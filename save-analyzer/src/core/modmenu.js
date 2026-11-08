// Builds a mod menu from the variables that were actually decoded.
// Every entry points at a real node id; nothing is synthesized.

import { classifyByEngine } from '../adapters/profiles.js';
import { walk } from './model.js';

export const CATEGORIES = [
  { id: 'currency', name: 'Money & Currency', icon: 'coin' },
  { id: 'resources', name: 'Resources', icon: 'cube' },
  { id: 'stats', name: 'Player Stats', icon: 'heart' },
  { id: 'progression', name: 'Level & Experience', icon: 'star' },
  { id: 'inventory', name: 'Inventory', icon: 'bag' },
  { id: 'relationships', name: 'Relationships', icon: 'people' },
  { id: 'flags', name: 'Quest & Story Flags', icon: 'flag' },
  { id: 'unlocks', name: 'Unlocks', icon: 'key' },
  { id: 'achievements', name: 'Achievements & Collectibles', icon: 'trophy' },
  { id: 'time', name: 'Time & Calendar', icon: 'clock' },
  { id: 'variables', name: 'Game Variables', icon: 'hash' },
  { id: 'text', name: 'Names & Text', icon: 'text' },
  { id: 'other', name: 'Other Values', icon: 'dots' },
  { id: 'internal', name: 'Engine Internals', icon: 'gear', hiddenByDefault: true },
];

const W = (s) => new RegExp(`(^| )(${s})( |$)`);
const RULES = [
  ['relationships', W('love|loves|affection|affinity|relationship|relation|rel|friendship|friend|trust|romance|corruption|lust|bond|intimacy|attraction|likes?|opinion|favor|favour|loyalty|obedience|submission|dominance|rapport|hearts?|kiss|dating|girlfriend|boyfriend|crush')],
  ['progression', W('level|lvl|lv|exp|xp|experience|rank|prestige|skill points?|sp|perk points?|ap|stage|tier|evolution|rebirth|ascension|mastery')],
  ['currency', W('gold|money|cash|coins?|credits?|gems?|diamonds?|crystals?|dollars?|bucks|funds|wealth|zeny|rubies|ruby|currency|bank|savings|wallet|silver|copper|platinum|souls?|shards?|tokens?|premium|balance|debt|income|salary|price|cost|munny|gil|caps')],
  ['stats', W('hp|health|max hp|mhp|mp|mmp|mana|stamina|energy|str|strength|dex|dexterity|agi|agility|int|intelligence|wis|wisdom|cha|charisma|con|constitution|vit|vitality|luk|luck|atk|attack|def|defense|defence|spd|speed|power|armor|armour|crit|critical|evasion|accuracy|charm|fitness|hunger|thirst|sanity|arousal|willpower|stress|fatigue|morale|stat|stats|attributes?|endurance|agility|beauty|intellect|fame|reputation|karma|corruption')],
  ['resources', W('wood|stone|iron|ore|food|fuel|materials?|resources?|metal|crops?|seeds?|wheat|water|oil|ammo|lumber|coal|gas|supplies|bricks|planks|cloth|leather|herbs?|potions?|population|workers|cards?')],
  ['achievements', W('achievements?|achieve|achieved|trophy|trophies|collect|collected|collectibles?|badges?|medals?|found|discovered|gallery|cg|cgs|endings?|secrets?|relics?')],
  ['unlocks', W('unlock|unlocked|owned|own|purchased|bought|available|enabled|locked|has|have')],
  ['time', W('day|days|time|hour|hours|minute|minutes|week|weeks|month|months|year|years|turn|turns|season|date|clock|weekday|playtime|period|daytime')],
  ['flags', W('quest|quests|mission|missions|story|chapter|act|scene|flag|flags|switch|switches|seen|route|event|events|progress|ending|met|visited|talked|done|completed|complete|finished|state|choice|chose|path|tutorial|intro|step|phase|task|tasks|objective')],
];
const INVENTORY_PARENT = /(^| )(inventory|inv|items?|bag|backpack|weapons?|armou?rs?|equipment|equip|stash|cargo|loot|pouch|chest)( |$)/;

