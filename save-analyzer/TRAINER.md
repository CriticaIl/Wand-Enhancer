# SaveForge trainer: how it works and what is possible in Safari

This document describes the floating trainer overlay and the research behind it. It covers which approaches work for showing a trainer over offline browser games in iPhone Safari, and which ones don't.

## How the overlay gets onto a game page

| Approach | Works in iPhone Safari? | Used by SaveForge |
| --- | --- | --- |
| **Bookmarklet** (`javascript:` bookmark run on the game page) | Yes. It runs with the page's own permissions, so it can read the game's globals and storage. | **Yes, the main route.** There are two variants: a small *loader* that pulls `trainer.js` from the SaveForge site, and an *offline* bookmarklet that contains the whole trainer (~150 KB). |
| **Same-origin frame** (game hosted on the same site as SaveForge) | Yes. The parent page may script a same-origin `<iframe>`. | **Yes.** Game tab → "Open trainer over game". |
| Cross-origin frame (any other site) | No. Safari's same-origin policy blocks script and storage access, as it should. | Not attempted. SaveForge tells you to use the bookmarklet. |
| Safari Web Extension / userscripts | Possible on iOS 15+, but it requires installing a native App Store app. It cannot be shipped as a web page. | Not used. A bookmarklet needs no install. |
| Proxying or re-hosting the game | This would change the game's origin, which separates it from its saves, and it would mean redistributing other people's games. | Not used. |
| Reading another tab or the browser's storage files | Impossible from web content. | Not used. |

The overlay is a custom element with a **Shadow DOM**, so the game's CSS can't restyle it and the overlay's CSS can't touch the game. Taps and key presses inside the panel stop propagating, so the game doesn't react to menu interaction. Everywhere outside the panel the game keeps receiving input normally. The panel can be minimised to a floating icon, collapsed to its header, or dragged anywhere.

## Engine integrations

Each integration uses only objects the engine publishes on `window`. When an engine keeps its state somewhere page scripts can't reach, SaveForge says so instead of pretending.

| Engine | Live? | Mechanism | Notes |
| --- | --- | --- | --- |
| **RPG Maker MV / MZ** | **Live** | `DataManager.makeSaveContents()` returns the live `$gameSystem`, `$gameSwitches`, `$gameVariables`, `$gameSelfSwitches`, `$gameActors` and `$gameParty` objects, which have the same layout as a save file. | Names come from `$dataSystem.switches/variables` and `$dataItems/$dataWeapons/$dataArmors`. After a write, the actor's `refresh()` (which clamps HP/MP) and `$gameMap.requestRefresh()` (which re-evaluates event pages) are called. |
| **SugarCube 2** | **Live** | `SugarCube.State.variables` (the active moment). | The "Refresh passage" action calls `SugarCube.Engine.show()` to re-render text that is already on screen. The values persist into later moments when the player navigates. |
| **Construct 2** | **Live** | `cr_getC2Runtime().all_global_vars[].data` | Changes are picked up on the next tick. |
| **Phaser 3** | **Live** | The global game instance's `registry.list`, plus each scene's custom properties and `data.list`. | Game objects and Phaser internals are skipped. |
| **Generic HTML5** | **Live\*** | Global variables are found by comparing `window` with a fresh frame's `window`, scored as game state or website data, then walked with caps on depth and node count. | This works for games that keep state in globals. If a game keeps state in closures or modules, nothing is found. The game may recompute or overwrite edited values, so these edits are marked *Live (unverified)*. |
| **Ren'Py web** | Apply & Reload | Ren'Py web runs Python in WebAssembly. Its only bridge is Python→JS (`emscripten.run_script`, see `renpy/webloader.py`), and there is no JS→Python API. | Save slots in IndexedDB (`/home/web_user/.renpy`, store `FILE_DATA`) are decoded with SaveForge's safe pickle reader, edited, rebuilt and written back. Ren'Py web builds skip the save-token check. |
| **Construct 3** | Apply & Reload | By default the runtime runs in a Web Worker, which the page can't reach. | Saves in localforage/IndexedDB can be edited. |
| **Twine Harlowe** | Apply & Reload | Story state is private to the engine. | Saves in localStorage can be edited. |
| **GameMaker HTML5** | Apply & Reload | Runtime variables are obfuscated and can't be identified reliably. | INI/JSON saves in storage can be edited. |
| Server-side, encrypted or WebAssembly-only state | No | There is nothing the page can safely read or change. | — |

The original demo games in `demo-games/` imitate the public API shape of RPG Maker, SugarCube and Construct 2, plus Ren'Py web's storage layout. They exist so these integrations can be tested in a real browser without redistributing those engines. Running against the real engines depends on their globals matching the documented API. The integration code checks for each object before using it.

