// Offline English helper for variable names and short text values.
//
// No network, no data leaves the device. It uses:
//   1. a game-vocabulary dictionary for Spanish, French, German, Portuguese,
//      Italian, Dutch, Polish, Turkish, Russian, Japanese, Chinese and Korean
//      (dictionary hits are reported as *translations*)
//   2. an abbreviation glossary (hp, atk, flg, cnt…) whose expansions are
//      reported as *guessed meanings*, because abbreviations are ambiguous
//   3. script detection (Cyrillic, kana, Han, Hangul…) to say which language
//      text is in even when a word is not in the dictionary
// Results never replace the original: callers keep the original key for editing.

const DICT = {
  es: {
    oro: 'gold', dinero: 'money', monedas: 'coins', moneda: 'coin', gemas: 'gems', gema: 'gem', diamantes: 'diamonds', vida: 'life', vidas: 'lives', salud: 'health', nivel: 'level', experiencia: 'experience', ataque: 'attack', defensa: 'defense', velocidad: 'speed', fuerza: 'strength', energia: 'energy', energía: 'energy', magia: 'magic', mana: 'mana', puntos: 'points', puntuacion: 'score', puntuación: 'score', objetos: 'items', objeto: 'item', inventario: 'inventory', arma: 'weapon', armas: 'weapons', armadura: 'armor', pocion: 'potion', poción: 'potion', pociones: 'potions', llave: 'key', llaves: 'keys', mision: 'mission', misión: 'mission', capitulo: 'chapter', capítulo: 'chapter', dia: 'day', día: 'day', dias: 'days', días: 'days', hora: 'hour', tiempo: 'time', jugador: 'player', enemigo: 'enemy', jefe: 'boss', nombre: 'name', amor: 'love', afecto: 'affection', confianza: 'trust', amistad: 'friendship', desbloqueado: 'unlocked', completado: 'completed', visto: 'seen', maximo: 'maximum', máximo: 'maximum', actual: 'current', total: 'total', escudo: 'shield', comida: 'food', madera: 'wood', piedra: 'stone', hierro: 'iron', tienda: 'shop', precio: 'price', recompensa: 'reward', logros: 'achievements', estrellas: 'stars', estrella: 'star', ronda: 'round', etapa: 'stage', mundo: 'world', mapa: 'map', partida: 'game', juego: 'game', guardar: 'save', mejor: 'best', record: 'record', totales: 'total', maxima: 'maximum', máxima: 'maximum', minimo: 'minimum', mínimo: 'minimum', cantidad: 'quantity', numero: 'number', número: 'number', actuales: 'current',
  },
  fr: {
    or: 'gold', argent: 'money', pieces: 'coins', pièces: 'coins', gemmes: 'gems', vie: 'life', vies: 'lives', sante: 'health', santé: 'health', niveau: 'level', experience: 'experience', expérience: 'experience', attaque: 'attack', defense: 'defense', défense: 'defense', vitesse: 'speed', force: 'strength', energie: 'energy', énergie: 'energy', magie: 'magic', points: 'points', score: 'score', objets: 'items', objet: 'item', inventaire: 'inventory', arme: 'weapon', armes: 'weapons', armure: 'armor', potion: 'potion', potions: 'potions', cle: 'key', clé: 'key', cles: 'keys', clés: 'keys', quete: 'quest', quête: 'quest', chapitre: 'chapter', jour: 'day', jours: 'days', heure: 'hour', temps: 'time', joueur: 'player', ennemi: 'enemy', patron: 'boss', nom: 'name', amour: 'love', affection: 'affection', confiance: 'trust', amitie: 'friendship', amitié: 'friendship', debloque: 'unlocked', débloqué: 'unlocked', termine: 'completed', terminé: 'completed', vu: 'seen', bouclier: 'shield', nourriture: 'food', bois: 'wood', pierre: 'stone', fer: 'iron', boutique: 'shop', prix: 'price', recompense: 'reward', récompense: 'reward', etoiles: 'stars', étoiles: 'stars', manche: 'round', monde: 'world', carte: 'map', partie: 'game', jeu: 'game', meilleur: 'best',
  },
  de: {
    geld: 'money', munzen: 'coins', münzen: 'coins', edelsteine: 'gems', leben: 'life', gesundheit: 'health', stufe: 'level', erfahrung: 'experience', angriff: 'attack', verteidigung: 'defense', geschwindigkeit: 'speed', starke: 'strength', stärke: 'strength', energie: 'energy', magie: 'magic', punkte: 'points', punktzahl: 'score', gegenstande: 'items', gegenstände: 'items', gegenstand: 'item', inventar: 'inventory', waffe: 'weapon', waffen: 'weapons', rustung: 'armor', rüstung: 'armor', trank: 'potion', tranke: 'potions', tränke: 'potions', schlussel: 'key', schlüssel: 'key', aufgabe: 'quest', kapitel: 'chapter', tag: 'day', tage: 'days', stunde: 'hour', zeit: 'time', spieler: 'player', gegner: 'enemy', feind: 'enemy', name: 'name', liebe: 'love', zuneigung: 'affection', vertrauen: 'trust', freundschaft: 'friendship', freigeschaltet: 'unlocked', abgeschlossen: 'completed', gesehen: 'seen', schild: 'shield', nahrung: 'food', essen: 'food', holz: 'wood', stein: 'stone', eisen: 'iron', laden: 'shop', preis: 'price', belohnung: 'reward', sterne: 'stars', runde: 'round', welt: 'world', karte: 'map', spiel: 'game', speichern: 'save', beste: 'best', aktuell: 'current', aktuelle: 'current', maximal: 'maximum', anzahl: 'number of', gesamt: 'total', menge: 'amount',
  },
  pt: {
    ouro: 'gold', dinheiro: 'money', moedas: 'coins', gemas: 'gems', vida: 'life', vidas: 'lives', saude: 'health', saúde: 'health', nivel: 'level', experiencia: 'experience', ataque: 'attack', defesa: 'defense', velocidade: 'speed', forca: 'strength', força: 'strength', energia: 'energy', pontos: 'points', pontuacao: 'score', pontuação: 'score', itens: 'items', inventario: 'inventory', inventário: 'inventory', arma: 'weapon', armadura: 'armor', pocao: 'potion', poção: 'potion', chave: 'key', chaves: 'keys', missao: 'mission', missão: 'mission', capitulo: 'chapter', dia: 'day', dias: 'days', tempo: 'time', jogador: 'player', inimigo: 'enemy', chefe: 'boss', nome: 'name', amor: 'love', confianca: 'trust', confiança: 'trust', amizade: 'friendship', desbloqueado: 'unlocked', concluido: 'completed', concluído: 'completed', escudo: 'shield', comida: 'food', madeira: 'wood', pedra: 'stone', ferro: 'iron', loja: 'shop', preco: 'price', preço: 'price', estrelas: 'stars', mundo: 'world', mapa: 'map', jogo: 'game', melhor: 'best',
  },
  it: {
    oro: 'gold', soldi: 'money', denaro: 'money', monete: 'coins', gemme: 'gems', vita: 'life', vite: 'lives', salute: 'health', livello: 'level', esperienza: 'experience', attacco: 'attack', difesa: 'defense', velocita: 'speed', velocità: 'speed', forza: 'strength', energia: 'energy', punti: 'points', punteggio: 'score', oggetti: 'items', oggetto: 'item', inventario: 'inventory', arma: 'weapon', armi: 'weapons', armatura: 'armor', pozione: 'potion', pozioni: 'potions', chiave: 'key', chiavi: 'keys', missione: 'mission', capitolo: 'chapter', giorno: 'day', giorni: 'days', tempo: 'time', giocatore: 'player', nemico: 'enemy', capo: 'boss', nome: 'name', amore: 'love', fiducia: 'trust', amicizia: 'friendship', sbloccato: 'unlocked', completato: 'completed', scudo: 'shield', cibo: 'food', legno: 'wood', pietra: 'stone', ferro: 'iron', negozio: 'shop', prezzo: 'price', stelle: 'stars', mondo: 'world', mappa: 'map', gioco: 'game', migliore: 'best',
  },
  nl: { goud: 'gold', geld: 'money', munten: 'coins', leven: 'life', levens: 'lives', gezondheid: 'health', niveau: 'level', ervaring: 'experience', aanval: 'attack', verdediging: 'defense', snelheid: 'speed', kracht: 'strength', punten: 'points', voorwerpen: 'items', wapen: 'weapon', sleutel: 'key', dag: 'day', speler: 'player', vijand: 'enemy', naam: 'name', liefde: 'love', ontgrendeld: 'unlocked', winkel: 'shop', wereld: 'world', spel: 'game' },
  pl: { zloto: 'gold', złoto: 'gold', pieniadze: 'money', pieniądze: 'money', monety: 'coins', zycie: 'life', życie: 'life', zdrowie: 'health', poziom: 'level', doswiadczenie: 'experience', doświadczenie: 'experience', atak: 'attack', obrona: 'defense', szybkosc: 'speed', szybkość: 'speed', sila: 'strength', siła: 'strength', punkty: 'points', przedmioty: 'items', ekwipunek: 'inventory', bron: 'weapon', broń: 'weapon', klucz: 'key', dzien: 'day', dzień: 'day', gracz: 'player', wrog: 'enemy', wróg: 'enemy', imie: 'name', imię: 'name', milosc: 'love', miłość: 'love', odblokowane: 'unlocked', sklep: 'shop', swiat: 'world', świat: 'world', gra: 'game' },
  tr: { altin: 'gold', altın: 'gold', para: 'money', jeton: 'coin', can: 'life', saglik: 'health', sağlık: 'health', seviye: 'level', deneyim: 'experience', saldiri: 'attack', saldırı: 'attack', savunma: 'defense', hiz: 'speed', hız: 'speed', guc: 'strength', güç: 'strength', puan: 'points', esyalar: 'items', eşyalar: 'items', envanter: 'inventory', silah: 'weapon', anahtar: 'key', gun: 'day', gün: 'day', oyuncu: 'player', dusman: 'enemy', düşman: 'enemy', isim: 'name', ask: 'love', aşk: 'love', kilitacik: 'unlocked', magaza: 'shop', mağaza: 'shop', dunya: 'world', dünya: 'world', oyun: 'game' },
  ru: {
    золото: 'gold', деньги: 'money', монеты: 'coins', монета: 'coin', кристаллы: 'crystals', жизнь: 'life', жизни: 'lives', здоровье: 'health', уровень: 'level', опыт: 'experience', атака: 'attack', защита: 'defense', скорость: 'speed', сила: 'strength', энергия: 'energy', мана: 'mana', очки: 'points', счёт: 'score', счет: 'score', предметы: 'items', предмет: 'item', инвентарь: 'inventory', оружие: 'weapon', броня: 'armor', зелье: 'potion', зелья: 'potions', ключ: 'key', ключи: 'keys', задание: 'quest', квест: 'quest', глава: 'chapter', день: 'day', дни: 'days', время: 'time', игрок: 'player', враг: 'enemy', босс: 'boss', имя: 'name', любовь: 'love', доверие: 'trust', дружба: 'friendship', открыто: 'unlocked', пройдено: 'completed', щит: 'shield', еда: 'food', дерево: 'wood', камень: 'stone', железо: 'iron', магазин: 'shop', цена: 'price', награда: 'reward', звёзды: 'stars', звезды: 'stars', раунд: 'round', мир: 'world', карта: 'map', игра: 'game', максимум: 'maximum', текущий: 'current', игрока: 'player’s', уровня: 'level (of)', количество: 'quantity', всего: 'total', макс: 'max',
  },
  ja: {
    所持金: 'money held', お金: 'money', 金: 'gold/money', ゴールド: 'gold', コイン: 'coins', ジェム: 'gems', 宝石: 'gems', 体力: 'health (HP)', 生命力: 'vitality', 命: 'life', ライフ: 'life', 残機: 'lives left', 経験値: 'experience points', 経験: 'experience', レベル: 'level', 攻撃力: 'attack power', 攻撃: 'attack', 防御力: 'defense', 防御: 'defense', 素早さ: 'speed', 速度: 'speed', スピード: 'speed', 力: 'strength', 魔力: 'magic power', 魔法: 'magic', 精神: 'spirit', 運: 'luck', 道具: 'items', アイテム: 'items', 持ち物: 'inventory', 武器: 'weapon', 防具: 'armor', 回復薬: 'healing potion', 薬: 'medicine', ポーション: 'potion', 鍵: 'key', カギ: 'key', クエスト: 'quest', 任務: 'mission', 章: 'chapter', 日: 'day', 日数: 'number of days', 時間: 'time', スコア: 'score', 得点: 'score', ポイント: 'points', 点: 'points', 名前: 'name', 主人公: 'protagonist', プレイヤー: 'player', 敵: 'enemy', ボス: 'boss', 好感度: 'affection level', 愛情: 'love', 信頼: 'trust', 友情: 'friendship', 仲間: 'party members', 解放: 'unlocked', 済み: 'done', 完了: 'completed', フラグ: 'flag', 最大: 'maximum', 現在: 'current', 合計: 'total', 盾: 'shield', 食料: 'food', 木材: 'wood', 石: 'stone', 鉄: 'iron', 店: 'shop', ショップ: 'shop', 値段: 'price', 報酬: 'reward', 実績: 'achievements', 星: 'stars', ステージ: 'stage', 面: 'stage', 世界: 'world', 地図: 'map', マップ: 'map', ゲーム: 'game', セーブ: 'save', 最高: 'best', 回数: 'count', 数: 'number', 個数: 'quantity', 所持: 'owned', 装備: 'equipment', スキル: 'skill', 技: 'skill', 状態: 'status', ステータス: 'status', 体: 'body', 心: 'heart',
  },
  zh: {
    金币: 'gold coins', 金幣: 'gold coins', 金钱: 'money', 金錢: 'money', 钱: 'money', 錢: 'money', 金: 'gold', 钻石: 'diamonds', 鑽石: 'diamonds', 宝石: 'gems', 寶石: 'gems', 生命: 'life', 生命值: 'health', 血量: 'health', 体力: 'stamina', 體力: 'stamina', 经验: 'experience', 經驗: 'experience', 经验值: 'experience points', 經驗值: 'experience points', 等级: 'level', 等級: 'level', 攻击: 'attack', 攻擊: 'attack', 攻击力: 'attack power', 防御: 'defense', 防禦: 'defense', 防御力: 'defense', 速度: 'speed', 力量: 'strength', 魔法: 'magic', 法力: 'mana', 分数: 'score', 分數: 'score', 积分: 'points', 積分: 'points', 物品: 'items', 道具: 'items', 背包: 'inventory', 武器: 'weapon', 装备: 'equipment', 裝備: 'equipment', 药水: 'potion', 藥水: 'potion', 钥匙: 'key', 鑰匙: 'key', 任务: 'quest', 任務: 'quest', 章节: 'chapter', 章節: 'chapter', 天: 'day', 天数: 'number of days', 时间: 'time', 時間: 'time', 名字: 'name', 名称: 'name', 玩家: 'player', 敌人: 'enemy', 敵人: 'enemy', 首领: 'boss', 好感度: 'affection level', 好感: 'affection', 爱: 'love', 愛: 'love', 信任: 'trust', 友谊: 'friendship', 解锁: 'unlocked', 解鎖: 'unlocked', 完成: 'completed', 最大: 'maximum', 当前: 'current', 當前: 'current', 总: 'total', 總: 'total', 护盾: 'shield', 食物: 'food', 木材: 'wood', 石头: 'stone', 铁: 'iron', 商店: 'shop', 价格: 'price', 奖励: 'reward', 成就: 'achievements', 星星: 'stars', 关卡: 'stage', 關卡: 'stage', 世界: 'world', 地图: 'map', 游戏: 'game', 遊戲: 'game', 最高: 'best', 次数: 'count', 数量: 'quantity', 技能: 'skill', 状态: 'status',
  },
  ko: {
    골드: 'gold', 돈: 'money', 코인: 'coins', 보석: 'gems', 다이아: 'diamonds', 생명: 'life', 생명력: 'vitality', 체력: 'health (HP)', 경험치: 'experience points', 경험: 'experience', 레벨: 'level', 공격력: 'attack power', 공격: 'attack', 방어력: 'defense', 방어: 'defense', 속도: 'speed', 힘: 'strength', 마력: 'magic power', 마법: 'magic', 점수: 'score', 포인트: 'points', 아이템: 'items', 인벤토리: 'inventory', 가방: 'bag', 무기: 'weapon', 방어구: 'armor', 장비: 'equipment', 포션: 'potion', 물약: 'potion', 열쇠: 'key', 퀘스트: 'quest', 임무: 'mission', 챕터: 'chapter', 장: 'chapter', 일: 'day', 날: 'day', 시간: 'time', 이름: 'name', 플레이어: 'player', 적: 'enemy', 보스: 'boss', 호감도: 'affection level', 호감: 'affection', 사랑: 'love', 신뢰: 'trust', 우정: 'friendship', 해금: 'unlocked', 완료: 'completed', 최대: 'maximum', 현재: 'current', 합계: 'total', 방패: 'shield', 음식: 'food', 나무: 'wood', 돌: 'stone', 철: 'iron', 상점: 'shop', 가격: 'price', 보상: 'reward', 업적: 'achievements', 별: 'stars', 스테이지: 'stage', 세계: 'world', 지도: 'map', 게임: 'game', 최고: 'best', 횟수: 'count', 개수: 'quantity', 스킬: 'skill', 상태: 'status',
  },
};
const LANG_NAMES = { es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', it: 'Italian', nl: 'Dutch', pl: 'Polish', tr: 'Turkish', ru: 'Russian', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', uk: 'Ukrainian', el: 'Greek', ar: 'Arabic', he: 'Hebrew', th: 'Thai', hi: 'Hindi', vi: 'Vietnamese' };

