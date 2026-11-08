// SaveForge UI. All parsing/editing goes through src/core; this file only renders.

import { analyzeFile, EditSession } from '../core/document.js';
import { base64Decode } from '../core/bytes.js';
import { sliderRange } from '../core/modmenu.js';
import { formatValue } from '../core/model.js';
import { bookmarkletUrl, storageBridge } from '../bridge/storage-bridge.js';
import { backupOriginal, deleteBackup, listBackups } from './backups.js';
import { add, clear, displayValue, draggable, fmtBytes, h, icon } from './dom.js';
import { SAMPLES } from './sample-data.js';
import { openTrainer } from '../trainer/inject.js';
import { FileProvider } from '../trainer/providers.js';
import { createStore } from '../trainer/store.js';
import { mountTrainer } from '../trainer/ui.js';

// ---------------------------------------------------------------- state & prefs

const prefs = {
  get(k, d) {
    try {
      const v = localStorage.getItem(`saveforge.${k}`);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`saveforge.${k}`, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
};

const state = {
  doc: null,
  session: null,
  file: null, // {name, bytes|text}
  backup: null,
  tab: 'analyze',
  showInternal: prefs.get('showInternal', false),
  menuFilter: '',
  treeFilter: '',
  treeEditableOnly: false,
  openCats: new Set(),
  openTree: new Set(['$']),
  compare: null,
  panelOpen: false,
  frame: null,
  frameSameOrigin: false,
};

const registry = new Map(); // nodeId -> Set<() => void>
const views = {};
let mainEl;
let toolbarEl;
let tabbarEl;
let fabEl;
let trainerCtl = null;

const TABS = [
  ['analyze', 'Analyze', 'upload'],
  ['menu', 'Mod Menu', 'menu'],
  ['tree', 'Fields', 'tree'],
  ['changes', 'Changes', 'diff'],
  ['game', 'Game', 'game'],
];

// ---------------------------------------------------------------- boot

export function start(root) {
  clear(root);
  const app = h('div', { class: 'app' });
  toolbarEl = h('div', { class: 'docline' });
  const top = h(
    'header',
    { class: 'topbar' },
    h(
      'div',
      { class: 'brand' },
      h('div', { class: 'logo' }, icon('logo')),
      h('div', null, h('h1', null, 'SAVEFORGE'), h('small', null, 'Save analyzer · mod menu')),
      h('button', { class: 'btn icon small ghost', style: { marginLeft: 'auto' }, 'aria-label': 'Help and supported formats', onclick: () => showHelp() }, icon('info')),
    ),
    toolbarEl,
  );
  tabbarEl = h('nav', { class: 'tabbar', role: 'tablist' });
  mainEl = h('main', { class: 'main' });
  app.append(top, mainEl, tabbarEl);
  root.append(app);
  renderTabs();
  renderToolbar();
  show('analyze');

  window.addEventListener('keydown', (e) => {
    if (!state.session || e.target.closest('input, textarea')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) state.session.redo();
      else state.session.undo();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (state.session && state.session.edits.size) e.preventDefault();
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) openFile(f);
  });
}

function renderTabs() {
  clear(tabbarEl);
  for (const [id, label, ic] of TABS) {
    const count = id === 'changes' && state.session && state.session.edits.size ? h('span', { class: 'count' }, state.session.edits.size) : null;
    tabbarEl.append(
      h('button', { role: 'tab', 'aria-selected': String(state.tab === id), onclick: () => show(id) }, icon(ic), h('span', null, label), count),
    );
  }
}

function show(tab) {
  state.tab = tab;
  renderTabs();
  registry.clear();
  clear(mainEl);
  views[tab](mainEl);
  window.scrollTo({ top: 0 });
}

function rerender() {
  show(state.tab);
}

// ---------------------------------------------------------------- toolbar

function renderToolbar() {
  clear(toolbarEl);
  const { doc, session } = state;
  if (!doc) {
    toolbarEl.append(h('span', { class: 'muted', style: { fontSize: '13px' } }, 'Offline · nothing leaves this device'));
    return;
  }
  const n = session.edits.size;
  add(
    toolbarEl,
    h('div', { class: 'docinfo' }, h('span', { class: 'name', title: doc.name }, doc.name), h('span', { class: 'eng' }, doc.engine.name, n ? h('span', { class: 'edits' }, ` · ${n} change${n === 1 ? '' : 's'}`) : null)),
    h(
      'div',
      { class: 'toolbar' },
      h('button', { class: 'btn icon small', 'aria-label': 'Undo', disabled: !session.undoStack.length, onclick: () => session.undo() }, icon('undo')),
      h('button', { class: 'btn icon small', 'aria-label': 'Redo', disabled: !session.redoStack.length, onclick: () => session.redo() }, icon('redo')),
      h('button', { class: 'btn icon small', 'aria-label': 'Reset all changes', disabled: !n, onclick: () => confirmReset() }, icon('reset')),
      h('button', { class: 'btn primary small', onclick: () => exportFlow() }, icon('download'), 'Export'),
    ),
  );
}

function confirmReset() {
  if (!state.session.edits.size) return;
  if (confirm(`Discard all ${state.session.edits.size} change(s)? (You can still undo this.)`)) state.session.reset();
}

// ---------------------------------------------------------------- loading

async function openFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await load(file.name || 'save', bytes);
}

async function load(name, input) {
  if (state.session && state.session.edits.size && !confirm('Discard the current unsaved changes and open another file?')) return;
  toast('Analyzing…');
  const res = await analyzeFile(name, input);
  if (!res.ok) {
    state.doc = null;
    state.session = null;
    state.failure = res;
    renderToolbar();
    removeFloating();
    show('analyze');
    toast('Format not supported', true);
    return;
  }
  state.failure = null;
  state.doc = res.doc;
  state.file = { name, input };
  state.session = new EditSession(res.doc);
  state.backup = null;
  state.openCats = new Set(res.doc.menu.categories.filter((c) => !c.hiddenByDefault).slice(0, 2).map((c) => c.id));
  state.openTree = new Set(['$']);
  state.compare = null;
  state.session.on(onSessionChange);
  renderToolbar();
  closeTrainer();
  ensureFloating();
  show(res.doc.menu.stats.editable ? 'menu' : 'analyze');
  toast(`Decoded ${res.doc.index.byId.size} fields`);
}

async function onSessionChange(reason, ids) {
  if (!state.backup && state.session.edits.size) {
    // automatic backup before the first change
    const bytes = typeof state.file.input === 'string' ? new TextEncoder().encode(state.file.input) : state.file.input;
    state.backup = await backupOriginal(state.file.name, bytes, state.doc.engine.name).catch(() => null);
    if (state.backup) toast(state.backup.memoryOnly ? 'Backup kept in memory (storage unavailable)' : 'Original backed up automatically');
  }
  renderToolbar();
  renderTabs();
  const all = reason === 'reset' || ids.length > 30;
  for (const [id, fns] of registry) if (all || ids.includes(id)) for (const fn of fns) fn();
  if (state.tab === 'changes') rerender();
  if (fabEl) updateFabCount();
}

function register(id, fn) {
  if (!registry.has(id)) registry.set(id, new Set());
  registry.get(id).add(fn);
}

