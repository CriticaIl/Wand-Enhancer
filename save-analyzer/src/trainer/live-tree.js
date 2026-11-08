// Snapshot live JavaScript objects into SaveForge's tree model, keeping a
// reference to the owning object of every primitive so it can be edited in place.
//
// Safety: only own *data* properties are read (getters are never invoked,
// functions are never called), DOM nodes / windows / typed arrays / Maps are
// skipped, cycles become 'ref' nodes, and the walk is capped by node count and
// depth so huge engine object graphs stay responsive.

import { childId, makeNode } from '../core/model.js';

const SKIP_TAGS = new Set(['Window', 'HTMLDocument', 'Document', 'Promise', 'WeakMap', 'WeakSet', 'Map', 'Set', 'ArrayBuffer', 'DataView', 'RegExp', 'Error', 'CanvasRenderingContext2D', 'WebGLRenderingContext', 'WebGL2RenderingContext', 'AudioContext', 'AudioBuffer', 'Image', 'HTMLImageElement', 'HTMLCanvasElement', 'Worker', 'WebSocket', 'XMLHttpRequest']);

function tagOf(v) {
  return Object.prototype.toString.call(v).slice(8, -1);
}

function skippable(v) {
  if (typeof v !== 'object' || v === null) return false;
  if (typeof v.nodeType === 'number' && typeof v.nodeName === 'string') return true; // DOM
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
 * @param opts {rootKeys?: string[], maxNodes?, maxDepth?, skipKey?(key, depth, obj) => bool, prefix?}
 * @returns {root, refs: Map<id, {obj, key}>, count, truncated}
 */
export function buildLiveTree(rootObj, opts = {}) {
  const { rootKeys = null, maxNodes = 60000, maxDepth = 14, skipKey = null, prefix = '$', rootLabel = '(live)' } = opts;
  const refs = new Map();
  const seen = new Map();
  let count = 0;
  let truncated = false;
  const root = makeNode(prefix, rootLabel, Array.isArray(rootObj) ? 'array' : 'object', { children: [] });
  seen.set(rootObj, prefix);

  // iterative BFS so depth-first deep chains cannot starve shallow, useful values
  const queue = [{ obj: rootObj, node: root, depth: 0, keys: rootKeys }];
  for (let qi = 0; qi < queue.length; qi++) {
    const { obj, node, depth, keys } = queue[qi];
    queue[qi] = null; // release for GC
    let names;
    try {
      names = keys || Object.keys(obj);
    } catch {
      continue;
    }
    for (const key of names) {
      if (count >= maxNodes) {
        truncated = true;
        break;
      }
      if (skipKey && skipKey(key, depth, obj)) continue;
      let desc;
      try {
        desc = Object.getOwnPropertyDescriptor(obj, key);
      } catch {
        continue;
      }
      if (!desc || !('value' in desc)) continue; // accessor: never invoke getters
      const v = desc.value;
      const id = childId(node.id, key);
      let child = null;
      switch (typeof v) {
        case 'number':
          if (!Number.isFinite(v)) continue;
          child = makeNode(id, key, Number.isInteger(v) ? 'int' : 'float', { value: v, editable: desc.writable !== false });
          child.meta.jsNumber = true;
          break;
        case 'boolean':
          child = makeNode(id, key, 'bool', { value: v, editable: desc.writable !== false });
          break;
        case 'string':
          if (v.length > 4096) continue;
          child = makeNode(id, key, 'string', { value: v, editable: desc.writable !== false });
          break;
        case 'object':
          if (v === null) {
            child = makeNode(id, key, 'null', { value: null });
            break;
          }
          if (skippable(v)) continue;
          if (seen.has(v)) {
            child = makeNode(id, key, 'ref', { value: seen.get(v) });
            child.meta.refTo = seen.get(v);
            child.meta.note = 'Same object as another location.';
            break;
          }
          if (depth + 1 >= maxDepth) {
            truncated = true;
            continue;
          }
          seen.set(v, id);
          child = makeNode(id, key, Array.isArray(v) ? 'array' : 'object', { children: [] });
          {
            const proto = Object.getPrototypeOf(v);
            const ctor = proto && proto !== Object.prototype && proto !== Array.prototype && proto.constructor && proto.constructor.name;
            if (ctor) child.meta.className = ctor;
          }
          queue.push({ obj: v, node: child, depth: depth + 1, keys: null });
          break;
        default:
          continue; // functions, symbols, undefined, bigint
      }
      if (!child.children) refs.set(id, { obj, key });
      node.children.push(child);
      count++;
    }
  }
  return { root, refs, count, truncated };
}

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
