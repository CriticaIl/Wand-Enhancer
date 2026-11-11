// SaveForge 2.3.1: the Python SaveForge sends to Ren'Py web, run with CPython the way Ren'Py runs
// it (py_exec in the store namespace, tools/renpy_exec_harness.py). Python 2 (Ren'Py 7 web
// builds) is not available here: the script is written for both, but only Python 3 is tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renpyCommand } from '../src/trainer/renpy-live.js';
import { hasPython } from './helpers.mjs';

const skip = !hasPython() && 'python3 not installed';
const HARNESS = new URL('../tools/renpy_exec_harness.py', import.meta.url).pathname;

function run(ops) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-renpy-'));
  const file = join(dir, 'cmds.txt');
  writeFileSync(file, ops.map((o, i) => renpyCommand({ cb: '__cb', id: i + 1, ...o })).join('\n'));
  const out = JSON.parse(execFileSync('python3', ['-I', HARNESS, file]).toString());
  out.answers = out.replies.map((r) => {
    const m = /^window\["__cb"\] && window\["__cb"\]\((.*)\)$/s.exec(r);
    assert.ok(m, `reply shape: ${r.slice(0, 80)}`);
    return JSON.parse(m[1]);
  });
  return out;
}

test('the command is one expression statement and creates no store variable (not even “result”)', { skip }, () => {
  const cmd = renpyCommand({ op: 'list', cb: '__cb', id: 1 });
  assert.match(cmd, /^exec\(__import__\('base64'\)\.b64decode\('[A-Za-z0-9+/=]+'\)\.decode\('utf-8'\), \{'__builtins__': __builtins__\}\)$/);
  const r = run([{ op: 'list' }, { op: 'get', paths: [[['a', 'money']]] }, { op: 'set', path: [['a', 'money'], ], value: 500 }]);
  assert.deepEqual(r.new_store_names, [], 'nothing added to the store (it would end up in the saves)');
  assert.equal(r.store.result, "the game's own variable called result", 'a game variable named result is untouched (renpy_exec would overwrite it)');
});

test('list: the game’s variables only (ever_been_changed), simple values, nested one level, read-only where JavaScript cannot hold them', { skip }, () => {
  const [a] = run([{ op: 'list' }]).answers;
  assert.equal(a.ok, true, a.error);
  const byPath = new Map(a.data.vars.map((v) => [v.p.map((s) => s[1]).join('.'), v]));
  for (const k of ['money', 'day', 'met_lucy', 'player_name', 'affection.eileen', 'affection.lucy', 'inventory.0', 'inventory.1', 'player.hp', 'player.max_hp', 'player.name', 'ratio', 'result']) assert.ok(byPath.has(k), `${k} listed`);
  for (const k of ['mouse_visible', 'suppress_overlay', 'config_like', '_private', 'helper', 'player._secret', 'long_text', 'player.items']) assert.ok(!byPath.has(k), `${k} not listed`);
  assert.equal(byPath.get('money').t, 'int');
  assert.equal(byPath.get('money').v, 120);
  assert.equal(byPath.get('met_lucy').t, 'bool');
  assert.equal(byPath.get('ratio').t, 'float');
  assert.deepEqual(byPath.get('player.hp').p, [['a', 'player'], ['a', 'hp']], 'object attribute path');
  assert.deepEqual(byPath.get('affection.eileen').p, [['a', 'affection'], ['k', 'eileen']], 'dict key path');
  assert.deepEqual(byPath.get('inventory.0').p, [['a', 'inventory'], ['i', 0]], 'list index path');
  assert.equal(byPath.get('huge').ro, 'a number too large for JavaScript');
  assert.equal(byPath.get('huge').v, '12345678901234567890', 'kept exact, as text');
  assert.equal(byPath.get('not_finite').ro, 'not a finite number');
  assert.equal(byPath.get('position.0').ro, 'a tuple cannot be changed');
  assert.equal(a.data.version, '8.3.7');
  assert.equal(a.data.name, 'Harness Story');
  const all = run([{ op: 'list', all: true }]).answers[0].data.vars.map((v) => v.p[0][1]);
  assert.ok(all.includes('mouse_visible'), 'Ren’Py’s own variables on request');
  const capped = run([{ op: 'list', max: 3 }]).answers[0].data;
  assert.equal(capped.vars.length, 3, 'capped');
});

