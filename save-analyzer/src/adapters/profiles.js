// Engine profiles: identify which game engine produced a decoded save, add
// engine-specific labels/categories, and explain how to re-import the file.
//
// Detection is structural (keys/classes actually present in the decoded data),
// never by file name alone. A profile only adds presentation; parsing and
// rebuilding always go through the generic pipeline.

import { walk } from '../core/model.js';

export const kindOf = (n) => (n.type === 'embedded' ? n.meta.innerType : n.type);
// Detectors run for every ancestor of every variable, so results are memoized per node
// (otherwise large saves are O(n²)).
const memo = (fn) => {
  const cache = new WeakMap();
  return (n) => {
    if (!n || typeof n !== 'object') return false;
    let v = cache.get(n);
    if (v === undefined) {
      v = fn(n);
      cache.set(n, v);
    }
    return v;
  };
};
const childKeys = memo((n) => new Set((n.children || []).map((c) => c.key)));
const child = (n, key) => (n.children || []).find((c) => c.key === key);

// ---------------------------------------------------------------- region detectors
// A region is a subtree with engine-specific meaning. Regions work at any depth,
// so a Ren'Py save inside a browser-storage dump is still recognised.

export const isRenpyRoots = memo((n) => {
  if (kindOf(n) !== 'dict' || !n.children || n.children.length < 1) return false;
  let store = 0;
  for (const c of n.children) if (c.key.startsWith('store.') || c.key === 'store') store++;
  return store / n.children.length > 0.6;
});

export const isRenpyLogTuple = memo((n) => {
  return kindOf(n) === 'tuple' && n.children && n.children.length === 2 && isRenpyRoots(n.children[0]);
});

export const isRenpyPersistent = memo((n) => {
  return kindOf(n) === 'instance' && /(^|\.)Persistent$/.test(n.meta.className || '');
});

export const isRpgMakerSave = memo((n) => {
  if (kindOf(n) !== 'object' || !n.children) return false;
  const k = childKeys(n);
  return k.has('system') && k.has('party') && k.has('actors') && (k.has('switches') || k.has('variables'));
});

export const isSugarCubeSave = memo((n) => {
  if (kindOf(n) !== 'object') return false;
  const state = child(n, 'state');
  if (!state || !state.children) return false;
  const k = childKeys(state);
  return (k.has('history') || k.has('delta')) && (k.has('index') || k.has('delta'));
});

export const isConstructSave = memo((n) => {
  if (kindOf(n) !== 'object') return false;
  const k = childKeys(n);
  return k.has('c2save') || k.has('c3save') || (k.has('rt') && k.has('types') && k.has('layouts'));
});

export const isStorageDump = memo((n) => {
  if (kindOf(n) !== 'object') return false;
  const f = child(n, 'format');
  return !!f && f.value === 'saveforge-storage-dump';
});

// ---------------------------------------------------------------- engine identification

