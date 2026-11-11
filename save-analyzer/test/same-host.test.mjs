// SaveForge 2.3.2: two different games hosted on the same origin (a portal such as mopoga.com:
// the portal page frames games that all come from one game host, so they share localStorage).
//
// Reported on 2.3.1: after switching from one game to another, the trainer listed
// "$player.money" as a SAVE variable (a SugarCube save) next to the new game's LIVE variables
// (Takedown, Chokehold stamina). Causes found:
//   - every save of the shared storage that was not KNOWN to be another game's was merged into
//     the live source as SAVE rows, without any evidence it belonged to the running game
//   - a lone SugarCube story's saves counted as "the current story" even on a page that is not a
//     SugarCube story at all
//   - a game switch that keeps the address (same document, new game) was not noticed
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
let port;

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
  port = server.address().port;
  browser = await playwright.chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

const portal = () => `http://127.0.0.1:${port}/test/fixtures/twin/frames.html`; // the portal page
const host = () => `http://localhost:${port}`; // the game host: every game, one origin
const STORY = '/test/fixtures/sugarcube-real/';
const BRAWLER = '/test/fixtures/brawler/';

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.addInitScript({ content: USERSCRIPT });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  return { ctx, page, errors };
}
async function frameOf(page, part, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const f = page.frames().find((x) => x.url().includes(part));
    if (f) return f;
    await page.waitForTimeout(100);
  }
  throw new Error(`no frame ${part}`);
}
async function openTrainerIn(page, frame) {
  await frame.locator('saveforge-launcher .b').waitFor({ timeout: 10000 });
  await page.evaluate(() => (location.hash = '#saveforge'));
  await frame.locator('saveforge-trainer .row').first().waitFor({ timeout: 15000 });
}
/** What the trainer lists, with where each entry comes from. */
async function listing(frame) {
  return frame.evaluate(() => {
    const p = window.__saveforgeTrainer.provider();
    return p.entries.map((e) => ({ path: e.path, label: e.label, origin: e.origin || p.kind, belongs: p.belongsTo ? p.belongsTo(e.nodeId) : null }));
  });
}
async function close(frame) {
  await frame.locator('saveforge-trainer .hbtn[aria-label="Close trainer"]').click();
  await frame.locator('saveforge-trainer').waitFor({ state: 'detached' });
}
const playStory = async (page, story = '') => {
  // the story autosaves on every passage, like SugarCube
  await page.evaluate((u) => window.swapTo(u), `${host()}${STORY}?go=Shop,Street${story ? `&story=${story}` : ''}`);
  const f = await frameOf(page, '/sugarcube-real/');
  await f.waitForFunction(() => Object.keys(localStorage).some((k) => /^\(Saved Games\).*\.saves$/.test(k)));
  return f;
};

