// Tells real game-state globals apart from website globals (analytics, ads,
// consent, frameworks, page metadata, portal SDKs).
//
// Every page global gets a score from evidence, and every decision carries
// human-readable reasons so the Diagnostics screen can show why something was
// included or excluded. Nothing here invents variables: it only filters what
// the page actually exposes.
//
// Evidence:
//   + numeric values, game-like key names (score, hp, level, coins, inventory…)
//   + values that change while the page runs (games mutate their state)
//   + constructor names like Game/Player/State/Scene
//   - known analytics/ad/consent/framework/portal-SDK globals (excluded outright)
//   - website-like key names (title, url, slug, rating, plays, thumbnail, locale…)
//   - URL strings, text-heavy objects

import { toEnglish } from '../core/translate.js';

export const INCLUDE_THRESHOLD = 0.35;

const enKeyCache = new Map();
/** Key words for scoring; non-English names (所持金, monedas…) use their offline translation. */
function keyWords(k) {
  if (enKeyCache.has(k)) return enKeyCache.get(k);
  const base = splitName(k);
  if (/^[\x00-\x7f]*$/.test(k) && !/[a-z]{4,}/i.test(k)) {
    if (enKeyCache.size > 20000) enKeyCache.clear();
    enKeyCache.set(k, base);
    return base;
  }
  const r = toEnglish(k);
  const out = r.kind === 'translation' || r.kind === 'partial' ? `${base} ${r.english.toLowerCase()}` : base;
  if (enKeyCache.size > 20000) enKeyCache.clear();
  enKeyCache.set(k, out);
  return out;
}

const KNOWN_WEBSITE = [
  ['analytics or tracking', /^(dataLayer|google_tag_manager|google_tag_data|gtag|ga|gaplugins|gaGlobal|GoogleAnalyticsObject|_gaq|_gat|_paq|Matomo|Piwik|hj|hjSiteSettings|_hjSettings|fbq|_fbq|twq|ttq|snaptr|pintrk|uetq|ym|yaCounter\d+|clarity|amplitude|mixpanel|analytics|heap|_satellite|s_gi|newrelic|NREUM|DD_RUM|LogRocket|Sentry|Raven|__SENTRY__|_linkedin_partner_id|lintrk|_hsq|optimizely|plausible|umami)$/],
  ['ads', /^(adsbygoogle|googletag|pbjs|apstag|criteo_q|Criteo|_taboola|TRC|OBR|outbrain|IMA|google|googlefc|adConfig|adsConfig|ads|adUnits|vidazoo|playwire|ramp|freestar|nitroAds|AdSlot.*|__ad.*|adngin|aniplayer.*|ezstandalone|__ez.*|_ezaq|mediavine.*|__mv.*|admiral.*)$/],
  ['privacy consent', /^(__cmp|__tcfapi|__uspapi|__gpp|OneTrust|OptanonActiveGroups|Optanon|OptanonWrapper|Cookiebot|CookieConsent|cookieconsent|_iub|didomiOnReady|Didomi|__cmpGdprAppliesGlobally|consent.*|gdpr.*|ccpa.*)$/i],
  ['game-portal SDK (not game state)', /^(sdk|GameDistribution|gdsdk|GD_OPTIONS|PokiSDK|CrazyGames|CrazySDK|famobi.*|Famobi|YaGames|ysdk|gamemonetize.*|sdkConfig|GameMonetize|SDK_OPTIONS|Playgama.*|bridge|GamePix|gamepix.*|Wortal|Azerion.*|h5branding.*|adInPlay.*|lagged.*)$/],
  ['web framework or library', /^(jQuery|\$|_|Vue|React|ReactDOM|preact|Alpine|htmx|Livewire|Turbo|Stimulus|Swiper|lazySizes|lazySizesConfig|Swal|moment|dayjs|axios|Modernizr|Popper|bootstrap|Prism|hljs|marked|DOMPurify|Hammer|Zone|ng|AMP|regeneratorRuntime|webpackChunk.*|webpackJsonp.*|__webpack.*|__NEXT_DATA__|__NEXT_.*|next|__NUXT__|\$nuxt|__INITIAL_STATE__|__APOLLO_STATE__|__REDUX_DEVTOOLS.*|__VUE.*|__REACT.*|__core-js.*|wp|wpApiSettings|ajaxurl|_wpemojiSettings|grecaptcha|recaptcha.*|YT|onYouTubeIframeAPIReady|Intercom|intercomSettings|OneSignal|Crisp|\$crisp|Tawk_API|zE|zESettings|LiveChatWidget|i18n|i18next|Shopify|__st|ShopifyAnalytics|addthis.*|__sharethis.*|FB|twttr|Disqus|DISQUS|disqus_config)$/],
];

