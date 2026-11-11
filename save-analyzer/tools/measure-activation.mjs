// Measures what activating SaveForge costs on a page (SaveForge 2.3.1, written for the Ren'Py
// activation crash). The userscript is injected like the Userscripts app does, the page is left
// to run, then SaveForge is activated (#saveforge) and the trainer left open for 10 s.
//
//   node tools/measure-activation.mjs <userscript.js> <page path?query> [label]
//   e.g. node tools/measure-activation.mjs standalone/saveforge-trainer.user.js "/test/fixtures/renpy-web/?mem=192"
//
// Reported: whether the renderer crashed (Chromium's equivalent of Safari reloading the page),
// time until the panel shows its first screen, the renderer's resident memory before and at its
// peak (sampled from /proc, so it is measured even while the page's main thread is frozen), long
// tasks, and what SaveForge opened. V8's heap is capped at 1.5 GB to approximate an iPhone tab.
// This is Chromium on Linux, not Safari: the numbers show relative cost, not iOS's limits.
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = new URL('..', import.meta.url).pathname;
const require = createRequire(ROOT);
const { chromium } = require('playwright');
const [, , usPath, pagePath = '/test/fixtures/renpy-web/', label = ''] = process.argv;
const US = readFileSync(usPath, 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
  try {
    const f = p.endsWith('/') ? join(p, 'index.html') : p;
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }).end(readFileSync(f));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=1536'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
  window.__lt = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration));
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* no long task timing */
  }
});
await ctx.addInitScript({ content: US });
const page = await ctx.newPage();
let crashed = false;
page.on('crash', () => (crashed = true));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const rendererRss = () => {
  let total = 0;
  for (const pid of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      if (!readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('--type=renderer')) continue;
      const m = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
      if (m) total += Number(m[1]);
    } catch {
      /* process gone */
    }
  }
  return Math.round(total / 1024);
};
await page.goto(`${base}${pagePath}`);
await page.waitForFunction(() => document.body.dataset.ready === '1' || document.readyState === 'complete', null, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.evaluate(() => (window.__lt.length = 0));
const before = rendererRss();
let peak = before;
const sampler = setInterval(() => (peak = Math.max(peak, rendererRss())), 100);
const t0 = Date.now();
page.evaluate(() => (location.hash = '#saveforge')).catch(() => {});
let usableMs = null;
const end = t0 + 45000;
while (Date.now() < end && !crashed) {
  const ok = await page
    .evaluate(() => {
      const h = document.querySelector('saveforge-trainer');
      return !!(h && h.shadowRoot && h.shadowRoot.querySelector('.row, .badbox, .warnbox, .okbox'));
    })
    .catch(() => false);
  if (ok) {
    usableMs = Date.now() - t0;
    break;
  }
  await new Promise((r) => setTimeout(r, 100));
}
const openEnd = Date.now() + 10000;
while (Date.now() < openEnd && !crashed) await new Promise((r) => setTimeout(r, 200));
clearInterval(sampler);
const lt = crashed ? null : await page.evaluate(() => window.__lt).catch(() => null);
const info = crashed
  ? null
  : await page
      .evaluate(() => {
        const t = window.__saveforgeTrainer;
        const p = t?.provider?.();
        return { source: t?.state?.().sourceId ?? null, variables: p?.entries?.length ?? null, first: (p?.entries || []).slice(0, 4).map((e) => e.path) };
      })
      .catch(() => null);
console.log(JSON.stringify({ label, page: pagePath, crashed, usableMs, rssBeforeMB: before, rssPeakMB: peak, rssGrowthMB: peak - before, longTasks: lt ? lt.length : null, longestTaskMs: lt && lt.length ? Math.max(...lt) : 0, blockedMs: lt ? lt.reduce((a, b) => a + b, 0) : null, info, errors: errors.slice(0, 3) }));
await browser.close().catch(() => {});
server.close();
process.exit(0);
