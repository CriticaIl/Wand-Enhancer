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
import { getMode, looksLikeGame, setMode } from './activation.js';

const VERSION = typeof __SAVEFORGE_VERSION__ === 'string' ? __SAVEFORGE_VERSION__ : 'dev';
const HELP_URL = 'https://github.com/CriticaIl/Wand-Enhancer/blob/claude/html5-game-save-analyzer-ogbcnf/save-analyzer/USERSCRIPT.md';

export function startUserscript(win, { detectDelays = [1500, 6000] } = {}) {
  if (win.__saveforgeUserscript) return win.__saveforgeUserscript;
  const doc = win.document;
  let launcher = null;
  let mode = 'auto';
  let detected = null;

  const api = {
    version: VERSION,
    open,
    get mode() {
      return mode;
    },
    setMode: changeMode,
    launcherVisible: () => !!launcher && launcher.host.style.display !== 'none',
    saved: Promise.resolve(), // settles once the latest per-site choice is stored
  };
  win.__saveforgeUserscript = api;

  function open() {
    hideLauncher();
    const ctl = openTrainer(win, {
      onClose: () => {
        delete win.__saveforgeTrainer;
        if (mode !== 'never' && (mode === 'always' || detected)) showLauncher();
      },
    });
    ctl.show();
    return ctl;
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
  (async () => {
    mode = await getMode(win);
    if (handleHash()) {
      /* handled */
    } else if (mode === 'always') showLauncher();
    else if (mode === 'auto') {
      for (const delay of detectDelays) {
        await new Promise((r) => win.setTimeout(r, delay));
        if (mode !== 'auto' || launcher || win.__saveforgeTrainer) break;
        const res = await looksLikeGame(win);
        if (res.game) {
          detected = res.reason;
          showLauncher();
          break;
        }
      }
    }
  })().catch((e) => {
    // never leak errors into the host website
    console.debug('SaveForge userscript:', e);
  });
  return api;
}
