// Automatic backups of original files, kept in this browser's IndexedDB.
// Falls back to an in-memory list when IndexedDB is unavailable (private mode).

const DB = 'saveforge';
const STORE = 'backups';
const memory = [];
let dbPromise = null;

function open() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('no IndexedDB'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const res = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(res && 'result' in res ? res.result : undefined);
        t.onerror = () => reject(t.error);
      }),
  );
}

async function sha256(bytes) {
  try {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `${bytes.length}-${bytes[0]}-${bytes[bytes.length - 1]}`;
  }
}

/** Stores the original bytes once per distinct file content. */
export async function backupOriginal(name, bytes, engine) {
  const hash = await sha256(bytes);
  const record = { name, bytes, hash, engine, savedAt: Date.now(), size: bytes.length };
  try {
    const all = await listBackups();
    const existing = all.find((b) => b.hash === hash);
    if (existing) return existing;
    const id = await tx('readwrite', (s) => s.add(record));
    const items = await listBackups();
    // keep the 30 most recent
    for (const old of items.slice(30)) await tx('readwrite', (s) => s.delete(old.id));
    return { ...record, id };
  } catch {
    const found = memory.find((b) => b.hash === hash);
    if (found) return found;
    const r = { ...record, id: `mem-${memory.length}`, memoryOnly: true };
    memory.unshift(r);
    return r;
  }
}

export async function listBackups() {
  try {
    const all = await tx('readonly', (s) => s.getAll());
    return [...(all || []), ...memory].sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [...memory];
  }
}

export async function deleteBackup(id) {
  const i = memory.findIndex((b) => b.id === id);
  if (i >= 0) memory.splice(i, 1);
  else await tx('readwrite', (s) => s.delete(id));
}
