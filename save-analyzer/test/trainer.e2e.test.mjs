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
  async nav(label) {
    const row = page.locator('saveforge-trainer .row .lbl', { hasText: label }).first();
    // the list is virtualised: rows below the fold exist only after scrolling to them
    if (!(await row.count())) await page.locator('saveforge-trainer .list').first().evaluate((el) => (el.scrollTop = el.scrollHeight));
    await row.click();
  },
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
    await leaveEdit(page);
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

/** After a live edit the sheet stays open to show verification; tap Done (or Back) to return. */
async function leaveEdit(scope) {
  const done = scope.locator('saveforge-trainer .sheet .btn', { hasText: /^Done$/ });
  if (await done.count()) await done.first().click();
}

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
  await leaveEdit(frame);
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

// ---------------------------------------------------------------- edits must reach the game (verification)
const statusText = (page) => page.locator('saveforge-trainer .sheet .statusbox').first();

test('SugarCube-style: edits reach the current passage even after the game copied its variables (no stale writes)', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/lantern-tale/');
  await inject(page);
  const t = T(page);
  // the story moves on: SugarCube-like engines copy State.variables into a new moment
  await page.evaluate(() => window.SugarCube.Engine.play('Stall'));
  await page.evaluate(() => window.SugarCube.Engine.play('Market'));
  await t.search('gold');
  await t.rowByName('$gold').locator('.num').click();
  await page.locator('saveforge-trainer .sheet .field').fill('640');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  await statusText(page).filter({ hasText: 'Applied and verified' }).waitFor({ timeout: 4000 });
  assert.equal(await page.evaluate(() => window.SugarCube.State.variables.gold), 640, 'the variables the story uses now');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('RPG Maker-style: engine setters are used and clamping is reported as “adjusted”, not as success', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/crystal-quest/');
  await inject(page);
  const t = T(page);
  await t.search('potion');
  await t.rowByName('Item #1 · Potion').locator('.num').click();
  await page.locator('saveforge-trainer .sheet .field').fill('500');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  await statusText(page).filter({ hasText: 'adjusted' }).waitFor({ timeout: 4000 });
  assert.match(await statusText(page).innerText(), /adjusted it to 99/);
  assert.match(await statusText(page).innerText(), /gainItem\(\)/);
  assert.equal(await page.locator('#potions').innerText(), '99');
  await leaveEdit(page);
  await t.search('bridge');
  await t.rowByName('Switch #3 · Bridge open').locator('.toggle').click();
  await page.locator('#bridge', { hasText: 'YES' }).waitFor({ timeout: 3000 });
  const calls = await page.evaluate(() => window.setterCalls);
  assert.ok(calls.gainItem >= 1 && calls.setValue >= 1, JSON.stringify(calls));
  await page.locator('saveforge-trainer .row .st-verified').first().waitFor({ timeout: 4000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Overwritten values are detected (Reverted) and Lock keeps re-applying them; replaced state objects still work', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/sakura-market/');
  await inject(page);
  const t = T(page);
  // hud.bank is a display copy the game overwrites every frame
  await t.search('bank');
  await t.rowByName('Bank').locator('.num').click();
  await page.locator('saveforge-trainer .sheet .field').fill('5000');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  await statusText(page).filter({ hasText: 'Reverted by the game' }).waitFor({ timeout: 4000 });
  assert.match(await statusText(page).innerText(), /changed it back to 1000/);
  await page.locator('saveforge-trainer .sheet .btn', { hasText: 'Lock value' }).click();
  await page.waitForTimeout(600);
  const lock = await page.evaluate(() => {
    const p = window.__saveforgeTrainer.provider();
    const [id, l] = [...p.locks][0];
    return { reapplied: l.reapplied, value: l.value, state: p.statusOf(id).state };
  });
  assert.equal(lock.state, 'locked');
  assert.ok(lock.reapplied > 3, `re-applied ${lock.reapplied} times`);
  await page.locator('saveforge-trainer .sheet .btn', { hasText: 'Unlock' }).click();
  assert.equal(await page.evaluate(() => window.__saveforgeTrainer.provider().locks.size), 0);
  await leaveEdit(page);
  // run is replaced with a new object 5×/s: the edit must land in the live object and stay
  await t.search('distance');
  await t.rowByName('Distance').locator('.num').click();
  await page.locator('saveforge-trainer .sheet .field').fill('90000');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  await statusText(page).filter({ hasText: 'Applied and verified' }).waitFor({ timeout: 4000 });
  assert.ok(Number(await page.locator('#dist').innerText()) >= 90000);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('English: foreign variable names get English labels and ⓘ translations; editing still uses the original key', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/sakura-market/');
  await inject(page);
  const t = T(page);
  await t.nav('Settings');
  await page.locator('saveforge-trainer .setrow', { hasText: 'Show English labels' }).locator('.toggle').click();
  await t.home();
  await t.search('money');
  const row = t.rowByName('Money held');
  await row.waitFor();
  assert.match(await row.locator('.sub2').innerText(), /所持金/, 'original name kept under the English label');
  await row.locator('.num').click();
  await page.locator('saveforge-trainer .sheet .field').fill('8888');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  await page.locator('#money', { hasText: '8888' }).waitFor({ timeout: 3000 });
  assert.equal(await page.evaluate(() => window.データ.所持金), 8888);
  await leaveEdit(page);
  await t.rowByName('Money held').locator('.info').click();
  const info = await page.locator('saveforge-trainer .sheet').innerText();
  assert.match(info, /In English/i);
  assert.match(info, /Translation · Japanese/i);
  assert.match(info, /所持金/);
  assert.match(info, /currency/, 'explanation understands the translated name');
  // Spanish too
  await t.home();
  await t.search('coins');
  assert.ok(await t.rowByName('Coins').isVisible());
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Find a value: scan, change in game, scan again, then edit the real variable', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/neon-courier/');
  await inject(page);
  const t = T(page);
  await t.nav('Find a value');
  await page.locator('saveforge-trainer .sheet .field').fill('250');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'First scan' }).click();
  await page.locator('#deliver').dispatchEvent('click'); // +40 credits in the game
  await page.locator('saveforge-trainer .sheet .field').fill('290');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Next scan' }).click();
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: /^Edit these/ }).click();
  await page.locator('saveforge-trainer .chip[aria-pressed=true]', { hasText: 'Found values' }).waitFor();
  await t.setNumber('Credits', 7777);
  await page.locator('#credits', { hasText: '7777' }).waitFor({ timeout: 3000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Apply & Reload is verified after the reload', { skip, timeout: 60000 }, async () => {
  const { page, ctx } = await openGame('/test/fixtures/demo-game/');
  await page.waitForFunction(() => document.title === 'saved');
  await inject(page);
  const t = T(page);
  await t.chip('Saves in storage');
  await page.locator('saveforge-trainer .badge.reload').first().waitFor();
  await t.search('coins');
  await t.setNumber('Coins', 321);
  await page.locator('saveforge-trainer .row .st-reload').first().waitFor();
  await page.locator('saveforge-trainer .tool.primary').click();
  await Promise.all([page.waitForEvent('load'), page.locator('saveforge-trainer .btn.warn', { hasText: 'Apply & Reload' }).click()]);
  await page.locator('#coins', { hasText: '321' }).waitFor({ timeout: 5000 });
  await inject(page);
  await t.chip('Saves in storage');
  await page.locator('saveforge-trainer .row .name', { hasText: 'After reload: 1/1 edits kept' }).waitFor({ timeout: 5000 });
  await ctx.close();
});

