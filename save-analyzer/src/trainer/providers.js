// Data sources behind the trainer UI. All expose the same interface so the
// GTA-style menu does not care whether a value lives in engine memory,
// in browser storage, or in an imported save file.
//
//   LiveProvider     engine/page memory: edits apply immediately (channel live / live-generic)
//   StorageProvider  localStorage + IndexedDB via the Storage Bridge: edits are pending
//                    until "Apply & Reload" (channel reload)
//   FileProvider     an imported save in the SaveForge app: edits go into the export (channel file)

import { storageBridge } from '../bridge/storage-bridge.js';
import { analyzeFile, EditSession } from '../core/document.js';
import { explain } from '../core/explain.js';
import { indexTree, pathOf, sameValue } from '../core/model.js';
import { generateModMenu } from '../core/modmenu.js';
import { coerceLive } from './live-tree.js';

// Trainer sections → existing mod-menu categories
export const SECTIONS = [
  { id: 'player', name: 'Player', icon: 'heart', cats: ['stats', 'progression', 'text'] },
  { id: 'money', name: 'Money', icon: 'coin', cats: ['currency', 'resources'] },
  { id: 'inventory', name: 'Inventory', icon: 'bag', cats: ['inventory'] },
  { id: 'world', name: 'World', icon: 'clock', cats: ['time', 'variables'] },
  { id: 'story', name: 'Story', icon: 'flag', cats: ['flags', 'relationships'] },
  { id: 'unlocks', name: 'Unlocks', icon: 'key', cats: ['unlocks', 'achievements'] },
  { id: 'advanced', name: 'Advanced', icon: 'gear', cats: ['other', 'internal'] },
];
export const SECTION_OF = Object.fromEntries(SECTIONS.flatMap((s) => s.cats.map((c) => [c, s.id])));

class BaseProvider {
  constructor() {
    this.listeners = new Set();
    this.refCounts = null;
  }
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(reason, ids = []) {
    for (const fn of this.listeners) fn(reason, ids);
  }
  load(root) {
    this.root = root;
    this.index = indexTree(root);
    this.menu = generateModMenu(root);
    this.entries = this.menu.all;
    this.entryById = new Map(this.entries.map((e) => [e.nodeId, e]));
    for (const e of this.entries) {
      e.section = SECTION_OF[e.category] || 'advanced';
      e.search = `${e.label} ${e.path}`.toLowerCase();
    }
    this.refCounts = null;
  }
  node(id) {
    return this.index.byId.get(id);
  }
  parents(id) {
    return pathOf(id, this.index).slice(0, -1);
  }
  liveName() {
    return null;
  }
  displayLabel(entry) {
    const n = this.liveName(entry.nodeId);
    return n ? `${entry.label} · ${n}` : entry.label;
  }
  explain(id) {
    const node = this.node(id);
    const entry = this.entryById.get(id);
    if (!this.refCounts) {
      this.refCounts = new Map();
      for (const e of this.entries) this.refCounts.set(e.key, (this.refCounts.get(e.key) || 0) + 1);
    }
    return explain(node, this.parents(id), {
      channel: node.editable ? this.channel : 'readonly',
      value: this.value(id),
      original: this.original(id),
      label: entry ? this.displayLabel(entry) : node.key,
      path: entry?.path,
      liveName: this.liveName(id),
      references: entry ? this.refCounts.get(entry.key) : 0,
      source: this.sourceOf(id),
      frame: frameLabel(this.win),
    });
  }
  sourceOf() {
    return null;
  }
}

/** "top page (origin)" or "iframe, depth n (origin)" for the window the data lives in. */
export function frameLabel(win) {
  if (!win) return null;
  let depth = 0;
  try {
    for (let w = win; w !== w.parent && depth < 10; w = w.parent) depth++;
  } catch {
    /* cross-origin parent: depth still counted up to that point */
  }
  let origin = '';
  try {
    origin = win.location.origin;
  } catch {
    origin = 'unknown origin';
  }
  return depth === 0 ? `top page (${origin})` : `iframe, depth ${depth} (${origin})`;
}

