// SaveForge Trainer — Safari Web Extension background script.
//
// The extension has NO standing website access. It uses "activeTab": only when
// you tap the SaveForge button does Safari grant temporary access to the tab
// you are looking at. Then the existing SaveForge trainer (trainer.js, the same
// bundle the bookmarklet loads) is injected into that page.
//
// The trainer must run in the page's MAIN world, because live editing reads the
// engine's own globals ($gameParty, SugarCube.State, cr_getC2Runtime…), which
// an isolated content script cannot see.

const api = globalThis.browser ?? globalThis.chrome;

/** Returns 'main' | 'fallback' | 'unsupported-page' | 'failed'. */
async function launchTrainer(tab) {
  if (!tab || typeof tab.id !== 'number') return 'failed';
  const url = tab.url || '';
  if (url && !/^(https?|file):/i.test(url)) {
    await flag(tab.id, 'Open a web page with a game first.');
    return 'unsupported-page';
  }
  try {
    // 1) Preferred: run the trainer directly in the page's main world.
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['trainer.js'], world: 'MAIN' });
    await clearFlag(tab.id);
    return 'main';
  } catch (mainError) {
    try {
      // 2) Older Safari without world:'MAIN': a tiny content script adds a
      //    <script src="…/trainer.js"> tag, which also runs in the main world.
      await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['inject-fallback.js'] });
      await clearFlag(tab.id);
      return 'fallback';
    } catch (fallbackError) {
      console.warn('SaveForge: could not open the trainer on this page', mainError, fallbackError);
      await flag(tab.id, 'SaveForge cannot run on this page (Safari blocked access).');
      return 'failed';
    }
  }
}

async function flag(tabId, title) {
  try {
    await api.action.setBadgeText({ tabId, text: '!' });
    await api.action.setTitle({ tabId, title });
  } catch {
    /* badges are cosmetic */
  }
}

async function clearFlag(tabId) {
  try {
    await api.action.setBadgeText({ tabId, text: '' });
  } catch {
    /* ignore */
  }
}

api.action.onClicked.addListener((tab) => {
  launchTrainer(tab);
});

// exposed for automated tests
globalThis.saveforgeLaunchTrainer = launchTrainer;