// ---------------------------------------------------------------- 1.5: visible UI refresh, smarter search, mobile
test('DOM game that redraws only on screen change: state vs screen, game redraw function, automatic refresh', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/boutique/');
  await inject(page);
  const t = T(page);
  await t.search('money');
  await t.rowByName('Argent').locator('.num').click();
  await page.locator('saveforge-trainer .sheet .field').fill('99999');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  const box = statusText(page);
  await box.filter({ hasText: 'Visible UI not refreshed yet' }).waitFor({ timeout: 5000 });
  assert.match(await box.innerText(), /Game state: ✓ Applied and verified/);
  assert.equal(await page.evaluate(() => window.jeu.magasin.argent), 99999, 'game state changed');
  assert.match(await page.locator('#argent').innerText(), /1\s822/, 'screen still old: the game redraws later');
  await page.locator('saveforge-trainer .sheet .btn', { hasText: 'Update game display' }).click();
  assert.deepEqual(await page.locator('saveforge-trainer .cand b').allTextContents(), ['afficherMagasin()']);
  await page.locator('saveforge-trainer .cand button').first().click();
  await page.locator('saveforge-trainer .okbox', { hasText: 'redrew the screen' }).waitFor();
  assert.match(await page.locator('#argent').innerText(), /99\s999/);
  await page.locator('saveforge-trainer .btn.go', { hasText: 'Use automatically' }).click();
  await page.locator('saveforge-trainer .tool[aria-label=Back]').click();
  await page.locator('saveforge-trainer .sheet .field').fill('1234');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  await box.filter({ hasText: 'Refreshed automatically' }).waitFor({ timeout: 5000 });
  assert.match(await box.innerText(), /Visible UI refreshed/);
  assert.match(await page.locator('#argent').innerText(), /1\s234/);
  assert.equal(await page.evaluate(() => window.onglet), 'magasin', 'no screen switch or reload was used');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Display-only fallback updates the visible number without touching the game', { skip, timeout: 60000 }, async () => {
  const { page, ctx } = await openGame('/demo-games/boutique/');
  await inject(page);
  const t = T(page);
  await t.search('money');
  await t.rowByName('Argent').locator('.num').click();
  await page.locator('saveforge-trainer .sheet .field').fill('5000');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  await statusText(page).filter({ hasText: 'not refreshed yet' }).waitFor({ timeout: 5000 });
  await page.locator('saveforge-trainer .sheet .btn', { hasText: 'Update game display' }).click();
  await page.locator('saveforge-trainer .sheet .btn', { hasText: 'Show new number on screen' }).click();
  await page.waitForFunction(() => /5\s?000/.test(document.getElementById('argent').textContent.replace(/ | /g, ' ')));
  assert.equal(await page.evaluate(() => window.jeu.magasin.argent), 5000);
  await ctx.close();
});

test('Engine games: screen status says the engine redraws by itself', { skip, timeout: 60000 }, async () => {
  const { page, ctx } = await openGame('/demo-games/star-runner/');
  await inject(page);
  const t = T(page);
  await t.search('lives');
  await t.setNumber('Lives', 7);
  await t.rowByName('Lives').locator('.info').click();
  await statusText(page).filter({ hasText: 'redraws by itself' }).waitFor({ timeout: 5000 });
  await ctx.close();
});

test('Search UI: ranking, dialogue hidden with a reveal link, English under text, filters, clear button, remembered search', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/boutique/');
  await inject(page);
  await page.locator('saveforge-trainer .tool[aria-label="Search"]').click();
  const input = page.locator('saveforge-trainer .search input');
  for (const [k, v] of Object.entries({ enterkeyhint: 'search', autocapitalize: 'none', autocorrect: 'off', inputmode: 'search' })) assert.equal(await input.getAttribute(k), v, k);
  assert.equal(await input.evaluate((el) => getComputedStyle(el).fontSize), '16px', '16px stops iPhone zoom on focus');
  await input.fill('money');
  await page.waitForTimeout(300);
  assert.deepEqual(await page.locator('saveforge-trainer .row .name').allTextContents(), ['Argent']);
  await page.locator('saveforge-trainer .linkbtn', { hasText: 'hidden' }).click();
  const names = await page.locator('saveforge-trainer .row .name').allTextContents();
  assert.equal(names[0], 'Argent', 'numbers still first');
  assert.ok(names.length >= 4, names.join(','));
  const subs = await page.locator('saveforge-trainer .row .sub2').allTextContents();
  assert.ok(subs.some((x) => /EN: Not enough money/.test(x)), subs.join(' | '));
  assert.ok(subs.some((x) => /EN: Earn money/.test(x)));
  // value search
  await input.fill('1822');
  await page.waitForTimeout(300);
  assert.deepEqual(await page.locator('saveforge-trainer .row .name').allTextContents(), ['Argent']);
  // filter: Text only
  await input.fill('argent');
  await page.locator('saveforge-trainer .fchip', { hasText: 'Text' }).click();
  await page.waitForTimeout(200);
  assert.ok(!(await page.locator('saveforge-trainer .row .name').allTextContents()).includes('Argent'));
  await page.locator('saveforge-trainer .fchip', { hasText: 'All' }).click();
  // clear
  await page.locator('saveforge-trainer .clr').click();
  assert.equal(await input.inputValue(), '');
  assert.ok(await page.locator('saveforge-trainer .sugg').isVisible(), 'suggestions after clearing');
  // remembered after closing and reopening the trainer
  await input.fill('clients');
  await page.waitForTimeout(400);
  await page.locator('saveforge-trainer .hbtn[aria-label="Close trainer"]').click();
  await inject(page);
  await page.locator('saveforge-trainer .tool[aria-label="Search"]').click();
  assert.equal(await page.locator('saveforge-trainer .search input').inputValue(), 'clients');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Compact view: smaller rows, path hidden, setting remembered', { skip, timeout: 60000 }, async () => {
  const { page, ctx } = await openGame('/demo-games/neon-courier/');
  await inject(page);
  const t = T(page);
  const h0 = await page.locator('saveforge-trainer .row').first().evaluate((el) => el.getBoundingClientRect().height);
  await t.nav('Settings');
  await page.locator('saveforge-trainer .setrow', { hasText: 'Compact view' }).locator('.toggle').click();
  await t.home();
  await t.nav('All variables');
  const h1 = await page.locator('saveforge-trainer .row').first().evaluate((el) => el.getBoundingClientRect().height);
  assert.equal(h0, 56);
  assert.equal(h1, 44);
  assert.equal(await page.locator('saveforge-trainer .row .sub2').first().evaluate((el) => getComputedStyle(el).display), 'none');
  await ctx.close();
});