export function identifyEngine(doc) {
  const root = doc.root;
  const found = new Set();
  let renpyVersion = null;
  walk(root, (n) => {
    if (isRenpyLogTuple(n)) found.add('renpy-save');
    else if (isRenpyPersistent(n)) found.add('renpy-persistent');
    else if (isRpgMakerSave(n)) found.add('rpgmaker');
    else if (isSugarCubeSave(n)) found.add('sugarcube');
    else if (isConstructSave(n)) found.add('construct');
    if (n.key === 'renpy_version' && typeof n.value === 'string') renpyVersion = n.value.trim();
  });
  const enc = doc.chain.describe();
  const top = root;

  if (isStorageDump(top)) {
    const origin = child(top, 'origin');
    return {
      id: 'storage-dump',
      name: 'Browser storage export',
      details: [`Captured from ${origin ? origin.value : 'unknown origin'}`, ...[...found].map((f) => `Contains: ${ENGINE_NAMES[f]}`)],
      importGuide: GUIDES['storage-dump'],
    };
  }
  if (found.has('renpy-save')) {
    return {
      id: 'renpy-save',
      name: "Ren'Py save slot",
      details: [renpyVersion ? `Written by ${renpyVersion.replace(/^Ren'Py\s*/i, "Ren'Py ")}` : "Ren'Py version not recorded", ...zipDetails(root)],
      importGuide: GUIDES['renpy-save'],
    };
  }
  if (found.has('renpy-persistent')) {
    return { id: 'renpy-persistent', name: "Ren'Py persistent data", details: [enc], importGuide: GUIDES['renpy-persistent'] };
  }
  if (found.has('rpgmaker')) {
    const mz = /zlib/.test(enc) && !/LZString/.test(enc);
    return {
      id: mz ? 'rpgmaker-mz' : 'rpgmaker-mv',
      name: mz ? 'RPG Maker MZ save' : 'RPG Maker MV save',
      details: [enc],
      importGuide: GUIDES[mz ? 'rpgmaker-mz' : 'rpgmaker-mv'],
    };
  }
  if (found.has('sugarcube')) return { id: 'sugarcube', name: 'SugarCube (Twine) save', details: [enc], importGuide: GUIDES.sugarcube };
  if (found.has('construct')) return { id: 'construct', name: 'Construct-style saveState (heuristic)', details: [enc], importGuide: GUIDES.generic };
  if (doc.chain.terminal.kind === 'ini') return { id: 'ini', name: 'INI save (e.g. GameMaker)', details: [enc], importGuide: GUIDES.ini };
  if (doc.chain.terminal.kind === 'pickle') return { id: 'pickle', name: 'Python pickle data', details: [enc], importGuide: GUIDES.generic };
  return { id: 'generic', name: 'Generic structured save', details: [enc], importGuide: GUIDES.generic };
}

function zipDetails(root) {
  if (root.type !== 'zip') return [];
  return root.children.map((c) => `${c.key}: ${c.meta.encoding || (c.type === 'bytes' ? `binary, ${c.meta.size} bytes (kept unchanged)` : c.type === 'string' ? 'text' : c.type)}`);
}

const ENGINE_NAMES = {
  'renpy-save': "Ren'Py save slot",
  'renpy-persistent': "Ren'Py persistent data",
  rpgmaker: 'RPG Maker MV/MZ save',
  sugarcube: 'SugarCube save',
  construct: 'Construct saveState',
};

// ---------------------------------------------------------------- engine-specific classification

const RENPY_INTERNAL = /^(_|renpy|config|persistent$|nvl_|gui$|layout$|preferences$|achievement$|build$|director$|iap$|updater$|define$|ui$|im$|anim$|audio$|theme$|store$|library$|python_dict$|sv$|bubble$)/;

/**
 * Engine-specific labelling for a leaf. Returns {category, label, hidden, note} or null.
 * `parents` is the list of ancestors from the root.
 */
export function classifyByEngine(node, parents) {
  // Ren'Py save-slot metadata files next to `log`
  const zipIdx = parents.findLastIndex((p) => p.type === 'zip' || (p.type === 'embedded' && p.meta.innerType === 'zip'));
  if (zipIdx >= 0 && (parents[zipIdx].children || []).some((c) => c.key === 'log' && c.type === 'embedded')) {
    const entry = parents[zipIdx + 1] || node;
    if (entry.key === 'signatures' || entry.key === 'renpy_version') return { hidden: true, category: 'internal' };
    if (entry.key === 'extra_info' && entry === node) return { category: 'text', label: 'Save slot name (extra_info)' };
    if (entry.key === 'json') {
      if (node.key === '_save_name') return { category: 'text', label: 'Save slot name (json)' };
      if (node.key === '_game_runtime') return { category: 'time', label: 'Playtime (seconds)' };
      return { hidden: true, category: 'internal' };
    }
  }
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i];
    if (isRenpyLogTuple(p)) {
      // Everything outside the roots dict is the rollback log: internal.
      const roots = p.children[0];
      if (parents[i + 1] !== roots && node !== roots) return { hidden: true, category: 'internal' };
      const top = parents[i + 2] || node;
      const name = top.key.replace(/^store\./, '');
      if (RENPY_INTERNAL.test(name)) return { hidden: true, category: 'internal' };
      if (top === node) return { label: name, scope: "Ren'Py store", path: `store.${name}` };
      const rel = relLabel(node, parents.slice(i + 3));
      return { label: `${name} › ${rel}`, scope: "Ren'Py store", path: `store.${name} › ${rel}` };
    }
    if (isRenpyPersistent(p)) {
      const top = parents[i + 1] || node;
      if (/^_/.test(top.key)) return { hidden: true, category: 'internal' };
      return { label: `persistent.${top === node ? node.key : `${top.key} › ${relLabel(node, parents.slice(i + 2))}`}`, scope: "Ren'Py persistent" };
    }
    if (isRpgMakerSave(p)) {
      if (node.key === '@c') return { hidden: true, category: 'internal' };
      return rpgMaker(node, parents.slice(i + 1).filter((c) => c.key !== '@a'));
    }
    if (isSugarCubeSave(p)) return sugarCube(node, parents.slice(i + 1));
    if (isStorageDump(p)) {
      const top = parents[i + 1] || node;
      if (top === node || top.key !== 'localStorage') {
        // dump metadata and IndexedDB bookkeeping (keys, timestamps, modes)
        if (top.key !== 'indexedDB' || !parents.some((x) => x.key === 'value') || ['timestamp', 'mode', '$type'].includes(node.key)) {
          return { hidden: true, category: 'internal' };
        }
      }
      return null;
    }
  }
  return null;
}

