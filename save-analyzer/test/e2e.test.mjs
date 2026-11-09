// Browser end-to-end tests (Playwright/Chromium). Skipped when Playwright is not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { bookmarkletUrl } from '../src/bridge/storage-bridge.js';
import { analyzeFile } from '../src/core/document.js';

const require = createRequire(import.meta.url);
let playwright = null;
try {
  playwright = require('playwright');
} catch {
  playwright = null;
}
const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!path.startsWith(ROOT)) return res.writeHead(403).end();
    try {
      const file = path.endsWith('/') ? join(path, 'index.html') : path;
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const skip = !playwright && 'playwright not installed';

test('same-origin game: read storage, edit in the mod menu, write back into the running game', { skip, timeout: 60000 }, async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/index.html`);
    await page.click('.tabbar button:has-text("Game")');
    await page.fill('input[type=url]', `${base}/test/fixtures/demo-game/`);
    await page.click('button:has-text("Launch")');
    await page.waitForSelector('text=Direct integration available');
    await page.frameLocator('iframe').locator('#coins').waitFor();
    await page.waitForFunction(() => document.querySelector('iframe').contentDocument.title === 'saved');
    await page.click('button:has-text("Read game storage")');
    await page.waitForSelector('.cat >> text=Money & Currency');
    const coins = page.locator('.ctl', { hasText: 'Coins' }).first().locator('input.input');
    await coins.fill('777777');
    await coins.press('Enter');
    const gems = page.locator('.ctl', { hasText: 'Gems' }).first().locator('input.input');
    await gems.fill('99');
    await gems.press('Enter');
    await page.click('.tabbar button:has-text("Game")');
    await page.waitForSelector('text=Direct integration available');
    await page.click('button:has-text("Validate & write back")');
    await page.waitForSelector('text=Verified');
    await page.click('button:has-text("Write into the running game")');
    await page.frameLocator('iframe').locator('#coins', { hasText: '777777' }).waitFor({ timeout: 10000 });
    const gemsInDb = await page.frameLocator('iframe').locator('body').evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open('pebblefarm');
          r.onsuccess = () => {
            const g = r.result.transaction('slots').objectStore('slots').get('slot1');
            g.onsuccess = () => resolve({ gems: JSON.parse(new TextDecoder().decode(g.result.blob)).gems, isBytes: g.result.blob instanceof Uint8Array, date: g.result.savedAt instanceof Date });
          };
        }),
    );
    assert.deepEqual(gemsInDb, { gems: 99, isBytes: true, date: true });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test('bookmarklet: export from the game page, edit, import back', { skip, timeout: 60000 }, async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch();
  try {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    await page.goto(`${base}/test/fixtures/demo-game/`);
    await page.waitForFunction(() => document.title === 'saved');
    const js = decodeURIComponent(bookmarkletUrl().slice('javascript:'.length));
    await page.evaluate(js);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#saveforge-bridge button[data-a=export]')]);
    const bytes = new Uint8Array(await readFile(await download.path()));
    const res = await analyzeFile(download.suggestedFilename(), bytes);
    assert.ok(res.ok);
    assert.equal(res.doc.engine.id, 'storage-dump');
    const coins = res.doc.menu.all.find((e) => e.key === 'coins');
    const quarry = res.doc.menu.all.find((e) => e.key === 'quarry');
    const out = await res.doc.export(new Map([[coins.nodeId, 4242], [quarry.nodeId, true]]));
    assert.ok(out.validation.ok, out.validation.problems.join('\n'));

    page.on('dialog', (d) => d.accept());
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#saveforge-bridge button[data-a=import]')]);
    await Promise.all([page.waitForEvent('load'), chooser.setFiles({ name: 'edited.json', mimeType: 'application/json', buffer: Buffer.from(out.bytes) })]);
    await page.locator('#coins', { hasText: '4242' }).waitFor();
    const st = await page.evaluate(() => JSON.parse(atob(localStorage.getItem('pebblefarm_save'))));
    assert.equal(st.unlocked.quarry, true);
  } finally {
    await browser.close();
    server.close();
  }
});

test('the website shows its version and build, the same as the trainer it opens', { skip, timeout: 60000 }, async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch();
  const { readFileSync } = await import('node:fs');
  const v = readFileSync(join(ROOT, 'src/version.js'), 'utf8');
  const VERSION = /VERSION = '([^']+)'/.exec(v)[1];
  const BUILD = /BUILD = '([^']+)'/.exec(v)[1];
  try {
    for (const path of ['/index.html', '/standalone/SaveForge.html']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${base}${path}`);
      assert.equal((await page.locator('.brand .appversion').innerText()).trim(), `· v${VERSION}`, path);
      await page.click('button[aria-label="Help and supported formats"]');
      assert.equal(await page.locator('.appversion-full').innerText(), `SaveForge ${VERSION} · build ${BUILD}`, path);
      // the trainer opened from this site is the same build
      await page.click('.modal .btn:has-text("Close")');
      await page.click('.tabbar button:has-text("Game")');
      await page.fill('input[type=url]', `${base}/test/fixtures/demo-game/`);
      await page.click('button:has-text("Launch")');
      await page.frameLocator('iframe').locator('#coins').waitFor();
      await page.click('button:has-text("Open trainer over game")');
      const frame = page.frameLocator('iframe');
      await frame.locator('saveforge-trainer .row').first().waitFor();
      assert.equal(await frame.locator('saveforge-trainer .title small').innerText(), `TRAINER ${VERSION}`, `${path}: trainer header`);
      assert.deepEqual(errors, [], path);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});
