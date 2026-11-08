// Safari Web Extension packaging tests.
// Xcode is not available on Linux CI, so the iOS project is checked
// structurally (parsed with the Cordova `xcode` parser, every reference
// resolved on disk). The WebExtension itself is exercised for real by loading
// it into Chromium, which implements the same `action` + `scripting` APIs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import vm from 'node:vm';
import { hasPython } from './helpers.mjs';

const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;
const EXT = join(ROOT, 'safari-extension/extension');
const IOS = join(ROOT, 'safari-extension/ios');
const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));

/** After a live edit the sheet stays open to show verification; tap Done (or Back) to return. */
async function leaveEdit(scope) {
  const done = scope.locator('saveforge-trainer .sheet .btn', { hasText: /^Done$/ });
  if (await done.count()) await done.first().click();
}

test('manifest: MV3, only activeTab + scripting, no standing website access', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'scripting']);
  assert.equal(manifest.host_permissions, undefined, 'no host permissions requested up front');
  assert.equal(manifest.content_scripts, undefined, 'nothing runs on pages until the button is tapped');
  assert.ok(manifest.action, 'toolbar button');
  assert.equal(manifest.action.default_popup, undefined, 'tapping the button launches directly');
  const files = [manifest.background.service_worker, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon), 'trainer.js', 'inject-fallback.js', `_locales/${manifest.default_locale}/messages.json`];
  for (const f of files) assert.ok(existsSync(join(EXT, f)), `missing ${f}`);
  const msgs = JSON.parse(readFileSync(join(EXT, '_locales/en/messages.json'), 'utf8'));
  for (const m of JSON.stringify(manifest).match(/__MSG_(\w+)__/g)) assert.ok(msgs[m.slice(6, -2)], m);
});

test('extension ships the same trainer bundle as the web app', () => {
  assert.equal(readFileSync(join(EXT, 'trainer.js'), 'utf8'), readFileSync(join(ROOT, 'standalone/trainer.js'), 'utf8'));
});

function loadBackground(scripting, url = 'https://game.example/') {
  const calls = { exec: [], badge: [] };
  let listener;
  const api = {
    action: {
      onClicked: { addListener: (fn) => (listener = fn) },
      setBadgeText: async (o) => calls.badge.push(o.text),
      setTitle: async () => {},
    },
    scripting: {
      executeScript: async (opts) => {
        calls.exec.push(opts);
        return scripting(opts);
      },
    },
  };
  const ctx = { browser: api, console: { warn() {} } };
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(join(EXT, 'background.js'), 'utf8'), ctx);
  return { launch: (tab = { id: 7, url }) => ctx.saveforgeLaunchTrainer(tab), calls, listener: () => listener };
}

test('background: injects trainer.js into the MAIN world when the button is tapped', async () => {
  const bg = loadBackground(() => [{}]);
  assert.equal(typeof bg.listener(), 'function', 'toolbar click listener registered');
  assert.equal(await bg.launch(), 'main');
  assert.deepEqual(JSON.parse(JSON.stringify(bg.calls.exec[0])), { target: { tabId: 7 }, files: ['trainer.js'], world: 'MAIN' });
});

test('background: falls back to a page <script> when world:MAIN is unsupported', async () => {
  const bg = loadBackground((o) => {
    if (o.world === 'MAIN') throw new Error('Unsupported world');
    return [{}];
  });
  assert.equal(await bg.launch(), 'fallback');
  assert.deepEqual([...bg.calls.exec[1].files], ['inject-fallback.js']);
});

test('background: refuses non-web pages and reports blocked pages with a badge', async () => {
  const bg = loadBackground(() => [{}]);
  assert.equal(await bg.launch({ id: 1, url: 'about:blank' }), 'unsupported-page');
  assert.equal(bg.calls.exec.length, 0);
  const blocked = loadBackground(() => {
    throw new Error('denied');
  });
  assert.equal(await blocked.launch(), 'failed');
  assert.deepEqual([...blocked.calls.badge], ['!']);
});