// ---------------------------------------------------------------- regression 1.6: game state under a generic global
// A custom game with no engine keeps everything under `app` (config, asset URLs,
// UI settings and the real shop data) plus a French top-level `var argent`.
// 1.5 showed "Game state: 0" there unless website globals were switched on.
test('custom game under a generic global: variables found without website globals, explained, learned and remembered', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/test/fixtures/generic-app/?every=1200');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await inject(page);
  await page.waitForTimeout(900);
  const state = () =>
    page.evaluate(() => {
      const p = window.__saveforgeTrainer.provider();
      return { includeAll: p.engine.includeAll, entries: p.entries.map((e) => ({ path: e.path, section: e.section, tier: e.detect?.tier })) };
    });
  let s = await state();
  assert.equal(s.includeAll, false, 'website globals stay off');
  const paths = s.entries.map((e) => e.path).join('|');
  for (const want of ['argent', 'donnees › jour', 'donnees › clients', 'donnees › employes', 'stock › croissant']) assert.ok(paths.includes(want), `${want} found: ${paths}`);
  assert.doesNotMatch(paths, /config|assets|› ui ›|siteConfig|pageMeta|dataLayer|apiUrl|volume/, 'no website data');
  assert.equal(s.entries.find((e) => e.path.endsWith('stock › croissant')).section, 'potential');
  // home lists confirmed sections and the Potential category
  await page.locator('saveforge-trainer .row .lbl', { hasText: 'Potential game variables' }).first().waitFor();
  // live edit of the detected money still reaches the game
  const t = T(page);
  await t.search('argent');
  await t.setNumber('Argent', 5000);
  assert.equal(await page.evaluate(() => window.argent), 5000);
  await page.waitForFunction(() => window.__saveforgeTrainer.provider().statusOf('$/argent')?.state === 'verified', null, { timeout: 4000 });
  // ⓘ explains the detection and lets the player confirm a potential variable
  await t.home();
  await t.nav('Potential game variables');
  const info = await t.info('Croissant');
  assert.match(info, /Detection: Potential game variable/i);
  assert.match(info, /inside a game-like object/);
  await page.locator('saveforge-trainer .sheet .btn', { hasText: 'This is a game variable' }).click();
  await page.locator('saveforge-trainer .sheet h3', { hasText: 'Detection: Game variable' }).waitFor();
  // session learning: a cryptic counter that changes while playing is promoted on its own
  await page.waitForFunction(() => window.__saveforgeTrainer.provider().entries.some((e) => e.path.endsWith('donnees › cpt')), null, { timeout: 8000 });
  // Diagnostics: counts, accessible state, excluded variables with reasons, report without values
  await t.home();
  await t.nav('Diagnostics');
  const sheet = page.locator('saveforge-trainer .sheet');
  await sheet.locator('h3', { hasText: 'Game variables:' }).waitFor();
  const text = await sheet.innerText();
  assert.match(text, /Game variables: [1-9]\d* confirmed, \d+ potential/i);
  assert.match(text, /Game state accessible/i);
  await sheet.locator('summary', { hasText: 'Why was this excluded?' }).click();
  const excluded = await sheet.locator('details.excluded-vars').innerText();
  assert.match(excluded, /app\.config\.apiUrl — excluded, confidence -?[\d.]+, source window\.app: .*website-like name/);
  assert.match(excluded, /pageMeta\.plays/);
  assert.ok(await sheet.locator('details.excluded-vars button', { hasText: 'Mark as game' }).first().isVisible());
  await sheet.locator('button', { hasText: 'Copy detection report' }).click();
  await page.locator('saveforge-trainer .toast', { hasText: 'Detection report copied' }).waitFor();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /app\.donnees\.stock\.croissant \[int\] game/);
  assert.match(report, /app\.config\.apiUrl \[string\] excluded/);
  assert.doesNotMatch(report, /api\.example\.net|Chez Lucie|Bienvenue/, 'no values in the report');
  // the mark is remembered for this website
  await page.waitForTimeout(300);
  await page.locator('saveforge-trainer .hbtn[aria-label="Close trainer"]').click();
  await inject(page);
  await page.waitForTimeout(900);
  s = await state();
  const croissant = s.entries.find((e) => e.path.endsWith('stock › croissant'));
  assert.equal(croissant.tier, 'game', 'still confirmed after reopening');
  assert.notEqual(croissant.section, 'potential');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---------------------------------------------------------------- Button & Textbox Linker
const L = (page) => ({
  async open() {
    await T(page).home();
    await T(page).nav('Button & Textbox Linker');
    await page.locator('saveforge-trainer .sheet h2', { hasText: 'Button & Textbox Linker' }).waitFor();
  },
  async inspect(selector) {
    await page.locator('saveforge-trainer .btn', { hasText: /^Inspect (element|another)$/ }).first().click();
    await page.locator('saveforge-trainer .lk-bar').waitFor();
    await page.locator(selector).tap();
    await page.locator('saveforge-trainer .lk-bar').waitFor({ state: 'detached' });
    await page.locator('saveforge-trainer .sheet .path').first().waitFor();
    return page.locator('saveforge-trainer .sheet').innerText();
  },
  state: () => page.evaluate(() => ({ ...window.joueur, log: document.getElementById('log').textContent })),
});

