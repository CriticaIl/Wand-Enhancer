// SaveForge 2.3.1: activating the trainer on a Ren'Py web game.
//
// The reported bug: Ren'Py web games ran normally in iPhone Safari, but activating SaveForge
// made Safari reload the page. Cause: the generic detector called Object.keys on page globals
// that are typed-array views of the whole WebAssembly memory (HEAP8…HEAPF64, 192 MB at start), one
// string per byte (measured on 2.3.0 with tools/measure-activation.mjs: the renderer grew to
// ~2.6 GB and crashed). The fixture test/fixtures/renpy-web reproduces a real Ren'Py web build's
// JavaScript surface. These tests instrument Object.keys & co. so any enumeration of large
// binary data is caught directly, and record every IndexedDB access SaveForge makes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;
const USERSCRIPT = readFileSync(join(ROOT, 'standalone/saveforge-trainer.user.js'), 'utf8');
let playwright = null;
try {
  playwright = require('playwright');
} catch {
  playwright = null;
}
const skip = !playwright && 'playwright not installed';
let server;
let browser;
let base;

before(async () => {
  if (skip) return;
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    try {
      const f = p.endsWith('/') ? join(p, 'index.html') : p;
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(f));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  // a phone-like heap ceiling: an enumeration of WebAssembly memory dies here as on an iPhone
  browser = await playwright.chromium.launch({ args: ['--js-flags=--max-old-space-size=1536'] });
});
after(async () => {
  await browser?.close();
  server?.close();
});

/** Records enumerations of big binary data and SaveForge's IndexedDB use (installed before SaveForge). */
function instrument() {
  const big = (v) => {
    try {
      return ArrayBuffer.isView(v) && v.length > 100000;
    } catch {
      return false;
    }
  };
  window.__enum = [];
  for (const name of ['keys', 'getOwnPropertyNames', 'entries', 'values']) {
    const orig = Object[name];
    Object[name] = function (v) {
      if (big(v)) {
        window.__enum.push(`${name}(${Object.prototype.toString.call(v).slice(8, -1)} of ${v.length})`);
        return []; // what 2.3.0 did here crashed the tab; record it and keep the test alive
      }
      return orig.call(Object, v);
    };
  }
  window.__idb = [];
  window.__watchIdb = false;
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (name, ...a) {
    if (window.__watchIdb && name !== 'saveforge-trainer') window.__idb.push(`open ${name}`);
    return open.call(this, name, ...a);
  };
  const dbs = IDBFactory.prototype.databases;
  if (dbs)
    IDBFactory.prototype.databases = function () {
      if (window.__watchIdb) window.__idb.push('databases()');
      return dbs.call(this);
    };
  const si = window.setInterval;
  const ci = window.clearInterval;
  window.__iv = new Set();
  window.setInterval = function (f, ms, ...a) {
    const id = si.call(window, f, ms, ...a);
    window.__iv.add(id);
    return id;
  };
  window.clearInterval = function (id) {
    window.__iv.delete(id);
    return ci.call(window, id);
  };
}

