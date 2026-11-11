// SaveForge 2.3: the trainer always targets the game being played, and there is only ever
// one trainer. These tests reproduce the reported problems with the BUILT userscript, injected
// into every frame like an iOS userscript manager does (Playwright addInitScript).
//
//   - two games built with the same engine on one host (itch.io serves every HTML game from one
//     origin): Game B must never show Game A's favorites, learned/hidden variables or saves
//   - single-page-app navigation (portals): a new game in the same document
//   - a portal that swaps or re-navigates its game frame
//   - several game frames, a portal page that itself looks like a game, a second SaveForge copy
//   - closing while scanning, reinjection, page restoration
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
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    // the single-page twin game: pushState addresses are served by the same page
    if (/\/twin\/play-[ab]$/.test(path)) path = path.replace(/play-[ab]$/, 'spa.html');
    try {
      const file = path.endsWith('/') ? join(path, 'index.html') : path;
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(file));
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

const base = () => `http://127.0.0.1:${port}`;
const other = () => `http://localhost:${port}`; // a different origin (cross-origin game frames)
const TWIN = '/test/fixtures/twin';

async function newPage({ instrument = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  if (instrument) {
    // counts the page's timers and listeners SaveForge leaves behind
    await ctx.addInitScript(() => {
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
    });
  }
  await ctx.addInitScript({ content: USERSCRIPT });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  return { ctx, page, errors };
}

const T = (scope) => scope.locator('saveforge-trainer');
async function openHere(page) {
  await page.evaluate(() => (location.hash = '#saveforge'));
}
async function waitRows(scope) {
  await scope.locator('saveforge-trainer .row').first().waitFor({ timeout: 15000 });
}
/** The live value of the twin game's gold, as the trainer shows it. */
async function trainerGold(frame) {
  return frame.evaluate(() => {
    const p = window.__saveforgeTrainer?.provider?.();
    if (!p || !p.entries) return null;
    const e = p.entries.find((x) => /player.*gold/.test(x.path));
    return e ? p.value(e.nodeId) : null;
  });
}
/** The count on a home-screen row (“Favorites  1 ›”), scrolling the list to reach it. */
async function homeCount(scope, label) {
  const row = scope.locator('saveforge-trainer .row', { has: scope.locator('.lbl .name', { hasText: new RegExp(`^${label}$`) }) }).first();
  for (let i = 0; i < 12 && !(await row.count()); i++) {
    await scope.locator('saveforge-trainer .list').first().evaluate((el) => (el.scrollTop = el.scrollHeight));
    await scope.waitForTimeout(150);
  }
  return Number((await row.locator('.nav').innerText()).replace(/[^0-9]/g, ''));
}
async function closeTrainer(scope) {
  await scope.locator('saveforge-trainer .hbtn[aria-label="Close trainer"]').click();
  await scope.locator('saveforge-trainer').waitFor({ state: 'detached' });
}
async function editGold(scope, value) {
  await scope.locator('saveforge-trainer .tool[aria-label="Search"]').click();
  await scope.locator('saveforge-trainer .search input').fill('gold');
  await scope.locator('saveforge-trainer .row').filter({ has: scope.locator('.name', { hasText: /gold/i }) }).first().locator('.num').click();
  await scope.locator('saveforge-trainer .sheet .field').fill(String(value));
  await scope.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  const done = scope.locator('saveforge-trainer .sheet .btn', { hasText: /^Done$/ });
  if (await done.count()) await done.first().click();
}
async function favoriteGold(scope) {
  await scope.locator('saveforge-trainer .tool[aria-label="Search"]').click();
  await scope.locator('saveforge-trainer .search input').fill('gold');
  await scope.locator('saveforge-trainer .row').filter({ has: scope.locator('.name', { hasText: /gold/i }) }).first().locator('.info').click();
  await scope.locator('saveforge-trainer .sheet .btn', { hasText: /^Favorite$/ }).click();
}
/** Every SaveForge launcher/panel that is visible, in every frame of the page. */
async function visibleCounts(page) {
  let launchers = 0;
  let panels = 0;
  for (const f of page.frames()) {
    try {
      const r = await f.evaluate(() => {
        const vis = (el) => !!el && el.style.display !== 'none' && el.isConnected;
        const l = [...document.querySelectorAll('saveforge-launcher')].filter((h) => vis(h) && h.shadowRoot && h.shadowRoot.querySelector('.b')).length;
        const p = [...document.querySelectorAll('saveforge-trainer')].filter(vis).length;
        return { l, p };
      });
      launchers += r.l;
      panels += r.p;
    } catch {
      /* frame gone */
    }
  }
  return { launchers, panels };
}
const frameWith = (page, part) => page.frames().find((f) => f.url().includes(part));
async function waitFrame(page, part, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const f = frameWith(page, part);
    if (f) return f;
    await page.waitForTimeout(100);
  }
  throw new Error(`no frame ${part}`);
}

