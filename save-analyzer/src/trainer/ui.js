// GTA-style floating trainer. Framework-free, rendered into a Shadow DOM of
// the *host* window (the game page), with a virtualized list so thousands of
// variables stay smooth on iPhone Safari.

import { sliderRange } from '../core/modmenu.js';
import { englishLabel, onlineTranslateUrl, toEnglish } from '../core/translate.js';
import { firstScan, foundValuesEngine, nextScan } from './scan.js';
import { checkDisplay, detectRenderer, engineRedraw, patchVisibleNumber, redrawCandidates, tryRedraw } from './display.js';
import { searchEntries, SUGGESTIONS, warmSearchIndex } from './search.js';
import { LiveProvider, SECTIONS, STATUS } from './providers.js';
import { createLinkerUI } from './linker-ui.js';
import { createSugarCubeSavesUI } from './sugarcube-saves-ui.js';
import { readSugarCubeStorage } from './sugarcube-saves.js';
import { createSignal, PROFILES } from './perf.js';
import { analyzeFile } from '../core/document.js';
import { decodeShare, encodeShare } from '../core/share.js';
import { ImportedProvider, matchImported } from './imported.js';
import { resolveSugarCubeSave, isSugarCubeSaveNode } from '../adapters/sugarcube-moments.js';
import { TRAINER_CSS } from './styles.js';

let ROW_H = 56; // 44 in compact view
const OVERSCAN = 6;
const ICONS = {
  logo: 'M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2zm0 4.2L7.6 8.7v6.6l4.4 2.5 4.4-2.5V8.7L12 6.2z',
  close: 'M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z',
  min: 'M5 17h14v2.5H5z',
  collapse: 'M7 14l5-5 5 5z',
  expand: 'M7 10l5 5 5-5z',
  back: 'M15.4 6.4L14 5l-7 7 7 7 1.4-1.4L9.8 12z',
  undo: 'M8 7V3L2 9l6 6v-4h6a4 4 0 010 8h-2v3h2a7 7 0 000-14z',
  redo: 'M16 7V3l6 6-6 6v-4h-6a4 4 0 000 8h2v3h-2a7 7 0 010-14z',
  link: 'M10.6 13.4a1 1 0 010-1.4l3.5-3.5a3 3 0 114.2 4.2l-2.1 2.1-1.4-1.4 2.1-2.1a1 1 0 10-1.4-1.4L12 13.4a1 1 0 01-1.4 0zm2.8-2.8a1 1 0 010 1.4l-3.5 3.5a3 3 0 11-4.2-4.2l2.1-2.1 1.4 1.4-2.1 2.1a1 1 0 101.4 1.4L12 10.6a1 1 0 011.4 0z',
  search: 'M10 3a7 7 0 015.6 11.2l5 5-1.4 1.4-5-5A7 7 0 1110 3zm0 2a5 5 0 100 10 5 5 0 000-10z',
  star: 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z',
  clock: 'M12 2a10 10 0 110 20 10 10 0 010-20zm-1 5v6l5 3 1-1.7-4-2.4V7z',
  lock: 'M7 10V8a5 5 0 0110 0v2h1v11H6V10zm2 0h6V8a3 3 0 00-6 0z',
  heart: 'M12 21l-1.5-1.3C5 15 2 12.2 2 8.6 2 5.6 4.4 3.3 7.3 3.3c1.7 0 3.4.8 4.7 2.1 1.3-1.3 3-2.1 4.7-2.1 2.9 0 5.3 2.3 5.3 5.3 0 3.6-3 6.4-8.5 11.1z',
  coin: 'M12 3c5 0 9 2 9 4.5v9C21 19 17 21 12 21s-9-2-9-4.5v-9C3 5 7 3 12 3zm0 2C8 5 5 6.4 5 7.5S8 10 12 10s7-1.4 7-2.5S16 5 12 5z',
  bag: 'M8 7a4 4 0 018 0h4l-1.5 14h-13L4 7zm2 0h4a2 2 0 00-4 0z',
  flag: 'M5 3h2v18H5zM8 4h11l-2.5 4.5L19 13H8z',
  key: 'M14 3a7 7 0 11-6.3 10H6v2H4v2H2v-4l7.7-7.7A7 7 0 0114 3zm2 3a2 2 0 100 4 2 2 0 000-4z',
  gear: 'M13.4 2l.5 2.6 1.9.8 2.2-1.5 1.9 1.9-1.5 2.2.8 1.9L22 10.6v2.8l-2.6.5-.8 1.9 1.5 2.2-1.9 1.9-2.2-1.5-1.9.8-.5 2.8h-2.8l-.5-2.6-1.9-.8-2.2 1.5-1.9-1.9 1.5-2.2-.8-1.9L2 13.4v-2.8l2.6-.5.8-1.9-1.5-2.2 1.9-1.9 2.2 1.5 1.9-.8L10.6 2zM12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
  list: 'M4 6h16v2.5H4zM4 11h16v2.5H4zM4 16h10v2.5H4z',
  shield: 'M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z',
  refresh: 'M12 4a8 8 0 107.4 11h-3.3A5 5 0 1112 7c1.4 0 2.6.6 3.5 1.5L13 11h7V4l-2.4 2.4A8 8 0 0012 4z',
  info: 'M12 2a10 10 0 110 20 10 10 0 010-20zm-1 8v7h2v-7zm0-4v2h2V6z',
};
const CHANNEL_LABEL = { live: 'Live', 'live-generic': 'Live*', reload: 'Apply & Reload', file: 'Saved edit', readonly: 'Read-only' };
const STATUS_MARK = { checking: '…', verified: '✓', adjusted: '≈', reverted: '↺', failed: '✕', locked: '🔒', reload: '⟳', export: '⤓', readonly: '' };

/**
 * Mounts the trainer.
 * @param win   host window (the game page)
 * @param opts  {sources: [{id, label, channel, create: () => Provider|Promise<Provider>}], limitations?: [{name, reason}],
 *               store, onExport?: () => void, startMinimized?: boolean}
 * @returns controller {show, hide, destroy, provider()}
 */