test('Linker: inspecting a button never runs it, and shows confirmed vs possible links honestly', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/test/fixtures/linker-game/');
  await inject(page);
  const l = L(page);
  await l.open();
  const before = await l.state();
  // inline onclick: confirmed, with the function and the variables its code changes
  let text = await l.inspect('#acheter');
  assert.deepEqual(await l.state(), before, 'the inspect tap did not buy anything');
  assert.match(text, /Confirmed links \(1\)/i);
  assert.match(text, /inline onclick attribute — runs acheter\(\)/);
  assert.match(text, /joueur\.argent -= 30 — likely, in acheter\(\) · matches trainer variable/);
  assert.match(text, /joueur\.epees \+= 1/);
  assert.doesNotMatch(text, /textContent/, 'DOM writes are not reported as game variables');
  assert.match(text, /may spend currency or erase progress/);
  // handler property: confirmed by function identity
  text = await l.inspect('#vendre');
  assert.match(text, /click handler property — calls vendre\(\)/);
  // delegated listener added before SaveForge: not invented, the limit is stated instead
  text = await l.inspect('#annuler');
  assert.match(text, /Confirmed links \(0\)/i);
  assert.match(text, /cannot be listed/);
  assert.doesNotMatch(text, /Annulé/);
  // destructive button: inspected, not run
  text = await l.inspect('#reset');
  assert.match(text, /reinitialiser\(\)/);
  assert.match(text, /joueur\.argent = 0/);
  // textbox: inline oninput assigns this.value → likely bound variable
  text = await l.inspect('#nom');
  assert.match(text, /Variable receiving the input/i);
  assert.match(text, /likely — handler code assigns the value to joueur\.nom/);
  assert.equal(await page.evaluate(() => document.activeElement?.id || ''), '', 'the field was not focused (no keyboard on iPhone)');
  // "Watch one tap" observes the real effect of a button whose listener cannot be listed
  await page.locator('saveforge-trainer .btn', { hasText: 'Inspect another' }).click();
  await page.locator('saveforge-trainer .lk-bar').waitFor();
  await page.locator('#vendre').tap();
  await page.locator('saveforge-trainer .lk-bar').waitFor({ state: 'detached' });
  await page.locator('saveforge-trainer .btn', { hasText: 'Watch one tap' }).click();
  await page.locator('#vendre').click();
  await page.locator('saveforge-trainer .lk-watch .okbox').waitFor({ timeout: 5000 });
  const watched = await page.locator('saveforge-trainer .lk-watch').innerText();
  assert.match(watched, /2 variable\(s\) changed/);
  assert.match(watched, /joueur › argent: 100 → 120/);
  assert.match(watched, /joueur › epees: 1 → 0/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Linker: remap Buy → Sell with preview and confirmation; Undo, Restore original and Disable all restore the game', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/test/fixtures/linker-game/');
  await inject(page);
  const l = L(page);
  await l.open();
  await l.inspect('#acheter');
  await page.locator('saveforge-trainer .btn', { hasText: 'Link to another action' }).click();
  await page.locator('saveforge-trainer .lk-cand', { hasText: 'Same as tapping “Vendre une épée”' }).click();
  const preview = await page.locator('saveforge-trainer .sheet').innerText();
  assert.match(preview, /Preview mapping/i);
  assert.match(preview, /inline onclick attribute: runs acheter\(\)/);
  assert.match(preview, /Same as tapping “Vendre une épée”/);
  // confirmation required: risky element needs the acknowledgement first
  const apply = page.locator('saveforge-trainer .btn.go', { hasText: 'Apply mapping' });
  assert.equal(await apply.isDisabled(), true);
  assert.deepEqual((await l.state()).argent, 100, 'nothing changed by the preview');
  await page.locator('saveforge-trainer .sheet label', { hasText: 'I understand' }).locator('input').check();
  await apply.click();
  await page.locator('saveforge-trainer .lk-map', { hasText: 'Acheter' }).waitFor();
  // the Buy button now sells
  await page.locator('saveforge-trainer .hbtn[aria-label="Minimize"]').click();
  await page.locator('#acheter').click();
  let s = await l.state();
  assert.equal(s.argent, 120);
  assert.equal(s.epees, 0);
  assert.equal(s.log, 'Épée vendue');
  // other buttons are untouched
  await page.locator('#vendre').click();
  assert.equal((await l.state()).log, 'Rien à vendre');
  // Disable all → original behaviour while disabled
  await page.locator('saveforge-trainer .orb').click();
  await page.locator('saveforge-trainer .sheet label', { hasText: 'Mappings enabled' }).locator('input').uncheck();
  await page.locator('saveforge-trainer .hbtn[aria-label="Minimize"]').click();
  await page.locator('#acheter').click();
  s = await l.state();
  assert.equal(s.argent, 90, 'bought: original behaviour');
  assert.equal(s.epees, 1);
  await page.locator('saveforge-trainer .orb').click();
  await page.locator('saveforge-trainer .sheet label', { hasText: 'Mappings enabled' }).locator('input').check();
  // Undo removes the mapping
  await page.locator('saveforge-trainer .btn', { hasText: 'Undo last change' }).click();
  assert.equal(await page.locator('saveforge-trainer .lk-map').count(), 0);
  await page.locator('saveforge-trainer .hbtn[aria-label="Minimize"]').click();
  await page.locator('#acheter').click();
  assert.equal((await l.state()).argent, 60, 'buys again after Undo');
  // map to Cancel (do nothing), then Restore original
  await page.locator('saveforge-trainer .orb').click();
  await l.inspect('#acheter');
  await page.locator('saveforge-trainer .btn', { hasText: 'Link to another action' }).click();
  await page.locator('saveforge-trainer .lk-cand', { hasText: 'Do nothing' }).click();
  await page.locator('saveforge-trainer .sheet label', { hasText: 'I understand' }).locator('input').check();
  await page.locator('saveforge-trainer .btn.go', { hasText: 'Apply mapping' }).click();
  await page.locator('saveforge-trainer .hbtn[aria-label="Minimize"]').click();
  await page.locator('#acheter').tap();
  assert.equal((await l.state()).argent, 60, 'cancelled: nothing bought');
  await page.locator('saveforge-trainer .orb').click();
  await page.locator('saveforge-trainer .lk-map .btn', { hasText: 'Restore original' }).click();
  await page.locator('saveforge-trainer .hbtn[aria-label="Minimize"]').click();
  await page.locator('#acheter').click();
  assert.equal((await l.state()).argent, 30, 'original restored');
  // closing SaveForge removes every interception
  await page.locator('saveforge-trainer .orb').click();
  await page.locator('saveforge-trainer .hbtn[aria-label="Close trainer"]').click();
  await page.locator('#acheter').click();
  assert.equal((await l.state()).argent, 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Linker: textbox binding (detect by typing, link a field to a variable) and per-game saved mappings', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/test/fixtures/linker-game/');
  await inject(page);
  const l = L(page);
  await l.open();
  // detect by typing: the variable that receives the text is observed
  await l.inspect('#nom');
  await page.locator('saveforge-trainer .btn', { hasText: 'Detect by typing' }).click();
  await page.locator('#nom').fill('Zoé');
  await page.locator('#nom').blur();
  await page.locator('saveforge-trainer .lk-watch .okbox').waitFor({ timeout: 5000 });
  assert.match(await page.locator('saveforge-trainer .lk-watch').innerText(), /joueur › nom: "Lucie" → "Zoé" — equals what you entered \(bound variable\)/);
  // link the unbound nickname field to joueur.surnom (keeping the game's own handling)
  await l.inspect('#surnom');
  await page.locator('saveforge-trainer .btn', { hasText: 'Link to another action' }).click();
  await page.locator('saveforge-trainer .lk-cand', { hasText: 'Write to joueur › surnom' }).click();
  assert.match(await page.locator('saveforge-trainer .sheet').innerText(), /also goes into the variable; the game’s own handlers keep working/);
  await page.locator('saveforge-trainer .sheet label', { hasText: 'Save this mapping for this game' }).locator('input').check();
  await page.locator('saveforge-trainer .btn.go', { hasText: 'Apply mapping' }).click();
  await page.locator('saveforge-trainer .lk-map', { hasText: 'Surnom' }).waitFor();
  await page.locator('saveforge-trainer .sheet label', { hasText: 'Apply saved mappings automatically' }).locator('input').check();
  await page.waitForTimeout(300);
  await page.locator('saveforge-trainer .hbtn[aria-label="Minimize"]').click();
  await page.locator('#surnom').fill('Max');
  assert.equal(await page.evaluate(() => window.joueur.surnom), 'Max');
  // the saved mapping comes back when SaveForge is opened again on this game
  await page.locator('saveforge-trainer .orb').click();
  await page.locator('saveforge-trainer .hbtn[aria-label="Close trainer"]').click();
  await page.locator('#surnom').fill('Off');
  assert.equal(await page.evaluate(() => window.joueur.surnom), 'Max', 'closed: no binding');
  await inject(page);
  await page.locator('saveforge-trainer .toast', { hasText: 'saved mapping(s) active' }).waitFor({ timeout: 4000 });
  await page.locator('saveforge-trainer .hbtn[aria-label="Minimize"]').click();
  await page.locator('#surnom').fill('Again');
  assert.equal(await page.evaluate(() => window.joueur.surnom), 'Again');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Linker: SugarCube-style story links can be inspected and relinked to another choice', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/lantern-tale/');
  await inject(page);
  const l = L(page);
  await l.open();
  const text = await l.inspect('a[data-go="Stall"]');
  assert.match(text, /Visit the lantern stall/);
  assert.equal(await page.evaluate(() => window.SugarCube.State.passage), 'Market', 'inspect tap did not navigate');
  await page.locator('saveforge-trainer .btn', { hasText: 'Link to another action' }).click();
  await page.locator('saveforge-trainer .lk-cand', { hasText: 'Same as tapping “See the Oracle”' }).click();
  await page.locator('saveforge-trainer .btn.go', { hasText: 'Apply mapping' }).click();
  await page.locator('saveforge-trainer .hbtn[aria-label="Minimize"]').click();
  await page.locator('a[data-go="Stall"]').click();
  assert.equal(await page.evaluate(() => window.SugarCube.State.passage), 'Oracle', 'the stall choice now leads to the Oracle');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---------------------------------------------------------------- 1.8: discoverability regressions
// 1.6/1.7 walked every global with one shared breadth-first budget: a large
// dialogue/translation table used it up and deeper money was never reached, not
// even with "Include website globals" or a value search (seen on a real game).

