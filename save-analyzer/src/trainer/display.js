// "Game state updated" vs "Visible UI refreshed".
//
// Editing a variable changes the game's state, but many games only redraw a
// screen when it is opened (DOM-based idle/shop games), while canvas engines
// redraw every frame. This module finds out, on the actual page:
//   - how the game draws (engine canvas loop / framework / plain DOM / canvas)
//   - whether the new value is visible on screen (reads visible text only)
//   - which of the game's own redraw functions could refresh the display
// It never reloads the page, never simulates clicks, and only calls a game
// function when the user taps it (or chose it for automatic use on that site).

/** Ways a number can appear on screen: 1822, 1,822, 1 822 (fr), 1.822 (de), 1.8K… */
export function displayForms(v) {
  const out = new Set();
  if (typeof v === 'boolean' || v === null || v === undefined) return out;
  if (typeof v === 'string') {
    if (v.trim().length >= 1 && v.length <= 200) out.add(v.trim());
    return out;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return out;
  out.add(String(n));
  for (const loc of ['en-US', 'fr-FR', 'de-DE']) {
    try {
      out.add(n.toLocaleString(loc).replace(/ | /g, ' '));
      out.add(n.toLocaleString(loc, { maximumFractionDigits: 0 }).replace(/ | /g, ' '));
    } catch {
      /* ignore */
    }
  }
  if (!Number.isInteger(n)) for (const d of [0, 1, 2]) out.add(n.toFixed(d));
  const abs = Math.abs(n);
  for (const [div, suf] of [[1e3, 'K'], [1e6, 'M'], [1e9, 'B'], [1e12, 'T']]) {
    if (abs >= div && abs < div * 1000) {
      for (const d of [0, 1, 2]) {
        const s = (n / div).toFixed(d);
        out.add(`${s}${suf}`);
        out.add(`${s}${suf.toLowerCase()}`);
      }
    }
  }
  return out;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SAVEFORGE-TRAINER', 'SAVEFORGE-LAUNCHER', 'SAVEFORGE-TOAST', 'TEXTAREA']);

function visible(el, win) {
  if (!el || el.nodeType !== 1) return false;
  try {
    const st = win.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  } catch {
    return false;
  }
}

/** Visible text nodes (and input values) that show one of the forms, as whole tokens. */
export function findOnScreen(win, value, { limit = 6000 } = {}) {
  const doc = win.document;
  const forms = [...displayForms(value)].filter((f) => f.length);
  if (!forms.length || !doc.body) return [];
  const escaped = forms.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(^|[^\\d.,])(${escaped.join('|')})(?![\\d]|[.,]\\d)`);
  const hits = [];
  const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
  let n = 0;
  let node;
  while ((node = walker.nextNode()) && n++ < limit) {
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName) || parent.closest('saveforge-trainer, saveforge-launcher')) continue;
    const text = (node.nodeValue || '').replace(/[\u202f\u00a0]/g, ' ');
    if (!text || text.length > 400 || !re.test(text)) continue;
    if (visible(parent, win)) hits.push(parent);
  }
  for (const input of doc.querySelectorAll('input, output, progress, meter')) {
    const v = input.value;
    if (v !== undefined && forms.includes(String(v)) && visible(input, win)) hits.push(input);
  }
  return hits;
}

/** How the page draws itself. */
export function detectRenderer(win, engineIds = []) {
  const doc = win.document;
  const has = (k) => {
    try {
      return k in win && win[k] !== undefined;
    } catch {
      return false;
    }
  };
  if (engineIds.some((id) => ['phaser', 'construct2', 'rpgmaker'].includes(id))) {
    return { kind: 'engine-loop', name: engineIds.find((id) => ['phaser', 'construct2', 'rpgmaker'].includes(id)), autoRedraw: true, evidence: 'game engine with a render loop' };
  }
  if (has('PIXI') || has('Phaser') || has('cc') || has('BABYLON') || has('THREE')) {
    return { kind: 'engine-loop', name: ['PIXI', 'Phaser', 'cc', 'BABYLON', 'THREE'].find(has), autoRedraw: true, evidence: 'canvas engine global found' };
  }
  const anyEl = doc.querySelector('[data-reactroot], #root, #app, [data-v-app], [ng-version], [x-data]');
  const fw =
    has('__REACT_DEVTOOLS_GLOBAL_HOOK__') && anyEl
      ? 'React'
      : has('__VUE__') || (anyEl && (anyEl.__vue_app__ || anyEl.__vue__))
        ? 'Vue'
        : doc.querySelector('[ng-version]')
          ? 'Angular'
          : has('Alpine')
            ? 'Alpine.js'
            : doc.querySelector('[class*="svelte-"]')
              ? 'Svelte'
              : null;
  if (fw) return { kind: 'framework', name: fw, autoRedraw: false, evidence: `${fw} app detected: the screen updates when the framework's own state changes` };
  const canvases = [...doc.querySelectorAll('canvas')].filter((c) => visible(c, win));
  const big = canvases.some((c) => {
    const r = c.getBoundingClientRect();
    return r.width * r.height > 0.15 * (win.innerWidth || 1) * (win.innerHeight || 1);
  });
  const textyUi = doc.body ? doc.body.querySelectorAll('button, [onclick], .tab, [role=tab]').length : 0;
  if (big && textyUi < 3) return { kind: 'canvas', name: 'canvas', autoRedraw: null, evidence: 'drawn on a canvas: the screen cannot be read; most canvas games redraw every frame' };
  return { kind: 'dom', name: 'HTML page', autoRedraw: false, evidence: 'the game writes values into the page’s HTML; many such games only redraw a screen when it is opened' };
}

const REDRAW_VERBS = 'render|refresh|redraw|draw|display|paint|repaint|show|update|afficher|affiche|actualiser|rafraichir|rafraîchir|maj|mettreAJour|miseAJour|dessiner|mostrar|actualizar|refrescar|renderizar|dibujar|anzeigen|aktualisieren|zeichnen|aggiorna|aggiornare|mostra|disegna|atualizar|desenhar';
// verb alone with a UI noun (updateUI, renderAll), verb + any name (afficherMagasin, updateMoney), or …UI/…Display
const REDRAW_NAME = new RegExp(`^(re)?(${REDRAW_VERBS})(ui|hud|screen|view|views|display|stats|all|interface|labels|text|page|panel|panels|tab|tabs|everything|values|counters|header|top|bar|menu)?s?$|^(re)?(${REDRAW_VERBS})[A-Z_\\u00c0-\\u024f]\\w*$|^\\w*(UI|Ui|Hud|HUD|Display|Screen|View)(update|refresh|render|redraw)?$`);
const DANGEROUS = /(tick|step|loop|frame|save|load|reset|buy|sell|add|give|earn|win|lose|start|init|spawn|delete|remove|clear|kill|die|attack|hit|damage|pay|spend|gain|collect|claim|reward|purchase|upgrade|unlock|level|prestige|rebirth|ascend|new|create|restart|next|prev|play|pause|resume|tutorial|quest|send|post|fetch|ajax|submit|login|logout|ad|ads|acheter|vendre|gagner|payer|sauver|sauvegarder|charger|ajouter|retirer|comprar|vender|ganar|guardar|kaufen|verkaufen|speichern)/i;

/**
 * The game's own zero-argument redraw functions (globals, and methods of
 * game-ish objects one level deep), ranked. Nothing is called here.
 */
export function redrawCandidates(win) {
  const out = [];
  const seen = new Set();
  const consider = (fn, path, owner) => {
    if (typeof fn !== 'function' || seen.has(fn) || fn.length > 0) return;
    const name = path[path.length - 1];
    if (!REDRAW_NAME.test(name)) return;
    // bare update()/show()/draw() are often the game loop or a screen change: never offered
    if (/^(update|show|draw|display|render|refresh)$/i.test(name) && path.length === 1) return;
    const lower = name.toLowerCase().replace(/^(re)?(render|refresh|redraw|draw|display|paint|repaint|show|update|afficher|affiche|actualiser|rafraichir|rafraîchir|maj|mettreajour|miseajour|dessiner|mostrar|actualizar|refrescar|renderizar|dibujar|anzeigen|aktualisieren|zeichnen|aggiorna|aggiornare|mostra|disegna|atualizar|desenhar)/, '');
    if (DANGEROUS.test(lower)) return;
    let src = '';
    try {
      src = Function.prototype.toString.call(fn);
    } catch {
      src = '';
    }
    if (/\[native code\]/.test(src)) return;
    seen.add(fn);
    let score = 0.4;
    if (/(ui|hud|display|screen|view|all|interface|stats|money|store|shop|values|magasin|boutique|argent|ecran|écran|interface|tienda|dinero|pantalla|laden|geld)/i.test(name)) score += 0.3;
    if (/innerHTML|textContent|innerText|\.value\s*=|appendChild|createElement|querySelector|getElementById/.test(src)) score += 0.25;
    if (/(fetch|XMLHttpRequest|localStorage\.setItem|indexedDB|Math\.random|\+\+|\+=|-=)/.test(src)) score -= 0.25;
    out.push({ path, owner, fn, label: path.join('.') + '()', score: Math.round(score * 100) / 100, touchesDom: /innerHTML|textContent|innerText|appendChild|getElementById|querySelector/.test(src), mutates: /(\+\+|\+=|-=|localStorage\.setItem)/.test(src) });
  };
  let names = [];
  try {
    names = Object.getOwnPropertyNames(win);
  } catch {
    return out;
  }
  for (const k of names) {
    let d;
    try {
      d = Object.getOwnPropertyDescriptor(win, k);
    } catch {
      continue;
    }
    if (!d || !('value' in d)) continue;
    const v = d.value;
    if (typeof v === 'function') consider(v, [k], win);
    else if (v && typeof v === 'object' && /^(game|Game|ui|UI|hud|view|app|App|screen|display|main|store|shop|manager|Main)$/.test(k)) {
      let keys = [];
      try {
        keys = [...Object.keys(v), ...Object.getOwnPropertyNames(Object.getPrototypeOf(v) || {})];
      } catch {
        keys = [];
      }
      for (const m of keys.slice(0, 200)) {
        try {
          const md = Object.getOwnPropertyDescriptor(v, m) || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(v), m);
          if (md && 'value' in md) consider(md.value, [k, m], v);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 12);
}

const nextFrame = (win) => new Promise((r) => (win.requestAnimationFrame ? win.requestAnimationFrame(() => win.setTimeout(r, 60)) : win.setTimeout(r, 80)));

/**
 * Is the new value on screen? Returns
 *   {state: 'shown'|'stale'|'auto'|'unknown', detail}
 */
export async function checkDisplay(win, { newValue, oldValue, renderer }) {
  await nextFrame(win);
  if (renderer.kind === 'engine-loop') return { state: 'auto', detail: `The game redraws every frame (${renderer.name}), so the new value appears on its next frame.` };
  const showsNew = findOnScreen(win, newValue).length;
  const showsOld = oldValue !== undefined && String(oldValue) !== String(newValue) ? findOnScreen(win, oldValue).length : 0;
  if (showsNew && !showsOld) return { state: 'shown', detail: `The screen now shows ${newValue}.` };
  if (showsOld) return { state: 'stale', detail: `The game state has ${newValue}, but the screen still shows ${oldValue}. This game redraws that part of the screen later (often when you switch screens).` };
  if (renderer.kind === 'canvas') return { state: 'unknown', detail: 'The game draws on a canvas, which cannot be read. Most canvas games redraw every frame.' };
  return { state: 'unknown', detail: `Neither the old nor the new value is visible on this screen right now.` };
}

/** Call one redraw candidate and report whether the screen changed. */
export async function tryRedraw(win, cand, { newValue, oldValue, renderer }) {
  try {
    cand.fn.call(cand.owner);
  } catch (e) {
    return { ok: false, state: 'error', detail: `${cand.label} threw an error: ${e && e.message}` };
  }
  const r = await checkDisplay(win, { newValue, oldValue, renderer });
  return { ok: r.state === 'shown', ...r, detail: r.state === 'shown' ? `${cand.label} redrew the screen: it now shows ${newValue}.` : `${cand.label} ran, but ${r.detail.charAt(0).toLowerCase()}${r.detail.slice(1)}` };
}

/**
 * Display-only fallback: replace the old number with the new one in exactly the
 * visible text the game wrote. It changes nothing in the game; the game's next
 * redraw writes the real value (which is the same).
 */
export function patchVisibleNumber(win, oldValue, newValue) {
  const doc = win.document;
  const formsOld = [...displayForms(oldValue)].sort((a, b) => b.length - a.length);
  let changed = 0;
  for (const el of findOnScreen(win, oldValue)) {
    for (const node of el.childNodes) {
      if (node.nodeType !== 3) continue;
      for (const f of formsOld) {
        const re = new RegExp(`(^|[^\\d.,])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d]|[.,]\\d)`);
        const plain = node.nodeValue.replace(/[\u202f\u00a0]/g, ' ');
        if (re.test(plain)) {
          node.nodeValue = plain.replace(re, (m, pre) => `${pre}${typeof newValue === 'number' ? newValue.toLocaleString(doc.documentElement.lang || undefined) : newValue}`);
          changed++;
          break;
        }
      }
    }
    if (el.tagName === 'INPUT' && String(el.value) === String(oldValue)) {
      el.value = String(newValue);
      changed++;
    }
  }
  return changed;
}

/** Engine-provided, known-safe redraws (used automatically after edits). */
export function engineRedraw(win, engineId) {
  try {
    if (engineId === 'rpgmaker' && win.SceneManager && win.SceneManager._scene) {
      const scene = win.SceneManager._scene;
      const layer = scene._windowLayer;
      const wins = layer && layer.children ? layer.children : [];
      let n = 0;
      for (const w of wins) if (w && typeof w.refresh === 'function') (w.refresh(), n++);
      return n ? { label: `RPG Maker window refresh (${n} windows)` } : null;
    }
  } catch {
    return null;
  }
  return null;
}
