// Which game is this trainer looking at? (SaveForge 2.3)
//
// Before 2.3 everything SaveForge remembered was keyed by the website's origin, and the scan
// kept after closing was reused for anything in the same window. On hosts that serve many games
// from one origin (itch.io's HTML game host, GitHub Pages, game portals) and on single-page-app
// portals, Game B therefore received Game A's favorites, hidden/learned variables, save links and
// even Game A's whole scan. A game context fixes that:
//
//   game key   origin + path (+ query, + a #/route) of the document running the game:
//              one key per game, used to scope everything SaveForge stores
//   document   a token on <html> (shared by every JavaScript world of that document): a new
//              document, even at the same address, is a new context
//   context id `${hash(game key)}-${document token}`, shown in Diagnostics
//
// watchContext() notices when the page in this window becomes another game (pushState/
// replaceState/popstate navigation, a #/route change) and when Safari restores the page from its
// back-forward cache.

const DOC_ATTR = 'data-saveforge-doc';
// query parameters that never select a game (tracking, cache busting, SaveForge's own)
const NOISE = /^(utm_.*|fbclid|gclid|dclid|msclkid|yclid|mc_.*|_ga|_gl|ref|referrer|source|v|ver|t|ts|cb|cachebust|nocache|_|saveforge.*)$/i;

function safe(fn, fallback = '') {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Short, stable hash (FNV-1a, base 36). */
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The address that identifies the game in this window. */
export function gameAddress(win) {
  const loc = safe(() => win.location, null);
  if (!loc) return { origin: 'unknown', path: '', query: '', route: '', key: 'unknown' };
  const origin = safe(() => loc.origin, 'unknown');
  const path = safe(() => loc.pathname, '/').replace(/\/index\.html?$/i, '/') || '/';
  let query = '';
  try {
    const sp = new URLSearchParams(loc.search);
    const keep = [...sp.entries()].filter(([k]) => !NOISE.test(k)).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    query = keep.map(([k, v]) => `${k}=${v}`).join('&');
  } catch {
    query = '';
  }
  // hash routers (#/game/12, #!/play): a route selects a game; any other hash does not
  const hash = safe(() => loc.hash, '');
  const route = /^#!?\//.test(hash) ? hash.replace(/^#!?/, '').split('?')[0] : '';
  return { origin, path, query, route, key: `${origin}${path}${query ? `?${query}` : ''}${route ? `#${route}` : ''}` };
}

/** A token per document, shared by every JavaScript world of it (the DOM is shared). */
export function docToken(win) {
  try {
    const de = win.document.documentElement;
    let t = de.getAttribute(DOC_ATTR);
    if (!t) {
      t = Math.random().toString(36).slice(2, 8);
      de.setAttribute(DOC_ATTR, t);
    }
    return t;
  } catch {
    return 'nodoc';
  }
}

/** "top page" or "iframe, depth n" */
export function frameDepth(win) {
  let depth = 0;
  try {
    for (let w = win; w !== w.parent && depth < 10; w = w.parent) depth++;
  } catch {
    /* cross-origin parent */
  }
  return depth;
}

export function gameContext(win, reason = '') {
  const a = gameAddress(win);
  const doc = docToken(win);
  const depth = frameDepth(win);
  return {
    key: a.key,
    origin: a.origin,
    href: safe(() => win.location.href),
    title: safe(() => win.document.title),
    gameId: hashStr(a.key),
    docId: doc,
    id: `${hashStr(a.key)}-${doc}`,
    depth,
    frame: depth === 0 ? 'top page' : `iframe, depth ${depth}`,
    reason,
    since: Date.now(),
  };
}

const GENERIC_WORDS = new Set(['index', 'html', 'game', 'games', 'play', 'player', 'build', 'dist', 'public', 'static', 'assets', 'html5', 'embed', 'frame', 'iframe', 'latest', 'release', 'main', 'default', 'files', 'uploads', 'content', 'save', 'saves', 'data', 'test', 'fixtures', 'demo', 'web', 'www', 'online', 'free', 'version']);

/** Words that name this game (path segments, title words): used to tell whose save a storage key is. */
export function gameTokens(win, extra = []) {
  const words = new Set();
  const add = (s) => {
    for (const w of String(s || '').toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 4 && !GENERIC_WORDS.has(w) && !/^\d{1,3}$/.test(w)) words.add(w);
  };
  const a = gameAddress(win);
  for (const seg of a.path.split('/')) add(seg.replace(/\.[a-z0-9]+$/i, ''));
  add(a.route);
  const title = safe(() => win.document.title);
  add(title);
  // a title like "Moon Harbor" also appears as "moonharbor" in keys
  const joined = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (joined.length >= 6 && joined.length <= 40) words.add(joined);
  for (const x of extra) add(x);
  return [...words];
}

/**
 * Calls onChange({from, to, why}) when this window now shows another game, and onRestore()
 * when Safari restores the page from its back-forward cache. Checks run once a second while
 * the page is visible (a cheap string comparison), and right after popstate/hashchange/pageshow.
 */
export function watchContext(win, ctx, { onChange, onRestore, everyMs = 1000 } = {}) {
  let stopped = false;
  let restored = 0;
  let timer = 0;
  const check = (why) => {
    if (stopped) return false;
    const now = gameAddress(win);
    if (now.key !== ctx.key) {
      onChange?.({ from: ctx.key, to: now.key, why });
      return true;
    }
    return false;
  };
  const onPop = () => check('navigation (history)');
  const onHash = () => check('navigation (#route)');
  const onShow = (e) => {
    if (!e.persisted) return;
    restored++;
    if (!check('page restored from the back-forward cache')) onRestore?.();
  };
  win.addEventListener('popstate', onPop);
  win.addEventListener('hashchange', onHash);
  win.addEventListener('pageshow', onShow);
  timer = win.setInterval(() => {
    if (!safe(() => win.document.hidden, false)) check('address changed (single-page navigation)');
  }, everyMs);
  return {
    check,
    restored: () => restored,
    stop() {
      if (stopped) return;
      stopped = true;
      win.clearInterval(timer);
      win.removeEventListener('popstate', onPop);
      win.removeEventListener('hashchange', onHash);
      win.removeEventListener('pageshow', onShow);
    },
    listeners: () => (stopped ? 0 : 3),
    timers: () => (stopped ? 0 : 1),
  };
}
