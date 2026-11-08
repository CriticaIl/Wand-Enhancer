import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFile, EditSession } from '../src/core/document.js';
import { editableNodes, mutate, readSample, sampleNames } from './helpers.mjs';

const samples = sampleNames();

test('sample set is present', () => {
  assert.ok(samples.length >= 12, `found ${samples.length} samples`);
});

for (const name of samples) {
  test(`${name}: decodes, and exporting without edits is byte-identical`, async () => {
    const bytes = readSample(name);
    const res = await analyzeFile(name, bytes);
    assert.ok(res.ok, res.reasons?.join('; '));
    const out = await res.doc.export(new Map());
    assert.deepEqual(out.bytes, bytes);
    assert.ok(out.validation.ok, out.validation.problems.join('\n'));
  });

  test(`${name}: editing every editable field round-trips with types preserved`, async () => {
    const res = await analyzeFile(name, readSample(name));
    const doc = res.doc;
    const nodes = editableNodes(doc);
    if (!nodes.length) {
      assert.ok(doc.chain.readOnlyReason || [...doc.index.byId.values()].some((n) => n.meta.readOnlyReason), 'no editable fields and no read-only reason');
      return;
    }
    const edits = new Map(nodes.map((n) => [n.id, mutate(n)]));
    const out = await doc.export(edits);
    assert.ok(out.validation.ok, out.validation.problems.join('\n'));
    assert.ok(out.validation.checked > 0);

    // independent second pass: decode the output and compare every field
    const again = await analyzeFile(name, out.bytes);
    assert.ok(again.ok);
    for (const n of nodes) {
      const m = again.doc.node(n.id);
      assert.equal(m.type, n.type, `${n.id} type`);
      assert.deepEqual(m.value, edits.get(n.id), `${n.id} value`);
    }
    assert.equal(again.doc.engine.id, doc.engine.id, 'engine detection is stable');
    assert.equal(again.doc.chain.describe(), doc.chain.describe(), 'encoding chain is stable');
  });
}

test('single edit leaves every other byte region intact (JSON splice)', async () => {
  const name = 'sandbox-plain.json';
  const original = new TextDecoder().decode(readSample(name));
  const res = await analyzeFile(name, readSample(name));
  const coins = res.doc.menu.all.find((e) => e.key === 'coins');
  const out = await res.doc.export(new Map([[coins.nodeId, 999999]]));
  assert.equal(new TextDecoder().decode(out.bytes), original.replace('"coins": 4200', '"coins": 999999'));
});

test('integers above 2^53 are never rounded', async () => {
  const text = '{"seed": 123456789012345678901234567890, "n": 1}';
  const res = await analyzeFile('x.json', new TextEncoder().encode(text));
  const out = await res.doc.export(new Map([['$/n', 2]]));
  assert.equal(new TextDecoder().decode(out.bytes), '{"seed": 123456789012345678901234567890, "n": 2}');
});

test('edit session: undo, redo, revert, reset and diff', async () => {
  const res = await analyzeFile('sandbox-plain.json', readSample('sandbox-plain.json'));
  const s = new EditSession(res.doc);
  const id = res.doc.menu.all.find((e) => e.key === 'coins').nodeId;
  const lvl = res.doc.menu.all.find((e) => e.key === 'level').nodeId;
  assert.throws(() => s.set({ id, value: '12.5' }), /whole number/);
  assert.throws(() => s.set({ id, value: 'abc' }));
  assert.equal(s.edits.size, 0, 'invalid input applies nothing');
  s.set({ id, value: '5000' });
  s.set([{ id, value: 6000 }, { id: lvl, value: 50 }], 'batch');
  assert.equal(s.value(id), 6000);
  s.undo();
  assert.equal(s.value(id), 5000);
  assert.equal(s.value(lvl), 6);
  s.redo();
  assert.equal(s.value(lvl), 50);
  assert.equal(s.diff().length, 2);
  s.revert(lvl);
  assert.equal(s.isEdited(lvl), false);
  s.reset();
  assert.equal(s.edits.size, 0);
  s.undo();
  assert.equal(s.value(id), 6000);
  // setting a value back to the original removes the edit
  s.set({ id, value: 4200 });
  assert.equal(s.isEdited(id), false);
});

test('booleans, floats and strings are validated by type', async () => {
  const res = await analyzeFile('sandbox-plain.json', readSample('sandbox-plain.json'));
  const s = new EditSession(res.doc);
  const find = (k) => res.doc.menu.all.find((e) => e.key === k).nodeId;
  assert.throws(() => s.set({ id: find('workshop'), value: 'maybe' }), /true or false/);
  assert.throws(() => s.set({ id: find('energy'), value: '1e999' }), /finite/);
  s.set({ id: find('energy'), value: '12.75' });
  s.set({ id: find('language'), value: 'de' });
  const out = await s.export();
  assert.ok(out.validation.ok);
});
