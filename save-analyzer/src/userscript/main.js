// Bundle entry for standalone/saveforge-trainer.user.js
import { startUserscript } from './entry.js';

(function boot() {
  // only real web pages (not about:blank, data:, or other opaque documents)
  if (!/^https?:$/.test(location.protocol)) return;
  const run = () => {
    try {
      startUserscript(window);
    } catch (e) {
      console.debug('SaveForge userscript did not start:', e);
    }
  };
  // managers inject at different times; wait for the DOM if needed
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();
