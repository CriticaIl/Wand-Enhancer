// SugarCube 2 saves keep the story history, not just the current values:
//   state.history[i] = {title, variables}        (plain history)
//   state.delta[0]   = {title, variables}        (delta-encoded history: the FIRST moment in full,
//   state.delta[k]   = diff(moment k-1, moment k) then one diff per later moment)
//   state.index      = the moment the player is on (not necessarily the last one)
// The values the game uses after loading are those of moment `index`. With delta
// encoding, delta[0] holds the first moment's values; a later diff may have
// replaced them. This module rebuilds the current moment exactly the way
// SugarCube's patch() does and tells, for every variable, which save field
// holds its current value (and which fields are superseded).
//
// SugarCube diff format (lib/helpers.js diff/patch):
//   key: [2, value]                 Copy  (value replaced)
//   key: [3, iso]                   CopyDate
//   key: 0                          Delete
//   key: {…}                        nested diff
//   "~": [1, start, end]            SpliceArray (array elements start..end removed)

const OP_DELETE = 0;
const OP_SPLICE = 1;
const OP_COPY = 2;
const OP_COPY_DATE = 3;
const SEP = '\u0001';

const kid = (n, k) => (n && n.children ? n.children.find((c) => c.key === k) || null : null);
const num = (n) => (n && (n.type === 'int' || n.type === 'float') ? Number(n.value) : NaN);
const isOpNode = (n) => !!n && (n.type === 'array' || n.type === 'list') && n.children && n.children.length >= 2 && (num(n.children[0]) === OP_COPY || num(n.children[0]) === OP_COPY_DATE);
const isSpliceNode = (n) => !!n && (n.type === 'array' || n.type === 'list') && n.children && n.children.length === 3 && num(n.children[0]) === OP_SPLICE;
const isDeleteNode = (n) => !!n && n.type === 'int' && Number(n.value) === OP_DELETE;

export function isSugarCubeSaveNode(n) {
  const st = kid(n, 'state');
  return !!st && !!st.children && (!!kid(st, 'delta') || !!kid(st, 'history'));
}

const memo = new WeakMap();

/**
 * @param saveNode  a SaveForge tree node whose child `state` holds history or delta
 * @returns {encoding, index, total, indexNote, current: Map(pathKey -> {nodeId, moment, path}),
 *           byNode: Map(nodeId -> {path, current: bool, moment, supersededBy?}), opNodes: Set(nodeId)}
 */
export function resolveSugarCubeSave(saveNode) {
  if (memo.has(saveNode)) return memo.get(saveNode);
  const st = kid(saveNode, 'state');
  const delta = kid(st, 'delta');
  const history = kid(st, 'history');
  const moments = delta || history;
  if (!moments || !moments.children || !moments.children.length) return null;
  const total = moments.children.length;
  const idxNode = kid(st, 'index');
  let index = idxNode ? num(idxNode) : total - 1;
  let indexNote = idxNode ? `state.index = ${index}` : 'no state.index: the last moment is the current one';
  if (!(index >= 0 && index < total)) {
    indexNote = `state.index = ${idxNode ? idxNode.value : '?'} is outside the ${total} moment(s); using the last moment`;
    index = total - 1;
  }
  const current = new Map();
  const opNodes = new Set();
  if (history) {
    flatten(kid(moments.children[index], 'variables'), [], current, index);
  } else {
    flatten(kid(moments.children[0], 'variables'), [], current, 0);
    for (let k = 1; k <= index; k++) applyDiff(kid(moments.children[k], 'variables'), [], current, k, opNodes);
    for (let k = index + 1; k < total; k++) collectOps(kid(moments.children[k], 'variables'), opNodes);
  }
  const byNode = new Map();
  for (const [key, v] of current) byNode.set(v.nodeId, { path: v.path, current: true, moment: v.moment });
  // every other variable value in any moment is superseded (an older or a future moment)
  for (let k = 0; k < total; k++) {
    const isDiff = !!delta && k > 0; // delta[0] and history moments are plain values
    walkVars(kid(moments.children[k], 'variables'), [], opNodes, isDiff, (leaf, path) => {
      if (byNode.has(leaf.id)) return;
      const cur = current.get(path.join(SEP));
      byNode.set(leaf.id, { path, current: false, moment: k, supersededBy: cur ? cur.moment : null });
    });
  }
  const res = { encoding: delta ? 'delta' : 'history', index, total, indexNote, current, byNode, opNodes };
  memo.set(saveNode, res);
  return res;
}

/** Variable path (array of keys) → display "$player.money". */
export function displayPath(path) {
  return `$${path.join('.')}`;
}
export function pathKey(path) {
  return path.join(SEP);
}

