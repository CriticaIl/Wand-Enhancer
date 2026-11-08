// High-level API: analyze a file, track edits with undo/redo, rebuild, validate.
// UI-agnostic so the same code path is exercised by the automated tests.

import { identifyEngine, lockStructuralFields } from '../adapters/profiles.js';
import { utf8Encode } from './bytes.js';
import { coerceValue, indexTree, sameValue, walk } from './model.js';
import { generateModMenu } from './modmenu.js';
import { analyzeBytes, analyzeText } from './pipeline.js';

export const ROOT = '$';

/**
 * Analyzes a file. Never throws for unsupported data; returns {ok:false, reasons}.
 */
export async function analyzeFile(name, input) {
  const trace = [];
  const isText = typeof input === 'string';
  let chain = null;
  try {
    chain = isText ? await analyzeText(input, ROOT, { trace, filename: name }) : await analyzeBytes(input, ROOT, { trace, filename: name });
  } catch (e) {
    trace.push(`Decoder error: ${e.message}`);
  }
  if (!chain || !chain.root.children) {
    return {
      ok: false,
      name,
      size: isText ? input.length : input.length,
      reasons: trace.length ? [...new Set(trace)] : ['No supported format was recognised.'],
    };
  }
  return { ok: true, doc: new SaveDocument(name, input, chain) };
}

export class SaveDocument {
  constructor(name, input, chain) {
    this.name = name;
    this.input = input;
    this.chain = chain;
    this.root = chain.root;
    this.index = indexTree(this.root);
    this.engine = identifyEngine(this);
    this.warnings = collectWarnings(this);
    applyEngineRules(this);
    lockStructuralFields(this.root);
    this.menu = generateModMenu(this.root);
    this.leafCount = 0;
    walk(this.root, (n) => {
      if (!n.children) this.leafCount++;
    });
  }

  node(id) {
    return this.index.byId.get(id);
  }

  /** Rebuilds the save with the given edits. Returns Uint8Array (or string for pasted text). */
  async build(edits) {
    for (const [id, v] of edits) {
      const n = this.node(id);
      if (!n) throw new Error(`Unknown field ${id}`);
      if (!n.editable) throw new Error(`${n.key} is read-only${n.meta.readOnlyReason ? `: ${n.meta.readOnlyReason}` : ''}`);
      coerceValue(n, typeof v === 'bigint' ? v.toString() : v);
    }
    return this.chain.serialize(edits);
  }

  /** Re-decodes rebuilt output and checks every value is what we expect. */
  async validate(output, edits) {
    const res = await analyzeFile(this.name, output);
    const problems = [];
    if (!res.ok) return { ok: false, problems: ['Rebuilt file could not be decoded again: ' + res.reasons.join('; ')] };
    const after = res.doc;
    const side = new Set(sideEffects(this.chain));
    let checked = 0;
    for (const [id, n] of this.index.byId) {
      if (n.children || side.has(id)) continue;
      const m = after.node(id);
      if (!m) {
        problems.push(`Missing after rebuild: ${id}`);
        continue;
      }
      const expected = edits.has(id) ? edits.get(id) : n.value;
      checked++;
      if (n.type === 'bytes') {
        if (n.value.length !== m.value.length) problems.push(`Binary data changed: ${id}`);
      } else if (m.type !== n.type) problems.push(`Type changed at ${id}: ${n.type} → ${m.type}`);
      else if (!sameValue(m.value, expected)) problems.push(`Value mismatch at ${id}`);
    }
    if (after.index.byId.size !== this.index.byId.size) problems.push(`Field count changed: ${this.index.byId.size} → ${after.index.byId.size}`);
    return { ok: problems.length === 0, problems: problems.slice(0, 50), checked, total: problems.length };
  }

  async export(edits) {
    const out = await this.build(edits);
    const bytes = typeof out === 'string' ? utf8Encode(out) : out;
    const validation = await this.validate(out, edits);
    return { bytes, validation, filename: this.name, unchanged: edits.size === 0 };
  }
}

