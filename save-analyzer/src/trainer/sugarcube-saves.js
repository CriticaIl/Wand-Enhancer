// SugarCube saves, edited the way the game reads them.
//
// How SugarCube 2 keeps a playthrough (and why "Apply & Reload" can revert an edit):
//   - the running playthrough lives in sessionStorage ("<prefix>.state", written on
//     every passage). A page reload RESUMES that session state.
//   - saves (autosave, slots) live in localStorage. They are used only when the
//     player loads one from the Saves menu (or story code calls Save…load()).
//   - the autosave is rewritten from the running playthrough on later passages.
// So editing the autosave and reloading the page brings back the session's old
// values, and the next autosave writes them over the edit. The reliable path is:
// edit a save → back it up → write it to a manual slot → LOAD it in the game →
// verify (the game writes the loaded state to its session state).
//
// Everything here works on plain objects read from storage. Nothing is evaluated.

import * as LZ from '../core/lzstring.js';
import { decodeDelta, encodeDelta } from '../adapters/sugarcube-moments.js';

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Decodes a stored value: plain JSON, LZString UTF-16 (SugarCube's storage) or Base64. */
export function decodeStored(raw) {
  if (typeof raw !== 'string' || raw.length < 2) return null;
  const tryJson = (t) => {
    try {
      const v = JSON.parse(t);
      return v && typeof v === 'object' ? v : null;
    } catch {
      return null;
    }
  };
  let v = tryJson(raw);
  if (v) return { obj: v, codec: 'json' };
  if (raw.endsWith(' ')) {
    try {
      const t = LZ.decompressFromUTF16(raw);
      if (t && (v = tryJson(t))) return { obj: v, codec: 'utf16' };
    } catch {
      /* not UTF-16 LZString */
    }
  }
  if (/^[A-Za-z0-9+/=]+$/.test(raw)) {
    try {
      const t = LZ.decompressFromBase64(raw);
      if (t && (v = tryJson(t))) return { obj: v, codec: 'base64' };
    } catch {
      /* not Base64 LZString */
    }
  }
  return null;
}
export function encodeStored(obj, codec) {
  const t = JSON.stringify(obj);
  if (codec === 'utf16') return LZ.compressToUTF16(t);
  if (codec === 'base64') return LZ.compressToBase64(t);
  return t;
}

const isState = (s) => !!s && typeof s === 'object' && (Array.isArray(s.delta) || Array.isArray(s.history));
export const isSave = (o) => !!o && typeof o === 'object' && isState(o.state);

/** The moments of a state object (delta decoded like SugarCube) and the current index. */
export function momentsOf(state) {
  const moments = Array.isArray(state.delta) ? decodeDelta(state.delta) : clone(state.history);
  let index = Number.isInteger(state.index) ? state.index : moments.length - 1;
  if (index < 0 || index >= moments.length) index = moments.length - 1;
  return { moments, index };
}
export function currentVariables(state) {
  const { moments, index } = momentsOf(state);
  return moments[index] ? moments[index].variables : null;
}
export function getPath(obj, path) {
  let o = obj;
  for (const k of path) {
    if (o === null || typeof o !== 'object' || !(k in o)) return { found: false };
    o = o[k];
  }
  return { found: true, value: o };
}
/** "player.money", "$player.money", "State.variables.player.money" → ['player','money'] */
export function parseVarPath(expr) {
  const e = String(expr || '')
    .trim()
    .replace(/^(SugarCube\.)?State\.variables\./, '')
    .replace(/^\$/, '')
    .replace(/\[(\d+)\]/g, '.$1');
  const parts = e.split('.').filter(Boolean);
  return parts.length ? parts : null;
}

/**
 * Applies edits to the CURRENT moment of a state object and re-encodes the history the
 * way SugarCube does. Only existing variables are changed (never invented).
 * @param edits [{path: ['player','money'], value}]
 */
export function editState(state, edits) {
  const { moments, index } = momentsOf(state);
  const vars = moments[index].variables;
  for (const { path, value } of edits) {
    let o = vars;
    for (let i = 0; i < path.length - 1; i++) {
      if (o === null || typeof o !== 'object' || !(path[i] in o)) throw new Error(`$${path.join('.')} does not exist in this save`);
      o = o[path[i]];
    }
    const k = path[path.length - 1];
    if (o === null || typeof o !== 'object' || !(k in o)) throw new Error(`$${path.join('.')} does not exist in this save`);
    const old = o[k];
    if (typeof old === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`$${path.join('.')} needs a number`);
      o[k] = n;
    } else if (typeof old === 'boolean') o[k] = value === true || value === 'true';
    else if (typeof old === 'string') o[k] = String(value);
    else throw new Error(`$${path.join('.')} is not a simple value`);
  }
  const out = { ...state };
  if (Array.isArray(state.delta)) out.delta = encodeDelta(moments);
  else out.history = moments;
  return out;
}