export function words(s) {
  return String(s)
    .replace(/^[_$@.]+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/[_\-.$\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

export function humanize(key) {
  const w = words(key);
  if (!w) return String(key);
  return w.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Hp|Mp|Tp|Xp|Exp|Atk|Def|Id|Npc|Ui)\b/g, (m) => m.toUpperCase());
}

function heuristicCategory(node, parents) {
  const own = words(node.key);
  const near = parents
    .slice(-3)
    .map((p) => words(p.key))
    .join(' ');
  for (const [cat, re] of RULES) if (re.test(own)) return adjust(cat, node);
  if ((node.type === 'int' || node.type === 'float') && INVENTORY_PARENT.test(near)) return 'inventory';
  for (const [cat, re] of RULES) if (re.test(near)) return adjust(cat, node);
  if (node.type === 'bool') return 'flags';
  if (node.type === 'string') return 'text';
  return 'other';
}

function adjust(cat, node) {
  if (node.type === 'string' && !['flags', 'time'].includes(cat)) return 'text';
  if (node.type === 'bool' && ['currency', 'resources', 'stats', 'progression', 'time'].includes(cat)) return 'flags';
  return cat;
}

function nearestName(parents) {
  for (let i = parents.length - 1; i >= Math.max(0, parents.length - 3); i--) {
    const c = (parents[i].children || []).find((x) => /^_?(name|title|displayName|label)$/i.test(x.key) && x.type === 'string' && x.value && x.value.length < 40);
    if (c) return c.value;
  }
  return null;
}

function genericLabel(node, parents) {
  const meaningful = parents.filter((p) => p.key !== '(root)' && p.key !== '(archive)' && p.type !== 'zip');
  const parent = meaningful[meaningful.length - 1];
  const named = nearestName(parents);
  let label = /^\d+$/.test(node.key) && parent ? `${humanize(parent.key)} #${node.key}` : humanize(node.key);
  if (named && !label.includes(named)) label = `${named} · ${label}`;
  return label;
}

function breadcrumb(node, parents) {
  return [...parents.filter((p) => p.key !== '(root)' && p.key !== '(archive)').map((p) => p.key), node.key].join(' › ');
}

function niceCeil(v) {
  if (v <= 10) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function sliderRange(node, category) {
  const v = Number(node.value);
  if (!Number.isFinite(v)) return null;
  if (Math.abs(v) > 1e12) return null;
  let hi;
  if (category === 'relationships') hi = v <= 100 ? 100 : niceCeil(v * 2);
  else if (category === 'stats' && v <= 100) hi = v <= 10 && node.type === 'float' && v <= 1 ? 1 : 100;
  else hi = niceCeil(Math.max(Math.abs(v) * 4, 100));
  const lo = v < 0 ? -hi : 0;
  const step = node.type === 'float' ? (hi <= 1 ? 0.01 : hi <= 10 ? 0.1 : 1) : Math.max(1, Math.round(hi / 1000));
  return { min: lo, max: hi, step };
}

/**
 * @returns {{categories: Array<{id,name,icon,hiddenByDefault,entries,groups}>, stats}}
 */
export function generateModMenu(root) {
  const entries = [];
  const valuesByKey = new Map();
  walk(root, (node, parents) => {
    if (!node.editable) return;
    const eng = classifyByEngine(node, parents) || {};
    const category = eng.category || (eng.hidden ? 'internal' : heuristicCategory(node, parents));
    const entry = {
      nodeId: node.id,
      key: node.key,
      label: eng.label || genericLabel(node, parents),
      path: eng.path || breadcrumb(node, parents),
      type: node.type,
      category: eng.hidden ? 'internal' : category,
      note: eng.note || node.meta.note || null,
      scope: eng.scope || null,
      groupHint: eng.group || null,
      parentId: parents.length ? parents[parents.length - 1].id : null,
      parentKey: [...parents].reverse().find((p) => p.key !== '@a')?.key ?? null,
    };
    entries.push(entry);
    if (node.type === 'string') {
      const set = valuesByKey.get(node.key) || new Set();
      if (set.size <= 13) set.add(node.value);
      valuesByKey.set(node.key, set);
    }
  });

  // Large homogeneous collections (switch arrays, item tables) become searchable groups.
  const byParent = new Map();
  for (const e of entries) {
    if (!e.parentId) continue;
    const list = byParent.get(e.parentId) || [];
    list.push(e);
    byParent.set(e.parentId, list);
  }
  const grouped = new Set();
  const groups = [];
  for (const [pid, list] of byParent) {
    if (list.length < 8) continue;
    const numericKeys = list.filter((e) => /^\d+$/.test(e.key)).length / list.length;
    const types = new Set(list.map((e) => e.type));
    if (numericKeys < 0.8 && !list[0].groupHint) continue;
    if (types.size > 2) continue;
    const cats = countBy(list.map((e) => e.category));
    const category = cats[0][0];
    let label = list[0].groupHint || humanize(list[0].parentKey || 'List');
    const owner = list[0].label.includes(' · ') ? list[0].label.split(' · ')[0] : null;
    if (owner && list.every((e) => e.label.startsWith(`${owner} · `))) label = `${owner} · ${label}`;
    groups.push({ id: pid, label, category, entries: list });
    for (const e of list) grouped.add(e);
  }

  for (const e of entries) {
    if (e.type === 'int' || e.type === 'float') e.range = null; // computed lazily by UI from current value
    if (e.type === 'string') {
      const set = valuesByKey.get(e.key);
      if (set && set.size >= 2 && set.size <= 12) e.suggestions = [...set];
    }
  }

  const categories = CATEGORIES.map((c) => ({
    ...c,
    entries: entries.filter((e) => e.category === c.id && !grouped.has(e)),
    groups: groups.filter((g) => g.category === c.id),
  })).filter((c) => c.entries.length || c.groups.length);

  return {
    categories,
    all: entries,
    stats: {
      editable: entries.length,
      hidden: entries.filter((e) => e.category === 'internal').length,
    },
  };
}

function countBy(arr) {
  const m = new Map();
  for (const a of arr) m.set(a, (m.get(a) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}
