# 3D Building Model – context for MaintDB

_Last updated: 18 Nov 2026_

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
| `assets` collection keyed by `assetKey` | **Done** (rules + `scripts/sync-assets.js`) | **Done** — every tappable item carries `userData.assetKey` (`assetKeyFor()` in `src/viewer.html`); **Export assets.json** link in the side panel (also `window.exportAssets()`) produces the file for `scripts/sync-assets.js`. Verified in a real headless-Chromium run (13,080 unique keys after the upstream columns/paving work, zero collisions). `FLOOR_TO_AREA`'s guess-table is gone — MaintDB now stores the model's own `floorLevel`/`floorName`/`kind`/`zone` directly (see section 5), so there's nothing left to check for a mismatch |
| Job numbers `SHF-000123` | **Done** (`counters/jobs` transaction; prefix in Settings → Site) | n/a |
| "3D Model" tile on Home | **Done** – needs the URL pasted into Settings → Site → 3D model link | Live at `https://themodel-b4w.pages.dev` |
| Circuits / breakers, supply tracing | Not started | Board charts exist in the model; register in Claude Sheets |
| Live open-job status in the model | **Done** — room-level "Open jobs" colour-by mode, reading Firestore directly (section 10) | n/a |
| Asset picker in MaintDB's own job sheet | **Done** — New Job wizard, the single-page job sheet, and Report a problem all have an optional **Item** field scoped to the selected room, fed from the synced `assets` collection (see README's "3D model integration"). This is what section 9/10 below call "closing the asset-key gap" — a job logged the normal way (not via the model's deep link) can now carry an `assetKey` too, so the live-status view isn't limited to model-originated jobs only | n/a |

## 5. Contract the model must meet (from README)

**Deep link** (model → app):

```
https://werdna64.github.io/maintenance/?new=1
  &asset=SHF.5.R505.BED.LAMP-L
  &source=3d-model
  &floor=Fifth
  &location=Room 505
  &name=Bedside lamp (left)
```

**`assets.json`** (model export → `node scripts/sync-assets.js path/to/assets.json`): a JSON array of

```json
{ "assetKey": "SHF.5.R505.BEDSIDE-LAMP-L", "floorLevel": 5, "floorName": "5th Floor", "room": "505", "kind": "room", "zone": null, "name": "Bedside lamp (left)", "type": "lamp", "parentKey": null }
```

**Item naming rules** (model side, agreed 18 Nov 2026). MaintDB builds
its Item Faults picker from the distinct `name` values in `assets.json`,
so every spelling variant the model invents becomes another entry in
that picker. Three rules keep it honest:

1. **One word per fixture.** A basin is a `Basin` whether it is wall
   hung or sat on a vanity; a socket is a `Socket` wherever it is. If
   the qualifier only records which *room type* you are in, drop it --
   the model already shows you which room you are looking at.
2. **A qualifier exists only to tell two of the same thing apart in the
   same space.** `Window (Duke Lane side)` and `Window (Eyre Street
   side)` earn their brackets because the corner rooms have both; every
   other room just has a `Window`. Qualifiers are lower case.
3. **Qualifiers are absolute, never relative.** Naming something by what
   happens to be next to it multiplies with the room handing. Bedside
   items are `(left)` and `(right)`, **as seen standing at the foot of
   the bed looking at the headboard** -- stated on the asset sheet in
   the model, because a convention nobody can see is not a convention.
   Note that **left is not a synonym for window side**: the hotel's
   mirrored room pairs mean the left lamp is the window-side one in
   roughly half the rooms and the bathroom-side one in the rest.

Vocabulary is shared with MaintDB's own common-issue wording -- that is
why the model says `Toilet` and not `WC`. If one side renames a fixture,
the other should follow, and `scripts/sync-assets.js` prunes
`config.itemTypes` so the old spelling drops out of the picker on the
next sync.

- `assetKey` format: `SHF.<FLOOR>.<LOCATION>[.<ZONE>].<ITEM>[-N]`, upper case, dot-separated, never reused. Floors `B`, `LG`, `G`, `1`–`9`, `ROOF`. Examples: `SHF.5.R505.BATH.EXTRACT`, `SHF.LG.SWITCH-ROOM.DB-HF`.
- **`floorLevel`/`floorName` are the model's own values, straight from each floor object** (`f.level`/`f.name` in `src/viewer.html`) — MaintDB no longer keeps a separately hand-typed "Area" list to match against. The old `FLOOR_TO_AREA` guess-table is gone entirely. `scripts/sync-assets.js` keeps MaintDB's Settings → Floors and the Item Faults picker's item-type list (`config.itemTypes`, from the distinct `name` values seen) in step automatically — nothing to reconcile by hand before a sync.
- `kind` is the model's own space kind (`room`/`corridor`/`plant`/`store`/...), `zone` its zone/wing grouping where it has one. Neither is used by the app yet, stored for later.
- `room` still has to be a stable string per physical space/room (its number, or a name for non-numbered spaces) — that part is unchanged.
- `active` is managed by the sync script; the model does not send it.

## 6. Open questions

1. ~~Area/Room naming matching exactly~~ — resolved; see `floorLevel`/`floorName` above. This is no longer a thing to check before syncing.
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

- **Model side — done:** `assetKey` on every tappable item, `asset=<key>`/`name=<label>` both sent in the Log-a-job link, an **Export assets.json** link in the side panel, and the room-level "Open jobs" live status view (section 10). Still open: reuse one tab via a named `window.open` target and/or `postMessage` (section 7) – the MaintDB side of that is already live, the model side isn't wired up yet.
- **MaintDB side — done:** the Area/Floor schema mismatch is resolved (section 5), the sync script is diff-based and safe to re-run, and the Asset picker closing the "assetKey gap" (sections 9/10) is built. Next real decision on this side is section 10's item-level work (per-item job lists, a floor work list) now that the gap it was blocked on is closed.

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

**The limitation this used to have, now closed (18 Nov 2026):** a job
only ever carried `assetKey` if it was created *through* the model's
own deep-link/message flow (section 7) — a job logged normally in
MaintDB (Housekeeping's "Report a problem", a Fire & Security Walk
finding, a PPM job, or the ordinary New Job wizard without going via
the model) had no `assetKey`, so it couldn't turn that item red even
though it was genuinely the same physical thing, and day one this
would have badly under-reported. MaintDB's job sheets (New Job wizard,
the single-page edit sheet, and Report a problem) now all have an
optional **Item** picker scoped to the selected room, fed from the
synced `assets` collection — picking one tags the job with that
`assetKey` the same as the model's own deep link would. So any job,
however it was raised, can now carry one.

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


