// Shared save variables for the floating trainer.
//
// The SaveForge Save Editor discovers save variables with one pipeline:
//   Storage Bridge dump (localStorage + IndexedDB) → analyzeFile() → SaveDocument
//   (format detection, decoding, tree, friendly labels, categories) → EditSession.
// The hub runs exactly that pipeline on the game page (StorageProvider) and keeps
// ONE shared instance for every trainer view, so the "Saves in storage" source and
// the save variables shown next to live variables are the same objects with the
// same pending edits, undo, validation and backups.
//
// Linking a save field to a live variable (shown once, as "Live + Save") happens
// only through
//   - engine mappings documented by the engine itself:
//       RPG Maker MV/MZ: a save file IS DataManager.makeSaveContents(), the same
//         object the live RPG Maker source walks ($/party/_gold ↔ <slot>/party/_gold)
//       SugarCube 2: a save holds state.history[index].variables, the live source
//         mirrors the active moment as state/history/0/variables
//   - verified observations: the save value changed to exactly the value the live
//     variable had just changed to (old → new), from a single live candidate,
//     twice — or once when the new value is distinctive (≥ 10 and unique on both
//     sides). Equal names or equal current values alone never link anything.

import { StorageProvider } from './providers.js';
import { isSugarCubeSaveNode, pathKey, resolveSugarCubeSave } from '../adapters/sugarcube-moments.js';

const NUMERIC = new Set(['int', 'float']);
const unesc = (s) => s.replace(/~1/g, '/').replace(/~0/g, '~');

