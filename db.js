/* db.js — local IndexedDB persistence layer.
   Everything lives on-device. No network calls. This file is the seam
   where a future sync/server layer would plug in (see notes at bottom). */

const DB_NAME = 'roomJobsDB';
const DB_VERSION = 1;

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains('jobs')){
        const jobStore = db.createObjectStore('jobs', { keyPath: 'id' });
        jobStore.createIndex('room', 'room');
        jobStore.createIndex('status', 'status');
        jobStore.createIndex('area', 'area');
      }
      if(!db.objectStoreNames.contains('rooms')){
        db.createObjectStore('rooms', { keyPath: 'id' });
      }
      if(!db.objectStoreNames.contains('config')){
        db.createObjectStore('config', { keyPath: 'key' });
      }
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

let dbPromise = openDB();

async function tx(storeName, mode){
  const db = await dbPromise;
  return db.transaction(storeName, mode).objectStore(storeName);
}

const DB = {
  // ---- jobs ----
  async getAllJobs(){
    const store = await tx('jobs', 'readonly');
    return new Promise((res, rej)=>{
      const req = store.getAll();
      req.onsuccess = ()=> res(req.result);
      req.onerror = ()=> rej(req.error);
    });
  },
  async putJob(job){
    const store = await tx('jobs', 'readwrite');
    return new Promise((res, rej)=>{
      const req = store.put(job);
      req.onsuccess = ()=> res();
      req.onerror = ()=> rej(req.error);
    });
  },
  async deleteJob(id){
    const store = await tx('jobs', 'readwrite');
    return new Promise((res, rej)=>{
      const req = store.delete(id);
      req.onsuccess = ()=> res();
      req.onerror = ()=> rej(req.error);
    });
  },

  // ---- rooms (configurable list, tagged to an area) ----
  async getAllRooms(){
    const store = await tx('rooms', 'readonly');
    return new Promise((res, rej)=>{
      const req = store.getAll();
      req.onsuccess = ()=> res(req.result);
      req.onerror = ()=> rej(req.error);
    });
  },
  async putRoom(room){
    const store = await tx('rooms', 'readwrite');
    return new Promise((res, rej)=>{
      const req = store.put(room);
      req.onsuccess = ()=> res();
      req.onerror = ()=> rej(req.error);
    });
  },
  async deleteRoom(id){
    const store = await tx('rooms', 'readwrite');
    return new Promise((res, rej)=>{
      const req = store.delete(id);
      req.onsuccess = ()=> res();
      req.onerror = ()=> rej(req.error);
    });
  },

  // ---- config (site name, areas list) ----
  async getConfig(){
    const store = await tx('config', 'readonly');
    return new Promise((res, rej)=>{
      const req = store.get('main');
      req.onsuccess = ()=> res(req.result ? req.result.value : null);
      req.onerror = ()=> rej(req.error);
    });
  },
  async setConfig(value){
    const store = await tx('config', 'readwrite');
    return new Promise((res, rej)=>{
      const req = store.put({ key: 'main', value });
      req.onsuccess = ()=> res();
      req.onerror = ()=> rej(req.error);
    });
  }
};

/* ---------------------------------------------------------------
   FUTURE SYNC HOOK:
   When a backend exists, wrap DB.putJob/putRoom/setConfig to also
   push to the server (with a local outbox + retry for offline use),
   and add a pull-on-launch step before first render. The IndexedDB
   copy stays the source of truth for instant, offline-first reads;
   the server becomes a sync target rather than a dependency.
--------------------------------------------------------------- */

window.DB = DB;
