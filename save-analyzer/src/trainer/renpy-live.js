// Ren'Py web: live variables through Ren'Py's own JavaScript → Python channel (SaveForge 2.3.1).
//
// Ren'Py web runs the game's Python inside WebAssembly. SaveForge never reads or writes that
// memory. Recent Ren'Py web builds (renpy-pre.js) offer window.renpy_exec / renpy_get / renpy_set:
// JavaScript puts Python into window._renpy_cmd, and Ren'Py runs it on its PERIODIC event
// (renpy/display/core.py exec_js_cmd, about 20 times a second while the game is in an interaction)
// with py_exec in the store namespace.
//
// SaveForge uses that channel with its own wrapper, not renpy_exec's: renpy_exec leaves its JSON
// result in the store variable `result` (it would end up in your saves, and overwrite a game
// variable of that name). SaveForge's command is ONE expression statement,
//   exec(<SaveForge's script>, {'__builtins__': __builtins__})
// which runs in its own namespace and creates no store variables. The script:
//   list  the game's variables: renpy.python.store_dicts['store'].ever_been_changed — the store
//         variables changed since the end of init, i.e. `default` variables and everything the game
//         assigned while playing (exactly what Ren'Py saves). Simple values only: bool, int,
//         float, str (≤ 500 characters), and those inside lists, dicts and the game's own objects
//         (one level). At most `max` values.
//   get   current values of given paths
//   set   one value, same type as the game's current value; then renpy.restart_interaction()
//         so screens show it; returns the value read back from the store
// Results come back through emscripten.run_script('window[<callback>](<json>)').

