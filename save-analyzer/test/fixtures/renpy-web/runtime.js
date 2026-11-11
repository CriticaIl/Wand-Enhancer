// Emulated Emscripten runtime + Ren'Py, as page globals (top-level var, like renpy.js).
var __q = new URLSearchParams(location.search);
var Module = typeof Module != 'undefined' ? Module : {};
Module.expectedDataFileDownloads = 1;
Module.dataFileDownloads = { 'renpy.data': { loaded: 15169254, total: 15169254 } };
Module.canvas = document.getElementById('canvas');
Module.print = function () {};
Module.arguments = [];
var INITIAL_MEMORY = Number(__q.get('mem') || 192) * 1024 * 1024;
var wasmMemory = new WebAssembly.Memory({ initial: INITIAL_MEMORY / 65536, maximum: 32768 });
var buffer, HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
function updateMemoryViews() {
  buffer = wasmMemory.buffer;
  Module.HEAP8 = HEAP8 = new Int8Array(buffer);
  Module.HEAP16 = HEAP16 = new Int16Array(buffer);
  Module.HEAP32 = HEAP32 = new Int32Array(buffer);
  Module.HEAPU8 = HEAPU8 = new Uint8Array(buffer);
  Module.HEAPU16 = HEAPU16 = new Uint16Array(buffer);
  Module.HEAPU32 = HEAPU32 = new Uint32Array(buffer);
  Module.HEAPF32 = HEAPF32 = new Float32Array(buffer);
  Module.HEAPF64 = HEAPF64 = new Float64Array(buffer);
}
updateMemoryViews();
// the running interpreter keeps changing its memory (counters, the Python heap…)
for (var __i = 0; __i < 4096; __i++) HEAP32[__i * 97] = __i;
var wasmTable = new WebAssembly.Table({ initial: 4096, element: 'anyfunc' });
// ---- virtual filesystem (MEMFS): the runtime files and the game, as Uint8Arrays
function __node(name, parent, contents) {
  return { name: name, parent: parent, mode: contents ? 33206 : 16895, rdev: 0, id: Math.floor(Math.random() * 1e9), timestamp: Date.now(), usedBytes: contents ? contents.length : 0, contents: contents || {}, node_ops: {}, stream_ops: {} };
}
var FS = { root: __node('/', null), streams: [], nextInode: 1, currentPath: '/', ErrnoError: function () {}, filesystems: {} };
FS.root.parent = FS.root;
function __mkdir(path) {
  var n = FS.root;
  path.split('/').filter(Boolean).forEach(function (seg) {
    if (!n.contents[seg]) n.contents[seg] = __node(seg, n);
    n = n.contents[seg];
  });
  return n;
}
function __file(path, bytes) {
  var dir = __mkdir(path.split('/').slice(0, -1).join('/'));
  var name = path.split('/').pop();
  dir.contents[name] = __node(name, dir, bytes);
}
(function () {
  var n = Number(__q.get('files') || 300);
  for (var i = 0; i < n; i++) {
    var b = new Uint8Array(50 * 1024);
    b[0] = i & 255;
    __file('/lib/python3.9/module' + i + '.pyc', b);
  }
  var zip = new Uint8Array(Number(__q.get('zipmb') || 10) * 1024 * 1024);
  zip[0] = 0x50; zip[1] = 0x4b;
  __file('/game.zip', zip);
  __mkdir('/home/web_user/.renpy/thequestion-1');
})();
var MEMFS = { ops_table: {}, mount: function () {} };
var IDBFS = { dbs: {}, mount: function () {} };
var GL = { counter: 1, buffers: [], programs: [], textures: [], contexts: [{ GLctx: document.getElementById('canvas').getContext('webgl') }], currentContext: null, stringCache: {} };
var EGL = { contextAttributes: { alpha: false } };
var ENV = { USER: 'web_user', HOME: '/home/web_user', LANG: 'C.UTF-8' };
var PATH = { normalize: function (p) { return p; } };
var TTY = { ttys: [] };
var PIPEFS = { BUCKET_BUFFER_SIZE: 8192 };
var SOCKFS = { root: null };
var JSEvents = { eventHandlers: [], deferredCalls: [] };
var Asyncify = { State: { Normal: 0, Unwinding: 1, Rewinding: 2 }, state: 0, currData: null, asyncPromiseHandlers: null };
var Browser = { mainLoop: { running: true, scheduler: null }, pointerLock: false };
var ABORT = false;
var runtimeInitialized = true;
var noExitRuntime = true;

