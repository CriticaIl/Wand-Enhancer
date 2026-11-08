import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const SAMPLES = new URL('../samples/', import.meta.url);
export const TOOLS = new URL('../tools/', import.meta.url);

export function sampleNames() {
  return readdirSync(SAMPLES).filter((f) => !f.startsWith('.') && f !== 'README.md');
}

export function readSample(name) {
  return new Uint8Array(readFileSync(new URL(name, SAMPLES)));
}

export function hasPython() {
  try {
    execFileSync('python3', ['-c', 'print(1)']);
    return true;
  } catch {
    return false;
  }
}

/** A deterministic, type-preserving change for any editable value. */
export function mutate(node) {
  const v = node.value;
  switch (node.type) {
    case 'int':
      return typeof v === 'bigint' ? v + 7n : v + 7;
    case 'float':
      return v + 0.5;
    case 'bool':
      return !v;
    case 'string':
      return node.meta.latin1 ? `${v}x` : `${v}·Δ✓`;
    default:
      throw new Error(`not editable: ${node.type}`);
  }
}

export function editableNodes(doc) {
  return [...doc.index.byId.values()].filter((n) => n.editable);
}
