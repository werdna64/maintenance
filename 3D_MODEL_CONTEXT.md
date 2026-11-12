# 3D Building Model – context for MaintDB

_Last updated: 12 Nov 2026_

What the 3D building model is, where it lives, and how it connects to this app. MaintDB is a static PWA on GitHub Pages with **Firebase Auth + Firestore** (no SQL, no server of its own). The app-side integration is already built – see README → "3D model integration". This file covers the model side and what is still to do.

## 1. What the 3D model is

An interactive three.js model of **Leonardo Hotel Sheffield**: 12 levels (Basement, Lower Ground, Ground, 1–9), ~580 spaces, 259 bedrooms, plant rooms, the LG switch room with its distribution boards, AC condensers, doors and fire zones.

- One self-contained page, `index.html` (~1.2 MB): three.js and all building data inlined, **no network requests**.
- Tap a space → info panel. Fitted-out spaces and every bedroom have a **close-up view** with tappable items (lamps, WC, TV, distribution boards…).
- Tapping an item opens an asset sheet with a **Log a job** button that deep-links into MaintDB.
- Distribution boards show their circuit chart laid out like the board, with red ON / green OFF breaker flags.

## 2. Where everything lives

| Thing | Location | Visibility |
| --- | --- | --- |
| Model source + built page | GitHub `werdna64/themodel` (`main`) | **Private** |
| Live model | `https://themodel-b4w.pages.dev` – Cloudflare Pages, auto-deploys on push to `main` | Behind **Cloudflare Access** (emailed one-time code, allow-list) |
| MaintDB | GitHub `werdna64/maintenance` → `https://werdna64.github.io/maintenance/` | **Public** repo and site; data in Firestore behind Firebase Auth |
| Circuit register (interim) | Claude Sheets "Leonardo Sheffield – Circuit Register" | Private |
| Integration brief (background) | Claude Doc "3D Hotel Model ↔ Maintenance Tracker – Integration Brief" – written before MaintDB's Firestore design was known; its SQL is superseded by this file and the README | Private |

`werdna64/themodel` layout: `index.html` (built model) · `build.sh` (rebuilds it) · `src/hotel.py`, `src/build.py` (geometry, fixtures, boards → `src/out/viewer_data.json`) · `src/viewer.html` (viewer, panels, Log-a-job link) · `src/make_html.py` (assembles `index.html`, stamps "Model updated <date>") · `src/three_bundle.js`.

## 3. Security rules for this repo

- **Never copy the model, `viewer_data.json`, floor geometry or screenshots of plant/switch rooms into this repo.** It and its Pages site are public; the model shows the hotel layout, plant and switch rooms, CCTV positions and fire routes.
- `assets.json` from the model is fine to pass to `scripts/sync-assets.js` locally, but **do not commit it** here (it lists rooms and equipment locations). Add it to `.gitignore` if it is ever placed in the repo folder.
- Linking **to** the model is fine: its URL goes in ⚙ Settings → Site → **3D model link**. Cloudflare Access controls who gets in; staff are managed in Cloudflare Zero Trust → Access controls → Policies → **Hotel staff**.
- `serviceAccountKey.json` must never be committed (already git-ignored).

## 4. Status

| Piece | MaintDB (this repo) | 3D model (`themodel`) |
| --- | --- | --- |
| Deep link `?new=1&asset=…&floor&location&name&source=3d-model` with fallback | **Done** (app.js deep-link handler) | **Done** — sends `new, site, floor, location, name, asset, source`; `asset` is now the unique `assetKey`, `name` the display label |
| `assets` collection keyed by `assetKey` | **Done** (rules + `scripts/sync-assets.js`) | **Done** — every tappable item carries `userData.assetKey` (`assetKeyFor()` in `src/viewer.html`); **Export assets.json** link in the side panel (also `window.exportAssets()`) produces the file for `scripts/sync-assets.js`. Verified in a real headless-Chromium run: 11,356 unique keys, 259 distinct bedrooms, zero collisions. One open item: `FLOOR_TO_AREA`'s floor→Area-name mapping is a reasonable guess, not yet checked against MaintDB's actual Settings → Areas list (see question 1 below) |
| Job numbers `SHF-000123` | **Done** (`counters/jobs` transaction; prefix in Settings → Site) | n/a |
| "3D Model" tile on Home | **Done** – needs the URL pasted into Settings → Site → 3D model link | Live at `https://themodel-b4w.pages.dev` |
| Circuits / breakers, supply tracing | Not started | Board charts exist in the model; register in Claude Sheets |
| Live open-job status in the model | Spec written (section 9) – needs the model to read Firestore directly | Not started |