function sideEffects(chain) {
  const out = [];
  const visit = (t) => {
    if (!t) return;
    if (t.sideEffects) out.push(...t.sideEffects);
    if (t.entries) for (const e of t.entries) if (e.chain) visit(e.chain.terminal);
    if (t.embedded) for (const c of t.embedded.values()) visit(c.terminal);
  };
  visit(chain.terminal);
  return out;
}

function collectWarnings(doc) {
  const out = [...doc.chain.warnings];
  const visit = (t) => {
    if (t.warnings && t !== doc.chain.terminal) out.push(...t.warnings);
    if (t.entries) for (const e of t.entries) if (e.chain) visit(e.chain.terminal);
    if (t.embedded) for (const c of t.embedded.values()) visit(c.terminal);
  };
  visit(doc.chain.terminal);
  return [...new Set(out)];
}

function applyEngineRules(doc) {
  // Ren'Py persistent files carry a signature after the zlib stream (8.1+).
  // A modified persistent cannot be re-signed here and the game would discard it.
  const visit = (chain) => {
    const t = chain.terminal;
    if (t.kind === 'pickle' && chain.zlibTrailer && chain.zlibTrailer.length && /Persistent$/.test(chain.root.meta.className || '')) {
      chain.setReadOnly(
        "Signed Ren'Py persistent data: Ren'Py 8.1+ discards persistent files whose signature does not match, and the signing key is not part of the file. Shown read-only to avoid wiping your persistent data.",
      );
      doc.warnings?.push?.('Persistent data is signed; editing is disabled to protect it.');
    }
    if (t.entries) for (const e of t.entries) if (e.chain) visit(e.chain);
    if (t.embedded) for (const c of t.embedded.values()) visit(c);
  };
  visit(doc.chain);
  // propagate read-only flags into the (shared) node objects already indexed
}

// ---------------------------------------------------------------- edit session

export class EditSession {
  constructor(doc) {
    this.doc = doc;
    this.edits = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason, ids = []) {
    for (const fn of this.listeners) fn(reason, ids);
  }

  value(id) {
    return this.edits.has(id) ? this.edits.get(id) : this.doc.node(id).value;
  }

  isEdited(id) {
    return this.edits.has(id);
  }

  /** Applies one or more changes as a single undo step. Throws on invalid input (nothing applied). */
  set(changes, label = 'Edit') {
    const list = Array.isArray(changes) ? changes : [changes];
    const step = [];
    for (const { id, value } of list) {
      const node = this.doc.node(id);
      if (!node) throw new Error(`Unknown field ${id}`);
      if (!node.editable) throw new Error(node.meta.readOnlyReason || `${node.key} is read-only`);
      const v = coerceValue(node, value);
      const before = this.edits.has(id) ? this.edits.get(id) : undefined;
      const after = sameValue(v, node.value) ? undefined : v;
      if (before === after || (before !== undefined && after !== undefined && sameValue(before, after))) continue;
      step.push({ id, before, after });
    }
    if (!step.length) return false;
    this.apply(step, 'after');
    this.undoStack.push({ label, step });
    this.redoStack = [];
    this.emit('edit', step.map((s) => s.id));
    return true;
  }

  apply(step, which) {
    for (const s of step) {
      const v = s[which];
      if (v === undefined) this.edits.delete(s.id);
      else this.edits.set(s.id, v);
    }
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.apply([...e.step].reverse(), 'before');
    this.redoStack.push(e);
    this.emit('undo', e.step.map((s) => s.id));
    return true;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.apply(e.step, 'after');
    this.undoStack.push(e);
    this.emit('redo', e.step.map((s) => s.id));
    return true;
  }

  revert(id) {
    if (!this.edits.has(id)) return false;
    return this.set({ id, value: this.doc.node(id).value }, 'Revert');
  }

  reset() {
    if (!this.edits.size) return false;
    const step = [...this.edits].map(([id, v]) => ({ id, before: v, after: undefined }));
    this.apply(step, 'after');
    this.undoStack.push({ label: 'Reset all', step });
    this.redoStack = [];
    this.emit('reset', step.map((s) => s.id));
    return true;
  }

  diff() {
    return [...this.edits].map(([id, after]) => ({ id, node: this.doc.node(id), before: this.doc.node(id).value, after }));
  }

  export() {
    return this.doc.export(this.edits);
  }
}
