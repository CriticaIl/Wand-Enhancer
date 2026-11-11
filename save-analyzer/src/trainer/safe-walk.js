// What SaveForge may enumerate on a game page (SaveForge 2.3.1).
//
// The Ren'Py activation crash: Emscripten builds (Ren'Py web, Unity, Godot, many C/C++ games)
// put their runtime on window — HEAP8…HEAPF64 are typed-array views of the WHOLE WebAssembly
// memory (Ren'Py: 192 MB at start, growing), and FS holds every game file as a Uint8Array.
// `Object.keys(HEAPU8)` builds one string per byte: hundreds of millions of strings, gigabytes of
// memory, and iOS kills the tab (Safari reloads the page). Every walker therefore asks here:
//   - binary data (typed arrays, ArrayBuffer, DataView, WebAssembly objects) is never enumerated
//   - arrays are enumerated by index up to a limit, never with Object.keys on the whole array
//   - an Emscripten runtime's globals are recognised and never scanned as game state

const BINARY_TAG = /^(ArrayBuffer|SharedArrayBuffer|DataView|(Big)?(Int|Uint|Float)(8|16|32|64)(Clamped)?Array|WebAssembly\..*)$/;

export function tagOf(v) {
  try {
    return Object.prototype.toString.call(v).slice(8, -1);
  } catch {
    return '';
  }
}

/** Typed arrays, ArrayBuffers, DataViews, WebAssembly.Memory/Table/Module/Instance. */
export function isBinary(v) {
  if (!v || (typeof v !== 'object' && typeof v !== 'function')) return false;
  try {
    if (ArrayBuffer.isView(v)) return true;
  } catch {
    return true;
  }
  return BINARY_TAG.test(tagOf(v));
}

/**
 * Own enumerable keys, at most `max`, without ever materialising a huge key list:
 * binary data → none; arrays → indices 0…max-1; other objects → Object.keys (capped).
 */
export function boundedKeys(v, max = 5000) {
  if (!v || typeof v !== 'object' || isBinary(v)) return [];
  if (Array.isArray(v)) {
    const n = Math.min(v.length >>> 0, max);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = String(i);
    return out;
  }
  const keys = Object.keys(v);
  return keys.length > max ? keys.slice(0, max) : keys;
}

/** Number of items Find a value may read from a typed array (small game tables only, never a heap). */
export function typedArrayScanLimit(v, wasmBuffers) {
  try {
    if (!ArrayBuffer.isView(v) || v instanceof DataView) return 0;
    if (wasmBuffers && wasmBuffers.has(v.buffer)) return 0; // a view of WebAssembly memory: never
    if (v.byteLength > 1024 * 1024) return 0; // engine buffers, images, audio, files
    return Math.min(v.length, 5000);
  } catch {
    return 0;
  }
}

// Emscripten runtime globals (classic, non-modularised builds: every top-level var is on window)
const EMSCRIPTEN_GLOBALS = /^(Module|FS|MEMFS|IDBFS|NODEFS|WORKERFS|PROXYFS|NODERAWFS|OPFS|PIPEFS|SOCKFS|TTY|ENV|PATH|PATH_FS|ERRNO_CODES|ERRNO_MESSAGES|DNS|Sockets|GL|EGL|SDL|SDL2|AL|GLUT|GLFW|GLEW|IDBStore|JSEvents|Browser|Asyncify|PThread|Fetch|SYSCALLS|ExceptionInfo|wasmMemory|wasmTable|wasmBinary|wasmBinaryFile|wasmExports|wasmModule|asm|asmLibraryArg|buffer|HEAP(8|16|32|64|U8|U16|U32|U64|F32|F64)|HEAP_DATA_VIEW|ABORT|EXITSTATUS|INITIAL_MEMORY|TOTAL_MEMORY|TOTAL_STACK|STACK_SIZE|STACK_BASE|STACK_MAX|DYNAMIC_BASE|DYNAMICTOP_PTR|ASM_CONSTS|__ATPRERUN__|__ATINIT__|__ATMAIN__|__ATEXIT__|__ATPOSTRUN__|runtimeInitialized|runtimeExited|runtimeKeepaliveCounter|runDependencies|runDependencyWatcher|runDependencyTracking|dependenciesFulfilled|noExitRuntime|calledRun|calledMain|arguments_|thisProgram|quit_|ENVIRONMENT_IS_[A-Z_]+|scriptDirectory|moduleOverrides|UTF8Decoder|UTF16Decoder|dataURIPrefix|tempDouble|tempI64|tempRet0|wasmOffsetConverter|preloadedImages|preloadedAudios|preloadedWasm|specialHTMLTargets|GOT|LDSO|dynamicLibraries|emscripten_.*|_emscripten_.*|INITIAL_INITIAL_MEMORY|DEFAULT_GAME_FILENAME|_GET)$/;

/** Is this page an Emscripten (WebAssembly) program? Cheap: a few property reads, nothing enumerated. */
export function isEmscripten(win) {
  try {
    const own = (k) => Object.getOwnPropertyDescriptor(win, k)?.value;
    if (ArrayBuffer.isView(own('HEAPU8')) || ArrayBuffer.isView(own('HEAP8'))) return true;
    const mem = own('wasmMemory');
    if (mem && tagOf(mem) === 'WebAssembly.Memory') return true;
    const M = own('Module');
    return !!(M && typeof M === 'object' && (ArrayBuffer.isView(M.HEAPU8) || M.wasmMemory || M.asm || M.calledRun !== undefined || M.expectedDataFileDownloads !== undefined));
  } catch {
    return false;
  }
}

/** A global that must never be scanned: binary data anywhere, or an Emscripten runtime global. */
export function runtimeGlobal(name, value, emscripten) {
  if (isBinary(value)) return 'binary data (typed array / WebAssembly memory): never read as variables';
  if (emscripten && EMSCRIPTEN_GLOBALS.test(name)) return 'Emscripten/WebAssembly runtime (its memory and virtual files are never read)';
  return null;
}

/** The ArrayBuffers that back WebAssembly memories reachable from window (views of them are never scanned). */
export function wasmBuffers(win) {
  const out = new Set();
  const add = (m) => {
    try {
      if (m && tagOf(m) === 'WebAssembly.Memory') out.add(m.buffer);
    } catch {
      /* detached */
    }
  };
  try {
    add(Object.getOwnPropertyDescriptor(win, 'wasmMemory')?.value);
    const M = Object.getOwnPropertyDescriptor(win, 'Module')?.value;
    if (M && typeof M === 'object') {
      add(M.wasmMemory);
      if (ArrayBuffer.isView(M.HEAPU8)) out.add(M.HEAPU8.buffer);
    }
    const h = Object.getOwnPropertyDescriptor(win, 'HEAPU8')?.value;
    if (ArrayBuffer.isView(h)) out.add(h.buffer);
  } catch {
    /* not readable */
  }
  return out;
}
