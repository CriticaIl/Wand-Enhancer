# SaveForge Trainer on iPhone: no Mac, no Xcode

> **New in 1.4:** edits are verified in the game (✓ / ≈ / ↺ / ✕ marks), with Lock, Find a value, English labels and translations, a three-finger tap to open, an always-visible variant and better late-game detection. Quick guide: [TESTING-ON-IPHONE.md](TESTING-ON-IPHONE.md).

This puts the full GTA-style SaveForge Trainer on your iPhone through a free userscript manager for Safari. You get the draggable menu, live editing, Apply & Reload, backups and the ⓘ explanations, all from the same code as the SaveForge web app.

**Script address:** https://criticail.github.io/Wand-Enhancer/save-analyzer/standalone/saveforge-trainer.user.js

## Which Safari extension?

| Manager | Price | Works with SaveForge? | Notes |
| --- | --- | --- | --- |
| **[Userscripts](https://apps.apple.com/app/userscripts/id1463298887)** | Free, [open source](https://github.com/quoid/userscripts) | **Recommended. This guide uses it.** | iOS 15.1+. Installs from a `.user.js` link, runs scripts inside game frames, and checks for updates. |
| Stay | See App Store | Should work (standard userscript format) | Not tested by SaveForge. |
| Tampermonkey (Safari) | See App Store | Should work (standard userscript format) | Not tested by SaveForge. |

The script deliberately uses only standard userscript features:

- `@inject-into page`, so it can reach game engines.
- `@grant none`.
- No menu commands, which aren't reliably supported on iOS.

So it doesn't depend on anything one particular manager offers.

## Install (once, about 3 minutes)

1. **Get the app.** Install **Userscripts** from the App Store and open it once. Recent versions create their scripts folder automatically. If it asks, tap *Set Userscripts Directory* and pick a folder in the Files app.
2. **Turn on the Safari extension.** Open **Settings → Apps → Safari → Extensions → Userscripts** (iOS 15–17: Settings → Safari → Extensions) and switch it **on**. Then choose website access:
   - **All Websites → Allow** (simplest). The launcher appears by itself on game pages; on every other site the script does nothing visible.
   - **Ask** (most private). Nothing runs until you allow Userscripts on a site. Once per game site, tap **AA** (or the puzzle-piece icon) → *Userscripts* → allow.
3. **Install SaveForge Trainer.**
   1. In Safari, open the script address above.
   2. Tap **AA** (or the puzzle-piece icon) in the address bar, then **Userscripts**.
   3. The popup says it found a userscript. Tap **Install** and confirm.

## Use it

- **On a game page:** a small translucent **⬢** button appears in the bottom-right corner within a few seconds. Tap it and the trainer opens over the game.
  - **In the trainer:** pick a section (Player, Money, Inventory, World, Story, Unlocks, Advanced), or use 🔍 search and ★ favourites.
  - **Changing values:** use **‹ ›** to step a value, tap the value to type it, or tap ON/OFF.
  - **ⓘ on every row:** explains what the variable likely controls, what changing it might do, the current and original value, whether the change is live or needs a reload, the risk to progression, and how confident SaveForge is.
  - **Keep playing:** tap **–** to shrink the trainer to its floating icon. Drag the green banner to move the trainer, or collapse it to the header.
- **On any page:** add **`#saveforge`** to the end of the address and press Go. The trainer opens even where no game was detected (useful for text games or saves in storage).
- **The edit badges:**
  - **LIVE:** the game changes immediately. Save in-game to keep it.
  - **LIVE\*:** written into the page's game data; whether the game uses it depends on the game.
  - **APPLY & RELOAD:** for saves in browser storage (Ren'Py web, Construct 3, GameMaker, Harlowe, any game that saves to storage). Tap the yellow **Apply & Reload** button.
    - **Before it writes:** SaveForge checks that the game hasn't saved in the meantime, verifies the data and stores a backup.
    - **It then reloads the page.** Unsaved in-game progress is lost on reload, so save in-game first.
- **Undo / redo** are in the toolbar. **Main menu → Backups & restore** puts original values back (live) or restores a storage snapshot.

### SugarCube (Twine) games

- **`$player.money` and the other story variables** are LIVE when SaveForge can reach SugarCube's `State`: directly, or through its page bridge if the userscript runs isolated. Search accepts exact paths: `player.money`, `$player.money` or `State.variables.player.money`.
- **Diagnostics → SugarCube** shows whether the live State is reachable and, if not, why. **Look up** checks one exact path.
- **No public SugarCube API?** Use **Edit SugarCube save**. A page reload does *not* load a SugarCube save: the game resumes its running session, which is why Apply & Reload reverted money. Instead:
  1. Edit the value.
  2. SaveForge backs up and writes a copy into an empty slot.
  3. Open the game's **Saves** menu and **Load** that slot.
  4. SaveForge shows ✓ when the game has loaded it.
- **From the online Save Editor:**
  1. In the editor: Export → **Copy share code**.
  2. In the trainer: **Import from Save Editor** → paste → confirm.
  3. The values show as SAVE · IMPORTED. Edit them, then download them, copy them back, or add them to the game's matching save.

### Save variables (same as the online Save Editor)

When the game keeps saves in the browser, the trainer reads them with the same detection as the SaveForge Save Editor. It lists them next to the live values, tagged:
- **LIVE:** changes the running game now
- **SAVE:** the game's save
- **LIVE+SAVE:** both, linked; listed once

Editing a SAVE value is pending until you tap **Write saves** at the bottom:
- **Write saves:** kept for the next load, no reload
- **Apply & Reload:** the game reloads with it
- **Export edited saves:** a file for the Save Editor

Values are linked as LIVE+SAVE only by the engine's save layout (RPG Maker, SugarCube) or after SaveForge sees the save follow a live change. To link one yourself: change it in the trainer, then save in-game. **Sync save variables** re-reads the saves, and they also sync by themselves while the trainer is open.

### Button & Textbox Linker (advanced)

Main menu → **Button & Textbox Linker**:
1. Tap **Inspect element**, then tap a game button, link, textbox, dropdown or checkbox. The game does not receive that tap.
2. Read what it is connected to:
   - **confirmed** (its own handlers)
   - **likely** (read from its code)
   - **possible** (parents that may handle it, variables with the same value)
3. **Show on screen** briefly hides the trainer and outlines the element.
4. **Watch one tap** / **Detect by typing:** use the element once for real, and SaveForge shows which variables changed.
5. **Link to another action…** → pick one → check the **preview** → **Apply mapping**.
6. **Undo last change**, **Restore original**, or switch **Mappings enabled** off to disable all.

Works on standard HTML elements, jQuery and SugarCube games. Canvas games (Phaser, RPG Maker, Unity…) draw their buttons as pixels and cannot be remapped. Details: [TRAINER.md](TRAINER.md#button--textbox-linker).

## Turning it on and off

| You want… | Do this |
| --- | --- |
| Hide the button on this site | Long-press **⬢** → *Hide on this site*, or add `#saveforge-off` to the address |
| Always show it on this site (even if no game is detected) | Long-press **⬢** → *Always show on this site*, or add `#saveforge-on` |
| Back to automatic | Long-press **⬢** → *Automatic on this site*, or add `#saveforge-auto` |
| Open the trainer right now | Tap **⬢**, or add `#saveforge` |
| Turn SaveForge off everywhere | In the Userscripts popup, switch *SaveForge Trainer* off (or switch the extension off in Settings) |
| Run it only on certain sites | In the Userscripts app, edit the script's `@match` line, e.g. `// @match *://*.itch.zone/*` |

## Avoiding interference with normal websites

- **Ordinary sites are untouched.** The script adds nothing to the page, stores nothing and loads nothing from the network. An automated test checks this: same page HTML, no new storage, no databases, no errors.
- **When the launcher appears:** only if the page looks like a game. That means a supported engine (RPG Maker, SugarCube, Construct 2, Ren'Py web, Construct 3, Harlowe, GameMaker), a large game canvas, a well-known game-state variable such as `window.game`, or Ren'Py web saves.
- **Isolated launcher and trainer:** both live in their own Shadow DOM, so they can't restyle the page. Taps on them don't reach the game.
- **Your settings:** per-site choices and backups are kept in a separate `saveforge-trainer` database, never in the game's own save data.
- **Games inside frames:** on sites like itch.io the script also runs inside the game frame, so the launcher appears on the game itself, not on the surrounding page.

## Updates

The script has `@version` and `@updateURL` pointing at GitHub Pages. The Userscripts popup periodically checks for newer versions and offers to update. To update by hand at any time, open the script address again and tap **Install**.

**For maintainers:**

- The userscript is built from the shared source (`src/userscript/` + `src/trainer/` + `src/core/`) by `npm run build`.
- When releasing a change, bump `"version"` in `package.json`. The build writes it into `@version` and into `saveforge-trainer.meta.js`, which is what managers poll. A test fails if they disagree.

## What it can't do (Safari limits)

- **Editing a game's memory live** only works where the engine publishes its state to the page (RPG Maker MV/MZ, SugarCube 2, Construct 2, games with global variables).
  - **Ren'Py web:** runs Python inside WebAssembly. SaveForge never reads that memory. Recent Ren'Py builds let SaveForge read and change store variables through Ren'Py itself (2.3.1); older ones offer the saves instead.
  - **Construct 3:** usually runs in a worker.
  - **Harlowe:** keeps its state private.
  - **What still works for these:** edit their saves through **Apply & Reload**.
- **Not editable at all:**
  - **Encrypted or server-stored progress.** There is nothing in the page to edit.
  - **Native apps and App Store games.** Userscripts only run inside Safari.
- **Strict security settings:** if a site blocks injected scripts with a strict Content-Security-Policy, the manager may not be able to run the script there. The Userscripts FAQ suggests changing the script's `@inject-into` to `auto` in that case, but then live engine access may not work.

## Game portals (games inside frames)

On many portals (game catalogue sites), the page you see is the *portal*. The game itself runs in an **iframe**, usually from another site and sometimes nested inside a second "wrapper" frame. Each of those frames has its own variables, and Safari lets a page read only its own.

- **Which frame gets the trainer:** the userscript runs in every frame. The top page decides, so there is always **one** ⬢ launcher (in the game frame) and **one** panel, never one per frame (2.3). Typing `#saveforge` on the portal page sends the trainer into the frame showing a game **now**. If a portal swapped its game, the new one opens. If the page holds several games, a chooser asks which.
- **Switching games:** when the page switches to another game, the trainer moves to it by itself. Favorites, marks and links are kept per game, and other games' saves on the same site are never shown or written.
- **Website globals are never shown as game variables:** analytics, ads, cookie consent, portal SDKs and page data (such as a `window.game = {title, plays, rating…}` description of the game) are filtered out.
  - **How it is judged (1.6):** every variable is scored on its own: its type, its name (translated), the object around it, whether it changes while you play, whether its value is on screen, and whether your edits worked. Game data inside a generic object (`app.data.money` next to `app.config.url`) is found; the URL is not.
  - **Not sure?** Uncertain finds appear under **Potential game variables**. ⓘ → *Detection* explains the score. Tap *This is a game variable* or *Not a game variable* and SaveForge remembers it for that website.
  - **Seeing the decisions:** Main menu → **Diagnostics** shows:
    - the confirmed / potential / excluded counts
    - why nothing was found (inaccessible vs. not detected)
    - every excluded variable with its reason and a *Mark as game* button
    - *Copy detection report*, for bug reports
- **If the trainer opens on the portal with "No game variables found here":** open **Diagnostics**. It shows the game frame's site and whether SaveForge is running there.
  - **Not running there:** allow Userscripts on that site too. Simplest: Settings → Apps → Safari → Extensions → Userscripts → *All Websites: Allow*. Alternatively, tap **Open game frame directly** to load the game on its own. Be aware that a game opened outside the portal may use separate saves from the embedded copy, because Safari keeps embedded sites' storage apart.
- **ⓘ shows where a value comes from:** every row's ⓘ panel names its source (engine, global, scene or storage key) and the frame it lives in.

## Troubleshooting

- **No ⬢ button on a game:**
  - The game may load slowly. Wait about 6 seconds, or add `#saveforge` to the address.
  - Check that Userscripts is allowed on that site (AA → Userscripts).
- **The popup doesn't offer Install:** the address must end in `.user.js`. Open the exact link above, not a GitHub page about it.
- **The trainer opens but says no data was found:**
  - Open **Diagnostics**. The game may be in a frame (see above).
  - Otherwise the game keeps its state somewhere Safari won't let pages reach: inside closures, in WebAssembly (Unity, Godot, Ren'Py web), or on a server. Try the *Saves in storage* source after saving in-game.
- **A number on screen can't be found:** open **Diagnostics → Run full scan → Look up a value**, and type the number as shown (`28,480,799` is fine). It tells you whether the value is:
  - **listed**
  - **excluded** (tap *Mark as game*)
  - **not reached** by the normal scan (it's in **All variables (raw)**)
  - **not reachable at all** (and why)

  In Search, *Search all accessible variables* repeats your search over everything reachable.
- **A game value is missing:** open **Diagnostics → Why was this excluded?**, find it and tap *Mark as game* (remembered for that site). Or play for a few seconds: values that change are promoted automatically. *Include website globals (advanced)* is still there, but should not be needed.
