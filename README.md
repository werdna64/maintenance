# Room Jobs — hotel maintenance tracker (PWA)

A mobile-first maintenance job tracker, grouped by Area and Room, shared in
real time across everyone who needs it. Installs to the home screen on
Android and iOS like a native app (no App Store needed) and works offline —
data syncs the moment a signal comes back.

## Who uses it, and what they can do

Three roles, each with its own PIN. Under the hood each role is a real
Firebase account — the PIN is just that account's password — so every
device's access is enforced by the server (Firestore security rules), not
just hidden in the app's UI.

| Role | Can do |
|---|---|
| **Maintenance** | Full control: log/edit/delete jobs, cycle status, manage the list of rooms and areas, set the site name. |
| **Housekeeping** | Raise a "Report a problem" against an existing room, and see the status of everything reported. Can't edit, delete, or change status — corrections go through Maintenance. |
| **Management** | Read-only dashboard: open/in-progress/awaiting-parts/done counts, and the full job list, grouped the same way. No editing. |

This means housekeeping's reports land directly in the job list — no more
relaying through the chat group.

## Files

- `index.html` — app shell (login screen + main app)
- `style.css` — styling
- `app.js` — app logic (login, jobs, rooms, areas, settings, role-based UI)
- `db.js` — Firebase Authentication + Firestore data layer
- `firebase-config.example.js` — template for your Firebase project's keys
- `firebase-config.js` — **you create this** (gitignored — see setup below)
- `firestore.rules` — server-side security rules (who can read/write what)
- `firebase.json` — optional, only needed if you deploy with the Firebase CLI
- `manifest.webmanifest` — lets Chrome/Safari install it as an app
- `sw.js` — service worker, caches the app shell for offline use
- `icon-192.png`, `icon-512.png` — app icons

## One-time setup

You'll need a free Google account. This all runs on Firebase's free tier —
for one hotel's maintenance traffic, it costs nothing.

### 1. Create the Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) →
   **Add project**. Name it anything (e.g. `hotel-maintenance`).
2. You don't need Google Analytics for this — you can turn it off.

### 2. Turn on Authentication

1. In the project, go to **Build → Authentication → Get started**.
2. Under **Sign-in method**, enable **Email/Password**.

### 3. Create the three role accounts

Still in **Authentication → Users → Add user**, create three accounts.
The "email" doesn't need to be real or receive mail — it's just an ID:

| Email | Password |
|---|---|
| `maintenance@site.local` | the Maintenance PIN |
| `housekeeping@site.local` | the Housekeeping PIN |
| `management@site.local` | the Management PIN |

Use a PIN that's at least 6 characters (Firebase's minimum) and not
something guessable like `123456` — anyone who has it can act as that role
from any device. Write down each account's **User UID** (shown in the
Users table) — you need it in the next step.

If you use different email addresses than the table above, update
`ROLE_ACCOUNTS` in `firebase-config.js` (step 6) to match.

### 4. Turn on Firestore and set up roles

1. Go to **Build → Firestore Database → Create database**. Start in
   **production mode** (the rules file below replaces the default).
2. In the Firestore console, manually add a collection called `roles`.
   For each of the three users, add a document whose **Document ID** is
   that user's UID (from step 3), with one field:
   - `role` (string) = `maintenance`, `housekeeping`, or `management`
     accordingly.

   This is what the security rules check — it's why only you (via the
   console) can grant a role, never the app itself.

### 5. Deploy the security rules

Easiest way — no install required:
1. Firestore console → **Rules** tab.
2. Paste in the contents of `firestore.rules` from this repo.
3. Click **Publish**.

(Alternatively, if you have the [Firebase CLI](https://firebase.google.com/docs/cli)
installed: `firebase deploy --only firestore:rules` using the included
`firebase.json`.)

### 6. Get your web app config

1. Project settings (gear icon) → **General** → scroll to **Your apps** →
   **Add app → Web** (`</>`).
2. Register it (any nickname), skip hosting setup if asked.
3. Copy the `firebaseConfig` object it shows you.
4. In this repo, copy `firebase-config.example.js` to `firebase-config.js`
   and paste your values in. This file is deliberately git-ignored — it's
   fine for these values to be public (Firebase's docs confirm the web
   config isn't a secret), it's just kept out of this repo so the codebase
   stays generic.

## Deploy to GitHub Pages (recommended — free, HTTPS, no IT involvement)

1. Create a new **public** GitHub repo, e.g. `room-jobs`.
2. Push all the files in this folder to the repo root — **including your
   filled-in `firebase-config.js`** (it's gitignored in *this* repo only
   so the template stays generic; your deployed copy needs to actually
   ship it, or delete it from `.gitignore` before you push, or upload it
   directly on github.com).
3. In the repo: **Settings → Pages → Source → Deploy from a branch → main
   → / (root)**.
4. GitHub gives you a URL like `https://yourusername.github.io/room-jobs/`.
   That's your app's permanent address — HTTPS by default, which service
   workers require.

## Install on Android

1. Open the URL in Chrome on the phone.
2. Chrome menu (⋮) → **Add to Home screen** / **Install app**.

## Install on iPhone/iPad

1. Open the URL in Safari.
2. Share icon → **Add to Home Screen**.

Either way it launches full-screen from the home screen icon, and keeps
working with no signal once it's loaded once.

## Day-to-day use

- Send the install link to Duncan (Maintenance), Lena/Juthakon
  (Housekeeping), and Gary/Katie (Management), plus the relevant PIN for
  each.
- On first open, tap your role, enter the PIN. Everyone stays signed in
  after that until they tap the ⏻ logout button.
- As Maintenance: ⚙ Settings lets you set the site name and add the Areas
  and Rooms for this hotel. Do this once before anyone else logs jobs —
  housekeeping can only report against rooms that already exist.

## Rotating or revoking a PIN

If someone leaves, or a PIN gets shared further than intended: Firebase
console → **Authentication → Users** → find the role's account → **⋮ →
Reset password**, and give everyone the new PIN. No app update needed.

## Backing up your data

Firestore console → your project → **Firestore Database** shows every job,
room, and the config doc directly, and can export the whole database
(**⋮ → Export/Import**) to Google Cloud Storage if you want an offline
backup.

## Where this could go next

- **Per-person logins** instead of shared role PINs, if you want to know
  exactly who logged or closed each job (Firebase Authentication already
  supports this — it's a bigger change to the login screen, not the data
  model).
- **Push notifications** (Firebase Cloud Messaging) so Maintenance gets
  pinged the moment housekeeping reports something, instead of having to
  open the app.
- **Photo attachments** on jobs (Firebase Storage) — useful for handover
  when Duncan's back, or for parts you need to identify.
- **Priority/urgency field** for jobs (e.g. a leak vs. a loose picture
  frame) so the list can surface the worst ones first.
