// A save imported from the SaveForge Save Editor (share code or pasted save text).
// Shown as SAVE variables that are clearly not the running game. Edits can be
// exported (file or share code) or — only when the game's own storage holds the
// very same save — transferred into that save and written with the usual
// verified Write saves / Apply & Reload flow.

import { EditSession } from '../core/document.js';
import { isSugarCubeSaveNode, pathKey, resolveSugarCubeSave } from '../adapters/sugarcube-moments.js';
import { FileProvider } from './providers.js';

export class ImportedProvider extends FileProvider {
  constructor(doc, meta = {}) {
    super(doc, new EditSession(doc));
    this.imported = true;
    this.meta = meta;
    this.title = `Imported: ${doc.name}`;
    this.note = `A copy of “${doc.name}”${meta.shared ? ' shared from the SaveForge Save Editor' : ' pasted into the trainer'}. These are SAVE values, not the running game: edits go into an exported file or share code, or into the game’s own matching save when one is verified.`;
  }
  statusOf(id) {
    const node = this.node(id);
    if (node && !node.editable) return { state: 'readonly', detail: node.meta.readOnlyReason || 'This value cannot be edited.' };
    if (this.session.isEdited(id)) return { state: 'export', detail: 'Imported save edit (not live): Export it, copy a share code for the Save Editor, or write it into the game’s matching save.' };
    return null;
  }
}

const kid = (n, k) => (n && n.children ? n.children.find((c) => c.key === k) || null : null);

function containersOf(doc, test) {
  const out = [];
  for (const [id, n] of doc.index.byId) if (n.children && test(n)) out.push({ id, node: n });
  return out;
}
function leafMap(node, prefix = '') {
  const m = new Map();
  const walk = (n, p) => {
    if (!n.children) return void m.set(p, n.value);
    for (const c of n.children) walk(c, `${p}/${c.key}`);
  };
  walk(node, prefix);
  return m;
}

/**
 * Finds the game's own save that IS the imported save (never a guess):
 *   SugarCube: same story id and same save date
 *   anything else: every value identical at the same relative paths
 * @returns {storageId, how, transfer(edits) → {changes, skipped}} or null
 */
export function matchImported(impDoc, sp) {
  if (!sp) return null;
  const imp = containersOf(impDoc, isSugarCubeSaveNode);
  if (imp.length) {
    const a = imp[0];
    const id = kid(a.node, 'id')?.value;
    const date = kid(a.node, 'date')?.value;
    if (id === undefined || date === undefined) return null;
    const hit = containersOf(sp.doc, isSugarCubeSaveNode).find((b) => kid(b.node, 'id')?.value === id && String(kid(b.node, 'date')?.value) === String(date));
    if (!hit) return null;
    const ra = resolveSugarCubeSave(a.node);
    const rb = resolveSugarCubeSave(hit.node);
    return {
      storageId: hit.id,
      how: `same SugarCube save (story id “${id}”, saved ${new Date(Number(date)).toLocaleString()})`,
      transfer(edits) {
        const changes = [];
        const skipped = [];
        for (const [impId, value] of edits) {
          const info = ra.byNode.get(impId);
          const target = info && info.current ? rb.current.get(pathKey(info.path)) : null;
          if (target) changes.push({ id: target.nodeId, value, label: `$${info.path.join('.')}` });
          else skipped.push(impId);
        }
        return { changes, skipped };
      },
    };
  }
  // generic: an identical subtree in the game's storage
  const want = leafMap(impDoc.root);
  if (want.size < 3) return null;
  for (const [id, n] of sp.doc.index.byId) {
    if (!n.children || n.children.length !== impDoc.root.children.length) continue;
    const have = leafMap(n);
    if (have.size !== want.size) continue;
    let same = true;
    for (const [k, v] of want) if (have.get(k) !== v) (same = false);
    if (!same) continue;
    return {
      storageId: id,
      how: `identical save data (${want.size} values) in the game’s storage`,
      transfer(edits) {
        const changes = [];
        const skipped = [];
        for (const [impId, value] of edits) {
          const rel = impId.slice(1);
          const target = `${id}${rel}`;
          if (sp.node(target)) changes.push({ id: target, value, label: rel });
          else skipped.push(impId);
        }
        return { changes, skipped };
      },
    };
  }
  return null;
}
