// The parts of Ren'Py's renpy-pre.js that matter to SaveForge (same names and behaviour).
(function () {
  var q = new URLSearchParams(location.search);
  window.progress = function () {};
  if (q.get('noexec') === '1') return; // older Ren'Py web builds have no JavaScript → Python calls
  var queue = [];
  var cur;
  window._renpy_cmd_callback = function (result) {
    if (!cur) return;
    var c = cur;
    cur = undefined;
    if (result.error !== undefined) c.reject(new Error(result.error));
    else c.resolve(result.data);
    next();
  };
  function next() {
    if (!queue.length) return;
    cur = queue.shift();
    var b64 = btoa(cur.py);
    window._renpy_cmd = "import base64, emscripten, json, traceback;\ntry:result = None;exec(base64.b64decode('" + b64 + "').decode('utf-8'));result = json.dumps(dict(data=result));\nexcept Exception as e:result = json.dumps(dict(error=str(e), name=e.__class__.__name__, traceback=traceback.format_exc()));\nemscripten.run_script('_renpy_cmd_callback(%s)' % (result,));";
  }
  window.renpy_exec = function (py) {
    return new Promise(function (resolve, reject) {
      queue.push({ py: py, resolve: resolve, reject: reject });
      if (!cur) next();
    });
  };
  window.renpy_get = function (name) {
    return window.renpy_exec('result = ' + name);
  };
  window.renpy_set = function (name, value, raw) {
    return window.renpy_exec(raw ? name + ' = ' + value + '; result = True' : 'import base64, json; ' + name + " = json.loads(base64.b64decode('" + btoa(JSON.stringify(value)) + "').decode('utf-8')); result = True");
  };
})();
