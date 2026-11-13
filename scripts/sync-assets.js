#!/usr/bin/env node
/*
 * scripts/sync-assets.js — one-way sync from the 3D hotel model's asset
 * export into this app's Firestore `assets` collection (and a drift
 * report between the two), plus the Rooms each asset implies and the
 * Floors list in config.
 *
 * Admin-only tooling, not part of the deployed app: uses a Firebase
 * service account key (full read/write, bypasses firestore.rules
 * entirely), never the public firebase-config.js the app itself uses.
 * See README's "3D model integration" section for full setup and the
 * exact assets.json field contract.
 *
 * Diff-and-batch, not read-then-write-per-item: the whole existing
 * `assets`/`rooms` state is read once, compared in memory against the
 * incoming file, and only the rows that actually changed are written,
 * in Firestore batches (<=500 writes each). A rerun against unchanged
 * data costs two collection reads and zero writes — safe to retry as
 * often as needed, and immune to the old version's failure mode where
 * every restart replayed a get()+set() for every already-synced item
 * from position zero, multiplying total Firestore operations with
 * each retry until it blew through the daily quota.
 *
 * Setup (once):
 *   1. Firebase console -> Project settings -> Service accounts ->
 *      Generate new private key. Save the downloaded file as
 *      serviceAccountKey.json in this repo's root (already gitignored
 *      — never commit it).
 *   2. npm install
 *
 * Usage:
 *   node scripts/sync-assets.js path/to/assets.json
 *   node scripts/sync-assets.js path/to/assets.json --service-account other-key.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

function uid(prefix){
  return prefix + Date.now() + Math.random().toString(36).slice(2, 7);
}

function parseArgs(argv){
  const args = { assetsPath: null, serviceAccountPath: null };
  for(let i = 0; i < argv.length; i++){
    if(argv[i] === '--service-account'){
      args.serviceAccountPath = argv[++i];
    } else if(!args.assetsPath){
      args.assetsPath = argv[i];
    }
  }
  return args;
}

function loadJson(filePath, label){
  if(!fs.existsSync(filePath)){
    console.error(`${label} not found: ${filePath}`);
    process.exit(1);
  }
  try{
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }catch(e){
    console.error(`${label} isn't valid JSON (${filePath}): ${e.message}`);
    process.exit(1);
  }
}

// Fields that actually describe the asset — active/floorLevel etc. are
// compared explicitly alongside these, so a doc is only rewritten when
// something a human would call "changed" actually did.
const ASSET_FIELDS = ['floorLevel', 'floorName', 'room', 'kind', 'zone', 'name', 'type', 'parentKey'];

function sameAsset(existing, incoming){
  if(!existing) return false;
  if(existing.active === false) return false; // reactivating always counts as a change
  return ASSET_FIELDS.every(f => (existing[f] ?? null) === (incoming[f] ?? null));
}

async function commitInChunks(db, ops){
  // ops: array of {type:'set'|'update', ref, data}
  let committed = 0;
  for(let i = 0; i < ops.length; i += 500){
    const batch = db.batch();
    for(const op of ops.slice(i, i + 500)){
      if(op.type === 'set') batch.set(op.ref, op.data);
      else batch.update(op.ref, op.data);
    }
    await batch.commit();
    committed += Math.min(500, ops.length - i);
  }
  return committed;
}

async function main(){
  const { assetsPath, serviceAccountPath } = parseArgs(process.argv.slice(2));
  if(!assetsPath){
    console.error('Usage: node scripts/sync-assets.js <assets.json> [--service-account <key.json>]');
    process.exit(1);
  }

  const keyPath = serviceAccountPath || path.join(__dirname, '..', 'serviceAccountKey.json');
  const serviceAccount = loadJson(keyPath, 'Service account key');

  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const items = loadJson(assetsPath, 'Assets file');
  if(!Array.isArray(items)){
    console.error('Assets file must be a JSON array of asset objects.');
    process.exit(1);
  }

  console.log(`Loading current Firestore state (one read each, not per item)...`);
  const [assetsSnap, roomsSnap, configSnap] = await Promise.all([
    db.collection('assets').get(),
    db.collection('rooms').get(),
    db.collection('config').doc('main').get()
  ]);

  // A room's number/name is only unique within its own floor — most
  // spaces appear on exactly one floor so this never matters, but a
  // handful (the Duke Lane / Eyre Lane elevation columns) legitimately
  // exist on several floors under the same name, so the lookup key
  // has to include the floor too or later floors silently clobber it.
  const roomKey = (number, floorLevel) => number + '|' + floorLevel;
  const existingAssetsByKey = new Map(assetsSnap.docs.map(d => [d.id, d.data()]));
  const roomsByNumber = new Map(roomsSnap.docs.map(d => [roomKey(d.data().number, d.data().floorLevel), d.data()]));
  const config = configSnap.exists ? configSnap.data() : {};
  const existingFloors = Array.isArray(config.floors) ? config.floors : [];

  console.log(`  ${existingAssetsByKey.size} existing assets, ${roomsByNumber.size} existing rooms`);

  const seenKeys = new Set();
  const seenFloors = new Map(); // level -> name
  const ops = [];
  let created = 0, updated = 0, unchanged = 0, skipped = 0;
  let roomsCreated = 0, roomsUpdated = 0;

  for(const item of items){
    const { assetKey, floorLevel, floorName, room, kind, zone, name, type, parentKey, active } = item || {};
    if(!assetKey || floorLevel == null || !floorName || !room || !name){
      console.warn(`Skipping item missing assetKey/floorLevel/floorName/room/name: ${JSON.stringify(item)}`);
      skipped++;
      continue;
    }
    seenKeys.add(assetKey);
    seenFloors.set(floorLevel, floorName);

    const rKey = roomKey(room, floorLevel);
    const existingRoom = roomsByNumber.get(rKey);
    if(!existingRoom){
      const newRoom = { id: uid('r'), number: room, floorLevel, floorName };
      ops.push({ type: 'set', ref: db.collection('rooms').doc(newRoom.id), data: newRoom });
      roomsByNumber.set(rKey, newRoom);
      roomsCreated++;
    } else if(existingRoom.floorName !== floorName){
      // floorLevel can't differ — it's part of the lookup key — but the
      // model could rename a floor (f.name) without changing its level.
      ops.push({ type: 'update', ref: db.collection('rooms').doc(existingRoom.id), data: { floorName } });
      existingRoom.floorName = floorName;
      roomsUpdated++;
    }

    const incoming = { assetKey, floorLevel, floorName, room, kind: kind || null, zone: zone || null, name, type: type || 'other', parentKey: parentKey || null, active: active !== false };
    const existing = existingAssetsByKey.get(assetKey);
    if(sameAsset(existing, incoming)){
      unchanged++;
      continue;
    }
    ops.push({ type: 'set', ref: db.collection('assets').doc(assetKey), data: incoming });
    existingAssetsByKey.set(assetKey, incoming);
    if(existing) updated++; else created++;
  }

  // Drift: assets this run's file didn't mention at all — left alone
  // rather than deleted (any job already logged against that key keeps
  // its link), but flagged inactive and printed so they can be
  // investigated. Reuses the collection read from the top of this run
  // instead of a second full scan at the end.
  const staleKeys = [];
  let deactivated = 0;
  for(const [key, data] of existingAssetsByKey){
    if(seenKeys.has(key)) continue;
    staleKeys.push(key);
    if(data.active !== false){
      ops.push({ type: 'update', ref: db.collection('assets').doc(key), data: { active: false } });
      data.active = false;
      deactivated++;
    }
  }

  // Floors list in config, derived entirely from what was just synced —
  // nothing here is hand-typed, so it can never drift from the model.
  const mergedFloors = new Map(existingFloors.map(f => [f.level, f.name]));
  for(const [level, name] of seenFloors) mergedFloors.set(level, name);
  const newFloors = [...mergedFloors.entries()].map(([level, name]) => ({ level, name })).sort((a, b) => a.level - b.level);
  const floorsChanged = JSON.stringify(newFloors) !== JSON.stringify(existingFloors);
  if(floorsChanged){
    // update(), not set() — config/main also holds siteName, siteCode,
    // departments, modelUrl, etc. and must not be clobbered.
    ops.push({ type: 'update', ref: db.collection('config').doc('main'), data: { floors: newFloors } });
  }

  console.log(`Writing ${ops.length} change(s) in batches of up to 500...`);
  await commitInChunks(db, ops);

  console.log('');
  console.log(`Assets:  ${created} created, ${updated} updated, ${unchanged} unchanged, ${skipped} skipped (missing fields)`);
  console.log(`Rooms:   ${roomsCreated} created, ${roomsUpdated} updated`);
  console.log(`Floors:  ${floorsChanged ? 'updated (' + newFloors.length + ' total)' : 'unchanged (' + newFloors.length + ' total)'}`);
  if(staleKeys.length){
    console.log(`\nIn Firestore but not in this file (marked inactive, not deleted — ${deactivated} newly so):`);
    staleKeys.forEach(k => console.log(`  ${k}`));
  } else {
    console.log('\nNo stale asset keys — model and database match.');
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
