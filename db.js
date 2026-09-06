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

firestore.enablePersistence({ synchronizeTabs: true }).catch(() => {
  // Multiple tabs without synchronizeTabs support, or a browser that
  // doesn't support persistence (e.g. private browsing) — the app still
  // works, just without the offline cache.
});

let currentUser = null; // { uid, role, name }

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
      currentUser = { uid: user.uid, role: profile.role, name: profile.name || '' };
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
