// Trainer screens for the Button & Textbox Linker (advanced, optional).
// Views: linker (overview) → inspect mode → linkel (what an element is wired to)
//        → linkpick (compatible actions) → linkprev (preview + confirmation).

import { candidatesFor, createLinker, inspectElement, pickElement, startRecording } from './linker.js';

export function createLinkerUI(ctx) {
  const { win, h, bodyEl, push, back, top, toast, setDesc, renderAll, host, panel, orb, root, store, getProvider } = ctx;
  const path = (() => {
    try {
      return win.location.pathname || '/';
    } catch {
      return '/';
    }
  })();
  const linker = createLinker(win, {
    store,
    key: `linker:${path}`,
    getProvider,
    host,
    onChange: () => updateBadge(),
    onError: (msg) => toast(msg, true),
  });
  let highlightEl = null;
  let inspectStop = null;

  // saved mappings: applied when SaveForge opens only if the user asked for that
  linker.load().then((r) => {
    if (r.applied) toast(`Linker: ${r.applied} saved mapping(s) active on this game`);
  });

  function updateBadge() {
    const n = linker.enabled ? linker.list().filter((m) => m.active).length : 0;
    panel.classList.toggle('linker-on', n > 0);
  }

  function highlight(el) {
    unhighlight();
    if (!el || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    highlightEl = h('div', { class: 'lk-hl', style: `left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px` });
    root.append(highlightEl);
    win.setTimeout(unhighlight, 2500);
  }
  function unhighlight() {
    highlightEl?.remove();
    highlightEl = null;
  }

  /** Briefly hides the panel so the highlighted element is visible (phones: the panel covers the game). */
  function showOnScreen(el) {
    if (!el.isConnected) return toast('This element is no longer on the page', true);
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch {
      /* old browsers */
    }
    ctx.minimize();
    highlight(el);
    win.setTimeout(() => {
      unhighlight();
      ctx.restore();
    }, 1800);
  }

  function startInspect() {
    if (!win.__saveforgeLinkerRec) startRecording(win);
    panel.style.display = 'none';
    orb.style.display = 'none';
    const bar = h(
      'div',
      { class: 'lk-bar', role: 'status' },
      h('b', null, 'Inspect element'),
      h('span', null, 'Tap a button, link, textbox, dropdown or checkbox in the game. The game will not receive this tap.'),
      h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancel'),
    );
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) bar.addEventListener(t, (e) => e.stopPropagation());
    root.append(bar);
    const finish = (el) => {
      inspectStop?.();
      inspectStop = null;
      bar.remove();
      panel.style.display = '';
      if (el) {
        push({ type: 'linkel', el });
        highlight(el);
      } else renderAll();
    };
    inspectStop = pickElement(win, { host, onPick: finish, onCancel: () => (toast('Nothing to inspect there'), finish(null)) });
  }

  // ---------------------------------------------------------------- overview
  function renderLinker() {
    if (!win.__saveforgeLinkerRec) startRecording(win);
    const list = linker.list();
    const sheet = h(
      'div',
      { class: 'sheet linker' },
      h('h2', null, 'Button & Textbox Linker'),
      h('p', { class: 'note' }, 'Advanced. Inspect what a game button, link, textbox, dropdown or checkbox is connected to, and optionally link it to another action. Nothing changes until you confirm a mapping, and every mapping can be undone.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn go', onclick: startInspect }, 'Inspect element')),
      h('h3', null, `Mappings on this game (${list.length})`),
      list.length
        ? h(
            'div',
            null,
            list.map((m) =>
              h(
                'div',
                { class: `lk-map${m.active && linker.enabled ? ' on' : ''}` },
                h('div', null, h('b', null, `“${m.label}”`), ` → ${m.action.label}${m.action.kind === 'variable' && m.mode === 'also' ? ' (plus original)' : ''}`),
                h('div', { class: 'path' }, m.selector, m.runs ? ` · used ${m.runs}×` : '', m.remember ? ' · saved for this game' : ''),
                h(
                  'div',
                  { class: 'btns' },
                  h('button', { class: 'btn mini', onclick: () => (linker.setActive(m.id, !m.active), renderAll()) }, m.active ? 'Pause' : 'Activate'),
                  h('button', { class: 'btn mini', onclick: () => (linker.remove(m.id), toast(`Original behaviour of “${m.label}” restored`), renderAll()) }, 'Restore original'),
                  h('button', { class: 'btn mini', onclick: () => (linker.setRemember(m.id, !m.remember), renderAll()) }, m.remember ? 'Forget on this game' : 'Save for this game'),
                ),
              ),
            ),
          )
        : h('p', { class: 'note' }, 'No mappings. The game behaves normally.'),
      h(
        'div',
        { class: 'btns' },
        h('button', { class: 'btn', disabled: !linker.canUndo(), onclick: () => (linker.undo(), toast('Last mapping change undone'), renderAll()) }, 'Undo last change'),
        h('button', { class: 'btn', disabled: !list.length, onclick: () => (toast(`${linker.restoreAll()} mapping(s) removed — original behaviour restored`), renderAll()) }, 'Restore all originals'),
      ),
      h(
        'label',
        { class: 'set' },
        h('input', { type: 'checkbox', checked: linker.enabled, onchange: (e) => (linker.setEnabled(e.target.checked), toast(e.target.checked ? 'Mappings enabled' : 'All mappings disabled — the game behaves normally'), renderAll()) }),
        ' Mappings enabled (turn off to disable all at once)',
      ),
      h(
        'label',
        { class: 'set' },
        h('input', { type: 'checkbox', checked: linker.autoApply, onchange: (e) => { const on = e.target.checked; linker.setAutoApply(on).then(() => toast(on ? 'Saved mappings will apply when SaveForge opens on this game' : 'Saved mappings stay off until you activate them')); } }),
        ' Apply saved mappings automatically when SaveForge opens on this game',
      ),
      h('h3', null, 'What works'),
      h('ul', null, [
        h('li', null, 'Standard HTML: buttons, links, inputs, textareas, dropdowns, checkboxes, radio buttons and elements with role="button".'),
        h('li', null, 'Handlers it can read: inline on… attributes, on… properties, jQuery handlers, listeners recorded after the Linker started, SugarCube passage links.'),
        h('li', null, 'Canvas games (Phaser, RPG Maker, Construct, Unity…) draw buttons as pixels: they cannot be inspected or remapped one by one.'),
      ]),
    );
    bodyEl.append(sheet);
    setDesc('Inspect and remap game buttons and fields. Mappings apply only after you confirm them.');
  }

  // ---------------------------------------------------------------- element
  function renderElement(v) {
    const el = v.el;
    if (!el.isConnected) {
      bodyEl.append(h('div', { class: 'sheet' }, h('div', { class: 'warnbox' }, 'This element is no longer on the page (the game redrew its screen). Inspect it again.'), h('div', { class: 'btns' }, h('button', { class: 'btn go', onclick: () => (back(), startInspect()) }, 'Inspect again'))));
      return;
    }
    const info = (v.info = inspectElement(el, { win, provider: getProvider(), host }));
    const item = (c, cls) => h('li', { class: cls }, h('b', null, c.source), ' — ', c.text, c.code && c.code.length > 60 ? h('details', null, h('summary', null, 'code'), h('pre', { class: 'code' }, c.code.slice(0, 1200))) : null);
    const eff = info.effects;
    const existing = linker.list().find((m) => m.selector === info.selector);
    const isInput = ['textbox', 'select', 'range', 'checkbox', 'radio'].includes(info.kind);
    bodyEl.append(
      h(
        'div',
        { class: 'sheet linker' },
        h('h2', null, info.label),
        h('div', { class: 'path' }, `<${info.tag}${info.type ? ` type=${info.type}` : ''}> · ${info.kind} · ${info.selector}`),
        info.risky ? h('div', { class: 'warnbox' }, info.risky) : null,
        existing ? h('div', { class: 'okbox' }, `Remapped by you: → ${existing.action.label}${existing.active && linker.enabled ? '' : ' (paused)'}`) : null,
        h('h3', null, `Confirmed links (${info.confirmed.length})`),
        info.confirmed.length ? h('ul', null, info.confirmed.map((c) => item(c, 'lk-confirmed'))) : h('p', { class: 'note' }, 'None that a web page can read.'),
        info.calls?.length ? [h('h3', null, 'Functions it calls'), h('ul', null, info.calls.map((c) => h('li', null, h('b', null, `${c.name}()`), ` — ${c.certainty === 'confirmed' ? 'called directly' : c.certainty === 'likely' ? 'called by the handler' : 'possibly called'}`, h('details', null, h('summary', null, 'code'), h('pre', { class: 'code' }, c.code)))))] : null,
        eff.length
          ? [
              h('h3', null, 'Variables its code changes'),
              h('p', { class: 'note' }, 'Read from the code, not run. “likely” = in the element’s own handler; “possible” = in code it may reach.'),
              h('ul', null, eff.slice(0, 20).map((e) => h('li', null, h('b', null, e.chain), ` ${e.op} ${e.rhs || ''} — ${e.certainty === 'confirmed' ? 'likely' : e.certainty}, in ${e.via}${e.id ? ` · matches trainer variable${e.idCertainty === 'name' ? ' (by name)' : ''}` : ''}`))),
            ]
          : null,
        isInput && (info.binding.likely.length || info.binding.possible.length)
          ? [
              h('h3', null, 'Variable receiving the input'),
              h('ul', null, [...info.binding.likely.map((b) => h('li', { class: 'lk-likely' }, h('b', null, 'likely'), ` — ${b.text}`)), ...info.binding.possible.map((b) => h('li', null, h('b', null, 'possible'), ` — ${b.chain}: ${b.text}`))]),
            ]
          : null,
        info.likely.length || info.possible.length ? [h('h3', null, `Possible links (${info.likely.length + info.possible.length})`), h('ul', null, [...info.likely.map((c) => item(c, 'lk-likely')), ...info.possible.map((c) => item(c))])] : null,
        watchBox(v, info),
        h('h3', null, 'Limits'),
        h('ul', null, info.limits.map((l) => h('li', null, l))),
        h(
          'div',
          { class: 'btns' },
          info.canvas ? null : h('button', { class: 'btn go', onclick: () => push({ type: 'linkpick', el, info, observedBinding: v.observedBinding }) }, 'Link to another action…'),
          info.canvas ? null : h('button', { class: 'btn', onclick: () => watchOnce(v), disabled: v.watch?.state === 'watching' }, isInput ? (info.kind === 'textbox' ? 'Detect by typing' : 'Watch one change') : 'Watch one tap'),
          existing ? h('button', { class: 'btn', onclick: () => (linker.remove(existing.id), toast('Original behaviour restored'), renderAll()) }, 'Restore original') : null,
          h('button', { class: 'btn', onclick: () => showOnScreen(el) }, 'Show on screen'),
          h('button', { class: 'btn', onclick: () => (back(), startInspect()) }, 'Inspect another'),
        ),
      ),
    );
    setDesc(`${info.confirmed.length} confirmed, ${info.likely.length + info.possible.length} possible link(s). Inspecting did not run anything.`);
  }

  async function watchOnce(v) {
    const info = v.info;
    v.watch = { state: 'watching', provider: !!getProvider() };
    renderAll();
    if (info.kind !== 'textbox') ctx.minimize();
    const r = await linker.watch(info);
    ctx.restore();
    v.watch = { state: 'done', ...r };
    if (r.changed?.some((c) => c.matchesInput)) v.observedBinding = r.changed.filter((c) => c.matchesInput).map((c) => c.id);
    if (top() === v) renderAll();
  }
  function watchBox(v, info) {
    const w = v.watch;
    if (!w) return h('div', { class: 'lk-watch' });
    if (w.state === 'watching') {
      return h(
        'div',
        { class: 'lk-watch' },
        h(
          'div',
          { class: 'warnbox' },
          h('b', null, 'Watching… '),
          info.kind === 'textbox' ? 'Type in the field and leave it (tap elsewhere). ' : info.kind === 'select' || info.kind === 'checkbox' || info.kind === 'radio' ? 'Change it once in the game. ' : 'Tap it once in the game — this really runs it. ',
          w.provider ? 'SaveForge compares the game’s variables before and after.' : 'No live variable source is open, so only the event is confirmed.',
        ),
      );
    }
    if (!w.ok) return h('div', { class: 'lk-watch' }, h('div', { class: 'note' }, 'Stopped watching (nothing happened within 30 s).'));
    return h(
      'div',
      { class: 'lk-watch' },
      h(
        'div',
        { class: w.changed.length ? 'okbox' : 'note' },
        h('b', null, 'Observed: '),
        w.changed.length ? `${w.changed.length} variable(s) changed after your ${info.kind === 'textbox' ? 'input' : info.kind === 'button' || info.kind === 'link' ? 'tap' : 'change'} (confirmed by observation).` : w.provider ? 'No scanned variable changed. The effect may be on screen only, on a server, or in variables SaveForge cannot see.' : 'The event happened; open a live source to see variable changes.',
        w.changed.length ? h('ul', null, w.changed.slice(0, 20).map((c) => h('li', null, h('b', null, c.path.replace(/^window › /, '')), `: ${fmt(c.before)} → ${fmt(c.after)}${c.matchesInput ? ' — equals what you entered (bound variable)' : ''}`))) : null,
      ),
    );
  }

  // ---------------------------------------------------------------- pick an action
  function renderPick(v) {
    const info = v.info;
    const cands = candidatesFor(info, { win, provider: getProvider(), host });
    const observed = new Set(v.observedBinding || []);
    cands.sort((a, b) => (observed.has(b.target) ? 1 : 0) - (observed.has(a.target) ? 1 : 0));
    bodyEl.append(
      h(
        'div',
        { class: 'sheet linker' },
        h('h2', null, `Link “${info.label}” to…`),
        h('p', { class: 'note' }, 'Only actions SaveForge can actually perform are listed. Choosing one opens a preview; nothing changes yet.'),
        cands.length
          ? h(
              'div',
              { class: 'lk-cands' },
              cands.map((c) =>
                h(
                  'button',
                  { class: 'lk-cand', onclick: () => push({ type: 'linkprev', el: v.el, info, action: c }) },
                  h('b', null, c.label),
                  observed.has(c.target) ? h('span', { class: 'badge verified' }, 'observed') : null,
                  c.risky ? h('span', { class: 'badge low' }, '⚠ risky') : null,
                  h('div', { class: 'path' }, c.detail || ''),
                ),
              ),
            )
          : h('div', { class: 'warnbox' }, ['textbox', 'select', 'range', 'checkbox'].includes(info.kind) ? 'Open a live game source first: fields can be linked to the game’s variables.' : 'No compatible actions were found on this page.'),
      ),
    );
    setDesc('Pick the new action. You will see a preview before anything changes.');
  }

  // ---------------------------------------------------------------- preview + confirmation
  function renderPreview(v) {
    const { info, action } = v;
    v.mode = v.mode || (action.kind === 'variable' ? 'also' : 'replace');
    const pv = linker.preview(info, action, v.mode);
    const needsAck = !!(action.risky || info.risky);
    let ack = !needsAck;
    let remember = false;
    const apply = h('button', { class: 'btn go', disabled: !ack, onclick: () => {
      const m = linker.apply(pv.mapping, { remember });
      toast(`Mapping applied: “${m.label}” → ${m.action.label}`);
      const st = S().stack;
      while (st.length > 1 && st[st.length - 1].type !== 'linker') st.pop();
      if (st[st.length - 1].type !== 'linker') st.push({ type: 'linker' });
      renderAll();
    } }, 'Apply mapping');
    bodyEl.append(
      h(
        'div',
        { class: 'sheet linker' },
        h('h2', null, 'Preview mapping'),
        h('dl', { class: 'kv' }, h('dt', null, 'Element'), h('dd', null, pv.element), h('dt', null, 'Now'), h('dd', null, h('ul', null, pv.from.map((f) => h('li', null, f)))), h('dt', null, 'After'), h('dd', { class: 'lk-to' }, pv.to)),
        action.kind === 'variable'
          ? h(
              'div',
              { class: 'lk-mode' },
              h('label', { class: 'set' }, h('input', { type: 'radio', name: 'lkmode', checked: v.mode === 'also', onchange: () => ((v.mode = 'also'), renderAll()) }), ' Also keep the game’s own handling (safest)'),
              h('label', { class: 'set' }, h('input', { type: 'radio', name: 'lkmode', checked: v.mode === 'replace', onchange: () => ((v.mode = 'replace'), renderAll()) }), ' Replace: the game’s input handlers do not run'),
            )
          : null,
        pv.warnings.length ? h('div', { class: 'warnbox' }, h('ul', null, pv.warnings.map((w) => h('li', null, w)))) : null,
        needsAck ? h('label', { class: 'set' }, h('input', { type: 'checkbox', onchange: (e) => ((ack = e.target.checked), (apply.disabled = !ack)) }), ' I understand this may spend in-game currency or erase progress') : null,
        h('label', { class: 'set' }, h('input', { type: 'checkbox', onchange: (e) => (remember = e.target.checked) }), ' Save this mapping for this game (stays off next time unless “apply automatically” is on)'),
        h('div', { class: 'btns' }, apply, h('button', { class: 'btn', onclick: back }, 'Cancel')),
        h('p', { class: 'note' }, 'Undo and Restore original are on the Linker screen. Turning “Mappings enabled” off disables every mapping at once.'),
      ),
    );
    setDesc('Check the mapping, then confirm. Nothing has changed yet.');
  }

  function S() {
    return ctx.state;
  }

  return {
    linker,
    render(v) {
      if (v.type === 'linker') return renderLinker();
      if (v.type === 'linkel') return renderElement(v);
      if (v.type === 'linkpick') return renderPick(v);
      if (v.type === 'linkprev') return renderPreview(v);
      return null;
    },
    crumb(v) {
      return { linker: 'Linker', linkel: 'Inspect element', linkpick: 'Link to…', linkprev: 'Preview mapping' }[v.type] || null;
    },
    startInspect,
    dispose() {
      inspectStop?.();
      linker.dispose();
      unhighlight();
      if (win.__saveforgeLinkerRec) win.__saveforgeLinkerRec.stop();
    },
  };
}

function fmt(v) {
  if (v === undefined) return '—';
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
  return String(v);
}
