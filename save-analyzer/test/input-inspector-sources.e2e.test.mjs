// SaveForge 2.3.4: Input Inspector on a SugarCube story whose passage data is not in the page.
//
// Reported on 2.3.3 (mopoga.com): textbox "textbox--patroncode" in passage CAH_PATRON_CODE_FORM →
// "Answer not found — The source of passage CAH_PATRON_CODE_FORM is not in the page
// (tw-passagedata)". SaveForge read passages ONLY from <tw-passagedata>. A story can remove that
// element after loading (or add passages with Story.add); SugarCube still has every passage,
// readable with Story.has(name) / Story.get(name).text. Fixture: test/fixtures/patron-code.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { sugarCubeSlugs } from '../src/trainer/input-inspector.js';

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
  browser = await playwright.chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

const PAGE = '/test/fixtures/patron-code/';
const T = (page) => page.locator('saveforge-trainer');
const result = (page) => T(page).locator('.inputresult');

/** The userscript in the page's own world (Userscripts with @inject-into page). */
async function openPageWorld(query = '') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.addInitScript({ content: USERSCRIPT });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}${PAGE}${query}`);
  await page.locator('#textbox--patroncode').focus();
  await page.evaluate(() => (location.hash = '#saveforge'));
  await page.waitForFunction(() => window.__saveforgeTrainer?.openInputInspector);
  await page.evaluate(() => window.__saveforgeTrainer.openInputInspector());
  return { ctx, page, errors };
}
async function find(page) {
  const state0 = await page.evaluate(() => window.__state());
  await T(page).locator('.btn.findanswers').click();
  await result(page).waitFor({ timeout: 10000 });
  return state0;
}
async function assertReadOnly(page, state0) {
  assert.equal(await page.evaluate(() => window.__rendered), 0, 'no passage code was run (render/processText)');
  assert.equal(await page.evaluate(() => window.__getUnknown), 0, 'Story.get was never called for a passage Story.has did not confirm');
  assert.equal(await page.evaluate(() => window.__state()), state0, 'State unchanged');
  assert.equal(await page.evaluate(() => window.__events), 0, 'no event dispatched into the page');
}

test('slug: "textbox--patroncode" is SugarCube’s name for the temporary variable _patronCode', () => {
  assert.ok(sugarCubeSlugs('_patronCode').includes('-patroncode'));
});

test('the reported case: passage data removed from the page → read through SugarCube’s Story API, read-only', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await openPageWorld();
  assert.equal(await page.locator('tw-storydata').count(), 0, 'the story removed its passage data (as on the reported game)');
  const state0 = await find(page);
  const answers = await result(page).locator('.answer-value').allInnerTexts();
  assert.deepEqual(answers.sort(), ['BACKER2025', 'GOLDEN-KEY', 'letmein'], `answers from the passage, the passage it goes to, and the widget: ${answers}`);
  const text = await result(page).innerText();
  assert.match(text, /_patronCode/);
  assert.match(text, /CAH_PATRON_CODE_FORM/);
  const golden = result(page).locator('.answer', { hasText: 'GOLDEN-KEY' });
  assert.match(await golden.innerText(), /letter case does not matter \(the game uppercases/);
  assert.match(await golden.locator('.evidence summary').innerText(), /passage “CAH_PATRON_CODE_FORM”/);
  assert.match(await golden.innerText(), /goes to passage “CAH_PATRON_THANKS”/);
  // which source was used, and why the others were not
  const src = await T(page).locator('.passage-sources').innerText();
  assert.match(src, /tw-passagedata.*not in this page/i);
  assert.match(src, /Story API.*used: window\.SugarCube\.Story/i);
  assert.match(text, /a real SugarCube passage/i, 'the textbox is confirmed as part of a SugarCube passage');
  await assertReadOnly(page, state0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('no passage data in the page and no SugarCube API: each source says why, and (2.3.5) the game’s own file still has the passages', { skip, timeout: 60000 }, async () => {
  // 2.3.4 ended here with "Answer not found". The story removed its passages from the PAGE only;
  // its file still has them (the genuinely unreadable case — passages packed in the file — is
  // tested in input-inspector-runtime.e2e.test.mjs)
  const { ctx, page, errors } = await openPageWorld('?private=1');
  const state0 = await find(page);
  const src = await T(page).locator('.passage-sources').innerText();
  assert.match(src, /tw-passagedata.*not in this page/i);
  assert.match(src, /window\.SugarCube\.Story: not present; window\.Story: not present/i);
  assert.match(src, /game’s HTML file.*used: same story/i);
  assert.deepEqual((await result(page).locator('.answer-value').allInnerTexts()).sort(), ['BACKER2025', 'GOLDEN-KEY', 'letmein']);
  await assertReadOnly(page, state0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the passage data is in the page: read from tw-passagedata, as before', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await openPageWorld('?keepdata=1');
  const state0 = await find(page);
  assert.deepEqual((await result(page).locator('.answer-value').allInnerTexts()).sort(), ['BACKER2025', 'GOLDEN-KEY', 'letmein']);
  assert.match(await T(page).locator('.passage-sources').innerText(), /tw-passagedata.*used/i);
  await assertReadOnly(page, state0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('SaveForge isolated from the page (extension world): passages read through the page bridge', { skip, timeout: 60000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}${PAGE}`);
  const cdp = await ctx.newCDPSession(page);
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'saveforge-isolated' });
  const inWorld = (expression) => cdp.send('Runtime.evaluate', { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true });
  await inWorld(USERSCRIPT);
  assert.equal((await inWorld('typeof window.SugarCube')).result.value, 'undefined', 'the isolated world cannot see window.SugarCube');
  await inWorld('window.__saveforgeUserscript.openHere(); window.__saveforgeTrainer.openInputInspector(); 1');
  const state0 = await page.evaluate(() => window.__state());
  await T(page).locator('.btn.findanswers').click();
  await result(page).waitFor({ timeout: 10000 });
  const answers = await result(page).locator('.answer-value').allInnerTexts();
  assert.deepEqual(answers.sort(), ['BACKER2025', 'GOLDEN-KEY', 'letmein']);
  assert.match(await T(page).locator('.passage-sources').innerText(), /page agent.*used: window\.SugarCube\.Story/i);
  await assertReadOnly(page, state0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the story in a cross-origin game frame (a portal like mopoga.com): inspected inside that frame', { skip, timeout: 60000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.addInitScript({ content: USERSCRIPT });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const gameUrl = `${base.replace('127.0.0.1', 'localhost')}${PAGE}`; // another origin than the portal
  await page.goto(`${base}/test/fixtures/twin/frames.html?a=${encodeURIComponent(gameUrl)}`);
  let frame = null;
  for (let i = 0; i < 80 && !frame; i++) {
    frame = page.frames().find((f) => f.url().includes('/patron-code/'));
    if (!frame) await page.waitForTimeout(100);
  }
  await frame.waitForFunction(() => !!window.__saveforgeUserscript);
  await page.waitForTimeout(2000); // the game frame reports itself to the portal page
  await page.evaluate(() => (location.hash = '#saveforge')); // opened from the portal page
  await frame.waitForFunction(() => window.__saveforgeTrainer?.openInputInspector, null, { timeout: 15000 });
  assert.equal(await page.locator('saveforge-trainer').count(), 0, 'not opened on the portal page');
  await frame.evaluate(() => window.__saveforgeTrainer.openInputInspector());
  const state0 = await frame.evaluate(() => window.__state());
  await frame.locator('saveforge-trainer .btn.findanswers').click();
  await frame.locator('saveforge-trainer .inputresult .answer-value').first().waitFor({ timeout: 10000 });
  assert.deepEqual((await frame.locator('saveforge-trainer .inputresult .answer-value').allInnerTexts()).sort(), ['BACKER2025', 'GOLDEN-KEY', 'letmein']);
  assert.equal(await frame.evaluate(() => window.__rendered + window.__getUnknown + window.__events), 0);
  assert.equal(await frame.evaluate(() => window.__state()), state0);
  assert.deepEqual(errors, []);
  await ctx.close();
});
