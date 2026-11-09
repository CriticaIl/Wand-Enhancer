// Build ID: a hash of every source file, so a page can show exactly which code it runs
// (not just a version number someone typed). Used by tools/build.mjs and by the test
// that fails when the published files were not rebuilt after a source change.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export function sourceFiles(srcDir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|css)$/.test(name) && name !== 'version.js') out.push(p);
    }
  };
  walk(srcDir);
  return out;
}

export function buildId(root) {
  const src = join(root, 'src');
  const h = createHash('sha256');
  for (const f of sourceFiles(src)) {
    h.update(relative(src, f));
    h.update('\0');
    h.update(readFileSync(f));
    h.update('\0');
  }
  h.update(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
  return h.digest('hex').slice(0, 8);
}