const PY = String.raw`
import json, base64, types, renpy, emscripten
ARGS = json.loads(base64.b64decode('__ARGS__').decode('utf-8'))
try:
    TEXT = (str, unicode)
except NameError:
    TEXT = (str,)
try:
    INTS = (int, long)
except NameError:
    INTS = (int,)
SAFE = 9007199254740991
store = renpy.store

def kind(v):
    if isinstance(v, bool):
        return 'bool'
    if isinstance(v, INTS):
        return 'int'
    if isinstance(v, float):
        return 'float'
    if isinstance(v, TEXT):
        return 'str'
    return None

def leaf(path, v, game, ro=None):
    t = kind(v)
    if t is None:
        return None
    if t == 'str':
        if len(v) > 500:
            return None
        if not isinstance(v, type(u'')):
            v = v.decode('utf-8', 'replace')
    if t == 'int' and abs(v) > SAFE:
        return {'p': path, 't': 'int', 'v': str(v), 'ro': 'a number too large for JavaScript', 'g': game}
    if t == 'float' and (v != v or v in (float('inf'), float('-inf'))):
        return {'p': path, 't': 'float', 'v': str(v), 'ro': 'not a finite number', 'g': game}
    out = {'p': path, 't': t, 'v': v, 'g': game}
    if ro:
        out['ro'] = ro
    return out

def game_names():
    try:
        return set(renpy.python.store_dicts['store'].ever_been_changed)
    except Exception:
        return None

def own_object(v):
    try:
        return hasattr(v, '__dict__') and str(type(v).__module__).startswith('store')
    except Exception:
        return False

def op_list():
    ebc = game_names()
    d = vars(store)
    cap = int(ARGS.get('max', 3000))
    out = []
    names = sorted(k for k in list(d.keys()) if isinstance(k, TEXT) and not k.startswith('_'))
    for k in names:
        game = ebc is not None and k in ebc
        if not game and not ARGS.get('all'):
            continue
        v = d.get(k)
        if isinstance(v, (types.ModuleType, type)) or isinstance(v, (types.FunctionType, types.BuiltinFunctionType, types.MethodType)):
            continue
        l = leaf([['a', k]], v, game)
        if l:
            out.append(l)
        elif isinstance(v, (list, tuple)):
            ro = 'a tuple cannot be changed' if isinstance(v, tuple) else None
            for i, x in enumerate(v[:100]):
                l = leaf([['a', k], ['i', i]], x, game, ro)
                if l:
                    out.append(l)
        elif isinstance(v, dict):
            for kk in list(v.keys())[:100]:
                if isinstance(kk, TEXT) or (isinstance(kk, INTS) and not isinstance(kk, bool)):
                    l = leaf([['a', k], ['k', kk]], v[kk], game)
                    if l:
                        out.append(l)
        elif own_object(v):
            for a in sorted(vars(v).keys())[:100]:
                if isinstance(a, TEXT) and not a.startswith('_'):
                    l = leaf([['a', k], ['a', a]], vars(v)[a], game)
                    if l:
                        out.append(l)
        if len(out) >= cap:
            break
    return {'vars': out[:cap], 'total': len(out), 'version': getattr(renpy, 'version_only', ''), 'name': getattr(renpy.config, 'name', '') or '', 'ebc': (len(ebc) if ebc is not None else None)}

def resolve(path):
    o = store
    for step in path:
        if step[0] == 'a':
            o = getattr(o, step[1])
        elif step[0] == 'i':
            o = o[int(step[1])]
        else:
            o = o[step[1]]
    return o

def op_get():
    vals = []
    for p in ARGS['paths']:
        try:
            l = leaf(p, resolve(p), True)
            vals.append({'ok': True, 'v': l['v'], 't': l['t']} if l else {'ok': False})
        except Exception:
            vals.append({'ok': False})
    return {'values': vals}

def op_set():
    path = ARGS['path']
    value = ARGS['value']
    parent = resolve(path[:-1])
    step = path[-1]
    if isinstance(parent, tuple):
        raise Exception('a tuple cannot be changed')
    if step[0] == 'a':
        cur = getattr(parent, step[1])
    else:
        cur = parent[int(step[1]) if step[0] == 'i' else step[1]]
    t = kind(cur)
    if t is None:
        raise Exception('this is not a simple value')
    if t == 'bool':
        if not isinstance(value, bool):
            raise Exception('the game keeps true/false here')
    elif t == 'int':
        if isinstance(value, bool) or not isinstance(value, (INTS + (float,))) or value != int(value):
            raise Exception('the game keeps a whole number here')
        value = int(value)
    elif t == 'float':
        if isinstance(value, bool) or not isinstance(value, (INTS + (float,))):
            raise Exception('the game keeps a number here')
        value = float(value)
    elif t == 'str':
        if not isinstance(value, TEXT):
            raise Exception('the game keeps text here')
    if step[0] == 'a':
        setattr(parent, step[1], value)
    else:
        parent[int(step[1]) if step[0] == 'i' else step[1]] = value
    try:
        renpy.exports.restart_interaction()
    except Exception:
        pass
    l = leaf(path, resolve(path), True)
    return {'v': l['v'] if l else None}

def node_info(n):
    return {'type': type(n).__name__, 'file': str(getattr(n, 'filename', '') or ''), 'line': int(getattr(n, 'linenumber', 0) or 0)}

def summarize(block):
    out = []
    for x in list(block or [])[:3]:
        t = type(x).__name__
        if t == 'Say':
            out.append({'say': str(getattr(x, 'what', '') or '')[:120]})
        elif t == 'Jump':
            out.append({'jump': str(getattr(x, 'target', '') or '')})
        elif t == 'Python':
            out.append({'py': str(getattr(getattr(x, 'code', None), 'source', '') or '')[:120]})
    return out

def op_input():
    # Input Inspector (2.3.3): the statement Ren'Py is executing (renpy.input waits inside it) and
    # the conditions that follow it, as source text. Nothing is executed.
    ctx = renpy.game.context()
    cur = renpy.game.script.lookup(ctx.current)
    info = node_info(cur)
    try:
        info['source'] = str(cur.code.source)[:500]
    except Exception:
        info['source'] = ''
    checks = []
    steps = []
    n = getattr(cur, 'next', None)
    seen = set()
    while n is not None and len(seen) < 40 and id(n) not in seen:
        seen.add(id(n))
        t = type(n).__name__
        if t == 'If':
            for cond, block in n.entries:
                c = node_info(n)
                c.update({'cond': str(cond)[:400], 'then': summarize(block)})
                checks.append(c)
        elif t == 'While':
            c = node_info(n)
            c.update({'cond': str(n.condition)[:400], 'then': summarize(n.block), 'loop': True})
            checks.append(c)
        elif t == 'Python':
            c = node_info(n)
            c.update({'source': str(getattr(getattr(n, 'code', None), 'source', '') or '')[:300]})
            steps.append(c)
        elif t in ('Jump', 'Return'):
            break
        n = getattr(n, 'next', None)
    return {'current': info, 'checks': checks, 'steps': steps}

try:
    data = {'list': op_list, 'get': op_get, 'set': op_set, 'input': op_input}[ARGS['op']]()
    reply = {'id': ARGS['id'], 'ok': True, 'data': data}
except Exception as e:
    reply = {'id': ARGS['id'], 'ok': False, 'error': '%s: %s' % (e.__class__.__name__, e)}
emscripten.run_script('window[%s] && window[%s](%s)' % (json.dumps(ARGS['cb']), json.dumps(ARGS['cb']), json.dumps(reply)))
`;

