// Safe Python pickle reader/patcher (protocols 0-5).
//
// SECURITY: this never executes anything. GLOBAL/REDUCE/BUILD/NEWOBJ/INST
// opcodes are recorded as inert descriptive nodes ("object of class X built
// from args Y with state Z") instead of importing or calling code. That is
// what makes it safe to open untrusted Ren'Py saves, but it also means we
// can only *describe* custom objects, not reconstruct them. Edits are
// therefore applied by splicing individual primitive opcodes in the original
// byte stream, leaving every other byte untouched.

import { concatBytes, latin1Decode, latin1Encode, utf8DecodeStrict, utf8Encode } from './bytes.js';

const OPS = {
  0x28: ['MARK', 'none'],
  0x2e: ['STOP', 'none'],
  0x30: ['POP', 'none'],
  0x31: ['POP_MARK', 'none'],
  0x32: ['DUP', 'none'],
  0x46: ['FLOAT', 'line'],
  0x49: ['INT', 'line'],
  0x4a: ['BININT', 'i4'],
  0x4b: ['BININT1', 'u1'],
  0x4c: ['LONG', 'line'],
  0x4d: ['BININT2', 'u2'],
  0x4e: ['NONE', 'none'],
  0x50: ['PERSID', 'line'],
  0x51: ['BINPERSID', 'none'],
  0x52: ['REDUCE', 'none'],
  0x53: ['STRING', 'line'],
  0x54: ['BINSTRING', 'bytes4'],
  0x55: ['SHORT_BINSTRING', 'bytes1'],
  0x56: ['UNICODE', 'line'],
  0x58: ['BINUNICODE', 'bytes4'],
  0x61: ['APPEND', 'none'],
  0x62: ['BUILD', 'none'],
  0x63: ['GLOBAL', 'line2'],
  0x64: ['DICT', 'none'],
  0x7d: ['EMPTY_DICT', 'none'],
  0x65: ['APPENDS', 'none'],
  0x67: ['GET', 'line'],
  0x68: ['BINGET', 'u1'],
  0x69: ['INST', 'line2'],
  0x6a: ['LONG_BINGET', 'u4'],
  0x6c: ['LIST', 'none'],
  0x5d: ['EMPTY_LIST', 'none'],
  0x6f: ['OBJ', 'none'],
  0x70: ['PUT', 'line'],
  0x71: ['BINPUT', 'u1'],
  0x72: ['LONG_BINPUT', 'u4'],
  0x73: ['SETITEM', 'none'],
  0x74: ['TUPLE', 'none'],
  0x29: ['EMPTY_TUPLE', 'none'],
  0x75: ['SETITEMS', 'none'],
  0x47: ['BINFLOAT', 'f8'],
  0x80: ['PROTO', 'u1'],
  0x81: ['NEWOBJ', 'none'],
  0x82: ['EXT1', 'u1'],
  0x83: ['EXT2', 'u2'],
  0x84: ['EXT4', 'i4'],
  0x85: ['TUPLE1', 'none'],
  0x86: ['TUPLE2', 'none'],
  0x87: ['TUPLE3', 'none'],
  0x88: ['NEWTRUE', 'none'],
  0x89: ['NEWFALSE', 'none'],
  0x8a: ['LONG1', 'bytes1'],
  0x8b: ['LONG4', 'bytes4'],
  0x42: ['BINBYTES', 'bytes4'],
  0x43: ['SHORT_BINBYTES', 'bytes1'],
  0x8c: ['SHORT_BINUNICODE', 'bytes1'],
  0x8d: ['BINUNICODE8', 'bytes8'],
  0x8e: ['BINBYTES8', 'bytes8'],
  0x8f: ['EMPTY_SET', 'none'],
  0x90: ['ADDITEMS', 'none'],
  0x91: ['FROZENSET', 'none'],
  0x92: ['NEWOBJ_EX', 'none'],
  0x93: ['STACK_GLOBAL', 'none'],
  0x94: ['MEMOIZE', 'none'],
  0x95: ['FRAME', 'u8'],
  0x96: ['BYTEARRAY8', 'bytes8'],
  0x97: ['NEXT_BUFFER', 'none'],
  0x98: ['READONLY_BUFFER', 'none'],
};

const PUT_OPS = new Set(['PUT', 'BINPUT', 'LONG_BINPUT', 'MEMOIZE']);
const PRIMITIVE_KINDS = new Set(['none', 'bool', 'int', 'float', 'str', 'bytes']);
const MAX_OPS = 20_000_000;

