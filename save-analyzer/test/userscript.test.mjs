// The userscript as an iOS userscript manager runs it: injected into every
// frame of every page (Playwright addInitScript behaves the same way).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;
const USERSCRIPT = readFileSync(join(ROOT, 'standalone/saveforge-trainer.user.js'), 'utf8');
const META = readFileSync(join(ROOT, 'standalone/saveforge-trainer.meta.js'), 'utf8');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

function meta(src) {
  const head = src.slice(0, src.indexOf('// ==/UserScript==') + 19);
  const out = {};
  for (const m of head.matchAll(/^\/\/ @(\S+)\s+(.*)$/gm)) (out[m[1]] ||= []).push(m[2].trim());
  return { head, out };
}

/** After a live edit the sheet stays open to show verification; tap Done (or Back) to return. */
async function leaveEdit(scope) {
  const done = scope.locator('saveforge-trainer .sheet .btn', { hasText: /^Done$/ });
  if (await done.count()) await done.first().click();
}

test('metadata: installable and updatable from GitHub Pages, page context, no special grants', () => {
  const { head, out } = meta(USERSCRIPT);
  assert.equal(out.version[0], pkg.version, '@version follows package.json so managers see updates');
  assert.deepEqual(out['inject-into'], ['page'], 'needs the page context to reach engine globals');
  assert.deepEqual(out.grant, ['none'], 'no GM APIs needed (they are unavailable in page context)');
  assert.ok(out.match.includes('*://*/*'));
  assert.equal(out.noframes, undefined, 'must also run inside game iframes (itch.io etc.)');
  assert.match(out.updateURL[0], /^https:\/\/criticail\.github\.io\/.+\/saveforge-trainer\.meta\.js$/);
  assert.match(out.downloadURL[0], /^https:\/\/criticail\.github\.io\/.+\/saveforge-trainer\.user\.js$/);
  assert.equal(META.trim(), head.trim(), 'meta.js is exactly the header');
  assert.equal([...Buffer.from(USERSCRIPT)].findIndex((b) => b > 127), -1, 'pure ASCII');
});

// ---------------------------------------------------------------- browser
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
const pages = new Map([
  ['/plain.html', '<!doctype html><title>News</title><body><h1>An ordinary website</h1><p>Some text with a <a href="#x">link</a>.</p><form><input name="q"><button>Search</button></form></body>'],
  ['/frame-host.html', null], // filled per test (needs the other origin's port)
]);

