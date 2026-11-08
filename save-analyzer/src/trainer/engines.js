// Live engine integrations. Each one only uses objects the engine itself
// publishes on `window` (documented/public globals). If an engine keeps its
// state somewhere page scripts cannot reach (a Web Worker, WebAssembly, a
// closure), it is reported as not live-editable instead of being faked.

import { buildLiveTree } from './live-tree.js';

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

export function detectLiveEngines(win) {
  const found = [];
  const rpg = rpgMaker(win);
  if (rpg) found.push(rpg);
  const sc = sugarCube(win);
  if (sc) found.push(sc);
  const c2 = construct2(win);
  if (c2) found.push(c2);
  const g = genericGlobals(win, found.length > 0);
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
    out.push({ id: 'renpy-web', name: "Ren'Py web", reason: "Ren'Py web runs the game's Python inside WebAssembly and only offers Python→JavaScript calls, so its variables cannot be changed live. Edit the save files instead (Apply & Reload)." });
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
    channel: 'live',
    note: 'Connected to the running RPG Maker engine ($gameParty, $gameActors, $gameVariables, $gameSwitches). Changes apply immediately; save in-game to keep them.',
    snapshot() {
      // the same objects the engine writes into a save file, so save profiles apply unchanged
      const contents = DM.makeSaveContents();
      const keep = ['system', 'switches', 'variables', 'selfSwitches', 'actors', 'party'];
      const obj = {};
      for (const k of keep) if (contents[k]) obj[k] = contents[k];
      return buildLiveTree(obj, { maxNodes: 60000, maxDepth: 8, rootLabel: 'RPG Maker' });
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
    channel: 'live',
    note: 'Connected to SugarCube.State.variables (the active moment). Story logic sees changes immediately; text already on screen updates when the passage is re-rendered. Save in-game to keep them.',
    snapshot() {
      // mirror SugarCube's save layout so the existing SugarCube profile labels apply ($name)
      const shell = { state: { history: [{ title: safe(() => SC.State.passage) || 'current', variables: SC.State.variables }], index: 0 } };
      return buildLiveTree(shell, { maxNodes: 60000, maxDepth: 14, rootLabel: 'SugarCube' });
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
    afterWrite(id, ref) {
      const gv = byName.get(ref.key);
      if (gv) gv.data = ref.obj[ref.key];
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
  let names;
  try {
    names = Object.getOwnPropertyNames(win);
  } catch {
    return null;
  }
  const candidates = [];
  for (const k of names) {
    if (baseline.has(k) || LIB_GLOBALS.test(k) || /^on[a-z]+$/.test(k)) continue;
    let d;
    try {
      d = Object.getOwnPropertyDescriptor(win, k);
    } catch {
      continue;
    }
    if (!d || !('value' in d)) continue;
    const v = d.value;
    if (typeof v === 'function' || v === undefined) continue;
    if (typeof v === 'object' && v !== null && (typeof v.nodeType === 'number' || v === win)) continue;
    candidates.push(k);
  }
  if (!candidates.length) return null;
  return {
    id: 'generic',
    name: hasEngine ? 'Other page globals' : 'Page globals (generic)',
    channel: 'live-generic',
    note: 'Found game data in the page’s global JavaScript variables. Edits are written directly; whether the game uses them immediately depends on how it was programmed. Save in-game to keep them.',
    snapshot() {
      return buildLiveTree(win, { rootKeys: candidates, maxNodes: 30000, maxDepth: 7, rootLabel: 'window' });
    },
  };
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}