// ---- the Ren'Py store (emulated Python): game variables are what ever_been_changed holds
var __store = {
  // Ren'Py's own store variables (defined by renpy/common, never changed by the game)
  mouse_visible: true, suppress_overlay: false, main_menu: false, save_name: '', menu_window_subtitle: '', _rollback: true, _skipping: true,
  // the game's (default statements + assignments while playing)
  money: 120, day: 2, met_lucy: true, player_name: 'Eileen', affection: { eileen: 3, lucy: 1 }, inventory: ['key', 'map'],
  player: { __class__: 'Player', hp: 10, max_hp: 12, name: 'Eileen' },
  huge_number: 12345678901234567890, // a Python int beyond JavaScript's safe integers
};
var __ebc = new Set(['money', 'day', 'met_lucy', 'player_name', 'affection', 'inventory', 'player', 'huge_number', '_defaults_set']);
(function () {
  var big = Number(__q.get('big') || 0);
  for (var i = 0; i < big; i++) {
    __store['flag_' + i] = i % 3 === 0;
    __ebc.add('flag_' + i);
  }
})();
window.__fixture = { store: __store, ebc: __ebc, executed: [], restarts: 0 };
function __render() {
  document.getElementById('hud').textContent = 'money ' + __store.money + ' · day ' + __store.day;
}
__render();