// ---------------------------------------------------------------- live

// Edit statuses shown in the trainer. An edit is only "verified" after the value
// was read back from the game's own object and was still there a moment later.
export const STATUS = {
  checking: 'Checking…',
  verified: 'Applied and verified',
  adjusted: 'Applied, adjusted by the game',
  reverted: 'Reverted by the game',
  failed: 'Failed',
  locked: 'Locked',
  reload: 'Requires reload',
  export: 'Saved edit (export)',
  readonly: 'Read-only',
};
const VERIFY_AFTER = [400, 1500];

const unescapeSeg = (s) => s.replace(/~1/g, '/').replace(/~0/g, '~');

/** Own data property only (never runs a getter while walking a path). */
function ownValue(obj, key) {
  if (obj === null || typeof obj !== 'object') return undefined;
  try {
    const d = Object.getOwnPropertyDescriptor(obj, key);
    if (d && 'value' in d) return d.value;
    // SugarCube's State.variables etc. are getters on engine objects we built the path from
    return d && typeof d.get === 'function' ? undefined : undefined;
  } catch {
    return undefined;
  }
}

export class LiveProvider extends BaseProvider {
  constructor(win, engine, store) {
    super();
    this.win = win;
    this.engine = engine;
    this.store = store;
    this.kind = 'live';
    this.channel = engine.channel;
    this.title = engine.name;
    this.note = engine.note;
    this.actions = engine.actions || [];
    this.undoStack = [];
    this.redoStack = [];
    this.touched = new Map(); // id -> value before the first trainer edit
    this.status = new Map(); // id -> {state, wanted, observed, detail, at}
    this.locks = new Map(); // id -> {value, reapplied, since}
    this.lockTimer = 0;
    this.timers = win && typeof win.setTimeout === 'function' ? win : globalThis;
    this.backupSaved = false;
    this.rescan();
  }

  rescan() {
    const snap = this.engine.snapshot();
    this.refs = snap.refs;
    this.truncated = snap.truncated;
    this.load(snap.root);
    for (const id of [...this.locks.keys()]) if (!this.index.byId.has(id)) this.unlock(id);
    this.emit('rescan');
  }

  liveName(id) {
    return this.engine.liveName ? this.engine.liveName(id, this.refs.get(id)) : null;
  }

  sourceOf(id) {
    if (this.engine.sourceOf) return `${this.engine.name}: ${this.engine.sourceOf(id)}`;
    const path = this.entryById.get(id)?.path;
    return `${this.engine.name}${path ? `: ${path}` : ''}`;
  }

  /**
   * Finds the object that owns a value *now*. Games replace their state objects
   * (SugarCube clones variables on every passage, RPG Maker swaps $gameParty on
   * load, many JS games rebuild state each tick), so the path is walked again
   * from the engine's live root instead of trusting the reference cached by the scan.
   */
  resolve(id) {
    if (this.engine.resolve) return this.engine.resolve(id, this.refs.get(id));
    if (this.engine.root) {
      const segs = id.split('/').slice(1).map(unescapeSeg);
      let obj = this.engine.root();
      for (let i = 0; i < segs.length - 1; i++) {
        obj = ownValue(obj, segs[i]);
        if (obj === null || typeof obj !== 'object') return null;
      }
      return { obj, key: segs[segs.length - 1] };
    }
    return this.refs.get(id) || null;
  }

  value(id) {
    const r = this.resolve(id);
    if (!r) return undefined;
    try {
      return r.obj[r.key];
    } catch {
      return undefined;
    }
  }
  original(id) {
    return this.touched.has(id) ? this.touched.get(id) : this.value(id);
  }
  isEdited(id) {
    return this.touched.has(id) && !sameValue(this.touched.get(id), this.value(id));
  }
  pendingCount() {
    return 0;
  }
  statusOf(id) {
    if (this.locks.has(id)) {
      const l = this.locks.get(id);
      return { state: 'locked', detail: l.reapplied ? `Locked at ${l.value}: the game changed it ${l.reapplied} time(s), SaveForge put it back each time.` : `Locked at ${l.value}.` };
    }
    const node = this.node(id);
    if (node && !node.editable) return { state: 'readonly', detail: node.meta.readOnlyReason || 'This value cannot be edited.' };
    return this.status.get(id) || null;
  }

