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
   person's UID (from step 3), with three fields:
   - `role` (string) = `maintenance`, `housekeeping`, or `management`
   - `name` (string) = their display name, e.g. `Duncan` — this is what
     shows up on jobs they log, so you can tell who did what.
   - `department` (string) = which department they actually belong to,
     e.g. `Maintenance`, `Reception`, `Night Team`, `Duty Manager` — used
     to auto-tag jobs with who reported them (see "Departments and the
     'Reported by' tag" below). It's independent of `role`: night staff
     and duty managers, for example, are usually given the Housekeeping
     *role* (so they can raise reports) but should get their own real
     *department* here so their reports aren't mislabelled.

   This is what the security rules check — it's why only you (via the
   console) can grant someone a role, never the app itself.

   **If you're adding `department` to accounts that already existed
   before this field was introduced**, go back through each person's
   `users/{uid}` document in the Firestore console and add it — nothing
   breaks without it (jobs just fall back to a generic department name),
   but reports won't be correctly tagged until it's set.

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
reason. The notes thread is enforced append-only too — once a job has
notes as a list, an update may only add a new entry to the end, never
edit or remove an earlier one. Walk History entries get the same honest-
attribution check on `conductedByUid`/`conductedByName` when a walk is
logged, and deletion records get the same check on
`deletedByUid`/`deletedByName` — and once written, a deletion record can
never be edited or removed, permanently preserving why a job was
deleted even though the job itself is gone. Everyday use of the app is
unaffected — this only blocks requests that don't match how the app
actually behaves.

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
- There's a built-in **User Guide** covering all of this from inside the
  app itself — "How to use this app" on the login screen (readable
  before signing in), or the book icon in the header once signed in.
  It's organized by role (Everyone, Housekeeping/Night Team/Duty
  Managers, Fire & Security Walk, Maintenance, Management), so send
  people there first rather than this README, which is really the setup
  doc for whoever's running the Firebase project.
- As Maintenance: ⚙ Settings lets you set the site name and add the Areas
  and Rooms for this hotel. Do this once before anyone else logs jobs —
  housekeeping can only report against rooms that already exist.
- The main list defaults to the **Active** filter — everything except
  Done jobs — so it stays a list of what's actually outstanding instead
  of accumulating every completed job forever. Tap **All** to see
  everything including Done, or **Done** to see just the completed
  ones; the "Show all" button next to search resets both the filter and
  the search box back to everything in one tap.
- Each area's heading is tap-to-collapse, with a count badge showing
  how many jobs are inside while it's collapsed (the badge disappears
  once expanded, since the cards themselves are the count then). Which
  areas are collapsed is remembered while the app is open, but resets
  on reload — it's a "get this out of my way for now" toggle, not a
  saved preference.
- Every new job starts as **Open**, no matter who creates it — the New
  Job dialog doesn't offer a status choice at creation. Only Maintenance
  can move a job through its statuses afterwards (the status pill on
  each card, or editing the job).
- **Marking a job Done requires a note first** — explaining what was
  actually done to fix it. Tapping the status pill straight to Done
  opens the job instead of applying it instantly, landing you in the
  Notes box; add a note (or leave one already on the thread) and Save
  to complete it. This is the one status change with a gate — cycling
  between Open/In Progress/Awaiting Parts stays a single tap.
- **Deleting a job requires a reason.** Tapping Delete opens a small
  confirmation asking why — the job disappears from the list, but the
  reason (plus a full snapshot of the job) is kept permanently in
  Firestore's `deletedJobs` collection, so there's still a record of
  what was deleted and why even though the job itself is gone. Nothing
  in the app currently displays this collection — check it directly in
  the Firestore console if you ever need to.
- ⚙ Settings → Rooms has a **bulk import** box under the usual one-at-a-
  time form — paste multiple `Room number, Area` lines (one per room)
  and tap Import. Any area mentioned that doesn't exist yet is created
  automatically. It's safe to re-run: a room number already on file
  gets its area updated rather than duplicated, and rooms not in the
  pasted list are left alone — useful for setting up a full room list
  in one go, or fixing a batch of areas later.