// ---------------------------------------------------------------- analyze view

views.analyze = (el) => {
  const { doc } = state;
  if (doc) {
    el.append(formatCard(doc));
    el.append(importGuideCard(doc));
  }
  el.append(importCard(!!doc));
  if (state.failure) el.prepend(failureCard(state.failure));
  const backups = h('div', { class: 'card' }, h('h2', null, 'Backups on this device'), h('div', { class: 'muted' }, 'Loading…'));
  el.append(backups);
  listBackups().then((list) => renderBackups(backups, list));
};

function importCard(compact) {
  const input = h('input', { type: 'file', class: 'hidden', onchange: (e) => e.target.files[0] && openFile(e.target.files[0]) });
  const drop = h(
    'label',
    { class: 'drop', style: compact ? { padding: '18px 16px' } : null },
    compact ? null : icon('upload', 'big'),
    h('div', { style: { fontWeight: 700, fontSize: '17px' } }, compact ? 'Open another save' : 'Import a save file'),
    compact ? null : h('p', null, '.save, .rpgsave, .rmmzsave, .json, .txt, .zip, persistent, storage exports… Detection is by content, not extension.'),
    h('span', { class: 'btn primary' }, icon('upload'), 'Choose file'),
    input,
  );
  drop.addEventListener('dragenter', () => drop.classList.add('over'));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', () => drop.classList.remove('over'));

  const ta = h('textarea', { class: 'input', placeholder: 'Paste a save string (e.g. a localStorage value or an exported save code)…', spellcheck: false, autocapitalize: 'off' });
  const paste = h(
    'details',
    { class: 'group' },
    h('summary', null, icon('paste'), 'Paste save text'),
    h(
      'div',
      { class: 'gbody' },
      ta,
      h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: () => ta.value.trim() && load('pasted-save.txt', ta.value) }, 'Analyze text')),
    ),
  );
  const samples = h(
    'details',
    { class: 'group' },
    h('summary', null, icon('star'), 'Try a sample save'),
    h(
      'div',
      { class: 'gbody' },
      h('p', { class: 'muted', style: { marginTop: 0, fontSize: '13px' } }, 'Synthetic test saves generated with the same libraries/encodings the engines use.'),
      ...SAMPLES.map((s) => h('button', { class: 'btn small', style: { margin: '0 6px 6px 0' }, onclick: () => load(s.name, base64Decode(s.data)) }, s.label)),
    ),
  );
  return h('div', { class: 'card' }, drop, h('div', { style: { height: '10px' } }), paste, samples);
}

function failureCard(f) {
  return h(
    'div',
    { class: 'card' },
    h('h2', null, `Could not decode “${f.name}”`),
    h('div', { class: 'notice bad' }, 'No supported format was found, so nothing is shown rather than guessing. Here is what was checked:'),
    h('ul', { class: 'clean' }, f.reasons.map((r) => h('li', null, r))),
    h(
      'p',
      { class: 'muted', style: { fontSize: '13px' } },
      'Many games encrypt or use custom binary formats; those cannot be edited safely without game-specific knowledge. If the game runs in the browser, try exporting its storage with the Storage Bridge (Game tab).',
    ),
  );
}

function formatCard(doc) {
  const size = typeof doc.input === 'string' ? doc.input.length : doc.input.length;
  const layers = doc.chain.describe().split(' › ');
  const ro = [...doc.index.byId.values()].filter((n) => n.meta.readOnlyReason && !n.children);
  const reasons = [...new Set(ro.map((n) => n.meta.readOnlyReason))];
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'row' }, h('h2', { class: 'grow', style: { margin: 0 } }, doc.engine.name), h('span', { class: 'pill ok' }, icon('check'), 'Decoded')),
    h('div', { class: 'chain', style: { margin: '12px 0' } }, layers.map((l, i) => [i ? h('i', null, '›') : null, h('span', null, l)])),
    h(
      'dl',
      { class: 'kv' },
      h('dt', null, 'File'),
      h('dd', null, `${doc.name} · ${fmtBytes(size)}`),
      h('dt', null, 'Fields'),
      h('dd', null, `${doc.index.byId.size} decoded · ${doc.menu.stats.editable} editable · ${doc.menu.stats.hidden} engine-internal`),
      ...doc.engine.details.slice(0, 4).flatMap((d) => [h('dt', null, '•'), h('dd', null, d)]),
    ),
    doc.warnings.map((w) => h('div', { class: 'notice warn' }, w)),
    reasons.map((r) => h('div', { class: 'notice warn' }, icon('lock'), ' ', r)),
    h(
      'div',
      { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn primary', onclick: () => show('menu') }, icon('menu'), 'Open mod menu'),
      h('button', { class: 'btn', onclick: () => show('tree') }, icon('tree'), 'Inspect all fields'),
    ),
  );
}

function importGuideCard(doc) {
  return h(
    'div',
    { class: 'card' },
    h('h2', null, 'Putting the edited save back'),
    h('ol', { class: 'steps' }, doc.engine.importGuide.map((s) => h('li', null, s))),
    h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Always keep the backup. The exported file keeps the original file name so it can replace the original.'),
  );
}

