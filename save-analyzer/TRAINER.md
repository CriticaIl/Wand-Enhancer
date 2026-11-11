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
| **Ren'Py web** | Live through Ren'Py (recent builds) · Apply & Reload | Ren'Py web runs Python in WebAssembly, which SaveForge never reads or writes. Recent builds have a JavaScript→Python channel (`window.renpy_exec`, Ren'Py's `web/renpy-pre.js` and `exec_js_cmd` in `renpy/display/core.py`), which SaveForge uses to read and set store variables through Ren'Py itself (2.3.1, see below). | Save slots in IndexedDB (`/home/web_user/.renpy`, store `FILE_DATA`) are decoded with SaveForge's safe pickle reader, edited, rebuilt and written back, on request. Ren'Py web builds skip the save-token check. |
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

**2. Generic page globals are judged variable by variable** (`src/trainer/game-state.js` → `scoreLeaf`, `src/trainer/engines.js` → `genericGlobals`). Since 1.6 a global that *looks* like website data as a whole (e.g. `app = {config, assets, ui, data: {money…}}`) is no longer thrown away: every number, switch and text inside it gets its own score, with the objects around it as context. Known analytics, ads, consent, framework and portal-SDK globals are still skipped outright.

| Evidence for one variable | Effect |
| --- | --- |
| Number / on-off value | +0.25 / +0.15 |
| Game-like name (translated: `argent`, `所持金`, `clients`, `jour`…) | +0.35 |
| Inside a game-like object (`stock`, `inventory`…) | +0.15 |
| Changed while the trainer was open (sampled at open, then every 2 s) | +0.4 |
| Its value is shown on the page (numbers ≥ 10) | +0.25 |
| The whole object looks like game state / website data | +0.15 / −0.15 (no penalty when the variable or its parent has a game-like name) |
| Website-like name (`title`, `url`, `plays`, `rating`, `lang`…) | −0.45 |
| Inside website data (`config`, `settings`, `page`, `ads`…) | −0.25 |
| Setting (`volume`, `theme`, `autoplay`…) / identifier (`id`, `token`, `seed`…) / timestamp | −0.1 / −0.15 / −0.2 |
| URL or file name / long text | −0.35 / −0.3 |
| Entry of a large numeric table (> 20 numbers) | −0.3 |
| Edit verified in the game | at least 1 |
| You tapped *This is a game variable* / *Not a game variable* | at least 0.9 / −1 (remembered per website) |

Tiers: **≥ 0.5 game variable** (listed in its normal section), **≥ 0.3 potential** (listed under *Potential game variables*), otherwise excluded. Text next to detected game variables (item names, dialogue) is kept for search and translation; URLs and website fields are not. Each tier and its reasons are shown in ⓘ → *Detection* and in Diagnostics. Diagnostics also says whether the game state is *inaccessible* (isolated script context) or simply *not detected*, lists excluded variables with *Mark as game*, and can copy a report (names, types and reasons, never values).

**How far the scan reaches (1.8).** The generic scan walks the page's globals breadth-first:
- **Budgets:** every global gets its own budget (20,000 values), text gets a separate cap (4,000 per global), and the scan goes 10 levels deep.
- **Why this changed:** in 1.6 and 1.7 one shared budget of 40,000 meant a large dialogue or translation table could use up the scan before a deeper value like `game.state.player.wallet.money` was reached. That value then stayed invisible even to *Include website globals* and value search. That regression is fixed and covered by tests (`test/fixtures/dialogue-heavy/`).
- **Also reached:**
  - **Script-level `let` / `const` / `class` variables.** These are globals, but not window properties. Names come from the page's inline scripts and its same-site script files; each is confirmed with `typeof name` and read by name. No other code is run. A Content-Security-Policy without `unsafe-eval` blocks this, and Diagnostics says so.
  - **SugarCube `setup` objects,** next to `State.variables`, with separate budgets.
- **Rescan game** lists the page's globals again, so state created after a title screen is found. (Before, the list from the first look was reused.)
- **All variables (raw)** is a source with no game/website classification: every global, library and website data included, script variables, `SugarCube.State.variables` and `SugarCube.setup`. Search offers *Search all accessible variables* to repeat a query there.
- **Diagnostics → Full scan** walks everything reachable and compares it with what the trainer lists:
  - each value is reported as *listed*, *reached but excluded* (with the reasons and *Mark as game*) or *not reached by the classified scan* (with the reason: budget, depth, library global, text cap)
  - **Look up a value or name** answers "where is 28,480,799?"
  - the report names what cannot be reached: getters (listed, never called), Map/Set containers, depth limits, and closures, modules, WebAssembly, workers, other frames and servers