export class PickleError extends Error {}

export function looksLikePickle(bytes) {
  if (bytes.length < 3) return false;
  if (bytes[0] === 0x80 && bytes[1] >= 2 && bytes[1] <= 5) return true;
  // protocol 0/1 streams usually start with a container or global
  return (bytes[0] === 0x28 || bytes[0] === 0x63 || bytes[0] === 0x7d || bytes[0] === 0x5d) && bytes[bytes.length - 1] === 0x2e;
}

// ---------------------------------------------------------------- tokenizer

function readLine(b, p) {
  let e = p;
  while (e < b.length && b[e] !== 0x0a) e++;
  if (e >= b.length) throw new PickleError('Unterminated text opcode');
  return [latin1Decode(b.subarray(p, e)), e + 1];
}

function le(b, p, n) {
  if (p + n > b.length) throw new PickleError('Truncated pickle');
  let v = 0;
  for (let i = n - 1; i >= 0; i--) v = v * 256 + b[p + i];
  return v;
}

/** Splits a pickle into opcodes. Returns ops with byte ranges; stops at STOP. */
export function tokenize(bytes) {
  const ops = [];
  let p = 0;
  while (p < bytes.length) {
    const start = p;
    const code = bytes[p++];
    const def = OPS[code];
    if (!def) throw new PickleError(`Unknown opcode 0x${code.toString(16)} at byte ${start}`);
    const [name, argType] = def;
    let arg = null;
    switch (argType) {
      case 'none':
        break;
      case 'u1':
        arg = le(bytes, p, 1);
        p += 1;
        break;
      case 'u2':
        arg = le(bytes, p, 2);
        p += 2;
        break;
      case 'u4':
        arg = le(bytes, p, 4);
        p += 4;
        break;
      case 'i4':
        arg = le(bytes, p, 4) | 0;
        p += 4;
        break;
      case 'u8':
        arg = le(bytes, p, 8);
        p += 8;
        break;
      case 'f8':
        if (p + 8 > bytes.length) throw new PickleError('Truncated float');
        arg = new DataView(bytes.buffer, bytes.byteOffset + p, 8).getFloat64(0, false);
        p += 8;
        break;
      case 'line':
        [arg, p] = readLine(bytes, p);
        break;
      case 'line2': {
        let a;
        let b;
        [a, p] = readLine(bytes, p);
        [b, p] = readLine(bytes, p);
        arg = [a, b];
        break;
      }
      case 'bytes1':
      case 'bytes4':
      case 'bytes8': {
        const n = argType === 'bytes1' ? 1 : argType === 'bytes4' ? 4 : 8;
        const len = le(bytes, p, n);
        p += n;
        if (p + len > bytes.length) throw new PickleError(`Truncated ${name}`);
        arg = bytes.subarray(p, p + len);
        p += len;
        break;
      }
      default:
        throw new PickleError('bad arg type');
    }
    ops.push({ code, name, arg, start, end: p });
    if (ops.length > MAX_OPS) throw new PickleError('Pickle too large');
    if (name === 'STOP') break;
  }
  if (!ops.length || ops[ops.length - 1].name !== 'STOP') throw new PickleError('Pickle has no STOP opcode');
  return { ops, end: p };
}

// ---------------------------------------------------------------- value decoding

function decodeLong(bytes) {
  if (bytes.length === 0) return 0;
  let v = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]);
  if (bytes[bytes.length - 1] & 0x80) v -= 1n << BigInt(bytes.length * 8);
  return normalizeInt(v);
}

function normalizeInt(v) {
  if (typeof v === 'bigint' && v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(v);
  return v;
}

function unescapePyString(text) {
  // Python repr() of a byte string, e.g. 'abc\n' or "it's"
  const q = text[0];
  if ((q !== "'" && q !== '"') || text[text.length - 1] !== q) throw new PickleError('Bad STRING literal');
  const body = text.slice(1, -1);
  const out = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') {
      out.push(c.charCodeAt(0) & 0xff);
      continue;
    }
    const n = body[++i];
    const map = { n: 10, r: 13, t: 9, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11, '0': 0 };
    if (n === 'x') {
      out.push(parseInt(body.substr(i + 1, 2), 16));
      i += 2;
    } else if (/[0-7]/.test(n) && /[0-7]/.test(body[i + 1] || '')) {
      let j = i;
      while (j < i + 3 && /[0-7]/.test(body[j])) j++;
      out.push(parseInt(body.slice(i, j), 8) & 0xff);
      i = j - 1;
    } else if (n in map) out.push(map[n]);
    else out.push(92, n.charCodeAt(0));
  }
  return Uint8Array.from(out);
}