/**
 * Everything SugarCube keeps in this page's storage.
 * @returns {saves: [{id, label, kind:'autosave'|'slot', slot?, key, path, codec, raw, save}],
 *           free: [{id, label, slot, key, path, codec, raw}], session: {key, codec, raw, state}|null, bundles}
 */
let cacheEntry = null;

// ---- which story is this? (2.3) SugarCube names its storage "(Saved Games)<story id>.<what>".
// Several stories on one website share localStorage (and, within a tab, sessionStorage), so
// saves are only ever taken from the story running on this page.
const SG = '(Saved Games)';
export function storyIdOfKey(key) {
  if (typeof key !== 'string' || !key.startsWith(SG)) return null;
  const rest = key.slice(SG.length);
  const i = rest.indexOf('.');
  return i > 0 ? rest.slice(0, i) : null;
}
function slugify(str) {
  return String(str || '')
    .trim()
    .replace(/[^\w\s\u2013\u2014-]+/g, '')
    .replace(/[_\s\u2013\u2014-]+/g, '-')
    .toLocaleLowerCase();
}
function storyIds(win) {
  const ids = new Set();
  for (const store of ['localStorage', 'sessionStorage']) {
    try {
      const st = win[store];
      for (let i = 0; i < st.length; i++) {
        const id = storyIdOfKey(st.key(i));
        if (id) ids.add(id);
      }
    } catch {
      /* blocked */
    }
  }
  return ids;
}
/** Is the page in this window a SugarCube story? (markers in the DOM, readable from any JS world) */
export function isSugarCubePage(win) {
  try {
    const doc = win.document;
    const sd = doc.querySelector('tw-storydata');
    if (sd && /sugarcube/i.test(sd.getAttribute('format') || '')) return true;
    if (doc.querySelector('script#script-sugarcube') || doc.getElementById('ui-bar')) return true;
    const sc = win.SugarCube;
    return !!(sc && sc.State);
  } catch {
    return false;
  }
}

/**
 * {ids, current, verified, page, how}: the story ids in this website's storage, and the story running
 * in this window. `current` is set only when the page IS a SugarCube story (2.3.2: a lone story's
 * saves used to count as "current" on any page of the website, e.g. a fighting game hosted next to
 * it). verified: the id was read from the running story or matches its title; otherwise it is only
 * probable (the page is a story, and only one story has saves here).
 */