/** Marks structural fields that must never be edited (engine bookkeeping). */
export function lockStructuralFields(root) {
  walk(root, (n, parents) => {
    if (n.key === '@c' && n.type === 'int' && parents.some(isRpgMakerSave)) {
      n.editable = false;
      n.meta.readOnlyReason = 'RPG Maker JsonEx object id (editing it would break the save).';
    }
    if (parents.length === 1 && isStorageDump(parents[0]) && ['format', 'version', 'origin', 'exportedAt'].includes(n.key)) {
      n.editable = false;
      n.meta.readOnlyReason = 'Storage Bridge header (used to check the import target).';
    }
    const di = parents.findIndex(isStorageDump);
    if (di >= 0 && parents[di + 1] && parents[di + 1].key === 'indexedDB' && !parents.slice(di + 2).some((p) => p.key === 'value') && n.editable) {
      n.editable = false;
      n.meta.readOnlyReason = 'IndexedDB database/store/key names decide where data is written back.';
    }
    if (n.key === '$type' && parents.length && parents.some(isStorageDump)) {
      n.editable = false;
      n.meta.readOnlyReason = 'Storage Bridge type tag.';
    }
  });
}

function relLabel(node, chain) {
  return [...chain.map((c) => c.key), node.key].join(' › ');
}

function nameOf(n) {
  const c = (n.children || []).find((x) => (x.key === '_name' || x.key === 'name') && x.type === 'string' && x.value);
  return c ? c.value : null;
}

function rpgMaker(node, chain) {
  const keys = chain.map((c) => c.key);
  const top = keys[0] || node.key;
  if (top === 'party' && node.key === '_gold') return { category: 'currency', label: 'Gold' };
  if (top === 'party' && ['_items', '_weapons', '_armors'].includes(keys[1])) {
    const kind = { _items: 'Item', _weapons: 'Weapon', _armors: 'Armor' }[keys[1]];
    return { category: 'inventory', label: `${kind} #${node.key}`, note: 'Item names live in the game database (data/*.json), not in the save.' };
  }
  if (top === 'variables' && keys[1] === '_data') return { category: 'variables', label: `Variable #${node.key}`, group: 'RPG Maker variables' };
  if (top === 'switches' && keys[1] === '_data') return { category: 'flags', label: `Switch #${node.key}`, group: 'RPG Maker switches' };
  if (top === 'selfSwitches') return { category: 'flags', label: `Self switch ${node.key}` };
  if (top === 'actors' && keys[1] === '_data' && chain[2]) {
    const actor = nameOf(chain[2]) || `Actor #${keys[2]}`;
    const map = { _hp: 'HP', _mp: 'MP', _tp: 'TP', _level: 'Level', _name: 'Name', _nickname: 'Nickname', _profile: 'Profile' };
    if (keys[3] === '_exp') return { category: 'progression', label: `${actor} · EXP (class ${node.key})` };
    if (keys[3] === '_paramPlus') return { category: 'stats', label: `${actor} · ${['Max HP', 'Max MP', 'ATK', 'DEF', 'MAT', 'MDF', 'AGI', 'LUK'][+node.key] || `Param ${node.key}`} bonus` };
    if (chain.length === 3 && map[node.key]) return { category: node.key === '_level' ? 'progression' : node.key.match(/_(hp|mp|tp)/) ? 'stats' : 'other', label: `${actor} · ${map[node.key]}` };
    return { label: `${actor} · ${[...chain.slice(3).map((c) => c.key), node.key].map((k) => k.replace(/^_/, '')).join(' › ')}` };
  }
  if (top === 'system' && /^_(saveCount|battleCount|winCount|escapeCount|playtime|framesOnSave)$/.test(node.key)) return { category: 'progression', label: `System ${node.key.slice(1)}` };
  if (top === 'map' || top === 'player' || top === 'screen' || top === 'timer' || top === 'system') return { hidden: true, category: 'internal' };
  return null;
}

