# SaveForge 2.2 on iPhone: install, test and what to expect

## What's new in 2.2: performance and stability
- **Big games stay playable while SaveForge works:** it scans in small steps (the game keeps rendering between them), and **Stop scanning** keeps what was read.
- **Memory:** game files in IndexedDB (Unity/Godot) are no longer read when SaveForge opens or in the background. In tests, 60 MB of such files had frozen the game for 44 s and used about 335 MB; now the freeze is under a second and the memory about 10 MB. Large binary values are never decoded or written back.
- **Low Memory Mode (Smart Scan)** is on by default on iPhone. It reads gameplay values first, and the home screen says what it did not read, with **Deep scan** on request.
- **Nothing runs in the background while SaveForge is minimized** or the page is hidden.
- **Reopening is instant:** the last scan is kept for a few minutes (*Results from … · Rescan*).
- **Safe Mode:** if SaveForge did not finish starting last time (the tab crashed or reloaded), the next launch tells you where it stopped and offers Safe Mode.
- **Diagnostics → Performance** shows stage times, values read, what was not read and what runs in the background. **Settings → Performance** has the limits.

**Please check on your iPhone:** whether the games that crashed or reloaded still do. These fixes target what was measured (see TRAINER.md); a crash on iOS can have other causes that tests here cannot reproduce. If one still crashes, reopen SaveForge on that tab: the Safe Mode screen shows the stage it stopped at, and Diagnostics → Performance shows what happened.

## What was new in 2.1: SugarCube saves that stick
- **Why money reverted:** SugarCube resumes its *session state* when the page reloads; it never loads a save on reload. So the edited autosave was ignored, and the next autosave wrote the old money back.
- **Edit SugarCube save** (main menu):
  1. Choose a save and the new value. SaveForge shows the save's value and the running game's value.
  2. **Back up & write.** By default this writes a copy into an empty slot.
  3. Open the game's **Saves** menu and **Load** that slot.
  4. SaveForge shows **✓ Verified** once the game has loaded it, and the next autosave keeps it.
- **Warnings and safety:**
  - It warns when the running game differs from the chosen save, and when you pick the autosave.
  - It refuses to write if the game saved meanwhile.
  - *Undo this write* restores the storage exactly.
  - Apply & Reload of SugarCube saves now warns first.
- **Diagnostics → SugarCube** no longer claims more than it checked. It also shows the session state and saves it found.

**On tukann.itch.io:**
1. Main menu → **Edit SugarCube save** → value `player.money` = what you want → **Back up & write**.
2. Tap – to shrink SaveForge, then in the game open **Saves** → **Load** “… (SaveForge edit)”.
3. Reopen SaveForge: the top line should read **Edited save loaded ✓**.

## What was new in 2.0 (SugarCube)
- **Live `State.variables`:** found directly, or through a page bridge when the userscript runs isolated from the page. It is also found when the story starts after SaveForge opened. `$player.money` is a LIVE variable; search `player.money` or `$player.money`.
- **Diagnostics → SugarCube:** says step by step whether the live State is reachable and why not, with **Look up** for an exact path. Type `player.money` and you see its live value, or the reason it can't be read.
- **Saves are read at their current moment:** for a delta-encoded save, `delta[0]` is only the first moment. The Save Editor and the trainer now show the value the game actually loads (`state.index`).
- **Fixed:** SugarCube saves stored in localStorage with LZString UTF-16 were not decoded at all.
- **Save Editor → trainer:** Export → *Copy share code*, then in the trainer *Import from Save Editor* → paste → confirm. The values are SAVE · IMPORTED, and you can export them or write them into the game's matching save.

**Try this on tukann.itch.io:** open the game, open SaveForge, then Diagnostics → SugarCube.
- **It says "Live: connected":** search `player.money` and edit it.
- **It says "Live state not reachable":** the reason is listed. The game's saves and *Import from Save Editor* still work.

## What was new in 1.9
- **Save variables in the trainer.** The trainer runs the Save Editor's own save detection on the game's browser saves (localStorage, IndexedDB) and lists those variables next to the live ones, with the same friendly names, categories and search.
- **Labels:**
  - **LIVE:** applied now and verified.
  - **SAVE:** pending → *Write saves* (next load), *Apply & Reload* or *Export edited saves*.
  - **LIVE+SAVE:** applied now, plus *Also write to save*.