## Finding the real game state

Many pages expose website globals that have nothing to do with the game.

**1. Engine adapters first.** These read documented engine objects:

| Engine | Objects read |
| --- | --- |
| RPG Maker | save contents |
| SugarCube | `State.variables` |
| Construct 2 | global variables |
| Phaser 3 | `game.registry`, custom scene properties and `scene.data` (game objects and Phaser internals are skipped) |

**2. Generic page globals are scored, not trusted** (`src/trainer/game-state.js`). Only game state is listed; everything else stays visible in Diagnostics with the reason.

| Signal | Effect |
| --- | --- |
| Known analytics, ads, consent, framework and portal-SDK globals | Excluded outright |
| Numbers | Raise the score |
| Game-like key names | Raise the score |
| Values that change during a ~0.7 s sample while the game runs | Raise the score |
| Game-like class names | Raise the score |
| Website-like keys (`title`, `slug`, `url`, `plays`, `rating`, `thumb`…) | Lower the score |
| URL strings | Lower the score |
| Text-heavy objects | Lower the score |

**3. Frames.** Portals run games in (often cross-origin, often nested) iframes.
- **Userscript:** runs in every frame. The frame with the game reports to its parent through namespaced `postMessage`; frames without a game stay silent unless the user opens SaveForge. "Open" is routed down to the game frame.
- **Bookmarklet/extension on a portal page:** Diagnostics lists game-sized frames with their origin and offers "Open trainer in this frame" (same site) or "Open game frame directly".

**4. Engines that can't be read live are named in Diagnostics:** Ren'Py web, Construct 3, Harlowe, GameMaker, Unity WebGL and Godot.

## The three kinds of edit

| Badge | Meaning | Undo | Persistence |
| --- | --- | --- | --- |
| **LIVE** | Written into the running engine immediately. | Undo/redo, plus "Restore original values". The original value of every touched variable is kept in a separate `saveforge-trainer` IndexedDB database. | Kept only after you **save in-game**. |
| **LIVE\*** | Written into page globals found generically. | Same as above. | Same. The game may overwrite it. |
| **APPLY & RELOAD** | Kept as a pending edit. When applied, SaveForge first checks that the game hasn't written to its storage since the trainer read it (otherwise it refuses, so newer progress is never overwritten). It then rebuilds and re-verifies the data, stores a snapshot backup, writes the data and reloads the page. | Undo/redo before applying; "Restore & reload" from any snapshot afterwards. | Permanent once written. |
| **SAVED EDIT** | Inside the SaveForge app, the edit goes into the exported save file. | Undo/redo/revert/reset. | When you load the exported file. |

## Explanation engine (ⓘ)

`src/core/explain.js` generates every information panel. There are no per-variable texts. Instead the engine combines several inputs:

- **Pattern library**: about 20 patterns, including currency, current/max vitals, level, experience, stats, inventory counts, relationships, story progress, story flags, unlocks, achievements, time, timestamps, position, counters, identifiers, version/seed, checksums, settings and names. Each pattern is scored against the variable's own name, its parents' names, its type and its value (for example, epoch-sized numbers are treated as timestamps).
- **Structural facts**: related siblings such as `hp` next to `maxHp`, or `level` next to `exp`; the owning character's name; how many other variables share the same name.
- **Engine knowledge**: documented RPG Maker fields are reported as facts with high confidence. Ren'Py and SugarCube variables are marked as *defined by the game's script*, so their meaning stays inferred, and confidence is capped.
- **Edit channel**: whether the change applies immediately, needs a reload, or goes into an exported file.

Every panel shows:

- what the variable likely controls
- what changing it might do
- the current and original values with their types
- when the change applies
- side effects and the risk to save progression
- a confidence level with the reasons behind it

If nothing matches, the panel says the purpose isn't recognised and confidence is *Unknown*.

## Performance and safety

- **Fast menus at scale:** menu generation is O(n) because the per-node engine detectors are memoized. Generating the menu for 10,200 live variables takes about 0.1 s, and opening the trainer on such a page takes about 0.3 s in headless Chromium.
- **Virtualized list:** rows are a fixed height and only the visible rows (plus overscan) exist in the DOM, about 13 for 10,000 items. Search is debounced and runs over precomputed lowercase strings.
- **Light live polling:** visible values are polled once a second. A row is redrawn only when its value changed, and never while a finger is on the list.
- **Read-only snapshotting:** when snapshotting live objects, getters are never invoked and functions are never called. DOM nodes, typed arrays and Maps are skipped, and cycles become references.
- **Saves are never executed:** saves are decoded with SaveForge's non-executing parsers. Nothing bypasses browser security.
