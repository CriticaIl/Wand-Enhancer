// Explanation engine: generates the ⓘ panel text for any variable from its
// name, type, value, neighbours, engine profile and edit channel.
//
// Nothing here is a per-variable script. A small library of *patterns*
// (currency, current/max pairs, story flags, identifiers, timestamps…) is
// scored against each variable, and the best match is combined with
// structural facts (siblings, engine region, how edits are applied).
// Confidence is reported honestly; with no pattern match the text says so.

import { isRenpyLogTuple, isRenpyPersistent, isRpgMakerSave, isSugarCubeSave, isStorageDump } from '../adapters/profiles.js';
import { humanize, words } from './modmenu.js';

const has = (re, text) => re.test(text);
const PLAYTIME = /(^| )(playtime|frames|elapsed|runtime|frames on save)( |$)/;
const INVENTORY = /(^| )(inventory|inv|items?|bag|backpack|weapons?|armou?rs?|equipment|stash|cargo|loot|pouch|chest)( |$)/;
const W = (s) => new RegExp(`(^| )(${s})( |$)`);

// ---------------------------------------------------------------- pattern library
// Each pattern: id, test(ctx) -> strength 0..1 (0 = no match), and text builders.
const PATTERNS = [
  {
    id: 'checksum',
    test: (c) => (has(W('checksum|crc|hash|signature|sig|hmac|digest|md5|sha1|sha256'), c.own) ? 0.8 : 0),
    controls: () => 'an integrity check (checksum/hash/signature) the game may use to detect tampering',
    effect: () => 'Editing it by hand almost never helps; a wrong value can make the game reject or reset the save.',
    risk: 'high',
    side: () => ['If the game verifies this value, other edits may also be rejected unless it is recomputed by the game itself.'],
  },
  {
    id: 'identifier',
    test: (c) => (has(/(^| )(id|ids|uuid|guid|uid|ref|index|idx|slot|type|kind|class)( |$)|(^| )\w+ id$/, c.own) && !has(W('hp|gold|level'), c.own) && !(c.numeric && INVENTORY.test(c.near)) ? 0.7 : 0),
    controls: (c) => `an identifier or reference${c.parentLabel ? ` inside “${c.parentLabel}”` : ''} that points to another object (character, item, map, slot…)`,
    effect: () => 'Changing it usually makes the game look up a different (or non-existent) object instead of changing a quantity.',
    risk: 'high',
    side: () => ['A reference to something that does not exist can crash the game or corrupt the save.'],
  },
  {
    id: 'timestamp',
    test: (c) => {
      const v = Number(c.value);
      const looks = typeof c.value === 'number' && ((v > 9.4e8 && v < 4.1e9) || (v > 9.4e11 && v < 4.1e12));
      if (looks && has(W('time|date|saved|created|updated|last|at|timestamp|stamp|when'), c.own)) return 0.85;
      if (c.type === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(c.value)) return 0.8;
      return looks ? 0.45 : 0;
    },
    controls: (c) => `a timestamp (a moment in real time${Number(c.value) > 9.4e11 ? ', in milliseconds' : Number(c.value) > 9.4e8 ? ', in seconds' : ''}), usually when something was saved or happened`,
    effect: () => 'Usually bookkeeping. Changing it rarely affects gameplay but can confuse “last saved” displays or timed rewards.',
    risk: 'low',
    side: () => [],
  },
  {
    id: 'version',
    test: (c) => (has(W('version|ver|build|revision|schema|format|engine'), c.own) ? 0.8 : has(W('seed|rng|random'), c.own) ? 0.75 : 0),
    controls: (c) => (has(W('seed|rng|random'), c.own) ? 'the random-number seed (what “random” outcomes will be)' : 'a version/format marker the game uses to understand this save'),
    effect: (c) =>
      has(W('seed|rng|random'), c.own)
        ? 'Changing it alters future random results (drops, events); it does not change anything that already happened.'
        : 'Changing it may make the game migrate, misread or refuse the save.',
    risk: 'medium',
    side: () => [],
  },
  {
    id: 'max-stat',
    test: (c) => (has(/(^| )(max|maximum|mhp|mmp|cap|capacity|limit)( |$)|^m(hp|mp|sp)$/, c.own) && c.numeric ? 0.8 : 0),
    controls: (c) => `the maximum/cap for ${c.stripMax || 'a related value'}`,
    effect: () => 'Raising it allows the related value to go higher; lowering it may clamp the current value down.',
    risk: 'low',
    side: (c) => (c.pairCurrent ? [`Related current value: “${c.pairCurrent.key}” (${fmt(c.pairCurrent.value)}). The game may clamp it to this maximum.`] : []),
  },
  {
    id: 'vital',
    test: (c) => (has(W('hp|health|life|lives|mp|mana|sp|stamina|energy|tp|shield|armor|armour|hunger|thirst|sanity|fatigue|stress'), c.own) && c.numeric ? 0.75 : 0),
    controls: (c) => `${c.owner ? `${c.owner}’s ` : 'a '}current ${vitalName(c.own)} (a resource bar that goes up and down during play)`,
    effect: (c) => `Higher values usually mean more survivability/actions.${c.pairMax ? ` Values above the maximum (“${c.pairMax.key}” = ${fmt(c.pairMax.value)}) are often clamped back by the game.` : ''} Setting it to 0 may trigger defeat or a game-over check.`,
    risk: 'low',
    side: (c) => (c.pairMax ? [`Linked maximum: “${c.pairMax.key}”. Raise that too if the game keeps reducing this value.`] : []),
  },
  {
    id: 'level',
    test: (c) => (has(W('level|lvl|lv|rank|tier|prestige'), c.own) && c.numeric ? 0.75 : 0),
    controls: (c) => `${c.owner ? `${c.owner}’s ` : 'the '}level or rank`,
    effect: () => 'Higher levels usually unlock stronger stats, skills or content. Some games only grant level-up rewards when leveling normally, so stats may not change by editing this alone.',
    risk: 'medium',
    side: (c) => [c.sibling(/(^| )(exp|xp|experience)( |$)/) ? `Experience is stored separately (“${c.sibling(/(^| )(exp|xp|experience)( |$)/).key}”); the game may recalculate the level from it or vice versa.` : 'Level is often derived from experience; the game may recalculate it.'],
  },
  {
    id: 'experience',
    test: (c) => (has(W('exp|xp|experience|mastery'), c.own) && c.numeric ? 0.75 : 0),
    controls: (c) => `${c.owner ? `${c.owner}’s ` : ''}experience points`,
    effect: () => 'More experience usually leads to level-ups the next time the game checks (often after a battle or action).',
    risk: 'low',
    side: (c) => (c.sibling(W('level|lvl|lv')) ? [`Level is stored separately (“${c.sibling(W('level|lvl|lv')).key}”) and may not update until the game re-checks.`] : []),
  },
  {
    id: 'currency',
    test: (c) => (has(W('gold|money|cash|coins?|credits?|gems?|diamonds?|crystals?|dollars?|bucks|funds|zeny|rubies|currency|bank|savings|wallet|silver|copper|souls?|shards?|tokens?|gil|munny|caps|balance'), c.own) && c.numeric ? 0.75 : 0),
    controls: () => 'an amount of in-game currency the player holds',
    effect: () => 'Raising it lets you buy more. Extremely large numbers can overflow displays or break shop/economy balance.',
    risk: 'low',
    side: () => ['Lifetime/total-earned statistics (if any) are usually stored separately and will not change.'],
  },
  {
    id: 'relationship',
    test: (c) => (has(W('love|affection|affinity|relationship|rel|friendship|trust|romance|corruption|lust|bond|intimacy|attraction|opinion|favor|favour|loyalty|obedience|rapport|hearts?|dating'), `${c.own} ${c.near}`) ? (c.numeric ? 0.7 : 0.5) : 0),
    controls: (c) => `relationship/affection progress${c.who ? ` with ${c.who}` : ''}`,
    effect: () => 'Story games often unlock scenes, routes or endings when this passes certain thresholds. Jumping far ahead can skip content or make dialogue inconsistent.',
    risk: 'medium',
    side: () => ['Thresholds are checked by the story script; the effect may only appear at the next relevant scene.'],
  },
  {
    id: 'story-progress',
    test: (c) => (has(W('chapter|act|stage|quest|mission|story|progress|phase|step|route|scene|episode|part|objective'), `${c.own}`) && c.numeric ? 0.7 : 0),
    controls: () => 'a story/quest progression marker (which step of the story you are on)',
    effect: () => 'Changing it can jump the story forward or back. Skipped steps may leave other flags unset, which can soft-lock quests.',
    risk: 'high',
    side: () => ['Other variables that would normally change along the way are not updated automatically.'],
  },
  {
    id: 'flag',
    test: (c) => (c.type === 'bool' || (c.numeric && (c.value === 0 || c.value === 1) && c.flagish) ? (has(W('seen|met|visited|talked|done|completed|complete|finished|triggered|cleared|defeated|killed|rescued|found|read|watched|chose|choice|ending|flag|switch|event|quest|tutorial|intro'), `${c.own} ${c.near}`) ? 0.7 : 0) : 0),
    controls: () => 'whether a story event or condition has happened (an on/off story flag)',
    effect: () => 'Turning it on can skip or unlock scenes/dialogue; turning it off can make events repeat. Changing story flags out of order can create inconsistent states.',
    risk: 'high',
    side: () => ['Story flags often work in combination; changing one may not trigger the effects the related flags expect.'],
  },
  {
    id: 'unlock',
    test: (c) => {
      const re = W('unlock|unlocks|unlocked|owned|own|purchased|bought|available|enabled|locked|has|have|learned|acquired|upgrades?|buildings?|features?');
      if (has(re, c.own)) return c.type === 'bool' ? 0.75 : 0.5;
      return c.type === 'bool' && has(re, c.near) ? 0.6 : 0;
    },
    controls: (c) => `whether ${c.subject ? `“${c.subject}”` : 'a feature, item or area'} is unlocked/owned`,
    effect: () => 'Turning it on usually makes the feature available immediately or next time the menu/area is opened. Unlocking early can bypass intended progression.',
    risk: 'medium',
    side: () => [],
  },
  {
    id: 'achievement',
    test: (c) => (has(W('achievements?|achieved|trophy|trophies|collect|collected|collectibles?|badges?|medals?|discovered|gallery|cg|cgs|endings?|secrets?|relics?'), `${c.own} ${c.near}`) ? 0.65 : 0),
    controls: () => 'achievement, gallery or collectible status',
    effect: () => 'Usually changes what appears as unlocked/collected in menus. It does not award platform achievements (Steam/Game Center).',
    risk: 'low',
    side: () => [],
  },
  {
    id: 'inventory-count',
    test: (c) => (c.numeric && INVENTORY.test(c.near) ? 0.65 : c.numeric && has(W('potions?|ammo|bullets|arrows|keys?|bombs?|scrolls?|herbs?|seeds?|ore|wood|stone|iron|food'), c.own) ? 0.6 : 0),
    controls: (c) => `how many ${c.subject ? `“${c.subject}”` : 'of an item'} you own`,
    effect: () => 'Changes the quantity in your inventory. Setting it to 0 may remove the item; very high numbers can exceed the game’s stack limit and be clamped.',
    risk: 'low',
    side: () => ['Items that never had an entry are not listed and cannot be added safely from here.'],
  },
  {
    id: 'stat',
    test: (c) => (c.numeric && has(W('str|strength|dex|dexterity|agi|agility|int|intelligence|wis|wisdom|cha|charisma|con|constitution|vit|vitality|luk|luck|atk|attack|def|defense|defence|mat|mdf|spd|speed|power|crit|critical|evasion|accuracy|charm|fitness|endurance|beauty|intellect|fame|reputation|karma|skill'), c.own) ? 0.7 : 0),
    controls: (c) => `${c.owner ? `${c.owner}’s ` : 'a '}${humanize(c.key)} attribute`,
    effect: () => 'Changes how strong the character is in that attribute. Some games recalculate attributes from level and equipment, which can overwrite your edit.',
    risk: 'low',
    side: () => [],
  },
  {
    id: 'time',
    test: (c) => (c.numeric && has(W('day|days|hour|hours|minute|minutes|week|weeks|month|months|year|years|turn|turns|season|clock|weekday|daytime|period'), c.own) ? 0.7 : has(PLAYTIME, c.own) ? 0.65 : 0),
    controls: (c) => (has(PLAYTIME, c.own) ? 'how long the game has been played (statistic)' : 'the in-game calendar/clock'),
    effect: (c) =>
      has(PLAYTIME, c.own)
        ? 'Usually only shown in save menus; rarely affects gameplay.'
        : 'Moving time can trigger or skip time-based events (shops, deadlines, scheduled scenes).',
    risk: 'medium',
    riskFor: (c) => (has(PLAYTIME, c.own) ? 'low' : 'medium'),
    side: () => [],
  },
  {
    id: 'position',
    test: (c) => (c.numeric && has(/^(x|y|z|pos ?x|pos ?y|real ?x|real ?y|direction|dir|facing|map ?id|map|room|zone|area)$/, c.own) ? 0.7 : 0),
    controls: () => 'a position/location (coordinates, facing direction, or current map/room)',
    effect: () => 'Changing it moves the character. Places outside walkable areas can trap the character (soft-lock).',
    risk: 'high',
    side: () => ['The game may only apply the change after a map transition or reload.'],
  },
  {
    id: 'counter',
    test: (c) => (c.numeric && has(W('count|counter|total|times|steps|kills|wins|losses|deaths|battles|escapes|saves|plays|runs|attempts|clicks|taps|placed|built|crafted|harvested|sold|bought'), c.own) ? 0.65 : 0),
    controls: () => 'a statistic counter (how many times something happened)',
    effect: () => 'Mostly informational, but some games award achievements or unlocks when a counter reaches a value.',
    risk: 'low',
    side: () => [],
  },
  {
    id: 'setting',
    test: (c) => (has(W('volume|music|sound|sfx|bgm|bgs|me|se|voice|language|lang|fullscreen|brightness|gamma|difficulty|speed|text speed|autosave|vibration|subtitles|quality|resolution|mute|always dash|command remember|settings?|options?|config|prefs?'), `${c.own} ${c.near}`) ? 0.6 : 0),
    controls: () => 'a game setting or preference',
    effect: () => 'Changes how the game behaves or sounds rather than your progress.',
    risk: 'low',
    side: () => [],
  },
  {
    id: 'name',
    test: (c) => (c.type === 'string' && has(W('name|nickname|title|label|display name|player|hero|character|profile|owner'), c.own) ? 0.7 : 0),
    controls: () => 'a name or text shown in the game',
    effect: () => 'Changes the displayed text. Some games use names as keys internally, so renaming can break lookups.',
    risk: 'low',
    side: () => [],
  },
];

