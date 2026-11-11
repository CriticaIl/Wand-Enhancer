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
| **SugarCube 2** | `<<textbox "$var" "default" ["Passage"]>>`, `<<textarea>>`, `<<numberbox>>`. Element `<input class="macro-textbox" name="textbox-<slug>">`, id the same unless `id` is given (`src/macro/macros/textbox.js`). On change `State.setVar(varName, value)`; on Enter it also goes to the optional passage. | Passage code that follows, e.g. `<<if $answer is "swordfish">>`, `eq`/`==`/`===`, `isnot`/`neq`/`!==`, `.toLowerCase()`/`.trim()`, `<<switch $answer>><<case "a" "b">>`, `["a","b"].includes($answer)`, `/^a$/i.test($answer)`. | The current passage (`div.passage[data-passage]`, set by `Engine` in `src/engine.js`), its source (`tw-passagedata`, as `Passage.text` reads it), the textbox's target passage and passages it links to, and the story JavaScript (`#twine-user-script`). All are DOM, so this also works when the story keeps `State` private or SaveForge runs isolated. | SugarCube 2 source (tmedwards/sugarcube-2): textbox.js, createslug.js, engine.js, passage.js |
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
