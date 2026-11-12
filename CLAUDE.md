# Maintenance Tracker (MaintDB)

Mobile-first maintenance job tracker PWA for Leonardo Hotel Sheffield. Static site on GitHub Pages (`https://werdna64.github.io/maintenance/`) backed by **Firebase Auth + Firestore** – there is no SQL database and no server of our own.

- `README.md` – full setup, roles, Firestore data model, release process, and the "3D model integration" section.
- `firestore.rules` – server-side access control; bump the rules version/date comment on every change.
- `3D_MODEL_CONTEXT.md` – the separate 3D building model (private repo `werdna64/themodel`, hosted behind Cloudflare Access), how it deep-links into this app, the `assets.json` contract, and what is still to do on each side. **Read it before touching anything 3D-related.**

## Rules

- This repo and its Pages site are **public**. Never commit the 3D model, its data, `assets.json`, floor plans, or anything showing the hotel layout, plant rooms or CCTV positions. Never commit `serviceAccountKey.json`.
- `firebase-config.js` is the public client config and is committed on purpose.
- Roles and display names are only ever set in the Firebase console, never from the app.
- Job numbers are assigned by the `counters/jobs` Firestore transaction, never by the client on its own.
