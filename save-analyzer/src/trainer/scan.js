// "Find a value": the classic trainer workflow for games whose engine is unknown.
//   1. enter the number you see in the game (e.g. 120 gold) → first scan
//   2. change it in the game (spend some gold), enter the new number → next scan
//   3. repeat until a few candidates remain, then edit / lock them
// It walks everything reachable from the page's globals (own data properties
// only: getters are never run), so it finds values inside engine objects too,
// but it cannot see variables hidden in closures, modules or WebAssembly.

import { childId, makeNode } from '../core/model.js';

const SKIP_TAGS = /^(Window|HTMLDocument|Document|Promise|WeakMap|WeakSet|ArrayBuffer|DataView|RegExp|Error|CanvasRenderingContext2D|WebGL2?RenderingContext|AudioContext|AudioBuffer|Worker|WebSocket|XMLHttpRequest|CSSStyleDeclaration|DOMRect)$/;

function skippable(v) {
  try {
    if (typeof v.nodeType === 'number') return true;
    if (v.window === v) return true;
    const tag = Object.prototype.toString.call(v).slice(8, -1);
    return SKIP_TAGS.test(tag) || (/Array$/.test(tag) && tag !== 'Array' && !/Float|Int|Uint/.test(tag));
  } catch {
    return true;
  }
}

/** Does a live value match what the user sees? Games often show rounded numbers. */
export function matches(v, target, mode = 'approx') {
  let n = v;
  if (typeof v === 'string') {
    if (!/^-?\d+(\.\d+)?$/.test(v.trim())) return false;
    n = Number(v);
  }
  if (typeof n !== 'number' || !Number.isFinite(n)) return false;
  if (n === target) return true;
  if (mode === 'exact') return false;
  return Number.isInteger(target) && (Math.floor(n) === target || Math.round(n) === target);
}

/**
 * First scan. Returns candidate paths (arrays of keys from window).
 * @param opts {maxNodes, timeBudgetMs, mode}
 */
export function firstScan(win, target, { maxNodes = 200000, timeBudgetMs = 2500, mode = 'approx' } = {}) {
  const t0 = Date.now();
  const out = [];
  const seen = new Set();
  let visited = 0;
  let truncated = false;
  const roots = [];
  for (const k of Object.getOwnPropertyNames(win)) {
    if (/^__saveforge/.test(k)) continue;
    let d;
    try {
      d = Object.getOwnPropertyDescriptor(win, k);
    } catch {
      continue;
    }
    if (!d || !('value' in d)) continue;
    roots.push([k, d.value]);
  }
  // breadth-first so shallow, likely-relevant values are found before deep engine internals
  const queue = [];
  for (const [k, v] of roots) {
    if (typeof v === 'number' || typeof v === 'string') {
      if (matches(v, target, mode)) out.push([k]);
    } else if (v && typeof v === 'object' && !skippable(v)) queue.push([v, [k]]);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    if (visited >= maxNodes || (qi % 256 === 0 && Date.now() - t0 > timeBudgetMs)) {
      truncated = true;
      break;
    }
    const [obj, path] = queue[qi];
    queue[qi] = null;
    if (seen.has(obj)) continue;
    seen.add(obj);
    let keys;
    try {
      keys = Object.keys(obj);
    } catch {
      continue;
    }
    if (keys.length > 5000) keys = keys.slice(0, 5000);
    for (const key of keys) {
      visited++;
      let d;
      try {
        d = Object.getOwnPropertyDescriptor(obj, key);
      } catch {
        continue;
      }
      if (!d || !('value' in d)) continue;
      const v = d.value;
      if (typeof v === 'number' || typeof v === 'string') {
        if (matches(v, target, mode) && d.writable !== false) out.push([...path, key]);
      } else if (v && typeof v === 'object' && path.length < 12 && !skippable(v)) queue.push([v, [...path, key]]);
    }
  }
  return { paths: out, visited, truncated, ms: Date.now() - t0 };
}

export function readPath(win, path) {
  let obj = win;
  for (let i = 0; i < path.length; i++) {
    try {
      const d = Object.getOwnPropertyDescriptor(obj, path[i]);
      if (!d || !('value' in d)) return undefined;
      obj = d.value;
    } catch {
      return undefined;
    }
    if (i < path.length - 1 && (obj === null || typeof obj !== 'object')) return undefined;
  }
  return obj;
}

/** Next scan: keep candidates that now show the new value. */
export function nextScan(win, paths, target, mode = 'approx') {
  return paths.filter((p) => matches(readPath(win, p), target, mode));
}

/** Engine object for the "Found values" source (works with LiveProvider). */
export function foundValuesEngine(win, getPaths) {
  return {
    id: 'found',
    name: 'Found values',
    channel: 'live-generic',
    evidence: 'values you located with Find a value',
    note: 'Values you located with Find a value. They are read from and written to the game’s own objects; each edit is read back to verify it.',
    root: () => win,
    snapshot() {
      const root = makeNode('$', 'window', 'object', { children: [] });
      const nodes = new Map([['$', root]]);
      let count = 0;
      for (const path of getPaths()) {
        let parent = root;
        let id = '$';
        path.forEach((key, i) => {
          id = childId(id, key);
          if (i === path.length - 1) {
            if (nodes.has(id)) return;
            const v = readPath(win, path);
            const type = typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'float') : typeof v === 'string' ? 'string' : null;
            if (!type) return;
            const leaf = makeNode(id, key, type, { value: v, editable: true });
            if (type !== 'string') leaf.meta.jsNumber = true;
            leaf.meta.note = 'Found with Find a value.';
            parent.children.push(leaf);
            nodes.set(id, leaf);
            count++;
          } else {
            if (!nodes.has(id)) {
              const n = makeNode(id, key, 'object', { children: [] });
              parent.children.push(n);
              nodes.set(id, n);
            }
            parent = nodes.get(id);
          }
        });
      }
      return { root, refs: new Map(), count, truncated: false };
    },
    sourceOf(id) {
      return `window.${id
        .split('/')
        .slice(1)
        .map((x) => x.replace(/~1/g, '/').replace(/~0/g, '~'))
        .join('.')} (found by scanning)`;
    },
  };
}
