// Minimal, defensive ZIP reader/writer (PKWARE APPNOTE subset).
// Supports stored (0) and deflated (8) entries, no encryption, no ZIP64.
// Unchanged entries are re-emitted with their original compressed bytes so
// unrelated data (screenshots, metadata) is preserved bit-for-bit.

import { concatBytes, crc32, latin1Decode, utf8DecodeStrict, utf8Encode } from './bytes.js';
import { deflateRaw, inflateRaw } from './compression.js';

const u16 = (b, p) => b[p] | (b[p + 1] << 8);
const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;

export function isZip(bytes) {
  return bytes.length >= 22 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6);
}

export function readZip(bytes) {
  let eocd = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 22 - 65535); p--) {
    if (u32(bytes, p) === 0x06054b50) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP end-of-central-directory record not found');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const comment = bytes.slice(eocd + 22, eocd + 22 + u16(bytes, eocd + 20));
  if (count === 0xffff || p === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const time = u16(bytes, p + 12);
    const date = u16(bytes, p + 14);
    const crc = u32(bytes, p + 16);
    const csize = u32(bytes, p + 20);
    const usize = u32(bytes, p + 24);
    const nlen = u16(bytes, p + 28);
    const xlen = u16(bytes, p + 30);
    const clen = u16(bytes, p + 32);
    const extAttr = u32(bytes, p + 38);
    const versionMadeBy = u16(bytes, p + 4);
    const local = u32(bytes, p + 42);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nlen);
    const name = flags & 0x800 ? utf8DecodeStrict(nameBytes) ?? latin1Decode(nameBytes) : latin1Decode(nameBytes);
    p += 46 + nlen + xlen + clen;

    if (u32(bytes, local) !== 0x04034b50) throw new Error(`Corrupt local header for ${name}`);
    const dataStart = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const raw = bytes.slice(dataStart, dataStart + csize);
    entries.push({ name, method, flags, time, date, crc, csize, usize, extAttr, versionMadeBy, raw, encrypted: !!(flags & 1) });
  }
  return { entries, comment };
}

export function entryData(entry) {
  if (entry.encrypted) throw new Error(`${entry.name} is encrypted`);
  let data;
  if (entry.method === 0) data = entry.raw;
  else if (entry.method === 8) data = inflateRaw(entry.raw, 0, Math.max(entry.usize * 2, 1 << 20)).data;
  else throw new Error(`${entry.name}: unsupported compression method ${entry.method}`);
  if (data.length !== entry.usize || crc32(data) !== entry.crc) throw new Error(`${entry.name}: CRC/size mismatch`);
  return data;
}

/**
 * Writes a ZIP. Each item is either an original entry (copied verbatim) or
 * `{name, data, method?, time?, date?}` for replaced content.
 */
export async function writeZip(items, comment = new Uint8Array(0)) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const item of items) {
    let { name, method = 8, time = 0, date = 0x21, crc, csize, usize, raw, extAttr = 0, versionMadeBy = 20 } = item;
    if (item.data) {
      usize = item.data.length;
      crc = crc32(item.data);
      raw = method === 8 ? await deflateRaw(item.data) : item.data;
      csize = raw.length;
    }
    const nameBytes = utf8Encode(name);
    const utf8 = /[^\x00-\x7f]/.test(name) ? 0x800 : 0;
    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, utf8, true);
    dv.setUint16(8, method, true);
    dv.setUint16(10, time, true);
    dv.setUint16(12, date, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, csize, true);
    dv.setUint32(22, usize, true);
    dv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, versionMadeBy, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, utf8, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, csize, true);
    cv.setUint32(24, usize, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(38, extAttr, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local, raw);
    centrals.push(central);
    offset += local.length + raw.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22 + comment.length);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, items.length, true);
  ev.setUint16(10, items.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, comment.length, true);
  end.set(comment, 22);
  return concatBytes([...locals, ...centrals, end]);
}
