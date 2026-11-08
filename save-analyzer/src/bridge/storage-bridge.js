// Storage Bridge.
//
// Browsers do not let one site read another site's storage, so SaveForge
// cannot reach into a game tab. This function is turned into a bookmarklet
// (Function.prototype.toString) that the user runs *on the game's own page*,
// where it has normal same-origin access. It can also be called directly on a
// same-origin iframe window.
//
// It MUST stay self-contained: no imports, no references to outer variables.
//
// Modes:
//   'ui'      floating Export/Import panel (bookmarklet entry point)
//   'collect' returns Promise<dump>
//   'apply'   (dump) writes keys back, returns Promise<summary>
//   'codec'   returns {encode, decode} for tests

export function storageBridge(win, mode, payload) {
  'use strict';
  var FORMAT = 'saveforge-storage-dump';
  var doc = win.document;

  function b64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return win.btoa(s);
  }
  function unb64(text) {
    var s = win.atob(text);
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // Structured-clone values -> JSON with $type tags (lossless for the types games use).
  function encode(v, depth) {
    depth = depth || 0;
    if (depth > 200) throw new Error('Value nested too deeply');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') return isFinite(v) ? v : { $type: 'Number', value: String(v) };
    if (typeof v === 'undefined') return { $type: 'undefined' };
    if (typeof v === 'bigint') return { $type: 'BigInt', value: v.toString() };
    var tag = Object.prototype.toString.call(v).slice(8, -1);
    if (tag === 'Date') return { $type: 'Date', value: isNaN(v.getTime()) ? null : v.toISOString() };
    if (tag === 'ArrayBuffer') return { $type: 'ArrayBuffer', base64: b64(new Uint8Array(v)) };
    if (win.ArrayBuffer.isView && win.ArrayBuffer.isView(v) && tag !== 'DataView') {
      return { $type: tag, base64: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    }
    if (tag === 'Map') {
      var entries = [];
      v.forEach(function (val, key) {
        entries.push([encode(key, depth + 1), encode(val, depth + 1)]);
      });
      return { $type: 'Map', entries: entries };
    }
    if (tag === 'Set') {
      var items = [];
      v.forEach(function (val) {
        items.push(encode(val, depth + 1));
      });
      return { $type: 'Set', items: items };
    }
    if (tag === 'Blob' || tag === 'File') throw new Error('Blob values must be pre-read');
    if (Array.isArray(v)) return v.map(function (x) {
      return encode(x, depth + 1);
    });
    var o = {};
    Object.keys(v).forEach(function (k) {
      o[k] = encode(v[k], depth + 1);
    });
    if (Object.prototype.hasOwnProperty.call(o, '$type')) return { $type: 'Object', value: o };
    return o;
  }

  function decode(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(decode);
    if (typeof v.$type === 'string') {
      switch (v.$type) {
        case 'Number':
          return Number(v.value);
        case 'undefined':
          return undefined;
        case 'BigInt':
          return win.BigInt(v.value);
        case 'Date':
          return new win.Date(v.value === null ? NaN : v.value);
        case 'ArrayBuffer':
          return unb64(v.base64).buffer;
        case 'Map':
          return new win.Map(v.entries.map(function (e) {
            return [decode(e[0]), decode(e[1])];
          }));
        case 'Set':
          return new win.Set(v.items.map(decode));
        case 'Blob':
          return new win.Blob([unb64(v.base64)], { type: v.mime || '' });
        case 'Object':
          var inner = {};
          Object.keys(v.value).forEach(function (k) {
            inner[k] = decode(v.value[k]);
          });
          return inner;
        default:
          if (typeof v.base64 === 'string' && typeof win[v.$type] === 'function') {
            var bytes = unb64(v.base64);
            var Ctor = win[v.$type];
            return new Ctor(bytes.buffer, 0, bytes.byteLength / (Ctor.BYTES_PER_ELEMENT || 1));
          }
          throw new Error('Unknown $type ' + v.$type);
      }
    }
    var o = {};
    Object.keys(v).forEach(function (k) {
      o[k] = decode(v[k]);
    });
    return o;
  }

  function req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () {
        resolve(r.result);
      };
      r.onerror = function () {
        reject(r.error);
      };
    });
  }

  function readBlobs(v) {
    // IndexedDB may hold Blobs (some engines store files that way); read them first.
    var tag = Object.prototype.toString.call(v).slice(8, -1);
    if (tag === 'Blob' || tag === 'File') {
      return v.arrayBuffer().then(function (buf) {
        return { $type: 'Blob', mime: v.type, base64: b64(new Uint8Array(buf)) };
      });
    }
    if (v && typeof v === 'object' && (Array.isArray(v) || tag === 'Object')) {
      var keys = Object.keys(v);
      return Promise.all(keys.map(function (k) {
        return readBlobs(v[k]);
      })).then(function (vals) {
        var out = Array.isArray(v) ? [] : {};
        keys.forEach(function (k, i) {
          out[k] = vals[i];
        });
        return out;
      });
    }
    return Promise.resolve(v);
  }

  function collectDb(name, version) {
    return req(win.indexedDB.open(name)).then(function (db) {
      var stores = Array.prototype.slice.call(db.objectStoreNames);
      var result = { name: name, version: db.version, stores: [] };
      return stores
        .reduce(function (p, storeName) {
          return p.then(function () {
            return new Promise(function (resolve, reject) {
              var tx = db.transaction(storeName, 'readonly');
              var store = tx.objectStore(storeName);
              var records = [];
              var cur = store.openCursor();
              cur.onsuccess = function () {
                var c = cur.result;
                if (!c) {
                  resolve({ name: storeName, keyPath: store.keyPath, autoIncrement: store.autoIncrement, records: records });
                  return;
                }
                records.push({ key: c.primaryKey, value: c.value });
                c.continue();
              };
              cur.onerror = function () {
                reject(cur.error);
              };
            }).then(function (s) {
              return Promise.all(s.records.map(function (r) {
                return readBlobs(r.value).then(function (val) {
                  return { key: encode(r.key), value: encode(val) };
                });
              })).then(function (recs) {
                s.records = recs;
                result.stores.push(s);
              });
            });
          });
        }, Promise.resolve())
        .then(function () {
          db.close();
          return result;
        });
    });
  }

  function collect() {
    var ls = {};
    try {
      for (var i = 0; i < win.localStorage.length; i++) {
        var k = win.localStorage.key(i);
        ls[k] = win.localStorage.getItem(k);
      }
    } catch (e) {
      ls = null;
    }
    var dump = { format: FORMAT, version: 1, origin: win.location.origin, exportedAt: new Date().toISOString(), localStorage: ls, indexedDB: [] };
    if (!win.indexedDB || !win.indexedDB.databases) return Promise.resolve(dump);
    return win.indexedDB.databases().then(function (dbs) {
      return dbs.reduce(function (p, info) {
        return p.then(function () {
          if (!info.name) return;
          return collectDb(info.name, info.version).then(
            function (d) {
              dump.indexedDB.push(d);
            },
            function (e) {
              dump.indexedDB.push({ name: info.name, error: String(e && e.message) });
            },
          );
        });
      }, Promise.resolve());
    }).then(function () {
      return dump;
    });
  }

  function apply(d) {
    if (!d || d.format !== FORMAT) return Promise.reject(new Error('This file is not a SaveForge storage export.'));
    var summary = { localStorage: 0, records: 0, skipped: [] };
    if (d.localStorage) {
      Object.keys(d.localStorage).forEach(function (k) {
        var v = d.localStorage[k];
        if (typeof v !== 'string') return;
        if (win.localStorage.getItem(k) !== v) {
          win.localStorage.setItem(k, v);
          summary.localStorage++;
        }
      });
    }
    return (d.indexedDB || []).reduce(function (p, dbDump) {
      return p.then(function () {
        if (dbDump.error || !dbDump.stores) return;
        return req(win.indexedDB.open(dbDump.name)).then(function (db) {
          var names = dbDump.stores
            .map(function (s) {
              return s.name;
            })
            .filter(function (n) {
              if (db.objectStoreNames.contains(n)) return true;
              summary.skipped.push(dbDump.name + '/' + n + ' (store no longer exists)');
              return false;
            });
          if (!names.length) {
            db.close();
            return;
          }
          return new Promise(function (resolve, reject) {
            var tx = db.transaction(names, 'readwrite');
            dbDump.stores.forEach(function (s) {
              if (names.indexOf(s.name) < 0) return;
              var store = tx.objectStore(s.name);
              s.records.forEach(function (r) {
                var value = decode(r.value);
                if (store.keyPath === null) store.put(value, decode(r.key));
                else store.put(value);
                summary.records++;
              });
            });
            tx.oncomplete = function () {
              db.close();
              resolve();
            };
            tx.onerror = function () {
              reject(tx.error);
            };
          });
        });
      });
    }, Promise.resolve()).then(function () {
      return summary;
    });
  }

  function ui() {
    var old = doc.getElementById('saveforge-bridge');
    if (old) old.remove();
    var box = doc.createElement('div');
    box.id = 'saveforge-bridge';
    box.setAttribute(
      'style',
      'position:fixed;z-index:2147483647;left:12px;right:12px;bottom:12px;max-width:420px;margin:auto;padding:16px;border-radius:16px;background:#12141c;color:#e8ecf5;font:15px/1.4 -apple-system,system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.6);border:1px solid #2c3346',
    );
    var btn = 'flex:1;min-height:46px;border:0;border-radius:12px;font:600 15px -apple-system,system-ui,sans-serif;';
    box.innerHTML =
      '<div style="font-weight:700;margin-bottom:4px">SaveForge Storage Bridge</div>' +
      '<div style="opacity:.75;font-size:13px;margin-bottom:12px">' + win.location.origin + '</div>' +
      '<div style="display:flex;gap:8px"><button data-a="export" style="' + btn + 'background:#3df5a7;color:#04140d">Export saves</button>' +
      '<button data-a="import" style="' + btn + 'background:#2a3145;color:#e8ecf5">Import edited</button>' +
      '<button data-a="close" style="' + btn + 'flex:0 0 46px;background:#2a3145;color:#e8ecf5">✕</button></div>' +
      '<div data-s style="margin-top:10px;font-size:13px;opacity:.85"></div>';
    doc.body.appendChild(box);
    var status = box.querySelector('[data-s]');
    var say = function (t) {
      status.textContent = t;
    };
    box.addEventListener('click', function (ev) {
      var a = ev.target.getAttribute && ev.target.getAttribute('data-a');
      if (a === 'close') box.remove();
      if (a === 'export') {
        say('Reading storage…');
        collect().then(
          function (dump) {
            var blob = new Blob([JSON.stringify(dump, null, 1)], { type: 'application/json' });
            var link = doc.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = (win.location.hostname || 'game') + '-storage.json';
            doc.body.appendChild(link);
            link.click();
            setTimeout(function () {
              URL.revokeObjectURL(link.href);
              link.remove();
            }, 4000);
            say('Exported ' + Object.keys(dump.localStorage || {}).length + ' localStorage keys and ' + dump.indexedDB.length + ' IndexedDB database(s). Open the file in SaveForge.');
          },
          function (e) {
            say('Export failed: ' + e.message);
          },
        );
      }
      if (a === 'import') {
        var input = doc.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = function () {
          var f = input.files[0];
          if (!f) return;
          f.text().then(function (text) {
            var d = JSON.parse(text);
            if (d.origin && d.origin !== win.location.origin && !win.confirm('This export came from ' + d.origin + ', but this page is ' + win.location.origin + '. Import anyway?')) return;
            say('Writing…');
            return apply(d).then(function (s) {
              say('Imported ' + s.localStorage + ' changed localStorage key(s) and ' + s.records + ' IndexedDB record(s).' + (s.skipped.length ? ' Skipped: ' + s.skipped.join(', ') : '') + ' Reload the game to use them.');
              if (win.confirm('Import complete. Reload the game now?')) win.location.reload();
            });
          }).catch(function (e) {
            say('Import failed: ' + e.message);
          });
        };
        input.click();
      }
    });
  }

  if (mode === 'collect') return collect();
  if (mode === 'apply') return apply(payload);
  if (mode === 'codec') return { encode: encode, decode: decode };
  ui();
}

/** javascript: URL for the bookmarklet. */
export function bookmarkletUrl() {
  const src = `(${storageBridge.toString()})(window,'ui')`;
  return 'javascript:' + encodeURIComponent(src.replace(/\n\s*/g, '\n'));
}
