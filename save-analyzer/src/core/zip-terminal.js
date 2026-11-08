// ZIP terminal: every entry is analyzed independently through the pipeline.
// Unchanged entries are copied verbatim (original compressed bytes).

import { printableRatio, utf8DecodeStrict, utf8Encode } from './bytes.js';
import { childId, makeNode } from './model.js';
import { entryData, readZip, writeZip } from './zip.js';

const MAX_TEXT_ENTRY = 64 * 1024;

export class ZipTerminal {
  constructor(bytes, prefix, ctx) {
    this.kind = 'zip';
    this.prefix = prefix;
    this.ctx = ctx;
    this.bytes = bytes;
    this.zip = readZip(bytes);
    this.warnings = [];
    this.sideEffects = [];
    this.entries = this.zip.entries.map((e) => ({ entry: e, id: childId(prefix, e.name), chain: null, text: null, data: null }));
    this.names = new Set(this.zip.entries.map((e) => e.name));
    this.isRenpy = this.names.has('log') && (this.names.has('renpy_version') || this.names.has('signatures') || this.names.has('extra_info'));
    this.root = makeNode(prefix, '(archive)', 'zip', { children: [] });
    this.root.meta.className = 'ZIP archive';
  }

  async init() {
    for (const item of this.entries) {
      const { entry, id } = item;
      let node;
      try {
        item.data = entryData(entry);
      } catch (e) {
        node = makeNode(id, entry.name, 'opaque', { value: `unreadable: ${e.message}` });
        this.root.children.push(node);
        continue;
      }
      try {
        item.chain = await this.ctx.analyzeBytes(item.data, id, { ...this.ctx, depth: (this.ctx.depth || 0) + 1, entryName: entry.name, zip: this });
      } catch (e) {
        this.warnings.push(`${entry.name}: ${e.message}`);
        item.chain = null;
      }
      if (item.chain && item.chain.root.children) {
        node = makeNode(id, entry.name, 'embedded', { children: item.chain.root.children });
        node.meta.encoding = item.chain.describe();
        node.meta.className = item.chain.root.meta.className;
        node.meta.innerType = item.chain.root.type;
        if (item.chain.readOnlyReason) node.meta.readOnlyReason = item.chain.readOnlyReason;
      } else {
        const text = item.data.length <= MAX_TEXT_ENTRY ? utf8DecodeStrict(item.data) : null;
        if (text !== null && (text === '' || printableRatio(text) > 0.97)) {
          item.text = text;
          node = makeNode(id, entry.name, 'string', { value: text, editable: true });
          node.meta.note = 'Plain text file inside the archive.';
          if (this.isRenpy && entry.name === 'signatures') {
            node.editable = false;
            node.meta.readOnlyReason = "Ren'Py save signature. Managed automatically: cleared when the game state changes.";
          }
        } else {
          node = makeNode(id, entry.name, 'bytes', { value: item.data });
          node.meta.size = item.data.length;
          node.meta.note = /\.png$/i.test(entry.name) ? 'PNG image (kept unchanged).' : 'Binary data not recognised; kept unchanged.';
        }
      }
      this.root.children.push(node);
    }
    return this;
  }

  async serialize(edits) {
    const items = [];
    const changed = new Set();
    for (const item of this.entries) {
      const { entry, id } = item;
      let newData = null;
      if (item.chain) {
        let touched = false;
        for (const k of edits.keys()) if (k.startsWith(id + '/')) touched = true;
        if (touched) newData = await item.chain.serialize(edits);
      } else if (item.text !== null && edits.has(id)) {
        newData = utf8Encode(edits.get(id));
      }
      if (newData) {
        changed.add(entry.name);
        items.push({ name: entry.name, data: newData, method: entry.method === 0 ? 0 : 8, time: entry.time, date: entry.date, extAttr: entry.extAttr, versionMadeBy: entry.versionMadeBy });
      } else items.push(entry);
    }
    if (this.isRenpy && changed.has('log') && this.names.has('signatures')) {
      // Ren'Py 8.1+ refuses a save whose signature no longer matches its log, but accepts
      // an unsigned save after one confirmation prompt (renpy/savetoken.py check_load).
      const i = items.findIndex((x) => x.name === 'signatures');
      this.sideEffects = [childId(this.prefix, 'signatures')];
      const sig = items[i];
      items[i] = { name: 'signatures', data: new Uint8Array(0), method: sig.method === 0 ? 0 : 8, time: sig.time, date: sig.date };
    }
    if (!changed.size) return this.bytes;
    return writeZip(items, this.zip.comment);
  }
}
