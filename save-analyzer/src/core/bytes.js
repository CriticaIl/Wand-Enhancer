// Byte/text helpers shared by every codec. Pure functions, no DOM access.

const encoder = new TextEncoder();

export function utf8Encode(text) {
  return encoder.encode(text);
}

/** Strict UTF-8 decode. Returns null when the bytes are not valid UTF-8. */
export function utf8DecodeStrict(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function utf8Decode(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

export function latin1Decode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return out;
}

export function latin1Encode(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64.charCodeAt(i)] = i;
B64_LOOKUP['-'.charCodeAt(0)] = 62; // url-safe alphabet
B64_LOOKUP['_'.charCodeAt(0)] = 63;

export function base64Encode(bytes, { urlSafe = false, pad = true } = {}) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (pad ? '==' : '');
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + (pad ? '=' : '');
  }
  if (urlSafe) out = out.replace(/\+/g, '-').replace(/\//g, '_');
  return out;
}

/** Decodes standard or url-safe base64. Returns null on any invalid character. */
export function base64Decode(text) {
  const clean = text.replace(/[\s]/g, '').replace(/=+$/, '');
  if (clean.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    const v = c < 128 ? B64_LOOKUP[c] : -1;
    if (v < 0) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Describes how a base64 string was written so it can be re-encoded the same way. */
export function base64Style(text) {
  const trimmed = text.trim();
  const lineMatch = trimmed.match(/^([^\r\n]+)\r?\n/);
  return {
    urlSafe: /[-_]/.test(trimmed),
    pad: /=$/.test(trimmed) || trimmed.replace(/\s/g, '').length % 4 === 0,
    lineLength: lineMatch && /[\r\n]/.test(trimmed) ? lineMatch[1].length : 0,
    newline: /\r\n/.test(trimmed) ? '\r\n' : '\n',
    trailingNewline: /\n$/.test(text),
  };
}

export function base64EncodeStyled(bytes, style) {
  let out = base64Encode(bytes, style);
  if (style.lineLength > 0) {
    const lines = [];
    for (let i = 0; i < out.length; i += style.lineLength) lines.push(out.slice(i, i + style.lineLength));
    out = lines.join(style.newline);
  }
  if (style.trailingNewline) out += style.newline;
  return out;
}

export function looksLikeBase64(text) {
  const clean = text.replace(/\s/g, '');
  if (clean.length < 8) return false;
  return /^[A-Za-z0-9+/\-_]+={0,2}$/.test(clean) && clean.length % 4 !== 1;
}

export function concatBytes(chunks) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

let crcTable = null;
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(i + 5552, bytes.length);
    for (; i < end; i++) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export function toHex(bytes, max = 64) {
  const parts = [];
  for (let i = 0; i < Math.min(bytes.length, max); i++) parts.push(bytes[i].toString(16).padStart(2, '0'));
  return parts.join(' ') + (bytes.length > max ? ' …' : '');
}

/** Rough "is this human text" ratio used to reject garbage decodes. */
export function printableRatio(text) {
  if (!text.length) return 0;
  let ok = 0;
  const n = Math.min(text.length, 4096);
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127 && !(c >= 0xd800 && c <= 0xdfff) && c !== 0xfffd)) ok++;
  }
  return ok / n;
}
