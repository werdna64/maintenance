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
| Deep link `?new=1&asset=…&floor&location&name&source=3d-model` with fallback | **Done** (app.js deep-link handler) | Sends `new, site, floor, location, asset, source`. `asset` is currently the **display name**, not a key, and `name` is not sent → every job lands as "not in asset register" with fallback text. **To do.** |
| `assets` collection keyed by `assetKey` | **Done** (rules + `scripts/sync-assets.js`) | Unique `assetKey` per tappable item and an `assets.json` export – **to do** |
| Job numbers `SHF-000123` | **Done** (`counters/jobs` transaction; prefix in Settings → Site) | n/a |
| "3D Model" tile on Home | **Done** – needs the URL pasted into Settings → Site → 3D model link | Live at `https://themodel-b4w.pages.dev` |
| Circuits / breakers, supply tracing | Not started | Board charts exist in the model; register in Claude Sheets |
| Live open-job status in the model | Not started (needs the model to read Firestore) | Not started |

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

1. What are MaintDB's exact Area names and Room naming (e.g. `5th Floor` / `505`, and for non-bedrooms like the switch room or bar)? The model's export must use them verbatim.
2. Should breakers become assets (so a job can be logged against "DB-HF way 10 L2")? If so, `parentKey` = the board's key. Circuit tracing beyond that is a separate future data model.
3. Which department should "3D Model" jobs map to – add a **3D Model** department in Settings, or leave blank?

## 7. Next steps

- **Model side (done in the 3D model chat / `themodel` repo):** add `assetKey` to every tappable item, send `asset=<key>` and `name=<label>` in the Log-a-job link, and export `assets.json` to the contract above.
- **MaintDB side:** paste `https://themodel-b4w.pages.dev` into Settings → Site → 3D model link; once `assets.json` exists, run `scripts/sync-assets.js` and check the drift report. No code change needed for either.