// Abbreviations: expansions are *guesses* (shown as such)
const ABBR = {
  hp: 'health points', mhp: 'maximum health points', mp: 'magic points', mmp: 'maximum magic points', sp: 'skill/stamina points', tp: 'technique points', ap: 'action/ability points', bp: 'battle points', xp: 'experience points', exp: 'experience', lv: 'level', lvl: 'level', atk: 'attack', att: 'attack', def: 'defense', mat: 'magic attack', mdf: 'magic defense', agi: 'agility', spd: 'speed', luk: 'luck', luck: 'luck', str: 'strength', dex: 'dexterity', int: 'intelligence', wis: 'wisdom', cha: 'charisma', con: 'constitution', vit: 'vitality', crit: 'critical hit', dmg: 'damage', dps: 'damage per second', eva: 'evasion', acc: 'accuracy', res: 'resistance', regen: 'regeneration', cd: 'cooldown', buff: 'temporary bonus', debuff: 'temporary penalty', npc: 'non-player character', pc: 'player character', mc: 'main character', inv: 'inventory', eq: 'equipment', equip: 'equipment', qty: 'quantity', amt: 'amount', cnt: 'count', num: 'number', nb: 'number', idx: 'index', id: 'identifier', cur: 'current', curr: 'current', max: 'maximum', min: 'minimum', tmp: 'temporary', temp: 'temporary', flg: 'flag', flag: 'on/off flag', sw: 'switch', var: 'variable', vars: 'variables', val: 'value', pos: 'position', dir: 'direction', chr: 'character', char: 'character', obj: 'object', btn: 'button', cfg: 'configuration', opt: 'option', prev: 'previous', nxt: 'next', tot: 'total', pts: 'points', pt: 'points', gp: 'gold pieces', g: 'gold', ep: 'episode', ch: 'chapter', lp: 'love points', aff: 'affection', rel: 'relationship', rep: 'reputation', stam: 'stamina', nrg: 'energy', mana: 'mana', hi: 'high', bgm: 'background music', se: 'sound effect', sfx: 'sound effects', fps: 'frames per second', ui: 'user interface', bg: 'background', fx: 'effects', ts: 'timestamp', ms: 'milliseconds',
};

