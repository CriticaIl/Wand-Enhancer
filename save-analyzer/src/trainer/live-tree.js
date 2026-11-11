// Snapshot live JavaScript objects into SaveForge's tree model, keeping a
// reference to the owning object of every primitive so it can be edited in place.
//
// Safety: only own *data* properties are read (getters are never invoked,
// functions are never called), DOM nodes / windows / typed arrays / Maps are
// skipped, cycles become 'ref' nodes, and the walk is capped by node count and
// depth so huge engine object graphs stay responsive.

import { childId, makeNode } from '../core/model.js';
import { boundedKeys, isBinary } from './safe-walk.js';

const SKIP_TAGS = new Set(['Window', 'HTMLDocument', 'Document', 'Promise', 'WeakMap', 'WeakSet', 'Map', 'Set', 'ArrayBuffer', 'DataView', 'RegExp', 'Error', 'CanvasRenderingContext2D', 'WebGLRenderingContext', 'WebGL2RenderingContext', 'AudioContext', 'AudioBuffer', 'Image', 'HTMLImageElement', 'HTMLCanvasElement', 'Worker', 'WebSocket', 'XMLHttpRequest']);

function tagOf(v) {
  return Object.prototype.toString.call(v).slice(8, -1);
}

function skippable(v) {
  if (typeof v !== 'object' || v === null) return false;
  if (typeof v.nodeType === 'number' && typeof v.nodeName === 'string') return true; // DOM
  if (isBinary(v)) return true; // typed arrays, ArrayBuffers, WebAssembly memory
  const tag = tagOf(v);
  if (SKIP_TAGS.has(tag) || /Array$/.test(tag) && tag !== 'Array') return true; // typed arrays
  try {
    if (v.window === v) return true;
  } catch {
    return true; // cross-origin object
  }
  return false;
}

/**
 * @param rootObj  object to walk
 * @param opts {rootKeys?: string[], maxNodes?, maxDepth?, skipKey?(key, depth, obj) => bool, prefix?,
 *              rootBudget?: max nodes under one root key (so one huge global cannot starve the others),
 *              maxStrings?: max text values under one root key (numbers and switches are never skipped for text),
 *              rootGetters?: {key: () => value} explicit roots read through a documented engine getter}
 * @returns {root, refs: Map<id, {obj, key}>, count, truncated, report}
 *   report: {roots: {key: {nodes, strings, skippedStrings, cut, depthLimited}}, getters: [id], gettersCount,
 *            depthLimited, skipped: {tag: n}}  — what was NOT reached and why (Diagnostics)
 */