/** The Python SaveForge sends for one operation (exported for the CPython test). */
export function renpyScript(args) {
  const json = JSON.stringify(args);
  return `# saveforge-renpy ${json}\n${PY.replace('__ARGS__', b64(json))}`;
}
/** The single expression statement written to window._renpy_cmd (creates no store variables). */
export function renpyCommand(args) {
  return `exec(__import__('base64').b64decode('${b64(renpyScript(args))}').decode('utf-8'), {'__builtins__': __builtins__})`;
}
function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Is this a Ren'Py web page, and can SaveForge talk to Ren'Py from here? Cheap, enumerates nothing. */
export function renpyWebInfo(win) {
  const own = (k) => {
    try {
      return Object.getOwnPropertyDescriptor(win, k)?.value;
    } catch {
      return undefined;
    }
  };
  let renpy = false;
  const why = [];
  try {
    const doc = win.document;
    if (typeof own('renpy_exec') === 'function') (renpy = true), why.push('window.renpy_exec');
    if (doc.querySelector('script[src*="renpy"]')) (renpy = true), why.push('renpy.js / renpy-pre.js scripts');
    const M = own('Module');
    if (M && typeof M === 'object' && M.dataFileDownloads && Object.keys(M.dataFileDownloads).some((k) => /renpy/i.test(k))) (renpy = true), why.push('Module loads renpy.data');
    if (doc.getElementById('ContextButton') && doc.getElementById('canvas') && own('FS')) (renpy = true), why.push("Ren'Py web page layout");
  } catch {
    /* no DOM */
  }
  const exec = typeof own('renpy_exec') === 'function';
  return {
    renpy,
    exec,
    evidence: why.join(', '),
    reason: !renpy
      ? ''
      : exec
        ? "This Ren'Py web build has Ren'Py's JavaScript interface (renpy_exec)."
        : renpy && own('FS')
          ? "This Ren'Py web build has no JavaScript interface to its Python (renpy_exec was added in recent Ren'Py versions), so its variables cannot be read or changed live."
          : "SaveForge cannot reach Ren'Py's JavaScript interface from here: it runs isolated from the page (Diagnostics → Script context), or the game has not started yet.",
  };
}

/** Sends SaveForge's commands to Ren'Py and receives the replies. One command at a time. */
export function renpyBridge(win, { timeoutMs = 6000 } = {}) {
  const cb = `__saveforgeRenpy_${Math.random().toString(36).slice(2, 8)}`;
  const pending = new Map();
  let seq = 0;
  let chain = Promise.resolve();
  let stats = { sent: 0, answered: 0, timeouts: 0, lastMs: 0, lastAt: 0 };
  win[cb] = (reply) => {
    const p = reply && pending.get(reply.id);
    if (!p) return;
    pending.delete(reply.id);
    win.clearTimeout(p.timer);
    stats.answered++;
    stats.lastMs = Date.now() - p.at;
    stats.lastAt = Date.now();
    if (reply.ok) p.resolve(reply.data);
    else p.reject(new Error(`Ren'Py: ${reply.error}`));
  };
  const once = (op, args, wait) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const at = Date.now();
      const cmd = renpyCommand({ ...args, op, id, cb });
      // never overwrite a command Ren'Py has not read yet (the game's own renpy_exec, e.g. save import)
      const start = () => {
        if (typeof win._renpy_cmd === 'string' && win._renpy_cmd.length) {
          if (Date.now() - at > wait) return reject(new Error("Ren'Py is busy with another command."));
          return void win.setTimeout(start, 50);
        }
        win._renpy_cmd = cmd;
        stats.sent++;
        const timer = win.setTimeout(() => {
          pending.delete(id);
          stats.timeouts++;
          // not read yet: take it back, so it never runs later unexpectedly
          if (win._renpy_cmd === cmd) delete win._renpy_cmd;
          reject(new Error(`Ren'Py did not answer within ${Math.round(wait / 1000)} s. It runs commands only while the game is waiting for you (dialogue, a menu); a loading screen or a paused tab does not answer.`));
        }, wait);
        pending.set(id, { resolve, reject, timer, at });
      };
      start();
    });
  return {
    call(op, args = {}, { timeout = timeoutMs } = {}) {
      const run = chain.then(() => once(op, args, timeout));
      chain = run.catch(() => {});
      return run;
    },
    stats: () => ({ ...stats, pending: pending.size }),
    dispose() {
      for (const p of pending.values()) win.clearTimeout(p.timer);
      pending.clear();
      try {
        delete win[cb];
      } catch {
        win[cb] = undefined;
      }
    },
  };
}