  /** Writes through the engine's own setter when it has one, else directly. Returns how it was written. */
  write(id, v) {
    const r = this.resolve(id);
    if (!r) throw new Error('This value is no longer reachable in the game (it may have been replaced). Tap Rescan game.');
    let how = 'direct';
    if (this.engine.setter) {
      const used = this.engine.setter(id, r, v);
      if (used) how = used;
    }
    if (how === 'direct') r.obj[r.key] = v;
    if (this.engine.afterWrite) this.engine.afterWrite(id, r);
    return how;
  }

  set(changes, label = 'Edit') {
    const list = Array.isArray(changes) ? changes : [changes];
    const step = [];
    for (const { id, value } of list) {
      const node = this.node(id);
      if (!node || !node.editable) throw new Error('This value is read-only.');
      const v = coerceLive(node, value);
      const before = this.value(id);
      if (before === undefined && !this.resolve(id)) throw new Error('This value is no longer reachable in the game. Tap Rescan game.');
      if (sameValue(before, v)) continue;
      step.push({ id, before, after: v });
    }
    if (!step.length) return { ok: true, changed: 0 };
    const results = [];
    for (const s of step) {
      if (!this.touched.has(s.id)) this.touched.set(s.id, s.before);
      results.push(this.applyAndVerify(s.id, s.after, s.before));
    }
    this.undoStack.push({ label, step });
    this.redoStack = [];
    this.saveBackup();
    this.emit('edit', step.map((s) => s.id));
    return { ok: true, changed: step.length, applied: 'live', verified: Promise.all(results) };
  }

  /** Write, read back from the game's own object, then watch for the game putting it back. */
  applyAndVerify(id, wanted, before) {
    let how;
    try {
      how = this.write(id, wanted);
    } catch (e) {
      const st = { state: 'failed', wanted, detail: e.message, at: Date.now() };
      this.status.set(id, st);
      this.emit('status', [id]);
      return Promise.resolve(st);
    }
    const now = this.value(id);
    const via = how === 'direct' ? 'written directly' : `written with the engine's ${how}`;
    let st;
    if (sameValue(now, wanted)) st = { state: 'checking', wanted, observed: now, detail: `Applied (${via}); checking that the game keeps it…` };
    else if (sameValue(now, before)) st = { state: 'failed', wanted, observed: now, detail: `The game rejected the change (${via}); it still reads ${now}.` };
    else st = { state: 'adjusted', wanted, observed: now, detail: `The game adjusted it to ${now} (${via}), e.g. a maximum or minimum.` };
    st.at = Date.now();
    this.status.set(id, st);
    this.emit('status', [id]);
    if (st.state === 'failed') return Promise.resolve(st);
    const target = st.observed;
    return new Promise((resolve) => {
      let i = 0;
      const check = () => {
        if (this.status.get(id) !== st) return resolve(this.status.get(id)); // superseded by a newer edit
        const cur = this.value(id);
        // a counter the game keeps advancing (distance, timers, score) continued from the new value: that is success
        const continued = typeof cur === 'number' && typeof target === 'number' && typeof before === 'number' && !sameValue(cur, target) && Math.abs(cur - target) < Math.abs(cur - before);
        if (continued) {
          const done = { ...st, state: 'verified', observed: cur, at: Date.now(), detail: `Applied and verified: the game kept your value and keeps changing it as you play (now ${cur}).` };
          this.status.set(id, done);
          this.emit('status', [id]);
          return resolve(done);
        }
        if (!sameValue(cur, target)) {
          const next = { state: 'reverted', wanted, observed: cur, at: Date.now(), detail: `The game changed it back to ${cur} within ${VERIFY_AFTER[i]} ms. It probably recalculates this value or keeps the real one elsewhere. Lock can keep re-applying it; if gameplay still does not change, use Find a value to locate the real variable.` };
          this.status.set(id, next);
          this.emit('status', [id]);
          return resolve(next);
        }
        if (++i < VERIFY_AFTER.length) return void this.timers.setTimeout(check, VERIFY_AFTER[i] - VERIFY_AFTER[i - 1]);
        const done = { ...st, state: st.state === 'adjusted' ? 'adjusted' : 'verified', at: Date.now(), detail: st.state === 'adjusted' ? st.detail : `Applied and verified: the game still has ${cur} after ${VERIFY_AFTER[VERIFY_AFTER.length - 1] / 1000} s (${via}).` };
        this.status.set(id, done);
        this.emit('status', [id]);
        resolve(done);
      };
      this.timers.setTimeout(check, VERIFY_AFTER[0]);
    });
  }

