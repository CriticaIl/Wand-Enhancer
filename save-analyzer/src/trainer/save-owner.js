// Whose save is this? (SaveForge 2.3)
//
// Browsers give every page of a website ONE localStorage and one set of IndexedDB databases.
// Hosts that serve many games from one origin (itch.io's HTML game host, GitHub Pages, portals)
// therefore mix the saves of different games in the same storage, and before 2.3 the trainer
// offered Game A's save variables — and wrote them — while you played Game B.
//
// Every storage entry (localStorage key, IndexedDB database) gets an owner game, remembered per
// website in SaveForge's own database:
//   - an entry that the running game creates or changes while SaveForge is open belongs to it
//     (SaveForge watched the game write it)
//   - an entry whose name contains words of exactly one game's address or title belongs to that
//     game (moonharbor_save → "Moon Harbor")
//   - otherwise the owner is unknown
// Entries owned by ANOTHER game are left out of this game's saves completely (never shown, never
// written; Diagnostics lists them and can hand one back to this game). Entries of unknown owner
// stay available, but once SaveForge has seen more than one game on the website, writing one asks
// first.

import { hashStr } from './context.js';

const KEY = 'save-owners';

function sig(v) {
  if (v === null || v === undefined) return 'null';
  const s = typeof v === 'string' ? v : JSON.stringify(v) || '';
  return `${s.length}:${hashStr(s)}`;
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Storage entries of a Storage Bridge dump: [{id, kind, name, sig}] */
export function storageEntries(dump) {
  const out = [];
  for (const [k, v] of Object.entries(dump?.localStorage || {})) out.push({ id: `ls:${k}`, kind: 'localStorage', name: k, sig: sig(v) });
  for (const db of dump?.indexedDB || []) if (db && db.name) out.push({ id: `idb:${db.name}`, kind: 'indexedDB', name: db.name, sig: db.stores ? sig(db.stores) : 'unread' });
  for (const n of dump?.indexedDBNotRead || []) out.push({ id: `idb:${n}`, kind: 'indexedDB', name: n, sig: 'unread' });
  return out;
}

export class SaveOwnership {
  /** siteStore: SaveForge's per-website store (shared by every game of the site). */
  constructor(siteStore, ctx, tokens = []) {
    this.store = siteStore;
    this.me = ctx.key;
    this.title = ctx.title || '';
    this.tokens = tokens.map(norm).filter((t) => t.length >= 4);
    this.reg = { games: {}, keys: {} };
    this.seen = new Map(); // entry id -> signature first seen in this session
    this.first = true; // the first read of this session
    this.foreign = []; // [{id, kind, name, owner, ownerTitle}] left out at the last read
    this.unknown = new Set(); // entry ids of unknown owner at the last read
    this.ready = null;
  }

  load() {
    this.ready ||= (async () => {
      try {
        const r = await this.store.get(KEY, null);
        if (r && r.games && r.keys) this.reg = r;
      } catch {
        /* no registry yet */
      }
      this.reg.games[this.me] = { title: this.title, tokens: this.tokens, last: Date.now() };
      this.save();
    })();
    return this.ready;
  }
  save() {
    this.store.set(KEY, this.reg).catch?.(() => {});
  }
  /** More than one game has been opened with SaveForge on this website. */
  multiGame() {
    return Object.keys(this.reg.games).length > 1;
  }
  titleOf(game) {
    return this.reg.games[game]?.title || game;
  }

  /** Name evidence: which known game's words appear in this entry's name (only if exactly one). */
  byName(name) {
    const n = norm(name);
    const hits = [];
    for (const [g, info] of Object.entries(this.reg.games)) if ((info.tokens || []).some((t) => n.includes(t))) hits.push(g);
    return hits.length === 1 ? hits[0] : null;
  }

  ownerOf(id) {
    return this.reg.keys[id]?.owner || null;
  }

  /** Records what this read shows (entries the game wrote while SaveForge watched become its own). */
  observe(dump) {
    let changed = false;
    for (const e of storageEntries(dump)) {
      const rec = this.reg.keys[e.id];
      const before = this.seen.get(e.id);
      if (this.first) {
        this.seen.set(e.id, e.sig);
        if (!rec) {
          const g = this.byName(e.name);
          if (g) {
            this.reg.keys[e.id] = { owner: g, how: 'name', at: Date.now() };
            changed = true;
          }
        }
        continue;
      }
      // created or changed during this session, while this game ran: the game wrote it
      if (e.sig !== 'unread' && (before === undefined || before !== e.sig)) {
        this.seen.set(e.id, e.sig);
        if (!rec || rec.owner !== this.me) {
          this.reg.keys[e.id] = { owner: this.me, how: 'written', at: Date.now() };
          changed = true;
        }
      }
    }
    this.first = false;
    if (changed) this.save();
  }

  /** Cheap localStorage-only look (closing): saves the game wrote since the last read become its own. */
  observeLocal(win) {
    if (this.first) return; // nothing was read in this session: nothing to compare with
    const ls = {};
    try {
      const st = win.localStorage;
      for (let i = 0; i < st.length; i++) {
        const k = st.key(i);
        const v = st.getItem(k);
        if (v && v.length > 4 * 1024 * 1024) continue; // very large values: compared at the next read
        ls[k] = v;
      }
    } catch {
      return;
    }
    this.observe({ localStorage: ls });
  }

  /** This game's view of a dump: entries of other games removed (listed in this.foreign). */
  filter(dump) {
    if (!dump) return dump;
    this.observe(dump);
    const foreign = [];
    const unknown = new Set();
    const keep = (id, kind, name) => {
      // engine knowledge first (SugarCube names its keys after the story): not stored, exact
      const hint = this.hint ? this.hint(name, kind) : null;
      if (hint === 'me') return true;
      if (hint) {
        foreign.push({ id, kind, name, owner: hint.owner, ownerTitle: hint.title, how: 'engine' });
        return false;
      }
      const o = this.ownerOf(id);
      if (!o) {
        unknown.add(id);
        return true;
      }
      if (o === this.me) return true;
      foreign.push({ id, kind, name, owner: o, ownerTitle: this.titleOf(o) });
      return false;
    };
    const out = { ...dump };
    if (dump.localStorage) out.localStorage = Object.fromEntries(Object.entries(dump.localStorage).filter(([k]) => keep(`ls:${k}`, 'localStorage', k)));
    if (dump.indexedDB) out.indexedDB = dump.indexedDB.filter((db) => !db || !db.name || keep(`idb:${db.name}`, 'indexedDB', db.name));
    if (dump.indexedDBNotRead) out.indexedDBNotRead = dump.indexedDBNotRead.filter((n) => keep(`idb:${n}`, 'indexedDB', n));
    this.foreign = foreign;
    this.unknown = unknown;
    return out;
  }

  /** Entry ids (of edited storage node ids) whose owner is unknown while the site has several games. */
  uncertainFor(nodeIds, dump) {
    if (!this.multiGame()) return [];
    const out = new Set();
    for (const id of nodeIds) {
      const seg = String(id).split('/').map((x) => x.replace(/~1/g, '/').replace(/~0/g, '~'));
      let eid = null;
      if (seg[1] === 'localStorage') eid = `ls:${seg[2]}`;
      else if (seg[1] === 'indexedDB') eid = `idb:${dump?.indexedDB?.[Number(seg[2])]?.name}`;
      if (eid && this.unknown.has(eid)) out.add(eid.replace(/^(ls|idb):/, ''));
    }
    return [...out];
  }

  /** "This is this game's save" (Diagnostics), or forget the owner. */
  assign(id, toMe = true) {
    if (toMe) this.reg.keys[id] = { owner: this.me, how: 'you', at: Date.now() };
    else delete this.reg.keys[id];
    this.save();
  }
  /** Forget which entries this game owns (Reset this game's trainer data); other games keep theirs. */
  forgetMine() {
    for (const [id, r] of Object.entries(this.reg.keys)) if (r.owner === this.me) delete this.reg.keys[id];
    this.save();
  }
  report() {
    return {
      games: Object.entries(this.reg.games).map(([key, g]) => ({ key, title: g.title, me: key === this.me })),
      foreign: this.foreign,
      unknown: [...this.unknown].map((x) => x.replace(/^(ls|idb):/, '')),
      multi: this.multiGame(),
    };
  }
}
