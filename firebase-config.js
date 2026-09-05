/* firebase-config.js — copy this file to `firebase-config.js` and fill in
   the values from your Firebase project (Project settings → General →
   Your apps → SDK setup and configuration).

   This is NOT a secret file — Firebase web config values are meant to be
   public (see https://firebase.google.com/docs/projects/api-keys) and are
   visible to anyone using the app anyway. It's kept out of the public repo
   here only so this codebase stays generic and isn't tied to one specific
   hotel's Firebase project. Real access control happens in firestore.rules
   and Firebase Authentication, not by hiding this file.

   `firebase-config.js` (without ".example") is listed in .gitignore, so
   once you fill it in and deploy, it won't get committed back here. */

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCiQ2bdqTUnEBqDCSWozHowsbwIHv-dTh0",
  authDomain: "hotel-maintenance-8c8b0.firebaseapp.com",
  projectId: "hotel-maintenance-8c8b0",
  storageBucket: "hotel-maintenance-8c8b0.firebasestorage.app",
  messagingSenderId: "938821970841",
  appId: "1:938821970841:web:9701e47a2bf43031dd8108"
};

/* The three fixed role accounts this app signs in as. The "email" is just
   an identifier Firebase Auth requires — it never needs to receive mail.
   Keep these in sync with the accounts you create in the Firebase console
   (see README.md → "Create the three role accounts"). */
window.ROLE_ACCOUNTS = {
  maintenance: "maintenance@site.local",
  housekeeping: "housekeeping@site.local",
  management: "management@site.local"
};