function vitalName(own) {
  const m = own.match(/hp|health|life|lives|mp|mana|sp|stamina|energy|tp|shield|armou?r|hunger|thirst|sanity|fatigue|stress/);
  const map = { hp: 'HP (health)', mp: 'MP (mana)', tp: 'TP', sp: 'SP' };
  return m ? map[m[0]] || m[0] : 'resource';
}

function fmt(v) {
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v);
  return String(v);
}

// ---------------------------------------------------------------- engine knowledge (exact meanings)

const RPG_PARTY = {
  _gold: ['the party’s gold (RPG Maker $gameParty._gold)', 'Money used in shops. The engine caps gold at the max set by the game (9,999,999 by default).', 'low'],
  _steps: ['the total steps walked by the party (statistic)', 'Only shown in menus; some games use it for step-count events.', 'low'],
};
const RPG_ACTOR = {
  _hp: ['current HP of this actor', 'The engine clamps HP to Max HP when it refreshes. 0 HP marks the actor as dead.', 'low'],
  _mp: ['current MP of this actor', 'Clamped to Max MP when the actor refreshes.', 'low'],
  _tp: ['current TP (tech points) of this actor', 'Clamped to the max TP (100 by default).', 'low'],
  _level: ['the actor’s level', 'RPG Maker normally changes level through EXP; setting it directly does not re-learn skills or add EXP, and the stored EXP may disagree.', 'medium'],
  _name: ['the actor’s displayed name', 'Changes the name shown in menus and messages.', 'low'],
  _nickname: ['the actor’s nickname', 'Display text only.', 'low'],
  _profile: ['the actor’s profile text', 'Display text only.', 'low'],
  _classId: ['the actor’s class ID (points to the database class list)', 'Switching to an invalid class ID can crash the game.', 'high'],
  _actorId: ['this actor’s database ID', 'Changing it breaks the link to the actor’s database entry.', 'high'],
};

