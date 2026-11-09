// SugarCube live access: can the trainer reach the running story's State, and if
// not, exactly why.
//
// SugarCube 2 publishes its APIs on window.SugarCube (State, Engine, Story, setup…).
// The trainer reaches them in one of three ways:
//   direct — SaveForge runs in the page's own JavaScript world and sees window.SugarCube
//   bridge — SaveForge runs in an isolated userscript/extension world: window.SugarCube
//            is invisible there, but the DOM is shared. A tiny agent is added to the page
//            world with a <script> element and answers synchronous requests through DOM
//            events and attributes (read/write one path, dump variables, re-render).
//   frame  — the story runs in a same-site child frame: open the trainer there.
// When none works the report says which step failed (not SugarCube, not started yet,
// global not exposed by this build, inline scripts blocked by the page's CSP, game
// in another site's frame).

import { buildLiveTree } from './live-tree.js';

const REQ = 'data-saveforge-sc-req';
const RES = 'data-saveforge-sc-res';
const AGENT = 'data-saveforge-sc-agent';
const EVT = 'saveforge-sc';

/** Story markers SugarCube leaves in the DOM (they do not need any script access). */
export function storyMarkers(doc) {
  const m = { sugarcube: false, format: '', version: '', started: false, list: [] };
  try {
    const sd = doc.querySelector('tw-storydata');
    if (sd) {
      m.format = sd.getAttribute('format') || '';
      m.version = sd.getAttribute('format-version') || '';
      m.list.push(`<tw-storydata format="${m.format}"${m.version ? ` format-version="${m.version}"` : ''}>`);
      if (/sugarcube/i.test(m.format)) m.sugarcube = true;
    }
    if (doc.querySelector('script#script-sugarcube')) (m.sugarcube = true), m.list.push('script#script-sugarcube');
    if (doc.getElementById('store-area')) m.list.push('#store-area');
    const passages = doc.getElementById('passages');
    if (passages) m.list.push('#passages');
    if (doc.getElementById('ui-bar')) (m.sugarcube = true), m.list.push('#ui-bar');
    if (doc.querySelector('.macro-link, .link-internal[data-passage]')) m.list.push('SugarCube passage links');
    m.started = !!(passages && passages.children.length);
  } catch {
    /* no document */
  }
  return m;
}

function directState(win) {
  try {
    const SC = win.SugarCube;
    if (!SC) return { ok: false, why: 'window.SugarCube is undefined in this context' };
    const st = SC.State;
    if (!st) return { ok: false, why: 'window.SugarCube exists but has no State' };
    const t = typeof st.variables;
    if (t !== 'object' || !st.variables) return { ok: false, why: `SugarCube.State.variables is ${t} (story not started yet?)` };
    return { ok: true, SC };
  } catch (e) {
    return { ok: false, why: `reading window.SugarCube threw: ${e.message}` };
  }
}

// ---------------------------------------------------------------- page-world bridge

// Runs in the page's own world. Plain ES5, no globals besides a marker; data is
// passed as JSON strings in attributes so nothing crosses worlds as objects.
const AGENT_SRC = `(function(){
  var de = document.documentElement;
  if (window.__saveforgeScAgent) { de.setAttribute('${AGENT}', '1'); return; }
  window.__saveforgeScAgent = 1;
  function sc(){ return window.SugarCube; }
  function root(name){ var S = sc() && sc().State; return S ? (name === 'temporary' ? S.temporary : S.variables) : undefined; }
  function plain(v, depth, seen, budget){
    if (v === null || typeof v !== 'object') return typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint' ? undefined : v;
    if (budget.n-- <= 0 || depth > 14) return undefined;
    if (seen.indexOf(v) >= 0) return undefined;
    if (v instanceof Date) return v.toISOString();
    var tag = Object.prototype.toString.call(v);
    if (tag === '[object Map]' || tag === '[object Set]') return undefined;
    seen.push(v);
    var out = Array.isArray(v) ? [] : {};
    var keys = Object.keys(v);
    for (var i = 0; i < keys.length; i++) {
      var d = Object.getOwnPropertyDescriptor(v, keys[i]);
      if (!d || !('value' in d)) continue;
      var x = plain(d.value, depth + 1, seen, budget);
      if (x !== undefined) out[keys[i]] = x;
    }
    seen.pop();
    return out;
  }
  function walk(path){
    var o = root(path[0]);
    for (var i = 1; i < path.length - 1; i++) { if (o === null || typeof o !== 'object') return null; o = o[path[i]]; }
    return o !== null && typeof o === 'object' ? o : null;
  }
  document.addEventListener('${EVT}', function(){
    var res;
    try {
      var q = JSON.parse(de.getAttribute('${REQ}') || '{}');
      var S = sc() && sc().State;
      if (q.op === 'probe') {
        var g = sc();
        res = { present: !!g, keys: g ? Object.keys(g).slice(0, 40) : [], state: !!(g && g.State), variablesType: S ? typeof S.variables : 'none', temporaryType: S ? typeof S.temporary : 'none', passage: S ? String(S.passage) : '', version: g && g.version ? (typeof g.version.short === 'function' ? g.version.short() : String(g.version.title || '')) : '' };
      } else if (!S) {
        res = { error: 'window.SugarCube.State is not available in the page' };
      } else if (q.op === 'dump') {
        res = { variables: plain(S.variables, 0, [], { n: 200000 }), temporary: plain(S.temporary, 0, [], { n: 20000 }), passage: String(S.passage) };
      } else if (q.op === 'get') {
        var o = walk(q.path);
        var v = o ? o[q.path[q.path.length - 1]] : undefined;
        res = { found: !!o && (q.path[q.path.length - 1] in o), value: v === undefined ? null : plain(v, 0, [], { n: 1000 }), type: typeof v };
      } else if (q.op === 'set') {
        var p = walk(q.path);
        if (!p) res = { error: 'path not found: ' + q.path.join('.') };
        else { p[q.path[q.path.length - 1]] = q.value; res = { ok: true, value: p[q.path[q.path.length - 1]] }; }
      } else if (q.op === 'show') {
        if (sc().Engine && typeof sc().Engine.show === 'function') sc().Engine.show();
        res = { ok: true };
      } else res = { error: 'unknown op' };
    } catch (e) { res = { error: String(e && e.message || e) }; }
    de.setAttribute('${RES}', JSON.stringify(res === undefined ? null : res));
  });
  de.setAttribute('${AGENT}', '1');
})();`;