export function currentStory(win) {
  const ids = storyIds(win);
  const out = (current, how, verified = false, page = true) => ({ ids: [...ids], current, verified, page, how });
  if (!isSugarCubePage(win)) return out(null, 'this page is not a SugarCube story', false, false);
  try {
    const sc = win.SugarCube;
    const live = sc && (sc.Config?.saves?.id || sc.Story?.id || sc.Story?.domId);
    if (live) return out(String(live), 'read from the running story (SugarCube.Story)', true);
  } catch {
    /* not reachable from this world */
  }
  try {
    const name = win.document.querySelector('tw-storydata')?.getAttribute('name');
    for (const c of [slugify(name), String(name || '')]) if (c && ids.has(c)) return out(c, 'matches the story title on this page', true);
  } catch {
    /* no DOM */
  }
  // 2.3.6: SugarCube rewrites "(Saved Games)<id>.state" in sessionStorage on every passage it
  // shows. The story whose playthrough in this tab is at the passage ON SCREEN is the one running
  // here; another story played earlier in the tab stays at its own last passage. Only a unique
  // match counts (two playthroughs at the same passage name identify nothing).
  const bySession = sessionMatch(win);
  if (bySession) return out(bySession.id, `its playthrough in this tab (sessionStorage “${bySession.key}”) is at passage “${bySession.passage}”, the passage on screen`, true);
  if (ids.size === 1) return out([...ids][0], 'probably this story: the only SugarCube story with saves on this website (its id could not be read from the page)', false);
  return out(null, ids.size ? `${ids.size} SugarCube stories have saves on this website and the one on this page cannot be identified` : 'no SugarCube storage', false);
}
/** The passage SugarCube shows in this window (div.passage[data-passage]), or null. */
export function passageOnScreen(win) {
  try {
    const el = win.document.querySelector('#passages > .passage[data-passage], #passages .passage[data-passage]');
    const n = el && el.getAttribute('data-passage');
    return n || null;
  } catch {
    return null;
  }
}
/** {id, key, passage} of the ONE story whose session playthrough is at the passage on screen. */
export function sessionMatch(win) {
  const shown = passageOnScreen(win);
  if (!shown) return null;
  const hits = [];
  try {
    const st = win.sessionStorage;
    for (let i = 0; i < st.length; i++) {
      const key = st.key(i);
      const id = storyIdOfKey(key);
      if (!id || !/\.state$/.test(key)) continue;
      const raw = st.getItem(key);
      if (!raw || raw.length > 8 * 1024 * 1024) continue; // never decode huge values here
      const d = decodeStored(raw);
      if (!d || !isState(d.obj)) continue;
      const { moments, index } = momentsOf(d.obj);
      if (moments[index] && moments[index].title === shown) hits.push({ id, key, passage: shown });
    }
  } catch {
    return null;
  }
  return hits.length === 1 ? hits[0] : null;
}
/**
 * Every SugarCube key in this website's storage, UNFILTERED (Diagnostics -> Saves found, 2.3.7):
 * [{store, key, story, size, shape, saves: [{slot, passage, date, money}], why}]. Read-only; values
 * over 8 MB are listed with their size and not decoded (Safari memory). `money`: every variable
 * path containing "money" in the save's CURRENT moment, with its value.
 */
