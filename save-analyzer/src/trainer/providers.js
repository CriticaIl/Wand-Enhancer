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
import { generateModMenu, generateModMenuAsync } from '../core/modmenu.js';
import { coerceLive } from './live-tree.js';

/** Ids of save variables listed inside a live source. */
export const SAVE_PREFIX = 'save:';

// Trainer sections → existing mod-menu categories
export const SECTIONS = [
  { id: 'player', name: 'Player', icon: 'heart', cats: ['stats', 'progression', 'text'] },
  { id: 'money', name: 'Money', icon: 'coin', cats: ['currency', 'resources'] },
  { id: 'inventory', name: 'Inventory', icon: 'bag', cats: ['inventory'] },
  { id: 'world', name: 'World', icon: 'clock', cats: ['time', 'variables'] },
  { id: 'story', name: 'Story', icon: 'flag', cats: ['flags', 'relationships'] },
  { id: 'unlocks', name: 'Unlocks', icon: 'key', cats: ['unlocks', 'achievements'] },
  { id: 'potential', name: 'Potential game variables', icon: 'search', cats: [] },
  { id: 'advanced', name: 'Advanced', icon: 'gear', cats: ['other', 'internal'] },
];
export const SECTION_OF = Object.fromEntries(SECTIONS.flatMap((s) => s.cats.map((c) => [c, s.id])));