function renderBackups(card, list) {
  clear(card).append(h('h2', null, 'Backups on this device'));
  if (!list.length) {
    card.append(h('p', { class: 'muted', style: { margin: 0 } }, 'An untouched copy of a save is stored here automatically the first time you change it.'));
    return;
  }
  for (const b of list.slice(0, 12)) {
    card.append(
      h(
        'div',
        { class: 'diff' },
        h('div', null, h('b', null, b.name), h('div', { class: 'crumbs' }, `${new Date(b.savedAt).toLocaleString()} · ${fmtBytes(b.size)} · ${b.engine || ''}${b.memoryOnly ? ' · memory only' : ''}`)),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn small', onclick: () => download(b.bytes, b.name) }, icon('download')),
          h('button', { class: 'btn small', onclick: () => load(b.name, b.bytes) }, 'Open'),
          h('button', { class: 'btn small ghost', 'aria-label': 'Delete backup', onclick: async () => (await deleteBackup(b.id), renderBackups(card, await listBackups())) }, icon('close')),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------- mod menu

views.menu = (el) => {
  if (!needDoc(el)) return;
  el.append(modMenu(false));
};

function modMenu(compact) {
  const { doc } = state;
  const wrap = h('div');
  const list = h('div');
  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: `Search ${doc.menu.stats.editable} variables…`,
    value: state.menuFilter,
    autocapitalize: 'off',
    autocorrect: 'off',
    oninput: (e) => {
      state.menuFilter = e.target.value;
      fill();
    },
  });
  const internal = h('label', { class: 'row', style: { gap: '8px', fontSize: '13px', color: 'var(--muted)' } }, switchEl(state.showInternal, (v) => {
    state.showInternal = v;
    prefs.set('showInternal', v);
    fill();
  }), 'Engine internals');

  if (!doc.menu.stats.editable) {
    wrap.append(
      h(
        'div',
        { class: 'empty' },
        icon('lock'),
        h('p', null, 'No editable variables in this file.'),
        h('p', { class: 'muted', style: { fontSize: '13px' } }, [...new Set([...doc.index.byId.values()].map((n) => n.meta.readOnlyReason).filter(Boolean))][0] || 'Everything decoded is read-only.'),
      ),
    );
    return wrap;
  }

  add(wrap, h('div', { class: 'menu-head' }, h('div', { class: 'search grow' }, icon('search'), search), compact ? null : internal), compact ? h('div', { style: { margin: '-4px 0 10px' } }, internal) : null, list);

  function fill() {
    clear(list);
    const q = state.menuFilter.trim().toLowerCase();
    const match = (e) => !q || e.label.toLowerCase().includes(q) || e.path.toLowerCase().includes(q);
    let shown = 0;
    for (const cat of doc.menu.categories) {
      if (cat.hiddenByDefault && !state.showInternal && !q) continue;
      const entries = cat.entries.filter(match);
      const groups = cat.groups.map((g) => ({ ...g, entries: g.entries.filter(match) })).filter((g) => g.entries.length);
      const count = entries.length + groups.reduce((n, g) => n + g.entries.length, 0);
      if (!count) continue;
      shown += count;
      const open = !!q || state.openCats.has(cat.id);
      const det = h('details', { class: 'cat', open });
      const body = h('div', { class: 'body' });
      const renderBody = () => {
        if (body.dataset.filled) return;
        body.dataset.filled = '1';
        for (const g of groups) body.append(groupEl(g, q));
        renderEntries(body, entries, 80);
      };
      det.append(
        h('summary', null, h('span', { class: 'ico' }, icon(cat.icon)), h('span', { class: 'title' }, cat.name), h('span', { class: 'n' }, count), icon('chev', 'chev')),
        body,
      );
      det.addEventListener('toggle', () => {
        if (det.open) {
          state.openCats.add(cat.id);
          renderBody();
        } else state.openCats.delete(cat.id);
      });
      if (open) renderBody();
      list.append(det);
    }
    if (!shown) list.append(h('div', { class: 'empty' }, icon('search'), h('p', null, q ? 'No variables match.' : 'Only engine internals here — turn on “Engine internals” to see them.')));
  }
  fill();
  return wrap;
}

function renderEntries(container, entries, pageSize) {
  let i = 0;
  const more = h('button', { class: 'btn small more', onclick: () => page() });
  const page = () => {
    more.remove();
    for (const e of entries.slice(i, i + pageSize)) container.append(control(e));
    i += pageSize;
    if (i < entries.length) {
      more.textContent = `Show ${Math.min(pageSize, entries.length - i)} more (${entries.length - i} left)`;
      container.append(more);
    }
  };
  page();
}

function groupEl(g, q) {
  const det = h('details', { class: 'group', open: !!q });
  const body = h('div', { class: 'gbody' });
  const filter = h('input', { class: 'input', type: 'search', placeholder: `Filter ${g.entries.length}…`, autocapitalize: 'off' });
  const listEl = h('div');
  const bulk = g.entries.every((e) => e.type === 'bool')
    ? h(
        'div',
        { class: 'row', style: { margin: '8px 0' } },
        h('button', { class: 'btn small', onclick: () => bulkSet(g.entries, true) }, 'All on'),
        h('button', { class: 'btn small', onclick: () => bulkSet(g.entries, false) }, 'All off'),
      )
    : g.entries.every((e) => e.type === 'int' || e.type === 'float')
      ? h('div', { class: 'row', style: { margin: '8px 0' } }, h('button', { class: 'btn small', onclick: () => bulkPrompt(g.entries) }, 'Set all to…'))
      : null;
  const fill = () => {
    clear(listEl);
    const f = filter.value.trim().toLowerCase();
    renderEntries(listEl, g.entries.filter((e) => !f || e.label.toLowerCase().includes(f) || String(state.session.value(e.nodeId)).toLowerCase().includes(f)), 40);
  };
  filter.addEventListener('input', fill);
  det.append(h('summary', null, icon('hash'), g.label, h('span', { class: 'dim', style: { marginLeft: 'auto', fontWeight: 400 } }, g.entries.length)), body);
  add(body, filter, bulk, listEl);
  let filled = false;
  const onOpen = () => {
    if (det.open && !filled) {
      filled = true;
      fill();
    }
  };
  det.addEventListener('toggle', onOpen);
  onOpen();
  return det;
}

function bulkSet(entries, value) {
  if (!confirm(`Set ${entries.length} values to ${value}? Story switches can change game behaviour; this is one undo step.`)) return;
  apply(entries.map((e) => ({ id: e.nodeId, value })), 'Bulk set');
}

function bulkPrompt(entries) {
  const v = prompt(`New value for all ${entries.length} entries:`);
  if (v === null || v.trim() === '') return;
  apply(entries.map((e) => ({ id: e.nodeId, value: v.trim() })), 'Bulk set');
}

function apply(changes, label) {
  try {
    state.session.set(changes, label);
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

function switchEl(checked, onchange) {
  const input = h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) });
  return h('span', { class: 'switch' }, input, h('span'));
}

function control(entry) {
  const { doc, session } = state;
  const node = doc.node(entry.nodeId);
  const id = node.id;
  const row = h('div', { class: 'ctl' });
  const was = h('div', { class: 'was full' });
  const lbl = h('div', { class: 'lbl' }, h('b', null, entry.label), h('small', null, entry.scope ? `${entry.scope} · ${entry.path}` : entry.path));
  row.append(lbl);
  let update;

  if (node.type === 'bool') {
    const input = h('input', { type: 'checkbox', onchange: (e) => apply({ id, value: e.target.checked }) || update() });
    row.append(h('span', { class: 'switch' }, input, h('span')));
    update = () => {
      input.checked = session.value(id) === true;
    };
  } else if (node.type === 'int' || node.type === 'float') {
    const isInt = node.type === 'int';
    const input = h('input', {
      class: 'input',
      inputmode: isInt ? (Number(node.value) < 0 ? 'text' : 'numeric') : 'decimal',
      enterkeyhint: 'done',
      autocomplete: 'off',
      'aria-label': entry.label,
    });
    const commit = () => {
      input.classList.remove('invalid');
      if (input.value.trim() === formatValue(session.value(id))) return;
      if (!apply({ id, value: input.value.trim() })) {
        input.classList.add('invalid');
        return;
      }
      update();
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
    const step = (dir) => {
      const cur = session.value(id);
      const delta = isInt ? 1 : 0.1;
      const next = typeof cur === 'bigint' ? cur + BigInt(dir) : isInt ? cur + dir : Math.round((cur + dir * delta) * 1e6) / 1e6;
      apply({ id, value: String(next) });
    };
    row.append(
      h(
        'div',
        { class: 'numrow' },
        h('button', { class: 'btn icon small', 'aria-label': 'Decrease', onclick: () => step(-1) }, icon('minus')),
        input,
        h('button', { class: 'btn icon small', 'aria-label': 'Increase', onclick: () => step(1) }, icon('plus')),
      ),
    );
    let range = typeof node.value === 'bigint' ? null : sliderRange(node, entry.category);
    let slider = null;
    if (range && ['currency', 'resources', 'stats', 'progression', 'inventory', 'relationships', 'time', 'variables'].includes(entry.category)) {
      slider = h('input', { type: 'range', min: range.min, max: range.max, step: range.step, 'aria-label': `${entry.label} slider` });
      const paint = () => slider.style.setProperty('--p', `${((slider.value - range.min) / (range.max - range.min)) * 100}%`);
      slider.addEventListener('input', () => {
        input.value = slider.value;
        paint();
      });
      slider.addEventListener('change', () => apply({ id, value: isInt ? String(Math.round(slider.value)) : slider.value }) || update());
      const maxBtn = h('button', { class: 'btn small', onclick: () => apply({ id, value: String(range.max) }) });
      const quick = h(
        'div',
        { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } },
        h('button', { class: 'btn small', onclick: () => apply({ id, value: String(isInt ? Math.round(Number(session.value(id)) * 2) : Number(session.value(id)) * 2) }) }, '×2'),
        maxBtn,
      );
      slider._range = (v) => {
        // grow the slider when a value goes past it, never shrink below the original range
        const base = sliderRange(node, entry.category);
        const want = Math.abs(v) > base.max ? sliderRange({ type: node.type, value: Math.abs(v) }, entry.category) : base;
        range = { min: Math.min(base.min, v < 0 ? -want.max : 0), max: want.max, step: want.step };
        Object.assign(slider, { min: range.min, max: range.max, step: range.step });
        maxBtn.textContent = `Max ${Number(range.max).toLocaleString()}`;
      };
      row.append(h('div', { class: 'full row', style: { flexWrap: 'nowrap' } }, h('div', { class: 'grow' }, slider), quick));
      slider._paint = paint;
    }
    update = () => {
      const v = session.value(id);
      if (document.activeElement !== input) input.value = formatValue(v);
      if (slider) {
        if (typeof v === 'number') slider._range(v);
        slider.value = String(Math.min(Math.max(Number(v), range.min), range.max));
        slider._paint();
      }
    };
  } else {
    const listId = entry.suggestions ? `dl-${Math.random().toString(36).slice(2)}` : null;
    const multiline = typeof node.value === 'string' && (node.value.length > 60 || node.value.includes('\n'));
    const input = multiline
      ? h('textarea', { class: 'input', rows: 3, spellcheck: false, 'aria-label': entry.label })
      : h('input', { class: 'input', list: listId, autocapitalize: 'off', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': entry.label });
    input.addEventListener('change', () => apply({ id, value: input.value }) || update());
    row.classList.add('wide');
    row.append(h('div', { class: 'full' }, input, listId ? h('datalist', { id: listId }, entry.suggestions.map((s) => h('option', { value: s }))) : null));
    update = () => {
      if (document.activeElement !== input) input.value = session.value(id);
    };
  }
  if (entry.note) row.append(h('div', { class: 'full dim', style: { fontSize: '12px' } }, entry.note));
  row.append(was);
  const refresh = () => {
    update();
    const edited = session.isEdited(id);
    row.classList.toggle('edited', edited);
    clear(was);
    if (edited) {
      was.append(`was ${displayValue(node.type, node.value)} `, h('button', { class: 'btn small ghost', onclick: () => session.revert(id) }, 'Revert'));
    }
  };
  refresh();
  register(id, refresh);
  return row;
}

// ---------------------------------------------------------------- tree view

views.tree = (el) => {
  if (!needDoc(el)) return;
  const { doc } = state;
  const results = h('div', { class: 'tree' });
  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search keys and values…',
    value: state.treeFilter,
    autocapitalize: 'off',
    oninput: (e) => {
      state.treeFilter = e.target.value;
      fill();
    },
  });
  const onlyEditable = h('label', { class: 'row', style: { gap: '8px', fontSize: '13px', color: 'var(--muted)' } }, switchEl(state.treeEditableOnly, (v) => {
    state.treeEditableOnly = v;
    fill();
  }), 'Editable only');
  el.append(
    h(
      'div',
      { class: 'card' },
      h('h2', null, 'All decoded fields'),
      h('p', { class: 'muted', style: { marginTop: 0, fontSize: '13px' } }, 'Everything that was safely decoded, with its real type. Locked fields show why they cannot be edited.'),
      h('div', { class: 'menu-head' }, h('div', { class: 'search grow' }, icon('search'), search), onlyEditable),
      results,
    ),
  );
  function fill() {
    clear(results);
    const q = state.treeFilter.trim().toLowerCase();
    if (q || state.treeEditableOnly) {
      let n = 0;
      for (const node of doc.index.byId.values()) {
        if (state.treeEditableOnly && !node.editable) continue;
        if (q && !node.key.toLowerCase().includes(q) && !(node.children ? false : String(node.value).toLowerCase().includes(q))) continue;
        if (++n > 300) {
          results.append(h('p', { class: 'muted' }, 'More than 300 matches — refine the search.'));
          break;
        }
        const crumbs = pathOfIds(node.id).slice(1, -1).map((x) => doc.node(x).key).join(' › ');
        results.append(h('div', null, h('div', { class: 'crumbs', style: { padding: '6px 6px 0 34px' } }, crumbs || '(root)'), treeRow(node, false)));
      }
      if (!n) results.append(h('div', { class: 'empty' }, h('p', null, 'No matches.')));
    } else {
      results.append(treeNodeEl(doc.root));
    }
  }
  fill();
};

function pathOfIds(id) {
  const out = [];
  let cur = id;
  while (cur) {
    out.unshift(cur);
    cur = state.doc.index.parentOf.get(cur);
  }
  return out;
}

function treeNodeEl(node) {
  const wrap = h('div');
  const row = treeRow(node, true, () => toggle());
  wrap.append(row);
  let kids = null;
  const toggle = () => {
    if (state.openTree.has(node.id)) state.openTree.delete(node.id);
    else state.openTree.add(node.id);
    paint();
  };
  const paint = () => {
    const open = state.openTree.has(node.id);
    row.classList.toggle('open', open);
    if (open && !kids) {
      kids = h('div', { class: 'kids' });
      renderEntriesTree(kids, node.children || []);
      wrap.append(kids);
    }
    if (kids) kids.classList.toggle('hidden', !open);
  };
  if (node.children) paint();
  return wrap;
}

function renderEntriesTree(container, children) {
  let i = 0;
  const more = h('button', { class: 'btn small more', onclick: () => page() });
  const page = () => {
    more.remove();
    for (const c of children.slice(i, i + 200)) container.append(treeNodeEl(c));
    i += 200;
    if (i < children.length) {
      more.textContent = `Show more (${children.length - i} left)`;
      container.append(more);
    }
  };
  page();
}

function treeRow(node, nested, onToggle) {
  const { session } = state;
  const isC = !!node.children;
  const row = h('div', { class: 'tn' });
  const valueEl = h('span', { class: 'v' });
  const badgeType = node.type === 'embedded' ? node.meta.innerType || 'embedded' : node.type;
  add(
    row,
    isC ? h('button', { class: 'tw', 'aria-label': 'Expand', onclick: onToggle }, icon('chev')) : h('span', { class: 'tw' }),
    h('span', { class: 'k', onclick: isC ? onToggle : null }, node.key),
    h('span', { class: `badge t-${node.type}`, title: node.meta.className || '' }, node.meta.className && node.type !== 'set' ? shortClass(node.meta.className) : badgeType),
    node.type === 'embedded' ? h('span', { class: 'badge t-embedded', title: node.meta.encoding }, 'encoded') : null,
    valueEl,
  );
  if (node.meta.readOnlyReason || (!node.editable && !isC && node.meta.note)) {
    row.append(h('button', { class: 'btn icon small ghost', 'aria-label': 'Why is this locked?', onclick: () => toast(node.meta.readOnlyReason || node.meta.note) }, icon(node.meta.readOnlyReason ? 'lock' : 'info')));
  }
  let editor = null;
  if (node.editable) {
    row.append(
      h('button', {
        class: 'edit',
        onclick: () => {
          if (editor) {
            editor.remove();
            editor = null;
            return;
          }
          editor = inlineEditor(node, () => {
            editor?.remove();
            editor = null;
          });
          row.after(editor);
        },
      }, 'EDIT'),
    );
  }
  const update = () => {
    if (isC) {
      valueEl.textContent = node.type === 'ref' ? '' : `${node.children.length} ${node.children.length === 1 ? 'item' : 'items'}`;
      valueEl.className = 'v';
      return;
    }
    const v = node.editable ? session.value(node.id) : node.value;
    valueEl.textContent = node.type === 'ref' ? `→ ${node.meta.refTo}` : displayValue(node.type, v);
    valueEl.className = `v ${node.type === 'string' ? 'str' : node.type === 'bool' ? 'bool' : node.type === 'int' || node.type === 'float' ? 'num' : ''}`;
    row.classList.toggle('edited', session.isEdited(node.id));
  };
  update();
  if (node.editable) register(node.id, update);
  return row;
}

function shortClass(c) {
  return c.length > 28 ? '…' + c.slice(-27) : c;
}

function inlineEditor(node, close) {
  const { session } = state;
  const cur = session.value(node.id);
  let input;
  if (node.type === 'bool') {
    input = h('select', { class: 'input' }, h('option', { value: 'true', selected: cur === true }, 'true'), h('option', { value: 'false', selected: cur === false }, 'false'));
  } else {
    input = h('input', { class: 'input mono', value: formatValue(cur).replace(/^"|"$/g, ''), inputmode: node.type === 'int' ? 'numeric' : node.type === 'float' ? 'decimal' : 'text', autocapitalize: 'off' });
    if (node.type === 'string') input.value = cur;
  }
  const save = () => {
    if (apply({ id: node.id, value: input.value })) close();
    else input.classList.add('invalid');
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  setTimeout(() => input.focus(), 30);
  return h(
    'div',
    { class: 'inline-edit' },
    h('div', { class: 'grow' }, input, h('div', { class: 'crumbs', style: { marginTop: '4px' } }, `${node.type} · original ${displayValue(node.type, node.value)}`)),
    h('button', { class: 'btn primary small', onclick: save }, 'Set'),
    session.isEdited(node.id) ? h('button', { class: 'btn small', onclick: () => (session.revert(node.id), close()) }, 'Revert') : null,
  );
}

// ---------------------------------------------------------------- changes / compare

views.changes = (el) => {
  if (!needDoc(el)) return;
  const { doc, session } = state;
  const diff = session.diff();
  const card = h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow', style: { margin: 0 } }, 'Before → after'), diff.length ? h('button', { class: 'btn small danger', onclick: confirmReset }, 'Reset all') : null));
  if (!diff.length) card.append(h('p', { class: 'muted' }, 'No changes yet. Edits from the mod menu and field inspector appear here.'));
  for (const d of diff) {
    const crumbs = pathOfIds(d.id).slice(1).map((x) => doc.node(x).key).join(' › ');
    const entry = doc.menu.all.find((e) => e.nodeId === d.id);
    card.append(
      h(
        'div',
        { class: 'diff' },
        h(
          'div',
          null,
          h('b', null, entry ? entry.label : d.node.key),
          h('div', { class: 'crumbs' }, crumbs),
          h('div', { class: 'vals' }, h('span', { class: 'old' }, displayValue(d.node.type, d.before)), '  →  ', h('span', { class: 'new' }, displayValue(d.node.type, d.after))),
        ),
        h('button', { class: 'btn small', onclick: () => session.revert(d.id) }, 'Revert'),
      ),
    );
  }
  if (diff.length) card.append(h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: exportFlow }, icon('download'), 'Validate & export')));
  el.append(card);
  el.append(compareCard());
};