// English game vocabulary (so English words are not reported as foreign)
const ENGLISH = new Set(('gold money coins coin gems gem life lives health level experience attack defense speed strength energy magic mana points score items item inventory weapon weapons armor potion potions key keys quest mission chapter day days hour time player enemy boss name love affection trust friendship unlocked completed seen max maximum min minimum current total shield food wood stone iron shop price reward achievements stars star round stage world map game save best record count number value flag switch variable data state stats status skill skills upgrade upgrades bonus base power luck agility vitality damage combo wave enemy credits cash diamonds crystals ammo fuel lap kills deaths wins losses steps level up is has can show hide on off true false enabled disabled visible music sound volume language settings options config version id index type kind list map x y z width height speed rate timer ticks frames delta last next prev first new old total remaining owned bought unlocked locked done finished started met visited talked read the a an of to in for and or with at by from my your his her their our player1 player2 p1 p2 store persistent global globals extras extra').split(' '));

const SCRIPT_RANGES = [
  ['ja', /[぀-ヿ]/], // kana → Japanese
  ['ko', /[가-힯ᄀ-ᇿ]/],
  ['zh', /[一-鿿]/], // Han without kana → Chinese (or Japanese kanji)
  ['ru', /[Ѐ-ӿ]/],
  ['el', /[Ͱ-Ͽ]/],
  ['ar', /[؀-ۿ]/],
  ['he', /[֐-׿]/],
  ['th', /[฀-๿]/],
  ['hi', /[ऀ-ॿ]/],
];