function flatten(node, prefix, map, moment) {
  if (!node) return;
  if (!node.children) {
    map.set(prefix.join(SEP), { nodeId: node.id, moment, path: prefix });
    return;
  }
  for (const c of node.children) flatten(c, [...prefix, c.key], map, moment);
}

function dropPrefix(map, prefix) {
  const p = prefix.join(SEP);
  for (const k of [...map.keys()]) if (k === p || k.startsWith(p + SEP)) map.delete(k);
}

function applyDiff(d, prefix, map, moment, opNodes) {
  if (!d) return;
  if (isDeleteNode(d)) {
    dropPrefix(map, prefix);
    opNodes.add(d.id);
    return;
  }
  if (isOpNode(d)) {
    opNodes.add(d.children[0].id);
    dropPrefix(map, prefix);
    flatten(d.children[1], prefix, map, moment);
    return;
  }
  if (!d.children) return;
  // patch() order: integer keys first (ascending), then the others; "~" splices last
  const kids = [...d.children].sort((a, b) => {
    const ai = /^\d+$/.test(a.key);
    const bi = /^\d+$/.test(b.key);
    if (ai && bi) return Number(a.key) - Number(b.key);
    return ai ? -1 : bi ? 1 : 0;
  });
  for (const c of kids) {
    if (/^~+$/.test(c.key) && isSpliceNode(c)) {
      opNodes.add(c.id);
      for (const x of c.children) opNodes.add(x.id);
      splice(map, prefix, num(c.children[1]), num(c.children[2]));
      continue;
    }
    applyDiff(c, [...prefix, c.key], map, moment, opNodes);
  }
}

function splice(map, prefix, start, end) {
  const p = prefix.join(SEP);
  const n = end - start + 1;
  const moved = [];
  for (const [k, v] of [...map]) {
    if (!k.startsWith(p + SEP)) continue;
    const rest = k.slice(p.length + 1).split(SEP);
    const i = Number(rest[0]);
    if (!/^\d+$/.test(rest[0])) continue;
    map.delete(k);
    if (i >= start && i <= end) continue;
    if (i > end) rest[0] = String(i - n);
    moved.push([rest, v]);
  }
  for (const [rest, v] of moved) {
    const path = [...prefix, ...rest];
    map.set(path.join(SEP), { ...v, path });
  }
}

function collectOps(d, opNodes) {
  if (!d) return;
  if (isDeleteNode(d)) return void opNodes.add(d.id);
  if (isOpNode(d)) return void opNodes.add(d.children[0].id);
  if (isSpliceNode(d)) {
    opNodes.add(d.id);
    for (const x of d.children) opNodes.add(x.id);
    return;
  }
  for (const c of d.children || []) collectOps(c, opNodes);
}

/** Visits variable values in a moment or diff; "[2, value]" wrappers are not part of the path. */
function walkVars(node, prefix, opNodes, isDiff, fn) {
  if (!node) return;
  if (isDiff) {
    if (isDeleteNode(node) && prefix.length) return void opNodes.add(node.id);
    if (isSpliceNode(node)) {
      opNodes.add(node.id);
      for (const x of node.children) opNodes.add(x.id);
      return;
    }
    if (isOpNode(node)) {
      opNodes.add(node.children[0].id);
      return walkVars(node.children[1], prefix, opNodes, false, fn); // the copied value is plain data
    }
  }
  if (!node.children) return void fn(node, prefix);
  for (const c of node.children) walkVars(c, [...prefix, c.key], opNodes, isDiff, fn);
}

// ---------------------------------------------------------------- plain-JS decoding (live bridge, tests)

/** Rebuilds the full history from a delta array exactly like SugarCube's historyDeltaDecode. */
export function decodeDelta(delta) {
  if (!Array.isArray(delta) || !delta.length) return [];
  const history = [clone(delta[0])];
  for (let i = 1; i < delta.length; i++) history.push(patch(history[i - 1], delta[i]));
  return history;
}
function patch(orig, diffed) {
  const out = clone(orig);
  for (const key of Object.keys(diffed || {})) {
    const d = diffed[key];
    if (d === OP_DELETE) delete out[key];
    else if (Array.isArray(d)) {
      if (d[0] === OP_SPLICE) out.splice(d[1], 1 + (d[2] - d[1]));
      else if (d[0] === OP_COPY) out[key] = clone(d[1]);
      else if (d[0] === OP_COPY_DATE) out[key] = new Date(d[1]);
    } else out[key] = patch(out[key], d);
  }
  return out;
}
function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}