function compareCard() {
  const card = h(
    'div',
    { class: 'card' },
    h('h2', null, 'Compare with another save'),
    h('p', { class: 'muted', style: { marginTop: 0, fontSize: '13px' } }, 'Load a second save of the same game (e.g. before and after buying something) to see exactly which variables changed. Great for finding the right field.'),
  );
  const input = h('input', {
    type: 'file',
    class: 'hidden',
    onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const res = await analyzeFile(f.name, new Uint8Array(await f.arrayBuffer()));
      if (!res.ok) return toast('That file could not be decoded', true);
      state.compare = res.doc;
      rerender();
    },
  });
  card.append(h('label', { class: 'btn' }, icon('upload'), state.compare ? `Comparing with ${state.compare.name}` : 'Choose second save', input));
  if (state.compare) {
    const other = state.compare;
    const rows = [];
    for (const [id, n] of state.doc.index.byId) {
      if (n.children) continue;
      const m = other.node(id);
      if (!m) rows.push([id, n, null, 'only in this file']);
      else if (!m.children && n.type !== 'bytes' && String(m.value) !== String(n.value)) rows.push([id, n, m, null]);
    }
    for (const [id, m] of other.index.byId) if (!m.children && !state.doc.node(id)) rows.push([id, null, m, 'only in the other file']);
    card.append(h('p', { class: 'muted' }, `${rows.length} difference(s)`));
    for (const [id, n, m, note] of rows.slice(0, 300)) {
      const label = pathOfIdsSafe(id);
      const canTake = n && m && n.editable && m.type === n.type;
      card.append(
        h(
          'div',
          { class: 'diff' },
          h(
            'div',
            null,
            h('div', { class: 'crumbs' }, label),
            note ? h('div', { class: 'dim' }, note) : h('div', { class: 'vals' }, h('span', { class: 'old' }, displayValue(n.type, n.value)), '  ↔  ', h('span', { class: 'new' }, displayValue(m.type, m.value))),
          ),
          canTake ? h('button', { class: 'btn small', title: 'Use the other file’s value', onclick: () => apply({ id, value: m.type === 'bool' ? m.value : String(m.value) }) }, 'Use') : null,
        ),
      );
    }
  }
  return card;
}

