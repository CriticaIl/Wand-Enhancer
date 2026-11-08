// Fallback for Safari versions without scripting world:'MAIN'.
// Runs in the isolated content-script world and adds the trainer as a page
// <script>, so it executes in the main world next to the game's globals.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const s = document.createElement('script');
  s.src = api.runtime.getURL('trainer.js');
  s.onload = () => s.remove();
  s.onerror = () => {
    s.remove();
    alert('SaveForge could not start on this page (it blocks extension scripts).');
  };
  (document.head || document.documentElement).appendChild(s);
})();