## 5. Contract the model must meet (from README)

**Deep link** (model → app):

```
https://werdna64.github.io/maintenance/?new=1
  &asset=SHF.5.R505.BED.LAMP-L
  &source=3d-model
  &floor=Fifth
  &location=Room 505
  &name=Left bedside lamp
```

**`assets.json`** (model export → `node scripts/sync-assets.js path/to/assets.json`): a JSON array of

```json
{ "assetKey": "SHF.5.R505.BED.LAMP-L", "area": "5th Floor", "room": "505", "name": "Left bedside lamp", "type": "lamp", "parentKey": null }
```

- `assetKey` format: `SHF.<FLOOR>.<LOCATION>[.<ZONE>].<ITEM>[-N]`, upper case, dot-separated, never reused. Floors `B`, `LG`, `G`, `1`–`9`, `ROOF`. Examples: `SHF.5.R505.BATH.EXTRACT`, `SHF.LG.SWITCH-ROOM.DB-HF`.
- `area` and `room` **must match MaintDB's existing Area and Room names exactly** (⚙ Settings → Areas / Rooms), otherwise the sync script creates new ones. The model needs that list before it can export – see open questions.
- `active` is managed by the sync script; the model does not send it.

## 6. Open questions

1. **Now the one actually blocking a real sync.** What are MaintDB's exact Area names and Room naming (e.g. `5th Floor` / `505`, and for non-bedrooms like the switch room or bar)? Check ⚙ Settings → Areas / Rooms in the live app and compare against `themodel`'s `FLOOR_TO_AREA` map (`src/viewer.html`) and each space's `s.no`/`s.name` – update whichever side doesn't match before running `scripts/sync-assets.js` for real (it'll create new Areas/Rooms for anything that doesn't match exactly, which is recoverable but messy to clean up after the fact).
2. Should breakers become assets (so a job can be logged against "DB-HF way 10 L2")? If so, `parentKey` = the board's key. Circuit tracing beyond that is a separate future data model.
3. Which department should "3D Model" jobs map to – add a **3D Model** department in Settings, or leave blank?

## 7. One tab, not a new one per tap (new – MaintDB side done, model side to do)

Each "Log a job" click currently opens the deep link with an unnamed
target (e.g. `window.open(url, '_blank')` or a plain `<a target="_blank">`),
so every tap spawns a brand-new tab/window – a fresh full page load
(Firebase init, all Firestore listeners reconnecting) and a pile of
abandoned tabs after a few taps. Two independent model-side fixes,
either is worth doing, both together is the real cure:

**Quick fix – reuse one tab:** give `window.open` a fixed target name
instead of `_blank`, and keep the returned handle around:
```js
let maintdbWin = null;
function logJob(url){
  if(maintdbWin && !maintdbWin.closed){ maintdbWin.location.href = url; maintdbWin.focus(); }
  else { maintdbWin = window.open(url, 'maintdb-logjob'); }
}
```
Still a full page reload per tap, but only ever one tab.

**Better fix – skip the reload entirely:** MaintDB now also listens for
a `postMessage` on that same reused window, so a second/third tap on a
different item doesn't reload it at all – the wizard just resets and
re-prefills for the new item, same as a fresh deep link would, in
under a second:
```js
let maintdbWin = null;
function logJob({ asset, floor, location, name, source }){
  const payload = { type: 'maintdb:logJob', asset, floor, location, name, source };
  if(maintdbWin && !maintdbWin.closed){
    maintdbWin.postMessage(payload, 'https://werdna64.github.io');
    maintdbWin.focus();
  } else {
    const url = new URL('https://werdna64.github.io/maintenance/');
    url.searchParams.set('new', '1');
    Object.entries(payload).forEach(([k,v]) => { if(k !== 'type' && v) url.searchParams.set(k, v); });
    maintdbWin = window.open(url, 'maintdb-logjob');
  }
}
```
MaintDB only accepts a message whose `event.origin` matches whatever's
set in Settings → Site → 3D model link (`https://themodel-b4w.pages.dev`)
– nothing arrives until that field is filled in, and nothing from any
other origin is ever accepted. `type` must be exactly `maintdb:logJob`;
the other fields are the same `asset`/`floor`/`location`/`name`/`source`
as the URL link, just as object properties instead of query params.

