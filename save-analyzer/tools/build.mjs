// Builds a single, self-contained HTML file (no network needed at runtime):
//   standalone/SaveForge.html
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
// Pure-ASCII output: some loaders (e.g. browser extension script loading) reject
// Unicode noncharacters such as U+FFFF that minifiers leave in regex literals.
const ascii = (code) => code.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
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
const code = ascii(js.outputFiles[0].text).replace(/<\/script/gi, '<\\/script');
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
writeFileSync(new URL('standalone/trainer.js', root), `/* SaveForge trainer - https://github.com/CriticaIl/Wand-Enhancer/tree/HEAD/save-analyzer */\n${ascii(trainer.outputFiles[0].text)}`);
console.log(`standalone/trainer.js ${(trainer.outputFiles[0].text.length / 1024).toFixed(1)} KB`);

// Safari Web Extension: ships the exact same trainer bundle.
const trainerFile = readFileSync(new URL('standalone/trainer.js', root), 'utf8');
writeFileSync(new URL('safari-extension/extension/trainer.js', root), trainerFile);

// Userscript for iOS Safari userscript managers (Userscripts, Stay, Tampermonkey).
// Built from the shared source; @version follows package.json so managers pick up updates.
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const PAGES = 'https://criticail.github.io/Wand-Enhancer/save-analyzer/standalone';
const usBundle = await build({
  entryPoints: [new URL('src/userscript/main.js', root).pathname],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['safari15', 'es2020'],
  write: false,
  legalComments: 'none',
  define: { __SAVEFORGE_VERSION__: JSON.stringify(pkg.version) },
});
const usMeta = `// ==UserScript==
// @name         SaveForge Trainer
// @namespace    https://github.com/CriticaIl/Wand-Enhancer/save-analyzer
// @version      ${pkg.version}
// @description  GTA-style floating trainer for browser games: live editing, Apply & Reload, and an explanation for every variable. Shows a small launcher only on pages that look like games; add #saveforge to any address to open it.
// @author       SaveForge
// @icon         https://criticail.github.io/Wand-Enhancer/save-analyzer/safari-extension/extension/images/icon-128.png
// @match        *://*/*
// @run-at       document-idle
// @inject-into  page
// @grant        none
// @updateURL    ${PAGES}/saveforge-trainer.meta.js
// @downloadURL  ${PAGES}/saveforge-trainer.user.js
// @homepageURL  https://github.com/CriticaIl/Wand-Enhancer/blob/claude/html5-game-save-analyzer-ogbcnf/save-analyzer/USERSCRIPT.md
// ==/UserScript==
`;
const userscript = `${usMeta}\n${ascii(usBundle.outputFiles[0].text)}`;
writeFileSync(new URL('standalone/saveforge-trainer.user.js', root), userscript);
writeFileSync(new URL('standalone/saveforge-trainer.meta.js', root), usMeta);
console.log(`standalone/saveforge-trainer.user.js ${(userscript.length / 1024).toFixed(1)} KB`);