  // ---------------------------------------------------------------- locking / freezing
  canLock(id) {
    const node = this.node(id);
    if (!node || !node.editable || !(node.type === 'int' || node.type === 'float' || node.type === 'bool' || node.type === 'string')) return false;
    const st = this.status.get(id);
    return !st || st.state !== 'failed';
  }
  /** Locks at the value you asked for (not at whatever the game just put back). */
  lock(id, value = this.status.get(id)?.wanted ?? this.value(id)) {
    if (!this.canLock(id)) throw new Error('Only values SaveForge could write can be locked.');
    this.locks.set(id, { value, reapplied: 0, since: Date.now() });
    if (!sameValue(this.value(id), value)) this.write(id, value);
    if (!this.lockTimer) this.lockTimer = this.timers.setInterval(() => this.enforceLocks(), 100);
    this.emit('status', [id]);
  }
  unlock(id) {
    this.locks.delete(id);
    if (!this.locks.size && this.lockTimer) {
      this.timers.clearInterval(this.lockTimer);
      this.lockTimer = 0;
    }
    this.emit('status', [id]);
  }
  unlockAll() {
    for (const id of [...this.locks.keys()]) this.unlock(id);
  }
  enforceLocks() {
    for (const [id, l] of this.locks) {
      const cur = this.value(id);
      if (sameValue(cur, l.value)) continue;
      try {
        this.write(id, l.value);
        l.reapplied++;
      } catch (e) {
        this.locks.delete(id);
        this.status.set(id, { state: 'failed', wanted: l.value, detail: `Lock stopped: ${e.message}`, at: Date.now() });
        this.emit('status', [id]);
      }
    }
  }
  dispose() {
    this.unlockAll();
  }

  async saveBackup() {
    // one backup record per session, updated with the original value of every touched variable
    const values = Object.fromEntries([...this.touched].map(([id, v]) => [id, v]));
    const record = { kind: 'live', engine: this.engine.id, title: this.title, values };
    if (!this.backupSaved) {
      this.backupSaved = true;
      this.backupRecord = await this.store.addBackup(record);
    } else if (this.backupRecord) {
      Object.assign(this.backupRecord, record);
    }
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return false;
    for (const s of [...e.step].reverse()) this.applyAndVerify(s.id, s.before, s.after);
    this.redoStack.push(e);
    this.emit('undo', e.step.map((s) => s.id));
    return true;
  }
  redo() {
    const e = this.redoStack.pop();
    if (!e) return false;
    for (const s of e.step) this.applyAndVerify(s.id, s.after, s.before);
    this.undoStack.push(e);
    this.emit('redo', e.step.map((s) => s.id));
    return true;
  }
  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  /** One tap: put a single value back to what it was before SaveForge changed it. */
  restoreOriginal(id) {
    if (!this.touched.has(id)) return { ok: true, changed: 0 };
    if (this.locks.has(id)) this.unlock(id);
    return this.set({ id, value: this.touched.get(id) }, 'Restore original');
  }