## 10. Showing open jobs in the model – rooms first (room layer BUILT)

Section 9 covers *getting* the data. This covers showing it, and the
ordering matters more than it looks.

**Rooms before items.** Only a job raised through the model's own
deep-link/message flow carries an `assetKey` (section 9's "real
limitation"). Every job, however it was raised, carries a **room**. So a
room-level roll-up works against the jobs already in MaintDB today,
while item-level marking would show almost nothing until people have
been using the model to raise jobs for a while. Build the room layer
first; the item layer fills in on its own as asset keys accumulate.

**Built, model side:** a fourth **Open jobs** option on the model's
existing *Colour by* control, alongside Use / Fire zone / AC unit.
Picking it lazily loads the Firebase compat SDK (same 10.13.0 this app
uses), signs in anonymously, subscribes to the whole `jobs` collection
and colours each room by the **worst status currently open in it** –
Open red, Awaiting Parts purple, In Progress amber, nothing neutral
grey. Rooms are matched by room number, or by room name for the spaces
that have no number (plant rooms, stores, the suites). Tapping a room
also adds a line to its info panel: how many are open, the worst
status, and the age of the oldest. The Key panel opens itself in this
mode and reports the connection state, so a failure reads as "could
not reach the tracker" rather than a building with no jobs in it.

Nothing on the MaintDB side is needed for that except **enabling
Anonymous Authentication** in the Firebase console, exactly as section
9 describes. Until that toggle is on, the mode will say the tracker
refused the connection.

Deliberately avoided: recolouring the *items* inside a room close-up.
The model already uses an emissive green tint to mean "you tapped
this", and tinting a light fitting red makes it harder to tell what the
object actually is. When the item layer comes, it should be a small
floating marker above the item, coloured by status, leaving the object
itself alone.

**Not built, and what each needs:**

- **Per-item job lists in the asset sheet.** The asset sheet is already
  the per-entity surface and already carries "Log a job", so the open
  jobs for that item belong directly above that button – job number,
  status, a few words of the issue, age. A separate panel would
  duplicate it. *Needs on the MaintDB side:* a deep link to an
  **existing** job. Today there is only `?new=1&asset=…`; making those
  rows links needs something like `?job=<id>` that opens that job.
- **A floor work list.** "What's outstanding on 5" is a different
  question from "what's wrong with this light" – planning a round
  rather than inspecting one thing – so it does earn its own panel,
  driven off the same snapshot. Worth adding once the room layer has
  proved itself in use.

**The asset-key gap flagged above is now closed (18 Nov 2026)** — see
section 9's update. Jobs logged the normal way in MaintDB can carry an
`assetKey` now, not just model-originated ones, so the item layer
(the per-item job lists bullet above) is worth taking more seriously
than when this section was first written — it should get real data
sooner than "once people have been using the model to raise jobs for
a while" originally assumed.

One thing to be deliberate about, same as section 9: this reads whole
job documents, so issue text and staff names reach the model, not just
a status colour. In practice the model is behind the same Cloudflare
Access allow-list, so it is not a new exposure – but it is a choice,
not an accident.

### The embedded copy cannot do live colours (settled 17 Nov 2026)

The model is also published as a Claude artifact, which is handy for a
quick look on a phone, but that copy runs in a sandboxed frame. It
cannot load the Firebase library from gstatic **and** cannot reach
`firestore.googleapis.com` either – both were probed and both are
blocked. So bundling the SDK into the file would not help, and is not
worth the ~600 KB.

Live job colours are a Cloudflare-site feature only. The embedded copy
says so plainly in the Key panel rather than looking broken. Do not
re-investigate this without re-running the probe first.
