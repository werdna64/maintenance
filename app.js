const STATUSES = ["Open","In Progress","Awaiting Parts","Done"];
const STATUS_ORDER = {"Open":0,"In Progress":1,"Awaiting Parts":1,"Done":2};

let jobs = [];
let rooms = [];      // { id, number, area }
let config = { siteName: "Room Jobs", areas: [] };
let activeFilter = "All";
let editingId = null;

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

// ---------------- load / persist ----------------

async function loadAll(){
  jobs = await DB.getAllJobs();
  rooms = await DB.getAllRooms();
  const cfg = await DB.getConfig();
  if(cfg) config = cfg;
}

async function seedIfEmpty(){
  if(!config.siteName){
    config = { siteName: "Room Jobs", areas: [] };
    await DB.setConfig(config);
  }
  // No hotel-specific data is seeded here on purpose — this file is
  // committed to a public repo. Set the site name, areas, rooms, and
  // jobs from the ⚙ Settings screen after install; that data stays in
  // the phone's local IndexedDB only and is never part of the source.
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

// ---------------- rendering: job list ----------------

function render(){
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
        card.innerHTML = `
          <div class="plaque">${escapeHtml(j.room)}</div>
          <div class="card-body">
            <div class="issue">${escapeHtml(j.issue || '(no description)')}</div>
            <div class="meta">
              <span>${fmtDate(j.dateLogged)}</span>
              ${j.loggedBy ? `<span>${escapeHtml(j.loggedBy)}</span>` : ''}
              ${j.status==='Done' && j.dateClosed ? `<span>Closed ${fmtDate(j.dateClosed)}</span>` : ''}
            </div>
            ${j.notes ? `<div class="notes">${escapeHtml(j.notes)}</div>` : ''}
            <button class="status-btn ${statusClass}" data-id="${j.id}">${j.status}</button>
          </div>
        `;
        card.querySelector('.card-body').addEventListener('click', (e)=>{
          if(e.target.classList.contains('status-btn')) return;
          openJobSheet(j);
        });
        card.querySelector('.status-btn').addEventListener('click', (e)=>{
          e.stopPropagation();
          cycleStatus(j);
        });
        g.appendChild(card);
      });
    });
    list.appendChild(g);
  });
}

async function cycleStatus(j){
  const idx = STATUSES.indexOf(j.status);
  j.status = STATUSES[(idx+1) % STATUSES.length];
  j.dateClosed = (j.status === 'Done') ? new Date().toISOString() : '';
  await DB.putJob(j);
  render();
  toast(`${j.room} → ${j.status}`);
}

// ---------------- job sheet ----------------

function openJobSheet(job){
  editingId = job ? job.id : null;
  el('sheetTitle').textContent = job ? `Edit — Room ${job.room}` : 'New job';
  el('f_room').value = job ? job.room : '';
  el('f_area').value = job ? roomArea(job.room) : '';
  el('f_issue').value = job ? (job.issue||'') : '';
  el('f_status').value = job ? job.status : 'Open';
  el('f_loggedBy').value = job ? (job.loggedBy||'') : '';
  el('f_notes').value = job ? (job.notes||'') : '';
  el('deleteBtn').style.display = job ? 'block' : 'none';
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
    rooms.push(r);
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
  const room = el('f_room').value.trim();
  if(!room){ toast('Room is required'); return; }
  const area = el('f_area').value.trim();
  const status = el('f_status').value;

  await ensureRoomExists(room, area);

  let job;
  if(editingId){
    job = jobs.find(j=>j.id===editingId);
  } else {
    job = { id: uid('j'), dateLogged: new Date().toISOString() };
    jobs.push(job);
  }
  job.room = room;
  job.issue = el('f_issue').value.trim();
  job.status = status;
  job.loggedBy = el('f_loggedBy').value.trim();
  job.notes = el('f_notes').value.trim();
  job.dateClosed = (status === 'Done') ? (job.dateClosed || new Date().toISOString()) : '';

  await DB.putJob(job);
  closeJobSheet();
  renderAreaSelects();
  render();
  toast('Saved');
}

async function handleDeleteJob(){
  if(!editingId) return;
  jobs = jobs.filter(j=>j.id!==editingId);
  await DB.deleteJob(editingId);
  closeJobSheet();
  render();
  toast('Deleted');
}

// ---------------- settings sheet ----------------

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
      renderAreaTags();
      renderAreaSelects();
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
      rooms = rooms.filter(x=>x.id!==r.id);
      await DB.deleteRoom(r.id);
      renderRoomList();
      renderAreaSelects();
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
    renderAreaTags();
    renderAreaSelects();
  }
  el('s_newArea').value = '';
}

async function handleAddRoom(){
  const num = el('s_newRoomNum').value.trim();
  const area = el('s_newRoomArea').value.trim();
  if(!num){ toast('Room number required'); return; }
  await ensureRoomExists(num, area);
  renderRoomList();
  renderAreaTags();
  renderAreaSelects();
  el('s_newRoomNum').value = '';
  el('s_newRoomArea').value = '';
  toast('Room added');
}

async function handleSaveSiteName(){
  config.siteName = el('s_siteName').value.trim() || 'Room Jobs';
  await DB.setConfig(config);
  renderHeader();
}

// ---------------- wiring ----------------

el('fabAdd').addEventListener('click', ()=>openJobSheet(null));
el('cancelBtn').addEventListener('click', closeJobSheet);
el('saveBtn').addEventListener('click', handleSaveJob);
el('deleteBtn').addEventListener('click', handleDeleteJob);
el('sheetBackdrop').addEventListener('click', (e)=>{ if(e.target.id==='sheetBackdrop') closeJobSheet(); });
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
  render();
});
el('settingsBackdrop').addEventListener('click', (e)=>{ if(e.target.id==='settingsBackdrop') closeSettings(); });
el('addAreaBtn').addEventListener('click', handleAddArea);
el('addRoomBtn').addEventListener('click', handleAddRoom);
el('s_siteName').addEventListener('blur', handleSaveSiteName);

// ---------------- init ----------------

(async function init(){
  await loadAll();
  await seedIfEmpty();
  renderHeader();
  renderChips();
  renderAreaSelects();
  render();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
})();
