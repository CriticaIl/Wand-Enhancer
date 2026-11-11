// SaveForge 2.3.5: Input Inspector on SugarCube runtimes that do not expose window.SugarCube.
//
// Reported on 2.3.4 (tukann.itch.io, passage CAH_PATRON_CODE_FORM), Passage sources:
//   tw-passagedata in this page — not available: <tw-storydata> is there but has no passages
//   SugarCube’s Story API … — not available: window.SugarCube is not exposed in SaveForge’s JavaScript world
//   the page bridge … — not available: window.SugarCube is not exposed by this game
// Stock SugarCube 2 keeps Story/State/Engine inside its wrapper function and exports only
// window.SugarCube (template/intro.js, src/sugarcube.js), and never empties <tw-storydata>: this
// runtime is customized. 2.3.4 looked only at window.SugarCube and at the page's DOM. Reproduced
// with test/fixtures/patron-code ?empty=1&private=1 (the exact three lines above on 2.3.4).
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
const hits = new Map(); // request counts per path (the game file must be read only when needed)

before(async () => {
  if (skip) return;
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.set(u.pathname, (hits.get(u.pathname) || 0) + 1);
    const p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    try {
      const f = p.endsWith('/') ? join(p, 'index.html') : p;
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }).end(readFileSync(f));
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

const DIR = '/test/fixtures/patron-code/';
const T = (page) => page.locator('saveforge-trainer');
const result = (page) => T(page).locator('.inputresult');
const sources = async (page) => (await T(page).locator('.passage-sources li').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());

async function inspect(file, query) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.addInitScript({ content: USERSCRIPT });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}${DIR}${file}${query}`);
  await page.locator('#textbox--patroncode').focus();
  await page.evaluate(() => (location.hash = '#saveforge'));
  await page.waitForFunction(() => window.__saveforgeTrainer?.openInputInspector);
  await page.evaluate(() => window.__saveforgeTrainer.openInputInspector());
  const path = `${DIR}${file}`;
  const before = hits.get(path) || 0;
  const state0 = await page.evaluate(() => window.__state());
  await T(page).locator('.btn.findanswers').click();
  await result(page).waitFor({ timeout: 10000 });
  await page.waitForTimeout(200);
  return { ctx, page, errors, state0, fileReads: (hits.get(path) || 0) - before };
}
async function readOnly(page, state0) {
  assert.equal(await page.evaluate(() => window.__rendered + window.__getUnknown + window.__events), 0, 'no passage run, no unconfirmed get(), no event');
  assert.equal(await page.evaluate(() => window.__state()), state0, 'State unchanged');
}

test('the reported state (empty <tw-storydata>, no SugarCube global): the same first diagnostic, then the passages from the game’s own file', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors, state0, fileReads } = await inspect('', '?empty=1&private=1');
  const src = await sources(page);
  assert.equal(src[0], 'tw-passagedata in this page — not available: <tw-storydata> is there but has no passages', 'the first line of the screenshot');
  assert.match(src[1], /Story API.*not available: window\.SugarCube\.Story: not present; window\.Story: not present; window\.tale \(SugarCube 1\): not present/);
  assert.match(src[2], /page agent.*not available: window\.SugarCube\.Story: not present/);
  assert.match(src[3], /game’s HTML file.*used: same story \(ifid C0FFEE00-0000-4000-8000-000000000004\), 4 passages/);
  assert.deepEqual((await result(page).locator('.answer-value').allInnerTexts()).sort(), ['BACKER2025', 'GOLDEN-KEY', 'letmein']);
  assert.match(await result(page).innerText(), /a real SugarCube passage: “CAH_PATRON_CODE_FORM” \(in the game’s own file, same story\)/);
  assert.ok(fileReads <= 1, `the game file is read at most once (0 when the browser cache has it): ${fileReads}`);
  await readOnly(page, state0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a customized runtime that exposes Story as a page global: verified, then used (no file read)', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors, state0, fileReads } = await inspect('', '?empty=1&private=1&globalstory=1');
  const src = await sources(page);
  assert.match(src[1], /Story API.*used: window\.Story/);
  assert.deepEqual((await result(page).locator('.answer-value').allInnerTexts()).sort(), ['BACKER2025', 'GOLDEN-KEY', 'letmein']);
  assert.equal(fileReads, 0);
  await readOnly(page, state0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a window.Story that is not SugarCube’s is never called or trusted', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors, state0 } = await inspect('', '?empty=1&private=1&fakestory=1');
  const src = await sources(page);
  assert.match(src[1], /window\.Story: present, but not shaped like SugarCube’s Story API.*not called/);
  assert.equal(await page.evaluate(() => window.__fakeCalls), 0, 'its has()/get() were never called');
  assert.ok(!(await result(page).innerText()).includes('not a passage'));
  await readOnly(page, state0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the game file itself has no passages (packed): “Answer not found”, with what the file holds and why', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors, state0 } = await inspect('packed.html', '?private=1');
  const text = await result(page).innerText();
  assert.match(text, /Answer not found/);
  const src = await sources(page);
  assert.match(src[src.length - 1], /game’s HTML file.*not available: the file’s <tw-storydata> has no passages either; it has 1 large script\(s\).*text\/x-packed.*does not decode or run/);
  const rt = await T(page).locator('.sc-runtime').innerText();
  assert.match(rt, /customized SugarCube runtime: its script .* does not contain SugarCube’s usual window\.SugarCube export/);
  assert.match(rt, /SugarCube 2\.37\.3/);
  assert.match(rt, /script ×1/);
  assert.equal(await result(page).locator('.answer').count(), 0, 'nothing guessed');
  await readOnly(page, state0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('SaveForge isolated from the page: the page agent does the same verified lookup', { skip, timeout: 60000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}${DIR}?empty=1&private=1&globalstory=1`);
  const cdp = await ctx.newCDPSession(page);
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'saveforge-isolated' });
  const inWorld = (expression) => cdp.send('Runtime.evaluate', { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true });
  await inWorld(USERSCRIPT);
  assert.equal((await inWorld('typeof window.Story')).result.value, 'undefined', 'the isolated world cannot see the page’s window.Story');
  await inWorld('window.__saveforgeUserscript.openHere(); window.__saveforgeTrainer.openInputInspector(); 1');
  await T(page).locator('.btn.findanswers').click();
  await result(page).waitFor({ timeout: 10000 });
  const src = await sources(page);
  assert.match(src.find((x) => /page agent/.test(x)), /used: window\.Story/);
  assert.deepEqual((await result(page).locator('.answer-value').allInnerTexts()).sort(), ['BACKER2025', 'GOLDEN-KEY', 'letmein']);
  assert.equal(await page.evaluate(() => window.__rendered + window.__getUnknown + window.__events), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the reported state inside a cross-origin game frame (itch.io serves HTML games from another host): the frame reads its own file', { skip, timeout: 60000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.addInitScript({ content: USERSCRIPT });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const gameUrl = `${base.replace('127.0.0.1', 'localhost')}${DIR}?empty=1&private=1`;
  await page.goto(`${base}/test/fixtures/twin/frames.html?a=${encodeURIComponent(gameUrl)}`);
  let frame = null;
  for (let i = 0; i < 80 && !frame; i++) {
    frame = page.frames().find((f) => f.url().includes('/patron-code/'));
    if (!frame) await page.waitForTimeout(100);
  }
  await frame.waitForFunction(() => !!window.__saveforgeUserscript);
  await frame.evaluate(() => window.__saveforgeUserscript.openHere());
  await frame.evaluate(() => window.__saveforgeTrainer.openInputInspector());
  await frame.locator('saveforge-trainer .btn.findanswers').click();
  await frame.locator('saveforge-trainer .inputresult .answer-value').first().waitFor({ timeout: 10000 });
  assert.deepEqual((await frame.locator('saveforge-trainer .inputresult .answer-value').allInnerTexts()).sort(), ['BACKER2025', 'GOLDEN-KEY', 'letmein']);
  const src = (await frame.locator('saveforge-trainer .passage-sources li').allInnerTexts()).join('\n');
  assert.match(src, /game’s HTML file.*used: same story/);
  assert.equal(await frame.evaluate(() => window.__rendered + window.__getUnknown + window.__events), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});
