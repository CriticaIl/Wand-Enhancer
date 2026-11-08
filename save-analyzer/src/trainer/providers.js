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
    this.backupSaved = false;
    this.rescan();
  }

  rescan() {
    const snap = this.engine.snapshot();
    this.refs = snap.refs;
    this.truncated = snap.truncated;
    this.load(snap.root);
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

  value(id) {
    const r = this.refs.get(id);
    if (!r) return this.node(id)?.value;
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

  write(id, v) {
    const r = this.refs.get(id);
    if (!r) throw new Error('This value is no longer reachable; tap Rescan.');
    r.obj[r.key] = v;
    if (this.engine.afterWrite) this.engine.afterWrite(id, r);
  }

  set(changes, label = 'Edit') {
    const list = Array.isArray(changes) ? changes : [changes];
    const step = [];
    for (const { id, value } of list) {
      const node = this.node(id);
      if (!node || !node.editable) throw new Error('This value is read-only.');
      const v = coerceLive(node, value);
      const before = this.value(id);
      if (sameValue(before, v)) continue;
      step.push({ id, before, after: v });
    }
    if (!step.length) return { ok: true, changed: 0 };
    for (const s of step) {
      if (!this.touched.has(s.id)) this.touched.set(s.id, s.before);
      this.write(s.id, s.after);
    }
    this.undoStack.push({ label, step });
    this.redoStack = [];
    this.saveBackup();
    this.emit('edit', step.map((s) => s.id));
    return { ok: true, changed: step.length, applied: 'live' };
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
    for (const s of [...e.step].reverse()) this.write(s.id, s.before);
    this.redoStack.push(e);
    this.emit('undo', e.step.map((s) => s.id));
    return true;
  }
  redo() {
    const e = this.redoStack.pop();
    if (!e) return false;
    for (const s of e.step) this.write(s.id, s.after);
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

  /** Puts every variable the trainer changed back to its value from before the first edit. */
  restoreSessionStart() {
    const changes = [...this.touched].filter(([id]) => this.refs.has(id)).map(([id, value]) => ({ id, value }));
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
    return new StorageProvider(win, store, dump, res.doc);
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
  dispose() {
    this.unsub?.();
  }
}