// ---------------------------------------------------------------- Bug 2: wrong game
test('two games on one host: Game B never shows Game A’s favorites or saves', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}${TWIN}/a/`);
  await openHere(page);
  await waitRows(page);
  assert.equal(await trainerGold(page), 1111);
  await favoriteGold(page);
  await page.evaluate(() => window.twinSave()); // Game A saves while SaveForge is open
  await page.waitForTimeout(3500);
  await closeTrainer(page);

  await page.goto(`${base()}${TWIN}/b/`);
  await page.evaluate(() => window.twinSave()); // Game B has its own save
  await openHere(page);
  await waitRows(page);
  assert.equal(await trainerGold(page), 2222, 'Game B’s own value');
  assert.equal(await homeCount(page, 'Favorites'), 0, 'Game A’s favorite is not carried over to Game B');
  // the save variables: Game B’s save only, never Game A’s
  await page.waitForFunction(() => !!window.__saveforgeTrainer.provider().saveProvider?.(), null, { timeout: 8000 });
  const keys = await page.evaluate(() => Object.keys(window.__saveforgeTrainer.provider().saveProvider().dump.localStorage || {}));
  assert.ok(keys.includes('emberforge_save'), `B’s save is read: ${keys}`);
  assert.ok(!keys.includes('moonharbor_save'), `A’s save is not offered for editing in B: ${keys}`);
  // and Game A still has its favorite
  await closeTrainer(page);
  await page.goto(`${base()}${TWIN}/a/`);
  await openHere(page);
  await waitRows(page);
  assert.equal(await homeCount(page, 'Favorites'), 1, 'A keeps its own favorite');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('single-page navigation: reopening after the game changed never reuses the previous game’s scan', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}${TWIN}/spa.html?start=a`);
  await openHere(page);
  await waitRows(page);
  assert.equal(await trainerGold(page), 1111);
  await closeTrainer(page); // results are kept for a quick reopen…
  await page.evaluate(() => {
    window.__oldGame = window.game;
    window.twinSwitch('b');
  });
  await openHere(page); // …but not for another game
  await waitRows(page);
  assert.equal(await T(page).locator('.row', { hasText: /Results from/ }).count(), 0, 'no “Results from N min ago” of the previous game');
  assert.equal(await trainerGold(page), 2222);
  await editGold(page, 3333);
  assert.equal(await page.evaluate(() => window.game.player.gold), 3333, 'edit reaches Game B');
  assert.equal(await page.evaluate(() => window.__oldGame.player.gold), 1111, 'Game A’s objects are never written');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('single-page navigation while the trainer is open: it moves to the new game by itself', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}${TWIN}/spa.html?start=a`);
  await openHere(page);
  await waitRows(page);
  const before = await page.evaluate(() => window.__saveforgeTrainer.state().contextId);
  await page.evaluate(() => {
    window.__oldGame = window.game;
    window.twinSwitch('b');
  });
  await page.waitForFunction((b) => window.__saveforgeTrainer?.state?.().contextId && window.__saveforgeTrainer.state().contextId !== b, before, { timeout: 10000 });
  await waitRows(page);
  await page.waitForFunction(() => {
    const p = window.__saveforgeTrainer?.provider?.();
    const e = p?.entries?.find((x) => /player.*gold/.test(x.path));
    return e && p.value(e.nodeId) === 2222;
  }, null, { timeout: 10000 });
  assert.equal(await visibleCounts(page).then((c) => c.panels), 1, 'still exactly one panel');
  await editGold(page, 4444);
  assert.equal(await page.evaluate(() => window.game.player.gold), 4444);
  assert.equal(await page.evaluate(() => window.__oldGame.player.gold), 1111, 'the previous game is never written');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a write prepared for the previous game is refused after the game changed', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}${TWIN}/spa.html?start=a`);
  await openHere(page);
  await waitRows(page);
  // the provider of Game A, held across the switch (a stale reference, as an async callback would)
  const r = await page.evaluate(async () => {
    const p = window.__saveforgeTrainer.provider();
    const e = p.entries.find((x) => /player.*gold/.test(x.path));
    window.__oldGame = window.game;
    window.twinSwitch('b');
    try {
      p.set([{ id: e.nodeId, value: 9999 }]);
      return { ok: true, a: window.__oldGame.player.gold, b: window.game.player.gold };
    } catch (err) {
      return { ok: false, msg: err.message, a: window.__oldGame.player.gold, b: window.game.player.gold };
    }
  });
  assert.equal(r.ok, false, 'refused');
  assert.match(r.msg, /different game|game changed/i);
  assert.equal(r.a, 1111);
  assert.equal(r.b, 2222);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('portal swaps its game frame for another game: SaveForge opens the new game, not the old one', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}${TWIN}/frames.html?a=${encodeURIComponent(`${other()}${TWIN}/a/`)}`);
  const fa = await waitFrame(page, '/twin/a/');
  await fa.locator('saveforge-launcher .b').waitFor({ timeout: 8000 });
  await page.evaluate((u) => window.swapTo(u), `${other()}${TWIN}/b/`);
  const fb = await waitFrame(page, '/twin/b/');
  await fb.locator('saveforge-launcher .b').waitFor({ timeout: 8000 });
  await openHere(page); // #saveforge on the portal page routes to the game frame
  await fb.locator('saveforge-trainer .row').first().waitFor({ timeout: 10000 });
  assert.equal(await trainerGold(fb), 2222);
  assert.equal(await visibleCounts(page).then((c) => c.panels), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('portal re-navigates the same game frame: SaveForge opens the game now in it', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}${TWIN}/frames.html?a=${encodeURIComponent(`${other()}${TWIN}/a/`)}`);
  const fa = await waitFrame(page, '/twin/a/');
  await fa.locator('saveforge-launcher .b').waitFor({ timeout: 8000 });
  await page.evaluate((u) => window.navigateTo(u), `${other()}${TWIN}/b/`);
  const fb = await waitFrame(page, '/twin/b/');
  await fb.locator('saveforge-launcher .b').waitFor({ timeout: 8000 });
  await openHere(page);
  await fb.locator('saveforge-trainer .row').first().waitFor({ timeout: 10000 });
  assert.equal(await trainerGold(fb), 2222);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('two game frames: SaveForge asks which game to open, and opens that one', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}${TWIN}/frames.html?a=${encodeURIComponent(`${other()}${TWIN}/a/`)}&b=${encodeURIComponent(`${other()}${TWIN}/b/`)}`);
  const fa = await waitFrame(page, '/twin/a/');
  const fb = await waitFrame(page, '/twin/b/');
  await page.waitForTimeout(2500); // both frames detect their game
  await openHere(page);
  const chooser = page.locator('saveforge-chooser');
  await chooser.waitFor({ state: 'attached', timeout: 8000 });
  const text = await chooser.evaluate((el) => el.shadowRoot.textContent);
  assert.match(text, /Moon Harbor/);
  assert.match(text, /Ember Forge/);
  await chooser.evaluate((el) => [...el.shadowRoot.querySelectorAll('button')].find((b) => /Ember Forge/.test(b.textContent)).click());
  await fb.locator('saveforge-trainer .row').first().waitFor({ timeout: 10000 });
  assert.equal(await trainerGold(fb), 2222);
  assert.equal(await fa.locator('saveforge-trainer').count(), 0, 'nothing opened in the other game');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---------------------------------------------------------------- Bug 1: duplicates
test('a portal page that looks like a game plus a game frame: one launcher, one panel', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}${TWIN}/frames.html?canvas=1&a=${encodeURIComponent(`${other()}${TWIN}/a/`)}`);
  const fa = await waitFrame(page, '/twin/a/');
  await fa.locator('saveforge-launcher .b').waitFor({ timeout: 8000 });
  await page.waitForTimeout(5000); // every detection pass of both documents
  assert.equal((await visibleCounts(page)).launchers, 1, 'one launcher on screen, in the game frame');
  await fa.locator('saveforge-launcher .b').click();
  await waitRows(fa);
  // the portal page is opened too (three-finger tap, #saveforge, its own launcher…)
  await openHere(page);
  await page.waitForTimeout(1500);
  const c = await visibleCounts(page);
  assert.equal(c.panels, 1, 'no second panel on the portal page');
  assert.equal(await page.locator('saveforge-trainer').count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('two copies booting at once, and the userscript injected again: one launcher, one panel', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}${TWIN}/a/`);
  const cdp = await ctx.newCDPSession(page);
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'copy-2' });
  await cdp.send('Runtime.evaluate', { expression: USERSCRIPT, contextId: executionContextId });
  await page.waitForTimeout(5000);
  assert.equal((await visibleCounts(page)).launchers, 1, 'one launcher');
  await page.evaluate((src) => (0, eval)(src), USERSCRIPT); // same world again (reinjection)
  await openHere(page);
  await waitRows(page);
  await cdp.send('Runtime.evaluate', { expression: 'window.__saveforgeUserscript.open()', contextId: executionContextId });
  await page.waitForTimeout(800);
  const c = await visibleCounts(page);
  assert.equal(c.panels, 1);
  assert.equal(c.launchers, 0, 'no launcher next to the open panel');
  await closeTrainer(page);
  await page.waitForTimeout(800);
  assert.equal((await visibleCounts(page)).launchers, 1, 'exactly one launcher comes back');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('closing while a big scan runs, and reopening quickly, leaves no timers and no second panel', { skip, timeout: 90000 }, async () => {
  const { ctx, page, errors } = await newPage({ instrument: true });
  await page.goto(`${base()}/test/fixtures/stress/?vars=20000&dialogue=5000`);
  await page.waitForTimeout(800);
  const idle = await page.evaluate(() => window.__iv.size);
  for (let i = 0; i < 3; i++) {
    await openHere(page);
    await page.locator('saveforge-trainer').waitFor({ state: 'attached' });
    await page.waitForTimeout(150 + i * 200); // still scanning
    await closeTrainer(page);
  }
  await page.waitForTimeout(3000); // any scan still running finishes or is dropped
  assert.equal(await page.locator('saveforge-trainer').count(), 0, 'a late scan result does not bring a panel back');
  assert.equal(await page.evaluate(() => window.__iv.size), idle, 'no SaveForge timer left running');
  await openHere(page);
  await waitRows(page);
  assert.equal((await visibleCounts(page)).panels, 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the game changes while the first scan is still running: the result shown is the new game’s', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}${TWIN}/spa.html?start=a`);
  await openHere(page);
  await page.locator('saveforge-trainer').waitFor({ state: 'attached' });
  await page.evaluate(() => window.twinSwitch('b')); // during the scan
  await page.waitForTimeout(200);
  await page.evaluate(() => window.twinSwitch('a'));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.twinSwitch('b'));
  await page.waitForFunction(() => {
    const p = window.__saveforgeTrainer?.provider?.();
    const e = p?.entries?.find((x) => /player.*gold/.test(x.path));
    return e && p.value(e.nodeId) === 2222 && window.__saveforgeTrainer.state().href.endsWith('/play-b');
  }, null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  assert.equal(await trainerGold(page), 2222, 'never replaced by the older scan');
  assert.equal((await visibleCounts(page)).panels, 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('navigating away and back, and Safari page restoration, keep targeting the right game', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}${TWIN}/a/`);
  await openHere(page);
  await waitRows(page);
  await page.goto(`${base()}${TWIN}/b/`);
  await openHere(page);
  await waitRows(page);
  assert.equal(await trainerGold(page), 2222);
  // (#saveforge added history entries: go back until Game A's page is shown)
  for (let i = 0; i < 4 && !(page.url().includes('/twin/a/') && (await page.evaluate(() => window.twinId).catch(() => null)) === 'a'); i++) {
    await page.goBack();
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => window.twinId === 'a');
  if (!(await page.locator('saveforge-trainer').count())) await openHere(page);
  await waitRows(page);
  assert.equal(await trainerGold(page), 1111);
  // what Safari does when it restores a page from its back-forward cache
  const before = await page.evaluate(() => window.__saveforgeTrainer.state().contextId);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => window.__saveforgeTrainer.state());
  assert.equal(st.contextId, before, 'same game, same context after restoration');
  assert.ok(st.restored >= 1, 'the restoration was noticed (and the game re-checked)');
  assert.equal(await trainerGold(page), 1111);
  assert.equal((await visibleCounts(page)).panels, 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('100,000 variables: the page changes game during the scan; the old scan is dropped and nothing is left running', { skip, timeout: 120000 }, async () => {
  const { ctx, page, errors } = await newPage({ instrument: true });
  await page.goto(`${base()}/test/fixtures/stress/?vars=100000&depth=10&lines=20000`);
  await page.waitForTimeout(800);
  const idle = await page.evaluate(() => window.__iv.size);
  await openHere(page);
  await page.locator('saveforge-trainer').waitFor({ state: 'attached' });
  await page.waitForTimeout(400); // the big scan is running
  await page.evaluate(() => history.pushState({}, '', '/test/fixtures/stress/level-2')); // single-page navigation
  await page.waitForFunction(() => window.__saveforgeTrainer?.state?.().gameKey?.endsWith('/level-2'), null, { timeout: 30000 });
  await waitRows(page);
  assert.equal((await visibleCounts(page)).panels, 1, 'one panel');
  await closeTrainer(page);
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => window.__iv.size), idle, 'no timer of either scan keeps running');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---------------------------------------------------------------- Diagnostics and reset
test('Diagnostics shows the game context, instances and resources; Reset clears only SaveForge’s data for this game', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}${TWIN}/a/`);
  await page.evaluate(() => window.twinSave());
  await openHere(page);
  await waitRows(page);
  await favoriteGold(page);
  const d = await page.evaluate(async () => {
    const x = await window.__saveforgeTrainer.diagnosticsData();
    return { game: x.game, instances: x.instances, resources: x.resources };
  });
  assert.match(d.game.href, /\/twin\/a\/$/);
  assert.match(d.game.contextId, /^[a-z0-9]+-[a-z0-9]+$/);
  assert.equal(d.game.frame, 'top page');
  assert.ok(d.game.reason, 'why this game was selected');
  assert.equal(d.instances.panels, 1);
  assert.ok(typeof d.resources.timers === 'number' && typeof d.resources.listeners === 'number');
  // the Diagnostics screen shows it
  await page.evaluate(() => window.__saveforgeTrainer.openDiagnostics());
  await T(page).locator('.sheet h3', { hasText: 'Game context' }).waitFor({ timeout: 8000 });
  const text = await T(page).locator('.sheet').innerText();
  assert.match(text, /Game context/i);
  assert.match(text, /Context ID/i);
  assert.match(text, /Trainer panels on this page\s*1/i);
  // reset this game's trainer data: the game's own save stays
  await page.evaluate(() => window.__saveforgeTrainer.resetGameData());
  await waitRows(page);
  assert.deepEqual(await page.evaluate(() => window.__saveforgeTrainer.state().favorites), []);
  assert.ok(await page.evaluate(() => !!localStorage.getItem('moonharbor_save')), 'the game’s save is untouched');
  assert.deepEqual(errors, []);
  await ctx.close();
});