- ⚙ Settings → **Common Issues** is an optional list of recurring
  problems (e.g. "Bath plug missing", "Sink blocked", "TV remote
  missing") that shows up as a "Quick pick" dropdown when logging or
  reporting a job — pick one to fill the issue text instantly, or leave
  it on "Other" and type your own. Nobody has to use it; it's purely a
  shortcut for the common cases.
- Every job now shows who logged it and when (date + time), and who last
  updated it and when if that's different — visible in the job list
  (compact) and the job detail view (full).
- Every job also carries a **"Reported by"** department tag — who it
  actually came from, separate from who typed it in. Housekeeping's own
  reports and Fire & Security Walk findings tag themselves automatically
  from the reporter's department; when Maintenance logs a job on behalf
  of someone else (e.g. a phone call from Reception), the New Job dialog
  has a "Reported by" picker defaulting to Maintenance's own department.
  ⚙ Settings → **Departments** is the editable list this picker draws
  from — seeded with Housekeeping, Reception, Night Team, Duty Manager,
  Maintenance and Fire & Security Walk, edit it to match this hotel's
  actual departments.
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

### Fire & Security Walk

The clipboard-checklist icon in the header (Maintenance and
Housekeeping-role accounts —
so it covers maintenance, night staff and duty managers doing the walk)
opens a floor-by-floor checklist, walked highest floor to lowest (then
any non-numbered areas like Bar or Kitchen after). On each floor: tap
any faults found (e.g. "Corridor lighting", "P10 fault") — leave them
all untapped if the floor's all in order — and optionally add a
freehand note, then **Next floor**. Nothing is saved until you tap
**Finish walk** on the last floor, so **Cancel walk** at any point
throws the whole walk away with nothing logged — no half-finished
findings left behind.

Each fault you tap becomes its own job, tagged `Fire & Security Walk`
and logged against a "**{Floor} Corridor**" room that's created
automatically the first time that floor gets a finding (e.g. "3rd Floor
Corridor") — so walk findings group under the same floor/area as
everything else, without needing a numbered room. A floor's optional
note is attached to whichever job(s) that floor produced; if you write
a note but tap no faults, it's logged as its own "Walk note" job so it
isn't lost.

**A fault that keeps getting found doesn't pile up duplicate jobs.**
Before logging a tapped fault as a new job, the walk checks whether
there's already an open (non-Done) job for that exact room and fault —
if so, it doesn't create another one. This is what makes a fault that
takes days to sort out (e.g. an EM light fitting that needs building,
testing and fitting) behave correctly: it stays as the *same* job,
carried through Open → In Progress → Awaiting Parts → Done at whatever
pace the work actually takes, how ever many walks re-confirm it's still
broken in the meantime — not a fresh "Open" job every time it's
re-spotted. When a Maintenance account runs the walk, each re-confirmation
also appends a note to that job ("Still present on today's walk", or
whatever freehand note you added), so the job's own note thread shows
the timeline. A Housekeeping-role walk (night staff/duty managers) skips
that note — Housekeeping can't edit an existing job (see the security
rules explainer above) — but Walk History still records that the fault
was found again that day, which is where to check if a job's own notes
don't mention it. Only a genuinely new occurrence, logged after the
previous one is marked Done, starts a new job — this only matches
faults picked from the Walk Faults checklist; a freehand "Walk note" is
never de-duplicated, since two different days' free text is usually
about two different things.

⚙ Settings → **Walk Faults** is the editable checklist offered on each
floor — seeded with the common ones (Corridor lighting, P10 fault, Fire
door, Fire extinguisher, Emergency lighting, Exit sign, Other), edit it
to match what this hotel's walks actually check for.

**Walk History** — the clock icon next to it opens a report of every
walk ever completed, newest first, grouped by day — only the most recent
day starts expanded, tap a day's heading to open or close it, so a long
history stays a scroll of headings rather than a wall of every walk ever
done. Each day's heading shows how many walks that day and whether any
had issues. Inside a day: when each walk was, who did it, and a
floor-by-floor breakdown (an "All clear" badge, or the faults found and
any note). Crucially, **finishing a walk records it even when every
floor is all clear** — so this is also your proof a walk actually
happened on a given day, not just a log of faults. Visible to everyone
signed in (including Management), since it's read-only.

Each floor also gets its own **completion timestamp**, stamped the
moment you tap "Next floor" (or "Finish walk" on the last one) — shown
in the report next to the time it took since the previous floor was
completed (e.g. `14:32 · +2m 14s`). Walking back and re-checking a
floor before moving on again is fine — only the timestamp from when you
actually move forward counts. A run of very short gaps between floors
is the tell for someone rattling through the checklist at their desk
rather than actually walking it.

## Adding someone new, or rotating/revoking a PIN

- **New person**: repeat steps 3–4 above for them — one Firebase Auth
  user, one `users/{uid}` document with their role, name and department.
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
`style.css`, or `db.js`, bump the version number in **all of these
places** so the check actually fires and the new files actually load on
reload:
- `version.json` → `"version"`
- `app.js` → `APP_VERSION` constant near the top
- `sw.js` → `CACHE_NAME`
- `sw.js` → the `?v=` query string on the `style.css`/`app.js`/`db.js`
  entries in the `ASSETS` array
- `index.html` → the same `?v=` query string on the `<link
  rel="stylesheet">` and the `db.js`/`app.js` `<script>` tags

They don't need to match each other's format — they're independent
triggers for "something changed" — but keep them as the same semver
string (e.g. everywhere becomes `0.1.16`) so it's obvious at a glance
they're in sync, and so a quick search for the old version number finds
every spot that still needs updating.

**Why the `?v=` query strings matter**: GitHub Pages doesn't give you
control over HTTP cache headers, so a plain reload can have the browser
(or an in-between CDN) serve the exact same cached copy of `app.js` even
after the service worker's own cache is cleared — the update banner
just keeps reappearing every time it's tapped, "stuck" reloading into
the same old version. Tagging `style.css`/`app.js`/`db.js` with a
version query string forces every browser layer to treat a new release
as a genuinely different URL, so there's nothing stale left to serve.

**`index.html` itself is fetched network-first** for the same reason,
one layer up: the query string is purely a client-side cache key — the
server always returns whatever `app.js` currently is, regardless of
which old version number an old cached `index.html` asks for. So a
stale cached `index.html` paired with a freshly-fetched newer `app.js`
is a real failure mode (a page missing a button a newer script expects
to wire up), not just a hypothetical one — it caused a genuine crash
once. `sw.js`'s fetch handler always tries the network for the page
navigation itself before falling back to cache, so the page structure
and the scripts it loads stay in sync as long as there's a connection.
As a second line of defence, `app.js`'s event-wiring calls all go
through a small `on(id, event, handler)` helper that skips a missing
element instead of throwing and aborting every wiring call after it —
so even if a mismatch like that does happen again, it degrades to one
inert button rather than breaking the whole page.

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
