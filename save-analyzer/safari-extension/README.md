# SaveForge Trainer: Safari Web Extension for iPhone

This folder packages the existing SaveForge trainer as an iOS Safari Web Extension. When you tap **SaveForge Trainer** in Safari's page menu, the extension injects the same `trainer.js` the web app and bookmarklet use into the current page. That one bundle includes the analyzer, the live engine integrations, Apply & Reload and the ⓘ explanation engine.

```
extension/                     the web extension (Manifest V3)
  manifest.json                permissions: activeTab + scripting only
  background.js                toolbar tap → inject trainer.js into the page
  inject-fallback.js           fallback for Safari versions without world:'MAIN'
  trainer.js                   the SaveForge trainer bundle (copied by `npm run build`)
  images/, _locales/
ios/
  SaveForge.xcodeproj          iOS app + Safari extension targets, ready to open in Xcode
  SaveForge/                   small SwiftUI container app (setup instructions)
  SaveForge Extension/         SafariWebExtensionHandler.swift + Info.plist
  project.yml                  optional XcodeGen spec to regenerate the project
tools/                         icon and Xcode project generators
```

## Privacy: website access only when you tap it

- The extension has **no host permissions and no content scripts**. Until you tap it, it can't see or change any website.
- When you tap it, `activeTab` gives temporary access to that one tab. Safari may also ask whether to allow access to the site; choose **Allow for One Day** or **Always Allow on This Website**.
- The trainer runs in the page's main JavaScript context. It needs to, because live editing reads the engine's own globals (`$gameParty`, `SugarCube.State`, …). Nothing is uploaded anywhere.
- A test (`test/safari-extension.test.mjs`) checks this: with the real manifest, launching without a tap fails and the page is untouched.

## What you need

| | Requirement |
| --- | --- |
| Computer | **A Mac** with Xcode 15 or newer (free from the Mac App Store; needs macOS 13.5+). Apple only allows iOS apps and extensions to be built and signed in Xcode on macOS. |
| Apple account | **A free Apple Account is enough** to install on your own iPhone. Apps signed this way stop opening after **7 days**; reconnect and press Run again to renew. At most 3 such apps per device. |
| Optional | A paid **Apple Developer Program** membership ($99/year) gives 1-year signing and TestFlight. You don't need it for personal use. |
| iPhone | iOS 15.4 or later (iOS 17+ recommended), a USB cable (or Wi‑Fi pairing), and **Developer Mode** turned on (iOS 16+: Settings → Privacy & Security → Developer Mode). |

## Install on your iPhone (Mac + Xcode)

1. **Get the code on your Mac:**
   ```sh
   git clone https://github.com/CriticaIl/Wand-Enhancer.git
   cd Wand-Enhancer && git checkout claude/html5-game-save-analyzer-ogbcnf
   open save-analyzer/safari-extension/ios/SaveForge.xcodeproj
   ```
   You don't need to build `trainer.js` yourself; it's committed. Only run `cd save-analyzer && npm install && npm run build` if you change the trainer source.
2. **Set a unique bundle ID:** click the blue **SaveForge** project → *Build Settings* → search `SAVEFORGE_BUNDLE_PREFIX` → change `com.example` to something unique, such as `com.yourname`. Both targets use this value.
3. **Signing:** select the **SaveForge** target → *Signing & Capabilities* → tick *Automatically manage signing* → *Team*: pick your Apple Account (add it with *Add an Account…* if needed). Repeat for the **SaveForge Extension** target.
4. **Run:** connect the iPhone, choose it as the run destination at the top of the window, and press **Run (⌘R)**.
   - With a free account, the first launch is blocked until you trust the developer: on the iPhone, go to Settings → General → *VPN & Device Management* → your Apple Account → **Trust**.
5. **Enable the extension:**
   - Open Settings → **Apps → Safari → Extensions** (on iOS 15–17: Settings → Safari → Extensions) → **SaveForge Trainer** → turn it on.
   - Leave *All Websites* on **Ask**.
6. **Use it:**
   - Open a game in Safari, tap the page-menu button in the address bar (**AA**, or the puzzle-piece icon on newer iOS), then tap **SaveForge Trainer**.
   - Allow access for that site when asked. The floating trainer opens over the game.
   - Tap **–** to minimise it to the floating icon and keep playing; drag the banner to move it.

