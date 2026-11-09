// Opens the trainer on a game page. Used by:
//   - standalone/trainer.js (bookmarklet / Safari extension; runs on the game's own page)
//   - the userscript (in whichever frame actually holds the game)
//   - the SaveForge app, for games loaded same-origin in its Game tab

import { detectLiveEngines, liveLimitations, rawGlobals } from './engines.js';
import { frameLabel, LiveProvider, StorageProvider } from './providers.js';
import { createStore } from './store.js';
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
  const { frameReports, openInFrame, contextInfo, ...rest } = extra;
  let engines = detectLiveEngines(win);
  let limitations = liveLimitations(win);
  const sourceFor = (e) => ({
    id: e.id,
    label: e.name,
    channel: e.channel,
    create: async () => {
      const store = createStore(win, `${origin}|${e.id}`);
      if (e.useStore) await e.useStore(store);
      if (e.prepare) await e.prepare();
      return new LiveProvider(win, e, store);
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
    create: () => StorageProvider.create(win, createStore(win, `${origin}|storage`)),
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

  function frameActions(f) {
    const acts = [];
    if (f.report && openInFrame) acts.push({ label: 'Open trainer in this frame', run: () => openInFrame(f.report) });
    else if (f.sameOrigin) acts.push({ label: 'Open trainer in this frame', run: () => openTrainer(f.el.contentWindow) });
    if (f.href && /^https?:/.test(f.href)) acts.push({ label: 'Open game frame directly', run: () => win.open(f.href, '_blank', 'noopener') });
    return acts;
  }

  const ctl = mountTrainer(win, {
    sources,
    limitations,
    diagnostics,
    fullScan,
    engineInfo: engineInfo(),
    engineInfoRefresh: engineInfo,
    rescanSources,
    store: createStore(win, `${origin}|ui`),
    onClose: () => {
      delete win.__saveforgeTrainer;
    },
    ...rest,
  });
  win.__saveforgeTrainer = ctl;
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
