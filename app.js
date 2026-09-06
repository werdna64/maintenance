// Bump alongside sw.js's CACHE_NAME and version.json's "version" field
// on every release — this is what the update banner compares against.
const APP_VERSION = '10';

const STATUSES = ["Open","In Progress","Awaiting Parts","Done"];
const STATUS_ORDER = {"Open":0,"In Progress":1,"Awaiting Parts":1,"Done":2};

let jobs = [];
let rooms = [];      // { id, number, area }
let config = { siteName: "Room Jobs", areas: [] };
let activeFilter = "All";
let editingId = null;
let currentRole = null;
let currentUser = null;   // { uid, role, name }
let sheetReadOnly = false;

let unsubJobs = null, unsubRooms = null, unsubConfig = null;

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

function uid(prefix){
  return prefix + Date.now() + Math.random().toString(36).slice(2,7);
}

function roomArea(roomNumber){
  const r = rooms.find(r => r.number === roomNumber);
  return r ? r.area : 'Unassigned';
}

// ---------------- version check ----------------

let updateAvailable = false;

async function checkForUpdate(){
  if(updateAvailable) return; // already showing the banner, no need to re-check
  try{
    const res = await fetch('version.json?_=' + Date.now(), { cache: 'no-store' });
    if(!res.ok) return;
    const data = await res.json();
    if(data.version && String(data.version) !== APP_VERSION){
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
  location.reload();
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
  unsubJobs = unsubRooms = unsubConfig = null;
  await DB.signOut();
}

function applyRolePermissions(role){
  const roleLabel = role[0].toUpperCase()+role.slice(1);
  el('roleBadge').textContent = currentUser.name ? `${currentUser.name} · ${roleLabel}` : roleLabel;
  el('settingsBtn').style.display = (role === 'maintenance') ? '' : 'none';

  if(role === 'maintenance'){
    el('fabAdd').style.display = '';
    el('fabAdd').onclick = ()=>openJobSheet(null);
  } else if(role === 'housekeeping'){
    el('fabAdd').style.display = '';
    el('fabAdd').onclick = ()=>openReportSheet();
  } else {
    el('fabAdd').style.display = 'none';
  }

  el('statsBar').style.display = (role === 'management') ? 'flex' : 'none';
}

// ---------------- realtime data wiring ----------------

function subscribeData(){
  unsubJobs = DB.onJobsChange(list => { jobs = list; render(); });
  unsubRooms = DB.onRoomsChange(list => { rooms = list; renderAreaSelects(); renderRoomSelect(); render(); });
  unsubConfig = DB.onConfigChange(cfg => {
    config = cfg || { siteName: "Room Jobs", areas: [] };
    if(!config.areas) config.areas = [];
    renderHeader();
    renderAreaSelects();
    render();
  });
}

// ---------------- rendering: header / chips ----------------

function renderHeader(){
  el('siteTitle').textContent = config.siteName || 'Room Jobs';
  el('siteEyebrow').textContent = 'Facilities';
}

function renderChips(){
  const wrap = el('statusChips');
  wrap.innerHTML = '';
  ['All', ...STATUSES].forEach(s=>{
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

function renderStats(){
  if(el('statsBar').style.display === 'none') return;
  const counts = { Open:0, "In Progress":0, "Awaiting Parts":0, Done:0 };
  jobs.forEach(j=>{ if(counts[j.status] !== undefined) counts[j.status]++; });
  el('statsBar').innerHTML = STATUSES.map(s=>`
    <div class="stat-tile">
      <div class="stat-num">${counts[s]}</div>
      <div class="stat-label">${escapeHtml(s)}</div>
    </div>
  `).join('');
}

// ---------------- rendering: job list ----------------

function render(){
  renderStats();

  const q = el('searchInput').value.trim().toLowerCase();
  let filtered = jobs.filter(j=>{
    if(activeFilter !== 'All' && j.status !== activeFilter) return false;
    if(q && !j.room.toLowerCase().includes(q)) return false;
    return true;
  });

  filtered.sort((a,b)=>{
    const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if(so !== 0) return so;
    return (b.dateLogged||'').localeCompare(a.dateLogged||'');
  });

  const openCount = jobs.filter(j=>j.status!=='Done').length;
  el('summaryLine').textContent = jobs.length===0
    ? 'No jobs logged yet'
    : `${openCount} open · ${jobs.length} total`;

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
    const g = document.createElement('div');
    g.className = 'group';
    g.innerHTML = `<div class="group-label"><span class="area-label">${escapeHtml(area)}</span><div class="rule"></div></div>`;

    const roomKeys = Object.keys(byArea[area]).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
    roomKeys.forEach(room=>{
      byArea[area][room].forEach(j=>{
        const card = document.createElement('div');
        card.className = 'card';
        const statusClass = 'status-' + j.status.replace(/ /g,'-');
        const canEdit = currentRole === 'maintenance';
        card.innerHTML = `
          <div class="plaque">${escapeHtml(j.room)}</div>
          <div class="card-body">
            <div class="issue">${escapeHtml(j.issue || '(no description)')}</div>
            <div class="meta">
              <span>${fmtDate(j.dateLogged)}</span>
              ${j.createdByName ? `<span>${escapeHtml(j.createdByName)}</span>` : ''}
              ${j.status==='Done' && j.dateClosed ? `<span>Closed ${fmtDate(j.dateClosed)}</span>` : ''}
            </div>
            ${j.notes ? `<div class="notes">${escapeHtml(j.notes)}</div>` : ''}
            ${canEdit
              ? `<button class="status-btn ${statusClass}" data-id="${j.id}">${j.status}</button>`
              : `<span class="status-badge ${statusClass}">${j.status}</span>`}
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
  if(isNew){
    job.createdByUid = currentUser.uid;
    job.createdByName = currentUser.name;
  }
}

async function cycleStatus(j){
  if(currentRole !== 'maintenance') return;
  const idx = STATUSES.indexOf(j.status);
  j.status = STATUSES[(idx+1) % STATUSES.length];
  j.dateClosed = (j.status === 'Done') ? new Date().toISOString() : '';
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
  el('f_issue').value = job ? (job.issue||'') : '';
  el('f_status').value = job ? job.status : 'Open';
  el('f_notes').value = job ? (job.notes||'') : '';

  if(job && job.createdByName){
    const createdLine = `Logged by ${job.createdByName} on ${fmtDate(job.dateLogged)}`;
    const updatedLine = (job.updatedByName && job.updatedByName !== job.createdByName)
      ? ` · Last updated by ${job.updatedByName}` : '';
    el('sheetAudit').textContent = createdLine + updatedLine;
  } else {
    el('sheetAudit').textContent = '';
  }

  ['f_room','f_issue','f_status','f_notes'].forEach(id=>{
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
  const status = el('f_status').value;

  const isNew = !editingId;
  let job = editingId ? jobs.find(j=>j.id===editingId) : null;
  if(!job){
    job = { id: uid('j'), dateLogged: new Date().toISOString() };
  }
  job.room = room;
  job.issue = el('f_issue').value.trim();
  job.status = status;
  job.notes = el('f_notes').value.trim();
  job.dateClosed = (status === 'Done') ? (job.dateClosed || new Date().toISOString()) : '';
  stampAudit(job, isNew);

  await DB.putJob(job);
  closeJobSheet();
  toast('Saved');
}

async function handleDeleteJob(){
  if(currentRole !== 'maintenance' || !editingId) return;
  await DB.deleteJob(editingId);
  closeJobSheet();
  toast('Deleted');
}

// ---------------- report sheet (housekeeping: raise a problem) ----------------

function openReportSheet(){
  el('r_room').value = '';
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
    dateLogged: new Date().toISOString(),
    dateClosed: ''
  };
  stampAudit(job, true);
  await DB.putJob(job);
  closeReportSheet();
  toast('Reported — thanks!');
}

// ---------------- settings sheet (maintenance only) ----------------

function openSettings(){
  el('s_siteName').value = config.siteName || '';
  renderAreaTags();
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
  config.siteName = el('s_siteName').value.trim() || 'Room Jobs';
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
el('cancelBtn').addEventListener('click', closeJobSheet);
el('saveBtn').addEventListener('click', handleSaveJob);
el('deleteBtn').addEventListener('click', handleDeleteJob);
el('sheetBackdrop').addEventListener('click', (e)=>{ if(e.target.id==='sheetBackdrop') closeJobSheet(); });

el('reportCancelBtn').addEventListener('click', closeReportSheet);
el('reportSubmitBtn').addEventListener('click', handleSubmitReport);
el('reportBackdrop').addEventListener('click', (e)=>{ if(e.target.id==='reportBackdrop') closeReportSheet(); });

el('searchInput').addEventListener('input', render);
el('showAllBtn').addEventListener('click', ()=>{
  el('searchInput').value = '';
  activeFilter = 'All';
  renderChips();
  render();
  toast('Showing all jobs');
});

el('settingsBtn').addEventListener('click', openSettings);
el('closeSettingsBtn').addEventListener('click', async ()=>{
  await handleSaveSiteName();
  closeSettings();
});
el('settingsBackdrop').addEventListener('click', (e)=>{ if(e.target.id==='settingsBackdrop') closeSettings(); });
el('addAreaBtn').addEventListener('click', handleAddArea);
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

el('versionTagLogin').textContent = `v${APP_VERSION}`;
el('versionTagHeader').textContent = `v${APP_VERSION}`;

checkForUpdate();
setInterval(checkForUpdate, 15 * 60 * 1000); // catch a deploy while the app is left open
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible') checkForUpdate();
});
