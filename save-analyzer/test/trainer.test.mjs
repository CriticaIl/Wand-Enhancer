import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFile } from '../src/core/document.js';
import { explain, PATTERN_IDS } from '../src/core/explain.js';
import { pathOf } from '../src/core/model.js';
import { generateModMenu } from '../src/core/modmenu.js';
import { buildLiveTree, coerceLive } from '../src/trainer/live-tree.js';
import { LiveProvider, SECTION_OF, SECTIONS } from '../src/trainer/providers.js';
import { readSample } from './helpers.mjs';

const memStore = () => {
  const kv = new Map();
  const backups = [];
  return {
    get: async (k, d) => (kv.has(k) ? kv.get(k) : d),
    set: async (k, v) => kv.set(k, v),
    addBackup: async (r) => (backups.unshift({ ...r, id: backups.length }), backups[0]),
    backups: async () => backups,
    _backups: backups,
  };
};

function explainLive(obj, path, channel = 'live') {
  const snap = buildLiveTree(obj);
  const ids = new Map();
  (function walk(n, parents) {
    ids.set(n.id, { n, parents });
    for (const c of n.children || []) walk(c, [...parents, n]);
  })(snap.root, []);
  const id = `$/${path.join('/')}`;
  const { n, parents } = ids.get(id);
  return explain(n, parents, { channel });
}

// ---------------------------------------------------------------- explanation engine

test('explanations recognise common variable patterns with honest confidence', () => {
  const game = { player: { name: 'Ana', hp: 40, maxHp: 100, level: 3, exp: 250, str: 7 }, gold: 10, inventory: { potion: 3 }, flags: { metKing: true }, ana_love: 12, day: 4, lastSaved: 1731000000123, playerId: 7, checksum: 'ab12', zzq: 5, qqv: true };
  const hp = explainLive(game, ['player', 'hp']);
  assert.match(hp.controls, /Ana’s current HP/);
  assert.match(hp.effect, /maximum \(“maxHp” = 100\)/);
  assert.ok(hp.sideEffects.some((s) => /maxHp/.test(s)));
  assert.equal(hp.confidence.level, 'Medium');

  assert.match(explainLive(game, ['player', 'maxHp']).controls, /maximum\/cap for HP/i);
  assert.match(explainLive(game, ['player', 'level']).sideEffects.join(' '), /exp/i);
  assert.match(explainLive(game, ['gold']).controls, /currency/);
  assert.match(explainLive(game, ['inventory', 'potion']).controls, /how many “Potion”/);
  assert.match(explainLive(game, ['flags', 'metKing']).controls, /story event|unlocked|condition/);
  assert.match(explainLive(game, ['ana_love']).controls, /relationship.*Ana/);
  assert.match(explainLive(game, ['day']).controls, /calendar/);
  assert.match(explainLive(game, ['lastSaved']).controls, /timestamp.*milliseconds/);
  assert.equal(explainLive(game, ['playerId']).risk, 'high');
  assert.match(explainLive(game, ['checksum']).effect, /reject|reset/);

  // unknown names: low confidence, explicitly not recognised
  const unknown = explainLive(game, ['zzq']);
  assert.equal(unknown.confidence.level, 'Unknown');
  assert.match(unknown.controls, /not recognised/);
  assert.match(unknown.confidence.reasons.join(' '), /No recognised naming pattern/);
  assert.equal(explainLive(game, ['qqv']).confidence.level, 'Unknown');
});

test('timing text distinguishes live, live-generic, reload and file edits', () => {
  const g = { gold: 1 };
  assert.match(explainLive(g, ['gold'], 'live').timing.text, /immediately/);
  assert.match(explainLive(g, ['gold'], 'live-generic').timing.text, /overwrite/);
  assert.match(explainLive(g, ['gold'], 'reload').timing.text, /Apply & Reload/);
  assert.match(explainLive(g, ['gold'], 'file').timing.text, /exported save file/);
});

