// Profiles the trainer on the stress fixture under CPU throttling (≈ a phone).
//   node tools/profile-trainer.mjs "vars=20000&lines=5000" [cpuRate=4] [steadyMs=15000]
// Reports: open time, long tasks, the game's frame gaps while opening and while the
// trainer stays open (visible, then minimized), JS heap, and the top functions by
// self time during opening (CPU profile).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = new URL('..', import.meta.url).pathname;
const [query = 'vars=20000&lines=5000', rate = '4', steadyArg = '15000'] = process.argv.slice(2);
const steadyMs = Number(steadyArg);

const server = createServer(async (req, res) => {
  try {
    let p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (p.endsWith('/')) p += 'index.html';
    res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }).end(await readFile(p));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch();
const page = await browser.newPage(process.env.MOBILE ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__long = [];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] });
  } catch {
    /* no longtask support */
  }
});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const heap = async () => {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Math.round((metrics.find((m) => m.name === 'JSHeapUsedSize')?.value || 0) / 1048576);
};
await page.goto(`http://localhost:${server.address().port}/test/fixtures/stress/?${query}`);
await page.waitForFunction(() => window.__idbReady && window.__perf.frames > 30, null, { timeout: 120000 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(rate) });
// unminified build from source, so the profile names real functions
const { build } = await import('esbuild');
const trainer = (await build({ entryPoints: [join(ROOT, 'src/trainer/bookmarklet-entry.js')], bundle: true, format: 'iife', write: false, target: ['es2020'], minify: false })).outputFiles[0].text;
const heap0 = await heap();
await page.evaluate(() => (window.resetPerf(), (window.__long.length = 0)));
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
const t0 = Date.now();
await page.addScriptTag({ content: trainer });
await page.locator('saveforge-trainer .row').first().waitFor({ timeout: 120000 });
const firstRow = Date.now() - t0;
await page.waitForTimeout(4000);
const { profile } = await cdp.send('Profiler.stop');
const open = await page.evaluate(() => ({ ...window.__perf, long: window.__long.slice(), entries: window.__saveforgeTrainer.provider()?.entries.length, perf: window.__saveforgeTrainer.perf?.() }));
const heap1 = await heap();
// self time per function
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => {
  const n = byId.get(id);
  const f = n.callFrame;
  if (!f.functionName && !f.url) return;
  const key = `${f.functionName || '(anon)'} ${f.url ? f.url.replace(/.*\//, '') : ''}:${f.lineNumber}`;
  self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
});
const top = [...self].filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 18);
const gc = [...self].filter(([k]) => /garbage/.test(k)).reduce((a, [, v]) => a + v, 0);
// steady state, trainer visible on the home list (profiled too)
await page.evaluate(() => (window.resetPerf(), (window.__long.length = 0)));
await cdp.send('Profiler.start');
await page.waitForTimeout(steadyMs);
const steadyProfile = (await cdp.send('Profiler.stop')).profile;
const steady = await page.evaluate(() => ({ ...window.__perf, long: window.__long.slice() }));
const heap2 = await heap();
// minimized
await page.locator('saveforge-trainer .hbtn[aria-label="Minimize"]').click();
await page.evaluate(() => (window.resetPerf(), (window.__long.length = 0)));
await page.waitForTimeout(steadyMs);
const mini = await page.evaluate(() => ({ ...window.__perf, long: window.__long.slice() }));
const heap3 = await heap();
const sum = (a) => a.reduce((x, y) => x + y, 0);
console.log(JSON.stringify({ query, cpuThrottle: rate, firstRowMs: firstRow, entries: open.entries, heapMB: { before: heap0, afterOpen: heap1, afterSteady: heap2, minimized: heap3 } }));
console.log(`OPEN   frames ${open.frames} maxGap ${Math.round(open.maxGap)}ms gaps>100ms ${open.gaps100} longTasks ${open.long.length} (total ${sum(open.long)}ms, max ${Math.max(0, ...open.long)}ms) GC ${Math.round(gc)}ms`);
console.log(`STEADY frames ${steady.frames} maxGap ${Math.round(steady.maxGap)}ms gaps>100ms ${steady.gaps100} longTasks ${steady.long.length} (total ${sum(steady.long)}ms, max ${Math.max(0, ...steady.long)}ms)`);
console.log(`MINI   frames ${mini.frames} maxGap ${Math.round(mini.maxGap)}ms gaps>100ms ${mini.gaps100} longTasks ${mini.long.length} (total ${sum(mini.long)}ms, max ${Math.max(0, ...mini.long)}ms)`);
if (open.perf) console.log('STAGES', JSON.stringify(open.perf.stages || open.perf));
console.log('TOP self time while opening (ms):');
for (const [k, v] of top) console.log(`  ${v.toFixed(0).padStart(6)}  ${k}`);
{
  const byId2 = new Map(steadyProfile.nodes.map((n) => [n.id, n]));
  const self2 = new Map();
  steadyProfile.samples.forEach((id, i) => {
    const f = byId2.get(id).callFrame;
    if (!f.functionName && !f.url) return;
    const key = `${f.functionName || '(anon)'}:${f.lineNumber}`;
    self2.set(key, (self2.get(key) || 0) + (steadyProfile.timeDeltas[i] || 0) / 1000);
  });
  console.log('TOP self time while open (steady, ms):');
  for (const [k, v] of [...self2].filter(([k]) => !/^\((idle|program)\)/.test(k) && !/^loop:/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${v.toFixed(0).padStart(6)}  ${k.slice(0, 90)}`);
}
if (errors.length) console.log('PAGE ERRORS', errors);
await browser.close();
server.close();