Each message applies independently and immediately replaces whatever
was on screen in that tab – there's no "are you sure" if someone had
started typing a note for the previous item and then taps a different
one; that's deliberate (the whole point is tapping through several
items quickly), so keep that in mind if it ever feels like it's
discarding something you expected to keep.

## 8. Next steps

- **Model side — done:** `assetKey` on every tappable item, `asset=<key>`/`name=<label>` both sent in the Log-a-job link, and an **Export assets.json** link in the side panel. Still open: reuse one tab via a named `window.open` target and/or `postMessage` (section 7) – the MaintDB side of that is already live, the model side isn't wired up yet.
- **MaintDB side – do next:** paste `https://themodel-b4w.pages.dev` into Settings → Site → 3D model link if not already done. Before running a real sync: resolve open question 1 above (Area/Room names matching exactly), export `assets.json` from the model's side panel, then `node scripts/sync-assets.js path/to/assets.json` and check the drift report.

## 9. Live status – the model reads Firestore directly (spec, not built)

No production data or users yet, so this is a good time to try real
two-way communication rather than staying one-way. The highest-value
piece: the model colours any tapped item by whether it currently has
an open job, read live from the same Firestore project MaintDB
already uses – no API, no new backend, same architecture as
everything else here.

**What the model needs:**

1. **The same public Firebase web config MaintDB already ships** –
   copy the values straight out of this repo's `firebase-config.js`
   (it's not a secret; Firestore's own rules are what actually gate
   access, same reasoning as this file's section 3 already covers for
   everything else).
2. **Anonymous Authentication turned on** – Firebase console →
   Authentication → Sign-in method → enable **Anonymous**. One console
   toggle, nothing in code on the MaintDB side.
3. **No `firestore.rules` change needed.** Every read the model needs
   (`jobs`, `rooms`, `config`, `assets`, `walks`, `ppmTasks`) is gated
   by `signedIn()` alone – `request.auth != null` – which an anonymous
   session satisfies exactly the same as a real staff login. Writes,
   and reads of `counters`/`deletedJobs`, stay blocked for an anonymous
   session (those check an actual role via `/users/{uid}`, which an
   anonymous UID never has) – correctly, since the model only ever
   needs to read.

**What to listen to:** the whole `jobs` collection, same scale
MaintDB's own `onJobsChange` already handles – no `where` clause,
no composite index, nothing to tune:

```js
firebase.initializeApp(FIREBASE_CONFIG); // from firebase-config.js
firebase.auth().signInAnonymously().then(() => {
  firebase.firestore().collection('jobs').onSnapshot(snap => {
    const statusByAsset = new Map();
    snap.docs.forEach(d => {
      const job = d.data();
      if(!job.assetKey || job.status === 'Done') return;
      statusByAsset.set(job.assetKey, job.status); // last one wins if >1 open job shares a key
    });
    applyAssetColours(statusByAsset); // model's own fn: walk tappable meshes, colour by userData.assetKey
  });
});
```

**The real limitation, worth knowing before building this:** a job
only carries `assetKey` if it was created *through* the model's own
deep-link/message flow (section 7). A job logged normally in MaintDB –
Housekeeping's "Report a problem", a Fire & Security Walk finding, a
PPM job, or Maintenance just picking a room in the ordinary New Job
wizard without going via the model – has no `assetKey`, so it won't
turn that item red even though it's genuinely the same physical thing.
Day one, this will under-report: most jobs won't have come through the
model yet. Closing that gap needs an "Asset" picker added to MaintDB's
own job sheet (so staff can tag one manually even when not using the
model) – not built, a real follow-up decision, not something to assume
into this spec.

**Also worth being deliberate about:** this exposes full job documents
to the model (issue text, notes, staff names, department – not just a
status colour), to anything that can complete Firebase anonymous
auth. In practice that's already gated by the same Cloudflare Access
allow-list as the rest of the model, so it's not a new exposure in
practice – just flagging it as a conscious choice rather than an
accident. A tighter version (status only, no text) would need a
maintained `assetStatus/{assetKey}` summary collection instead of
reading `jobs` directly – real extra engineering (something has to
keep it in sync – client-side on every save, the same way
`counters/jobs` is maintained today, or a Cloud Function, which this
app has deliberately avoided so far) – worth it only once this first
version proves the idea is worth having.

