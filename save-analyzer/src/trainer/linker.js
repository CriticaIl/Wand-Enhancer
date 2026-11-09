// Button & Textbox Linker: inspect what a game's interactive element is wired to,
// and (only when the user confirms) remap it to another compatible action.
//
// What a web page can honestly know about an element's behaviour:
//   - inline handler attributes (onclick="buy()")            → confirmed
//   - handler properties (el.onclick = fn)                   → confirmed
//   - jQuery's own event registry (jQuery._data(el,'events')) → confirmed
//   - addEventListener listeners added after recording started → confirmed (recorded)
//   - listeners on ancestors (document/body) → possible (event delegation)
//   - variables written by handler code (static reading of the source) → likely
//   - variables that changed after the user tapped / typed once → confirmed (observed)
//   - engine conventions (SugarCube data-passage links, textbox-<var> ids) → confirmed / likely
// Listeners added with addEventListener *before* recording started cannot be listed
// by any page script (browsers expose them only to DevTools). That is said, not guessed.
//
// Safety: inspecting never runs game code (functions are read with toString, never
// called) and the inspect tap is swallowed before the game sees it. Remappings are
// applied only after confirmation, are undoable, and stop when disabled.

const INTERACTIVE = 'button, a, input, select, textarea, summary, label, [role=button], [role=link], [role=checkbox], [role=menuitem], [role=option], [onclick], [data-passage], [tabindex]';
const POINTER_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'];
const HANDLER_TYPES = ['click', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'input', 'change', 'keydown', 'keyup', 'submit', 'focus', 'blur'];
const RISKY = /(buy|purchase|pay|spend|order|checkout|acheter|achat|payer|kaufen|bezahlen|comprar|pagar|compra|acquista|купить|購入|买|구매|delete|remove|erase|wipe|reset|clear|restart|new ?game|format|supprimer|effacer|réinitialiser|recommencer|löschen|zurücksetzen|borrar|reiniciar|eliminar|cancella|удалить|сброс|削除|リセット|删除|重置|삭제|초기화)/i;
const NAV_KEYS = /^(Enter| )$/;

export function elementKind(el) {
  const tag = el.tagName;
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (tag === 'CANVAS') return 'canvas';
  if (tag === 'SELECT') return 'select';
  if (tag === 'TEXTAREA' || el.isContentEditable) return 'textbox';
  if (tag === 'INPUT') {
    if (type === 'checkbox' || type === 'radio') return type;
    if (type === 'range') return 'range';
    if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
    if (['hidden', 'file', 'color'].includes(type)) return 'other';
    return 'textbox';
  }
  if (tag === 'A') return 'link';
  if (tag === 'BUTTON' || el.getAttribute('role') === 'button' || tag === 'SUMMARY') return 'button';
  if (el.getAttribute('role') === 'checkbox') return 'checkbox';
  return el.hasAttribute('onclick') || el.hasAttribute('data-passage') ? 'button' : 'other';
}
const CLICKY = new Set(['button', 'link', 'other']);

/** The interactive element a tap on `target` meant (a label means its control). */
export function interactiveFor(target, host) {
  let el = target && target.nodeType === 1 ? target : target?.parentElement;
  if (!el || (host && host.contains(el))) return null;
  if (el.tagName === 'CANVAS') return el;
  const hit = el.closest(INTERACTIVE);
  if (hit && hit.tagName === 'LABEL' && hit.control) return hit.control;
  return hit || el;
}

export function labelOf(el) {
  const t = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const kind = elementKind(el);
  if (kind === 'textbox' || kind === 'select' || kind === 'range') {
    const lab = el.labels && el.labels[0] ? t(el.labels[0].textContent) : '';
    return lab || t(el.getAttribute('aria-label')) || t(el.getAttribute('placeholder')) || t(el.name) || t(el.id) || el.tagName.toLowerCase();
  }
  if (kind === 'checkbox' || kind === 'radio') return (el.labels && el.labels[0] ? t(el.labels[0].textContent) : '') || t(el.getAttribute('aria-label')) || t(el.name) || t(el.id) || kind;
  return (t(el.getAttribute('aria-label')) || t(el.value && el.tagName === 'INPUT' ? el.value : '') || t(el.textContent) || t(el.title) || t(el.id) || el.tagName.toLowerCase()).slice(0, 60);
}