test('engine knowledge: RPG Maker fields are documented (high), Ren\'Py names are inferred (≤ medium)', async () => {
  const mv = (await analyzeFile('f.rpgsave', readSample('rpgmaker-mv-file1.rpgsave'))).doc;
  const gold = mv.menu.all.find((e) => e.label === 'Gold');
  const x = explain(mv.node(gold.nodeId), pathOf(gold.nodeId, mv.index).slice(0, -1), {});
  assert.equal(x.confidence.level, 'High');
  assert.match(x.controls, /^This controls the party’s gold/);

  const rp = (await analyzeFile('r.save', readSample('renpy8-1-1-LT1.save'))).doc;
  const love = rp.menu.all.find((e) => e.label === 'mira_love');
  const y = explain(rp.node(love.nodeId), pathOf(love.nodeId, rp.index).slice(0, -1), {});
  assert.match(y.controls, /^This likely controls relationship/);
  assert.ok(y.confidence.score <= 0.7, 'inferred meaning is capped below high confidence');
  assert.ok(y.sideEffects.some((s) => /rollback/.test(s)));
  assert.ok(y.confidence.reasons.some((r) => /Ren'Py store variable/.test(r)));
});

test('every generated explanation has all required sections (all samples)', async () => {
  for (const name of ['renpy8-1-1-LT1.save', 'rpgmaker-mz-file1.rmmzsave', 'sugarcube-the-lantern-road.save', 'sandbox-plain.json', 'gamemaker-save.ini', 'storage-dump-example.json']) {
    const { doc } = await analyzeFile(name, readSample(name));
    for (const e of doc.menu.all) {
      const x = explain(doc.node(e.nodeId), pathOf(e.nodeId, doc.index).slice(0, -1), { channel: 'file' });
      for (const k of ['controls', 'effect', 'type', 'progression', 'summary']) assert.ok(x[k] && typeof x[k] === 'string', `${name} ${e.label}: ${k}`);
      assert.ok(x.timing.label && x.timing.text);
      assert.ok(['High', 'Medium', 'Low', 'Unknown'].includes(x.confidence.level));
      assert.ok(x.confidence.reasons.length > 0);
    }
  }
  assert.ok(PATTERN_IDS.length >= 15);
});

// ---------------------------------------------------------------- live tree

test('live tree never invokes getters or functions, handles cycles and skips platform objects', () => {
  let getterCalls = 0;
  const state = { gold: 5, ratio: 0.5, name: 'x', on: true, fn() {}, bytes: new Uint8Array(4), map: new Map() };
  Object.defineProperty(state, 'computed', { enumerable: true, get: () => getterCalls++ });
  state.self = state;
  const snap = buildLiveTree({ state });
  assert.equal(getterCalls, 0);
  const keys = snap.root.children[0].children.map((c) => `${c.key}:${c.type}`);
  assert.deepEqual(keys.sort(), ['gold:int', 'name:string', 'on:bool', 'ratio:float', 'self:ref'].sort());
});

test('live tree respects node caps (huge object graphs stay bounded)', () => {
  const big = {};
  for (let i = 0; i < 5000; i++) big[`k${i}`] = { a: i, b: i };
  const snap = buildLiveTree({ big }, { maxNodes: 1000 });
  assert.equal(snap.count, 1000);
  assert.equal(snap.truncated, true);
});

test('coerceLive: JS numbers accept decimals, booleans/strings validated', () => {
  assert.equal(coerceLive({ type: 'int' }, '12.5'), 12.5);
  assert.throws(() => coerceLive({ type: 'int' }, 'lots'));
  assert.throws(() => coerceLive({ type: 'float' }, '1e400'));
  assert.equal(coerceLive({ type: 'bool' }, 'false'), false);
  assert.throws(() => coerceLive({ type: 'bool' }, 'maybe'));
});

// ---------------------------------------------------------------- live provider

test('LiveProvider: writes into live objects, undo/redo, engine hook, session-start restore', async () => {
  const game = { party: { gold: 100 }, flags: { door: false } };
  let hooks = 0;
  const engine = { id: 'test', name: 'Test', channel: 'live', note: '', snapshot: () => buildLiveTree(game), afterWrite: () => hooks++ };
  const store = memStore();
  const p = new LiveProvider({}, engine, store);
  const gold = p.entries.find((e) => e.key === 'gold').nodeId;
  const door = p.entries.find((e) => e.key === 'door').nodeId;
  p.set({ id: gold, value: '999' });
  p.set({ id: door, value: true });
  assert.equal(game.party.gold, 999);
  assert.equal(game.flags.door, true);
  assert.equal(hooks, 2);
  assert.ok(p.isEdited(gold));
  p.undo();
  assert.equal(game.flags.door, false);
  p.redo();
  assert.equal(game.flags.door, true);
  game.party.gold = 1500; // the game itself changes the value
  assert.equal(p.value(gold), 1500, 'reads are live');
  p.restoreSessionStart();
  assert.deepEqual(game, { party: { gold: 100 }, flags: { door: false } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(store._backups.length, 1);
  assert.equal(store._backups[0].values[gold], 100);
  assert.throws(() => p.set({ id: gold, value: 'abc' }));
  const info = p.explain(gold);
  assert.match(info.timing.text, /immediately/);
});

test('trainer sections cover every mod-menu category', () => {
  const cats = ['currency', 'resources', 'stats', 'progression', 'inventory', 'relationships', 'flags', 'unlocks', 'achievements', 'time', 'variables', 'text', 'other', 'internal'];
  for (const c of cats) assert.ok(SECTION_OF[c], c);
  assert.deepEqual(SECTIONS.map((s) => s.name), ['Player', 'Money', 'Inventory', 'World', 'Story', 'Unlocks', 'Potential game variables', 'Advanced']);
});

test('menu generation stays fast for 10,000+ variables', () => {
  const world = {};
  for (let i = 0; i < 4000; i++) world[`npc${i}`] = { name: `N${i}`, hp: i % 90, gold: i, met: i % 3 === 0 };
  const t0 = performance.now();
  const snap = buildLiveTree({ world });
  const menu = generateModMenu(snap.root);
  const ms = performance.now() - t0;
  assert.equal(menu.all.length, 16000);
  assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
});

test('game-state classifier: website globals out, game state in, mutation evidence counts', async () => {
  const { classifyGlobal, applyMutation, sampleNumbers, countChanges } = await import('../src/trainer/game-state.js');
  const out = (n, v) => classifyGlobal(n, v).kind;
  assert.equal(out('dataLayer', [{ event: 'x' }]), 'website');
  assert.equal(out('PokiSDK', { init() {} }), 'website');
  assert.equal(out('game', { id: 1, title: 'X', slug: 'x', plays: 100, rating: 4.5, thumb: 'https://a/b.png', url: '/game/x' }), 'website');
  assert.equal(out('siteConfig', { lang: 'en', cdn: 'https://x', theme: 'dark' }), 'website');
  assert.equal(out('state', { player: { hp: 10, maxHp: 20, level: 2 }, gold: 5, inventory: { potion: 1 } }), 'game');
  assert.equal(out('score', 10), 'game');
  assert.notEqual(out('isMobile', true), 'game');
  // values that change while the page runs push an ambiguous object over the line
  const ambiguous = { a: 1, b: 2, c: 3 };
  const r = classifyGlobal('mgr', ambiguous);
  assert.notEqual(r.kind, 'game');
  const s1 = sampleNumbers(ambiguous);
  ambiguous.a = 2;
  const changed = countChanges(s1, sampleNumbers(ambiguous));
  assert.equal(changed, 1);
  assert.equal(applyMutation(r, changed).kind, 'game');
  // known website globals never get mutation credit
  assert.equal(applyMutation(classifyGlobal('dataLayer', []), 5).kind, 'website');
});

test('regression 1.6: a custom game under a generic global is excluded by the whole-object classifier but found variable by variable', async () => {
  const { classifyGlobal, scoreLeaf } = await import('../src/trainer/game-state.js');
  const vm = await import('node:vm');
  const html = readFileSync(new URL('./fixtures/generic-app/index.html', import.meta.url), 'utf8');
  const code = html.split('<script>')[1].split('</script>')[0];
  const ctx = { addEventListener() {}, URLSearchParams, location: { search: '' } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  // the old verdict on the whole object: config, asset URLs and UI settings drown the game data
  assert.notEqual(classifyGlobal('app', ctx.app).kind, 'game', 'whole-object score excludes app (the bug users hit)');
  const leaf = (path, extra = {}) => {
    const keys = path.split('.');
    let v = ctx;
    for (const k of keys) v = v[k];
    const type = typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'float') : typeof v === 'boolean' ? 'bool' : 'string';
    return scoreLeaf({ key: keys.at(-1), type, value: v, parentKeys: keys.slice(0, -1), globalKind: classifyGlobal(keys[0], ctx[keys[0]]).kind, ...extra });
  };
  for (const p of ['argent', 'app.donnees.jour', 'app.donnees.clients', 'app.donnees.employes']) assert.equal(leaf(p).tier, 'game', p);
  for (const p of ['app.donnees.stock.croissant', 'app.donnees.prix.pain']) assert.notEqual(leaf(p).tier, 'excluded', p);
  for (const p of ['app.config.version', 'app.config.apiUrl', 'app.config.analyticsId', 'app.config.build', 'app.config.debug', 'app.assets.title', 'app.ui.volume', 'app.ui.theme', 'siteConfig.ads.refresh', 'siteConfig.cdn', 'pageMeta.plays', 'pageMeta.rating', 'pageMeta.thumb']) {
    const r = leaf(p);
    assert.equal(r.tier, 'excluded', `${p}: ${r.reasons.join('; ')}`);
    assert.ok(r.reasons.length, `${p} explains why`);
  }
  // evidence from the session: a cryptic counter that changes while playing is promoted;
  // a verified edit or the user's mark wins; "not a game variable" always hides
  assert.equal(leaf('app.donnees.cpt').tier, 'excluded');
  assert.equal(leaf('app.donnees.cpt', { changed: true }).tier, 'game');
  assert.equal(leaf('app.ui.volume', { mark: 'game' }).tier, 'game');
  assert.equal(leaf('app.donnees.fourOuvert', { verified: true }).tier, 'game');
  assert.equal(leaf('argent', { mark: 'not' }).tier, 'excluded');
  // a changing website value does not become game state (ad refresh timers, view counters)
  assert.equal(leaf('siteConfig.ads.refresh', { changed: true }).tier, 'excluded');
  assert.equal(leaf('pageMeta.plays', { changed: true, onScreen: true }).tier, 'excluded');
  // timestamps and big data tables stay out
  assert.equal(scoreLeaf({ key: 'n', type: 'int', value: 1731000000000, parentKeys: ['app', 'donnees'], globalKind: 'unknown' }).tier, 'excluded');
  assert.equal(scoreLeaf({ key: '17', type: 'int', value: 4, parentKeys: ['tables', 'curve'], globalKind: 'unknown', inLargeArray: true }).tier, 'excluded');
});

test('Linker code reader: finds written variables and called functions without running anything', async () => {
  const { writesIn, callsIn } = await import('../src/trainer/linker.js');
  const w = writesIn("document.getElementById('log').textContent = t; joueur.argent -= 30; ++app.data.coins; inv['potion'] = 2; player.name = this.value; if (a == b) x.y++;");
  const chains = w.map((x) => `${x.chain} ${x.op}`);
  assert.ok(chains.includes('joueur.argent -='));
  assert.ok(chains.includes('app.data.coins ++'));
  assert.ok(chains.includes('inv.potion ='));
  assert.ok(chains.includes('player.name ='));
  assert.ok(chains.includes('x.y ++'));
  assert.ok(!chains.some((c) => /textContent/.test(c)), 'DOM property writes are not variables');
  assert.ok(!chains.some((c) => /^a /.test(c)), 'comparisons are not assignments');
  assert.equal(w.find((x) => x.chain === 'player.name').rhs, 'this.value');
  assert.deepEqual(callsIn('if (ok) { buy(1); render(); } else alert("x")').sort(), ['alert', 'buy', 'render']);
});

test('scan budgets: one huge global cannot hide values in another; skipped text and getters are reported', () => {
  const dialogues = {};
  for (let i = 0; i < 15000; i++) dialogues[`line ${i}`] = { De: `Text ${i}`, Fr: `Texte ${i}` };
  const win = { dialogues, game: { a: { b: { c: { money: 28480799 } } } } };
  Object.defineProperty(win, 'secret', { get: () => 1, enumerable: true });
  // the 1.6/1.7 shape: one shared budget, dialogue first → money never reached
  const old = buildLiveTree(win, { rootKeys: ['dialogues', 'game'], maxNodes: 40000, maxDepth: 7 });
  assert.ok(!JSON.stringify(old.root).includes('28480799'), 'reproduces the regression');
  const t = buildLiveTree(win, { rootKeys: ['dialogues', 'game', 'secret'], maxNodes: 90000, maxDepth: 10, rootBudget: 20000, maxStrings: 4000 });
  assert.ok(JSON.stringify(t.root).includes('28480799'), 'money reached');
  assert.equal(t.report.roots.dialogues.strings, 4000);
  assert.equal(t.report.roots.dialogues.skippedStrings, 26000);
  assert.equal(t.report.roots.dialogues.cut, false);
  // a global bigger than its own budget is cut — and only that global
  const big = buildLiveTree(win, { rootKeys: ['dialogues', 'game'], maxNodes: 90000, maxDepth: 10, rootBudget: 10000, maxStrings: 4000 });
  assert.equal(big.report.roots.dialogues.cut, true);
  assert.ok(JSON.stringify(big.root).includes('28480799'));
  assert.equal(t.report.gettersCount, 1);
  assert.deepEqual(t.report.getters, ['$/secret']);
  // explicit engine getters are read on purpose (SugarCube.State.variables)
  const g = buildLiveTree({}, { rootKeys: ['SugarCube.State.variables'], rootGetters: { 'SugarCube.State.variables': () => ({ money: 5 }) } });
  assert.equal(g.root.children[0].children[0].value, 5);
});

test('save links: only engine layouts or verified observations link a save field to a live variable', async () => {
  const { SaveHub } = await import('../src/trainer/save-hub.js');
  const hub = new SaveHub({ setInterval: () => 1, clearInterval: () => {} }, memStore());
  const vals = { '$/a': 5, '$/b': 5, '$/d': 2, '$/c': 300 };
  const p = { engine: { id: 'generic' }, liveEntries: Object.keys(vals).map((nodeId) => ({ nodeId })), node: () => ({ type: 'int' }), value: (id) => vals[id] };
  hub.attached.add(p);
  hub.observeLive(p);
  const step = (before, after) => hub.matchObservations(new Map(Object.entries(before)), new Map(Object.entries(after)));
  // same value, nothing changed: never a link
  step({ S1: 5, S2: 300, S3: 2 }, { S1: 5, S2: 300, S3: 2 });
  assert.equal(hub.observed.size, 0);
  // two live values changed the same way: ambiguous, not merged
  vals['$/a'] = 6;
  vals['$/b'] = 6;
  hub.observeLive(p);
  step({ S1: 5 }, { S1: 6 });
  assert.equal(hub.observed.size, 0);
  assert.deepEqual(hub.possibleFor('S1').sort(), ['$/a', '$/b']);
  // a small, common value needs two matching changes
  vals['$/d'] = 3;
  hub.observeLive(p);
  step({ S3: 2 }, { S3: 3 });
  assert.equal(hub.observed.size, 0, 'one small change is not enough');
  vals['$/d'] = 4;
  hub.observeLive(p);
  step({ S3: 3 }, { S3: 4 });
  assert.equal(hub.observed.get('generic|$/d')?.saveId, 'S3');
  // a distinctive value (≥ 10, unique on both sides) links after one change
  vals['$/c'] = 4242;
  hub.observeLive(p);
  step({ S2: 300 }, { S2: 4242, S3: 4 });
  assert.equal(hub.observed.get('generic|$/c')?.saveId, 'S2');
  // a link the save stops following is dropped after two contradictions
  step({ S2: 4242 }, { S2: 17 });
  step({ S2: 17 }, { S2: 18 });
  assert.equal(hub.observed.has('generic|$/c'), false);
});

// ---------------------------------------------------------------- translation (offline)
test('translation: dictionary words are translations, abbreviations are guesses, unknown text is not invented', async () => {
  const { toEnglish, englishLabel } = await import('../src/core/translate.js');
  const t = (s) => toEnglish(s);
  const cases = [
    ['所持金', 'translation', 'Japanese', 'money held'],
    ['最大体力', 'translation', 'Japanese', 'maximum'],
    ['好感度', 'translation', 'Japanese', 'affection level'],
    ['金币数量', 'translation', 'Chinese', 'gold coins quantity'],
    ['경험치', 'translation', 'Korean', 'experience points'],
    ['золото', 'translation', 'Russian', 'gold'],
    ['уровеньИгрока', 'translation', 'Russian', 'level player'],
    ['monedasTotales', 'translation', 'Spanish', 'coins total'],
    ['pièces', 'translation', 'French', 'coins'],
    ['schlüsselAnzahl', 'translation', 'German', 'key number of'],
    ['moedas', 'translation', 'Portuguese', 'coins'],
    ['punteggio', 'translation', 'Italian', 'score'],
  ];
  for (const [src, kind, lang, en] of cases) {
    const r = t(src);
    assert.equal(r.kind, kind, `${src}: ${JSON.stringify(r)}`);
    assert.equal(r.languageName, lang, src);
    assert.ok(r.english.includes(en), `${src} → ${r.english}`);
    assert.equal(r.original, src, 'original preserved');
  }
  const abbr = t('atkBonus');
  assert.equal(abbr.kind, 'guess');
  assert.match(abbr.english, /attack bonus/);
  assert.equal(t('gold').kind, 'english');
  assert.equal(t('playerName').kind, 'english');
  const unknown = t('ヴァルハラ');
  assert.equal(unknown.kind, 'none', 'unknown Japanese word is not invented');
  assert.equal(unknown.languageName, 'Japanese');
  assert.equal(unknown.english, 'ヴァルハラ');
  const partial = t('¿Dónde está la llave?');
  assert.equal(partial.kind, 'partial');
  assert.match(partial.english, /key/);
  // labels keep structure and $ prefixes
  assert.equal(englishLabel('$monedas').text, '$Coins');
  assert.equal(englishLabel('Reid · HP').text, 'Reid · Health points');
  assert.equal(englishLabel('gold'), null);
});

// ---------------------------------------------------------------- verification
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
function liveWith(engine) {
  return new LiveProvider({}, { id: 't', name: 'Test', channel: 'live', note: '', ...engine }, memStore());
}

test('verification: verified, adjusted, reverted and failed are reported from the game object, not from SaveForge', async () => {
  const game = { gold: 10, hp: 50, score: 0, locked: 3 };
  const p = liveWith({
    root: () => game,
    snapshot: () => buildLiveTree(game),
    setter(id, ref, v) {
      if (id === '$/hp') {
        ref.obj.hp = Math.min(v, 100); // engine clamps
        return 'setHp()';
      }
      if (id === '$/locked') return 'noop()'; // engine ignores the write
      return false;
    },
  });
  const id = (k) => p.entries.find((e) => e.key === k).nodeId;
  const [g] = await p.set({ id: id('gold'), value: '999' }).verified;
  assert.equal(g.state, 'verified');
  assert.equal(game.gold, 999);
  const [h] = await p.set({ id: id('hp'), value: '500' }).verified;
  assert.equal(h.state, 'adjusted');
  assert.equal(h.observed, 100);
  const r = p.set({ id: id('score'), value: '77' }).verified;
  setTimeout(() => (game.score = 1), 100); // the game overwrites the edit
  assert.equal((await r)[0].state, 'reverted');
  assert.equal((await r)[0].observed, 1);
  const [f] = await p.set({ id: id('locked'), value: '9' }).verified;
  assert.equal(f.state, 'failed');
});

test('verification: edits follow the live object when the game replaces it (no stale snapshot writes)', async () => {
  const world = { state: { coins: 5 } };
  const p = liveWith({ root: () => world, snapshot: () => buildLiveTree(world) });
  const coins = p.entries.find((e) => e.key === 'coins').nodeId;
  const old = world.state;
  world.state = { ...world.state }; // the game rebuilt its state object after the scan
  const [st] = await p.set({ id: coins, value: '500' }).verified;
  assert.equal(st.state, 'verified');
  assert.equal(world.state.coins, 500, 'written to the object the game uses now');
  assert.equal(old.coins, 5, 'the stale copy was not touched');
  assert.equal(p.value(coins), 500);
});

test('lock: re-applies a value the game keeps overwriting, reports it, and stops when unlocked', async () => {
  const game = { gold: 10 };
  const p = liveWith({ root: () => game, snapshot: () => buildLiveTree(game) });
  const id = p.entries[0].nodeId;
  p.lock(id, 400);
  assert.equal(game.gold, 400);
  game.gold = 3;
  await tick(250);
  assert.equal(game.gold, 400);
  assert.ok(p.locks.get(id).reapplied >= 1);
  assert.equal(p.statusOf(id).state, 'locked');
  p.unlock(id);
  game.gold = 3;
  await tick(250);
  assert.equal(game.gold, 3);
  p.dispose();
});

test('restore original: one tap puts back the value from before SaveForge changed it', async () => {
  const game = { lives: 3 };
  const p = liveWith({ root: () => game, snapshot: () => buildLiveTree(game) });
  const id = p.entries[0].nodeId;
  await p.set({ id, value: '99' }).verified;
  await p.restoreOriginal(id).verified;
  assert.equal(game.lives, 3);
});

test('find a value: first and next scan narrow down to the real variable', async () => {
  const { firstScan, nextScan } = await import('../src/trainer/scan.js');
  const win = { shop: { price: 120 }, game: { player: { gold: 120, gems: 4 } }, ui: { label: '120' } };
  const r = firstScan(win, 120);
  assert.equal(r.paths.length, 3);
  win.game.player.gold = 90;
  win.ui.label = '90';
  const left = nextScan(win, r.paths, 90);
  assert.deepEqual(left.map((p) => p.join('.')).sort(), ['game.player.gold', 'ui.label']);
  // getters are never run while scanning
  let ran = 0;
  Object.defineProperty(win, 'trap', { enumerable: true, get: () => ran++ });
  firstScan(win, 1);
  assert.equal(ran, 0);
});

// ---------------------------------------------------------------- 1.5: sentences, search ranking, display helpers
test('translation of UI sentences: phrases, elision, word-by-word, partial marking', async () => {
  const { toEnglish } = await import('../src/core/translate.js');
  assert.deepEqual([toEnglish("Gagner de l'argent").english, toEnglish("Gagner de l'argent").kind], ['Earn money', 'translation']);
  assert.equal(toEnglish('Pas assez d’argent !').english, 'Not enough money');
  assert.equal(toEnglish('Acheter un ordinateur').english, 'buy a computer');
  const wbw = toEnglish('Vous avez gagné 50 pièces');
  assert.equal(wbw.kind, 'translation');
  assert.match(wbw.note, /word by word/);
  assert.equal(toEnglish('No tienes suficiente dinero').english, "You don't have enough money");
  assert.equal(toEnglish('お金が足りません').english, 'Not enough money');
  const partial = toEnglish('Le client est content');
  assert.equal(partial.kind, 'partial');
  assert.match(partial.english, /“content”/, 'unknown word shown in quotes, not guessed');
  assert.equal(toEnglish('Welcome to the store').kind, 'english');
});

function searchProvider(state) {
  return new LiveProvider({}, { id: 's', name: 'S', channel: 'live-generic', note: '', root: () => state, snapshot: () => buildLiveTree(state) }, memStore());
}

test('search: gameplay numbers rank above dialogue; aliases, translations and values match', async () => {
  const { searchEntries } = await import('../src/trainer/search.js');
  const state = {
    store: { money: 1822, customers: 4 },
    textes: { tuto: "Gagnez de l'argent en vendant des ordinateurs.", erreur: "Pas assez d'argent", bouton: 'Gagner de l’argent', moneyHint: 'Earn money by selling computers to customers.' },
    etat: { argent: 50, jour: 3 },
    player: { name: 'Vex', hp: 30 },
  };
  const p = searchProvider(state);
  const paths = (r) => r.results.map((x) => x.entry.path.replace(/^.*?› /, ''));
  const money = searchEntries(p, 'money');
  assert.equal(paths(money)[0], 'store › money', 'the real money variable first');
  assert.ok(paths(money).includes('etat › argent'), 'French “argent” found through its translation');
  assert.ok(!paths(money).some((x) => x.startsWith('textes')), 'dialogue hidden in gameplay mode');
  assert.ok(money.hiddenText >= 3);
  const all = searchEntries(p, 'money', { gameplayOnly: false });
  const iMoney = paths(all).indexOf('store › money');
  const iText = paths(all).findIndex((x) => x.startsWith('textes'));
  assert.ok(iText > iMoney, 'text matches come after gameplay numbers');
  assert.equal(paths(searchEntries(p, 'cash'))[0], 'store › money', 'alias');
  assert.deepEqual(paths(searchEntries(p, '1822')), ['store › money'], 'search by current value');
  assert.deepEqual(paths(searchEntries(p, '1 822')), ['store › money'], 'value with a thousands space');
  assert.equal(paths(searchEntries(p, 'day'))[0], 'etat › jour', 'English name of a French variable');
  assert.equal(paths(searchEntries(p, 'argent'))[0], 'etat › argent', 'original-language name');
  assert.ok(paths(searchEntries(p, 'name')).includes('player › name'), 'short names are gameplay text');
  // filters and exact mode
  assert.ok(searchEntries(p, 'money', { filter: 'text', gameplayOnly: false }).results.every((x) => p.node(x.entry.nodeId).type === 'string'));
  assert.ok(searchEntries(p, 'money', { filter: 'number' }).results.every((x) => p.node(x.entry.nodeId).type === 'int'));
  assert.deepEqual(paths(searchEntries(p, 'mon', { mode: 'exact' })), []);
  assert.ok(paths(searchEntries(p, 'mon')).includes('store › money'));
});

test('search stays fast with 10,000+ variables', async () => {
  const { searchEntries } = await import('../src/trainer/search.js');
  const world = {};
  for (let i = 0; i < 3500; i++) world[`npc${i}`] = { gold: i, hp: i % 90, line: `Bonjour voyageur numéro ${i}, as-tu de l'argent ?` };
  const p = searchProvider({ world });
  searchEntries(p, 'gold'); // first search builds the cached index
  const t0 = performance.now();
  const r = searchEntries(p, 'money');
  const ms = performance.now() - t0;
  assert.ok(r.total >= 3500, `total ${r.total}`);
  assert.equal(r.results.length, 1000, 'display list is capped');
  assert.ok(ms < 800, `search took ${ms.toFixed(0)} ms`);
});

test('display helpers: number forms and safe redraw candidates only', async () => {
  const { displayForms, redrawCandidates } = await import('../src/trainer/display.js');
  const forms = displayForms(1822);
  for (const f of ['1822', '1,822', '1 822', '1.822', '1.8K', '1.82K']) assert.ok(forms.has(f), f);
  const win = {
    afficherMagasin() {
      return document;
    },
    updateMoney() {
      el.textContent = 1;
    },
    update() {},
    refresh() {},
    tick() {},
    buyItem() {},
    ajouterArgent() {},
    changerOnglet(n) {
      return n;
    },
    renderAll() {},
  };
  const labels = redrawCandidates(win).map((c) => c.label);
  assert.deepEqual(labels.sort(), ['afficherMagasin()', 'renderAll()', 'updateMoney()']);
});

// ---------------------------------------------------------------- 2.0: SugarCube current moment, share codes, exact paths
test('SugarCube saves: the current moment of a delta-encoded history matches SugarCube’s own decoding (random histories)', async () => {
  const { historyDeltaEncode } = await import('./sugarcube-diff.mjs');
  const { decodeDelta, resolveSugarCubeSave } = await import('../src/adapters/sugarcube-moments.js');
  const { analyzeFile } = await import('../src/core/document.js');
  let seed = 7;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  const mutate = (v) => {
    const o = JSON.parse(JSON.stringify(v));
    for (let i = 0; i < 1 + rnd(4); i++) {
      const r = rnd(9);
      if (r < 3) o.player.money = rnd(5) === 0 ? 0 : rnd(40000000);
      else if (r === 3) o.player.items[`it${rnd(4)}`] = rnd(9);
      else if (r === 4) delete o.player.items[Object.keys(o.player.items)[0]];
      else if (r === 5) o.flags.push(`f${rnd(50)}`);
      else if (r === 6 && o.flags.length > 1) o.flags.splice(rnd(o.flags.length), 1 + rnd(2));
      else if (r === 7) o.day = rnd(30);
      else o.player.stats = rnd(2) ? { lust: rnd(100) } : 'gone'; // type change → whole Copy
    }
    return o;
  };
  const flat = (v, p = [], out = new Map()) => {
    if (v === null || typeof v !== 'object') return out.set(p.join('.'), v);
    for (const k of Object.keys(v)) flat(v[k], [...p, k], out);
    return out;
  };
  for (let run = 0; run < 300; run++) {
    let vars = { player: { money: 28480799, items: { partySupplies: 0 }, stats: { lust: 40 } }, day: 1, flags: ['a', 'b'] };
    const history = [{ title: 'p0', variables: vars }];
    for (let i = 1; i < 1 + rnd(6); i++) history.push({ title: `p${i}`, variables: (vars = mutate(vars)) });
    const index = rnd(history.length);
    const delta = historyDeltaEncode(history);
    assert.deepEqual(decodeDelta(delta), history, 'reference decode');
    const res = await analyzeFile('save.json', JSON.stringify({ id: 's', state: { delta, index }, date: 1 }));
    assert.ok(res.ok);
    const r = resolveSugarCubeSave(res.doc.root);
    const got = new Map([...r.current.values()].map((c) => [c.path.join('.'), res.doc.node(c.nodeId).value]));
    const want = flat(history[index].variables);
    assert.deepEqual(new Map([...got].sort()), new Map([...want].sort()), `run ${run}, index ${index}/${history.length}`);
    // the editor labels exactly the current values as $variables
    const shown = res.doc.menu.all.filter((e) => e.category !== 'internal' && e.label.startsWith('$')).map((e) => [e.label.slice(1), res.doc.node(e.nodeId).value]);
    assert.deepEqual(new Map(shown.sort()), new Map([...want].sort()));
  }
});

test('SugarCube saves stored with LZString compressToUTF16 (trailing space) decode, edit and rebuild', async () => {
  const LZ = await import('../src/core/lzstring.js');
  const { analyzeFile, EditSession } = await import('../src/core/document.js');
  const raw = LZ.compressToUTF16(JSON.stringify({ id: 'x', state: { history: [{ title: 'A', variables: { player: { money: 28480799 } } }], index: 0 }, date: 1 }));
  assert.ok(raw.endsWith(' '));
  const res = await analyzeFile('slot', raw);
  assert.ok(res.ok, res.reasons?.join('; '));
  const e = res.doc.menu.all.find((x) => x.label === '$player.money');
  assert.equal(res.doc.node(e.nodeId).value, 28480799);
  const s = new EditSession(res.doc);
  s.set({ id: e.nodeId, value: '1' });
  const out = await s.export();
  assert.ok(out.validation.ok, out.validation.problems.join('; '));
  const txt = typeof out.bytes === 'string' ? out.bytes : new TextDecoder().decode(out.bytes);
  assert.ok(txt.endsWith(' '), 'still UTF-16 LZString');
  assert.equal(JSON.parse(LZ.decompressFromUTF16(txt)).state.history[0].variables.player.money, 1);
});

test('share codes carry a save between the Save Editor and the trainer; exact SugarCube paths are understood', async () => {
  const { encodeShare, decodeShare, SHARE_PREFIX } = await import('../src/core/share.js');
  const text = encodeShare({ name: 'pasted-save.txt', input: 'N4Ig...', engine: 'sugarcube' });
  assert.ok(text.startsWith(SHARE_PREFIX));
  assert.deepEqual((({ name, input, engine, shared }) => ({ name, input, engine, shared }))(decodeShare(text)), { name: 'pasted-save.txt', input: 'N4Ig...', engine: 'sugarcube', shared: true });
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  assert.deepEqual([...decodeShare(encodeShare({ name: 'f.save', input: bytes })).input], [...bytes]);
  assert.equal(decodeShare('  {"plain":"save"} ').input, '{"plain":"save"}');
  assert.throws(() => decodeShare(`${SHARE_PREFIX}garbage!!`), /damaged/);
  const { parseStatePath } = await import('../src/trainer/inject.js');
  assert.deepEqual(parseStatePath('player.money'), ['variables', 'player', 'money']);
  assert.deepEqual(parseStatePath('$player.money'), ['variables', 'player', 'money']);
  assert.deepEqual(parseStatePath('State.variables.player.money'), ['variables', 'player', 'money']);
  assert.deepEqual(parseStatePath('SugarCube.State.variables.inv[2]'), ['variables', 'inv', '2']);
  assert.deepEqual(parseStatePath('_cost'), ['temporary', 'cost']);
  assert.deepEqual(parseStatePath('State.temporary.cost'), ['temporary', 'cost']);
  // search: an exact path outranks everything else
  const { searchEntries } = await import('../src/trainer/search.js');
  const p = {
    entries: [
      { nodeId: 'a', label: '$player.moneyBank', path: 'State.variables.player.moneyBank', key: 'moneyBank', category: 'currency' },
      { nodeId: 'b', label: '$player.money', path: 'State.variables.player.money', key: 'money', category: 'currency' },
    ],
    node: () => ({ type: 'int', editable: true }),
    value: () => 5,
  };
  for (const q of ['player.money', '$player.money', 'State.variables.player.money']) assert.equal(searchEntries(p, q).results[0].entry.nodeId, 'b', q);
});

test('SugarCube save writer: edits only the current moment, keeps the encoding, refuses stale writes, never invents variables', async () => {
  const { historyDeltaEncode } = await import('./sugarcube-diff.mjs');
  const { decodeDelta } = await import('../src/adapters/sugarcube-moments.js');
  const LZ = await import('../src/core/lzstring.js');
  const M = await import('../src/trainer/sugarcube-saves.js');
  const h = [
    { title: 'A', variables: { player: { money: 28480799, name: 'Max' }, day: 1 } },
    { title: 'B', variables: { player: { money: 28470000, name: 'Max' }, day: 1 } },
    { title: 'C', variables: { player: { money: 1, name: 'Max' }, day: 2 } },
  ];
  const state = { delta: historyDeltaEncode(h), index: 1 };
  const out = M.editState(state, [{ path: ['player', 'money'], value: '20480799' }]);
  const dec = decodeDelta(out.delta);
  assert.equal(dec[1].variables.player.money, 20480799, 'current moment edited');
  assert.equal(dec[0].variables.player.money, 28480799, 'earlier moment untouched');
  assert.equal(dec[2].variables.player.money, 1, 'future moment untouched');
  assert.equal(out.index, 1);
  assert.throws(() => M.editState(state, [{ path: ['player', 'gems'], value: 5 }]), /does not exist/);
  assert.throws(() => M.editState(state, [{ path: ['player', 'money'], value: 'lots' }]), /needs a number/);
  assert.deepEqual(M.parseVarPath('State.variables.player.money'), ['player', 'money']);
  assert.deepEqual(M.parseVarPath('$player.money'), ['player', 'money']);
  // storage: a 2.36 bundle in UTF-16 LZString + session state
  const bundle = { autosave: { id: 'x', state, title: 'B', date: 2 }, slots: [null, { id: 'x', state, title: 'B', date: 1 }] };
  const ls = new Map([['(Saved Games)x.saves', LZ.compressToUTF16(JSON.stringify(bundle))], ['other', 'not a save']]);
  const ss = new Map([['(Saved Games)x.state', LZ.compressToUTF16(JSON.stringify(state))]]);
  const fake = (m) => ({ get length() { return m.size; }, key: (i) => [...m.keys()][i], getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) });
  // a SugarCube story page (2.3.2: SugarCube saves are only ever this page's game on a SugarCube page)
  const document = { querySelector: (sel) => (sel === 'script#script-sugarcube' ? {} : null), getElementById: () => null };
  const win = { localStorage: fake(ls), sessionStorage: fake(ss), document };
  const sc = M.readSugarCubeStorage(win);
  assert.deepEqual(sc.saves.map((x) => x.label), ['Autosave', 'Slot 2']);
  assert.deepEqual(sc.free.map((x) => x.label), ['Slot 1']);
  assert.equal(M.currentVariables(sc.session.state).player.money, 28470000);
  const target = sc.free[0];
  const saveObj = { ...sc.saves[0].save, state: out };
  M.writeSave(win, target, saveObj, target.raw);
  const after = JSON.parse(LZ.decompressFromUTF16(ls.get('(Saved Games)x.saves')));
  assert.equal(decodeDelta(after.slots[0].state.delta)[1].variables.player.money, 20480799);
  assert.equal(decodeDelta(after.autosave.state.delta)[1].variables.player.money, 28470000, 'autosave untouched');
  // stale: the game saved after the workflow read it
  assert.throws(() => M.writeSave(win, target, saveObj, target.raw), (e) => e.conflict === true);
  // the session state the game writes after loading is what verifies it
  assert.equal(M.checkLoaded(win, [{ path: ['player', 'money'], value: '20480799' }]).state, 'waiting');
  ss.set('(Saved Games)x.state', LZ.compressToUTF16(JSON.stringify(out)));
  assert.equal(M.checkLoaded(win, [{ path: ['player', 'money'], value: '20480799' }]).state, 'verified');
  for (const codec of ['json', 'base64', 'utf16']) assert.deepEqual(M.decodeStored(M.encodeStored(bundle, codec)), { obj: bundle, codec });
});