class BaseProvider {
  /** Set by the trainer (inject.js): throws when this page now shows another game, so nothing
   * read from the previous game is ever written (2.3). */
  checkContext() {
    if (this.disposed) throw new Error('This scan was closed. Nothing was written.');
    this.guard?.();
  }
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
  load(root, menu = null) {
    this.root = root;
    this.index = indexTree(root);
    this.menu = menu || generateModMenu(root);
    this.entries = this.menu.all;
    this.entryById = new Map(this.entries.map((e) => [e.nodeId, e]));
    for (const e of this.entries) {
      e.detect = this.index.byId.get(e.nodeId)?.meta?.detect || null;
      // the generic detector's uncertain finds get their own section instead of being hidden
      e.section = e.detect?.tier === 'potential' ? 'potential' : SECTION_OF[e.category] || 'advanced';
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
  /**
   * Builds the provider with a time-sliced scan (the game keeps running) instead of one
   * long synchronous pass. `signal.abort()` (Stop scanning) keeps what was read so far.
   */
  static async createAsync(win, engine, store, { signal = null, sliceMs = 8, perf = null, onProgress = null, yieldFn } = {}) {
    const y = yieldFn || (() => new Promise((r) => win.setTimeout(r, 0)));
    const snap = engine.snapshotAsync ? await timed(perf, `scan: ${engine.name}`, () => engine.snapshotAsync({ signal, sliceMs, yieldFn: y, onProgress }), (t) => ({ nodes: t.count, truncated: t.truncated, stopped: !!t.stopped })) : await timed(perf, `scan: ${engine.name}`, () => engine.snapshot(), (t) => ({ nodes: t.count, truncated: t.truncated }));
    engine._cached = null;
    if (onProgress) onProgress({ stage: 'menu', count: snap.count });
    const menu = await timed(perf, 'build variable list', () => generateModMenuAsync(snap.root, { sliceMs, signal: null, yieldFn: y }), (m) => ({ variables: m.all.length }));
    return new LiveProvider(win, engine, store, { preloaded: { snap, menu } });
  }

  constructor(win, engine, store, opts = {}) {
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
    this.paused = false;
    this.lastRelearn = 0;
    this.relearnMinMs = opts.relearnMinMs ?? engine.profile?.relearnMinMs ?? 15000;
    if (opts.preloaded) {
      this.refs = opts.preloaded.snap.refs;
      this.truncated = opts.preloaded.snap.truncated;
      this.scanStopped = !!opts.preloaded.snap.stopped;
      this.load(opts.preloaded.snap.root, opts.preloaded.menu);
    } else this.rescan();
    // session learning: variables that start changing while you play are promoted. A full
    // re-scan is expensive on big games, so it is rate-limited, time-sliced and paused while
    // the trainer is minimized or the page is hidden.
    if (engine.onLearned && engine.startLearning) {
      this.unlearn = engine.onLearned(() => this.requestRelearn());
      engine.startLearning(engine.profile?.learnEveryMs ?? 2000);
    }
  }

  /** Learning found new evidence: re-scan later, at most every relearnMinMs, never while paused. */
  requestRelearn() {
    this.relearnDirty = true;
    if (this.disposed || this.paused || this.relearnTimer || this.relearning) return;
    const wait = Math.max(0, this.lastRelearn + this.relearnMinMs - Date.now());
    this.relearnTimer = this.timers.setTimeout(() => {
      this.relearnTimer = 0;
      if (this.paused || this.disposed) return;
      this.relearnAsync({ background: true });
    }, wait);
  }
  /** Minimized / hidden: stop background work (learning, save sync, re-scans). */
  setPaused(on) {
    if (this.disposed) return; // a closed scan never restarts background work
    this.paused = !!on;
    if (on) {
      if (this.engine.stopLearning) this.engine.stopLearning();
      if (this.relearnTimer) this.timers.clearTimeout(this.relearnTimer), (this.relearnTimer = 0);
    } else {
      if (this.engine.startLearning) this.engine.startLearning(this.engine.profile?.learnEveryMs ?? 2000);
      if (this.relearnDirty) this.requestRelearn();
    }
    if (this.saves) this.saves.setPaused?.(this, on);
  }

  /** Re-runs detection without leaving the current screen (new evidence, a mark, a verified edit). */
  relearn() {
    const snap = this.engine.snapshot();
    this.refs = snap.refs;
    this.truncated = snap.truncated;
    this.load(snap.root);
    this.relearnDirty = false; // user-triggered (mark, verified edit): does not use up the background rate limit
    this.emit('learned');
  }
  /** Same, time-sliced so the game keeps running. */
  async relearnAsync({ signal = null, background = false } = {}) {
    if (this.relearning) return;
    this.relearning = true;
    try {
      const y = () => new Promise((r) => this.timers.setTimeout(r, 0));
      const sliceMs = this.engine.profile?.sliceMs ?? 8;
      const snap = this.engine.snapshotAsync ? await this.engine.snapshotAsync({ signal, sliceMs, yieldFn: y }) : this.engine.snapshot();
      this.engine._cached = null;
      const menu = await generateModMenuAsync(snap.root, { sliceMs, yieldFn: y });
      if (this.disposed) return; // closed or replaced meanwhile: never shown
      this.refs = snap.refs;
      this.truncated = snap.truncated;
      this.scanStopped = !!snap.stopped;
      this.load(snap.root, menu);
      if (background) this.lastRelearn = Date.now();
      this.relearnDirty = false;
      this.emit('learned');
    } finally {
      this.relearning = false;
    }
  }
  detection(id) {
    if (this.isSave(id)) return null;
    return this.engine.detection ? this.engine.detection(id) : null;
  }
  canMark() {
    return typeof this.engine.mark === 'function';
  }
  /** tier: 'game' | 'not' | null (forget). Remembered for this website. */
  mark(id, tier) {
    if (!this.canMark()) return;
    this.engine.mark(id, tier);
    this.relearn();
  }

  // ---------------------------------------------------------------- shared save variables
  // Save variables come from the SaveHub (the Save Editor's pipeline). They are listed
  // next to live variables with ids prefixed "save:"; a save field linked to a live
  // variable (engine mapping or verified observation) is shown once, on the live entry.

  load(root, menu = null) {
    super.load(root, menu);
    this.liveEntries = this.entries;
    if (this.saves) this.mergeSaves();
  }

  attachSaves(hub) {
    if (this.saves) return;
    this.saves = hub;
    this.saveOrder = [];
    this.saveRedo = [];
    this.unsubHub = hub.on((r) => {
      if (r !== 'synced' && r !== 'stale') return;
      this.mergeSaves();
      this.emit('learned');
    });
    hub.attach(this);
    this.mergeSaves();
    this.emit('learned');
  }
  wireSaves() {
    const sp = this.saves?.provider;
    if (!sp || this.wiredSp === sp) return;
    this.unsubSp?.();
    this.wiredSp = sp;
    this.unsubSp = sp.on((reason, ids) => {
      if (reason === 'learned' || reason === 'rescan') return;
      this.emit(reason === 'reset' ? 'status' : reason, ids.map((i) => this.fromSaveId(i)));
    });
  }
  mergeSaves() {
    const sp = this.saves?.provider;
    this.saveLinks = sp ? this.saves.linksFor(this) : new Map();
    this.saveToLive = new Map([...this.saveLinks.values()].map((l) => [l.saveId, l.liveId]));
    for (const e of this.liveEntries) {
      const l = this.saveLinks.get(e.nodeId);
      e.origin = l ? 'live+save' : 'live';
      e.saveLink = l || null;
    }
    const extra = [];
    if (sp) {
      for (const se of sp.entries) {
        if (this.saveToLive.has(se.nodeId)) continue;
        // engine internals (e.g. superseded SugarCube moments) stay in “Saves in storage” only
        if (se.category === 'internal') continue;
        extra.push({ ...se, nodeId: SAVE_PREFIX + se.nodeId, origin: 'save', saveId: se.nodeId, en: undefined });
      }
    }
    this.entries = extra.length ? [...this.liveEntries, ...extra] : this.liveEntries;
    this.entryById = new Map(this.entries.map((e) => [e.nodeId, e]));
    this.refCounts = null;
    this.wireSaves();
  }
  isSave(id) {
    return typeof id === 'string' && id.startsWith(SAVE_PREFIX);
  }
  saveProvider() {
    return this.saves?.provider || null;
  }
  fromSaveId(saveId) {
    return this.saveToLive?.get(saveId) || SAVE_PREFIX + saveId;
  }
  hasSaves() {
    return !!this.saveProvider()?.entries.length;
  }
  /** 'live', 'save' or 'live+save' */
  originOf(id) {
    return this.isSave(id) ? 'save' : this.saveLinks?.has(id) ? 'live+save' : 'live';
  }
  saveLinkOf(id) {
    return this.saveLinks?.get(id) || null;
  }
  channelOf(id) {
    return this.isSave(id) ? 'reload' : this.channel;
  }
  savePending() {
    return this.saveProvider()?.pendingCount() || 0;
  }
  /** Linked variable: also put the value into its save field (pending until written). */
  setSaveFor(id, value, label = 'Also save') {
    const l = this.saveLinkOf(id);
    const sp = this.saveProvider();
    if (!l || !sp) throw new Error('This variable has no verified save link.');
    const r = sp.set({ id: l.saveId, value: typeof value === 'number' ? String(value) : value }, label);
    if (r.changed) {
      this.saveOrder.push('save');
      this.saveRedo = [];
    }
    return r;
  }
  set(changes, label = 'Edit') {
    this.checkContext();
    const list = Array.isArray(changes) ? changes : [changes];
    const saveCh = list.filter((c) => this.isSave(c.id));
    const liveCh = list.filter((c) => !this.isSave(c.id));
    let res = { ok: true, changed: 0 };
    if (saveCh.length) {
      const sp = this.saveProvider();
      if (!sp) throw new Error('The saves are no longer available. Tap Sync save variables.');
      res = sp.set(saveCh.map((c) => ({ id: c.id.slice(SAVE_PREFIX.length), value: c.value })), label);
      if (res.changed && this.saves) {
        this.saveOrder.push('save');
        this.saveRedo = [];
      }
    }
    if (liveCh.length) {
      res = this.setLive(liveCh, label);
      if (res.changed && this.saves) {
        this.saveOrder.push('live');
        this.saveRedo = [];
      }
    }
    return res;
  }

  rescan() {
    // list the game's globals again first: state created after the first look must be found too
    if (this.engine.refresh) {
      try {
        this.engine.refresh();
      } catch {
        /* keep the previous list */
      }
    }
    const snap = this.engine.snapshot();
    this.refs = snap.refs;
    this.truncated = snap.truncated;
    this.load(snap.root);
    for (const id of [...this.locks.keys()]) if (!this.index.byId.has(id)) this.unlock(id);
    this.emit('rescan');
  }

  node(id) {
    if (this.isSave(id)) return this.saveProvider()?.node(id.slice(SAVE_PREFIX.length));
    return super.node(id);
  }
  parents(id) {
    if (this.isSave(id)) return this.saveProvider()?.parents(id.slice(SAVE_PREFIX.length)) || [];
    return super.parents(id);
  }
  explain(id) {
    if (this.isSave(id)) return this.saveProvider().explain(id.slice(SAVE_PREFIX.length));
    return super.explain(id);
  }
  liveName(id) {
    if (this.isSave(id)) return null;
    return this.engine.liveName ? this.engine.liveName(id, this.refs.get(id)) : null;
  }

  sourceOf(id) {
    if (this.isSave(id)) return `Save: ${this.saveProvider()?.sourceOf(id.slice(SAVE_PREFIX.length)) || 'browser storage'}`;
    const link = this.saveLinkOf(id);
    if (link) return `${this.liveSourceOf(id)} · Save: ${this.saveProvider().sourceOf(link.saveId)} (${link.how === 'engine' ? 'engine save layout' : 'verified by observation'})`;
    return this.liveSourceOf(id);
  }
  liveSourceOf(id) {
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
    if (this.isSave(id)) return this.saveProvider()?.value(id.slice(SAVE_PREFIX.length));
    const r = this.resolve(id);
    if (!r) return undefined;
    try {
      return r.obj[r.key];
    } catch {
      return undefined;
    }
  }
  original(id) {
    if (this.isSave(id)) return this.saveProvider()?.original(id.slice(SAVE_PREFIX.length));
    return this.touched.has(id) ? this.touched.get(id) : this.value(id);
  }
  isEdited(id) {
    if (this.isSave(id)) return !!this.saveProvider()?.isEdited(id.slice(SAVE_PREFIX.length));
    return this.touched.has(id) && !sameValue(this.touched.get(id), this.value(id));
  }
  pendingCount() {
    return this.savePending();
  }
  statusOf(id) {
    if (this.isSave(id)) {
      const st = this.saveProvider()?.statusOf(id.slice(SAVE_PREFIX.length));
      return st && st.state === 'reload' ? { ...st, detail: 'Save edit pending. It is written to the game’s save when you tap Write saves (kept for the next load) or Apply & Reload (the game reloads and reads it). The running game does not see it before that.' } : st;
    }
    if (this.locks.has(id)) {
      const l = this.locks.get(id);
      return { state: 'locked', detail: l.reapplied ? `Locked at ${l.value}: the game changed it ${l.reapplied} time(s), SaveForge put it back each time.` : `Locked at ${l.value}.` };
    }
    const node = this.node(id);
    if (node && (!node.editable || node.meta?.readOnlyReason)) return { state: 'readonly', detail: node.meta?.readOnlyReason || 'This value cannot be edited.' };
    return this.status.get(id) || null;
  }

  /** Writes through the engine's own setter when it has one, else directly. Returns how it was written. */
  write(id, v) {
    this.checkContext();
    if (this.engine.writeAsync) {
      // through the game (its answer arrives later); never into a local copy only
      this.engine.writeAsync(id, v).catch(() => {});
      return this.engine.name;
    }
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

  setLive(changes, label = 'Edit') {
    this.checkContext();
    const list = Array.isArray(changes) ? changes : [changes];
    const step = [];
    for (const { id, value } of list) {
      const node = this.node(id);
      if (!node || !node.editable) throw new Error('This value is read-only.');
      if (node.meta?.readOnlyReason) throw new Error(node.meta.readOnlyReason);
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
      if (this.saves) this.saves.noteLive(this, s.id, s.before, s.after); // evidence for save links
    }
    this.undoStack.push({ label, step });
    this.redoStack = [];
    this.saveBackup();
    this.emit('edit', step.map((s) => s.id));
    return { ok: true, changed: step.length, applied: 'live', verified: Promise.all(results) };
  }

  /** Write, read back from the game's own object, then watch for the game putting it back. */
  applyAndVerify(id, wanted, before) {
    if (this.engine.writeAsync) return this.applyAsync(id, wanted, before);
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
          if (this.engine.markVerified) this.engine.markVerified(id);
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
        if (this.engine.markVerified) this.engine.markVerified(id);
        this.emit('status', [id]);
        resolve(done);
      };
      this.timers.setTimeout(check, VERIFY_AFTER[0]);
    });
  }

