// SaveForge Trainer userscript entry (Userscripts / Stay / Tampermonkey on iOS Safari).
//
// Activation, without relying on any manager-specific API (GM_* is unavailable
// in page context, and menu commands are not supported everywhere on iOS):
//   - auto (default): a small launcher appears only on pages that look like a game
//   - add #saveforge to the address to open the trainer on any page
//   - #saveforge-on  → always show the launcher on this site
//   - #saveforge-off → never show it on this site
//   - long-press the launcher for the same choices
// On ordinary websites nothing is added, stored or loaded.

import { openTrainer } from '../trainer/inject.js';
import { getMode, looksLikeGame, probeContext, setMode } from './activation.js';

const VERSION = typeof __SAVEFORGE_VERSION__ === 'string' ? __SAVEFORGE_VERSION__ : 'dev';
// 'auto' for the normal script; the "always visible" variant is built with 'always'
const DEFAULT_MODE = typeof __SAVEFORGE_DEFAULT_MODE__ === 'string' ? __SAVEFORGE_DEFAULT_MODE__ : 'auto';
// re-check for games that appear late (lazy loaders, "Play" buttons, ads before the game)
const DETECT_SCHEDULE = [1500, 4000, 8000, 15000, 30000, 60000];
const HELP_URL = 'https://github.com/CriticaIl/Wand-Enhancer/blob/claude/html5-game-save-analyzer-ogbcnf/save-analyzer/USERSCRIPT.md';

