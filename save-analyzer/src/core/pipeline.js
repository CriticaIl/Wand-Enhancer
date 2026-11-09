// Format detection pipeline.
//
// A save is decoded as a *chain*: zero or more reversible layers (text
// encoding, base64, zlib, gzip, lz-string, URI encoding) ending in a
// terminal (JSON, pickle, ZIP, INI). Exporting runs the same chain
// backwards. Nothing is reported as decoded unless a terminal parsed it.

import {
  base64Decode,
  base64EncodeStyled,
  base64Style,
  latin1Decode,
  latin1Encode,
  looksLikeBase64,
  printableRatio,
  utf8DecodeStrict,
  utf8Encode,
} from './bytes.js';
import { gunzip, gzip, isGzip, isZlibHeader, zlibDeflate, zlibInflate } from './compression.js';
import { IniTerminal, looksLikeIni } from './ini-terminal.js';
import { createJsonTerminal, looksLikeJson } from './json-terminal.js';
import * as LZ from './lzstring.js';
import { walk } from './model.js';
import { looksLikePickle } from './pickle.js';
import { PickleTerminal } from './pickle-terminal.js';
import { isZip } from './zip.js';
import { ZipTerminal } from './zip-terminal.js';

const MAX_DEPTH = 8;

export class Chain {
  constructor({ input, layers, terminal, prefix }) {
    this.input = input; // original input of the first layer (bytes or text)
    this.layers = layers; // outermost first: [{label, encode}]
    this.terminal = terminal;
    this.prefix = prefix;
    this.root = terminal.root;
    this.readOnlyReason = null;
    this.warnings = [...(terminal.warnings || [])];
  }

  describe() {
    return [...this.layers.map((l) => l.label), terminalLabel(this.terminal)].join(' › ');
  }

  touched(edits) {
    for (const id of edits.keys()) if (id === this.prefix || id.startsWith(this.prefix + '/')) return true;
    return false;
  }

  setReadOnly(reason) {
    this.readOnlyReason = reason;
    walk(this.root, (n) => {
      if (n.editable) {
        n.editable = false;
        n.meta.readOnlyReason = reason;
      }
    });
  }

  async serialize(edits) {
    if (!this.touched(edits)) return this.input;
    if (this.readOnlyReason) throw new Error(this.readOnlyReason);
    let data = await this.terminal.serialize(edits);
    for (let i = this.layers.length - 1; i >= 0; i--) data = await this.layers[i].encode(data);
    return data;
  }
}

function terminalLabel(t) {
  switch (t.kind) {
    case 'json':
      return 'JSON';
    case 'pickle':
      return `Python pickle v${t.parsed.protocol}`;
    case 'zip':
      return 'ZIP';
    case 'ini':
      return 'INI';
    default:
      return t.kind;
  }
}

// ---------------------------------------------------------------- layers

const textLayer = (bom) => ({
  label: bom ? 'UTF-8 (BOM)' : 'UTF-8 text',
  encode: async (text) => utf8Encode((bom ? '﻿' : '') + text),
});

const base64Layer = (style) => ({
  label: style.urlSafe ? 'Base64 (URL-safe)' : 'Base64',
  encode: async (bytes) => base64EncodeStyled(bytes, style),
});

const zlibLayer = (level, trailer) => ({
  label: 'zlib',
  encode: async (bytes) => {
    const z = await zlibDeflate(bytes, level);
    if (!trailer.length) return z;
    const out = new Uint8Array(z.length + trailer.length);
    out.set(z);
    out.set(trailer, z.length);
    return out;
  },
});

const gzipLayer = (header) => ({ label: 'gzip', encode: async (bytes) => gzip(bytes, header) });

const LZ_VARIANTS = [
  { label: 'LZString (Base64)', test: (s) => /^[A-Za-z0-9+/=]+$/.test(s) && s.length >= 4, dec: LZ.decompressFromBase64, enc: LZ.compressToBase64 },
  { label: 'LZString (URI-safe)', test: (s) => /^[A-Za-z0-9+\-$]+$/.test(s) && s.length >= 4, dec: LZ.decompressFromEncodedURIComponent, enc: LZ.compressToEncodedURIComponent },
  { label: 'LZString (UTF-16)', test: (s) => s.length >= 2 && / $/.test(s) && /^[ -耟]+$/.test(s), dec: LZ.decompressFromUTF16, enc: LZ.compressToUTF16 },
  { label: 'LZString (raw)', test: (s) => s.length >= 2 && /[Ā-￿]/.test(s), dec: LZ.decompress, enc: LZ.compress },
];

// ---------------------------------------------------------------- analyzers

/**
 * @returns {Promise<Chain|null>}
 * ctx: {depth, trace: string[] (diagnostics), filename}
 */
