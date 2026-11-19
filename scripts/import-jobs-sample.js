#!/usr/bin/env node
/*
 * scripts/import-jobs-sample.js — writes a jobs-sample.json (produced by
 * export-jobs-sample.js) into Firestore. See README's "Shared dev backend"
 * section.
 *
 * Refuses to run unless FIRESTORE_EMULATOR_HOST is set — this script only
 * ever writes to an emulator, never to live, so there's no path from
 * "seed some test data" to "overwrite real jobs". Run it on whichever
 * machine hosts the dev emulator, pointed at its own localhost:8080, not
 * through the Cloudflare Tunnel.
 *
 * Usage:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/import-jobs-sample.js jobs-sample.json
 */

'use strict';

const fs = require('fs');

async function main(){
  if(!process.env.FIRESTORE_EMULATOR_HOST){
    console.error('Refusing to run without FIRESTORE_EMULATOR_HOST set — this script only ever writes to an emulator.');
    console.error('Example: FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/import-jobs-sample.js jobs-sample.json');
    process.exit(1);
  }
  const file = process.argv[2];
  if(!file || !fs.existsSync(file)){
    console.error('Usage: FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/import-jobs-sample.js <jobs-sample.json>');
    process.exit(1);
  }
  const jobs = JSON.parse(fs.readFileSync(file, 'utf8'));
  if(!Array.isArray(jobs)){
    console.error('Expected a JSON array of job objects (from export-jobs-sample.js).');
    process.exit(1);
  }

  const admin = require('firebase-admin');
  admin.initializeApp({ projectId: 'hotel-maintenance-8c8b0' });
  const db = admin.firestore();

  for(let i = 0; i < jobs.length; i += 500){
    const batch = db.batch();
    for(const job of jobs.slice(i, i + 500)){
      const { id, ...data } = job;
      batch.set(db.collection('jobs').doc(id), data);
    }
    await batch.commit();
  }
  console.log(`Imported ${jobs.length} job(s) into the emulator at ${process.env.FIRESTORE_EMULATOR_HOST}.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