function engineKnowledge(c) {
  const region = c.region;
  if (region === 'rpgmaker') {
    const keys = c.chainKeys;
    if (keys[0] === 'party' && RPG_PARTY[c.key]) return pack(RPG_PARTY[c.key], 'Documented RPG Maker field');
    if (keys[0] === 'party' && ['_items', '_weapons', '_armors'].includes(keys[1])) {
      const kind = { _items: 'item', _weapons: 'weapon', _armors: 'armor' }[keys[1]];
      return pack([`how many of ${kind} #${c.key}${c.liveName ? ` (“${c.liveName}”)` : ''} the party owns`, 'Quantities are capped at 99 by default (game-specific). 0 removes the item.', 'low'], 'Documented RPG Maker inventory table');
    }
    if (keys[0] === 'switches') return pack([`RPG Maker game switch #${c.key}${c.liveName ? ` (“${c.liveName}”)` : ''}`, 'Switches turn event pages and story conditions on/off. Changing one can start, skip or repeat events.', 'high'], 'Documented RPG Maker switch table');
    if (keys[0] === 'variables') return pack([`RPG Maker game variable #${c.key}${c.liveName ? ` (“${c.liveName}”)` : ''}`, 'Game variables are general-purpose numbers the game’s events read (quest stages, counters, choices). The meaning is defined by this specific game.', 'high'], 'Documented RPG Maker variable table');
    if (keys[0] === 'selfSwitches') return pack(['a self switch of one map event (map, event, letter)', 'Controls which page a specific event shows, e.g. an opened chest.', 'medium'], 'Documented RPG Maker self-switch table');
    if (keys[0] === 'actors' && RPG_ACTOR[c.key] && keys.length <= 4) return pack(RPG_ACTOR[c.key], 'Documented RPG Maker actor field');
    if (keys[0] === 'actors' && keys.includes('_exp')) return pack([`the actor’s EXP for class ${c.key}`, 'Level-ups from EXP are applied when the game next changes EXP (e.g. after a battle).', 'low'], 'Documented RPG Maker actor field');
    if (keys[0] === 'actors' && keys.includes('_paramPlus')) return pack([`a permanent bonus to parameter #${c.key} (MHP, MMP, ATK, DEF, MAT, MDF, AGI, LUK)`, 'Bonuses add to the base parameter; effective immediately when the actor refreshes.', 'low'], 'Documented RPG Maker actor field');
  }
  if (region === 'renpy-store') {
    return { knownSource: "Ren'Py store variable (defined by this game’s script)", engineNote: "Ren'Py stores every game variable as store.<name>; its meaning comes from the game’s own script, so the description below is inferred from the name." };
  }
  if (region === 'renpy-persistent') return { knownSource: "Ren'Py persistent data (shared across all save slots)", engineNote: 'Persistent data survives new games and affects every save slot, e.g. gallery unlocks.' };
  if (region === 'sugarcube') return { knownSource: 'SugarCube story variable ($name)', engineNote: 'Story variables are set by the story’s passages; their meaning comes from this story, so the description is inferred from the name.' };
  return null;
}