export async function analyzeBytes(bytes, prefix, ctx = {}) {
  const c = withCtx(ctx);
  if (c.depth > MAX_DEPTH) return null;

  if (isZip(bytes)) {
    try {
      const t = await new ZipTerminal(bytes, prefix, c).init();
      return new Chain({ input: bytes, layers: [], terminal: t, prefix });
    } catch (e) {
      c.trace.push(`ZIP signature found but archive could not be read: ${e.message}`);
      return null;
    }
  }
  if (isGzip(bytes)) {
    try {
      const { data, header } = gunzip(bytes);
      const inner = await analyzeBytes(data, prefix, { ...c, depth: c.depth + 1 });
      if (inner) return wrap(inner, bytes, gzipLayer(header));
      c.trace.push('gzip data decompressed, but the contents were not a recognised format.');
    } catch (e) {
      c.trace.push(`gzip header found but decompression failed: ${e.message}`);
    }
    return null;
  }
  if (isZlibHeader(bytes)) {
    try {
      const { data, level, trailer } = zlibInflate(bytes);
      const inner = await analyzeBytes(data, prefix, { ...c, depth: c.depth + 1, zlibTrailer: trailer });
      if (inner) {
        const chain = wrap(inner, bytes, zlibLayer(level, trailer));
        chain.zlibTrailer = trailer;
        return chain;
      }
      c.trace.push('zlib data decompressed, but the contents were not a recognised format.');
    } catch (e) {
      if (!c.quiet) c.trace.push(`zlib-like header but not a valid zlib stream (${e.message}).`);
    }
  }
  if (looksLikePickle(bytes)) {
    try {
      const t = new PickleTerminal(bytes, prefix, c);
      return new Chain({ input: bytes, layers: [], terminal: t, prefix });
    } catch (e) {
      c.trace.push(`Looked like a Python pickle but could not be parsed safely: ${e.message}`);
      return null;
    }
  }
  let bom = false;
  let view = bytes;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bom = true;
    view = bytes.subarray(3);
  }
  const text = utf8DecodeStrict(view);
  if (text === null) {
    c.trace.push('Binary data is not ZIP, gzip, zlib, pickle or UTF-8 text.');
    return null;
  }
  const inner = await analyzeText(text, prefix, c);
  if (!inner) return null;
  return wrap(inner, bytes, textLayer(bom));
}

export async function analyzeText(text, prefix, ctx = {}) {
  const c = withCtx(ctx);
  if (c.depth > MAX_DEPTH) return null;
  const trimmed = text.trim();
  if (!trimmed) {
    c.trace.push('File is empty.');
    return null;
  }

  if (looksLikeJson(trimmed)) {
    const t = createJsonTerminal(text, prefix, c);
    if (t) {
      await t.resolveEmbedded();
      return new Chain({ input: text, layers: [], terminal: t, prefix });
    }
    c.trace.push('Text starts like JSON but is not valid JSON.');
  }

  if (/^%(7B|5B)/i.test(trimmed)) {
    try {
      const decoded = decodeURIComponent(trimmed);
      const inner = await analyzeText(decoded, prefix, { ...c, depth: c.depth + 1 });
      if (inner) return wrap(inner, text, { label: 'URI-encoded', encode: async (s) => encodeURIComponent(s) });
    } catch {
      c.trace.push('Looked URI-encoded but could not be decoded.');
    }
  }

  if (looksLikeBase64(trimmed)) {
    const bytes = base64Decode(trimmed);
    if (bytes && bytes.length) {
      const inner = await analyzeBytes(bytes, prefix, { ...c, depth: c.depth + 1, quiet: true, fromBase64: true });
      if (inner && !(inner.layers.length === 1 && inner.layers[0].label.startsWith('UTF-8') && inner.terminal.kind === 'ini')) {
        return wrap(inner, text, base64Layer(base64Style(text)));
      }
    }
  }

  // "Binary strings" (one char per byte), e.g. RPG Maker MZ: pako.deflate(json, {to: 'string'})
  if (/^[\x00-\xff]+$/.test(text) && /[\x80-\xff]|^\x78/.test(text)) {
    const bin = latin1Encode(text);
    if (isZlibHeader(bin) || isGzip(bin) || isZip(bin)) {
      const inner = await analyzeBytes(bin, prefix, { ...c, depth: c.depth + 1, quiet: true });
      if (inner) return wrap(inner, text, { label: 'Binary string', encode: async (b) => latin1Decode(b) });
    }
  }

  const compact = trimmed;
  for (const v of LZ_VARIANTS) {
    // compressToUTF16 output ends with a space (part of the stream): never test it trimmed
    const src = v.dec === LZ.decompressFromUTF16 ? text : compact;
    if (!v.test(src)) continue;
    const out = LZ.tryDecompress(v.dec, src);
    if (!out || printableRatio(out) < 0.95) continue;
    const inner = await analyzeText(out, prefix, { ...c, depth: c.depth + 1 });
    if (inner) {
      // Only claim LZ-String when re-compressing reproduces the input exactly.
      if (v.enc(out) !== src) c.trace.push(`${v.label}: decompressed, but re-compression differs from the original (edits still produce a valid stream).`);
      return wrap(inner, text, { label: v.label, encode: async (s) => v.enc(s) });
    }
  }

  if (looksLikeIni(text)) {
    return new Chain({ input: text, layers: [], terminal: new IniTerminal(text, prefix), prefix });
  }

  if (!c.nested) c.trace.push('Text is not JSON, Base64, LZString, URI-encoded or INI data.');
  return null;
}

function withCtx(ctx) {
  const c = { depth: 0, trace: [], ...ctx };
  c.analyzeBytes = analyzeBytes;
  c.analyzeText = analyzeText;
  return c;
}

function wrap(inner, input, layer) {
  const chain = new Chain({ input, layers: [layer, ...inner.layers], terminal: inner.terminal, prefix: inner.prefix });
  chain.warnings = inner.warnings;
  chain.zlibTrailer = inner.zlibTrailer;
  if (inner.readOnlyReason) chain.setReadOnly(inner.readOnlyReason);
  return chain;
}