async function openRenpy(query = '') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(instrument);
  await ctx.addInitScript({ content: USERSCRIPT });
  const page = await ctx.newPage();
  const errors = [];
  let crashed = false;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('crash', () => (crashed = true));
  page.on('dialog', (d) => d.accept());
  await page.goto(`${base}/test/fixtures/renpy-web/?${query}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  await page.waitForTimeout(800);
  const idle = await page.evaluate(() => window.__iv.size);
  await page.evaluate(() => {
    window.__watchIdb = true;
    location.hash = '#saveforge';
  });
  return { ctx, page, errors, idle, crashed: () => crashed };
}
const T = (page) => page.locator('saveforge-trainer');
const gold = (page) =>
  page.evaluate(() => {
    const p = window.__saveforgeTrainer?.provider?.();
    const e = p?.entries?.find((x) => /›\s*money$/.test(x.path));
    return e ? p.value(e.nodeId) : null;
  });

test('activation on a Ren’Py web game: no crash, WebAssembly memory never enumerated, a working panel within a second', { skip, timeout: 60000 }, async () => {
  const t0 = Date.now();
  const { ctx, page, errors, crashed } = await openRenpy('mem=192');
  await T(page).locator('.row').first().waitFor({ timeout: 10000 });
  const firstScreenMs = Date.now() - t0;
  await page.waitForTimeout(6000); // background refresh, learning, save sync…
  assert.equal(crashed(), false);
  assert.deepEqual(await page.evaluate(() => window.__enum), [], 'no typed array of WebAssembly memory / files was enumerated');
  assert.ok(firstScreenMs < 5000, `first screen after ${firstScreenMs} ms`);
  const st = await page.evaluate(() => window.__saveforgeTrainer.state());
  assert.equal(st.sourceId, 'renpy', 'opens on Ren’Py’s live variables');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('light mode: activation reads no storage (IndexedDB is read only when you open Saves in storage)', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await openRenpy();
  await T(page).locator('.row').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(4000);
  assert.deepEqual(await page.evaluate(() => window.__idb), [], 'no IndexedDB access by SaveForge after activation');
  // on request: the saves are inspected as before
  await T(page).locator('.chip', { hasText: 'Saves in storage' }).click();
  await T(page).locator('.row').first().waitFor({ timeout: 10000 });
  assert.ok((await page.evaluate(() => window.__idb)).length > 0, 'read when asked');
  assert.ok(await page.evaluate(() => window.__saveforgeTrainer.provider().entries.some((e) => /money/.test(e.path))), 'Ren’Py save variables listed');
  assert.deepEqual(await page.evaluate(() => window.__enum), []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Ren’Py live variables: the game’s store variables are listed, Ren’Py’s own are not, big ints are read-only', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await openRenpy();
  await page.waitForFunction(() => window.__saveforgeTrainer?.provider?.()?.entries?.length > 0, null, { timeout: 10000 });
  const paths = await page.evaluate(() => window.__saveforgeTrainer.provider().entries.map((e) => e.path.replace(/^Ren'Py store › /, '')));
  for (const p of ['money', 'day', 'met_lucy', 'player_name', 'affection › eileen', 'inventory › 0', 'player › hp']) assert.ok(paths.includes(p), `${p} listed: ${paths.join(', ')}`);
  assert.ok(!paths.some((p) => /mouse_visible|suppress_overlay|^_/.test(p)), 'Ren’Py’s own store variables are not listed by default');
  assert.equal(await gold(page), 120);
  const huge = await page.evaluate(() => {
    const p = window.__saveforgeTrainer.provider();
    const e = p.entries.find((x) => /huge_number/.test(x.path));
    let refused = '';
    try {
      p.set([{ id: e.nodeId, value: 1 }]);
    } catch (err) {
      refused = err.message;
    }
    return { state: p.statusOf(e.nodeId)?.state, why: p.statusOf(e.nodeId)?.detail, refused, shown: p.value(e.nodeId) };
  });
  assert.equal(huge.state, 'readonly');
  assert.match(huge.why, /too large for JavaScript/);
  assert.match(huge.refused, /too large for JavaScript/, 'a write is refused');
  assert.equal(huge.shown, '12345678901234567000', 'shown exactly as Ren’Py sent it (as text)');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('editing a Ren’Py variable: changed through Ren’Py, verified by reading it back, no store variable added', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await openRenpy();
  await T(page).locator('.row').first().waitFor({ timeout: 10000 });
  await T(page).locator('.tool[aria-label="Search"]').click();
  await T(page).locator('.search input').fill('money');
  await T(page).locator('.row').filter({ has: page.locator('.name', { hasText: /money/i }) }).first().locator('.num').click();
  await T(page).locator('.sheet .field').fill('500');
  await T(page).locator('.sheet .btn.go', { hasText: 'Apply' }).click();
  await page.waitForFunction(() => window.__fixture.store.money === 500, null, { timeout: 5000 });
  await page.waitForFunction(
    () => {
      const p = window.__saveforgeTrainer.provider();
      const e = p.entries.find((x) => /›\s*money$/.test(x.path));
      return p.statusOf(e.nodeId)?.state === 'verified';
    },
    null,
    { timeout: 8000 },
  );
  const st = await page.evaluate(() => {
    const p = window.__saveforgeTrainer.provider();
    const e = p.entries.find((x) => /›\s*money$/.test(x.path));
    return p.statusOf(e.nodeId).detail;
  });
  assert.match(st, /verified: Ren'Py \(live\) still has 500/);
  assert.equal(await page.locator('#hud').innerText(), 'money 500 · day 2', 'the game shows it (screens restarted)');
  assert.ok(await page.evaluate(() => window.__fixture.restarts) >= 1);
  assert.equal(await page.evaluate(() => 'result' in window.__fixture.store), false, 'renpy_exec’s “result” variable was never created in the store');
  // a value changed by the game is picked up by the background refresh
  await page.evaluate(() => (window.__fixture.store.day = 9));
  await page.waitForFunction(() => {
    const p = window.__saveforgeTrainer.provider();
    const e = p.entries.find((x) => /›\s*day$/.test(x.path));
    return p.value(e.nodeId) === 9;
  }, null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => window.__saveforgeTrainer.provider().canLock(window.__saveforgeTrainer.provider().entries[0].nodeId)), false, 'no locks on Ren’Py (values change only through Ren’Py)');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Ren’Py does not answer (loading screen, blocked): the panel stays usable, says why, and leaves no command behind', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors, crashed } = await openRenpy('interaction=0');
  await page.locator('saveforge-trainer').waitFor({ state: 'attached', timeout: 5000 });
  await T(page).locator('.badbox', { hasText: /did not answer/ }).waitFor({ timeout: 15000 });
  assert.equal(await page.evaluate(() => typeof window._renpy_cmd), 'undefined', 'the unanswered command was taken back (it never runs later)');
  assert.equal(crashed(), false);
  assert.deepEqual(await page.evaluate(() => window.__enum), []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('an older Ren’Py web build without renpy_exec: an explanation, and the saves on request', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await openRenpy('noexec=1');
  const first = T(page).locator('.row .name', { hasText: "Ren'Py's variables are not reachable here" });
  await first.waitFor({ timeout: 10000 });
  assert.deepEqual(await page.evaluate(() => window.__idb), [], 'nothing read yet');
  await T(page).locator('.row .name', { hasText: 'Inspect the saves' }).click();
  await page.waitForFunction(() => window.__saveforgeTrainer.state().sourceId === 'storage');
  await T(page).locator('.row').first().waitFor({ timeout: 10000 });
  assert.ok(await page.evaluate(() => window.__saveforgeTrainer.provider().entries.length > 0));
  assert.deepEqual(await page.evaluate(() => window.__enum), []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('closing on Ren’Py leaves nothing running, and the raw page view (on request) is safe too', { skip, timeout: 90000 }, async () => {
  const { ctx, page, errors, idle, crashed } = await openRenpy('mem=192&big=2000');
  await T(page).locator('.row').first().waitFor({ timeout: 10000 });
  // the page-global scan, the raw view and Find a value, all on request: still never the WebAssembly memory
  await page.evaluate(async () => {
    await window.__saveforgeTrainer.selectSource('raw');
  });
  await T(page).locator('.row').first().waitFor({ timeout: 20000 });
  assert.equal(crashed(), false);
  assert.deepEqual(await page.evaluate(() => window.__enum), [], 'raw scan: no binary enumeration');
  await T(page).locator('.hbtn[aria-label="Close trainer"]').click();
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.__iv.size), idle, 'no SaveForge timer left');
  assert.equal(await page.evaluate(() => Object.keys(window).filter((k) => /^__saveforgeRenpy_/.test(k)).length), 0, 'the reply callback was removed');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Diagnostics explains the Ren’Py connection', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await openRenpy();
  await T(page).locator('.row').first().waitFor({ timeout: 10000 });
  const d = await page.evaluate(async () => (await window.__saveforgeTrainer.diagnosticsData()).renpy);
  assert.equal(d.connected, true);
  assert.equal(d.exec, true);
  assert.equal(d.version, '8.3.7.25031702');
  assert.ok(d.bridge.answered >= 1);
  const ex = await page.evaluate(async () => (await window.__saveforgeTrainer.diagnosticsData()).globals.length);
  assert.equal(ex, 0, 'no page-global classification ran (light mode)');
  await page.evaluate(() => window.__saveforgeTrainer.openDiagnostics());
  await T(page).locator('.sheet h3', { hasText: "Ren'Py web" }).waitFor({ timeout: 8000 });
  assert.match(await T(page).locator('.sheet').innerText(), /Connected through Ren'Py's JavaScript interface/);
  assert.deepEqual(errors, []);
  await ctx.close();
});
