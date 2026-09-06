# Maintenance Tracker (PWA)

A mobile-first maintenance job tracker, grouped by Area and Room, shared in
real time across everyone who needs it. Installs to the home screen on
Android and iOS like a native app (no App Store needed) and works offline —
data syncs the moment a signal comes back.

## Who uses it, and what they can do

Every person gets their own account — a **username and a personal PIN**.
Under the hood each account is a real Firebase account, so device access
is enforced by the server (Firestore security rules) using the account's
assigned role, not just hidden in the app's UI. Because everyone signs in
as themselves, every job records who actually logged it, updated it, or
closed it — a real audit trail, not a free-text field anyone could fill
in with anything.

Each account is assigned one of three roles:

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
- `firebase-config.js` — this hotel's actual Firebase project keys (committed — see "Get your web app config" below)
- `firestore.rules` — server-side security rules (who can read/write what)
- `firebase.json` — optional, only needed if you deploy with the Firebase CLI
- `manifest.webmanifest` — lets Chrome/Safari install it as an app
- `sw.js` — service worker, caches the app shell for offline use
- `version.json` — current build number; app.js polls this to detect a
  stale build and prompt a reload (see "Releasing an update" below)
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

### 3. Create an account for each person

Still in **Authentication → Users → Add user**, create one account per
person who'll use the app. The "email" the app asks for is just
`<username>@site.local` — it never needs to be real or receive mail, it's
just an identifier:

| Email | Password |
|---|---|
| `duncan@site.local` | Duncan's personal PIN |
| `lena@site.local` | Lena's personal PIN |
| `juthakon@site.local` | Juthakon's personal PIN |
| `gary@site.local` | Gary's personal PIN |
| `katie@site.local` | Katie's personal PIN |
| *(you, etc.)* | your PIN |

The part before `@site.local` is that person's **username** — what they
actually type into the app's login screen (case doesn't matter; spaces
become dots). Use a PIN that's at least 6 characters (Firebase's minimum)
and not something guessable — anyone who has it can sign in as that
person from any device. Write down each account's **User UID** (shown in
the Users table) — you need it in the next step.

(The app used to sign in with three shared role accounts —
`maintenance@site.local` etc. If you already created those, you can keep
them as a fallback shared login, delete them once everyone has their own
account, or repurpose one — e.g. rename its `name` field — for yourself.)

### 4. Turn on Firestore and set up each person's role

1. Go to **Build → Firestore Database → Create database**. Start in
   **production mode** (the rules file below replaces the default).
2. In the Firestore console, manually add a collection called `users`.
   For each person, add a document whose **Document ID** is that
   person's UID (from step 3), with two fields:
   - `role` (string) = `maintenance`, `housekeeping`, or `management`
   - `name` (string) = their display name, e.g. `Duncan` — this is what
     shows up on jobs they log, so you can tell who did what.

   This is what the security rules check — it's why only you (via the
   console) can grant someone a role, never the app itself.

### 5. Deploy the security rules

Easiest way — no install required:
1. Firestore console → **Rules** tab.
2. Paste in the contents of `firestore.rules` from this repo.
3. Click **Publish**.

(Alternatively, if you have the [Firebase CLI](https://firebase.google.com/docs/cli)
installed: `firebase deploy --only firestore:rules` using the included
`firebase.json`.)

**What these rules actually protect, beyond who-can-touch-what**: creating
or editing a job requires the `createdByUid`/`createdByName` and
`updatedByUid`/`updatedByName` fields to genuinely match whoever is
signed in (checked against their `/users/{uid}` profile) — the app's UI
was always the only thing enforcing honest attribution and "new jobs
start Open," which meant someone using the Firestore SDK directly
(bypassing the app entirely) could previously have forged those fields.
This closes that gap. A job's `createdByUid`/`createdByName`/`dateLogged`
also become permanently unchangeable after creation, for the same
reason. Everyday use of the app is unaffected — this only blocks
requests that don't match how the app actually behaves.

### 6. Get your web app config

1. Project settings (gear icon) → **General** → scroll to **Your apps** →
   **Add app → Web** (`</>`).
2. Register it (any nickname), skip hosting setup if asked.
3. Copy the `firebaseConfig` object it shows you.
4. In this repo, copy `firebase-config.example.js` to `firebase-config.js`
   and paste your values in. It's fine for these values to be committed
   and public (Firebase's docs confirm the web config isn't a secret —
   real access control is the rules + Auth, not this file); it's just
   `.gitignore`d by default so a copy of this codebase deployed for a
   *different* hotel doesn't accidentally ship with your project's values.

   (This repo already has its own `firebase-config.js` committed and
   filled in — you only need to redo this step if you ever start a fresh
   Firebase project.)

## Deploy to GitHub Pages (recommended — free, HTTPS, no IT involvement)

1. Push this repo to GitHub if it isn't already (it needs `firebase-config.js`
   present at the repo root — see above).
2. In the repo: **Settings → Pages → Source → Deploy from a branch → main
   → / (root)**.
