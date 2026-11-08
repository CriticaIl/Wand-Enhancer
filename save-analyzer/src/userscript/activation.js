// Decides whether the userscript should show its launcher on a page, without
// touching the page: no DOM changes, no storage writes, no network.

import { detectLiveEngines, liveLimitations } from '../trainer/engines.js';
import { classifyGlobal } from '../trainer/game-state.js';

const RENPY_DB = '/home/web_user/.renpy';

/**
 * Cheap, side-effect-free check for "this page is probably a game".
 * @returns {Promise<{game: boolean, reason: string}>}
 */
export async function looksLikeGame(win) {
  // 1) a supported engine published its globals
  const engines = safe(() => detectLiveEngines(win, { generic: false }), []);
  if (engines.length) return { game: true, reason: `${engines[0].name} detected` };
  // 2) an engine we know (Ren'Py web, Harlowe, Construct 3, GameMaker)
  const limited = safe(() => liveLimitations(win), []);
  if (limited.length) return { game: true, reason: `${limited[0].name} detected` };
  // 3) a large canvas (most HTML5 games draw into one)
  const doc = win.document;
  const vw = win.innerWidth || 1;
  const vh = win.innerHeight || 1;
  for (const c of doc.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect();
    if (r.width >= 280 && r.height >= 140 && r.width * r.height >= 0.15 * vw * vh) return { game: true, reason: 'game canvas' };
  }
  // 4) a well-known game-state global holding numbers (read-only peek, no getters invoked)
  for (const name of GAME_GLOBALS) {
    const d = safe(() => Object.getOwnPropertyDescriptor(win, name), null);
    if (!d || !('value' in d) || !hasNumbers(d.value)) continue;
    // a portal's `window.game = {title, plays, rating, thumb…}` is page data, not game state
    if (classifyGlobal(name, d.value).kind === 'game') return { game: true, reason: `game state in window.${name}` };
  }
  // 5) Ren'Py web save storage (listing databases does not create one)
  try {
    if (win.indexedDB && typeof win.indexedDB.databases === 'function') {
      const dbs = await win.indexedDB.databases();
      if (dbs.some((d) => d.name === RENPY_DB)) return { game: true, reason: "Ren'Py web saves" };
    }
  } catch {
    /* ignore */
  }
  return { game: false, reason: '' };
}

const GAME_GLOBALS = ['game', 'Game', 'gameState', 'GameState', 'gameData', 'player', 'Player', 'save', 'saveData', 'state', 'world', 'G'];

function hasNumbers(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 2) return false;
  let keys;
  try {
    keys = Object.keys(v).slice(0, 50);
  } catch {
    return false;
  }
  let n = 0;
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !('value' in d)) continue;
    if (typeof d.value === 'number') n++;
    else if (depth < 2 && hasNumbers(d.value, depth + 1)) n++;
    if (n >= 2) return true;
  }
  return false;
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- per-site mode
// Stored in SaveForge's own IndexedDB database on that site, but only once the
// user chooses a mode; ordinary sites never get a database created.

const DB = 'saveforge-trainer';
export const MODES = ['auto', 'always', 'never'];

async function dbExists(win) {
  try {
    if (typeof win.indexedDB.databases !== 'function') return true; // cannot tell; opening is harmless here
    return (await win.indexedDB.databases()).some((d) => d.name === DB);
  } catch {
    return false;
  }
}

function withStore(win, mode, fn) {
  return new Promise((resolve, reject) => {
    const r = win.indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('kv');
      r.result.createObjectStore('backups', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => {
        db.close();
        resolve(req?.result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    r.onerror = () => reject(r.error);
  });
}

export async function getMode(win) {
  try {
    if (!(await dbExists(win))) return 'auto';
    const v = await withStore(win, 'readonly', (s) => s.get('userscript:mode'));
    return MODES.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export async function setMode(win, mode) {
  if (!MODES.includes(mode)) throw new Error(`bad mode ${mode}`);
  try {
    await withStore(win, 'readwrite', (s) => s.put(mode, 'userscript:mode'));
  } catch {
    /* private mode: setting lasts for this page only */
  }
}