export function listSugarCubeKeys(win, { find = /money/i } = {}) {
  const out = [];
  const moneyOf = (vars) => {
    const hits = [];
    let budget = 3000;
    const walk = (o, path, depth) => {
      if (!o || typeof o !== 'object' || depth > 4 || hits.length >= 6) return;
      for (const k of Object.keys(o)) {
        if (--budget < 0) return;
        const v = o[k];
        const p = path ? `${path}.${k}` : k;
        if (find.test(k) && (typeof v === 'number' || typeof v === 'string')) hits.push(`$${p} = ${String(v).slice(0, 24)}`);
        else if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) walk(v, p, depth + 1);
      }
    };
    walk(vars, '', 0);
    return hits;
  };
  const oneSave = (slot, sv) => {
    try {
      const { moments, index } = momentsOf(sv.state);
      const m = moments[index] || {};
      return { slot, passage: m.title || sv.title || '?', date: sv.date || null, money: moneyOf(m.variables) };
    } catch (e) {
      return { slot, passage: '?', date: null, money: [], error: e.message };
    }
  };
  for (const store of ['localStorage', 'sessionStorage']) {
    let st;
    try {
      st = win[store];
      if (typeof st.length !== 'number') throw new Error('no storage');
    } catch {
      out.push({ store, key: '', story: null, size: 0, shape: 'blocked', saves: [], why: `${store} cannot be read here` });
      continue;
    }
    for (let i = 0; i < st.length; i++) {
      const key = st.key(i);
      const story = storyIdOfKey(key);
      if (!story) continue;
      const raw = st.getItem(key) || '';
      const row = { store, key, story, size: raw.length, shape: 'unknown', saves: [], why: '' };
      if (raw.length > 8 * 1024 * 1024) {
        row.shape = 'not decoded (over 8 MB)';
        out.push(row);
        continue;
      }
      const d = decodeStored(raw);
      if (!d) {
        row.shape = 'not decodable (not JSON or LZString)';
        out.push(row);
        continue;
      }
      const o = d.obj;
      row.codec = d.codec;
      if (isState(o)) {
        row.shape = 'session state (the running playthrough)';
        row.saves.push(oneSave('session', { state: o }));
      } else if (isSave(o)) {
        row.shape = 'one save';
        row.saves.push(oneSave('save', o));
      } else if ('autosave' in o || Array.isArray(o.slots)) {
        row.shape = 'saves bundle (autosave + slots)';
        if (isSave(o.autosave)) row.saves.push(oneSave('autosave', o.autosave));
        (o.slots || []).forEach((sv, n) => isSave(sv) && row.saves.push(oneSave(`slot ${n + 1}`, sv)));
        if (!row.saves.length) row.why = 'no save in it (empty autosave and slots)';
      } else row.shape = `other SugarCube data (${Object.keys(o).slice(0, 4).join(', ') || 'empty'})`;
      out.push(row);
    }
  }
  return out;
}
/** Cheap signature of both storages (keys, lengths, edges) — avoids decoding everything again. */
function storageSig(win) {
  let s = '';
  for (const store of ['localStorage', 'sessionStorage']) {
    try {
      const st = win[store];
      for (let i = 0; i < st.length; i++) {
        const k = st.key(i);
        const v = st.getItem(k) || '';
        s += `${store[0]}${k}:${v.length}:${v.slice(0, 24)}${v.slice(-24)}|`;
      }
    } catch {
      /* blocked */
    }
  }
  return s;
}
export function readSugarCubeStorage(win, { fresh = false } = {}) {
  const sig = storageSig(win);
  if (!fresh && cacheEntry && cacheEntry.win === win && cacheEntry.sig === sig) return cacheEntry.out;
  const out = readSugarCubeStorageRaw(win);
  cacheEntry = { win, sig, out };
  return out;
}
function readSugarCubeStorageRaw(win) {
  const story = currentStory(win);
  const out = { saves: [], free: [], session: null, story };
  // another story's keys are never offered (never written); keys without a story id are kept
  const mine = (k) => {
    const id = storyIdOfKey(k);
    if (!id) return true;
    if (!story.page) return false; // not a SugarCube page: no SugarCube save is this game's
    return !story.current || id === story.current;
  };
  const each = (store, fn) => {
    try {
      const st = win[store];
      for (let i = 0; i < st.length; i++) {
        const k = st.key(i);
        if (mine(k)) fn(k, st.getItem(k));
      }
    } catch {
      /* storage blocked */
    }
  };
  each('localStorage', (key, raw) => {
    const d = decodeStored(raw);
    if (!d) return;
    const o = d.obj;
    if (isSave(o)) {
      const auto = /auto/i.test(key);
      out.saves.push({ id: `${key}`, label: auto ? 'Autosave' : `Save “${key.replace(/^\(Saved Games\)/, '')}”`, kind: auto ? 'autosave' : 'slot', key, path: [], codec: d.codec, raw, save: o });
      return;
    }
    // SugarCube 2.36 bundle: {autosave, slots: [...]}
    if ('autosave' in o || Array.isArray(o.slots)) {
      if (isSave(o.autosave)) out.saves.push({ id: `${key}#autosave`, label: 'Autosave', kind: 'autosave', key, path: ['autosave'], codec: d.codec, raw, save: o.autosave });
      (o.slots || []).forEach((sv, i) => {
        const ref = { id: `${key}#slot${i}`, label: `Slot ${i + 1}`, kind: 'slot', slot: i, key, path: ['slots', i], codec: d.codec, raw };
        if (isSave(sv)) out.saves.push({ ...ref, save: sv });
        else if (sv === null || sv === undefined) out.free.push(ref);
      });
    }
  });
  each('sessionStorage', (key, raw) => {
    if (out.session) return;
    const d = decodeStored(raw);
    if (d && isState(d.obj)) out.session = { key, codec: d.codec, raw, state: d.obj };
  });
  return out;
}