const GAME_WORDS = /(^|[^a-z])(hp|health|life|lives|score|scores|highscore|best|level|lvl|xp|exp|experience|gold|coins?|money|cash|credits?|gems?|diamonds?|ammo|stamina|energy|mana|mp|inventory|items?|player|players|enemy|enemies|boss|wave|stage|round|combo|stars?|upgrades?|unlocked|achievements?|quest|chapter|day|days|turn|turns|speed|power|damage|attack|defen[cs]e|armou?r|shield|weapons?|skills?|perks?|potions?|keys?|resources?|wood|stone|food|ore|crystals?|tokens?|souls?|kills?|deaths?|lap|laps|fuel|hunger|thirst|affection|love|trust|story|flags?|switch(es)?|variables?|savegame|saveData|progress|world|map|room|zone|checkpoint|bank|distance|held|stamina|vitality|affection|customers?|clients?|stock|employees?|workers?|staff|profit|income|sales|revenue|factory|production|machines?|stats|statistics|counters?|clicks?|taps|multiplier|prestige|rebirth|population|happiness|reputation|fame|fans|followers|harvest|crops?|animals?|buildings?|houses?|prices?|costs?|cost|upkeep|wages?|salary|debt|loans?)([^a-z]|$)/i;
const WEBSITE_WORDS = /(^|[^a-z])(title|description|desc|slug|url|uri|href|link|links|thumb|thumbnail|image|img|images|icon|banner|category|categories|tags?|rating|ratings|votes?|plays|views|likes|dislikes|author|developer|publisher|created|updated|published|date|lang|language|locale|embed|iframe|share|social|seo|canonical|ads?|adslot|analytics|consent|cookies?|tracking|useragent|is_?mobile|device|browser|os|platform|env|environment|api|endpoint|token|csrf|nonce|session|cdn|domain|host|hostname|path|route|router|menu|nav|footer|header|breadcrumbs?|related|recommended|comments?|cart|product|price|currency_code|email|login|logout|signup|account|profile_url|avatar)([^a-z]|$)/i;
const WEBSITE_NAME = /(config|settings|options|env|site|page|seo|i18n|locale|translations|session|csrf|token|nonce|api|endpoint|cdn|theme|consent|cookie|tracking|analytics|banner|meta|schema|menu|nav|layout|route|router|portal|embed|share|social|related)/i;
const GAME_CLASS = /(Game|Player|State|Save|World|Level|Scene|Inventory|Stats|Hero|Character|Store(?!front)|Engine)/;
const URL_STRING = /^(https?:)?\/\/|^\/[\w-]+(\/|\.|$)|^data:|^[\w.-]+\.(png|jpe?g|webp|gif|svg|mp4|html?)$/i;

