# SaveForge 2.3 on iPhone: install, test and what to expect

## Fixed in 2.3.6: SugarCube save variables missing on itch.io (regression since 2.3.2)

**What you saw (tukann.itch.io, 2.3.5):** the main menu showed only *Partial: generic page state* and LIVE* values; the SugarCube variables (SAVE rows such as `$player.money`) you had edited before were gone.

**Why:** itch.io serves every HTML game from one website (`html-classic.itch.zone`), so all of them share one browser storage. Since 2.3.2, a save is shown next to the live values only if SaveForge can tell it belongs to the game you are playing. This game keeps SugarCube's API private and saves under its own id, so SaveForge could not tell which of the website's stories was running. Its own save was marked *not confirmed* and was hidden without a word. Reproduced: 2.3.1 lists the story's save values; 2.3.2–2.3.5 list none.

**What 2.3.6 changes:**
- SugarCube keeps the current playthrough in the tab (`(Saved Games)<id>.state`). The story whose playthrough is at **the passage on screen** is the one running. Its saves are this game's again; other stories' saves stay hidden. If two playthroughs are at the same passage, nothing is guessed.
- When saves are still held back, the main menu says so: *Not confirmed as this game's: N save(s), not listed*, with each save's reason.

**Please check (not confirmed on the real game yet):**
1. Install 2.3.6, open the game, play to any passage, open SaveForge.
2. Main menu: do the SAVE variables (for example `$player.money`) appear again?
3. If not, send: the *Not confirmed as this game's* line (if shown) and its hint; Diagnostics → *Where the variables come from* (the *Saves* list with each reason); and Diagnostics → *Game context* (how many games SaveForge has seen on this website).

## Fixed in 2.3.5: Input Inspector on games without window.SugarCube

**What you saw (tukann.itch.io):** all three passage sources were "not available".

**What that means:** this game's SugarCube is customized. A normal SugarCube always has `window.SugarCube`, and never empties its story data. The game keeps SugarCube's functions private and removes its passages from the page.

