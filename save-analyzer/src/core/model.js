// Common tree model shown by the UI, independent of the underlying format.
//
// Node = {
//   id: string            unique, stable path id (used as edit key)
//   key: string           display key
//   type: 'object'|'array'|'dict'|'list'|'tuple'|'set'|'instance'|'embedded'|'zip'
//        |'string'|'int'|'float'|'bool'|'null'|'bytes'|'ref'|'opaque'
//   value: primitive value for leaves (int may be BigInt)
//   editable: boolean
//   children: Node[] | null
//   meta: { className?, note?, encoding?, readOnlyReason?, refTo?, size? }
// }

export const EDITABLE_TYPES = new Set(['string', 'int', 'float', 'bool']);

export function escapeSegment(seg) {
  return String(seg).replace(/~/g, '~0').replace(/\//g, '~1');
}

export function childId(parentId, seg) {
  return `${parentId}/${escapeSegment(seg)}`;
}

export function makeNode(id, key, type, extra = {}) {
  return { id, key: String(key), type, value: undefined, editable: false, children: null, meta: {}, ...extra };
}

export function isContainer(node) {
  return Array.isArray(node.children);
}

export function walk(node, fn, parents = []) {
  if (fn(node, parents) === false) return;
  if (node.children) {
    parents.push(node);
    for (const c of node.children) walk(c, fn, parents);
    parents.pop();
  }
}

export function indexTree(root) {
  const byId = new Map();
  const parentOf = new Map();
  walk(root, (n, parents) => {
    byId.set(n.id, n);
    if (parents.length) parentOf.set(n.id, parents[parents.length - 1].id);
  });
  return { byId, parentOf };
}

export function pathOf(id, index) {
  const out = [];
  let cur = index.byId.get(id);
  while (cur) {
    out.unshift(cur);
    const p = index.parentOf.get(cur.id);
    cur = p ? index.byId.get(p) : null;
  }
  return out;
}

/** Validates and coerces a user-entered value for a node. Throws with a readable message. */
export function coerceValue(node, input) {
  switch (node.type) {
    case 'bool':
      if (typeof input === 'boolean') return input;
      if (input === 'true' || input === '1') return true;
      if (input === 'false' || input === '0') return false;
      throw new Error('Expected true or false');
    case 'int': {
      const s = String(input).trim();
      if (!/^-?\d+$/.test(s)) throw new Error('Expected a whole number');
      const big = BigInt(s);
      const limit = node.meta.intLimit;
      if (limit && (big < limit[0] || big > limit[1])) throw new Error(`Out of range for this format (${limit[0]} … ${limit[1]})`);
      return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
    }
    case 'float': {
      const s = String(input).trim();
      if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) throw new Error('Expected a number');
      const v = Number(s);
      if (!Number.isFinite(v)) throw new Error('Number is not finite');
      return v;
    }
    case 'string':
      if (typeof input !== 'string') return String(input);
      if (node.meta.maxBytes && new TextEncoder().encode(input).length > node.meta.maxBytes) throw new Error('Text too long for this field');
      return input;
    default:
      throw new Error(`${node.type} values cannot be edited`);
  }
}

export function sameValue(a, b) {
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    try {
      return BigInt(a) === BigInt(b);
    } catch {
      return false;
    }
  }
  return Object.is(a, b) || a === b;
}

export function formatValue(v) {
  if (v === null) return 'null';
  if (v === undefined) return '';
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}

/** Edits under a given id prefix (inclusive). */
export function editsUnder(edits, prefix) {
  const out = new Map();
  for (const [id, v] of edits) if (id === prefix || id.startsWith(prefix + '/')) out.set(id, v);
  return out;
}