  /**
   * Engines that change values through the game itself and answer later (Ren'Py: Python runs
   * the change on its next event): sent → the game's answer (its value afterwards) → read again
   * from the game after a while. Verified only if the game still has the value then.
   */
  async applyAsync(id, wanted, before) {
    const sent = { state: 'checking', wanted, detail: `Sent to ${this.engine.name}; waiting for its answer…`, at: Date.now() };
    this.status.set(id, sent);
    this.emit('status', [id]);
    const fail = (detail, observed) => {
      const st = { state: 'failed', wanted, observed, detail, at: Date.now() };
      if (this.status.get(id) === sent || this.status.get(id)?.wanted === wanted) this.status.set(id, st);
      this.emit('status', [id]);
      return st;
    };
    let res;
    try {
      this.checkContext();
      res = await this.engine.writeAsync(id, wanted);
    } catch (e) {
      return fail(`Not changed: ${e.message}`);
    }
    if (this.disposed || this.status.get(id) !== sent) return this.status.get(id); // closed, or superseded by a newer edit
    const now = res.value;
    let st;
    if (sameValue(now, wanted)) st = { state: 'checking', wanted, observed: now, detail: `${this.engine.name} set it to ${now}; checking that the game keeps it…` };
    else if (sameValue(now, before)) return fail(`The game kept ${now}.`, now);
    else st = { state: 'adjusted', wanted, observed: now, detail: `The game adjusted it to ${now}.` };
    st.at = Date.now();
    this.status.set(id, st);
    this.emit('status', [id]);
    await new Promise((r) => this.timers.setTimeout(r, VERIFY_AFTER[VERIFY_AFTER.length - 1]));
    if (this.disposed || this.status.get(id) !== st) return this.status.get(id);
    let again;
    try {
      again = this.engine.readAsync ? await this.engine.readAsync(id) : { ok: true, value: this.value(id) };
    } catch (e) {
      again = { ok: false, error: e.message };
    }
    if (this.disposed || this.status.get(id) !== st) return this.status.get(id);
    let done;
    if (!again.ok) done = { ...st, state: st.state === 'adjusted' ? 'adjusted' : 'checking', at: Date.now(), detail: `${st.detail.replace(/; checking.*$/, '.')} It could not be read again yet${again.error ? ` (${again.error})` : ''}.` };
    else if (sameValue(again.value, now)) done = { ...st, state: st.state === 'adjusted' ? 'adjusted' : 'verified', observed: again.value, at: Date.now(), detail: st.state === 'adjusted' ? st.detail : `Applied and verified: ${this.engine.name} still has ${again.value} after ${VERIFY_AFTER[VERIFY_AFTER.length - 1] / 1000} s.` };
    else done = { state: 'reverted', wanted, observed: again.value, at: Date.now(), detail: `The game changed it back to ${again.value}. It probably recalculates this value; look for the variable it is calculated from.` };
    this.status.set(id, done);
    if (done.state === 'verified' && this.engine.markVerified) this.engine.markVerified(id);
    this.emit('status', [id]);
    return done;
  }

