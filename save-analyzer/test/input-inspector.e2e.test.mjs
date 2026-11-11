// SaveForge 2.3.3: the Input Inspector in the floating trainer, with the built userscript.
// Manual only (Find Answers), the chooser, answers with evidence and Copy, "Answer not found",
// login fields never listed, the game's textbox never changed and nothing submitted.
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
  browser = await playwright.chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function open(path) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await ctx.addInitScript(() => {
    // counts focusin listeners on the page's document (SaveForge must remove its own on close)
    const add = Document.prototype.addEventListener;
    const remove = Document.prototype.removeEventListener;
    window.__focusin = 0;
    Document.prototype.addEventListener = function (t, ...a) {
      if (t === 'focusin') window.__focusin++;
      return add.call(this, t, ...a);
    };
    Document.prototype.removeEventListener = function (t, ...a) {
      if (t === 'focusin') window.__focusin--;
      return remove.call(this, t, ...a);
    };
  });
  await ctx.addInitScript({ content: USERSCRIPT });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}${path}`);
  await page.evaluate(() => (location.hash = '#saveforge'));
  await page.locator('saveforge-trainer').waitFor({ state: 'attached' });
  await page.waitForFunction(() => window.__saveforgeTrainer?.inputInspectorRuns);
  return { ctx, page, errors };
}
const T = (page) => page.locator('saveforge-trainer');
async function openInspector(page) {
  await page.evaluate(() => window.__saveforgeTrainer.openInputInspector());
  await T(page).locator('.btn.findanswers').waitFor();
}
const findAnswers = (page) => T(page).locator('.btn.findanswers').click();
const result = (page) => T(page).locator('.inputresult');

test('SugarCube: nothing runs on focus or typing; Find Answers inspects the textbox you tapped, with evidence and Copy', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await open('/test/fixtures/riddle-story/');
  // using the game's textbox: tap, type, change — the inspector never runs on its own
  // (the open panel covers the page on a phone-sized screen: focus it like a tap, type with the keyboard)
  await page.locator('#textbox-answer').focus();
  await page.keyboard.type('my guess');
  await page.locator('#textbox-answer').evaluate((el) => el.dispatchEvent(new Event('change'))); // what leaving the box does (the test's own event)
  await page.evaluate(() => (window.__events = 0));
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__saveforgeTrainer.inputInspectorRuns()), 0, 'no inspection on focus or typing');
  await openInspector(page);
  assert.equal(await page.evaluate(() => window.__saveforgeTrainer.inputInspectorRuns()), 0, 'opening the section does not inspect either');
  await findAnswers(page);
  await result(page).waitFor({ timeout: 8000 });
  const text = await result(page).innerText();
  assert.match(text, /Textbox: textbox-answer/i);
  assert.match(text, /SugarCube/);
  assert.match(text, /\$answer/);
  assert.match(text, /\$gateOpen/, 'the variable the right answer sets is shown as connected');
  assert.match(text, /my guess/, 'its value in the game (State) is shown: the game stored what was typed');
  const answers = await result(page).locator('.answer-value').allInnerTexts();
  assert.deepEqual(answers, ['swordfish', 'Swordfish!']);
  const first = result(page).locator('.answer').first();
  assert.match(await first.innerText(), /letter case does not matter/);
  assert.match(await first.innerText(), /spaces at the start and end are ignored/);
  assert.match(await first.innerText(), /goes to passage “Vault”/);
  assert.match(await first.locator('.evidence summary').innerText(), /passage “Check” \(the textbox goes there\), line 1/);
  assert.match(await first.locator('.evidence pre').textContent(), /\$answer\.toLowerCase\(\)\.trim\(\) is "swordfish"/);
  await first.locator('.btn.copy').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'swordfish', 'Copy puts the answer on the clipboard');
  // the game is untouched
  assert.equal(await page.locator('#textbox-answer').inputValue(), 'my guess', 'the textbox still has your text');
  assert.equal(await page.evaluate(() => window.__events), 0, 'SaveForge dispatched no input/change/submit/click into the page');
  assert.equal(await page.evaluate(() => !!window.__submitted), false);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('several textboxes: you choose; login fields are never listed; "Answer not found" instead of a guess', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await open('/test/fixtures/riddle-story/?private=1');
  await openInspector(page);
  await findAnswers(page);
  const choices = T(page).locator('.btn.choice');
  await choices.first().waitFor();
  const labels = await choices.allInnerTexts();
  assert.equal(labels.length, 2, `the two story textboxes only: ${labels}`);
  assert.ok(labels.every((l) => /textbox-(answer|hero)/.test(l) && /SugarCube/.test(l)));
  assert.ok(!labels.some((l) => /User name|username|pw/i.test(l)), 'the login form is not offered');
  assert.match(await T(page).locator('.sheet.inputs').innerText(), /2 field\(s\) on this page were not inspected: login, password/);
  await choices.filter({ hasText: 'textbox-hero' }).click();
  await result(page).waitFor({ timeout: 8000 });
  const t = await result(page).innerText();
  assert.match(t, /Answer not found/);
  assert.match(t, /never compares \$hero with a fixed text/);
  assert.equal(await result(page).locator('.answer').count(), 0, 'nothing is guessed');
  // a story that keeps State private: the answer is still found from its passages
  await T(page).locator('.btn', { hasText: 'Inspect another textbox' }).click();
  await choices.filter({ hasText: 'textbox-answer' }).click();
  await result(page).locator('.answer-value').first().waitFor({ timeout: 8000 });
  assert.equal(await result(page).locator('.answer-value').first().innerText(), 'swordfish');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('plain HTML game: the check in a named function is found; code a page cannot see gives "Answer not found"', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await open('/test/fixtures/riddle-html/');
  await page.locator('#ans').focus();
  await openInspector(page);
  await findAnswers(page);
  await result(page).waitFor({ timeout: 8000 });
  assert.deepEqual(await result(page).locator('.answer-value').allInnerTexts(), ['echo']);
  const a = await result(page).locator('.answer').first().innerText();
  assert.match(a, /letter case does not matter/);
  assert.match(await result(page).locator('.evidence summary').first().innerText(), /function check\(\)/);
  // another textbox, with a listener added by addEventListener: not readable by a page
  await T(page).locator('.btn', { hasText: 'Inspect another textbox' }).click();
  await T(page).locator('.btn.choice', { hasText: 'Secret word' }).click();
  await result(page).locator('.answer-not-found').waitFor({ timeout: 8000 });
  assert.match(await result(page).innerText(), /addEventListener are invisible to a web page/);
  assert.equal(await page.evaluate(() => window.__events), 0);
  assert.equal(await page.evaluate(() => !!window.solved || !!window.found), false, 'the game’s checks were never run');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Ren’Py: the conditions after renpy.input, read through Ren’Py’s channel', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await open('/test/fixtures/renpy-web/?input=1');
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  await T(page).locator('.row').first().waitFor({ timeout: 10000 });
  await openInspector(page);
  await findAnswers(page);
  await result(page).waitFor({ timeout: 10000 });
  assert.deepEqual(await result(page).locator('.answer-value').allInnerTexts(), ['swordfish']);
  const t = await result(page).innerText();
  assert.match(t, /Ren'Py is waiting in game\/script\.rpy:40/);
  assert.match(t, /answer = answer\.strip\(\)\.lower\(\)/, 'the normalisation before the check is shown');
  assert.match(t, /jumps to vault/);
  assert.match(await result(page).locator('.evidence summary').first().innerText(), /game\/script\.rpy:43/);
  assert.equal(await page.evaluate(() => 'result' in window.__fixture.store), false, 'no store variable created');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the Input Inspector is optional: closing the trainer removes its focus listener', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await open('/test/fixtures/riddle-html/');
  const opened = await page.evaluate(() => window.__focusin);
  assert.ok(opened >= 1, 'a focus listener while the trainer is open');
  await T(page).locator('.hbtn[aria-label="Close trainer"]').click();
  await page.locator('saveforge-trainer').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__focusin), opened - 1, 'removed when the trainer closes');
  assert.deepEqual(errors, []);
  await ctx.close();
});