function pathOfIdsSafe(id) {
  return id
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .join(' › ');
}

// ---------------------------------------------------------------- export

async function exportFlow() {
  const { session, doc } = state;
  if (!session) return;
  const back = h('div', { class: 'modal-back', onclick: (e) => e.target === back && back.remove() });
  const modal = h('div', { class: 'modal' }, h('h2', null, 'Export modified save'), h('p', { class: 'muted' }, 'Rebuilding and re-decoding to verify…'));
  back.append(modal);
  document.body.append(back);
  let result;
  try {
    result = await session.export();
  } catch (e) {
    add(clear(modal), h('h2', null, 'Export stopped'), h('div', { class: 'notice bad' }, e.message), h('button', { class: 'btn', onclick: () => back.remove() }, 'Close'));
    return;
  }
  const v = result.validation;
  const original = typeof doc.input === 'string' ? new TextEncoder().encode(doc.input) : doc.input;
  const dl = () => download(result.bytes, result.filename);
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([result.bytes], result.filename)] });
  add(
    clear(modal),
    h('h2', null, 'Export modified save'),
    v.ok
      ? h('div', { class: 'notice ok' }, icon('shield'), ` Verified: the rebuilt file was decoded again and all ${v.checked} values match (${session.edits.size} changed, everything else identical).`)
      : h('div', null, h('div', { class: 'notice bad' }, 'Verification found problems, so downloading is not recommended:'), h('ul', { class: 'clean mono', style: { fontSize: '12px' } }, v.problems.map((p) => h('li', null, p)))),
    result.unchanged ? h('div', { class: 'notice' }, 'No changes were made — this is identical to the original file.') : null,
    h('dl', { class: 'kv', style: { margin: '12px 0' } }, h('dt', null, 'File name'), h('dd', { class: 'mono' }, result.filename), h('dt', null, 'Size'), h('dd', null, `${fmtBytes(original.length)} → ${fmtBytes(result.bytes.length)}`), h('dt', null, 'Encoding'), h('dd', null, doc.chain.describe())),
    h(
      'div',
      { class: 'row' },
      v.ok ? h('button', { class: 'btn primary', onclick: dl }, icon('download'), 'Download save') : h('button', { class: 'btn danger', onclick: () => confirm('Download a file that failed verification?') && dl() }, 'Download anyway'),
      canShare && v.ok ? h('button', { class: 'btn', onclick: () => navigator.share({ files: [new File([result.bytes], result.filename)] }).catch(() => {}) }, icon('share'), 'Share / Save to Files') : null,
      h('button', { class: 'btn', onclick: () => download(original, backupName(doc.name)) }, 'Download original'),
    ),
    h('h3', null, 'Import it into the game'),
    h('ol', { class: 'steps' }, doc.engine.importGuide.map((s) => h('li', null, s))),
    state.frameSameOrigin && doc.engine.id === 'storage-dump' ? h('button', { class: 'btn primary', style: { marginTop: '8px' }, onclick: () => (back.remove(), writeToFrame(result.bytes)) }, 'Write into the running game') : null,
    h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { class: 'btn ghost', onclick: () => back.remove() }, 'Close')),
  );
}

