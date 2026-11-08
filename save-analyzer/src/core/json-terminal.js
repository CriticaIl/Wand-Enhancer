// JSON terminal: a strict JSON parser that records the source range of every
// value. Edits are spliced into the original text, so whitespace, key order,
// duplicate keys, number spelling and escapes outside edited values are
// preserved exactly. Integers beyond 2^53 are kept as BigInt (never rounded).

import { childId, makeNode } from './model.js';

class JsonSyntaxError extends Error {}

const MAX_DEPTH = 512;

export function looksLikeJson(text) {
  const t = text.trimStart();
  return t.startsWith('{') || t.startsWith('[');
}

export class JsonTerminal {
  constructor(text, prefix, ctx) {
    this.kind = 'json';
    this.text = text;
    this.prefix = prefix;
    this.ctx = ctx;
    this.ranges = new Map(); // id -> [start, end]
    this.embedded = new Map(); // id -> chain
    this.floats = new Set();
    this.pending = [];
    this.pos = 0;
    this.skipWs();
    this.root = this.parseValue(prefix, '(root)', 0);
    this.skipWs();
    if (this.pos !== text.length) throw new JsonSyntaxError(`Unexpected data after JSON at ${this.pos}`);
  }

  /** Nested-encoding detection is async, so it runs after the synchronous parse. */
  async resolveEmbedded() {
    if (!this.ctx.analyzeText) return;
    for (const node of this.pending) {
      const s = node.value;
      if (!qualifiesForNested(s)) continue;
      let chain = null;
      try {
        chain = await this.ctx.analyzeText(s, node.id, { ...this.ctx, trace: [], depth: (this.ctx.depth || 0) + 1, nested: true });
      } catch {
        chain = null;
      }
      if (!chain || !chain.root.children) continue;
      this.embedded.set(node.id, chain);
      node.type = 'embedded';
      node.children = chain.root.children;
      node.editable = false;
      node.meta.encoding = chain.describe();
      node.meta.className = chain.root.meta.className;
      node.meta.innerType = chain.root.type;
      if (chain.readOnlyReason) node.meta.readOnlyReason = chain.readOnlyReason;
    }
    this.pending = [];
  }

