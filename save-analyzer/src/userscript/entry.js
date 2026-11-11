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
import { docToken } from '../trainer/context.js';
import { getMode, looksLikeGame, probeContext, setMode } from './activation.js';

import { BUILD, VERSION } from '../version.js';
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
    build: BUILD,
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

  // ---------------------------------------------------------------- frames (2.3: one coordinator)
  // Games on portals usually run in an iframe (often another site, sometimes nested). This
  // script runs in every frame. Every instance reports itself to its parent (relayed up to the
  // top page); the TOP page's instance coordinates:
  //   - it elects the one frame that shows the launcher (a big game frame wins over a portal page
  //     that merely has a canvas) and tells every frame ("state": owner + active panel)
  //   - opening anywhere goes through it: if a panel is already open in any frame that panel is
  //     shown; otherwise the game frame is chosen from FRESH reports (a ping round), never from a
  //     frame that was removed or navigated to another game; several games → a chooser
  // Messages are namespaced and checked against the sending window (child or parent only).
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const MSG = '__saveforge';
  const routes = new Map(); // report id -> direct child window that leads to it
  const reports = new Map(); // report id -> report (from descendants), with .seen (our clock)
  let state = { known: false, owner: null, active: null }; // from the top page's coordinator
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
  const myReport = (extra = {}) => ({ id, doc: docToken(win), origin: safeOrigin(), href: safeHref(), title: safeTitle(), game: !!detected, reason: detected || '', trainer: !!win.__saveforgeTrainer, ...extra });
  const childIndex = (w) => {
    for (let i = 0; i < win.frames.length; i++) if (win.frames[i] === w) return i;
    return -1;
  };
  const post = (target, msg) => {
    try {
      target.postMessage({ [MSG]: 1, ...msg }, '*');
    } catch {
      /* frame gone */
    }
  };
  const down = (msg) => {
    for (let i = 0; i < win.frames.length; i++) post(win.frames[i], msg);
  };
  function reportUp(extra) {
    if (isTop) return elect();
    post(win.parent, { type: 'report', report: myReport(extra) });
  }
  /** Reports whose frame was removed (or that left) are forgotten. */
  function pruneRoutes() {
    for (const [rid, w] of routes) {
      if (!isChildWindow(w) || reports.get(rid)?.gone) {
        routes.delete(rid);
        reports.delete(rid);
      }
    }
  }
  win.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || d[MSG] !== 1) return;
    const fromChild = isChildWindow(e.source);
    const fromParent = !isTop && e.source === win.parent;
    if (d.type === 'report' && d.report && fromChild) {
      // slot: where the reporting frame sits (frame index path below this window). A NEW document
      // in the same slot (the portal navigated the frame to another game) replaces the old report:
      // the old document cannot be relied on to say goodbye (pagehide messages can be lost)
      const relayed = { ...d.report, slot: [childIndex(e.source), ...(d.report.slot || [])] };
      const slot = relayed.slot.join('/');
      for (const [rid, old] of reports) if (rid !== relayed.id && old.slot && old.slot.join('/') === slot && old.doc !== relayed.doc) (reports.delete(rid), routes.delete(rid));
      routes.set(relayed.id, e.source);
      reports.set(relayed.id, { ...relayed, seen: Date.now() });
      if (relayed.gone) (reports.delete(relayed.id), routes.delete(relayed.id));
      if (isTop) scheduleElect();
      else post(win.parent, { type: 'report', report: relayed });
    } else if (d.type === 'req' && fromChild) {
      if (isTop) decideOpen(d.from);
      else post(win.parent, d);
    } else if (fromParent && d.type === 'ping') {
      down({ type: 'ping' });
      // answer with what is true NOW (a frame may have been navigated to another game)
      detectNow().finally(() => reportUp());
    } else if (fromParent && d.type === 'state') {
      state = { known: true, owner: d.owner, active: d.active };
      applyState();
      down(d);
    } else if (fromParent && (d.type === 'open' || d.type === 'show')) {
      if (d.target === id) {
        if (d.type === 'open') openHere();
        else if (win.__saveforgeTrainer) win.__saveforgeTrainer.show();
        else openHere();
      } else if (routes.has(d.target)) post(routes.get(d.target), { type: d.type, target: d.target });
    }
  });
  // leaving the page (navigation, tab closed): the coordinator forgets this frame at once
  win.addEventListener('pagehide', () => {
    if (!isTop) post(win.parent, { type: 'report', report: myReport({ gone: true, game: false, trainer: false }) });
  });
  win.addEventListener('pageshow', (e) => {
    if (e.persisted) reportUp();
  });

  // ---- the top page's coordinator
  let electTimer = 0;
  function scheduleElect() {
    win.clearTimeout(electTimer);
    electTimer = win.setTimeout(elect, 150);
  }
  function frameArea(w) {
    try {
      for (const el of doc.querySelectorAll('iframe')) {
        if (el.contentWindow !== w) continue;
        const r = el.getBoundingClientRect();
        return Math.max(0, r.width) * Math.max(0, r.height);
      }
    } catch {
      /* no DOM */
    }
    return 0;
  }
  function elect() {
    if (!isTop) return;
    pruneRoutes();
    const screen = (win.innerWidth || 1) * (win.innerHeight || 1);
    const games = [...reports.values()].filter((r) => r.game && !r.gone).map((r) => ({ r, area: frameArea(routes.get(r.id)) })).sort((a, b) => b.area - a.area);
    let owner = null;
    if (games.length && games[0].area >= 0.2 * screen) owner = games[0].r.id; // a big game frame
    else if (detected) owner = id;
    else if (games.length) owner = games[0].r.id;
    const activeChild = [...reports.values()].find((r) => r.trainer && !r.gone);
    const active = win.__saveforgeTrainer ? id : activeChild ? activeChild.id : null;
    state = { known: true, owner, active };
    applyState();
    down({ type: 'state', owner, active });
  }
  function applyState() {
    if (!state.known) return;
    if (win.__saveforgeTrainer || state.active) return hideLauncher(); // a panel is open somewhere
    if (mode === 'never') return removeLauncher();
    if (state.owner === id) return showLauncher();
    if (state.owner) return hideLauncher(); // another frame holds the game
    // no game anywhere: only the top page shows a launcher, and only in "always" mode; an
    // ordinary page keeps nothing of SaveForge in its DOM
    if (isTop && mode === 'always') showLauncher();
    else removeLauncher();
  }
  async function pingFrames(wait = 600) {
    const t0 = Date.now();
    down({ type: 'ping' });
    await new Promise((r) => win.setTimeout(r, wait));
    pruneRoutes();
    return [...reports.values()].filter((r) => r.seen >= t0 && !r.gone).map((r) => ({ ...r, source: routes.get(r.id) }));
  }
  function routeTo(target, type = 'open') {
    if (target === id) return type === 'open' ? openHere() : win.__saveforgeTrainer ? win.__saveforgeTrainer.show() : openHere();
    const route = routes.get(target);
    if (!route) throw new Error('That frame is no longer available.');
    post(route, { type, target });
    return null;
  }
  function openInFrame(report) {
    routeTo(report.id, 'open');
  }
  /** Top page: where should the trainer open? (from: the frame that asked, or this page) */
  let deciding = null;
  function decideOpen(from = id) {
    if (deciding) return deciding;
    deciding = (async () => {
      const fresh = await pingFrames(500);
      // 1. a panel is already open somewhere: show it, never open a second one
      if (win.__saveforgeTrainer) return win.__saveforgeTrainer.show();
      const active = fresh.find((r) => r.trainer);
      if (active) return routeTo(active.id, 'show');
      // 2. the frame you opened it from holds a game: open there
      const req = from !== id ? fresh.find((r) => r.id === from) : null;
      if (req && req.game) return routeTo(req.id, 'open');
      // 3. the games on this page now (one entry per frame document, even with two SaveForge copies)
      const seen = new Set();
      const games = fresh.filter((r) => r.game && !seen.has(`${r.href}|${r.title}`) && seen.add(`${r.href}|${r.title}`));
      if (detected && from === id && !games.length) return openHere();
      const options = [...(detected ? [{ id, title: safeTitle(), href: safeHref(), origin: safeOrigin(), reason: detected, self: true }] : []), ...games];
      if (options.length > 1) return chooser(options);
      if (options.length === 1) {
        if (options[0].id !== id) toast('Opening SaveForge in the game frame…');
        return routeTo(options[0].id, 'open');
      }
      // 4. same-site frames where the manager did not inject the script (srcdoc, about:blank, blob)
      const local = await sameSiteGameFrame();
      if (local) return local;
      // 5. nothing detected: open where you asked
      return from !== id && routes.has(from) ? routeTo(from, 'open') : openHere();
    })().finally(() => (deciding = null));
    return deciding;
  }
  async function sameSiteGameFrame() {
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
        return openTrainer(child, { onClose: () => delete child.__saveforgeTrainer, reason: 'a same-site game frame without the userscript, opened from the page around it' });
      }
    }
    return null;
  }

  /** Several games on the page: you choose (2.3). */
  function chooser(options) {
    doc.querySelector('saveforge-chooser')?.remove();
    const host = doc.createElement('saveforge-chooser');
    host.setAttribute('style', 'all: initial');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      .w { position: fixed; z-index: 2147483647; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom)); transform: translateX(-50%); width: min(92vw, 380px); padding: 10px; border-radius: 16px;
        background: rgba(10,12,18,.97); color: #eef2f8; font: 15px -apple-system, system-ui, sans-serif; box-shadow: 0 14px 40px rgba(0,0,0,.6); }
      h2 { font-size: 16px; margin: 4px 6px 8px; }
      button { display: block; width: 100%; text-align: left; min-height: 48px; margin: 4px 0; padding: 8px 12px; border: 0; border-radius: 12px; background: rgba(255,255,255,.07); color: inherit; font: inherit; }
      button small { display: block; color: #8b95ad; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      button.x { background: none; text-align: center; color: #8b95ad; }
    </style><div class="w" role="dialog" aria-label="Choose the game"><h2>Which game should SaveForge open?</h2></div>`;
    const w = root.querySelector('.w');
    for (const o of options) {
      const b = doc.createElement('button');
      b.textContent = o.title || o.origin || 'Game';
      const sm = doc.createElement('small');
      sm.textContent = `${o.self ? 'this page · ' : 'frame · '}${o.href || o.origin}`;
      b.append(sm);
      b.addEventListener('click', () => {
        host.remove();
        try {
          routeTo(o.id, 'open');
        } catch (err) {
          toast(err.message);
        }
      });
      w.append(b);
    }
    const x = doc.createElement('button');
    x.className = 'x';
    x.textContent = 'Cancel';
    x.addEventListener('click', () => host.remove());
    w.append(x);
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) host.addEventListener(t, (ev) => ev.stopPropagation());
    (doc.body || doc.documentElement).append(host);
    return null;
  }

  async function open() {
    if (win.__saveforgeTrainer) return win.__saveforgeTrainer.show();
    if (isTop) return decideOpen(id);
    if (state.known) {
      // the top page coordinates: a panel open elsewhere is shown, and a non-game frame asks it
      if (!state.active && (detected || state.owner === id)) return openHere();
      reportUp();
      post(win.parent, { type: 'req', from: id });
      return null;
    }
    // no SaveForge on the top page (not allowed there): decide here, as before 2.3
    if (!detected) {
      const found = [...reports.values()].find((r) => r.game) || (await pingFrames(500)).find((r) => r.game);
      if (found) {
        toast('Opening SaveForge in the game frame…');
        openInFrame(found);
        return null;
      }
      const local = await sameSiteGameFrame();
      if (local) return local;
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
      reason: detected ? `game detected in this ${isTop ? 'page' : 'frame'} (${detected})` : `opened by you in this ${isTop ? 'page' : 'frame'} (no game detected here)`,
      instances: async () => (isTop ? { frames: (await pingFrames(400)).filter((r) => r.trainer).length + (win.__saveforgeTrainer ? 1 : 0) } : {}),
      onClose: () => {
        delete win.__saveforgeTrainer;
        reportUp();
        if (state.known) applyState();
        else if (mode !== 'never' && (mode === 'always' || detected)) showLauncher();
      },
    });
    ctl.show();
    reportUp(); // trainer: true only if THIS copy holds the panel (not another world's)
    return ctl;
  }

  function safeOrigin() {
    try {
      return win.location.origin;
    } catch {
      return '';
    }
  }
  function safeTitle() {
    try {
      return doc.title || '';
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
    } else if (state.known) {
      if (isTop) elect();
      else applyState();
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
    // another SaveForge copy (other JS world, older version) shows a panel here, or its own launcher
    try {
      if (doc.querySelector('saveforge-trainer')) return hideLauncher();
      const others = [...doc.querySelectorAll('saveforge-launcher')].filter((el) => el !== launcher?.host && el.style.display !== 'none');
      if (others.length) return hideLauncher();
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

  /** Is there a game here right now? (answers the coordinator's ping; never shows anything) */
  async function detectNow() {
    if (detected) return true;
    try {
      const res = await looksLikeGame(win);
      if (res.game) detected = res.reason;
    } catch {
      /* page gone */
    }
    return !!detected;
  }
  /** Shows the launcher where the coordinator says (or here when no SaveForge runs above this frame). */
  function settleLauncher() {
    if (isTop) return elect();
    reportUp();
    win.setTimeout(() => {
      if (state.known) applyState();
      else if (mode !== 'never' && (detected || mode === 'always')) showLauncher();
    }, 400);
  }
  async function detectOnce() {
    if (mode !== 'auto' || detected || win.__saveforgeTrainer) return true;
    const res = await looksLikeGame(win);
    if (!res.game) return false;
    detected = res.reason;
    settleLauncher();
    return true;
  }

  (async () => {
    mode = (await getMode(win)) || DEFAULT_MODE;
    reportUp(); // the coordinator learns about this frame (and tells it where the launcher goes)
    if (handleHash()) {
      /* handled */
    } else if (mode === 'always') settleLauncher();
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