const keyOf = (p) => JSON.stringify(p);

/**
 * The Ren'Py engine for LiveProvider. Values are mirrored in a plain object (the tree SaveForge
 * shows); the mirror is refreshed from Ren'Py in small rotating batches and written only through
 * Ren'Py (writeAsync: set, read back by Ren'Py, verified again later by the provider).
 */
export function renpyEngine(win, { buildLiveTree, max = 3000 } = {}) {
  const bridge = renpyBridge(win);
  let mirror = {};
  let leaves = []; // [{p, t, v, g, ro}]
  let pathOf = new Map(); // mirror key path (\0-joined) -> Ren'Py path
  let roOf = new Map();
  let info = null;
  let all = false;
  let timer = 0;
  let rot = 0;
  let listedAt = 0;
  const priority = new Set(); // Ren'Py paths read on every refresh (just edited)
  const listeners = new Set();
  let disposed = false;
  let lastError = '';

  const segOf = (step) => (step[0] === 'i' ? String(step[1]) : String(step[1]));
  const mirrorKey = (p) => p.map(segOf).join('\u0000');
  function rebuild(list) {
    leaves = list.vars || [];
    info = { version: list.version, name: list.name, total: list.total, ebc: list.ebc };
    mirror = {};
    pathOf = new Map();
    roOf = new Map();
    for (const l of leaves) {
      let o = mirror;
      for (let i = 0; i < l.p.length - 1; i++) {
        const k = segOf(l.p[i]);
        if (!o[k] || typeof o[k] !== 'object') o[k] = l.p[i + 1][0] === 'i' ? [] : {};
        o = o[k];
      }
      o[segOf(l.p[l.p.length - 1])] = l.t === 'int' && typeof l.v === 'string' ? l.v : l.v;
      pathOf.set(mirrorKey(l.p), l.p);
      if (l.ro) roOf.set(mirrorKey(l.p), l.ro);
    }
    listedAt = Date.now();
  }
  async function list() {
    rebuild(await bridge.call('list', { max, all }, { timeout: 8000 }));
  }
  const setMirror = (p, v) => {
    let o = mirror;
    for (let i = 0; i < p.length - 1; i++) {
      o = o?.[segOf(p[i])];
      if (!o) return;
    }
    o[segOf(p[p.length - 1])] = v;
  };
  const idToPath = (id) => pathOf.get(id.split('/').slice(1).map((x) => x.replace(/~1/g, '/').replace(/~0/g, '~')).join('\u0000'));

  /** One refresh: up to 300 values in rotation, plus the ones just edited. */
  async function refresh() {
    if (disposed || !leaves.length) return;
    const batch = [...priority].map((k) => JSON.parse(k));
    const n = Math.min(300, leaves.length);
    for (let i = 0; i < n && batch.length < 320; i++) batch.push(leaves[(rot + i) % leaves.length].p);
    rot = (rot + n) % Math.max(1, leaves.length);
    const res = await bridge.call('get', { paths: batch });
    res.values.forEach((r, i) => r.ok && setMirror(batch[i], r.v));
    lastError = '';
  }

  const engine = {
    id: 'renpy',
    name: "Ren'Py (live)",
    channel: 'live',
    noLocks: true, // values change only through Ren'Py's answers, not 10 times a second
    ownedByProvider: true,
    evidence: "Ren'Py's JavaScript interface (window.renpy_exec / _renpy_cmd) answered",
    note: "Ren'Py's store variables, read and changed through Ren'Py's own JavaScript interface — never its WebAssembly memory. Ren'Py applies a change while the game waits for you (dialogue, a menu) and redraws its screens; save in-game to keep it. Rolling back past the change undoes it, like any change in Ren'Py.",
    get info() {
      return info;
    },
    bridgeStats: () => bridge.stats(),
    /** One operation through Ren'Py's channel (the Input Inspector's 'input'). */
    call: (op, args = {}) => bridge.call(op, args),
    lastError: () => lastError,
    async prepare() {
      await list();
    },
    snapshot() {
      const t = buildLiveTree(mirror, { maxNodes: max + 500, maxDepth: 4, rootLabel: "Ren'Py store" });
      // read-only values (numbers too large for JavaScript, tuples) stay visible but cannot be edited
      const mark = (n, keys) => {
        for (const c of n.children || []) {
          const ks = [...keys, c.key];
          if (c.children) mark(c, ks);
          // shown (the menu lists editable leaves), but every write path refuses it
          else if (roOf.has(ks.join('\u0000'))) c.meta = { ...(c.meta || {}), readOnlyReason: `Read-only: ${roOf.get(ks.join('\u0000'))}.` };
        }
      };
      mark(t.root, []);
      this.lastReport = { count: t.count, truncated: t.truncated || (info && info.total > leaves.length), listed: leaves.length, total: info?.total ?? leaves.length };
      return t;
    },
    scanReport() {
      return this.lastReport || null;
    },
    root: () => mirror,
    sourceOf(id) {
      const p = idToPath(id);
      if (!p) return "Ren'Py store";
      return `Ren'Py variable ${p.map((s, i) => (s[0] === 'a' ? `${i ? '.' : ''}${s[1]}` : `[${JSON.stringify(s[1])}]`)).join('')}`;
    },
    /** Sets through Ren'Py; resolves with the value Ren'Py's store has afterwards. */
    async writeAsync(id, value) {
      const p = idToPath(id);
      if (!p) throw new Error('This value is no longer listed. Tap Rescan game.');
      if (roOf.has(mirrorKey(p))) throw new Error(roOf.get(mirrorKey(p)));
      const r = await bridge.call('set', { path: p, value });
      setMirror(p, r.v);
      priority.add(keyOf(p));
      win.setTimeout(() => priority.delete(keyOf(p)), 15000);
      return { value: r.v };
    },
    /** Reads one value from Ren'Py again (verification). */
    async readAsync(id) {
      const p = idToPath(id);
      if (!p) return { ok: false };
      const r = await bridge.call('get', { paths: [p] });
      const x = r.values[0];
      if (x && x.ok) setMirror(p, x.v);
      return x && x.ok ? { ok: true, value: x.v } : { ok: false };
    },
    onLearned(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Background refresh while the trainer is visible (paused when minimized or hidden). */
    startLearning(every = 2000) {
      if (timer || disposed || !every) return;
      let busy = false;
      timer = win.setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          // the list itself is re-read now and then: the game may have new variables
          if (Date.now() - listedAt > 30000) {
            const before = leaves.length;
            await list();
            if (leaves.length !== before) for (const fn of listeners) fn([]);
          } else await refresh();
        } catch (e) {
          lastError = e.message;
        } finally {
          busy = false;
        }
      }, Math.max(1500, every));
    },
    stopLearning() {
      if (timer) win.clearInterval(timer);
      timer = 0;
    },
    learning: () => !!timer,
    /** Ren'Py's own store variables too (config-like flags of the engine), or the game's only. */
    async setShowAll(v) {
      all = !!v;
      await list();
      for (const fn of listeners) fn([]);
    },
    showsAll: () => all,
    dispose() {
      disposed = true;
      engine.stopLearning();
      bridge.dispose();
    },
  };
  return engine;
}

/** Ren'Py web without a reachable JavaScript interface: an empty, working trainer that says why. */
export function renpyUnavailableEngine(win, info, { buildLiveTree } = {}) {
  return {
    id: 'renpy-info',
    name: "Ren'Py web",
    channel: 'live',
    evidence: info.evidence,
    note: `${info.reason} SaveForge never reads or writes the game's WebAssembly memory. Its saves can be inspected (and edited with verification) under Saves in storage.`,
    emptyLabel: "Ren'Py's variables are not reachable here",
    emptyHint: `${info.reason} Open “Inspect the saves” below, or Diagnostics for details.`,
    snapshot() {
      return buildLiveTree({}, { maxNodes: 1, rootLabel: "Ren'Py" });
    },
    actions: [],
  };
}
