# Room Jobs — PWA

A mobile-first maintenance job tracker, grouped by Area and Room. Runs entirely
offline once installed; all data is stored locally on the device in IndexedDB.
No server required.

## Files

- `index.html` — app shell
- `style.css` — styling
- `app.js` — app logic (jobs, rooms, areas, settings)
- `db.js` — IndexedDB storage layer (this is the seam to plug a sync/server layer into later)
- `manifest.webmanifest` — lets Chrome/Android install it as an app
- `sw.js` — service worker, caches the app for offline use
- `icon-192.png`, `icon-512.png` — app icons

## Deploy to GitHub Pages (recommended — free, HTTPS, no IT involvement)

1. Create a new **public** GitHub repo, e.g. `room-jobs`.
2. Upload all the files in this folder to the repo root (drag-and-drop on
   github.com works fine, or `git add . && git commit && git push`).
3. In the repo: **Settings → Pages → Source → Deploy from a branch → main → / (root)**.
4. GitHub gives you a URL like `https://yourusername.github.io/room-jobs/`.
   That's your app's permanent address — HTTPS by default, which service
   workers require.

## Install on Android

1. Open the GitHub Pages URL in Chrome on the phone.
2. Chrome menu (⋮) → **Add to Home screen** / **Install app**.
3. It now launches full-screen from the home screen icon, and works with
   no signal once it's loaded once (service worker caches everything).

## Configuring for a new site / hotel

Tap the ⚙ icon in the app:
- Set the **site name** (shown in the header).
- Add/remove **Areas** (floors, departments — whatever fits that building).
- Add/remove **Rooms**, each tagged to an Area.

Because this is all local storage, running the *same app* for a second hotel
means either:
- a second install pointed at a second deployment (simplest — just deploy
  the same code to a second GitHub repo/URL), or
- adding a "site switcher" later once there's a backend, so one install can
  hold multiple sites' data and swap between them.

## Where a server/cloud layer would go later

`db.js` is written so the rest of the app never talks to storage directly —
everything goes through `DB.getAllJobs()`, `DB.putJob()`, etc. When you're
ready to add sync:

1. Add a small self-hosted API (e.g. a lightweight Node/Python service on
   your own infrastructure) with a `jobs` / `rooms` / `config` table.
2. Wrap each `DB.put*`/`DB.delete*` call to also push to that API, with a
   local "outbox" queue for offline retries.
3. On app launch, pull from the API and merge into IndexedDB before
   rendering.

IndexedDB stays the source of truth for instant, offline-first reads either
way — the server becomes a sync target, not a dependency, so the app keeps
working exactly as it does now even if the network/server is unreachable.

## Adding user accounts later

There's already a plain "Logged by" text field on each job (no login) as a
placeholder. When you're ready for real accounts:
- Add a `users` store / API table with a name + PIN (simplest) or proper
  auth if it needs to cross untrusted networks.
- Gate the app behind a lightweight login screen that sets a `currentUser`
  in memory, and use that to auto-fill "Logged by" and optionally restrict
  editing/deleting other people's jobs.
- This doesn't require restructuring the data model — jobs already carry a
  `loggedBy` field to build on.
