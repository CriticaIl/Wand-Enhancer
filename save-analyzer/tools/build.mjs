// Builds a single, self-contained HTML file (no network needed at runtime):
//   standalone/SaveForge.html
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const js = await build({
  entryPoints: [new URL('src/main.js', root).pathname],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['safari15', 'es2020'],
  write: false,
  legalComments: 'none',
});
const css = await build({ entryPoints: [new URL('src/ui/styles.css', root).pathname], bundle: true, minify: true, write: false, target: ['safari15'] });
const code = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
let html = readFileSync(new URL("index.html", root), "utf8").replace("<html lang=\"en\">", "<html lang=\"en\" data-standalone=\"1\">");
html = html.replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${css.outputFiles[0].text}</style>`);
html = html.replace(/<script type="module" src="src\/main.js"><\/script>/, () => `<script>${code}</script>`);
mkdirSync(new URL('standalone/', root), { recursive: true });
writeFileSync(new URL('standalone/SaveForge.html', root), html);
console.log(`standalone/SaveForge.html ${(html.length / 1024).toFixed(1)} KB`);

// Trainer overlay for game pages (loaded by the trainer bookmarklet or injected same-origin).
const trainer = await build({
  entryPoints: [new URL('src/trainer/bookmarklet-entry.js', root).pathname],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['safari15', 'es2020'],
  write: false,
  legalComments: 'none',
});
writeFileSync(new URL('standalone/trainer.js', root), `/* SaveForge trainer — https://github.com/CriticaIl/Wand-Enhancer/tree/HEAD/save-analyzer */\n${trainer.outputFiles[0].text}`);
console.log(`standalone/trainer.js ${(trainer.outputFiles[0].text.length / 1024).toFixed(1)} KB`);