/** A selector that finds the element again, also after the game re-renders it. */
export function selectorFor(el, win) {
  const esc = (s) => (win.CSS && win.CSS.escape ? win.CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'));
  const doc = el.ownerDocument;
  const unique = (sel) => {
    try {
      const all = doc.querySelectorAll(sel);
      return all.length === 1 && all[0] === el;
    } catch {
      return false;
    }
  };
  if (el.id && unique(`#${esc(el.id)}`)) return `#${esc(el.id)}`;
  const own = (e) => {
    let s = e.tagName.toLowerCase();
    const name = e.getAttribute('name');
    if (name && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.tagName)) return `${s}[name="${esc(name)}"]`;
    for (const a of e.attributes) {
      if (/^data-/.test(a.name) && a.value.length && a.value.length <= 40 && !/^data-(v-|reactid)/.test(a.name)) return `${s}[${a.name}="${esc(a.value)}"]`;
    }
    return s;
  };
  // nearest ancestor with an id + the element's own distinguishing attribute
  let anchor = el.parentElement;
  while (anchor && !anchor.id && anchor !== doc.body) anchor = anchor.parentElement;
  const prefix = anchor && anchor.id ? `#${esc(anchor.id)} ` : '';
  const short = `${prefix}${own(el)}`;
  if (unique(short)) return short;
  // full path with nth-of-type
  const parts = [];
  for (let e = el; e && e.nodeType === 1 && e !== doc.documentElement; e = e.parentElement) {
    if (e.id && unique(`#${esc(e.id)}`)) {
      parts.unshift(`#${esc(e.id)}`);
      break;
    }
    let s = own(e);
    const parent = e.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === e.tagName);
      if (same.length > 1) s += `:nth-of-type(${same.indexOf(e) + 1})`;
    }
    parts.unshift(s);
  }
  return parts.join(' > ');
}

function fnSource(fn) {
  try {
    const s = Function.prototype.toString.call(fn);
    return /\[native code\]/.test(s) ? null : s;
  } catch {
    return null;
  }
}
function shortCode(s, n = 160) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

const CHAIN = String.raw`(?:window\.|this\.)?[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*|\[\s*(?:\d+|'[^']*'|"[^"]*")\s*\])*`;
const CALL_RE = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'function', 'catch', 'typeof', 'new', 'with', 'do', 'else', 'var', 'let', 'const', 'await', 'async', 'yield', 'delete', 'void', 'in', 'of', 'instanceof']);

function normChain(c) {
  return c
    .replace(/\s+/g, '')
    .replace(/^window\./, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\[['"]([^'"]*)['"]\]/g, '.$1');
}

/** Variables assigned / incremented in a piece of code (static reading only). */
export function writesIn(code) {
  const out = [];
  const src = String(code);
  const assign = new RegExp(`(${CHAIN})\\s*(\\+\\+|--|[-+*/%]?=(?!=))\\s*([^;\\n]*)`, 'g');
  // a chain right after ".", ")" or "]" is a property of a call result (el.textContent = …), not a variable
  const prop = (i) => i > 0 && /[\w$.)\]]/.test(src[i - 1]);
  for (const m of src.matchAll(assign)) {
    if (prop(m.index)) continue;
    const chain = normChain(m[1]);
    if (/^(this|e|ev|event|evt)\./.test(chain) && !/^this\.value/.test(chain)) continue;
    out.push({ chain, op: m[2], rhs: shortCode(m[3], 60) });
  }
  for (const m of src.matchAll(new RegExp(`(\\+\\+|--)\\s*(${CHAIN})`, 'g'))) if (!prop(m.index)) out.push({ chain: normChain(m[2]), op: m[1], rhs: '' });
  return out.filter((w) => w.chain.includes('.') || !/^(i|j|k|n|x|y|e|ev|el|v|t)$/.test(w.chain));
}
export function callsIn(code) {
  const out = new Set();
  for (const m of String(code).matchAll(CALL_RE)) if (!KEYWORDS.has(m[1])) out.add(m[1]);
  return [...out];
}

// ---------------------------------------------------------------- listener recording
const REC = new WeakMap(); // EventTarget -> [{type, fn, capture, at}]
let recording = null;

/** Records addEventListener calls from now on (call the returned stop() to restore). */
export function startRecording(win) {
  if (win.__saveforgeLinkerRec) return win.__saveforgeLinkerRec;
  const proto = win.EventTarget && win.EventTarget.prototype;
  if (!proto) return null;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  const since = Date.now();
  const wrappedAdd = function (type, fn, opt) {
    try {
      if (fn && !(fn && fn.__saveforge)) {
        const list = REC.get(this) || [];
        if (list.length < 200) list.push({ type: String(type), fn, capture: !!(opt === true || (opt && opt.capture)), at: Date.now() });
        REC.set(this, list);
      }
    } catch {
      /* recording is best-effort */
    }
    return add.call(this, type, fn, opt);
  };
  const wrappedRemove = function (type, fn, opt) {
    try {
      const list = REC.get(this);
      if (list) {
        const i = list.findIndex((l) => l.type === String(type) && l.fn === fn);
        if (i >= 0) list.splice(i, 1);
      }
    } catch {
      /* ignore */
    }
    return remove.call(this, type, fn, opt);
  };
  proto.addEventListener = wrappedAdd;
  proto.removeEventListener = wrappedRemove;
  recording = {
    since,
    stop() {
      if (proto.addEventListener === wrappedAdd) proto.addEventListener = add;
      if (proto.removeEventListener === wrappedRemove) proto.removeEventListener = remove;
      delete win.__saveforgeLinkerRec;
      recording = null;
    },
  };
  win.__saveforgeLinkerRec = recording;
  return recording;
}

