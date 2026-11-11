// Opens the trainer on a game page. Used by:
//   - standalone/trainer.js (bookmarklet / Safari extension; runs on the game's own page)
//   - the userscript (in whichever frame actually holds the game)
//   - the SaveForge app, for games loaded same-origin in its Game tab

import { detectLiveEngines, liveLimitations, rawGlobals } from './engines.js';
import { frameLabel, LiveProvider } from './providers.js';
import { clearPrefix, createStore } from './store.js';
import { gameAddress, gameContext, gameTokens, markContent, watchContext } from './context.js';
import { SaveOwnership } from './save-owner.js';
import { currentStory, isSugarCubePage, storyIdOfKey } from './sugarcube-saves.js';
import { SaveHub } from './save-hub.js';
import { BUILD, VERSION } from '../version.js';
import { createSignal, finishStartup, interruptedStartup, PerfLog, PROFILES, resolveSettings } from './perf.js';
import { probeSugarCube, sugarCubeBridge, storyMarkers, pageBridge } from './sugarcube-live.js';
import { sugarCubeDirect } from './engines.js';
import { mountTrainer } from './ui.js';
import { renpyEngine, renpyUnavailableEngine, renpyWebInfo } from './renpy-live.js';
import { buildLiveTree } from './live-tree.js';
import { createInputInspector } from './input-inspector.js';

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

/** This copy of SaveForge (userscript, bookmarklet, extension…): version + an id per JS world. */
export const SF_VERSION = VERSION;
export const SF_BUILD = BUILD;
const SF_ID = Math.random().toString(36).slice(2, 8);

/** Every SaveForge copy that opened a trainer on this page (shared through the DOM). */
export function saveforgeCopies(win) {
  try {
    return (win.document.documentElement.getAttribute('data-saveforge-copies') || '').split(' ').filter(Boolean).map((x) => {
      const [version, id] = x.split('@');
      return { version, id, self: id === SF_ID };
    });
  } catch {
    return [];
  }
}