export function createLiveTreeWalker(rootObj, opts = {}) {
  const { rootKeys = null, maxNodes = 60000, maxDepth = 14, skipKey = null, prefix = '$', rootLabel = '(live)', rootBudget = Infinity, maxStrings = Infinity, rootGetters = null, priorityRoots = null } = opts;
  const refs = new Map();
  const seen = new Map();
  let count = 0;
  let truncated = false;
  const report = { roots: {}, getters: [], gettersCount: 0, depthLimited: 0, skipped: {} };
  const rs = (k) => report.roots[k] || (report.roots[k] = { nodes: 0, strings: 0, skippedStrings: 0, cut: false, depthLimited: 0 });
  const root = makeNode(prefix, rootLabel, Array.isArray(rootObj) ? 'array' : 'object', { children: [] });
  seen.set(rootObj, prefix);

  // iterative BFS so depth-first deep chains cannot starve shallow, useful values
  const queue = [{ obj: rootObj, node: root, depth: 0, keys: rootKeys, rk: null }];
  // resumable: step(deadline) walks until the deadline and continues where it stopped,
  // so a big game can be scanned in small slices while it keeps running
  let qi = 0;
  let cur = null;
  // items of very large arrays (NPC lists, tile maps…) are read after everything else, so
  // named game state (player, inventory, stats) is reached first within the same budget
  // order: priority roots (likely game state) → other roots → items of very large arrays.
  // Nothing is dropped by this ordering; it only decides what is read first within the budget.
  const lowQ = [];
  const bigQ = []; // large arrays inside priority roots
  const bigLowQ = []; // large arrays elsewhere
  const BIG_ARRAY = 256;
  function step(deadline = Infinity, signal = null) {
    let n = 0;
    for (;;) {
      if (!cur) {
        if (qi >= queue.length) {
          // game state → its large lists → other globals → their large lists
          const next = bigQ.length ? bigQ : lowQ.length ? lowQ : bigLowQ;
          if (next.length) queue.push(...next.splice(0));
        }
        if (qi >= queue.length) return true;
        const item = queue[qi];
        queue[qi++] = null; // release for GC
        let names;
        try {
          // arrays by index, capped: Object.keys on a 10-million-item array is itself a memory spike
          names = item.keys || boundedKeys(item.obj, Math.max(maxNodes, 10000));
        } catch {
          continue;
        }
        cur = { ...item, names, ki: 0 };
      }
      const { obj, node, depth, rk, names } = cur;
      while (cur.ki < names.length) {
        if ((++n & 63) === 0 && (now() > deadline || (signal && signal.aborted))) return false;
        const key = names[cur.ki++];
      if (count >= maxNodes) {
        truncated = true;
        break;
      }
      const r = rk ?? (depth === 0 ? String(key) : null);
      const st = r !== null ? rs(r) : null;
      if (st && st.nodes >= rootBudget) {
        st.cut = true;
        truncated = true;
        break;
      }
      if (skipKey && skipKey(key, depth, obj)) continue;
      let v;
      let writable = true;
      const getter = depth === 0 && rootGetters && Object.prototype.hasOwnProperty.call(rootGetters, key) ? rootGetters[key] : null;
      if (getter) {
        try {
          v = getter();
        } catch {
          continue;
        }
      } else {
        let desc;
        try {
          desc = Object.getOwnPropertyDescriptor(obj, key);
        } catch {
          continue;
        }
        if (!desc) continue;
        if (!('value' in desc)) {
          // accessor: never invoke getters, but say where they are
          report.gettersCount++;
          if (report.getters.length < 60) report.getters.push(childId(node.id, key));
          continue;
        }
        v = desc.value;
        writable = desc.writable !== false;
      }
      const id = childId(node.id, key);
      let child = null;
      switch (typeof v) {
        case 'number':
          if (!Number.isFinite(v)) continue;
          child = makeNode(id, key, Number.isInteger(v) ? 'int' : 'float', { value: v, editable: writable });
          child.meta.jsNumber = true;
          break;
        case 'boolean':
          child = makeNode(id, key, 'bool', { value: v, editable: writable });
          break;
        case 'string':
          if (v.length > 4096) continue;
          if (st && st.strings >= maxStrings) {
            st.skippedStrings++;
            continue;
          }
          if (st) st.strings++;
          child = makeNode(id, key, 'string', { value: v, editable: writable });
          break;
        case 'object':
          if (v === null) {
            child = makeNode(id, key, 'null', { value: null });
            break;
          }
          if (skippable(v)) {
            const tag = tagOf(v);
            if (/^(Map|Set|WeakMap|WeakSet|Promise)$/.test(tag) || (/Array$/.test(tag) && tag !== 'Array')) report.skipped[tag] = (report.skipped[tag] || 0) + 1;
            continue;
          }
          if (seen.has(v)) {
            child = makeNode(id, key, 'ref', { value: seen.get(v) });
            child.meta.refTo = seen.get(v);
            child.meta.note = 'Same object as another location.';
            break;
          }
          if (depth + 1 >= maxDepth) {
            truncated = true;
            report.depthLimited++;
            if (st) st.depthLimited++;
            continue;
          }
          seen.set(v, id);
          child = makeNode(id, key, Array.isArray(v) ? 'array' : 'object', { children: [] });
          {
            const proto = Object.getPrototypeOf(v);
            const ctor = proto && proto !== Object.prototype && proto !== Array.prototype && proto.constructor && proto.constructor.name;
            if (ctor) child.meta.className = ctor;
          }
          const low = priorityRoots && r !== null && !priorityRoots.has(r);
          (Array.isArray(obj) && names.length > BIG_ARRAY ? (low ? bigLowQ : bigQ) : low ? lowQ : queue).push({ obj: v, node: child, depth: depth + 1, keys: null, rk: r });
          break;
        default:
          continue; // functions, symbols, undefined, bigint
      }
      if (!child.children) refs.set(id, { obj, key });
      node.children.push(child);
      count++;
      if (st) st.nodes++;
      }
      cur = null;
    }
  }
  return {
    step,
    result: () => ({ root, refs, count, truncated, report }),
    progress: () => ({ count, pending: queue.length - qi + lowQ.length + bigQ.length + bigLowQ.length + (cur ? 1 : 0) }),
  };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Synchronous walk (small trees, tests). */
export function buildLiveTree(rootObj, opts = {}) {
  const w = createLiveTreeWalker(rootObj, opts);
  w.step(Infinity);
  return w.result();
}

/**
 * Time-sliced walk: works for at most `sliceMs` at a time, then yields so the game can
 * render frames. `signal.aborted` (Stop scanning) ends it early with what was found so far
 * (marked stopped, never silently).
 */
export async function buildLiveTreeAsync(rootObj, opts = {}, { sliceMs = 8, signal = null, yieldFn = defaultYield, onProgress = null } = {}) {
  const w = createLiveTreeWalker(rootObj, opts);
  for (;;) {
    const done = w.step(now() + sliceMs, signal);
    if (onProgress) onProgress(w.progress());
    if (done) return w.result();
    if (signal && signal.aborted) {
      const r = w.result();
      r.truncated = true;
      r.stopped = true;
      return r;
    }
    await yieldFn();
  }
}
const defaultYield = () => new Promise((r) => setTimeout(r, 0));

/** Converts user input to a JS value for a live node (JS has a single number type). */
export function coerceLive(node, input) {
  if (node.type === 'bool') {
    if (typeof input === 'boolean') return input;
    if (input === 'true' || input === '1') return true;
    if (input === 'false' || input === '0') return false;
    throw new Error('Expected true or false');
  }
  if (node.type === 'int' || node.type === 'float') {
    const s = String(input).trim();
    if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) throw new Error('Expected a number');
    const v = Number(s);
    if (!Number.isFinite(v)) throw new Error('Number is not finite');
    return v;
  }
  if (node.type === 'string') return String(input);
  throw new Error(`${node.type} values cannot be edited`);
}