// lookup index: word -> [{lang, en}]
const INDEX = new Map();
for (const [lang, words] of Object.entries(DICT)) {
  for (const [w, en] of Object.entries(words)) {
    const k = w.toLowerCase();
    if (!INDEX.has(k)) INDEX.set(k, []);
    INDEX.get(k).push({ lang, en });
    const folded = fold(k);
    if (folded !== k) {
      if (!INDEX.has(folded)) INDEX.set(folded, []);
      INDEX.get(folded).push({ lang, en });
    }
  }
}
const CJK_MAX = 6;

function fold(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function scriptLanguage(text) {
  for (const [lang, re] of SCRIPT_RANGES) if (re.test(text)) return lang;
  return null;
}

/** Splits identifiers: camelCase, snake_case, digits, and CJK runs (segmented by dictionary). */
export function tokenize(text) {
  const tokens = [];
  const parts = String(text)
    .replace(/([a-z\u00df-\u00ff\u0430-\u044f\u0451])([A-Z\u0410-\u042f\u0401])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .split(/[\s_\-.$:/\\|,;()[\]{}'"!?·›#]+/)
    .filter(Boolean);
  for (const part of parts) {
    // split runs of different scripts (e.g. "HPの最大" → HP, の, 最大)
    for (const run of part.match(/[぀-ヿ一-鿿가-힯]+|[^぀-ヿ一-鿿가-힯]+/g) || []) {
      if (/^[぀-ヿ一-鿿가-힯]/.test(run)) tokens.push(...segmentCJK(run));
      else tokens.push(run);
    }
  }
  return tokens;
}

function segmentCJK(run) {
  const out = [];
  let i = 0;
  while (i < run.length) {
    let found = null;
    for (let len = Math.min(CJK_MAX, run.length - i); len >= 1; len--) {
      const w = run.slice(i, i + len);
      if (INDEX.has(w)) {
        found = w;
        break;
      }
    }
    if (found) {
      out.push(found);
      i += found.length;
    } else {
      // group unknown characters together until the next known word
      let j = i + 1;
      while (j < run.length && ![...Array(Math.min(CJK_MAX, run.length - j)).keys()].some((d) => INDEX.has(run.slice(j, j + d + 1)))) j++;
      out.push(run.slice(i, j));
      i = j;
    }
  }
  return out.filter((t) => !/^[のをにはがでとへもや]$/.test(t)); // Japanese particles
}

/**
 * @returns {{original, english, kind: 'english'|'translation'|'partial'|'guess'|'none',
 *            language: string|null, languageName: string|null, parts: Array<{src, en, how}>, note}}
 *   kind: 'translation' = every foreign word was in the offline dictionary
 *         'partial'     = some foreign words translated, others not
 *         'guess'       = only abbreviations were expanded (meanings are guesses)
 *         'none'        = foreign text that could not be translated offline
 *         'english'     = already English, nothing to do
 */
export function toEnglish(text) {
  const original = String(text ?? '');
  const result = { original, english: original, kind: 'english', language: null, languageName: null, parts: [], note: '' };
  if (!original.trim() || original.length > 400) return result;
  const tokens = tokenize(original);
  if (!tokens.length) return result;
  const langVotes = new Map();
  let foreign = 0;
  let translated = 0;
  let guessed = 0;
  const script = scriptLanguage(original);
  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (/^\d+$/.test(tok)) {
      result.parts.push({ src: tok, en: tok, how: 'number' });
      continue;
    }
    const nonLatin = !!scriptLanguage(tok);
    if (!nonLatin && ENGLISH.has(low)) {
      result.parts.push({ src: tok, en: low, how: 'english' });
      continue;
    }
    const hits = INDEX.get(low) || INDEX.get(fold(low));
    if (hits) {
      // prefer the language the text's script implies, then the most common vote so far
      const hit = hits.find((h) => h.lang === script) || hits.find((h) => script === 'zh' && h.lang === 'ja') || [...hits].sort((a, b) => (langVotes.get(b.lang) || 0) - (langVotes.get(a.lang) || 0))[0];
      for (const h of hits) langVotes.set(h.lang, (langVotes.get(h.lang) || 0) + (h === hit ? 2 : 1));
      result.parts.push({ src: tok, en: hit.en, how: 'dictionary', lang: hit.lang });
      foreign++;
      translated++;
      continue;
    }
    if (!nonLatin && ABBR[low]) {
      result.parts.push({ src: tok, en: ABBR[low], how: 'abbreviation' });
      guessed++;
      continue;
    }
    if (nonLatin || /[À-ɏ]/.test(tok)) {
      result.parts.push({ src: tok, en: null, how: 'unknown' });
      foreign++;
      continue;
    }
    // plain ASCII word we do not know: could be English, a name, or a foreign word without accents
    result.parts.push({ src: tok, en: tok, how: 'unknown-ascii' });
  }
  // in text that is otherwise in another language, unknown plain words are probably that language too
  if (translated) {
    for (const p of result.parts) {
      if (p.how === 'unknown-ascii' && /^[a-z]{3,}$/i.test(p.src)) {
        p.how = 'unknown';
        p.en = null;
        foreign++;
      }
    }
  }
  const best = [...langVotes].sort((a, b) => b[1] - a[1])[0];
  result.language = (script === 'zh' && langVotes.has('ja') ? 'ja' : script) || (best ? best[0] : null);
  if (script === 'zh' && /[぀-ヿ]/.test(original)) result.language = 'ja';
  result.languageName = result.language ? LANG_NAMES[result.language] || result.language : null;
  result.english = result.parts.map((p) => p.en ?? `“${p.src}”`).join(' ');
  if (foreign && translated === foreign) {
    result.kind = 'translation';
    result.note = `Translated from ${result.languageName || 'another language'} with SaveForge’s offline game dictionary (word by word; the developer’s exact meaning may differ).`;
  } else if (translated) {
    result.kind = 'partial';
    result.note = `Partly translated from ${result.languageName || 'another language'}: words in quotes are not in the offline dictionary.`;
  } else if (foreign) {
    result.kind = 'none';
    result.english = original;
    result.note = result.languageName ? `This looks like ${result.languageName}, but these words are not in the offline dictionary. Use “Translate online” if you want to send just this text to a translation service.` : 'Could not translate this text offline.';
  } else if (guessed) {
    result.kind = 'guess';
    result.note = 'Abbreviations expanded: these are common meanings in games, not a translation, so treat them as guesses.';
  } else {
    result.kind = 'english';
    result.english = original;
  }
  if (result.kind === 'translation' && guessed) result.note += ' Abbreviations were expanded as guesses.';
  return result;
}

/** English label for display ("Show English labels"); returns null when there is nothing to change. */
export function englishLabel(label) {
  const r = toEnglish(label);
  if (r.kind === 'english' || r.kind === 'none') return null;
  // keep the label's structure (· and › separators, #numbers, $ prefixes)
  const pieces = String(label).split(/(\s*[·›]\s*)/);
  const out = pieces.map((piece) => {
    if (/^\s*[·›]\s*$/.test(piece)) return piece;
    const t = toEnglish(piece);
    if (t.kind === 'english' || t.kind === 'none') return piece;
    const prefix = /^[$@#]/.test(piece) ? piece[0] : '';
    const words = t.parts.map((p) => p.en ?? p.src).join(' ');
    return prefix + words.charAt(0).toUpperCase() + words.slice(1);
  });
  const text = out.join('');
  return text === label ? null : { text, kind: r.kind };
}

/** Online translation link (opened only after the user agrees; sends just this text). */
export function onlineTranslateUrl(text) {
  return `https://translate.google.com/?sl=auto&tl=en&op=translate&text=${encodeURIComponent(String(text).slice(0, 1000))}`;
}

export const SUPPORTED_LANGUAGES = Object.keys(DICT).map((k) => LANG_NAMES[k]);