export function openTrainer(win, extra = {}) {
  if (win.__saveforgeTrainer) {
    win.__saveforgeTrainer.show();
    return win.__saveforgeTrainer;
  }
  // Another SaveForge copy (a second installed script, an older version, the extension…) runs in
  // another JavaScript world, so the global above cannot see it — but the DOM is shared. Never
  // open a second panel: show the existing one instead.
  try {
    const de = win.document.documentElement;
    const mine = `${SF_VERSION}@${SF_ID}`;
    const list = (de.getAttribute('data-saveforge-copies') || '').split(' ').filter(Boolean);
    if (!list.includes(mine)) de.setAttribute('data-saveforge-copies', [...list, mine].join(' '));
    const other = win.document.querySelector('saveforge-trainer');
    if (other && other.getAttribute('data-sf-id') !== SF_ID) {
      other.dispatchEvent(new win.CustomEvent('saveforge-show'));
      const stub = { show: () => other.dispatchEvent(new win.CustomEvent('saveforge-show')), hide() {}, destroy() {}, provider: () => null, duplicateOf: other.getAttribute('data-sf-version') || '?' };
      return stub;
    }
  } catch {
    /* no DOM access */
  }
  const origin = (() => {
    try {
      return win.location.origin;
    } catch {
      return 'page';
    }
  })();
  // the caller's onClose (the userscript's) runs in addition to SaveForge's own cleanup, never instead of it
  const { frameReports, openInFrame, contextInfo, saveSyncMs, safeMode: safeArg, onClose: callerOnClose, reason: openReason, instances: instancesFn, ...rest } = extra;
  // objects a previous game in this document left behind (2.3.2): only while they are unchanged
  const leftover = new Map();
  for (const [k, v] of (win.__saveforgeLeftover && win.__saveforgeLeftover.objects) || []) {
    try {
      if (Object.getOwnPropertyDescriptor(win, k)?.value === v) leftover.set(k, v);
    } catch {
      /* gone */
    }
  }
  // ---- which game this trainer belongs to (2.3): everything below is scoped to it
  const gctx = gameContext(win, openReason || (contextInfo ? 'opened by the SaveForge userscript in this frame' : 'opened on this page (bookmarklet, extension or the SaveForge app)'));
  let stale = ''; // set when this page now shows another game: nothing may be written any more
  let closed = false;
  const guard = () => {
    if (closed) throw new Error('This trainer was closed. Nothing was written.');
    const now = gameAddress(win).key;
    if (stale || now !== gctx.addressKey) {
      throw new Error(`This page now shows a different game (${now}). Nothing was written: SaveForge only edits the game it scanned, and is switching to the new game.`);
    }
  };
  // Stores: per GAME (game key), not per website as before 2.3. A few interface preferences
  // (panel position, performance profile, label language) stay per website. Data stored per
  // website by older versions is inherited by the first game opened there after the update only.
  const siteStore = createStore(win, `${origin}|ui`);
  const metaStore = createStore(win, `${gctx.key}|meta`);
  let legacyP = null;
  const legacyUse = () =>
    (legacyP ||= (async () => {
      if (await metaStore.get('legacy-off', false)) return false;
      const owner = await siteStore.get('legacy-owner', null);
      if (!owner) {
        await siteStore.set('legacy-owner', gctx.key);
        return true;
      }
      return owner === gctx.key;
    })().catch(() => false));
  const scoped = (part, skip = []) => createStore(win, `${gctx.key}|${part}`, { scope: `${origin}|${part}`, use: legacyUse, skip: new Set(skip) });
  const SITE_PREFS = new Set(['pos', 'perf', 'englishLabels', 'enInResults', 'compact', 'saveAutoSync']);
  const gameUi = scoped('ui', ['sc-verify']);
  const pick = (n) => (SITE_PREFS.has(n) ? siteStore : gameUi);
  // a previous start that never finished (the tab crashed or reloaded while scanning)
  const interrupted = safeArg === undefined ? interruptedStartup(win) : null;
  let safeMode = !!safeArg;
  const perf = new PerfLog(win);
  win.__saveforgeStarting = true;
  const uiStore = { scope: gameUi.scope, get: (n, f) => pick(n).get(n, f), set: (n, v) => pick(n).set(n, v), addBackup: (r) => gameUi.addBackup(r), backups: () => gameUi.backups() };
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
  // — only for the SAME game in the same document: after a single-page navigation the kept
  // objects belong to the previous game and are thrown away
  let cache = win.__saveforgeCache || null;
  if (cache) {
    win.clearTimeout(cache.timer);
    delete win.__saveforgeCache;
    if (Date.now() - cache.at >= cache.ttl || cache.ctxKey !== gctx.key || cache.docId !== gctx.docId) {
      dropCache(cache);
      cache = null;
    }
  }

  // Ren'Py web (2.3.1): opens light — no page-global scan, no storage read, no SugarCube probe.
  // Its variables come from Ren'Py itself (renpy-live.js) when the build allows it.
  const rp = renpyWebInfo(win);
  const lightweight = rp.renpy;
  const renpyEngines = () => {
    if (!rp.exec) return [renpyUnavailableEngine(win, rp, { buildLiveTree })];
    const eng = renpyEngine(win, { buildLiveTree });
    eng.actions = [
      {
        label: "Show Ren'Py's own variables too",
        hint: "Also list the engine's store variables (config-like flags Ren'Py defines), not only the game's.",
        run: async () => {
          await eng.setShowAll(!eng.showsAll());
          win.__saveforgeTrainer?.provider?.()?.relearn?.();
        },
      },
    ];
    return [eng];
  };
  const st0 = perf.start('detect engines');
  let engines = cache ? cache.engines : lightweight ? renpyEngines() : detectLiveEngines(win, { generic: !(interrupted || safeMode), leftover });
  let limitations = liveLimitations(win);
  // SugarCube: when window.SugarCube is not visible from here, find out why and use the
  // page bridge if SaveForge runs in an isolated userscript/extension world
  let scProbe = cache ? cache.scProbe : null;
  if (!cache && !lightweight && !engines.some((e) => e.id === 'sugarcube')) {
    scProbe = probeSugarCube(win);
    if (scProbe.verdict === 'bridge') engines.unshift(sugarCubeBridge(win, pageBridge(win).rpc));
  }
  perf.end(st0, { engines: engines.map((e) => e.id).join(', ') });
  // one shared set of save variables (the Save Editor's pipeline) for every view
  const hub = cache ? cache.hub : new SaveHub(win, scoped('storage', ['save-links', 'verify']), extra.saveSyncMs ? { autoMs: extra.saveSyncMs } : undefined);
  hub.guard = guard;
  if (hub.provider) hub.provider.guard = guard;
  // saves of other games on this website are never this game's save variables
  if (!hub.ownership) {
    hub.ownership = new SaveOwnership(siteStore, gctx, gameTokens(win));
    // SugarCube names its keys after the story: on a page that is not a SugarCube story, none is
    // this game's (2.3.2: a lone story's saves used to count as "current" on any page)
    hub.ownership.hint = (name, kind) => {
      if (kind !== 'localStorage') return null;
      const id = storyIdOfKey(name);
      if (!id) return null;
      const st = currentStory(win);
      if (!st.page) return { owner: `sugarcube:${id}`, title: `SugarCube story “${id}” (this page is not a SugarCube story)` };
      if (!st.current) return null; // several stories, this one unknown: not confirmed
      if (id !== st.current) return { owner: `sugarcube:${id}`, title: `SugarCube story “${id}”` };
      return st.verified ? 'me' : 'probable';
    };
    // the engines this page actually runs (a save of another engine is another game's)
    Object.defineProperty(hub.ownership, 'pageEngines', {
      get: () => {
        const ids = new Set(engines.map((e) => e.id));
        const out = new Set();
        if (ids.has('sugarcube') || isSugarCubePage(win)) out.add('sugarcube');
        if (ids.has('rpgmaker')) out.add('rpgmaker');
        if (lightweight || limitations.some((l) => l.id === 'renpy-web')) out.add('renpy');
        return out;
      },
    });
  }
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
      const store = scoped(e.id);
      if (e.useStore) await e.useStore(store);
      if (closed || stale) throw new Error('Closed before the scan started.');
      if (e.prepare) await perf.time(`prepare: ${e.name}`, () => e.prepare());
      if (closed || stale) throw new Error('Closed before the scan started.');
      scanSignal = createSignal();
      const p = await LiveProvider.createAsync(win, e, store, { signal: scanSignal, sliceMs: e.profile.sliceMs || 8, perf, onProgress: (x) => progressFn && progressFn(x) });
      scanSignal = null;
      p.guard = guard;
      p.gameContext = gctx;
      if (leftover.size) p.leftover = new Set(leftover.keys());
      // closed, or the game changed, while scanning: this result is never shown and never runs
      if (closed || stale) {
        p.dispose();
        throw new Error('Closed while scanning.');
      }
      if (safeMode) return p; // Safe Mode: no save reading, no background work
      finishStartup(win);
      win.__saveforgeStarting = false;
      // save variables appear as soon as the saves are read (never blocks the live list);
      // Ren'Py keeps its saves as files in IndexedDB: read only when you open Saves in storage
      if (!lightweight) hub.ensure().then(() => !closed && !p.disposed && p.attachSaves(hub));
      return p;
    },
  });
  const sources = engines.map(sourceFor);
  const engineInfo = () => engines.map((e) => ({ id: e.id, name: e.name, channel: e.channel }));
  // "Rescan game": engines that finished loading after the trainer opened become new sources
  const rescanSources = () => {
    const now = detectLiveEngines(win, { leftover });
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
    create: async () => {
      const p = new LiveProvider(win, await getRaw(), scoped('raw'));
      p.guard = guard;
      p.gameContext = gctx;
      return p;
    },
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
      game: { ...gctx, contextId: gctx.id, href: safe(() => win.location.href), current: !stale && gameAddress(win).key === gctx.addressKey, stale, restored: watcher ? watcher.restored() : 0, cachedAt: cache ? cache.at : null },
      instances: await instancesNow(),
      resources: resourcesNow(),
      scan: scanStatus(),
      saveOwners: hub.ownership ? hub.ownership.report() : null,
      renpy: lightweight ? renpyReport() : null,
      sources: sourcesReport(),
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
    // one panel at a time: this one closes before the frame's opens
    const moveTo = (fn) => () => {
      ctl.destroy();
      fn();
    };
    if (f.report && openInFrame) acts.push({ label: 'Open trainer in this frame', run: moveTo(() => openInFrame(f.report)) });
    else if (f.sameOrigin) acts.push({ label: 'Open trainer in this frame', run: moveTo(() => openTrainer(f.el.contentWindow, { reason: 'opened from Diagnostics of the page around this frame' })) });
    if (f.href && /^https?:/.test(f.href)) acts.push({ label: 'Open game frame directly', run: () => win.open(f.href, '_blank', 'noopener') });
    return acts;
  }

  // a story that starts after the trainer opened (loading screen, "Start" passage) is
  // connected as soon as its State is ready
  let scTimer = 0;
  const scWatch = () => {
    if (!scProbe || !['not-started', 'hidden'].includes(scProbe.verdict) || !storyMarkers(win.document).sugarcube) return;
    win.clearInterval(scTimer);
    // a story still loading may publish window.SugarCube for a while; one already running that
    // keeps State private almost never will: check it only briefly, and cheaply (no storage reads)
    const limit = scProbe.verdict === 'not-started' ? 90 : 15;
    const bridge = scProbe.page ? pageBridge(win) : null; // the page-world agent exists only if the page allowed it
    let tries = 0;
    scTimer = win.setInterval(() => {
      tries++;
      if (engines.some((e) => e.id === 'sugarcube') || tries > limit) return void win.clearInterval(scTimer);
      let eng = sugarCubeDirect(win);
      if (!eng && bridge && bridge.rpc) {
        try {
          const pr = bridge.rpc('probe');
          if (pr && pr.present && pr.variablesType === 'object') eng = sugarCubeBridge(win, bridge.rpc);
        } catch {
          /* page agent gone */
        }
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

  let watcher = null;
  // Input Inspector (2.3.3): created now, but it reads nothing until you press Find Answers
  const inputInspector = createInputInspector(win, {
    renpyCall:
      lightweight && rp.exec
        ? (op, args) => {
            const e = engines.find((x) => x.id === 'renpy');
            if (!e || !e.call) throw new Error("Not connected to Ren'Py.");
            return e.call(op, args);
          }
        : null,
  });
  const ctl = mountTrainer(win, {
    inputInspector,
    gameContext: gctx,
    guard,
    resetGameData: () => resetGameData(),
    claimSave: async (id) => {
      hub.ownership?.assign(id, true);
      await hub.sync({ force: true });
    },
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
      // Ren'Py: listing again is one cheap request, and a kept copy would be stale: nothing is kept
      if (lightweight) return false;
      const ttl = P && P.lowMemory ? 3 * 60 * 1000 : 10 * 60 * 1000;
      for (const pr of providers.values()) {
        pr.unlockAll?.();
        pr.setPaused?.(true);
      }
      hub.stopAuto();
      const c = { providers, engines, hub, scProbe, at: Date.now(), ttl, ctxKey: gctx.key, docId: gctx.docId };
      c.timer = win.setTimeout(() => {
        if (win.__saveforgeCache !== c) return;
        dropCache(c);
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
    sfVersion: SF_VERSION,
    sfBuild: SF_BUILD,
    sfId: SF_ID,
    copies: () => saveforgeCopies(win),
    onClose: (kept, how = {}) => {
      closed = true;
      // closing (even during a scan) is your choice, not a crash: the next open is not offered Safe Mode
      finishStartup(win);
      watcher?.stop();
      // saves this game wrote since the last read are its own (unless the page already changed game)
      if (!stale) hub.ownership?.observeLocal(win);
      if (!kept) hub.dispose();
      scanSignal?.abort('closed');
      win.clearInterval(scTimer);
      scTimer = 0;
      win.__saveforgeStarting = false;
      if (win.__saveforgeTrainer === ctl) delete win.__saveforgeTrainer;
      // switching to the new game is not a close: the caller (userscript launcher) is not told
      if (how.restart) return;
      try {
        callerOnClose?.(kept);
      } catch {
        /* caller cleanup is best-effort */
      }
    },
    ...rest,
  });
  win.__saveforgeTrainer = ctl;
  for (const pr of cache ? cache.providers.values() : []) pr.guard = guard;
  ctl.perf = () => ({ stages: perf.stages, last: perf.lastCompleted()?.name || null, current: perf.current?.name || null });

  // ---- the page becomes another game: never keep showing (or writing) the previous one.
  // The trainer closes its scan of the old game and opens again for the new one by itself.
  const reopen = (why, notice) =>
    win.setTimeout(() => {
      if (win.__saveforgeTrainer) return; // opened again meanwhile
      try {
        openTrainer(win, { ...extra, reason: why, notice, startMinimized: !!ctl.state?.().minimized });
      } catch (e) {
        console.debug('SaveForge could not reopen:', e);
      }
    }, 700);
  watcher = watchContext(win, gctx, {
    onChange: ({ to, why, content, leftover: left }) => {
      if (stale || closed) return;
      stale = `${why}: ${to}`;
      if (content) {
        // same address: the document now carries which game it shows, and what the old one left
        markContent(win, content);
        win.__saveforgeLeftover = { objects: left, at: Date.now() };
      }
      scanSignal?.abort('the game changed');
      ctl.destroy({ keep: false, restart: true });
      reopen(`the page switched to another game (${why})`, 'This page now shows another game: SaveForge switched to it. Nothing from the previous game is shown or written.');
    },
    onRestore: () => {
      // Safari restored the page from its back-forward cache: same game; read its saves again
      if (hub.provider && !closed) hub.sync().catch(() => {});
    },
  });
  if (stale === '' && gameAddress(win).key !== gctx.addressKey) watcher.check('changed while opening');
  const uiState = ctl.state;
  ctl.state = () => ({ ...(uiState ? uiState() : {}), contextId: gctx.id, gameKey: gctx.key, href: safe(() => win.location.href), restored: watcher.restored(), stale, closed });
  ctl.context = () => gctx;
  ctl.diagnosticsData = diagnostics;
  ctl.resources = resourcesNow;

  /** Where every listed variable comes from: live roots (this frame) and save entries with their owner. */
  function sourcesReport() {
    const live = new Map();
    for (const p of ctl.providers ? ctl.providers() : []) {
      if (p.kind !== 'live') continue;
      for (const e of p.liveEntries || p.entries || []) {
        const root = (e.nodeId.split('/')[1] || '').replace(/~1/g, '/').replace(/~0/g, '~');
        const k = `${p.engine.name}|${root}`;
        if (!live.has(k)) live.set(k, { source: p.engine.name, root, count: 0, frame: gctx.frame, state: p.leftover?.has(root) ? 'left over from the previous game' : 'this game' });
        live.get(k).count++;
      }
    }
    return { frame: gctx.frame, href: safe(() => win.location.href), live: [...live.values()].sort((a, b) => b.count - a.count).slice(0, 40), saves: hub.ownership ? hub.ownership.report().entries : [] };
  }
  function resourcesNow() {
    const r = ctl.uiResources ? ctl.uiResources() : { timers: 0, listeners: 0, observers: 0 };
    const out = { timers: r.timers, listeners: r.listeners, observers: r.observers || 0, detail: [...(r.detail || [])] };
    const add = (what, t = 0, l = 0) => {
      if (!t && !l) return;
      out.timers += t;
      out.listeners += l;
      out.detail.push(`${what}: ${t ? `${t} timer(s)` : ''}${t && l ? ', ' : ''}${l ? `${l} listener(s)` : ''}`);
    };
    if (watcher) add('game change watcher', watcher.timers(), watcher.listeners());
    add('SugarCube start watcher', scTimer ? 1 : 0);
    add('save auto-sync', hub.timer ? 1 : 0);
    for (const p of ctl.providers ? ctl.providers() : []) {
      const x = p.resources ? p.resources() : null;
      if (x) add(`scan “${p.title || p.kind}”`, x.timers, x.listeners);
    }
    return out;
  }
  async function instancesNow() {
    const doc = win.document;
    const vis = (el) => el.isConnected && el.style.display !== 'none';
    const local = {
      panels: [...doc.querySelectorAll('saveforge-trainer')].filter(vis).length,
      launchers: [...doc.querySelectorAll('saveforge-launcher')].filter(vis).length,
      copies: saveforgeCopies(win).length || 1,
    };
    try {
      return { ...local, ...(instancesFn ? await instancesFn() : {}) };
    } catch {
      return local;
    }
  }
  function scanStatus() {
    const last = perf.lastCompleted?.();
    return { running: !!scanSignal, current: perf.current?.name || null, last: last ? last.name : null, lastAt: last ? last.end || last.at || null : null, cachedAt: cache ? cache.at : null, openedAt: gctx.since };
  }
  /** Reset this game's trainer data: SaveForge's own records for this game only. Never the game's saves. */
  async function resetGameData() {
    const n = await clearPrefix(win, `${gctx.key}|`);
    hub.ownership?.forgetMine();
    await metaStore.set('legacy-off', true); // and do not inherit pre-2.3 per-website data again
    ctl.destroy({ keep: false, restart: true });
    win.setTimeout(() => {
      if (!win.__saveforgeTrainer) openTrainer(win, { ...extra, reason: 'reopened after “Reset this game’s trainer data”', notice: `SaveForge’s data for this game was reset (${n} record(s): favorites, recent, marks, learned links, Linker mappings). The game’s own saves were not touched.` });
    }, 50);
    return n;
  }
  let settingsNow = null;
  settingsP.then((P) => (settingsNow = P));
  function resolveSettingsSync() {
    return settingsNow;
  }
  if (!interrupted && !safeMode && !lightweight) scWatch();
  // the "Inspect the saves" action of the Ren'Py screen needs the controller
  for (const e of engines) if (e.id === 'renpy-info') e.actions = [{ label: 'Inspect the saves (Saves in storage)', hint: "Reads Ren'Py's save files from the browser storage (on request only).", run: () => ctl.selectSource('storage') }];
  function renpyReport() {
    const e = engines.find((x) => x.id === 'renpy' || x.id === 'renpy-info');
    return {
      evidence: rp.evidence,
      exec: rp.exec,
      reason: rp.reason,
      connected: !!(e && e.id === 'renpy' && e.info),
      version: e?.info?.version || '',
      name: e?.info?.name || '',
      listed: e?.scanReport?.()?.listed ?? null,
      total: e?.info?.total ?? null,
      gameVariables: e?.info?.ebc ?? null,
      bridge: e?.bridgeStats ? e.bridgeStats() : null,
      lastError: e?.lastError ? e.lastError() : '',
    };
  }
  return ctl;
}

/** Ends a kept scan: its providers and save hub stop for good. */
function dropCache(c) {
  try {
    for (const pr of c.providers.values()) pr.dispose?.();
    c.hub?.dispose?.();
  } catch {
    /* already gone */
  }
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