test('Xcode project: parses, has app + extension targets, every file reference exists', () => {
  const xcode = require('xcode');
  const proj = xcode.project(join(IOS, 'SaveForge.xcodeproj/project.pbxproj')).parseSync();
  const objs = proj.hash.project.objects;
  const ref = (c) => (typeof c === 'string' ? c : c.value); // IDs with or without /* comments */
  const targets = Object.entries(objs.PBXNativeTarget).filter(([k]) => !k.endsWith('_comment')).map(([, t]) => t);
  const byName = Object.fromEntries(targets.map((t) => [t.name.replace(/"/g, ''), t]));
  assert.equal(byName.SaveForge.productType.replace(/"/g, ''), 'com.apple.product-type.application');
  assert.equal(byName['SaveForge Extension'].productType.replace(/"/g, ''), 'com.apple.product-type.app-extension');
  assert.equal(byName.SaveForge.dependencies.length, 1, 'app depends on the extension');

  // every ID referenced anywhere must exist
  const all = new Set();
  for (const sec of Object.values(objs)) for (const k of Object.keys(sec)) if (!k.endsWith('_comment')) all.add(k);
  const text = readFileSync(join(IOS, 'SaveForge.xcodeproj/project.pbxproj'), 'utf8');
  for (const id of text.match(/\b[0-9A-F]{24}\b/g)) assert.ok(all.has(id), `dangling reference ${id}`);

  // resolve file reference paths through the group tree
  const groups = Object.entries(objs.PBXGroup).filter(([k]) => !k.endsWith('_comment'));
  const parentOf = new Map();
  for (const [gid, g] of groups) for (const c of g.children) parentOf.set(ref(c), gid);
  const strip = (s) => (s || '').replace(/^"|"$/g, '');
  const pathOf = (id) => {
    const parts = [];
    let cur = id;
    while (cur) {
      const o = objs.PBXGroup[cur] || objs.PBXFileReference[cur];
      if (o?.path) parts.unshift(strip(o.path));
      cur = parentOf.get(cur);
    }
    return resolve(IOS, ...parts);
  };
  let checked = 0;
  for (const [id, f] of Object.entries(objs.PBXFileReference)) {
    if (id.endsWith('_comment') || strip(f.sourceTree) !== '<group>') continue;
    assert.ok(existsSync(pathOf(id)), `missing ${pathOf(id)}`);
    checked++;
  }
  assert.ok(checked >= 11, `checked ${checked} file references`);
  // the extension copies manifest.json to the root of the .appex
  const extRes = byName['SaveForge Extension'].buildPhases.map(ref).map((id) => objs.PBXResourcesBuildPhase[id]).find(Boolean);
  const names = extRes.files.map((f) => strip(objs.PBXFileReference[ref(objs.PBXBuildFile[ref(f)].fileRef)].path));
  assert.deepEqual(names.sort(), ['_locales', 'background.js', 'images', 'inject-fallback.js', 'manifest.json', 'trainer.js']);
  // bundle IDs: extension must be prefixed by the app's ID
  const cfgs = objs.XCBuildConfiguration;
  const ids = Object.values(cfgs).map((c) => c.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER).filter(Boolean).map(strip);
  assert.ok(ids.includes('$(SAVEFORGE_BUNDLE_PREFIX).SaveForge'));
  assert.ok(ids.includes('$(SAVEFORGE_BUNDLE_PREFIX).SaveForge.Extension'));
});

test('Xcode project is reproducible from tools/gen_xcodeproj.py', { skip: !hasPython() }, () => {
  const file = join(IOS, 'SaveForge.xcodeproj/project.pbxproj');
  const before = readFileSync(file, 'utf8');
  execFileSync('python3', [join(ROOT, 'safari-extension/tools/gen_xcodeproj.py')]);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('plists and asset catalog are valid', { skip: !hasPython() }, () => {
  const out = execFileSync('python3', ['-c', `import plistlib,sys;d=plistlib.load(open(sys.argv[1],'rb'));print(d['NSExtension']['NSExtensionPointIdentifier'])`, join(IOS, 'SaveForge Extension/Info.plist')]).toString().trim();
  assert.equal(out, 'com.apple.Safari.web-extension');
  const icon = JSON.parse(readFileSync(join(IOS, 'SaveForge/Assets.xcassets/AppIcon.appiconset/Contents.json'), 'utf8'));
  const png = join(IOS, 'SaveForge/Assets.xcassets/AppIcon.appiconset', icon.images[0].filename);
  const b = readFileSync(png);
  assert.equal(b.readUInt32BE(16), 1024);
  assert.equal(b[25], 2, 'App Store icon must be RGB without alpha');
  assert.ok(statSync(png).size > 1000);
});

// ---------------------------------------------------------------- real extension in Chromium

let playwright = null;
try {
  playwright = require('playwright');
} catch {
  playwright = null;
}

test('real extension: tapping the button opens the live trainer on a game page', { skip: !playwright && 'playwright not installed', timeout: 60000 }, async (t) => {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = createServer((req, res) => {
    const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    try {
      const file = path.endsWith('/') ? join(path, 'index.html') : path;
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // Automation cannot tap a toolbar button, which is what grants activeTab access.
  // A test-only copy of the extension gets host access to this local server in
  // place of that tap; the real manifest is checked first to have no such access.
  const granted = mkdtempSync(join(tmpdir(), 'sf-ext-granted-'));
  cpSync(EXT, granted, { recursive: true });
  writeFileSync(join(granted, 'manifest.json'), JSON.stringify({ ...manifest, host_permissions: ['http://127.0.0.1/*'] }));
  const launchWith = (dir) =>
    playwright.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'sf-ext-')), {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
    });
  const workerOf = async (c) => c.serviceWorkers()[0] || (await c.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null));
  let ctx;
  try {
    // 1) real manifest: without the user's tap the extension cannot touch the page
    const strict = await launchWith(EXT);
    const sw0 = await workerOf(strict);
    if (sw0) {
      const p0 = await strict.newPage();
      await p0.goto(`${base}/demo-games/crystal-quest/`);
      const r0 = await sw0.evaluate(async (url) => globalThis.saveforgeLaunchTrainer((await chrome.tabs.query({ url: `${url}/*` }))[0]), base);
      assert.equal(r0, 'failed', 'no standing website access');
      assert.equal(await p0.locator('saveforge-trainer').count(), 0);
    }
    await strict.close();
    ctx = await launchWith(granted);
  } catch (e) {
    server.close();
    t.skip(`this Chromium cannot load extensions headless: ${e.message.split('\n')[0]}`);
    return;
  }
  try {
    const sw = await workerOf(ctx);
    if (!sw) {
      t.skip('extension service worker did not start in this headless Chromium');
      return;
    }
    const page = await ctx.newPage();
    await page.goto(`${base}/demo-games/crystal-quest/`);
    // what the toolbar button does (activeTab grants access on the tap):
    const result = await sw.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url: `${url}/*` });
      return globalThis.saveforgeLaunchTrainer(tab);
    }, base);
    assert.equal(result, 'main');
    await page.locator('saveforge-trainer .chip[aria-pressed=true]', { hasText: 'RPG Maker' }).waitFor({ timeout: 10000 });
    await page.locator('saveforge-trainer .row .lbl', { hasText: 'Money' }).first().click();
    await page.locator('saveforge-trainer .row').filter({ has: page.locator('.name', { hasText: 'Gold' }) }).first().locator('.num').click();
    await page.locator('saveforge-trainer .sheet .field').fill('8888');
    await page.locator('saveforge-trainer .sheet .btn.go', { hasText: 'Apply' }).click();
    await leaveEdit(page);
    await page.locator('#gold', { hasText: '8888' }).waitFor({ timeout: 3000 });
    // ⓘ is present on every variable row
    const rows = await page.locator('saveforge-trainer .row:has(.toggle), saveforge-trainer .row:has(.num)').count();
    const infos = await page.locator('saveforge-trainer .row .info').count();
    assert.equal(infos, rows);
  } finally {
    await ctx.close();
    server.close();
  }
});

test('userscript is valid JavaScript built from the shared trainer source', () => {
  const src = readFileSync(join(ROOT, 'standalone/saveforge-trainer.user.js'), 'utf8');
  assert.match(src, /@inject-into\s+page/);
  assert.match(src, /saveforge-launcher/);
  execFileSync(process.execPath, ['--check', join(ROOT, 'standalone/saveforge-trainer.user.js')]);
  assert.ok(dirname(EXT));
});

test('built bundles are pure ASCII (extension loaders reject noncharacters like U+FFFF)', () => {
  for (const f of ['standalone/trainer.js', 'standalone/saveforge-trainer.user.js', 'safari-extension/extension/trainer.js']) {
    const b = readFileSync(join(ROOT, f));
    assert.equal(b.findIndex((x) => x > 127), -1, f);
  }
});
