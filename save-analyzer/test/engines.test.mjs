import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import LZString from 'lz-string';
import pako from 'pako';
import { analyzeFile, EditSession } from '../src/core/document.js';
import { hasPython, readSample } from './helpers.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'sf-engines-'));
const byLabel = (doc, label) => {
  const e = doc.menu.all.find((x) => x.label === label);
  assert.ok(e, `menu entry "${label}" missing`);
  return e.nodeId;
};
const pyVerify = (bytes) => {
  const p = join(tmp, `out-${Math.random().toString(36).slice(2)}`);
  writeFileSync(p, bytes);
  return JSON.parse(execFileSync('python3', ['-I', new URL('../tools/verify_renpy.py', import.meta.url).pathname, p]).toString());
};

const expectations = {
  'renpy8-1-1-LT1.save': ['renpy-save', 'ZIP'],
  'renpy-legacy-protocol2.save': ['renpy-save', 'ZIP'],
  'renpy-protocol0.save': ['renpy-save', 'ZIP'],
  'renpy-persistent-unsigned': ['renpy-persistent', 'zlib › Python pickle v5'],
  'renpy-persistent-signed': ['renpy-persistent', 'zlib › Python pickle v5'],
  'rpgmaker-mv-file1.rpgsave': ['rpgmaker-mv', 'UTF-8 text › LZString (Base64) › JSON'],
  'rpgmaker-mz-file1.rmmzsave': ['rpgmaker-mz', 'UTF-8 text › Binary string › zlib › UTF-8 text › JSON'],
  'sugarcube-the-lantern-road.save': ['sugarcube', 'UTF-8 text › LZString (Base64) › JSON'],
  'sandbox-base64.txt': ['generic', 'UTF-8 text › Base64 › UTF-8 text › JSON'],
  'sandbox-gzip.save': ['generic', 'gzip › UTF-8 text › JSON'],
  'sandbox-plain.json': ['generic', 'UTF-8 text › JSON'],
  'gamemaker-save.ini': ['ini', 'UTF-8 text › INI'],
  'storage-dump-example.json': ['storage-dump', 'UTF-8 text › JSON'],
};

for (const [name, [engine, chain]] of Object.entries(expectations)) {
  test(`${name} is identified as ${engine}`, async () => {
    const res = await analyzeFile(name, readSample(name));
    assert.ok(res.ok);
    assert.equal(res.doc.engine.id, engine);
    assert.equal(res.doc.chain.describe(), chain);
  });
}

for (const name of ['renpy8-1-1-LT1.save', 'renpy-legacy-protocol2.save', 'renpy-protocol0.save']) {
  test(`${name}: edits load correctly in CPython; shared objects and signature handled`, { skip: !hasPython() }, async () => {
    const { doc } = await analyzeFile(name, readSample(name));
    const s = new EditSession(doc);
    s.set([
      { id: byLabel(doc, 'money'), value: '999999' },
      { id: byLabel(doc, 'player_name'), value: 'Zoë ✨' },
      { id: byLabel(doc, 'met_alex'), value: false },
      { id: byLabel(doc, 'stamina'), value: '99.25' },
      { id: byLabel(doc, 'mira_love'), value: '100' },
      { id: byLabel(doc, 'big_number'), value: '-123456789012345678901234567890' },
      { id: byLabel(doc, 'inventory › items › potion'), value: '250' },
    ]);
    const out = await s.export();
    assert.ok(out.validation.ok, out.validation.problems.join('\n'));
    const py = pyVerify(out.bytes);
    const R = py.roots;
    assert.equal(R['store.money'], 999999);
    assert.equal(R['store.player_name'], 'Zoë ✨');
    assert.equal(R['store.companion_name'], 'Mira', 'memo-shared string not changed at its other reference');
    assert.equal(R['store.met_alex'], false);
    assert.equal(R['store.stamina'], 99.25);
    assert.equal(R['store.mira_love'], 100);
    assert.deepEqual(R['store.big_number'], { bigint: '-123456789012345678901234567890' });
    assert.deepEqual(R['store.inventory'].items, { potion: 250, ether: 1, key_red: 1 });
    assert.equal(R['store.day'], 4, 'unrelated value untouched');
    assert.equal(py.log_inventory_is_root, true, 'object identity inside the rollback log is preserved');
    assert.deepEqual(py.names, ['screenshot.png', 'extra_info', 'json', 'renpy_version', 'log', ...(name.startsWith('renpy8') ? ['signatures'] : [])]);
    if (name.startsWith('renpy8')) assert.equal(py.signatures, '', "stale signature is cleared so Ren'Py prompts instead of refusing");
  });
}

test("Ren'Py rollback log and internal store variables are hidden from the menu by default", async () => {
  const { doc } = await analyzeFile('x.save', readSample('renpy8-1-1-LT1.save'));
  const internal = doc.menu.categories.find((c) => c.id === 'internal');
  assert.ok(internal.hiddenByDefault);
  const labels = doc.menu.all.filter((e) => e.category !== 'internal').map((e) => e.label);
  assert.ok(labels.includes('money'));
  assert.ok(!labels.some((l) => /_version|_rollback|rollback_limit/.test(l)));
});

