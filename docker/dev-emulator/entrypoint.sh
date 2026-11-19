#!/bin/sh
set -e
mkdir -p /data

# --import errors out if the directory has no prior export in it (e.g. the
# very first run against a fresh volume), so only pass it once there's
# something to import.
if [ -f /data/firebase-export-metadata.json ]; then
  exec firebase emulators:start --only firestore,auth --import=/data --export-on-exit=/data
else
  exec firebase emulators:start --only firestore,auth --export-on-exit=/data
fi
