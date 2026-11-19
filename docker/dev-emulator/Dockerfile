# Persistent host for the shared dev Firebase emulator (Firestore + Auth) —
# see README's "Shared dev backend" section. Not used by the deployed app,
# CI, or production in any way; this only runs on whatever machine you
# choose to host dev/test data on (e.g. a home-LAN box, later maybe IT
# department kit — it's just Node + a JRE, so it'll run anywhere Docker does).

FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jre-headless \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g firebase-tools@13

WORKDIR /app
COPY firebase.json .firebaserc firestore.rules ./
COPY docker/dev-emulator/entrypoint.sh ./

EXPOSE 8080 9099 4000
ENTRYPOINT ["./entrypoint.sh"]
