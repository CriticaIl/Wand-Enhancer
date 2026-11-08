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
  assert.deepEqual(SECTIONS.map((s) => s.name), ['Player', 'Money', 'Inventory', 'World', 'Story', 'Unlocks', 'Advanced']);
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