/**
 * Installs the agent in the page world (once) and returns a synchronous rpc(op, args),
 * or {rpc: null, why} when the page blocks inline scripts.
 */
export function pageBridge(win) {
  if (win.__saveforgeScBridge) return win.__saveforgeScBridge;
  const doc = win.document;
  const de = doc.documentElement;
  try {
    if (de.getAttribute(AGENT) !== '1') {
      const s = doc.createElement('script');
      s.textContent = AGENT_SRC;
      (doc.head || de).appendChild(s);
      s.remove();
    }
  } catch (e) {
    return { rpc: null, why: `adding the page agent failed: ${e.message}` };
  }
  if (de.getAttribute(AGENT) !== '1') return { rpc: null, why: 'the page blocked SaveForge’s inline page script (Content-Security-Policy without inline scripts)' };
  const rpc = (op, args = {}) => {
    de.setAttribute(REQ, JSON.stringify({ op, ...args }));
    de.removeAttribute(RES);
    doc.dispatchEvent(new win.CustomEvent(EVT));
    const raw = de.getAttribute(RES);
    de.removeAttribute(REQ);
    de.removeAttribute(RES);
    if (raw === null) throw new Error('the page agent did not answer');
    return JSON.parse(raw);
  };
  const b = { rpc };
  win.__saveforgeScBridge = b;
  return b;
}

// ---------------------------------------------------------------- probe

/**
 * Determines whether the running SugarCube state is reachable, and how.
 * @returns {verdict: 'direct'|'bridge'|'frame'|'not-started'|'hidden'|'blocked'|'other-site-frame'|'none',
 *           reason, steps: [{ok, text}], markers, page?, frames}
 */
