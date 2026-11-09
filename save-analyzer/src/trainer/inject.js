// Opens the trainer on a game page. Used by:
//   - standalone/trainer.js (bookmarklet / Safari extension; runs on the game's own page)
//   - the userscript (in whichever frame actually holds the game)
//   - the SaveForge app, for games loaded same-origin in its Game tab

import { detectLiveEngines, liveLimitations, rawGlobals } from './engines.js';
import { frameLabel, LiveProvider } from './providers.js';
import { createStore } from './store.js';
import { SaveHub } from './save-hub.js';
import { createSignal, finishStartup, interruptedStartup, PerfLog, PROFILES, resolveSettings } from './perf.js';
import { probeSugarCube, sugarCubeBridge, storyMarkers, pageBridge } from './sugarcube-live.js';
import { sugarCubeDirect } from './engines.js';
import { mountTrainer } from './ui.js';

/** Iframes on this page that are big enough to be a game, with what we can know about them. */
export function listGameFrames(win, reports = []) {
  const out = [];
  const vw = win.innerWidth || 1;
  const vh = win.innerHeight || 1;
  for (const el of win.document.querySelectorAll('iframe')) {
    const r = el.getBoundingClientRect();
    const area = Math.max(0, r.width) * Math.max(0, r.height);
    if (r.width < 200 || r.height < 150) continue; // ads, trackers, widgets
    let sameOrigin = false;
    let href = el.src || el.getAttribute('src') || '';
    try {
      href = el.contentWindow.location.href;
      sameOrigin = true;
    } catch {
      sameOrigin = false;
    }
    let origin = '';
    try {
      origin = new URL(href, win.location.href).origin;
    } catch {
      origin = 'unknown';
    }
    const report = reports.find((x) => x.source === el.contentWindow);
    out.push({ el, href, origin, sameOrigin, width: Math.round(r.width), height: Math.round(r.height), share: Math.round((area / (vw * vh)) * 100), report });
  }
  return out.sort((a, b) => b.width * b.height - a.width * a.height);
}

