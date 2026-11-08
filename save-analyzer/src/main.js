import { start } from './ui/app.js';

start(document.getElementById('app'));

// Offline support when hosted over HTTPS next to standalone/sw.js (e.g. GitHub Pages).
if ('serviceWorker' in navigator && location.protocol === 'https:' && document.documentElement.dataset.standalone === '1') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
