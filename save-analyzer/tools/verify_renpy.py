"""Loads an edited Ren'Py-format save/persistent with CPython and prints the
store values as JSON. Used by test/renpy.test.mjs to cross-check our pickle
patcher against Python's own unpickler. Uses the stand-in fixture classes only;
never run this on untrusted files (pickle.loads executes code)."""

import io
import json
import os
import sys
import zipfile
import zlib

sys.path.insert(0, os.path.dirname(__file__))
import renpy_fixtures  # noqa: E402,F401  (registers stand-in classes)
import pickle  # noqa: E402


def plain(v):
    if isinstance(v, dict):
        return {str(k): plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [plain(x) for x in v]
    if isinstance(v, int) and not isinstance(v, bool) and abs(v) > 2**53:
        return {"bigint": str(v)}
    if hasattr(v, "__dict__"):
        return {"__class__": type(v).__name__, **{k: plain(x) for k, x in vars(v).items()}}
    return v


path = sys.argv[1]
data = open(path, "rb").read()
if data[:2] == b"PK":
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        roots, log = pickle.loads(zf.read("log"))
        out = {"roots": plain(roots), "same_name_object": roots["store.player_name"] is roots["store.companion_name"],
               "log_inventory_is_root": log.current.objects[0] is roots["store.inventory"],
               "signatures": zf.read("signatures").decode() if "signatures" in zf.namelist() else None,
               "names": zf.namelist()}
else:
    d = zlib.decompressobj()
    p = pickle.loads(d.decompress(data))
    out = {"persistent": plain(p), "trailer": d.unused_data.decode()}
print(json.dumps(out))
