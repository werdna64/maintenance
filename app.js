// Bump alongside sw.js's CACHE_NAME and version.json's "version" field
// on every release — this is what the update banner compares against.
// Semantic versioning: 0.1.x = Pre-release (you, solo testing), 0.2.x =
// Beta (others using it), 1.0.0+ = Release. APP_STAGE is the human label
// shown alongside the number — bump it (and version.json's "stage") when
// you actually move to the next phase, not on every release.
const APP_VERSION = '0.1.19';
const APP_STAGE = 'Pre-release';

const STATUSES = ["Open","In Progress","Awaiting Parts","Done"];
const STATUS_ORDER = {"Open":0,"In Progress":1,"Awaiting Parts":1,"Done":2};

let jobs = [];
let rooms = [];      // { id, number, area }
let walks = [];       // completed Fire & Security Walk sessions
let config = { siteName: "Maintenance Tracker", areas: [], commonIssues: [], departments: [], walkFaults: [] };
let activeFilter = "Active"; // "Active" = everything except Done, the default view
let collapsedAreas = new Set(); // area names the user has manually collapsed
let editingId = null;
let currentRole = null;
let currentUser = null;   // { uid, role, name, department }
let sheetReadOnly = false;
let lastSeenAt = null;

let unsubJobs = null, unsubRooms = null, unsubConfig = null, unsubLastSeen = null, unsubWalks = null;

const el = id => document.getElementById(id);

function toast(msg){
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1600);
}

function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
}

function fmtDateTime(iso){
  if(!iso) return '';
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
  const time = d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  return `${date}, ${time}`;
}

function fmtTimeOnly(iso){
  if(!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}

function fmtElapsed(ms){
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2,'0')}s` : `${s}s`;
}

function uid(prefix){
  return prefix + Date.now() + Math.random().toString(36).slice(2,7);
}

function roomArea(roomNumber){
  const r = rooms.find(r => r.number === roomNumber);
  return r ? r.area : 'Unassigned';
}

// Notes used to be a single overwritable string; they're now a list of
// individually-signed entries. This reads either shape as a normalized
// array without touching the job — jobs migrate to the new shape the
// next time a note is actually added to them.
function normalizeNotes(job){
  if(Array.isArray(job.notes)) return job.notes;
  if(typeof job.notes === 'string' && job.notes.trim()){
    return [{
      text: job.notes,
      authorName: job.notesUpdatedByName || job.createdByName || '',
      authorUid: job.notesUpdatedByUid || job.createdByUid || '',
      createdAt: job.notesUpdatedAt || job.dateLogged
    }];
  }
  return [];
}

// ---------------- version check ----------------

let updateAvailable = false;

async function checkForUpdate(){
  if(updateAvailable) return; // already showing the banner, no need to re-check
  try{
    const res = await fetch('version.json?_=' + Date.now(), { cache: 'no-store' });
    if(!res.ok) return;
    const data = await res.json();
    const changed = (data.version && String(data.version) !== APP_VERSION)
      || (data.stage && String(data.stage) !== APP_STAGE);
    if(changed){
      updateAvailable = true;
      el('updateBanner').classList.add('show');
      if('serviceWorker' in navigator){
        const reg = await navigator.serviceWorker.getRegistration();
        if(reg) reg.update().catch(()=>{});
      }
    }
  }catch(e){
    // Offline or blocked — nothing to do, the currently loaded copy still works.
  }
}

async function reloadForUpdate(){
  try{
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if(window.caches){
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  }catch(e){
    // Best effort — reload regardless, the new service worker/cache will
    // still take over on the next load even if cleanup partly failed.
  }
  // Clearing the service worker's own Cache Storage (above) doesn't touch
  // the browser's separate HTTP cache — a plain location.reload() can
  // still be answered from there with the exact same stale app.js,
  // leaving the update banner stuck reappearing every time it's tapped.
  // A cache-busting query string forces a genuinely fresh request.
  const url = new URL(location.href);
  url.searchParams.set('_', Date.now());
  location.href = url.toString();
}

// ---------------- login ----------------

function resetLoginForm(){
  el('usernameInput').value = '';
  el('pinInput').value = '';
  el('loginError').textContent = '';
}

async function handleLogin(){
  const username = el('usernameInput').value.trim();
  const pin = el('pinInput').value.trim();
  if(!username || !pin){ el('loginError').textContent = 'Enter your username and PIN.'; return; }
  el('pinSubmitBtn').disabled = true;
  try{
    await DB.signIn(username, pin);
    // DB.onAuthChange fires and drives the rest of the UI switch.
  }catch(e){
    el('loginError').textContent = 'Incorrect username or PIN.';
  }finally{
    el('pinSubmitBtn').disabled = false;
  }
}

async function handleLogout(){
  if(unsubJobs) unsubJobs();
  if(unsubRooms) unsubRooms();
  if(unsubConfig) unsubConfig();
  if(unsubLastSeen) unsubLastSeen();
  if(unsubWalks) unsubWalks();
  unsubJobs = unsubRooms = unsubConfig = unsubLastSeen = unsubWalks = null;
  lastSeenAt = null;
  await DB.signOut();
}

function applyRolePermissions(role){
  const roleLabel = role[0].toUpperCase()+role.slice(1);
  el('roleBadge').textContent = currentUser.name ? `${currentUser.name} · ${roleLabel}` : roleLabel;
  el('settingsBtn').style.display = (role === 'maintenance') ? '' : 'none';
  el('walkBtn').style.display = (role === 'maintenance' || role === 'housekeeping') ? '' : 'none';

  if(role === 'maintenance'){
    el('fabAdd').style.display = '';
    el('fabAdd').onclick = ()=>openJobSheet(null);
  } else if(role === 'housekeeping'){
    el('fabAdd').style.display = '';
    el('fabAdd').onclick = ()=>openReportSheet();
  } else {
    el('fabAdd').style.display = 'none';
  }
}

// ---------------- realtime data wiring ----------------

// Config (site name, areas, common issues) is authenticated-only, like
// everything else operational — the login screen shows a generic name
// rather than exposing the real site name (and areas/common issues) to
// anyone who finds the public repo's Firebase project, unauthenticated.
function subscribeData(){
  unsubJobs = DB.onJobsChange(list => { jobs = list; render(); renderNotifications(); });
  unsubRooms = DB.onRoomsChange(list => { rooms = list; renderAreaSelects(); renderRoomSelect(); render(); });
  unsubWalks = DB.onWalksChange(list => { walks = list; renderWalkHistory(); });
  unsubConfig = DB.onConfigChange(cfg => {
    config = cfg || { siteName: "Maintenance Tracker", areas: [], commonIssues: [], departments: [], walkFaults: [] };
    if(!config.areas) config.areas = [];
    if(!config.commonIssues) config.commonIssues = [];
    // Departments and walk faults get a sensible starter list the first
    // time this config doc is ever seen missing them — distinct from a
    // deliberately emptied list, which stays empty. Only maintenance can
    // write config (see firestore.rules), so only seed from that role.
    let needsSeed = false;
    if(!config.departments){
      config.departments = ['Housekeeping','Reception','Night Team','Duty Manager','Maintenance','Fire & Security Walk'];
      needsSeed = true;
    }
    if(!config.walkFaults){
      config.walkFaults = ['Corridor lighting','P10 fault','Fire door','Fire extinguisher','Emergency lighting','Exit sign','Other'];
      needsSeed = true;
    }
    if(needsSeed && currentRole === 'maintenance'){
      DB.setConfig(config).catch(()=>{});
    }
    renderHeader();
    renderAreaSelects();
    renderIssuePresetSelects();
    renderSourceSelect();
    render();
  });
  unsubLastSeen = DB.onLastSeenChange(ts => {
    if(ts === null){
      // Never checked before — seed to "now" so the whole pre-existing
      // backlog doesn't dump into the panel the first time this ships.
      lastSeenAt = new Date().toISOString();
      DB.markNotificationsSeen().catch(()=>{});
    } else {
      lastSeenAt = ts;
    }
    renderNotifications();
  });
}

// ---------------- rendering: header / chips ----------------

function renderHeader(){
  el('siteTitle').textContent = config.siteName ? `Maintenance Tracker @ ${config.siteName}` : 'Maintenance Tracker';
}

function renderChips(){
  const wrap = el('statusChips');
  wrap.innerHTML = '';
  ['Active', 'All', ...STATUSES].forEach(s=>{
    const c = document.createElement('div');
    c.className = 'chip' + (activeFilter===s ? ' active':'');
    c.textContent = s;
    c.onclick = ()=>{ activeFilter = s; render(); };
    wrap.appendChild(c);
  });
}

function renderAreaSelects(){
  const options = `<option value="">Select area…</option>` +
    (config.areas||[]).map(a=>`<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
  const currentJobArea = el('f_area').value;
  const currentSettingsArea = el('s_newRoomArea').value;
  el('f_area').innerHTML = options;
  el('s_newRoomArea').innerHTML = options;
  if((config.areas||[]).includes(currentJobArea)) el('f_area').value = currentJobArea;
  if((config.areas||[]).includes(currentSettingsArea)) el('s_newRoomArea').value = currentSettingsArea;
}

