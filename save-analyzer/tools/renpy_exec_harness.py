"""Runs SaveForge's Ren'Py command the way Ren'Py web does (SaveForge 2.3.1 test harness).

Ren'Py's exec_js_cmd() reads window._renpy_cmd and runs it with renpy.python.py_exec in the store
namespace. This harness builds a fake `renpy` package (store module, store_dicts with
ever_been_changed, config, exports.restart_interaction) and a fake `emscripten` module whose
run_script records what would be sent back to JavaScript, then executes the command in the store
module's namespace and prints JSON: {replies, restarts, new_store_names, store}.

usage: python3 -I tools/renpy_exec_harness.py <file with one command per line>
"""
import json
import sys
import types

store = types.ModuleType('store')
sys.modules['store'] = store
renpy = types.ModuleType('renpy')
renpy.store = store
renpy.version_only = '8.3.7'
renpy.config = types.SimpleNamespace(name='Harness Story')
restarts = []
renpy.exports = types.SimpleNamespace(restart_interaction=lambda: restarts.append(1))
renpy.python = types.ModuleType('renpy.python')


class StoreDict:
    def __init__(self):
        self.ever_been_changed = set()


sd = StoreDict()
renpy.python.store_dicts = {'store': sd}
sys.modules['renpy'] = renpy
sys.modules['renpy.python'] = renpy.python
replies = []
em = types.ModuleType('emscripten')
em.run_script = lambda s: replies.append(s)
sys.modules['emscripten'] = em

# the store: Ren'Py's own variables, and the game's (ever_been_changed)
exec(
    '''
class Player(object):
    def __init__(self):
        self.hp = 10
        self.max_hp = 12
        self.name = "Eileen"
        self._secret = 1
        self.items = ["a"]
mouse_visible = True
suppress_overlay = False
config_like = 3
money = 120
day = 2
met_lucy = True
player_name = "Eileen"
affection = {"eileen": 3, "lucy": 1}
inventory = ["key", "map"]
position = (1, 2)
player = Player()
huge = 12345678901234567890
ratio = 0.5
not_finite = float("inf")
long_text = "x" * 600
_private = 5
result = "the game's own variable called result"
def helper():
    return 1
''',
    store.__dict__,
)
sd.ever_been_changed.update(['money', 'day', 'met_lucy', 'player_name', 'affection', 'inventory', 'position', 'player', 'huge', 'ratio', 'not_finite', 'long_text', '_private', 'result', 'helper'])

before = set(store.__dict__.keys())
with open(sys.argv[1]) as f:
    for cmd in f.read().split('\n'):
        if cmd.strip():
            exec(cmd, store.__dict__)  # what renpy.python.py_exec(cmd, hide=True) does with the store
new_names = sorted(set(store.__dict__.keys()) - before)
print(json.dumps({
    'replies': replies,
    'restarts': len(restarts),
    'new_store_names': new_names,
    'store': {'money': store.money, 'met_lucy': store.met_lucy, 'hp': store.player.hp, 'affection': store.affection, 'inventory': list(store.inventory), 'result': store.result},
}))