function rawUnicodeUnescape(text) {
  return text.replace(/\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})/g, (_, a, b) => String.fromCodePoint(parseInt(a || b, 16)));
}

function bytesToStr(raw) {
  const u = utf8DecodeStrict(raw);
  return u !== null ? { v: u, enc: 'utf8' } : { v: latin1Decode(raw), enc: 'latin1' };
}

// ---------------------------------------------------------------- interpreter

const MARK = Symbol('mark');

/**
 * Parses a pickle into an inert node graph.
 * Node kinds: none,bool,int,float,str,bytes,list,tuple,dict,set,frozenset,global,object,opaque
 * Primitive nodes carry `op` (index of the opcode that produced them at that position).
 */
export function parsePickle(bytes) {
  const { ops, end } = tokenize(bytes);
  let stack = [];
  const metastack = [];
  const memo = new Map();
  const memoGets = new Set();
  let protocol = 0;
  let result = null;
  const warnings = new Set();

  const popMark = () => {
    if (!metastack.length) throw new PickleError('MARK stack underflow');
    const items = stack;
    stack = metastack.pop();
    return items;
  };
  const pop = () => {
    if (!stack.length) throw new PickleError('Stack underflow');
    return stack.pop();
  };
  const top = () => {
    if (!stack.length) throw new PickleError('Stack underflow');
    return stack[stack.length - 1];
  };
  const addEntries = (target, pairs) => {
    if (target.k === 'dict') target.entries.push(...pairs);
    else if (target.k === 'object') target.dictEntries.push(...pairs);
    else throw new PickleError(`SETITEM on ${target.k}`);
  };
  const addItems = (target, items) => {
    if (target.k === 'list') target.items.push(...items);
    else if (target.k === 'object') target.listItems.push(...items);
    else throw new PickleError(`APPEND on ${target.k}`);
  };
  const object = (cls, args, via, kwargs = null) => {
    let c = cls;
    let a = args;
    // copyreg._reconstructor(cls, base, state) is how protocol 0/1 pickles objects
    if (cls.k === 'global' && /^copy_?reg$/.test(cls.module) && cls.name === '_reconstructor' && args.k === 'tuple' && args.items[0]) {
      c = args.items[0];
      const base = globalName(args.items[1]);
      const init = args.items[2];
      const o = { k: 'object', cls: c, args: null, kwargs, state: null, listItems: [], dictEntries: [], via };
      // _reconstructor(cls, dict|list, value) initialises the subclass with `value`.
      if (/^(__builtin__|builtins)\.dict$/.test(base) && init && init.k === 'dict') o.dictEntries = init.entries;
      else if (/^(__builtin__|builtins)\.list$/.test(base) && init && init.k === 'list') o.listItems = init.items;
      else if (/^(__builtin__|builtins)\.object$/.test(base) && (!init || init.k === 'none')) o.args = null;
      else o.args = { k: 'tuple', items: args.items.slice(1) };
      return o;
    }
    return { k: 'object', cls: c, args: a, kwargs, state: null, listItems: [], dictEntries: [], via };
  };

  for (let i = 0; i < ops.length; i++) {
    try {
      step(i);
    } catch (e) {
      if (e instanceof PickleError) e.message += ` (opcode ${ops[i].name} at byte ${ops[i].start})`;
      throw e;
    }
  }
  if (stack.length || metastack.length) warnings.add('Pickle left unused values on the stack.');
  return { ops, protocol, root: result, memoGets, trailer: bytes.slice(end), warnings: [...warnings], bytes };

  function step(i) {
    const op = ops[i];
    const { name, arg } = op;
    switch (name) {
      case 'PROTO':
        protocol = arg;
        if (arg > 5) throw new PickleError(`Unsupported pickle protocol ${arg}`);
        break;
      case 'FRAME':
        break;
      case 'STOP':
        result = pop();
        break;
      case 'MARK':
        metastack.push(stack);
        stack = [];
        break;
      case 'POP':
        if (stack.length) stack.pop();
        else popMark();
        break;
      case 'POP_MARK':
        popMark();
        break;
      case 'DUP':
        stack.push(top());
        break;
      case 'NONE':
        stack.push({ k: 'none', op: i });
        break;
      case 'NEWTRUE':
      case 'NEWFALSE':
        stack.push({ k: 'bool', v: name === 'NEWTRUE', op: i });
        break;
      case 'INT':
        if (arg === '01' || arg === '00') stack.push({ k: 'bool', v: arg === '01', op: i });
        else stack.push({ k: 'int', v: normalizeInt(BigInt(arg.trim())), op: i });
        break;
      case 'LONG':
        stack.push({ k: 'int', v: normalizeInt(BigInt(arg.trim().replace(/L$/, ''))), op: i });
        break;
      case 'BININT':
      case 'BININT1':
      case 'BININT2':
        stack.push({ k: 'int', v: arg, op: i });
        break;
      case 'LONG1':
      case 'LONG4':
        stack.push({ k: 'int', v: decodeLong(arg), op: i });
        break;
      case 'FLOAT':
        stack.push({ k: 'float', v: parseFloat(arg), op: i });
        break;
      case 'BINFLOAT':
        stack.push({ k: 'float', v: arg, op: i });
        break;
      case 'STRING': {
        const s = bytesToStr(unescapePyString(arg.trim()));
        stack.push({ k: 'str', v: s.v, enc: s.enc, py2: true, op: i });
        break;
      }
      case 'BINSTRING':
      case 'SHORT_BINSTRING': {
        const s = bytesToStr(arg);
        stack.push({ k: 'str', v: s.v, enc: s.enc, py2: true, op: i });
        break;
      }
      case 'UNICODE':
        stack.push({ k: 'str', v: rawUnicodeUnescape(arg), op: i });
        break;
      case 'BINUNICODE':
      case 'SHORT_BINUNICODE':
      case 'BINUNICODE8': {
        const v = utf8DecodeStrict(arg);
        if (v === null) throw new PickleError('Invalid UTF-8 in unicode opcode');
        stack.push({ k: 'str', v, op: i });
        break;
      }
      case 'BINBYTES':
      case 'SHORT_BINBYTES':
      case 'BINBYTES8':
        stack.push({ k: 'bytes', v: arg, op: i });
        break;
      case 'BYTEARRAY8':
        stack.push({ k: 'bytes', v: arg, bytearray: true, op: i });
        break;
      case 'EMPTY_LIST':
        stack.push({ k: 'list', items: [] });
        break;
      case 'LIST':
        {
          const items = popMark(); // must run before reading `stack`
          stack.push({ k: 'list', items });
        }
        break;
      case 'APPEND': {
        const v = pop();
        addItems(top(), [v]);
        break;
      }
      case 'APPENDS': {
        const items = popMark();
        addItems(top(), items);
        break;
      }
      case 'EMPTY_TUPLE':
        stack.push({ k: 'tuple', items: [] });
        break;
      case 'TUPLE':
        {
          const items = popMark(); // must run before reading `stack`
          stack.push({ k: 'tuple', items });
        }
        break;
      case 'TUPLE1':
      case 'TUPLE2':
      case 'TUPLE3': {
        const n = name === 'TUPLE1' ? 1 : name === 'TUPLE2' ? 2 : 3;
        if (stack.length < n) throw new PickleError('Stack underflow');
        stack.push({ k: 'tuple', items: stack.splice(stack.length - n, n) });
        break;
      }
      case 'EMPTY_DICT':
        stack.push({ k: 'dict', entries: [] });
        break;
      case 'DICT': {
        const items = popMark();
        const d = { k: 'dict', entries: [] };
        for (let j = 0; j + 1 < items.length; j += 2) d.entries.push([items[j], items[j + 1]]);
        stack.push(d);
        break;
      }
      case 'SETITEM': {
        const v = pop();
        const key = pop();
        addEntries(top(), [[key, v]]);
        break;
      }
      case 'SETITEMS': {
        const items = popMark();
        const pairs = [];
        for (let j = 0; j + 1 < items.length; j += 2) pairs.push([items[j], items[j + 1]]);
        addEntries(top(), pairs);
        break;
      }
      case 'EMPTY_SET':
        stack.push({ k: 'set', items: [] });
        break;
      case 'ADDITEMS': {
        const items = popMark();
        const t = top();
        if (t.k !== 'set') throw new PickleError('ADDITEMS on non-set');
        t.items.push(...items);
        break;
      }
      case 'FROZENSET':
        {
          const items = popMark(); // must run before reading `stack`
          stack.push({ k: 'frozenset', items });
        }
        break;
      case 'GLOBAL':
        stack.push({ k: 'global', module: arg[0], name: arg[1] });
        break;
      case 'STACK_GLOBAL': {
        const n = pop();
        const m = pop();
        if (m.k !== 'str' || n.k !== 'str') throw new PickleError('STACK_GLOBAL requires strings');
        stack.push({ k: 'global', module: m.v, name: n.v });
        break;
      }
      case 'REDUCE': {
        const args = pop();
        const fn = pop();
        stack.push(object(fn, args, 'reduce'));
        break;
      }
      case 'NEWOBJ': {
        const args = pop();
        const cls = pop();
        stack.push(object(cls, args, 'newobj'));
        break;
      }
      case 'NEWOBJ_EX': {
        const kwargs = pop();
        const args = pop();
        const cls = pop();
        stack.push(object(cls, args, 'newobj_ex', kwargs));
        break;
      }
      case 'INST': {
        const items = popMark();
        stack.push(object({ k: 'global', module: arg[0], name: arg[1] }, { k: 'tuple', items }, 'inst'));
        break;
      }
      case 'OBJ': {
        const items = popMark();
        if (!items.length) throw new PickleError('OBJ without class');
        stack.push(object(items[0], { k: 'tuple', items: items.slice(1) }, 'obj'));
        break;
      }
      case 'BUILD': {
        const state = pop();
        const obj = top();
        if (obj.k === 'object') {
          if (obj.state) warnings.add('An object received multiple BUILD states; only the last is shown.');
          obj.state = state;
        } else warnings.add(`BUILD applied to a ${obj.k}; state ignored for display.`);
        break;
      }
      case 'PERSID':
        stack.push({ k: 'opaque', what: `persistent id ${arg}` });
        break;
      case 'BINPERSID':
        pop();
        stack.push({ k: 'opaque', what: 'persistent id' });
        break;
      case 'EXT1':
      case 'EXT2':
      case 'EXT4':
        stack.push({ k: 'opaque', what: `extension code ${arg}` });
        break;
      case 'NEXT_BUFFER':
        stack.push({ k: 'opaque', what: 'out-of-band buffer' });
        break;
      case 'READONLY_BUFFER':
        break;
      case 'PUT':
      case 'BINPUT':
      case 'LONG_BINPUT':
        memo.set(Number(arg), top());
        break;
      case 'MEMOIZE':
        memo.set(memo.size, top());
        break;
      case 'GET':
      case 'BINGET':
      case 'LONG_BINGET': {
        const idx = Number(arg);
        if (!memo.has(idx)) throw new PickleError(`Memo ${idx} referenced before definition`);
        memoGets.add(idx);
        const v = memo.get(idx);
        // Primitives are values: give this occurrence its own op so it can be edited independently.
        stack.push(PRIMITIVE_KINDS.has(v.k) ? { ...v, op: i, viaMemo: true } : v);
        break;
      }
      default:
        throw new PickleError(`Unhandled opcode ${name}`);
    }
  }
}