**3. Frames.** Portals run games in (often cross-origin, often nested) iframes.
- **Userscript:** runs in every frame. The frame with the game reports to its parent through namespaced `postMessage`; frames without a game stay silent unless the user opens SaveForge. "Open" is routed down to the game frame.
- **Bookmarklet/extension on a portal page:** Diagnostics lists game-sized frames with their origin and offers "Open trainer in this frame" (same site) or "Open game frame directly".

**4. Engines that can't be read live are named in Diagnostics:** Ren'Py web, Construct 3, Harlowe, GameMaker, Unity WebGL and Godot.

## How an edit reaches the game (and how SaveForge knows)

Before 1.4, values were read and written through object references cached when the trainer first scanned. Games often *replace* their state objects:

- SugarCube copies `State.variables` on every passage.
- RPG Maker replaces `$gameParty` and friends when a save loads.
- Many JS games rebuild their state object each tick.

After that, SaveForge wrote into a copy the game no longer used, and the row showed SaveForge's own number. The pipeline is now:

1. **Detect**: engine adapters, then scored generic globals (see above), or **Find a value** (a value scanner that narrows the number you see in the game down to the variable holding it).
2. **Resolve on every access**: each value is looked up again from the engine's live root at the moment of reading or writing. Engines that replace objects are therefore always written in their current state.
3. **Write through the engine** where it has a setter:

   | Engine | Setters used |
   | --- | --- |
   | RPG Maker | `gainGold`, `gainItem`, `$gameSwitches.setValue`, `$gameVariables.setValue`, `setHp`/`setMp`/`setTp`, `changeLevel` |
   | Phaser | `registry.set`, `scene.data.set` |
   | Construct 2 | writes the global-variable object itself |

   Everything else is a direct property write.
4. **Read back from the game's own object** immediately, then again at 0.4 s and 1.5 s:

   | Result | Status |
   | --- | --- |
   | Still there | **Applied and verified** |
   | Moved on from your value, e.g. a counter | Still **verified** |
   | Engine clamped it | **Adjusted** |
   | Back to the old value | **Reverted** |
   | Write rejected or object gone | **Failed** |

   Storage edits show **Requires reload** and are checked again after the reload. Read-only values say why.
5. **Lock** (optional): re-applies your value every 100 ms through the same path and counts how often the game changed it. It stops when unlocked or when the trainer closes.

**The script context matters.** Userscripts runs SaveForge in the page's own JavaScript world only with `@inject-into page`. An isolated extension world cannot see the game's variables. Diagnostics checks this on demand with a one-line page script and shows *page*, *isolated* or *unknown* (unknown means the page blocks inline scripts).

## English translation (offline)

`src/core/translate.js` translates variable names and short text values from 12 languages with a built-in game-vocabulary dictionary:

- Spanish, French, German, Portuguese, Italian, Dutch, Polish and Turkish
- Russian
- Japanese, Chinese and Korean, using dictionary-based word segmentation because these are written without spaces

It also expands common abbreviations (hp, atk, flg, cnt…).

Results are labelled as:

| Label | Meaning |
| --- | --- |
| *Translation* | Every foreign word was in the dictionary |
| *Partial translation* | Unknown words are shown in quotes |
| *Guessed meaning* | Abbreviations only |
| *Not translated* | The language was detected, but the words aren't in the dictionary |

The original key is always kept and used for editing. Translated names also feed categorisation and the ⓘ explanations, so `所持金` is understood as money.

"Translate online" is opt-in per text. It asks first and opens Google Translate with just that string.

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

## SugarCube (Twine): live State and saves

**Live: three ways to reach `State.variables`**, tried in this order.

| Way | When | How |
| --- | --- | --- |
| Direct | SaveForge runs in the page's own JavaScript world | `window.SugarCube.State.variables` (current moment), `State.temporary` (`_temp` variables) and `setup` |
| Page bridge | SaveForge runs in an isolated userscript or extension world, where `window.SugarCube` does not exist | A small agent is added to the page world with a `<script>` element. It answers synchronous requests over DOM events and attributes: read one path, write one path, dump variables, re-render. Edits are read back and verified like any live edit. |
| Frame | The story runs in a same-site child frame | Diagnostics → Frames → *Open trainer in this frame* |

A story that publishes `window.SugarCube` after the trainer opened is connected as soon as it is ready. SaveForge checks every second for 90 seconds and selects the new source.

**Diagnostics → SugarCube** tells you which case you are in, step by step:
- story markers in the DOM: `<tw-storydata format="SugarCube">`, `#ui-bar`, `#passages`
- whether `window.SugarCube.State.variables` is visible from SaveForge's context
- whether it exists in the page's own world
- **Look up** an exact path: `player.money`, `$player.money`, `State.variables.player.money` or `_temp`

