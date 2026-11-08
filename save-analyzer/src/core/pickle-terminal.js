// Presents a safely-parsed pickle as a tree and maps leaf edits back to opcodes.

import { childId, makeNode } from './model.js';
import { globalName, parsePickle, patchPickle } from './pickle.js';

const BUILTIN_SET = new Set(['builtins.set', '__builtin__.set', 'builtins.frozenset', '__builtin__.frozenset']);

function keyLabel(k) {
  switch (k.k) {
    case 'str':
      return k.v;
    case 'int':
    case 'float':
      return String(k.v);
    case 'bool':
      return k.v ? 'True' : 'False';
    case 'none':
      return 'None';
    case 'tuple':
      return `(${k.items.map(keyLabel).join(', ')}${k.items.length === 1 ? ',' : ''})`;
    case 'global':
      return globalName(k);
    case 'object':
      return `<${globalName(k.cls) || 'object'}>`;
    default:
      return `<${k.k}>`;
  }
}

export class PickleTerminal {
  constructor(bytes, prefix, ctx = {}) {
    this.kind = 'pickle';
    this.prefix = prefix;
    this.parsed = parsePickle(bytes);
    this.opById = new Map();
    this.pnodeById = new Map();
    this.visited = new Map();
    this.nodeCount = 0;
    this.warnings = [...this.parsed.warnings];
    this.root = this.convert(this.parsed.root, prefix, '(root)');
    this.root.meta.note = `Python pickle protocol ${this.parsed.protocol}. Decoded without executing any code; classes are shown by name only.`;
    if (this.parsed.trailer.length) this.warnings.push(`${this.parsed.trailer.length} byte(s) after the pickle STOP opcode are preserved unchanged.`);
  }

  convert(p, id, key) {
    this.nodeCount++;
    switch (p.k) {
      case 'none':
        return makeNode(id, key, 'null', { value: null });
      case 'bool':
      case 'int':
      case 'float':
      case 'str': {
        const type = p.k === 'str' ? 'string' : p.k;
        const n = makeNode(id, key, type, { value: p.v, editable: true });
        if (p.k === 'str' && p.py2) n.meta.note = `Python 2 byte string (${p.enc}).`;
        if (p.k === 'str' && p.enc === 'latin1') n.meta.latin1 = true;
        this.opById.set(id, p.op);
        this.pnodeById.set(id, p);
        return n;
      }
      case 'bytes': {
        const n = makeNode(id, key, 'bytes', { value: p.v });
        n.meta.size = p.v.length;
        n.meta.note = p.bytearray ? 'bytearray' : 'bytes';
        return n;
      }
      case 'global': {
        const n = makeNode(id, key, 'opaque', { value: globalName(p) });
        n.meta.note = 'Reference to a Python class or function (not executed).';
        return n;
      }
      case 'opaque':
        return makeNode(id, key, 'opaque', { value: p.what });
      default:
        break;
    }
    // containers
    if (this.visited.has(p)) {
      const n = makeNode(id, key, 'ref', { value: this.visited.get(p) });
      n.meta.refTo = this.visited.get(p);
      n.meta.note = 'Same Python object as another location; edit it there.';
      return n;
    }
    this.visited.set(p, id);
    const seen = new Map();
    const seg = (s) => {
      const c = (seen.get(s) || 0) + 1;
      seen.set(s, c);
      return c > 1 ? `${s}#${c}` : s;
    };
    const items = (list) => list.map((v, i) => this.convert(v, childId(id, seg(String(i))), String(i)));
    const entries = (pairs) =>
      pairs.map(([k, v]) => {
        const label = keyLabel(k);
        return this.convert(v, childId(id, seg(label)), label);
      });

    switch (p.k) {
      case 'list':
        return makeNode(id, key, 'list', { children: items(p.items) });
      case 'tuple':
        return makeNode(id, key, 'tuple', { children: items(p.items) });
      case 'set':
      case 'frozenset':
        return makeNode(id, key, 'set', { children: items(p.items), meta: { className: p.k } });
      case 'dict':
        return makeNode(id, key, 'dict', { children: entries(p.entries) });
      case 'object': {
        const cls = globalName(p.cls) || '<dynamic class>';
        const n = makeNode(id, key, 'instance', { children: [] });
        n.meta.className = cls;
        const args = p.args && p.args.k === 'tuple' ? p.args.items : p.args ? [p.args] : [];
        if (BUILTIN_SET.has(cls) && args[0] && args[0].k === 'list') {
          n.children.push(...items(args[0].items));
          n.type = 'set';
          return n;
        }
        if (p.dictEntries.length) n.children.push(...entries(p.dictEntries));
        if (p.listItems.length) n.children.push(...items(p.listItems));
        const state = p.state;
        const contentful = p.dictEntries.length || p.listItems.length;
        if (state && state.k === 'dict' && !contentful && !this.visited.has(state)) {
          this.visited.set(state, id);
          n.children.push(...entries(state.entries));
        } else if (
          state &&
          state.k === 'tuple' &&
          state.items.length === 2 &&
          !contentful &&
          state.items.every((s) => s.k === 'dict' || s.k === 'none')
        ) {
          for (const s of state.items) if (s.k === 'dict') n.children.push(...entries(s.entries));
        } else if (state) {
          n.children.push(this.convert(state, childId(id, seg('@state')), '@state'));
        }
        if (args.length) n.children.push(this.convert({ k: 'tuple', items: args }, childId(id, seg('@args')), '@args'));
        if (p.kwargs) n.children.push(this.convert(p.kwargs, childId(id, seg('@kwargs')), '@kwargs'));
        return n;
      }
      default:
        return makeNode(id, key, 'opaque', { value: p.k });
    }
  }

  async serialize(edits) {
    const replacements = new Map();
    for (const [id, value] of edits) {
      const op = this.opById.get(id);
      if (op === undefined) continue;
      const pnode = this.pnodeById.get(id);
      if (pnode.k === 'str' && pnode.enc === 'latin1' && /[^\u0000-ÿ]/.test(value)) {
        throw new Error(`${id}: this Python 2 string can only hold Latin-1 characters`);
      }
      replacements.set(op, { node: pnode, value });
    }
    return patchPickle(this.parsed, replacements);
  }
}
