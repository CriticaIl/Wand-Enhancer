// The published files must be built from the current source: same version and the same build
// fingerprint everywhere (website, trainer, userscripts, extension). Fails when someone changes
// src/ (or package.json) without running `npm run build`, i.e. when the site would serve old code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildId } from '../tools/build-id.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('build fingerprint: every published file was built from the current source', () => {
  const pkg = JSON.parse(read('package.json')).version;
  const v = read('src/version.js');
  const VERSION = /VERSION = '([^']+)'/.exec(v)[1];
  const BUILD = /BUILD = '([^']+)'/.exec(v)[1];
  assert.equal(VERSION, pkg, 'src/version.js follows package.json');
  assert.equal(BUILD, buildId(ROOT), 'src/ changed since the last build: run npm run build');
  // website: index.html loads the bundle of this build (cache-busted URL)
  const index = read('index.html');
  assert.match(index, new RegExp(`standalone/app\\.js\\?v=${BUILD}`));
  assert.match(index, new RegExp(`standalone/app\\.css\\?v=${BUILD}`));
  // every bundle carries this build
  for (const f of ['standalone/app.js', 'standalone/SaveForge.html', 'standalone/trainer.js', 'standalone/saveforge-trainer.user.js', 'standalone/saveforge-trainer-always.user.js', 'safari-extension/extension/trainer.js']) {
    assert.ok(read(f).includes(`"${BUILD}"`) || read(f).includes(`'${BUILD}'`), `${f} is from build ${BUILD}`);
  }
  // userscript managers compare @version: it must be the package version
  for (const f of ['standalone/saveforge-trainer.user.js', 'standalone/saveforge-trainer.meta.js', 'standalone/saveforge-trainer-always.user.js', 'standalone/saveforge-trainer-always.meta.js']) {
    assert.match(read(f), new RegExp(`@version +${pkg.replace(/\./g, '\\.')}\\b`), f);
  }
  // offline cache: a new cache name per build, revalidated with the server
  const sw = read('standalone/sw.js');
  assert.match(sw, new RegExp(`saveforge-${pkg.replace(/\./g, '\\.')}-${BUILD}`));
  assert.match(sw, /cache: 'no-cache'/);
});