function sugarCube(node, chain) {
  const keys = chain.map((c) => c.key);
  // state.history[i].variables.X  or state.delta[0].variables.X
  const vi = keys.indexOf('variables');
  if (keys[0] === 'state' && vi >= 0) {
    const moment = keys[2];
    const rest = keys.slice(vi + 1);
    return { label: `$${[...rest, node.key].join('.')}`, scope: `${keys[1]}[${moment}]`, path: `State.variables.${[...rest, node.key].join('.')}` };
  }
  return { hidden: true, category: 'internal' };
}

// ---------------------------------------------------------------- import guides

const GUIDES = {
  'renpy-save': [
    'Desktop: quit the game, then copy the downloaded file over the original slot file (same name, e.g. 1-1-LT1.save) in the game\'s saves folder. Ren\'Py keeps saves both in <game>/game/saves/ and in the per-user folder (Windows: %APPDATA%\\RenPy\\<game-id>, macOS: ~/Library/RenPy/<game-id>, Linux: ~/.renpy/<game-id>). Replace the copy in the per-user folder, or delete it, so the newer one is not synced back.',
    "Ren'Py 8.1+ signs saves. Because the log changed, the signature is removed: when loading, Ren'Py asks once whether you trust this save. Answer Yes. (Web builds skip this check.)",
    'Web port: use the Storage Bridge bookmarklet in the Game tab to export the game\'s IndexedDB, edit it here, then import the edited export with the same bookmarklet and reload the game page.',
  ],
  'renpy-persistent': [
    "Copy the file back as `persistent` in the same folder it came from, with the game closed.",
    "Ren'Py 8.1+ verifies a signature appended to persistent data. A modified, signed persistent file would be silently discarded by the game, so editing is disabled for signed files.",
  ],
  'rpgmaker-mv': [
    'Desktop/NW.js: replace the file in <game>/www/save/ (e.g. file1.rpgsave) with the game closed.',
    'Browser: MV stores saves in localStorage as "RPG File1" etc. Use the Storage Bridge bookmarklet to export, edit, and import.',
    'Only existing entries can be changed. Items you never owned have no entry in the save and cannot be added safely.',
  ],
  'rpgmaker-mz': [
    'Desktop: replace the file in <game>/save/ (e.g. file1.rmmzsave) with the game closed.',
    'Browser: MZ stores saves in IndexedDB/localforage. Use the Storage Bridge bookmarklet to export, edit, and import.',
  ],
  sugarcube: [
    'Open the game, open Saves, choose "Load from disk" (or "Import"), and pick the downloaded .save file.',
    'SugarCube restores the moment that was active when you saved. If the history has several moments, edit the one marked as the current index.',
  ],
  'storage-dump': [
    'Open the game page in Safari, run the Storage Bridge "Import" bookmarklet, choose the downloaded file, then reload the page.',
    'Import writes only the keys contained in this file, for the origin it was exported from.',
  ],
  ini: ['Replace the .ini file in the game\'s save folder (GameMaker: %LOCALAPPDATA%\\<game>) with the game closed.'],
  generic: [
    'Use the game\'s own "Import save" feature if it has one, or replace the original file with the downloaded file (same name) while the game is closed.',
    'For browser games that keep saves in localStorage/IndexedDB, use the Storage Bridge bookmarklet in the Game tab.',
  ],
};
