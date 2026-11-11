// Live engine integrations. Each one only uses objects the engine itself
// publishes on `window` (documented/public globals). If an engine keeps its
// state somewhere page scripts cannot reach (a Web Worker, WebAssembly, a
// closure), it is reported as not live-editable instead of being faked.

import { boundedKeys, isBinary, isEmscripten, runtimeGlobal } from './safe-walk.js';
import { applyMutation, classifyGlobal, countChanges, sampleNumbers, scoreLeaf, screenNumbers } from './game-state.js';
import { buildLiveTree, buildLiveTreeAsync } from './live-tree.js';
import { childId, escapeSegment } from '../core/model.js';

/**
 * @typedef LiveEngine
 * @property {string} id
 * @property {string} name
 * @property {'live'|'live-generic'} channel
 * @property {string} note        shown in the trainer header / info panel
 * @property {() => {root, refs, count, truncated}} snapshot
 * @property {(id, refInfo) => string|null} [liveName]   engine-provided display name
 * @property {(id, refInfo) => void} [afterWrite]        engine refresh hook
 * @property {Array<{label, run}>} [actions]
 */

export function detectLiveEngines(win, { generic = true } = {}) {
  const found = [];
  const rpg = rpgMaker(win);
  if (rpg) found.push(rpg);
  const sc = sugarCube(win);
  if (sc) found.push(sc);
  const c2 = construct2(win);
  if (c2) found.push(c2);
  const ph = phaser(win);
  if (ph) found.push(ph);
  // the generic scan briefly creates a hidden iframe, so callers that must not touch the page skip it
  const g = generic ? genericGlobals(win, found.length > 0) : null;
  if (g) found.push(g);
  return found;
}

/** Engines we know cannot be edited live, with the reason (shown to the user). */
export function liveLimitations(win) {
  const out = [];
  const has = (k) => {
    try {
      return k in win;
    } catch {
      return false;
    }
  };
  if (has('RenPyWeb') || /renpy/i.test(win.document?.title || '') || win.document?.querySelector?.('script[src*="renpy"]')) {
    out.push({ id: 'renpy-web', name: "Ren'Py web", reason: "Ren'Py web runs the game's Python inside WebAssembly; SaveForge never reads or writes that memory. Recent builds offer a JavaScript interface to Ren'Py (renpy_exec): SaveForge uses it to read and change store variables through Ren'Py itself. Without it, the saves can be inspected and edited (verified) under Saves in storage." });
  }
  if (has('Harlowe') || win.document?.querySelector?.('tw-story')) {
    out.push({ id: 'harlowe', name: 'Twine (Harlowe)', reason: 'Harlowe keeps story state private, so it cannot be edited live. Saves in browser storage can be edited with Apply & Reload.' });
  }
  if (has('c3_runtimeInterface') || win.document?.querySelector?.('script[src*="c3runtime"]')) {
    out.push({ id: 'construct3', name: 'Construct 3', reason: 'Construct 3 usually runs the game in a Web Worker, which page scripts cannot access. Saves in browser storage can be edited with Apply & Reload.' });
  }
  if (has('GameMaker_Init') || has('g_pBuiltIn') || win.document?.querySelector?.('#canvas[gamemaker], script[src*="html5game"]')) {
    out.push({ id: 'gamemaker', name: 'GameMaker HTML5', reason: 'GameMaker HTML5 compiles variables into obfuscated runtime structures, so they cannot be identified reliably live. INI/JSON saves in browser storage can be edited with Apply & Reload.' });
  }
  if (has('unityInstance') || has('createUnityInstance') || win.document?.querySelector?.('#unity-canvas, script[src*=".loader.js"]')) {
    out.push({ id: 'unity', name: 'Unity WebGL', reason: 'Unity runs the game in WebAssembly memory that page scripts cannot read as variables. PlayerPrefs and save files in IndexedDB (/idbfs) can be edited with Apply & Reload.' });
  }
  if (has('GODOT_CONFIG') || has('Godot') || win.document?.querySelector?.('script[src*="godot"], canvas#canvas[data-godot]')) {
    out.push({ id: 'godot', name: 'Godot (web)', reason: 'Godot runs the game in WebAssembly; its variables are not reachable from the page. Save files in IndexedDB (/userfs) can be edited with Apply & Reload.' });
  }
  return out;
}

// ---------------------------------------------------------------- RPG Maker MV / MZ