function renderIssuePresetSelects(){
  const options = `<option value="">Other (type your own)…</option>` +
    (config.commonIssues||[]).map(i=>`<option value="${escapeHtml(i)}">${escapeHtml(i)}</option>`).join('');
  el('f_issuePreset').innerHTML = options;
  el('r_issuePreset').innerHTML = options;
}

function renderSourceSelect(){
  const current = el('f_source').value;
  el('f_source').innerHTML = `<option value="">Select…</option>` +
    (config.departments||[]).map(d=>`<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  if((config.departments||[]).includes(current)) el('f_source').value = current;
}

function renderRoomSelect(){
  const sorted = [...rooms].sort((a,b)=> a.number.localeCompare(b.number, undefined, {numeric:true}));
  const options = `<option value="">Select room…</option>` +
    sorted.map(r=>`<option value="${escapeHtml(r.number)}">${escapeHtml(r.number)} — ${escapeHtml(r.area)}</option>`).join('');

  const currentReportRoom = el('r_room').value;
  el('r_room').innerHTML = options;
  if(sorted.some(r=>r.number === currentReportRoom)) el('r_room').value = currentReportRoom;

  const currentJobRoom = el('f_room').value;
  el('f_room').innerHTML = options;
  if(sorted.some(r=>r.number === currentJobRoom)) el('f_room').value = currentJobRoom;
}

// ---------------- notifications ----------------
// In-app only: derived live from the jobs already synced, compared
// against a per-person "last seen" watermark. Nothing is pushed while
// the app is closed, but nothing is lost either — reopening the app
// recomputes exactly what happened since last time, however long ago.

function computeNotifications(){
  if(!currentUser || !lastSeenAt) return [];
  const since = new Date(lastSeenAt).getTime();
  const items = [];

  jobs.forEach(j=>{
    // New job reported by someone else — surfaced to Maintenance.
    if(currentRole === 'maintenance' && j.createdByUid && j.createdByUid !== currentUser.uid){
      const t = new Date(j.dateLogged).getTime();
      if(t > since){
        items.push({
          time: t, tag: 'New',
          title: `Room ${j.room} — ${j.issue || '(no description)'}`,
          meta: `Reported by ${j.createdByName || 'someone'} · ${fmtDateTime(j.dateLogged)}`,
          job: j
        });
      }
    }
    // A job you logged was changed by someone else.
    if(j.createdByUid === currentUser.uid && j.updatedByUid && j.updatedByUid !== currentUser.uid && j.updatedAt){
      const t = new Date(j.updatedAt).getTime();
      if(t > since){
        items.push({
          time: t, tag: 'Updated',
          title: `Room ${j.room} — now ${j.status}`,
          meta: `By ${j.updatedByName || 'someone'} · ${fmtDateTime(j.updatedAt)}`,
          job: j
        });
      }
    }
  });

  items.sort((a,b)=> b.time - a.time);
  return items.slice(0, 20);
}

function renderNotifications(){
  const items = computeNotifications();

  const countEl = el('notifCount');
  if(items.length > 0){
    countEl.textContent = items.length > 9 ? '9+' : String(items.length);
    countEl.classList.add('show');
  } else {
    countEl.classList.remove('show');
  }

  const list = el('notifList');
  list.innerHTML = '';
  if(items.length === 0){
    list.innerHTML = `<div class="notif-empty">No new notifications</div>`;
    return;
  }
  items.forEach(n=>{
    const btn = document.createElement('button');
    btn.className = 'notif-item';
    btn.innerHTML = `
      <span class="notif-tag">${escapeHtml(n.tag)}</span>
      <span class="notif-body">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-meta">${escapeHtml(n.meta)}</div>
      </span>
    `;
    btn.addEventListener('click', ()=>{
      closeNotifPanel();
      openJobSheet(n.job);
    });
    list.appendChild(btn);
  });
}

function openNotifPanel(){
  renderNotifications();
  el('notifBackdrop').classList.add('open');
}

function closeNotifPanel(){
  el('notifBackdrop').classList.remove('open');
  // Mark as seen on close, not open — so the list doesn't empty out from
  // under someone while they're still looking at what's new.
  DB.markNotificationsSeen().catch(()=>{});
}

// ---------------- rendering: job list ----------------

function render(){
  const q = el('searchInput').value.trim().toLowerCase();
  let filtered = jobs.filter(j=>{
    if(activeFilter === 'Active'){ if(j.status === 'Done') return false; }
    else if(activeFilter !== 'All' && j.status !== activeFilter) return false;
    if(q && !j.room.toLowerCase().includes(q)) return false;
    return true;
  });

  filtered.sort((a,b)=>{
    const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if(so !== 0) return so;
    return (b.dateLogged||'').localeCompare(a.dateLogged||'');
  });

  if(jobs.length === 0){
    el('summaryLine').textContent = 'No jobs logged yet';
  } else {
    const counts = { Open:0, "In Progress":0, "Awaiting Parts":0, Done:0 };
    jobs.forEach(j=>{ if(counts[j.status] !== undefined) counts[j.status]++; });
    el('summaryLine').textContent =
      `${counts.Open} Open · ${counts["In Progress"]} In Progress · ${counts["Awaiting Parts"]} Awaiting Parts · ${counts.Done} Done`;
  }

  const list = el('list');
  list.innerHTML = '';

  if(filtered.length === 0){
    list.innerHTML = `<div class="empty"><div class="big">No jobs match</div></div>`;
    return;
  }

  // group by area, then room
  const byArea = {};
  filtered.forEach(j=>{
    const area = roomArea(j.room);
    if(!byArea[area]) byArea[area] = {};
    if(!byArea[area][j.room]) byArea[area][j.room] = [];
    byArea[area][j.room].push(j);
  });

  const areaKeys = Object.keys(byArea).sort((a,b)=>{
    const idxA = (config.areas||[]).indexOf(a);
    const idxB = (config.areas||[]).indexOf(b);
    if(idxA === -1 && idxB === -1) return a.localeCompare(b);
    if(idxA === -1) return 1;
    if(idxB === -1) return -1;
    return idxA - idxB;
  });

  areaKeys.forEach(area=>{
    const areaJobCount = Object.values(byArea[area]).reduce((n, arr) => n + arr.length, 0);
    const g = document.createElement('details');
    g.className = 'group';
    if(!collapsedAreas.has(area)) g.open = true;
    g.addEventListener('toggle', ()=>{
      if(g.open) collapsedAreas.delete(area); else collapsedAreas.add(area);
    });
    g.innerHTML = `<summary class="group-label"><span class="area-label">${escapeHtml(area)}</span><span class="group-count">${areaJobCount}</span><div class="rule"></div></summary>`;

    const roomKeys = Object.keys(byArea[area]).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
    roomKeys.forEach(room=>{
      byArea[area][room].forEach(j=>{
        const card = document.createElement('div');
        card.className = 'card';
        const statusClass = 'status-' + j.status.replace(/ /g,'-');
        const canEdit = currentRole === 'maintenance';
        const noteEntries = normalizeNotes(j);
        const lastNote = noteEntries[noteEntries.length - 1];
        const plaqueClass = 'plaque' + (j.room.length > 7 ? ' long' : '');
        card.innerHTML = `
          <div class="${plaqueClass}">${escapeHtml(j.room)}</div>
          <div class="card-body">
            <div class="card-top">
              <div class="issue">${escapeHtml(j.issue || '(no description)')}</div>
              ${canEdit
                ? `<button class="status-btn ${statusClass}" data-id="${j.id}">${j.status}</button>`
                : `<span class="status-badge ${statusClass}">${j.status}</span>`}
            </div>
            <div class="meta">
              ${j.createdByName
                ? `<div>Logged ${fmtDateTime(j.dateLogged)} · ${escapeHtml(j.createdByName)}${j.source ? ` · ${escapeHtml(j.source)}` : ''}</div>`
                : `<div>${fmtDateTime(j.dateLogged)}${j.source ? ` · ${escapeHtml(j.source)}` : ''}</div>`}
              ${(j.updatedByName && j.updatedAt && j.updatedAt !== j.dateLogged)
                ? `<div>Updated ${fmtDateTime(j.updatedAt)} · ${escapeHtml(j.updatedByName)}</div>` : ''}
            </div>
            ${lastNote ? `<div class="notes">${escapeHtml(lastNote.text)}
              <span class="notes-meta">— ${escapeHtml(lastNote.authorName || 'someone')}, ${fmtDateTime(lastNote.createdAt)}</span>
              ${noteEntries.length > 1 ? `<span class="notes-meta"> (+${noteEntries.length - 1} more)</span>` : ''}
            </div>` : ''}
          </div>
        `;
        card.querySelector('.card-body').addEventListener('click', (e)=>{
          if(e.target.classList.contains('status-btn')) return;
          openJobSheet(j);
        });
        const btn = card.querySelector('.status-btn');
        if(btn){
          btn.addEventListener('click', (e)=>{
            e.stopPropagation();
            cycleStatus(j);
          });
        }
        g.appendChild(card);
      });
    });
    list.appendChild(g);
  });
}

function stampAudit(job, isNew){
  job.updatedByUid = currentUser.uid;
  job.updatedByName = currentUser.name;
  job.updatedAt = new Date().toISOString();
  if(isNew){
    job.createdByUid = currentUser.uid;
    job.createdByName = currentUser.name;
  }
}

async function cycleStatus(j){
  if(currentRole !== 'maintenance') return;
  const idx = STATUSES.indexOf(j.status);
  const nextStatus = STATUSES[(idx+1) % STATUSES.length];
  if(nextStatus === 'Done'){
    // Marking a job Done needs a record of what was actually done to
    // fix it — open the sheet instead of applying the status instantly,
    // so there's somewhere to add that note before it's saved.
    openJobSheet(j);
    el('f_status').value = 'Done';
    el('f_newNote').focus();
    toast('Add a note on what was done, then Save');
    return;
  }
  j.status = nextStatus;
  j.dateClosed = '';
  stampAudit(j, false);
  await DB.putJob(j);
  toast(`${j.room} → ${j.status}`);
}

// ---------------- job sheet (maintenance: edit, others: view) ----------------

function openJobSheet(job){
  const canEdit = currentRole === 'maintenance';
  sheetReadOnly = !canEdit;
  editingId = job ? job.id : null;
  el('sheetTitle').textContent = job ? `${canEdit ? 'Edit' : 'View'} — Room ${job.room}` : 'New job';
  el('f_room').value = job ? job.room : '';
  el('f_area').value = job ? roomArea(job.room) : '';
  el('f_issuePreset').value = '';
  el('f_issue').value = job ? (job.issue||'') : '';
  el('f_status').value = job ? job.status : 'Open';
  el('f_source').value = job ? (job.source||'') : (currentUser.department || '');
  // New jobs always start Open — status only becomes changeable once a
  // job exists, and only maintenance can change it (cycle button or here).
  el('statusField').style.display = job ? '' : 'none';

  if(job && job.createdByName){
    const createdLine = `Logged by ${job.createdByName} on ${fmtDateTime(job.dateLogged)}`;
    const hasUpdate = job.updatedByName && job.updatedAt && job.updatedAt !== job.dateLogged;
    const updatedLine = hasUpdate
      ? ` · Updated by ${job.updatedByName} on ${fmtDateTime(job.updatedAt)}` : '';
    const sourceLine = job.source ? ` · Reported by ${job.source}` : '';
    el('sheetAudit').textContent = createdLine + updatedLine + sourceLine;
  } else {
    el('sheetAudit').textContent = '';
  }

  renderNotesList(job);
  el('f_newNote').value = '';
  el('addNoteRow').style.display = (job && canEdit) ? 'flex' : 'none';

  ['f_room','f_source','f_issuePreset','f_issue','f_status'].forEach(id=>{
    el(id).disabled = sheetReadOnly;
  });
  el('f_area').disabled = true; // always derived from the selected room — manage areas in Settings
  el('deleteBtn').style.display = (job && canEdit) ? 'block' : 'none';
  el('saveBtn').style.display = canEdit ? 'block' : 'none';
  el('cancelBtn').textContent = canEdit ? 'Cancel' : 'Close';
  el('sheetBackdrop').classList.add('open');
}

function closeJobSheet(){
  el('sheetBackdrop').classList.remove('open');
  editingId = null;
}

function renderNotesList(job){
  const wrap = el('notesList');
  const entries = job ? normalizeNotes(job) : [];
  if(entries.length === 0){
    wrap.innerHTML = `<div class="notes-empty">No notes yet</div>`;
    return;
  }
  wrap.innerHTML = entries.map(n => `
    <div class="note-entry">
      <div class="note-text">${escapeHtml(n.text)}</div>
      <div class="notes-meta">${escapeHtml(n.authorName || 'someone')}, ${fmtDateTime(n.createdAt)}</div>
    </div>
  `).join('');
}

async function handleAddNote(){
  if(currentRole !== 'maintenance' || !editingId) return;
  const text = el('f_newNote').value.trim();
  if(!text) return;
  const job = jobs.find(j=>j.id===editingId);
  if(!job) return;

  const notes = normalizeNotes(job);
  notes.push({
    text,
    authorUid: currentUser.uid,
    authorName: currentUser.name,
    createdAt: new Date().toISOString()
  });
  job.notes = notes;
  stampAudit(job, false);

  await DB.putJob(job);
  el('f_newNote').value = '';
  renderNotesList(job);
  toast('Note added');
}

async function ensureRoomExists(number, area){
  if(!number) return;
  let r = rooms.find(r => r.number === number);
  if(!r){
    r = { id: uid('r'), number, area: area || 'Unassigned' };
    await DB.putRoom(r);
  } else if(area && r.area !== area){
    r.area = area;
    await DB.putRoom(r);
  }
  if(area && !(config.areas||[]).includes(area)){
    config.areas = [...(config.areas||[]), area];
    await DB.setConfig(config);
  }
}

async function handleSaveJob(){
  if(currentRole !== 'maintenance') return;
  const room = el('f_room').value.trim();
  if(!room){ toast('Room is required'); return; }

  const isNew = !editingId;
  let job = editingId ? jobs.find(j=>j.id===editingId) : null;
  if(!job){
    job = { id: uid('j'), dateLogged: new Date().toISOString() };
  }
  // New jobs always start Open regardless of who's creating them — the
  // status field is only shown (and only readable from f_status) when
  // editing an existing job.
  const status = isNew ? 'Open' : el('f_status').value;

  // Marking a job Done needs a record of what was actually done to fix
  // it — block the save until the note thread has at least one entry
  // (add one via the Notes section above, then Save again).
  if(status === 'Done' && normalizeNotes(job).length === 0){
    toast('Add a note on what was done before marking Done');
    el('f_newNote').focus();
    return;
  }

  job.room = room;
  job.issue = el('f_issue').value.trim();
  job.status = status;
  job.source = el('f_source').value || currentUser.department || 'Maintenance';
  job.dateClosed = (status === 'Done') ? (job.dateClosed || new Date().toISOString()) : '';
  stampAudit(job, isNew);

  await DB.putJob(job);
  closeJobSheet();
  toast('Saved');
}

// Deleting a job removes it entirely — unlike marking Done, there's no
// note thread left behind to explain why. A reason is required and
// kept as a permanent record (with a full snapshot of the job) in a
// separate deletedJobs collection, so the "why" survives even though
// the job itself doesn't.
function openDeleteConfirm(){
  if(currentRole !== 'maintenance' || !editingId) return;
  const job = jobs.find(j=>j.id===editingId);
  if(!job) return;
  el('deleteConfirmSummary').textContent = `Room ${job.room} — ${job.issue || '(no description)'}`;
  el('deleteReason').value = '';
  el('deleteConfirmBackdrop').classList.add('open');
}

function closeDeleteConfirm(){
  el('deleteConfirmBackdrop').classList.remove('open');
}

async function handleConfirmDelete(){
  if(currentRole !== 'maintenance' || !editingId) return;
  const reason = el('deleteReason').value.trim();
  if(!reason){ toast('A reason is required'); return; }
  const job = jobs.find(j=>j.id===editingId);
  if(!job) return;

  await DB.putDeletedJobRecord({
    id: uid('d'),
    job,
    reason,
    deletedByUid: currentUser.uid,
    deletedByName: currentUser.name,
    deletedAt: new Date().toISOString()
  });
  await DB.deleteJob(editingId);

  closeDeleteConfirm();
  closeJobSheet();
  toast('Deleted');
}

// ---------------- report sheet (housekeeping: raise a problem) ----------------

function openReportSheet(){
  el('r_room').value = '';
  el('r_issuePreset').value = '';
  el('r_issue').value = '';
  el('reportBackdrop').classList.add('open');
}

function closeReportSheet(){
  el('reportBackdrop').classList.remove('open');
}

async function handleSubmitReport(){
  const room = el('r_room').value.trim();
  if(!room){ toast('Select a room'); return; }
  const issue = el('r_issue').value.trim();
  if(!issue){ toast('Describe the problem'); return; }

  const job = {
    id: uid('j'),
    room,
    issue,
    status: 'Open',
    notes: '',
    source: currentUser.department || 'Housekeeping',
    dateLogged: new Date().toISOString(),
    dateClosed: ''
  };
  stampAudit(job, true);
  await DB.putJob(job);
  closeReportSheet();
  toast('Reported — thanks!');
}

// ---------------- Fire & Security Walk wizard ----------------
// Floor-by-floor (one step per Area), each with a multi-select fault
// checklist that defaults to none selected ("all in order") plus an
// optional freehand note. Nothing is written to Firestore until "Finish
// walk" on the last floor — everything lives in memory until then, so
// "Cancel walk" can discard it all with zero partial writes. Findings
// attach to an auto-created "{Area} Corridor" room per floor (a
// floor-unique room number, so different floors' corridor jobs don't
// collide into one room group).

let walkAreas = [];
let walkIndex = 0;
let walkData = {}; // { [area]: { faults: Set<string>, note: string, completedAt: string|null } }
let walkStartedAt = null;

// Walk order: floors highest-to-lowest (9th Floor down to 1st, however
// they're named — first number found in the area name), then any
// non-floor areas (Bar, Kitchen, Reception, ...) after, in whatever
// order they're listed in Settings. This only affects the walk's own
// step order — the main job list still groups by config.areas' order.
function floorNumber(area){
  const m = String(area).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function walkAreaOrder(areas){
  const floors = [], others = [];
  areas.forEach(a=>{
    const n = floorNumber(a);
    if(n !== null) floors.push({a, n}); else others.push(a);
  });
  floors.sort((x,y)=> y.n - x.n);
  return [...floors.map(f=>f.a), ...others];
}

function openWalkWizard(){
  if(!(config.areas||[]).length){ toast('Add areas in Settings first'); return; }
  walkAreas = walkAreaOrder(config.areas);
  walkIndex = 0;
  walkData = {};
  walkStartedAt = new Date().toISOString();
  walkAreas.forEach(a => walkData[a] = { faults: new Set(), note: '', completedAt: null });
  renderWalkStep();
  el('walkBackdrop').classList.add('open');
}

function closeWalkWizard(){
  el('walkBackdrop').classList.remove('open');
}

function renderWalkStep(){
  const area = walkAreas[walkIndex];
  const data = walkData[area];
  el('walkProgress').textContent = `Floor ${walkIndex + 1} of ${walkAreas.length}`;
  el('walkFloorName').textContent = area;

  const wrap = el('walkFaultChips');
  wrap.innerHTML = '';
  (config.walkFaults||[]).forEach(f=>{
    const chip = document.createElement('div');
    chip.className = 'chip' + (data.faults.has(f) ? ' active' : '');
    chip.textContent = f;
    chip.addEventListener('click', ()=>{
      if(data.faults.has(f)) data.faults.delete(f); else data.faults.add(f);
      chip.classList.toggle('active');
    });
    wrap.appendChild(chip);
  });

  el('walkNote').value = data.note;
  el('walkBackBtn').style.display = walkIndex > 0 ? '' : 'none';
  el('walkNextBtn').textContent = (walkIndex === walkAreas.length - 1) ? 'Finish walk' : 'Next floor';
}

function saveCurrentWalkStep(){
  const area = walkAreas[walkIndex];
  if(area) walkData[area].note = el('walkNote').value.trim();
}

function walkGoBack(){
  saveCurrentWalkStep();
  if(walkIndex > 0){
    walkIndex--;
    renderWalkStep();
  }
}

async function walkGoNext(){
  saveCurrentWalkStep();
  // Stamped on forward progress only — going Back to revise a floor
  // doesn't count as re-completing it until Next is tapped again, so a
  // gap between two floors' timestamps always reflects real time spent.
  walkData[walkAreas[walkIndex]].completedAt = new Date().toISOString();
  if(walkIndex === walkAreas.length - 1){
    await finishWalk();
  } else {
    walkIndex++;
    renderWalkStep();
  }
}

async function createWalkJob(area, issue, note){
  const job = {
    id: uid('j'),
    room: `${area} Corridor`,
    issue,
    status: 'Open',
    source: 'Fire & Security Walk',
    dateLogged: new Date().toISOString(),
    dateClosed: ''
  };
  if(note){
    job.notes = [{
      text: note,
      authorUid: currentUser.uid,
      authorName: currentUser.name,
      createdAt: job.dateLogged
    }];
  }
  stampAudit(job, true);
  await DB.putJob(job);
}

// A named fault (from the Walk Faults checklist, not a freehand "Walk
// note") gets matched against any job already open for that exact
// room + issue text before logging a new one — so a fault a walk keeps
// re-finding (an EM light fitting that takes days to build, test and
// fit) stays as the ONE job it already is, tracked through its status
// changes, rather than spawning a fresh duplicate every walk that
// re-confirms it's still broken. Returns true if a new job was created,
// false if an existing one was found (and, when possible, reconfirmed).
async function logWalkFinding(area, issue, note){
  const room = `${area} Corridor`;
  const existing = jobs.find(j => j.room === room && j.issue === issue && j.status !== 'Done');
  if(existing){
    // Only Maintenance can update an existing job (firestore.rules) —
    // a Maintenance-conducted walk appends a "still present" note; a
    // Housekeeping-role walk (covers night staff/duty managers) simply
    // doesn't touch the job, since it can't. Either way the walk's own
    // record (Walk History) still shows the fault was found again today.
    if(currentRole === 'maintenance'){
      const notes = normalizeNotes(existing);
      notes.push({
        text: note || "Still present on today's walk",
        authorUid: currentUser.uid,
        authorName: currentUser.name,
        createdAt: new Date().toISOString()
      });
      existing.notes = notes;
      stampAudit(existing, false);
      await DB.putJob(existing);
    }
    return false;
  }
  await createWalkJob(area, issue, note);
  return true;
}

async function finishWalk(){
  const floors = walkAreas.map(area=>{
    const data = walkData[area];
    const faults = Array.from(data.faults);
    return { area, faults, note: data.note || '', allClear: faults.length === 0 && !data.note, completedAt: data.completedAt };
  });

  let newCount = 0, reconfirmedCount = 0;
  for(const floor of floors){
    if(floor.allClear) continue;
    await ensureRoomExists(`${floor.area} Corridor`, floor.area);
    if(floor.faults.length === 0){
      // Freehand notes aren't matched/de-duplicated — different days'
      // notes are usually about different things, so each is its own job.
      await createWalkJob(floor.area, 'Walk note', floor.note);
      newCount++;
    } else {
      for(const fault of floor.faults){
        const isNew = await logWalkFinding(floor.area, fault, floor.note);
        if(isNew) newCount++; else reconfirmedCount++;
      }
    }
  }

  // Record the walk itself — even an all-clear one — so there's proof
  // the walk actually happened, not just a trail of faults found.
  const walk = {
    id: uid('w'),
    conductedByUid: currentUser.uid,
    conductedByName: currentUser.name,
    startedAt: walkStartedAt,
    finishedAt: new Date().toISOString(),
    floors
  };
  await DB.putWalk(walk);

  closeWalkWizard();
  let msg;
  if(newCount === 0 && reconfirmedCount === 0) msg = 'Walk logged — all in order';
  else if(newCount > 0 && reconfirmedCount > 0) msg = `Walk logged — ${newCount} new, ${reconfirmedCount} still open`;
  else if(newCount > 0) msg = `Walk logged — ${newCount} new issue${newCount===1?'':'s'}`;
  else msg = `Walk logged — ${reconfirmedCount} already logged`;
  toast(msg);
}

// ---------------- Walk History report (all signed-in roles) ----------------

function openWalkHistory(){
  renderWalkHistory();
  el('walkHistoryBackdrop').classList.add('open');
}

function closeWalkHistory(){
  el('walkHistoryBackdrop').classList.remove('open');
}

// Local calendar day the walk started on (not the raw UTC date in the
// ISO string) — so a late-night walk groups with the day staff would
// actually call "today."
function walkDayKey(iso){
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDayHeading(dayKey){
  const [y,m,d] = dayKey.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'});
}

function walkSummary(w){
  const floors = w.floors || [];
  const totalFaults = floors.reduce((n,f)=> n + (f.faults ? f.faults.length : 0), 0);
  const anyIssues = floors.some(f=>!f.allClear);
  const label = !anyIssues ? 'All clear' : (totalFaults > 0 ? `${totalFaults} issue${totalFaults===1?'':'s'} found` : 'Notes only');
  return { totalFaults, anyIssues, label };
}

function renderWalkHistory(){
  const wrap = el('walkHistoryList');
  const sorted = [...walks].sort((a,b)=> (b.startedAt||'').localeCompare(a.startedAt||''));

  if(sorted.length === 0){
    wrap.innerHTML = `<div class="notif-empty">No walks logged yet</div>`;
    return;
  }

  // Group into calendar days, most recent first — only the most recent
  // day starts expanded, so a long history stays a scroll of headings
  // rather than a wall of every walk ever done.
  const dayKeys = [];
  const byDay = {};
  sorted.forEach(w=>{
    const key = walkDayKey(w.startedAt);
    if(!byDay[key]){ byDay[key] = []; dayKeys.push(key); }
    byDay[key].push(w);
  });

  wrap.innerHTML = dayKeys.map((key, dayIdx)=>{
    const dayWalks = byDay[key];
    const dayFaults = dayWalks.reduce((n,w)=> n + walkSummary(w).totalFaults, 0);
    const dayIssueWalks = dayWalks.filter(w=>walkSummary(w).anyIssues).length;
    const dayStats = dayIssueWalks === 0
      ? `${dayWalks.length} walk${dayWalks.length===1?'':'s'} · all clear`
      : `${dayWalks.length} walk${dayWalks.length===1?'':'s'} · ${dayFaults} issue${dayFaults===1?'':'s'}`;

    return `
      <details class="walk-day"${dayIdx===0?' open':''}>
        <summary>
          <span class="walk-day-date">${escapeHtml(fmtDayHeading(key))}</span>
          <span class="walk-day-stats">${escapeHtml(dayStats)}</span>
        </summary>
        <div class="walk-day-body">
          ${dayWalks.map(w=>renderWalkEntry(w)).join('')}
        </div>
      </details>
    `;
  }).join('');
}

function renderWalkEntry(w){
  const floors = w.floors || [];
  const { anyIssues, label } = walkSummary(w);

  return `
      <div class="walk-entry">
        <div class="walk-entry-head">
          <div>
            <div class="walk-entry-date">${fmtDateTime(w.startedAt)}</div>
            <div class="walk-entry-by">${escapeHtml(w.conductedByName || 'someone')}</div>
          </div>
          <span class="walk-entry-summary ${anyIssues ? 'has-issues' : 'clear'}">${escapeHtml(label)}</span>
        </div>
        <div class="walk-entry-floors">
          ${floors.map((f,i)=>{
            // Elapsed since the previous floor was completed (or since
            // the walk started, for the first floor) — a run of very
            // short gaps is the tell for someone tapping through at
            // their desk instead of actually walking the floors.
            const prevTime = i === 0 ? w.startedAt : floors[i-1].completedAt;
            const elapsed = (f.completedAt && prevTime)
              ? fmtElapsed(new Date(f.completedAt) - new Date(prevTime)) : '';
            return `
            <div class="walk-floor-row">
              <span class="walk-floor-label">${escapeHtml(f.area)}</span>
              ${f.allClear
                ? `<span class="walk-clear-badge">All clear</span>`
                : (f.faults && f.faults.length
                  ? `<span class="walk-fault-list">${f.faults.map(fault=>`<span class="fault-chip">${escapeHtml(fault)}</span>`).join('')}</span>`
                  : '')}
              ${f.completedAt ? `<span class="walk-floor-time">${fmtTimeOnly(f.completedAt)}${elapsed ? ` · +${elapsed}` : ''}</span>` : ''}
              ${f.note ? `<div class="walk-floor-note">${escapeHtml(f.note)}</div>` : ''}
            </div>
          `;
          }).join('')}
        </div>
      </div>
    `;
}

// ---------------- User Guide (static content, works pre- and post-login) ----------------

function openGuide(){
  el('guideBackdrop').classList.add('open');
}

function closeGuide(){
  el('guideBackdrop').classList.remove('open');
}

// ---------------- settings sheet (maintenance only) ----------------

function openSettings(){
  el('s_siteName').value = config.siteName || '';
  renderAreaTags();
  renderCommonIssueTags();
  renderDepartmentTags();
  renderWalkFaultTags();
  renderRoomList();
  el('settingsBackdrop').classList.add('open');
}
function closeSettings(){
  el('settingsBackdrop').classList.remove('open');
}

function renderAreaTags(){
  const wrap = el('areaTagList');
  wrap.innerHTML = '';
  (config.areas||[]).forEach(a=>{
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `<span>${escapeHtml(a)}</span><button data-area="${escapeHtml(a)}">×</button>`;
    tag.querySelector('button').addEventListener('click', async ()=>{
      config.areas = config.areas.filter(x=>x!==a);
      await DB.setConfig(config);
      toast('Area removed');
    });
    wrap.appendChild(tag);
  });
}

function renderCommonIssueTags(){
  const wrap = el('commonIssueTagList');
  wrap.innerHTML = '';
  (config.commonIssues||[]).forEach(i=>{
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `<span>${escapeHtml(i)}</span><button data-issue="${escapeHtml(i)}">×</button>`;
    tag.querySelector('button').addEventListener('click', async ()=>{
      config.commonIssues = config.commonIssues.filter(x=>x!==i);
      await DB.setConfig(config);
      toast('Common issue removed');
    });
    wrap.appendChild(tag);
  });
}

function renderDepartmentTags(){
  const wrap = el('departmentTagList');
  wrap.innerHTML = '';
  (config.departments||[]).forEach(d=>{
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `<span>${escapeHtml(d)}</span><button data-department="${escapeHtml(d)}">×</button>`;
    tag.querySelector('button').addEventListener('click', async ()=>{
      config.departments = config.departments.filter(x=>x!==d);
      await DB.setConfig(config);
      toast('Department removed');
    });
    wrap.appendChild(tag);
  });
}

function renderWalkFaultTags(){
  const wrap = el('walkFaultTagList');
  wrap.innerHTML = '';
  (config.walkFaults||[]).forEach(f=>{
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `<span>${escapeHtml(f)}</span><button data-fault="${escapeHtml(f)}">×</button>`;
    tag.querySelector('button').addEventListener('click', async ()=>{
      config.walkFaults = config.walkFaults.filter(x=>x!==f);
      await DB.setConfig(config);
      toast('Walk fault removed');
    });
    wrap.appendChild(tag);
  });
}

function renderRoomList(){
  const wrap = el('roomList');
  wrap.innerHTML = '';
  const sorted = [...rooms].sort((a,b)=> a.number.localeCompare(b.number, undefined, {numeric:true}));
  sorted.forEach(r=>{
    const row = document.createElement('div');
    row.className = 'room-row';
    row.innerHTML = `<span class="r-num">${escapeHtml(r.number)}</span><span class="r-area">${escapeHtml(r.area)}</span><button data-id="${r.id}">×</button>`;
    row.querySelector('button').addEventListener('click', async ()=>{
      await DB.deleteRoom(r.id);
      renderRoomList();
      toast('Room removed');
    });
    wrap.appendChild(row);
  });
}

async function handleAddArea(){
  const val = el('s_newArea').value.trim();
  if(!val) return;
  if(!(config.areas||[]).includes(val)){
    config.areas = [...(config.areas||[]), val];
    await DB.setConfig(config);
  }
  el('s_newArea').value = '';
}

async function handleAddCommonIssue(){
  const val = el('s_newCommonIssue').value.trim();
  if(!val) return;
  if(!(config.commonIssues||[]).includes(val)){
    config.commonIssues = [...(config.commonIssues||[]), val];
    await DB.setConfig(config);
  }
  el('s_newCommonIssue').value = '';
}

async function handleAddDepartment(){
  const val = el('s_newDepartment').value.trim();
  if(!val) return;
  if(!(config.departments||[]).includes(val)){
    config.departments = [...(config.departments||[]), val];
    await DB.setConfig(config);
  }
  el('s_newDepartment').value = '';
}

async function handleAddWalkFault(){
  const val = el('s_newWalkFault').value.trim();
  if(!val) return;
  if(!(config.walkFaults||[]).includes(val)){
    config.walkFaults = [...(config.walkFaults||[]), val];
    await DB.setConfig(config);
  }
  el('s_newWalkFault').value = '';
}

async function handleAddRoom(){
  const num = el('s_newRoomNum').value.trim();
  const area = el('s_newRoomArea').value.trim();
  if(!num){ toast('Room number required'); return; }
  await ensureRoomExists(num, area);
  el('s_newRoomNum').value = '';
  el('s_newRoomArea').value = '';
  toast('Room added');
}

async function handleSaveSiteName(){
  config.siteName = el('s_siteName').value.trim() || 'Maintenance Tracker';
  await DB.setConfig(config);
}

// ---------------- wiring ----------------

el('pinSubmitBtn').addEventListener('click', handleLogin);
el('usernameInput').addEventListener('keydown', (e)=>{ if(e.key==='Enter') el('pinInput').focus(); });
el('pinInput').addEventListener('keydown', (e)=>{ if(e.key==='Enter') handleLogin(); });
el('logoutBtn').addEventListener('click', handleLogout);

el('f_room').addEventListener('change', ()=>{
  const area = roomArea(el('f_room').value);
  if((config.areas||[]).includes(area)) el('f_area').value = area;
});
el('f_issuePreset').addEventListener('change', ()=>{
  if(el('f_issuePreset').value) el('f_issue').value = el('f_issuePreset').value;
});
el('cancelBtn').addEventListener('click', closeJobSheet);
el('saveBtn').addEventListener('click', handleSaveJob);
el('addNoteBtn').addEventListener('click', handleAddNote);
el('f_newNote').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); handleAddNote(); } });
el('deleteBtn').addEventListener('click', openDeleteConfirm);
el('deleteConfirmCancelBtn').addEventListener('click', closeDeleteConfirm);
el('deleteConfirmBtn').addEventListener('click', handleConfirmDelete);
el('deleteConfirmBackdrop').addEventListener('click', (e)=>{ if(e.target.id==='deleteConfirmBackdrop') closeDeleteConfirm(); });
el('sheetBackdrop').addEventListener('click', (e)=>{ if(e.target.id==='sheetBackdrop') closeJobSheet(); });

el('r_issuePreset').addEventListener('change', ()=>{
  if(el('r_issuePreset').value) el('r_issue').value = el('r_issuePreset').value;
});
el('reportCancelBtn').addEventListener('click', closeReportSheet);
el('reportSubmitBtn').addEventListener('click', handleSubmitReport);
el('reportBackdrop').addEventListener('click', (e)=>{ if(e.target.id==='reportBackdrop') closeReportSheet(); });

el('walkBtn').addEventListener('click', openWalkWizard);
el('walkCancelBtn').addEventListener('click', closeWalkWizard);
el('walkBackBtn').addEventListener('click', walkGoBack);
el('walkNextBtn').addEventListener('click', walkGoNext);
el('walkBackdrop').addEventListener('click', (e)=>{ if(e.target.id==='walkBackdrop') closeWalkWizard(); });

el('walkHistoryBtn').addEventListener('click', openWalkHistory);
el('walkHistoryCloseBtn').addEventListener('click', closeWalkHistory);
el('walkHistoryBackdrop').addEventListener('click', (e)=>{ if(e.target.id==='walkHistoryBackdrop') closeWalkHistory(); });

el('guideBtn').addEventListener('click', openGuide);
el('loginGuideBtn').addEventListener('click', openGuide);
el('guideCloseBtn').addEventListener('click', closeGuide);
el('guideBackdrop').addEventListener('click', (e)=>{ if(e.target.id==='guideBackdrop') closeGuide(); });

el('searchInput').addEventListener('input', render);
el('showAllBtn').addEventListener('click', ()=>{
  el('searchInput').value = '';
  activeFilter = 'All';
  renderChips();
  render();
  toast('Showing all jobs');
});

el('notifBtn').addEventListener('click', openNotifPanel);
el('notifCloseBtn').addEventListener('click', closeNotifPanel);
el('notifBackdrop').addEventListener('click', (e)=>{ if(e.target.id==='notifBackdrop') closeNotifPanel(); });

el('settingsBtn').addEventListener('click', openSettings);
el('closeSettingsBtn').addEventListener('click', async ()=>{
  await handleSaveSiteName();
  closeSettings();
});
el('settingsBackdrop').addEventListener('click', (e)=>{ if(e.target.id==='settingsBackdrop') closeSettings(); });
el('addAreaBtn').addEventListener('click', handleAddArea);
el('addCommonIssueBtn').addEventListener('click', handleAddCommonIssue);
el('addDepartmentBtn').addEventListener('click', handleAddDepartment);
el('addWalkFaultBtn').addEventListener('click', handleAddWalkFault);
el('addRoomBtn').addEventListener('click', handleAddRoom);
el('s_siteName').addEventListener('blur', handleSaveSiteName);

// ---------------- init ----------------

renderChips();

DB.onAuthChange((user)=>{
  if(user){
    currentUser = user;
    currentRole = user.role;
    el('loginScreen').style.display = 'none';
    el('appRoot').style.display = '';
    applyRolePermissions(currentRole);
    subscribeData();
  } else {
    currentUser = null;
    currentRole = null;
    el('appRoot').style.display = 'none';
    el('loginScreen').style.display = '';
    resetLoginForm();
  }
});

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}

el('updateReloadBtn').addEventListener('click', reloadForUpdate);

el('versionTagLogin').textContent = `v${APP_VERSION} · ${APP_STAGE}`;

checkForUpdate();
setInterval(checkForUpdate, 15 * 60 * 1000); // catch a deploy while the app is left open
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible') checkForUpdate();
});