/** Classifies one global. */
export function classifyGlobal(name, value) {
  for (const [label, re] of KNOWN_WEBSITE) {
    if (re.test(name)) return { name, kind: 'website', score: 0, reasons: [`known ${label} global`] };
  }
  const reasons = [];
  if (value === null || value === undefined) return { name, kind: 'website', score: 0, reasons: ['empty'] };
  if (typeof value !== 'object') {
    // top-level primitive, e.g. `var score = 0` in a simple game
    if (GAME_WORDS.test(keyWords(name)) && (typeof value === 'number' || typeof value === 'boolean')) {
      return { name, kind: 'game', score: 0.55, reasons: [`top-level ${typeof value} with a game-like name`] };
    }
    if (WEBSITE_NAME.test(name) || WEBSITE_WORDS.test(splitName(name))) return { name, kind: 'website', score: 0.05, reasons: ['website-like name'] };
    return { name, kind: 'unknown', score: 0.15, reasons: ['top-level value with no game-like name'] };
  }
  const st = stats(value);
  let score = 0;
  if (st.numbers) {
    score += (Math.min(st.numbers, 20) / 20) * 0.3;
    reasons.push(`${st.numbers} numeric value(s)`);
  }
  if (st.gameKeys) {
    // absolute count, but small objects whose keys are mostly game-like count too
    score += Math.min(1, st.gameKeys / 6 + (st.gameKeys / Math.max(1, st.keys)) * 0.5) * 0.45;
    reasons.push(`game-like keys: ${st.gameKeyNames.slice(0, 5).join(', ')}`);
    if (st.numbers && !st.webKeys && !st.urls && st.gameKeys / Math.max(1, st.keys) >= 0.5) {
      score += 0.1;
      reasons.push('mostly game numbers');
    }
  }
  if (GAME_WORDS.test(splitName(name))) {
    score += 0.1;
    reasons.push('game-like global name');
  }
  if (st.className && GAME_CLASS.test(st.className)) {
    score += 0.15;
    reasons.push(`object of class ${st.className}`);
  }
  if (st.webKeys) {
    score -= (Math.min(st.webKeys, 6) / 6) * 0.35;
    reasons.push(`website-like keys: ${st.webKeyNames.slice(0, 5).join(', ')}`);
  }
  if (st.urls) {
    score -= (Math.min(st.urls, 4) / 4) * 0.25;
    reasons.push(`${st.urls} URL/file string(s)`);
  }
  if (st.strings > st.numbers * 2 && st.strings > 3) {
    score -= 0.15;
    reasons.push('mostly text');
  }
  if (WEBSITE_NAME.test(name) && !GAME_WORDS.test(splitName(name))) {
    score -= 0.2;
    reasons.push('website-like global name');
  }
  if (!st.numbers && !st.bools) {
    score -= 0.2;
    reasons.push('no numbers or switches to edit');
  }
  return { name, kind: score >= INCLUDE_THRESHOLD ? 'game' : st.webKeys || st.urls ? 'website' : 'unknown', score: round(score), reasons, numeric: st.numbers };
}

/** Adds the "changes while running" evidence from two samples of numeric leaves. */
export function applyMutation(result, changed) {
  if (!changed || result.reasons[0]?.startsWith('known ')) return result;
  const score = round(result.score + 0.35);
  return { ...result, score, kind: score >= INCLUDE_THRESHOLD ? 'game' : result.kind, reasons: [...result.reasons, `${changed} value(s) changed while the page was running`] };
}