function rpgMaker(win) {
  let DM;
  try {
    DM = win.DataManager;
    if (!DM || typeof DM.makeSaveContents !== 'function' || !win.$gameParty || !win.$gameSystem) return null;
  } catch {
    return null;
  }
  const mz = !!win.Utils && typeof win.Utils.RPGMAKER_NAME === 'string' ? win.Utils.RPGMAKER_NAME : 'MV';
  return {
    id: 'rpgmaker',
    name: `RPG Maker ${mz}`,
    evidence: 'DataManager.makeSaveContents and $gameParty are present',
    channel: 'live',
    note: 'Connected to the running RPG Maker engine ($gameParty, $gameActors, $gameVariables, $gameSwitches). Changes apply immediately; save in-game to keep them.',
    root() {
      // the same objects the engine writes into a save file, so save profiles apply unchanged;
      // rebuilt on every access because loading a save replaces $gameParty and friends
      const contents = DM.makeSaveContents();
      const obj = {};
      for (const k of ['system', 'switches', 'variables', 'selfSwitches', 'actors', 'party']) if (contents[k]) obj[k] = contents[k];
      return obj;
    },
    snapshot() {
      return buildLiveTree(this.root(), { maxNodes: 60000, maxDepth: 8, rootLabel: 'RPG Maker' });
    },
    /** Uses RPG Maker's own methods so clamping, refreshes and event updates happen like in-game. */
    setter(id, ref, v) {
      const seg = id.split('/');
      const n = Number(seg[seg.length - 1]);
      const cur = ref.obj[ref.key];
      const P = win.$gameParty;
      try {
        if (seg[1] === 'party' && seg[2] === '_gold' && typeof P.gainGold === 'function') return P.gainGold(v - cur), 'gainGold()';
        if (seg[1] === 'party' && ['_items', '_weapons', '_armors'].includes(seg[2]) && typeof P.gainItem === 'function') {
          const table = { _items: win.$dataItems, _weapons: win.$dataWeapons, _armors: win.$dataArmors }[seg[2]];
          if (table && table[n]) return P.gainItem(table[n], v - (cur || 0)), 'gainItem()';
        }
        if (seg[1] === 'switches' && seg[2] === '_data' && typeof win.$gameSwitches.setValue === 'function') return win.$gameSwitches.setValue(n, v), 'setValue()';
        if (seg[1] === 'variables' && seg[2] === '_data' && typeof win.$gameVariables.setValue === 'function') return win.$gameVariables.setValue(n, v), 'setValue()';
        if (seg[1] === 'actors' && seg.length === 5) {
          const actor = ref.obj;
          const m = { _hp: 'setHp', _mp: 'setMp', _tp: 'setTp' }[seg[4]];
          if (m && typeof actor[m] === 'function') return actor[m](v), `${m}()`;
          if (seg[4] === '_level' && typeof actor.changeLevel === 'function') return actor.changeLevel(v, false), 'changeLevel()';
        }
      } catch {
        return false;
      }
      return false;
    },
    liveName(id) {
      const seg = id.split('/');
      const key = seg[seg.length - 1];
      const n = Number(key);
      try {
        if (seg[1] === 'switches' && win.$dataSystem) return win.$dataSystem.switches[n] || null;
        if (seg[1] === 'variables' && win.$dataSystem) return win.$dataSystem.variables[n] || null;
        if (seg[1] === 'party' && seg[2] === '_items' && win.$dataItems) return win.$dataItems[n]?.name || null;
        if (seg[1] === 'party' && seg[2] === '_weapons' && win.$dataWeapons) return win.$dataWeapons[n]?.name || null;
        if (seg[1] === 'party' && seg[2] === '_armors' && win.$dataArmors) return win.$dataArmors[n]?.name || null;
      } catch {
        return null;
      }
      return null;
    },
    afterWrite(id, ref) {
      try {
        if (ref.obj && typeof ref.obj.refresh === 'function' && /\/actors\//.test(id)) ref.obj.refresh();
        if (win.$gameMap && typeof win.$gameMap.requestRefresh === 'function') win.$gameMap.requestRefresh();
      } catch {
        /* engine refresh is best-effort */
      }
    },
  };
}

// ---------------------------------------------------------------- SugarCube 2

/** The direct SugarCube adapter, or null (used again when a story starts late). */
export function sugarCubeDirect(win) {
  return sugarCube(win);
}

function sugarCube(win) {
  let SC;
  try {
    SC = win.SugarCube;
    if (!SC || !SC.State || typeof SC.State.variables !== 'object') return null;
  } catch {
    return null;
  }
  return {
    id: 'sugarcube',
    name: 'SugarCube (Twine)',
    evidence: 'window.SugarCube.State.variables is present (story variables and setup objects)',
    channel: 'live',
    note: 'Connected to SugarCube.State.variables (the active moment). Story logic sees changes immediately; text already on screen updates when the passage is re-rendered. Save in-game to keep them.',
    root() {
      // mirror SugarCube's save layout so the existing SugarCube profile labels apply ($name).
      // State.variables is read on every access: SugarCube makes a new copy on each passage.
      // setup: the story's own objects (item tables, shops, NPC data…), often edited by
      // story code through setup.* — data properties only, functions are skipped
      const root = { state: { history: [{ title: safe(() => SC.State.passage) || 'current', variables: SC.State.variables }], index: 0 } };
      const setup = safe(() => SC.setup);
      if (setup && typeof setup === 'object') root.setup = setup;
      // State.temporary: the _temporary variables of the current passage
      const temp = safe(() => SC.State.temporary);
      if (temp && typeof temp === 'object') root.temporary = temp;
      return root;
    },
    resolve(id) {
      const segs = id.split('/').slice(1).map((x) => x.replace(/~1/g, '/').replace(/~0/g, '~'));
      let obj = segs[0] === 'state' && segs[3] === 'variables' ? safe(() => SC.State.variables) : segs[0] === 'temporary' ? safe(() => SC.State.temporary) : segs[0] === 'setup' ? safe(() => SC.setup) : null;
      const from = segs[0] === 'state' ? 4 : 1;
      if (!obj) return null;
      for (let i = from; i < segs.length - 1; i++) {
        obj = safe(() => obj[segs[i]]);
        if (obj === null || typeof obj !== 'object') return null;
      }
      return { obj, key: segs[segs.length - 1] };
    },
    /** Exact path lookup, e.g. ['variables','player','money'] (Diagnostics). */
    lookup(path) {
      let o = path[0] === 'temporary' ? safe(() => SC.State.temporary) : safe(() => SC.State.variables);
      for (let i = 1; i < path.length - 1; i++) {
        if (o === null || typeof o !== 'object') return { found: false };
        o = o[path[i]];
      }
      if (o === null || typeof o !== 'object' || !(path[path.length - 1] in o)) return { found: false };
      const v = o[path[path.length - 1]];
      return { found: true, value: v, type: typeof v };
    },
    snapshot() {
      // story variables and setup get separate budgets so a large setup table cannot hide $variables
      const t = buildLiveTree(this.root(), { maxNodes: 90000, maxDepth: 14, rootBudget: 45000, maxStrings: 8000, rootLabel: 'SugarCube' });
      this.lastReport = { ...t.report, count: t.count, truncated: t.truncated };
      return t;
    },
    scanReport() {
      return this.lastReport || null;
    },
    actions: [
      {
        label: 'Refresh passage',
        hint: 'Re-render the current passage so on-screen text shows the new values (does not add history).',
        run: () => SC.Engine && typeof SC.Engine.show === 'function' && SC.Engine.show(),
      },
    ],
  };
}

// ---------------------------------------------------------------- Construct 2

function construct2(win) {
  let rt;
  try {
    if (typeof win.cr_getC2Runtime !== 'function') return null;
    rt = win.cr_getC2Runtime();
    if (!rt || !Array.isArray(rt.all_global_vars)) return null;
  } catch {
    return null;
  }
  const byName = new Map();
  return {
    id: 'construct2',
    name: 'Construct 2',
    evidence: 'cr_getC2Runtime().all_global_vars is present',
    channel: 'live',
    note: 'Connected to Construct 2 global variables. Changes apply on the next game tick; save in-game to keep them.',
    snapshot() {
      const globals = {};
      byName.clear();
      for (const gv of rt.all_global_vars) {
        if (!gv || typeof gv.name !== 'string') continue;
        globals[gv.name] = gv.data;
        byName.set(gv.name, gv);
      }
      return buildLiveTree({ globals }, { rootLabel: 'Construct 2' });
    },
    resolve(id) {
      const m = /^\$\/globals\/([^/]+)$/.exec(id);
      if (!m) return null;
      const name = m[1].replace(/~1/g, '/').replace(/~0/g, '~');
      const gv = rt.all_global_vars.find((g) => g && g.name === name);
      return gv ? { obj: gv, key: 'data' } : null;
    },
  };
}

// ---------------------------------------------------------------- generic globals

const LIB_GLOBALS = /^(PIXI|Phaser|THREE|BABYLON|createjs|Howler|Howl|jQuery|\$|_|React|ReactDOM|Vue|angular|Ember|Backbone|Matter|p2|Box2D|planck|LZString|pako|JSZip|localforage|Stats|dat|gsap|TweenMax|TweenLite|anime|Hammer|PIXI_SOUND|webkit.*|chrome|safari|SaveForge.*|__.*|google.*|ga|gtag|dataLayer|fbq|_gaq|SugarCube|DataManager|Utils|Graphics|Input|TouchInput|Bitmap|Sprite.*|Window_.*|Scene_.*|Game_.*|\$data.*|\$game.*|Imported|PluginManager|SceneManager|ImageManager|AudioManager|SoundManager|TextManager|ColorManager|StorageManager|ConfigManager|BattleManager|EffectManager|FontManager|VideoManager|Spriteset_.*|Tilemap|ShaderTilemap|WebAudio|JsonEx|Decrypter|ResourceHandler|CacheEntry|CacheMap|ImageCache|RequestQueue|Point|Rectangle|Stage|Weather|ToneFilter|ToneSprite|ScreenSprite|TilingSprite|Window|WindowLayer|Video|ProgressWatcher|Html5Audio|Story|State|Engine|Config|Setting|Macro|Wikifier|Passage|Scripting|Save|UI|UIBar|Dialog|Fullscreen|LoadScreen|SimpleAudio|L10n|Template|Util|Has|Browser|Engine|setup|prehistory|predisplay|prerender|postdisplay|postrender|cr_.*|C2_.*|c2_.*|module|exports|require|define)$/;

function genericGlobals(win, hasEngine) {
  let baseline;
  try {
    const f = win.document.createElement('iframe');
    f.style.display = 'none';
    win.document.documentElement.appendChild(f);
    baseline = new Set(Object.getOwnPropertyNames(f.contentWindow));
    f.remove();
  } catch {
    baseline = new Set(Object.getOwnPropertyNames(Object.getPrototypeOf(win) || {}));
  }
  const pageGlobals = [];
  const prefiltered = []; // shown in Diagnostics as excluded, never scanned
  const runtimeWhy = new Map(); // global -> why it is never scanned (WebAssembly runtime, binary data)
  const emscripten = isEmscripten(win);
  const lexical = lexicalGlobals(win);
  /** (Re)lists the page's own globals. Called again by Rescan: games often create their state after the first look. */
  const collect = () => {
    let names;
    try {
      names = Object.getOwnPropertyNames(win);
    } catch {
      return false;
    }
    pageGlobals.length = 0;
    prefiltered.length = 0;
    for (const k of names) {
      if (baseline.has(k) || /^on[a-z]+$/.test(k) || /^__saveforge/.test(k)) continue;
      if (LIB_GLOBALS.test(k)) {
        if (prefiltered.length < 200) prefiltered.push(k);
        continue;
      }
      let d;
      try {
        d = Object.getOwnPropertyDescriptor(win, k);
      } catch {
        continue;
      }
      if (!d || !('value' in d)) continue;
      const v = d.value;
      if (typeof v === 'function' || v === undefined) continue;
      // WebAssembly runtimes (Emscripten: Ren'Py web, Unity, Godot…) and binary data are never game
      // variables, and enumerating them can use gigabytes (the 2.3.0 Ren'Py crash)
      const why = runtimeGlobal(k, v, emscripten);
      if (why) {
        if (prefiltered.length < 200) prefiltered.push(k);
        runtimeWhy.set(k, why);
        continue;
      }
      // DOM nodes, windows and frames (an <iframe id="x"> creates a global that is
      // the frame's window; reading anything from a cross-origin one throws)
      if (typeof v === 'object' && v !== null && isNodeOrWindow(v, win)) continue;
      // engine objects handled by a dedicated adapter (Phaser game instances)
      if (safe(() => v && typeof v === 'object' && v.registry && v.scene && Array.isArray(v.scene.scenes))) continue;
      pageGlobals.push(k);
    }
    // script-level let/const/class bindings are globals too, but never window properties
    for (const k of lexical.names()) {
      if (pageGlobals.includes(k) || LIB_GLOBALS.test(k)) continue;
      const v = lexical.get(k);
      if (typeof v === 'function' || v === undefined || (v && typeof v === 'object' && isNodeOrWindow(v, win))) continue;
      pageGlobals.push(k);
    }
    return true;
  };
  if (!collect()) return null;
  if (!pageGlobals.length) return null;

  const read = (k) => {
    if (lexical.has(k)) return lexical.get(k);
    try {
      return Object.getOwnPropertyDescriptor(win, k)?.value;
    } catch {
      return undefined;
    }
  };
  let results = null; // [{name, kind, score, reasons}]
  const changedIds = new Set(); // leaves seen changing during this session
  const verifiedIds = new Set(); // leaves whose edits the game kept
  let marks = {}; // id (or id prefix) -> 'game' | 'not', remembered per website
  let store = null;
  let leafReport = []; // every scored leaf of the last snapshot (Diagnostics)
  let lastReport = null; // what the last scan could not reach, and why
  let lastSample = null;
  let learnTimer = null;
  const learnListeners = new Set();

  const classifyAll = (changes) => {
    results = pageGlobals.map((k) => {
      const r = classifyGlobal(k, read(k));
      return changes ? applyMutation(r, changes.get(k) || 0) : r;
    });
    results.sort((x, y) => y.score - x.score);
    for (const k of prefiltered) results.push({ name: k, kind: 'website', score: 0, known: true, reasons: [runtimeWhy.get(k) || 'known library, analytics or engine global (handled by an engine adapter if it is one)'] });
    for (const r of results) if (r.reasons[0]?.startsWith('known ')) r.known = true;
  };
  const markOf = (id) => {
    let best = null;
    for (const k in marks) if ((id === k || id.startsWith(`${k}/`)) && (!best || k.length > best.length)) best = k;
    return best ? marks[best] : null;
  };
  /** Globals whose variables are inspected one by one (known analytics/ads/library globals are not, unless marked). */
  let candidateCache = null; // recomputed when the globals are re-classified or a mark changes
  const candidateKeys = () => {
    if (candidateCache && candidateCache.cls === results && candidateCache.marks === marks && candidateCache.all === engine.includeAll) return candidateCache.keys;
    const keys = candidateKeysRaw();
    candidateCache = { cls: results, marks, all: engine.includeAll, keys };
    return keys;
  };
  const candidateKeysRaw = () => {
    const cls = engine.classification();
    const keys = cls.filter((r) => !r.known || markOf(`$/${escapeSegment(r.name)}`) === 'game' || engine.includeAll).map((r) => r.name);
    // `var textes = jeu.textes = {…}`: walk the object where the game keeps it (inside the
    // game-state global), so it is judged as part of the game rather than on its own
    const gameObjs = cls.filter((r) => r.kind === 'game').map((r) => read(r.name)).filter((v) => v && typeof v === 'object');
    const alias = (k) => {
      const v = read(k);
      if (!v || typeof v !== 'object') return false;
      return gameObjs.some((g) => g !== v && safe(() => boundedKeys(g, 2000).some((x) => Object.getOwnPropertyDescriptor(g, x)?.value === v)));
    };
    const kindOf = new Map(cls.map((r) => [r.name, r.kind]));
    return keys.filter((k) => kindOf.get(k) === 'game' || !alias(k));
  };
  /** Numeric leaves of the candidate globals, keyed by tree id (own data properties only). */
  const sampleIds = (keys, limit = 6000) => {
    const out = new Map();
    const seen = new Set();
    const walk = (v, id, depth) => {
      if (out.size >= limit || depth > 6 || !v || typeof v !== 'object' || seen.has(v)) return;
      if (isNodeOrWindow(v, win) || isBinary(v)) return; // typed arrays / WebAssembly memory: never enumerated
      seen.add(v);
      let ks;
      try {
        ks = boundedKeys(v, 300);
      } catch {
        return;
      }
      for (const k of ks.slice(0, 300)) {
        let d;
        try {
          d = Object.getOwnPropertyDescriptor(v, k);
        } catch {
          continue;
        }
        if (!d || !('value' in d)) continue;
        const cid = childId(id, k);
        if (typeof d.value === 'number' || typeof d.value === 'boolean') out.set(cid, d.value);
        else if (d.value && typeof d.value === 'object') walk(d.value, cid, depth + 1);
        if (out.size >= limit) return;
      }
    };
    for (const k of keys) {
      const v = read(k);
      const id = childId('$', k);
      if (typeof v === 'number' || typeof v === 'boolean') out.set(id, v);
      else walk(v, id, 1);
    }
    return out;
  };
  /** Compares with the previous sample; returns the leaves that changed for the first time. */
  const learn = () => {
    const now = sampleIds(candidateKeys(), engine.profile?.observeCap ?? 6000);
    const fresh = [];
    if (lastSample) {
      for (const [id, v] of now) {
        if (lastSample.has(id) && lastSample.get(id) !== v && !changedIds.has(id)) {
          changedIds.add(id);
          fresh.push(id);
        }
      }
    }
    lastSample = now;
    return fresh;
  };
  const tierOfId = (id) => leafReport.find((l) => l.id === id)?.tier;
  const persistMarks = () => store && store.set('detection-marks', marks).catch(() => {});

  const engine = {
    id: 'generic',
    name: hasEngine ? 'Other game state' : 'Game state (generic)',
    channel: 'live-generic',
    includeAll: false,
    note: 'Game variables found in the page’s global JavaScript. Each variable is judged on its own (name, type, where it sits, whether it changes while you play, whether its value is on screen), so game state inside a generic object is still found while analytics, ads and page data stay hidden. Edits are written directly; whether the game uses them immediately depends on how it was programmed. Save in-game to keep them.',
    /** Samples values twice so state that changes while the game runs counts as evidence. */
    async prepare(ms = 500) {
      // reading the game's script files (possibly many MB) is skipped in Low Memory Mode;
      // a Deep scan reads them (Diagnostics says which happened)
      if (!this.profile?.lowMemory || (this.profile?.maxNodes || 0) >= 100000) await Promise.race([lexical.fetchExternal(), new Promise((r) => win.setTimeout(r, 1500))]);
      collect();
      const first = new Map(pageGlobals.map((k) => [k, sampleNumbers(read(k))]));
      learn();
      await new Promise((r) => win.setTimeout(r, ms));
      const changes = new Map(pageGlobals.map((k) => [k, countChanges(first.get(k), sampleNumbers(read(k)))]));
      classifyAll(changes);
      learn();
    },
    /** Loads the variables the user marked on this website. */
    async useStore(s) {
      store = s;
      try {
        marks = (await s.get('detection-marks', {})) || {};
        candidateCache = null;
      } catch {
        marks = {};
      }
    },
    /** Keeps watching while the trainer is open; variables that start changing are promoted. */
    startLearning(every = 2000) {
      if (learnTimer || !every) return; // background scanning can be turned off
      learnTimer = win.setInterval(() => {
        let fresh;
        try {
          fresh = learn();
        } catch {
          return;
        }
        if (fresh.length) {
          const promoted = fresh.filter((id) => tierOfId(id) !== 'game');
          if (promoted.length) for (const fn of learnListeners) fn(promoted);
        }
      }, every);
    },
    stopLearning() {
      if (learnTimer) win.clearInterval(learnTimer);
      learnTimer = null;
    },
    learning: () => !!learnTimer,
    onLearned(fn) {
      learnListeners.add(fn);
      return () => learnListeners.delete(fn);
    },
    /** Marks a variable (or a whole object) as game state or not; remembered for this website. */
    mark(id, tier) {
      if (tier === 'game' || tier === 'not') marks[id] = tier;
      else delete marks[id];
      candidateCache = null;
      persistMarks();
    },
    marks: () => ({ ...marks }),
    /** Called when an edit was verified in the game: the strongest evidence there is. */
    markVerified(id) {
      verifiedIds.add(id);
    },
    detection(id) {
      return leafReport.find((l) => l.id === id) || null;
    },
    leaves: () => leafReport,
    scanReport: () => lastReport,
    classification() {
      if (!results) classifyAll(null);
      return results;
    },
    /** Globals that contribute at least one game or potential variable. */
    included() {
      const tops = new Set(leafReport.filter((l) => l.tier !== 'excluded').map((l) => l.global));
      return this.classification()
        .filter((r) => this.includeAll || tops.has(r.name))
        .map((r) => r.name);
    },
    root: () => win,
    resolve: (id) => resolveFrom(win, id, lexical),
    lexical: () => lexical.info(),
    /** Rescan: list globals again (new ones appear after title screens / loading), keep session evidence. */
    refresh() {
      lexical.refresh();
      collect();
      classifyAll(null);
    },
    /** Reads same-site game scripts once to find script-level let/const variables (no code is run). */
    async discover() {
      await lexical.fetchExternal();
      collect();
      classifyAll(null);
    },
    /** Scan limits come from the performance profile (Smart Scan / Standard / Deep). */
    profile: null,
    walkOpts(keys) {
      const P = this.profile || { maxNodes: 90000, depth: 10, rootBudget: 20000, textCap: 4000 };
      // each global gets its own budget and text is capped separately, so a huge dialogue or
      // translation table cannot use up the scan before deeper game values are reached
      // globals with game-state evidence are read first (Smart Scan priority); the others follow
      const prio = new Set(this.classification().filter((r) => r.kind === 'game' || marks[`$/${escapeSegment(r.name)}`] === 'game').map((r) => r.name));
      return { rootKeys: keys, maxNodes: P.maxNodes, maxDepth: P.depth, rootBudget: P.rootBudget, maxStrings: P.textCap, rootLabel: 'window', rootGetters: lexical.getters(keys), priorityRoots: prio.size ? prio : null };
    },
    snapshot() {
      if (this._cached) {
        const t = this._cached;
        this._cached = null;
        return t;
      }
      const keys = candidateKeys();
      const t = buildLiveTree(win, this.walkOpts(keys));
      const gen = finishScan(this, t, keys);
      let r = gen.next();
      while (!r.done) r = gen.next();
      return r.value;
    },
    /** Time-sliced scan: the game keeps running between slices; Stop keeps what was found. */
    async snapshotAsync({ signal = null, sliceMs = 8, yieldFn = () => new Promise((r) => win.setTimeout(r, 0)), onProgress = null } = {}) {
      const keys = candidateKeys();
      const t = await buildLiveTreeAsync(win, this.walkOpts(keys), { signal, sliceMs, yieldFn, onProgress: (p) => onProgress && onProgress({ stage: 'reading', ...p }) });
      const gen = finishScan(this, t, keys);
      let deadline = performance.now() + sliceMs;
      let r = gen.next();
      while (!r.done) {
        if (performance.now() > deadline) {
          if (onProgress) onProgress({ stage: 'scoring', count: t.count });
          await yieldFn();
          deadline = performance.now() + sliceMs;
        }
        r = gen.next();
      }
      this._cached = r.value;
      return r.value;
    },
    sourceOf(id) {
      const top = (id.split('/')[1] || '').replace(/~1/g, '/').replace(/~0/g, '~');
      const r = this.classification().find((x) => x.name === top);
      const d = this.detection(id);
      const conf = d ? `${d.tier === 'game' ? 'game variable' : d.tier === 'potential' ? 'potential game variable' : d.tier === 'text' ? 'text next to game variables' : 'excluded'}, confidence ${d.score}` : r ? `object score ${r.score}` : '';
      return `${lexical.has(top) ? `script variable ${top}` : `window.${top}`}${conf ? ` (${conf}${this.includeAll && d?.tier === 'excluded' ? ', shown because “include website globals” is on' : ''})` : ''}`;
    },
  };
  /** Scores every leaf (tiers), keeps text next to game state, prunes the rest. Pauses (yield) every 256 leaves. */
  function* finishScan(self, t, keys) {
    const cls = self.classification();
    const kindOf = new Map(cls.map((r) => [r.name, r.kind]));
    lastReport = { ...t.report, keys, count: t.count, truncated: t.truncated, stopped: !!t.stopped, profile: self.profile ? self.profile.name : 'Standard scan', limits: self.profile ? { maxNodes: self.profile.maxNodes, depth: self.profile.depth, textCap: self.profile.textCap } : null };
    const screen = safe(() => screenNumbers(win)) || new Set();
    const report = [];
    // text inside game-state globals, or next to detected game variables (item names,
    // dialogue), is kept for search and translation
    const gameGlobals = new Set(cls.filter((r) => r.kind === 'game').map((r) => r.name));
    // pass 1: score every primitive leaf on its own (iterative, pausable)
    const stack = [{ node: t.root, parents: [], pathStr: '' }];
    let n = 0;
    while (stack.length) {
      const { node, parents, pathStr } = stack.pop();
      if (!node.children) continue;
      const big = node.type === 'array' && node.children.length > 20 && node.children.filter((c) => c.type === 'int' || c.type === 'float').length > 20;
      for (let i = node.children.length - 1; i >= 0; i--) {
        const c = node.children[i];
        if (c.children) stack.push({ node: c, parents: [...parents, c.key], pathStr: pathStr ? `${pathStr}.${c.key}` : c.key });
      }
      for (const c of node.children) {
        if (c.children || !['int', 'float', 'bool', 'string'].includes(c.type)) continue;
        const global = parents[0] ?? c.key;
        const d = scoreLeaf({
          key: c.key,
          type: c.type,
          value: c.value,
          parentKeys: parents,
          globalKind: kindOf.get(global) || 'unknown',
          inLargeArray: big && (c.type === 'int' || c.type === 'float'),
          changed: changedIds.has(c.id),
          onScreen: (c.type === 'int' || c.type === 'float') && Math.abs(c.value) >= 10 && screen.has(c.value),
          verified: verifiedIds.has(c.id),
          mark: markOf(c.id),
        });
        report.push({ id: c.id, global, path: pathStr ? `${pathStr}.${c.key}` : c.key, type: c.type, tier: d.tier, score: d.score, reasons: d.reasons, node: c });
        if ((++n & 255) === 0) yield n;
      }
    }
    // pass 2: text next to real game variables (item names, quest text…) stays available
    // for search and translation, but URLs and website fields do not
    const gameBoxes = new Set(report.filter((l) => l.type !== 'string' && l.tier !== 'excluded').map((l) => l.id.slice(0, l.id.lastIndexOf('/'))));
    let m = 0;
    for (const l of report) {
      if ((++m & 2047) === 0) yield m;
      const box = l.id.slice(0, l.id.lastIndexOf('/'));
      if (l.type === 'string' && l.tier === 'excluded' && l.score > -0.2 && (gameGlobals.has(l.global) || gameBoxes.has(box)) && box !== '$') l.tier = 'text';
      l.node.meta.detect = { tier: l.tier, score: l.score, reasons: l.reasons };
    }
    leafReport = report.map(({ node, ...rest }) => rest);
    if (self.includeAll) return t;
    // pass 3: keep only detected variables (and the objects that hold them)
    const keep = new Set(report.filter((l) => l.tier !== 'excluded').map((l) => l.id));
    const prune = (node) => {
      node.children = node.children.filter((c) => {
        if (c.children) {
          prune(c);
          return c.children.length > 0;
        }
        return keep.has(c.id);
      });
    };
    prune(t.root);
    for (const id of [...t.refs.keys()]) if (!keep.has(id)) t.refs.delete(id);
    t.count = keep.size;
    return t;
  }
  return engine;
}

// ---------------------------------------------------------------- Phaser 3

const PHASER_SCENE_KEYS = new Set(['sys', 'game', 'anims', 'cache', 'registry', 'sound', 'textures', 'events', 'cameras', 'add', 'make', 'scene', 'children', 'lights', 'data', 'input', 'load', 'time', 'tweens', 'physics', 'matter', 'impact', 'plugins', 'renderer', 'scale', 'facebook', 'plugin', 'rexUI']);

function phaser(win) {
  let P;
  try {
    P = win.Phaser;
    if (!P || typeof P !== 'object') return null;
  } catch {
    return null;
  }
  const isGame = (v) => {
    try {
      return !!v && typeof v === 'object' && v.registry && typeof v.registry.list === 'object' && v.scene && Array.isArray(v.scene.scenes);
    } catch {
      return false;
    }
  };
  const games = [];
  for (const k of Object.getOwnPropertyNames(win)) {
    let d;
    try {
      d = Object.getOwnPropertyDescriptor(win, k);
    } catch {
      continue;
    }
    if (d && 'value' in d && isGame(d.value) && !games.some((g) => g.value === d.value)) games.push({ name: k, value: d.value });
  }
  if (Array.isArray(P.GAMES)) for (const g of P.GAMES) if (isGame(g) && !games.some((x) => x.value === g)) games.push({ name: 'Phaser.GAMES', value: g });
  if (!games.length) return null;
  const { name: gameVar, value: game } = games[0];
  return {
    id: 'phaser',
    name: `Phaser ${String(P.VERSION || '3').split(/[ -]/)[0]}`,
    channel: 'live',
    evidence: `window.${gameVar} is a Phaser game (registry + scenes)`,
    note: 'Connected to the Phaser game: the global registry and the custom properties and data of each scene. Changes apply on the next frame; save in-game to keep them.',
    snapshot() {
      const refs = new Map();
      let count = 0;
      let truncated = false;
      const graft = (obj, prefix, label, rootKeys) => {
        const t = buildLiveTree(obj, { prefix, rootLabel: label, rootKeys, maxNodes: 20000, maxDepth: 5 });
        t.root.key = label;
        for (const [k, v] of t.refs) refs.set(k, v);
        count += t.count;
        truncated ||= t.truncated;
        return t.root;
      };
      const children = [graft(game.registry.list, '$/registry', 'registry')];
      const scenesNode = { id: '$/scenes', key: 'scenes', type: 'object', value: undefined, editable: false, children: [], meta: {} };
      for (const scene of game.scene.scenes) {
        const key = safe(() => scene.sys.settings.key) || 'scene';
        const own = Object.keys(scene).filter((k) => {
          if (PHASER_SCENE_KEYS.has(k) || k.startsWith('_')) return false;
          const v = scene[k];
          if (typeof v === 'function') return false;
          return !(v && typeof v === 'object' && ('scene' in v || 'sys' in v || 'renderer' in v));
        });
        const node = graft(scene, childId('$/scenes', key), key, own);
        node.meta.className = 'Phaser.Scene';
        if (scene.data && typeof scene.data.list === 'object') node.children.push(graft(scene.data.list, `${node.id}/data`, 'data'));
        scenesNode.children.push(node);
      }
      children.push(scenesNode);
      const root = { id: '$', key: 'Phaser', type: 'object', value: undefined, editable: false, children, meta: {} };
      return { root, refs, count, truncated };
    },
    resolve(id) {
      const seg = id.split('/').map((x) => x.replace(/~1/g, '/').replace(/~0/g, '~'));
      const walk = (obj, rest) => {
        for (let i = 0; i < rest.length - 1; i++) {
          obj = obj?.[rest[i]];
          if (!obj || typeof obj !== 'object') return null;
        }
        return { obj, key: rest[rest.length - 1] };
      };
      if (seg[1] === 'registry') return walk(game.registry.list, seg.slice(2));
      if (seg[1] === 'scenes') {
        const scene = game.scene.scenes.find((sc) => (safe(() => sc.sys.settings.key) || 'scene') === seg[2]);
        if (!scene) return null;
        if (seg[3] === 'data' && scene.data && typeof scene.data.list === 'object') return walk(scene.data.list, seg.slice(4));
        return walk(scene, seg.slice(3));
      }
      return null;
    },
    /** registry.set / data.set fire Phaser's changedata events, like in-game changes. */
    setter(id, ref, v) {
      const seg = id.split('/');
      try {
        if (seg[1] === 'registry' && seg.length === 3 && typeof game.registry.set === 'function') return game.registry.set(ref.key, v), 'registry.set()';
        if (seg[1] === 'scenes' && seg[3] === 'data' && seg.length === 5) {
          const scene = game.scene.scenes.find((sc) => (safe(() => sc.sys.settings.key) || 'scene') === seg[2].replace(/~1/g, '/').replace(/~0/g, '~'));
          if (scene && typeof scene.data.set === 'function') return scene.data.set(ref.key, v), 'data.set()';
        }
      } catch {
        return false;
      }
      return false;
    },
    sourceOf(id) {
      if (id.startsWith('$/registry')) return `${gameVar}.registry (Phaser data registry)`;
      const m = /^\$\/scenes\/([^/]+)(\/data)?/.exec(id);
      return m ? `scene “${m[1].replace(/~1/g, '/').replace(/~0/g, '~')}”${m[2] ? '.data' : ' property'}` : 'Phaser game';
    },
  };
}

function isNodeOrWindow(v, win) {
  try {
    return v === win || v.window === v || typeof v.nodeType === 'number';
  } catch {
    return true; // cross-origin window: not readable
  }
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- script-level variables

const IDENT = /^[A-Za-z_$][\w$]*$/;
const RESERVED = new Set('break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null return super switch this throw true try typeof var void while with yield await async of static get set undefined NaN Infinity eval arguments'.split(' '));

/**
 * Script-level `let` / `const` / `class` bindings are globals that are NOT window
 * properties, so no window walk can see them. Names are read from the page's
 * classic scripts (inline, and same-site files on request) and confirmed with
 * `typeof name` evaluated in the page; values are read with the name itself.
 * Nothing else is run. Blocked by a Content-Security-Policy without
 * 'unsafe-eval' — that is reported, not hidden.
 */
export function lexicalGlobals(win) {
  const found = new Map(); // name -> source
  const unprobed = new Set();
  const ext = { started: false, done: null, files: [], failed: [] };
  let blocked = '';
  const ev = (code) => (0, win.eval)(code);
  const own = (n) => {
    try {
      return Object.prototype.hasOwnProperty.call(win, n);
    } catch {
      return true;
    }
  };
  const add = (name, from) => {
    if (!IDENT.test(name) || RESERVED.has(name) || found.has(name) || own(name) || name.startsWith('__saveforge')) return;
    if (blocked) return void unprobed.add(name);
    try {
      if (ev(`typeof ${name}`) !== 'undefined') found.set(name, from);
    } catch (e) {
      if (/eval|Content.Security|CSP/i.test(`${e && e.name} ${e && e.message}`)) {
        blocked = String(e.message || e);
        unprobed.add(name);
      }
    }
  };
  const parse = (text, from) => {
    let n = 0;
    for (const m of text.matchAll(/(?:^|[;{}\n])\s*(?:let|const|class)\s+([A-Za-z_$][\w$]*)/g)) if (n++ < 400) add(m[1], from);
    for (const m of text.matchAll(/(?:^|[;{}\n])\s*(?:let|const)\s+[A-Za-z_$][\w$]*\s*=[^;\n]*?(?:,\s*([A-Za-z_$][\w$]*)\s*=)/g)) if (m[1]) add(m[1], from);
  };
  const scanInline = () => {
    try {
      for (const sc of win.document.scripts) {
        if (sc.src) continue;
        const type = (sc.type || '').toLowerCase();
        if (type && !/^(text|application)\/(javascript|ecmascript|x-javascript)$/.test(type)) continue; // modules are not global
        parse((sc.textContent || '').slice(0, 2e6), 'inline script');
      }
    } catch {
      /* no document */
    }
  };
  scanInline();
  return {
    names: () => [...found.keys()],
    has: (n) => found.has(n),
    get(n) {
      try {
        return ev(n);
      } catch {
        return undefined;
      }
    },
    set(n, v) {
      if (!found.has(n)) throw new Error('Not a script variable');
      win.__saveforgeLexTmp = v;
      try {
        ev(`${n} = window.__saveforgeLexTmp`);
      } finally {
        delete win.__saveforgeLexTmp;
      }
    },
    holder(n) {
      const self = this;
      return Object.defineProperty({}, n, { enumerable: true, get: () => self.get(n), set: (v) => self.set(n, v) });
    },
    getters(keys) {
      const out = {};
      for (const k of keys) if (found.has(k)) out[k] = () => this.get(k);
      return out;
    },
    refresh: scanInline,
    /** Reads same-site classic script files (once) to find their script-level variables. */
    fetchExternal() {
      if (ext.done) return ext.done;
      ext.done = (async () => {
        let list = [];
        try {
          list = [...win.document.querySelectorAll('script[src]')].filter((sc) => sc.type !== 'module').map((sc) => sc.src);
        } catch {
          return;
        }
        const origin = safe(() => win.location.origin);
        for (const src of list.slice(0, 12)) {
          let u;
          try {
            u = new URL(src, win.location.href);
          } catch {
            continue;
          }
          if (u.origin !== origin || typeof win.fetch !== 'function') continue;
          try {
            const r = await win.fetch(u.href, { cache: 'force-cache', credentials: 'same-origin' });
            const text = (await r.text()).slice(0, 5e6);
            parse(text, u.pathname.split('/').pop() || u.pathname);
            ext.files.push(u.pathname);
          } catch {
            ext.failed.push(u.pathname);
          }
        }
      })();
      return ext.done;
    },
    info: () => ({ names: [...found].map(([name, from]) => ({ name, from })), unprobed: [...unprobed].slice(0, 50), blocked, files: ext.files, failed: ext.failed }),
  };
}

function ownData(obj, key) {
  if (obj === null || typeof obj !== 'object') return undefined;
  try {
    const d = Object.getOwnPropertyDescriptor(obj, key);
    return d && 'value' in d ? d.value : undefined;
  } catch {
    return undefined;
  }
}
const unesc = (s) => (s.includes('~') ? s.replace(/~1/g, '/').replace(/~0/g, '~') : s);

/** Live path resolution from the window, script variables, or documented engine getters. */
function resolveFrom(win, id, lexical, special = null) {
  const segs = id.split('/').slice(1).map(unesc);
  if (!segs.length) return null;
  const first = segs[0];
  let obj;
  let i = 1;
  if (special && Object.prototype.hasOwnProperty.call(special, first)) {
    if (segs.length === 1) return null;
    obj = safe(special[first]);
  } else if (lexical && lexical.has(first)) {
    if (segs.length === 1) return { obj: lexical.holder(first), key: first };
    obj = lexical.get(first);
  } else {
    obj = win;
    i = 0;
  }
  for (; i < segs.length - 1; i++) {
    obj = ownData(obj, segs[i]);
    if (obj === null || typeof obj !== 'object') return null;
  }
  if (obj === null || typeof obj !== 'object') return null;
  return { obj, key: segs[segs.length - 1] };
}

function baselineOf(win) {
  try {
    const f = win.document.createElement('iframe');
    f.style.display = 'none';
    win.document.documentElement.appendChild(f);
    const b = new Set(Object.getOwnPropertyNames(f.contentWindow));
    f.remove();
    return b;
  } catch {
    return new Set(Object.getOwnPropertyNames(Object.getPrototypeOf(win) || {}));
  }
}

/**
 * Every variable SaveForge can reach, without any classification: all page
 * globals (libraries and website globals included), script-level variables and
 * documented engine getters (SugarCube.State.variables, SugarCube.setup). Used
 * by "All variables (raw)" and the Diagnostics full scan.
 */
export function rawGlobals(win) {
  const baseline = baselineOf(win);
  const lexical = lexicalGlobals(win);
  const special = {};
  const SC = safe(() => win.SugarCube);
  if (SC && safe(() => SC.State && typeof SC.State.variables === 'object')) {
    special['SugarCube.State.variables'] = () => SC.State.variables;
    if (safe(() => SC.setup && typeof SC.setup === 'object')) special['SugarCube.setup'] = () => SC.setup;
  }
  const keys = () => {
    let names = [];
    try {
      names = Object.getOwnPropertyNames(win);
    } catch {
      names = [];
    }
    const own = names.filter((k) => !baseline.has(k) && !/^on[a-z]+$/.test(k) && !/^__saveforge/.test(k) && k !== 'SugarCube');
    return [...Object.keys(special), ...own, ...lexical.names().filter((k) => !own.includes(k)), ...(names.includes('SugarCube') ? ['SugarCube'] : [])];
  };
  let last = null;
  return {
    id: 'raw',
    name: 'All variables (raw)',
    channel: 'live-generic',
    note: 'Everything SaveForge can reach on this page, with no game/website classification: page globals (libraries and website data included), script-level variables and documented engine objects. Use it to search for any value. Edits are written directly.',
    root: () => win,
    resolve: (id) => resolveFrom(win, id, lexical, special),
    async prepare() {
      await Promise.race([lexical.fetchExternal(), new Promise((r) => win.setTimeout(r, 2500))]);
    },
    refresh() {
      lexical.refresh();
    },
    snapshot() {
      const ks = keys();
      const t = buildLiveTree(win, { rootKeys: ks, rootGetters: { ...lexical.getters(ks), ...special }, maxNodes: 80000, maxDepth: 12, rootBudget: 25000, maxStrings: 3000, rootLabel: 'window' });
      last = { ...t.report, keys: ks, count: t.count, truncated: t.truncated };
      return t;
    },
    scanReport: () => last,
    lexical: () => lexical.info(),
    special: () => Object.keys(special),
    sourceOf(id) {
      const top = unesc(id.split('/')[1] || '');
      return special[top] ? top : lexical.has(top) ? `script variable ${top}` : `window.${top}`;
    },
  };
}
