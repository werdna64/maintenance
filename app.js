// Bump alongside sw.js's CACHE_NAME and version.json's "version" field
// on every release — this is what the update banner compares against.
// Semantic versioning: 0.1.x = Pre-release (you, solo testing), 0.2.x =
// Beta (others using it), 1.0.0+ = Release. APP_STAGE is the human label
// shown alongside the number — bump it (and version.json's "stage") when
// you actually move to the next phase, not on every release.
const APP_VERSION = '0.1.30';
const APP_STAGE = 'Pre-release';

const STATUSES = ["Open","In Progress","Awaiting Parts","Done"];
const STATUS_ORDER = {"Open":0,"In Progress":1,"Awaiting Parts":1,"Done":2};

let jobs = [];
let rooms = [];      // { id, number, area }
let walks = [];       // completed Fire & Security Walk sessions
let ppmTasks = [];    // planned preventative maintenance schedules
let config = { siteName: "Maintenance Tracker", areas: [], commonIssues: [], departments: [], walkFaults: [] };
let activeFilter = "Active"; // "Active" = everything except Done, the default view
let expandedAreas = new Set(); // area names the user has manually expanded (default: all collapsed)
let viewedJobIds = new Set(); // jobs opened this session — no longer "new" even if within the unseen window
let editingId = null;
let ppmEditingId = null;
let currentRole = null;
let currentUser = null;   // { uid, role, name, department }
let sheetReadOnly = false;
let lastSeenAt = null;

let unsubJobs = null, unsubRooms = null, unsubConfig = null, unsubLastSeen = null, unsubWalks = null, unsubPpmTasks = null;

const el = id => document.getElementById(id);

// Null-safe event wiring: if index.html and app.js ever briefly mismatch
// (a stale cached page paired with a freshly-fetched newer script, or
// simply a typo) this skips the one missing element instead of throwing
// and aborting every wiring call after it in the same script — a single
// missing button shouldn't take the logout button down with it.
function on(id, event, handler){
  const node = el(id);
  if(node) node.addEventListener(event, handler);
  else console.warn(`on(): #${id} not found — skipping "${event}" wiring`);
}

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
  if(unsubPpmTasks) unsubPpmTasks();
  unsubJobs = unsubRooms = unsubConfig = unsubLastSeen = unsubWalks = unsubPpmTasks = null;
  lastSeenAt = null;
  lastAlertedTime = null; // a different person may sign in next on this device
  viewedJobIds = new Set();
  currentView = 'home';
  await DB.signOut();
}

function applyRolePermissions(role){
  const roleLabel = role[0].toUpperCase()+role.slice(1);
  el('roleBadge').textContent = currentUser.name ? `${currentUser.name} · ${roleLabel}` : roleLabel;
  el('settingsBtn').style.display = (role === 'maintenance') ? '' : 'none';
  el('walkBtn').style.display = (role === 'maintenance' || role === 'housekeeping') ? '' : 'none';

  // FAB's onclick is role-based and set once here; whether it's actually
  // visible also depends on which screen is showing — see showView().
  if(role === 'maintenance'){
    el('fabAdd').onclick = ()=>openJobSheet(null);
  } else if(role === 'housekeeping'){
    el('fabAdd').onclick = ()=>openReportSheet();
  }
}

// ---------------- home screen ----------------
// The landing screen after login — tiles into each section, tailored to
// what the signed-in role can actually do. "Job List" is its own screen
// now rather than the default landing; the 🏠 header icon (or tapping
// the header title) gets back here from anywhere.

const HOME_ICONS = {
  newJob: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
  list: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`,
  walk: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><polyline points="9 14 11 16 15 12"></polyline></svg>`,
  history: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 16 14"></polyline></svg>`,
  ppm: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
  settings: `⚙`
};

