// DEFLATE / zlib / gzip support.
//
// Inflate is implemented in pure JS (RFC 1951) so decoding never depends on
// browser support. Compression prefers the platform CompressionStream
// (Safari 16.4+, Node 18+) and falls back to spec-valid "stored" deflate
// blocks, which every zlib/gzip/zip reader accepts.

import { adler32, concatBytes, crc32 } from './bytes.js';

// ---------------------------------------------------------------- inflate

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function buildHuffman(lengths) {
  const counts = new Uint16Array(16);
  for (const l of lengths) counts[l]++;
  counts[0] = 0;
  const offsets = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + counts[i - 1];
  const symbols = new Uint16Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbols[offsets[lengths[s]]++] = s;
  return { counts, symbols };
}

class BitReader {
  constructor(bytes, pos = 0) {
    this.bytes = bytes;
    this.pos = pos;
    this.bit = 0;
    this.cur = 0;
  }
  bits(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (this.bit === 0) {
        if (this.pos >= this.bytes.length) throw new Error('Unexpected end of deflate stream');
        this.cur = this.bytes[this.pos++];
        this.bit = 8;
      }
      v |= (this.cur & 1) << i;
      this.cur >>= 1;
      this.bit--;
    }
    return v;
  }
  align() {
    this.bit = 0;
  }
  decode(h) {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= this.bits(1);
      const count = h.counts[len];
      if (code - count < first) return h.symbols[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error('Invalid Huffman code');
  }
}

let fixedLit = null;
let fixedDist = null;
function fixedTables() {
  if (!fixedLit) {
    const l = new Uint8Array(288);
    l.fill(8, 0, 144);
    l.fill(9, 144, 256);
    l.fill(7, 256, 280);
    l.fill(8, 280, 288);
    fixedLit = buildHuffman(l);
    fixedDist = buildHuffman(new Uint8Array(30).fill(5));
  }
  return [fixedLit, fixedDist];
}

/**
 * Inflates a raw DEFLATE stream.
 * @returns {{data: Uint8Array, end: number}} decompressed bytes and the input offset after the final block.
 */
