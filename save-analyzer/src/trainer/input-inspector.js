// Input Inspector (SaveForge 2.3.3): which text does the game itself check a textbox for?
// See INPUT-INSPECTOR.md. Runs only when you press Find Answers. Reads attributes, passage text and
// handler source as TEXT (never runs game code), never reads what you typed, never changes the
// field and never submits anything. Login, password and other sensitive fields are not inspected.

import { callsIn, recordedListeners } from './linker.js';

export const LIMITS = { passages: 8, text: 300000, functions: 10, fnText: 20000, candidates: 30 };

// ---------------------------------------------------------------- sensitive fields

const ALLOWED_TYPES = new Set(['', 'text', 'search', 'number', 'textarea']);
const SENSITIVE_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|username|email|tel|tel-[a-z]+|cc-[a-z-]+|street-address|address-line\d|postal-code|bday[a-z-]*|name|given-name|family-name|honorific-[a-z]+|nickname|organization|webauthn)\b/i;
const SENSITIVE_WORDS = /(passwor|passwd|\bpwd\b|passcode|\bpin\b|log[\s_-]?in|sign[\s_-]?(in|up|on)|user[\s_-]?name|\buser[\s_-]?id\b|e-?mail|account|credit|card[\s_-]?(number|no)|\bcvc\b|\bcvv\b|\biban\b|\bssn\b|social security|phone|mobile number|\botp\b|2fa|two[\s-]?factor|verification code|security code|captcha|billing|payment)/i;

