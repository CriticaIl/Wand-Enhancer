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

const NONE = Symbol('none');

/** Deletes SaveForge's records whose key starts with prefix (Reset this game's trainer data). */
export async function clearPrefix(win, prefix) {
  for (const key of [...memory.kv.keys()]) if (key.startsWith(prefix)) memory.kv.delete(key);
  try {
    const keys = (await run(win, 'kv', 'readonly', (s) => s.getAllKeys())) || [];
    const mine = keys.filter((x) => typeof x === 'string' && x.startsWith(prefix));
    if (mine.length) await run(win, 'kv', 'readwrite', (s) => mine.forEach((x) => s.delete(x)));
    return mine.length;
  } catch {
    return 0;
  }
}

/**
 * scope: what the data belongs to. Since 2.3 game data is scoped per GAME (see context.js),
 * not per website. `legacy` (optional): {scope, use: () => Promise<boolean>, skip: Set} — the
 * pre-2.3 per-website scope, read when this game has nothing stored yet and `use()` says this
 * game inherited that data (the first game opened on the site after the update).
 */
export function createStore(win, scope, legacy = null) {
  const k = (name) => `${scope}:${name}`;
  const raw = async (key) => {
    try {
      const v = await run(win, 'kv', 'readonly', (s) => s.get(key));
      return v === undefined ? NONE : v;
    } catch {
      return memory.kv.has(key) ? memory.kv.get(key) : NONE;
    }
  };
  return {
    scope,
    async get(name, fallback) {
      const v = await raw(k(name));
      if (v !== NONE) return v;
      if (legacy && !legacy.skip?.has(name) && (await legacy.use())) {
        const old = await raw(`${legacy.scope}:${name}`);
        if (old !== NONE) return old;
      }
      return fallback;
    },
    /** Deletes everything stored under this scope. Never the game's own saves. */
    clear: () => clearPrefix(win, `${scope}:`),
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
      // backups made before 2.3 were per website: still listed (marked) so they can be restored
      return [...list, ...memory.backups]
        .filter((b) => b.scope === scope || (legacy && b.scope === legacy.scope))
        .map((b) => (b.scope === scope ? b : { ...b, legacy: true }))
        .sort((a, b) => b.savedAt - a.savedAt);
    },
  };
}