function backupName(name) {
  const m = /^(.*?)(\.[^.]+)?$/.exec(name);
  return `${m[1]}.backup${m[2] || ''}`;
}

function download(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 5000);
}

// ---------------------------------------------------------------- game browser

views.game = (el) => {
  const recent = prefs.get('recentUrls', []);
  const url = h('input', { class: 'input', type: 'url', placeholder: 'https://… game URL', value: state.gameUrl || recent[0] || '', autocapitalize: 'off', autocorrect: 'off', enterkeyhint: 'go' });
  const launch = () => {
    let u = url.value.trim();
    if (!u) return;
    if (!/^[a-z]+:/i.test(u)) u = `https://${u}`;
    if (!/^https?:/i.test(u)) return toast('Only http(s) game URLs can be opened', true);
    state.gameUrl = u;
    prefs.set('recentUrls', [u, ...recent.filter((r) => r !== u)].slice(0, 6));
    rerender();
  };
  url.addEventListener('keydown', (e) => e.key === 'Enter' && launch());
  el.append(
    h(
      'div',
      { class: 'card' },
      h('h2', null, 'Game browser'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, url), h('button', { class: 'btn primary', onclick: launch }, icon('game'), 'Launch')),
      recent.length ? h('div', { class: 'row', style: { marginTop: '8px' } }, recent.map((r) => h('button', { class: 'btn small ghost', onclick: () => ((url.value = r), launch()) }, shortUrl(r)))) : null,
    ),
  );
  if (state.gameUrl) {
    const frame = h('iframe', { src: state.gameUrl, allow: 'autoplay; fullscreen; gamepad', referrerpolicy: 'no-referrer', title: 'Game' });
    state.frame = frame;
    const status = h('div', { class: 'notice' }, 'Loading game…');
    frame.addEventListener('load', () => {
      let same = false;
      try {
        same = !!frame.contentWindow.location.href && frame.contentWindow.location.origin === location.origin;
      } catch {
        same = false;
      }
      state.frameSameOrigin = same;
      clear(status);
      if (same) {
        status.className = 'notice ok';
        status.append(
          h('b', null, 'Direct integration available. '),
          'This game is on the same origin as SaveForge, so its storage can be read and written here.',
          h(
            'div',
            { class: 'row', style: { marginTop: '8px' } },
            h('button', { class: 'btn primary small', onclick: () => openTrainerInFrame(frame) }, 'Open trainer over game'),
            h('button', { class: 'btn small', onclick: readFromFrame }, 'Read game storage'),
            state.doc && state.doc.engine.id === 'storage-dump' ? h('button', { class: 'btn small', onclick: exportFlow }, 'Validate & write back…') : null,
          ),
        );
      } else {
        status.className = 'notice warn';
        status.append(
          h('b', null, 'Separate save-editor workflow. '),
          'The game is on another origin, so Safari (correctly) blocks SaveForge from reading its storage, and a game cannot be changed from outside while it runs. Use the Storage Bridge below on the game’s own page, or export the save from the game. If the frame stays blank, the site refuses embedding — ',
          h('a', { href: state.gameUrl, target: '_blank', rel: 'noopener', style: { color: 'var(--accent-2)' } }, 'open it in a new tab'),
          '.',
        );
      }
    });
    el.append(h('div', { class: 'game-wrap' }, frame), status);
  }
  el.append(launchOptionsCard(), trainerCard(), bridgeCard(), compatCard());
};

function shortUrl(u) {
  try {
    const x = new URL(u);
    return x.host + (x.pathname.length > 1 ? x.pathname.slice(0, 18) : '');
  } catch {
    return u.slice(0, 30);
  }
}

function bridgeCard() {
  const code = bookmarkletUrl();
  return h(
    'div',
    { class: 'card' },
    h('h2', null, 'Storage Bridge (bookmarklet)'),
    h('p', { class: 'muted', style: { marginTop: 0 } }, 'For browser games that save to localStorage or IndexedDB (RPG Maker web, Ren’Py web, Construct, many sandbox games). The bridge runs on the game page itself, exports every save it can see to a file, and imports the edited file back. It only talks to that page; nothing is uploaded.'),
    h(
      'div',
      { class: 'row' },
      h('a', { class: 'bm', href: code, onclick: (e) => (e.preventDefault(), toast('Drag this to your bookmarks bar, or use “Copy code” on iPhone')) }, 'SaveForge Bridge'),
      h('button', { class: 'btn small', onclick: () => copy(code) }, 'Copy code'),
    ),
    h('h3', null, 'Set up on iPhone (once)'),
    h(
      'ol',
      { class: 'steps' },
      h('li', null, 'Tap “Copy code” above.'),
      h('li', null, 'Bookmark any page (Share → Add Bookmark), name it “SaveForge Bridge”.'),
      h('li', null, 'Open Bookmarks → Edit → the new bookmark, replace its address with the copied code, Done.'),
    ),
    h('h3', null, 'Use it'),
    h(
      'ol',
      { class: 'steps' },
      h('li', null, 'Open the game in Safari, save in-game, then open Bookmarks and tap “SaveForge Bridge”. Tap Export saves.'),
      h('li', null, 'Open the downloaded “…-storage.json” here (Analyze tab), edit, and Export.'),
      h('li', null, 'Back on the game page, run the bridge again, tap Import edited, pick the exported file, and reload.'),
    ),
    h('p', { class: 'dim', style: { fontSize: '12px' } }, 'Games that keep progress only in memory, on a server, or in encrypted/custom formats cannot be edited this way.'),
  );
}