function attr(el, name) {
  try {
    const v = el.getAttribute ? el.getAttribute(name) : el[name];
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}
// no lookbehind (Safari < 16.4): a reference must not continue an identifier or a property chain
export const LEAD = String.raw`(?<lead>^|[^\w$.'"])`;
function fieldType(el) {
  const tag = String(el.tagName || el.nodeName || '').toLowerCase();
  if (tag === 'textarea') return 'textarea';
  return String(attr(el, 'type') || el.type || '').toLowerCase();
}

/** Why a field must not be inspected (a login, password, payment or account field), or null. */
export function sensitiveReason(el) {
  const type = fieldType(el);
  if (type === 'password') return 'a password field';
  if (type === 'email' || type === 'tel') return `an ${type === 'email' ? 'e-mail' : 'phone'} field`;
  const ac = attr(el, 'autocomplete');
  if (ac && SENSITIVE_AUTOCOMPLETE.test(ac)) return `marked autocomplete="${ac}" (account or personal data)`;
  // game engines' own textboxes are judged by type and autocomplete only: "Enter the password"
  // puzzles in a story are game logic, not an account
  if (!engineField(el)) {
    const words = [attr(el, 'name'), attr(el, 'id'), attr(el, 'placeholder'), attr(el, 'aria-label'), labelText(el)].join(' ');
    if (SENSITIVE_WORDS.test(words)) return 'it looks like a login, account or payment field';
  }
  const form = formOf(el);
  if (form) {
    try {
      if (form.querySelector && form.querySelector('input[type=password]')) return 'it is in a form with a password field';
      const method = String(attr(form, 'method') || '').toLowerCase();
      const action = attr(form, 'action');
      if (method === 'post' || (action && /^(https?:)?\/\//i.test(action))) return 'it is in a form that sends data to a server';
    } catch {
      return 'its form could not be checked';
    }
  }
  return null;
}
function formOf(el) {
  try {
    return el.form || (el.closest ? el.closest('form') : null);
  } catch {
    return null;
  }
}
/** A textbox created by a story engine (SugarCube macro, Harlowe input, Ren'Py web input). */
export function engineField(el) {
  try {
    const cls = String(attr(el, 'class'));
    if (/\bmacro-(textbox|textarea|numberbox)\b/.test(cls)) return 'sugarcube';
    if (el.closest && el.closest('tw-story, tw-passage, tw-expression')) return 'harlowe';
    if (attr(el, 'id') === 'inputText' && el.closest && el.closest('#inputDiv')) return 'renpy';
  } catch {
    /* detached */
  }
  return null;
}
function labelText(el) {
  try {
    const id = attr(el, 'id');
    const doc = el.ownerDocument;
    if (id && doc) {
      const l = doc.querySelector(`label[for="${cssEscape(id)}"]`);
      if (l) return l.textContent.trim().slice(0, 80);
    }
    const parent = el.closest ? el.closest('label') : null;
    if (parent) return parent.textContent.trim().slice(0, 80);
  } catch {
    /* no DOM */
  }
  return '';
}
function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

/** What to call a field in the chooser: its label, placeholder, name… (never its typed text). */
export function fieldLabel(el) {
  return attr(el, 'aria-label') || labelText(el) || attr(el, 'placeholder') || attr(el, 'name') || attr(el, 'id') || (fieldType(el) === 'textarea' ? 'text area' : 'textbox');
}

/** The game's text fields on this page: {candidates: [{el, label, engine}], excluded: [{label, why}]} */
export function listGameInputs(doc) {
  const candidates = [];
  const excluded = [];
  let els = [];
  try {
    els = [...doc.querySelectorAll('input, textarea')];
  } catch {
    return { candidates, excluded };
  }
  for (const el of els) {
    if (candidates.length >= LIMITS.candidates) break;
    const type = fieldType(el);
    if (type === 'password' || type === 'email' || type === 'tel') {
      excluded.push({ why: sensitiveReason(el) }); // counted, never listed
      continue;
    }
    if (!ALLOWED_TYPES.has(type)) continue; // checkboxes, buttons, hidden fields… are not textboxes
    try {
      if (el.disabled) continue;
      const r = el.getBoundingClientRect();
      const cs = el.ownerDocument.defaultView.getComputedStyle(el);
      if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    } catch {
      continue;
    }
    const why = sensitiveReason(el);
    if (why) excluded.push({ why }); // their labels are not even shown
    else candidates.push({ el, label: fieldLabel(el), engine: engineField(el) || 'html', kind: 'element' });
  }
  return { candidates, excluded };
}

// ---------------------------------------------------------------- reading literal comparisons

/** Parses a quoted string at pos: {value, end} or null. */
export function parseString(text, pos) {
  const q = text[pos];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  let out = '';
  for (let i = pos + 1; i < text.length && i < pos + 2000; i++) {
    const c = text[i];
    if (c === '\\') {
      const n = text[i + 1];
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
      i++;
      continue;
    }
    if (c === q) return { value: out, end: i + 1 };
    if (q === '`' && c === '$' && text[i + 1] === '{') return null; // template with code: not a literal
    if (c === '\n' && q !== '`') return null;
    out += c;
  }
  return null;
}
/** A list of string literals: [ "a", 'b' ] / ( "a", "b" ) / (a: "a", "b"): {values, end} or null. */
function parseList(text, pos) {
  const open = text[pos];
  const close = open === '[' ? ']' : open === '(' ? ')' : null;
  if (!close) return null;
  let i = pos + 1;
  const hm = /^\s*a:\s*/.exec(text.slice(i, i + 10)); // Harlowe (a: …)
  if (open === '(' && hm) i += hm[0].length;
  const values = [];
  for (let guard = 0; guard < 200; guard++) {
    while (/\s|,/.test(text[i] || '')) i++;
    if (text[i] === close) return values.length ? { values, end: i + 1 } : null;
    const s = parseString(text, i);
    if (!s) return null;
    values.push(s.value);
    i = s.end;
  }
  return null;
}

const NORM_METHODS = { toLowerCase: 'lower', toLocaleLowerCase: 'lower', lower: 'lower', casefold: 'lower', toUpperCase: 'upper', toLocaleUpperCase: 'upper', upper: 'upper', trim: 'trim', strip: 'trim', trimStart: 'trim', trimEnd: 'trim', lstrip: 'trim', rstrip: 'trim' };
const CHAIN_RE = /^(?:\s*\.\s*(toLowerCase|toUpperCase|toLocaleLowerCase|toLocaleUpperCase|trim|trimStart|trimEnd|lower|upper|strip|lstrip|rstrip|casefold)\s*\(\s*\))+/;

/**
 * Every place the code compares the reference with literal text.
 * lang: 'sc' (SugarCube TwineScript), 'harlowe', 'js', 'py'. norm0: normalisation already applied
 * to the variable (e.g. answer = answer.lower() before the check).
 * @returns [{values, op, norm:[…], index, length}]
 */
export function findComparisons(code, refRe, lang, norm0 = []) {
  const out = [];
  const src = String(code);
  const re = new RegExp(refRe.source, refRe.flags.includes('g') ? refRe.flags : `${refRe.flags}g`);
  for (const m of src.matchAll(re)) {
    const lead = (m.groups && m.groups.lead) || '';
    const i = m.index + lead.length;
    let j = m.index + m[0].length;
    const norm = new Set(norm0);
    const chain = CHAIN_RE.exec(src.slice(j, j + 200));
    if (chain) {
      for (const c of chain[0].matchAll(/(\w+)\s*\(/g)) if (NORM_METHODS[c[1]]) norm.add(NORM_METHODS[c[1]]);
      j += chain[0].length;
    }
    // wrappers before the reference: (lowercase: $x) in Harlowe, lowercase(x) helpers
    const before = src.slice(Math.max(0, i - 200), i);
    let wrapped = false;
    if (/\((lowercase|lowerfirst):\s*$/.test(before) || /\blower(case)?\(\s*$/i.test(before)) (norm.add('lower'), (wrapped = true));
    if (/\(uppercase:\s*$/.test(before)) (norm.add('upper'), (wrapped = true));
    if (/\(trimmed:\s*$/.test(before)) (norm.add('trim'), (wrapped = true));
    // (lowercase: $x) is "a": the wrapper closes between the reference and the operator
    const close = wrapped ? /^\s*\)/.exec(src.slice(j, j + 20)) : null;
    if (close) j += close[0].length;
    const after = src.slice(j, j + 400);
    let hit = null;
    // ref OP literal
    const opm = /^\s*(===|!==|==|!=|\bis\s+not\s+in\b|\bis\s+in\b|\bisnot\b|\bis\s+not\b|\bis\b|\beq\b|\bneq\b|\bnot\s+in\b|\bin\b|\bcontains\b)\s*(?:\)\s*)?/.exec(after);
    if (opm) {
      const op = opm[1].replace(/\s+/g, ' ');
      const at = j + opm[0].length;
      const neg = /^(!==|!=|isnot|is not|neq|not in|is not in)$/.test(op);
      if (/(^|\s)in$/.test(op)) {
        const l = parseList(src, at);
        if (l) hit = { values: l.values, op: neg ? 'not-in' : 'in', end: l.end };
        else if (lang === 'py') {
          // answer in "abc": the answer is part of that text (rare), not an answer list
        }
      } else if (op === 'contains') {
        const s = parseString(src, at);
        if (s) hit = { values: [s.value], op: 'contains', end: s.end };
      } else {
        const s = parseString(src, at);
        if (s) hit = { values: [s.value], op: neg ? 'ne' : 'eq', end: s.end };
      }
    }
    // ref.includes("x") / startsWith / endsWith (JS), ref.match(/re/)
    if (!hit) {
      const mm = /^\s*\.\s*(includes|startsWith|endsWith|indexOf)\s*\(\s*/.exec(after);
      if (mm) {
        const s = parseString(src, j + mm[0].length);
        if (s) hit = { values: [s.value], op: mm[1] === 'startsWith' ? 'starts' : mm[1] === 'endsWith' ? 'ends' : 'contains', end: s.end };
      }
      const rm = /^\s*\.\s*(?:match|search)\s*\(\s*\/((?:\\\/|[^/\n])+)\/([a-z]*)\s*\)/.exec(after);
      if (rm) hit = { values: [], pattern: rm[1], flags: rm[2], op: 'pattern', end: j + rm[0].length };
    }
    // literal OP ref (reversed), ["a","b"].includes(ref), /re/.test(ref), "x" in ref (py)
    if (!hit) {
      const tail = before.replace(/\((lowercase|uppercase|lowerfirst|trimmed):\s*$/, '').replace(/\blower(case)?\(\s*$/i, '');
      const rev = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1\s*(===|!==|==|!=|\bis\s+not\b|\bis\b|\beq\b|\bneq\b)\s*$/.exec(tail);
      const inc = /\[((?:\s*(["'`])(?:\\.|(?!\2)[^\\\n])*\2\s*,?)+)\]\s*\.\s*includes\s*\(\s*$/.exec(tail);
      const tst = /\/((?:\\\/|[^/\n])+)\/([a-z]*)\s*\.\s*test\s*\(\s*$/.exec(tail);
      const pin = lang === 'py' ? /(["'])((?:\\.|(?!\1)[^\\\n])*)\1\s+in\s+$/.exec(tail) : null;
      if (rev) hit = { values: [unescape(rev[2])], op: /^(!==|!=|neq|is not)$/.test(rev[3].replace(/\s+/g, ' ')) ? 'ne' : 'eq', start: i - (tail.length - rev.index) };
      else if (inc) {
        const l = parseList(`[${inc[1]}]`, 0);
        if (l) hit = { values: l.values, op: 'in', start: i - (tail.length - inc.index) };
      } else if (tst) hit = { values: [], pattern: tst[1], flags: tst[2], op: 'pattern', start: i - (tail.length - tst.index) };
      else if (pin) hit = { values: [unescape(pin[2])], op: 'contains', start: i - (tail.length - pin.index) };
    }
    if (!hit) continue;
    const vals = hit.values.filter((v) => v !== ''); // "is the box empty?" checks are not answers
    if (!vals.length && hit.op !== 'pattern') continue;
    out.push({ values: vals, op: hit.op, pattern: hit.pattern, flags: hit.flags, norm: [...norm], index: hit.start ?? i, end: hit.end ?? j });
  }
  return out;
}
function unescape(s) {
  return String(s).replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

/** switch (ref) { case "a": … } / <<switch $ref>><<case "a" "b">> */
export function findCases(code, refRe, lang) {
  const out = [];
  const src = String(code);
  const ref = refRe.source.split(LEAD).join(''); // right after "switch (" no lead character is needed
  const open = lang === 'sc' ? new RegExp(`<<switch\\s+(?:${ref})((?:\\s*\\.\\s*\\w+\\s*\\(\\s*\\))*)\\s*>>`, 'g') : new RegExp(`\\bswitch\\s*\\(\\s*(?:${ref})((?:\\s*\\.\\s*\\w+\\s*\\(\\s*\\))*)\\s*\\)\\s*\\{`, 'g');
  for (const m of src.matchAll(open)) {
    const norm = new Set();
    for (const c of (m[1] || '').matchAll(/(\w+)\s*\(/g)) if (NORM_METHODS[c[1]]) norm.add(NORM_METHODS[c[1]]);
    const body = src.slice(m.index, m.index + 4000);
    const endIdx = lang === 'sc' ? body.indexOf('<</switch>>') : body.search(/\n\s*\}\s*(\n|$)/);
    const block = endIdx > 0 ? body.slice(0, endIdx) : body;
    const caseRe = lang === 'sc' ? /<<case\s+([^>]*)>>/g : /\bcase\s+((["'`])(?:\\.|(?!\2)[^\\\n])*\2)\s*:/g;
    for (const c of block.matchAll(caseRe)) {
      const vals = [];
      const args = c[1];
      for (let i = 0; i < args.length; ) {
        const s = parseString(args, i);
        if (s) {
          vals.push(s.value);
          i = s.end;
        } else i++;
      }
      if (vals.filter(Boolean).length) out.push({ values: vals.filter(Boolean), op: 'case', norm: [...norm], index: m.index + c.index, end: m.index + c.index + c[0].length });
    }
  }
  return out;
}

/** Turns a comparison into answers with notes ("letter case does not matter", impossible checks…). */
export function describeComparison(c) {
  const notes = [];
  if (c.norm.includes('lower')) notes.push('letter case does not matter (the game lowercases your text)');
  if (c.norm.includes('upper')) notes.push('letter case does not matter (the game uppercases your text)');
  if (c.norm.includes('trim')) notes.push('spaces at the start and end are ignored');
  if (!c.norm.includes('lower') && !c.norm.includes('upper') && ['eq', 'ne', 'in', 'not-in', 'case'].includes(c.op)) notes.push('exact text, letter case matters');
  const answers = [];
  if (c.op === 'pattern') {
    const derived = derivePattern(c.pattern, c.flags);
    if (derived) for (const v of derived) answers.push({ value: v, how: `matches the game's pattern /${c.pattern}/${c.flags}`, notes: [/i/.test(c.flags) ? 'letter case does not matter (pattern with the i flag)' : 'exact text, letter case matters'] });
    else answers.push({ value: null, pattern: `/${c.pattern}/${c.flags}`, how: `the game accepts text matching /${c.pattern}/${c.flags} (no single answer can be read from it)`, notes: [] });
    return answers;
  }
  for (const v of c.values) {
    let impossible = '';
    if (c.norm.includes('lower') && v !== v.toLowerCase()) impossible = `this check can never succeed: the game lowercases your text but compares it with “${v}”`;
    if (c.norm.includes('upper') && v !== v.toUpperCase()) impossible = `this check can never succeed: the game uppercases your text but compares it with “${v}”`;
    if (c.norm.includes('trim') && v !== v.trim()) impossible = 'this check can never succeed: the game removes the spaces this text has at its ends';
    const how = c.op === 'eq' ? 'the game checks that your text is exactly this' : c.op === 'ne' ? 'the game checks that your text is NOT this (everything else is rejected or treated differently)' : c.op === 'in' || c.op === 'case' ? 'one of the texts the game checks for' : c.op === 'not-in' ? 'one of the texts the game excludes' : c.op === 'contains' ? 'your text must contain this' : c.op === 'starts' ? 'your text must start with this' : c.op === 'ends' ? 'your text must end with this' : 'compared by the game';
    answers.push({ value: v, how, notes: [...notes], impossible });
  }
  return answers;
}
/** ^answer$ and ^(a|b)$ patterns without other regex syntax become answers. */
export function derivePattern(p, flags = '') {
  void flags;
  const m = /^\^(?:\(\?:|\()?((?:[^\\^$.|?*+()[\]{}]|\\[.\\/ -])+(?:\|(?:[^\\^$.|?*+()[\]{}]|\\[.\\/ -])+)*)\)?\$$/.exec(p);
  if (!m) return null;
  return m[1].split('|').map((x) => x.replace(/\\(.)/g, '$1'));
}

// ---------------------------------------------------------------- evidence and outcomes

function lineAt(text, index) {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const start = before.lastIndexOf('\n') + 1;
  const endNl = text.indexOf('\n', index);
  const raw = text.slice(start, endNl < 0 ? text.length : endNl).trim();
  return { line, snippet: raw.length > 200 ? `${raw.slice(0, 197)}…` : raw };
}
/** What the branch after a check does (links, passage changes, variables set), for SugarCube/Harlowe. */
export function branchOutcome(text, end, lang) {
  let body = '';
  if (lang === 'sc') {
    const close = text.indexOf('>>', end);
    if (close < 0) return null;
    const rest = text.slice(close + 2, close + 2 + 1500);
    const stop = rest.search(/<<(elseif|else|\/if)\b/);
    body = stop >= 0 ? rest.slice(0, stop) : rest.slice(0, 400);
  } else if (lang === 'harlowe') {
    const open = text.indexOf('[', end);
    if (open < 0 || open - end > 40) return null;
    let depth = 0;
    let i = open;
    for (; i < text.length && i < open + 1500; i++) {
      if (text[i] === '[') depth++;
      else if (text[i] === ']' && --depth === 0) break;
    }
    body = text.slice(open + 1, i);
  } else if (lang === 'js') {
    const open = text.indexOf('{', end);
    if (open < 0 || open - end > 60) return null;
    let depth = 0;
    let i = open;
    for (; i < text.length && i < open + 1500; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) break;
    }
    body = text.slice(open + 1, i);
  }
  if (!body.trim()) return null;
  const parts = [];
  const goes = new Set();
  for (const m of body.matchAll(/\[\[([^\]|>]*?)(?:\||->)([^\]]+)\]\]/g)) goes.add(m[2].trim());
  for (const m of body.matchAll(/\[\[([^\]|>]+)\]\]/g)) goes.add(m[1].trim());
  for (const m of body.matchAll(/<<goto\s+(["'])([^"']+)\1/g)) goes.add(m[2]);
  for (const m of body.matchAll(/\(go-?to:\s*(["'])([^"']+)\1/g)) goes.add(m[2]);
  for (const m of body.matchAll(/Engine\.play\(\s*(["'])([^"']+)\1/g)) goes.add(m[2]);
  if (goes.size) parts.push(`goes to passage ${[...goes].slice(0, 3).map((g) => `“${g}”`).join(', ')}`);
  const sets = [];
  for (const m of body.matchAll(/<<set\s+(\$[\w.]+)\s+to\s+([^>]{1,40})>>/g)) sets.push(`${m[1]} to ${m[2].trim()}`);
  for (const m of body.matchAll(/\(set:\s*(\$[\w.]+)\s+to\s+([^)]{1,40})\)/g)) sets.push(`${m[1]} to ${m[2].trim()}`);
  if (lang === 'js') for (const m of body.matchAll(/([A-Za-z_$][\w$.]*)\s*=(?!=)\s*([^;\n]{1,40})/g)) if (!/^(var|let|const)$/.test(m[1])) sets.push(`${m[1]} = ${m[2].trim()}`);
  if (sets.length) parts.push(`sets ${sets.slice(0, 3).join(', ')}`);
  const say = body
    .replace(/<<[^>]*>>|\[\[[^\]]*\]\]|\([a-z-]+:[^)]*\)|[{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!parts.length && say) parts.push(`shows “${say.length > 80 ? `${say.slice(0, 77)}…` : say}”`);
  return { text: parts.join('; ') || null, sets: sets.map((s) => s.split(/ to | = /)[0]) };
}

function answersFrom(comparisons, text, where, lang) {
  const out = [];
  for (const c of comparisons) {
    const ev = lineAt(text, c.index);
    const outcome = branchOutcome(text, c.end, lang);
    for (const a of describeComparison(c)) out.push({ ...a, op: c.op, evidence: { where, line: ev.line, code: ev.snippet }, outcome: outcome?.text || null, sets: outcome?.sets || [] });
  }
  return out;
}
function mergeAnswers(list) {
  const seen = new Map();
  for (const a of list) {
    const k = `${a.value ?? a.pattern}|${a.notes?.join(',')}|${a.op}`;
    if (!seen.has(k)) seen.set(k, { ...a, more: [] });
    else seen.get(k).more.push(a.evidence);
  }
  return [...seen.values()];
}
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- SugarCube

function passageText(doc, name) {
  try {
    for (const el of doc.querySelectorAll('tw-passagedata')) if (el.getAttribute('name') === name) return el.textContent || '';
  } catch {
    /* no DOM */
  }
  return null;
}
function passagesTagged(doc, tag) {
  const out = [];
  try {
    for (const el of doc.querySelectorAll('tw-passagedata')) if ((el.getAttribute('tags') || '').split(/\s+/).includes(tag)) out.push({ name: el.getAttribute('name'), text: el.textContent || '' });
  } catch {
    /* no DOM */
  }
  return out;
}
/** <<textbox "$var" "default" "Passage">> and friends in a passage's source. */
export function sugarCubeTextboxes(text) {
  const out = [];
  for (const m of String(text).matchAll(/<<(textbox|textarea|numberbox)\s+(["'])([$_][^"']+)\2([^>]*)>>/g)) {
    const rest = m[4];
    const args = [];
    for (let i = 0; i < rest.length; ) {
      const s = parseString(rest, i);
      if (s) {
        args.push(s.value);
        i = s.end;
        continue;
      }
      const l = /^\[\[([^\]]*)\]\]/.exec(rest.slice(i));
      if (l) {
        args.push(l[1].split(/\||->/).pop());
        i += l[0].length;
        continue;
      }
      i++;
    }
    const opt = /\bpassage\s+(["'])([^"']+)\1/.exec(rest);
    out.push({ macro: m[1], receiver: m[3].trim(), def: args[0] ?? '', target: opt ? opt[2] : args[1] || null, index: m.index });
  }
  return out;
}
/** The names SugarCube may give a textbox for a receiver ($player.name → textbox-playername / textbox-player-name…). */
export function sugarCubeSlugs(varName) {
  const base = String(varName).trim();
  const legacy = base.replace(/[^\w\s\u2013\u2014-]+/g, '').replace(/[_\s\u2013\u2014-]+/g, '-').toLocaleLowerCase();
  const modern = base.replace(/^\$/, '').replace(/^_/, '-').replace(/[\s\u2013\u2014'"`<>[\]{}()\\/.$]+/g, '');
  return [...new Set([legacy, modern, legacy.replace(/-/g, ''), base.replace(/^[$_]/, '').toLowerCase()])].filter(Boolean);
}
function sugarCubeRef(receiver) {
  const temp = receiver[0] === '_';
  const path = escRe(receiver.slice(1));
  const alts = temp ? [`_${path}`, `State\\.temporary\\.${path}`, `temporary\\(\\)\\.${path}`] : [`\\$${path}`, `State\\.variables\\.${path}`, `variables\\(\\)\\.${path}`, `State\\.getVar\\(\\s*["']\\$${path}["']\\s*\\)`];
  return new RegExp(`(?:${alts.join('|')})(?![\\w$])`);
}
/** Passages a passage leads to ([[links]], <<goto>>, <<link "x" "P">>, <<button>>). */
function linkedPassages(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\[\[([^\]]*)\]\]/g)) out.add(m[1].split(/\||->/).pop().split('][')[0].trim());
  for (const m of String(text).matchAll(/<<(?:goto|include|link|button|actions|click)\s+(?:(["'])[^"']*\1\s+)?(["'])([^"']+)\2/g)) out.add(m[3]);
  return [...out].filter(Boolean);
}

export function inspectSugarCube(win, el) {
  const doc = win.document;
  const passageEl = doc.querySelector('#passages .passage[data-passage], .passage[data-passage]');
  const current = passageEl ? passageEl.getAttribute('data-passage') : null;
  const inspected = [];
  if (!current) return { found: false, why: 'The current SugarCube passage could not be found on the page.', inspected };
  const text = passageText(doc, current);
  if (text === null) return { found: false, why: `The source of passage “${current}” is not in the page (tw-passagedata).`, inspected };
  inspected.push(`passage “${current}”`);
  const boxes = sugarCubeTextboxes(text);
  const name = String(attr(el, 'name') || attr(el, 'id')).replace(/^(textbox|textarea|numberbox)-/, '');
  let box = boxes.find((b) => sugarCubeSlugs(b.receiver).includes(name.toLowerCase()) || sugarCubeSlugs(b.receiver).includes(name));
  let match = box ? `the textbox's name “${attr(el, 'name')}” is SugarCube's name for ${box.receiver}` : '';
  if (!box && boxes.length === 1) (box = boxes[0]), (match = `the only textbox macro in passage “${current}”`);
  if (!box) return { found: false, why: boxes.length ? `Passage “${current}” has ${boxes.length} textboxes and this one could not be matched to its variable.` : `Passage “${current}” has no <<textbox>> macro (the field may come from a widget or JavaScript).`, inspected };
  const ref = sugarCubeRef(box.receiver);
  const sources = [{ where: `passage “${current}”`, text }];
  const names = new Set([current]);
  const queue = [box.target, ...linkedPassages(text)].filter(Boolean);
  let total = text.length;
  for (const n of queue) {
    if (names.size >= LIMITS.passages || total > LIMITS.text) break;
    if (names.has(n)) continue;
    const t = passageText(doc, n);
    if (t === null) continue;
    names.add(n);
    total += t.length;
    sources.push({ where: `passage “${n}”${n === box.target ? ' (the textbox goes there)' : ''}`, text: t });
  }
  for (const w of passagesTagged(doc, 'widget').slice(0, 3)) if (total < LIMITS.text) (total += w.text.length), sources.push({ where: `widget passage “${w.name}”`, text: w.text });
  try {
    const js = doc.querySelector('#twine-user-script, script[type="text/twine-javascript"]');
    if (js && total < LIMITS.text) sources.push({ where: 'the story JavaScript', text: js.textContent.slice(0, LIMITS.text - total), lang: 'js' });
  } catch {
    /* none */
  }
  let answers = [];
  for (const s of sources) {
    inspected.push(s.where);
    const lang = s.lang || 'sc';
    answers.push(...answersFrom([...findComparisons(s.text, ref, lang), ...findCases(s.text, ref, lang)], s.text, s.where, lang));
  }
  answers = mergeAnswers(answers);
  let value;
  try {
    const sc = win.SugarCube;
    const root = box.receiver[0] === '_' ? sc?.State?.temporary : sc?.State?.variables;
    if (root) value = box.receiver.slice(1).split('.').reduce((o, k) => (o == null ? undefined : o[k]), root);
  } catch {
    value = undefined;
  }
  return {
    found: answers.some((a) => a.value !== null),
    engine: 'SugarCube',
    field: { variable: box.receiver, macro: `<<${box.macro}>>`, target: box.target, match, value, passage: current },
    answers,
    inspected: [...new Set(inspected)],
    why: answers.length ? '' : `The game never compares ${box.receiver} with a fixed text in the passages SaveForge read.`,
  };
}

// ---------------------------------------------------------------- Harlowe

export function inspectHarlowe(win) {
  const doc = win.document;
  const inspected = [];
  const all = [];
  try {
    for (const el of doc.querySelectorAll('tw-passagedata')) all.push({ name: el.getAttribute('name'), text: el.textContent || '' });
  } catch {
    /* no DOM */
  }
  const withInput = all.filter((p) => /\((?:force-)?input(?:-box)?:[^)]*\b2?bind\s+\$/.test(p.text));
  let shown = null;
  try {
    shown = doc.querySelector('tw-passage[name]')?.getAttribute('name') || null;
  } catch {
    shown = null;
  }
  const pick = withInput.filter((p) => !shown || p.name === shown);
  const used = pick.length ? pick : withInput;
  if (!used.length) return { found: false, engine: 'Harlowe', why: 'No passage of this story has an (input-box:) or (input:) bound to a variable.', inspected };
  const uncertain = used.length > 1 || !shown;
  let answers = [];
  const vars = new Set();
  for (const p of used.slice(0, LIMITS.passages)) {
    inspected.push(`passage “${p.name}”`);
    for (const m of p.text.matchAll(/\((?:force-)?input(?:-box)?:[^)]*\b2?bind\s+\$([\w.']+)/g)) vars.add(m[1].replace(/'s\b/g, '.'));
    for (const v of vars) {
      const ref = new RegExp(`\\$${escRe(v)}(?![\\w])`);
      answers.push(...answersFrom(findComparisons(p.text, ref, 'harlowe'), p.text, `passage “${p.name}”`, 'harlowe'));
      for (const l of linkedPassages(p.text).slice(0, 4)) {
        const t = all.find((x) => x.name === l);
        if (!t) continue;
        inspected.push(`passage “${t.name}”`);
        answers.push(...answersFrom(findComparisons(t.text, ref, 'harlowe'), t.text, `passage “${t.name}”`, 'harlowe'));
      }
    }
  }
  answers = mergeAnswers(answers);
  return {
    found: answers.some((a) => a.value !== null),
    engine: 'Harlowe',
    field: { variable: [...vars].map((v) => `$${v}`).join(', '), match: uncertain ? `not sure which passage is on screen: every passage with a bound input was read (${used.map((p) => `“${p.name}”`).join(', ')})` : `the input of passage “${used[0].name}”` },
    answers,
    inspected: [...new Set(inspected)],
    why: answers.length ? '' : 'The story never compares the bound variable with a fixed text in the passages read.',
  };
}

// ---------------------------------------------------------------- plain HTML / JavaScript games

function fnSource(fn) {
  try {
    const s = Function.prototype.toString.call(fn);
    return /\[native code\]/.test(s) ? null : s.slice(0, LIMITS.fnText);
  } catch {
    return null;
  }
}
/** Code connected to a field, as text: inline handlers, handler properties, jQuery and recorded listeners. */
export function handlerSources(win, el) {
  const out = [];
  const seenFn = new Set();
  const add = (where, code) => {
    if (code && out.length < 24) out.push({ where, code: String(code).slice(0, LIMITS.fnText) });
  };
  const fromTarget = (t, label) => {
    for (const ev of ['onchange', 'oninput', 'onkeydown', 'onkeyup', 'onkeypress', 'onblur', 'onsubmit', 'onclick']) {
      const a = attr(t, ev);
      if (a) add(`${ev} of ${label}`, a);
      try {
        const f = t[ev];
        if (typeof f === 'function' && !seenFn.has(f)) seenFn.add(f), !a && add(`${ev} of ${label}`, fnSource(f));
      } catch {
        /* not readable */
      }
    }
    try {
      const jq = win.jQuery || win.$;
      const evs = jq && jq._data ? jq._data(t, 'events') : null;
      if (evs) for (const [type, hs] of Object.entries(evs)) for (const h of hs || []) if (!seenFn.has(h.handler)) seenFn.add(h.handler), add(`jQuery ${type} of ${label}`, fnSource(h.handler));
    } catch {
      /* no jQuery */
    }
    for (const l of recordedListeners(t)) if (!seenFn.has(l.fn)) seenFn.add(l.fn), add(`${l.type} listener of ${label}`, fnSource(l.fn));
  };
  fromTarget(el, 'the textbox');
  const form = formOf(el);
  if (form) fromTarget(form, 'its form');
  let buttons = [];
  try {
    // the field's form, or the element that directly contains it (never the whole page)
    const scope = form || el.parentElement;
    buttons = scope ? [...scope.querySelectorAll('button, input[type=button], input[type=submit]')].slice(0, 6) : [];
  } catch {
    buttons = [];
  }
  for (const b of buttons) fromTarget(b, `button “${(b.textContent || attr(b, 'value') || '').trim().slice(0, 30) || 'button'}”`);
  fromTarget(win.document, 'the page (key handler)');
  // one level of named global functions the handlers call
  const called = new Set();
  for (const s of [...out]) for (const n of callsIn(s.code)) if (called.size < LIMITS.functions) called.add(n);
  for (const n of called) {
    let f;
    try {
      f = Object.getOwnPropertyDescriptor(win, n)?.value;
    } catch {
      f = null;
    }
    if (typeof f === 'function' && !seenFn.has(f)) seenFn.add(f), add(`function ${n}()`, fnSource(f));
  }
  return out;
}
/** How the code refers to this field's text. */
function jsRefs(el, where) {
  const alts = [];
  const id = attr(el, 'id');
  const name = attr(el, 'name');
  if (/the textbox/.test(where)) alts.push('this\\.value');
  alts.push('(?:e|ev|evt|event)\\.target\\.value');
  if (id) {
    const i = escRe(id);
    alts.push(`getElementById\\(\\s*["']${i}["']\\s*\\)\\.value`, `querySelector\\(\\s*["']#${i}["']\\s*\\)\\.value`, `\\$\\(\\s*["']#${i}["']\\s*\\)\\.val\\(\\s*\\)`, `${LEAD}${i}\\.value`);
  }
  if (name) {
    const n = escRe(name);
    alts.push(`elements\\[\\s*["']${n}["']\\s*\\]\\.value`, `elements\\.${n}\\.value`, `querySelector\\(\\s*["'][^"']*name=["']?${n}["']?[^"']*["']\\s*\\)\\.value`);
  }
  return alts;
}
export function inspectHtml(win, el) {
  const sources = handlerSources(win, el);
  const inspected = sources.map((s) => s.where);
  const ownCode = sources.some((s) => /of the textbox$/.test(s.where));
  let answers = [];
  for (const s of sources) {
    const alts = jsRefs(el, s.where);
    const direct = new RegExp(`(?:${alts.join('|')})`);
    // a variable that holds the field's text: const a = input.value.trim().toLowerCase()
    const vars = [];
    for (const m of s.code.matchAll(/(?:\b(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=(?!=)\s*([^;\n]{0,200})/g)) {
      if (!direct.test(m[2])) continue;
      const norm = [];
      for (const c of m[2].matchAll(/\.\s*(\w+)\s*\(/g)) if (NORM_METHODS[c[1]]) norm.push(NORM_METHODS[c[1]]);
      vars.push({ name: m[1], norm });
    }
    const comps = [...findComparisons(s.code, direct, 'js'), ...findCases(s.code, direct, 'js')];
    for (const v of vars) {
      const r = new RegExp(`${LEAD}${escRe(v.name)}(?![\\w$])`);
      comps.push(...findComparisons(s.code, r, 'js', v.norm), ...findCases(s.code, r, 'js'));
    }
    answers.push(...answersFrom(comps, s.code, s.where, 'js'));
  }
  answers = mergeAnswers(answers);
  return {
    found: answers.some((a) => a.value !== null),
    engine: 'HTML/JavaScript',
    field: { variable: answers.length ? '(read from the textbox by the code below)' : '', match: `${sources.length} piece(s) of code connected to this textbox were read` },
    answers,
    inspected,
    why: answers.length
      ? ''
      : `${sources.length ? 'The code SaveForge could read never compares this textbox’s text with a fixed value.' : 'No code connected to this textbox can be read.'}${ownCode ? '' : ' Listeners added with addEventListener are invisible to a web page (turn on the Button & Textbox Linker’s recording and reload to capture them), and code inside closures, modules or WebAssembly cannot be read.'}`,
  };
}

// ---------------------------------------------------------------- RPG Maker MV/MZ (name input)

/** Name Input Processing (303) and Conditional Branch → Actor → Name is (111 [4, actor, 1, name]). */
export function rpgMakerNameChecks(lists) {
  const answers = [];
  const actors = new Set();
  for (const { where, list } of lists) {
    for (const cmd of list || []) {
      if (!cmd) continue;
      if (cmd.code === 303) actors.add(cmd.parameters?.[0]);
      if (cmd.code === 111 && cmd.parameters?.[0] === 4 && cmd.parameters?.[2] === 1 && typeof cmd.parameters?.[3] === 'string' && cmd.parameters[3]) {
        answers.push({ actor: cmd.parameters[1], value: cmd.parameters[3], how: 'the game checks that the actor’s name is exactly this', notes: ['exact text, letter case matters'], op: 'eq', evidence: { where, code: `Conditional Branch: Actor ${cmd.parameters[1]} › Name is “${cmd.parameters[3]}”` } });
      }
      if (cmd.code === 111 && cmd.parameters?.[0] === 12 && typeof cmd.parameters[1] === 'string') {
        const code = cmd.parameters[1];
        for (const m of code.matchAll(/\$gameActors\.actor\(\s*(\d+)\s*\)\.name\(\)/g)) {
          const ref = new RegExp(escRe(m[0]));
          for (const c of findComparisons(code, ref, 'js')) for (const a of describeComparison(c)) answers.push({ actor: Number(m[1]), ...a, op: c.op, evidence: { where, code: `Conditional Branch (script): ${code.slice(0, 160)}` } });
        }
      }
    }
  }
  return { answers, actors: [...actors] };
}
function rpgMakerLists(win) {
  const out = [];
  try {
    const map = win.$dataMap;
    const mapId = win.$gameMap?._mapId;
    for (const ev of map?.events || []) {
      if (!ev) continue;
      (ev.pages || []).forEach((pg, i) => out.push({ where: `Map ${mapId ?? '?'} › event ${ev.id} “${ev.name || ''}” › page ${i + 1}`, list: pg.list }));
    }
    for (const ce of win.$dataCommonEvents || []) if (ce) out.push({ where: `Common event ${ce.id} “${ce.name || ''}”`, list: ce.list });
  } catch {
    /* not loaded */
  }
  return out;
}
export function rpgMakerNameCandidate(win) {
  try {
    const sc = win.SceneManager?._scene;
    if (!sc || !win.Scene_Name || !(sc instanceof win.Scene_Name)) return null;
    const id = sc._actorId;
    const name = win.$gameActors?._data?.[id]?._name;
    return { kind: 'rpgmaker-name', engine: 'rpgmaker', label: `RPG Maker name input (actor ${id}${name ? `, now “${name}”` : ''})`, actorId: id };
  } catch {
    return null;
  }
}
export function inspectRpgMaker(win, cand) {
  const lists = rpgMakerLists(win);
  const { answers } = rpgMakerNameChecks(lists);
  const mine = mergeAnswers(answers.filter((a) => a.actor === cand.actorId));
  return {
    found: mine.length > 0,
    engine: 'RPG Maker',
    field: { variable: `actor ${cand.actorId}'s name`, value: safe(() => win.$gameActors._data[cand.actorId]._name), match: 'the name input scene that is open now' },
    answers: mine,
    inspected: [`${lists.length} event page(s) of this map and the common events`],
    why: mine.length ? '' : `No event on this map or common event checks actor ${cand.actorId}'s name against a fixed text.`,
  };
}
function safe(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- Ren'Py (through renpy-live's channel)

/** Ren'Py: the statement waiting for renpy.input and the conditions after it (data from the 'input' op). */
export function renpyAnswers(data) {
  const cur = data.current || {};
  const m = /([A-Za-z_][\w.]*)\s*=\s*renpy\.(?:exports\.)?input\s*\(/.exec(cur.source || '');
  if (!m) return { found: false, engine: "Ren'Py", why: cur.type ? `Ren'Py is not waiting in a “variable = renpy.input(…)” statement right now (current statement: ${cur.type}${cur.file ? ` at ${cur.file}:${cur.line}` : ''}). Open the inspector while the game shows its text input.` : "Ren'Py did not report its current statement.", inspected: [] };
  const v = m[1];
  const norm = [];
  const steps = [];
  for (const s of data.steps || []) {
    const r = new RegExp(`^\\s*${escRe(v)}\\s*=\\s*${escRe(v)}((?:\\s*\\.\\s*\\w+\\s*\\(\\s*\\))+)\\s*$`).exec(s.source || '');
    if (r) {
      for (const c of r[1].matchAll(/(\w+)\s*\(/g)) if (NORM_METHODS[c[1]]) norm.push(NORM_METHODS[c[1]]);
      steps.push(`${s.file}:${s.line} ${s.source.trim()}`);
    }
  }
  const ref = new RegExp(`${LEAD}${escRe(v)}(?![\\w])`);
  let answers = [];
  for (const c of data.checks || []) {
    const where = `${c.file}:${c.line}`;
    for (const k of findComparisons(c.cond, ref, 'py', norm)) {
      for (const a of describeComparison(k)) answers.push({ ...a, op: k.op, evidence: { where, code: `${c.loop ? 'while' : 'if'} ${c.cond}` }, outcome: summarizeBlock(c.then), sets: [] });
    }
  }
  answers = mergeAnswers(answers);
  return {
    found: answers.some((a) => a.value !== null),
    engine: "Ren'Py",
    field: { variable: v, match: `Ren'Py is waiting in ${cur.file}:${cur.line}: ${String(cur.source).trim().slice(0, 120)}`, steps },
    answers,
    inspected: [`${cur.file}:${cur.line}`, `${(data.checks || []).length} condition(s) after it`],
    why: answers.length ? '' : `None of the conditions after the input compares ${v} with a fixed text.`,
  };
}
function summarizeBlock(b) {
  if (!b || !b.length) return null;
  const parts = b.map((x) => (x.jump ? `jumps to ${x.jump}` : x.say ? `says “${x.say.slice(0, 70)}”` : x.py ? `runs ${x.py.slice(0, 60)}` : null)).filter(Boolean);
  return parts.length ? parts.slice(0, 2).join('; ') : null;
}

// ---------------------------------------------------------------- the inspector

/**
 * opts.renpyCall(op, args) → Promise: Ren'Py's channel (renpy-live), when connected.
 * Nothing here runs until candidates() / inspect() are called by the Find Answers button.
 */
export function createInputInspector(win, { renpyCall = null } = {}) {
  let runs = 0;
  return {
    get runs() {
      return runs;
    },
    /** The game's textboxes (and engine inputs drawn on a canvas) you can choose from. */
    candidates() {
      runs++;
      const { candidates, excluded } = listGameInputs(win.document);
      const rm = rpgMakerNameCandidate(win);
      if (rm) candidates.unshift(rm);
      if (renpyCall) candidates.unshift({ kind: 'renpy-input', engine: 'renpy', label: "Ren'Py text input (renpy.input)" });
      return { candidates, excluded };
    },
    /** Inspects one candidate: {found, engine, field, answers, inspected, why}. Never changes it. */
    async inspect(cand) {
      runs++;
      try {
        if (cand.kind === 'renpy-input') return renpyAnswers(await renpyCall('input', {}));
        if (cand.kind === 'rpgmaker-name') return inspectRpgMaker(win, cand);
        const el = cand.el;
        if (!el || !el.isConnected) return { found: false, why: 'This textbox is no longer on the page.', inspected: [] };
        const why = sensitiveReason(el);
        if (why) return { found: false, why: `Not inspected: ${why}.`, inspected: [], refused: true };
        if (cand.engine === 'sugarcube') return inspectSugarCube(win, el);
        if (cand.engine === 'harlowe') return inspectHarlowe(win);
        if (cand.engine === 'renpy' && renpyCall) return renpyAnswers(await renpyCall('input', {}));
        return inspectHtml(win, el);
      } catch (e) {
        return { found: false, why: `The inspection stopped: ${e.message}`, inspected: [] };
      }
    },
  };
}
