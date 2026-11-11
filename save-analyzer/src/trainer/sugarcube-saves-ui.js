// Guided SugarCube save editing: Edit → Back up → Write → Load → Verify.
// Used when the story's live State is not reachable (no public window.SugarCube),
// and offered whenever SugarCube saves are present.

import { checkLoaded, currentVariables, editState, getPath, parseVarPath, publicLoader, readRaw, readSugarCubeStorage, writeSave, writeSession } from './sugarcube-saves.js';

export function createSugarCubeSavesUI(ctx) {
  const { win, h, bodyEl, back, toast, setDesc, renderAll, store, top } = ctx;
  const backups = ctx.backupStore || store; // listed in Backups & restore with the other save snapshots
  const pageLoad = () => {
    try {
      return Math.round(win.performance.timeOrigin);
    } catch {
      return 0;
    }
  };
  let pending = null; // {expect:[{path,value,label}], target, at, backup}
  let pollTimer = 0;
  let lastCheck = null;

  const fmt = (v) => (v === undefined ? '—' : typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
  const when = (d) => (d ? new Date(Number(d)).toLocaleString() : '?');

  // a write made before a page reload is checked again when the trainer opens
  store?.get?.('sc-verify', null).then((p) => {
    if (p && Date.now() - p.at < 6 * 3600 * 1000) {
      pending = p;
      startPoll();
    }
  });

  function startPoll() {
    win.clearInterval(pollTimer);
    pollTimer = win.setInterval(poll, 1000);
    poll();
  }
  function poll() {
    if (!pending) return void (win.clearInterval(pollTimer), (pollTimer = 0));
    let r = checkLoaded(win, pending.expect.map((e) => ({ path: e.path, value: e.value })));
    // the session option takes effect only through a page reload: the values are already in the
    // session state right after writing, so success is counted only on a newer page load
    if (pending.target.kind === 'session' && pending.page === pageLoad() && r.state === 'verified') r = { ...r, state: 'waiting' };
    const changed = !lastCheck || lastCheck.state !== r.state;
    lastCheck = r;
    if (r.state === 'verified' && !pending.verifiedAt) {
      pending.verifiedAt = Date.now();
      store?.set?.('sc-verify', pending);
      toast(`✓ Verified: the game loaded your edited save (${pending.expect.map((e) => `$${e.path.join('.')} = ${fmt(Number(e.value) || e.value)}`).join(', ')})`);
      win.clearInterval(pollTimer), (pollTimer = 0);
    }
    if (changed && ['scsave', 'home'].includes(top().type)) renderAll();
  }
  function status() {
    if (!pending) return null;
    if (pending.verifiedAt) return { state: 'verified', text: `Verified ${when(pending.verifiedAt)}: the game’s session state has ${pending.expect.map((e) => `$${e.path.join('.')} = ${fmt(e.value)}`).join(', ')}.` };
    if (pending.target.kind === 'session' && pending.page === pageLoad()) return { state: 'waiting', text: 'The edited values are in the session state. Reload the page: SugarCube resumes the session state, and SaveForge checks it after the reload.' };
    const got = lastCheck?.got || [];
    return { state: 'waiting', text: `Waiting for the game to load the edited save (${pending.target.label}). The running game still has ${got.map((g) => `$${g.path.join('.')} = ${g.now.found ? fmt(g.now.value) : '—'}`).join(', ') || 'unknown values'}.` };
  }

  function render(v) {
    if (pending && !v.fresh) return renderLoad(v);
    const sc = readSugarCubeStorage(win, { fresh: true });
    const sheet = h('div', { class: 'sheet scsave' }, h('h2', null, 'Edit a SugarCube save'));
    bodyEl.append(sheet);
    // several stories on this website and the one on this page cannot be told: never guess whose save to write
    if (sc.story && !sc.story.page) {
      sheet.append(h('div', { class: 'badbox' }, 'This page is not a SugarCube story, so no SugarCube save belongs to it. SugarCube saves stored on this website belong to other games and are never written from here.'));
      return;
    }
    if (sc.story && !sc.story.current && sc.story.ids.length > 1) {
      sheet.append(h('div', { class: 'badbox' }, `${sc.story.how} (${sc.story.ids.join(', ')}). SaveForge does not write a save it cannot attribute to this game. Start the story (play one passage) and open this again, or use Saves in storage.`));
      return;
    }
    if (sc.story?.current && sc.story.ids.length > 1) sheet.append(h('p', { class: 'note' }, `Story “${sc.story.current}” (${sc.story.how}). Saves of the other ${sc.story.ids.length - 1} SugarCube stor${sc.story.ids.length > 2 ? 'ies' : 'y'} on this website are not shown.`));
    if (!sc.saves.length) {
      sheet.append(h('div', { class: 'warnbox' }, 'No SugarCube saves were found in this page’s storage. Save the game once (its Saves menu), then come back.'));
      return;
    }
    sheet.append(
      h(
        'div',
        { class: 'okbox' },
        h('b', null, 'How SugarCube uses saves: '),
        'the running game lives in the browser session and a page reload simply resumes it. Saves (autosave and slots) are used only when you LOAD one in the game. So an edited save must be loaded from the game’s Saves menu — reloading the web page does not load it.',
      ),
    );
    if (!v.edits) v.edits = [{ expr: v.prefill?.expr || 'player.money', value: v.prefill?.value ?? '' }];
    const byDate = sc.saves.slice().sort((a, b) => Number(b.save.date || 0) - Number(a.save.date || 0));
    if (!v.sourceId || !sc.saves.some((s) => s.id === v.sourceId)) v.sourceId = byDate[0].id;
    const source = sc.saves.find((s) => s.id === v.sourceId);
    const sessionVars = sc.session ? currentVariables(sc.session.state) : null;
    const sourceVars = currentVariables(source.save.state);
    const paths = v.edits.map((e) => parseVarPath(e.expr));

    // 1. the save to edit
    sheet.append(h('h3', null, '1. Save to start from'));
    for (const s of byDate) {
      const vars = currentVariables(s.save.state);
      sheet.append(
        h(
          'label',
          { class: 'set' },
          h('input', { type: 'radio', name: 'scsrc', checked: s.id === v.sourceId, onchange: () => ((v.sourceId = s.id), renderAll()) }),
          h('span', null, h('b', null, s.label), ` · “${s.save.title || '?'}” · saved ${when(s.save.date)}`, h('br'), paths.filter(Boolean).map((p) => `$${p.join('.')} = ${fmt(getPath(vars, p).value)}`).join(' · ')),
        ),
      );
    }
    // 2. values
    sheet.append(h('h3', null, '2. New values'));
    v.edits.forEach((e, i) => {
      const p = paths[i];
      const inSave = p ? getPath(sourceVars, p) : { found: false };
      const inGame = p && sessionVars ? getPath(sessionVars, p) : { found: false };
      const pathIn = h('input', { class: 'field', value: e.expr, 'aria-label': 'Variable', autocapitalize: 'none', autocorrect: 'off', spellcheck: false, onchange: (ev) => ((e.expr = ev.target.value), renderAll()) });
      const valIn = h('input', { class: 'field', value: e.value, 'aria-label': 'New value', inputmode: typeof inSave.value === 'number' ? 'decimal' : 'text', oninput: (ev) => (e.value = ev.target.value) });
      sheet.append(
        h('div', { class: 'scedit' }, pathIn, valIn),
        h('p', { class: 'note' }, p ? `In this save: ${inSave.found ? fmt(inSave.value) : 'not found'} · running game (session): ${inGame.found ? fmt(inGame.value) : sc.session ? 'not found' : 'no session state'}` : 'Type a variable such as player.money'),
      );
    });
    sheet.append(h('div', { class: 'btns' }, h('button', { class: 'btn mini', onclick: () => (v.edits.push({ expr: '', value: '' }), renderAll()) }, '+ Another variable')));

    // 3. where to write
    sheet.append(h('h3', null, '3. Where to write it'));
    const targets = [];
    if (sc.free.length) targets.push({ id: 'free', label: `Copy into empty ${sc.free[0].label} (recommended)`, note: 'Your other saves stay untouched; load this slot afterwards.', ref: sc.free[0], kind: 'slot' });
    for (const s of sc.saves.filter((x) => x.kind === 'slot' && x.id !== 'never')) targets.push({ id: `over:${s.id}`, label: `Overwrite ${s.label} (“${s.save.title}”)`, note: 'Replaces that slot (a backup is kept).', ref: s, kind: 'slot' });
    const auto = sc.saves.find((x) => x.kind === 'autosave');
    if (auto) targets.push({ id: 'auto', label: 'Autosave (not recommended)', note: 'The game rewrites the autosave from the running session at the next passage — load it immediately or the edit is replaced.', ref: auto, kind: 'autosave' });
    if (sc.session) targets.push({ id: 'session', label: 'The running game’s session state, then reload the page', note: 'Reloading resumes the session state, so this applies on reload. It replaces the current playthrough (a backup is kept).', ref: sc.session, kind: 'session' });
    if (!v.targetId || !targets.some((t) => t.id === v.targetId)) v.targetId = targets[0]?.id;
    for (const t of targets) sheet.append(h('label', { class: 'set' }, h('input', { type: 'radio', name: 'sctgt', checked: t.id === v.targetId, onchange: () => ((v.targetId = t.id), renderAll()) }), h('span', null, h('b', null, t.label), h('br'), h('span', { class: 'note' }, t.note))));
    const target = targets.find((t) => t.id === v.targetId);

    // warnings, with evidence
    const warn = [];
    if (sessionVars) {
      for (const [i, p] of paths.entries()) {
        if (!p) continue;
        const a = getPath(sourceVars, p);
        const b = getPath(sessionVars, p);
        if (a.found && b.found && String(a.value) !== String(b.value)) warn.push(`The running game (session) has $${p.join('.')} = ${fmt(b.value)}, but this save has ${fmt(a.value)}. The game keeps playing from its session: if you do not LOAD the edited save, its next autosave writes ${fmt(b.value)} again. Loading the edited save replaces the running progress.`);
        else if (target?.kind === 'autosave' && a.found) warn.push(`The autosave is rewritten from the running game at the next passage. Load it right away, or choose a manual slot.`);
        void i;
      }
    }
    if (target?.kind === 'autosave' && !sessionVars) warn.push('The game rewrites the autosave at the next passage. Prefer a manual slot.');
    const needsAck = warn.length > 0;
    let ack = !needsAck || v.ack;
    const go = h('button', { class: 'btn go', disabled: !ack || !target, onclick: () => doWrite(v, sc, source, target, paths) }, 'Back up & write');
    if (warn.length) sheet.append(h('div', { class: 'warnbox' }, h('ul', null, [...new Set(warn)].map((w) => h('li', null, w)))), h('label', { class: 'set' }, h('input', { type: 'checkbox', checked: !!v.ack, onchange: (e) => ((v.ack = e.target.checked), (go.disabled = !e.target.checked)) }), ' I understand'));
    sheet.append(h('div', { class: 'btns' }, go, h('button', { class: 'btn', onclick: back }, 'Cancel')), h('p', { class: 'note' }, 'A backup of the save storage (and the session state) is stored first; the rebuilt save is decoded again and compared before anything is written.'));
    setDesc('Edit a SugarCube save, then load it in the game.');
  }

  async function doWrite(v, sc, source, target, paths) {
    try {
      const edits = v.edits.map((e, i) => ({ path: paths[i], value: e.value })).filter((e) => e.path && String(e.value).trim() !== '');
      if (!edits.length) throw new Error('Enter at least one new value.');
      ctx.guard?.(); // never write a save after the page switched to another game
      // the story could not be identified for sure: writing is your decision, never SaveForge's guess
      if (sc.story && sc.story.current && !sc.story.verified && !win.confirm(`SaveForge could not read this story's id from the page. ${sc.story.how}.\n\nWrite into the saves of story “${sc.story.current}”? Only do this if it is the story you are playing.`)) throw new Error('Not written: the story was not confirmed.');
      const backup = { kind: 'storage', title: 'Before SugarCube save edit', dump: { format: 'saveforge-storage-dump', version: 1, origin: safeOrigin(win), exportedAt: new Date().toISOString(), localStorage: {}, indexedDB: [] }, changes: edits.map((e) => ({ id: `$${e.path.join('.')}`, after: String(e.value) })) };
      if (target.kind !== 'session') backup.dump.localStorage[target.ref.key] = readRaw(win, 'localStorage', target.ref.key);
      if (sc.session) backup.session = { key: sc.session.key, raw: sc.session.raw };
      const rec = await backups?.addBackup?.(backup);
      let written;
      if (target.kind === 'session') {
        const state = editState(sc.session.state, edits);
        written = writeSession(win, sc.session, state, sc.session.raw);
      } else {
        const saveObj = { ...source.save, state: editState(source.save.state, edits), date: Date.now() };
        if (target.id === 'free') saveObj.title = `${source.save.title || 'Save'} (SaveForge edit)`;
        written = writeSave(win, target.ref, saveObj, target.ref.raw);
      }
      pending = { page: pageLoad(), expect: edits.map((e) => ({ path: e.path, value: e.value })), target: { id: target.id, kind: target.kind, slot: target.ref.slot, key: target.ref.key, label: target.kind === 'session' ? 'session state' : target.id === 'free' ? target.ref.label : target.ref.label }, at: Date.now(), undo: { store: target.kind === 'session' ? 'sessionStorage' : 'localStorage', key: target.kind === 'session' ? sc.session.key : target.ref.key, raw: written.before }, backupId: rec?.id ?? null };
      await store?.set?.('sc-verify', pending);
      v.fresh = false;
      toast('Backed up and written (verified). Now load it in the game.');
      startPoll();
      renderAll();
    } catch (e) {
      toast(e.message, true);
      if (e.conflict) renderAll();
    }
  }

  function renderLoad(v) {
    const st = status();
    const t = pending.target;
    const loader = t.kind !== 'session' ? publicLoader(win) : null;
    const sheet = h(
      'div',
      { class: 'sheet scsave' },
      h('h2', null, st.state === 'verified' ? 'Edited save loaded' : 'Load the edited save'),
      h('div', { class: st.state === 'verified' ? 'okbox' : 'warnbox' }, h('b', null, st.state === 'verified' ? '✓ Verified. ' : 'Not loaded yet. '), st.text),
    );
    if (st.state !== 'verified') {
      if (t.kind === 'session') {
        sheet.append(h('p', null, 'The session state now holds your values. Reload the page: SugarCube resumes the session state.'), h('div', { class: 'btns' }, h('button', { class: 'btn go', onclick: () => win.location.reload() }, 'Reload the page now')));
      } else {
        if (loader) sheet.append(h('p', null, 'This story publishes SugarCube’s Save API, so SaveForge can load it for you.'), h('div', { class: 'btns' }, h('button', { class: 'btn go', onclick: () => { try { loader.load(t); poll(); } catch (e) { toast(e.message, true); } } }, `Load ${t.label} in the game now`)));
        sheet.append(
          h('h3', null, loader ? 'Or load it yourself' : 'Load it in the game'),
          h('ol', null, [
            h('li', null, 'Tap – to shrink SaveForge.'),
            h('li', null, 'Open the game’s Saves menu (usually “Saves” in the left sidebar or the game’s menu).'),
            h('li', null, `Load ${t.label}${t.kind === 'slot' ? ' — the one marked “(SaveForge edit)” if it was copied' : ''}.`),
            h('li', null, 'SaveForge checks the game right after it loads and shows ✓ here.'),
          ]),
          h('div', { class: 'note' }, 'Do not reload the web page for this: a reload resumes the running session, not your save.'),
          h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => ctx.minimize?.() }, 'Shrink SaveForge')),
        );
      }
    } else {
      sheet.append(h('p', { class: 'note' }, 'Verified from the game’s own session state, which SugarCube writes after loading. Keep playing; the game’s next autosave will carry these values.'));
    }
    sheet.append(
      h(
        'div',
        { class: 'btns' },
        h('button', { class: 'btn', onclick: () => undoWrite() }, 'Undo this write'),
        h('button', { class: 'btn', onclick: () => { pending = null; store?.set?.('sc-verify', null); v.fresh = true; v.edits = null; renderAll(); } }, st.state === 'verified' ? 'Done' : 'Start over'),
      ),
    );
    bodyEl.append(sheet);
    setDesc('Load the edited save in the game; SaveForge verifies it.');
  }

  function undoWrite() {
    if (!pending?.undo) return;
    if (!win.confirm('Put the save storage back exactly as it was before this write?')) return;
    const u = pending.undo;
    try {
      if (u.raw === null || u.raw === undefined) win[u.store].removeItem(u.key);
      else win[u.store].setItem(u.key, u.raw);
      pending = null;
      store?.set?.('sc-verify', null);
      toast('Write undone: the save storage is back to before');
      renderAll();
    } catch (e) {
      toast(e.message, true);
    }
  }

  return {
    render,
    status,
    hasSaves: () => readSugarCubeStorage(win).saves.length > 0,
    pending: () => pending,
    dispose: () => {
      win.clearInterval(pollTimer);
      pollTimer = 0;
    },
    timers: () => (pollTimer ? 1 : 0),
  };
}

function safeOrigin(win) {
  try {
    return win.location.origin;
  } catch {
    return '';
  }
}