// ---------------------------------------------------------------- encoding primitives

function u32le(n) {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

function encodeLong(v) {
  let big = BigInt(v);
  if (big === 0n) return new Uint8Array(0);
  const out = [];
  const neg = big < 0n;
  while (true) {
    const byte = Number(big & 0xffn);
    out.push(byte);
    big >>= 8n;
    if (!neg && big === 0n && !(byte & 0x80)) break;
    if (neg && big === -1n && byte & 0x80) break;
  }
  return Uint8Array.from(out);
}

function pyFloatRepr(v) {
  if (Number.isNaN(v)) return 'nan';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  const s = String(v);
  return /[.eE]/.test(s) ? s : s + '.0';
}

function rawUnicodeEscape(s) {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === 0x5c || cp === 0x0a || cp === 0x0d || cp === 0x00 || cp === 0x1a) out += '\\u' + cp.toString(16).padStart(4, '0');
    else if (cp > 0xffff) out += '\\U' + cp.toString(16).padStart(8, '0');
    else if (cp > 0xff) out += '\\u' + cp.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out;
}

/** Encodes a primitive in the same opcode family as the original op. */
export function encodePrimitive(node, value, origOp, protocol) {
  const text = ['INT', 'LONG', 'FLOAT', 'STRING', 'UNICODE'].includes(origOp.name);
  switch (node.k) {
    case 'bool':
      if (protocol >= 2 && !text) return Uint8Array.of(value ? 0x88 : 0x89);
      return latin1Encode(value ? 'I01\n' : 'I00\n');
    case 'int': {
      const big = BigInt(value);
      if (text) {
        if (big >= -(2n ** 31n) && big < 2n ** 31n) return latin1Encode(`I${big}\n`);
        return latin1Encode(`L${big}L\n`);
      }
      if (big >= 0n && big < 256n) return Uint8Array.of(0x4b, Number(big));
      if (big >= 0n && big < 65536n) return Uint8Array.of(0x4d, Number(big) & 0xff, Number(big) >> 8);
      if (big >= -(2n ** 31n) && big < 2n ** 31n) return Uint8Array.of(0x4a, ...u32le(Number(big)));
      if (protocol < 2) return latin1Encode(`L${big}L\n`);
      const raw = encodeLong(big);
      if (raw.length < 256) return Uint8Array.of(0x8a, raw.length, ...raw);
      return concatBytes([Uint8Array.of(0x8b, ...u32le(raw.length)), raw]);
    }
    case 'float': {
      if (text) return latin1Encode(`F${pyFloatRepr(value)}\n`);
      const out = new Uint8Array(9);
      out[0] = 0x47;
      new DataView(out.buffer).setFloat64(1, value, false);
      return out;
    }
    case 'str': {
      if (node.py2) {
        const raw = node.enc === 'latin1' ? latin1Encode(value) : utf8Encode(value);
        if (origOp.name === 'STRING') {
          let r = "'";
          for (const b of raw) {
            if (b === 0x27) r += "\\'";
            else if (b === 0x5c) r += '\\\\';
            else if (b >= 0x20 && b < 0x7f) r += String.fromCharCode(b);
            else r += '\\x' + b.toString(16).padStart(2, '0');
          }
          return latin1Encode(`S${r}'\n`);
        }
        if (raw.length < 256) return concatBytes([Uint8Array.of(0x55, raw.length), raw]);
        return concatBytes([Uint8Array.of(0x54, ...u32le(raw.length)), raw]);
      }
      if (text) return concatBytes([Uint8Array.of(0x56), latin1Encode(rawUnicodeEscape(value)), Uint8Array.of(0x0a)]);
      const raw = utf8Encode(value);
      if (protocol >= 4 && raw.length < 256) return concatBytes([Uint8Array.of(0x8c, raw.length), raw]);
      return concatBytes([Uint8Array.of(0x58, ...u32le(raw.length)), raw]);
    }
    default:
      throw new PickleError(`Cannot encode ${node.k}`);
  }
}