function homeTilesForRole(role){
  if(role === 'maintenance'){
    return [
      { icon: HOME_ICONS.newJob, label: 'New Job', action: 'newJob' },
      { icon: HOME_ICONS.list, label: 'Job List', action: 'jobs' },
      { icon: HOME_ICONS.walk, label: 'Fire & Security Walk', action: 'walk' },
      { icon: HOME_ICONS.history, label: 'Walk History', action: 'walkHistory' },
      { icon: HOME_ICONS.ppm, label: 'PPM', action: 'ppm' },
      { icon: HOME_ICONS.settings, label: 'Settings', action: 'settings' }
    ];
  }
  if(role === 'housekeeping'){
    return [
      { icon: HOME_ICONS.newJob, label: 'Report a Problem', action: 'report' },
      { icon: HOME_ICONS.list, label: 'Job List', action: 'jobs' },
      { icon: HOME_ICONS.walk, label: 'Fire & Security Walk', action: 'walk' }
    ];
  }
  // management
  return [
    { icon: HOME_ICONS.list, label: 'Job List', action: 'jobs' },
    { icon: HOME_ICONS.history, label: 'Walk History', action: 'walkHistory' }
  ];
}

function handleHomeTile(action){
  if(action === 'newJob'){ showView('jobs'); openJobSheet(null); }
  else if(action === 'report'){ showView('jobs'); openReportSheet(); }
  else if(action === 'jobs'){ showView('jobs'); }
  else if(action === 'walk'){ openWalkWizard(); }
  else if(action === 'walkHistory'){ openWalkHistory(); }
  else if(action === 'ppm'){ openPpmList(); }
  else if(action === 'settings'){ openSettings(); }
}

function renderHome(){
  const wrap = el('homeTiles');
  wrap.innerHTML = '';
  homeTilesForRole(currentRole).forEach(t=>{
    const btn = document.createElement('button');
    btn.className = 'home-tile';
    btn.innerHTML = `<span class="home-tile-icon">${t.icon}</span><span class="home-tile-label">${escapeHtml(t.label)}</span>`;
    btn.addEventListener('click', ()=>handleHomeTile(t.action));
    wrap.appendChild(btn);
  });
}