export function startUserscript(win, { detectDelays = DETECT_SCHEDULE, watchMs = 180000 } = {}) {
  if (win.__saveforgeUserscript) return win.__saveforgeUserscript;
  const doc = win.document;
  let launcher = null;
  let mode = 'auto';
  let detected = null;

  const api = {
    version: VERSION,
    open,
    openHere: () => openHere(),
    frameReports: () => [...reports.values()],
    get mode() {
      return mode;
    },
    setMode: changeMode,
    launcherVisible: () => !!launcher && launcher.host.style.display !== 'none',
    saved: Promise.resolve(), // settles once the latest per-site choice is stored
  };
  win.__saveforgeUserscript = api;

  // ---------------------------------------------------------------- frames
  // Games on portals usually run in an iframe (often another site, sometimes
  // nested). This script runs in every frame; each instance reports a detected
  // game to its parent, reports are relayed up, and "open" is routed down to the
  // frame that actually holds the game. Messages are namespaced and checked
  // against the sending window; frames without a game stay silent unless the
  // user opens SaveForge (which pings them for the Diagnostics screen).
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const MSG = '__saveforge';
  const routes = new Map(); // report id -> direct child window that leads to it
  const reports = new Map(); // report id -> report (from descendants)
  const isTop = (() => {
    try {
      return win === win.top;
    } catch {
      return false;
    }
  })();
  const isChildWindow = (w) => {
    for (let i = 0; i < win.frames.length; i++) if (win.frames[i] === w) return true;
    return false;
  };
  const myReport = () => ({ id, origin: safeOrigin(), href: safeHref(), game: !!detected, reason: detected || '' });
  const post = (target, msg) => {
    try {
      target.postMessage({ [MSG]: 1, ...msg }, '*');
    } catch {
      /* frame gone */
    }
  };
  function reportUp() {
    if (!isTop) post(win.parent, { type: 'report', report: myReport() });
  }
  win.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || d[MSG] !== 1) return;
    if (d.type === 'report' && d.report && isChildWindow(e.source)) {
      routes.set(d.report.id, e.source);
      reports.set(d.report.id, d.report);
      if (d.report.game) hideLauncherForChild();
      if (!isTop) post(win.parent, { type: 'report', report: d.report });
    } else if (e.source === win.parent && d.type === 'ping') {
      reportUp();
      for (let i = 0; i < win.frames.length; i++) post(win.frames[i], { type: 'ping' });
    } else if (e.source === win.parent && d.type === 'open') {
      if (d.target === id) openHere();
      else if (routes.has(d.target)) post(routes.get(d.target), { type: 'open', target: d.target });
    }
  });
  function hideLauncherForChild() {
    // the game frame shows its own launcher; avoid a second one on the portal page
    if (!detected && mode !== 'always') removeLauncher();
  }
  async function pingFrames(wait = 600) {
    for (let i = 0; i < win.frames.length; i++) post(win.frames[i], { type: 'ping' });
    await new Promise((r) => win.setTimeout(r, wait));
    return [...reports.values()].map((r) => ({ ...r, source: routes.get(r.id) }));
  }
  function openInFrame(report) {
    const route = routes.get(report.id);
    if (!route) throw new Error('That frame is no longer available.');
    post(route, { type: 'open', target: report.id });
  }

  async function open() {
    // no game state here but a descendant frame has one: open it there
    if (!detected) {
      const found = [...reports.values()].find((r) => r.game) || (await pingFrames(500)).find((r) => r.game);
      if (found) {
        toast('Opening SaveForge in the game frame…');
        openInFrame(found);
        return null;
      }
      // same-site frames where the manager did not inject the script (srcdoc, about:blank, blob frames)
      for (const el of doc.querySelectorAll('iframe')) {
        let child = null;
        try {
          child = el.contentWindow;
          void child.location.href; // throws for other sites
        } catch {
          continue;
        }
        if (!child || child.__saveforgeUserscript) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 200 || r.height < 150) continue;
        if ((await looksLikeGame(child)).game) {
          toast('Opening SaveForge in the game frame…');
          return openTrainer(child, { onClose: () => delete child.__saveforgeTrainer });
        }
      }
    }
    return openHere();
  }

  function openHere() {
    hideLauncher();
    const ctl = openTrainer(win, {
      frameReports: () => pingFrames(500),
      openInFrame,
      contextInfo: async () => probeContext(win),
      siteMode: { get: async () => mode, set: (m) => changeMode(m) },
      onClose: () => {
        delete win.__saveforgeTrainer;
        if (mode !== 'never' && (mode === 'always' || detected)) showLauncher();
      },
    });
    ctl.show();
    return ctl;
  }

  function safeOrigin() {
    try {
      return win.location.origin;
    } catch {
      return '';
    }
  }
  function safeHref() {
    try {
      return win.location.href;
    } catch {
      return '';
    }
  }

  async function changeMode(m) {
    mode = m;
    // update the page first, then remember the choice
    if (m === 'never') {
      removeLauncher();
      win.__saveforgeTrainer?.destroy();
    } else if (m === 'always' || detected) showLauncher();
    else removeLauncher();
    api.saved = setMode(win, m);
    await api.saved;
  }

  // ---------------------------------------------------------------- address-bar triggers
  function handleHash() {
    const h = (win.location.hash || '').toLowerCase();
    const token = h === '#saveforge' ? 'open' : h === '#saveforge-on' ? 'always' : h === '#saveforge-off' ? 'never' : h === '#saveforge-auto' ? 'auto' : null;
    if (!token) return false;
    try {
      win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search);
    } catch {
      /* ignore */
    }
    if (token === 'open') open();
    else changeMode(token).then(() => token !== 'never' && toast(token === 'always' ? 'SaveForge: launcher always shown on this site' : 'SaveForge: automatic mode'));
    if (token === 'never') toast('SaveForge: hidden on this site (#saveforge-on to undo)');
    return true;
  }

  // ---------------------------------------------------------------- launcher (Shadow DOM, only when wanted)
  function showLauncher() {
    if (win.__saveforgeTrainer) return;
    // another SaveForge copy (other JS world, older version) already shows a launcher or the panel here
    try {
      if (!launcher && (doc.querySelector('saveforge-launcher') || doc.querySelector('saveforge-trainer'))) return;
    } catch {
      /* no DOM */
    }
    if (!launcher) launcher = buildLauncher();
    launcher.host.style.display = '';
  }
  function hideLauncher() {
    if (launcher) launcher.host.style.display = 'none';
  }
  function removeLauncher() {
    launcher?.host.remove();
    launcher = null;
  }

  function buildLauncher() {
    const host = doc.createElement('saveforge-launcher');
    host.setAttribute('style', 'all: initial');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host { all: initial; }
      .b { position: fixed; z-index: 2147483645; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom)); width: 44px; height: 44px; border: 0; border-radius: 14px; padding: 0;
        background: linear-gradient(135deg, #3df5a7, #22d3ee); color: #04140d; font: 800 21px/44px -apple-system, system-ui, sans-serif; text-align: center;
        opacity: .6; box-shadow: 0 6px 18px rgba(0,0,0,.45); touch-action: none; -webkit-user-select: none; user-select: none; cursor: pointer; }
      .b:active { opacity: 1; }
      .m { position: fixed; z-index: 2147483646; right: 12px; bottom: calc(64px + env(safe-area-inset-bottom)); min-width: 230px; padding: 6px; border-radius: 14px; background: rgba(10,12,18,.97);
        box-shadow: 0 14px 40px rgba(0,0,0,.6); font: 15px -apple-system, system-ui, sans-serif; color: #eef2f8; }
      .m button { display: block; width: 100%; text-align: left; min-height: 44px; padding: 0 12px; border: 0; border-radius: 10px; background: none; color: inherit; font: inherit; }
      .m button:active, .m button[aria-checked=true] { background: rgba(61,245,167,.15); }
      .m small { display: block; padding: 6px 12px; color: #8b95ad; font-size: 12px; }
    </style><button class="b" aria-label="Open SaveForge Trainer" title="SaveForge Trainer (long-press for options)">⬢</button>`;
    const btn = root.querySelector('.b');
    let menu = null;
    let timer = 0;
    let longPressed = false;
    let start = null;
    const stop = (e) => e.stopPropagation();
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'keydown']) host.addEventListener(t, stop);
    btn.addEventListener('pointerdown', (e) => {
      longPressed = false;
      start = { x: e.clientX, y: e.clientY, moved: false };
      btn.setPointerCapture?.(e.pointerId);
      timer = win.setTimeout(() => {
        longPressed = true;
        toggleMenu();
      }, 600);
    });
    btn.addEventListener('pointermove', (e) => {
      if (!start) return;
      if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) return;
      start.moved = true;
      win.clearTimeout(timer);
      btn.style.left = `${Math.min(Math.max(4, e.clientX - 22), win.innerWidth - 48)}px`;
      btn.style.top = `${Math.min(Math.max(4, e.clientY - 22), win.innerHeight - 48)}px`;
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
    });
    btn.addEventListener('pointerup', () => {
      win.clearTimeout(timer);
      const moved = start?.moved;
      start = null;
      if (!longPressed && !moved) {
        closeMenu();
        open();
      }
    });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());

    function closeMenu() {
      menu?.remove();
      menu = null;
    }
    function toggleMenu() {
      if (menu) return closeMenu();
      menu = doc.createElement('div');
      menu.className = 'm';
      menu.setAttribute('role', 'menu');
      const item = (label, fn, checked) => {
        const b = doc.createElement('button');
        b.textContent = label;
        if (checked !== undefined) {
          b.setAttribute('role', 'menuitemradio');
          b.setAttribute('aria-checked', String(checked));
        }
        b.addEventListener('click', () => {
          closeMenu();
          fn();
        });
        menu.append(b);
      };
      item('Open SaveForge Trainer', open);
      item(`${mode === 'auto' ? '✓ ' : ''}Automatic on this site`, () => changeMode('auto'), mode === 'auto');
      item(`${mode === 'always' ? '✓ ' : ''}Always show on this site`, () => changeMode('always'), mode === 'always');
      item('Hide on this site', () => changeMode('never').then(() => toast('SaveForge hidden here. Add #saveforge-on to the address to bring it back.')), mode === 'never');
      item('Help', () => win.open(HELP_URL, '_blank', 'noopener'));
      const note = doc.createElement('small');
      note.textContent = `SaveForge ${VERSION}${detected ? ` · ${detected}` : ''}`;
      menu.append(note);
      root.append(menu);
    }
    (doc.body || doc.documentElement).append(host);
    return { host, root, btn };
  }

  function toast(msg) {
    const t = doc.createElement('saveforge-toast');
    t.setAttribute('style', 'all:initial;position:fixed;z-index:2147483647;left:50%;bottom:80px;transform:translateX(-50%);max-width:90vw;padding:10px 14px;border-radius:10px;background:rgba(10,12,18,.95);color:#eef2f8;font:600 14px -apple-system,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5);pointer-events:none');
    t.textContent = msg;
    (doc.body || doc.documentElement).append(t);
    win.setTimeout(() => t.remove(), 3200);
  }

  // ---------------------------------------------------------------- boot
  win.addEventListener('hashchange', () => {
    handleHash();
  });
  // three-finger tap anywhere opens SaveForge (manual activation where detection fails);
  // the event is only observed, never blocked, so the game still receives it
  win.addEventListener(
    'touchstart',
    (e) => {
      if (mode === 'never' || !e.touches || e.touches.length < 3 || win.__saveforgeTrainer) return;
      open();
    },
    { passive: true, capture: true },
  );

  async function detectOnce() {
    if (mode !== 'auto' || detected || win.__saveforgeTrainer) return true;
    const res = await looksLikeGame(win);
    if (!res.game) return false;
    detected = res.reason;
    reportUp();
    showLauncher();
    return true;
  }

  (async () => {
    mode = (await getMode(win)) || DEFAULT_MODE;
    if (handleHash()) {
      /* handled */
    } else if (mode === 'always') showLauncher();
    if (mode === 'auto') {
      // games often appear late: watch the DOM for new canvases/frames as well as re-checking on a schedule
      let timer = 0;
      let observer = null;
      const stopAt = Date.now() + watchMs;
      try {
        observer = new win.MutationObserver((records) => {
          if (detected || Date.now() > stopAt) return observer.disconnect();
          const relevant = records.some((r) => [...r.addedNodes].some((n) => n.nodeType === 1 && /^(CANVAS|IFRAME|SCRIPT|OBJECT|EMBED)$/.test(n.nodeName)));
          if (!relevant) return;
          win.clearTimeout(timer);
          timer = win.setTimeout(() => detectOnce().then((done) => done && observer.disconnect()), 1200);
        });
        observer.observe(doc.documentElement, { childList: true, subtree: true });
      } catch {
        observer = null;
      }
      let waited = 0;
      for (const at of detectDelays) {
        await new Promise((r) => win.setTimeout(r, at - waited));
        waited = at;
        if (await detectOnce()) break;
      }
      if (detected) observer?.disconnect();
    }
  })().catch((e) => {
    // never leak errors into the host website
    console.debug('SaveForge userscript:', e);
  });
  return api;
}