function openTrainerInFrame(frame) {
  openTrainer(frame.contentWindow);
  const top = frame.getBoundingClientRect().top + window.scrollY - (document.querySelector('.topbar')?.offsetHeight || 0) - 8;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function trainerUrl() {
  const standalone = document.documentElement.dataset.standalone === '1';
  return new URL(standalone ? 'trainer.js' : 'standalone/trainer.js', location.href).href;
}

function trainerLoaderBookmarklet() {
  const src = trainerUrl();
  return `javascript:(function(){if(window.__saveforgeTrainer){window.__saveforgeTrainer.show();return}var s=document.createElement('script');s.src=${JSON.stringify(src)}+'?v='+Date.now();s.onerror=function(){alert('SaveForge trainer could not be loaded (offline, or blocked by this page). Use the offline trainer bookmarklet instead.')};document.documentElement.appendChild(s)})()`;
}

async function copyFullTrainer() {
  try {
    if (!/^https?:/.test(location.protocol)) throw new Error('Open SaveForge from its web address to copy the offline trainer.');
    const code = await (await fetch(trainerUrl(), { cache: 'no-cache' })).text();
    await copy(`javascript:${encodeURIComponent(code)}`);
    toast(`Copied offline trainer (${Math.round(code.length / 1024)} KB)`);
  } catch (e) {
    toast(e.message, true);
  }
}

function shortcutCode() {
  return `(function () {\n  if (window.__saveforgeTrainer) { window.__saveforgeTrainer.show(); completion(true); return; }\n  var s = document.createElement('script');\n  s.src = ${JSON.stringify(trainerUrl())} + '?v=' + Date.now();\n  s.onerror = function () { alert('SaveForge could not load (offline, or blocked by this page).'); };\n  document.documentElement.appendChild(s);\n  completion(true);\n})();`;
}

function launchOptionsCard() {
  const standalone = document.documentElement.dataset.standalone === '1';
  const userscript = new URL(standalone ? 'saveforge-trainer.user.js' : 'standalone/saveforge-trainer.user.js', location.href).href;
  const repo = 'https://github.com/CriticaIl/Wand-Enhancer/tree/claude/html5-game-save-analyzer-ogbcnf/save-analyzer/safari-extension';
  const opt = (title, text, ...actions) => h('div', { class: 'notice' }, h('b', null, title), h('div', { class: 'muted', style: { fontSize: '13px', margin: '4px 0 8px' } }, text), h('div', { class: 'row' }, ...actions));
  const guide = 'https://github.com/CriticaIl/Wand-Enhancer/blob/claude/html5-game-save-analyzer-ogbcnf/save-analyzer/USERSCRIPT.md';
  return h(
    'div',
    { class: 'card' },
    h('h2', null, 'Open the trainer on iPhone'),
    h('p', { class: 'muted', style: { marginTop: 0 } }, 'All options open the same trainer over the game page. The first one needs only your iPhone.'),
    opt(
      'Recommended: Userscripts app (free, iPhone only)',
      '1) Install “Userscripts” and switch it on in Settings → Apps → Safari → Extensions. 2) Tap “Install script”, then tap AA → Userscripts → Install. A small ⬢ button then appears on game pages; or add #saveforge to any address. Updates arrive automatically.',
      h('a', { class: 'btn small', href: 'https://apps.apple.com/app/userscripts/id1463298887', target: '_blank', rel: 'noopener' }, 'Get Userscripts'),
      h('a', { class: 'btn small primary', href: userscript }, 'Install script'),
      h('a', { class: 'btn small', href: guide, target: '_blank', rel: 'noopener' }, 'Guide'),
    ),
    opt(
      'Shortcuts app (built in)',
      'New shortcut → “Run JavaScript on Web Page” → paste this code → Show in Share Sheet. Then Share → SaveForge Trainer on a game page. Needs a connection.',
      h('button', { class: 'btn small', onclick: () => copy(shortcutCode()) }, 'Copy shortcut code'),
    ),
    opt(
      'Own Safari extension (needs a Mac with Xcode once)',
      'Adds “SaveForge Trainer” to Safari’s page menu. Asks for website access only when you tap it.',
      h('a', { class: 'btn small', href: `${repo}#readme`, target: '_blank', rel: 'noopener' }, 'Install guide'),
    ),
  );
}

function trainerCard() {
  return h(
    'div',
    { class: 'card' },
    h('h2', null, 'Trainer overlay for browser games'),
    h(
      'p',
      { class: 'muted', style: { marginTop: 0 } },
      'A GTA-style floating trainer that runs on the game page itself. It finds the game’s variables, explains each one (ⓘ), and edits them live where the engine allows it, or as saved edits with Apply & Reload.',
    ),
    h(
      'div',
      { class: 'row' },
      h('a', { class: 'bm', href: trainerLoaderBookmarklet(), onclick: (e) => (e.preventDefault(), toast('Add this as a bookmark: use “Copy trainer bookmarklet” on iPhone')) }, 'SaveForge Trainer'),
      h('button', { class: 'btn small', onclick: () => copy(trainerLoaderBookmarklet()) }, 'Copy trainer bookmarklet'),
      h('button', { class: 'btn small', onclick: copyFullTrainer }, 'Copy offline version'),
    ),
    h(
      'ol',
      { class: 'steps' },
      h('li', null, 'Tap “Copy trainer bookmarklet”, bookmark any page, then edit that bookmark and paste the code as its address (same steps as the Storage Bridge below).'),
      h('li', null, 'Open your game in Safari, open Bookmarks and tap “SaveForge Trainer”. The trainer appears over the game; minimise it to the floating icon to keep playing.'),
    ),
    h(
      'p',
      { class: 'dim', style: { fontSize: '12px' } },
      'The normal bookmarklet loads the trainer from this site, so it needs a connection and a page that allows it. The offline version contains the whole trainer (about 150 KB). Very long bookmarks may not sync or save on every iOS version; if it does not stick, use the normal one.',
    ),
  );
}

function compatCard() {
  const rows = [
    ['RPG Maker MV / MZ', 'Live', 'Gold, items (with names), actors, switches and variables through $gameParty, $gameActors, $gameSwitches, $gameVariables.'],
    ['SugarCube 2 (Twine)', 'Live', 'Story variables via SugarCube.State.variables; “Refresh passage” re-renders the text.'],
    ['Construct 2', 'Live', 'Global variables via cr_getC2Runtime().'],
    ['Plain HTML5 games', 'Live*', 'Global JavaScript objects are found automatically. It works only if the game keeps its state in globals; the game may overwrite edits.'],
    ['Ren’Py web', 'Apply & Reload', 'Python runs inside WebAssembly with no JavaScript→Python access, so edit the save files in IndexedDB.'],
    ['Construct 3', 'Apply & Reload', 'Usually runs in a Web Worker that page scripts cannot reach.'],
    ['Harlowe (Twine)', 'Apply & Reload', 'Story state is private to the engine.'],
    ['GameMaker HTML5', 'Apply & Reload', 'Runtime variables are obfuscated; INI/JSON saves in storage can be edited.'],
    ['Any game, cross-site in the Game tab', 'Bookmarklet only', 'Safari blocks access across sites; run the trainer bookmarklet on the game page instead.'],
    ['Server-side, encrypted or WebAssembly-only state', 'Not supported', 'There is nothing the browser lets a page read or change safely.'],
  ];
  return h(
    'div',
    { class: 'card' },
    h('h2', null, 'What can be edited live?'),
    h('table', { class: 'fmt' }, h('tr', null, h('th', null, 'Engine'), h('th', null, 'Mode'), h('th', null, 'How')), rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))),
    h('p', { class: 'dim', style: { fontSize: '12px' } }, 'Live = applied to the running game immediately (save in-game to keep it). Live* = written to page globals; the effect depends on the game. Apply & Reload = written to browser storage, then the page reloads.'),
  );
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    prompt('Copy this:', text);
  }
}