3. GitHub gives you a URL like `https://yourusername.github.io/maintenance/`.
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

- Send the install link to each person, along with their own username and
  PIN — not a shared one.
- On first open, enter your username and PIN. Everyone stays signed in
  after that on that device until they tap the ⏻ logout button.
- As Maintenance: ⚙ Settings lets you set the site name and add the Areas
  and Rooms for this hotel. Do this once before anyone else logs jobs —
  housekeeping can only report against rooms that already exist.
- Every new job starts as **Open**, no matter who creates it — the New
  Job dialog doesn't offer a status choice at creation. Only Maintenance
  can move a job through its statuses afterwards (the status pill on
  each card, or editing the job).
- ⚙ Settings → **Common Issues** is an optional list of recurring
  problems (e.g. "Bath plug missing", "Sink blocked", "TV remote
  missing") that shows up as a "Quick pick" dropdown when logging or
  reporting a job — pick one to fill the issue text instantly, or leave
  it on "Other" and type your own. Nobody has to use it; it's purely a
  shortcut for the common cases.
- Every job now shows who logged it and when (date + time), and who last
  updated it and when if that's different — visible in the job list
  (compact) and the job detail view (full).
- Notes are a running, timestamped thread rather than one overwritable
  text box — each note you add is its own entry, permanently signed
  with who wrote it and when, so earlier notes never get lost or
  silently replaced when someone adds a new one. Maintenance-only to
  add (same as everything else editable); everyone can read the full
  thread. The job list shows just the latest note as a preview
  ("+N more" if there's a longer history) — open the job to see it all.
- The 🔔 in the header shows what's new since you last checked: for
  Maintenance, jobs someone else has reported; for whoever logged a job,
  any status change someone else made to it. It only updates while the
  app is open — closing the app doesn't send an alert, but nothing is
  lost either, since it's computed fresh from the real job data every
  time you reopen it. Tap a notification to jump straight to that job.

## Adding someone new, or rotating/revoking a PIN

- **New person**: repeat steps 3–4 above for them — one Firebase Auth
  user, one `users/{uid}` document with their role and name.
- **PIN change or someone leaving**: Firebase console →
  **Authentication → Users** → find their account → **⋮ → Reset
  password** (to change their PIN), or **⋮ → Delete account** (to revoke
  access entirely). No app update needed either way.
- **Role change** (e.g. someone moves from Housekeeping to Maintenance):
  edit the `role` field on their `users/{uid}` document in Firestore.

## Releasing an update

Every device polls `version.json` (on launch, every 15 minutes while
open, and whenever the tab/app comes back to the foreground) and shows a
"new version available" banner with a Reload button if it doesn't match
the build that's currently loaded — so staff don't get stuck running an
old, possibly-broken copy without knowing it.

### Version numbering

Uses standard semantic versioning, with the phase of rollout as an
explicit label alongside the number (shown on the login screen and in
the app header, e.g. `v0.1.3 · Pre-release`):

| Version | Stage | Meaning |
|---|---|---|
| `0.1.x` | **Pre-release** | Just you, testing solo. |
| `0.2.x` | **Beta** | Other staff are using it too. |
| `1.0.0`+ | **Release** | The real thing — `1.1.0` for new features from here, `1.0.1` for fixes. |

### Bumping the version

Whenever you (or anyone) pushes a change to `app.js`, `index.html`,
`style.css`, or `db.js`, bump the version number in **three places** so
the check actually fires and the new files actually load on reload:
- `version.json` → `"version"`
- `app.js` → `APP_VERSION` constant near the top
- `sw.js` → `CACHE_NAME`

All three just need to change to *something* different from before —
they don't need to match each other's format, they're three independent
triggers for "something changed." In practice, keep them as the same
semver string (e.g. all three become `0.1.4`) so it's obvious at a
glance they're in sync.

The **stage** label (`APP_STAGE` in `app.js`, `"stage"` in
`version.json`) doesn't need to change on every release — only bump it
when you actually move to the next phase (e.g. handing it to Duncan and
Lena for the first time = flip to Beta).

### Don't forget the security rules

Bumping the version only ships `app.js`/`index.html`/`style.css`/`db.js`.
If a change also touched `firestore.rules` (a new collection, a
permission change), that needs a **separate** manual step — paste the
updated file into Firestore console → **Rules** → **Publish** (see
"Deploy the security rules" above). Nothing enforces this automatically;
forgetting it means the code expects a permission the server doesn't
actually grant yet.

## Backing up your data

Firestore console → your project → **Firestore Database** shows every job,
room, and the config doc directly, and can export the whole database
(**⋮ → Export/Import**) to Google Cloud Storage if you want an offline
backup.

## Where this could go next

- **Push notifications** (Firebase Cloud Messaging) so Maintenance gets
  pinged the moment housekeeping reports something, instead of having to
  open the app.
- **Photo attachments** on jobs (Firebase Storage) — useful for handover
  when Duncan's back, or for parts you need to identify.
- **Priority/urgency field** for jobs (e.g. a leak vs. a loose picture
  frame) so the list can surface the worst ones first.