export function mountTrainer(win, opts) {
  const doc = win.document;
  const host = doc.createElement('saveforge-trainer');
  host.setAttribute('style', 'all: initial');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = TRAINER_CSS;
  shadow.append(style);
  (doc.body || doc.documentElement).append(host);

  // ---------- tiny DOM helpers bound to the host document
  const h = (tag, attrs, ...kids) => {
    const e = doc.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (k === 'style') e.setAttribute('style', v);
        else if (k in e && typeof v !== 'string') e[k] = v;
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) e.append(k instanceof win.Node ? k : doc.createTextNode(String(k)));
    return e;
  };
  const ic = (name) => {
    const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    const p = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ICONS[name] || ICONS.info);
    s.append(p);
    return s;
  };
  const clear = (e) => {
    while (e.firstChild) e.firstChild.remove();
    return e;
  };

  // ---------- state
  const S = {
    provider: null,
    sourceId: null,
    providers: new Map(),
    stack: [{ type: 'home' }],
    selected: 0,
    minimized: !!opts.startMinimized,
    collapsed: false,
    favorites: new Set(),
    recent: [],
    query: '',
    status: null,
    englishLabels: false,
    enInResults: true,
    compact: false,
    search: { filter: 'all', gameplayOnly: true, mode: 'partial', hidden: 0, aliases: [] },
    display: { renderer: null, status: new Map(), auto: null, candidates: null },
    scan: { target: '', paths: null, kept: [], history: [], info: '' },
  };
  const store = opts.store;

  // ---------- skeleton
  const root = h('div', { class: 'root' });
  const panel = h('section', { class: 'panel', role: 'dialog', 'aria-label': 'SaveForge trainer' });
  const banner = h('div', { class: 'banner' }, h('div', { class: 'title' }, 'SaveForge', h('small', null, 'TRAINER')));
  const hbtns = h(
    'div',
    { class: 'hbtns' },
    h('button', { class: 'hbtn', 'aria-label': 'Collapse', onclick: () => setCollapsed(!S.collapsed) }, ic('collapse')),
    h('button', { class: 'hbtn', 'aria-label': 'Minimize', onclick: () => setMinimized(true) }, ic('min')),
    h('button', { class: 'hbtn', 'aria-label': 'Close trainer', onclick: () => ctl.destroy() }, ic('close')),
  );
  banner.append(hbtns);
  const sourcesEl = h('div', { class: 'sources' });
  const subEl = h('div', { class: 'sub' });
  const bodyEl = h('div', { class: 'body' });
  const descEl = h('div', { class: 'desc' });
  const compatEl = h('div', { class: 'compat', title: 'Compatibility of this game with SaveForge' });
  const toolsEl = h('div', { class: 'tools' });
  panel.append(banner, sourcesEl, compatEl, subEl, bodyEl, descEl, toolsEl);
  const orb = h('button', { class: 'orb', 'aria-label': 'Open SaveForge trainer' }, ic('logo'));
  root.append(panel, orb);
  shadow.append(root);

  // keep game input handlers from reacting to taps/typing inside the trainer
  for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'dblclick', 'wheel', 'keydown', 'keyup', 'keypress', 'contextmenu']) {
    panel.addEventListener(t, (e) => e.stopPropagation());
    orb.addEventListener(t, (e) => e.stopPropagation());
  }

  // ---------- dragging (panel by banner, orb by itself)
  function makeDraggable(el, handle, onTap) {
    let st = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.hbtn')) return;
      const r = el.getBoundingClientRect();
      st = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, moved: false };
      handle.setPointerCapture?.(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!st) return;
      const dx = e.clientX - st.x;
      const dy = e.clientY - st.y;
      if (!st.moved && Math.hypot(dx, dy) < 6) return;
      st.moved = true;
      const l = Math.min(Math.max(0, st.l + dx), win.innerWidth - Math.min(el.offsetWidth, win.innerWidth));
      const t = Math.min(Math.max(0, st.t + dy), win.innerHeight - 50);
      el.style.left = `${l}px`;
      el.style.top = `${t}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    });
    const end = () => {
      if (!st) return;
      const moved = st.moved;
      st = null;
      if (!moved && onTap) onTap();
      if (moved) savePos();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', () => (st = null));
  }
  makeDraggable(panel, banner, null);
  makeDraggable(orb, orb, () => setMinimized(false));
  function savePos() {
    store?.set('pos', { panel: [panel.style.left, panel.style.top], orb: [orb.style.left, orb.style.top] });
  }

  function setMinimized(v) {
    S.minimized = v;
    panel.style.display = v ? 'none' : '';
    orb.style.display = v ? '' : 'none';
    syncPaused();
    if (!v) renderAll();
    updateOrb();
  }
  /** Background work (learning, save sync, re-scans) runs only while the trainer is visible. */
  function syncPaused() {
    for (const [k, pr] of S.providers) pr.setPaused?.(S.minimized || doc.hidden || k !== S.sourceId);
  }
  doc.addEventListener('visibilitychange', syncPaused);
  function setCollapsed(v) {
    S.collapsed = v;
    panel.classList.toggle('collapsed', v);
    clear(hbtns.firstChild).append(ic(v ? 'expand' : 'collapse'));
  }
  function updateOrb() {
    orb.querySelector('.n')?.remove();
    const n = S.provider ? S.provider.pendingCount() || [...S.provider.entries].filter((e) => S.provider.isEdited(e.nodeId)).length : 0;
    if (n) orb.append(h('span', { class: 'n' }, n));
  }

  // ---------- Button & Textbox Linker (created lazily; saved mappings load at mount)
  let linkerUI = null;
  /** The shared save variables behind the current view (the storage chip, or saves merged into a live source). */
  const savesOf = (p = S.provider) => (p?.kind === 'storage' ? p : p?.saveProvider?.() || null);
  const hub = opts.saveHub || null;
  const liveProvider = () => (S.provider?.kind === 'live' ? S.provider : [...S.providers.values()].find((p) => p.kind === 'live') || null);
  let scSavesUI = null;
  function getScSavesUI() {
    if (!scSavesUI) {
      scSavesUI = createSugarCubeSavesUI({
        win, h, bodyEl, back, top, toast, setDesc, renderAll, store,
        backupStore: opts.saveHub?.store || null,
        minimize: () => setMinimized(true),
      });
    }
    return scSavesUI;
  }
  /** SugarCube save workflow, prefilled from pending save edits ($player.money → 20480799). */
  function openScSave() {
    const sp = savesOf();
    const d = sp?.diff ? sp.diff().map((x) => ({ x, e: sp.entryById.get(x.id) })).find(({ e }) => e && /^\$/.test(e.label)) : null;
    push({ type: 'scsave', fresh: true, prefill: d ? { expr: d.e.label.slice(1), value: String(d.x.after) } : null });
  }
  function getLinkerUI() {
    if (!linkerUI) {
      linkerUI = createLinkerUI({
        win, h, bodyEl, push, back, top, toast, setDesc, renderAll, host, panel, orb, root, store,
        getProvider: liveProvider,
        get state() {
          return S;
        },
        minimize: () => (panel.style.display = 'none'),
        restore: () => {
          if (!S.minimized) panel.style.display = '';
        },
      });
    }
    return linkerUI;
  }

  let toastTimer;
  function toast(msg, bad) {
    shadow.querySelector('.toast')?.remove();
    const t = h('div', { class: `toast${bad ? ' bad' : ''}` }, msg);
    root.append(t);
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => t.remove(), bad ? 4000 : 2000);
  }

  // ---------- sources
  async function selectSource(id) {
    const src = opts.sources.find((s) => s.id === id);
    if (!src) return;
    S.sourceId = id;
    S.stack = [{ type: 'home' }];
    S.selected = 0;
    renderSources();
    if (!S.providers.has(id)) {
      S.provider = null;
      S.status = { loading: `Reading ${src.label}…`, scanning: true };
      renderAll();
      try {
        const p = await src.create();
        S.providers.set(id, p);
        listen(p);
      } catch (e) {
        S.status = { error: e.message || String(e) };
        renderAll();
        opts.onReady?.();
        return;
      }
    }
    if (S.sourceId !== id) return; // another source was picked meanwhile
    S.provider = S.providers.get(id);
    S.status = null;
    // only the source on screen does background work (learning, save sync)
    for (const [k, pr] of S.providers) pr.setPaused?.(k !== id || S.minimized || doc.hidden);
    await loadPrefs();
    renderAll();
    opts.onReady?.();
    warmSearch(S.provider);
  }
  function warmSearch(p) {
    if (!p || p.entries.length < 2000) return; // small lists index instantly anyway
    win.setTimeout(() => warmSearchIndex(p, { sliceMs: 6, yieldFn: () => new Promise((r) => win.setTimeout(r, 0)), isPaused: () => S.minimized || doc.hidden }).catch(() => {}), 500);
  }
  const unsubs = [];
  function listen(p) {
    unsubs.push(p.on((reason, ids) => onProviderChange(reason, ids, p)));
  }
  // scan progress on the loading screen (updated in place, no re-render)
  let lastProg = 0;
  opts.onScanProgress?.((x) => {
    const t = Date.now();
    if (t - lastProg < 250) return; // a few updates per second are enough
    lastProg = t;
    const el = bodyEl.querySelector('.scanprog');
    if (!el) return;
    el.textContent = x.stage === 'menu' ? `Building the list of ${fmtNum(x.count)} values…` : x.stage === 'scoring' ? `Sorting ${fmtNum(x.count)} values…` : `Read ${fmtNum(x.count)} values${x.pending ? ` · ${fmtNum(x.pending)} objects left` : ''}…`;
  });

  async function loadPrefs() {
    if (!store) return;
    const scope = S.sourceId;
    S.favorites = new Set(await store.get(`fav:${scope}`, []));
    S.recent = await store.get(`recent:${scope}`, []);
    S.englishLabels = !!(await store.get('englishLabels', false));
    S.enInResults = await store.get('enInResults', true);
    S.compact = !!(await store.get('compact', false));
    if (hub) hub.setAuto((await store.get('saveAutoSync', true)) !== false);
    ROW_H = S.compact ? 44 : 56;
    panel.classList.toggle('compact', S.compact);
    const last = await store.get('search', null);
    if (last) {
      S.query = last.query || '';
      Object.assign(S.search, { filter: last.filter || 'all', gameplayOnly: last.gameplayOnly !== false, mode: last.mode || 'partial' });
    }
    S.display.auto = await store.get(`redraw:${S.sourceId}`, null);
  }
  function saveFavs() {
    store?.set(`fav:${S.sourceId}`, [...S.favorites]);
  }
  function pushRecent(ids) {
    for (const id of ids) {
      S.recent = [id, ...S.recent.filter((x) => x !== id)].slice(0, 40);
    }
    store?.set(`recent:${S.sourceId}`, S.recent);
  }

  function onProviderChange(reason, ids, from) {
    if (from && from !== S.provider) return; // another source (e.g. the shared saves): its view is rebuilt when selected
    if (reason === 'status') {
      // verification results arrive later: update rows / open status boxes in place
      if (listRefresh) listRefresh();
      for (const id of ids) if (statusBoxes.has(id)) fillStatus(statusBoxes.get(id), id);
      updateOrb();
      return;
    }
    if (reason === 'edit' || reason === 'undo' || reason === 'redo') {
      pushRecent(ids);
      for (const id of ids) if (statusBoxes.has(id)) fillStatus(statusBoxes.get(id), id);
    }
    if (reason === 'rescan') {
      S.stack = [{ type: 'home' }];
    }
    if (reason === 'learned') {
      // new evidence while playing: update the lists in place, keep the current screen
      const p = S.provider;
      warmSearch(p);
      for (const v of S.stack) {
        if (v.section) v.entries = p.entries.filter((e) => e.section === v.section && (v.section !== 'advanced' || e.category !== 'internal'));
        else if (v.all) v.entries = p.entries;
      }
      if (['edit', 'search', 'findvalue', 'display', 'apply'].includes(top().type)) {
        if (listRefresh) listRefresh();
        return;
      }
    }
    if ((reason === 'edit' || reason === 'undo' || reason === 'redo') && top().type === 'edit' && S.provider?.kind === 'live') {
      // keep the edit sheet open so the verification result is visible
      if (listRefresh) listRefresh();
      renderTools();
      return;
    }
    renderAll();
  }
  const statusBoxes = new Map(); // id -> element showing live verification status

  function statusOf(id) {
    return S.provider?.statusOf ? S.provider.statusOf(id) : null;
  }
  function fillStatus(el, id) {
    clear(el);
    const st = statusOf(id);
    if (!st) {
      el.className = 'statusbox';
      el.append(S.provider.isSave?.(id) ? 'Save value, not changed. Edits stay pending until you write the saves; the running game uses them after it loads the save.' : S.provider.kind === 'live' ? 'Not changed by SaveForge yet. After an edit SaveForge reads the value back from the game and watches whether the game keeps it.' : '');
      return;
    }
    el.className = `statusbox st-${st.state}`;
    el.append(h('b', null, `Game state: ${STATUS_MARK[st.state] || ''} ${STATUS[st.state] || st.state}`), h('div', null, st.detail || ''));
    const d = S.display.status.get(id);
    if (d) {
      const mark = { shown: '✓', auto: '✓', stale: '⚠', unknown: '?', checking: '…' }[d.state] || '';
      const title = { shown: 'Visible UI refreshed', auto: 'Visible UI redraws by itself', stale: 'Visible UI not refreshed yet', unknown: 'Visible UI: cannot check', checking: 'Checking the screen…' }[d.state] || d.state;
      el.append(h('div', { class: `displine ds-${d.state}` }, h('b', null, `Screen: ${mark} ${title}`), h('div', null, d.detail)));
    }
  }

  // ---------- visible UI refresh (separate from the game state)
  function renderer() {
    if (!S.display.renderer) S.display.renderer = detectRenderer(win, (opts.engineInfo || []).map((x) => x.id));
    return S.display.renderer;
  }
  async function afterEditDisplay(id, before, after) {
    if (S.provider?.kind !== 'live') return;
    S.display.status.set(id, { state: 'checking', detail: 'Looking at the screen…' });
    refreshStatusViews(id);
    const eng = (opts.engineInfo || []).map((x) => x.id);
    for (const e of eng) engineRedraw(win, e);
    let res = await checkDisplay(win, { newValue: after, oldValue: before, renderer: renderer() });
    if (res.state === 'stale' && S.display.auto) {
      const cand = (S.display.candidates ||= redrawCandidates(win)).find((c) => c.label === S.display.auto);
      if (cand) {
        const r = await tryRedraw(win, cand, { newValue: after, oldValue: before, renderer: renderer() });
        res = { state: r.state, detail: r.state === 'shown' ? `Refreshed automatically with ${cand.label}: the screen shows ${after}.` : r.detail };
      }
    }
    S.display.status.set(id, { ...res, before, after });
    refreshStatusViews(id);
    if (res.state === 'stale') toast('Game state updated · the screen redraws later: tap “Update game display”');
  }
  function refreshStatusViews(id) {
    if (statusBoxes.has(id)) fillStatus(statusBoxes.get(id), id);
  }

  function renderSources() {
    clear(sourcesEl);
    for (const s of opts.sources) {
      sourcesEl.append(h('button', { class: 'chip', 'aria-pressed': String(s.id === S.sourceId), onclick: () => selectSource(s.id) }, h('span', { class: `dot ${s.channel}` }), s.label));
    }
    if (opts.limitations?.length) sourcesEl.append(h('button', { class: 'chip', onclick: () => push({ type: 'about' }) }, '⚠ ', 'Limits'));
  }

  // ---------- navigation
  const top = () => S.stack[S.stack.length - 1];
  function push(view) {
    S.stack.push(view);
    S.selected = 0;
    renderAll();
  }
  function back() {
    if (S.stack.length > 1) S.stack.pop();
    S.selected = top().selected || 0;
    renderAll();
  }

  // ---------- list models
  function homeItems() {
    const p = S.provider;
    const items = [];
    if (!p.entries.length) {
      items.push({ kind: 'nav', label: 'No game variables found here', icon: 'info', count: '', hint: 'This page exposes no game state SaveForge can read. Open Diagnostics: the game may be in a frame, or keep its state where Safari does not allow access.', view: { type: 'diagnostics' } });
    }
    if (p.reloadSummary) items.push({ kind: 'nav', label: `After reload: ${p.reloadSummary.ok}/${p.reloadSummary.total} edits kept`, icon: p.reloadSummary.ok === p.reloadSummary.total ? 'shield' : 'info', count: '', hint: p.reloadSummary.ok === p.reloadSummary.total ? 'Every value written with Apply & Reload was still in storage after the game reloaded.' : 'The game overwrote some values when it reloaded (for example an autosave). Recent shows which.', view: { type: 'list', title: 'Recent', dynamic: 'recent' } });
    const lim = scanLimitItem(p);
    if (lim) items.unshift(lim);
    if (opts.cachedAt && p.kind === 'live') items.push({ kind: 'action', label: `Results from ${Math.max(1, Math.round((Date.now() - opts.cachedAt) / 60000))} min ago · Rescan`, icon: 'refresh', hint: 'Reopening reused the last scan instead of scanning again. Tap to read the game again.', run: () => (rescanGame(), undefined) });
    if (p.locks?.size) items.push({ kind: 'nav', label: `Locked values`, icon: 'lock', count: p.locks.size, hint: 'Values SaveForge keeps re-applying. Open to unlock.', view: { type: 'locks' } });
    for (const sec of SECTIONS) {
      const entries = p.entries.filter((e) => e.section === sec.id && (sec.id !== 'advanced' || e.category !== 'internal'));
      const hint = sec.id === 'potential' ? 'Probably game state, but SaveForge is not sure. Open ⓘ on one to see why and to mark it.' : undefined;
      if (entries.length) items.push({ kind: 'nav', label: sec.name, icon: sec.icon, count: entries.length, hint, view: { type: 'list', title: sec.name, entries, section: sec.id } });
    }
    items.push({ kind: 'nav', label: 'Favorites', icon: 'star', count: S.favorites.size, view: { type: 'list', title: 'Favorites', dynamic: 'fav' } });
    items.push({ kind: 'nav', label: 'Recently modified', icon: 'clock', count: S.recent.length, view: { type: 'list', title: 'Recent', dynamic: 'recent' } });
    items.push({ kind: 'nav', label: 'All variables', icon: 'list', count: p.entries.length, view: { type: 'list', title: 'All variables', entries: p.entries, all: true } });
    items.push({ kind: 'nav', label: 'Backups & restore', icon: 'shield', count: '', view: { type: 'backups' } });
    if (opts.diagnostics) items.push({ kind: 'nav', label: 'Diagnostics', icon: 'info', count: '', hint: 'Detected engine, frame, and where each variable comes from.', view: { type: 'diagnostics' } });
    for (const a of p.actions || []) items.push({ kind: 'action', label: a.label, icon: 'refresh', hint: a.hint, run: a.run });
    if (p.kind === 'live') items.push({ kind: 'nav', label: 'Update game display', icon: 'refresh', count: '', hint: 'Make the game redraw its screen after an edit, and see how this game draws.', view: { type: 'display', id: S.recent[0] || null } });
    items.push({ kind: 'nav', label: 'Find a value', icon: 'search', count: '', hint: 'Unknown game? Type a number you see on screen, change it in the game, scan again: SaveForge finds the real variable.', view: { type: 'findvalue' } });
    items.push({ kind: 'action', label: 'Rescan game', icon: 'refresh', hint: 'Look for the game again: engines that finished loading, new variables, new saves.', run: () => rescanGame() });
    if (hub && (p.kind === 'live' || p.kind === 'storage')) {
      if (hub.stale) items.unshift({ kind: 'nav', label: 'The game saved new progress', icon: 'info', count: '', hint: 'Your pending save edits were made on older save data. Open to write them anyway is refused; sync to discard them and read the new save.', view: { type: 'apply' } });
      items.push({ kind: 'action', label: 'Sync save variables', icon: 'refresh', hint: `Read the game’s saves again with the Save Editor’s detection (${savesOf(p)?.entries.length || 0} save variables now${hub.auto ? ', synced automatically while the trainer is open' : ''}).`, run: () => (syncSaves(), undefined) });
    }
    const scUI = getScSavesUI();
    if (scUI.pending() || scUI.hasSaves()) {
      const st = scUI.status();
      // an edited save waiting to be loaded (or just verified) is shown first
      (st ? items.unshift.bind(items) : items.push.bind(items))({ kind: 'nav', label: st ? (st.state === 'verified' ? 'Edited save loaded ✓' : 'Edited save: load it in the game') : 'Edit SugarCube save', icon: 'shield', count: '', hint: st ? st.text : 'Edit a save, back it up, write it to a manual slot, then load it from the game’s Saves menu. SaveForge verifies it after the game loads it.', view: { type: 'scsave' } });
    }
    items.push({ kind: 'nav', label: 'Import from Save Editor', icon: 'shield', count: '', hint: 'Bring a save decoded by the SaveForge Save Editor (share code or pasted save text) into the trainer as SAVE variables. You confirm first.', view: { type: 'import' } });
    items.push({ kind: 'nav', label: 'Button & Textbox Linker', icon: 'link', count: linkerUI ? linkerUI.linker.list().length || '' : '', hint: 'Advanced: inspect what a game button or field is connected to, and link it to another action (only after you confirm).', view: { type: 'linker' } });
    items.push({ kind: 'nav', label: 'Settings', icon: 'gear', count: '', hint: 'English labels, launcher visibility on this site.', view: { type: 'settings' } });
    return items;
  }

  /** Smart Scan stops early on big games; say what was not read and offer more, never hide it. */
  function scanLimitItem(p) {
    if (p.kind !== 'live' || !(p.truncated || p.scanStopped)) return null;
    const r = p.engine?.scanReport?.();
    const parts = [];
    if (r) {
      const roots = Object.entries(r.roots || {});
      const texts = roots.reduce((a, [, v]) => a + (v.skippedStrings || 0), 0);
      const cut = roots.filter(([, v]) => v.cut).map(([k]) => k);
      if (texts) parts.push(`${fmtNum(texts)} texts (text limit)`);
      if (cut.length) parts.push(`part of ${cut.slice(0, 3).join(', ')}${cut.length > 3 ? '…' : ''} (size limit)`);
      if (r.depthLimited) parts.push(`${fmtNum(r.depthLimited)} objects deeper than ${r.limits?.depth ?? '?'} levels`);
    }
    const label = p.scanStopped ? `Scan stopped · ${fmtNum(p.entries.length)} values so far` : `${r?.profile || 'Scan'}: ${fmtNum(p.entries.length)} values · more available`;
    return { kind: 'action', label, icon: 'search', hint: `Not read yet: ${parts.join('; ') || 'some values (scan limits)'}. Tap for a Deep scan (bigger limits; Stop keeps what it finds).`, run: () => (runDeepScan(), undefined) };
  }
  async function runDeepScan() {
    const p = S.provider;
    if (!p || p.kind !== 'live' || !opts.deepScan) return;
    const e = await opts.deepScan(S.sourceId);
    if (!e) return;
    const sig = createSignal();
    S.scanSignal = sig;
    S.status = { loading: `Deep scan of ${p.title}…`, scanning: true };
    renderAll();
    try {
      if (p.engine.refresh) p.engine.refresh();
      await p.relearnAsync({ signal: sig });
      toast(sig.aborted ? `Deep scan stopped: ${fmtNum(p.entries.length)} values` : `Deep scan done: ${fmtNum(p.entries.length)} values`);
    } catch (err) {
      toast(err.message, true);
    }
    S.scanSignal = null;
    S.status = null;
    renderAll();
  }

  function viewEntries(v) {
    const p = S.provider;
    if (v.dynamic === 'fav') return [...S.favorites].map((id) => p.entryById.get(id)).filter(Boolean);
    if (v.dynamic === 'recent') return S.recent.map((id) => p.entryById.get(id)).filter(Boolean);
    if (v.type === 'search') {
      if (!S.query.trim()) return [];
      const r = searchEntries(p, S.query, S.search);
      S.search.hidden = r.hiddenText;
      S.search.aliases = r.aliases;
      return r.results.map((x) => x.entry);
    }
    return v.entries;
  }

  // ---------- rendering
  function renderAll() {
    if (S.minimized) return updateOrb();
    renderSub();
    renderBody();
    renderTools();
    updateOrb();
  }

  function renderSub() {
    clear(subEl);
    compatEl.style.display = S.provider && top().type === 'home' ? '' : 'none';
    if (S.provider) {
      const c = compatibility();
      clear(compatEl).append(h('span', { class: `cdot ${c.level}` }), c.label);
    }
    const v = top();
    const crumb = v.type === 'home' ? 'Main menu' : v.type === 'list' ? v.title : v.type === 'search' ? 'Search' : v.type === 'info' ? 'Information' : v.type === 'edit' ? 'Edit value' : v.type === 'backups' ? 'Backups & restore' : v.type === 'apply' ? 'Apply & Reload' : v.type === 'diagnostics' ? 'Diagnostics' : v.type === 'findvalue' ? 'Find a value' : v.type === 'display' ? 'Update game display' : v.type === 'settings' ? 'Settings' : v.type === 'locks' ? 'Locked values' : /^link/.test(v.type) ? getLinkerUI().crumb(v) : v.type === 'scsave' ? 'SugarCube save' : v.type === 'import' ? 'Import from Save Editor' : v.type === 'impexport' ? 'Export imported save' : 'About';
    const ch = S.provider?.channel;
    subEl.append(h('span', { class: 'crumb' }, crumb), ch ? h('span', { class: `badge ${ch}` }, CHANNEL_LABEL[ch]) : null, h('span', { class: 'count' }, ''));
  }

  function setCount(i, n) {
    const c = subEl.querySelector('.count');
    if (c) c.textContent = n ? `${Math.min(i + 1, n)} / ${n}` : '';
  }

  function renderBody() {
    // a background update (saves attached, learning) must not make the list jump
    const oldList = bodyEl.querySelector('.list');
    if (oldList && oldList._view === top()) top().scroll = oldList.scrollTop;
    clear(bodyEl);
    listRefresh = null; // the previous list is gone; renderList installs a new one
    if (S.status?.loading) {
      bodyEl.append(
        h(
          'div',
          { class: 'empty' },
          h('div', null, S.status.loading),
          S.status.scanning ? h('div', { class: 'scanprog note' }, 'Starting…') : null,
          S.status.scanning && opts.stopScan ? h('div', { class: 'btns', style: 'justify-content:center' }, h('button', { class: 'btn', onclick: () => (S.scanSignal ? S.scanSignal.abort() : opts.stopScan(), toast('Stopping: keeping what was read so far')) }, 'Stop scanning')) : null,
          S.status.scanning ? h('p', { class: 'note' }, 'SaveForge reads the game in small steps so it keeps running. Stop keeps what was read so far; you can continue later.') : null,
        ),
      );
      return setDesc('');
    }
    if (S.status?.choice) return renderStartupChoice();
    if (S.status?.error) {
      bodyEl.append(h('div', { class: 'sheet' }, h('div', { class: 'badbox' }, S.status.error), limitationsBlock()));
      return setDesc('');
    }
    if (!S.provider) return bodyEl.append(h('div', { class: 'empty' }, 'Choose a source above.'));
    const v = top();
    if (v.type === 'home') return renderList(homeItems(), (it) => it);
    if (v.type === 'list') {
      const entries = viewEntries(v);
      if (!entries.length) {
        bodyEl.append(h('div', { class: 'empty' }, v.dynamic === 'fav' ? 'No favourites yet. Open ⓘ on any value and tap ★.' : v.dynamic === 'recent' ? 'Nothing modified yet.' : 'Nothing here.'));
        return setDesc('');
      }
      return renderList(entries, null);
    }
    if (v.type === 'search') return renderSearch();
    if (v.type === 'info') return renderInfo(v.id);
    if (v.type === 'edit') return renderEdit(v.id);
    if (v.type === 'backups') return renderBackups();
    if (v.type === 'apply') return renderApply();
    if (v.type === 'about') return renderAbout();
    if (v.type === 'diagnostics') return renderDiagnostics();
    if (v.type === 'findvalue') return renderFindValue();
    if (v.type === 'display') return renderDisplay(v.id);
    if (v.type === 'settings') return renderSettings();
    if (/^link/.test(v.type)) return getLinkerUI().render(v);
    if (v.type === 'import') return renderImport(v);
    if (v.type === 'scsave') return getScSavesUI().render(v);
    if (v.type === 'impexport') return renderImportExport();
    if (v.type === 'locks') {
      const p = S.provider;
      const entries = [...(p.locks?.keys() || [])].map((id) => p.entryById.get(id)).filter(Boolean);
      if (!entries.length) return bodyEl.append(h('div', { class: 'empty' }, 'Nothing is locked.')), setDesc('');
      renderList([{ kind: 'action', label: 'Unlock all', icon: 'lock', hint: 'Stop re-applying every locked value.', run: () => (p.unlockAll(), back()) }, ...entries], null);
      return;
    }
  }

  // ---------- virtual list
  let listRefresh = null;
  function renderList(items, _mapper, container = bodyEl) {
    const list = h('div', { class: 'list', role: 'listbox' });
    const spacer = h('div', { class: 'spacer', style: `height:${items.length * ROW_H}px` });
    list.append(spacer);
    list._items = items;
    list._view = top();
    container.append(list);
    const rows = new Map();
    const v = top();
    let raf = 0;
    const paint = () => {
      raf = 0;
      const vh = list.clientHeight || 468;
      const first = Math.max(0, Math.floor(list.scrollTop / ROW_H) - OVERSCAN);
      const last = Math.min(items.length, Math.ceil((list.scrollTop + vh) / ROW_H) + OVERSCAN);
      for (const [i, el] of rows) {
        if (i < first || i >= last) {
          el.remove();
          rows.delete(i);
        }
      }
      for (let i = first; i < last; i++) {
        if (!rows.has(i)) {
          const el = rowEl(items[i], i);
          el.style.top = `${i * ROW_H}px`;
          spacer.append(el);
          rows.set(i, el);
        }
      }
    };
    list.addEventListener('scroll', () => {
      if (!raf) raf = win.requestAnimationFrame(paint);
      v.scroll = list.scrollTop;
    }, { passive: true });
    let touching = false;
    list.addEventListener('pointerdown', () => (touching = true));
    for (const ev of ['pointerup', 'pointercancel']) list.addEventListener(ev, () => win.setTimeout(() => (touching = false), 400));
    listRefresh = () => {
      if (touching) return; // never swap a row under the user's finger
      for (const [i, el] of rows) {
        if (el._sig === rowSig(items[i], i)) continue;
        const fresh = rowEl(items[i], i);
        fresh.style.top = el.style.top;
        el.replaceWith(fresh);
        rows.set(i, fresh);
      }
    };
    win.requestAnimationFrame(() => {
      if (v.scroll) list.scrollTop = v.scroll;
      paint();
    });
    paint();
    selectRow(Math.min(S.selected, items.length - 1), items, false);
  }

  function selectRow(i, items, rerender = true) {
    S.selected = Math.max(0, i);
    top().selected = S.selected;
    setCount(S.selected, items.length);
    const it = items[S.selected];
    if (!it) return setDesc('');
    if (it.kind === 'nav' || it.kind === 'action') setDesc(it.hint || (it.kind === 'nav' ? `${it.count === '' ? '' : `${it.count} item(s). `}Tap to open.` : ''));
    else describe(it.nodeId);
    if (rerender) for (const r of bodyEl.querySelectorAll('.row')) r.classList.toggle('sel', Number(r.dataset.i) === S.selected);
  }

  function describe(id) {
    const p = S.provider;
    try {
      const x = p.explain(id);
      setDesc(`${x.summary}.`, x.channel, x.confidence.level);
    } catch {
      setDesc('');
    }
  }

  function setDesc(text, channel, conf) {
    clear(descEl);
    if (!text) return descEl.append(h('span', { class: 't' }, S.provider ? S.provider.note || '' : 'SaveForge trainer'));
    descEl.append(h('span', { class: 't' }, text));
    if (conf) descEl.append(h('span', { class: `badge ${conf.toLowerCase()}`, title: 'Interpretation confidence' }, conf));
  }

  function labelOf(e) {
    const base = S.provider.displayLabel(e);
    if (!S.englishLabels) return { text: base, original: null };
    if (e.en === undefined) e.en = englishLabel(base);
    return e.en ? { text: e.en.text, original: base, kind: e.en.kind } : { text: base, original: null };
  }

  function subLine(e, node, original, st) {
    const p = S.provider;
    if (st && (st.state === 'reverted' || st.state === 'adjusted' || st.state === 'failed')) return `${STATUS[st.state]}: now ${short(p.value(e.nodeId))}`;
    if (S.enInResults && node.type === 'string') {
      const v = p.value(e.nodeId);
      if (typeof v === 'string' && v.length > 1) {
        const tr = cachedTranslation(v);
        if (tr && tr.kind !== 'english' && tr.kind !== 'none') return `EN${tr.kind === 'translation' ? '' : ' (partial)'}: ${tr.english}`;
      }
    }
    return original ? `${original} · ${e.path}` : e.path;
  }
  const trCache = new Map();
  function cachedTranslation(text) {
    if (trCache.has(text)) return trCache.get(text);
    const r = toEnglish(text);
    if (trCache.size > 5000) trCache.clear();
    trCache.set(text, r);
    return r;
  }

  function compatibility() {
    const eng = opts.engineInfo || [];
    const p = S.provider;
    const adapters = eng.filter((x) => x.id !== 'generic' && x.id !== 'found');
    if (adapters.length) return { level: 'full', label: `Full live editing · ${adapters.map((x) => x.name).join(', ')}` };
    if (p && p.kind === 'live' && p.entries.length) return { level: 'partial', label: 'Partial: generic page state (edits verified one by one)' };
    if (p && p.kind === 'storage' && p.entries.length) return { level: 'saves', label: 'Saves only: edit with Apply & Reload' };
    if (opts.limitations?.length) return { level: 'none', label: `Not live-editable: ${opts.limitations[0].name}` };
    if (p && p.kind === 'file') return { level: 'saves', label: 'Save file editing (export)' };
    return { level: 'unknown', label: 'Unknown engine: try Find a value or Saves in storage' };
  }

  function rowSig(it, i) {
    const p = S.provider;
    if (it.kind === 'nav' || it.kind === 'action') return `${i === S.selected}|${it.count}`;
    let v;
    try {
      v = p.value(it.nodeId);
    } catch {
      v = undefined;
    }
    return `${i === S.selected}|${String(v)}|${p.originOf ? p.originOf(it.nodeId) : ''}|${p.isEdited(it.nodeId)}|${S.favorites.has(it.nodeId)}|${statusOf(it.nodeId)?.state || ''}|${S.englishLabels}`;
  }

  function rowEl(it, i) {
    const el = buildRow(it, i);
    el._sig = rowSig(it, i);
    return el;
  }

  function buildRow(it, i) {
    const p = S.provider;
    const sel = i === S.selected;
    const row = h('div', { class: `row${sel ? ' sel' : ''}`, role: 'option', 'data-i': String(i) });
    const choose = () => selectRow(i, bodyEl.querySelector('.list')?._items || [it]);
    if (it.kind === 'nav' || it.kind === 'action') {
      row.append(
        h('span', { class: 'ico' }, ic(it.icon)),
        h('div', { class: 'lbl', onclick: () => (choose(), it.kind === 'nav' ? push(it.view) : runAction(it)) }, h('span', { class: 'name' }, it.label)),
        h('span', { class: 'nav', onclick: () => (it.kind === 'nav' ? push(it.view) : runAction(it)) }, it.kind === 'nav' ? [String(it.count), ' ›'] : '▶'),
      );
      return row;
    }
    const e = it;
    const node = p.node(e.nodeId);
    if (!node) return row; // the entry vanished (re-read saves, rescan): repainted on the next refresh
    const value = p.value(e.nodeId);
    if (p.isEdited(e.nodeId)) row.classList.add('edited');
    const { text: label, original } = labelOf(e);
    const st = statusOf(e.nodeId);
    row.append(
      h(
        'div',
        { class: 'lbl', onclick: () => (S.selected === i ? openEdit(e.nodeId) : choose()) },
        h('span', { class: 'name' }, st && STATUS_MARK[st.state] ? h('span', { class: `st st-${st.state}`, title: STATUS[st.state] }, STATUS_MARK[st.state]) : null, S.favorites.has(e.nodeId) ? h('span', { class: 'star' }, '★') : null, label),
        h('span', { class: 'sub2' }, originTag(e), subLine(e, node, original, st)),
      ),
      valueWidget(node, value, e, choose),
      h('button', { class: 'info', 'aria-label': `About ${label}`, onclick: () => (choose(), push({ type: 'info', id: e.nodeId })) }, 'ⓘ'),
    );
    return row;
  }

  /** LIVE / SAVE / LIVE+SAVE, shown once save variables are part of the list. */
  function originTag(e) {
    const p = S.provider;
    if (p?.imported) return h('span', { class: 'otag o-save', title: 'Imported save: not the running game' }, 'SAVE · IMPORTED');
    if (!p?.hasSaves?.()) return null;
    const o = p.originOf(e.nodeId);
    return h('span', { class: `otag o-${o.replace('+', '')}`, title: o === 'live' ? 'Live: changes the running game' : o === 'save' ? 'Save: written to the game’s save (needs a reload or export)' : 'Live + Save: the running game and its save, linked by a verified mapping' }, o === 'live+save' ? 'LIVE+SAVE' : o.toUpperCase());
  }

  function valueWidget(node, value, e, choose) {
    const p = S.provider;
    if (!node.editable) return h('span', { class: 'lock' }, ic('lock'), short(value));
    if (node.type === 'bool') {
      return h('button', { class: `toggle${value ? ' on' : ''}`, onclick: () => (choose(), apply(e.nodeId, !value)) }, value ? 'ON' : 'OFF');
    }
    if (node.type === 'int' || node.type === 'float') {
      const step = stepFor(node, e, value);
      return h(
        'span',
        { class: 'val' },
        h('button', { class: 'arrow', 'aria-label': 'Decrease', onclick: () => (choose(), apply(e.nodeId, round(Number(value) - step, node))) }, '‹'),
        h('button', { class: 'num', onclick: () => (choose(), openEdit(e.nodeId)) }, fmtNum(value)),
        h('button', { class: 'arrow', 'aria-label': 'Increase', onclick: () => (choose(), apply(e.nodeId, round(Number(value) + step, node))) }, '›'),
      );
    }
    return h('button', { class: 'text', onclick: () => (choose(), openEdit(e.nodeId)) }, short(value));
  }

  function stepFor(node, e, value) {
    if (node.type === 'float' && Math.abs(value) < 10) return 0.1;
    const r = sliderRange({ ...node, value: Number(value) }, e.category);
    return r ? Math.max(1, Math.round(r.max / 100)) : 1;
  }
  function round(v, node) {
    return node.type === 'float' || !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v;
  }

  function apply(id, value, label) {
    try {
      const beforeValue = S.provider.value(id);
      const res = S.provider.set({ id, value: typeof value === 'number' ? String(value) : value }, label);
      if (res.changed) {
        const ch = S.provider.channelOf ? S.provider.channelOf(id) : S.provider.channel;
        if (ch === 'reload') toast(S.provider.kind === 'live' ? '⟳ Save edit pending: Write saves (kept for the next load) or Apply & Reload — the running game does not change yet' : '⟳ Requires reload: tap Apply & Reload to write it');
        else if (S.provider.channel === 'file') toast('Saved into the edit: Export to download');
        else if (res.verified) {
          const name = S.provider.entryById.get(id)?.label || 'Value';
          res.verified.then((list) => {
            const st = list[0];
            if (!st) return;
            const msg = { verified: `✓ ${name}: applied and verified in the game`, adjusted: `≈ ${name}: the game adjusted it to ${st.observed}`, reverted: `↺ ${name}: the game changed it back to ${st.observed}. Try Lock`, failed: `✕ ${name}: ${st.detail}` }[st.state];
            if (msg) toast(msg, st.state === 'reverted' || st.state === 'failed');
            if (st.state === 'verified' || st.state === 'adjusted') afterEditDisplay(id, beforeValue, S.provider.value(id));
          });
        }
      }
      return true;
    } catch (err) {
      toast(err.message, true);
      return false;
    }
  }

  function runAction(it) {
    try {
      const r = it.run();
      toast(`${it.label}: done`);
      return r;
    } catch (e) {
      toast(e.message, true);
    }
  }

  function openEdit(id) {
    const node = S.provider.node(id);
    if (!node.editable) return push({ type: 'info', id });
    if (node.type === 'bool') return apply(id, !S.provider.value(id));
    push({ type: 'edit', id });
  }

  // ---------- search
  function renderSearch() {
    const p = S.provider;
    const input = h('input', { type: 'search', inputmode: 'search', enterkeyhint: 'search', placeholder: `Search ${p.entries.length} variables or a value`, value: S.query, autocapitalize: 'none', autocorrect: 'off', autocomplete: 'off', spellcheck: false, 'aria-label': 'Search variables' });
    const clearBtn = h('button', { class: 'clr', 'aria-label': 'Clear search', onclick: () => ((input.value = ''), (S.query = ''), saveSearch(), run(), input.focus()) }, '×');
    const chip = (label, on, fn) => h('button', { class: `fchip${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick: fn }, label);
    const filters = h('div', { class: 'filters' });
    const results = h('div');
    const fillFilters = () => {
      clear(filters).append(
        ...[['all', 'All'], ['number', 'Numbers'], ['text', 'Text'], ['bool', 'On/Off'], ['editable', 'Editable'], ['game', 'Game state']].map(([k, l]) => chip(l, S.search.filter === k, () => ((S.search.filter = k), saveSearch(), fillFilters(), run()))),
        h('span', { class: 'fsep' }),
        chip('Gameplay only', S.search.gameplayOnly, () => ((S.search.gameplayOnly = !S.search.gameplayOnly), saveSearch(), fillFilters(), run())),
        chip(S.search.mode === 'exact' ? 'Exact' : 'Partial', S.search.mode === 'exact', () => ((S.search.mode = S.search.mode === 'exact' ? 'partial' : 'exact'), saveSearch(), fillFilters(), run())),
      );
    };
    bodyEl.append(h('div', { class: 'search' }, h('div', { class: 'sfield' }, input, clearBtn), filters), results);
    let t = 0;
    const run = () => {
      clear(results);
      clearBtn.style.visibility = S.query ? 'visible' : 'hidden';
      if (!S.query.trim()) {
        results.append(
          h(
            'div',
            { class: 'sugg' },
            h('div', { class: 'note' }, 'Try a word or the number you see in the game (e.g. 1822). Synonyms and other languages are matched too.'),
            h('div', { class: 'chips' }, SUGGESTIONS.map((w) => h('button', { class: 'fchip', onclick: () => ((input.value = w), (S.query = w), saveSearch(), run()) }, w))),
          ),
        );
        setDesc('');
        return;
      }
      const items = viewEntries(top());
      const info = [];
      if (S.search.aliases.length) info.push(`Also matching: ${S.search.aliases.slice(0, 6).join(', ')}${S.search.aliases.length > 6 ? '…' : ''}`);
      if (S.search.hidden) info.push(h('button', { class: 'linkbtn', onclick: () => ((S.search.gameplayOnly = false), saveSearch(), fillFilters(), run()) }, `${S.search.hidden} text/dialogue match(es) hidden — show`));
      const everywhere = S.sourceId !== 'raw' && opts.sources.some((x) => x.id === 'raw') ? h('button', { class: 'linkbtn raw-search', onclick: () => searchEverywhere() }, 'Search all accessible variables (no classification) →') : null;
      if (info.length) results.append(h('div', { class: 'sinfo' }, info.map((x) => h('div', null, x))));
      if (!items.length) {
        results.append(h('div', { class: 'empty' }, `No matches in ${p.title}.`, everywhere ? h('div', null, everywhere) : null));
        setDesc('');
        return;
      }
      if (everywhere) results.append(h('div', { class: 'sinfo' }, everywhere));
      renderList(items, null, results);
      results.querySelector('.list').style.height = S.compact ? 'min(38vh, 420px)' : 'min(34vh, 380px)';
    };
    input.addEventListener('input', () => {
      S.query = input.value;
      win.clearTimeout(t);
      t = win.setTimeout(() => (saveSearch(), run()), 140);
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur()); // closes the iPhone keyboard
    fillFilters();
    run();
    if (!S.query) win.setTimeout(() => input.focus(), 50);
  }
  /** Same query over every reachable variable (the unclassified raw source). */
  async function searchEverywhere() {
    const q = S.query;
    const keep = { ...S.search };
    await selectSource('raw');
    S.query = q;
    Object.assign(S.search, keep, { gameplayOnly: false });
    S.stack = [{ type: 'home' }, { type: 'search' }];
    renderAll();
  }
  function saveSearch() {
    store?.set('search', { query: S.query, filter: S.search.filter, gameplayOnly: S.search.gameplayOnly, mode: S.search.mode });
  }

  // ---------- info (explanation) sheet
  function renderInfo(id) {
    const p = S.provider;
    const x = p.explain(id);
    const node = p.node(id);
    const fav = S.favorites.has(id);
    const sheet = h(
      'div',
      { class: 'sheet' },
      h('h2', null, x.title),
      h('div', { class: 'path' }, x.path || id),
      h('div', { class: 'chips' }, h('span', { class: `badge ${x.channel}` }, x.timing.label), h('span', { class: `badge ${x.confidence.level.toLowerCase()}` }, `${x.confidence.level} confidence`), h('span', { class: 'badge' }, x.type)),
      statusSection(id),
      saveLinkSection(id),
      detectionSection(id),
      englishSection(id, x.title),
      h('h3', null, 'What it controls'),
      h('p', null, x.controls),
      h('h3', null, 'What changing it might do'),
      h('p', null, x.effect),
      h('h3', null, 'Current value'),
      typeof x.value === 'string' && x.value.length > 80
        ? h('div', null, h('details', { class: 'fulltext' }, h('summary', null, `${x.value.slice(0, 80)}… (show full text, ${x.value.length} characters)`), h('div', { class: 'textval' }, x.value)), h('dl', { class: 'kv' }, h('dt', null, 'Type'), h('dd', null, x.type)))
        : h('dl', { class: 'kv' }, h('dt', null, 'Now'), h('dd', { class: typeof x.value === 'string' ? 'textval' : '' }, typeof x.value === 'string' ? x.value : show(x.value)), h('dt', null, p.kind === 'live' ? 'Before trainer' : 'Original'), h('dd', null, show(x.original)), h('dt', null, 'Type'), h('dd', null, x.type)),
      h('h3', null, 'When it applies'),
      h('p', null, x.timing.text),
      x.source || x.frame ? h('h3', null, 'Where it comes from') : null,
      x.source || x.frame ? h('dl', { class: 'kv' }, x.source ? [h('dt', null, 'Source'), h('dd', null, x.source)] : null, x.frame ? [h('dt', null, 'Frame'), h('dd', null, x.frame)] : null) : null,
      h('h3', null, 'Side effects & progression'),
      h('p', null, x.progression),
      x.sideEffects.length ? h('ul', null, x.sideEffects.map((s) => h('li', null, s))) : null,
      h('h3', null, `How sure is SaveForge? ${x.confidence.level} (${Math.round(x.confidence.score * 100)}%)`),
      h('div', { class: 'meter' }, h('i', { style: `width:${Math.round(x.confidence.score * 100)}%` })),
      h('ul', null, x.confidence.reasons.map((r) => h('li', null, r))),
      h('p', { class: 'note' }, 'Explanations are generated from the variable name, type, surrounding data and engine knowledge. They are informed guesses unless marked as a documented engine field.'),
      h(
        'div',
        { class: 'btns' },
        node.editable ? h('button', { class: 'btn go', onclick: () => openEdit(id) }, node.type === 'bool' ? 'Toggle' : 'Edit') : null,
        h('button', { class: 'btn', onclick: () => toggleFav(id) }, ic('star'), fav ? 'Unfavorite' : 'Favorite'),
        h('button', { class: 'btn', onclick: back }, 'Back'),
      ),
    );
    bodyEl.append(sheet);
    setDesc(x.summary, x.channel, x.confidence.level);
  }

  /** Live / Save / Live + Save, and how a link was established (never from names alone). */
  function saveLinkSection(id) {
    const p = S.provider;
    if (!p?.hasSaves?.()) return null;
    const o = p.originOf(id);
    const link = p.saveLinkOf(id);
    const sp = p.saveProvider();
    const rows = [];
    if (o === 'live+save') {
      rows.push(h('p', null, `Linked to the save field ${sp.sourceOf(link.saveId)}.`), h('p', { class: 'note' }, `How: ${link.how === 'engine' ? 'the engine’s documented save layout' : 'verified observation'} — ${link.detail}.`), h('p', { class: 'note' }, 'Editing changes the running game right away (verified). The save keeps the old value until the game saves, or until you tap “Also write to save” and Write saves.'));
      if (link.how === 'observed') rows.push(h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { hub.unlink(p.engine.id, id); toast('Link removed'); back(); } }, 'Remove this link')));
    } else if (o === 'save') {
      if (/^\$/.test(p.entryById.get(id)?.label || '') && /\/state\/(delta|history)\//.test(id)) rows.push(h('div', { class: 'btns' }, h('button', { class: 'btn go', onclick: () => push({ type: 'scsave', fresh: true, prefill: { expr: p.entryById.get(id).label.slice(1), value: String(p.value(id)) } }) }, 'Edit with the SugarCube save workflow')));
      const possible = hub ? hub.possibleFor(p.isSave(id) ? id.slice(5) : id) : [];
      rows.push(h('p', null, `Only in the save: ${sp.sourceOf(id.slice(5))}.`), h('p', { class: 'note' }, 'Not linked to a running-game variable. Edits are written to the save (Write saves) and used when the game loads it, or exported.'));
      if (possible.length) rows.push(h('p', { class: 'note' }, `Possibly the same as: ${possible.map((x) => p.entryById.get(x)?.path || x).join(', ')} — not verified (several live values changed the same way), so not merged.`));
    } else {
      rows.push(h('p', { class: 'note' }, 'Live only: no save field is linked. A link is made only by the engine’s save layout or after SaveForge sees the save follow this value (e.g. change it, then save in-game).'));
    }
    return h('div', null, h('h3', null, `Source: ${o === 'live+save' ? 'Live + Save' : o === 'save' ? 'Save' : 'Live'}`), rows);
  }

  const TIER_TEXT = {
    game: 'Game variable',
    potential: 'Potential game variable',
    text: 'Text next to game variables',
    excluded: 'Excluded (looks like website data)',
  };
  /** Why the generic detector shows (or hid) this variable, with buttons to correct it. */
  function detectionSection(id) {
    const p = S.provider;
    const d = p.detection ? p.detection(id) : null;
    if (!d) return null;
    const marked = p.engine?.marks ? p.engine.marks()[id] : null;
    return h(
      'div',
      { class: 'detect' },
      h('h3', null, `Detection: ${TIER_TEXT[d.tier] || d.tier}`),
      h('div', { class: 'meter' }, h('i', { style: `width:${Math.max(0, Math.min(100, Math.round(d.score * 100)))}%` })),
      h('p', { class: 'note' }, `Score ${d.score} (game ≥ 0.5, potential ≥ 0.3). Evidence:`),
      h('ul', null, d.reasons.map((r) => h('li', null, r))),
      p.canMark && p.canMark()
        ? h(
            'div',
            { class: 'btns' },
            h('button', { class: 'btn', onclick: () => markVar(id, 'game') }, marked === 'game' ? '✓ Marked as game variable' : 'This is a game variable'),
            h('button', { class: 'btn', onclick: () => markVar(id, 'not') }, marked === 'not' ? '✓ Marked as not a game variable' : 'Not a game variable'),
            marked ? h('button', { class: 'btn', onclick: () => markVar(id, null) }, 'Forget my choice') : null,
          )
        : null,
      p.canMark && p.canMark() ? h('p', { class: 'note' }, 'Your choice is remembered for this website, in Safari’s storage for this site.') : null,
    );
  }
  function markVar(id, tier) {
    S.provider.mark(id, tier);
    toast(tier === 'game' ? 'Marked as a game variable (remembered for this site)' : tier === 'not' ? 'Hidden from now on (remembered for this site)' : 'Choice forgotten');
    renderAll();
  }

  function toggleFav(id) {
    if (S.favorites.has(id)) S.favorites.delete(id);
    else S.favorites.add(id);
    saveFavs();
    renderAll();
  }

  function revert(id) {
    const p = S.provider;
    const orig = p.original(id);
    apply(id, typeof orig === 'number' ? String(orig) : orig, 'Revert');
  }

  // ---------- edit sheet
  function renderEdit(id) {
    const p = S.provider;
    const node = p.node(id);
    const e = p.entryById.get(id);
    const cur = p.value(id);
    const isNum = node.type === 'int' || node.type === 'float';
    const input = node.type === 'string' && String(cur).length > 40 ? h('textarea', { class: 'field' }) : h('input', { class: 'field', inputmode: isNum ? 'decimal' : 'text', enterkeyhint: 'done', autocapitalize: 'off', autocomplete: 'off' });
    input.value = isNum ? String(cur) : cur;
    const range = isNum ? sliderRange({ ...node, value: Math.max(Math.abs(Number(cur)), Math.abs(Number(node.value))) }, e?.category) : null;
    const set = (v) => {
      input.value = String(round(v, node));
      input.classList.remove('bad');
    };
    const commit = () => {
      if (!apply(id, input.value.trim())) return input.classList.add('bad');
      if (p.kind !== 'live') back();
    };
    input.addEventListener('keydown', (ev) => ev.key === 'Enter' && !ev.shiftKey && (ev.preventDefault(), commit()));
    const quick = isNum
      ? h(
          'div',
          { class: 'quick' },
          [
            ['0', () => set(0)],
            ['−10%', () => set(Number(input.value) * 0.9)],
            ['+10%', () => set(Number(input.value) * 1.1)],
            ['×2', () => set(Number(input.value) * 2)],
            ['×10', () => set(Number(input.value) * 10)],
            ['½', () => set(Number(input.value) / 2)],
            range ? [`${fmtNum(range.max)}`, () => set(range.max)] : null,
            ['Orig.', () => set(Number(p.original(id)))],
          ]
            .filter(Boolean)
            .map(([t, fn]) => h('button', { onclick: () => (fn(), node.type === 'int' && (input.value = String(Math.round(Number(input.value))))) }, t)),
        )
      : e?.suggestions
        ? h('div', { class: 'quick' }, e.suggestions.slice(0, 8).map((s) => h('button', { onclick: () => (input.value = s) }, short(s))))
        : null;
    const ch = p.channelOf ? p.channelOf(id) : p.channel;
    const timing = ch === 'live' || ch === 'live-generic' ? 'Applies to the running game immediately.' : ch === 'reload' ? 'Kept pending until you write the saves (Write saves or Apply & Reload). The running game only sees it after it loads the save.' : 'Goes into the exported save file.';
    bodyEl.append(
      h(
        'div',
        { class: 'sheet' },
        h('h2', null, p.displayLabel(e || { label: node.key, nodeId: id })),
        h('div', { class: 'path' }, e?.path || id),
        h('div', { class: 'chips' }, h('span', { class: `badge ${ch}` }, CHANNEL_LABEL[ch]), p.originOf && p.hasSaves?.() ? h('span', { class: 'badge' }, p.originOf(id).toUpperCase()) : null, h('span', { class: 'badge' }, node.type)),
        h('div', { style: 'height:8px' }),
        input,
        h('div', { class: 'btns', style: 'margin-top:8px' }, h('button', { class: 'btn go', onclick: commit }, 'Apply'), h('button', { class: 'btn', onclick: back }, p.kind === 'live' ? 'Done' : 'Cancel'), h('button', { class: 'btn', onclick: () => push({ type: 'info', id }) }, 'ⓘ Info')),
        statusSection(id),
        quick,
        node.type === 'string' ? translateBox(String(cur)) : null,
        h('p', { class: 'note' }, `${timing} ${p.kind === 'live' ? 'Before trainer' : 'Original'}: ${show(p.original(id))}.`),
      ),
    );
    describe(id);
    win.setTimeout(() => input.focus(), 60);
  }

  // ---------- status / lock / restore block (info + edit sheets)
  function statusSection(id) {
    const p = S.provider;
    const box = h('div', { class: 'statusbox' });
    statusBoxes.set(id, box);
    fillStatus(box, id);
    const btns = h('div', { class: 'btns' });
    if (p.kind === 'live' && p.canLock?.(id)) {
      const locked = p.locks.has(id);
      btns.append(h('button', { class: `btn${locked ? ' warn' : ''}`, onclick: () => { try { locked ? p.unlock(id) : p.lock(id); toast(locked ? 'Unlocked' : `Locked at ${short(p.value(id))}: SaveForge re-applies it if the game changes it`); renderAll(); } catch (e) { toast(e.message, true); } } }, ic('lock'), locked ? 'Unlock' : 'Lock value'));
    }
    const isSave = p.isSave?.(id);
    if (p.kind === 'live' && !isSave) btns.append(h('button', { class: 'btn', onclick: () => push({ type: 'display', id }) }, ic('refresh'), 'Update game display'));
    if (p.saveLinkOf?.(id)) {
      btns.append(h('button', { class: 'btn', onclick: () => { try { const r = p.setSaveFor(id, p.value(id)); toast(r.changed ? `Save field set to ${short(p.value(id))}: tap Write saves to keep it for the next load` : 'The save already has this value'); renderAll(); } catch (e) { toast(e.message, true); } } }, '⤓ Also write to save'));
    }
    if ((isSave || p.saveLinkOf?.(id)) && p.savePending?.()) btns.append(h('button', { class: 'btn go', onclick: () => push({ type: 'apply' }) }, `Write saves (${p.savePending()})…`));
    if (p.isEdited(id) && p.restoreOriginal) {
      btns.append(h('button', { class: 'btn', onclick: () => { p.restoreOriginal(id); toast(`Restoring original value ${short(p.original(id))}`); renderAll(); } }, '↺ Restore original'));
    }
    return h('div', null, h('h3', null, 'Status in the game'), box, btns.childNodes.length ? btns : null);
  }

  function englishSection(id, title) {
    const p = S.provider;
    const node = p.node(id);
    const keyText = String(node.key);
    const k = toEnglish(title && title !== keyText ? title : keyText);
    const v = node.type === 'string' && typeof p.value(id) === 'string' ? toEnglish(p.value(id)) : null;
    const rows = [];
    const badge = (r) => h('span', { class: `badge ${r.kind === 'translation' ? 'high' : r.kind === 'partial' || r.kind === 'guess' ? 'medium' : 'low'}` }, r.kind === 'translation' ? `Translation · ${r.languageName}` : r.kind === 'partial' ? `Partial translation · ${r.languageName || '?'}` : r.kind === 'guess' ? 'Guessed meaning' : `Not translated${r.languageName ? ` · ${r.languageName}` : ''}`);
    const block = (what, r) => {
      if (r.kind === 'english') return null;
      return h(
        'div',
        { class: 'tr' },
        h('div', null, h('b', null, what), ' ', badge(r)),
        h('dl', { class: 'kv' }, h('dt', null, 'Original'), h('dd', null, r.original), h('dt', null, 'English'), h('dd', null, r.kind === 'none' ? '—' : r.english)),
        r.parts.some((x) => x.how === 'dictionary' || x.how === 'abbreviation' || x.how === 'unknown') ? h('ul', null, r.parts.filter((x) => x.how !== 'english' && x.how !== 'number').map((x) => h('li', null, `${x.src} → ${x.en ?? 'not in the offline dictionary'}${x.how === 'abbreviation' ? ' (abbreviation, guessed)' : x.how === 'dictionary' ? '' : ''}`))) : null,
        h('p', { class: 'note' }, r.note),
        r.kind !== 'translation' && r.kind !== 'guess' ? h('button', { class: 'btn', onclick: () => translateOnline(r.original) }, 'Translate online (asks first)') : null,
      );
    };
    const parts = [block('Name', k), v ? block('Text value', v) : null].filter(Boolean);
    if (!parts.length) return null;
    return h('div', null, h('h3', null, 'In English'), parts);
  }

  /** "Translate to English" for a text value: display only, the game's text is never changed. */
  function translateBox(text) {
    const box = h('div', { class: 'trbox' });
    const showIt = () => {
      const r = toEnglish(text);
      clear(box).append(
        h('div', null, h('b', null, 'English: '), r.kind === 'english' ? 'Already English.' : r.kind === 'none' ? 'Not in the offline dictionary.' : r.english),
        r.note ? h('div', { class: 'note' }, r.note) : null,
        r.kind !== 'translation' && r.kind !== 'english' ? h('button', { class: 'btn', onclick: () => translateOnline(text) }, 'Translate online (asks first)') : null,
        h('div', { class: 'note' }, 'Shown for reading only; the game’s own text is not changed.'),
      );
    };
    box.append(h('button', { class: 'btn', onclick: showIt }, 'Translate to English'));
    return box;
  }

  function translateOnline(text) {
    const ok = win.confirm(`Send only this text to Google Translate?\n\n“${String(text).slice(0, 200)}”\n\nNothing else from the game or your saves is sent. It opens in a new tab.`);
    if (ok) win.open(onlineTranslateUrl(text), '_blank', 'noopener');
  }

  // ---------- update game display (investigate + refresh the visible UI)
  function renderDisplay(id) {
    const p = S.provider;
    const r = renderer();
    const d = id ? S.display.status.get(id) : null;
    const cands = (S.display.candidates = redrawCandidates(win));
    const resultEl = h('div');
    const sheet = h(
      'div',
      { class: 'sheet' },
      h('h2', null, 'Update game display'),
      h('p', null, 'Your edit is already in the game’s state. This screen is about the picture: making the game redraw what it shows.'),
      h('h3', null, 'How this game draws'),
      h('p', null, `${r.kind === 'engine-loop' ? 'Engine render loop' : r.kind === 'framework' ? `${r.name} app` : r.kind === 'canvas' ? 'Canvas' : 'HTML page'}: ${r.evidence}.`),
      d ? h('div', { class: `statusbox ds-${d.state}` }, h('b', null, 'Screen now'), h('div', null, d.detail)) : null,
      h('h3', null, `The game’s own redraw functions (${cands.length})`),
      cands.length
        ? h(
            'div',
            null,
            h('p', { class: 'note' }, 'Found in the page by name. SaveForge only runs one when you tap Try, then checks the screen. Functions that look like they change the game (tick, buy, add, save…) are never listed.'),
            cands.map((c) =>
              h(
                'div',
                { class: 'cand' },
                h('div', null, h('b', null, c.label), h('div', { class: 'note' }, `${c.touchesDom ? 'writes to the page' : 'unknown effect'}${c.mutates ? ' · also changes numbers, so use with care' : ''}`)),
                h('button', { class: 'btn', onclick: () => runCandidate(c, id, resultEl) }, 'Try'),
              ),
            ),
          )
        : h('p', null, r.kind === 'engine-loop' ? 'Not needed: the engine redraws every frame.' : 'No redraw function could be identified safely. Many games keep them private.'),
      resultEl,
      id && d && d.state === 'stale' ? h('div', null, h('h3', null, 'Display-only fallback'), h('p', { class: 'note' }, `Replace ${d.before} with ${d.after} in the text currently on screen. This changes only what you see, not the game; the game’s next redraw shows the same value anyway.`), h('button', { class: 'btn', onclick: () => { const n = patchVisibleNumber(win, d.before, d.after); toast(n ? `Updated ${n} number(s) on screen (display only)` : 'The old number is no longer on screen'); afterEditDisplay(id, d.before, d.after); } }, 'Show new number on screen')) : null,
      h('h3', null, 'Manual fallback'),
      h('p', null, 'Switch to another screen or tab in the game and back. The game redraws then, and your new value appears. Your progress is not affected.'),
      S.display.auto ? h('div', { class: 'okbox' }, `Automatic after edits on this site: ${S.display.auto}`, h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: async () => { S.display.auto = null; await store?.set(`redraw:${S.sourceId}`, null); renderAll(); } }, 'Stop automatic redraw'))) : null,
    );
    bodyEl.append(sheet);
    setDesc('Game state and the visible screen are separate: a value can be correct in the game before the screen shows it.');
  }

  async function runCandidate(c, id, resultEl) {
    const d = id ? S.display.status.get(id) : null;
    const r = await tryRedraw(win, c, { newValue: d ? d.after : undefined, oldValue: d ? d.before : undefined, renderer: renderer() });
    clear(resultEl).append(
      h(
        'div',
        { class: r.ok ? 'okbox' : 'warnbox' },
        r.detail,
        r.ok ? h('div', { class: 'btns' }, h('button', { class: 'btn go', onclick: async () => { S.display.auto = c.label; await store?.set(`redraw:${S.sourceId}`, c.label); toast(`Will run ${c.label} after edits on this site`); renderAll(); } }, 'Use automatically after edits')) : null,
      ),
    );
    if (id && d) {
      S.display.status.set(id, { ...d, state: r.state === 'error' ? d.state : r.state, detail: r.detail });
      refreshStatusViews(id);
    }
  }

  // ---------- find a value (value scanner)
  function renderFindValue() {
    const sc = S.scan;
    const input = h('input', { class: 'field', inputmode: 'decimal', enterkeyhint: 'search', placeholder: 'e.g. 120', value: sc.target });
    const result = h('div');
    const run = () => {
      const n = Number(String(input.value).trim());
      if (!String(input.value).trim() || !Number.isFinite(n)) return toast('Type the number you see in the game', true);
      sc.target = String(n);
      if (!sc.paths) {
        const r = firstScan(win, n);
        sc.paths = r.paths;
        sc.info = `First scan: ${r.paths.length} match(es) among ${r.visited.toLocaleString()} values in ${r.ms} ms${r.truncated ? ' (stopped early: very large page)' : ''}.`;
      } else {
        const before = sc.paths.length;
        sc.paths = nextScan(win, sc.paths, n);
        sc.info = `Next scan: ${before} → ${sc.paths.length} match(es).`;
      }
      sc.history.push(n);
      renderAll();
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && run());
    const add = () => {
      sc.kept = sc.paths.slice(0, 50);
      const src = opts.sources.find((x) => x.id === 'found');
      if (!src) opts.sources.push({ id: 'found', label: 'Found values', channel: 'live-generic', create: () => new LiveProvider(win, foundValuesEngine(win, () => sc.kept), store) });
      S.providers.delete('found');
      selectSource('found').then(() => S.provider && push({ type: 'list', title: 'Found values', entries: S.provider.entries }));
      toast(`${sc.kept.length} value(s) added to Found values`);
    };
    bodyEl.append(
      h(
        'div',
        { class: 'sheet' },
        h('h2', null, 'Find a value'),
        h('p', null, sc.paths ? 'Now change this number in the game (spend, earn, take damage…), then type the new number and scan again.' : 'Type a number you can see in the game right now, for example your gold or score.'),
        input,
        h('div', { class: 'btns' }, h('button', { class: 'btn go', onclick: run }, sc.paths ? 'Next scan' : 'First scan'), sc.paths ? h('button', { class: 'btn', onclick: () => { S.scan = { target: '', paths: null, kept: [], history: [], info: '' }; renderAll(); } }, 'Start over') : null),
        sc.info ? h('p', { class: 'note' }, sc.info) : null,
        sc.paths && sc.paths.length && sc.paths.length <= 50 ? h('div', null, h('ul', null, sc.paths.slice(0, 12).map((p) => h('li', { class: 'path' }, p.join('.')))), h('div', { class: 'btns' }, h('button', { class: 'btn go', onclick: add }, `Edit these ${sc.paths.length}`))) : null,
        sc.paths && sc.paths.length > 50 ? h('p', { class: 'note' }, 'Too many matches: change the value in the game and scan again to narrow it down.') : null,
        sc.paths && !sc.paths.length ? h('div', { class: 'warnbox' }, 'No matches. The game probably keeps this number where page scripts cannot see it (inside a closure, a module, WebAssembly or a server), or shows a value calculated from something else. Saves in storage may still work.') : null,
        h('p', { class: 'note' }, 'Searches every value reachable from the page’s globals (never runs game code). Values hidden in closures, modules, WebAssembly or on a server cannot be found.'),
        result,
      ),
    );
    setDesc('Classic trainer search: narrow a visible number down to the variable that holds it.');
    win.setTimeout(() => input.focus(), 50);
  }

  // ---------- settings
  async function renderSettings() {
    const sheet = h('div', { class: 'sheet' }, h('h2', null, 'Settings'));
    bodyEl.append(sheet);
    const toggleRow = (label, on, fn, note) => h('div', { class: 'setrow' }, h('div', null, h('b', null, label), note ? h('div', { class: 'note' }, note) : null), h('button', { class: `toggle${on ? ' on' : ''}`, onclick: fn }, on ? 'ON' : 'OFF'));
    sheet.append(
      toggleRow('Show English labels', S.englishLabels, async () => {
        S.englishLabels = !S.englishLabels;
        await store?.set('englishLabels', S.englishLabels);
        renderAll();
      }, 'Translates or explains variable names offline. The original name stays underneath, and editing always uses the original variable.'),
      toggleRow('English for text values', S.enInResults, async () => {
        S.enInResults = !S.enInResults;
        await store?.set('enInResults', S.enInResults);
        renderAll();
      }, 'Shows an English translation under foreign-language text in lists and search results (display only).'),
      toggleRow('Compact view', S.compact, async () => {
        S.compact = !S.compact;
        ROW_H = S.compact ? 44 : 56;
        panel.classList.toggle('compact', S.compact);
        await store?.set('compact', S.compact);
        renderAll();
      }, 'Smaller rows so more variables fit on the iPhone screen.'),
      hub
        ? toggleRow('Sync save variables automatically', hub.auto, async () => {
            hub.setAuto(!hub.auto);
            await store?.set('saveAutoSync', hub.auto);
            renderAll();
          }, 'While the trainer is open, SaveForge re-reads the game’s saves when they change (the same detection as the Save Editor). Pending save edits are never overwritten.')
        : null,
    );
    if (opts.settingsP && store) {
      const saved = (await store.get('perf', {})) || {};
      const eff = await opts.settingsP;
      const save = async (patch) => {
        await store.set('perf', { ...saved, ...patch });
        toast('Saved: applies to the next scan (Rescan game)');
        renderAll();
      };
      const choice = (label, key, options, note) =>
        h('div', null, h('b', null, label), note ? h('div', { class: 'note' }, note) : null, h('div', { class: 'btns' }, options.map(([v, t]) => h('button', { class: `btn mini${(saved[key] ?? null) === v ? ' go' : ''}`, onclick: () => save({ [key]: v }) }, t))));
      sheet.append(
        h('h3', null, 'Performance'),
        h('p', { class: 'note' }, `Now: ${eff.name}${eff.lowMemoryAuto ? ` (automatic: ${eff.lowMemory ? 'this looks like a phone' : 'not a phone'})` : ''} · up to ${fmtNum(eff.maxNodes)} values, ${eff.depth} levels deep · background ${eff.learnEveryMs ? `every ${eff.learnEveryMs / 1000} s` : 'off'}.`),
        choice('Low Memory Mode', 'lowMemory', [[null, 'Automatic'], [true, 'On'], [false, 'Off']], 'Smart Scan: reads gameplay values first with small limits, skips script files and IndexedDB until you ask, and does less in the background. Nothing is hidden: what was not read is listed, with Deep scan.'),
        choice('Scan depth', 'depth', [[null, 'Default'], [6, '6'], [8, '8'], [10, '10'], [14, '14']]),
        choice('Variable limit (first scan)', 'maxNodes', [[null, 'Default'], [10000, '10k'], [25000, '25k'], [90000, '90k'], [300000, '300k']]),
        choice('Background scanning', 'background', [[null, 'Automatic'], ['slow', 'Slow'], ['off', 'Off']], 'Learning which values change while you play, and save sync. Always paused while SaveForge is minimized or the page is hidden.'),
        choice('Read IndexedDB saves automatically', 'readIndexedDB', [[null, 'Default (no)'], [true, 'Yes'], [false, 'No']], 'Some engines keep whole game files there (Unity, Godot). Saves in storage reads it when you open it.'),
        choice('Keep scan results when closed', 'keepResults', [[null, 'Yes'], [false, 'No']], 'Reopening shows the last results immediately instead of scanning again (paused while closed).'),
      );
    }
    if (opts.siteMode) {
      const mode = await opts.siteMode.get();
      sheet.append(
        h('h3', null, 'SaveForge launcher on this site'),
        h('div', { class: 'btns' }, ['auto', 'always', 'never'].map((m) => h('button', { class: `btn${mode === m ? ' go' : ''}`, onclick: async () => { await opts.siteMode.set(m); toast(`Launcher: ${m}`); renderAll(); } }, { auto: 'Automatic', always: 'Always show', never: 'Hide' }[m]))),
        h('p', { class: 'note' }, 'Automatic shows the ⬢ only when a game is detected. Always show keeps it on this site even if detection fails. You can also add #saveforge to any address to open SaveForge.'),
      );
    }
    sheet.append(h('p', { class: 'note' }, 'Translation uses a built-in dictionary (Spanish, French, German, Portuguese, Italian, Dutch, Polish, Turkish, Russian, Japanese, Chinese, Korean) and runs entirely on your device. “Translate online” is only used when you tap it, and it asks first.'));
    setDesc('');
  }

  async function rescanGame() {
    toast('Rescanning…');
    if (opts.rescanSources) {
      const fresh = opts.rescanSources();
      for (const src of fresh) {
        if (opts.sources.some((x) => x.id === src.id)) continue;
        const at = opts.sources.findIndex((x) => x.id === 'raw' || x.id === 'storage');
        opts.sources.splice(at < 0 ? opts.sources.length : at, 0, src);
      }
      if (opts.engineInfoRefresh) opts.engineInfo = opts.engineInfoRefresh();
    }
    const p = S.provider;
    if (p?.kind === 'live') {
      if (p.engine.refresh) p.engine.refresh();
      if (p.relearnAsync) await p.relearnAsync();
      else p.rescan();
    } else if (p?.kind === 'storage') return reread();
    renderSources();
    renderAll();
    toast(`Rescanned: ${S.provider?.entries.length ?? 0} variable(s) in ${S.provider?.title || 'this source'}`);
  }

  // ---------- Apply & Reload (storage)
  function renderApply() {
    const p = S.provider;
    const sp = savesOf(p);
    const diff = sp?.diff ? sp.diff() : [];
    const label = (d) => sp.entryById.get(d.id)?.label || d.node.key;
    const sheet = h(
      'div',
      { class: 'sheet' },
      h('h2', null, `Write ${diff.length} save change(s)`),
      sugarCubeReloadWarning(sp),
      hub?.stale ? h('div', { class: 'badbox' }, 'The game saved new progress after these edits were made. Writing is refused so that progress is not overwritten: Sync save variables (discards the pending save edits) and edit again.') : null,
      h('ul', null, diff.slice(0, 50).map((d) => h('li', null, `${label(d)}: ${show(d.before)} → ${show(d.after)}`))),
      h('div', { class: 'okbox' }, 'Before writing, SaveForge checks that the game has not saved meanwhile, re-decodes the rebuilt save to verify every value, and stores a backup you can restore from “Backups & restore”.'),
      h('h3', null, 'Write saves (no reload)'),
      h('p', { class: 'note' }, 'The save is changed in place. The running game is not changed: it uses the new values when it next loads this save. If the game saves before that, its in-memory values replace yours.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn go', onclick: doWriteNow }, 'Write saves')),
      h('h3', null, 'Apply & Reload'),
      h('div', { class: 'warnbox' }, 'Writes the saves, then reloads the page so the game reads them. Anything you did in the game since its last save is lost — save in-game first if needed.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn warn', onclick: doApply }, 'Apply & Reload')),
      h('h3', null, 'Export edited saves'),
      h('p', { class: 'note' }, 'Downloads the edited saves as a SaveForge storage export (verified). Open it in the SaveForge Save Editor, or import it with the Storage Bridge.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: doExport }, 'Export edited saves'), h('button', { class: 'btn', onclick: back }, 'Cancel')),
    );
    bodyEl.append(sheet);
    setDesc('Save edits are written to the game’s storage. The running game sees them after it loads the save.', 'reload');
  }

  // ---------- import from the Save Editor (different site: share code through the clipboard)
  function renderImport(v) {
    const sheet = h('div', { class: 'sheet' }, h('h2', null, 'Import from Save Editor'));
    bodyEl.append(sheet);
    if (!v.preview) {
      const ta = h('textarea', { class: 'field', placeholder: 'Paste the share code from the Save Editor (Export → Copy share code), or a save text', autocapitalize: 'off', spellcheck: false, style: 'min-height:120px' });
      const err = h('div');
      const read = async () => {
        clear(err);
        try {
          const sh = decodeShare(ta.value);
          const res = await analyzeFile(sh.name, sh.input);
          if (!res.ok) throw new Error(`The save could not be decoded: ${res.reasons.slice(0, 2).join('; ')}`);
          const sp = hub ? await hub.ensure() : null;
          v.preview = { sh, doc: res.doc, match: matchImported(res.doc, sp) };
          renderAll();
        } catch (e) {
          err.append(h('div', { class: 'badbox' }, e.message));
        }
      };
      sheet.append(
        h('p', { class: 'note' }, 'The Save Editor runs on another site, so browsers keep the two apart. In the Save Editor: Export → Copy share code. Then paste it here. Nothing is imported until you confirm.'),
        ta,
        h('div', { class: 'btns' }, h('button', { class: 'btn go', onclick: read }, 'Read'), h('button', { class: 'btn', onclick: back }, 'Cancel')),
        err,
      );
      setDesc('Paste a share code from the Save Editor.');
      return;
    }
    const { sh, doc: d, match } = v.preview;
    const sc = [...d.index.byId.values()].filter((n) => n.children && isSugarCubeSaveNode(n)).map((n) => resolveSugarCubeSave(n)).filter(Boolean)[0];
    const visible = d.menu.all.filter((e) => e.category !== 'internal').length;
    sheet.append(
      h('dl', { class: 'kv' },
        h('dt', null, 'Save'), h('dd', null, sh.name),
        h('dt', null, 'Format'), h('dd', null, d.engine.name),
        h('dt', null, 'Variables'), h('dd', null, `${visible} (of ${d.index.byId.size} fields)`),
        sc ? [h('dt', null, 'Current moment'), h('dd', null, `${sc.index + 1} of ${sc.total} (${sc.encoding === 'delta' ? 'delta-encoded history, resolved like SugarCube' : 'history'}; ${sc.indexNote})`)] : null,
        sh.at ? [h('dt', null, 'Shared'), h('dd', null, new Date(sh.at).toLocaleString())] : null,
      ),
      h('div', { class: 'warnbox' }, 'These values are a copy of the save, not the running game. They are listed as SAVE · IMPORTED. Editing them never changes the game until you export them or write them into the game’s matching save.'),
      match ? h('div', { class: 'okbox' }, `Matching save in this game: ${hub?.provider?.sourceOf(match.storageId) || match.storageId} — ${match.how}. Edits can be written into it (verified, with a backup).`) : h('p', { class: 'note' }, 'No identical save was found in this game’s storage, so edits can only be exported (file or share code).'),
      h('div', { class: 'btns' }, h('button', { class: 'btn go', onclick: () => confirmImport(v.preview) }, 'Import as SAVE variables'), h('button', { class: 'btn', onclick: () => ((v.preview = null), renderAll()) }, 'Back')),
    );
    setDesc('Check the save, then confirm the import.');
  }
  async function confirmImport(pv) {
    const p = new ImportedProvider(pv.doc, { shared: pv.sh.shared, at: pv.sh.at, original: pv.sh.input, match: pv.match });
    try {
      await store?.addBackup?.({ kind: 'imported', title: `Imported ${pv.doc.name}`, name: pv.doc.name, original: typeof pv.sh.input === 'string' ? pv.sh.input : null });
    } catch {
      /* backup list unavailable: the original stays downloadable from Export */
    }
    const src = { id: 'imported', label: `Imported: ${pv.doc.name}`, channel: 'file', create: async () => p };
    S.providers.delete('imported');
    const i = opts.sources.findIndex((x) => x.id === 'imported');
    if (i >= 0) opts.sources.splice(i, 1, src);
    else opts.sources.push(src);
    renderSources();
    await selectSource('imported');
    toast(`Imported ${pv.doc.name}: SAVE values, not live`);
  }
  function renderImportExport() {
    const p = S.provider;
    if (!p?.imported) return back();
    const match = p.meta.match || matchImported(p.doc, hub?.provider);
    const sheet = h(
      'div',
      { class: 'sheet' },
      h('h2', null, `Export ${p.pendingCount()} change(s)`),
      h('ul', null, p.session.diff().slice(0, 40).map((d) => h('li', null, `${p.entryById.get(d.id)?.label || d.node.key}: ${show(d.before)} → ${show(d.after)}`))),
      h('div', { class: 'btns' },
        h('button', { class: 'btn go', onclick: () => exportImported('file') }, 'Download edited save'),
        h('button', { class: 'btn', onclick: () => exportImported('share') }, 'Copy share code for the Save Editor'),
        h('button', { class: 'btn', onclick: () => downloadBytes(typeof p.meta.original === 'string' ? new TextEncoder().encode(p.meta.original) : p.meta.original, `${p.doc.name}.original`) }, 'Download original'),
      ),
      h('p', { class: 'note' }, 'Both are re-decoded and verified before you get them.'),
      h('h3', null, 'Write into the game’s save'),
      match && hub?.provider
        ? h('div', null, h('p', { class: 'note' }, `Verified destination: ${hub.provider.sourceOf(match.storageId)} — ${match.how}. The changes are added to the game’s save as pending edits; then use Write saves (verified, with a backup).`), h('div', { class: 'btns' }, h('button', { class: 'btn warn', onclick: () => transferImported(match) }, 'Add to the game’s save')))
        : h('p', { class: 'note' }, 'Not available: no save in this game’s storage is verifiably the same save (same SugarCube story id and save date, or identical data). Export instead.'),
    );
    bodyEl.append(sheet);
    setDesc('Imported save edits: export them, or write them into the matching game save.');
  }
  async function exportImported(how) {
    const p = S.provider;
    try {
      const out = await p.session.export();
      if (!out.validation.ok) throw new Error(`Verification failed: ${out.validation.problems.slice(0, 2).join('; ')}`);
      if (how === 'file') {
        downloadBytes(typeof out.bytes === 'string' ? new TextEncoder().encode(out.bytes) : out.bytes, out.filename || p.doc.name);
        toast('Edited save downloaded (verified)');
      } else {
        const code = encodeShare({ name: out.filename || p.doc.name, input: out.bytes, engine: p.doc.engine.id });
        try {
          await win.navigator.clipboard.writeText(code);
          toast('Share code copied: paste it into the Save Editor (Paste save text)');
        } catch {
          const ta = h('textarea', { class: 'field report', readonly: 'readonly' });
          ta.value = code;
          bodyEl.append(h('div', { class: 'sheet' }, h('h3', null, 'Share code'), ta));
          ta.select();
        }
      }
    } catch (e) {
      toast(e.message, true);
    }
  }
  async function transferImported(match) {
    const p = S.provider;
    const sp = hub?.provider;
    if (!sp) return toast('The game’s saves are not available', true);
    const { changes, skipped } = match.transfer(p.session.edits);
    if (!changes.length) return toast('None of these edits are in the current moment of the game’s save', true);
    if (!win.confirm(`Add ${changes.length} change(s) to the game’s save ${sp.sourceOf(match.storageId)}?${skipped.length ? ` (${skipped.length} edit(s) of older moments are skipped)` : ''} They stay pending until you tap Write saves.`)) return;
    try {
      sp.set(changes.map((c) => ({ id: c.id, value: typeof c.value === 'number' ? String(c.value) : c.value })), 'From imported save');
      toast(`${changes.length} change(s) added to the game’s save: Write saves to keep them`);
      await selectSource(opts.sources.find((x) => x.id === 'storage') ? 'storage' : S.sourceId);
      push({ type: 'apply' });
    } catch (e) {
      toast(e.message, true);
    }
  }

  /** SugarCube resumes its session state on reload: say so before an Apply & Reload of SugarCube saves. */
  function sugarCubeReloadWarning(sp) {
    if (!sp?.diff) return null;
    const touchesSugarCube = sp.diff().some((d) => /\/state\/(delta|history)\//.test(d.id));
    if (!touchesSugarCube) return null;
    const sc = readSugarCubeStorage(win);
    if (!sc.session) return null;
    return h(
      'div',
      { class: 'badbox' },
      h('b', null, 'SugarCube does not load saves on a page reload. '),
      'A reload resumes the running game from its session state, so edits written into the autosave or a slot are not loaded — and the next autosave writes the old values back (money reverts). Use the SugarCube save workflow: write to a manual slot, then load it from the game’s Saves menu.',
      h('div', { class: 'btns' }, h('button', { class: 'btn go', onclick: () => openScSave() }, 'Use the SugarCube save workflow')),
    );
  }

  async function doWriteNow() {
    try {
      toast('Verifying and writing…');
      const r = hub && savesOf() === hub.provider ? await hub.writeNow() : await savesOf().applyAndReload({ reload: false });
      toast(`✓ Saves written (${r.written} item(s)) and verified. The game uses them the next time it loads.`);
      back();
    } catch (e) {
      applyFailed(e);
    }
  }
  async function doExport() {
    try {
      const bytes = hub && savesOf() === hub.provider ? await hub.exportEdited() : (await savesOf().session.export()).bytes;
      const host = (() => {
        try {
          return win.location.hostname || 'game';
        } catch {
          return 'game';
        }
      })();
      downloadBytes(bytes, `${host}-saves-edited.json`);
      toast('Edited saves exported (verified)');
    } catch (e) {
      toast(e.message, true);
    }
  }
  function downloadBytes(bytes, name) {
    const url = win.URL.createObjectURL(new win.Blob([bytes], { type: 'application/json' }));
    const a = doc.createElement('a');
    a.href = url;
    a.download = name;
    doc.body.append(a);
    a.click();
    win.setTimeout(() => (win.URL.revokeObjectURL(url), a.remove()), 4000);
  }

  async function doApply() {
    try {
      toast('Verifying and writing…');
      await savesOf().applyAndReload({ reload: true });
    } catch (e) {
      applyFailed(e);
    }
  }
  function applyFailed(e) {
    clear(bodyEl).append(
      h(
        'div',
        { class: 'sheet' },
        h('h2', null, 'Nothing was written'),
        h('div', { class: 'badbox' }, e.message),
        h('div', { class: 'btns' }, h('button', { class: 'btn go', onclick: () => reread() }, 'Re-read storage'), h('button', { class: 'btn', onclick: back }, 'Back')),
      ),
    );
  }

  async function reread() {
    if (hub) {
      await hub.sync({ force: true, discard: true });
      S.stack = [{ type: 'home' }];
      renderAll();
      toast('Saves re-read');
      return;
    }
    S.providers.delete(S.sourceId);
    await selectSource(S.sourceId);
  }
  /** Sync save variables: re-run the Save Editor's discovery on the game's saves. */
  async function syncSaves() {
    if (!hub) return;
    toast('Reading the game’s saves…');
    const r = await hub.sync({ force: true });
    const p = S.provider;
    const n = savesOf(p)?.entries.length || 0;
    const linked = p?.saveLinks ? p.saveLinks.size : 0;
    if (r.stale) toast('The game saved new progress, but save edits are pending: write or discard them first (Write saves screen)', true);
    else toast(`Save variables synced: ${n} from the saves${p?.kind === 'live' ? `, ${linked} linked to live variables` : ''}`);
    renderAll();
  }

  // ---------- backups
  async function renderBackups() {
    const p = S.provider;
    const sheet = h('div', { class: 'sheet' }, h('h2', null, 'Backups & restore'));
    bodyEl.append(sheet);
    if (p.kind === 'live') {
      const n = p.touched.size;
      sheet.append(
        h('p', null, `Live edits change the game’s memory. The value of every variable before the trainer first changed it is remembered (${n} so far) and stored in this browser.`),
        h('div', { class: 'btns' }, h('button', { class: 'btn warn', onclick: () => (n && confirmRestoreLive()) }, `Restore ${n} original value(s)`)),
        h('p', { class: 'note' }, 'Undo/redo work step by step from the toolbar. Nothing is saved to the game until you save in-game.'),
      );
    } else if (p.kind === 'file') {
      sheet.append(h('p', null, 'The original file is backed up automatically in SaveForge (Analyze tab) and can be downloaded from the Export screen. Use Undo, Revert or Reset to go back.'));
    }
    const sp = savesOf(p);
    const bstore = sp?.store || p.store || store;
    if (bstore) {
      const list = (await bstore.backups()).filter((b) => b.kind === 'storage');
      if (sp) sheet.append(h('h3', null, 'Save snapshots (taken before every save write)'));
      if (sp && !list.length) sheet.append(h('p', { class: 'note' }, 'None yet. A snapshot is stored automatically before anything is written.'));
      if (sp) {
        for (const b of list.slice(0, 10)) {
          sheet.append(
            h(
              'div',
              { class: 'okbox' },
              h('b', null, new Date(b.savedAt).toLocaleString()),
              ` · ${b.changes?.length || 0} change(s) were applied after it`,
              h(
                'div',
                { class: 'btns' },
                h('button', { class: 'btn warn', onclick: () => confirmRestoreStorage(b) }, 'Restore & reload'),
                h('button', { class: 'btn', onclick: () => downloadJson(b.dump, `saveforge-backup-${b.savedAt}.json`) }, 'Download'),
              ),
            ),
          );
        }
      }
    }
    setDesc('Backups are kept in this browser (separate from the game’s own data).');
  }

  function confirmRestoreLive() {
    if (!win.confirm('Put every variable the trainer changed back to its original value?')) return;
    try {
      S.provider.restoreSessionStart();
      toast('Original values restored');
    } catch (e) {
      toast(e.message, true);
    }
  }

  function confirmRestoreStorage(b) {
    if (!win.confirm('Overwrite the game’s current storage with this snapshot and reload? Progress saved after it will be replaced.')) return;
    savesOf().restore(b).catch((e) => toast(e.message, true));
  }

  function downloadJson(obj, name) {
    const url = win.URL.createObjectURL(new win.Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }));
    const a = doc.createElement('a');
    a.href = url;
    a.download = name;
    doc.body.append(a);
    a.click();
    win.setTimeout(() => (win.URL.revokeObjectURL(url), a.remove()), 4000);
  }

  // ---------- diagnostics
  async function renderDiagnostics() {
    const sheet = h('div', { class: 'sheet' }, h('h2', null, 'Diagnostics'), h('p', { class: 'note' }, 'Reading…'));
    bodyEl.append(sheet);
    setDesc('What SaveForge found on this page and why.');
    let d;
    try {
      d = await opts.diagnostics();
    } catch (e) {
      clear(sheet).append(h('div', { class: 'badbox' }, e.message));
      return;
    }
    if (top().type !== 'diagnostics') return;
    const p = S.provider;
    const generic = p && p.engine && p.engine.id === 'generic' ? p.engine : null;
    const included = d.globals.filter((g) => g.kind === 'game');
    const excluded = d.globals.filter((g) => g.kind !== 'game');
    const gameFrame = d.frames.find((f) => f.share >= 25);
    clear(sheet).append(h(
      'div',
      null,
      h('h2', null, 'Diagnostics'),
      h('dl', { class: 'kv' }, h('dt', null, 'This frame'), h('dd', null, d.frame || '?'), h('dt', null, 'Address'), h('dd', null, d.href || '?'), h('dt', null, 'Script context'), h('dd', null, d.context ? `${d.context.world}: ${d.context.detail}` : '?')),
      d.context && d.context.world === 'isolated' ? h('div', { class: 'badbox' }, 'SaveForge is running in an isolated extension context, so it cannot see or change the game’s JavaScript. Edits would only change SaveForge’s own copy. In the Userscripts app make sure the script has “@inject-into page”, or use the trainer bookmarklet.') : null,
      !d.engines.some((e) => e.id !== 'generic') && !included.length && gameFrame
        ? h('div', { class: 'warnbox' }, `No game state was found on this page, but a large frame (${gameFrame.size}, ${gameFrame.share}% of the screen, from ${gameFrame.origin}) is probably the game. Its variables live in that frame — open the trainer there.`)
        : null,
      h('h3', null, 'Engines'),
      d.engines.length ? h('ul', null, d.engines.map((e) => h('li', null, h('b', null, e.name), ` — ${e.channel === 'live' ? 'live' : e.channel === 'live-generic' ? 'live (generic)' : e.channel}${e.evidence ? ` · ${e.evidence}` : ''}`))) : h('p', null, 'No supported engine globals on this page.'),
      d.limitations.length ? h('div', null, d.limitations.map((l) => h('div', { class: 'warnbox' }, h('b', null, l.name), ' — ', l.reason))) : null,
      d.sugarcube && (d.sugarcube.connected || d.sugarcube.verdict !== 'none') ? sugarCubeBlock(d.sugarcube) : null,
      perfBlock(),
      h('h3', null, `Frames on this page (${d.frames.length})`),
      d.frames.length
        ? d.frames.map((f) =>
            h(
              'div',
              { class: f.saveforge.startsWith('running · game') ? 'okbox' : 'warnbox' },
              h('b', null, f.origin), ` · ${f.size} (${f.share}% of screen) · ${f.sameOrigin ? 'same site' : 'other site'}`,
              h('div', { class: 'path' }, f.href),
              h('div', null, `SaveForge: ${f.saveforge}`),
              !f.sameOrigin && !/^running/.test(f.saveforge) ? h('div', { class: 'note' }, 'Safari does not let this page read another site’s frame. Allow your userscript manager on that frame’s site, or open the frame directly. Note: a game opened directly may use separate saves from the embedded one.') : null,
              f.actions.length ? h('div', { class: 'btns' }, f.actions.map((a) => h('button', { class: 'btn', onclick: () => { try { a.run(); } catch (e) { toast(e.message, true); } } }, a.label))) : null,
            ),
          )
        : h('p', null, 'No game-sized frames.'),
      detectionBlock(d, generic),
      opts.fullScan ? fullScanBlock(generic) : null,
      h('h3', null, `Page globals: ${included.length} game state, ${excluded.length} website/other`),
      h('p', { class: 'note' }, 'Whole objects are scored too, but they are only context: variables inside a website-looking object are still checked one by one above.'),
      included.length ? h('ul', null, included.slice(0, 40).map((g) => h('li', null, h('b', null, g.name), ` — score ${g.score}: ${g.reasons.join('; ')}`))) : null,
      excluded.length ? h('details', { class: 'excluded-globals' }, h('summary', null, `Excluded objects (${excluded.length})`), h('ul', null, excluded.slice(0, 80).map((g) => h('li', null, h('b', null, g.name), ` — ${g.kind}, score ${g.score}: ${g.reasons.join('; ')}`)))) : null,
      generic
        ? h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { generic.includeAll = !generic.includeAll; p.rescan(); toast(generic.includeAll ? 'Website globals included (advanced)' : 'Showing game state only'); } }, generic.includeAll ? 'Hide website globals' : 'Include website globals (advanced)'))
        : null,
    ));
  }

  /** Performance Diagnostics: what each stage cost, what was read, what runs in the background. */
  function perfBlock() {
    const pl = opts.perf;
    if (!pl) return null;
    const p = S.provider;
    const r = p?.engine?.scanReport?.();
    const mem = pl.memory();
    const hubR = hub ? hub.reads : null;
    const notRead = hub?.provider?.dump?.indexedDBNotRead || [];
    const skippedVals = hub?.provider?.dump?.skippedValues || 0;
    const last = pl.lastCompleted();
    const rows = [
      ['Profile', `${p?.engine?.profile?.name || '?'}${p?.engine?.profile ? ` · up to ${fmtNum(p.engine.profile.maxNodes)} values, ${p.engine.profile.depth} levels` : ''}${S.safe ? ' · Safe Mode' : ''}`],
      ['Last completed stage', last ? `${last.name} (${last.ms} ms)` : '—'],
      ['Running now', pl.current ? pl.current.name : 'nothing'],
      ['Values read', r ? `${fmtNum(r.count)}${r.truncated ? ' (limits reached)' : ''}${r.stopped ? ' (stopped by you)' : ''}` : p ? fmtNum(p.entries.length) : '—'],
      ['Variables listed', p ? fmtNum(p.entries.length) : '—'],
      ['Memory', mem ? `${mem.usedMB} MB JavaScript heap (limit ${mem.limitMB} MB)` : 'not available in this browser (Safari does not report it)'],
      ['Background', p?.kind === 'live' ? `${p.paused ? 'paused' : 'running'} · learning ${p.engine?.profile?.learnEveryMs ? `every ${p.engine.profile.learnEveryMs / 1000} s` : 'off'} · full re-scan at most every ${Math.round((p.relearnMinMs || 0) / 1000)} s` : '—'],
      ['Save reads', hubR ? `${hubR.count} read(s), last ${hubR.lastMs} ms, ${fmtNum(Math.round(hubR.lastBytes / 1024))} KB${hub.isPaused() ? ' · sync paused' : ''}` : '—'],
      ['Button Linker', linkerUI ? `${linkerUI.linker.listenerCount?.() ?? 0} page listeners` : 'not started'],
    ];
    return h(
      'div',
      { class: 'perfdiag' },
      h('h3', null, 'Performance'),
      h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      notRead.length ? h('div', { class: 'warnbox' }, `IndexedDB not read (to save memory): ${notRead.slice(0, 6).join(', ')}${notRead.length > 6 ? '…' : ''}.`, h('div', { class: 'btns' }, h('button', { class: 'btn mini', onclick: async () => { toast('Reading IndexedDB…'); await hub.readIndexedDB(); renderAll(); } }, 'Read IndexedDB saves'))) : null,
      skippedVals ? h('p', { class: 'note' }, `${skippedVals} large binary value(s) in storage were not read (over ${fmtNum(Math.round((hub.profile.maxBinary || 0) / 1024))} KB); they are never written back.`) : null,
      h('details', null, h('summary', null, `Stages (${pl.stages.length})`), h('ul', null, pl.stages.slice(-20).map((st) => h('li', null, `${st.name}: ${st.done ? `${st.ms} ms` : 'running…'}${st.nodes !== undefined ? ` · ${fmtNum(st.nodes)} values` : ''}${st.variables !== undefined ? ` · ${fmtNum(st.variables)} listed` : ''}${st.error ? ` · error: ${st.error}` : ''}`)))),
      p?.kind === 'live' && opts.deepScan ? h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => runDeepScan() }, 'Deep scan')) : null,
    );
  }

  /** Can the trainer reach the running SugarCube State, and why (not)? Plus an exact path lookup. */
  function sugarCubeBlock(sc) {
    const cls = sc.connected ? 'okbox' : ['not-started', 'frame', 'other-site-frame'].includes(sc.verdict) ? 'warnbox' : 'badbox';
    const label = { direct: 'Live: connected directly', bridge: 'Live: connected through the page bridge', frame: 'In a child frame', 'other-site-frame': 'Game in another site’s frame', 'not-started': 'Story not started yet', hidden: 'No public SugarCube API', blocked: 'Live access not possible', none: 'Not a SugarCube story' }[sc.verdict] || sc.verdict;
    const q = h('input', { class: 'field', type: 'search', value: 'player.money', autocapitalize: 'none', autocorrect: 'off', spellcheck: false, 'aria-label': 'State path' });
    const out = h('div', { class: 'sclookup' });
    const look = () => {
      clear(out);
      const r = sc.lookup(q.value);
      if (r.error) return void out.append(h('div', { class: 'badbox' }, r.error));
      const expr = `State.${r.path[0]}.${r.path.slice(1).join('.')}`;
      if (!r.found) return void out.append(h('div', { class: 'warnbox' }, `${expr} does not exist in the live State (checked in the current moment).`));
      const listed = S.provider?.entries?.find((e) => e.path === expr || e.path === `State.${r.path[0]}.${r.path.slice(1).join('.')}`);
      out.append(h('div', { class: 'okbox' }, h('b', null, expr), ` = ${typeof r.value === 'object' ? JSON.stringify(r.value).slice(0, 80) : String(r.value)} (${r.type}) — LIVE`, h('div', null, listed ? `In the trainer as ${listed.label}.` : 'Open the SugarCube source to edit it.')));
    };
    q.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), look(), q.blur()));
    return h(
      'div',
      null,
      h('h3', null, 'SugarCube'),
      h('div', { class: cls }, h('b', null, label), ' — ', sc.reason),
      sc.steps?.length ? h('ul', null, sc.steps.map((st) => h('li', null, `${st.ok ? '✓' : '✕'} ${st.text}`))) : null,
      h('div', { class: 'btns' }, q, h('button', { class: 'btn go', onclick: look }, 'Look up')),
      out,
      !sc.connected && sc.storage?.saves?.length ? h('div', { class: 'btns' }, h('button', { class: 'btn go', onclick: () => push({ type: 'scsave', fresh: true }) }, 'Edit SugarCube save')) : null,
    );
  }

  /**
   * Full scan: everything reachable, unclassified, compared with what the trainer lists.
   * Tells "not reached" (and why) apart from "reached but excluded" (and why).
   */
  function fullScanBlock(generic) {
    const out = h('div', { class: 'fullscan' });
    const q = h('input', { class: 'field', type: 'search', inputmode: 'search', enterkeyhint: 'search', placeholder: 'A value you see (e.g. 28480799) or a name', autocapitalize: 'none', autocorrect: 'off', spellcheck: false, 'aria-label': 'Find in full scan' });
    let scan = null;
    const run = async () => {
      clear(out).append(h('p', { class: 'note' }, 'Scanning everything reachable…'));
      try {
        scan = await opts.fullScan([...S.providers.values()].filter((p) => p.kind === 'live' && p.engine?.id !== 'raw'));
      } catch (e) {
        clear(out).append(h('div', { class: 'badbox' }, `Full scan failed: ${e.message}`));
        return;
      }
      show();
    };
    const sugarEquiv = (id) => (id.startsWith('$/SugarCube.State.variables/') ? `$/state/history/0/variables/${id.slice(28)}` : id.startsWith('$/SugarCube.setup/') ? `$/setup/${id.slice(18)}` : id);
    const rootOf = (id) => (id.split('/')[1] || '').replace(/~1/g, '/').replace(/~0/g, '~');
    const statusOf = (leaf) => {
      const gl = new Map((scan.generic?.leaves || []).map((l) => [l.id, l]));
      if (scan.listed.has(leaf.id) || scan.listed.has(sugarEquiv(leaf.id))) {
        const g = gl.get(leaf.id);
        return { cls: 'okbox', text: g ? `Listed (${g.tier === 'potential' ? 'potential game variable' : g.tier === 'text' ? 'text' : 'game variable'}, confidence ${g.score})` : 'Listed by the engine source' };
      }
      const g = gl.get(leaf.id);
      if (g) return { cls: 'warnbox', text: `Reached but excluded by classification (confidence ${g.score}): ${g.reasons.join('; ') || 'no game evidence'}`, mark: leaf.id };
      const root = rootOf(leaf.id);
      const gr = scan.generic?.report?.roots?.[root];
      let why;
      if (scan.special.includes(root)) why = 'reached through the engine’s own getter; the engine source lists it under its own path';
      else if (!scan.generic) why = 'no classified scan on this page';
      else if (!gr) why = 'this global is not walked by the classified scan (a known library, analytics/ad or engine global)';
      else if (gr.cut) why = 'the classified scan’s budget for this global ran out before this value';
      else if (gr.depthLimited) why = 'deeper than the classified scan goes in this global';
      else if (leaf.type === 'string' && gr.skippedStrings) why = 'text limit for this global reached';
      else why = 'not reached by the classified scan';
      return { cls: 'badbox', text: `Not reached by the classified scan: ${why}. It is in “All variables (raw)”.` };
    };
    const show = () => {
      const r = scan.report || { roots: {}, getters: [], gettersCount: 0, depthLimited: 0, skipped: {}, keys: [] };
      const gIds = new Set((scan.generic?.leaves || []).map((l) => l.id));
      const notReached = scan.leaves.filter((l) => !gIds.has(l.id) && !scan.listed.has(l.id) && !scan.listed.has(sugarEquiv(l.id)));
      const byRoot = new Map();
      for (const l of notReached) byRoot.set(rootOf(l.id), (byRoot.get(rootOf(l.id)) || 0) + 1);
      const cuts = Object.entries(r.roots).filter(([, v]) => v.cut || v.skippedStrings || v.depthLimited);
      const lex = scan.lexical || { names: [], unprobed: [], blocked: '', files: [], failed: [] };
      const skipped = Object.entries(r.skipped || {});
      const genericCuts = Object.entries(scan.generic?.report?.roots || {}).filter(([, v]) => v.cut);
      clear(out).append(
        h('dl', { class: 'kv' },
          h('dt', null, 'Reached'), h('dd', null, `${scan.leaves.length} values in ${r.keys.length} globals${lex.names.length ? ` (incl. ${lex.names.length} script variable(s))` : ''}${scan.special.length ? ` + ${scan.special.join(', ')}` : ''}`),
          h('dt', null, 'Listed'), h('dd', null, `${scan.listed.size} in the trainer’s sources`),
          h('dt', null, 'Excluded'), h('dd', null, `${(scan.generic?.leaves || []).filter((l) => l.tier === 'excluded').length} reached but classified as website/other`),
          h('dt', null, 'Not reached'), h('dd', null, `${notReached.length} only reachable in the full scan`),
        ),
        genericCuts.length ? h('div', { class: 'warnbox' }, `Classified scan budget ran out in: ${genericCuts.map(([k]) => k).join(', ')}.`) : null,
        notReached.length ? h('details', null, h('summary', null, `Only in the full scan, by global (${byRoot.size})`), h('ul', null, [...byRoot].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => h('li', null, h('b', null, k), ` — ${n} value(s)`)))) : null,
        h('h3', null, 'What could not be reached'),
        h('ul', null, [
          h('li', null, `${r.gettersCount} getter propert${r.gettersCount === 1 ? 'y' : 'ies'} (never called)${r.getters.length ? `: ${r.getters.slice(0, 8).map((g) => g.slice(2).replace(/\//g, '.')).join(', ')}${r.getters.length > 8 ? '…' : ''}` : ''}`),
          skipped.length ? h('li', null, `Map/Set/typed-array containers skipped: ${skipped.map(([k, n]) => `${n} ${k}`).join(', ')}`) : null,
          r.depthLimited ? h('li', null, `${r.depthLimited} object(s) deeper than 12 levels`) : null,
          cuts.length ? h('li', null, `Limits hit: ${cuts.slice(0, 6).map(([k, v]) => `${k} (${v.cut ? 'size limit' : ''}${v.skippedStrings ? `${v.skippedStrings} texts skipped` : ''}${v.depthLimited ? ' depth' : ''})`).join(', ')}`) : null,
          h('li', null, lex.blocked ? `Script-level let/const variables: blocked by the page’s security policy (${lex.blocked.slice(0, 80)}). ${lex.unprobed.length} name(s) could not be checked.` : `Script-level let/const variables: ${lex.names.length ? lex.names.map((x) => x.name).slice(0, 10).join(', ') : 'none found'}${lex.files.length ? ` (read ${lex.files.length} script file(s))` : ''}`),
          h('li', null, 'Never reachable from a web page: variables inside functions (closures), ES modules, WebAssembly memory, Web Workers, other sites’ frames, and server-side state.'),
        ]),
        h('h3', null, 'Look up a value or name'),
        h('div', { class: 'btns' }, q, h('button', { class: 'btn go', onclick: lookup }, 'Find')),
        h('div', { class: 'lookup' }),
      );
      q.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), lookup(), q.blur()));
    };
    const norm = (x) => String(x).replace(/[\s  ,']/g, '');
    function lookup() {
      const box = out.querySelector('.lookup');
      if (!box || !scan) return;
      const raw = q.value.trim();
      if (!raw) return;
      const n = norm(raw);
      const asNum = /^-?\d+(\.\d+)?$/.test(n) ? Number(n) : null;
      const lower = raw.toLowerCase();
      const hits = scan.leaves.filter((l) => (asNum !== null && typeof l.value === 'number' && (l.value === asNum || Math.round(l.value) === asNum)) || (typeof l.value === 'string' && l.value === raw) || l.path.toLowerCase().includes(lower)).slice(0, 30);
      clear(box);
      if (!hits.length) {
        box.append(h('div', { class: 'badbox' }, `“${raw}” is not in any variable SaveForge can reach. The game keeps it somewhere a web page cannot read (inside functions, a module, WebAssembly, a worker, another frame or a server), or the screen shows a formatted/derived number. Try Find a value with a smaller number you can change.`));
        return;
      }
      for (const l of hits) {
        const st = statusOf(l);
        box.append(
          h('div', { class: st.cls }, h('b', null, l.path), ` = ${typeof l.value === 'string' ? JSON.stringify(l.value.slice(0, 40)) : l.value}`, h('div', null, st.text),
            st.mark && S.provider?.mark ? h('button', { class: 'btn mini', onclick: (ev) => { S.provider.mark(st.mark, 'game'); ev.target.textContent = '✓ Marked as game'; ev.target.disabled = true; } }, 'Mark as game') : null),
        );
      }
    }
    return h(
      'div',
      null,
      h('h3', null, 'Full scan (everything reachable)'),
      h('p', { class: 'note' }, 'Walks every variable a web page can reach, ignoring game/website classification, and compares it with what the trainer lists. Finds values that were never reached (and why) versus values that were reached but excluded.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: run }, 'Run full scan')),
      out,
    );
  }

  /** Per-variable detection: what was found, why zero, and what was excluded (with a way to correct it). */
  function detectionBlock(d, generic) {
    const det = d.detection || { available: false, leaves: [], counts: {} };
    const c = det.counts || {};
    const found = det.leaves.filter((l) => l.tier === 'game' || l.tier === 'potential');
    // array entries (asset lists, data tables) collapse into one row each so they do not bury the rest
    const excluded = [];
    const groups = new Map();
    for (const l of det.leaves) {
      if (l.tier !== 'excluded') continue;
      const m = /^(.*)\.(\d+)$/.exec(l.path);
      if (!m) {
        excluded.push(l);
        continue;
      }
      const g = groups.get(m[1]);
      if (g) g.n++;
      else {
        const row = { ...l, path: `${m[1]}[…]`, n: 1, group: true };
        groups.set(m[1], row);
        excluded.push(row);
      }
    }
    for (const g of groups.values()) if (g.n === 1) Object.assign(g, { path: g.path.replace('[…]', '[0]'), group: false });
    excluded.sort((a, b) => b.score - a.score);
    const others = d.engines.filter((e) => e.id !== 'generic');
    const isolated = d.context && d.context.world === 'isolated';
    let state;
    if (isolated) state = ['badbox', 'Game state inaccessible', 'SaveForge cannot reach the game’s JavaScript from an isolated context (see Script context above), so nothing can be detected here. This is not the same as the game having no state.'];
    else if (others.length) state = ['okbox', 'Game state accessible', `Connected to ${others.map((e) => e.name).join(', ')}.${found.length ? ` The generic detector also found ${found.length} variable(s).` : ''}`];
    else if (found.length) state = ['okbox', 'Game state accessible', `${c.game || 0} game variable(s) and ${c.potential || 0} potential one(s) found in the page’s JavaScript.`];
    else if (!det.available) state = ['warnbox', 'No game state detected', 'This page has no JavaScript globals of its own besides the browser’s. The game may keep its state privately (inside functions or modules), in WebAssembly, in a worker, in another frame (see Frames) or on a server. Try Find a value with a number you see on screen.'];
    else if (!det.leaves.length) state = ['warnbox', 'No game state detected', 'The page’s own globals contain no numbers, switches or text that could be game state (only functions, libraries or known website tools). The state is probably private, in WebAssembly, in a frame or on a server. Try Find a value.'];
    else state = ['warnbox', 'No game state detected', `${det.leaves.length} variable(s) were inspected, but none looked like game state. If one of the excluded variables below is really part of the game, open it and tap “Mark as game”: SaveForge remembers it for this website.`];
    const why = (l) => l.reasons.join('; ') || 'no evidence either way';
    const row = (l, btn) =>
      h(
        'li',
        null,
        h('b', null, l.path),
        ` — ${l.group ? `${l.n} entries, ` : ''}${l.tier === 'game' ? 'game' : l.tier === 'potential' ? 'potential' : l.tier}, confidence ${l.score}, source window.${l.global}: ${why(l)}`,
        btn,
      );
    const markBtn = (l) =>
      generic && !l.group
        ? h(
            'button',
            {
              class: 'btn mini',
              onclick: (ev) => {
                S.provider.mark(l.id, 'game');
                ev.target.textContent = '✓ Marked';
                ev.target.disabled = true;
                toast(`${l.path} marked as a game variable (remembered for this site)`);
              },
            },
            'Mark as game',
          )
        : null;
    return h(
      'div',
      null,
      h('h3', null, `Game variables: ${c.game || 0} confirmed, ${c.potential || 0} potential${c.text ? `, ${c.text} text` : ''} (${c.excluded || 0} excluded)`),
      h('div', { class: state[0] }, h('b', null, state[1]), ' — ', state[2]),
      h('p', { class: 'note' }, 'Every variable is judged on its own: its type, its name (translated if needed), the object around it, whether it changes while you play, whether its value is on screen and whether your edits worked. Website data (analytics, ads, page and site settings, URLs) stays hidden.'),
      found.length ? h('details', null, h('summary', null, `Detected (${found.length})`), h('ul', null, found.slice(0, 120).map((l) => row(l)))) : null,
      excluded.length ? h('details', { class: 'excluded-vars' }, h('summary', null, `Why was this excluded? (${c.excluded || 0} variables)`), h('ul', null, excluded.slice(0, 150).map((l) => row(l, markBtn(l))))) : null,
      det.leaves.length || d.globals.length
        ? h(
            'div',
            { class: 'btns' },
            h('button', { class: 'btn', onclick: () => copyReport(d) }, 'Copy detection report'),
          )
        : null,
      h('p', { class: 'note' }, 'Wrongly excluded or included? Copy the report (names, types and reasons only — no text values) and paste it into a bug report.'),
    );
  }
  function detectionReport(d) {
    const det = d.detection || { leaves: [], counts: {} };
    const lines = [
      `SaveForge ${opts.version || ''} detection report`.trim(),
      `Frame: ${d.frame || '?'}`,
      `Context: ${d.context ? d.context.world : '?'}`,
      `Engines: ${d.engines.map((e) => e.name).join(', ') || 'none'}`,
      `Limitations: ${d.limitations.map((l) => l.name).join(', ') || 'none'}`,
      `Counts: ${JSON.stringify(det.counts)}`,
      '',
      'Globals (object score):',
      ...d.globals.slice(0, 80).map((g) => `  ${g.name}: ${g.kind} ${g.score} — ${g.reasons.join('; ')}`),
      '',
      'Variables (tier, score, type, reasons):',
      ...det.leaves.slice(0, 400).map((l) => `  ${l.path} [${l.type}] ${l.tier} ${l.score} — ${l.reasons.join('; ')}`),
    ];
    // never include values: text could be personal, numbers are not needed to judge the detection
    return lines.join('\n');
  }
  async function copyReport(d) {
    const text = detectionReport(d);
    try {
      await win.navigator.clipboard.writeText(text);
      toast('Detection report copied');
    } catch {
      // clipboard blocked (permissions, iframe): show it so it can be selected manually
      const ta = h('textarea', { class: 'field report', readonly: 'readonly' });
      ta.value = text;
      bodyEl.append(h('div', { class: 'sheet' }, h('h3', null, 'Detection report'), h('p', { class: 'note' }, 'Select all and copy.'), ta));
      ta.focus();
      ta.select();
    }
  }

  // ---------- interrupted start → Safe Mode offer
  function renderStartupChoice() {
    const rec = S.status.choice;
    bodyEl.append(
      h(
        'div',
        { class: 'sheet' },
        h('h2', null, 'SaveForge did not finish starting last time'),
        h('div', { class: 'warnbox' }, `The last start on this tab stopped during “${rec.stage}” (${new Date(rec.at).toLocaleTimeString()}). The page may have run out of memory or been reloaded. This does not prove SaveForge caused it, but Safe Mode avoids the heavy steps.`),
        h('h3', null, 'Safe Mode'),
        h('ul', null, [h('li', null, 'No automatic scan: open a source when you want it (smallest limits).'), h('li', null, 'No save reading, no background learning or save sync, no Button Linker at start.'), h('li', null, 'Everything stays available on request.')]),
        h(
          'div',
          { class: 'btns' },
          h('button', { class: 'btn go', onclick: () => { opts.enterSafeMode?.(); S.safe = true; S.status = null; opts.onReady?.(); renderSources(); renderAll(); toast('Safe Mode: tap a source above to scan it'); } }, 'Open in Safe Mode'),
          h('button', { class: 'btn', onclick: () => { S.status = null; selectSource(firstSource()); } }, 'Start normally'),
        ),
      ),
    );
    setDesc('Choose how to start.');
  }

  // ---------- about / limitations
  function limitationsBlock() {
    if (!opts.limitations?.length) return null;
    return h('div', null, h('h3', null, 'Detected engines that cannot be edited live'), opts.limitations.map((l) => h('div', { class: 'warnbox' }, h('b', null, l.name), ' — ', l.reason)));
  }
  function renderAbout() {
    const p = S.provider;
    bodyEl.append(
      h(
        'div',
        { class: 'sheet' },
        h('h2', null, p ? p.title : 'SaveForge trainer'),
        p ? h('p', null, p.note) : null,
        p?.truncated ? h('div', { class: 'warnbox' }, 'This game has a very large amount of data; only the first part was scanned.') : null,
        h('h3', null, 'Edit types'),
        h('ul', null, [
          h('li', null, h('b', null, 'Live'), ' — written into the running game’s memory; immediate.'),
          h('li', null, h('b', null, 'Live*'), ' — written into page globals found generically; the game may or may not read them.'),
          h('li', null, h('b', null, 'Apply & Reload'), ' — written to browser storage, then the page reloads.'),
          h('li', null, h('b', null, 'Saved edit'), ' — goes into an exported save file.'),
        ]),
        limitationsBlock(),
        h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: back }, 'Back')),
      ),
    );
    setDesc('');
  }

  // ---------- toolbar
  function renderTools() {
    clear(toolsEl);
    const p = S.provider;
    const tool = (icon, label, fn, disabled, cls) => h('button', { class: `tool${cls ? ` ${cls}` : ''}`, 'aria-label': label, disabled: !!disabled, onclick: fn }, ic(icon));
    toolsEl.append(
      tool('back', 'Back', back, S.stack.length < 2),
      tool('undo', 'Undo', () => p.undo(), !p || !p.canUndo()),
      tool('redo', 'Redo', () => p.redo(), !p || !p.canRedo()),
      tool('search', 'Search', () => (top().type === 'search' ? null : push({ type: 'search' })), !p),
      tool('refresh', 'Refresh values', () => refreshValues(), !p),
    );
    const sp = savesOf(p);
    if (sp && sp.pendingCount()) {
      toolsEl.append(h('button', { class: 'tool primary', onclick: () => push({ type: 'apply' }) }, p.kind === 'storage' ? 'Apply & Reload ' : 'Write saves ', h('span', { class: 'n' }, sp.pendingCount())));
    } else if (p && p.imported) {
      toolsEl.append(h('button', { class: 'tool primary', onclick: () => push({ type: 'impexport' }) }, 'Export ', h('span', { class: 'n' }, p.pendingCount())));
    } else if (p && p.kind === 'file' && opts.onExport) {
      toolsEl.append(h('button', { class: 'tool', style: 'flex:2', onclick: opts.onExport }, `Export${p.pendingCount() ? ` (${p.pendingCount()})` : ''}`));
    }
  }

  function refreshValues() {
    const p = S.provider;
    if (p?.kind === 'storage') return reread();
    if (listRefresh) listRefresh();
    renderAll();
    toast('Values re-read from the game');
  }

  // ---------- live value polling (values can change while the game runs)
  const poll = win.setInterval(() => {
    if (S.minimized || !S.provider || S.provider.kind !== 'live' || doc.hidden) return;
    const v = top();
    if ((v.type === 'list' || v.type === 'search' || v.type === 'home') && listRefresh) listRefresh();
  }, 1000);

  function short(v) {
    const s = v === null || v === undefined ? 'null' : String(v);
    return s.length > 18 ? s.slice(0, 17) + '…' : s;
  }
  function show(v) {
    if (typeof v === 'string') return JSON.stringify(v.length > 80 ? v.slice(0, 80) + '…' : v);
    return String(v);
  }
  function fmtNum(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return Math.abs(n) >= 1e15 ? n.toExponential(3) : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  // ---------- controller
  const ctl = {
    show() {
      setMinimized(false);
    },
    hide() {
      setMinimized(true);
    },
    destroy() {
      win.clearInterval(poll);
      linkerUI?.dispose();
      scSavesUI?.dispose();
      doc.removeEventListener('visibilitychange', syncPaused);
      for (const u of unsubs.splice(0)) u();
      // keep the scan results (paused) so reopening does not scan again, unless turned off
      const keep = S.providers.size && opts.keepOnClose ? opts.keepOnClose(new Map([...S.providers].filter(([k]) => k !== 'imported'))) : false;
      if (!keep) for (const pr of S.providers.values()) pr.dispose?.();
      host.remove();
      opts.onClose?.(keep);
    },
    provider: () => S.provider,
    /** New sources found after opening (e.g. a SugarCube story that started late). */
    addSources(list, { select = false, note = '' } = {}) {
      const added = [];
      for (const src of list) {
        if (opts.sources.some((x) => x.id === src.id)) continue;
        opts.sources.unshift(src);
        added.push(src);
      }
      if (!added.length) return;
      if (opts.engineInfoRefresh) opts.engineInfo = opts.engineInfoRefresh();
      renderSources();
      if (note) toast(note);
      const cur = S.provider;
      if (select && (!cur || cur.kind !== 'live' || !cur.touched?.size)) selectSource(added[0].id);
    },
    selectSource,
    root: shadow,
  };

  (async () => {
    const pos = store ? await store.get('pos', null) : null;
    if (pos?.panel?.[0]) Object.assign(panel.style, { left: pos.panel[0], top: pos.panel[1] });
    if (pos?.orb?.[0]) Object.assign(orb.style, { left: pos.orb[0], top: pos.orb[1], right: 'auto', bottom: 'auto' });
  })();
  renderSources();
  setMinimized(S.minimized);
  if (store && !opts.interrupted && !opts.safeMode?.()) getLinkerUI(); // saved Linker mappings apply only if the user chose "apply automatically"
  if (store) getScSavesUI(); // a SugarCube save written before a page reload is verified again
  if (opts.prefilled) {
    for (const [k, pr] of opts.prefilled) {
      if (!opts.sources.some((x) => x.id === k)) continue;
      S.providers.set(k, pr);
      listen(pr);
    }
  }
  const firstSource = () => ([...S.providers.keys()].find((k) => k !== 'raw') || (opts.sources.find((x) => x.id !== 'raw') || opts.sources[0]).id);
  if (opts.interrupted) {
    S.status = { choice: opts.interrupted };
    renderAll();
  } else if (opts.sources.length) {
    selectSource(firstSource()); // the unclassified raw scan only opens on request
  } else {
    S.status = { error: 'No editable game data was found on this page.' };
    renderAll();
  }
  return ctl;
}
