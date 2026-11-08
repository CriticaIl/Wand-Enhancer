"""Generates Ren'Py-format sample files into samples/.

Layout follows renpy/loadsave.py (SaveRecord.write_file) and renpy/persistent.py:
  save slot  = ZIP_DEFLATED archive: screenshot.png, extra_info, json,
               renpy_version, log (pickle of (roots, rollback_log)), signatures
  persistent = zlib.compress(pickle(Persistent), 3) + signature text
Run: python3 tools/make_renpy_samples.py
"""

import base64
import json
import os
import pickle
import sys
import zipfile
import zlib

sys.path.insert(0, os.path.dirname(__file__))
import renpy_fixtures as fx  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "samples")
os.makedirs(OUT, exist_ok=True)

# 1x1 transparent PNG
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
FAKE_SIGNATURE = "signature {} {}\n".format(
    base64.b64encode(b"fake-verifying-key-der").decode(), base64.b64encode(b"fake-signature").decode()
)


def write_save(path, protocol, signed=True):
    roots = fx.make_roots()
    log = pickle.dumps(fx.make_log(roots), protocol)
    meta = {"_save_name": "Forest camp", "_renpy_version": [8, 3, 4, 24120703], "_version": "1.0", "_game_runtime": 5321.4, "_ctime": 1731000000.0}
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("screenshot.png", PNG)
        zf.writestr("extra_info", "Forest camp".encode("utf-8"))
        zf.writestr("json", json.dumps(meta))
        zf.writestr("renpy_version", "Ren'Py 8.3.4.24120703")
        zf.writestr("log", log)
        if signed:
            zf.writestr("signatures", FAKE_SIGNATURE)


def write_persistent(path, signed):
    data = pickle.dumps(fx.make_persistent(), 5)
    blob = zlib.compress(data, 3)
    if signed:
        blob += FAKE_SIGNATURE.encode("utf-8")
    with open(path, "wb") as f:
        f.write(blob)


if __name__ == "__main__":
    write_save(os.path.join(OUT, "renpy8-1-1-LT1.save"), 5)
    write_save(os.path.join(OUT, "renpy-legacy-protocol2.save"), 2, signed=False)
    write_save(os.path.join(OUT, "renpy-protocol0.save"), 0, signed=False)
    write_persistent(os.path.join(OUT, "renpy-persistent-unsigned"), False)
    write_persistent(os.path.join(OUT, "renpy-persistent-signed"), True)
    print("ok")
