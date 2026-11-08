// INI terminal (GameMaker ini_* saves, many custom engines).
// Edits replace only the value text of a line.

import { childId, makeNode } from './model.js';

export function looksLikeIni(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/^\s*[;#]/.test(l));
  if (lines.length < 2 || lines.length > 200000) return false;
  if (!/^\s*\[[^\]]+\]\s*$/.test(lines[0])) return false;
  let ok = 0;
  for (const l of lines) if (/^\s*\[[^\]]+\]\s*$/.test(l) || /^\s*[^=\[\]]+?\s*=/.test(l)) ok++;
  return ok / lines.length > 0.95;
}

const NUM = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

export class IniTerminal {
  constructor(text, prefix) {
    this.kind = 'ini';
    this.text = text;
    this.prefix = prefix;
    this.ranges = new Map();
    this.formats = new Map();
    this.root = makeNode(prefix, '(ini)', 'object', { children: [] });
    this.root.meta.className = 'INI';
    let section = this.root;
    const sectionSeen = new Map();
    const re = /[^\r\n]*(\r?\n|$)/g;
    let m;
    while ((m = re.exec(text)) && m[0] !== '') {
      const lineStart = m.index;
      const line = m[0].replace(/\r?\n$/, '');
      const sec = /^\s*\[([^\]]+)\]\s*$/.exec(line);
      if (sec) {
        const name = sec[1];
        const n = (sectionSeen.get(name) || 0) + 1;
        sectionSeen.set(name, n);
        section = makeNode(childId(prefix, n > 1 ? `${name}#${n}` : name), name, 'object', { children: [] });
        this.root.children.push(section);
        continue;
      }
      const kv = /^(\s*)([^=;#\[][^=]*?)(\s*=\s*)(.*?)\s*$/.exec(line);
      if (!kv) continue;
      const key = kv[2];
      const rawStart = lineStart + kv[1].length + kv[2].length + kv[3].length;
      let raw = kv[4];
      let quoted = false;
      let valueStart = rawStart;
      if (raw.length >= 2 && raw[0] === '"' && raw[raw.length - 1] === '"') {
        quoted = true;
        raw = raw.slice(1, -1);
        valueStart++;
      }
      const id = childId(section.id, key);
      let node;
      if (NUM.test(raw)) {
        const isFloat = /[.eE]/.test(raw);
        node = makeNode(id, key, isFloat ? 'float' : 'int', { value: Number(raw), editable: true });
        const dec = /\.(\d+)$/.exec(raw);
        this.formats.set(id, { decimals: dec ? dec[1].length : 0 });
      } else if (!quoted && /^(true|false)$/i.test(raw)) {
        node = makeNode(id, key, 'bool', { value: raw.toLowerCase() === 'true', editable: true });
        this.formats.set(id, { boolCase: raw });
      } else {
        node = makeNode(id, key, 'string', { value: raw, editable: true });
        node.meta.note = quoted ? 'Quoted INI value' : undefined;
      }
      this.ranges.set(id, [valueStart, valueStart + raw.length]);
      section.children.push(node);
    }
  }

  async serialize(edits) {
    const splices = [];
    for (const [id, v] of edits) {
      const r = this.ranges.get(id);
      if (!r) continue;
      const f = this.formats.get(id) || {};
      let text;
      if (typeof v === 'boolean') text = f.boolCase && f.boolCase === f.boolCase.toUpperCase() ? String(v).toUpperCase() : String(v);
      else if (typeof v === 'number' && f.decimals && Number(v.toFixed(f.decimals)) === v) text = v.toFixed(f.decimals);
      else text = String(v);
      if (/[\r\n]/.test(text)) throw new Error('INI values cannot contain line breaks');
      splices.push([r[0], r[1], text]);
    }
    if (!splices.length) return this.text;
    splices.sort((a, b) => b[0] - a[0]);
    let out = this.text;
    for (const [s, e, t] of splices) out = out.slice(0, s) + t + out.slice(e);
    return out;
  }
}
