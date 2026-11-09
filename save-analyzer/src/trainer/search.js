// Trainer search: ranks real gameplay variables above dialogue and UI text.
//
// Matches the variable name, its English translation, the original-language
// name, the full path, and the current value (type 1822 to find the 1822 you
// see in the game). Synonyms (money/cash/coins/argent/所持金…) widen the query.

import { englishLabel, toEnglish } from '../core/translate.js';

export const ALIAS_GROUPS = [
  ['money', 'cash', 'currency', 'coins', 'coin', 'gold', 'funds', 'credits', 'bank', 'balance', 'wallet', 'bucks', 'dollars', 'euros', 'gil', 'zeny', 'argent', 'dinero', 'monedas', 'geld', 'dinheiro', 'soldi', 'moedas', 'pieces', 'pièces', '所持金', 'お金', 'ゴールド', '金币', '金钱', '골드', '돈', 'деньги', 'золото'],
  ['health', 'hp', 'life', 'lives', 'vie', 'vies', 'vida', 'vidas', 'salud', 'leben', 'vita', 'santé', 'sante', '体力', 'ライフ', '生命', '血量', '체력', '생명', 'здоровье', 'жизнь'],
  ['level', 'lvl', 'lv', 'rank', 'niveau', 'nivel', 'stufe', 'livello', 'レベル', '等级', '레벨', 'уровень'],
  ['experience', 'xp', 'exp', 'experiencia', 'expérience', 'experience', 'erfahrung', '経験値', '经验', '경험치', 'опыт'],
  ['score', 'points', 'pts', 'highscore', 'best', 'puntos', 'punkte', 'punti', 'pontos', 'スコア', '分数', '점수', 'очки'],
  ['energy', 'stamina', 'mana', 'mp', 'énergie', 'energie', 'energia', 'エネルギー', '体力', '에너지', 'энергия'],
  ['items', 'inventory', 'bag', 'stock', 'inventaire', 'objets', 'inventario', 'objetos', 'inventar', 'アイテム', '道具', '物品', '背包', '아이템', 'инвентарь'],
  ['attack', 'atk', 'damage', 'dmg', 'power', 'strength', 'attaque', 'ataque', 'angriff', '攻撃', '攻击', '공격', 'атака'],
  ['defense', 'def', 'armor', 'armour', 'shield', 'défense', 'defensa', 'verteidigung', '防御', '방어', 'защита'],
  ['speed', 'spd', 'agility', 'vitesse', 'velocidad', 'geschwindigkeit', '速度', '속도', 'скорость'],
  ['day', 'days', 'time', 'turn', 'jour', 'jours', 'dia', 'día', 'tag', '日', '天', '일', 'день'],
  ['customers', 'clients', 'client', 'clientes', 'kunden', '客', '顾客', '손님'],
  ['price', 'cost', 'prix', 'coût', 'precio', 'preis', 'prezzo', '値段', '价格', '가격', 'цена'],
  ['gems', 'diamonds', 'crystals', 'premium', 'gemmes', 'gemas', 'edelsteine', '宝石', '钻石', '보석'],
];
export const SUGGESTIONS = ['money', 'health', 'level', 'xp', 'score', 'energy', 'items', 'day'];

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** The query plus synonyms and its English meaning. */
export function expandQuery(q, mode = 'partial') {
  const base = norm(q).trim();
  const terms = new Set([base]);
  if (!base) return { base, terms: [], aliases: [] };
  const aliases = [];
  for (const group of ALIAS_GROUPS) {
    const g = group.map(norm);
    if (g.some((w) => w === base || (mode !== 'exact' && base.length >= 3 && w.startsWith(base)))) for (const w of g) if (w !== base) (terms.add(w), aliases.push(w));
  }
  const en = toEnglish(q);
  if (en.kind === 'translation' || en.kind === 'partial') for (const w of norm(en.english).split(/\s+/)) if (w.length >= 3 && !terms.has(w)) (terms.add(w), aliases.push(w));
  return { base, terms: [...terms], aliases };
}

/** Cached, normalised search fields for an entry. */
function fields(p, e) {
  if (e._sf) return e._sf;
  const node = p.node(e.nodeId);
  const key = norm(node?.key ?? e.key);
  const label = norm(p.displayLabel ? p.displayLabel(e) : e.label);
  let en = '';
  const t = englishLabel(e.label);
  if (t) en = norm(t.text);
  if (!en) {
    const k = toEnglish(node?.key ?? e.key);
    if (k.kind === 'translation' || k.kind === 'partial' || k.kind === 'guess') en = norm(k.english);
  }
  e._sf = { key, label, en, path: norm(e.path), words: new Set(`${key} ${label} ${en}`.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) };
  return e._sf;
}

const LONG_TEXT = 40;
/** Is this a gameplay variable (numbers, switches, short names), not dialogue/UI text? */
export function isGameplay(e, node, value) {
  if (e.category === 'internal') return false;
  if (node.type === 'int' || node.type === 'float' || node.type === 'bool') return true;
  if (node.type === 'string') {
    const s = String(value ?? '').trim();
    if (s.length > LONG_TEXT || /[.!?…:]\s*$/.test(s)) return false;
    // names, classes, states ("Vex", "Knight", "idle") are gameplay; UI sentences are not
    if (/(^|[^a-z])(name|nickname|title|class|job|rank|state|mode|status|difficulty|character|hero|player)([^a-z]|$)/i.test(String(node.key))) return true;
    return s.split(/\s+/).length <= 2 && s.length <= 24;
  }
  return false;
}