test('set: same type as the game’s value, written through the store, read back, screens restarted', { skip }, () => {
  const r = run([
    { op: 'set', path: [['a', 'money']], value: 500 },
    { op: 'set', path: [['a', 'player'], ['a', 'hp']], value: 7 },
    { op: 'set', path: [['a', 'affection'], ['k', 'lucy']], value: 4 },
    { op: 'set', path: [['a', 'inventory'], ['i', 1]], value: 'lamp' },
    { op: 'set', path: [['a', 'met_lucy']], value: 1 }, // a number where the game keeps true/false
    { op: 'set', path: [['a', 'money']], value: 'lots' }, // text where the game keeps a number
    { op: 'set', path: [['a', 'money']], value: 1.5 }, // a fraction where it keeps a whole number
    { op: 'set', path: [['a', 'position'], ['i', 0]], value: 9 }, // a tuple
    { op: 'set', path: [['a', 'nope']], value: 1 },
    { op: 'get', paths: [[['a', 'money']], [['a', 'player'], ['a', 'hp']], [['a', 'missing']]] },
  ]);
  const [m, hp, lucy, inv, b, t1, t2, tup, nope, get] = r.answers;
  assert.deepEqual([m.ok, m.data.v], [true, 500]);
  assert.deepEqual([hp.ok, hp.data.v], [true, 7]);
  assert.deepEqual([lucy.ok, lucy.data.v], [true, 4]);
  assert.deepEqual([inv.ok, inv.data.v], [true, 'lamp']);
  assert.equal(b.ok, false);
  assert.match(b.error, /true\/false/);
  assert.equal(t1.ok, false);
  assert.match(t1.error, /whole number/);
  assert.equal(t2.ok, false);
  assert.equal(tup.ok, false);
  assert.match(tup.error, /tuple/);
  assert.equal(nope.ok, false);
  assert.deepEqual(get.data.values, [{ ok: true, v: 500, t: 'int' }, { ok: true, v: 7, t: 'int' }, { ok: false }]);
  assert.deepEqual(r.store, { money: 500, met_lucy: true, hp: 7, affection: { eileen: 3, lucy: 4 }, inventory: ['key', 'lamp'], result: "the game's own variable called result" });
  assert.equal(r.restarts, 4, 'renpy.restart_interaction() after each successful change');
});

test('input (Input Inspector, 2.3.3): the statement waiting for renpy.input and the conditions after it, read as text', { skip }, async () => {
  const { renpyAnswers } = await import('../src/trainer/input-inspector.js');
  const r = run([{ op: 'input' }]);
  const [a] = r.answers;
  assert.equal(a.ok, true, a.error);
  assert.deepEqual(a.data.current, { type: 'Python', file: 'game/script.rpy', line: 40, source: 'answer = renpy.input("The password?", length=20)' });
  assert.deepEqual(a.data.steps.map((s) => s.source), ['answer = answer.strip().lower()']);
  assert.deepEqual(a.data.checks.map((c) => c.cond), ['answer == "swordfish"', 'answer in ("open sesame", "mellon")', 'True', 'answer != "again"']);
  assert.deepEqual(a.data.checks[0].then, [{ jump: 'vault' }]);
  assert.equal(a.data.checks[3].loop, true);
  assert.deepEqual(r.new_store_names, [], 'nothing added to the store');
  // and SaveForge's reading of it
  const res = renpyAnswers(a.data);
  assert.deepEqual(res.answers.map((x) => x.value), ['swordfish', 'open sesame', 'mellon', 'again']);
  assert.ok(res.answers.every((x) => x.notes.some((n) => /letter case does not matter/.test(n))));
  assert.equal(res.answers[0].evidence.where, 'game/script.rpy:43');
  assert.match(res.answers[3].how, /NOT this/, 'while answer != "again": the loop ends when it is "again"');
});