async function readFromFrame() {
  try {
    const dump = await storageBridge(state.frame.contentWindow, 'collect');
    await load(`${location.hostname || 'game'}-storage.json`, new TextEncoder().encode(JSON.stringify(dump, null, 1)));
  } catch (e) {
    toast(`Could not read storage: ${e.message}`, true);
  }
}

async function writeToFrame(bytes) {
  try {
    const dump = JSON.parse(new TextDecoder().decode(bytes));
    const s = await storageBridge(state.frame.contentWindow, 'apply', dump);
    toast(`Wrote ${s.localStorage} key(s), ${s.records} record(s). Reloading game…`);
    state.frame.contentWindow.location.reload();
  } catch (e) {
    toast(`Write failed: ${e.message}`, true);
  }
}

// ---------------------------------------------------------------- floating mod menu

function ensureFloating() {
  if (fabEl) {
    updateFabCount();
    return;
  }
  const pos = prefs.get('fabPos', null);
  fabEl = h('button', { class: 'fab', 'aria-label': 'Open floating mod menu', style: pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : { right: '16px', bottom: 'calc(var(--tabbar) + 16px)' } }, icon('logo'));
  draggable(fabEl, fabEl, {
    onEnd: (moved) => {
      if (moved) {
        const r = fabEl.getBoundingClientRect();
        prefs.set('fabPos', { x: Math.round(r.left), y: Math.round(r.top) });
      }
    },
  });
  fabEl.addEventListener('click', () => {
    if (fabEl.dataset.justDragged) return;
    togglePanel();
  });
  document.body.append(fabEl);
  updateFabCount();
}

function updateFabCount() {
  if (!fabEl) return;
  fabEl.querySelector('.count')?.remove();
  const n = state.session?.edits.size;
  if (n) fabEl.append(h('span', { class: 'count' }, n));
}

function removeFloating() {
  closeTrainer();
  fabEl?.remove();
  fabEl = null;
}

// The floating button opens the GTA-style trainer on the imported save (saved edits → Export).
function togglePanel() {
  if (trainerCtl) return closeTrainer();
  const provider = new FileProvider(state.doc, state.session);
  trainerCtl = mountTrainer(window, {
    sources: [{ id: 'file', label: state.doc.name, channel: 'file', create: () => provider }],
    store: createStore(window, 'saveforge-app'),
    onExport: exportFlow,
    onClose: () => {
      provider.dispose();
      trainerCtl = null;
      if (fabEl) fabEl.style.display = '';
    },
  });
  if (fabEl) fabEl.style.display = 'none';
}

function closeTrainer() {
  trainerCtl?.destroy();
  trainerCtl = null;
}

// ---------------------------------------------------------------- misc

function needDoc(el) {
  if (state.doc) return true;
  el.append(h('div', { class: 'empty' }, icon('upload'), h('p', null, 'Import a save first.'), h('button', { class: 'btn primary', onclick: () => show('analyze') }, 'Go to Analyze')));
  return false;
}

let toastTimer;
function toast(msg, bad = false) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), bad ? 4200 : 2200);
}

function showHelp() {
  const back = h('div', { class: 'modal-back', onclick: (e) => e.target === back && back.remove() });
  const rows = [
    ['Ren’Py save slot (.save)', 'ZIP + pickle (protocols 0–5)', 'Read & write. Pickle is decoded without executing code; edits patch only the changed values. The stale 8.1+ signature is cleared, so Ren’Py asks once whether to trust the save.'],
    ['Ren’Py persistent', 'zlib + pickle', 'Read & write when unsigned. Signed (8.1+) files are read-only: the game would discard them.'],
    ['RPG Maker MV (.rpgsave)', 'LZString Base64 + JSON', 'Read & write. Existing items/switches/variables only.'],
    ['RPG Maker MZ (.rmmzsave)', 'zlib binary string + JSON', 'Read & write.'],
    ['SugarCube / Twine (.save)', 'LZString Base64 + JSON', 'Read & write story variables.'],
    ['Generic HTML5 saves', 'JSON, Base64, gzip, zlib, LZString (all variants), URI-encoded, nested JSON strings', 'Read & write. Detection is structural; custom encryption is not supported.'],
    ['INI saves (GameMaker etc.)', 'INI text', 'Read & write; number formatting kept.'],
    ['Storage Bridge exports', 'localStorage + IndexedDB JSON', 'Read & write, including Ren’Py web saves stored in IndexedDB.'],
  ];
  back.append(
    h(
      'div',
      { class: 'modal' },
      h('h2', null, 'Supported formats'),
      h('table', { class: 'fmt' }, h('tr', null, h('th', null, 'Format'), h('th', null, 'Encoding'), h('th', null, 'Support')), rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))),
      h('h3', null, 'Not supported (by design)'),
      h('ul', { class: 'clean' }, [
        'Encrypted saves, proprietary binary formats, and games that store progress on a server.',
        'Editing a running game’s memory — browsers do not allow it. Edit the save, then load it.',
        'Adding variables that are not in the save, or re-signing Ren’Py persistent data.',
        'Unity WebGL PlayerPrefs, Godot binary saves and similar are only handled if they happen to be JSON/INI.',
      ].map((t) => h('li', null, t))),
      h('h3', null, 'Safety'),
      h('ul', { class: 'clean' }, [
        'Everything runs locally in your browser. Files are never uploaded.',
        'The original file is backed up automatically before the first change.',
        'Every export is re-decoded and compared field by field before you download it.',
      ].map((t) => h('li', null, t))),
      h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { class: 'btn', onclick: () => back.remove() }, 'Close')),
    ),
  );
  document.body.append(back);
}