  // ---------------------------------------------------------------- locking / freezing
  canLock(id) {
    if (this.isSave(id)) return false;
    if (this.engine.noLocks) return false;
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
    if (this.disposed) return;
    if (this.saves) {
      this.saves.detach(this);
      this.unsubHub?.();
      this.unsubSp?.();
    }
    this.unlockAll();
    if (this.relearnTimer) this.timers.clearTimeout(this.relearnTimer), (this.relearnTimer = 0);
    if (this.unlearn) this.unlearn();
    if (this.engine.stopLearning) this.engine.stopLearning();
    if (this.engine.ownedByProvider) this.engine.dispose?.();
    this.disposed = true;
  }
  /** SaveForge timers this scan keeps running right now (Diagnostics). */
  resources() {
    return { timers: (this.lockTimer ? 1 : 0) + (this.relearnTimer ? 1 : 0) + (this.engine.learning?.() ? 1 : 0), listeners: 0 };
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
    if (this.saves && this.saveOrder.length) {
      const which = this.saveOrder.pop();
      this.saveRedo.push(which);
      if (which === 'save') return this.saveProvider()?.undo();
    }
    const e = this.undoStack.pop();
    if (!e) return false;
    for (const s of [...e.step].reverse()) this.applyAndVerify(s.id, s.before, s.after);
    this.redoStack.push(e);
    this.emit('undo', e.step.map((s) => s.id));
    return true;
  }
  redo() {
    if (this.saves && this.saveRedo.length) {
      const which = this.saveRedo.pop();
      this.saveOrder.push(which);
      if (which === 'save') return this.saveProvider()?.redo();
    }
    const e = this.redoStack.pop();
    if (!e) return false;
    for (const s of e.step) this.applyAndVerify(s.id, s.after, s.before);
    this.undoStack.push(e);
    this.emit('redo', e.step.map((s) => s.id));
    return true;
  }
  canUndo() {
    if (this.saves && this.saveOrder.length && this.saveOrder[this.saveOrder.length - 1] === 'save') return !!this.saveProvider()?.canUndo();
    return this.undoStack.length > 0;
  }
  canRedo() {
    if (this.saves && this.saveRedo.length && this.saveRedo[this.saveRedo.length - 1] === 'save') return !!this.saveProvider()?.canRedo();
    return this.redoStack.length > 0;
  }

