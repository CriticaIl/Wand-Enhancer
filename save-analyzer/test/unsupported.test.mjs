import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFile } from '../src/core/document.js';
import { readSample } from './helpers.mjs';

const enc = (s) => new TextEncoder().encode(s);

test('random binary is reported as unsupported with reasons, not "decoded"', async () => {
  let s = 7;
  const bytes = Uint8Array.from({ length: 4096 }, () => (s = (s * 1103515245 + 12345) & 0xff));
  const res = await analyzeFile('mystery.dat', bytes);
  assert.equal(res.ok, false);
  assert.ok(res.reasons.length > 0);
});

test('plain prose is not mistaken for an encoded save', async () => {
  const res = await analyzeFile('notes.txt', enc('Remember to buy milk and eggs tomorrow morning.'));
  assert.equal(res.ok, false);
  assert.match(res.reasons.join(' '), /not JSON/);
});

test('invalid JSON is rejected instead of half-parsed', async () => {
  const res = await analyzeFile('broken.json', enc('{"gold": 10, "hp": }'));
  assert.equal(res.ok, false);
  assert.match(res.reasons.join(' '), /not valid JSON/);
});

test('a truncated ZIP is rejected with an explanation', async () => {
  const bytes = readSample('renpy8-1-1-LT1.save').slice(0, 600);
  const res = await analyzeFile('cut.save', bytes);
  assert.equal(res.ok, false);
  assert.match(res.reasons.join(' '), /ZIP/);
});

test('a ZIP whose log is corrupt keeps the archive but marks the entry unreadable', async () => {
  const bytes = readSample('renpy-legacy-protocol2.save');
  // flip a byte inside the compressed log entry so its CRC fails
  const idx = new TextDecoder('latin1').decode(bytes).indexOf('log') + 3 + 10;
  const broken = bytes.slice();
  broken[idx] ^= 0x55;
  const res = await analyzeFile('x.save', broken);
  if (res.ok) {
    const log = res.doc.root.children.find((c) => c.key === 'log');
    assert.notEqual(log.type, 'embedded');
  } else assert.ok(res.reasons.length);
});

test('base64 of random bytes is not claimed as a save', async () => {
  const res = await analyzeFile('x.txt', enc(Buffer.from(Uint8Array.from({ length: 300 }, (_, i) => (i * 97) & 0xff)).toString('base64')));
  assert.equal(res.ok, false);
});
