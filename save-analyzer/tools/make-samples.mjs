// Generates HTML5-engine sample saves into samples/ using the same libraries
// those engines ship (lz-string, pako), so the encodings match real games.
// The game data itself is synthetic. Run: node tools/make-samples.mjs

import { writeFileSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import LZString from 'lz-string';
import pako from 'pako';

const out = (name, data) => writeFileSync(new URL(`../samples/${name}`, import.meta.url), data);

// ---------------------------------------------------------------- RPG Maker MV/MZ (JsonEx shape)
function rpgMakerContents() {
  const switches = [null];
  for (let i = 1; i <= 24; i++) switches.push(i % 3 === 0);
  const variables = [null];
  for (let i = 1; i <= 12; i++) variables.push(i * 10);
  const actor = (id, name, hp, mp, level, exp) => ({
    _actorId: id, _name: name, _nickname: '', _profile: '', _hp: hp, _mp: mp, _tp: 0, _level: level,
    _classId: 1, _exp: { 1: exp, '@c': 7 }, _skills: { '@a': [1, 3, 8], '@c': 8 },
    _paramPlus: { '@a': [0, 0, 5, 0, 0, 0, 2, 0], '@c': 9 }, _equips: { '@a': [], '@c': 10 }, '@c': 6,
  });
  return {
    system: { _saveEnabled: true, _saveCount: 7, _battleCount: 31, _winCount: 29, _escapeCount: 1, _framesOnSave: 216000, '@c': 1 },
    screen: { _brightness: 255, '@c': 2 },
    timer: { _frames: 0, _working: false, '@c': 3 },
    switches: { _data: { '@a': switches, '@c': 5 }, '@c': 4 },
    variables: { _data: { '@a': variables, '@c': 12 }, '@c': 11 },
    selfSwitches: { _data: { '1,3,A': true, '@c': 14 }, '@c': 13 },
    actors: { _data: { '@a': [null, actor(1, 'Reid', 412, 88, 14, 18233), actor(2, 'Priscilla', 305, 160, 13, 16002)], '@c': 16 }, '@c': 15 },
    party: { _inBattle: false, _gold: 1520, _steps: 4410, _items: { 1: 12, 7: 2, 11: 1, '@c': 18 }, _weapons: { 3: 1, '@c': 19 }, _armors: { 2: 1, 5: 1, '@c': 20 }, _actors: { '@a': [1, 2], '@c': 21 }, '@c': 17 },
    map: { _mapId: 3, _displayX: 0, _displayY: 0, '@c': 22 },
    player: { _x: 10, _y: 12, _direction: 2, '@c': 23 },
  };
}
const mv = JSON.stringify(rpgMakerContents());
out('rpgmaker-mv-file1.rpgsave', LZString.compressToBase64(mv));
// MZ: StorageManager.jsonToZip = pako.deflate(json, {to: "string", level: 1}); written with fs as UTF-8
const mzBinary = pako.deflate(mv, { level: 1 });
out('rpgmaker-mz-file1.rmmzsave', Buffer.from(String.fromCharCode(...mzBinary), 'utf8'));

// ---------------------------------------------------------------- SugarCube 2 export (Save.export → LZString base64)
const sugar = {
  state: {
    history: [{ title: 'Market', variables: { gold: 85, health: 70, maxHealth: 100, reputation: 3, metOracle: true, inventory: { rope: 1, torch: 4 }, companion: 'Wren', flags: { bridgeRepaired: false } } }],
    index: 0,
    expired: [],
    seed: 'kB4vQ',
  },
  title: 'The Lantern Road',
  date: 1731000000000,
  id: 'the-lantern-road',
  idx: 0,
  version: 2,
};
out('sugarcube-the-lantern-road.save', LZString.compressToBase64(JSON.stringify(sugar)));

// ---------------------------------------------------------------- Generic HTML5 sandbox: base64(JSON) in localStorage
const sandbox = {
  version: '0.9.3',
  player: { name: 'Builder', level: 6, xp: 1340, hp: 82, maxHp: 120, energy: 40.5 },
  resources: { coins: 4200, gems: 15, wood: 380, stone: 125, iron: 12 },
  unlocks: { workshop: true, harbor: false, airship: false },
  achievements: { firstHouse: true, hundredTrees: true, millionaire: false },
  settings: { musicVolume: 0.6, language: 'en' },
  stats: { playtimeSeconds: 18003, buildingsPlaced: 57 },
  lastSaved: 1731000000123,
  bigSeed: 12345678901234567890,
};
out('sandbox-base64.txt', Buffer.from(JSON.stringify(sandbox)).toString('base64'));
out('sandbox-plain.json', JSON.stringify(sandbox, null, 2) + '\n');
out('sandbox-gzip.save', gzipSync(Buffer.from(JSON.stringify(sandbox))));

// ---------------------------------------------------------------- GameMaker-style INI
out(
  'gamemaker-save.ini',
  ['[player]', 'name="Kit"', 'gold="2500.000000"', 'level="9.000000"', 'hp="64.000000"', '', '[progress]', 'chapter="3.000000"', 'boss1_defeated="1.000000"', 'secret_found="0.000000"', ''].join('\r\n'),
);

// ---------------------------------------------------------------- Storage Bridge export (bookmarklet format)
const renpyWebSave = readFileSync(new URL('../samples/renpy8-1-1-LT1.save', import.meta.url));
const dump = {
  format: 'saveforge-storage-dump',
  version: 1,
  origin: 'https://example-game.local',
  exportedAt: '2026-11-08T12:00:00.000Z',
  localStorage: {
    'RPG File1': LZString.compressToBase64(mv),
    sandbox_save: Buffer.from(JSON.stringify(sandbox)).toString('base64'),
    settings: JSON.stringify({ volume: 0.8, fullscreen: false }),
    plainNumber: '42',
  },
  indexedDB: [
    {
      name: '/home/web_user/.renpy',
      version: 21,
      stores: [
        {
          name: 'FILE_DATA',
          keyPath: null,
          autoIncrement: false,
          records: [
            {
              key: '/home/web_user/.renpy/demo-123/1-1-LT1.save',
              value: { timestamp: { $type: 'Date', value: '2026-11-08T11:59:00.000Z' }, mode: 33206, contents: { $type: 'Uint8Array', base64: renpyWebSave.toString('base64') } },
            },
          ],
        },
      ],
    },
  ],
};
out('storage-dump-example.json', JSON.stringify(dump, null, 2));
console.log('ok');