let currentView = 'home';
function showView(view){
  currentView = view;
  const showJobs = view === 'jobs';
  el('homeScreen').style.display = showJobs ? 'none' : '';
  el('controls').style.display = showJobs ? '' : 'none';
  el('list').style.display = showJobs ? '' : 'none';
  el('fabAdd').style.display = (showJobs && (currentRole === 'maintenance' || currentRole === 'housekeeping')) ? '' : 'none';
  if(!showJobs) renderHome();
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
  unsubPpmTasks = DB.onPpmTasksChange(list => { ppmTasks = list; renderPpmList(); checkPpmDue(); });
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
  const currentReportArea = el('r_area').value;
  const currentPpmArea = el('p_area').value;
  const currentSettingsArea = el('s_newRoomArea').value;
  el('f_area').innerHTML = options;
  el('r_area').innerHTML = options;
  el('p_area').innerHTML = options;
  el('s_newRoomArea').innerHTML = options;
  if((config.areas||[]).includes(currentJobArea)) el('f_area').value = currentJobArea;
  if((config.areas||[]).includes(currentReportArea)) el('r_area').value = currentReportArea;
  if((config.areas||[]).includes(currentPpmArea)) el('p_area').value = currentPpmArea;
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

// The room list is scoped to whichever area is currently picked in that
// sheet — with a couple hundred rooms across a real hotel, one flat
// "every room" dropdown is unusable, so Area is chosen first and Room
// is filtered down to just that area's handful of options.
function populateRoomSelect(selectId, areaId){
  const area = el(areaId).value;
  const filtered = rooms.filter(r => r.area === area)
    .sort((a,b)=> a.number.localeCompare(b.number, undefined, {numeric:true}));
  const current = el(selectId).value;
  el(selectId).innerHTML = area
    ? `<option value="">Select room…</option>` + filtered.map(r=>`<option value="${escapeHtml(r.number)}">${escapeHtml(r.number)}</option>`).join('')
    : `<option value="">Select an area first…</option>`;
  if(filtered.some(r=>r.number === current)) el(selectId).value = current;
}

function renderRoomSelect(){
  populateRoomSelect('r_room', 'r_area');
  populateRoomSelect('f_room', 'f_area');
  populateRoomSelect('p_room', 'p_area');
}

// ---------------- notifications ----------------
// In-app only: derived live from the jobs already synced, compared
// against a per-person "last seen" watermark. Nothing is pushed while
// the app is closed, but nothing is lost either — reopening the app
// recomputes exactly what happened since last time, however long ago.

// A short beep for a genuinely new notification arriving while the app
// is open — a synthesized tone rather than an audio file, so there's
// nothing to fetch or cache. One AudioContext is created lazily and
// reused (browsers require a real user gesture to unlock audio, and by
// the time any notification exists the user has already signed in —
// a tap — so the context created on that first call stays usable for
// the rest of the session). Failing silently (blocked, unsupported) is
// fine — the visual badge is the notification; sound is a bonus.
let notifAudioCtx = null;
function playNotifSound(){
  try{
    if(!notifAudioCtx) notifAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(notifAudioCtx.state === 'suspended') notifAudioCtx.resume().catch(()=>{});
    const osc = notifAudioCtx.createOscillator();
    const gain = notifAudioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    const now = notifAudioCtx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(gain);
    gain.connect(notifAudioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  }catch(e){
    // Audio blocked or unsupported — the visual badge still works.
  }
}

// Highest notification timestamp already alerted on this session — set
// on the very first computation after login without a sound (so
// reopening the app after being away doesn't blast a backlog of beeps
// for everything that happened while it was closed), then only beeps
// for something genuinely newer arriving after that.
let lastAlertedTime = null;

function computeNotifications(){
  if(!currentUser || !lastSeenAt) return [];
  const since = new Date(lastSeenAt).getTime();
  const items = [];

  jobs.forEach(j=>{
    if(viewedJobIds.has(j.id)) return; // already opened it — no longer "new"
    // New job reported by someone else — surfaced to Maintenance.
    if(currentRole === 'maintenance' && j.createdByUid && j.createdByUid !== currentUser.uid){
      const t = new Date(j.dateLogged).getTime();
      if(t > since){
        items.push({
          time: t, tag: 'New',
          title: `${j.room} — ${j.issue || '(no description)'}`,
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
          title: `${j.room} — now ${j.status}`,
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

  if(items.length > 0){
    const newestTime = items[0].time;
    if(lastAlertedTime !== null && newestTime > lastAlertedTime) playNotifSound();
    lastAlertedTime = (lastAlertedTime === null) ? newestTime : Math.max(lastAlertedTime, newestTime);
  }

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

  // Same "unseen since last checked" set the notification bell uses —
  // an area with one of these jobs inside it gets a red count badge,
  // so something new doesn't go unnoticed just because its area starts
  // collapsed. Clears the same way the bell's own badge does: opening
  // and closing the notifications panel marks everything seen.
  const unseenJobIds = new Set(computeNotifications().map(n => n.job.id));

  areaKeys.forEach(area=>{
    const areaJobs = Object.values(byArea[area]).flat();
    const areaJobCount = areaJobs.length;
    const hasUnseen = areaJobs.some(j => unseenJobIds.has(j.id));
    const g = document.createElement('details');
    g.className = 'group';
    if(expandedAreas.has(area)) g.open = true;
    g.addEventListener('toggle', ()=>{
      if(g.open) expandedAreas.add(area); else expandedAreas.delete(area);
    });
    g.innerHTML = `<summary class="group-label"><span class="area-label">${escapeHtml(area)}</span><span class="group-count${hasUnseen ? ' has-new' : ''}">${areaJobCount}</span><div class="rule"></div></summary>`;

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
  if(job && !viewedJobIds.has(job.id)){
    // Opening a job acknowledges just that one — its "new" badge (area
    // group, notification bell) clears without needing to mark every
    // other unrelated notification seen too.
    viewedJobIds.add(job.id);
    render();
    renderNotifications();
  }
  el('sheetTitle').textContent = job ? `${canEdit ? 'Edit' : 'View'} — ${job.room}` : 'New job';
  el('f_area').value = job ? roomArea(job.room) : '';
  populateRoomSelect('f_room', 'f_area');
  if(job) el('f_room').value = job.room;
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

  ['f_area','f_room','f_source','f_issuePreset','f_issue','f_status'].forEach(id=>{
    el(id).disabled = sheetReadOnly;
  });
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
  const previousStatus = job ? job.status : null;
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

  // Completing a PPM-generated job is what advances its schedule — the
  // task doc is only touched on the Open→Done transition, never on
  // every save, so re-saving an already-Done job doesn't push the date
  // out again.
  if(job.ppmTaskId && status === 'Done' && previousStatus !== 'Done'){
    const task = ppmTasks.find(t=>t.id === job.ppmTaskId);
    if(task){
      const basis = task.recurrenceType === 'fixed' ? task.nextDueAt : new Date().toISOString();
      task.nextDueAt = advanceDueDate(basis, task);
      task.lastCompletedAt = new Date().toISOString();
      task.lastCompletedJobId = job.id;
      task.activeJobId = null;
      await DB.putPpmTask(task);
    }
  }

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
  el('deleteConfirmSummary').textContent = `${job.room} — ${job.issue || '(no description)'}`;
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
  el('r_area').value = '';
  populateRoomSelect('r_room', 'r_area');
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

// ---------------- PPM: planned preventative maintenance (maintenance only) ----------------
// Recurring/compliance schedules (fire alarm tests, servicing, statutory
// checks) rather than reactive faults. A task's own doc just holds the
// schedule; when it falls due, checkPpmDue() creates an ordinary job for
// it (source: 'PPM', linked via ppmTaskId) — completing that job through
// the normal Done flow is what advances the schedule. See checkPpmDue()
// and the PPM hook in handleSaveJob() below.

function fmtRecurrence(task){
  const unit = task.intervalValue === 1 ? task.intervalUnit.replace(/s$/,'') : task.intervalUnit;
  const freq = `Every ${task.intervalValue} ${unit}`;
  return task.recurrenceType === 'fixed' ? `${freq} (fixed)` : `${freq} (rolling)`;
}

function ppmDueStatus(task){
  const daysUntil = (new Date(task.nextDueAt).getTime() - Date.now()) / 86400000;
  if(daysUntil < 0) return 'overdue';
  if(daysUntil <= 7) return 'soon';
  return 'ok';
}

// Fixed: next due is always computed from the previous *scheduled* date,
// so a late completion doesn't shift the whole future schedule. Rolling:
// next due is computed from whenever the task actually gets completed.
function advanceDueDate(fromIso, task){
  const d = new Date(fromIso);
  const n = task.intervalValue;
  switch(task.intervalUnit){
    case 'days': d.setDate(d.getDate() + n); break;
    case 'weeks': d.setDate(d.getDate() + n*7); break;
    case 'months': d.setMonth(d.getMonth() + n); break;
    case 'years': d.setFullYear(d.getFullYear() + n); break;
  }
  return d.toISOString();
}

// There's no server/cron in this architecture, so a PPM task only comes
// due when someone with the app open triggers this check (on data load
// and every 15 minutes thereafter, same cadence as checkForUpdate()) —
// if nobody opens the app on the day something falls due, it won't
// appear as a job until someone next does. Each due task becomes one
// ordinary job (source: 'PPM', linked via ppmTaskId); activeJobId stops
// the same task spawning a second job while the first is still open.
async function checkPpmDue(){
  if(currentRole !== 'maintenance' || !currentUser) return;
  const now = Date.now();
  for(const task of ppmTasks){
    if(task.activeJobId) continue;
    if(new Date(task.nextDueAt).getTime() > now) continue;
    const job = {
      id: uid('j'),
      room: task.room,
      issue: task.name,
      status: 'Open',
      source: 'PPM',
      ppmTaskId: task.id,
      dateLogged: new Date().toISOString(),
      dateClosed: ''
    };
    stampAudit(job, true);
    await DB.putJob(job);
    task.activeJobId = job.id;
    await DB.putPpmTask(task);
  }
}

function openPpmList(){
  renderPpmList();
  el('ppmBackdrop').classList.add('open');
}

function closePpmList(){
  el('ppmBackdrop').classList.remove('open');
}

function renderPpmList(){
  const wrap = el('ppmList');
  if(!wrap) return; // called from subscribeData() before the DOM exists on very first paint is not possible, but stay defensive
  if(ppmTasks.length === 0){
    wrap.innerHTML = `<div class="notif-empty">No PPM tasks yet — tap Add task to create one</div>`;
    return;
  }
  const sorted = [...ppmTasks].sort((a,b)=> new Date(a.nextDueAt) - new Date(b.nextDueAt));
  const statusLabel = { overdue: 'Overdue', soon: 'Due soon', ok: 'Upcoming' };
  wrap.innerHTML = sorted.map(t=>{
    const status = ppmDueStatus(t);
    const metaParts = [fmtRecurrence(t)];
    if(t.room) metaParts.unshift(t.room);
    if(t.contractor) metaParts.push(t.contractor);
    return `
      <div class="ppm-item" data-id="${t.id}">
        <div class="ppm-item-top">
          <div class="ppm-item-name">${escapeHtml(t.name)}</div>
          <span class="ppm-status ppm-status-${status}">${statusLabel[status]}</span>
        </div>
        <div class="ppm-item-meta">${escapeHtml(metaParts.join(' · '))}</div>
        <div class="ppm-item-due">Due ${fmtDate(t.nextDueAt)}</div>
      </div>
    `;
  }).join('');
  wrap.querySelectorAll('.ppm-item').forEach(node=>{
    node.addEventListener('click', ()=>{
      const task = ppmTasks.find(t=>t.id === node.dataset.id);
      if(task) openPpmTaskSheet(task);
    });
  });
}

function openPpmTaskSheet(task){
  if(currentRole !== 'maintenance') return;
  ppmEditingId = task ? task.id : null;
  el('ppmTaskSheetTitle').textContent = task ? 'Edit PPM Task' : 'New PPM Task';
  el('p_name').value = task ? task.name : '';
  el('p_area').value = (task && task.room) ? roomArea(task.room) : '';
  populateRoomSelect('p_room', 'p_area');
  if(task && task.room) el('p_room').value = task.room;
  el('p_recurrenceType').value = task ? task.recurrenceType : 'fixed';
  el('p_intervalValue').value = task ? task.intervalValue : 1;
  el('p_intervalUnit').value = task ? task.intervalUnit : 'weeks';
  el('p_nextDueAt').value = task ? task.nextDueAt.slice(0,10) : new Date().toISOString().slice(0,10);
  el('p_contractor').value = task ? (task.contractor || '') : '';
  el('ppmTaskDeleteBtn').style.display = task ? 'block' : 'none';
  if(task){
    const parts = [];
    if(task.lastCompletedAt) parts.push(`Last done ${fmtDateTime(task.lastCompletedAt)}`);
    if(task.createdByName) parts.push(`Added by ${task.createdByName}`);
    el('ppmTaskAudit').textContent = parts.join(' · ');
  } else {
    el('ppmTaskAudit').textContent = '';
  }
  el('ppmTaskBackdrop').classList.add('open');
}

function closePpmTaskSheet(){
  el('ppmTaskBackdrop').classList.remove('open');
  ppmEditingId = null;
}

async function handleSavePpmTask(){
  if(currentRole !== 'maintenance') return;
  const name = el('p_name').value.trim();
  if(!name){ toast('Task name is required'); return; }
  const room = el('p_room').value.trim();
  if(!room){ toast('Room is required'); return; }
  const nextDueRaw = el('p_nextDueAt').value;
  if(!nextDueRaw){ toast('Next due date is required'); return; }
  const intervalValue = parseInt(el('p_intervalValue').value, 10);
  if(!intervalValue || intervalValue < 1){ toast('Enter a valid interval'); return; }

  const isNew = !ppmEditingId;
  let task = ppmEditingId ? ppmTasks.find(t=>t.id===ppmEditingId) : null;
  if(!task) task = { id: uid('p') };

  task.name = name;
  task.room = room;
  task.recurrenceType = el('p_recurrenceType').value;
  task.intervalValue = intervalValue;
  task.intervalUnit = el('p_intervalUnit').value;
  task.nextDueAt = new Date(nextDueRaw + 'T00:00:00').toISOString();
  task.contractor = el('p_contractor').value.trim();
  task.updatedByUid = currentUser.uid;
  task.updatedByName = currentUser.name;
  task.updatedAt = new Date().toISOString();
  if(isNew){
    task.createdByUid = currentUser.uid;
    task.createdByName = currentUser.name;
    task.createdAt = task.updatedAt;
    task.lastCompletedAt = null;
    task.lastCompletedJobId = null;
    task.activeJobId = null;
  }

  await DB.putPpmTask(task);
  closePpmTaskSheet();
  toast('Saved');
}

async function handleDeletePpmTask(){
  if(currentRole !== 'maintenance' || !ppmEditingId) return;
  await DB.deletePpmTask(ppmEditingId);
  closePpmTaskSheet();
  toast('Deleted');
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

// Bulk room entry: one "Number, Area" pair per line. Reuses
// ensureRoomExists() line by line — a room number already on file gets
// its area updated rather than duplicated, and anything not mentioned
// in the paste is left untouched, so this is safe to re-run.
async function handleBulkImportRooms(){
  const raw = el('s_bulkRooms').value;
  const lines = raw.split('\n').map(l=>l.trim()).filter(l=>l);
  if(lines.length === 0){ toast('Paste some rooms first'); return; }

  const btn = el('bulkImportRoomsBtn');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  let added = 0, skipped = 0;
  for(const line of lines){
    const commaIdx = line.indexOf(',');
    if(commaIdx === -1){ skipped++; continue; }
    const num = line.slice(0, commaIdx).trim();
    const area = line.slice(commaIdx + 1).trim();
    if(!num || !area){ skipped++; continue; }
    await ensureRoomExists(num, area);
    added++;
  }

  renderRoomList();
  el('s_bulkRooms').value = '';
  btn.disabled = false;
  btn.textContent = 'Import rooms';
  toast(skipped > 0 ? `Imported ${added}, skipped ${skipped} (need "Number, Area")` : `Imported ${added} rooms`);
}

async function handleSaveSiteName(){
  config.siteName = el('s_siteName').value.trim() || 'Maintenance Tracker';
  await DB.setConfig(config);
}

// ---------------- wiring ----------------

on('pinSubmitBtn', 'click', handleLogin);
on('usernameInput', 'keydown', (e)=>{ if(e.key==='Enter') el('pinInput').focus(); });
on('pinInput', 'keydown', (e)=>{ if(e.key==='Enter') handleLogin(); });
on('logoutBtn', 'click', handleLogout);
on('siteTitle', 'click', ()=> showView('home'));
on('homeBtn', 'click', ()=> showView('home'));

on('f_area', 'change', ()=>{ populateRoomSelect('f_room', 'f_area'); });
on('f_issuePreset', 'change', ()=>{
  if(el('f_issuePreset').value) el('f_issue').value = el('f_issuePreset').value;
});
on('cancelBtn', 'click', closeJobSheet);
on('saveBtn', 'click', handleSaveJob);
on('addNoteBtn', 'click', handleAddNote);
on('f_newNote', 'keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); handleAddNote(); } });
on('deleteBtn', 'click', openDeleteConfirm);
on('deleteConfirmCancelBtn', 'click', closeDeleteConfirm);
on('deleteConfirmBtn', 'click', handleConfirmDelete);
on('deleteConfirmBackdrop', 'click', (e)=>{ if(e.target.id==='deleteConfirmBackdrop') closeDeleteConfirm(); });
on('sheetBackdrop', 'click', (e)=>{ if(e.target.id==='sheetBackdrop') closeJobSheet(); });

on('r_area', 'change', ()=>{ populateRoomSelect('r_room', 'r_area'); });
on('r_issuePreset', 'change', ()=>{
  if(el('r_issuePreset').value) el('r_issue').value = el('r_issuePreset').value;
});
on('reportCancelBtn', 'click', closeReportSheet);
on('reportSubmitBtn', 'click', handleSubmitReport);
on('reportBackdrop', 'click', (e)=>{ if(e.target.id==='reportBackdrop') closeReportSheet(); });

on('walkBtn', 'click', openWalkWizard);
on('walkCancelBtn', 'click', closeWalkWizard);
on('walkBackBtn', 'click', walkGoBack);
on('walkNextBtn', 'click', walkGoNext);
on('walkBackdrop', 'click', (e)=>{ if(e.target.id==='walkBackdrop') closeWalkWizard(); });

on('walkHistoryBtn', 'click', openWalkHistory);
on('walkHistoryCloseBtn', 'click', closeWalkHistory);
on('walkHistoryBackdrop', 'click', (e)=>{ if(e.target.id==='walkHistoryBackdrop') closeWalkHistory(); });

on('guideBtn', 'click', openGuide);
on('loginGuideBtn', 'click', openGuide);
on('guideCloseBtn', 'click', closeGuide);
on('guideBackdrop', 'click', (e)=>{ if(e.target.id==='guideBackdrop') closeGuide(); });

on('ppmCloseBtn', 'click', closePpmList);
on('ppmAddBtn', 'click', ()=>openPpmTaskSheet(null));
on('ppmBackdrop', 'click', (e)=>{ if(e.target.id==='ppmBackdrop') closePpmList(); });
on('p_area', 'change', ()=>{ populateRoomSelect('p_room', 'p_area'); });
on('ppmTaskCancelBtn', 'click', closePpmTaskSheet);
on('ppmTaskSaveBtn', 'click', handleSavePpmTask);
on('ppmTaskDeleteBtn', 'click', handleDeletePpmTask);
on('ppmTaskBackdrop', 'click', (e)=>{ if(e.target.id==='ppmTaskBackdrop') closePpmTaskSheet(); });

on('searchInput', 'input', render);
on('showAllBtn', 'click', ()=>{
  el('searchInput').value = '';
  activeFilter = 'All';
  renderChips();
  render();
  toast('Showing all jobs');
});

on('notifBtn', 'click', openNotifPanel);
on('notifCloseBtn', 'click', closeNotifPanel);
on('notifBackdrop', 'click', (e)=>{ if(e.target.id==='notifBackdrop') closeNotifPanel(); });

on('settingsBtn', 'click', openSettings);
on('closeSettingsBtn', 'click', async ()=>{
  await handleSaveSiteName();
  closeSettings();
});
on('settingsBackdrop', 'click', (e)=>{ if(e.target.id==='settingsBackdrop') closeSettings(); });
on('addAreaBtn', 'click', handleAddArea);
on('addCommonIssueBtn', 'click', handleAddCommonIssue);
on('addDepartmentBtn', 'click', handleAddDepartment);
on('addWalkFaultBtn', 'click', handleAddWalkFault);
on('addRoomBtn', 'click', handleAddRoom);
on('bulkImportRoomsBtn', 'click', handleBulkImportRooms);
on('s_siteName', 'blur', handleSaveSiteName);

// ---------------- init ----------------

renderChips();

DB.onAuthChange((user)=>{
  if(user){
    currentUser = user;
    currentRole = user.role;
    el('loginScreen').style.display = 'none';
    el('appRoot').style.display = '';
    applyRolePermissions(currentRole);
    showView('home');
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

on('updateReloadBtn', 'click', reloadForUpdate);

el('versionTagLogin').textContent = `v${APP_VERSION} · ${APP_STAGE}`;

checkForUpdate();
setInterval(checkForUpdate, 15 * 60 * 1000); // catch a deploy while the app is left open
setInterval(checkPpmDue, 15 * 60 * 1000); // catch a PPM task falling due while the app is left open
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible'){
    checkForUpdate();
    checkPpmDue();
  }
});