/** Reads numeric leaves (own data properties only, never getters) for mutation sampling. */
export function sampleNumbers(value, limit = 400) {
  const out = new Map();
  const seen = new Set();
  const walk = (v, path, depth) => {
    if (out.size >= limit || depth > 4 || !v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    let keys;
    try {
      keys = Object.keys(v);
    } catch {
      return;
    }
    for (const k of keys.slice(0, 200)) {
      let d;
      try {
        d = Object.getOwnPropertyDescriptor(v, k);
      } catch {
        continue;
      }
      if (!d || !('value' in d)) continue;
      if (typeof d.value === 'number') out.set(`${path}.${k}`, d.value);
      else if (d.value && typeof d.value === 'object' && !isPlatformObject(d.value)) walk(d.value, `${path}.${k}`, depth + 1);
      if (out.size >= limit) return;
    }
  };
  if (typeof value === 'number') out.set('', value);
  else walk(value, '', 0);
  return out;
}

export function countChanges(a, b) {
  let n = 0;
  for (const [k, v] of a) if (b.has(k) && b.get(k) !== v) n++;
  return n;
}

function stats(value) {
  const st = { numbers: 0, bools: 0, strings: 0, urls: 0, gameKeys: 0, webKeys: 0, keys: 0, gameKeyNames: [], webKeyNames: [], className: null };
  try {
    const proto = Object.getPrototypeOf(value);
    if (proto && proto !== Object.prototype && proto !== Array.prototype && proto.constructor) st.className = proto.constructor.name;
  } catch {
    /* ignore */
  }
  const seen = new Set();
  let budget = 400;
  const walk = (v, depth) => {
    if (budget <= 0 || depth > 4 || !v || typeof v !== 'object' || seen.has(v) || isPlatformObject(v)) return;
    seen.add(v);
    let keys;
    try {
      keys = Object.keys(v);
    } catch {
      return;
    }
    for (const k of keys.slice(0, 150)) {
      if (--budget <= 0) return;
      let d;
      try {
        d = Object.getOwnPropertyDescriptor(v, k);
      } catch {
        continue;
      }
      if (!d || !('value' in d)) continue;
      const x = d.value;
      const words = keyWords(k);
      const isArrayIndex = Array.isArray(v) && /^\d+$/.test(k);
      if (!isArrayIndex) {
        st.keys++;
        if (GAME_WORDS.test(words)) {
          st.gameKeys++;
          if (st.gameKeyNames.length < 8 && !st.gameKeyNames.includes(k)) st.gameKeyNames.push(k);
        } else if (WEBSITE_WORDS.test(words)) {
          st.webKeys++;
          if (st.webKeyNames.length < 8 && !st.webKeyNames.includes(k)) st.webKeyNames.push(k);
        }
      }
      if (typeof x === 'number') st.numbers++;
      else if (typeof x === 'boolean') st.bools++;
      else if (typeof x === 'string') {
        st.strings++;
        if (URL_STRING.test(x)) st.urls++;
      } else if (x && typeof x === 'object') walk(x, depth + 1);
    }
  };
  walk(value, 0);
  return st;
}

function isPlatformObject(v) {
  try {
    if (typeof v.nodeType === 'number' && typeof v.nodeName === 'string') return true;
    if (v.window === v) return true;
    const tag = Object.prototype.toString.call(v).slice(8, -1);
    return /^(Promise|Map|Set|WeakMap|WeakSet|ArrayBuffer|DataView|RegExp|Error|CanvasRenderingContext2D|WebGL2?RenderingContext|AudioContext|Worker|WebSocket|XMLHttpRequest)$/.test(tag) || (/Array$/.test(tag) && tag !== 'Array');
  } catch {
    return true; // cross-origin or exotic object
  }
}

export function splitName(s) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.$]+/g, ' ')
    .toLowerCase();
}

function round(x) {
  return Math.round(x * 100) / 100;
}


// ---------------------------------------------------------------- per-variable scoring (1.6)
// Whole objects often mix game state with configuration and assets
// (app = {config:{lang,url}, assets:{…}, data:{money:1822}}), so variables are
// judged one by one, with their parents as context, instead of excluding the
// whole object.

export const LEAF_GAME = 0.5;
export const LEAF_POTENTIAL = 0.3;
const SETTING_WORDS = /(^| )(volume|music|sound|sfx|bgm|theme|dark|mode|autoplay|fullscreen|quality|language|lang|locale|subtitles|vibration|muted?)( |$)/;
const ID_WORDS = /(^| )(id|ids|uuid|guid|hash|token|nonce|seed|key|index|idx)( |$)/;
const URLISH = /^(https?:)?\/\/|^\/[\w-]+(\/|\.|$)|^data:|\.(png|jpe?g|webp|gif|svg|mp3|ogg|wav|mp4|html?|json|js|css)(\?|$)/i;

/**
 * @param leaf {key, type, value, parentKeys: string[] (nearest last), globalKind,
 *              inLargeArray, changed, onScreen, verified, mark}
 * @returns {score, tier: 'game'|'potential'|'excluded', reasons}
 */
