// Tiny DOM helpers + inline icon set (no external assets, works offline).

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Like Element.append, but skips null/false and flattens arrays. */
export function add(el, ...children) {
  append(el, children);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

const PATHS = {
  logo: 'M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2zm0 4.2L7.6 8.7v6.6l4.4 2.5 4.4-2.5V8.7L12 6.2z',
  upload: 'M12 3l5 5h-3v6h-4V8H7l5-5zM5 17h14v3H5z',
  menu: 'M4 6h16v2.5H4zM4 11h16v2.5H4zM4 16h10v2.5H4z',
  tree: 'M4 4h6v5H4zM14 9h6v5h-6zM14 16h6v4h-6zM7 9v9h7v-2H9v-5h5V9z',
  diff: 'M7 3h2v4h4v2H9v4H7V9H3V7h4zM11 17h10v2H11zM3 21l8-18h2L5 21z',
  game: 'M7 8h10a5 5 0 015 5v1a4 4 0 01-7 2.6L13.5 15h-3L9 16.6A4 4 0 012 14v-1a5 5 0 015-5zm0 3v1.5H5.5V14H7v1.5h1.5V14H10v-1.5H8.5V11zm8.5 0a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4zm2.5 2.5a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z',
  info: 'M12 2a10 10 0 110 20 10 10 0 010-20zm-1 8v7h2v-7zm0-4v2h2V6z',
  undo: 'M8 7V3L2 9l6 6v-4h6a4 4 0 010 8h-2v3h2a7 7 0 000-14z',
  redo: 'M16 7V3l6 6-6 6v-4h-6a4 4 0 000 8h2v3h-2a7 7 0 010-14z',
  reset: 'M12 4a8 8 0 107.4 11h-3.3A5 5 0 1112 7c1.4 0 2.6.6 3.5 1.5L13 11h7V4l-2.4 2.4A8 8 0 0012 4z',
  download: 'M11 3h2v9l3.5-3.5 1.4 1.4L12 15.8 6.1 9.9l1.4-1.4L11 12zM4 18h16v3H4z',
  chev: 'M9 6l6 6-6 6-1.4-1.4L12.2 12 7.6 7.4z',
  search: 'M10 3a7 7 0 015.6 11.2l5 5-1.4 1.4-5-5A7 7 0 1110 3zm0 2a5 5 0 100 10 5 5 0 000-10z',
  close: 'M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z',
  lock: 'M7 10V8a5 5 0 0110 0v2h1v11H6V10zm2 0h6V8a3 3 0 00-6 0z',
  check: 'M9.5 16.2l-4.2-4.2-1.4 1.4 5.6 5.6L21 7.4 19.6 6z',
  share: 'M12 2l4 4-1.4 1.4L13 5.8V15h-2V5.8L9.4 7.4 8 6zM5 10h3v2H7v8h10v-8h-1v-2h3v12H5z',
  shield: 'M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z',
  coin: 'M12 3c5 0 9 2 9 4.5v9C21 19 17 21 12 21s-9-2-9-4.5v-9C3 5 7 3 12 3zm0 2C8 5 5 6.4 5 7.5S8 10 12 10s7-1.4 7-2.5S16 5 12 5z',
  cube: 'M12 2l9 5v10l-9 5-9-5V7zm0 2.3L5.3 8 12 11.7 18.7 8zM5 9.7v6.1l6 3.4v-6.1zm14 0l-6 3.4v6.1l6-3.4z',
  heart: 'M12 21l-1.5-1.3C5 15 2 12.2 2 8.6 2 5.6 4.4 3.3 7.3 3.3c1.7 0 3.4.8 4.7 2.1 1.3-1.3 3-2.1 4.7-2.1 2.9 0 5.3 2.3 5.3 5.3 0 3.6-3 6.4-8.5 11.1z',
  star: 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z',
  bag: 'M8 7a4 4 0 018 0h4l-1.5 14h-13L4 7zm2 0h4a2 2 0 00-4 0z',
  people: 'M9 11a4 4 0 110-8 4 4 0 010 8zm7 0a3 3 0 110-6 3 3 0 010 6zM2 20c0-3.3 3.1-6 7-6s7 2.7 7 6zm15.5 0c0-1.9-.7-3.6-2-4.9 3.5.1 6.5 2.1 6.5 4.9z',
  flag: 'M5 3h2v18H5zM8 4h11l-2.5 4.5L19 13H8z',
  key: 'M14 3a7 7 0 11-6.3 10H6v2H4v2H2v-4l7.7-7.7A7 7 0 0114 3zm2 3a2 2 0 100 4 2 2 0 000-4z',
  trophy: 'M7 3h10v2h4v3a5 5 0 01-5 5h-.4A5 5 0 0113 15v3h4v3H7v-3h4v-3a5 5 0 01-2.6-2H8a5 5 0 01-5-5V5h4zm-2 4v1a3 3 0 002 2.8V7zm12 0v3.8A3 3 0 0019 8V7z',
  clock: 'M12 2a10 10 0 110 20 10 10 0 010-20zm-1 5v6l5 3 1-1.7-4-2.4V7z',
  hash: 'M9 3h2l-.6 5h4l.6-5h2l-.6 5H20v2h-3.8l-.5 4H19v2h-3.5L15 21h-2l.6-5h-4L9 21H7l.6-5H4v-2h3.8l.5-4H5V8h3.5zm1.1 7l-.5 4h4l.5-4z',
  text: 'M4 4h16v3h-2V6h-5v12h2v2H9v-2h2V6H6v1H4z',
  dots: 'M5 10a2 2 0 110 4 2 2 0 010-4zm7 0a2 2 0 110 4 2 2 0 010-4zm7 0a2 2 0 110 4 2 2 0 010-4z',
  gear: 'M13.4 2l.5 2.6 1.9.8 2.2-1.5 1.9 1.9-1.5 2.2.8 1.9L22 10.6v2.8l-2.6.5-.8 1.9 1.5 2.2-1.9 1.9-2.2-1.5-1.9.8-.5 2.8h-2.8l-.5-2.6-1.9-.8-2.2 1.5-1.9-1.9 1.5-2.2-.8-1.9L2 13.4v-2.8l2.6-.5.8-1.9-1.5-2.2 1.9-1.9 2.2 1.5 1.9-.8L10.6 2zM12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
  paste: 'M9 2h6v2h4v18H5V4h4zm0 4H7v14h10V6h-2v2H9zm2-2v2h2V4z',
  link: 'M10.6 13.4a1 1 0 010-1.4l3-3a1 1 0 011.4 1.4l-3 3a1 1 0 01-1.4 0zM8 17a3 3 0 01-2.1-5.1l2-2 1.4 1.4-2 2A1 1 0 008.7 15l2-2 1.4 1.4-2 2A3 3 0 018 17zm7.7-3.1l-1.4-1.4 2-2A1 1 0 0014.9 9l-2 2-1.4-1.4 2-2a3 3 0 014.2 4.2z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  minus: 'M5 11h14v2H5z',
};

export function icon(name, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'currentColor');
  if (cls) svg.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', PATHS[name] || PATHS.dots);
  svg.append(p);
  return svg;
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function displayValue(type, v) {
  if (v === null || v === undefined) return 'null';
  if (type === 'string') return JSON.stringify(v.length > 200 ? v.slice(0, 200) + '…' : v);
  if (type === 'bytes') return `<${v.length} bytes>`;
  return String(v);
}

/** Makes `el` draggable by `handle` (pointer events; works with touch). */
export function draggable(el, handle, { onEnd, clickThreshold = 6 } = {}) {
  let start = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button:not(.fab), input, select, a')) return;
    const r = el.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < clickThreshold) return;
    start.moved = true;
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    const left = Math.min(Math.max(4, start.left + dx), window.innerWidth - w - 4);
    const top = Math.min(Math.max(4, start.top + dy), window.innerHeight - Math.min(hgt, 60) - 4);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  });
  const end = (e) => {
    if (!start) return;
    const moved = start.moved;
    start = null;
    if (moved) {
      e.preventDefault();
      el.dataset.justDragged = '1';
      setTimeout(() => delete el.dataset.justDragged, 50);
    }
    if (onEnd) onEnd(moved);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