// the emulated Python side of SaveForge's command (src/trainer/renpy-live.js builds it)
function __saveforgeOp(args) {
  var basic = function (v) {
    return typeof v === 'boolean' || typeof v === 'number' || (typeof v === 'string' && v.length <= 500);
  };
  var kindOf = function (v) {
    return typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'float') : 'str';
  };
  var leaf = function (path, v, game) {
    if (typeof v === 'number' && Number.isInteger(v) && !Number.isSafeInteger(v)) return { p: path, t: 'int', v: String(v), ro: 'a number too large for JavaScript', g: game };
    return { p: path, t: kindOf(v), v: v, g: game };
  };
  if (args.op === 'list') {
    var out = [];
    var names = Object.keys(__store).filter(function (k) { return k[0] !== '_'; }).sort();
    names.forEach(function (k) {
      var v = __store[k];
      var game = __ebc.has(k);
      if (!game && !args.all) return;
      if (basic(v)) out.push(leaf([['a', k]], v, game));
      else if (Array.isArray(v)) v.slice(0, 100).forEach(function (x, i) { if (basic(x)) out.push(leaf([['a', k], ['i', i]], x, game)); });
      else if (v && typeof v === 'object') Object.keys(v).slice(0, 100).forEach(function (kk) {
        if (kk === '__class__' || !basic(v[kk])) return;
        out.push(leaf(v.__class__ ? [['a', k], ['a', kk]] : [['a', k], ['k', kk]], v[kk], game));
      });
    });
    return { vars: out.slice(0, args.max || 3000), total: out.length, version: '8.3.7.25031702', name: 'The Question', ebc: __ebc.size };
  }
  var get = function (path) {
    var o = __store;
    for (var i = 0; i < path.length; i++) {
      if (o === null || o === undefined) throw new Error('not found');
      o = o[path[i][1]];
    }
    return o;
  };
  if (args.op === 'get') return { values: args.paths.map(function (p) { try { var v = get(p); return basic(v) ? { ok: true, v: v } : { ok: false }; } catch (e) { return { ok: false }; } }) };
  if (args.op === 'set') {
    var path = args.path;
    var o = __store;
    for (var i = 0; i < path.length - 1; i++) o = o[path[i][1]];
    var key = path[path.length - 1][1];
    var cur = o[key];
    if (typeof cur !== typeof args.value) throw new Error('type mismatch: the game has ' + typeof cur);
    o[key] = args.value;
    __ebc.add(path[0][1]);
    window.__fixture.restarts++;
    __render();
    return { v: get(path) };
  }
  if (args.op === 'input') {
    // ?input=1: Ren'Py waits in "$ answer = renpy.input(...)" (the Python side reads this from the AST)
    if (__q.get('input') !== '1') return { current: { type: 'Say', file: 'game/script.rpy', line: 12, source: '' }, checks: [], steps: [] };
    return {
      current: { type: 'Python', file: 'game/script.rpy', line: 40, source: 'answer = renpy.input("The password?", length=20)' },
      steps: [{ type: 'Python', file: 'game/script.rpy', line: 41, source: 'answer = answer.strip().lower()' }],
      checks: [
        { type: 'If', file: 'game/script.rpy', line: 43, cond: 'answer == "swordfish"', then: [{ jump: 'vault' }] },
        { type: 'If', file: 'game/script.rpy', line: 43, cond: 'True', then: [{ say: 'Wrong.' }] },
      ],
    };
  }
  throw new Error('unknown op');
}
// Ren'Py's PERIODIC event: read window._renpy_cmd, delete it, run it in the store
var __interaction = __q.get('interaction') !== '0';
setInterval(function () {
  __store.mouse_visible = !__store.mouse_visible; // the engine's own state keeps changing
  if (!__interaction || typeof window._renpy_cmd !== 'string') return;
  var cmd = window._renpy_cmd;
  delete window._renpy_cmd;
  window.__fixture.executed.push(cmd.slice(0, 80));
  var m = /b64decode\('([A-Za-z0-9+/=]+)'\)/.exec(cmd);
  if (!m) return;
  var py = decodeURIComponent(escape(atob(m[1])));
  var head = /^# saveforge-renpy (\{.*\})$/m.exec(py);
  if (head) {
    // SaveForge's command: runs in its own namespace (no store variables are created)
    var args = JSON.parse(head[1]);
    var reply;
    try {
      reply = { id: args.id, ok: true, data: __saveforgeOp(args) };
    } catch (e) {
      reply = { id: args.id, ok: false, error: e.message };
    }
    window[args.cb](JSON.parse(JSON.stringify(reply)));
    return;
  }
  // renpy_exec's wrapper: "result = <expr>" in the store, and the JSON result stays in store.result
  var r = /^result = ([A-Za-z_][\w.]*)$/.exec(py.trim());
  var data = r ? r[1].split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, __store) : true;
  __store.result = JSON.stringify({ data: data === undefined ? null : data });
  __ebc.add('result');
  window._renpy_cmd_callback(JSON.parse(__store.result));
}, 50);
// ---- IDBFS: the saves, as Ren'Py web keeps them
(function () {
  var r = indexedDB.open('/home/web_user/.renpy', 21);
  r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains('FILE_DATA')) r.result.createObjectStore('FILE_DATA'); };
  r.onsuccess = function () {
    var db = r.result;
    fetch('../../../samples/renpy8-1-1-LT1.save').then(function (x) { return x.arrayBuffer(); }).then(function (buf) {
      var tx = db.transaction('FILE_DATA', 'readwrite');
      tx.objectStore('FILE_DATA').put({ timestamp: new Date(), mode: 33206, contents: new Uint8Array(buf) }, '/home/web_user/.renpy/thequestion-1/1-1-LT1.save');
      tx.oncomplete = function () { db.close(); document.body.dataset.ready = '1'; };
    });
  };
})();
// the game draws every frame (WebGL canvas)
(function frame() {
  var gl = GL.contexts[0].GLctx;
  if (gl) {
    gl.clearColor((Date.now() % 1000) / 1000, 0.1, 0.2, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  requestAnimationFrame(frame);
})();
