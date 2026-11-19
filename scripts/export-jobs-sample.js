#!/usr/bin/env node
/*
 * scripts/export-jobs-sample.js — pulls a capped, most-recent sample of
 * real job documents from LIVE Firestore into a local JSON file, so the
 * shared dev backend (see README's "Shared dev backend" section) can have
 * realistic-looking job data without jobs ever syncing from live
 * automatically.
 *
 * This is the ONLY tool in this repo that reads jobs from live for dev
 * purposes, and it is meant to be run by hand, occasionally, never on a
 * schedule or in CI: every run costs one live Firestore read per job
 * fetched, taken straight out of the Spark tier's 50k-reads/day budget.
 * --limit keeps that bounded and defaults low on purpose.
 *
 * Always targets live (ignores FIRESTORE_EMULATOR_HOST) — the whole point
 * is to pull FROM live, so there's nothing to guard against here the way
 * import-jobs-sample.js guards against writing TO it.
 *
 * Usage:
 *   node scripts/export-jobs-sample.js [--out jobs-sample.json] [--limit 200] [--service-account key.json]
 */

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv){
  const args = { out: path.join(__dirname, '..', 'jobs-sample.json'), limit: 200, serviceAccountPath: null };
  for(let i = 0; i < argv.length; i++){
    if(argv[i] === '--out') args.out = argv[++i];
    else if(argv[i] === '--limit') args.limit = parseInt(argv[++i], 10);
    else if(argv[i] === '--service-account') args.serviceAccountPath = argv[++i];
  }
  return args;
}

async function main(){
  const { out, limit, serviceAccountPath } = parseArgs(process.argv.slice(2));
  if(!Number.isFinite(limit) || limit <= 0){
    console.error('--limit must be a positive number.');
    process.exit(1);
  }

  const keyPath = serviceAccountPath || path.join(__dirname, '..', 'serviceAccountKey.json');
  if(!fs.existsSync(keyPath)){
    console.error(`Service account key not found: ${keyPath}`);
    process.exit(1);
  }
  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  console.log(`Reading up to ${limit} most-recent live jobs (this costs ${limit} reads against today's quota)...`);
  const snap = await db.collection('jobs').orderBy('createdAt', 'desc').limit(limit).get();
  const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  fs.writeFileSync(out, JSON.stringify(jobs, null, 2));
  console.log(`Wrote ${jobs.length} job(s) to ${out}.`);
  console.log(`Next: node scripts/import-jobs-sample.js ${out}  (run that against the dev emulator, never live)`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
