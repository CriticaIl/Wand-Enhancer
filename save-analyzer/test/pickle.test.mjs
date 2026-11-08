import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { latin1Encode } from '../src/core/bytes.js';
import { parsePickle, patchPickle, PickleError } from '../src/core/pickle.js';
import { PickleTerminal } from '../src/core/pickle-terminal.js';
import { hasPython } from './helpers.mjs';

const py = (code) => new Uint8Array(execFileSync('python3', ['-I', '-c', `import pickle,sys\n${code}`]));
const pyLoads = (bytes, expr = 'repr(v)') =>
  execFileSync('python3', ['-I', '-c', `import pickle,sys,json\nv=pickle.loads(sys.stdin.buffer.read())\nprint(${expr})`], { input: bytes }).toString().trim();

test('a malicious pickle is described, never executed', { skip: !hasPython() }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-'));
  const marker = join(dir, 'pwned');
  // os.system("touch <marker>") via REDUCE
  const evil = latin1Encode(`cos\nsystem\n(S'touch ${marker}'\ntR.`);
  const t = new PickleTerminal(evil, '$');
  assert.equal(t.root.type, 'instance');
  assert.equal(t.root.meta.className, 'os.system');
  assert.equal(existsSync(marker), false);
});

test('unknown opcodes and truncation fail loudly instead of guessing', () => {
  assert.throws(() => parsePickle(Uint8Array.of(0x80, 2, 0xff, 0x2e)), PickleError);
  assert.throws(() => parsePickle(Uint8Array.of(0x80, 2, 0x58, 10, 0, 0, 0, 0x61)), PickleError);
  assert.throws(() => parsePickle(Uint8Array.of(0x80, 2, 0x4e)), /STOP/);
});

for (const proto of [0, 1, 2, 3, 4, 5]) {
  test(`patching primitives keeps Python semantics (protocol ${proto})`, { skip: !hasPython() }, () => {
    const bytes = py(`
s = "shared"
d = {"i": 5, "neg": -70000, "big": 2**80, "f": 1.5, "t": True, "s": s, "s2": s, "u": "héllo", "n": None, "l": [1, s], "tup": (s, 3)}
sys.stdout.buffer.write(pickle.dumps(d, ${proto}))`);
    const t = new PickleTerminal(bytes, '$');
    const id = (k) => `$/${k}`;
    const edits = new Map([
      [id('i'), 1_000_000],
      [id('neg'), 3],
      [id('big'), -(2n ** 90n)],
      [id('f'), -0.25],
      [id('t'), false],
      [id('s'), 'changed ✓'],
      [id('u'), 'naïve \\ back\nslash'],
      [`${id('l')}/1`, 'list copy'],
    ]);
    return t.serialize(edits).then((out) => {
      const r = JSON.parse(
        pyLoads(out, 'json.dumps([v["i"],v["neg"],str(v["big"]),v["f"],v["t"],v["s"],v["s2"],v["u"],v["l"],list(v["tup"]),v["n"], v["l"][1] is v["s"]])'),
      );
      assert.deepEqual(r, [1000000, 3, String(-(2n ** 90n)), -0.25, false, 'changed ✓', 'shared', 'naïve \\ back\nslash', [1, 'list copy'], ['shared', 3], null, false]);
    });
  });
}

test('protocol 4/5 frames are recomputed after a size change', { skip: !hasPython() }, async () => {
  const bytes = py(`sys.stdout.buffer.write(pickle.dumps({"k": "v" * 70000, "x": "short"}, 5))`);
  const parsed = parsePickle(bytes);
  assert.ok(parsed.ops.some((o) => o.name === 'FRAME'));
  const t = new PickleTerminal(bytes, '$');
  const out = await t.serialize(new Map([['$/x', 'now a much longer string value than before']]));
  assert.equal(pyLoads(out, 'v["x"]'), 'now a much longer string value than before');
});

test('Python 2 byte strings keep their opcode family', async () => {
  // protocol 2, {'name': 'Bob'} using SHORT_BINSTRING (as Ren'Py 7 / Python 2 wrote it)
  const bytes = Uint8Array.of(0x80, 2, 0x7d, 0x71, 0, 0x55, 4, ...latin1Encode('name'), 0x71, 1, 0x55, 3, ...latin1Encode('Bob'), 0x73, 0x2e);
  const t = new PickleTerminal(bytes, '$');
  assert.equal(t.root.children[0].value, 'Bob');
  const out = await t.serialize(new Map([['$/name', 'Robert']]));
  const again = parsePickle(out);
  assert.ok(again.ops.some((o) => o.name === 'SHORT_BINSTRING' && new TextDecoder().decode(o.arg) === 'Robert'));
});

test('no edits returns the original bytes exactly', () => {
  const bytes = Uint8Array.of(0x80, 2, 0x4b, 5, 0x2e);
  assert.equal(patchPickle(parsePickle(bytes), new Map()), bytes);
});
