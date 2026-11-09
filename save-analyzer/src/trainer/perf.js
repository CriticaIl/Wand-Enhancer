// Performance and stability: scan profiles, time slicing, a stage log for
// Performance Diagnostics, and a startup marker that detects an interrupted start
// (for example the tab crashed or was reloaded while SaveForge was scanning).

/** Scan profiles. Smart Scan (low memory) reads gameplay first and stops early; it never hides
 *  what it did not read: the counts and a Deep scan button are shown. */
export const PROFILES = {
  low: { name: 'Smart Scan (low memory)', maxNodes: 30000, rootBudget: 20000, textCap: 1000, depth: 8, learnEveryMs: 4000, relearnMinMs: 20000, observeCap: 1000, hubAutoMs: 5000, readIndexedDB: false, maxBinary: 512 * 1024, sliceMs: 6 },
  normal: { name: 'Standard scan', maxNodes: 90000, rootBudget: 20000, textCap: 4000, depth: 10, learnEveryMs: 2000, relearnMinMs: 10000, observeCap: 5000, hubAutoMs: 2500, readIndexedDB: false, maxBinary: 4 * 1024 * 1024, sliceMs: 10 },
  deep: { name: 'Deep scan', maxNodes: 300000, rootBudget: 120000, textCap: 60000, depth: 14, learnEveryMs: 2000, relearnMinMs: 15000, observeCap: 5000, hubAutoMs: 2500, readIndexedDB: true, maxBinary: 16 * 1024 * 1024, sliceMs: 12 },
};

/** Phones and small-memory devices get Low Memory Mode by default. */
export function isLowMemoryDevice(win) {
  try {
    const n = win.navigator;
    if (typeof n.deviceMemory === 'number' && n.deviceMemory <= 4) return true;
    const touch = (n.maxTouchPoints || 0) > 0;
    const small = Math.min(win.screen?.width || 9999, win.screen?.height || 9999) <= 900;
    return touch && small;
  } catch {
    return false;
  }
}

/**
 * Effective settings: profile + user overrides.
 * saved: {lowMemory: true|false|null(auto), depth, maxNodes, background: 'off'|'slow'|'normal', readIndexedDB}
 */
export function resolveSettings(saved = {}, win) {
  const low = saved.lowMemory === null || saved.lowMemory === undefined ? isLowMemoryDevice(win) : !!saved.lowMemory;
  const p = { ...(low ? PROFILES.low : PROFILES.normal), lowMemory: low, lowMemoryAuto: saved.lowMemory === null || saved.lowMemory === undefined };
  if (Number(saved.depth) > 0) p.depth = Number(saved.depth);
  if (Number(saved.maxNodes) > 0) {
    p.maxNodes = Number(saved.maxNodes);
    p.rootBudget = Math.max(p.rootBudget, Math.round(p.maxNodes / 3));
  }
  if (saved.background === 'off') (p.learnEveryMs = 0), (p.hubAutoMs = 0);
  else if (saved.background === 'slow') (p.learnEveryMs = Math.max(p.learnEveryMs, 10000)), (p.relearnMinMs = Math.max(p.relearnMinMs, 120000)), (p.hubAutoMs = Math.max(p.hubAutoMs, 10000));
  if (typeof saved.readIndexedDB === 'boolean') p.readIndexedDB = saved.readIndexedDB;
  p.background = saved.background || 'auto';
  p.keepResults = saved.keepResults !== false;
  return p;
}

export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Yields to the browser so the game can render (one macrotask). */
export const yieldTo = (win) => new Promise((r) => (win && win.setTimeout ? win.setTimeout(r, 0) : setTimeout(r, 0)));

/** A stoppable task (Stop scanning). */
export function createSignal() {
  const s = { aborted: false, reason: '', abort(reason = 'stopped') {
    s.aborted = true;
    s.reason = reason;
  } };
  return s;
}

/** Stage log for Performance Diagnostics. */
export class PerfLog {
  constructor(win) {
    this.win = win;
    this.stages = [];
    this.current = null;
    this.counters = {};
  }
  start(name, detail = '') {
    const st = { name, detail, start: now(), ms: null, done: false };
    this.stages.push(st);
    if (this.stages.length > 60) this.stages.shift();
    this.current = st;
    markStartup(this.win, name);
    return st;
  }
  end(st, extra = {}) {
    if (!st) return;
    st.ms = Math.round(now() - st.start);
    st.done = true;
    Object.assign(st, extra);
    if (this.current === st) this.current = null;
  }
  async time(name, fn, extra) {
    const st = this.start(name);
    try {
      const r = await fn(st);
      this.end(st, typeof extra === 'function' ? extra(r) : extra);
      return r;
    } catch (e) {
      this.end(st, { error: e.message });
      throw e;
    }
  }
  count(k, n = 1) {
    this.counters[k] = (this.counters[k] || 0) + n;
  }
  lastCompleted() {
    for (let i = this.stages.length - 1; i >= 0; i--) if (this.stages[i].done) return this.stages[i];
    return null;
  }
  memory() {
    try {
      const m = this.win.performance && this.win.performance.memory;
      if (m && m.usedJSHeapSize) return { usedMB: Math.round(m.usedJSHeapSize / 1048576), limitMB: Math.round(m.jsHeapSizeLimit / 1048576) };
    } catch {
      /* not available */
    }
    return null; // Safari does not expose JavaScript memory use
  }
}

// ---------------------------------------------------------------- interrupted startup

const KEY = '__saveforge_startup';
/** Written synchronously to sessionStorage (it survives a tab reload after a crash). */
export function markStartup(win, stage) {
  try {
    const cur = JSON.parse(win.sessionStorage.getItem(KEY) || 'null');
    const rec = cur && cur.open ? { ...cur, stage, at: Date.now() } : { open: true, stage, started: Date.now(), at: Date.now() };
    win.sessionStorage.setItem(KEY, JSON.stringify(rec));
  } catch {
    /* storage blocked: no detection */
  }
}
export function finishStartup(win) {
  try {
    win.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
/** A previous start that never finished (and is not still running in this page). */
export function interruptedStartup(win) {
  try {
    const rec = JSON.parse(win.sessionStorage.getItem(KEY) || 'null');
    if (!rec || !rec.open) return null;
    if (win.__saveforgeStarting) return null; // a start running right now in this page
    return rec;
  } catch {
    return null;
  }
}