test('unsigned persistent is editable and verified by CPython; signed persistent is read-only', { skip: !hasPython() }, async () => {
  const u = (await analyzeFile('persistent', readSample('renpy-persistent-unsigned'))).doc;
  const s = new EditSession(u);
  s.set({ id: byLabel(u, 'persistent.endings_seen'), value: 9 });
  const out = await s.export();
  assert.ok(out.validation.ok);
  assert.equal(pyVerify(out.bytes).persistent.endings_seen, 9);

  const signed = (await analyzeFile('persistent', readSample('renpy-persistent-signed'))).doc;
  assert.equal(signed.menu.all.length, 0);
  const anyLeaf = [...signed.index.byId.values()].find((n) => n.type === 'int');
  assert.match(anyLeaf.meta.readOnlyReason, /signature/);
  assert.throws(() => new EditSession(signed).set({ id: anyLeaf.id, value: 1 }), /signature/);
  await assert.rejects(signed.export(new Map([[anyLeaf.id, 1]])), /read-only/);
});

test('RPG Maker MV: output decodes with the real lz-string and keeps JsonEx ids', async () => {
  const { doc } = await analyzeFile('file1.rpgsave', readSample('rpgmaker-mv-file1.rpgsave'));
  const s = new EditSession(doc);
  s.set([
    { id: byLabel(doc, 'Gold'), value: 99999 },
    { id: byLabel(doc, 'Reid · HP'), value: 999 },
    { id: byLabel(doc, 'Item #7'), value: 99 },
  ]);
  const sw = doc.menu.categories.find((c) => c.id === 'flags').groups.find((g) => g.label === 'RPG Maker switches');
  assert.equal(sw.entries.length, 24);
  s.set({ id: sw.entries[0].nodeId, value: true });
  const out = await s.export();
  const json = JSON.parse(LZString.decompressFromBase64(new TextDecoder().decode(out.bytes)));
  assert.equal(json.party._gold, 99999);
  assert.equal(json.actors._data['@a'][1]._hp, 999);
  assert.equal(json.party._items['7'], 99);
  assert.equal(json.switches._data['@a'][1], true);
  assert.equal(json.party['@c'], 17);
  const ids = [...doc.index.byId.values()].filter((n) => n.key === '@c');
  assert.ok(ids.length > 10 && ids.every((n) => !n.editable));
});

test('RPG Maker MZ: output inflates with pako exactly like StorageManager.zipToJson', async () => {
  const { doc } = await analyzeFile('file1.rmmzsave', readSample('rpgmaker-mz-file1.rmmzsave'));
  const s = new EditSession(doc);
  s.set({ id: byLabel(doc, 'Gold'), value: 123456 });
  const out = await s.export();
  const binaryString = new TextDecoder().decode(out.bytes); // fs.readFileSync(path, {encoding: "utf8"})
  const json = JSON.parse(pako.inflate(Uint8Array.from(binaryString, (c) => c.charCodeAt(0)), { to: 'string' }));
  assert.equal(json.party._gold, 123456);
});

test('SugarCube: variables are exposed with $ names and re-import through lz-string', async () => {
  const { doc } = await analyzeFile('x.save', readSample('sugarcube-the-lantern-road.save'));
  const s = new EditSession(doc);
  s.set([
    { id: byLabel(doc, '$gold'), value: 5000 },
    { id: byLabel(doc, '$metOracle'), value: false },
    { id: byLabel(doc, '$inventory.torch'), value: 40 },
  ]);
  const out = await s.export();
  const save = JSON.parse(LZString.decompressFromBase64(new TextDecoder().decode(out.bytes)));
  const vars = save.state.history[0].variables;
  assert.deepEqual([vars.gold, vars.metOracle, vars.inventory.torch, vars.health], [5000, false, 40, 70]);
});

test('Storage dump: nested Ren\'Py web save inside IndexedDB bytes is decoded and rebuilt', { skip: !hasPython() }, async () => {
  const { doc } = await analyzeFile('dump.json', readSample('storage-dump-example.json'));
  const money = doc.menu.all.find((e) => e.key === 'store.money');
  const rpgGold = doc.menu.all.find((e) => e.label === 'Gold');
  assert.ok(money && rpgGold);
  const s = new EditSession(doc);
  s.set([
    { id: money.nodeId, value: 31337 },
    { id: rpgGold.nodeId, value: 777 },
  ]);
  const out = await s.export();
  assert.ok(out.validation.ok, out.validation.problems.join('\n'));
  const dump = JSON.parse(new TextDecoder().decode(out.bytes));
  const rec = dump.indexedDB[0].stores[0].records[0];
  assert.equal(rec.value.contents.$type, 'Uint8Array');
  assert.equal(pyVerify(Buffer.from(rec.value.contents.base64, 'base64')).roots['store.money'], 31337);
  assert.equal(JSON.parse(LZString.decompressFromBase64(dump.localStorage['RPG File1'])).party._gold, 777);
  assert.equal(dump.localStorage.plainNumber, '42');
});

test('INI: decimals formatting is kept (GameMaker writes 6 decimals)', async () => {
  const { doc } = await analyzeFile('save.ini', readSample('gamemaker-save.ini'));
  const s = new EditSession(doc);
  s.set({ id: byLabel(doc, 'Kit · Gold'), value: '99999' });
  const out = await s.export();
  assert.match(new TextDecoder().decode(out.bytes), /\r\ngold="99999\.000000"\r\n/);
});