  /** Puts every variable the trainer changed back to its value from before the first edit. */
  restoreSessionStart() {
    this.unlockAll();
    const changes = [...this.touched].filter(([id]) => this.index.byId.has(id)).map(([id, value]) => ({ id, value }));
    if (!changes.length) return { ok: true, changed: 0 };
    return this.set(changes, 'Restore session start');
  }
}

// ---------------------------------------------------------------- storage (Apply & Reload)

export class ConflictError extends Error {}

export class StorageProvider extends BaseProvider {
  static async create(win, store) {
    const dump = await storageBridge(win, 'collect');
    const text = JSON.stringify(dump, null, 1);
    const res = await analyzeFile('browser-storage.json', new TextEncoder().encode(text));
    if (!res.ok) throw new Error('Browser storage could not be decoded.');
    const p = new StorageProvider(win, store, dump, res.doc);
    await p.verifyAfterReload();
    return p;
  }

  /** After Apply & Reload: did the values survive the reload, or did the game overwrite them on load? */
  async verifyAfterReload() {
    const pending = await this.store.get('verify', null);
    if (!pending || Date.now() - pending.at > 15 * 60 * 1000) return;
    this.postReload = new Map();
    let ok = 0;
    for (const [id, expected] of pending.items) {
      const n = this.node(id);
      const now = n ? String(n.value) : undefined;
      const good = now === expected;
      if (good) ok++;
      this.postReload.set(id, good ? { state: 'verified', detail: `Verified after reload: storage still has ${expected}.` } : { state: 'reverted', detail: n ? `After reload the game saved ${now} over your ${expected} (it probably autosaved older in-memory progress).` : 'After reload this value no longer exists in storage.' });
    }
    this.reloadSummary = { ok, total: pending.items.length };
    await this.store.set('verify', null);
  }

  statusOf(id) {
    const node = this.node(id);
    if (node && !node.editable) return { state: 'readonly', detail: node.meta.readOnlyReason || 'This value cannot be edited.' };
    if (this.session.isEdited(id)) return { state: 'reload', detail: 'Saved edit: written to browser storage when you tap Apply & Reload; the running game sees it after the reload.' };
    return this.postReload?.get(id) || null;
  }

  restoreOriginal(id) {
    return this.session.revert(id) ? { ok: true, changed: 1 } : { ok: true, changed: 0 };
  }

  constructor(win, store, dump, doc) {
    super();
    this.win = win;
    this.store = store;
    this.dump = dump;
    this.doc = doc;
    this.session = new EditSession(doc);
    this.session.on((reason, ids) => this.emit(reason, ids));
    this.kind = 'storage';
    this.channel = 'reload';
    this.title = 'Browser storage';
    this.note = `Saves found in this page’s localStorage/IndexedDB (${doc.engine.details.filter((d) => /Contains/.test(d)).map((d) => d.replace('Contains: ', '')).join(', ') || 'generic data'}). Edits are kept pending and written with Apply & Reload.`;
    this.actions = [];
    this.load(doc.root);
  }

  value(id) {
    return this.session.value(id);
  }
  original(id) {
    return this.node(id).value;
  }
  isEdited(id) {
    return this.session.isEdited(id);
  }
  pendingCount() {
    return this.session.edits.size;
  }
  set(changes, label) {
    const changed = this.session.set(changes, label);
    return { ok: true, changed: changed ? 1 : 0, applied: 'pending' };
  }
  undo() {
    return this.session.undo();
  }
  redo() {
    return this.session.redo();
  }
  canUndo() {
    return this.session.undoStack.length > 0;
  }
  canRedo() {
    return this.session.redoStack.length > 0;
  }
  diff() {
    return this.session.diff();
  }