### Test it on the demo games
Open https://criticail.github.io/Wand-Enhancer/save-analyzer/demo-games/ in Safari and launch the extension on each game:

| Demo game | What to check |
| --- | --- |
| **Crystal Quest** (RPG Maker-style) | Money → Gold → change it; the HUD updates immediately (**LIVE**). |
| **Lantern Tale** (SugarCube-style) | Change `$gold`, then Main menu → *Refresh passage*. |
| **Tap Miner** (Construct 2-style) | Set *Auto Drill* to 1; the ore count starts climbing. |
| **Neon Courier** (plain HTML5) | Credits and health change on the canvas (**LIVE\***). |
| **Ruins (web)** (Ren'Py web storage) | Choose *Saves in storage* → edit `money` → **Apply & Reload**. |

Tap **ⓘ** on any row to see its explanation.

### If Xcode has trouble with the committed project
I generated and checked this project on Linux; I couldn't compile it there. If it doesn't open or build cleanly, either:

- regenerate it with XcodeGen: `brew install xcodegen && cd save-analyzer/safari-extension/ios && xcodegen`, or
- let Apple's converter build a fresh project from the extension folder:
  ```sh
  xcrun safari-web-extension-converter save-analyzer/safari-extension/extension \
      --ios-only --app-name "SaveForge" --bundle-identifier com.yourname.SaveForge
  ```
  Then continue from step 3.

## No Mac? iPhone-only alternatives

All of these reuse the same trainer. Pick one.

### A. Userscripts app (free, recommended without a Mac)
See **[USERSCRIPT.md](../USERSCRIPT.md)** for step-by-step instructions. In short:

1. Install [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) and enable it under Safari → Extensions.
2. Open `https://criticail.github.io/Wand-Enhancer/save-analyzer/standalone/saveforge-trainer.user.js` in Safari → **AA** → *Userscripts* → **Install**.
3. A small ⬢ launcher appears on game pages, or add `#saveforge` to any address. Updates arrive automatically.

### B. Shortcuts app (built in)
1. Open **Shortcuts** → **+** → add the action **Run JavaScript on Web Page**.
2. Replace its code with:
   ```js
   (function () {
     if (window.__saveforgeTrainer) { window.__saveforgeTrainer.show(); completion(true); return; }
     var s = document.createElement('script');
     s.src = 'https://criticail.github.io/Wand-Enhancer/save-analyzer/standalone/trainer.js?v=' + Date.now();
     s.onerror = function () { alert('SaveForge could not load (offline, or blocked by this page).'); };
     document.documentElement.appendChild(s);
     completion(true);
   })();
   ```
3. Tap the shortcut's settings (ⓘ) → turn on **Show in Share Sheet** and set it to accept **Safari web pages**. Name it *SaveForge Trainer*.
4. On a game page: **Share → SaveForge Trainer**. The first time, allow the shortcut to run on that website.

This needs a connection, because it loads `trainer.js` from GitHub Pages. Pages with a strict Content-Security-Policy can block it.

### C. Bookmarklet (if you want to retry it)
Common reasons it doesn't work:

- **How it's opened:** Safari won't run `javascript:` code typed or pasted into the address bar. It has to be opened from **Bookmarks/Favorites**. Typing the bookmark's name in the address bar and choosing it from the suggestions also works.
- **Incomplete paste:** when editing the bookmark's address, the whole code must be pasted. Use the short **loader** version ("Copy trainer bookmarklet"). The ~150 KB offline version is often too long for iOS to keep.
- **The page blocks it:** some pages block external scripts (CSP). Use the extension or the Userscripts option instead.

### D. Same-site games
For games you can host next to SaveForge, the app's **Game** tab has **Open trainer over game**, which needs no extension at all.

## What still applies everywhere

- **LIVE** edits change the running game immediately, for RPG Maker MV/MZ, SugarCube 2, Construct 2 and globals found generically (**LIVE\***). They are kept only when you save in-game.
- **Apply & Reload** writes saved edits to browser storage, then reloads the page. This is the route for Ren'Py web and for saves in localStorage/IndexedDB. SaveForge checks first that the game hasn't saved in the meantime, and keeps a snapshot backup.
- Ren'Py web, Construct 3, Harlowe and GameMaker can't be edited live; the trainer explains why under *Limits*.
