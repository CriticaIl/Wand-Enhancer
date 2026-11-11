// Runs ONE scenario against several built userscripts (e.g. every release, extracted with
// `git show <commit>:save-analyzer/standalone/saveforge-trainer.user.js`) and prints what each
// version lists. Written for the 2.3.6 regression investigation (SugarCube save variables missing
// on a story that keeps State private, on a website hosting several games).
//
//   node tools/compare-versions.mjs <scenario> <label=path.user.js> [...]
//   scenarios:
//     shared-host   another SugarCube story is played and SaveForge opened in it first (same origin,
//                   same tab, as on itch.io's shared HTML game host), then a story that keeps its
//                   State private is played and SaveForge opened in it
//     single-game   only the private-State story
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = new URL('..', import.meta.url).pathname;
const { chromium } = createRequire(ROOT)('playwright');
const [, , scenario = 'shared-host', ...specs] = process.argv;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
const server = createServer((req, res) => {
  // /html/<upload id>/ serves the SugarCube fixture, like itch.io's per-upload game paths
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/html\/\d+\//, '/test/fixtures/sugarcube-real/');
  const p = normalize(join(ROOT, pathname));
  try {
    const f = p.endsWith('/') ? join(p, 'index.html') : p;
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }).end(readFileSync(f));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const host = `http://localhost:${server.address().port}`;
const STORY = '/test/fixtures/sugarcube-real/';
const browser = await chromium.launch();

async function openTrainer(page) {
  await page.evaluate(() => (location.hash = '#saveforge'));
  await page.waitForFunction(() => window.__saveforgeTrainer?.provider?.()?.entries?.length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(4000); // saves are read and merged after the live list
}
async function run(label, path) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript({ content: readFileSync(path, 'utf8') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (scenario.startsWith('new-upload')) {
    // day 1: the game at upload 1111; SaveForge open while the game autosaves (owner recorded);
    // day 2 (a new tab): the developer uploaded a new build, now at /html/2222/
    const q = `?hidden=1&story=cah&globals=1${scenario === 'new-upload-plain' ? '&plainpassage=1' : ''}`;
    await page.goto(`${host}/html/1111/${q}&go=Shop`);
    await page.waitForTimeout(800);
    await openTrainer(page);
    await page.evaluate(() => document.querySelector('#passages a[data-passage]').click()); // the game's own link (the trainer panel covers it)
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__saveforgeTrainer.syncSaves?.());
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__saveforgeTrainer.destroy());
    await page.waitForTimeout(500);
    const page2 = await ctx.newPage();
    page2.on('pageerror', (e) => errors.push(e.message));
    await page2.goto(`${host}/html/2222/${q}&go=Shop`);
    await page2.waitForTimeout(800);
    await openTrainer(page2);
    return report(label, page2, errors, ctx);
  }
  if (scenario === 'shared-host') {
    await page.goto(`${host}${STORY}?story=other&go=Shop`);
    await page.waitForTimeout(800);
    await openTrainer(page);
    await page.evaluate(() => window.__saveforgeTrainer.destroy());
  }
  await page.goto(`${host}${STORY}?hidden=1&story=cah&globals=1&go=Shop,Street`);
  await page.waitForTimeout(800);
  await openTrainer(page);
  return report(label, page, errors, ctx);
}
async function report(label, page, errors, ctx) {
  const r = await page.evaluate(() => {
    const t = window.__saveforgeTrainer;
    const p = t.provider();
    const rows = p.entries.map((e) => ({ path: e.path, origin: e.origin || p.kind, label: e.label }));
    const host = document.querySelector('saveforge-trainer');
    const compat = host?.shadowRoot?.querySelector('.compat, .compatibility')?.textContent || '';
    return {
      source: t.state ? t.state().sourceId : p.engine?.id,
      live: rows.filter((x) => x.origin === 'live').length,
      save: rows.filter((x) => x.origin === 'save' || x.origin === 'live+save').length,
      money: rows.filter((x) => /money/.test(`${x.path} ${x.label}`)).map((x) => `${x.label} (${x.origin})`).slice(0, 2),
      fromOther: rows.filter((x) => /other\.saves/.test(x.path)).length,
      compat: compat.trim().slice(0, 70),
      hidden: (() => {
        try {
          const o = t.saveHub?.ownership || p.saves?.ownership;
          return (o?.foreign || []).map((f) => `${f.name} -> ${f.ownerTitle} (${f.how})`);
        } catch {
          return '?';
        }
      })(),
    };
  });
  console.log(JSON.stringify({ version: label, ...r, errors: errors.slice(0, 2) }));
  await ctx.close();
}
for (const spec of specs) {
  const [label, path] = spec.split('=');
  try {
    await run(label, path);
  } catch (e) {
    console.log(JSON.stringify({ version: label, failed: e.message.split('\n')[0] }));
  }
}
await browser.close();
server.close();
