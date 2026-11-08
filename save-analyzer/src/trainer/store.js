// Trainer persistence on the host page: favourites, recents and backups.
// Uses a *separate* IndexedDB database ("saveforge-trainer") so the game's own
// localStorage/IndexedDB data is never touched by bookkeeping. Falls back to
// memory when IndexedDB is unavailable.

const DB = 'saveforge-trainer';
const memory = { kv: new Map(), backups: [] };

function open(win) {
  return new Promise((resolve, reject) => {
    let r;
    try {
      r = win.indexedDB.open(DB, 1);
    } catch (e) {
      reject(e);
      return;
    }
    r.onupgradeneeded = () => {
      r.result.createObjectStore('kv');
      r.result.createObjectStore('backups', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function run(win, store, mode, fn) {
  const db = await open(win);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function createStore(win, scope) {
  const k = (name) => `${scope}:${name}`;
  return {
    async get(name, fallback) {
      try {
        const v = await run(win, 'kv', 'readonly', (s) => s.get(k(name)));
        return v === undefined ? fallback : v;
      } catch {
        return memory.kv.has(k(name)) ? memory.kv.get(k(name)) : fallback;
      }
    },
    async set(name, value) {
      try {
        await run(win, 'kv', 'readwrite', (s) => s.put(value, k(name)));
      } catch {
        memory.kv.set(k(name), value);
      }
    },
    async addBackup(record) {
      const r = { ...record, scope, savedAt: Date.now() };
      try {
        const id = await run(win, 'backups', 'readwrite', (s) => s.add(r));
        const all = await this.backups();
        for (const old of all.slice(20)) await run(win, 'backups', 'readwrite', (s) => s.delete(old.id));
        return { ...r, id };
      } catch {
        const m = { ...r, id: `mem-${memory.backups.length}`, memoryOnly: true };
        memory.backups.unshift(m);
        return m;
      }
    },
    async backups() {
      let list = [];
      try {
        list = (await run(win, 'backups', 'readonly', (s) => s.getAll())) || [];
      } catch {
        /* memory only */
      }
      return [...list, ...memory.backups].filter((b) => b.scope === scope).sort((a, b) => b.savedAt - a.savedAt);
    },
  };
}