export function scoreLeaf(leaf) {
  const reasons = [];
  const own = keyWords(String(leaf.key));
  const near = leaf.parentKeys.slice(-2).map((k) => keyWords(String(k))).join(' ');
  let s = 0;
  if (leaf.type === 'int' || leaf.type === 'float') {
    s += 0.25;
    reasons.push('number');
  } else if (leaf.type === 'bool') {
    s += 0.15;
    reasons.push('on/off value');
  } else if (leaf.type === 'string') {
    const v = String(leaf.value ?? '');
    if (URLISH.test(v)) {
      s -= 0.35;
      reasons.push('URL or file name');
    } else if (v.length > 30 || v.trim().split(/\s+/).length > 3) {
      s -= 0.3;
      reasons.push('long text (dialogue/UI)');
    }
  }
  const ownGame = GAME_WORDS.test(own);
  if (ownGame) {
    s += 0.35;
    reasons.push(`game-like name “${leaf.key}”`);
  } else if (GAME_WORDS.test(near)) {
    s += 0.15;
    reasons.push('inside a game-like object');
  }
  if (!ownGame && WEBSITE_WORDS.test(own)) {
    s -= 0.45;
    reasons.push(`website-like name “${leaf.key}”`);
  }
  if (!GAME_WORDS.test(near) && (WEBSITE_WORDS.test(near) || WEBSITE_NAME.test(leaf.parentKeys.slice(-2).join(' ')))) {
    s -= 0.25;
    reasons.push('inside website data (config, page, ads…)');
  }
  if (!ownGame && SETTING_WORDS.test(own)) {
    s -= 0.1;
    reasons.push('a setting, not progress');
  }
  if (!ownGame && ID_WORDS.test(own)) {
    s -= 0.15;
    reasons.push('identifier');
  }
  const n = Number(leaf.value);
  if (typeof leaf.value === 'number' && ((n > 9.4e8 && n < 4.1e9) || (n > 9.4e11 && n < 4.1e12))) {
    s -= 0.2;
    reasons.push('looks like a timestamp');
  }
  if (leaf.inLargeArray) {
    s -= 0.3;
    reasons.push('entry of a large data table');
  }
  const nearGame = ownGame || GAME_WORDS.test(near);
  if (leaf.globalKind === 'game') {
    s += 0.15;
    reasons.push('its object looks like game state');
  } else if (leaf.globalKind === 'website' && !nearGame) {
    // the whole-object verdict is weak evidence: it must not outweigh a game-like name
    // (app = {config, assets, data: {money}} looks like website data as a whole)
    s -= 0.15;
    reasons.push('its object looks like website data');
  }
  if (leaf.changed) {
    s += 0.4;
    reasons.push('changed while the game was running');
  }
  if (leaf.onScreen) {
    s += 0.25;
    reasons.push('its value is shown on screen');
  }
  if (leaf.verified) {
    s = Math.max(s, 1);
    reasons.push('edited and verified in the game');
  }
  if (leaf.mark === 'game') {
    s = Math.max(s, 0.9);
    reasons.push('you marked it as a game variable');
  } else if (leaf.mark === 'not') {
    s = -1;
    reasons.push('you marked it as not a game variable');
  }
  s = round(s);
  return { score: s, tier: s >= LEAF_GAME ? 'game' : s >= LEAF_POTENTIAL ? 'potential' : 'excluded', reasons };
}

/** Numbers visible in the page's text (for “shown on screen” evidence). Reads text only. */
export function screenNumbers(win, limit = 6000) {
  const out = new Set();
  const doc = win.document;
  if (!doc || !doc.body || !doc.createTreeWalker) return out;
  const walker = doc.createTreeWalker(doc.body, 4);
  let node;
  let i = 0;
  while ((node = walker.nextNode()) && i++ < limit) {
    const p = node.parentElement;
    if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName) || p.closest('saveforge-trainer, saveforge-launcher')) continue;
    const text = (node.nodeValue || '').replace(/[\u202f\u00a0]/g, ' ');
    for (const m of text.matchAll(/-?\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/g)) {
      const raw = m[0];
      const grouped = /^-?\d{1,3}([ ,.])\d{3}/.exec(raw);
      let v = raw;
      if (grouped) v = raw.split(grouped[1]).join('').replace(',', '.');
      else v = raw.replace(',', '.');
      const num = Number(v);
      if (Number.isFinite(num)) out.add(num);
    }
  }
  return out;
}
