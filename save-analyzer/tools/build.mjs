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

// Userscript (for the free "Userscripts" Safari extension on iOS — no Mac needed).
// It only adds a small launcher button; the trainer starts when you tap it.
const userscript = `// ==UserScript==
// @name         SaveForge Trainer
// @description  Floating SaveForge trainer for browser games. Tap the small hexagon button to open it.
// @version      1.0.0
// @match        *://*/*
// @run-at       document-idle
// @inject-into  page
// @noframes
// ==/UserScript==

(function () {
  'use strict';
  if (window.__saveforgeLauncher) return;
  window.__saveforgeLauncher = true;
  if (sessionStorage.getItem('saveforge.launcher.hidden') === '1') return;
  function startTrainer() {
${trainerFile.replace(/^/gm, '    ')}
  }
  var b = document.createElement('button');
  b.type = 'button';
  b.title = 'Open SaveForge Trainer (long-press to hide on this page)';
  b.setAttribute('aria-label', 'Open SaveForge Trainer');
  b.textContent = '\\u2B22';
  b.setAttribute('style', 'all:initial;position:fixed;z-index:2147483645;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#3df5a7,#22d3ee);color:#04140d;font:700 20px/40px system-ui;text-align:center;opacity:.55;box-shadow:0 4px 14px rgba(0,0,0,.4);cursor:pointer;');
  var pressTimer = 0;
  b.addEventListener('pointerdown', function (e) { e.stopPropagation(); pressTimer = setTimeout(function () { pressTimer = -1; sessionStorage.setItem('saveforge.launcher.hidden', '1'); b.remove(); }, 800); });
  b.addEventListener('pointerup', function (e) { e.stopPropagation(); if (pressTimer === -1) return; clearTimeout(pressTimer); if (window.__saveforgeTrainer) window.__saveforgeTrainer.show(); else startTrainer(); sync(); });
  b.addEventListener('click', function (e) { e.stopPropagation(); });
  // hidden while the trainer is open (it has its own minimise button), back when it is closed
  function sync() { b.style.display = window.__saveforgeTrainer ? 'none' : 'block'; }
  setInterval(sync, 1000);
  (document.body || document.documentElement).appendChild(b);
})();
`;
writeFileSync(new URL('standalone/saveforge-trainer.user.js', root), userscript);
console.log(`standalone/saveforge-trainer.user.js ${(userscript.length / 1024).toFixed(1)} KB`);