- **No guessing:** a save field is merged with a live variable only via the engine's save layout (RPG Maker, SugarCube) or after SaveForge sees the save follow a live change. To link one yourself, change it in the trainer, then save in-game.
- **Sync save variables** re-reads the saves, and they also sync automatically while the trainer is open. If the game saves while you have pending save edits, nothing is overwritten.

## What was new in 1.8
- **Fixed: values hidden by large dialogue tables.** Since 1.6, one shared scan budget could be used up by a big dialogue/translation table before deeper game values (such as money) were reached. Each global now has its own budget and text is capped separately.
- **Rescan finds state created later** (after a title screen or "Start").
- **Script-level `let`/`const` variables** and **SugarCube `setup` objects** are found.
- **All variables (raw):** a source with every reachable variable and no classification. Search → *Search all accessible variables* repeats a search there.
- **Diagnostics → Run full scan:**
  - reached vs. listed vs. excluded vs. not reached, with reasons
  - what cannot be reached (getters, Map/Set, closures, modules, WebAssembly…)
  - **Look up a value or name**, e.g. `28,480,799`

## What was new in 1.7
- **Button & Textbox Linker (advanced, optional):** Main menu → *Button & Textbox Linker* → **Inspect element**, then tap a game control. The tap is swallowed, so nothing is bought or changed.
  - **What you see:** confirmed handlers, the functions they call, the variables their code changes, and possible links (labelled as such), plus what cannot be seen and why.
  - **Watch one tap / Detect by typing:** runs the element once for real and shows exactly which variables changed.
  - **Link to another action:** e.g. Buy → *Same as tapping “Sell”*, Buy → *Do nothing*, a textbox → *Write to player.name*, a story choice → another choice. A preview needs confirmation, and risky buttons need an extra tick.
  - **Undoing it:** *Undo last change*, *Restore original*, *Restore all originals*, *Mappings enabled* (off = disable all). Mappings can be saved per game and stay off next time unless you turn on *apply automatically*.