// ---------------------------------------------------------------- the reported case
for (const openedBefore of [false, true]) {
  test(`a SugarCube story, then a brawler from the same game host${openedBefore ? ' (SaveForge also opened in the story)' : ''}: only the brawler's variables`, { skip, timeout: 90000 }, async () => {
    const { ctx, page, errors } = await newPage();
    await page.goto(`${portal()}?a=${encodeURIComponent(`${host()}${BRAWLER}?first=1`)}`);
    await frameOf(page, '/brawler/');
    const story = await playStory(page);
    if (openedBefore) {
      await openTrainerIn(page, story);
      await close(story);
    }
    await page.evaluate((u) => window.swapTo(u), `${host()}${BRAWLER}`);
    const brawler = await frameOf(page, '/brawler/');
    await brawler.evaluate(() => window.brawlerSave()); // the brawler has a save of its own
    await openTrainerIn(page, brawler);
    await brawler.waitForTimeout(2500); // saves are read after the live list
    const rows = await listing(brawler);
    assert.ok(rows.some((r) => /takedown/i.test(r.path)), 'the brawler’s live variables');
    assert.ok(!rows.some((r) => /money|\$|Saved Games/.test(`${r.path} ${r.label}`)), `nothing from the SugarCube story: ${rows.filter((r) => /money|\$/.test(r.path + r.label)).map((r) => `${r.path} (${r.origin})`).join(', ')}`);
    const d = await brawler.evaluate(async () => {
      const x = await window.__saveforgeTrainer.diagnosticsData();
      return { engines: x.engines.map((e) => e.id), foreign: x.saveOwners.foreign.map((f) => `${f.name} → ${f.ownerTitle}`) };
    });
    assert.ok(!d.engines.includes('sugarcube'), `no SugarCube engine on the brawler page: ${d.engines}`);
    assert.ok(d.foreign.some((f) => /\(Saved Games\)fixture\.saves/.test(f) && /SugarCube/.test(f)), `the story’s save is listed as another game’s: ${d.foreign}`);
    // Saves in storage: the brawler's save, never the story's
    await brawler.locator('saveforge-trainer .chip', { hasText: 'Saves in storage' }).click();
    await brawler.waitForFunction(() => window.__saveforgeTrainer.state().sourceId === 'storage' && window.__saveforgeTrainer.provider()?.kind === 'storage');
    const keys = await brawler.evaluate(() => Object.keys(window.__saveforgeTrainer.provider().dump.localStorage));
    assert.ok(keys.includes('cagebrawler_save'));
    assert.ok(!keys.some((k) => /Saved Games/.test(k)), `story saves not offered: ${keys}`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('two SugarCube stories on the same game host: each sees only its own saves', { skip, timeout: 90000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${portal()}?a=${encodeURIComponent(`${host()}${BRAWLER}`)}`);
  await playStory(page); // story "fixture"
  const b = await playStory(page, 'other'); // story "other", same origin
  await openTrainerIn(page, b);
  await b.waitForTimeout(2500);
  const rows = await listing(b);
  const saveRows = rows.filter((r) => r.origin === 'save' || r.origin === 'live+save');
  assert.ok(saveRows.length, 'the story’s own save is linked');
  const saveDetail = (r) => (r.origin === 'save' ? r.belongs.detail : r.belongs.save?.detail || '');
  assert.ok(saveRows.every((r) => /\(Saved Games\)other\.saves/.test(saveDetail(r))), `every save row is from this story’s save: ${saveRows.map(saveDetail).filter((d) => !/other\.saves/.test(d)).slice(0, 2)}`);
  const d = await b.evaluate(async () => (await window.__saveforgeTrainer.diagnosticsData()).saveOwners.foreign.map((f) => f.name));
  assert.ok(d.includes('(Saved Games)fixture.saves'), `the first story’s saves are another game’s: ${d}`);
  assert.ok(!d.includes('(Saved Games)other.saves'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a game switch without an address change (same document): the trainer moves to the new game', { skip, timeout: 90000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${host()}/test/fixtures/arcade/?game=quest`);
  await page.evaluate(() => (location.hash = '#saveforge'));
  await page.locator('saveforge-trainer .row').first().waitFor({ timeout: 15000 });
  const before = await page.evaluate(() => window.__saveforgeTrainer.state().contextId);
  assert.ok((await listing(page)).some((r) => /gold/.test(r.path)));
  await page.evaluate(() => window.loadGame('brawler'));
  await page.waitForFunction((b) => window.__saveforgeTrainer?.state?.().contextId && window.__saveforgeTrainer.state().contextId !== b, before, { timeout: 15000 });
  await page.waitForFunction(() => window.__saveforgeTrainer?.provider?.()?.entries?.some((e) => /takedown/i.test(e.path)), null, { timeout: 15000 });
  const rows = await listing(page);
  assert.ok(!rows.some((r) => /gold|potions/.test(r.path)), 'nothing of the previous game');
  const g = await page.evaluate(async () => (await window.__saveforgeTrainer.diagnosticsData()).game);
  assert.match(g.reason, /switched|changed/i, 'Diagnostics says why');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('same document, and the previous game left its object behind: it is kept out of the new game', { skip, timeout: 90000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${host()}/test/fixtures/arcade/?game=quest&keep=1`);
  await page.evaluate(() => (location.hash = '#saveforge'));
  await page.locator('saveforge-trainer .row').first().waitFor({ timeout: 15000 });
  const before = await page.evaluate(() => window.__saveforgeTrainer.state().contextId);
  await page.evaluate(() => window.loadGame('brawler'));
  await page.waitForFunction((b) => window.__saveforgeTrainer?.state?.().contextId && window.__saveforgeTrainer.state().contextId !== b, before, { timeout: 15000 });
  await page.waitForFunction(() => window.__saveforgeTrainer?.provider?.()?.entries?.some((e) => /takedown/i.test(e.path)), null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => typeof window.quest), 'object', 'the old object is still on the page');
  const rows = await listing(page);
  assert.ok(!rows.some((r) => /gold|potions/.test(r.path)), `the left-over object is not listed: ${rows.map((r) => r.path).join(', ')}`);
  const excl = await page.evaluate(async () => (await window.__saveforgeTrainer.diagnosticsData()).globals.filter((g) => g.name === 'quest').map((g) => g.reasons.join('; ')));
  assert.match(excl.join(''), /previous game/, 'Diagnostics says why it is excluded');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('saves whose game cannot be confirmed: never merged into live variables, not written unless you confirm', { skip, timeout: 90000 }, async () => {
  const { ctx, page, errors } = await newPage();
  // SaveForge has seen two games on this host (the story, then the brawler)…
  await page.goto(`${portal()}?a=${encodeURIComponent(`${host()}${BRAWLER}`)}`);
  const story = await playStory(page);
  await openTrainerIn(page, story);
  await close(story);
  await page.evaluate((u) => window.swapTo(u), `${host()}${BRAWLER}`);
  const b = await frameOf(page, '/brawler/');
  // …and the shared storage holds a save no game can be matched to
  await b.evaluate(() => localStorage.setItem('slot1', JSON.stringify({ hp: 55, level: 9 })));
  await openTrainerIn(page, b);
  await b.waitForTimeout(2500);
  assert.ok(!(await listing(b)).some((r) => r.origin === 'save' || r.origin === 'live+save'), 'no unconfirmed save in the live list');
  await b.locator('saveforge-trainer .chip', { hasText: 'Saves in storage' }).click();
  await b.waitForFunction(() => window.__saveforgeTrainer.provider()?.kind === 'storage');
  const r = await b.evaluate(() => {
    const p = window.__saveforgeTrainer.provider();
    const e = p.entries.find((x) => /level/.test(x.path));
    return { belongs: p.belongsTo(e.nodeId) };
  });
  assert.equal(r.belongs.state, 'unverified');
  assert.match(r.belongs.detail, /not confirmed/i);
  // writing it: refused unless you confirm it is this game's save
  const w = await b.evaluate(async () => {
    const p = window.__saveforgeTrainer.provider();
    const e = p.entries.find((x) => /level/.test(x.path));
    p.set([{ id: e.nodeId, value: 10 }]);
    try {
      await p.applyAndReload({ reload: false });
      return 'written';
    } catch (err) {
      return err.message;
    }
  });
  assert.match(w, /not confirmed/i);
  assert.equal(await b.evaluate(() => JSON.parse(localStorage.getItem('slot1')).level), 9, 'nothing written');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('every variable says which game and frame it comes from', { skip, timeout: 90000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${portal()}?a=${encodeURIComponent(`${host()}${BRAWLER}`)}`);
  const b = await frameOf(page, '/brawler/');
  await b.evaluate(() => window.brawlerSave());
  await openTrainerIn(page, b);
  await b.waitForTimeout(2500);
  const rows = await listing(b);
  const live = rows.find((r) => /takedown/i.test(r.path));
  assert.equal(live.belongs.state, 'current');
  assert.match(live.belongs.detail, /iframe, depth 1/);
  assert.match(live.belongs.detail, /Cage Brawler/);
  const saved = rows.find((r) => r.origin === 'save' || r.origin === 'live+save');
  assert.ok(saved, 'the brawler’s own save is linked');
  assert.match(saved.belongs.detail, /cagebrawler_save/);
  const vs = await b.evaluate(async () => (await window.__saveforgeTrainer.diagnosticsData()).sources);
  assert.ok(vs.live.some((x) => x.root === 'fight'), 'Diagnostics lists the live roots');
  assert.ok(vs.saves.some((x) => x.name === 'cagebrawler_save' && x.state === 'mine'));
  assert.deepEqual(errors, []);
  await ctx.close();
});
