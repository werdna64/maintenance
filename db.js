/* db.js — Firebase-backed auth + data layer.

   Auth: there are three fixed accounts (maintenance / housekeeping /
   management), one per role — see firebase-config.js (ROLE_ACCOUNTS) and
   README.md. "Logging in" from the app's point of view is picking a role
   and typing that role's PIN; under the hood this is a real Firebase
   email+password sign-in, so Firebase's own throttling/hashing applies —
   this file never sees or stores a password itself.

   Data: jobs / rooms / config live in Firestore and sync in realtime to
   every signed-in device. Firestore's own offline cache (enabled below)
   keeps the app usable with no signal, exactly like the old IndexedDB
   version did — writes made offline queue and flush when back online.

   Access control is NOT enforced here — it's enforced server-side by
   firestore.rules, keyed on the role recorded in /roles/{uid}. Treat any
   UI-level restriction in app.js as a convenience, not the security
   boundary. */

firebase.initializeApp(window.FIREBASE_CONFIG);
const auth = firebase.auth();
const firestore = firebase.firestore();

firestore.enablePersistence({ synchronizeTabs: true }).catch(() => {
  // Multiple tabs without synchronizeTabs support, or a browser that
  // doesn't support persistence (e.g. private browsing) — the app still
  // works, just without the offline cache.
});

let currentRole = null;

const DB = {
  // ---- auth ----
  async signIn(role, pin) {
    const email = (window.ROLE_ACCOUNTS || {})[role];
    if (!email) throw new Error('Unknown role: ' + role);
    await auth.signInWithEmailAndPassword(email, pin);
  },

  async signOut() {
    currentRole = null;
    await auth.signOut();
  },

  getRole() {
    return currentRole;
  },

  // Fires once at startup and again on every sign-in/sign-out.
  // callback(role|null, user|null)
  onAuthChange(callback) {
    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        currentRole = null;
        callback(null, null);
        return;
      }
      try {
        const doc = await firestore.collection('roles').doc(user.uid).get();
        currentRole = doc.exists ? doc.data().role : null;
      } catch (e) {
        currentRole = null;
      }
      if (!currentRole) {
        // Signed in with Firebase but no role assigned (e.g. account set
        // up but the /roles doc wasn't created yet) — treat as logged out.
        await auth.signOut();
        callback(null, null);
        return;
      }
      callback(currentRole, user);
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

  // ---- config (realtime) ----
  onConfigChange(callback) {
    return firestore.collection('config').doc('main').onSnapshot((doc) => {
      callback(doc.exists ? doc.data() : null);
    });
  },
  async setConfig(value) {
    await firestore.collection('config').doc('main').set(value);
  }
};

window.DB = DB;
