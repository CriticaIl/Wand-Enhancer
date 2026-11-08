// Opens the trainer on a game page. Used by:
//   - standalone/trainer.js (bookmarklet; runs on the game's own page)
//   - the SaveForge app, for games loaded same-origin in its Game tab

import { detectLiveEngines, liveLimitations } from './engines.js';
import { LiveProvider, StorageProvider } from './providers.js';
import { createStore } from './store.js';
import { mountTrainer } from './ui.js';

export function openTrainer(win, extra = {}) {
  if (win.__saveforgeTrainer) {
    win.__saveforgeTrainer.show();
    return win.__saveforgeTrainer;
  }
  const origin = (() => {
    try {
      return win.location.origin;
    } catch {
      return 'page';
    }
  })();
  const engines = detectLiveEngines(win);
  const sources = engines.map((e) => ({
    id: e.id,
    label: e.name,
    channel: e.channel,
    create: () => new LiveProvider(win, e, createStore(win, `${origin}|${e.id}`)),
  }));
  sources.push({
    id: 'storage',
    label: 'Saves in storage',
    channel: 'reload',
    create: () => StorageProvider.create(win, createStore(win, `${origin}|storage`)),
  });
  const ctl = mountTrainer(win, {
    sources,
    limitations: liveLimitations(win),
    store: createStore(win, `${origin}|ui`),
    onClose: () => {
      delete win.__saveforgeTrainer;
    },
    ...extra,
  });
  win.__saveforgeTrainer = ctl;
  return ctl;
}
