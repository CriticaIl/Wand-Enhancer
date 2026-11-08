// Opens the trainer on a game page. Used by:
//   - standalone/trainer.js (bookmarklet / Safari extension; runs on the game's own page)
//   - the userscript (in whichever frame actually holds the game)
//   - the SaveForge app, for games loaded same-origin in its Game tab

import { detectLiveEngines, liveLimitations } from './engines.js';
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
  const { frameReports, openInFrame, ...rest } = extra;
  const engines = detectLiveEngines(win);
  const limitations = liveLimitations(win);
  const sources = engines.map((e) => ({
    id: e.id,
    label: e.name,
    channel: e.channel,
    create: async () => {
      if (e.prepare) await e.prepare();
      return new LiveProvider(win, e, createStore(win, `${origin}|${e.id}`));
    },
  }));
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
      frame: frameLabel(win),
      href: safe(() => win.location.href),
      engines: engines.map((e) => ({ id: e.id, name: e.name, channel: e.channel, evidence: e.evidence || (e.id === 'generic' ? 'page globals scored as game state' : '') })),
      limitations,
      globals: generic ? generic.classification() : [],
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
    store: createStore(win, `${origin}|ui`),
    onClose: () => {
      delete win.__saveforgeTrainer;
    },
    ...rest,
  });
  win.__saveforgeTrainer = ctl;
  return ctl;
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}
