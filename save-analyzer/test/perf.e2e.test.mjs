// Stress and stability tests (SaveForge 2.2): big games under phone-like conditions.
// Each test runs Chromium with 4× CPU throttling and a touch/mobile context (Low Memory
// Mode), and measures the GAME's responsiveness (its own requestAnimationFrame gaps)
// while SaveForge works. Passing these does not prove a crash on a real iPhone is fixed;
// they guard against the bottlenecks that were measured (see TRAINER.md, Performance).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, normalize } from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let playwright = null;
try {
  playwright = require('playwright');
} catch {
  playwright = null;
}
const skip = !playwright && 'playwright not installed';
const ROOT = new URL('..', import.meta.url).pathname;
let server;
let base;
let browser;
let trainerJs;
let bridgeJs;

before(async () => {
  if (skip) return;
  trainerJs = (await build({ entryPoints: [join(ROOT, 'src/trainer/bookmarklet-entry.js')], bundle: true, format: 'iife', write: false, target: ['es2020'], minify: true })).outputFiles[0].text;
  bridgeJs = (await build({ stdin: { contents: "import { storageBridge } from './src/bridge/storage-bridge.js'; window.__sb = storageBridge;", resolveDir: ROOT }, bundle: true, format: 'iife', write: false })).outputFiles[0].text;
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT)) return res.writeHead(403).end();
    try {
      const file = path.endsWith('/') ? join(path, 'index.html') : path;
      res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : 'text/javascript' }).end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