before(async () => {
  if (skip) return;
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (pages.has(url.pathname) && pages.get(url.pathname)) return res.writeHead(200, { 'content-type': 'text/html' }).end(pages.get(url.pathname));
    const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    try {
      const file = path.endsWith('/') ? join(path, 'index.html') : path;
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
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

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.addInitScript({ content: USERSCRIPT });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  return { ctx, page, errors };
}
const base = () => `http://127.0.0.1:${port}`;
const launcher = (scope) => scope.locator('saveforge-launcher .b');

test('ordinary websites are left alone: no launcher, no storage, no DOM changes', { skip, timeout: 30000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}/plain.html`);
  const before = await page.evaluate(() => document.body.innerHTML);
  await page.waitForTimeout(2500);
  assert.equal(await page.locator('saveforge-launcher').count(), 0);
  assert.equal(await page.evaluate(() => document.body.innerHTML), before);
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  assert.deepEqual(dbs, [], 'no databases created');
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  assert.equal(await page.evaluate(() => typeof window.__saveforgeUserscript.open), 'function');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('game pages get the launcher automatically; trainer edits live; launcher returns after closing', { skip, timeout: 30000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}/demo-games/crystal-quest/`);
  await launcher(page).waitFor({ timeout: 5000 });
  await launcher(page).click();
  await page.locator('saveforge-trainer .chip[aria-pressed=true]', { hasText: 'RPG Maker' }).waitFor();
  assert.equal(await page.locator('saveforge-launcher').evaluate((h) => h.style.display), 'none', 'launcher hidden while the trainer is open');
  await page.locator('saveforge-trainer .row .lbl', { hasText: 'Money' }).first().click();
  await page.locator('saveforge-trainer .row').filter({ has: page.locator('.name', { hasText: 'Gold' }) }).first().locator('.num').click();
  await page.locator('saveforge-trainer .sheet .field').fill('2024');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  await leaveEdit(page);
  await page.locator('#gold', { hasText: '2024' }).waitFor({ timeout: 3000 });
  // ⓘ explanation
  await page.locator('saveforge-trainer .row .info').first().click();
  assert.match(await page.locator('saveforge-trainer .sheet').innerText(), /what it controls/i);
  await page.locator('saveforge-trainer .hbtn[aria-label="Close trainer"]').click();
  await launcher(page).waitFor({ state: 'visible', timeout: 3000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('#saveforge opens the trainer anywhere; Apply & Reload works through the userscript', { skip, timeout: 40000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}/test/fixtures/demo-game/`);
  await page.waitForFunction(() => document.title === 'saved');
  assert.equal(await page.locator('saveforge-launcher').count(), 0, 'no canvas/engine: not auto-detected');
  await page.evaluate(() => (location.hash = '#saveforge'));
  await page.locator('saveforge-trainer .row').first().waitFor();
  assert.equal(await page.evaluate(() => location.hash), '', 'trigger removed from the address');
  await page.locator('saveforge-trainer .chip', { hasText: 'Saves in storage' }).click();
  await page.locator('saveforge-trainer .badge.reload').first().waitFor();
  await page.locator('saveforge-trainer .tool[aria-label="Search"]').click();
  await page.locator('saveforge-trainer .search input').fill('coins');
  await page.locator('saveforge-trainer .row').filter({ has: page.locator('.name', { hasText: 'Coins' }) }).first().locator('.num').click();
  await page.locator('saveforge-trainer .sheet .field').fill('5150');
  await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  await leaveEdit(page);
  await page.locator('saveforge-trainer .tool.primary').click();
  await Promise.all([page.waitForEvent('load'), page.locator('saveforge-trainer .btn.warn', { hasText: 'Apply & Reload' }).click()]);
  await page.locator('#coins', { hasText: '5150' }).waitFor({ timeout: 5000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('per-site switch: long-press → Hide on this site persists; #saveforge-on brings it back', { skip, timeout: 40000 }, async () => {
  const { ctx, page } = await newPage();
  const url = `${base()}/demo-games/neon-courier/`;
  await page.goto(url);
  await launcher(page).waitFor({ timeout: 5000 });
  const box = await launcher(page).boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await page.locator('saveforge-launcher .m button', { hasText: 'Hide on this site' }).click();
  assert.equal(await page.locator('saveforge-launcher').count(), 0);
  await page.evaluate(() => window.__saveforgeUserscript.saved);
  await page.reload();
  await page.waitForTimeout(2500);
  assert.equal(await page.locator('saveforge-launcher').count(), 0, 'stays hidden after reload');
  await page.evaluate(() => (location.hash = '#saveforge-on'));
  await launcher(page).waitFor({ timeout: 5000 });
  await page.evaluate(() => window.__saveforgeUserscript.saved);
  // "always" also works on pages that are not detected as games
  await page.goto(`${base()}/plain.html#saveforge-on`);
  await launcher(page).waitFor({ timeout: 5000 });
  await page.evaluate(() => window.__saveforgeUserscript.saved);
  await page.reload();
  await launcher(page).waitFor({ timeout: 5000 });
  assert.equal(await page.evaluate(() => window.__saveforgeUserscript.mode), 'always');
  await page.evaluate(() => (location.hash = '#saveforge-auto'));
  await page.locator('saveforge-launcher').waitFor({ state: 'detached', timeout: 5000 });
  await ctx.close();
});

test('games inside a cross-origin iframe (itch.io-style): launcher and live trainer run in the game frame', { skip, timeout: 40000 }, async () => {
  pages.set('/frame-host.html', `<!doctype html><title>Game portal</title><body><h1>Portal page</h1><iframe src="http://localhost:${port}/demo-games/tap-miner/" style="width:380px;height:700px;border:0"></iframe></body>`);
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}/frame-host.html`);
  const frame = page.frameLocator('iframe');
  await launcher(frame).waitFor({ timeout: 6000 });
  assert.equal(await page.locator('body > saveforge-launcher').count(), 0, 'nothing added to the portal page itself');
  await launcher(frame).click();
  await frame.locator('saveforge-trainer .chip[aria-pressed=true]', { hasText: 'Construct 2' }).waitFor();
  await frame.locator('saveforge-trainer .tool[aria-label="Search"]').click();
  await frame.locator('saveforge-trainer .search input').fill('pick');
  await frame.locator('saveforge-trainer .row').filter({ has: frame.locator('.name', { hasText: 'Pick Level' }) }).first().locator('.num').click();
  await frame.locator('saveforge-trainer .sheet .field').fill('77');
  await frame.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  await leaveEdit(frame);
  await frame.locator('#pick', { hasText: '77' }).waitFor({ timeout: 3000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Ren'Py web pages are detected from their save storage", { skip, timeout: 30000 }, async () => {
  const { ctx, page } = await newPage();
  await page.goto(`${base()}/demo-games/ruins-web/`);
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  await page.reload(); // database now exists from the first visit
  await launcher(page).waitFor({ timeout: 6000 });
  await ctx.close();
});

// ---------------------------------------------------------------- regression: game portals (e.g. mopoga.com)
// The portal page is full of website globals and the game runs in a
// cross-origin iframe (nested one level deeper). Previously the trainer listed
// ~15 website globals from the portal page as "game variables".

const portalUrl = () => `${base()}/test/fixtures/portal/?game=${encodeURIComponent(`http://localhost:${port}`)}`;
const gameFrame = (page) => page.frames().find((f) => f.url().includes('/demo-games/star-runner/'));

test('portal: no launcher on the portal page; the launcher appears inside the nested game frame', { skip, timeout: 40000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(portalUrl());
  const game = page.frameLocator('#game-frame').frameLocator('iframe');
  await launcher(game).waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  assert.equal(await page.locator('saveforge-launcher').count(), 0, 'portal page left alone');
  assert.equal(await page.frameLocator('#game-frame').locator('saveforge-launcher').count(), 0, 'wrapper page left alone');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('portal: #saveforge on the portal page opens the trainer in the game frame with real game state', { skip, timeout: 40000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(portalUrl());
  const game = page.frameLocator('#game-frame').frameLocator('iframe');
  await launcher(game).waitFor({ timeout: 8000 });
  await page.evaluate(() => (location.hash = '#saveforge'));
  await game.locator('saveforge-trainer .chip[aria-pressed=true]', { hasText: 'Phaser' }).waitFor({ timeout: 8000 });
  assert.equal(await page.locator('saveforge-trainer').count(), 0, 'not opened on the portal page');
  // live edit reaches the game
  await game.locator('saveforge-trainer .tool[aria-label="Search"]').click();
  await game.locator('saveforge-trainer .search input').fill('lives');
  await game.locator('saveforge-trainer .row').filter({ has: game.locator('.name', { hasText: 'Lives' }) }).first().locator('.num').click();
  await game.locator('saveforge-trainer .sheet .field').fill('9');
  await game.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  await leaveEdit(game);
  await game.locator('#lives', { hasText: '9' }).waitFor({ timeout: 3000 });
  // ⓘ tells where the variable comes from
  await game.locator('saveforge-trainer .row .info').first().click();
  const info = await game.locator('saveforge-trainer .sheet').innerText();
  assert.match(info, /where it comes from/i);
  assert.match(info, /scene “Play”/);
  assert.match(info, /iframe, depth 2 \(http:\/\/localhost/);
  // none of the portal's website globals leaked in
  const all = await gameFrame(page).evaluate(() => window.__saveforgeTrainer.provider().entries.map((e) => e.path).join('|'));
  assert.doesNotMatch(all, /dataLayer|siteConfig|plays|rating|thumb|adsbygoogle|Cookiebot/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('portal: opened on the portal page itself, website globals are not shown as game variables and Diagnostics explains why', { skip, timeout: 40000 }, async () => {
  // bookmarklet / extension style: trainer injected into the top page only
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(portalUrl());
  await page.frameLocator('#game-frame').frameLocator('iframe').locator('#score').waitFor();
  await page.addScriptTag({ content: readFileSync(join(ROOT, 'standalone/trainer.js'), 'utf8') });
  await page.locator('saveforge-trainer .row').first().waitFor();
  await page.waitForTimeout(1200); // generic source samples values for ~0.7 s
  const counts = await page.evaluate(() => {
    const p = window.__saveforgeTrainer.provider();
    return { source: p.title, entries: p.entries.length };
  });
  assert.equal(counts.entries, 0, `website globals listed as game variables: ${JSON.stringify(counts)}`);
  assert.ok(await page.locator('saveforge-trainer .row .name', { hasText: 'No game variables found here' }).isVisible());
  await page.locator('saveforge-trainer .row .lbl', { hasText: 'Diagnostics' }).first().click();
  const sheet = page.locator('saveforge-trainer .sheet');
  await sheet.locator('h3', { hasText: 'Frames on this page' }).waitFor();
  const text = await sheet.innerText();
  assert.match(text, /probably the game/i);
  assert.match(text, /localhost/, 'game frame origin shown');
  assert.match(text, /other site/i);
  assert.match(text, /not running in this frame/i);
  // 1.6: per-variable detection says why nothing is listed, and lists what it excluded
  assert.match(text, /Game variables: 0 confirmed, 0 potential/i);
  assert.match(text, /No game state detected — \d+ variable\(s\) were inspected, but none looked like game state/);
  await sheet.locator('summary', { hasText: 'Why was this excluded?' }).click();
  const vars = await sheet.locator('details.excluded-vars').innerText();
  assert.match(vars, /game\.plays — excluded.*website-like name “plays”/);
  assert.match(vars, /siteConfig\.ads\.refresh — excluded/);
  await sheet.locator('summary', { hasText: 'Excluded objects' }).click();
  const excluded = await sheet.locator('details.excluded-globals').innerText();
  for (const name of ['dataLayer', 'adsbygoogle', 'Cookiebot', 'siteConfig', 'game', 'relatedGames']) assert.match(excluded, new RegExp(`\\b${name}\\b`), `${name} listed as excluded`);
  assert.match(excluded, /website-like keys: title, slug/);
  assert.ok(await sheet.locator('button', { hasText: 'Open game frame directly' }).isVisible());
  // advanced: website globals can still be inspected on request
  await sheet.locator('button', { hasText: 'Include website globals' }).click();
  assert.ok((await page.evaluate(() => window.__saveforgeTrainer.provider().entries.length)) > 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---------------------------------------------------------------- launcher reliability (games that are hard to detect)

test('late-loading games: the launcher appears when the game shows up after the old detection window', { skip, timeout: 40000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}/test/fixtures/late-game/?delay=7000`);
  await page.waitForTimeout(6500);
  assert.equal(await page.locator('saveforge-launcher').count(), 0, 'nothing before the game exists');
  await launcher(page).waitFor({ timeout: 8000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('manual activation: a three-finger tap opens SaveForge on a page where nothing was detected', { skip, timeout: 30000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}/plain.html`);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const t = (i) => new Touch({ identifier: i, target: document.body, clientX: 50 + i * 40, clientY: 200 });
    const touches = [t(1), t(2), t(3)];
    document.body.dispatchEvent(new TouchEvent('touchstart', { touches, targetTouches: touches, changedTouches: touches, bubbles: true }));
  });
  await page.locator('saveforge-trainer .row').first().waitFor({ timeout: 5000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('“always visible” script variant shows the launcher on any permitted page; per-site hide still works', { skip, timeout: 30000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.addInitScript({ content: readFileSync(join(ROOT, 'standalone/saveforge-trainer-always.user.js'), 'utf8') });
  const page = await ctx.newPage();
  await page.goto(`${base()}/plain.html`);
  await launcher(page).waitFor({ timeout: 4000 });
  assert.equal(await page.evaluate(() => window.__saveforgeUserscript.mode), 'always');
  await page.evaluate(() => (location.hash = '#saveforge-off'));
  await page.locator('saveforge-launcher').waitFor({ state: 'detached', timeout: 3000 });
  const meta = readFileSync(join(ROOT, 'standalone/saveforge-trainer-always.meta.js'), 'utf8');
  assert.match(meta, /@name\s+SaveForge Trainer \(always visible\)/);
  assert.match(meta, /saveforge-trainer-always\.meta\.js/);
  await ctx.close();
});

test('game in a same-site frame the manager does not inject into (srcdoc): #saveforge opens the trainer there', { skip, timeout: 30000 }, async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base()}/test/fixtures/srcdoc-game/`);
  const frame = page.frameLocator('#g');
  await frame.locator('#gems', { hasText: '7' }).waitFor();
  await page.evaluate(() => (location.hash = '#saveforge'));
  await frame.locator('saveforge-trainer .row').first().waitFor({ timeout: 6000 });
  assert.equal(await page.locator('body > saveforge-trainer').count(), 0, 'not on the portal page');
  await frame.locator('saveforge-trainer .tool[aria-label="Search"]').click();
  await frame.locator('saveforge-trainer .search input').fill('gems');
  await frame.locator('saveforge-trainer .row').filter({ has: frame.locator('.name', { hasText: 'Gems' }) }).first().locator('.num').click();
  await frame.locator('saveforge-trainer .sheet .field').fill('70');
  await frame.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
  await frame.locator('#gems', { hasText: '70' }).waitFor({ timeout: 3000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Diagnostics reports the script context (page world = edits can reach the game)', { skip, timeout: 30000 }, async () => {
  const { ctx, page } = await newPage();
  await page.goto(`${base()}/demo-games/tap-miner/`);
  await launcher(page).waitFor({ timeout: 6000 });
  await launcher(page).click();
  await page.locator('saveforge-trainer .row .lbl', { hasText: 'Diagnostics' }).first().click();
  const sheet = page.locator('saveforge-trainer .sheet');
  await sheet.locator('dd', { hasText: /^page:/ }).waitFor({ timeout: 5000 });
  assert.match(await sheet.innerText(), /Same JavaScript context as the game/);
  // compatibility indicator on the main menu
  await page.locator('saveforge-trainer .tool[aria-label="Back"]').click();
  assert.match(await page.locator('saveforge-trainer .compat').innerText(), /Full live editing · Construct 2/);
  await ctx.close();
});
