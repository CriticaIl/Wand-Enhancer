// SaveForge 2.3.7: Diagnostics → "Saves found in storage" (the 2.3.6 report: SugarCube variables
// still missing on tukann.itch.io, with no explanation on screen).
//
// One mechanism reproduced (tools/compare-versions.mjs new-upload-plain) that gives exactly that
// screen: itch.io serves each upload of a game under its own path (/html/<upload id>/). SaveForge
// recorded the save as written by the game at the OLD path; after a new upload the same game has
// another game key, so its own save is classified as ANOTHER game's save (same title) and removed
// before anything is counted. 2.3.1 listed it (a lone story counted as the running one before the
// stored record was consulted). Whether this is what happens on the real game is NOT known: the
// report below is what the iPhone has to show. These tests only check that the report tells the
// truth; listing behaviour is unchanged in 2.3.7.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;
const USERSCRIPT = readFileSync(process.env.SAVEFORGE_USERSCRIPT || join(ROOT, 'standalone/saveforge-trainer.user.js'), 'utf8');
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
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/html\/\d+\//, '/test/fixtures/sugarcube-real/');
    const p = normalize(join(ROOT, pathname));
    try {
      const f = p.endsWith('/') ? join(p, 'index.html') : p;
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(f));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${server.address().port}`;
  browser = await playwright.chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function openTrainer(page) {
  await page.evaluate(() => (location.hash = '#saveforge'));
  await page.waitForFunction(() => window.__saveforgeTrainer?.provider?.()?.entries?.length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(3500); // saves are read in the background
}
async function report(page) {
  await page.evaluate(() => window.__saveforgeTrainer.openDiagnostics());
  const pre = page.locator('saveforge-trainer .savesfound-text');
  await pre.waitFor({ timeout: 15000 });
  return pre.innerText();
}

test('new upload of the same game (stale owner record): the report shows the save, its $player.money, HIDDEN and why; the main menu says so', { skip, timeout: 120000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript({ content: USERSCRIPT });
  const q = '?hidden=1&story=cah&globals=1&plainpassage=1';
  const day1 = await ctx.newPage();
  await day1.goto(`${base}/html/1111/${q}&go=Shop`);
  await day1.waitForTimeout(500);
  await openTrainer(day1);
  await day1.evaluate(() => document.querySelector('#passages a[data-passage]').click()); // the game autosaves while SaveForge is open
  await day1.waitForTimeout(600);
  await day1.evaluate(() => window.__saveforgeTrainer.destroy());
  await day1.waitForTimeout(500);
  const page = await ctx.newPage(); // another day, another tab, a new upload
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/html/2222/${q}&go=Shop`);
  await page.waitForTimeout(500);
  await openTrainer(page);
  const saveRows = await page.evaluate(() => window.__saveforgeTrainer.provider().entries.filter((e) => e.origin === 'save').length);
  assert.equal(saveRows, 0, 'the reported screen: no SAVE rows (listing unchanged in 2.3.7)');
  assert.equal(await page.locator('saveforge-trainer').getByText(/Hidden as another game’s: 1 SugarCube save\(s\)/).count(), 1, 'the main menu says a SugarCube save is hidden');
  const text = await report(page);
  assert.match(text, /\[localStorage\] \(Saved Games\)cah\.saves \| \d+ chars \| saves bundle/);
  assert.match(text, /owner: other \(Story cah \(SugarCube\)\)/, text);
  assert.match(text, /SaveForge record: Story cah \(SugarCube\) \[http:\/\/localhost:\d+\/html\/1111\/[^\]]*\], written/, 'the stale record: the same title at the old upload path');
  assert.match(text, /shown: HIDDEN as another game’s save/);
  assert.match(text, /autosave: passage “\w+”.*\$player\.money = \d+/, `the save holds $player.money: ${text}`);
  assert.match(text, /This game: .*key http:\/\/localhost:\d+\/html\/2222\//);
  assert.match(text, /Passage on screen \(data-passage\): none found/);
  assert.match(text, /\[sessionStorage\] \(Saved Games\)cah\.state .*session state/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a save that IS listed: the report says LISTED with the row count', { skip, timeout: 60000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript({ content: USERSCRIPT });
  const page = await ctx.newPage();
  await page.goto(`${base}/test/fixtures/sugarcube-real/?hidden=1&story=cah&globals=1&go=Shop,Street`);
  await page.waitForTimeout(500);
  await openTrainer(page);
  const text = await report(page);
  assert.match(text, /\(Saved Games\)cah\.saves/);
  assert.match(text, /shown: LISTED: \d+ SAVE row\(s\)/, text);
  assert.match(text, /\$player\.money = \d+/);
  await ctx.close();
});