/** Phone-like page: touch + small screen (Low Memory Mode) and 4× slower CPU. */
async function phone(query) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => {
    window.__long = [];
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] });
    } catch {
      /* no longtask support */
    }
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${base}/test/fixtures/stress/?${query}`);
  await page.waitForFunction(() => window.__idbReady && window.__perf.frames > 30, null, { timeout: 120000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const heapMB = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return Math.round((metrics.find((m) => m.name === 'JSHeapUsedSize')?.value || 0) / 1048576);
  };
  const reset = () => page.evaluate(() => (window.resetPerf(), (window.__long.length = 0)));
  const game = () => page.evaluate(() => ({ ...window.__perf, long: window.__long.slice() }));
  const inject = async () => {
    await page.addScriptTag({ content: trainerJs });
    await page.locator('saveforge-trainer .row').first().waitFor({ timeout: 120000 });
  };
  return { ctx, page, cdp, errors, heapMB, reset, game, inject };
}

test('stress: 20,000 variables, a dialogue table and a busy game loop — the game keeps running while SaveForge opens, sits open and is minimized', { skip, timeout: 240000 }, async () => {
  const s = await phone('vars=20000&lines=5000&churn=300');
  await s.reset();
  await s.inject();
  await s.page.waitForTimeout(3000);
  const open = await s.game();
  assert.ok(open.frames > 100, `the game kept rendering while SaveForge opened (${open.frames} frames)`);
  assert.ok(open.maxGap < 1000, `longest game freeze while opening: ${Math.round(open.maxGap)} ms (was 1.5–2.2 s before 2.2)`);
  // Low Memory Mode on a phone-like device, and its profile is reported
  assert.match(await s.page.evaluate(() => window.__saveforgeTrainer.provider().engine.profile.name), /Smart Scan/);
  // visible and idle: background work is rate-limited and sliced
  await s.reset();
  await s.page.waitForTimeout(8000);
  const steady = await s.game();
  assert.ok(steady.maxGap < 700, `longest freeze while open: ${Math.round(steady.maxGap)} ms (was 0.8–1.1 s)`);
  // minimized: no background scanning at all
  await s.page.locator('saveforge-trainer .hbtn[aria-label="Minimize"]').click();
  await s.reset();
  await s.page.waitForTimeout(8000);
  const mini = await s.game();
  assert.ok(mini.long.every((d) => d < 100), `long tasks while minimized: ${mini.long.join(', ')}`);
  assert.ok(mini.maxGap < 150, `freeze while minimized: ${Math.round(mini.maxGap)} ms`);
  assert.deepEqual(s.errors, []);
  await s.ctx.close();
});

test('stress: 100,000 variables 10 levels deep — Smart Scan reads gameplay first, says what it did not read, Deep scan can be stopped', { skip, timeout: 300000 }, async () => {
  const s = await phone('vars=100000&depth=10&lines=20000&churn=400');
  await s.reset();
  await s.inject();
  const open = await s.game();
  assert.ok(open.maxGap < 1200, `longest freeze while opening: ${Math.round(open.maxGap)} ms`);
  const info = await s.page.evaluate(() => {
    const p = window.__saveforgeTrainer.provider();
    return { entries: p.entries.length, money: p.entries.some((e) => /player › money$/.test(e.path)), truncated: p.truncated };
  });
  assert.ok(info.money, 'the player’s money is read first');
  assert.ok(info.truncated, 'limits reached on this size');
  // what was not read is shown, never silently dropped
  const row = s.page.locator('saveforge-trainer .row .lbl', { hasText: 'more available' }).first();
  await row.waitFor();
  // Deep scan, then Stop: keeps what it found so far and stays usable
  await row.click();
  await s.page.locator('saveforge-trainer .btn', { hasText: 'Stop scanning' }).waitFor();
  await s.page.waitForTimeout(1500);
  await s.page.locator('saveforge-trainer .btn', { hasText: 'Stop scanning' }).click();
  await s.page.locator('saveforge-trainer .toast', { hasText: /Deep scan (stopped|done)/ }).waitFor({ timeout: 60000 });
  const after = await s.page.evaluate(() => window.__saveforgeTrainer.provider().entries.length);
  assert.ok(after > 0);
  const game = await s.game();
  assert.ok(game.frames > 50, 'the game kept running during the deep scan');
  assert.deepEqual(s.errors, []);
  await s.ctx.close();
});

test('stress: 60 MB of game files in IndexedDB are not read until asked, big binaries are never decoded or written back', { skip, timeout: 300000 }, async () => {
  const s = await phone('vars=3000&lines=0&idbmb=60');
  const heap0 = await s.heapMB();
  await s.reset();
  await s.inject();
  await s.page.waitForTimeout(3000);
  const open = await s.game();
  const heap1 = await s.heapMB();
  assert.ok(open.maxGap < 1500, `longest freeze while opening: ${Math.round(open.maxGap)} ms (was 44 s before 2.2)`);
  assert.ok(heap1 - heap0 < 80, `memory used by opening SaveForge: ${heap1 - heap0} MB (was ≈ 335 MB)`);
  // the trainer says what it did not read
  await s.page.locator('saveforge-trainer .row .lbl', { hasText: 'Diagnostics' }).first().click();
  await s.page.locator('saveforge-trainer .perfdiag').waitFor();
  assert.match(await s.page.locator('saveforge-trainer .perfdiag').innerText(), /IndexedDB not read \(to save memory\): \/idbfs/);
  // opening "Saves in storage" reads IndexedDB, but 1 MB files stay unread in Low Memory Mode
  await s.page.locator('saveforge-trainer .chip', { hasText: 'Saves in storage' }).click();
  await s.page.locator('saveforge-trainer .row').first().waitFor({ timeout: 120000 });
  const skipped = await s.page.evaluate(() => window.__saveforgeTrainer.provider().dump.skippedValues || 0);
  assert.equal(skipped, 60, 'each 1 MB file left unread');
  assert.ok((await s.heapMB()) - heap0 < 120, 'still small after reading storage');
  // a dump with unread values never overwrites them
  await s.page.addScriptTag({ content: bridgeJs });
  const kept = await s.page.evaluate(async () => {
    const dump = await window.__sb(window, 'collect', { maxBinary: 1000 });
    const summary = await window.__sb(window, 'apply', dump);
    const db = await new Promise((r) => (indexedDB.open('/idbfs').onsuccess = (e) => r(e.target.result)));
    const rec = await new Promise((r) => (db.transaction('FILE_DATA').objectStore('FILE_DATA').get('/idbfs/data/file0').onsuccess = (e) => r(e.target.result)));
    return { size: rec.contents.byteLength, skipped: summary.skipped.length };
  });
  assert.equal(kept.size, 1024 * 1024, 'the real file is untouched');
  assert.equal(kept.skipped, 60);
  assert.deepEqual(s.errors, []);
  await s.ctx.close();
});

test('stability: reopening reuses the last scan; an interrupted start offers Safe Mode on the next launch', { skip, timeout: 240000 }, async () => {
  const s = await phone('vars=20000&lines=2000');
  await s.inject();
  await s.page.locator('saveforge-trainer .hbtn[aria-label="Close trainer"]').click();
  // reopen: no new scan stage, results shown immediately
  const t0 = Date.now();
  await s.inject();
  const reopenMs = Date.now() - t0;
  const stages = await s.page.evaluate(() => window.__saveforgeTrainer.perf().stages.map((x) => x.name));
  assert.ok(!stages.some((x) => /^scan:/.test(x)), `no scan on reopen: ${stages.join(', ')}`);
  assert.ok(reopenMs < 3000, `reopened in ${reopenMs} ms`);
  await s.page.locator('saveforge-trainer .row .lbl', { hasText: /Results from .* · Rescan/ }).waitFor();
  // a start that never finished (simulated: the tab reloaded while scanning)
  await s.page.evaluate(() => sessionStorage.setItem('__saveforge_startup', JSON.stringify({ open: true, stage: 'scan: Game state (generic)', started: Date.now() - 9000, at: Date.now() - 5000 })));
  await s.page.reload();
  await s.page.waitForFunction(() => window.__perf && window.__perf.frames > 10);
  await s.reset();
  await s.inject().catch(() => {});
  await s.page.locator('saveforge-trainer .sheet h2', { hasText: 'SaveForge did not finish starting last time' }).waitFor();
  assert.match(await s.page.locator('saveforge-trainer .sheet').innerText(), /stopped during “scan: Game state \(generic\)”/);
  await s.page.locator('saveforge-trainer .btn.go', { hasText: 'Open in Safe Mode' }).click();
  await s.page.waitForTimeout(3000);
  const g = await s.game();
  assert.ok(g.long.every((d) => d < 300), `Safe Mode does no heavy work: ${g.long.join(', ')}`);
  assert.equal(await s.page.evaluate(() => window.__saveforgeTrainer.provider()), null, 'nothing scanned until asked');
  assert.equal(await s.page.evaluate(() => sessionStorage.getItem('__saveforge_startup')), null, 'the marker is cleared once started');
  assert.deepEqual(s.errors, []);
  await s.ctx.close();
});

test('stability: the Button Linker never stacks duplicate page listeners', { skip, timeout: 120000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  // count SaveForge's own window listeners from outside
  await page.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    const rem = EventTarget.prototype.removeEventListener;
    window.__sfL = new Map();
    EventTarget.prototype.addEventListener = function (t, fn, o) {
      if (this === window && fn && fn.__saveforge) window.__sfL.set(fn, (window.__sfL.get(fn) || new Set()).add(`${t}|${!!(o === true || (o && o.capture))}`));
      return add.call(this, t, fn, o);
    };
    EventTarget.prototype.removeEventListener = function (t, fn, o) {
      const s = window.__sfL.get(fn);
      if (s) s.delete(`${t}|${!!(o === true || (o && o.capture))}`);
      return rem.call(this, t, fn, o);
    };
    window.__sfCount = () => [...window.__sfL.values()].reduce((a, s) => a + s.size, 0);
  });
  await page.goto(`${base}/test/fixtures/linker-game/`);
  await page.addScriptTag({ content: trainerJs });
  await page.locator('saveforge-trainer .row').first().waitFor();
  const t = {
    async linker() {
      const b = page.locator('saveforge-trainer .tool[aria-label="Back"]');
      while (await b.isEnabled()) await b.click();
      const row = page.locator('saveforge-trainer .row .lbl', { hasText: 'Button & Textbox Linker' }).first();
      if (!(await row.count())) await page.locator('saveforge-trainer .list').first().evaluate((el) => (el.scrollTop = el.scrollHeight));
      await row.click();
    },
  };
  for (let round = 0; round < 4; round++) {
    await t.linker();
    await page.locator('saveforge-trainer .btn', { hasText: 'Inspect element' }).click();
    await page.locator('#vendre').tap();
    await page.locator('saveforge-trainer .btn', { hasText: 'Link to another action' }).click();
    await page.locator('saveforge-trainer .lk-cand', { hasText: 'Do nothing' }).click();
    await page.locator('saveforge-trainer .btn.go', { hasText: 'Apply mapping' }).click();
    await page.locator('saveforge-trainer .lk-map').first().waitFor();
    const n = await page.evaluate(() => window.__sfCount());
    assert.ok(n <= 10, `round ${round}: ${n} SaveForge window listeners`);
    await page.locator('saveforge-trainer .btn', { hasText: 'Restore all originals' }).click();
    assert.equal(await page.evaluate(() => window.__sfCount()), 0, 'all removed when no mapping is active');
  }
  await ctx.close();
});