export function probeSugarCube(win, { contextInfo = null, tryBridge = true } = {}) {
  const steps = [];
  const doc = win.document;
  const markers = storyMarkers(doc);
  const direct = directState(win);
  steps.push({ ok: markers.sugarcube, text: markers.sugarcube ? `SugarCube story in this frame: ${markers.list.join(', ')}${markers.version ? ` (SugarCube ${markers.version})` : ''}` : `No SugarCube markers in this frame${markers.list.length ? ` (found: ${markers.list.join(', ')})` : ''}` });
  steps.push({ ok: direct.ok, text: direct.ok ? 'window.SugarCube.State.variables is reachable from SaveForge’s script context' : `Direct access: ${direct.why}` });
  if (direct.ok) return { verdict: 'direct', reason: 'Connected directly to SugarCube.State.', steps, markers, frames: [] };

  let page = null;
  if (tryBridge && (markers.sugarcube || markers.list.length)) {
    const b = pageBridge(win);
    if (!b.rpc) {
      steps.push({ ok: false, text: `Page-world check: ${b.why}` });
    } else {
      try {
        page = b.rpc('probe');
        steps.push({ ok: page.present, text: page.present ? `In the page’s own world window.SugarCube exists (keys: ${page.keys.slice(0, 8).join(', ')}…; State.variables is ${page.variablesType}${page.version ? `; version ${page.version}` : ''})` : 'In the page’s own world window.SugarCube is undefined too' });
      } catch (e) {
        steps.push({ ok: false, text: `Page-world check failed: ${e.message}` });
      }
    }
  }
  if (page && page.present && page.variablesType === 'object') {
    return { verdict: 'bridge', reason: 'SaveForge runs in an isolated script context (window.SugarCube is invisible there), but the page’s own world has it: connected through the page bridge.', steps, markers, page, frames: [] };
  }

  const frames = [];
  try {
    for (const f of doc.querySelectorAll('iframe')) {
      let same = false;
      let has = false;
      try {
        same = !!f.contentWindow.location.href;
        has = directState(f.contentWindow).ok || storyMarkers(f.contentWindow.document).sugarcube;
      } catch {
        same = false;
      }
      frames.push({ src: f.src || '(inline)', sameOrigin: same, sugarcube: has, el: f });
    }
  } catch {
    /* no frames */
  }
  const inFrame = frames.find((f) => f.sugarcube);
  if (inFrame) {
    steps.push({ ok: true, text: `The story runs in a same-site child frame (${inFrame.src})` });
    return { verdict: 'frame', reason: 'The SugarCube story is inside a frame of this page: open the trainer in that frame (Diagnostics → Frames).', steps, markers, page, frames };
  }
  if (!markers.sugarcube) {
    const other = frames.filter((f) => !f.sameOrigin);
    if (other.length) return { verdict: 'other-site-frame', reason: `No SugarCube story in this frame; ${other.length} frame(s) from other sites may hold the game. SaveForge must run inside that frame (the userscript does when allowed on that site).`, steps, markers, page, frames };
    return { verdict: 'none', reason: 'This frame is not a SugarCube story.', steps, markers, page, frames };
  }
  if (page && page.present && page.variablesType !== 'object') {
    return { verdict: 'not-started', reason: 'SugarCube is loaded but the story has not started yet (State.variables not ready). SaveForge keeps checking for a while.', steps, markers, page, frames };
  }
  if (!markers.started && !page) {
    return { verdict: 'not-started', reason: 'The SugarCube story has not started yet (no passage rendered). SaveForge keeps checking for a while.', steps, markers, page, frames };
  }
  if (!page) {
    const ctx = contextInfo && contextInfo.world ? ` Script context: ${contextInfo.world}.` : '';
    return { verdict: 'blocked', reason: `The SugarCube story is here, but SaveForge cannot see window.SugarCube and the page blocks the page-world bridge.${ctx} Live values cannot be reached; use its saves (Saves in storage) or Import from Save Editor.`, steps, markers, page, frames };
  }
  return { verdict: 'hidden', reason: 'This SugarCube build does not expose window.SugarCube (its State is private to the story’s code), so no web page or extension can read the live variables. Use its saves (Saves in storage) or Import from Save Editor.', steps, markers, page, frames };
}

// ---------------------------------------------------------------- bridge engine

const unesc = (s) => s.replace(/~1/g, '/').replace(/~0/g, '~');
/** live id → ['variables'|'temporary', ...path] */
export function stateEnginePath(id) {
  const segs = id.split('/').slice(1).map(unesc);
  if (segs[0] === 'state' && segs[1] === 'history' && segs[3] === 'variables') return ['variables', ...segs.slice(4)];
  if (segs[0] === 'temporary') return ['temporary', ...segs.slice(1)];
  return null;
}

/** SugarCube through the page bridge: same tree layout and ids as the direct adapter. */
export function sugarCubeBridge(win, rpc) {
  const holders = new Map();
  return {
    id: 'sugarcube',
    name: 'SugarCube (Twine)',
    evidence: 'window.SugarCube.State in the page’s own world, through SaveForge’s page bridge (SaveForge itself runs isolated)',
    channel: 'live',
    bridged: true,
    note: 'Connected to SugarCube.State.variables (the active moment) through the page bridge. Story logic sees changes immediately; text on screen updates when the passage is re-rendered (Refresh passage). Save in-game to keep them.',
    root() {
      const d = rpc('dump');
      if (d.error) throw new Error(d.error);
      return { state: { history: [{ title: d.passage || 'current', variables: d.variables || {} }], index: 0 }, temporary: d.temporary || {} };
    },
    snapshot() {
      const t = buildLiveTree(this.root(), { maxNodes: 90000, maxDepth: 14, rootBudget: 60000, maxStrings: 8000, rootLabel: 'SugarCube' });
      // values are not editable through the copy; resolve() routes reads/writes to the page
      return t;
    },
    resolve(id) {
      const path = stateEnginePath(id);
      if (!path || path.length < 2) return null;
      const key = path[path.length - 1];
      if (!holders.has(id)) {
        holders.set(
          id,
          Object.defineProperty({}, key, {
            enumerable: true,
            get: () => {
              const r = rpc('get', { path });
              return r && r.found ? r.value : undefined;
            },
            set: (v) => {
              const r = rpc('set', { path, value: v });
              if (r && r.error) throw new Error(r.error);
            },
          }),
        );
      }
      return { obj: holders.get(id), key };
    },
    /** Exact path lookup, e.g. ['variables','player','money'] (Diagnostics). */
    lookup(path) {
      return rpc('get', { path });
    },
    actions: [
      {
        label: 'Refresh passage',
        hint: 'Re-render the current passage so on-screen text shows the new values (does not add history).',
        run: () => rpc('show'),
      },
    ],
  };
}
