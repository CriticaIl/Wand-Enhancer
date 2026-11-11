// SaveForge 2.3.1: the walkers never enumerate WebAssembly memory or other big binary data.
// An Emscripten-shaped window (HEAP views of one memory, FS with file contents) is walked by
// every walker that runs on activation or on request, with Object.keys instrumented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedKeys, isBinary, isEmscripten, runtimeGlobal, typedArrayScanLimit, wasmBuffers } from '../src/trainer/safe-walk.js';
import { classifyGlobal, sampleNumbers } from '../src/trainer/game-state.js';
import { firstScan } from '../src/trainer/scan.js';
import { buildLiveTree } from '../src/trainer/live-tree.js';

function emscriptenWindow() {
  const wasmMemory = new WebAssembly.Memory({ initial: 256 }); // 16 MB
  const buffer = wasmMemory.buffer;
  const file = (n) => ({ name: 'f', mode: 33206, timestamp: 1, contents: new Uint8Array(n) });
  const win = {
    wasmMemory,
    buffer,
    HEAP8: new Int8Array(buffer),
    HEAPU8: new Uint8Array(buffer),
    HEAP32: new Int32Array(buffer),
    HEAPF64: new Float64Array(buffer),
    Module: { HEAPU8: new Uint8Array(buffer), calledRun: true, dataFileDownloads: { 'renpy.data': {} } },
    FS: { root: { contents: { 'game.zip': file(4 * 1024 * 1024), lib: { contents: { 'a.pyc': file(50000) } } } } },
    GL: { counter: 3 },
    game: { gold: 120, stats: new Float32Array([1, 2, 120]) }, // a small typed array the game keeps itself
  };
  win.window = win;
  return win;
}
function watchKeys(fn) {
  const seen = [];
  const orig = { keys: Object.keys, names: Object.getOwnPropertyNames };
  Object.keys = (v) => (ArrayBuffer.isView(v) && v.length > 100000 && seen.push(`keys ${v.constructor.name}(${v.length})`), orig.keys(v));
  Object.getOwnPropertyNames = (v) => (ArrayBuffer.isView(v) && v.length > 100000 && seen.push(`names ${v.constructor.name}(${v.length})`), orig.names(v));
  try {
    return { out: fn(), seen };
  } finally {
    Object.keys = orig.keys;
    Object.getOwnPropertyNames = orig.names;
  }
}

test('safe-walk: binary data recognised, keys bounded, Emscripten runtime recognised', () => {
  const w = emscriptenWindow();
  for (const v of [w.HEAPU8, w.HEAPF64, w.buffer, w.wasmMemory, new DataView(new ArrayBuffer(8))]) assert.equal(isBinary(v), true);
  for (const v of [{}, [], 'x', 1, null]) assert.equal(isBinary(v), false);
  assert.deepEqual(boundedKeys(w.HEAPU8), []);
  assert.equal(boundedKeys(new Array(1e7).fill(0), 50).length, 50, 'big arrays by index, capped');
  assert.equal(isEmscripten(w), true);
  assert.equal(isEmscripten({ game: {} }), false);
  assert.match(runtimeGlobal('FS', w.FS, true), /Emscripten/);
  assert.match(runtimeGlobal('HEAPU8', w.HEAPU8, false), /binary data/);
  assert.equal(runtimeGlobal('game', w.game, true), null);
  assert.equal(runtimeGlobal('FS', w.FS, false), null, 'names alone only count on Emscripten pages');
  const heaps = wasmBuffers(w);
  assert.equal(typedArrayScanLimit(w.HEAP32, heaps), 0, 'a view of WebAssembly memory is never scanned');
  assert.equal(typedArrayScanLimit(w.game.stats, heaps), 3, 'a small typed array the game keeps is');
});

test('the walkers on an Emscripten window: no enumeration of the heap or of file contents (the 2.3.0 Ren’Py crash)', () => {
  const w = emscriptenWindow();
  // sampleNumbers was called on every page global: HEAPU8 itself was enumerated byte by byte
  const s = watchKeys(() => Object.keys(w).map((k) => sampleNumbers(w[k])));
  assert.deepEqual(s.seen, [], 'sampleNumbers');
  const c = watchKeys(() => Object.keys(w).map((k) => classifyGlobal(k, w[k])));
  assert.deepEqual(c.seen, [], 'classifyGlobal');
  const t = watchKeys(() => buildLiveTree(w, { rootKeys: Object.keys(w).filter((k) => k !== 'window'), maxNodes: 5000 }));
  assert.deepEqual(t.seen, [], 'live tree (All variables raw)');
  const f = watchKeys(() => firstScan(w, 120));
  assert.deepEqual(f.seen, [], 'Find a value');
  const paths = f.out.paths.map((p) => p.join('.'));
  assert.ok(paths.includes('game.gold'), `the game's value is found: ${paths}`);
  assert.ok(paths.includes('game.stats.2'), 'and in the small typed array the game keeps');
  assert.ok(!paths.some((p) => /^(HEAP|buffer|Module|FS|wasmMemory)/.test(p)), 'nothing from the WebAssembly runtime is offered');
});