## What was new in 1.6
- **Game variables are found one by one.** A game that keeps everything in one generic object (settings, asset lists *and* its money) no longer shows "Game state: 0". You should not need *Include website globals* any more.
- **Potential game variables:** a new home-screen category for values SaveForge is not sure about. They are shown, not hidden.
- **Learning while you play:** values that change while the trainer is open (checked every 2 s), and values whose edits were verified, are promoted to game variables.
- **You decide:** ⓘ → *Detection* shows the score and reasons, with *This is a game variable* / *Not a game variable*. Your choice is remembered for that website.
- **Diagnostics explains zero:**
  - *Game state inaccessible* (SaveForge cannot reach the game's JavaScript) vs. *No game state detected* (with the reason)
  - counts of confirmed, potential and excluded variables
  - **Why was this excluded?**, with *Mark as game*
  - **Copy detection report** (names, types and reasons only; no values)

## What was new in 1.5
- **Game state and the screen are reported separately.** After an edit, the status box shows the *Game state* (✓ verified) and the *Screen*:
  - ✓ refreshed
  - ✓ the engine redraws by itself
  - ⚠ not refreshed yet
  - ? can't check
- **Update game display:** shows how the game draws, lists the game's own redraw functions (e.g. `afficherMagasin()`), and runs one only when you tap **Try**. It then checks the screen and can be set to run automatically after edits on that site.
  - **Display-only fallback:** shows the new number on screen without changing the game.
  - **Manual fallback:** switch screens in the game.
  - It never reloads the page or taps buttons for you.
- **Smarter search:** matches names, English translations, original-language names, paths and current values (type `1822`). Synonyms work (money/cash/coins/argent/所持金…).
  - **Filters:** All / Numbers / Text / On/Off / Editable / Game state, plus *Gameplay only* and *Exact*.
  - **Ranking:** gameplay numbers rank above dialogue.
  - **Clear button**, and your last search is remembered.
- **English for text values:** UI sentences are translated offline, e.g. “Gagner de l’argent” → *Earn money* and “Pas assez d’argent” → *Not enough money*.
  - **Where translations appear:** under the text in lists, plus a **Translate to English** button and the full text in ⓘ.
  - **Game text is never changed.**
- **Compact view** and larger, easier-to-read rows.


## 1. Install or update (no Mac needed)

1. Install **Userscripts** from the App Store (free). Then turn it on in Settings → Apps → Safari → Extensions → Userscripts, and set **All Websites → Allow**. With "Ask", game frames from other sites may stay blocked.
2. In Safari, open **one** of these links, then tap **AA** (or the puzzle-piece icon) → **Userscripts** → **Install** (or **Update**).

   | Script | Behaviour | Link |
   | --- | --- | --- |
   | **Normal** (recommended) | The ⬢ button appears only where a game is detected | `https://criticail.github.io/Wand-Enhancer/save-analyzer/standalone/saveforge-trainer.user.js` |
   | **Always visible** | The ⬢ button appears on every site you allow (hide it per site with a long-press) | `https://criticail.github.io/Wand-Enhancer/save-analyzer/standalone/saveforge-trainer-always.user.js` |

   Install only one. If both are installed, the first one to load wins and the other stays inactive.
3. If you already had SaveForge, the Userscripts popup offers **2.2.0** as an update. You can also open the link again and tap Install.

## 2. Opening SaveForge

| Method | Works when |
| --- | --- |
| Tap the **⬢** button | A game was detected, the site is set to "Always show", or you installed the always-visible script |
| **Three-finger tap** anywhere on the page | Any page where Userscripts runs. The game still receives the tap. |
| Add **`#saveforge`** to the end of the address and press Go | Any page where Userscripts runs |
| Long-press **⬢** → *Always show on this site* | Keeps the button on that site from then on |
| Trainer → **Settings** → *Always show* | Same, from inside the trainer |

If none of these work on a site, Userscripts is not running there. Check the extension's permission for that site.

## 3. What the status marks mean

After every edit, SaveForge reads the value back **from the game's own object**. It reads again 0.4 s and 1.5 s later.

| Mark | Status | Meaning |
| --- | --- | --- |
| … | Checking | Written, still watching |
| ✓ | **Applied and verified** | The game has the new value and kept it. A counter that keeps moving from your value (like distance) also counts. |
| ≈ | **Adjusted by the game** | The game clamped it, e.g. potions max 99 or HP max = Max HP |
| ↺ | **Reverted by the game** | The game put the old value back. The real value is probably kept elsewhere. Try **Lock value** or **Find a value**. |
| ✕ | **Failed** | The game rejected the write, or the object no longer exists (tap **Rescan game**) |
| 🔒 | **Locked** | SaveForge re-applies your value whenever the game changes it (shown with a count) |
| ⟳ | **Requires reload** | A saved edit: tap **Apply & Reload**. After the reload SaveForge checks the values again ("After reload: 2/2 edits kept"). |
| ⤓ | **Saved edit (export)** | Editing an imported save file in the SaveForge app |

A ✓ means the game's own variable holds your value. If the screen still shows the old number, the game may only redraw it later (SugarCube: tap *Refresh passage*).

## 4. Things to try on a real game

1. **Edit and verify.** Open the trainer, change a number, and watch the mark next to it and the "Status in the game" box in the edit sheet.
2. **Overwritten values.** If you get ↺, open the value and tap **Lock value**. If gameplay still doesn't change, the variable you edited is a display copy. Use **Find a value**:
   1. Type the number you see in the game and tap **First scan**.
   2. Change it in the game (spend or earn), type the new number and tap **Next scan**.
   3. Repeat until a few matches remain, then tap **Edit these**.
3. **Foreign or cryptic names.** Turn on Trainer → **Settings** → *Show English labels*. The original names stay underneath. Open **ⓘ** for the "In English" section.
4. **Nothing found.** Open **Diagnostics**. It shows:
   - which frame you're in
   - the *script context* (it must say "page")
   - the detected engines
   - frames on the page
   - confirmed / potential / excluded variables, and whether the state is *inaccessible* or *not detected*
   - why each variable was excluded (tap *Mark as game* if it belongs to the game)
5. **Late-loading games.** The button can appear up to 60 s after the page loads (it watches for the game). **Rescan game** looks again on demand.
6. **Restore.** **↺ Restore original** in the edit or ⓘ sheet puts back one value. *Backups & restore* puts back everything.

## 5. Verified by automated tests vs. still needs your iPhone

### Verified by the automated tests (Chromium, 180 tests)

**Edits:**
- Edits reach the game's live objects, even after the game replaced them. Covered cases: SugarCube copying variables on every passage, a state object rebuilt 5× per second, and RPG Maker objects re-read on every access.
- Engine setters are used: RPG Maker `gainGold`, `gainItem`, `setValue`, `setHp` and `changeLevel`, and Phaser `registry.set` / `data.set`. Clamping is reported as "adjusted", never as success.
- Overwritten values are reported as "Reverted". Lock keeps re-applying, and unlocking stops it.
- Apply & Reload is checked again after the reload.
- Find a value narrows from many matches to the real variable, and editing the result changes the game.

**Performance and stability (2.2)**, with 4× CPU throttling and a phone-like (touch, small screen) context, measuring the game's own frame gaps:
- **20,000 variables, dialogue and a busy game loop:** the game keeps rendering while SaveForge opens (longest freeze under 1 s), while it stays open (under 0.7 s) and while it is minimized (no long tasks).
- **100,000 variables, 10 levels deep:** the player's money is read first, what was not read is shown, and Deep scan can be stopped.
- **60 MB in IndexedDB:** opening uses under 80 MB more memory (was about 335 MB) and does not read it. *Saves in storage* reads it with the 1 MB files left unread, and writing back leaves those files untouched.
- **Reopening reuses the last scan**, and an interrupted start offers Safe Mode, which does no heavy work.
- **The Button Linker never stacks duplicate page listeners.**

**SugarCube save editing (2.1)**, on a story that resumes its session state on reload like SugarCube:
- **The money revert is reproduced:** editing the autosave + Apply & Reload brings back the old money, and the next autosave writes it back. SaveForge now warns before that write.
- **The workflow:** write a copy to an empty slot (autosave untouched, running game unchanged) → load it from the game's Saves menu → verified → the next autosave carries the edit → the snapshot is listed in Backups.
- **Warnings and refusals:** the running game differing from the chosen save, confirmation, refusal when the game autosaved meanwhile, and Undo restoring the exact storage.
- **Loading paths:** the public Save API loads it for you, and the session-state option applies on reload and is verified only after the reload.
- **Unit tests:**
  - only the current moment changes and the delta history stays valid
  - all storage encodings round-trip
  - stale writes are refused
  - missing variables are never created

**SugarCube (2.0), on a realistic story:** sealed `window.SugarCube`, getter-based `State`, cloned moments, saves stored as SugarCube 2.36 does.
- **Late start:** `State.variables.player.money` becomes LIVE once the story starts, is found by `player.money`, `$player.money` and `State.variables.player.money`, and is edited and verified. `_temp` variables are listed too.
- **Isolated userscript world** (a real isolated world in Chromium): the trainer can't see `window.SugarCube`, but the page bridge connects, and an edit changes the page's State.
- **Delta save:** the live variable is linked to the current moment's field `delta[1]`, not `delta[0]`. Writing the save produces a history whose current moment holds the new value, with `delta[0]` untouched.
- **State kept private:** Diagnostics names the reason. The game's saves show the current-moment value, and a share code from the Save Editor imports after confirmation, exports a verified file and writes into the matching game save.
- **Unit tests:**
  - the current moment matches SugarCube's own decoding on 300 random histories
  - the UTF-16 LZString round trip
  - share codes
  - exact-path parsing and search

**Save variables (1.9):**
- A generic game's save shows up as SAVE entries next to the LIVE ones. Fields with the same name and value are *not* merged. After a live edit and an in-game save they become one LIVE+SAVE entry, linked by observation.
- *Also write to save* + *Write saves* changes the save without a reload. A SAVE-only edit stays pending, explained as such, with the running game untouched. Undo/redo cover it, Apply & Reload loads it, and the save snapshot restores the old save.
- RPG Maker gold/HP/level and SugarCube variables are linked through their engine save layouts, and the edited RPG File1 decodes with the new gold.
- Saves appear automatically after the game saves. Sync save variables works, and a pending save edit is never written over newer progress.
- The linking rules are unit-tested: equal values never link, ambiguous changes never link, small values need two changes, and contradicted links are dropped.

**Discoverability (1.8):**
- The 1.6/1.7 regression is reproduced and fixed. A money value 5 levels deep next to a 12,000-line multilingual dialogue table:
  - is listed under Money
  - is found by searching `28480799`
  - can be edited
  - shows as *Listed* in the full-scan lookup
- `let`/`const` script variables are found and edited for real. A global created after the trainer opened is found by Rescan. SugarCube `setup` and story variables are both listed.
- The full scan names a getter and a Map instead of inventing values, says when a number is not reachable, and the raw search finds variables the classified scan does not list.
- Variables that were editable in earlier versions (all demo games and fixtures) are still found, editable and live.

**Button & Textbox Linker (1.7):**
- Inspecting Buy, Reset and a name field runs nothing: money, items and focus are unchanged, so no keyboard opens.
- Inline handlers and handler properties are confirmed. A listener the page added before SaveForge is not invented; the limit is stated instead.
- Watch one tap reports the real changes (money 100 → 120, swords 1 → 0).
- Buy → Sell works after preview and confirmation. *Mappings enabled* off restores buying, Undo removes the mapping, Do nothing swallows the tap, Restore original buys again, and closing SaveForge removes every interception.
- Detect by typing finds the bound variable (`joueur.nom`). Linking an unbound field writes into `joueur.surnom`, and the saved mapping comes back when SaveForge is reopened with *apply automatically* on.
- A story choice is relinked to another choice (SugarCube-style demo).

**Detection (1.6):**
- The 1.5 "Game state: 0" case: a custom game with no engine whose state sits under a generic global, next to config, asset URLs and UI settings. Money, shop stats and stock are found without website globals; config, assets, UI settings and site data stay out.
- A cryptic counter that changes while you play is promoted automatically. Marks are remembered after reopening the trainer, and the detection report contains no values.
- The game-portal page still lists no website globals, and Diagnostics says "No game state detected" with the reason.

**English:**
- Offline translation for Japanese, Chinese, Korean, Russian, Spanish, French, German, Portuguese and Italian names.
- Abbreviations are labelled as guesses, and unknown words are never invented.
- English labels keep the original key, and editing still works.

**Activation:**
- The launcher appears for games that load late (7 s), and a three-finger tap opens SaveForge.
- The always-visible variant shows the launcher everywhere, and per-site hide still works.
- Games in srcdoc frames and nested cross-origin frames are handled.
- Ordinary websites still get no DOM changes, storage or errors.

**Existing features:** analyzer, saves, Diagnostics, favourites, backups, Safari extension and all earlier tests still pass.

### Not verifiable here (please test on your iPhone)

- Whether tukann's game (or any real game) exposes a redraw function SaveForge can find. Many games keep their render functions private. In that case the screen status says "not refreshed yet" and the display-only and manual fallbacks remain. The Update game display screen shows exactly what was found.


**Userscripts on iOS:**
- Whether Userscripts on *your* iOS version runs the script in the page context on every site. Diagnostics → *Script context* tells you. "isolated" means edits cannot reach the game.
- Whether Userscripts injects into cross-origin game frames on the sites you use. This depends on the extension's per-site permissions.
- Whether the Userscripts popup offers the 2.2.0 update automatically (its update check is known to be imperfect).

**Mobile Safari behaviour:**
- Three-finger tap on iOS. Safari or the system may claim the gesture in some situations; `#saveforge` is the fallback.

**Real games and sites:**
- How much the Linker can see on your games. Many games add their listeners before SaveForge starts, so those show only through *Watch one tap*. Canvas games cannot be remapped.
- Whether the per-variable scores pick the right values on *your* game. If something is wrong, Diagnostics → *Copy detection report* gives a report you can share.
- Real commercial games and portals such as mopoga.com. The demo games imitate the engines' public APIs, but they are not those engines. Unknown engines rely on the generic detector and Find a value.
- Games that keep state in closures, ES modules, WebAssembly (Unity, Godot, Ren'Py web, GameMaker) or on a server. Those values cannot be found or edited live; SaveForge tells you so in Diagnostics.

## 6. Privacy

- **Offline translation:** works entirely on your device.
- **"Translate online":** used only when you tap it. It asks first and sends only that one piece of text to Google Translate in a new tab, never saves or game data.
- **Backups and settings:** stay in Safari's storage for that site, in a separate `saveforge-trainer` database.
