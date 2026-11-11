#!/usr/bin/env node
/*
 * scripts/sync-assets.js — one-way sync from the 3D hotel model's asset
 * export into this app's Firestore `assets` collection (and a drift
 * report between the two), plus the Rooms/Areas each asset implies.
 *
 * Admin-only tooling, not part of the deployed app: uses a Firebase
 * service account key (full read/write, bypasses firestore.rules
 * entirely), never the public firebase-config.js the app itself uses.
 * See README's "3D model integration" section for full setup and the
 * exact assets.json field contract.
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

  const seenKeys = new Set();
  let created = 0, updated = 0, skipped = 0;
  let roomsCreated = 0, roomsUpdated = 0, areasAdded = 0;

  // Config (the areas list) is one doc — read once, mutate in memory,
  // write once at the end rather than on every single asset.
  const configRef = db.collection('config').doc('main');
  const configSnap = await configRef.get();
  const config = configSnap.exists ? configSnap.data() : { areas: [] };
  if(!Array.isArray(config.areas)) config.areas = [];
  let configChanged = false;

  // Same reasoning for rooms — load the current list once rather than a
  // get() per asset (this hotel has ~580 spaces; 580 extra reads would
  // be slow for no benefit).
  const roomsSnap = await db.collection('rooms').get();
  const roomsByNumber = new Map(roomsSnap.docs.map(d => [d.data().number, d.data()]));

  for(const item of items){
    const { assetKey, area, room, name, type, parentKey, active } = item || {};
    if(!assetKey || !area || !room || !name){
      console.warn(`Skipping item missing assetKey/area/room/name: ${JSON.stringify(item)}`);
      skipped++;
      continue;
    }
    seenKeys.add(assetKey);

    const existingRoom = roomsByNumber.get(room);
    if(!existingRoom){
      const newRoom = { id: uid('r'), number: room, area };
      await db.collection('rooms').doc(newRoom.id).set(newRoom);
      roomsByNumber.set(room, newRoom);
      roomsCreated++;
    } else if(existingRoom.area !== area){
      await db.collection('rooms').doc(existingRoom.id).update({ area });
      existingRoom.area = area;
      roomsUpdated++;
    }

    if(!config.areas.includes(area)){
      config.areas.push(area);
      configChanged = true;
      areasAdded++;
    }

    const assetRef = db.collection('assets').doc(assetKey);
    const assetSnap = await assetRef.get();
    await assetRef.set({
      assetKey, area, room, name,
      type: type || 'other',
      parentKey: parentKey || null,
      active: active !== false
    });
    if(assetSnap.exists) updated++; else created++;
  }

  if(configChanged){
    await configRef.set(config, { merge: true });
  }

  // Drift report: assets already in Firestore that this run's file
  // didn't mention at all — left alone rather than deleted (so any job
  // already logged against that key keeps its link), but flagged
  // inactive and printed so they can be investigated.
  const existingAssetsSnap = await db.collection('assets').get();
  let deactivated = 0;
  const staleKeys = [];
  for(const doc of existingAssetsSnap.docs){
    if(seenKeys.has(doc.id)) continue;
    const data = doc.data();
    if(data.active !== false){
      await doc.ref.update({ active: false });
      deactivated++;
    }
    staleKeys.push(doc.id);
  }

  console.log('');
  console.log(`Assets:  ${created} created, ${updated} updated, ${skipped} skipped (missing fields)`);
  console.log(`Rooms:   ${roomsCreated} created, ${roomsUpdated} updated`);
  console.log(`Areas:   ${areasAdded} added`);
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
