"""Ren'Py-shaped fixtures for the sample generator and the cross-check tests.

These are NOT real Ren'Py classes. They are minimal stand-ins registered under
the module names Ren'Py uses (renpy.revertable, renpy.rollback, renpy.persistent,
store) so that CPython's pickler emits the same opcode structure a real save
contains: GLOBAL/STACK_GLOBAL class references, NEWOBJ/REDUCE, BUILD with a
__dict__ state, memoized strings and framed protocol-5 streams.
"""

import sys
import types


def _module(name):
    if name in sys.modules:
        return sys.modules[name]
    mod = types.ModuleType(name)
    sys.modules[name] = mod
    parent, _, child = name.rpartition(".")
    if parent:
        setattr(_module(parent), child, mod)
    return mod


revertable = _module("renpy.revertable")
rollback = _module("renpy.rollback")
persistent_mod = _module("renpy.persistent")
store = _module("store")


class RevertableDict(dict):
    pass


class RevertableList(list):
    pass


class RevertableObject(object):
    pass


class RollbackLog(object):
    pass


class Rollback(object):
    pass


class Persistent(object):
    pass


class Inventory(RevertableObject):
    pass


for cls, mod in [
    (RevertableDict, revertable),
    (RevertableList, revertable),
    (RevertableObject, revertable),
    (RollbackLog, rollback),
    (Rollback, rollback),
    (Persistent, persistent_mod),
    (Inventory, store),
]:
    cls.__module__ = mod.__name__
    setattr(mod, cls.__name__, cls)


def make_roots():
    inv = Inventory()
    inv.owner = "Mira"
    inv.items = RevertableDict({"potion": 3, "ether": 1, "key_red": 1})
    inv.capacity = 20
    name = "Mira"  # memoized and referenced twice
    roots = {
        "store.money": 250,
        "store.day": 4,
        "store.player_name": name,
        "store.companion_name": name,
        "store.mira_love": 12,
        "store.met_alex": True,
        "store.chapter2_unlocked": False,
        "store.stamina": 7.5,
        "store.inventory": inv,
        "store.visited": RevertableList(["town", "forest"]),
        "store.big_number": 2**70,
        "store.negative": -40000,
        "store._version": "1.0",
        "store._rollback": True,
    }
    return roots


def make_log(roots):
    log = RollbackLog()
    rb = Rollback()
    rb.context = "start"
    rb.stores = {"store": {"money": 200}}
    rb.objects = [roots["store.inventory"]]
    log.log = RevertableList([rb])
    log.current = rb
    log.rollback_limit = 128
    return (roots, log)


def make_persistent():
    p = Persistent()
    p._seen_ever = {"start": True, "chapter1": True}
    p._chosen = {}
    p.endings_seen = 2
    p.gallery_unlocked = True
    p.best_time = 182.25
    return p
