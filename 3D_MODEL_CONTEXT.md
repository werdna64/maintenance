# 3D Building Model – context for the Maintenance Tracker (MaintDB)

_Last updated: 12 Nov 2026_

This file tells Claude Code working on **MaintDB** (`werdna64/maintenance`) what the 3D building model is, where it lives, and how the two are meant to connect. Put it in the MaintDB repo as `docs/3D_MODEL_CONTEXT.md` and reference it from `CLAUDE.md`.

---

## 1. What the 3D model is

An interactive three.js model of **Leonardo Hotel Sheffield**: 12 levels (Basement, Lower Ground, Ground, 1–9), ~580 spaces, 259 bedrooms, plant rooms, the LG switch room with its distribution boards, AC condensers, doors and fire zones.

- One self-contained page, `index.html` (~1.2 MB). three.js and all building data are inlined; it makes **no network requests**.
- Tap a space → info panel. Fitted-out spaces and every bedroom have a **close-up view** with tappable items (lamps, WC, TV, distribution boards…).
- Tapping an item opens an asset sheet with a **Log a job** button that deep-links into MaintDB (section 4).
- Distribution boards show their circuit chart laid out like the board, with red ON / green OFF breaker flags.

## 2. Where everything lives

| Thing | Location | Visibility |
| --- | --- | --- |
| Model source + built page | GitHub `werdna64/themodel` (branch `main`) | **Private** |
| Live model | `https://themodel-b4w.pages.dev` (Cloudflare Pages, auto-deploys on push to `main`) | Behind **Cloudflare Access** – emailed one-time code, allow-list only |
| MaintDB PWA | GitHub `werdna64/maintenance` → `https://werdna64.github.io/maintenance/` | **Public** |
| Demo copy | Private claude.ai artifact | Owner only |
| Circuit register | Claude Sheets "Leonardo Sheffield – Circuit Register" (`https://claude.ai/artifact/4MU13Te9BFeDpARWA6m8cG`) | Private |
| Full integration brief | Claude Doc "3D Hotel Model ↔ Maintenance Tracker – Integration Brief" (`https://claude.ai/artifact/KdqRXeGMvxjEdvF8nQaQSP`) | Private |

### `werdna64/themodel` layout

```
index.html          built model – what Cloudflare serves
build.sh            rebuilds index.html from src/
requirements.txt    numpy, shapely>=2, trimesh
src/hotel.py        base floor plans and spaces
src/build.py        geometry, doors, fixtures, fit-outs, boards → src/out/viewer_data.json
src/viewer.html     three.js viewer (panels, close-ups, asset sheets, Log-a-job link)
src/make_html.py    injects data + three_bundle.js + build date into index.html
src/three_bundle.js three.js r160 + OrbitControls
```

Rebuild: `pip install -r requirements.txt && ./build.sh`, commit, push. The side panel shows "Model updated <date time>" so you can confirm which build is live.

## 3. Security rules (important)

- **Never copy the model, `viewer_data.json` or any floor geometry into `werdna64/maintenance`.** That repo and its GitHub Pages site are public; the model shows the hotel layout, plant and switch rooms, CCTV positions and fire routes.
- MaintDB itself holds nothing that identifies users or the hotel, so it can stay public.
- Link **to** the model (`https://themodel-b4w.pages.dev`) from MaintDB if wanted; the login protects it.
- Staff access to the model is managed in Cloudflare Zero Trust → Access controls → Policies → **Hotel staff** (Emails list). The main address uses that policy; preview URLs are owner-only.

## 4. Current link from the model into MaintDB (live now)

`src/viewer.html`, `TRACKER_URL = 'https://werdna64.github.io/maintenance/'`. Tapping **Log a job** opens:

```
https://werdna64.github.io/maintenance/?new=1
  &site=Leonardo Hotel Sheffield
  &floor=Fifth                 (Basement | Lower Ground | Ground | First … Ninth)
  &location=Room 505           (or a space name, e.g. "Switch room", "Bar")
  &asset=Bedside lamp          (display name, bracketed suffix stripped)
  &source=3d-model
```

**MaintDB should handle this today:** when `new=1` is present, open the new-job form pre-filled from `site`, `floor`, `location` and `asset`, and record `source=3d-model`. Treat all values as untrusted text.

**Known limitation:** `asset` is not unique (both bedside lamps send "Bedside lamp", and the same name repeats in every room). Fixed by asset keys (section 5).

## 5. Planned changes (see the integration brief for full SQL and payloads)

1. **Asset keys.** Every tappable item gets a stable `assetKey`, format `SITE.FLOOR.LOCATION[.ZONE].ITEM[-N]`, e.g. `SHF.5.R505.BED.LAMP-L`, `SHF.LG.SWITCH-ROOM.DB-HF`, `SHF.LG.SWITCH-ROOM.DB-HF.W10-L2`. Floors: `B`, `LG`, `G`, `1`–`9`, `ROOF`. The model build will export `assets.json` / `assets.csv` to seed MaintDB.
2. **MaintDB schema:** `assets` table (`asset_key` unique, `parent_id` for containment, `room_id` nullable – not every location is a bedroom), `circuits` table (board, way, phase, device, rating, status), `assets.fed_from → circuits` for the electrical supply tree, `jobs.asset_id`, server-assigned `jobs.job_number` (e.g. `SHF-000123`), `jobs.client_request_id` for idempotent offline posts.
3. **Deep link v2:** `?new=1&asset=<assetKey>&source=3d-model` plus the current fields as fallback. Unknown key → still open a pre-filled job and flag "asset not in register"; never fail.
4. **Later:** `POST /api/jobs`, open-jobs endpoints so the model can show items with open jobs in red, and circuit trace endpoints. This needs the model and MaintDB on the same origin behind the same login (e.g. MaintDB front end moved onto the Cloudflare project).

## 6. Open questions for MaintDB

- Which backend/database does MaintDB use, and how does it authenticate? (Brief assumes PostgreSQL.)
- Does `rooms` cover non-bedroom locations, or should assets carry `location` text?
- Should breakers be assets (can have jobs) as well as circuit rows? Brief assumes yes, one-to-one.
- When circuits move into MaintDB, is the Claude Sheets register retired?

## 7. Suggested first task for Claude Code in MaintDB

Implement the `?new=1` deep-link handler (section 4) with the fallback behaviour from section 5.3, so it already accepts an optional `asset` key. No schema change is needed for that step.
