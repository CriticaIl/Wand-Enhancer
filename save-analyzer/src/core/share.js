// Moving a save between the SaveForge Save Editor (criticail.github.io) and the
// floating trainer (on the game's own site). Browsers keep different sites apart,
// so the user carries a share code through the clipboard; nothing is sent anywhere.
//
//   SAVEFORGE-SHARE-1:<lz-string, URI-safe JSON {v, name, engine, kind, data, at}>
//
// A plain save string (what the game itself exports, or a localStorage value) is
// accepted too.

import * as LZ from './lzstring.js';

export const SHARE_PREFIX = 'SAVEFORGE-SHARE-1:';

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** @param input string (pasted text) or Uint8Array (file bytes) */
export function encodeShare({ name, input, engine = '' }) {
  const isText = typeof input === 'string';
  const payload = { v: 1, name: name || 'save', engine, kind: isText ? 'text' : 'bytes', data: isText ? input : toB64(input), at: new Date().toISOString() };
  return SHARE_PREFIX + LZ.compressToEncodedURIComponent(JSON.stringify(payload));
}

/** @returns {name, input, engine, shared: boolean, at} — throws on a damaged share code */
export function decodeShare(text) {
  const t = String(text || '').trim();
  if (!t) throw new Error('Nothing was pasted.');
  if (!t.startsWith(SHARE_PREFIX)) return { name: 'pasted-save.txt', input: t, engine: '', shared: false, at: null };
  const json = LZ.decompressFromEncodedURIComponent(t.slice(SHARE_PREFIX.length));
  if (!json) throw new Error('This share code is damaged or incomplete (copy it again from the Save Editor).');
  let p;
  try {
    p = JSON.parse(json);
  } catch {
    throw new Error('This share code is damaged or incomplete (copy it again from the Save Editor).');
  }
  if (!p || p.v !== 1 || typeof p.data !== 'string') throw new Error('Unsupported share code version.');
  return { name: p.name || 'save', input: p.kind === 'bytes' ? fromB64(p.data) : p.data, engine: p.engine || '', shared: true, at: p.at || null };
}
