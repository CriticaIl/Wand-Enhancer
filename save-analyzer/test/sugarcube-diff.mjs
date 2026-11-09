// Reference implementation of SugarCube 2's history delta encoding (lib/helpers.js
// diff + State historyDeltaEncode), used to build realistic test saves. Kept
// separate from the code under test so the resolver is checked against an
// independent encoder.

const DiffOp = { Delete: 0, SpliceArray: 1, Copy: 2, CopyDate: 3 };
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const isNumeric = (k) => /^\d+$/.test(k);

export function diff(orig, dest) {
  const origIsArray = Array.isArray(orig);
  const keys = [...Object.keys(orig), ...Object.keys(dest)].sort().filter((v, i, a) => i === 0 || a[i - 1] !== v);
  const diffed = {};
  let aOpRef;
  for (const key of keys) {
    const o = orig[key];
    const d = dest[key];
    if (Object.prototype.hasOwnProperty.call(orig, key)) {
      if (Object.prototype.hasOwnProperty.call(dest, key)) {
        if (o === d) continue;
        if (typeof o === typeof d && typeof o === 'object' && o !== null && d !== null && Array.isArray(o) === Array.isArray(d)) {
          const r = diff(o, d);
          if (r !== null) diffed[key] = r;
        } else diffed[key] = [DiffOp.Copy, clone(d)];
      } else if (origIsArray && isNumeric(key)) {
        const n = Number(key);
        if (!aOpRef) {
          aOpRef = '';
          do aOpRef += '~';
          while (keys.includes(aOpRef));
          diffed[aOpRef] = [DiffOp.SpliceArray, n, n];
        }
        if (n < diffed[aOpRef][1]) diffed[aOpRef][1] = n;
        if (n > diffed[aOpRef][2]) diffed[aOpRef][2] = n;
      } else diffed[key] = DiffOp.Delete;
    } else diffed[key] = [DiffOp.Copy, clone(d)];
  }
  return Object.keys(diffed).length ? diffed : null;
}

export function historyDeltaEncode(history) {
  if (!history.length) return [];
  const delta = [clone(history[0])];
  for (let i = 1; i < history.length; i++) delta.push(diff(history[i - 1], history[i]) || {});
  return delta;
}