**What 2.3.5 adds:**
- **The Story API is also found as `window.Story`** (or SugarCube 1's `tale`), after checking that it really is the story's.
- **The game's own HTML file** is read once from the browser cache: passages removed from the page are often still in it. It is never run.
- **SugarCube runtime:** when nothing can be read, SaveForge says why (version, what the story data holds, whether the engine exports its API, which globals exist).

**Please check:**
1. Same game and passage → **Find Answers**.
2. Look at the last line of **Passage sources**:
   - *"the game's HTML file … used"*: the passages were read, and any answers shown are the game's own comparisons.
   - *"has no passages either … packed or encoded"*: the game ships its passages in a form SaveForge does not decode, so the answer cannot be read.
3. If the passages were read and the result is still *Answer not found*, the game checks the code against a computed value (for example a hash).

## Fixed in 2.3.4: Input Inspector on stories that hide their passages

**What you saw:** on mopoga.com, *Answer not found — The source of passage CAH_PATRON_CODE_FORM is not in the page (tw-passagedata)*.

**Why:** SaveForge only read passages from the story data in the page. That story data can be removed by the game after it loads, while SugarCube still has every passage.

**Now:** SaveForge also reads the passage the way SugarCube offers it: `Story.has(name)` first, then `Story.get(name).text`. When SaveForge runs isolated from the page, it reads it through a small read-only page script. It never runs a passage and never changes the game.

**New in the result:**
- **Passage sources:** which source was used, and why the others failed.
- **Belongs to:** confirms the textbox is part of a real SugarCube passage.

**Please check on your iPhone:**
1. Open the same game and passage, then Input Inspector → **Find Answers**.
2. Look at **Passage sources**:
   - If *SugarCube's Story API … used*, the passage was read. The answers listed are the ones the game compares the code with.
   - If it says *window.SugarCube is not exposed*, this game hides SugarCube completely, and SaveForge cannot read its passages.
3. If the passage was read but the result is still *Answer not found*, the game probably checks the code against a computed value (for example a hash), not a fixed text.

## New in 2.3.3: Input Inspector (optional, manual)

When a game asks you to type something (a password for a door, a riddle's answer, a name), the **Input Inspector** shows which text the game itself checks for.

**How to use it:**
1. Tap the game's textbox (optional).
2. Open SaveForge → **Input Inspector** → **Find Answers**.

**What it does and doesn't do:**
- **It runs only when you press the button.** Tapping or typing in a textbox never starts it.
- **If the page has several textboxes,** you choose one. The one you tapped is preselected.
- **Each answer comes with:**
  - a **Copy** button
  - how the game compares it ("letter case does not matter", "spaces are ignored")
  - what happens next ("goes to passage Vault")
  - the variable it is connected to
  - **Evidence:** where it was found, and the game's code
- **If the game's logic can't be read, it says *Answer not found*** and what it read. It never guesses.
- **It never types into the game, never submits anything, and never inspects login, password or payment fields.**

**Engines:**
- **SugarCube:** from the story's passages, even when the story keeps its variables private.
- **Harlowe:** from passages.
- **Ren'Py web:** the conditions after `renpy.input`, through Ren'Py's own interface.
- **RPG Maker:** name-input checks in events.
- **Plain HTML games:** from the code attached to the textbox.
- **Not readable:** Construct, GameMaker, Unity and Godot compile their logic, so the result there is *Answer not found*.

Details and the research behind it: INPUT-INSPECTOR.md.

## Fixed in 2.3.2: another game's saves next to the game you play (portals such as mopoga.com)

**What you saw:** on a portal, after switching games, the trainer listed `$player.money` as **SAVE** (value 0) next to the new game's **LIVE** values (Takedown, Chokehold stamina).

**What it was:** a saved variable of the *previous* game. The live variables were the right game's. A portal's games are usually served from one website, and a website has one browser storage, so every game's saves sit side by side. The previous game was a SugarCube (Twine) story, and its saves were still in that storage. Two mistakes put its save next to the new game:
1. **The SugarCube rule.** When only one SugarCube story had saves on the website, SaveForge treated it as "the current story" on **any** page there, even a fighting game.
2. **The merge.** Every save not known to belong to another game was shown next to the live values. The "SugarCube (Twine)" you saw described that *save*, not the game you were playing.

Both were reproduced with two games served from one origin inside a portal (a SugarCube story, then a fighting game), before the fix.

**Now:**
- **Each save is checked for its game.** A save is this game's only with evidence:
  - this game wrote it while SaveForge was open
  - it is named after this game
  - it is the running SugarCube story's own save
  - or you said so
- **Saves of another engine** (a SugarCube save on a page that is not a SugarCube story) or of another story are another game's. They are never shown and never written. Diagnostics lists them.
- **Saves that cannot be confirmed** never appear next to the live values. Under *Saves in storage* they are marked **NOT CONFIRMED** and are written only after you confirm they are this game's save. On a website where SaveForge has seen only this game, a save of the same engine is shown as **PROBABLY** (still not confirmed).
- **Every value says where it comes from** (ⓘ → *Belongs to*): the game, frame and address for live values; the storage key and how sure SaveForge is for saves. **Diagnostics → Where the variables come from** lists all of them.
- **A game change without an address change is noticed:** if the page swaps its game inside the same document (new scripts, a new Twine story, the old game's objects removed), the trainer reopens for the new game. Objects the old game left behind are kept out.

**Please check on your iPhone (mopoga.com):**
1. Play a game, then switch to another, and open SaveForge. No SAVE row of the previous game should appear.
2. Tap ⓘ on a value → *Belongs to*. It names the game and frame.
3. If a save of yours is wrongly hidden: Diagnostics → *Saves of other games here* → **This is this game's save**.

## Fixed in 2.3.1: Ren'Py games reloading when SaveForge opens

**What caused it:** Ren'Py web keeps its WebAssembly memory (192 MB or more) in page variables. When the trainer opened, SaveForge listed those variables entry by entry: one item per byte, hundreds of millions of them. iOS stops a tab that uses that much memory, and Safari reloads the page. Without SaveForge, nothing touches that memory, which is why the game ran fine on its own.

**Measured** (Chromium with a phone-like memory limit; details in TRAINER.md):
- **2.3.0:** the page crashed every time, after growing by about 2.5 GB.
- **2.3.1:** the trainer is usable in about 0.6 s, uses about 20 MB more, and the game never pauses.

**Now on Ren'Py web games:**
- **Light mode:** SaveForge opens at once without scanning anything heavy and without reading storage. The WebAssembly memory is never read or written.
- **Live variables** (recent Ren'Py versions): money, flags, relationship points, names… are listed and can be edited. SaveForge asks Ren'Py itself to change the value, and the game redraws its screens. A ✓ appears when Ren'Py confirms the value 1.5 s later. Ren'Py applies changes while the game waits for you (dialogue or a menu). **Save in-game to keep them.** Rolling back past the change undoes it.
- **Older Ren'Py web games** without this interface: SaveForge explains why, and offers **Inspect the saves** (the saves in storage, read only when you tap it).
- **Diagnostics → Ren'Py web** shows whether SaveForge is connected, the Ren'Py version, and how many commands Ren'Py answered.

**Please check on your iPhone:**
1. **Does the Ren'Py game still reload when you open SaveForge?** This was fixed for the cause that was measured. If it still reloads, open SaveForge again on the reloaded page and use Safe Mode, then send Diagnostics.
2. **Does the panel say "Ren'Py (live)" and list your game's variables?** Older Ren'Py versions cannot.
3. **Edit one value while the game shows dialogue.** Does the ✓ appear, and does the game use the value?

## Fixed in 2.3: the wrong game, and duplicate menus

**What caused it (found and reproduced by tests before fixing):**

| What you saw | Cause | Fixed by |
| --- | --- | --- |
| Game B showed Game A's variables or favorites | Everything SaveForge remembered (favorites, recent, hidden/marked variables, learned save links, Linker mappings) was stored **per website**. Sites such as itch.io's game host and GitHub Pages serve many games from one website, so every game there shared it. | Stored **per game** now (website + game address). |
| Reopening after switching games showed the old game | The scan kept for a quick reopen was reused for anything in the same browser tab, including a new game loaded by a portal without a full page load. | The kept scan is reused only for the same game in the same page. |
| The trainer kept the old game while open | Nothing noticed when the page switched to another game. | The trainer checks once a second (and on navigation). When the game changes it closes its scan of the old game and opens again for the new one. Any edit still aimed at the old game is refused. |
| Game B offered Game A's **saves** | One website has one browser storage. On shared hosts it holds every game's saves, and SaveForge read all of them. | Every save is matched to its game (see below). Other games' saves are left out and never written. |
| `#saveforge` / the button opened nothing, or the old game | When a portal replaced or re-navigated its game frame, SaveForge still used the **first** game frame it had heard of, which could be gone or showing another game. | The top page asks every frame what it shows **now** before opening. A frame that now shows another game replaces its old entry. |
| Two buttons, or two menus | Each frame decided on its own: a portal page with an animated banner (a canvas) and the game frame both showed a button, and each could open a panel. | The top page coordinates: one button (the game frame's), one panel across the page and all its frames. Several games on one page: a chooser asks which one. |
| Timers kept running after closing during a scan | A scan that finished after you closed the trainer was never stopped. | Late scan results are discarded and stopped. A test closes SaveForge three times mid-scan and checks nothing is left running. |

**Saves on websites that host several games:**
- A save the game writes while SaveForge is open becomes that game's. So does a save named after the game (`moonharbor_save` → "Moon Harbor"), and a SugarCube save of the running story.
- **Saves of other games are not shown and never written.** Diagnostics → *Game context* lists them. If one is wrongly attributed, *This is this game's save* hands it back.
- A save whose game cannot be told stays available. Once SaveForge has seen two or more games on that website, writing such a save asks first.
- **SugarCube:** stories name their saves after the story id. Only the running story's saves are offered. If several stories have saves and the one on the page cannot be identified, SaveForge refuses to write rather than guess.

**Diagnostics → Game context** shows:
- the game, its address and frame
- the context ID, and why this game was selected
- scan status and age
- trainer panels and launchers on this page (and in all frames, from the top page)
- the number of SaveForge copies
- SaveForge's own timers and page listeners running right now

**Reset this game's trainer data** (same screen) deletes SaveForge's records for this game and scans it again. It removes favorites, recent, marks, learned save links and Linker mappings. **The game's own saves are not touched.**

**Upgrading from 2.2:** older versions stored data per website. The **first game you open on each website after updating** keeps that data; other games there start fresh. Older save backups stay listed under Backups.

## Which version am I running? (2.3.6)
Every part shows the same version **and build** (a fingerprint of the code; the same build means the same code):

| Where | How to see it |
| --- | --- |
| SaveForge website | Next to “Save analyzer · mod menu”: **· v2.3.6**. Tap **ⓘ** (top right) → *Version*: **SaveForge 2.3.6 · build xxxxxxxx** |
| Floating trainer | Header: **TRAINER 2.3.6**. Diagnostics → *This copy: SaveForge 2.3.6 (build xxxxxxxx)* |
| Userscripts app | The SaveForge script shows **2.3.6** |

**If the website still shows an older version:**
- **The cache.** GitHub Pages lets browsers keep files for up to 10 minutes, so a deploy can take that long to appear. Pull down to reload, or tap ⓘ → **Reload latest version** (clears SaveForge's offline copy and reloads).
- **The Userscripts app.** It checks for updates on its own schedule. Open the install link again (USERSCRIPT.md) and tap **Update**, then reload the game page.

**What changed in 2.2.2 (the website's version label):**
- **Why "2.2.1" never appeared on the website:** the website never showed a version anywhere. It does now, and the trainer and userscript read the same version file.
- **The main page** now loads one bundled file whose address changes with every build. Safari can no longer mix cached old parts with new ones after an update.
- **The offline copy** (service worker) is replaced with each build and checks with the server instead of reusing cached copies.
- **A test fails** if the published files were not rebuilt from the current code.

## Fixed in 2.2.1
- **Timers left running after closing.** When the trainer was opened by the userscript, closing it skipped SaveForge's own cleanup: the userscript's close handler replaced it instead of running alongside. Each close left a timer behind (on SugarCube games, a check every second), and they added up with every reopen. Fixed; a test opens and closes SaveForge three times and checks nothing keeps running.
- **No more second menu.** If two SaveForge copies run on a page (two installed scripts, an old and a new copy, or the userscript plus the Safari extension), each used to open its own panel. Now the second copy shows the existing panel, and **Diagnostics** says how many copies are running.
- **No pointless polling on games like yours:** on a SugarCube story that is already running and keeps its State private, SaveForge no longer polls for it.
- **The version is shown** next to TRAINER in the header.

**If you still see two menus:** check the version next to TRAINER and Diagnostics → *SaveForge copies*. In the Userscripts app, keep only one SaveForge script (delete the "always visible" one if you installed both, and any old copy), and turn off the SaveForge Safari extension if you installed it too.

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
3. If you already had SaveForge, the Userscripts popup offers **2.3.6** as an update. You can also open the link again and tap Install.

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

### Verified by the automated tests (Chromium, 198 tests)

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

**Input Inspector passage sources (2.3.4):**
- Passage data removed by the story: read through SugarCube's Story API, with the same answers (passage, linked passage, widget). The tests count passage code runs, unknown-name `Story.get()` calls, State changes and dispatched events: all zero.
- No data and no SugarCube API: *Answer not found*, with the reason for each source.
- Data in the page: read as before.
- SaveForge isolated from the page: read through the page bridge.
- The story in a cross-origin portal frame: inspected inside that frame.

**Input Inspector (2.3.3):**
- Nothing runs on focus or typing, only on Find Answers.
- The tapped SugarCube textbox: answers with how they are compared, what happens, the connected variables, evidence and a working Copy. The game's textbox keeps your text, and no event is dispatched into the page.
- Several textboxes: a chooser. The login form's fields are not offered, and are counted as not inspected.
- "Answer not found" where no check exists, and never a guess.
- A story with private State: still found from its passages.
- A plain HTML game: a check in a named function. A listener a page cannot see is explained.
- Ren'Py: the conditions after `renpy.input`, with the normalisation before them.
- The Ren'Py Python, run in CPython against a fake AST.
- Analysis units: SugarCube, Harlowe, JavaScript, Python and RPG Maker patterns, impossible checks, sensitive fields.

**Games sharing one game host (2.3.2)**, in a portal with games served from one origin:
- A SugarCube story, then a fighting game: the fighting game shows only its own variables and saves. The story's save is listed as another game's, whether or not SaveForge was opened in the story.
- Two SugarCube stories: each sees only its own saves.
- A game switch without an address change is followed. An object the previous game left on the page is kept out, and Diagnostics says why.
- Saves that cannot be confirmed are never merged into live values, and are not written without your confirmation.
- Every value names its game, frame and save entry.

**Ren'Py web (2.3.1)**, on a page with the JavaScript surface of a real Ren'Py 8 web build:
- Activating SaveForge: no crash, no enumeration of WebAssembly memory or virtual files, first screen within a second, opens on Ren'Py's live variables.
- No IndexedDB access until *Saves in storage* is opened. Ren'Py save variables are listed then.
- The game's variables are listed (from `ever_been_changed`) and Ren'Py's own are not. Big integers are read-only.
- Editing sets the value through Ren'Py, verified by reading it back. The game's display updates, and no store variable (`result`) is created. Values the game changes are picked up.
- Ren'Py not answering: the panel stays usable and explains, and the command is taken back.
- An older build without `renpy_exec`: an explanation, and the saves on request.
- Closing leaves no timers or callbacks; the raw page view is safe.
- The Python run in CPython as Ren'Py runs it: no store variables created, a game variable named `result` untouched, type checks, read-back, `restart_interaction`.
- Every walker on an Emscripten-shaped window: no heap or file enumeration. Find a value still finds the game's own values.

**Game targeting and one trainer (2.3):**
- Two games on one website: Game B shows none of Game A's favorites, and Game A's save is neither offered nor written. Game A keeps its favorite.
- Single-page navigation: after closing, the old game's kept scan is not reused. While the trainer is open, it switches to the new game by itself. Edits never reach the old game's objects, and a write prepared for the old game is refused.
- A portal swapping or re-navigating its game frame: `#saveforge` opens the game shown now.
- Two game frames: a chooser lists both, and only the chosen one opens.
- A portal page with its own canvas plus a game frame: one launcher and one panel across all frames.
- Two SaveForge copies in separate worlds plus a reinjected script: one launcher and one panel. Exactly one launcher comes back after closing.
- Closing during a 20,000-variable scan three times: no timers left behind and no panel brought back. A 100,000-variable game changing during its scan: the old scan is dropped.
- The game changing three times during the first scan: the newest game's result is shown.
- Navigating away and back, and a Safari-style page restore: the right game, the same context.
- Diagnostics shows the game context, instances and resources. *Reset this game's trainer data* keeps the game's save.

**Existing features:** analyzer, saves, Diagnostics, favourites, backups, Safari extension and all earlier tests still pass.

### Not verifiable here (please test on your iPhone)

**Input Inspector (2.3.3, Chromium only):**
- **Real games:** fixtures imitate SugarCube's markup (from its source), Ren'Py's AST (from its source) and plain pages. RPG Maker name checks are unit-tested on event data only.
- **Harlowe 3:** its source was not available, so support works from passage text (the documented syntax).
- **Copy on iPhone:** Safari may ask for permission, or block clipboard access. SaveForge then tells you to select the text.
- **Answers built at run time:** answers computed from other values (`answer === secret`, where secret is set elsewhere) are not literal, and show as *Answer not found*.

**Games sharing one game host (2.3.2, Chromium only):**
- **mopoga.com itself** could not be opened from the test environment. The tests rebuild its layout (a portal page, games from one shared origin in frames).
- **Saves made before SaveForge saw the game write them** have no proof of ownership. They show as NOT CONFIRMED (or PROBABLY on a site with one known game) until the game saves while SaveForge is open, or you confirm them.
- **A game switch inside one page** is recognised from the page content (scripts, story, objects). A host that switches games without any of these changing is not noticed: use *Rescan game*.

**Ren'Py (2.3.1, tested in Chromium with a Ren'Py-shaped page only):**
- **A real Ren'Py web game was not run here.** Running a downloaded game build was not permitted in this test environment. The real build's files were read and analysed, and the fixture copies its JavaScript surface.
- **Whether iOS's memory limit is now respected on your games:** the measured cause is fixed, but iOS may have other limits.
- **Ren'Py 7 web builds (Python 2):** the script is written for Python 2 but was tested with Python 3 only.
- **Which Ren'Py versions have `renpy_exec`:** it is in current Ren'Py 8 web builds. SaveForge detects it rather than assuming.
- **Screens that show a value only on the next interaction:** Ren'Py redraws screens after a change, but text already shown in dialogue does not change.

**2.3 targeting and duplicates (tested in Chromium only):**
- **Your games and portals.** The tests use made-up twin games, a portal, and frames with swapped games. Real portals may load games in ways the tests do not cover (for example, replacing the game without changing the address: tap *Rescan game* then).
- **Safari's back-forward cache.** The tests simulate Safari's page-restore event; real restoration was not observed on an iPhone.
- **Userscripts copies in separate worlds** were simulated with Chromium isolated worlds. Whether the Userscripts app also runs a copy in frames where you did not allow it is up to the app.
- **Which game owns an older save** on a shared website, from before SaveForge saw the game write it. Check Diagnostics → *Game context* the first time on such a site.

- Whether tukann's game (or any real game) exposes a redraw function SaveForge can find. Many games keep their render functions private. In that case the screen status says "not refreshed yet" and the display-only and manual fallbacks remain. The Update game display screen shows exactly what was found.


**Userscripts on iOS:**
- Whether Userscripts on *your* iOS version runs the script in the page context on every site. Diagnostics → *Script context* tells you. "isolated" means edits cannot reach the game.
- Whether Userscripts injects into cross-origin game frames on the sites you use. This depends on the extension's per-site permissions.
- Whether the Userscripts popup offers the 2.3.6 update automatically (its update check is known to be imperfect).

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