  sourceOf(id) {
    const seg = id.split('/').map((x) => x.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (seg[1] === 'localStorage') return `localStorage key “${seg[2]}”`;
    if (seg[1] === 'indexedDB') {
      const db = this.dump.indexedDB?.[Number(seg[2])];
      const store = db?.stores?.[Number(seg[4])];
      const rec = store?.records?.[Number(seg[6])];
      const key = rec ? (typeof rec.key === 'string' ? rec.key : JSON.stringify(rec.key)) : '?';
      return `IndexedDB “${db?.name ?? '?'}” › ${store?.name ?? '?'} › ${key}`;
    }
    return 'browser storage';
  }

  /** Checks storage has not changed since it was read (e.g. a game autosave). */
  async assertUnchanged() {
    const now = await storageBridge(this.win, 'collect');
    const strip = (d) => JSON.stringify({ l: d.localStorage, i: d.indexedDB });
    if (strip(now) !== strip(this.dump)) {
      throw new ConflictError('The game has saved to its storage since the trainer read it (for example an autosave). Nothing was written, so no newer progress was overwritten. Tap “Re-read storage”, then make your edits again.');
    }
  }

  /** Validates, backs up, writes and reloads. Returns only if it did not reload. */
  async applyAndReload({ reload = true } = {}) {
    if (!this.session.edits.size) return { written: 0 };
    await this.assertUnchanged();
    const out = await this.session.export();
    if (!out.validation.ok) throw new Error(`Verification failed, nothing was written: ${out.validation.problems.slice(0, 3).join('; ')}`);
    const backup = await this.store.addBackup({ kind: 'storage', title: 'Before Apply & Reload', dump: this.dump, changes: this.diff().map((d) => ({ id: d.id, before: String(d.before), after: String(d.after) })) });
    const edited = JSON.parse(new TextDecoder().decode(out.bytes));
    await this.store.set('verify', { at: Date.now(), items: this.diff().map((d) => [d.id, String(d.after)]) });
    const summary = await storageBridge(this.win, 'apply', edited);
    if (reload) this.win.location.reload();
    return { written: summary.localStorage + summary.records, backup };
  }

  async restore(backup) {
    if (!backup?.dump) throw new Error('This backup has no storage snapshot.');
    await storageBridge(this.win, 'apply', backup.dump);
    this.win.location.reload();
  }
}

// ---------------------------------------------------------------- file (inside the SaveForge app)

export class FileProvider extends BaseProvider {
  constructor(doc, session, { onCommit } = {}) {
    super();
    this.doc = doc;
    this.session = session;
    this.kind = 'file';
    this.channel = 'file';
    this.title = doc.engine.name;
    this.note = `Editing “${doc.name}”. Changes go into the exported save file (Export), not into a running game.`;
    this.actions = [];
    this.onCommit = onCommit;
    this.unsub = session.on((reason, ids) => this.emit(reason, ids));
    this.load(doc.root);
    // reuse the document's menu so labels match the rest of the app
  }
  value(id) {
    return this.session.value(id);
  }
  original(id) {
    return this.node(id).value;
  }
  isEdited(id) {
    return this.session.isEdited(id);
  }
  pendingCount() {
    return this.session.edits.size;
  }
  set(changes, label) {
    const changed = this.session.set(changes, label);
    return { ok: true, changed: changed ? 1 : 0, applied: 'file' };
  }
  undo() {
    return this.session.undo();
  }
  redo() {
    return this.session.redo();
  }
  canUndo() {
    return this.session.undoStack.length > 0;
  }
  canRedo() {
    return this.session.redoStack.length > 0;
  }
  statusOf(id) {
    const node = this.node(id);
    if (node && !node.editable) return { state: 'readonly', detail: node.meta.readOnlyReason || 'This value cannot be edited.' };
    return this.session.isEdited(id) ? { state: 'export', detail: 'Saved into the edited save file. Export it and load it in the game to see the change.' } : null;
  }
  restoreOriginal(id) {
    return this.session.revert(id) ? { ok: true, changed: 1 } : { ok: true, changed: 0 };
  }
  dispose() {
    this.unsub?.();
  }
}
