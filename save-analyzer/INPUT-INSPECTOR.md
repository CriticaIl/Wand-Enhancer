# Input Inspector (SaveForge 2.3.3): plan

The Input Inspector answers one question about a textbox in a game ("enter the password", "what is the
riddle's answer?", "name your character"): **which text does the game itself check for?** It shows
the answers found in the game's own, accessible logic, with evidence, and says **Answer not found**
when there is none. It never guesses, never types into the game and never submits anything.

## Activation: 100% manual

- **Where it lives:** a section of the floating trainer, *Input Inspector* on the home screen. Nothing of it runs unless you open the trainer.
- **What starts it:** the only thing that runs an inspection is the **Find Answers** button. Clicking, focusing or typing in a game's textbox never triggers anything.
- **What it remembers between presses:** while the trainer is open, SaveForge remembers *which* game textbox you last focused. That is an element reference only: its text and attributes are not read. It is used to preselect that textbox when you press the button. The listener is removed when the trainer closes.
- **Several textboxes:** a list shows them and you choose one. The preselected one is only a suggestion.
- **Lightweight:** an inspection reads attributes of the chosen element, a few passages (the current one and those it leads to, at most 8 passages and 300 KB of text), the event handlers of the field, its form and its buttons, and at most 10 named functions they call (20 KB each). It runs once per press, and nothing keeps running afterwards.

## What it never does

- **Never modifies the game:** it never changes the textbox's text, never dispatches input/change/submit events, and never clicks the game's buttons. It does not read the text you typed either.
- **Never runs game code:** handlers and passages are read as text, not executed.
- **Never touches sensitive fields:** login, password, payment and account fields are not listed and not inspected:
  - `type=password|email|tel`
  - autocomplete values like `current-password`, `username`, `one-time-code`, `cc-*`
  - names, ids, labels or placeholders about passwords, logins, accounts, e-mail, cards, codes sent by SMS
  - any field of a form that also has a password field
  - SaveForge's own UI
- **Never guesses:** an answer appears only when the game compares the field's value (or the variable it is bound to) with a literal value in code SaveForge can read. Everything else is *Answer not found*, with what was inspected.

## Research per engine

| Engine | How a textbox is made | How the answer is checked | What SaveForge reads | Verified against |
| --- | --- | --- | --- | --- |
| **SugarCube 2** (sources: see *Fixed in 2.3.4*) | `<<textbox "$var" "default" ["Passage"]>>`, `<<textarea>>`, `<<numberbox>>`. Element `<input class="macro-textbox" name="textbox-<slug>">`, id the same unless `id` is given (`src/macro/macros/textbox.js`). On change `State.setVar(varName, value)`; on Enter it also goes to the optional passage. | Passage code that follows, e.g. `<<if $answer is "swordfish">>`, `eq`/`==`/`===`, `isnot`/`neq`/`!==`, `.toLowerCase()`/`.trim()`, `<<switch $answer>><<case "a" "b">>`, `["a","b"].includes($answer)`, `/^a$/i.test($answer)`. | The current passage (`div.passage[data-passage]`, set by `Engine` in `src/engine.js`), its source (`tw-passagedata`, as `Passage.text` reads it), the textbox's target passage and passages it links to, and the story JavaScript (`#twine-user-script`). All are DOM, so this also works when the story keeps `State` private or SaveForge runs isolated. | SugarCube 2 source (tmedwards/sugarcube-2): textbox.js, createslug.js, engine.js, passage.js |
| **Harlowe 3** | `(input-box: bind $var, …)`, `(force-input-box:)`, `(input:)`. | `(if: $var is "x")`, `(else-if:)`, `is in (a: "x", "y")`, `contains`, `(lowercase: $var) is "x"`. | Passage sources in `tw-passagedata`: the passage with the input macro. If the page does not say which passage is current, every passage with an input macro is listed as a candidate, and the evidence says so. | Harlowe 3's documented macro syntax only. Harlowe 3's source was not reachable from here (the GitHub fork found is Harlowe 2, with only `(prompt:)`), so its markup is not relied on. |
| **Ren'Py web** | `$ answer = renpy.input("…")` (drawn on the canvas, with an HTML input on some devices). | Python conditions after it: `if answer.strip().lower() == "swordfish":`, `in ("a", "b")`, `"x" in answer`. | Through Ren'Py's own JavaScript channel (2.3.1, no store variables created): `renpy.game.context().current` → `renpy.game.script.lookup()` → the `Python` node's `code.source`, then the next statements via `node.next`. `If` nodes keep their conditions as source text (`entries`), and `While` nodes theirs (`condition`). Reassignments like `answer = answer.lower()` in between are noted. Only while Ren'Py waits for the input (it answers on its PERIODIC event). | Ren'Py source: `renpy/ast.py` (If, While, Python, PyCode), `renpy/execution.py` (`Context.current`), `renpy/game.py`, `renpy/script.py` |
| **RPG Maker MV/MZ** | Event command 303 *Name Input Processing* (actor, max length), drawn on the canvas. | Event command 111 *Conditional Branch → Actor → Name is* (`[4, actorId, 1, "Name"]`), or a *Script* condition (`[12, "code"]`) comparing the actor's name. | `$dataMap.events` and `$dataCommonEvents` (already loaded game data): branches for the actor of the active `Scene_Name`, or of every 303 command found. | RPG Maker MV/MZ event command layout (`Game_Interpreter.command111`/`command303`) |
| **Other HTML5 games** | A plain `<input>`/`<textarea>`. | JavaScript: `input.value === "x"`, `.value.trim().toLowerCase() == 'x'`, a variable assigned from `.value` and compared later, `["a","b"].includes(v)`, `switch (v) { case "a": }`, `/^x$/i.test(v)`. | Inline handlers of the field, its form and its buttons, and jQuery handlers. Listeners added with `addEventListener` cannot be listed by a web page, unless the Linker's recording is on. One level of named functions they call. | — |
| **Construct, GameMaker, Unity, Godot** | Engine-drawn text input. | Compiled event sheets or WebAssembly: not readable. | Nothing, and it says so: *Answer not found*. | — |

## Results

For the chosen field, SaveForge shows:
- **The field:** engine, label or placeholder, and the variable it is connected to (SugarCube receiver, Harlowe `bind`, the Ren'Py variable, the RPG Maker actor). Its current value is shown when the engine exposes it.
- **Answers:** each value the game checks for, with a **Copy** button, and:
  - **How it is compared:** "letter case does not matter (the game lowercases your text)", "spaces at the ends are ignored", "must contain", "pattern"
  - **What happens:** the start of the branch the game runs, e.g. "→ goes to passage *Vault*", "sets $doorOpen to true"
  - **Evidence:** where it was found (passage *Gate*, line 3; `game/script.rpy:42`; Map 3 › event *Old man* › page 1; `onclick` of button *Submit*) and the code itself
- **Unusable checks are flagged:** for example, an uppercase literal compared with lowercased text can never match.
- **Connected variables:** variables the matching branch sets, and variables used in the same conditions.
- **Answer not found:** what was inspected, and why nothing could be read (closures, WebAssembly, compiled engines, listeners a page cannot list).

**Copy** uses the clipboard (`navigator.clipboard.writeText`, with a selection fallback inside SaveForge's own panel). It never puts text into the game.

## Tests

- **Analysis units** (`test/input-inspector.test.mjs`):
  - SugarCube patterns (operators, chains, switch/case, includes, regex, else branches, impossible checks) and slug matching
  - Harlowe patterns
  - JavaScript handler patterns
  - Python conditions
  - RPG Maker event lists
  - sensitive-field rules
  - "not found" cases
- **Ren'Py:** the Python of the `input` operation, run with CPython against a fake AST (`tools/renpy_exec_harness.py`).
- **In a browser** (`test/input-inspector.e2e.test.mjs`):
  - nothing runs on focus or typing, only on Find Answers
  - the chooser for several fields
  - answers with evidence, and Copy
  - the game's text is unchanged and nothing is submitted
  - login fields are never listed
  - *Answer not found*
  - a story whose State is private
  - a Ren'Py `renpy.input` through the fixture
  - closing removes the focus listener

## Fixed in 2.3.5: SugarCube runtimes without window.SugarCube

**Reported** on tukann.itch.io, passage `CAH_PATRON_CODE_FORM`, with 2.3.4's *Passage sources*:
1. `tw-passagedata`: `<tw-storydata>` is there but has no passages
2. Story API: `window.SugarCube` is not exposed in SaveForge's JavaScript world
3. page bridge: `window.SugarCube` is not exposed by this game

**Investigation:**
- **itch.io and its game hosts cannot be reached from the test environment**, and the game's files are not public elsewhere. So the game itself was not inspected; the conclusions come from SugarCube's source and the diagnostics.
- **The game is SugarCube 2, not SugarCube 1.** `textbox--patroncode` is the slug of the temporary variable `_patronCode`, and temporary variables only exist from SugarCube 2.3. The `div.passage[data-passage]` markup is also SugarCube 2's.
- **Stock SugarCube 2 cannot produce these diagnostics:**
  - The engine runs inside `(function (window, document, jQuery, undefined) { … })` (`template/intro.js`/`outro.js`), so `Story`, `State` and `Engine` are local to it, never globals.
  - It exports only `window.SugarCube`, as a non-configurable property (`src/sugarcube.js`), so a page script cannot remove it.
  - It never empties `<tw-storydata>` (`src/story.js`).
  - The diagnostics therefore show **a customized or protected runtime** that keeps its API private and removes its passages from the page. That combination is typical of games that hide a Patreon code.
- **A real compatibility gap in 2.3.4:** it looked only at `window.SugarCube`. A customized runtime that exposes its Story API as a page global (`window.Story`) was ignored. This was reproduced: 2.3.4 showed the three lines above, word for word, while a genuine `window.Story` was present.
- **A second source 2.3.4 missed:** the game's own HTML file. SugarCube reads its passages from the page when it starts. A story that removes them afterwards still ships them in its file.

**Fix:**
- **Story API lookup** (`findStoryApi` in `src/trainer/sugarcube-live.js`): `window.SugarCube.Story`, `window.Story`, `window.tale` (SugarCube 1). An object is accepted only if all of these hold:
  1. Before any of its functions is called, it has SugarCube's shape: `has`, `get` and one of `filter`/`find`/`lookup`/`lookupWith`. An unrelated `Story` object is never called.
  2. `has(<passage on screen>)` is true.
  3. `get()` returns that passage, by name, with its text.

  The same code (its own source text, never built with `eval`) runs in the page world when SaveForge is isolated. The agent uses new markers, so the 2.3.4 agent cannot shadow it.
- **The game's HTML file:** read once with `fetch(location, {cache: 'force-cache'})`, so normally from the browser cache, and only after the other sources failed.
  - It must be the same story (`ifid`), and is at most 50 MB.
  - It is scanned by tags, with HTML comments removed first; no document is built.
  - If the file has no passages either, the result says what it holds (for example, a large `text/x-packed` script). SaveForge never decodes or runs it.
- **SugarCube runtime** (shown when no source works): format and version (from the page, or from the game file), what `<tw-storydata>` holds, whether `script#script-sugarcube` contains SugarCube's `window.SugarCube` export, the start state, and which SugarCube globals the page has. Then a verdict: customized runtime, different packaging, or engine not started.

**Tests** (`test/input-inspector-runtime.e2e.test.mjs`):
- The reported state: the same first diagnostic line, then the passages from the game file.
- A runtime with `window.Story`: verified, and used without reading the file.
- An impostor `window.Story`: never called.
- A file with packed passages: *Answer not found*, with what the file holds and the runtime verdict.
- An isolated world: the page agent's verified lookup.
- The reported state inside a cross-origin game frame (as on itch.io).

Read-only checks in every case: passages run, unconfirmed `get()` calls, State changes and dispatched events are all zero.

**What still cannot be known from here:** whether tukann's game keeps its passages in its HTML file. If it does, 2.3.5 finds the answer there. If it ships them packed or encrypted, the result is *Answer not found*, and *SugarCube runtime* and the file line say so. If the game compares the code with a computed value (a hash), the result is also *Answer not found*.

## Fixed in 2.3.4: passages that are not in the page

**Reported:** on a real game on mopoga.com, the trainer showed:
- textbox `textbox--patroncode`, passage `CAH_PATRON_CODE_FORM`
- *"Answer not found — The source of passage CAH_PATRON_CODE_FORM is not in the page (tw-passagedata)"*

**Root cause:**
- **SaveForge assumed passage source is always in `<tw-passagedata>`.** SugarCube itself never removes that element (`src/story.js` reads it and leaves it). But a story can remove `<tw-storydata>` after loading, as games that hide their passages do, or add passages at run time with `Story.add()`. SugarCube still has every passage: its `Passage` objects keep their own (detached) elements, so `Story.get(name).text` works (`src/passage.js`).
- **It also took the first passage element on the page**, rather than the one containing the textbox.

**Reproduced** with `test/fixtures/patron-code`: the same passage and textbox name, story data removed by the story. 2.3.3 gave the exact message from the report, while `SugarCube.Story.get` was visible to the page-world userscript.

**Fix** (`sugarCubePassageSource` in `src/trainer/input-inspector.js`). Passage source is read from, in order:
1. `<tw-passagedata>`
2. SugarCube's Story API in SaveForge's JavaScript world. `Story.has(name)` comes first, and only then `Story.get(name).text`: `get()` of an unknown name returns a new, empty passage. Widget passages come from `Story.getWidgets()`, and the story JavaScript from `Story.getScripts()`.
3. When SaveForge runs isolated (it cannot see `window.SugarCube`), a separate read-only page agent (`passageBridge` in `src/trainer/sugarcube-live.js`, with its own markers so an older agent cannot shadow it). It does the same reads in the page world.

What the result shows:
- **The passage of the textbox** is now the `[data-passage]` element around it.
- **"Belongs to"** confirms a real SugarCube passage: the passage exists in a source, and has the `<<textbox>>` for that variable.
- **"Passage sources"** lists every source checked, which one was used, and why each other one failed. For example: no `<tw-storydata>` in the page; `window.SugarCube` not exposed; the page blocked SaveForge's inline script.

Nothing is rendered or run, and State is never touched. The tests count `render`/`processText` calls, `get()` of unconfirmed names, State changes and events dispatched: all zero.

**Tests:** `test/input-inspector-sources.e2e.test.mjs`. Each case failed on 2.3.3:
- the reported case (data removed, Story API)
- no data and no API: *Answer not found*, with the reason of each source
- data in the page (unchanged path)
- an isolated world (page bridge)
- the story in a cross-origin portal frame

**Still unknown on the reported game:** whether it removes its story data or adds passages at run time, and whether `window.SugarCube` is exposed there. *Passage sources* will say.

**Also possible:** if the game checks the code against a computed value (a hash, a value built elsewhere), the result stays *Answer not found*. Only literal comparisons count as answers.

## Status (2.3.3)

Implemented as planned, with the tests above:
- `test/input-inspector.test.mjs`: 9 analysis tests
- `test/input-inspector.e2e.test.mjs`: 5 browser tests
- the `input` case in `test/renpy-live.test.mjs` (CPython)

Two decisions taken while building it:
- **Buttons:** only those of the field's form, or of the element that directly contains it, are read. The whole page is not read: a test showed another field's *Answer* button being attributed to it.
- **Password, e-mail and phone fields** are counted as not inspected, and never listed.

## Not verifiable here

- Real games of each engine on an iPhone (fixtures imitate their documented structures).
- Harlowe 3's exact markup (not available here); its support works from passage text.
- Ren'Py inputs inside screens or Python functions (the inspector reads statements after the current one only).