  skipWs() {
    const t = this.text;
    while (this.pos < t.length) {
      const c = t.charCodeAt(this.pos);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 0xfeff) this.pos++;
      else break;
    }
  }

  parseValue(id, key, depth) {
    if (depth > MAX_DEPTH) throw new JsonSyntaxError('JSON nested too deeply');
    const t = this.text;
    const start = this.pos;
    const c = t[this.pos];
    let node;
    if (c === '{') {
      this.pos++;
      node = makeNode(id, key, 'object', { children: [] });
      const seen = new Map();
      this.skipWs();
      if (t[this.pos] === '}') this.pos++;
      else {
        for (;;) {
          this.skipWs();
          if (t[this.pos] !== '"') throw new JsonSyntaxError(`Expected key at ${this.pos}`);
          const k = this.parseString();
          this.skipWs();
          if (t[this.pos++] !== ':') throw new JsonSyntaxError(`Expected ':' at ${this.pos - 1}`);
          this.skipWs();
          const n = (seen.get(k) || 0) + 1;
          seen.set(k, n);
          const seg = n > 1 ? `${k}#${n}` : k; // duplicate keys stay addressable
          node.children.push(this.parseValue(childId(id, seg), k, depth + 1));
          this.skipWs();
          const d = t[this.pos++];
          if (d === '}') break;
          if (d !== ',') throw new JsonSyntaxError(`Expected ',' or '}' at ${this.pos - 1}`);
        }
      }
      if ([...seen.values()].some((v) => v > 1)) node.meta.note = 'Contains duplicate keys (games normally use the last one).';
    } else if (c === '[') {
      this.pos++;
      node = makeNode(id, key, 'array', { children: [] });
      this.skipWs();
      if (t[this.pos] === ']') this.pos++;
      else {
        for (let i = 0; ; i++) {
          this.skipWs();
          node.children.push(this.parseValue(childId(id, i), String(i), depth + 1));
          this.skipWs();
          const d = t[this.pos++];
          if (d === ']') break;
          if (d !== ',') throw new JsonSyntaxError(`Expected ',' or ']' at ${this.pos - 1}`);
        }
      }
    } else if (c === '"') {
      const s = this.parseString();
      node = makeNode(id, key, 'string', { value: s, editable: true });
      this.pending.push(node);
    } else if (c === 't' && t.startsWith('true', this.pos)) {
      this.pos += 4;
      node = makeNode(id, key, 'bool', { value: true, editable: true });
    } else if (c === 'f' && t.startsWith('false', this.pos)) {
      this.pos += 5;
      node = makeNode(id, key, 'bool', { value: false, editable: true });
    } else if (c === 'n' && t.startsWith('null', this.pos)) {
      this.pos += 4;
      node = makeNode(id, key, 'null', { value: null });
      node.meta.note = 'null has no type information, so it is shown read-only.';
    } else {
      const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?/.exec(t.slice(this.pos, this.pos + 400));
      if (!m) throw new JsonSyntaxError(`Unexpected character at ${this.pos}`);
      this.pos += m[0].length;
      const raw = m[0];
      if (m[2] || m[3]) {
        node = makeNode(id, key, 'float', { value: Number(raw), editable: true });
        this.floats.add(id);
      }
      else {
        const big = BigInt(raw);
        const safe = big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER);
        node = makeNode(id, key, 'int', { value: safe ? Number(big) : big, editable: true });
        if (!safe) node.meta.note = 'Larger than JavaScript can store exactly; preserved as-is unless you edit it.';
      }
      node.meta.raw = raw;
    }
    this.ranges.set(id, [start, this.pos]);
    return node;
  }

  parseString() {
    const t = this.text;
    let p = this.pos + 1;
    let out = '';
    let chunk = p;
    for (;;) {
      if (p >= t.length) throw new JsonSyntaxError('Unterminated string');
      const c = t.charCodeAt(p);
      if (c === 34) break;
      if (c < 32) throw new JsonSyntaxError(`Control character in string at ${p}`);
      if (c === 92) {
        out += t.slice(chunk, p);
        const e = t[p + 1];
        const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (e === 'u') {
          const hex = t.slice(p + 2, p + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new JsonSyntaxError(`Bad \\u escape at ${p}`);
          out += String.fromCharCode(parseInt(hex, 16));
          p += 6;
        } else if (e in map) {
          out += map[e];
          p += 2;
        } else throw new JsonSyntaxError(`Bad escape at ${p}`);
        chunk = p;
      } else p++;
    }
    out += t.slice(chunk, p);
    this.pos = p + 1;
    return out;
  }

  /** Returns the rebuilt text (original text when nothing under this terminal changed). */
  async serialize(edits) {
    const splices = [];
    for (const [id, chain] of this.embedded) {
      let touched = false;
      for (const eid of edits.keys()) if (eid.startsWith(id + '/')) touched = true;
      if (!touched) continue;
      const inner = await chain.serialize(edits);
      const [s, e] = this.ranges.get(id);
      splices.push([s, e, JSON.stringify(inner)]);
    }
    for (const [id, value] of edits) {
      const r = this.ranges.get(id);
      if (!r || this.embedded.has(id)) continue;
      let text = encodeJsonValue(value);
      // keep floats recognisable as floats (40.5 -> 41 must stay "41.0")
      if (this.floats.has(id) && /^-?\d+$/.test(text)) text += '.0';
      splices.push([r[0], r[1], text]);
    }
    if (!splices.length) return this.text;
    splices.sort((a, b) => b[0] - a[0]);
    let out = this.text;
    for (const [s, e, v] of splices) out = out.slice(0, s) + v + out.slice(e);
    return out;
  }
}

function encodeJsonValue(v) {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('JSON cannot store NaN/Infinity');
    return String(v);
  }
  return JSON.stringify(v);
}

function qualifiesForNested(s) {
  if (s.length < 2) return false;
  const t = s.trimStart();
  if ((t[0] === '{' || t[0] === '[') && s.length >= 2) return true;
  if (s.length >= 12 && /^[A-Za-z0-9+/=\-_$\s]+$/.test(s)) return true; // base64 / lz-string (only kept if the result parses)
  if (s.length >= 8 && /[Ā-￿]/.test(s)) return true; // lz-string UTF16 / raw
  if (/^%(7B|5B)/i.test(s)) return true;
  if (/^\s*\[[^\]\n]+\]\s*\r?\n/.test(s)) return true; // INI
  return false;
}

export function createJsonTerminal(text, prefix, ctx) {
  try {
    return new JsonTerminal(text, prefix, ctx);
  } catch (e) {
    if (e instanceof JsonSyntaxError || e instanceof SyntaxError) return null;
    throw e;
  }
}