test('regression: money deep in a game global stays discoverable next to a huge dialogue table', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/test/fixtures/dialogue-heavy/?lines=12000');
  await inject(page);
  await page.waitForTimeout(1200);
  const paths = await page.evaluate(() => window.__saveforgeTrainer.provider().entries.map((e) => `${e.path}@${e.section}`));
  assert.ok(paths.includes('window › game › state › player › wallet › computerStoreMoney@money'), paths.slice(0, 20).join(' | '));
  const t = T(page);
  // the exact value search finds it
  await t.search('28480799');
  assert.deepEqual(await page.locator('saveforge-trainer .row .name').allTextContents(), ['Computer Store Money']);
  await t.setNumber('Computer Store Money', 99999999);
  assert.equal(await page.evaluate(() => window.game.state.player.wallet.computerStoreMoney), 99999999);
  // Diagnostics full scan: the value is reached and listed; the dialogue cap is reported, not hidden
  await t.home();
  await t.nav('Diagnostics');
  const sheet = page.locator('saveforge-trainer .sheet');
  await sheet.locator('button', { hasText: 'Run full scan' }).click();
  await sheet.locator('.fullscan dl').waitFor({ timeout: 10000 });
  assert.match(await sheet.locator('.fullscan').innerText(), /dialogues \(\d+ texts skipped\)/);
  await sheet.locator('.fullscan input').fill('99,999,999');
  await sheet.locator('.fullscan .btn', { hasText: 'Find' }).click();
  assert.match(await sheet.locator('.fullscan .lookup').innerText(), /game\.state\.player\.wallet\.computerStoreMoney = 99999999\s+Listed \(game variable/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('hidden state: script-level let/const, state created later (Rescan), SugarCube setup, and an honest full scan', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/test/fixtures/hidden-state/');
  await inject(page);
  const t = T(page);
  // SugarCube story variables and setup objects
  const sc = await page.evaluate(() => window.__saveforgeTrainer.provider().entries.map((e) => e.path).join('|'));
  assert.match(sc, /State\.variables\.money/);
  assert.match(sc, /setup\.shop\.prices\.laptop/); // SugarCube notation since 2.0
  // script-level variables are found and edited for real
  await t.chip('Other game state');
  await page.waitForTimeout(1200);
  const g = await page.evaluate(() => window.__saveforgeTrainer.provider().entries.map((e) => e.path).join('|'));
  for (const want of ['window › coins', 'window › save › gold', 'window › shopPrices › sword']) assert.ok(g.includes(want), `${want}: ${g}`);
  await t.search('coins');
  await t.setNumber('Coins', 50);
  assert.equal(await page.evaluate(() => coins), 50, 'let coins changed in the game');
  await t.search('gold');
  await t.setNumber('Gold', 800);
  assert.equal(await page.evaluate(() => save.gold), 800);
  // state created after the trainer opened is found by Rescan
  await page.locator('saveforge-trainer .hbtn[aria-label="Minimize"]').click();
  await page.locator('#start').click();
  await page.locator('saveforge-trainer .orb').click();
  await t.home();
  await t.nav('Rescan game');
  await page.waitForFunction(() => window.__saveforgeTrainer.provider().entries.some((e) => /lateState › computerStore › money/.test(e.path)), null, { timeout: 4000 });
  // full scan: what cannot be reached is named, never invented
  await t.home();
  await t.nav('Diagnostics');
  const sheet = page.locator('saveforge-trainer .sheet');
  await sheet.locator('button', { hasText: 'Run full scan' }).click();
  await sheet.locator('.fullscan dl').waitFor({ timeout: 10000 });
  const full = await sheet.locator('.fullscan').innerText();
  assert.match(full, /getter propert(y|ies) \(never called\): .*secretGold/);
  assert.match(full, /1 Map/);
  assert.match(full, /Script-level let\/const variables: .*save/);
  await sheet.locator('.fullscan input').fill('999');
  await sheet.locator('.fullscan .btn', { hasText: 'Find' }).click();
  assert.match(await sheet.locator('.fullscan .lookup').innerText(), /not in any variable SaveForge can reach/);
  await sheet.locator('.fullscan input').fill('3200');
  await sheet.locator('.fullscan .btn', { hasText: 'Find' }).click();
  assert.match(await sheet.locator('.fullscan .lookup').innerText(), /SugarCube\.State\.variables\.money = 3200\s+Listed by the engine source/);
  // search across everything reachable, regardless of classification
  await t.home();
  await t.search('olivia');
  await page.locator('saveforge-trainer .raw-search').click();
  await page.locator('saveforge-trainer .chip[aria-pressed=true]', { hasText: 'All variables (raw)' }).waitFor();
  await page.locator('saveforge-trainer .row .name').nth(1).waitFor({ timeout: 10000 }); // the raw source loads first
  const raw = await page.evaluate(() => window.__saveforgeTrainer.provider().entries.filter((e) => /olivia/i.test(e.path)).map((e) => e.path).join('|'));
  assert.match(raw, /SugarCube\.State\.variables › affection › olivia/);
  assert.match(raw, /SugarCube\.setup › npcs › olivia › maxAffection/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('regression: variables that were editable in earlier versions are still discoverable and editable', { skip, timeout: 120000 }, async () => {
  const cases = [
    ['/demo-games/neon-courier/', /window › game › credits$/],
    ['/demo-games/boutique/', /window › jeu › magasin › argent$/],
    ['/demo-games/sakura-market/', /window › データ › 所持金$/],
    ['/demo-games/sakura-market/', /window › estado › monedas$/],
    ['/demo-games/lantern-tale/', /State\.variables\.gold$/],
    ['/demo-games/crystal-quest/', /party › _gold$/],
    ['/demo-games/tap-miner/', /globals › Ore$/],
    ['/demo-games/star-runner/', /registry › stars$/],
    ['/test/fixtures/generic-app/', /window › argent$/],
    ['/test/fixtures/linker-game/', /window › joueur › argent$/],
    ['/test/fixtures/dialogue-heavy/', /computerStoreMoney$/],
  ];
  for (const [path, re] of cases) {
    const { page, ctx, errors } = await openGame(path);
    await inject(page);
    await page.waitForTimeout(900);
    const found = await page.evaluate((src) => {
      const p = window.__saveforgeTrainer.provider();
      const e = p.entries.find((x) => new RegExp(src).test(x.path));
      return e ? { path: e.path, editable: p.node(e.nodeId).editable, value: p.value(e.nodeId) } : { missing: p.entries.slice(0, 12).map((x) => x.path) };
    }, re.source);
    assert.ok(!found.missing, `${path}: ${re} not found; have ${JSON.stringify(found.missing)}`);
    assert.equal(found.editable, true, `${path}: ${found.path} editable`);
    assert.equal(typeof found.value, 'number', `${path}: ${found.path} live value`);
    assert.deepEqual(errors, [], path);
    await ctx.close();
  }
});

// ---------------------------------------------------------------- 1.9: shared save variables (Save Editor ⇄ trainer)
const S9 = (page) => ({
  entries: (re) =>
    page.evaluate((src) => {
      const p = window.__saveforgeTrainer.provider();
      return p.entries.filter((e) => new RegExp(src).test(e.path)).map((e) => ({ id: e.nodeId, path: e.path, origin: p.originOf ? p.originOf(e.nodeId) : 'live', value: p.value(e.nodeId), how: e.saveLink?.how || null }));
    }, re.source),
  waitOrigin: (re, origin, timeout = 8000) =>
    page.waitForFunction(([src, o]) => {
      const p = window.__saveforgeTrainer?.provider();
      return !!p?.originOf && p.entries.some((e) => new RegExp(src).test(e.path) && p.originOf(e.nodeId) === o);
    }, [re.source, origin], { timeout }),
  rowWithTag: (name, tag) => page.locator('saveforge-trainer .row').filter({ has: page.locator('.name', { hasText: name }) }).filter({ has: page.locator(`.otag.o-${tag}`) }).first(),
});

test('shared save variables: discovered like the Save Editor, never linked by name, linked by observation, edited live and in the save, restored', { skip, timeout: 90000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/neon-courier/');
  await page.locator('#save').click();
  await inject(page);
  const t = T(page);
  const s = S9(page);
  await s.waitOrigin(/neoncourier\.save › credits$/, 'save');
  // same variables as the Save Editor (same pipeline), next to the live ones — not merged by name or value
  let credits = await s.entries(/credits$/);
  assert.deepEqual(credits.map((c) => c.origin).sort(), ['live', 'save']);
  assert.ok(credits.every((c) => c.value === 250));
  // the "Saves in storage" source is the very same shared save model
  assert.equal(await page.evaluate(async () => {
    const p = window.__saveforgeTrainer.provider();
    return p.saveProvider().entries.length === p.entries.filter((e) => e.nodeId.startsWith('save:')).length;
  }), true);
  // edit the live value; the game saves; the save follows → verified link, one entry
  await t.search('credits');
  assert.equal(await page.locator('saveforge-trainer .row .otag.o-save').count(), 1);
  await t.setNumber('Credits', 4242);
  assert.equal(await page.evaluate(() => window.game.credits), 4242);
  await page.waitForFunction(() => window.__saveforgeTrainer.provider().statusOf('$/game/credits')?.state === 'verified', null, { timeout: 4000 });
  await page.evaluate(() => document.getElementById('save').click());
  await s.waitOrigin(/game › credits$/, 'live+save');
  credits = await s.entries(/credits$/);
  assert.equal(credits.length, 1, 'no duplicate once linked');
  assert.equal(credits[0].how, 'observed');
  // other same-named fields stay separate (no guessing)
  assert.deepEqual((await s.entries(/› day$/)).map((x) => x.origin).sort(), ['live', 'save']);
  // ⓘ explains the link
  await t.home();
  await t.search('credits');
  await page.locator('saveforge-trainer .row .info').first().click();
  const info = await t.sheetText();
  assert.match(info, /Source: Live \+ Save/i);
  assert.match(info, /verified observation — observed: the save changed 250 → 4242/);
  // live edit + "Also write to save" + Write saves (no reload)
  await page.evaluate(() => (window.__noReload = 1));
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: /^(Edit|Toggle)$/ }).click();
  await page.locator('saveforge-trainer .sheet .field').fill('5000');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  assert.equal(await page.evaluate(() => window.game.credits), 5000);
  await page.locator('saveforge-trainer .sheet .btn', { hasText: 'Also write to save' }).click();
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('neoncourier.save'))).credits, 4242, 'pending until written');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: /Write saves \(1\)/ }).click();
  assert.match(await t.sheetText(), /The running game is not changed/);
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Write saves' }).click();
  await page.locator('saveforge-trainer .toast', { hasText: 'Saves written' }).waitFor();
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('neoncourier.save'))).credits, 5000);
  assert.equal(await page.evaluate(() => window.__noReload), 1, 'no reload');
  // a save-only edit is pending and explained, the running game is untouched
  await t.home();
  await t.search('day');
  await s.rowWithTag('Day', 'save').locator('.num').click();
  await page.locator('saveforge-trainer .sheet .field').fill('9');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  assert.match(await t.sheetText(), /Save edit pending.*does not see it before that/s);
  assert.equal(await page.evaluate(() => window.game.day), 1);
  // undo/redo cover save edits too
  await t.tool('Undo');
  assert.equal(await page.evaluate(() => window.__saveforgeTrainer.provider().savePending()), 0);
  await t.tool('Redo');
  assert.equal(await page.evaluate(() => window.__saveforgeTrainer.provider().savePending()), 1);
  // Apply & Reload: the game loads the edited save
  await page.locator('saveforge-trainer .tool.primary', { hasText: 'Write saves' }).click();
  await Promise.all([page.waitForEvent('load'), page.locator('saveforge-trainer .btn.warn', { hasText: 'Apply & Reload' }).click()]);
  await page.waitForFunction(() => window.game && window.game.day === 9);
  // restore: the snapshot taken before the write puts the old save back
  await inject(page);
  await t.nav('Backups & restore');
  await page.locator('saveforge-trainer .sheet h3', { hasText: 'Save snapshots' }).waitFor();
  await Promise.all([page.waitForEvent('load'), page.locator('saveforge-trainer .btn.warn', { hasText: 'Restore & reload' }).first().click()]);
  await page.waitForFunction(() => window.game && window.game.day === 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('shared save variables: engine save layouts link RPG Maker and SugarCube variables without guessing', { skip, timeout: 60000 }, async () => {
  let { page, ctx, errors } = await openGame('/demo-games/crystal-quest/');
  await page.locator('#save').click();
  await inject(page);
  let s = S9(page);
  await s.waitOrigin(/party › _gold$/, 'live+save');
  const gold = await s.entries(/_gold$/);
  assert.equal(gold.length, 1, 'save gold merged into the live entry');
  assert.equal(gold[0].how, 'engine');
  // edit live (engine setter, verified), then also write it to RPG File1
  const t = T(page);
  await t.search('gold');
  await t.setNumber('Gold', 777);
  assert.equal(await page.evaluate(() => window.$gameParty._gold), 777);
  await page.locator('saveforge-trainer .row .info').first().click();
  await page.locator('saveforge-trainer .sheet .btn', { hasText: 'Also write to save' }).click();
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: /Write saves \(1\)/ }).click();
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Write saves' }).click();
  await page.locator('saveforge-trainer .toast', { hasText: 'Saves written' }).waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(LZString.decompressFromBase64(localStorage.getItem('RPG File1'))).party._gold), 777);
  assert.deepEqual(errors, []);
  await ctx.close();

  ({ page, ctx, errors } = await openGame('/test/fixtures/hidden-state/'));
  await inject(page);
  s = S9(page);
  await s.waitOrigin(/State\.variables\.money$/, 'live+save');
  assert.deepEqual((await s.entries(/maxAffection$/)).map((x) => x.origin), ['live'], 'setup is not in the save');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('shared save variables: automatic sync, Sync save variables, and pending save edits are never overwritten', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame('/demo-games/neon-courier/');
  await inject(page);
  const t = T(page);
  const s = S9(page);
  await page.waitForTimeout(800);
  assert.equal((await s.entries(/neoncourier\.save/)).length, 0, 'no save yet');
  // the game saves → its variables appear without any button
  await page.evaluate(() => document.getElementById('save').click());
  await s.waitOrigin(/neoncourier\.save › credits$/, 'save');
  // manual sync
  await t.home();
  await t.nav('Sync save variables');
  await page.locator('saveforge-trainer .toast', { hasText: 'Save variables synced' }).waitFor();
  // a pending save edit, then the game saves newer progress
  await t.search('credits');
  await s.rowWithTag('Credits', 'save').locator('.num').click();
  await page.locator('saveforge-trainer .sheet .field').fill('1');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  await page.evaluate(() => {
    window.game.credits = 9999;
    document.getElementById('save').click();
  });
  await page.waitForFunction(() => window.__saveforgeTrainer.provider().saves.stale === true, null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => window.__saveforgeTrainer.provider().savePending()), 1, 'pending edit kept');
  await t.home();
  await page.locator('saveforge-trainer .row .lbl', { hasText: 'The game saved new progress' }).waitFor();
  await page.locator('saveforge-trainer .tool.primary', { hasText: 'Write saves' }).click();
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Write saves' }).click();
  await page.locator('saveforge-trainer .sheet h2', { hasText: 'Nothing was written' }).waitFor();
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('neoncourier.save'))).credits, 9999, 'newer progress kept');
  await page.locator('saveforge-trainer .sheet .btn', { hasText: 'Re-read storage' }).click();
  // the pending edit is discarded on request, the newer save is read, and because the save
  // followed the game's own 250 → 9999 change, credits are now linked (one entry)
  await page.waitForFunction(() => {
    const p = window.__saveforgeTrainer.provider();
    return p.savePending() === 0 && !p.saves.stale && p.originOf('$/game/credits') === 'live+save' && p.value('$/game/credits') === 9999 && !p.entries.some((x) => /neoncourier\.save › credits$/.test(x.path));
  }, null, { timeout: 5000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---------------------------------------------------------------- 2.0: SugarCube State.variables.player.money
// A realistic SugarCube story (fixtures/sugarcube-real): sealed window.SugarCube,
// State.variables/temporary getters, a cloned moment per passage, and saves stored
// like SugarCube 2.36 (delta-encoded history, LZString UTF-16 in localStorage).
const SC_URL = '/test/fixtures/sugarcube-real/';

test('SugarCube: State.variables.player.money is LIVE after a late start, found by exact path, edited and verified', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame(`${SC_URL}?init=1500&go=Shop`);
  await inject(page); // before the story publishes window.SugarCube
  await page.locator('saveforge-trainer .chip[aria-pressed=true]', { hasText: 'SugarCube' }).waitFor({ timeout: 6000 });
  const t = T(page);
  for (const q of ['player.money', '$player.money', 'State.variables.player.money']) {
    await t.home();
    await t.search(q);
    assert.equal(await page.locator('saveforge-trainer .row .name').first().innerText(), '$player.money', q);
  }
  await t.setNumber('$player.money', 30000000);
  assert.equal(await page.evaluate(() => SugarCube.State.variables.player.money), 30000000);
  await page.waitForFunction(() => {
    const p = window.__saveforgeTrainer.provider();
    const e = p.entries.find((x) => x.label === '$player.money');
    return p.statusOf(e.nodeId)?.state === 'verified';
  }, null, { timeout: 4000 });
  // _temporary variables of the passage are live too
  await t.home();
  await t.search('_cost');
  assert.equal(await page.locator('saveforge-trainer .row .name').first().innerText(), '_cost');
  // Diagnostics: connected directly; exact path lookup
  await t.home();
  await t.nav('Diagnostics');
  const sheet = page.locator('saveforge-trainer .sheet');
  await sheet.locator('h3', { hasText: 'SugarCube' }).waitFor();
  assert.match(await sheet.innerText(), /Live: connected directly/);
  await sheet.locator('.btn', { hasText: 'Look up' }).click();
  assert.match(await sheet.locator('.sclookup').innerText(), /State\.variables\.player\.money = 30000000 \(number\) — LIVE\s+In the trainer as \$player\.money/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('SugarCube in an isolated userscript world: window.SugarCube is invisible, the page bridge connects the live State', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame(`${SC_URL}?go=Shop`);
  const cdp = await ctx.newCDPSession(page);
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'saveforge-userscript' });
  const iso = async (fn) => {
    const r = await cdp.send('Runtime.evaluate', { expression: `(${fn})()`, contextId: executionContextId, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  await cdp.send('Runtime.evaluate', { expression: trainerJs, contextId: executionContextId });
  await page.locator('saveforge-trainer .row').first().waitFor();
  assert.equal(await iso('() => typeof window.SugarCube'), 'undefined', 'really isolated');
  assert.equal(await iso('() => window.__saveforgeTrainer.provider().title'), 'SugarCube (Twine)');
  const t = T(page);
  await t.search('player.money');
  await t.setNumber('$player.money', 12345);
  assert.equal(await page.evaluate(() => SugarCube.State.variables.player.money), 12345, 'the page world changed');
  assert.equal(await iso(`() => { const p = window.__saveforgeTrainer.provider(); const e = p.entries.find((x) => x.label === '$player.money'); return p.value(e.nodeId); }`), 12345);
  await t.home();
  await t.nav('Diagnostics');
  const sheet = page.locator('saveforge-trainer .sheet');
  await sheet.locator('h3', { hasText: 'SugarCube' }).waitFor();
  assert.match(await sheet.innerText(), /Live: connected through the page bridge/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('SugarCube save: the current moment of a delta-encoded save is linked to the live variable, not delta[0]', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame(`${SC_URL}?go=Shop,Street`);
  await inject(page);
  const s = S9(page);
  await s.waitOrigin(/^State\.variables\.player\.money$/, 'live+save');
  const link = await page.evaluate(() => {
    const p = window.__saveforgeTrainer.provider();
    const e = p.entries.find((x) => x.label === '$player.money');
    return { saveId: e.saveLink.saveId, detail: e.saveLink.detail, saveValue: p.saveProvider().value(e.saveLink.saveId), dupes: p.entries.filter((x) => /player\.money/.test(x.label)).length };
  });
  assert.match(link.saveId, /\/autosave\/state\/delta\/1\/variables\/player\/money\/1$/, 'the Copy op of moment 2, not delta[0]');
  assert.match(link.detail, /current moment 3\/3 \(delta-encoded; value stored in delta\[1\]\)/);
  assert.equal(link.saveValue, 28470000);
  assert.equal(link.dupes, 1, 'superseded moments are not listed next to live values');
  // edit live, also write it to the save, then decode the stored save like SugarCube does
  const t = T(page);
  await t.search('player.money');
  await t.setNumber('$player.money', 5000000);
  await page.locator('saveforge-trainer .row .info').first().click();
  await page.locator('saveforge-trainer .sheet .btn', { hasText: 'Also write to save' }).click();
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: /Write saves \(1\)/ }).click();
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Write saves' }).click();
  await page.locator('saveforge-trainer .toast', { hasText: 'Saves written' }).waitFor();
  const { decodeDelta } = await import('../src/adapters/sugarcube-moments.js');
  const save = await page.evaluate(() => JSON.parse(LZString.decompressFromUTF16(localStorage.getItem('(Saved Games)fixture.saves'))).autosave);
  const moments = decodeDelta(save.state.delta);
  assert.equal(moments[save.state.index].variables.player.money, 5000000, 'current moment carries the new value');
  assert.equal(save.state.delta[0].variables.player.money, 28480799, 'the first moment is untouched');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('SugarCube that keeps State private: the reason is reported, saves stay editable, and a share code from the Save Editor imports with confirmation', { skip, timeout: 90000 }, async () => {
  const { page, ctx, errors } = await openGame(`${SC_URL}?hidden=1&go=Shop,Street`);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const exported = await page.evaluate(() => window.__fixture.Save.exportText());
  await inject(page);
  const t = T(page);
  // no live source is invented; the reason is explicit
  assert.equal(await page.locator('saveforge-trainer .chip', { hasText: 'SugarCube' }).count(), 0);
  await t.home();
  await t.nav('Diagnostics');
  let sheet = page.locator('saveforge-trainer .sheet');
  await sheet.locator('h3', { hasText: 'SugarCube' }).waitFor();
  const diag = await sheet.innerText();
  assert.match(diag, /No public SugarCube API — window\.SugarCube is not defined in this page — neither in SaveForge’s context nor in the page’s own context/);
  assert.doesNotMatch(diag, /no web page or extension can read/, 'no unsupported claims');
  assert.match(diag, /✓ SugarCube session state found in sessionStorage/);
  assert.match(diag, /✓ SugarCube saves in localStorage: Autosave \(\+3 empty slot\(s\)\)/);
  assert.match(diag, /✓ SugarCube story in this frame: <tw-storydata format="SugarCube" format-version="2\.36\.1">/);
  assert.match(diag, /✕ In the page’s own world window\.SugarCube is undefined too/);
  await sheet.locator('.btn', { hasText: 'Look up' }).click();
  assert.match(await sheet.locator('.sclookup').innerText(), /Not connected to the live State/);
  // the game's own saves: current-moment value as SAVE
  await t.home();
  await t.chip('Saves in storage');
  await t.search('player.money');
  assert.equal(await page.locator('saveforge-trainer .row .name').first().innerText(), '$player.money');
  assert.match(await page.locator('saveforge-trainer .row .num').first().innerText(), /28,?470,?000/);
  // Save Editor → share code → trainer (different sites): confirm, then SAVE · IMPORTED
  const { encodeShare } = await import('../src/core/share.js');
  const code = encodeShare({ name: 'fixture.save', input: exported, engine: 'sugarcube' });
  await t.home();
  await t.nav('Import from Save Editor');
  await page.locator('saveforge-trainer .sheet textarea').fill(code);
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Read' }).click();
  const preview = await t.sheetText();
  assert.match(preview, /Current moment\s+3 of 3 \(delta-encoded history, resolved like SugarCube; state\.index = 2\)/);
  assert.match(preview, /not the running game/);
  assert.match(preview, /Matching save in this game: .*same SugarCube save \(story id “fixture”/);
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Import as SAVE variables' }).click();
  await page.locator('saveforge-trainer .chip[aria-pressed=true]', { hasText: 'Imported: fixture.save' }).waitFor();
  await t.search('player.money');
  assert.equal(await page.locator('saveforge-trainer .row .otag').first().innerText(), 'SAVE · IMPORTED');
  await t.setNumber('$player.money', 777);
  // export: the downloaded file decodes to the edited current moment
  await page.locator('saveforge-trainer .tool.primary', { hasText: 'Export' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Download edited save' }).click()]);
  const text = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
  const out = await analyzeFile('edited.save', text);
  const money = out.doc.menu.all.find((e) => e.label === '$player.money');
  assert.equal(out.doc.node(money.nodeId).value, 777);
  // write it into the game's matching save (verified destination), then Write saves
  await page.locator('saveforge-trainer .sheet .btn.warn', { hasText: 'Add to the game’s save' }).click();
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Write saves' }).click();
  await page.locator('saveforge-trainer .toast', { hasText: 'Saves written' }).waitFor();
  const { decodeDelta } = await import('../src/adapters/sugarcube-moments.js');
  const save = await page.evaluate(() => JSON.parse(LZString.decompressFromUTF16(localStorage.getItem('(Saved Games)fixture.saves'))).autosave);
  assert.equal(decodeDelta(save.state.delta)[save.state.index].variables.player.money, 777);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---------------------------------------------------------------- 2.1: SugarCube save editing that survives
// SugarCube keeps the running playthrough in sessionStorage and a page reload
// resumes it; saves are used only when loaded. Editing the autosave and reloading
// therefore reverts (the user's money 20480799 → 28480799). These tests reproduce
// that and check the guided Edit → Backup → Write → Load → Verify workflow.
const scSaves = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('(Saved Games)fixture.saves');
    return JSON.parse(LZString.decompressFromUTF16(raw));
  });
const moneyOf = async (save) => {
  const { decodeDelta } = await import('../src/adapters/sugarcube-moments.js');
  return decodeDelta(save.state.delta)[save.state.index].variables.player.money;
};
const hudMoney = (page) => page.evaluate(() => Number(/💵 (\d+)/.exec(document.getElementById('hud').textContent)[1]));

test('regression: editing the SugarCube autosave + Apply & Reload reverts the money; SaveForge now warns before writing', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame(`${SC_URL}?hidden=1&go=Shop`);
  await inject(page);
  const t = T(page);
  await t.chip('Saves in storage');
  await t.search('player.money');
  await t.setNumber('$player.money', 20480799);
  await page.locator('saveforge-trainer .tool.primary', { hasText: 'Apply & Reload' }).click();
  const warn = await t.sheetText();
  assert.match(warn, /SugarCube does not load saves on a page reload/);
  assert.match(warn, /money reverts/);
  // doing it anyway reproduces the report
  await Promise.all([page.waitForEvent('load'), page.locator('saveforge-trainer .btn.warn', { hasText: 'Apply & Reload' }).click()]);
  assert.equal(await hudMoney(page), 28470000, 'the reload resumed the session state, not the edited autosave');
  await page.locator('a[data-passage="Street"]').click();
  assert.equal(await moneyOf((await scSaves(page)).autosave), 28470000, 'the next autosave wrote the old money back');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('SugarCube save workflow: edit → backup → write to a free slot → load from the game’s Saves menu → verified', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame(`${SC_URL}?hidden=1&go=Shop`);
  await inject(page);
  const t = T(page);
  await t.nav('Edit SugarCube save');
  let sheet = await t.sheetText();
  assert.match(sheet, /reloading the web page does not load it/);
  assert.match(sheet, /In this save: 28,470,000 · running game \(session\): 28,470,000/);
  assert.match(sheet, /Copy into empty Slot 1 \(recommended\)/);
  await page.locator('saveforge-trainer .scedit input').nth(1).fill('20480799');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Back up & write' }).click();
  await page.locator('saveforge-trainer .sheet h2', { hasText: 'Load the edited save' }).waitFor();
  sheet = await t.sheetText();
  assert.match(sheet, /Not loaded yet/);
  assert.match(sheet, /Open the game’s Saves menu/);
  assert.match(sheet, /Do not reload the web page/);
  // written to Slot 1 as a copy; the autosave is untouched
  let saves = await scSaves(page);
  assert.equal(await moneyOf(saves.slots[0]), 20480799);
  assert.match(saves.slots[0].title, /SaveForge edit/);
  assert.equal(await moneyOf(saves.autosave), 28470000);
  assert.equal(await hudMoney(page), 28470000, 'writing alone does not change the running game');
  // the player loads it from the game's own menu
  await page.locator('saveforge-trainer .hbtn[aria-label="Minimize"]').click();
  await page.locator('#saves-btn').click();
  await page.locator('#saves-dialog button[data-load="0"]').click();
  await page.locator('saveforge-trainer .toast', { hasText: 'Verified: the game loaded your edited save' }).waitFor({ timeout: 4000 });
  assert.equal(await hudMoney(page), 20480799);
  // it sticks: the next passage autosaves the edited money
  await page.locator('a[data-passage="Street"]').click();
  saves = await scSaves(page);
  assert.equal(await moneyOf(saves.autosave), 20480799, 'the game’s own autosave now carries the edit');
  await page.locator('saveforge-trainer .orb').click();
  await t.home();
  await page.locator('saveforge-trainer .row .lbl', { hasText: 'Edited save loaded ✓' }).waitFor();
  // the backup is listed with the other save snapshots
  await t.nav('Backups & restore');
  await page.locator('saveforge-trainer .sheet .okbox', { hasText: 'change(s) were applied after it' }).first().waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('SugarCube save workflow: warns when the running game differs from the save, refuses when the game saved meanwhile, undo restores', { skip, timeout: 60000 }, async () => {
  const { page, ctx, errors } = await openGame(`${SC_URL}?hidden=1`);
  // an older manual save (money 28480799), then the game moves on (session 28470000)
  await page.locator('#saves-btn').click();
  await page.locator('#saves-dialog button[data-save="0"]').click();
  await page.locator('a[data-passage="Shop"]').click();
  await inject(page);
  const t = T(page);
  await t.nav('Edit SugarCube save');
  await page.locator('saveforge-trainer .sheet label', { hasText: 'Slot 1' }).first().locator('input').check();
  await page.locator('saveforge-trainer .scedit input').nth(1).fill('99');
  const sheet = await t.sheetText();
  assert.match(sheet, /The running game \(session\) has \$player\.money = 28,470,000, but this save has 28,480,799/);
  const go = page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Back up & write' });
  assert.equal(await go.isDisabled(), true, 'needs “I understand”');
  await page.locator('saveforge-trainer .sheet label', { hasText: 'I understand' }).locator('input').check();
  // the game autosaves before the write → refused, nothing written
  const before = await page.evaluate(() => localStorage.getItem('(Saved Games)fixture.saves'));
  await page.evaluate(() => document.querySelector('a[data-passage="Street"]').click());
  await page.locator('saveforge-trainer .scedit input').nth(1).fill('99');
  await go.click();
  await page.locator('saveforge-trainer .toast', { hasText: 'The game saved to this storage after you started' }).waitFor();
  assert.notEqual(await page.evaluate(() => localStorage.getItem('(Saved Games)fixture.saves')), before, 'only the game’s own autosave changed it');
  assert.equal(await moneyOf((await scSaves(page)).slots[0]), 28480799);
  // start again: writes, then Undo puts the storage back exactly
  await t.home();
  await t.nav('Edit SugarCube save');
  await page.locator('saveforge-trainer .sheet label', { hasText: 'Overwrite Slot 1' }).locator('input').check();
  await page.locator('saveforge-trainer .scedit input').nth(1).fill('99');
  const ack = page.locator('saveforge-trainer .sheet label', { hasText: 'I understand' }).locator('input');
  if (await ack.count()) await ack.check();
  const raw = await page.evaluate(() => localStorage.getItem('(Saved Games)fixture.saves'));
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Back up & write' }).click();
  await page.locator('saveforge-trainer .sheet h2', { hasText: 'Load the edited save' }).waitFor();
  assert.equal(await moneyOf((await scSaves(page)).slots[0]), 99);
  await page.locator('saveforge-trainer .sheet .btn', { hasText: 'Undo this write' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('(Saved Games)fixture.saves')), raw);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('SugarCube save workflow: public Save API loads it for you; the session option applies on reload and is verified after it', { skip, timeout: 60000 }, async () => {
  let { page, ctx, errors } = await openGame(`${SC_URL}?go=Shop`);
  await inject(page);
  let t = T(page);
  await t.nav('Edit SugarCube save');
  await page.locator('saveforge-trainer .scedit input').nth(1).fill('123456');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Back up & write' }).click();
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Load Slot 1 in the game now' }).click();
  await page.locator('saveforge-trainer .sheet h2', { hasText: 'Edited save loaded' }).waitFor({ timeout: 4000 });
  assert.equal(await page.evaluate(() => SugarCube.State.variables.player.money), 123456);
  assert.deepEqual(errors, []);
  await ctx.close();

  ({ page, ctx, errors } = await openGame(`${SC_URL}?hidden=1&go=Shop`));
  await inject(page);
  t = T(page);
  await t.nav('Edit SugarCube save');
  await page.locator('saveforge-trainer .sheet label', { hasText: 'session state, then reload' }).locator('input').check();
  await page.locator('saveforge-trainer .scedit input').nth(1).fill('777777');
  const ack = page.locator('saveforge-trainer .sheet label', { hasText: 'I understand' }).locator('input');
  if (await ack.count()) await ack.check();
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Back up & write' }).click();
  await Promise.all([page.waitForEvent('load'), page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Reload the page now' }).click()]);
  assert.equal(await hudMoney(page), 777777, 'the reload resumed the edited session state');
  await inject(page);
  await page.locator('saveforge-trainer .row .lbl', { hasText: 'Edited save loaded ✓' }).waitFor({ timeout: 4000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});