function pack([controls, effect, risk], source) {
  return { exact: true, controls, effect, risk, knownSource: source };
}

// ---------------------------------------------------------------- context

function regionOf(parents) {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i];
    if (isRenpyLogTuple(p)) return { region: 'renpy-store', start: i + 2 };
    if (isRenpyPersistent(p)) return { region: 'renpy-persistent', start: i + 1 };
    if (isRpgMakerSave(p)) return { region: 'rpgmaker', start: i + 1 };
    if (isSugarCubeSave(p)) return { region: 'sugarcube', start: i + 1 };
    if (isStorageDump(p)) return { region: 'storage', start: i + 1 };
  }
  return { region: null, start: 0 };
}

function buildContext(node, parents, opts) {
  const { region, start } = regionOf(parents);
  const chain = parents.slice(start).filter((p) => p.key !== '@a');
  const parent = parents[parents.length - 1];
  const siblings = (parent?.children || []).filter((s) => s !== node);
  const key = String(node.key).replace(/^store\./, '');
  const own = words(key);
  const near = parents
    .slice(-3)
    .map((p) => words(String(p.key).replace(/^store\./, '')))
    .join(' ');
  const numeric = node.type === 'int' || node.type === 'float';
  const ownerNode = [...parents].reverse().slice(0, 3).find((p) => (p.children || []).some((x) => /^_?(name|title|displayName)$/i.test(x.key) && x.type === 'string'));
  const owner = ownerNode ? ownerNode.children.find((x) => /^_?(name|title|displayName)$/i.test(x.key)).value : null;
  const sibling = (re) => siblings.find((s) => re.test(words(s.key)));
  const baseWord = own.replace(/(^| )(max|maximum|cap|capacity|limit)( |$)/, ' ').trim();
  const pairMax = numeric ? siblings.find((s) => (s.type === 'int' || s.type === 'float') && new RegExp(`(^| )(max|maximum|m)( )?${escapeRe(baseWord)}( |$)|^m${escapeRe(baseWord)}$`).test(words(s.key))) : null;
  const pairCurrent = numeric && /(^| )(max|maximum)( |$)/.test(own) ? siblings.find((s) => words(s.key) === baseWord) : null;
  const subjectRaw = /^\d+$/.test(key) ? null : key;
  const flagish = /(^| )(seen|met|done|flag|switch|visited|unlocked|completed|has|is)( |$)/.test(own);
  return {
    node,
    key,
    own,
    near,
    type: node.type,
    value: opts.value !== undefined ? opts.value : node.value,
    numeric,
    region,
    chainKeys: chain.map((c) => c.key).concat(node.key),
    parentLabel: parent && !/^(\(|\d+$|@)/.test(String(parent.key)) && !/^(json|log)$/.test(String(parent.key)) ? humanize(String(parent.key).replace(/^store\./, '')) : null,
    owner,
    who: whoFromName(own),
    subject: subjectRaw ? humanize(subjectRaw.replace(/^(has|have|own|owned|unlocked|is)[_ ]?/i, '')) : parent ? `${humanize(parent.key)} #${key}` : null,
    stripMax: baseWord ? humanize(baseWord) : null,
    sibling,
    pairMax,
    pairCurrent,
    flagish,
    liveName: opts.liveName || null,
  };
}

function whoFromName(own) {
  const m = own.match(/^([a-z]+) (love|affection|affinity|rel|relationship|trust|friendship|corruption|lust|points)$/) || own.match(/^(love|affection|trust|rel) ([a-z]+)$/);
  if (!m) return null;
  const name = /^(love|affection|trust|rel)$/.test(m[1]) ? m[2] : m[1];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------- timing / channel

const TIMING = {
  live: {
    label: 'Live',
    text: 'Applies immediately to the running game (in memory). It becomes permanent only when you save in-game.',
  },
  'live-generic': {
    label: 'Live (unverified)',
    text: 'Written directly into the page’s JavaScript data. It takes effect when the game next reads this value; some games recalculate values and overwrite edits. Permanent only when you save in-game.',
  },
  reload: {
    label: 'Apply & Reload',
    text: 'Saved edit: written to the game’s browser storage when you press Apply & Reload. The running game will not see it until the page reloads, and in-game progress since your last save is lost on reload.',
  },
  file: {
    label: 'Saved edit (export)',
    text: 'Saved edit: written into the exported save file. Load that file in the game to see it.',
  },
  readonly: { label: 'Read-only', text: 'This value cannot be edited safely.' },
};

// ---------------------------------------------------------------- main

/**
 * @param node   model node
 * @param parents ancestors from root
 * @param opts   {channel: 'live'|'live-generic'|'reload'|'file', value?, original?, label?, liveName?, engineNote?, references?: number}
 */
export function explain(node, parents, opts = {}) {
  const c = buildContext(node, parents, opts);
  const known = engineKnowledge(c);
  const reasons = [];
  let best = null;
  let bestScore = 0;
  for (const p of PATTERNS) {
    const s = p.test(c);
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }

  let controls;
  let effect;
  let risk;
  let side = [];
  let score;
  if (known && known.exact) {
    controls = known.controls;
    effect = known.effect;
    risk = known.risk;
    score = 0.92;
    reasons.push(`${known.knownSource}: the meaning comes from the engine’s documented data layout.`);
    if (best && bestScore >= 0.6) side = best.side(c);
  } else if (best && bestScore >= 0.45) {
    controls = best.controls(c);
    effect = best.effect(c);
    risk = best.riskFor ? best.riskFor(c) : best.risk;
    side = best.side(c);
    score = bestScore;
    reasons.push(`The name “${c.key}”${c.near && bestScore < 0.7 ? ` and its location (${c.near})` : ''} match a common “${best.id.replace(/-/g, ' ')}” pattern.`);
    if (known?.knownSource) {
      reasons.push(`${known.knownSource}; the engine does not define what it means.`);
      score = Math.min(score, 0.7);
    }
  } else {
    controls = genericControls(c);
    effect = genericEffect(c);
    risk = c.type === 'bool' ? 'medium' : 'unknown';
    score = 0.2;
    reasons.push('No recognised naming pattern. This explanation is based only on the data type and location.');
    if (known?.knownSource) reasons.push(`${known.knownSource}.`);
  }
  if (c.pairMax) reasons.push(`Found a matching maximum next to it (“${c.pairMax.key}”).`);
  if (opts.liveName) {
    reasons.push(`The game itself names this “${opts.liveName}”.`);
    score = Math.min(0.97, score + 0.05);
  }
  if (/^\d+$/.test(c.key) && !known?.exact && !opts.liveName) {
    reasons.push('The key is only a number, so its meaning depends on the list it belongs to.');
    score = Math.min(score, 0.5);
  }

  // structural side effects
  if (known?.engineNote) side.push(known.engineNote);
  if (c.region === 'renpy-store') side.push("Ren'Py keeps a rollback history: rolling back past this point in the game can restore the old value.");
  if (opts.references > 1) side.push(`The same name appears in ${opts.references - 1} other place(s) in this data; they are separate values and are not changed together.`);
  if (node.meta?.readOnlyReason) side.unshift(node.meta.readOnlyReason);
  const progression = risk === 'high' ? 'High: this can change story/quest state or break references. Keep the backup.' : risk === 'medium' ? 'Moderate: may affect progression checks or be recalculated by the game.' : risk === 'low' ? 'Low: a quantity or display value; it does not normally change story state.' : 'Unknown: the purpose is not recognised, so the effect on progression cannot be predicted.';

  const channel = node.editable === false ? 'readonly' : opts.channel || 'file';
  const level = score >= 0.8 ? 'High' : score >= 0.55 ? 'Medium' : score >= 0.35 ? 'Low' : 'Unknown';
  return {
    title: opts.label || humanize(c.key),
    path: opts.path || null,
    controls: `${known?.exact ? 'This controls' : 'This likely controls'} ${controls}.`,
    effect,
    type: typeLabel(node, c),
    value: opts.value !== undefined ? opts.value : node.value,
    original: opts.original !== undefined ? opts.original : node.value,
    timing: TIMING[channel],
    channel,
    sideEffects: side,
    progression,
    risk,
    confidence: { level, score: Math.round(score * 100) / 100, reasons },
    summary: shortSummary(controls),
  };
}

function genericControls(c) {
  const where = c.parentLabel ? ` stored under “${c.parentLabel}”` : '';
  switch (c.type) {
    case 'bool':
      return `an on/off setting or condition${where}. Its exact purpose is not recognised`;
    case 'int':
    case 'float':
      return `a number the game uses${where}. Its exact purpose is not recognised`;
    case 'string':
      return `a piece of text${where}. Its exact purpose is not recognised`;
    default:
      return `a ${c.type} value${where}`;
  }
}

function genericEffect(c) {
  if (c.type === 'bool') return 'Flipping it may enable/disable something or mark an event as done. Test carefully and keep the backup.';
  if (c.numeric) return 'Changing it may alter an amount, a counter, an ID or a state code, which cannot be told apart without more context. Small changes are safer than large ones.';
  return 'Text values can be names, IDs or internal codes. Changing an internal code can break lookups.';
}

function typeLabel(node, c) {
  const t = { int: 'Whole number', float: 'Decimal number', bool: 'On/off (boolean)', string: 'Text', null: 'Empty (null)' }[node.type] || node.type;
  const extra = node.meta?.jsNumber ? ' · JavaScript number' : node.meta?.note && /Python/.test(node.meta.note) ? ' · Python 2 string' : '';
  return `${t}${extra}${c.region === 'renpy-store' || c.region === 'renpy-persistent' ? ' (Python)' : ''}`;
}

function shortSummary(controls) {
  const s = controls.replace(/\. Its exact purpose is not recognised/, ' (purpose not recognised)');
  return capitalize(s.length > 110 ? s.slice(0, 107) + '…' : s);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const PATTERN_IDS = PATTERNS.map((p) => p.id);
