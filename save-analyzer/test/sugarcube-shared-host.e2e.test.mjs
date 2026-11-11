// SaveForge 2.3.6 regression: SugarCube save variables missing on a website hosting several games.
//
// Reported on 2.3.5 (tukann.itch.io): the main menu showed only generic page state ("Partial:
// generic page state", LIVE* 7/16); the SugarCube variables found and edited in earlier versions
// were gone. Reproduced with tools/compare-versions.mjs: 2.3.1 lists the story's 10 SAVE values,
// 2.3.2–2.3.5 list none. Cause: on a shared origin (itch.io serves every HTML game from one host)
// SaveForge has seen several games, and a story that keeps window.SugarCube private and uses its
// own save id (not its title) could not be identified, so its own save was "not confirmed" and,
// since 2.3.2, never merged. 2.3.6 identifies the running story by its session playthrough
// ("(Saved Games)<id>.state") being at the passage on screen; another story's saves stay excluded.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;
// SAVEFORGE_USERSCRIPT=<older build> runs these tests against a release (they fail on 2.3.2–2.3.5)
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
let requests = [];

before(async () => {
  if (skip) return;
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
  server = createServer((req, res) => {
    requests.push(req.url);
    const p = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
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

const STORY = '/test/fixtures/sugarcube-real/';

async function openTrainer(page) {
  await page.evaluate(() => (location.hash = '#saveforge'));
  await page.waitForFunction(() => window.__saveforgeTrainer?.provider?.()?.entries?.length > 0, null, { timeout: 20000 });
  // saves are read and merged in the background after the live list
  await page.waitForFunction(() => (window.__saveforgeTrainer.provider().entries || []).some((e) => e.origin === 'save') || window.__saveforgeTrainer.provider().heldBack, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
}
function snapshot(page) {
  return page.evaluate(() => {
    const p = window.__saveforgeTrainer.provider();
    const rows = p.entries.map((e) => ({ path: String(e.path), origin: e.origin || p.kind, label: e.label, nodeId: e.nodeId }));
    return {
      kind: p.kind,
      live: rows.filter((x) => x.origin === 'live').map((x) => x.nodeId).sort(),
      save: rows.filter((x) => x.origin === 'save'),
      heldBack: p.heldBack,
    };
  });
}
/** Another story played (and SaveForge opened in it) first, in the same tab, then the reported one. */
async function sharedHost({ otherAt = 'Shop', cahGo = 'Shop,Street' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript({ content: USERSCRIPT });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}${STORY}?story=other&go=${otherAt}`);
  await page.waitForTimeout(500);
  await openTrainer(page);
  await page.evaluate(() => window.__saveforgeTrainer.destroy());
  await page.goto(`${base}${STORY}?hidden=1&story=cah&globals=1&go=${cahGo}`);
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}

test('shared website, story keeps SugarCube private: its own SAVE variables are listed again (as in 2.3.1), none of the other story’s', { skip, timeout: 90000 }, async () => {
  const { ctx, page, errors } = await sharedHost();
  assert.equal(await page.evaluate(() => typeof window.SugarCube), 'undefined', 'the reported state: no window.SugarCube');
  await openTrainer(page);
  const s = await snapshot(page);
  assert.equal(s.kind, 'live', 'generic page state is the live source (the reported "Partial: generic page state")');
  assert.ok(s.live.length >= 3, 'LIVE* values listed');
  assert.ok(s.save.length >= 5, `the story’s own save values are merged as SAVE rows (got ${s.save.length})`);
  assert.ok(s.save.some((x) => /money/.test(`${x.path} ${x.label}`)), '$player.money is back');
  assert.ok(s.save.every((x) => !/other\.saves/.test(x.nodeId) && /cah\.saves/.test(x.nodeId)), `nothing from the other story’s saves: ${s.save.map((x) => x.nodeId)}`);
  assert.equal(s.heldBack, null, 'nothing held back');
  const why = await page.evaluate(() => {
    const p = window.__saveforgeTrainer.provider();
    const e = p.entries.find((x) => x.origin === 'save');
    return p.saves.ownerOf(e.saveId);
  });
  assert.equal(why.state, 'mine');
  assert.match(why.why, /sessionStorage .*cah\.state.* at passage “Street”, the passage on screen/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('both playthroughs at the same passage: the story cannot be identified, its saves are held back AND the main menu says why', { skip, timeout: 90000 }, async () => {
  const { ctx, page, errors } = await sharedHost({ otherAt: 'Shop', cahGo: 'Shop' });
  await openTrainer(page);
  const s = await snapshot(page);
  assert.equal(s.save.length, 0, 'no unconfirmed save is mixed with the LIVE values');
  assert.ok(s.heldBack && s.heldBack.values > 0, 'held back values are counted');
  assert.ok(s.heldBack.saves.some((x) => /cah\.saves/.test(x.name) && /several games share/.test(x.why)), JSON.stringify(s.heldBack));
  assert.ok(s.heldBack.saves.every((x) => !/other\.saves/.test(x.name) || /not confirmed/.test(x.why)));
  const menu = await page.locator('saveforge-trainer').getByText(/Not confirmed as this game’s: \d+ save\(s\), not listed/).count();
  assert.equal(menu, 1, 'the main menu shows the held-back saves');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('one story on the website: unchanged (its SAVE variables listed)', { skip, timeout: 60000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript({ content: USERSCRIPT });
  const page = await ctx.newPage();
  await page.goto(`${base}${STORY}?hidden=1&story=cah&globals=1&go=Shop,Street`);
  await page.waitForTimeout(500);
  await openTrainer(page);
  const s = await snapshot(page);
  assert.ok(s.save.some((x) => /money/.test(`${x.path} ${x.label}`)));
  await ctx.close();
});

test('Input Inspector does not touch the main scan: same variables with it, and no game-file fetch or page agent until Find Answers', { skip, timeout: 90000 }, async () => {
  const { ctx, page, errors } = await sharedHost();
  requests = [];
  await openTrainer(page);
  const before = await snapshot(page);
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-saveforge-psg2-agent]').length), 0, 'no passage agent installed by the scan');
  assert.equal(await page.evaluate(() => window.__saveforgeTrainer.debug?.().inputInspectorRuns ?? window.__saveforgeTrainer.inputInspectorRuns?.() ?? 0), 0, 'Input Inspector has not run');
  assert.ok(!requests.some((u) => u.includes('/sugarcube-real/') && !/\.js$/.test(u)), `the game file was not fetched by SaveForge: ${requests}`);
  // open and close the Input Inspector view without pressing Find Answers
  await page.evaluate(() => window.__saveforgeTrainer.openInputInspector());
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__saveforgeTrainer.rescan?.());
  await page.waitForTimeout(1500);
  const after = await snapshot(page);
  assert.deepEqual(after.live, before.live, 'the same LIVE variables');
  assert.equal(after.save.length, before.save.length, 'the same SAVE variables');
  assert.deepEqual(errors, []);
  await ctx.close();
});