When it cannot connect, it says why:
- *not started yet*
- *in a child frame* or *in another site's frame*
- *the page blocks the bridge* (Content-Security-Policy)
- *this build does not expose `window.SugarCube`* (State is private to the story's code, so no page or extension can read it live)

**Saves: the current moment, not `delta[0]`.** A SugarCube save stores the story history, either as `state.history[]` or delta-encoded as `state.delta[]`, plus `state.index`:
- `delta[0]` is the *first* moment in full.
- Every later entry is a diff (`[2, value]` copy, `0` delete, `{"~": [1, start, end]}` splice).

`src/adapters/sugarcube-moments.js` rebuilds moment `state.index` exactly like SugarCube's `patch()`. It is checked against SugarCube's own decoding on 300 random histories.

- **The editor and trainer** show the current value as `$player.money`. Its field may live in `delta[0]` or in a later diff. Values of other moments are marked *not current* (visible under engine internals), and diff operation codes are locked.
- **Live + Save links** for SugarCube use the current moment of the autosave (or the newest save).
- **Storage format:** saves stored with LZString `compressToUTF16`, as SugarCube does in localStorage, are decoded. The trailing space of that format used to be trimmed away.

**Editing SugarCube saves so they stick (2.1).** SugarCube keeps the running playthrough in **sessionStorage** (`<prefix>.state`, written on every passage), and a page reload *resumes* it. Saves (autosave, slots) in localStorage are used only when the player **loads** one, and the autosave is rewritten from the running playthrough on later passages. Editing the autosave and reloading the page therefore reverts:
1. The reload resumes the old session.
2. The next autosave writes the old values back.

*Edit SugarCube save* (main menu, Diagnostics, or ⓘ on a `$variable` from the saves) does it the way the game loads saves:
1. **Edit:** pick the save to start from and the new values. Each value is shown next to the save's value and the running game's (session) value.
2. **Where:**
   - **a copy in an empty slot** (default)
   - overwrite a manual slot
   - the autosave (warned against)
   - the session state, which applies when the page is reloaded
3. **Back up & write:**
   - The original storage values (and the session state) are stored as a snapshot first, and the rebuilt save is decoded again and compared before writing.
   - Only the current moment is changed, and the history is re-encoded like SugarCube's own delta encoding. Variables that do not exist are never created.
   - Writing is refused if the game saved after the screen was opened.
4. **Warnings:** when the running game differs from the chosen save, or the target is the autosave, SaveForge explains what the game will do and asks for confirmation.
5. **Load:**
   - With a public `window.SugarCube.Save` API, SaveForge can load it for you (*Load Slot N in the game now*).
   - Otherwise it guides you through the game's own Saves menu, and says plainly that reloading the page does not load a save.
6. **Verify:** after the game loads the save, it writes the loaded state to its session state. SaveForge reads that and shows *✓ Verified* (also after a reload, for the session option). *Undo this write* puts the storage back exactly.

*Apply & Reload* of SugarCube save fields now warns about this first and offers the workflow.

**Diagnostics wording:** SaveForge only reports what it checked. *"window.SugarCube is not defined in this page, neither in SaveForge's context nor in the page's own context"* means the public API is absent. SaveForge does not claim that nothing can read the state. It also lists the session state and the saves it found.

**Import from Save Editor.** The editor (criticail.github.io) and the trainer (the game's site) cannot see each other's data.
1. In the editor: Export → **Copy share code** (`SAVEFORGE-SHARE-1:…`).
2. In the trainer: **Import from Save Editor** → paste → a preview shows the format, the variable count and the current moment → confirm.
3. The values appear as **SAVE · IMPORTED** (never live). Edits can be downloaded (verified) or copied back as a share code.
4. They can be added to the game's own save **only if it is verifiably the same save**: the same SugarCube story id and save date, or identical data. Then *Write saves* writes them, with a backup.

## Save variables in the trainer (shared with the Save Editor)

**How the Save Editor finds variables:** a save (an imported file, or a Storage Bridge dump of the game's localStorage and IndexedDB) goes through `analyzeFile()` (`src/core/document.js`):
- format detection and the decode chain (`src/core/pipeline.js`: JSON, Base64, LZString, zlib, pickle, INI, ZIP…)
- the variable tree, engine profiles (`src/adapters/profiles.js`), and friendly names and categories (`generateModMenu`)
- edits through an `EditSession`, with undo, a verified rebuild and validation

**The trainer runs that same pipeline on the game page** (`src/trainer/save-hub.js`). One shared save model per trainer is used by every view. The *Saves in storage* source and the save variables listed next to live ones are the same objects, with the same pending edits, undo, validation and backups.

| Label | Meaning | Editing |
| --- | --- | --- |
| **LIVE** | Running-game variable | Applied immediately, read back and verified |
| **SAVE** | Field in the game's save, not linked to a live variable | Pending → **Write saves** (kept for the next load, no reload), **Apply & Reload** (the game reloads and reads it), or **Export edited saves** (a SaveForge storage export for the Save Editor or the Storage Bridge) |
| **LIVE+SAVE** | A live variable and its save field, linked by a verified mapping (listed once) | Applied live immediately. **Also write to save** puts the value into the save as well (pending until written) |

**Linking never guesses from names or equal values.** A save field is merged into a live entry only when:
- **The engine documents the layout:**
  - RPG Maker MV/MZ: a save is `DataManager.makeSaveContents()`, the object the live source walks, so `party/_gold` ↔ `<slot>/party/_gold`. The slot is the newest one from `RPG Global`, or the longest play time.
  - SugarCube 2: `state.history[index].variables` ↔ the live active moment.
- **Or SaveForge observed it:** the save changed `old → new` right after exactly one live value changed `old → new`.
  - Twice, or once if the new value is distinctive (≥ 10 and unique on both sides).
  - Several live values changing the same way stay unlinked; ⓘ lists them as *possibly the same*.
  - A link the save stops following is dropped.
  - Observed links are remembered per site. ⓘ shows how each link was made and can remove an observed one.

**Sync:**
- **Sync save variables** re-reads the saves.
- While the trainer is open, the saves are re-read automatically when localStorage changes (checked every 2.5 s, IndexedDB every 10 s). This can be turned off in Settings.
- **Pending save edits are never overwritten.** If the game saves newer progress meanwhile, the trainer says so, writing is refused (the existing conflict check), and *Re-read storage* discards the pending edits and reads the new save.

**Backups:** a snapshot of the saves is stored before every write, whether Write saves or Apply & Reload. *Backups & restore* puts it back.

## Button & Textbox Linker

Main menu → **Button & Textbox Linker** (advanced, optional; `src/trainer/linker.js`, `src/trainer/linker-ui.js`).

**Inspect element.** The panel steps aside and a bar at the bottom says *Tap a button, link, textbox, dropdown or checkbox*. That tap and the events after it are swallowed at the window (capture phase) before the game sees them:
- no purchase, no navigation
- no focus, so no keyboard on iPhone

Game code is never called during inspection: handlers are read with `Function.prototype.toString`.

**What it can find, and how sure it is**

| Source | Label |
| --- | --- |
| Inline `on…` attributes (`onclick="acheter()"`), `on…` properties (`el.onclick = vendre`), jQuery's registry, `addEventListener` calls made after the Linker started recording | **Confirmed** |
| SugarCube `data-passage` links (goes to passage X) | **Confirmed** |
| Functions called by those handlers, and variables their code assigns (`joueur.argent -= 30`), matched to trainer variables by path | **Likely** (read from code, not run) |
| SugarCube `textbox-<var>` ids, `this.value` assignments in input handlers | **Likely** binding |
| Listeners on parents (`document`, `body`) that handle clicks for everything inside them | **Likely** when their code mentions the element's id/class/data attribute, otherwise **possible** |
| Variables holding the same text as a field, or named like it | **Possible** binding |
| *Watch one tap* / *Detect by typing*: you use the element once, SaveForge compares every scanned variable before and after | **Confirmed by observation** (this one really runs the element) |

**What no web page can see:** listeners the game added with `addEventListener` before SaveForge started recording. Only browser developer tools can list those. The inspection says so, and points to *Watch one tap*, instead of guessing.

**Linking.** *Link to another action…* lists only actions SaveForge can actually perform:
- **Buttons, links, dialogue choices:**
  - *Same as tapping “…”*: SaveForge taps that other element for you.
  - *Call fn()*: zero-argument functions the page defines.
  - *Go to passage* (SugarCube).
  - *Do nothing*.
- **Textboxes, dropdowns, sliders, checkboxes:** *Write to <variable>*, of a compatible type. Either keep the game's own handling (the default) or replace it. A field can also be set to *ignore input*.

A **preview** shows *Now* (the confirmed handlers) next to *After*, with warnings. Buttons that look like they buy, reset or delete need an extra *I understand* tick before **Apply mapping**.

Remappings are enforced by capture listeners on the window, matched by CSS selector at event time, so they survive the game re-rendering its screen:
- **Remapped button:** the original click handlers (inline, property, delegated) don't run; the new action runs instead.
- **Field linked to a variable:** writes go through the trainer's live provider.

Nothing is intercepted while there are no active mappings, when *Mappings enabled* is off, or after the trainer is closed.

**Undo / restore:** *Undo last change*, *Restore original* for each mapping, *Restore all originals*, *Pause* for each mapping, and the *Mappings enabled* switch (off = disable all).

**Saved per game:** tick *Save this mapping for this game*. It is stored in SaveForge's own IndexedDB store for that site, keyed by page path. Saved mappings stay **off** next time unless *Apply saved mappings automatically when SaveForge opens on this game* is on. They apply only while the trainer is open; the userscript never applies them by itself on page load.

**Supported**

| Game / element | Inspect | Remap |
| --- | --- | --- |
| Plain HTML games (`button`, `a`, `input`, `textarea`, `select`, checkbox/radio, range, `role=button`, elements with `onclick`) | Yes | Yes |
| jQuery-based games | Yes (handlers via `jQuery._data`) | Yes |
| SugarCube / Twine (DOM links and form macros) | Yes (`data-passage`, `textbox-…` ids) | Yes (other choice, passage, variable) |
| Games that delegate clicks from `document` | Partly (possible links, *Watch one tap*) | Yes |
| Canvas games (Phaser, RPG Maker, Construct, Unity, Godot, GameMaker) | No: buttons are pixels, not elements; the canvas is reported as such | No |
| Elements inside cross-origin frames | Only when SaveForge runs in that frame (the userscript does) | Same |

A game that registers its own *window capture* listeners before SaveForge can still see a remapped tap first. *Watch one tap* shows what really happens.

## Input Inspector (2.3.3)

A manual, optional section of the trainer that reads which text a game checks a textbox for. Plan, research per engine, safety rules and tests: [INPUT-INSPECTOR.md](INPUT-INSPECTOR.md). The analysis is in `src/trainer/input-inspector.js`. Ren'Py's `input` operation is in `src/trainer/renpy-live.js`.

## Games sharing one game host (2.3.2)

**The report:** on mopoga.com, after switching games, `$player.money` appeared as SAVE (value 0) next to the new game's LIVE values. Reproduced in `test/same-host.test.mjs` with a portal page that frames games from one shared game host: a SugarCube story (`test/fixtures/sugarcube-real`), then a fighting game (`test/fixtures/brawler`).

The LIVE values were the running game's. The SAVE values were the story's save, from the storage the two games share. Two causes:
1. **The SugarCube rule.** `currentStory()` returned the only story id found in storage on **any** page, so the story's keys counted as the running game's.
2. **The merge.** `mergeSaves()` listed every save entry not known to be another game's next to the live values.

**Ownership of a save entry** (`save-owner.js`, `classify`), checked in this order:
1. **SugarCube keys:**
   - this game's when the running story's id is read from the page or matches its title
   - another game's when the page is not a SugarCube story, or the key names another story
   - probable when the page is a story but its id cannot be read
2. **SaveForge's record for this website:**
   - written by this game while watched, or marked by you → this game's
   - written by another game → another game's
3. **Name:** words of this game's address or title in the key, or in IndexedDB record keys → this game's.
4. **Engine mismatch:** a save whose engine is certain from its name (SugarCube, RPG Maker `RPG File1`, Ren'Py's IndexedDB database) on a page not running that engine → another game's.
5. **Probable:** SaveForge has seen only this game on the website, and the save is of this page's engine.
6. **Otherwise not confirmed.**

What each state allows:
- **Merged into live sources and linked:** only this game's and probable saves.
- **Saves in storage:** not-confirmed saves are listed there, marked NOT CONFIRMED. `applyAndReload` refuses them (`OwnershipError`) until you confirm them, which records them as this game's.
- **Another game's saves** are filtered out of the dump, so they are never written.

**Provenance:** `belongsTo(id)` on every provider gives the game, frame and address for live values (and the linked save's owner), or the save entry and its ownership. It is shown under ⓘ → *Belongs to*, and in Diagnostics → *Where the variables come from*.

**Same address, another game:** the context watcher also compares the page content every 2 s. It reports a switch when:
- the Twine story changed, or
- the page's own scripts were replaced **and** one of the old game's objects disappeared or the title changed (bundlers remove chunk scripts after loading, which alone is not a switch), or
- several of the old game's objects were removed.

On a switch, the document is marked with a content id, which becomes part of the game key. Objects of the old game that are still on the page and unchanged are excluded from the new game's scan.

## Ren'Py web: opening safely, and live variables (2.3.1)

**The crash.** Activating SaveForge on a Ren'Py web game made Safari reload the page; the game ran fine without SaveForge. Ren'Py's `renpy.js` is a classic script, so its top-level variables are page globals. They include `HEAP8`…`HEAPF64`, typed-array views of the whole WebAssembly memory (192 MB at start, `INITIAL_MEMORY=201326592` in a published build). The generic detector called `sampleNumbers()` on every page global, and `sampleNumbers` checked for typed arrays only on nested values, so it ran `Object.keys(HEAPU8)`: one string per byte. Three more paths were unguarded:
- **The learning sampler** (`sampleIds`, every 2–4 s): `Object.keys` on the same globals, and on `FS` file contents such as the game archive.
- **Find a value:** it read typed arrays deliberately.
- **The live tree:** it used `Object.keys` on big arrays.

**Measured** with `tools/measure-activation.mjs`, in Chromium with V8's heap capped at 1.5 GB, on `test/fixtures/renpy-web`. That fixture mirrors a published Ren'Py 8 web build's JavaScript surface (globals, virtual filesystem, IDBFS saves, the `_renpy_cmd` channel). These are Chromium numbers, not iPhone Safari.

| | 2.3.0 | 2.3.1 |
| --- | --- | --- |
| Activation, 192 MB WebAssembly memory | **renderer crashed** in every run (peak ≈ 2.64 GB, +2.5 GB) | usable after **0.63 s**, +20 MB (113 → 133 MB), no long tasks |
| 64 MB | crashed (peak 2.75 GB) | — |
| 16 MB | survived: 1.17 GB peak, a **6.4 s** freeze (14.6 s blocked), one useless "variable" (`GL.counter`) | — |
| + 5,000 game variables | — | 0.73 s, +39 MB, 3,000 values listed (capped) |
| Ren'Py not answering (loading) | — | panel at once, message after the 8 s wait |
| Older Ren'Py without `renpy_exec` | — | explanation screen in 0.63 s |
| Ordinary game (20,000-variable stress page) | 1.38 s, +122 MB, 13,884 variables | 1.48 s, +126 MB, 13,884 variables |

The real build was found, read and statically analysed (its `renpy.js`, `renpy-pre.js`, `index.html`). Running it in this test environment was not permitted, so the measurements use the fixture.

**Fixes** (`src/trainer/safe-walk.js`, used by every walker):
- **Binary data is never enumerated:** typed arrays, ArrayBuffer, DataView and WebAssembly objects.
- **Arrays are enumerated by index, capped**, never with `Object.keys` on the whole array.
- **An Emscripten page's runtime globals are never scanned:** `Module`, `FS`, `HEAP*`, `wasmMemory`, `GL`, `Asyncify`… Diagnostics lists them as excluded. Find a value skips WebAssembly memory; small typed arrays a game keeps itself are still searched.

**Light mode for Ren'Py web.** Ren'Py is recognised by `renpy_exec`, its `renpy.js`/`renpy-pre.js` scripts, `Module` loading `renpy.data`, or its page layout. On a Ren'Py page the trainer:
- **does not run at opening:** no page-global scan, no SugarCube probe, no storage read, no save auto-sync
- **keeps nothing after closing**
- **reads saves only on request:** *Saves in storage* (IndexedDB) still works and verifies its writes
- **shows its first screen at once**, then lists the variables

**Live variables through Ren'Py** (`src/trainer/renpy-live.js`):
- **The channel.** Ren'Py runs Python that JavaScript writes into `window._renpy_cmd`, on its PERIODIC event while an interaction runs. SaveForge sends one expression, `exec(<script>, {'__builtins__': __builtins__})`, which creates **no store variables**. Ren'Py's own `renpy_exec` wrapper leaves its JSON result in the store variable `result`, which would end up in saves and overwrite a game variable of that name.
- **What is listed.** The game's variables are `renpy.python.store_dicts['store'].ever_been_changed`: `default` variables and everything assigned while playing, which is what Ren'Py saves. Only simple values are listed: bool, int, float, and str up to 500 characters, including those inside lists, dicts and the game's own objects (one level). Ren'Py's own store variables appear on request. Integers beyond JavaScript's range, non-finite floats and tuples are shown read-only.
- **Editing.** The new value must match the type the game has. It is set in the store, then `renpy.restart_interaction()` redraws the screens, and Ren'Py reads the value back. It is verified when Ren'Py still has it 1.5 s later. Locks are off for Ren'Py.
- **Refresh.** Values are refreshed in rotating batches of 300 (paused while minimized). The list is read again every 30 s.
- **When Ren'Py does not answer** (a loading screen, a paused tab), the command is taken back after 6–8 s so it never runs later, and the panel says why.
- **Tests.** The Python is tested with CPython, run the way `py_exec` runs it (`tools/renpy_exec_harness.py`, `test/renpy-live.test.mjs`). Python 2 (Ren'Py 7 web) was not tested.

## Game targeting and one trainer (2.3)

**The game context.** A trainer belongs to exactly one game, identified in `src/trainer/context.js`:
- **Game key:** the origin, path, meaningful query parameters and a `#/route`. Tracking and cache-busting parameters are ignored.
- **Document token:** stored on `<html>`, so every JavaScript world of a document agrees on it.
- **Context ID:** `hash(game key)-document token`.

What SaveForge stores is keyed by the game key:
- favorites, recent, marks, learned save links, Linker mappings, SugarCube verification, backups
- per website (interface preferences only): panel position, performance profile, label language

**When the page changes game.** `watchContext` compares the game key once a second while the page is visible, and right after `popstate`/`hashchange`/`pageshow`. When it differs:
- the running scan is aborted
- the trainer closes without keeping its scan, and opens again for the new game 0.7 s later
- every provider carries a guard, so writes are refused once the address no longer matches the scanned game: live writes, locks, storage writes, and the SugarCube save workflow
- a scan that finishes after its trainer closed is disposed and never shown

**Whose save is it** (`src/trainer/save-owner.js`). Every localStorage key and IndexedDB database gets an owner game, remembered per website:
1. **engine knowledge:** SugarCube's `(Saved Games)<story id>.…` keys belong to the running story
2. **written while watched:** an entry the game wrote while SaveForge was open is that game's
3. **by name:** a name containing words of exactly one known game's address or title belongs to that game

Entries of other games are filtered out of the Storage Bridge dump before analysis. They are never shown, linked or written: `apply` writes only the keys in the dump. Entries of unknown owner stay available. Once SaveForge has seen several games on the website, writing them asks first.

**One launcher, one panel, the right frame** (`src/userscript/entry.js`). Every frame's instance reports to its parent, relayed up to the top page. Reports carry the frame's slot (index path) and document token, so a frame navigated to another game replaces its old report.

The top page's instance coordinates:
- **Launcher:** it elects the one frame that shows it. A game frame covering ≥ 20% of the screen wins over a portal page that merely has a canvas.
- **State broadcast:** it tells every frame where the launcher is and where a panel is open. A frame never shows a launcher next to an open panel.
- **Opening:** before opening, it pings all frames and decides from **fresh** replies only:
  1. an open panel is shown, never a second one
  2. otherwise the requesting game frame opens
  3. otherwise the one game opens, or a chooser lists several
  4. otherwise a same-site frame without the script, or the page itself

Within one document, copies in different worlds still coordinate through the DOM (2.2.1).

**Tests:** `test/targeting.test.mjs` reproduced the reported problems on 2.2.2 before they were fixed. It uses twin games with the same engine and variable names on one host, a single-page twin, and a portal with swapped, re-navigated, double and canvas-plus-frame layouts.

Results on the unfixed 2.2.2 build:
- **Reproduced:** favorites carried over, the old scan reused, writes to the old game accepted, nothing opened after a frame swap or re-navigation, two launchers, 4 timers left after closing mid-scan.
- **Already passed:** two copies in different worlds plus reinjection.
- **New features:** the chooser, Diagnostics and Reset have no 2.2.2 equivalent.

## Performance and stability (2.2)

**How it was measured:** `node tools/profile-trainer.mjs "<fixture query>" 4` runs the stress fixture (`test/fixtures/stress/`) in Chromium with 4× CPU throttling (roughly a phone) and a game loop that changes state every frame. It measures:
- the game's own frame gaps while SaveForge opens, while it stays open, and while it is minimized
- long tasks
- the JavaScript heap
- a CPU profile per function

These are Chromium measurements: iPhone Safari was not measured, and passing them does not prove a crash on a phone is fixed.

**What the profile showed (before 2.2), at 4× throttling:**

| Case | Before | After 2.2 |
| --- | --- | --- |
| 60 MB of game files in IndexedDB (Unity/Godot keep files there): opening | game frozen **44 s**, heap 2 → **337 MB** | longest freeze 0.5 s, heap +9 MB |
| same, trainer open | frozen **52 s** every ~10 s (re-read) | no long tasks |
| 20,000 variables + 5,000 dialogue lines: opening | longest freeze 1.5–2.2 s (4.4 s blocked in total) | ≈ 0.5 s (1.4 s in total, in slices) |
| same, trainer open | freezes up to 0.85–1.1 s (full re-scans) | ≤ 0.4 s, rate-limited |
| same, minimized | background scanning continued | nothing runs |
| 100,000 variables, 10 levels deep, 20,000 dialogue lines (Low Memory) | — | longest freeze ≈ 0.5 s; player values read first |
| first search, 7,800 entries | 0.77–0.9 s | ≈ 0.4 s (index built in the background) |

**Causes and fixes:**
1. **Eager save reading.** Since 1.9 the shared save hub read all of IndexedDB when the trainer opened and every 10 s. It Base64-encoded every binary file and tried LZString on each. Now:
   - Opening reads localStorage only and lists IndexedDB databases by name.
   - IndexedDB is read when you open *Saves in storage*, tap *Read IndexedDB saves*, run a Deep scan, or enable it in Settings.
   - Binary values over a size limit (512 KB in Low Memory Mode, 4 MB otherwise) are not read. They are marked, counted in Diagnostics, and **never written back**: the Storage Bridge leaves such records untouched.
   - Auto-sync compares only a localStorage signature.
2. **One long synchronous scan.** The tree walk, scoring and variable-list building now run in time slices (6–12 ms each, yielding to the game between them). *Stop scanning* keeps what was read so far.
3. **Full re-scans on learning.** A new changing value used to trigger a complete re-scan immediately. Background re-scans now happen at most every 20 s (Low Memory) or 10 s, are time-sliced, and are paused while the trainer is minimized or the page is hidden. Your own actions (marking a value, a verified edit) are not rate-limited.
4. **Repeated work:** label and category computation is cached per key, and candidate globals are cached until they are re-classified. Save-hub observation reads a rotating window of 500 values per tick, and SugarCube save detection caches by a storage signature (verification always reads exactly).
5. **Smart Scan priority:** globals with game-state evidence are read first, then their large lists (more than 256 items), then other globals, then their large lists. A dialogue table can no longer use up the budget before the player's values. Nothing is dropped by this ordering.

**Low Memory Mode** is on by default on phones (touch + small screen, or `deviceMemory` ≤ 4).

| | Smart Scan (Low Memory) | Standard | Deep scan (on request) |
| --- | --- | --- | --- |
| Values read first | 30,000 | 90,000 | 300,000 |
| Per global / text per global | 20,000 / 1,000 | 20,000 / 4,000 | 120,000 / 60,000 |
| Depth | 8 | 10 | 14 |
| Learning / background re-scan | every 4 s / at most every 20 s | 2 s / 10 s | — |
| Script files read for let/const | no | yes | yes |
| IndexedDB read automatically | no | no | yes |

What was not read is always shown, never hidden:
- **Home:** *“Smart Scan: N values · more available”* lists what was not read (texts over the limit, globals cut by size, objects deeper than the limit) and starts a **Deep scan**, which can be stopped.
- **Diagnostics → Performance** shows:
  - the profile and the last completed stage, plus what is running now
  - per-stage times, values read and variables listed
  - the JavaScript heap (Chromium only: Safari does not report memory)
  - background status, save reads, IndexedDB databases not read, large values skipped
  - Button Linker page listeners

**Settings → Performance:** Low Memory Mode (automatic/on/off), scan depth, variable limit, background scanning (automatic/slow/off), read IndexedDB automatically, and keep scan results when closed.

**Reopening and Safe Mode:**
- **Reopening:** closing SaveForge keeps the last scan, with background work paused and locks released, for 3 minutes (Low Memory) or 10 minutes. Reopening shows it immediately (*Results from N min ago · Rescan*).
- **Interrupted starts:** every start writes its current stage to sessionStorage, which survives a tab reload. If a start never finished (the tab crashed or reloaded while scanning), the next launch says at which stage it stopped and offers **Safe Mode**: no automatic scan, no save reading, no background work, and no Linker at start, with everything available on request.

**Button Linker:** its page interception listeners are installed once while a mapping is active and removed when none is. A test checks that repeated inspect/apply/restore cycles never stack listeners.

## Performance and safety

- **Fast menus at scale:** menu generation is O(n) because the per-node engine detectors are memoized. Generating the menu for 10,200 live variables takes about 0.1 s, and opening the trainer on such a page takes about 0.3 s in headless Chromium.
- **Virtualized list:** rows are a fixed height and only the visible rows (plus overscan) exist in the DOM, about 13 for 10,000 items. Search is debounced and runs over precomputed lowercase strings.
- **Light live polling:** visible values are polled once a second. A row is redrawn only when its value changed, and never while a finger is on the list.
- **Read-only snapshotting:** when snapshotting live objects, getters are never invoked and functions are never called. DOM nodes, typed arrays and Maps are skipped, and cycles become references.
- **Saves are never executed:** saves are decoded with SaveForge's non-executing parsers. Nothing bypasses browser security.
