// Real-browser tests of the trainer overlay on the original demo games.
// The trainer is bundled from source for each run (never a stale build).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { build } from 'esbuild';
import { analyzeFile } from '../src/core/document.js';

const require = createRequire(import.meta.url);
let playwright = null;
try {
  playwright = require('playwright');
} catch {
  playwright = null;
}
const skip = !playwright && 'playwright not installed';
const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let server;
let base;
let browser;
let trainerJs;
const extraPages = new Map();

before(async () => {
  if (skip) return;
  const out = await build({ entryPoints: [join(ROOT, 'src/trainer/bookmarklet-entry.js')], bundle: true, format: 'iife', write: false, target: ['es2020'] });
  trainerJs = out.outputFiles[0].text;
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (extraPages.has(url.pathname)) return res.writeHead(200, { 'content-type': 'text/html' }).end(extraPages.get(url.pathname));
    const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT)) return res.writeHead(403).end();
    try {
      const file = path.endsWith('/') ? join(path, 'index.html') : path;
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
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

async function openGame(path, { viewport = { width: 390, height: 844 } } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(`${base}${path}`);
  return { page, ctx, errors };
}

async function inject(page) {
  await page.addScriptTag({ content: trainerJs });
  await page.locator('saveforge-trainer .row').first().waitFor();
}

const T = (page) => ({
  chip: (label) => page.locator('saveforge-trainer .chip', { hasText: label }).click(),
  rowByName: (label) => page.locator('saveforge-trainer .row').filter({ has: page.locator('.name', { hasText: label }) }).first(),
  nav: (label) => page.locator('saveforge-trainer .row .lbl', { hasText: label }).first().click(),
  tool: (label) => page.locator(`saveforge-trainer .tool[aria-label="${label}"]`).click(),
  async search(q) {
    await page.locator('saveforge-trainer .tool[aria-label="Search"]').click();
    await page.locator('saveforge-trainer .search input').fill(q);
    await page.waitForTimeout(250);
  },
  async setNumber(label, value) {
    await this.rowByName(label).locator('.num').click();
    await page.locator('saveforge-trainer .sheet .field').fill(String(value));
    await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  },
  async info(label) {
    await this.rowByName(label).locator('.info').click();
    return page.locator('saveforge-trainer .sheet').innerText();
  },
  sheetText: () => page.locator('saveforge-trainer .sheet').innerText(),
  async home() {
    const b = page.locator('saveforge-trainer .tool[aria-label="Back"]');
    while (await b.isEnabled()) await b.click();
  },
});

test('generic live editing: Neon Courier reacts immediately; undo and restore work', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/neon-courier/');
  await inject(page);
  const t = T(page);
  assert.equal(await page.locator('saveforge-trainer .chip[aria-pressed=true]').innerText(), 'Game state (generic)');
  await t.search('credits');
  await t.setNumber('Credits', 9999);
  await page.locator('#credits', { hasText: '9999' }).waitFor({ timeout: 3000 });

  await t.search('boost');
  await t.rowByName('Boost Drive').locator('.toggle').click();
  await page.locator('#boost', { hasText: 'ON' }).waitFor({ timeout: 3000 });
  await t.tool('Undo');
  await page.locator('#boost', { hasText: 'off' }).waitFor({ timeout: 3000 });

  await t.search('health');
  const info = await t.info('Vex · Health');
  assert.match(info, /What it controls/i);
  assert.match(info, /current health|HP|health/i);
  assert.match(info, /maxHealth/, 'explanation mentions the related maximum');
  assert.match(info, /Live \(unverified\)/i);
  assert.match(info, /How sure is SaveForge\? (Medium|High|Low)/i);

  // restore original values from the backup screen
  await t.home();
  await t.nav('Backups & restore');
  await page.locator('saveforge-trainer .btn.warn', { hasText: 'Restore' }).click();
  await page.locator('#credits', { hasText: '250' }).waitFor({ timeout: 3000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('SugarCube-style story: variables change live, Refresh passage re-renders the text', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/lantern-tale/');
  await inject(page);
  const t = T(page);
  assert.equal(await page.locator('saveforge-trainer .chip[aria-pressed=true]').innerText(), 'SugarCube (Twine)');
  await t.search('gold');
  await t.setNumber('$gold', 500);
  assert.equal(await page.evaluate(() => window.SugarCube.State.variables.gold), 500, 'story state changed immediately');
  assert.equal(await page.locator('#gold').innerText(), '85', 'text already on screen is unchanged until re-render');
  await t.search('trust');
  await t.setNumber('$wrenTrust', 12);
  await t.home();
  await t.nav('Refresh passage');
  await page.locator('#gold', { hasText: '500' }).waitFor({ timeout: 3000 });
  await page.locator('#secret').waitFor({ timeout: 3000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('RPG Maker-style game: gold, named items, switches and actor HP change live', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/crystal-quest/');
  await inject(page);
  const t = T(page);
  assert.match(await page.locator('saveforge-trainer .chip[aria-pressed=true]').innerText(), /RPG Maker/);
  await t.nav('Money');
  await t.setNumber('Gold', 50000);
  await page.locator('#gold', { hasText: '50000' }).waitFor({ timeout: 3000 });

  await t.search('potion');
  assert.ok(await t.rowByName('Item #1 · Potion').isVisible(), 'item named from $dataItems');
  await t.setNumber('Item #1 · Potion', 42);
  await page.locator('#potions', { hasText: '42' }).waitFor({ timeout: 3000 });

  await t.search('bridge');
  await t.rowByName('Switch #3 · Bridge open').locator('.toggle').click();
  await page.locator('#bridge', { hasText: 'YES' }).waitFor({ timeout: 3000 });
  assert.ok((await page.evaluate(() => window.$gameMap.refreshes)) > 0, 'map refresh requested after switch change');
  const info = await t.info('Switch #3 · Bridge open');
  assert.match(info, /This controls RPG Maker game switch #3 \(“Bridge open”\)/);
  assert.match(info, /High confidence/i);

  // HP above the maximum is clamped by the engine's own refresh()
  await page.locator('saveforge-trainer .btn', { hasText: 'Back' }).click();
  await t.search('Reid · HP');
  await t.setNumber('Reid · HP', 999);
  await page.locator('#hp', { hasText: '120 / 120' }).waitFor({ timeout: 3000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Construct 2-style globals: edits reach the game loop', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/tap-miner/');
  await inject(page);
  const t = T(page);
  assert.equal(await page.locator('saveforge-trainer .chip[aria-pressed=true]').innerText(), 'Construct 2');
  await t.search('pick');
  await t.setNumber('Pick Level', 50);
  await t.search('drill');
  await t.setNumber('Auto Drill', 1);
  await page.locator('#pick', { hasText: '50' }).waitFor({ timeout: 3000 });
  await page.waitForFunction(() => Number(document.getElementById('ore').textContent) >= 100, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.cr_getC2Runtime().all_global_vars.find((g) => g.name === 'PickLevel').data), 50);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('storage source: pending edits, Apply & Reload, backup snapshot', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/test/fixtures/demo-game/');
  await page.waitForFunction(() => document.title === 'saved');
  await inject(page);
  const t = T(page);
  await t.chip('Saves in storage');
  await page.locator('saveforge-trainer .badge.reload').first().waitFor();
  await t.search('coins');
  await t.setNumber('Coins', 4242);
  assert.equal(await page.locator('#coins').innerText(), '10', 'nothing written before Apply & Reload');
  await page.locator('saveforge-trainer .tool.primary', { hasText: 'Apply & Reload' }).click();
  assert.match(await t.sheetText(), /in-game progress|since its last save/i);
  await Promise.all([page.waitForEvent('load'), page.locator('saveforge-trainer .btn.warn', { hasText: 'Apply & Reload' }).click()]);
  await page.locator('#coins', { hasText: '4242' }).waitFor({ timeout: 5000 });

  await inject(page);
  await t.chip('Saves in storage');
  await t.nav('Backups & restore');
  await page.locator('saveforge-trainer .sheet .okbox', { hasText: 'change(s) were applied after it' }).first().waitFor();
  await Promise.all([page.waitForEvent('load'), page.locator('saveforge-trainer .btn.warn', { hasText: 'Restore & reload' }).first().click()]);
  await page.locator('#coins', { hasText: '10' }).waitFor({ timeout: 5000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('storage source refuses to overwrite progress saved after it was read', { skip, timeout: 60000 }, async () => {
  const { page, ctx } = await openGame('/test/fixtures/demo-game/');
  await page.waitForFunction(() => document.title === 'saved');
  await inject(page);
  const t = T(page);
  await t.chip('Saves in storage');
  await page.locator('saveforge-trainer .badge.reload').first().waitFor();
  await t.search('coins');
  await t.setNumber('Coins', 999);
  // the game saves new progress meanwhile
  await page.locator('#earn').dispatchEvent('click');
  await page.evaluate(() => (document.title = ''));
  await page.locator('#save').dispatchEvent('click');
  await page.waitForFunction(() => document.title === 'saved');
  await page.locator('saveforge-trainer .tool.primary').click();
  await page.locator('saveforge-trainer .btn.warn', { hasText: 'Apply & Reload' }).click();
  await page.locator('saveforge-trainer .badbox', { hasText: 'Nothing was written' }).waitFor();
  const st = await page.evaluate(() => JSON.parse(atob(localStorage.getItem('pebblefarm_save'))));
  assert.equal(st.coins, 11, 'newer in-game save kept');
  await ctx.close();
});

test("Ren'Py web save in IndexedDB: edit through storage, verify bytes after reload", { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/ruins-web/');
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  await inject(page);
  const t = T(page);
  await t.chip('Saves in storage');
  await page.locator('saveforge-trainer .badge.reload').first().waitFor();
  await t.search('money');
  await t.setNumber('money', 31337);
  await page.locator('saveforge-trainer .tool.primary').click();
  await Promise.all([page.waitForEvent('load'), page.locator('saveforge-trainer .btn.warn', { hasText: 'Apply & Reload' }).click()]);
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  const b64 = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open('/home/web_user/.renpy');
        r.onsuccess = () => {
          const g = r.result.transaction('FILE_DATA').objectStore('FILE_DATA').get('/home/web_user/.renpy/ruins-1/1-1-LT1.save');
          g.onsuccess = () => {
            let s = '';
            for (const b of g.result.contents) s += String.fromCharCode(b);
            resolve(btoa(s));
          };
        };
      }),
  );
  const res = await analyzeFile('slot.save', new Uint8Array(Buffer.from(b64, 'base64')));
  assert.ok(res.ok);
  const money = res.doc.menu.all.find((e) => e.label === 'money');
  assert.equal(res.doc.node(money.nodeId).value, 31337);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('performance: 10,000 variables stay virtualized and searchable', { skip, timeout: 60000 }, async () => {
  const vars = [];
  for (let i = 0; i < 10000; i++) vars.push(`"v${i}":{"gold":${i},"hp":${i % 100},"seen":${i % 2 === 0}}`);
  extraPages.set('/big.html', `<!doctype html><title>big</title><body><script>window.world={${vars.slice(0, 3400).join(',')}};</script></body>`);
  const { page, ctx, errors } = await openGame('/big.html');
  const started = Date.now();
  await inject(page);
  const openMs = Date.now() - started;
  const t = T(page);
  await t.nav('All variables');
  const rows = await page.locator('saveforge-trainer .row').count();
  const total = await page.locator('saveforge-trainer .sub .count').innerText();
  assert.match(total, /\/ 10200$/, `count shows all variables (${total})`);
  assert.ok(rows < 40, `only visible rows are in the DOM (${rows})`);
  await page.locator('saveforge-trainer .list').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(200);
  const last = await page.locator('saveforge-trainer .row .sub2').last().innerText();
  assert.match(last, /v3399/);
  const s0 = Date.now();
  await t.search('v3399 ›');
  const searchMs = Date.now() - s0;
  assert.ok((await page.locator('saveforge-trainer .row').count()) >= 3);
  assert.ok(openMs < 5000, `opened in ${openMs} ms`);
  assert.ok(searchMs < 2500, `search in ${searchMs} ms`);
  console.log(`# trainer perf: open ${openMs} ms for 10,200 variables, search ${searchMs} ms, ${rows} DOM rows`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('SaveForge app: floating trainer edits an imported save; Game tab opens the trainer over a same-origin game', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/index.html');
  const t = T(page);
  // imported save → floating trainer (saved edits) → Export verification
  await page.click('text=Try a sample save');
  await page.click('button:has-text("RPG Maker MV")');
  await page.locator('.fab').click();
  await page.locator('saveforge-trainer .chip[aria-pressed=true]').waitFor();
  assert.equal(await page.locator('saveforge-trainer .sub .badge').first().innerText(), 'SAVED EDIT');
  await t.nav('Money');
  await t.setNumber('Gold', 777);
  assert.equal(await page.locator('.tabbar .count').innerText(), '1', 'edit reached the app session');
  await page.locator('saveforge-trainer .tool', { hasText: 'Export' }).click();
  await page.locator('.modal >> text=Verified').waitFor();
  await page.locator('.modal button', { hasText: 'Close' }).click();
  await page.locator('saveforge-trainer .hbtn[aria-label="Close trainer"]').click();

  // Game tab → same-origin game → live trainer injected into the frame
  await page.click('.tabbar button:has-text("Game")');
  await page.fill('input[type=url]', `${base}/demo-games/crystal-quest/`);
  await page.click('button:has-text("Launch")');
  await page.click('button:has-text("Open trainer over game")');
  const frame = page.frameLocator('iframe');
  await frame.locator('saveforge-trainer .row .lbl', { hasText: 'Money' }).first().click();
  await frame.locator('saveforge-trainer .row').filter({ has: frame.locator('.name', { hasText: 'Gold' }) }).first().locator('.num').click();
  await frame.locator('saveforge-trainer .sheet .field').fill('31415');
  await frame.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  await frame.locator('#gold', { hasText: '31415' }).waitFor({ timeout: 3000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Phaser 3-style game: registry, scene properties and scene data are live; game objects are not listed', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/star-runner/');
  await inject(page);
  const t = T(page);
  assert.match(await page.locator('saveforge-trainer .chip[aria-pressed=true]').innerText(), /Phaser 3\.80/);
  const paths = await page.evaluate(() => window.__saveforgeTrainer.provider().entries.map((e) => e.path));
  for (const p of ['registry › stars', 'registry › bestScore', 'scenes › Play › score', 'scenes › Play › lives', 'scenes › Play › data › shield']) assert.ok(paths.some((x) => x.endsWith(p)), `${p} in ${paths.join(', ')}`);
  assert.ok(!paths.some((p) => /player|sys|cameras|events/.test(p)), 'engine internals and game objects are not listed');
  await t.search('stars');
  await t.setNumber('Stars', 99);
  await page.locator('#stars', { hasText: '99' }).waitFor({ timeout: 3000 });
  await t.search('shield');
  await t.rowByName('Shield').locator('.toggle').click();
  await page.locator('#shield', { hasText: 'ON' }).waitFor({ timeout: 3000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});