function typeMatches(filter, node, e) {
  switch (filter) {
    case 'number':
      return node.type === 'int' || node.type === 'float';
    case 'text':
      return node.type === 'string';
    case 'bool':
      return node.type === 'bool';
    case 'editable':
      return !!node.editable;
    case 'game':
      return e.category !== 'internal';
    default:
      return true;
  }
}

/** A query that is a variable path (has a dot, or a SugarCube $/_ sigil), normalised; else null. */
function pathQuery(q) {
  const t = String(q || '').trim();
  if (!/^[$_]?[A-Za-z_$][\w$]*(\.[\w$]+|\[\d+\])+$/.test(t.replace(/^(SugarCube\.)?State\.(variables|temporary)\./, '')) && !/^[$_][A-Za-z_]\w*$/.test(t)) return null;
  return normPath(t);
}
function normPath(s) {
  return String(s || '')
    .replace(/ › /g, '.')
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/^(window|SugarCube|RPG Maker|Phaser|Construct 2)\./, '')
    .replace(/^State\.variables\./, '')
    .replace(/^State\.temporary\./, '_')
    .replace(/^\$/, '')
    .toLowerCase();
}

function numberQuery(q) {
  const t = q.trim().replace(/[\s,](?=\d{3}\b)/g, '').replace(/,/g, '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/**
 * @returns {{results: Array<{entry, score, why}>, hiddenText: number, total: number, aliases: string[]}}
 */
export function searchEntries(p, query, { filter = 'all', gameplayOnly = true, mode = 'partial', limit = 1000 } = {}) {
  const { base, terms, aliases } = expandQuery(query, mode);
  const out = [];
  let hiddenText = 0;
  if (!base) return { results: out, hiddenText, total: 0, aliases };
  const num = numberQuery(query);
  const pq = pathQuery(query);
  const exact = mode === 'exact';
  const textMatch = (hay, t) => (exact ? hay === t : hay.includes(t));
  for (const e of p.entries) {
    const node = p.node(e.nodeId);
    if (!node || !typeMatches(filter, node, e)) continue;
    const f = fields(p, e);
    let score = 0;
    let why = '';
    const hit = (s, w) => {
      if (s > score) (score = s), (why = w);
    };
    if (pq) {
      // exact variable paths: player.money, $player.money, State.variables.player.money, _tmp
      const ep = normPath(e.path);
      const el = normPath(e.label);
      if (ep === pq || el === pq) hit(130, 'exact path');
      else if (ep.endsWith('.' + pq) || el.endsWith('.' + pq)) hit(110, 'path');
    }
    for (const t of terms) {
      const isAlias = t !== base;
      const k = isAlias ? 0.75 : 1;
      if (f.key === t || f.label === t) hit(100 * k, isAlias ? `synonym “${t}”` : 'name');
      else if (f.en === t) hit(92 * k, isAlias ? `English “${t}”` : 'English name');
      else if (!exact && f.words.has(t)) hit(78 * k, isAlias ? `synonym “${t}”` : 'name word');
      else if (!exact && t.length >= 2 && (f.key.includes(t) || f.label.includes(t))) hit(55 * k, isAlias ? `synonym “${t}”` : 'name');
      else if (!exact && t.length >= 2 && f.en.includes(t)) hit(50 * k, 'English name');
      else if (!exact && t.length >= 3 && f.path.includes(t)) hit(22 * k, 'path');
    }
    let value;
    const readValue = () => (value === undefined ? (value = p.value(e.nodeId)) : value);
    if (num !== null && (node.type === 'int' || node.type === 'float')) {
      const v = Number(readValue());
      if (v === num) hit(90, `value = ${num}`);
      else if (!exact && Number.isInteger(num) && (Math.floor(v) === num || Math.round(v) === num)) hit(70, `value ≈ ${num}`);
    }
    if (node.type === 'string' && base.length >= 2) {
      const s = norm(readValue());
      if (s === base) hit(45, 'text value');
      else if (!exact && s.includes(base)) hit(16, 'text value');
      else if (!exact && aliases.some((a) => a.length >= 3 && s.includes(a))) hit(10, 'text value');
    }
    if (!score) continue;
    const gameplay = isGameplay(e, node, readValue());
    if (gameplayOnly && !gameplay) {
      hiddenText++;
      continue;
    }
    // rank actual gameplay numbers above text
    if (node.type === 'int' || node.type === 'float') score += 25;
    else if (node.type === 'bool') score += 10;
    else if (!gameplay) score -= 30;
    if (e.category === 'internal') score -= 25;
    if (p.isEdited?.(e.nodeId)) score += 3;
    out.push({ entry: e, score, why });
  }
  out.sort((a, b) => b.score - a.score || a.entry.label.length - b.entry.label.length);
  return { results: out.slice(0, limit), hiddenText, total: out.length, aliases };
}