function readSession(win) {
  const cur = currentStory(win).current;
  try {
    const st = win.sessionStorage;
    for (let i = 0; i < st.length; i++) {
      const key = st.key(i);
      const id = storyIdOfKey(key);
      if (id && cur && id !== cur) continue; // another story played earlier in this tab
      const raw = st.getItem(key);
      const d = decodeStored(raw);
      if (d && isState(d.obj)) return { key, codec: d.codec, raw, state: d.obj };
    }
  } catch {
    /* blocked */
  }
  return null;
}

/** Re-reads one save (or the session) to compare with what the workflow started from. */
export function readRaw(win, store, key) {
  try {
    return win[store].getItem(key);
  } catch {
    return null;
  }
}

/**
 * Writes a save object to a slot/key, keeping the container format and encoding.
 * Refuses when the stored value changed since `expectRaw` (the game saved meanwhile).
 */
export function writeSave(win, target, saveObj, expectRaw) {
  const now = readRaw(win, 'localStorage', target.key);
  if (expectRaw !== undefined && now !== expectRaw) {
    const err = new Error('The game saved to this storage after you started (for example an autosave). Nothing was written, so no newer progress was lost. Start again to edit the newest save.');
    err.conflict = true;
    throw err;
  }
  let container;
  if (!target.path.length) container = saveObj;
  else {
    const d = decodeStored(now);
    if (!d) throw new Error('The save storage could not be decoded again; nothing was written.');
    container = d.obj;
    let o = container;
    for (let i = 0; i < target.path.length - 1; i++) o = o[target.path[i]];
    o[target.path[target.path.length - 1]] = saveObj;
  }
  const raw = encodeStored(container, target.codec);
  // verify before writing: decode what will be stored and compare
  const back = decodeStored(raw);
  if (!back || JSON.stringify(back.obj) !== JSON.stringify(container)) throw new Error('Verification of the rebuilt save failed; nothing was written.');
  win.localStorage.setItem(target.key, raw);
  return { before: now, after: raw };
}

export function writeSession(win, session, state, expectRaw) {
  const now = readRaw(win, 'sessionStorage', session.key);
  if (expectRaw !== undefined && now !== expectRaw) {
    const err = new Error('The game changed its session state after you started (you played on). Nothing was written. Start again.');
    err.conflict = true;
    throw err;
  }
  const raw = encodeStored(state, session.codec);
  const back = decodeStored(raw);
  if (!back || JSON.stringify(back.obj) !== JSON.stringify(state)) throw new Error('Verification of the rebuilt session state failed; nothing was written.');
  win.sessionStorage.setItem(session.key, raw);
  return { before: now, after: raw };
}

/** Did the game load the edited values? Reads the session state the game writes after loading. */
export function checkLoaded(win, expect) {
  // only the session state is read (exactly, every time): no localStorage decoding while polling
  const sc = { session: readSession(win) };
  if (!sc.session) return { state: 'unknown', detail: 'The game has no session state to check yet.' };
  const vars = currentVariables(sc.session.state);
  const got = expect.map((e) => ({ ...e, now: getPath(vars, e.path) }));
  if (got.every((g) => g.now.found && String(g.now.value) === String(g.value))) return { state: 'verified', got };
  return { state: 'waiting', got };
}

/** Public SugarCube save API, when the story publishes window.SugarCube (2.36: Save.slots/autosave, 2.37: Save.browser). */
export function publicLoader(win) {
  let SC;
  try {
    SC = win.SugarCube;
  } catch {
    return null;
  }
  const S = SC && SC.Save;
  if (!S) return null;
  return {
    load(target) {
      if (target.kind === 'autosave') {
        if (S.autosave && typeof S.autosave.load === 'function') return S.autosave.load();
        if (S.browser && S.browser.auto && typeof S.browser.auto.load === 'function') return S.browser.auto.load(0);
      } else if (typeof target.slot === 'number') {
        if (S.slots && typeof S.slots.load === 'function') return S.slots.load(target.slot);
        if (S.browser && S.browser.slot && typeof S.browser.slot.load === 'function') return S.browser.slot.load(target.slot);
      }
      throw new Error('This SugarCube version’s Save API has no load function SaveForge knows.');
    },
  };
}