function recorded(target) {
  try {
    return REC.get(target) || [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- analysis

/**
 * Describes what an element is connected to. Never calls game code.
 * @param ctx {win, provider?}  provider: the live trainer provider (for variable links)
 */
export function inspectElement(el, ctx) {
  const { win } = ctx;
  const doc = win.document;
  const kind = elementKind(el);
  const info = {
    el,
    kind,
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type') || '',
    label: labelOf(el),
    id: el.id || '',
    selector: selectorFor(el, win),
    value: kind === 'checkbox' || kind === 'radio' ? !!el.checked : 'value' in el ? String(el.value ?? '') : null,
    confirmed: [], // {source, text, code?, fn?}
    likely: [], // {source, text, code?}
    possible: [],
    effects: [], // {chain, id?, op, rhs, via, certainty}
    binding: { confirmed: [], likely: [], possible: [] }, // inputs: {id, path, text}
    limits: [],
    risky: null,
    canvas: kind === 'canvas',
  };
  const vars = variableIndex(ctx.provider);
  const fnsSeen = new Set();
  const analyse = (code, via, certainty, depth = 0) => {
    if (!code || depth > 2) return;
    for (const w of writesIn(code)) {
      if (/^this\.value$/.test(w.chain)) continue;
      const id = vars.byChain(w.chain);
      if (!info.effects.some((x) => x.chain === w.chain && x.op === w.op)) info.effects.push({ ...w, id: id?.id || null, idCertainty: id?.how || null, via, certainty });
      if ((kind === 'textbox' || kind === 'select' || kind === 'range' || kind === 'checkbox') && /this\.(value|checked)|\.target\.(value|checked)/.test(w.rhs) && w.op === '=') {
        info.binding.likely.push({ id: id?.id || null, chain: w.chain, text: `handler code assigns the ${/checked/.test(w.rhs) ? 'checked state' : 'value'} to ${w.chain}${id ? '' : ' (not found among the scanned variables)'}` });
      }
    }
    for (const name of callsIn(code)) {
      if (fnsSeen.has(name)) continue;
      let f;
      try {
        f = Object.getOwnPropertyDescriptor(win, name)?.value;
      } catch {
        f = undefined;
      }
      if (typeof f !== 'function') continue;
      const src = fnSource(f);
      if (!src) continue;
      fnsSeen.add(name);
      info.calls = info.calls || [];
      info.calls.push({ name, via, code: shortCode(src, 240), certainty });
      analyse(src, `${name}()`, certainty === 'confirmed' ? 'likely' : 'possible', depth + 1);
    }
  };

  // 1. inline attributes and handler properties
  for (const a of el.attributes) {
    if (!/^on[a-z]+$/.test(a.name)) continue;
    info.confirmed.push({ source: `inline ${a.name} attribute`, text: `runs ${shortCode(a.value, 120)}`, code: a.value });
    analyse(a.value, a.name, 'confirmed');
  }
  for (const t of HANDLER_TYPES) {
    if (el.hasAttribute(`on${t}`)) continue;
    let f;
    try {
      f = el[`on${t}`];
    } catch {
      f = null;
    }
    if (typeof f !== 'function') continue;
    const name = globalNameOf(win, f);
    const src = fnSource(f);
    info.confirmed.push({ source: `${t} handler property`, text: name ? `calls ${name}()` : `runs ${shortCode(src || 'a function', 120)}`, code: src, fn: name });
    if (name) {
      info.calls = info.calls || [];
      info.calls.push({ name, via: `on${t}`, code: shortCode(src || '', 240), certainty: 'confirmed' });
      fnsSeen.add(name);
    }
    analyse(src, `on${t}`, 'confirmed');
  }
  // 2. jQuery registry
  const jq = safe(() => win.jQuery && win.jQuery._data && win.jQuery._data(el, 'events'));
  if (jq) {
    for (const [type, hs] of Object.entries(jq)) {
      for (const hd of hs || []) {
        const src = fnSource(hd.handler);
        info.confirmed.push({ source: `jQuery ${type} handler`, text: `runs ${shortCode(src || 'a function', 120)}`, code: src });
        analyse(src, `jQuery ${type}`, 'confirmed');
      }
    }
  }
  // 3. recorded listeners
  for (const l of recorded(el)) {
    const src = fnSource(l.fn);
    const name = globalNameOf(win, l.fn);
    info.confirmed.push({ source: `${l.type} listener (recorded)`, text: name ? `calls ${name}()` : `runs ${shortCode(src || 'a function', 120)}`, code: src, fn: name });
    analyse(src, `${l.type} listener`, 'confirmed');
  }
  // 4. engines
  const passage = el.getAttribute('data-passage');
  if (passage) info.confirmed.push({ source: 'SugarCube link', text: `goes to passage “${passage}”` });
  if (kind === 'link') {
    const href = el.getAttribute('href') || '';
    if (/^javascript:/i.test(href)) {
      info.confirmed.push({ source: 'javascript: link', text: `runs ${shortCode(href.slice(11), 120)}`, code: href.slice(11) });
      analyse(href.slice(11), 'href', 'confirmed');
    } else if (href && href !== '#' && !passage) info.confirmed.push({ source: 'link', text: `opens ${shortCode(href, 80)}` });
  }
  const sc = /^(textbox|checkbox|radiobutton|listbox|numberbox|textarea)-(.+)$/.exec(el.id || el.name || '');
  if (sc && safe(() => win.SugarCube && win.SugarCube.State)) {
    const m = ctx.provider ? findEntry(ctx.provider, (e) => e.key === sc[2] || e.key.toLowerCase() === sc[2].replace(/-/g, '')) : null;
    info.binding.likely.push({ id: m?.nodeId || null, chain: `$${sc[2]}`, text: `SugarCube ${sc[1]} macro for $${sc[2]} (from its id)` });
  }
  // 5. delegated listeners on ancestors (the game may handle every click under them)
  for (let a = el.parentElement, depth = 0; a; a = a.parentElement, depth++) checkAncestor(a, depth);
  checkAncestor(doc, 'document');
  checkAncestor(win, 'window');
  function checkAncestor(a, where) {
    const name = a === win ? 'window' : a === doc ? 'document' : `<${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''}>`;
    const handlers = [];
    if (a.nodeType === 1) for (const at of a.attributes) if (/^on(click|pointerdown|mousedown|touchstart|input|change)$/.test(at.name)) handlers.push({ how: `inline ${at.name}`, code: at.value });
    for (const t of ['click', 'pointerdown', 'mousedown', 'touchstart', 'input', 'change']) {
      if (a.nodeType === 1 && a.hasAttribute(`on${t}`)) continue;
      const f = safe(() => a[`on${t}`]);
      if (typeof f === 'function') handlers.push({ how: `on${t} property`, code: fnSource(f) });
    }
    for (const l of recorded(a)) if (/^(click|pointer|mouse|touch|input|change)/.test(l.type)) handlers.push({ how: `${l.type} listener (recorded)`, code: fnSource(l.fn) });
    const ajq = safe(() => win.jQuery && win.jQuery._data && win.jQuery._data(a, 'events'));
    if (ajq) for (const [type, hs] of Object.entries(ajq)) for (const hd of hs || []) if (!hd.selector || safe(() => el.matches(hd.selector))) handlers.push({ how: `jQuery ${type}${hd.selector ? ` for “${hd.selector}”` : ''}`, code: fnSource(hd.handler), matched: !!hd.selector });
    for (const hd of handlers) {
      const refs = mentions(hd.code || '', el);
      const target = refs.length ? 'likely' : 'possible';
      const text = `${name} ${hd.how} ${refs.length ? `checks ${refs.join(', ')} — probably handles this element` : 'handles events from everything inside it (delegation)'}`;
      (hd.matched ? info.confirmed : info[target]).push({ source: `delegated (${name})`, text, code: hd.code });
      if (refs.length || hd.matched) analyse(hd.code, `${name} listener`, hd.matched ? 'confirmed' : 'possible');
    }
  }
  // 6. inputs: variables holding the same value / similar name (possible)
  if (ctx.provider && (kind === 'textbox' || kind === 'select' || kind === 'range' || kind === 'checkbox')) {
    const want = kind === 'checkbox' ? 'bool' : kind === 'range' ? 'number' : 'any';
    const v = info.value;
    const keyHint = [el.id, el.name, el.getAttribute('placeholder'), labelOf(el)].filter(Boolean).join(' ').toLowerCase();
    for (const e of ctx.provider.entries || []) {
      const node = ctx.provider.node(e.nodeId);
      if (!node || !compatibleType(node.type, want)) continue;
      const cur = safe(() => ctx.provider.value(e.nodeId));
      const sameValue = kind === 'checkbox' ? false : typeof cur === 'string' ? cur !== '' && cur === v : typeof cur === 'number' && v !== '' && Number(v) === cur;
      const nameHit = e.key.length > 2 && keyHint.includes(e.key.toLowerCase());
      if (sameValue || nameHit) {
        if (info.binding.likely.some((b) => b.id === e.nodeId)) continue;
        info.binding.possible.push({ id: e.nodeId, chain: e.path, text: sameValue ? `holds the same ${typeof cur === 'number' ? 'number' : 'text'} as the field right now` : `its name “${e.key}” matches the field` });
      }
      if (info.binding.possible.length >= 8) break;
    }
  }
  // 7. limits and risk
  if (!recording) info.limits.push('Listeners the game added with addEventListener before the Linker started cannot be listed by any web page (only browser developer tools see them). Use “Watch one tap” to see what the element really changes.');
  else info.limits.push(`Listeners added before recording started (${new Date(recording.since).toLocaleTimeString()}) cannot be listed. Use “Watch one tap” to observe the real effect.`);
  if (info.canvas) info.limits.unshift('This is a canvas: the game draws its buttons as pixels, so they are not page elements and cannot be inspected or remapped one by one. Live variable editing and Find a value still work.');
  const riskText = `${info.label} ${info.calls?.map((c) => c.name).join(' ') || ''} ${info.confirmed.map((c) => c.code || '').join(' ')}`;
  const r = RISKY.exec(riskText);
  if (r) info.risky = `This element looks like it may spend currency or erase progress (“${r[1]}”). Inspecting is safe; tapping it or watching a tap runs it.`;
  if (!info.confirmed.length && !info.likely.length && !info.possible.length && !info.canvas) info.possible.push({ source: 'none found', text: 'No accessible handler on this element or its parents.' });
  return info;
}

function mentions(code, el) {
  if (!code) return [];
  const out = [];
  if (el.id && new RegExp(`['"\`#]${escapeRe(el.id)}['"\`]`).test(code)) out.push(`#${el.id}`);
  for (const c of el.classList || []) if (c.length > 2 && new RegExp(`['"\`.]${escapeRe(c)}['"\`\\s]`).test(code)) out.push(`.${c}`);
  for (const a of el.attributes || []) if (/^data-/.test(a.name) && code.includes(a.name)) out.push(`[${a.name}]`);
  if (el.name && new RegExp(`['"]${escapeRe(el.name)}['"]`).test(code)) out.push(`name=${el.name}`);
  return out;
}
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function globalNameOf(win, fn) {
  if (!fn || !fn.name) return null;
  try {
    return Object.getOwnPropertyDescriptor(win, fn.name)?.value === fn ? fn.name : null;
  } catch {
    return null;
  }
}
function compatibleType(t, want) {
  if (want === 'bool') return t === 'bool';
  if (want === 'number') return t === 'int' || t === 'float';
  return t === 'string' || t === 'int' || t === 'float';
}
function findEntry(p, fn) {
  return (p.entries || []).find(fn) || null;
}
function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Maps JS property chains from game code to trainer variable ids. */
function variableIndex(p) {
  const exact = new Map();
  const tail = new Map();
  for (const e of p?.entries || []) {
    const segs = e.nodeId.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (p.engine && p.engine.id === 'generic') exact.set(segs.join('.'), e.nodeId);
    if (segs.length >= 2) {
      const k = segs.slice(-2).join('.');
      tail.set(k, tail.has(k) ? null : e.nodeId); // ambiguous tails are not used
    }
  }
  return {
    byChain(chain) {
      const c = chain.replace(/^this\./, '');
      if (exact.has(c)) return { id: exact.get(c), how: 'exact' };
      const segs = c.split('.');
      if (segs.length >= 2) {
        const t = tail.get(segs.slice(-2).join('.'));
        if (t) return { id: t, how: 'name' };
      }
      return null;
    },
  };
}

// ---------------------------------------------------------------- actions & remapping

/** Compatible actions an element could be linked to. */
export function candidatesFor(info, ctx) {
  const { win } = ctx;
  const doc = win.document;
  const out = [];
  if (CLICKY.has(info.kind) || info.kind === 'radio') {
    out.push({ kind: 'block', target: '', label: 'Do nothing (cancel this button)', detail: 'Taps on it are swallowed; the game does not react.' });
    const seen = new Set([info.el]);
    for (const el of doc.querySelectorAll('button, a, input[type=button], input[type=submit], [role=button], [onclick], [data-passage]')) {
      if (seen.has(el) || (ctx.host && ctx.host.contains(el)) || !visible(el, win)) continue;
      seen.add(el);
      const label = labelOf(el);
      if (!label) continue;
      const brief = briefHandler(el, win);
      out.push({ kind: 'element', target: selectorFor(el, win), label: `Same as tapping “${label}”`, detail: brief || 'Does whatever that element does (SaveForge taps it for you).', risky: RISKY.test(label) ? 'may spend currency or erase progress' : null });
      if (out.length > 60) break;
    }
    for (const f of gameFunctions(win)) out.push({ kind: 'function', target: f.name, label: `Call ${f.name}()`, detail: shortCode(f.code, 120), risky: RISKY.test(f.name) ? 'may spend currency or erase progress' : null });
    const SC = safe(() => win.SugarCube);
    const passages = SC && safe(() => (SC.Story && typeof SC.Story.lookupWith === 'function' ? SC.Story.lookupWith(() => true).map((p) => p.title) : null));
    if (passages && SC.Engine && typeof SC.Engine.play === 'function') for (const t of passages.slice(0, 80)) out.push({ kind: 'passage', target: t, label: `Go to passage “${t}”`, detail: 'SugarCube Engine.play()' });
  }
  if (['textbox', 'select', 'range', 'checkbox'].includes(info.kind) && ctx.provider) {
    const want = info.kind === 'checkbox' ? 'bool' : info.kind === 'range' ? 'number' : 'any';
    const ranked = [...info.binding.likely, ...info.binding.possible].map((b) => b.id).filter(Boolean);
    const entries = (ctx.provider.entries || []).filter((e) => {
      const n = ctx.provider.node(e.nodeId);
      return n && n.editable && compatibleType(n.type, want);
    });
    entries.sort((a, b) => (ranked.includes(b.nodeId) ? 1 : 0) - (ranked.includes(a.nodeId) ? 1 : 0));
    for (const e of entries.slice(0, 150)) out.push({ kind: 'variable', target: e.nodeId, label: `Write to ${e.path.replace(/^window › /, '')}`, detail: `now ${shortCode(String(safe(() => ctx.provider.value(e.nodeId))), 40)}${ranked.includes(e.nodeId) ? ' · suggested by the inspection' : ''}` });
    if (info.kind !== 'checkbox') out.unshift({ kind: 'block', target: '', label: 'Ignore input (the game does not receive it)', detail: 'Typing still works in the field, but the game’s input/change handlers are not called.' });
  }
  return out;
}

function visible(el, win) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = win.getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}
function briefHandler(el, win) {
  const on = el.getAttribute('onclick');
  if (on) return `onclick: ${shortCode(on, 60)}`;
  const f = safe(() => el.onclick);
  if (typeof f === 'function') return `onclick: ${globalNameOf(win, f) ? `${globalNameOf(win, f)}()` : shortCode(fnSource(f) || 'function', 60)}`;
  if (el.getAttribute('data-passage')) return `passage “${el.getAttribute('data-passage')}”`;
  return '';
}
/** Zero-argument functions the page defines itself (never called during listing). */
export function gameFunctions(win, limit = 40) {
  const out = [];
  let names = [];
  try {
    names = Object.getOwnPropertyNames(win);
  } catch {
    return out;
  }
  for (const n of names) {
    if (/^(on|webkit|__saveforge|_|\$)/.test(n) || n.length < 3) continue;
    let f;
    try {
      f = Object.getOwnPropertyDescriptor(win, n)?.value;
    } catch {
      continue;
    }
    if (typeof f !== 'function' || f.length !== 0) continue;
    const code = fnSource(f);
    if (!code || /^class\b/.test(code) || /^[A-Z]/.test(n)) continue;
    out.push({ name: n, code });
    if (out.length >= limit) break;
  }
  return out;
}

const describeAction = (a) => (a.kind === 'block' ? a.label : a.label);

/**
 * Remapping engine. Mappings: {id, selector, label, kind, action:{kind, target, label}, mode, remember}
 * Applied through capture listeners on the window, matched by selector at event
 * time (so re-rendered buttons stay remapped). Nothing is intercepted while no
 * mapping is active or when mappings are disabled.
 */
export function createLinker(win, { store, key, getProvider, host, onChange = () => {}, onError = () => {} }) {
  const doc = win.document;
  let mappings = [];
  let enabled = true;
  let autoApply = false;
  const history = [];
  let replaying = 0;
  let installed = false;
  let seq = 0;

  const mine = (fn) => ((fn.__saveforge = true), fn);
  const matchFor = (e, wantClick) => {
    if (!enabled || replaying) return null;
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    if (!t || t.nodeType !== 1 || (host && host.contains(t))) return null;
    for (const m of mappings) {
      if (!m.active) continue;
      if ((m.kindGroup === 'click') !== wantClick) continue;
      let el = null;
      try {
        el = t.closest(m.selector);
      } catch {
        el = null;
      }
      if (el) return { m, el };
    }
    return null;
  };
  const onPointer = mine((e) => {
    const hit = matchFor(e, true);
    if (hit) e.stopImmediatePropagation(); // the game's own pointer handlers do not run; click still follows
  });
  const onClick = mine((e) => {
    const hit = matchFor(e, true);
    if (!hit) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    run(hit.m, hit.el);
  });
  const onKey = mine((e) => {
    if (!NAV_KEYS.test(e.key)) return;
    const hit = matchFor(e, true);
    if (hit && hit.el.tagName !== 'BUTTON' && hit.el.tagName !== 'A' && hit.el.tagName !== 'INPUT') {
      // custom elements (div role=button) activated by keyboard
      e.stopImmediatePropagation();
      e.preventDefault();
      run(hit.m, hit.el);
    }
  });
  const onInput = mine((e) => {
    const hit = matchFor(e, false);
    if (!hit) return;
    const { m, el } = hit;
    if (m.action.kind === 'variable') {
      const p = getProvider();
      if (p && p.write) {
        try {
          const node = p.node(m.action.target);
          let v = el.type === 'checkbox' || el.type === 'radio' ? !!el.checked : el.value;
          if (node && (node.type === 'int' || node.type === 'float')) {
            v = Number(v);
            if (!Number.isFinite(v)) return;
            if (node.type === 'int') v = Math.round(v);
          }
          if (node && node.type === 'bool') v = !!(typeof v === 'boolean' ? v : v && v !== 'false' && v !== '0');
          if (node && node.type === 'string') v = String(v);
          p.write(m.action.target, v);
          m.lastWrite = { value: v, at: Date.now() };
        } catch (err) {
          onError(`Linker could not write the variable: ${err.message}`);
        }
      }
    }
    if (m.mode === 'replace' || m.action.kind === 'block') e.stopImmediatePropagation();
  });

  function install() {
    if (installed) return;
    installed = true;
    for (const t of POINTER_EVENTS) win.addEventListener(t, onPointer, true);
    win.addEventListener('click', onClick, true);
    win.addEventListener('keydown', onKey, true);
    win.addEventListener('input', onInput, true);
    win.addEventListener('change', onInput, true);
  }
  function uninstall() {
    if (!installed) return;
    installed = false;
    for (const t of POINTER_EVENTS) win.removeEventListener(t, onPointer, true);
    win.removeEventListener('click', onClick, true);
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('input', onInput, true);
    win.removeEventListener('change', onInput, true);
  }
  function sync() {
    if (enabled && mappings.some((m) => m.active)) install();
    else uninstall();
    onChange();
  }

  function run(m, el) {
    const a = m.action;
    m.runs = (m.runs || 0) + 1;
    try {
      if (a.kind === 'block') return;
      if (a.kind === 'element') {
        const target = doc.querySelector(a.target);
        if (!target) throw new Error(`“${a.label}” is not on the screen right now`);
        if (target === el) throw new Error('the target is the same element');
        replaying++;
        try {
          target.click();
        } finally {
          replaying--;
        }
        return;
      }
      if (a.kind === 'function') {
        const f = Object.getOwnPropertyDescriptor(win, a.target)?.value;
        if (typeof f !== 'function') throw new Error(`${a.target}() no longer exists`);
        f.call(win);
        return;
      }
      if (a.kind === 'passage') {
        win.SugarCube.Engine.play(a.target);
      }
    } catch (err) {
      onError(`Linked action failed: ${err.message}`);
    }
  }

  async function persist() {
    if (!store) return;
    const saved = mappings.filter((m) => m.remember).map(({ el, runs, lastWrite, active, ...m }) => m);
    try {
      await store.set(key, { autoApply, mappings: saved });
    } catch {
      /* storage unavailable (private mode): mappings stay for this session */
    }
  }
  function pushHistory(op) {
    history.push(op);
    if (history.length > 50) history.shift();
  }

  return {
    get enabled() {
      return enabled;
    },
    get autoApply() {
      return autoApply;
    },
    list: () => mappings,
    history: () => history,
    /** Loads saved mappings; they are applied only if the user chose "apply automatically". */
    async load() {
      if (!store) return { applied: 0, saved: 0 };
      let saved = null;
      try {
        saved = await store.get(key, null);
      } catch {
        saved = null;
      }
      if (!saved) return { applied: 0, saved: 0 };
      autoApply = !!saved.autoApply;
      for (const m of saved.mappings || []) if (!mappings.some((x) => x.id === m.id)) mappings.push({ ...m, remember: true, active: autoApply });
      seq = mappings.length;
      sync();
      return { applied: autoApply ? mappings.length : 0, saved: mappings.length };
    },
    preview(info, action, mode = 'replace') {
      const original = info.confirmed.length ? info.confirmed.map((c) => `${c.source}: ${c.text}`) : info.likely.length ? info.likely.map((c) => `${c.source}: ${c.text}`) : ['No confirmed handler (the game may still react through listeners SaveForge cannot list).'];
      const warnings = [];
      if (action.risky) warnings.push(`The new action ${action.risky}.`);
      if (info.risky) warnings.push(info.risky);
      if (action.kind === 'element') warnings.push('SaveForge will tap the other element for you each time this one is tapped. If that element is not on screen, nothing happens.');
      if (action.kind === 'function') warnings.push(`${action.target}() is called with no arguments. If the game expects arguments, it may misbehave; Undo restores the original.`);
      if (action.kind === 'variable') warnings.push(mode === 'replace' ? 'What you type goes into the variable only; the game’s own input handlers are not called.' : 'What you type also goes into the variable; the game’s own handlers keep working.');
      const groupClick = action.kind !== 'variable' && !(['textbox', 'select', 'range'].includes(info.kind) && action.kind === 'block');
      return {
        element: `${info.label} (${info.kind}, ${info.selector})`,
        from: original,
        to: action.kind === 'variable' ? `${action.label} on every change${mode === 'also' ? ', plus the original behaviour' : ''}` : `${describeAction(action)}${action.detail ? ` — ${action.detail}` : ''}`,
        warnings,
        mapping: {
          selector: info.selector,
          label: info.label,
          kind: info.kind,
          kindGroup: groupClick ? 'click' : 'input',
          action: { kind: action.kind, target: action.target, label: action.label },
          mode: action.kind === 'variable' ? mode : 'replace',
        },
      };
    },
    /** Applies a confirmed mapping (replaces an existing one for the same element). */
    apply(mapping, { remember = false } = {}) {
      const m = { ...mapping, id: `m${Date.now().toString(36)}${seq++}`, remember, active: true, createdAt: Date.now() };
      const i = mappings.findIndex((x) => x.selector === m.selector && x.kindGroup === m.kindGroup);
      const old = i >= 0 ? mappings[i] : null;
      if (old) mappings.splice(i, 1, m);
      else mappings.push(m);
      pushHistory({ op: old ? 'replace' : 'add', mapping: m, old });
      sync();
      persist();
      return m;
    },
    /** Restore original for one element. */
    remove(id) {
      const i = mappings.findIndex((m) => m.id === id);
      if (i < 0) return false;
      const [m] = mappings.splice(i, 1);
      pushHistory({ op: 'remove', mapping: m, index: i });
      sync();
      persist();
      return true;
    },
    setActive(id, on) {
      const m = mappings.find((x) => x.id === id);
      if (!m) return;
      m.active = !!on;
      sync();
    },
    restoreAll() {
      if (!mappings.length) return 0;
      const n = mappings.length;
      pushHistory({ op: 'clear', list: mappings.slice() });
      mappings = [];
      sync();
      persist();
      return n;
    },
    canUndo: () => history.length > 0,
    undo() {
      const h = history.pop();
      if (!h) return null;
      if (h.op === 'add') mappings = mappings.filter((m) => m.id !== h.mapping.id);
      else if (h.op === 'replace') mappings = mappings.map((m) => (m.id === h.mapping.id ? h.old : m));
      else if (h.op === 'remove') mappings.splice(Math.min(h.index, mappings.length), 0, h.mapping);
      else if (h.op === 'clear') mappings = h.list.slice();
      sync();
      persist();
      return h;
    },
    setEnabled(v) {
      enabled = !!v;
      sync();
    },
    async setAutoApply(v) {
      autoApply = !!v;
      await persist();
      onChange();
    },
    setRemember(id, v) {
      const m = mappings.find((x) => x.id === id);
      if (m) m.remember = !!v;
      persist();
    },
    /** Arms one real tap / edit on the element and reports which variables changed. */
    watch(info, { ms = 700, timeout = 30000 } = {}) {
      const p = getProvider();
      return new Promise((resolve) => {
        const before = snapshotValues(p);
        const evType = ['textbox', 'select', 'range'].includes(info.kind) ? 'change' : info.kind === 'checkbox' || info.kind === 'radio' ? 'change' : 'click';
        let timer = 0;
        const done = (res) => {
          win.removeEventListener(evType, hit, true);
          if (evType === 'change') win.removeEventListener('input', hit, true);
          win.clearTimeout(timer);
          resolve(res);
        };
        const hit = mine((e) => {
          const t = e.composedPath ? e.composedPath()[0] : e.target;
          if (!t || t.nodeType !== 1 || !(t === info.el || info.el.contains(t) || safe(() => t.closest(info.selector)))) return;
          win.removeEventListener(evType, hit, true);
          if (evType === 'change') win.removeEventListener('input', hit, true);
          win.setTimeout(() => {
            const changed = [];
            for (const [id, b] of before) {
              const a = safe(() => p.value(id));
              if (a !== b && !(Number.isNaN(a) && Number.isNaN(b))) changed.push({ id, path: p.entryById.get(id)?.path || id, before: b, after: a });
            }
            const typed = evType === 'change' ? (info.kind === 'checkbox' || info.kind === 'radio' ? !!info.el.checked : String(info.el.value)) : null;
            for (const c of changed) c.matchesInput = typed !== null && (c.after === typed || (typeof c.after === 'number' && String(c.after) === typed));
            done({ ok: true, changed, typed, provider: !!p });
          }, ms);
        });
        win.addEventListener(evType, hit, true);
        if (evType === 'change') win.addEventListener('input', hit, true);
        timer = win.setTimeout(() => done({ ok: false, timeout: true, changed: [] }), timeout);
      });
    },
    dispose() {
      uninstall();
    },
  };
}

function snapshotValues(p) {
  const m = new Map();
  if (!p || !p.entries) return m;
  for (const e of p.entries.slice(0, 20000)) {
    const n = p.node(e.nodeId);
    if (!n || !['int', 'float', 'bool', 'string'].includes(n.type)) continue;
    m.set(e.nodeId, safe(() => p.value(e.nodeId)));
  }
  return m;
}

// ---------------------------------------------------------------- inspect mode

/**
 * Lets the user pick an element. The picking tap (and the events that follow it)
 * are swallowed so the game never reacts. Returns stop().
 */
export function pickElement(win, { host, onPick, onCancel }) {
  const types = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'dblclick', 'contextmenu'];
  let picked = false;
  let stopped = false;
  const inHost = (e) => {
    const path = e.composedPath ? e.composedPath() : [e.target];
    return host && path.includes(host);
  };
  const handler = (e) => {
    if (inHost(e)) return;
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault(); // no focus, no keyboard, no link navigation, no click
    if (picked) return;
    if (!/^(pointerdown|mousedown|touchstart|click)$/.test(e.type)) return;
    picked = true;
    const pt = e.touches && e.touches[0] ? e.touches[0] : e;
    let t = e.composedPath ? e.composedPath()[0] : e.target;
    if ((!t || t.nodeType !== 1) && typeof pt.clientX === 'number') t = win.document.elementFromPoint(pt.clientX, pt.clientY);
    const el = interactiveFor(t, host);
    // keep swallowing the rest of this tap (up, click) before handing control back
    win.setTimeout(() => {
      stop();
      if (el) onPick(el);
      else onCancel && onCancel();
    }, 450);
  };
  handler.__saveforge = true;
  for (const t of types) win.addEventListener(t, handler, { capture: true, passive: false });
  function stop() {
    if (stopped) return;
    stopped = true;
    for (const t of types) win.removeEventListener(t, handler, { capture: true });
  }
  return stop;
}
