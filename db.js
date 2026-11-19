/* db.js — Firebase-backed auth + data layer.

   Auth: every person gets their own account — a username and a personal
   PIN. "Username" maps to a Firebase email identifier
   (username@EMAIL_DOMAIN below) that never needs to receive real mail;
   under the hood this is a real Firebase email+password sign-in, so
   Firebase's own throttling/hashing applies — this file never sees or
   stores a PIN itself. Each account's role (maintenance / housekeeping /
   management) and display name live in /users/{uid} in Firestore — see
   README.md for how to create a new person's account.

   Data: jobs / rooms / config live in Firestore and sync in realtime to
   every signed-in device. Firestore's own offline cache (enabled below)
   keeps the app usable with no signal, exactly like the old IndexedDB
   version did — writes made offline queue and flush when back online.

   Access control is NOT enforced here — it's enforced server-side by
   firestore.rules, keyed on the role recorded in /users/{uid}. Treat any
   UI-level restriction in app.js as a convenience, not the security
   boundary. */

(function(){

const EMAIL_DOMAIN = 'site.local';

function usernameToEmail(username) {
  return username.trim().toLowerCase().replace(/\s+/g, '.') + '@' + EMAIL_DOMAIN;
}

firebase.initializeApp(window.FIREBASE_CONFIG);
const auth = firebase.auth();
const firestore = firebase.firestore();

// Dev/testing only — never true for the real deployed app, which is
// never served from localhost. Point at a local `firebase emulators:start`
// instead of the real project; no quota, no risk to real data. See
// README's "Local emulator (dev/testing only)" section for setup.
if(location.hostname === 'localhost' || location.hostname === '127.0.0.1'){
  auth.useEmulator('http://localhost:9099', { disableWarnings: true });
  firestore.useEmulator('localhost', 8080);
  console.warn('Using local Firebase emulators, not the real project.');
} else{
  const devState = connectToDevBackendIfRequested();
  if(devState === 'on') console.warn('Using the shared dev backend, not the real project.');
  else if(devState === 'unconfigured') console.warn('Dev backend requested but DEV_BACKEND has no hostnames — staying on the real project (LIVE).');
}

// Lets a tester point the real, production-served app at the shared dev
// emulator (see README's "Shared dev backend" section) instead of live
// Firebase — for testing against real-looking data without touching
// production or its quota. Deliberately NOT a free-form host: only ever
// connects to the fixed DEV_BACKEND hostnames below, never to whatever a
// URL happens to contain, since this file also handles real sign-in.
// `?devBackend=1` turns it on and remembers the choice; `?devBackend=0`
// turns it back off.
//
// Three states, not two (mirrors the model's src/viewer.html — see
// 3D_MODEL_CONTEXT.md, "Three states, not two"), because the dangerous
// failure is a silent one: asking for the dev backend and not getting it
// used to look identical to never asking — add ?devBackend=1, see no bar,
// assume it's working, and go on writing real jobs to live. 'unconfigured'
// exists so that can never happen quietly, including for a browser that
// still has the flag stored in localStorage from when DEV_BACKEND *was*
// filled in — reverting the hostnames here must still warn on every load
// after that, not fall back to live with nothing said. This matters more
// here than in the model: the model only reads, db.js writes jobs.
function connectToDevBackendIfRequested(){
  const DEV_BACKEND = {
    // Filled in once the Cloudflare Tunnel hostnames exist (see README).
    // Left null, the whole feature is inert even if someone adds
    // ?devBackend=1 to the URL — they just get the 'unconfigured' warning.
    firestoreHost: null, // e.g. 'maintdb-dev-db.example.com'
    authUrl: null,        // e.g. 'https://maintdb-dev-auth.example.com'
  };
  const STORAGE_KEY = 'maintdb_devBackend';
  const requested = new URLSearchParams(location.search).get('devBackend');
  if(requested === '0'){
    try{ localStorage.removeItem(STORAGE_KEY); }catch(e){}
    return 'off';
  }
  const wantsIt = requested === '1' || (() => {
    try{ return localStorage.getItem(STORAGE_KEY) === '1'; }catch(e){ return false; }
  })();
  if(!wantsIt) return 'off';
  if(!DEV_BACKEND.firestoreHost || !DEV_BACKEND.authUrl){
    // Never written to localStorage here — a request that can't be
    // honoured is never remembered, so fixing DEV_BACKEND later or just
    // reloading without the param both recover cleanly. A flag already
    // sitting in localStorage from an earlier working config is left
    // alone rather than cleared, so the warning keeps firing on every
    // load until it's actually resolved one way or the other.
    showDevBackendBanner('unconfigured');
    return 'unconfigured';
  }
  auth.useEmulator(DEV_BACKEND.authUrl, { disableWarnings: true });
  firestore.useEmulator(DEV_BACKEND.firestoreHost, 443);
  try{ localStorage.setItem(STORAGE_KEY, '1'); }catch(e){}
  showDevBackendBanner('on');
  return 'on';
}

function showDevBackendBanner(state){
  const banner = document.createElement('div');
  if(state === 'unconfigured'){
    banner.textContent = 'DEV BACKEND REQUESTED BUT NOT CONFIGURED — this is LIVE data';
    banner.style.background = '#b91c1c';
  } else {
    banner.textContent = 'DEV BACKEND — test data, not the live hotel system';
    banner.style.background = '#b45309';
  }
  banner.style.cssText += 'position:fixed;top:0;left:0;right:0;z-index:99999;'
    + 'color:#fff;font:600 12px system-ui,sans-serif;text-align:center;padding:4px 8px;';
  document.addEventListener('DOMContentLoaded', () => document.body.prepend(banner));
}

firestore.enablePersistence({ synchronizeTabs: true }).catch(() => {
  // Multiple tabs without synchronizeTabs support, or a browser that
  // doesn't support persistence (e.g. private browsing) — the app still
  // works, just without the offline cache.
});

let currentUser = null; // { uid, role, name, department }

// Shared by claimJobNumber() and claimPpmTaskAndCreateJob() below — a
// single incrementing counter doc (config/main stays separate; this is
// its own doc so a hot counter never contends with site-config writes).
// Zero-padded to 6 digits (SHF-000001); past 999999 it just gets wider,
// nothing breaks.
async function claimNumberInTx(tx, siteCode) {
  const counterRef = firestore.collection('counters').doc('jobs');
  const snap = await tx.get(counterRef);
  const next = (snap.exists ? snap.data().next : 0) + 1;
  tx.set(counterRef, { next });
  return `${siteCode}-${String(next).padStart(6, '0')}`;
}

const DB = {
  // ---- auth ----
  async signIn(username, pin) {
    await auth.signInWithEmailAndPassword(usernameToEmail(username), pin);
  },

  async signOut() {
    currentUser = null;
    await auth.signOut();
  },

  getCurrentUser() {
    return currentUser;
  },

  // Fires once at startup and again on every sign-in/sign-out.
  // callback({ uid, role, name } | null)
  onAuthChange(callback) {
    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        currentUser = null;
        callback(null);
        return;
      }
      let profile = null;
      try {
        const doc = await firestore.collection('users').doc(user.uid).get();
        profile = doc.exists ? doc.data() : null;
      } catch (e) {
        profile = null;
      }
      if (!profile || !profile.role) {
        // Signed in with Firebase but no profile/role set up yet (e.g.
        // account created but the /users doc wasn't added) — treat as
        // logged out rather than letting them in with no permissions.
        await auth.signOut();
        callback(null);
        return;
      }
      currentUser = { uid: user.uid, role: profile.role, name: profile.name || '', department: profile.department || '' };
      callback(currentUser);
    });
  },

  // ---- jobs (realtime) ----
  onJobsChange(callback) {
    return firestore.collection('jobs').onSnapshot((snap) => {
      callback(snap.docs.map(d => d.data()));
    });
  },
  async putJob(job) {
    await firestore.collection('jobs').doc(job.id).set(job);
  },
  async deleteJob(id) {
    await firestore.collection('jobs').doc(id).delete();
  },

  // Write-only audit trail for deletions — a permanent record of why a
  // job was removed and what it looked like, since the job document
  // itself won't exist to ask afterwards. No realtime listener; nothing
  // in the app currently reads this back.
  async putDeletedJobRecord(record) {
    await firestore.collection('deletedJobs').doc(record.id).set(record);
  },

  // ---- rooms (realtime) ----
  onRoomsChange(callback) {
    return firestore.collection('rooms').onSnapshot((snap) => {
      callback(snap.docs.map(d => d.data()));
    });
  },
  async putRoom(room) {
    await firestore.collection('rooms').doc(room.id).set(room);
  },
  async deleteRoom(id) {
    await firestore.collection('rooms').doc(id).delete();
  },

  // ---- assets (on-demand, not a live listener) ----
  // Physical items below room level (a bedside lamp, a distribution
  // board...), keyed by a stable assetKey shared with the 3D hotel
  // model — see README's "3D model integration" section. Populated by
  // the scripts/sync-assets.js script, not edited from inside the app.
  // Deliberately fetched on demand rather than subscribed to as a
  // whole collection: this collection runs into the tens of thousands
  // of documents for a full hotel, and a blanket onSnapshot() re-reads
  // all of them on every client reconnect — see git history for the
  // quota outage that caused.
  async getAssetByKey(assetKey) {
    const doc = await firestore.collection('assets').doc(assetKey).get();
    return doc.exists ? doc.data() : null;
  },
  async getAssetsForRoom(room) {
    // A single equality filter needs no composite index; filtering out
    // inactive ones is cheap client-side since one room is at most a
    // few dozen documents, never worth a second index for.
    const snap = await firestore.collection('assets').where('room', '==', room).get();
    return snap.docs.map(d => d.data()).filter(a => a.active !== false);
  },

  // ---- walk history (realtime) ----
  onWalksChange(callback) {
    return firestore.collection('walks').onSnapshot((snap) => {
      callback(snap.docs.map(d => d.data()));
    });
  },
  async putWalk(walk) {
    await firestore.collection('walks').doc(walk.id).set(walk);
  },

  // ---- PPM (planned preventative maintenance) tasks (realtime) ----
  onPpmTasksChange(callback) {
    return firestore.collection('ppmTasks').onSnapshot((snap) => {
      callback(snap.docs.map(d => d.data()));
    });
  },
  async putPpmTask(task) {
    await firestore.collection('ppmTasks').doc(task.id).set(task);
  },
  async deletePpmTask(id) {
    await firestore.collection('ppmTasks').doc(id).delete();
  },

  // Atomically claims a due PPM task and creates its linked job in one
  // transaction, so two overlapping checks — the same device's own
  // write re-triggering its realtime listener mid-check, or two staff
  // signed in at once — can't both win the "is this task still
  // unclaimed?" read and each create a duplicate job. Returns true if
  // this call created the job, false if the task turned out to already
  // be claimed (or no longer due) by the time the transaction ran.
  async claimPpmTaskAndCreateJob(taskId, job, siteCode) {
    return await firestore.runTransaction(async (tx) => {
      const taskRef = firestore.collection('ppmTasks').doc(taskId);
      const taskSnap = await tx.get(taskRef);
      if (!taskSnap.exists) return false;
      const task = taskSnap.data();
      if (task.activeJobId) return false;
      if (new Date(task.nextDueAt).getTime() > Date.now()) return false;
      // Reads (task, counter) before writes (counter, job, task) —
      // Firestore transactions require every read to happen before any
      // write, so the job number is claimed here rather than before
      // the transaction starts.
      job.jobNumber = await claimNumberInTx(tx, siteCode);
      tx.set(firestore.collection('jobs').doc(job.id), job);
      tx.update(taskRef, { activeJobId: job.id });
      return true;
    });
  },

  // A short, human-friendly reference for a job (e.g. "SHF-000123"),
  // assigned atomically from a shared counter doc so two people saving
  // a new job at the same moment can never collide. Call it once, right
  // before the job's own doc is written — a job number is never reused,
  // but a gap is possible if the job write itself then fails (e.g. the
  // device goes offline mid-save), which is an acceptable trade-off for
  // not needing a combined transaction at every job-creation call site.
  async claimJobNumber(siteCode) {
    return await firestore.runTransaction(async (tx) => {
      return await claimNumberInTx(tx, siteCode);
    });
  },

  // ---- config (realtime) ----
  onConfigChange(callback) {
    return firestore.collection('config').doc('main').onSnapshot((doc) => {
      callback(doc.exists ? doc.data() : null);
    });
  },
  async setConfig(value) {
    await firestore.collection('config').doc('main').set(value);
  },

  // ---- notifications: per-person "last seen" marker (realtime) ----
  onLastSeenChange(callback) {
    return firestore.collection('notificationState').doc(currentUser.uid).onSnapshot((doc) => {
      callback(doc.exists ? doc.data().lastSeenAt : null);
    });
  },
  async markNotificationsSeen() {
    await firestore.collection('notificationState').doc(currentUser.uid)
      .set({ lastSeenAt: new Date().toISOString() });
  }
};

window.DB = DB;

})();