  /** One tap: put a single value back to what it was before SaveForge changed it. */
  restoreOriginal(id) {
    if (this.isSave(id)) return this.saveProvider()?.restoreOriginal(id.slice(SAVE_PREFIX.length));
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

/** Storage Bridge read, seen by this game: saves owned by other games of the website are left out (save-owner.js). */
async function collectFor(win, collectOpts = {}) {
  const { filter, ...opts } = collectOpts;
  const dump = await storageBridge(win, 'collect', opts);
  return filter ? filter(dump) : dump;
}

export class StorageProvider extends BaseProvider {
  /** collectOpts: {indexedDB: false} reads localStorage only; {maxBinary} leaves big binary files unread. */
  static async create(win, store, collectOpts = {}) {
    const dump = await collectFor(win, collectOpts);
    const text = JSON.stringify(dump);
    const res = await analyzeFile('browser-storage.json', new TextEncoder().encode(text));
    if (!res.ok) throw new Error('Browser storage could not be decoded.');
    const p = new StorageProvider(win, store, dump, res.doc);
    p.collectOpts = collectOpts;
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

  /** Same pipeline as the SaveForge Save Editor: Storage Bridge dump → analyzeFile. */
  static async read(win, collectOpts = {}) {
    const dump = await collectFor(win, collectOpts);
    const res = await analyzeFile('browser-storage.json', new TextEncoder().encode(JSON.stringify(dump)));
    return { dump, doc: res.ok ? res.doc : null };
  }

  /** Re-read in place (Sync save variables): the same provider object stays shared by every view. */
  replaceData(dump, doc) {
    this.dump = dump;
    this.doc = doc;
    this.unsubSession?.();
    this.session = new EditSession(doc);
    this.unsubSession = this.session.on((reason, ids) => this.emit(reason, ids));
    this.load(doc.root);
    this.emit('learned');
  }

  constructor(win, store, dump, doc) {
    super();
    this.win = win;
    this.store = store;
    this.dump = dump;
    this.doc = doc;
    this.session = new EditSession(doc);
    this.unsubSession = this.session.on((reason, ids) => this.emit(reason, ids));
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
    this.checkContext();
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
    const now = await collectFor(this.win, this.collectOpts || {});
    const strip = (d) => JSON.stringify({ l: d.localStorage, i: d.indexedDB });
    if (strip(now) !== strip(this.dump)) {
      throw new ConflictError('The game has saved to its storage since the trainer read it (for example an autosave). Nothing was written, so no newer progress was overwritten. Tap “Re-read storage”, then make your edits again.');
    }
  }

  /** Validates, backs up, writes and reloads. Returns only if it did not reload. */
  async applyAndReload({ reload = true } = {}) {
    if (!this.session.edits.size) return { written: 0 };
    this.checkContext();
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
    this.checkContext();
    await storageBridge(this.win, 'apply', backup.dump);
    // SugarCube save edits also captured the running game's session state
    if (backup.session?.key) {
      try {
        if (backup.session.raw === null || backup.session.raw === undefined) this.win.sessionStorage.removeItem(backup.session.key);
        else this.win.sessionStorage.setItem(backup.session.key, backup.session.raw);
      } catch {
        /* sessionStorage blocked */
      }
    }
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

async function timed(perf, name, fn, extra) {
  if (!perf) return fn();
  return perf.time(name, fn, extra);
}