export function openTrainer(win, extra = {}) {
  if (win.__saveforgeTrainer) {
    win.__saveforgeTrainer.show();
    return win.__saveforgeTrainer;
  }
  const origin = (() => {
    try {
      return win.location.origin;
    } catch {
      return 'page';
    }
  })();
  const { frameReports, openInFrame, contextInfo, saveSyncMs, safeMode: safeArg, ...rest } = extra;
  // a previous start that never finished (the tab crashed or reloaded while scanning)
  const interrupted = safeArg === undefined ? interruptedStartup(win) : null;
  let safeMode = !!safeArg;
  const perf = new PerfLog(win);
  win.__saveforgeStarting = true;
  const uiStore = createStore(win, `${origin}|ui`);
  // scan profile (Low Memory Mode on phones by default); read before any scan starts
  const settingsP = uiStore
    .get('perf', {})
    .catch(() => ({}))
    .then((saved) => resolveSettings(saved || {}, win));
  let deepFor = new Set(); // sources the user asked to scan deeply
  let scanSignal = null;
  let progressFn = null;

  // results kept from the last time the trainer was closed on this page: reopening does not
  // repeat an expensive scan (Rescan game does it on request)
  const cache = win.__saveforgeCache && Date.now() - win.__saveforgeCache.at < win.__saveforgeCache.ttl ? win.__saveforgeCache : null;
  if (cache) win.clearTimeout(cache.timer);
  delete win.__saveforgeCache;

  const st0 = perf.start('detect engines');
  let engines = cache ? cache.engines : detectLiveEngines(win, { generic: !(interrupted || safeMode) });
  let limitations = liveLimitations(win);
  // SugarCube: when window.SugarCube is not visible from here, find out why and use the
  // page bridge if SaveForge runs in an isolated userscript/extension world
  let scProbe = cache ? cache.scProbe : null;
  if (!cache && !engines.some((e) => e.id === 'sugarcube')) {
    scProbe = probeSugarCube(win);
    if (scProbe.verdict === 'bridge') engines.unshift(sugarCubeBridge(win, pageBridge(win).rpc));
  }
  perf.end(st0, { engines: engines.map((e) => e.id).join(', ') });
  // one shared set of save variables (the Save Editor's pipeline) for every view
  const hub = cache ? cache.hub : new SaveHub(win, createStore(win, `${origin}|storage`), extra.saveSyncMs ? { autoMs: extra.saveSyncMs } : undefined);
  settingsP.then((P) => {
    hub.profile = P;
    if (!cache) hub.includeIndexedDB = !!P.readIndexedDB;
    if (!extra.saveSyncMs) hub.autoMs = P.hubAutoMs || 0;
    if (!P.hubAutoMs) hub.setAuto(false);
  });
  const sourceFor = (e) => ({
    id: e.id,
    label: e.name,
    channel: e.channel,
    create: async () => {
      const P = await settingsP;
      e.profile = deepFor.has(e.id) ? { ...P, ...PROFILES.deep, name: PROFILES.deep.name } : P;
      const store = createStore(win, `${origin}|${e.id}`);
      if (e.useStore) await e.useStore(store);
      if (e.prepare) await perf.time(`prepare: ${e.name}`, () => e.prepare());
      scanSignal = createSignal();
      const p = await LiveProvider.createAsync(win, e, store, { signal: scanSignal, sliceMs: e.profile.sliceMs || 8, perf, onProgress: (x) => progressFn && progressFn(x) });
      scanSignal = null;
      if (safeMode) return p; // Safe Mode: no save reading, no background work
      finishStartup(win);
      win.__saveforgeStarting = false;
      // save variables appear as soon as the saves are read (never blocks the live list)
      hub.ensure().then(() => p.attachSaves(hub));
      return p;
    },
  });
  const sources = engines.map(sourceFor);
  const engineInfo = () => engines.map((e) => ({ id: e.id, name: e.name, channel: e.channel }));
  // "Rescan game": engines that finished loading after the trainer opened become new sources
  const rescanSources = () => {
    const now = detectLiveEngines(win);
    const added = now.filter((e) => !engines.some((x) => x.id === e.id));
    engines = [...engines, ...added];
    limitations = liveLimitations(win);
    return added.map(sourceFor);
  };
  // every reachable variable, unclassified — created only when the user opens it
  let rawEngine = null;
  const getRaw = async () => {
    if (!rawEngine) {
      rawEngine = rawGlobals(win);
      await rawEngine.prepare();
    }
    return rawEngine;
  };
  sources.push({
    id: 'raw',
    label: 'All variables (raw)',
    channel: 'live-generic',
    create: async () => new LiveProvider(win, await getRaw(), createStore(win, `${origin}|raw`)),
  });
  sources.push({
    id: 'storage',
    label: 'Saves in storage',
    channel: 'reload',
    create: async () => {
      await settingsP;
      let p = await perf.time('read saves', () => hub.ensure());
      if (!p) throw new Error(hub.error || 'Browser storage could not be decoded.');
      // opening this source is the request to read IndexedDB too (large binaries stay unread)
      if (!hub.includeIndexedDB && (p.dump.indexedDBNotRead || []).length) await perf.time('read IndexedDB saves', () => hub.readIndexedDB());
      p = hub.provider;
      return p;
    },
  });

  const diagnostics = async () => {
    const generic = engines.find((e) => e.id === 'generic');
    const frames = listGameFrames(win, frameReports ? await frameReports() : []);
    return {
      context: contextInfo ? await contextInfo() : { world: 'page', detail: 'Running in the page’s own JavaScript context (bookmarklet, extension or same-site frame).' },
      frame: frameLabel(win),
      href: safe(() => win.location.href),
      engines: engines.map((e) => ({ id: e.id, name: e.name, channel: e.channel, evidence: e.evidence || (e.id === 'generic' ? 'page globals scored as game state' : '') })),
      limitations,
      globals: generic ? generic.classification() : [],
      sugarcube: sugarCubeReport(),
      detection: detectionSummary(generic),
      frames: frames.map((f) => ({
        href: f.href,
        origin: f.origin,
        sameOrigin: f.sameOrigin,
        size: `${f.width}×${f.height}`,
        share: f.share,
        saveforge: f.report ? (f.report.game ? `running · game detected (${f.report.reason})` : 'running · no game detected there') : f.sameOrigin ? 'not running (same site: can be opened from here)' : 'not running in this frame',
        actions: frameActions(f),
      })),
    };
  };

  /**
   * Full diagnostic scan: walks everything reachable (unclassified) and compares it
   * with what the classified sources list, so "not reached" and "reached but
   * excluded" are told apart. Also says what could not be reached at all, and why.
   */
  const fullScan = async (providers = []) => {
    const raw = await getRaw();
    raw.refresh();
    const t = raw.snapshot();
    const rep = raw.scanReport();
    const leaves = [];
    const walk = (n, path) => {
      for (const c of n.children || []) {
        const p = [...path, c.key];
        if (c.children) walk(c, p);
        else if (['int', 'float', 'bool', 'string'].includes(c.type)) leaves.push({ id: c.id, path: p.join('.'), type: c.type, value: c.value });
      }
    };
    walk(t.root, []);
    const generic = engines.find((e) => e.id === 'generic');
    const listed = new Set();
    for (const p of providers) for (const e of p.entries || []) listed.add(e.nodeId);
    return { leaves, report: rep, lexical: raw.lexical(), special: raw.special(), generic: generic ? { leaves: generic.leaves(), report: generic.scanReport ? generic.scanReport() : null } : null, listed };
  };

  /** The SugarCube connection report and an exact State path lookup (Diagnostics). */
  function sugarCubeReport() {
    const eng = engines.find((e) => e.id === 'sugarcube');
    const probe = eng ? { verdict: eng.bridged ? 'bridge' : 'direct', reason: eng.bridged ? 'Connected through the page bridge (SaveForge runs isolated from the page).' : 'Connected directly to SugarCube.State.', steps: (scProbe && scProbe.steps) || [], markers: storyMarkers(win.document) } : probeSugarCube(win);
    return {
      ...probe,
      frames: undefined,
      connected: !!eng,
      lookup: (expr) => {
        const path = parseStatePath(expr);
        if (!path) return { error: 'Use a path like player.money, $player.money, State.variables.player.money or _temp' };
        if (!eng) return { error: `Not connected to the live State: ${probe.reason}`, path };
        try {
          return { path, ...eng.lookup(path) };
        } catch (e) {
          return { path, error: e.message };
        }
      },
    };
  }

  function frameActions(f) {
    const acts = [];
    if (f.report && openInFrame) acts.push({ label: 'Open trainer in this frame', run: () => openInFrame(f.report) });
    else if (f.sameOrigin) acts.push({ label: 'Open trainer in this frame', run: () => openTrainer(f.el.contentWindow) });
    if (f.href && /^https?:/.test(f.href)) acts.push({ label: 'Open game frame directly', run: () => win.open(f.href, '_blank', 'noopener') });
    return acts;
  }

  // a story that starts after the trainer opened (loading screen, "Start" passage) is
  // connected as soon as its State is ready
  let scTimer = 0;
  const scWatch = () => {
    if (!scProbe || !['not-started', 'hidden', 'blocked'].includes(scProbe.verdict) || !storyMarkers(win.document).sugarcube) return;
    let tries = 0;
    scTimer = win.setInterval(() => {
      tries++;
      if (engines.some((e) => e.id === 'sugarcube') || tries > 90) return void win.clearInterval(scTimer);
      let eng = sugarCubeDirect(win);
      if (!eng) {
        const p = probeSugarCube(win);
        if (p.verdict === 'bridge') eng = sugarCubeBridge(win, pageBridge(win).rpc);
        scProbe = p;
      }
      if (!eng) return;
      win.clearInterval(scTimer);
      engines = [eng, ...engines];
      scProbe = { verdict: eng.bridged ? 'bridge' : 'direct', reason: 'Connected after the story started.', steps: [], markers: storyMarkers(win.document), frames: [] };
      win.__saveforgeTrainer?.addSources?.([sourceFor(eng)], { select: true, note: `SugarCube connected${eng.bridged ? ' through the page bridge' : ''}` });
    }, 1000);
  };

  /** Deep scan on request: bigger limits for one source (never automatic). */
  const deepScan = async (id) => {
    deepFor.add(id);
    const e = engines.find((x) => x.id === id);
    if (!e) return null;
    if (id === 'storage' || id === 'raw') return null;
    e.profile = { ...(await settingsP), ...PROFILES.deep, name: PROFILES.deep.name };
    return e;
  };

  const ctl = mountTrainer(win, {
    sources,
    limitations,
    diagnostics,
    fullScan,
    perf,
    settingsP,
    deepScan,
    interrupted,
    safeMode: () => safeMode,
    enterSafeMode: () => {
      safeMode = true;
    },
    stopScan: () => scanSignal && scanSignal.abort('stopped by you'),
    onScanProgress: (fn) => (progressFn = fn),
    prefilled: cache ? cache.providers : null,
    onReady: () => {
      finishStartup(win);
      win.__saveforgeStarting = false;
    },
    cachedAt: cache ? cache.at : null,
    keepOnClose: (providers) => {
      // keep scan results for a while so reopening is instant; timers are paused, locks released
      const P = resolveSettingsSync();
      if (P && P.keepResults === false) return false;
      const ttl = P && P.lowMemory ? 3 * 60 * 1000 : 10 * 60 * 1000;
      for (const pr of providers.values()) {
        pr.unlockAll?.();
        pr.setPaused?.(true);
      }
      hub.stopAuto();
      const c = { providers, engines, hub, scProbe, at: Date.now(), ttl };
      c.timer = win.setTimeout(() => {
        if (win.__saveforgeCache !== c) return;
        for (const pr of providers.values()) pr.dispose?.();
        hub.dispose();
        delete win.__saveforgeCache;
      }, ttl);
      win.__saveforgeCache = c;
      return true;
    },
    engineInfo: engineInfo(),
    engineInfoRefresh: engineInfo,
    rescanSources,
    saveHub: hub,
    store: uiStore,
    onClose: (kept) => {
      if (!kept) hub.dispose();
      scanSignal?.abort('closed');
      win.__saveforgeStarting = false;
      win.clearInterval(scTimer);
      delete win.__saveforgeTrainer;
    },
    ...rest,
  });
  win.__saveforgeTrainer = ctl;
  ctl.perf = () => ({ stages: perf.stages, last: perf.lastCompleted()?.name || null, current: perf.current?.name || null });
  let settingsNow = null;
  settingsP.then((P) => (settingsNow = P));
  function resolveSettingsSync() {
    return settingsNow;
  }
  if (!interrupted && !safeMode) scWatch();
  return ctl;
}

/** Why the generic detector found what it found (or nothing), for Diagnostics. */
function detectionSummary(generic) {
  if (!generic) return { available: false, leaves: [], counts: { game: 0, potential: 0, text: 0, excluded: 0 } };
  const leaves = generic.leaves();
  const counts = { game: 0, potential: 0, text: 0, excluded: 0 };
  for (const l of leaves) counts[l.tier] = (counts[l.tier] || 0) + 1;
  return { available: true, scanned: leaves.length > 0, leaves, counts, marks: generic.marks() };
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** "player.money", "$player.money", "State.variables.player.money", "_tmp", "State.temporary.x" → ['variables'|'temporary', ...] */
export function parseStatePath(expr) {
  let e = String(expr || '').trim().replace(/^SugarCube\./, '');
  let root = 'variables';
  if (/^State\.temporary\./.test(e)) (root = 'temporary'), (e = e.replace(/^State\.temporary\./, ''));
  else if (/^State\.variables\./.test(e)) e = e.replace(/^State\.variables\./, '');
  else if (/^_/.test(e)) (root = 'temporary'), (e = e.slice(1));
  else e = e.replace(/^\$/, '');
  const parts = e
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\[["']([^"']+)["']\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  return parts.length ? [root, ...parts] : null;
}
