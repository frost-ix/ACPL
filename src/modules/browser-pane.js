// Browser Panels — native child webviews (lib.rs browser_*) placed over the browser cells of
// the pane grid. panes.js renders the cells; this module keeps the webviews in sync with them.
// A panel cannot be drawn under HTML, so it is hidden while an overlay is open (dialogs,
// Ctrl+K, drag & drop, welcome screen).

import { onOverlayChange } from './dom.js';

let openSlots = Object.freeze([]); // slots whose webview exists
let hiddenFor = Object.freeze([]); // reasons the panels are hidden right now
let urls = Object.freeze({}); // slot -> current URL
const observed = new Map(); // slot -> { el, observer } (runtime handles)
let urlListeners = Object.freeze([]);

const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
};

export const browserUrl = (slot) => urls[slot] || '';
export const onBrowserUrl = (fn) => { urlListeners = Object.freeze([...urlListeners, fn]); };

export function setBrowsersHidden(reason, hidden) {
  const before = hiddenFor.length > 0;
  const others = hiddenFor.filter((r) => r !== reason);
  hiddenFor = Object.freeze(hidden ? [...others, reason] : others);
  const after = hiddenFor.length > 0;
  if (before !== after && openSlots.length) window.api.browserVisible(!after);
}

// Keep a panel glued to its cell while the cell resizes
const placeLater = (slot, el) => requestAnimationFrame(() => {
  if (openSlots.includes(slot) && el.isConnected) window.api.browserBounds(slot, rectOf(el));
});

function observe(slot, el) {
  const current = observed.get(slot);
  if (current && current.el === el) return;
  if (current) current.observer.disconnect();
  const observer = new ResizeObserver(() => placeLater(slot, el));
  observer.observe(el);
  observed.set(slot, { el, observer });
}

function forget(slot) {
  const current = observed.get(slot);
  if (current) current.observer.disconnect();
  observed.delete(slot);
}

/** bodies: [{ slot, el }] — the browser cells currently on screen */
export async function syncBrowsers(bodies) {
  const wanted = bodies.map((b) => b.slot);
  // Closing a panel closes its pages: the next panel of this slot starts on a blank page
  openSlots.filter((s) => !wanted.includes(s)).forEach((slot) => {
    window.api.browserClose(slot);
    forget(slot);
    urls = Object.freeze(Object.fromEntries(Object.entries(urls).filter(([k]) => Number(k) !== slot)));
  });
  openSlots = Object.freeze(openSlots.filter((s) => wanted.includes(s)));

  for (const { slot, el } of bodies) {
    observe(slot, el);
    if (openSlots.includes(slot)) {
      placeLater(slot, el);
      continue;
    }
    const port = await window.api.browserOpen({ slot, url: urls[slot] || 'about:blank', rect: rectOf(el) });
    if (!port) continue;
    // a render during the await may have opened it already (the backend just re-placed it)
    if (!openSlots.includes(slot)) openSlots = Object.freeze([...openSlots, slot]);
    if (hiddenFor.length) window.api.browserVisible(false);
  }
}

// Window size changes move every cell
export function replaceAllBrowsers() {
  observed.forEach(({ el }, slot) => placeLater(slot, el));
}

// Pure: what the address bar text means -> URL
export function toUrl(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'about:blank';
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  if (/^[^\s]+\.[^\s]+$/.test(raw) || /^localhost(:\d+)?(\/|$)/.test(raw)) return `https://${raw}`.replace(/^https:\/\/localhost/, 'http://localhost');
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
}

export const navigateBrowser = (slot, text) => window.api.browserNavigate(slot, toUrl(text));
export const browserHistory = (slot, action) => window.api.browserHistory(slot, action);

export function setupBrowserPanels() {
  onOverlayChange((reason, open) => setBrowsersHidden(reason, open));
  window.addEventListener('resize', replaceAllBrowsers);
  window.api.onBrowserNavigated(({ slot, url }) => {
    urls = Object.freeze({ ...urls, [slot]: url });
    urlListeners.forEach((fn) => fn(slot, url));
  });
}
