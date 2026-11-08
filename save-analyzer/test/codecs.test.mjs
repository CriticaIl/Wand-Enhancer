import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import LZRef from 'lz-string';
import pako from 'pako';
import * as LZ from '../src/core/lzstring.js';
import { base64Decode, base64Encode, crc32, utf8Encode } from '../src/core/bytes.js';
import { gunzip, gzip, inflateRaw, zlibDeflate, zlibInflate } from '../src/core/compression.js';
import { entryData, readZip, writeZip } from '../src/core/zip.js';
import { hasPython } from './helpers.mjs';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function randomText(r, n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = r();
    out += x < 0.7 ? 'abcdefghij{}":,[]0123456789 '[Math.floor(r() * 28)] : x < 0.95 ? String.fromCharCode(0x20 + Math.floor(r() * 0x60)) : String.fromCharCode(0xa0 + Math.floor(r() * 0x3000));
  }
  return out;
}

test('lz-string matches the reference implementation in every variant', () => {
  const r = rng(1);
  const inputs = ['', 'a', 'aaaaaaaaaaaaaaaa', JSON.stringify({ gold: 10, név: 'ünï 😀' })];
  for (let i = 0; i < 40; i++) inputs.push(randomText(r, Math.floor(r() * 3000)));
  const pairs = [
    ['compressToBase64', 'decompressFromBase64'],
    ['compressToUTF16', 'decompressFromUTF16'],
    ['compressToEncodedURIComponent', 'decompressFromEncodedURIComponent'],
    ['compress', 'decompress'],
  ];
  for (const s of inputs) {
    for (const [c, d] of pairs) {
      const ours = LZ[c](s);
      assert.equal(ours, LZRef[c](s), `${c} output differs`);
      if (s) assert.equal(LZ[d](LZRef[c](s)), s, `${d} failed`);
    }
  }
});

test('inflate decodes pako output at every level; pako reads our zlib/gzip', async () => {
  const r = rng(2);
  for (let i = 0; i < 12; i++) {
    const data = utf8Encode(randomText(r, 1000 + Math.floor(r() * 60000)));
    for (const level of [0, 1, 6, 9]) {
      assert.deepEqual(zlibInflate(pako.deflate(data, { level })).data, data);
      assert.deepEqual(inflateRaw(pako.deflateRaw(data, { level })).data, data);
    }
    assert.deepEqual(gunzip(pako.gzip(data)).data, data);
    assert.deepEqual(pako.inflate(await zlibDeflate(data)), data);
    assert.deepEqual(pako.ungzip(await gzip(data)), data);
  }
});

test('stored-block fallback is valid when CompressionStream is unavailable', async () => {
  const saved = globalThis.CompressionStream;
  globalThis.CompressionStream = undefined;
  try {
    const data = utf8Encode('x'.repeat(200000) + 'end');
    const z = await zlibDeflate(data);
    assert.deepEqual(pako.inflate(z), data);
    assert.deepEqual(zlibInflate(z).data, data);
  } finally {
    globalThis.CompressionStream = saved;
  }
});

test('zlib checksum and corrupt streams are rejected', () => {
  const z = pako.deflate(utf8Encode('hello world hello world'));
  z[z.length - 1] ^= 1;
  assert.throws(() => zlibInflate(z), /checksum/);
  assert.throws(() => inflateRaw(new Uint8Array([0xff, 0xff, 0xff])));
});

test('base64 round trip including url-safe and invalid input', () => {
  const r = rng(3);
  for (let n = 0; n < 50; n++) {
    const b = Uint8Array.from({ length: n * 7 }, () => Math.floor(r() * 256));
    assert.deepEqual(base64Decode(base64Encode(b)), b);
    assert.deepEqual(base64Decode(base64Encode(b, { urlSafe: true, pad: false })), b);
    assert.equal(base64Encode(b), Buffer.from(b).toString('base64'));
  }
  assert.equal(base64Decode('ab$d'), null);
});

test('zip: unchanged entries are copied verbatim; CRCs verified', async () => {
  const a = utf8Encode('alpha'.repeat(100));
  const b = utf8Encode('beta');
  const zip1 = await writeZip([
    { name: 'a.txt', data: a },
    { name: 'dir/b.bin', data: b, method: 0 },
  ]);
  const z = readZip(zip1);
  assert.deepEqual(entryData(z.entries[0]), a);
  assert.deepEqual(entryData(z.entries[1]), b);
  const zip2 = await writeZip(z.entries);
  assert.deepEqual(zip2, zip1);
  const broken = zip1.slice();
  broken[40] ^= 0xff; // inside a.txt compressed data
  assert.throws(() => entryData(readZip(broken).entries[0]));
  assert.equal(crc32(utf8Encode('123456789')), 0xcbf43926);
});

test('zip output is readable by Python zipfile', { skip: !hasPython() }, async () => {
  const zip = await writeZip([
    { name: 'log', data: utf8Encode('payload'.repeat(50)) },
    { name: 'ünï.txt', data: utf8Encode('x'), method: 0 },
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'sf-'));
  const p = join(dir, 'x.zip');
  writeFileSync(p, zip);
  const out = execFileSync('python3', ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip(), z.namelist(), len(z.read("log")))', p]).toString();
  assert.match(out, /^None \['log', 'ünï.txt'\] 350/);
});