function memoIndexOf(op, memoKeys) {
  return op.name === 'MEMOIZE' ? memoKeys.size : Number(op.arg);
}

/**
 * Rebuilds the pickle with primitive replacements.
 * @param parsed result of parsePickle
 * @param replacements Map<opIndex, {node, value}>
 */
export function patchPickle(parsed, replacements) {
  const { ops, bytes, protocol, memoGets } = parsed;
  if (!replacements.size) return bytes;
  const POP = Uint8Array.of(0x30);
  const segments = []; // [{frame: bool, chunks: []}]
  let current = { frame: false, chunks: [] };
  segments.push(current);
  const memoKeys = new Set();
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.name === 'FRAME') {
      current = { frame: true, chunks: [] };
      segments.push(current);
      continue;
    }
    const orig = bytes.subarray(op.start, op.end);
    const rep = replacements.get(i);
    if (rep) {
      const encoded = encodePrimitive(rep.node, rep.value, op, protocol);
      const next = ops[i + 1];
      if (/GET$/.test(op.name)) {
        current.chunks.push(encoded); // the memo keeps the original value for other references
      } else if (next && PUT_OPS.has(next.name) && memoGets.has(memoIndexOf(next, memoKeys))) {
        // Keep the original literal memoized for its other references, then swap it for the new value.
        current.chunks.push(orig, bytes.subarray(next.start, next.end), POP, encoded);
        memoKeys.add(memoIndexOf(next, memoKeys));
        i++;
      } else {
        current.chunks.push(encoded);
      }
      continue;
    }
    if (PUT_OPS.has(op.name)) memoKeys.add(memoIndexOf(op, memoKeys));
    current.chunks.push(orig);
  }
  const out = [];
  for (const seg of segments) {
    const body = concatBytes(seg.chunks);
    if (seg.frame) {
      const head = new Uint8Array(9);
      head[0] = 0x95;
      new DataView(head.buffer).setBigUint64(1, BigInt(body.length), true);
      out.push(head);
    }
    out.push(body);
  }
  out.push(parsed.trailer);
  return concatBytes(out);
}

export function globalName(node) {
  return node && node.k === 'global' ? `${node.module}.${node.name}` : null;
}