export class SaveHub {
  constructor(win, store, { autoMs = 2500, profile = null } = {}) {
    this.win = win;
    this.store = store;
    // memory safety: IndexedDB (Unity/Godot keep whole game files there) is read only on request,
    // and binary values above maxBinary are left unread (marked, never written back)
    this.profile = profile || { readIndexedDB: false, maxBinary: 4 * 1024 * 1024, observeCap: 5000 };
    this.includeIndexedDB = !!this.profile.readIndexedDB;
    this.pausedBy = new Set();
    this.reads = { count: 0, lastMs: 0, lastBytes: 0 };
    this.provider = null; // shared StorageProvider (null: nothing readable)
    this.error = '';
    this.stale = false; // the game saved while save edits were pending
    this.listeners = new Set();
    this.attached = new Set(); // live providers showing save variables
    this.observed = new Map(); // `${engine}|${liveId}` -> {saveId, n, at, detail}
    this.pairs = new Map(); // `${engine}|${liveId}|${saveId}` -> {n, distinctive, contra}
    this.ambiguous = new Map(); // saveId -> [liveIds] (possible, never merged)
    this.hist = new Map(); // engine -> Map(liveId -> [values in order])
    this.saveVals = new Map(); // saveId -> numeric value at the last read
    this.sig = '';
    this.lsSig = '';
    this.auto = true;
    this.autoMs = autoMs;
    this.timer = 0;
    this.ticks = 0;
    this.syncing = null;
    this.lastSync = null;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(reason) {
    for (const fn of this.listeners) fn(reason);
  }

  /** First read (once). Resolves to the shared provider or null. */
  ensure() {
    if (!this.ready) {
      this.ready = (async () => {
        try {
          const saved = await this.store.get('save-links', []);
          for (const l of saved || []) this.observed.set(`${l.engine}|${l.liveId}`, l);
        } catch {
          /* no stored links */
        }
        try {
          const t0 = Date.now();
          this.provider = await StorageProvider.create(this.win, this.store, this.collectOpts());
          this.noteRead(t0, this.provider.dump);
          this.sig = signature(this.provider.dump);
          this.lsSig = lsSignature(this.win);
          this.saveVals = numericValues(this.provider);
          this.lastSync = Date.now();
        } catch (e) {
          this.provider = null;
          this.error = e.message || String(e);
        }
        return this.provider;
      })();
    }
    return this.ready;
  }

  /**
   * Re-reads the game's saves (Sync save variables). Pending save edits are never
   * thrown away silently: the hub reports "stale" instead, unless discard is set.
   */
  async sync({ force = false, discard = false } = {}) {
    await this.ensure();
    if (this.syncing) {
      // an automatic sync is running: a forced/discarding one must still run afterwards
      if (!force && !discard) return this.syncing;
      await this.syncing.catch(() => {});
    }
    this.syncing = (async () => {
      try {
        for (const p of this.attached) this.observeLive(p);
        const t0 = Date.now();
        const opts = this.collectOpts();
        const { dump, doc } = await StorageProvider.read(this.win, opts);
        this.noteRead(t0, dump);
        const sig = signature(dump);
        this.lsSig = lsSignature(this.win);
        if (!doc) return { changed: false, error: 'The saves could not be decoded.' };
        if (!force && sig === this.sig) return { changed: false };
        if (this.provider && this.provider.pendingCount() && !discard) {
          if (sig !== this.sig) {
            this.stale = true;
            this.emit('stale');
          }
          return { changed: sig !== this.sig, stale: this.stale };
        }
        const before = this.saveVals;
        if (this.provider) this.provider.replaceData(dump, doc);
        else this.provider = new StorageProvider(this.win, this.store, dump, doc);
        this.provider.collectOpts = opts;
        this.sig = sig;
        this.stale = false;
        this.saveVals = numericValues(this.provider);
        this.matchObservations(before, this.saveVals);
        this.lastSync = Date.now();
        this.emit('synced');
        return { changed: true };
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }

  /** Keeps the trainer in step with the game's saves while it is open. */
  startAuto() {
    if (this.timer || !this.auto) return;
    this.timer = this.win.setInterval(() => this.tick(), this.autoMs);
  }
  stopAuto() {
    if (this.timer) this.win.clearInterval(this.timer);
    this.timer = 0;
  }
  setAuto(v) {
    this.auto = !!v;
    if (this.auto) this.startAuto();
    else this.stopAuto();
  }
  async tick() {
    if (this.syncing || this.isPaused()) return;
    for (const p of this.attached) this.observeLive(p);
    this.ticks++;
    // only localStorage is compared periodically (cheap); IndexedDB is re-read only on request
    const ls = lsSignature(this.win);
    if (ls !== this.lsSig) {
      try {
        await this.sync();
      } catch {
        /* storage temporarily unavailable */
      }
    }
  }

  /** Options for the Storage Bridge read. */
  collectOpts() {
    return { indexedDB: this.includeIndexedDB, maxBinary: this.profile.maxBinary };
  }
  noteRead(t0, dump) {
    this.reads.count++;
    this.reads.lastMs = Date.now() - t0;
    try {
      this.reads.lastBytes = JSON.stringify(dump.localStorage || {}).length + (dump.indexedDB || []).reduce((a, d) => a + JSON.stringify(d).length, 0);
    } catch {
      this.reads.lastBytes = 0;
    }
  }
  /** Reads IndexedDB too (on request: Sync / Saves in storage / Deep scan). */
  async readIndexedDB() {
    this.includeIndexedDB = true;
    return this.sync({ force: true });
  }
  setPaused(p, on) {
    if (on) this.pausedBy.add(p);
    else this.pausedBy.delete(p);
  }
  isPaused() {
    return this.attached.size > 0 && [...this.attached].every((p) => this.pausedBy.has(p));
  }

  attach(p) {
    this.attached.add(p);
    this.observeLive(p);
    this.startAuto();
  }
  detach(p) {
    this.attached.delete(p);
    if (!this.attached.size) this.stopAuto();
  }

  // ---------------------------------------------------------------- observation

  /** Records the value history of a live source's numbers (the evidence for links). */
  observeLive(p) {
    const eng = p.engine?.id || 'live';
    if (!this.hist.has(eng)) this.hist.set(eng, new Map());
    const h = this.hist.get(eng);
    let n = 0;
    // a rotating window per tick: the cost is spread instead of re-reading everything at once
    const cap = this.profile.observeCap ?? 5000;
    const all = p.liveEntries || [];
    const per = Math.min(500, cap);
    if (!this.cursor) this.cursor = new Map();
    const from = (this.cursor.get(p) || 0) % Math.max(1, Math.min(all.length, cap));
    this.cursor.set(p, from + per);
    for (const e of all.slice(from, from + per)) {
      if (n++ > per) break;
      const node = p.node(e.nodeId);
      if (!node || !NUMERIC.has(node.type)) continue;
      let v;
      try {
        v = p.value(e.nodeId);
      } catch {
        continue;
      }
      if (typeof v !== 'number') continue;
      const list = h.get(e.nodeId);
      if (!list) h.set(e.nodeId, [v]);
      else if (list[list.length - 1] !== v) {
        list.push(v);
        if (list.length > 8) list.shift();
      }
    }
  }
  /** Called by the live source when the trainer itself changes a value. */
  noteLive(p, id, before, after) {
    const eng = p.engine?.id || 'live';
    if (!this.hist.has(eng)) this.hist.set(eng, new Map());
    const h = this.hist.get(eng);
    const list = h.get(id) || [];
    if (typeof before === 'number' && list[list.length - 1] !== before) list.push(before);
    if (typeof after === 'number') list.push(after);
    while (list.length > 8) list.shift();
    h.set(id, list);
  }

  matchObservations(before, after) {
    let learned = false;
    for (const [sid, nv] of after) {
      const ov = before.get(sid);
      if (ov === undefined || ov === nv) continue;
      for (const p of this.attached) {
        const eng = p.engine?.id || 'live';
        const h = this.hist.get(eng) || new Map();
        const cands = [];
        for (const [lid, list] of h) {
          const i = list.lastIndexOf(nv);
          if (i > 0 && list.slice(0, i).includes(ov)) cands.push(lid);
        }
        // a verified link the save no longer follows loses its standing
        for (const [k, l] of this.observed) {
          if (!k.startsWith(`${eng}|`) || l.saveId !== sid || cands.includes(l.liveId)) continue;
          l.contra = (l.contra || 0) + 1;
          if (l.contra >= 2) {
            this.observed.delete(k);
            learned = true;
          }
        }
        if (cands.length > 1) this.ambiguous.set(sid, cands.slice(0, 6));
        if (cands.length !== 1) continue;
        const lid = cands[0];
        const key = `${eng}|${lid}|${sid}`;
        const pr = this.pairs.get(key) || { n: 0, distinctive: false };
        pr.n++;
        pr.distinctive = pr.distinctive || distinctive(nv, p, after);
        this.pairs.set(key, pr);
        if (pr.n >= 2 || pr.distinctive) {
          const prev = this.observed.get(`${eng}|${lid}`);
          if (!prev || prev.saveId !== sid) learned = true;
          this.observed.set(`${eng}|${lid}`, { engine: eng, liveId: lid, saveId: sid, n: pr.n, at: Date.now(), detail: `observed: the save changed ${ov} → ${nv} right after the live value did${pr.n > 1 ? ` (${pr.n} times)` : ', a value found nowhere else'}` });
          this.ambiguous.delete(sid);
        }
      }
    }
    if (learned) this.persist();
  }
  persist() {
    this.store.set('save-links', [...this.observed.values()]).catch?.(() => {});
  }
  /** Forget a link (user action). */
  unlink(engine, liveId) {
    this.observed.delete(`${engine}|${liveId}`);
    for (const k of [...this.pairs.keys()]) if (k.startsWith(`${engine}|${liveId}|`)) this.pairs.delete(k);
    this.persist();
    this.emit('synced');
  }

  // ---------------------------------------------------------------- links

  /** Map liveId -> {saveId, how, detail} for one live source. */
  linksFor(p) {
    const out = new Map();
    const sp = this.provider;
    if (!sp) return out;
    const eng = p.engine?.id || 'live';
    for (const l of engineLinks(eng, p, sp)) if (sp.node(l.saveId) && p.node(l.liveId)) out.set(l.liveId, l);
    for (const [k, l] of this.observed) {
      if (!k.startsWith(`${eng}|`) || out.has(l.liveId)) continue;
      if (sp.node(l.saveId) && p.node(l.liveId)) out.set(l.liveId, { liveId: l.liveId, saveId: l.saveId, how: 'observed', detail: l.detail });
    }
    // one save field is never shown under two live variables
    const seen = new Set();
    for (const [lid, l] of [...out]) {
      if (seen.has(l.saveId)) out.delete(lid);
      else seen.add(l.saveId);
    }
    return out;
  }
  possibleFor(saveId) {
    return this.ambiguous.get(saveId) || [];
  }

  /** Writes pending save edits to storage without reloading, then re-reads. */
  async writeNow() {
    const sp = this.provider;
    if (!sp || !sp.pendingCount()) return { written: 0 };
    const r = await sp.applyAndReload({ reload: false });
    await this.sync({ force: true, discard: true });
    return r;
  }
  /** The edited saves as a Storage Bridge export (opens in the SaveForge Save Editor, imports with the bookmarklet). */
  async exportEdited() {
    const sp = this.provider;
    if (!sp) throw new Error('No saves to export.');
    const out = await sp.session.export();
    if (!out.validation.ok) throw new Error(`Verification failed: ${out.validation.problems.slice(0, 3).join('; ')}`);
    return out.bytes;
  }

  dispose() {
    this.stopAuto();
    this.attached.clear();
  }
}

// ---------------------------------------------------------------- engine mappings

function containers(sp, test) {
  const out = [];
  for (const [id, n] of sp.doc.index.byId) {
    if (!n.children || !test(n)) continue;
    out.push({ id, node: n });
  }
  return out;
}
const childKeys = (n) => new Set(n.children.map((c) => c.key));
const childOf = (n, k) => n.children?.find((c) => c.key === k);

/** Documented engine save layouts → live paths. Returns [{liveId, saveId, how, detail}]. */
export function engineLinks(eng, p, sp) {
  const out = [];
  if (eng === 'rpgmaker') {
    const slots = containers(sp, (n) => {
      const k = childKeys(n);
      return k.has('party') && k.has('actors') && k.has('system');
    });
    if (!slots.length) return out;
    const slot = pickRpgSlot(slots, sp);
    const name = slotName(slot.id);
    for (const e of p.liveEntries || []) {
      if (!e.nodeId.startsWith('$/')) continue;
      const saveId = `${slot.id}/${e.nodeId.slice(2)}`;
      if (sp.node(saveId) && !sp.node(saveId).children) out.push({ liveId: e.nodeId, saveId, how: 'engine', detail: `RPG Maker save contents (DataManager.makeSaveContents), ${name}` });
    }
  }
  if (eng === 'sugarcube') {
    // every SugarCube save in the storage (autosave, slots), resolved to its CURRENT moment
    // (delta-encoded history is patched like SugarCube does; delta[0] is only the first moment)
    const saves = containers(sp, (n) => isSugarCubeSaveNode(n));
    if (!saves.length) return out;
    const save = saves.find((x) => /(^|\/)autosave($|\/)|\.auto(\.|$)|autosave/i.test(x.id)) || saves.slice().sort((a, b) => Number(childOf(b.node, 'date')?.value || 0) - Number(childOf(a.node, 'date')?.value || 0))[0];
    const r = resolveSugarCubeSave(save.node);
    if (!r) return out;
    const prefix = '$/state/history/0/variables/';
    for (const e of p.liveEntries || []) {
      if (!e.nodeId.startsWith(prefix)) continue;
      const path = e.nodeId.slice(prefix.length).split('/').map(unesc);
      const cur = r.current.get(pathKey(path));
      if (cur && sp.node(cur.nodeId) && !sp.node(cur.nodeId).children) out.push({ liveId: e.nodeId, saveId: cur.nodeId, how: 'engine', detail: `SugarCube save, current moment ${r.index + 1}/${r.total} (${r.encoding === 'delta' ? `delta-encoded; value stored in delta[${cur.moment}]` : `history[${r.index}]`}), ${slotName(save.id)}` });
    }
  }
  return out;
}

function pickRpgSlot(slots, sp) {
  if (slots.length === 1) return slots[0];
  // RPG Maker MV keeps per-slot timestamps in "RPG Global"
  for (const [id, n] of sp.doc.index.byId) {
    if (!/\/localStorage\/RPG Global$/.test(id) || !n.children) continue;
    let best = null;
    for (const c of n.children) {
      const ts = Number(childOf(c, 'timestamp')?.value || 0);
      if (ts && (!best || ts > best.ts)) best = { ts, i: c.key };
    }
    const hit = best && slots.find((s) => new RegExp(`/RPG File${best.i}$`).test(s.id));
    if (hit) return hit;
  }
  // otherwise: the slot with the most play time at save
  return slots.slice().sort((a, b) => frames(b) - frames(a))[0];
}
function frames(s) {
  return Number(childOf(childOf(s.node, 'system'), '_framesOnSave')?.value || 0);
}
function slotName(id) {
  const seg = id.split('/').map(unesc);
  return seg[1] === 'localStorage' ? `localStorage “${seg[2]}”` : 'save in IndexedDB';
}

// ---------------------------------------------------------------- helpers

function numericValues(sp) {
  const m = new Map();
  if (!sp) return m;
  for (const [id, n] of sp.doc.index.byId) if (!n.children && NUMERIC.has(n.type) && typeof n.value === 'number') m.set(id, n.value);
  return m;
}
function distinctive(v, p, saveVals) {
  if (typeof v !== 'number' || Math.abs(v) < 10) return false;
  let live = 0;
  for (const e of p.liveEntries || []) {
    try {
      if (p.value(e.nodeId) === v) live++;
    } catch {
      /* ignore */
    }
    if (live > 1) return false;
  }
  let save = 0;
  for (const x of saveVals.values()) if (x === v) save++;
  return live === 1 && save === 1;
}
function signature(dump) {
  return hash(JSON.stringify([dump.localStorage, dump.indexedDB]));
}
function lsSignature(win) {
  try {
    const ls = win.localStorage;
    let acc = '';
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (/^saveforge/i.test(k)) continue;
      acc += `${k}=${hash(ls.getItem(k) || '')};`;
    }
    return acc;
  } catch {
    return '';
  }
}
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}`;
}