export function inflateRaw(input, start = 0, maxOutput = 512 * 1024 * 1024) {
  const br = new BitReader(input, start);
  let out = new Uint8Array(Math.max(1024, (input.length - start) * 4));
  let o = 0;
  const ensure = (n) => {
    if (o + n <= out.length) return;
    if (o + n > maxOutput) throw new Error('Decompressed data exceeds safety limit');
    let size = out.length * 2;
    while (size < o + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(out.subarray(0, o));
    out = next;
  };
  let final = 0;
  do {
    final = br.bits(1);
    const type = br.bits(2);
    if (type === 0) {
      br.align();
      const p = br.pos;
      if (p + 4 > input.length) throw new Error('Truncated stored block');
      const len = input[p] | (input[p + 1] << 8);
      const nlen = input[p + 2] | (input[p + 3] << 8);
      if ((len ^ 0xffff) !== nlen) throw new Error('Corrupt stored block length');
      if (p + 4 + len > input.length) throw new Error('Truncated stored block');
      ensure(len);
      out.set(input.subarray(p + 4, p + 4 + len), o);
      o += len;
      br.pos = p + 4 + len;
    } else if (type === 1 || type === 2) {
      let lit;
      let dist;
      if (type === 1) {
        [lit, dist] = fixedTables();
      } else {
        const hlit = br.bits(5) + 257;
        const hdist = br.bits(5) + 1;
        const hclen = br.bits(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = br.bits(3);
        const clh = buildHuffman(cl);
        const lengths = new Uint8Array(hlit + hdist);
        for (let i = 0; i < hlit + hdist; ) {
          const sym = br.decode(clh);
          if (sym < 16) lengths[i++] = sym;
          else {
            let rep = 0;
            let val = 0;
            if (sym === 16) {
              if (i === 0) throw new Error('Invalid repeat');
              val = lengths[i - 1];
              rep = 3 + br.bits(2);
            } else if (sym === 17) rep = 3 + br.bits(3);
            else rep = 11 + br.bits(7);
            if (i + rep > lengths.length) throw new Error('Invalid code lengths');
            lengths.fill(val, i, i + rep);
            i += rep;
          }
        }
        lit = buildHuffman(lengths.subarray(0, hlit));
        dist = buildHuffman(lengths.subarray(hlit));
      }
      for (;;) {
        const sym = br.decode(lit);
        if (sym < 256) {
          ensure(1);
          out[o++] = sym;
        } else if (sym === 256) break;
        else {
          const li = sym - 257;
          if (li >= 29) throw new Error('Invalid length symbol');
          const len = LEN_BASE[li] + br.bits(LEN_EXTRA[li]);
          const di = br.decode(dist);
          if (di >= 30) throw new Error('Invalid distance symbol');
          const d = DIST_BASE[di] + br.bits(DIST_EXTRA[di]);
          if (d > o) throw new Error('Distance too far back');
          ensure(len);
          for (let k = 0; k < len; k++, o++) out[o] = out[o - d];
        }
      }
    } else {
      throw new Error('Invalid deflate block type');
    }
  } while (!final);
  return { data: out.slice(0, o), end: br.pos };
}

// ---------------------------------------------------------------- deflate

function deflateStored(data) {
  const blocks = [];
  if (data.length === 0) return new Uint8Array([1, 0, 0, 0xff, 0xff]);
  for (let i = 0; i < data.length; i += 65535) {
    const chunk = data.subarray(i, Math.min(i + 65535, data.length));
    const header = new Uint8Array(5);
    header[0] = i + 65535 >= data.length ? 1 : 0;
    header[1] = chunk.length & 0xff;
    header[2] = chunk.length >> 8;
    header[3] = ~chunk.length & 0xff;
    header[4] = (~chunk.length >> 8) & 0xff;
    blocks.push(header, chunk);
  }
  return concatBytes(blocks);
}

async function streamThrough(format, data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Raw DEFLATE. Uses native compression when available, stored blocks otherwise. */
export async function deflateRaw(data) {
  if (typeof CompressionStream === 'function') {
    try {
      return await streamThrough('deflate-raw', data);
    } catch {
      try {
        const z = await streamThrough('deflate', data);
        return z.subarray(2, z.length - 4);
      } catch {
        /* fall through */
      }
    }
  }
  return deflateStored(data);
}

// ---------------------------------------------------------------- zlib

export function isZlibHeader(bytes) {
  if (bytes.length < 6) return false;
  const cmf = bytes[0];
  const flg = bytes[1];
  return (cmf & 0x0f) === 8 && cmf >> 4 <= 7 && ((cmf << 8) | flg) % 31 === 0 && !(flg & 0x20);
}

/**
 * @returns {{data: Uint8Array, level: number, trailer: Uint8Array}} trailer = bytes after the zlib stream
 * (Ren'Py appends save-token signatures there).
 */
export function zlibInflate(bytes) {
  if (!isZlibHeader(bytes)) throw new Error('Not a zlib stream');
  const { data, end } = inflateRaw(bytes, 2);
  if (end + 4 > bytes.length) throw new Error('Missing zlib checksum');
  const stored = ((bytes[end] << 24) | (bytes[end + 1] << 16) | (bytes[end + 2] << 8) | bytes[end + 3]) >>> 0;
  if (stored !== adler32(data)) throw new Error('zlib checksum mismatch');
  return { data, level: bytes[1] >> 6, trailer: bytes.slice(end + 4) };
}

export async function zlibDeflate(data, level = 2) {
  const raw = await deflateRaw(data);
  const cmf = 0x78;
  let flg = (level & 3) << 6;
  flg += 31 - (((cmf << 8) | flg) % 31);
  const sum = adler32(data);
  return concatBytes([
    new Uint8Array([cmf, flg]),
    raw,
    new Uint8Array([sum >>> 24, (sum >>> 16) & 0xff, (sum >>> 8) & 0xff, sum & 0xff]),
  ]);
}

// ---------------------------------------------------------------- gzip

export function isGzip(bytes) {
  return bytes.length > 18 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 8;
}

export function gunzip(bytes) {
  if (!isGzip(bytes)) throw new Error('Not a gzip stream');
  const flags = bytes[3];
  let p = 10;
  if (flags & 4) p += 2 + (bytes[p] | (bytes[p + 1] << 8));
  let name = '';
  if (flags & 8) {
    while (bytes[p] !== 0) name += String.fromCharCode(bytes[p++]);
    p++;
  }
  if (flags & 16) while (bytes[p++] !== 0);
  if (flags & 2) p += 2;
  const { data, end } = inflateRaw(bytes, p);
  const crc = (bytes[end] | (bytes[end + 1] << 8) | (bytes[end + 2] << 16) | (bytes[end + 3] << 24)) >>> 0;
  if (crc !== crc32(data)) throw new Error('gzip CRC mismatch');
  return { data, name, header: bytes.slice(0, 10) };
}

export async function gzip(data, header) {
  const raw = await deflateRaw(data);
  const head = new Uint8Array(10);
  if (header) head.set(header.subarray(0, 10));
  else head.set([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff]);
  head[3] = 0; // we never re-emit optional fields
  const crc = crc32(data);
  const n = data.length >>> 0;
  return concatBytes([
    head,
    raw,
    new Uint8Array([crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24, n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, n >>> 24]),
  ]);
}
