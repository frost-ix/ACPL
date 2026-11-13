// Custom Title Bar (window decorations are off, see tauri.conf.json)
//
// Dragging / double-click-to-maximize come from the `data-tauri-drag-region` attributes in
// index.html; this module wires the three window buttons, mirrors the maximized / focused
// state onto <body>, and keeps a lone Alt key press inside the page.

import { t } from './i18n.js';

const currentWindow = () => {
  const api = window.__TAURI__ && window.__TAURI__.window;
  return api && api.getCurrentWindow ? api.getCurrentWindow() : null;
};

const BUTTONS = {
  'wc-minimize': { title: 'windowMinimize', run: (w) => w.minimize() },
  'wc-maximize': { title: 'windowMaximize', run: (w) => w.toggleMaximize() },
  // Goes through CloseRequested -> the existing "save and quit?" dialog
  'wc-close': { title: 'windowClose', run: (w) => w.close() },
};

const setBodyFlag = (cls, on) => document.body.classList.toggle(cls, !!on);

async function syncMaximized(win) {
  try {
    setBodyFlag('window-maximized', await win.isMaximized());
  } catch (e) {
    // permission missing / window gone: keep the last state
  }
}

// A lone Alt (or F10) press would put the window into Windows' menu mode and take the
// keyboard focus away from the page. Marking it handled keeps it in the webview; the backend
// additionally drops the menu command (alt_menu_guard in lib.rs). Alt+<key> still works.
function guardMenuKeys() {
  const isMenuKey = (e) => e.key === 'Alt' || (e.key === 'F10' && !e.shiftKey && !e.ctrlKey);
  ['keydown', 'keyup'].forEach((type) => {
    window.addEventListener(type, (e) => { if (isMenuKey(e)) e.preventDefault(); }, true);
  });
}

// Left side: extract / report work on the current session, so they wait for a running one
const SESSION_ACTIONS = ['btn-extract-chat', 'btn-export-report'];

export function setSessionActionsEnabled(enabled) {
  SESSION_ACTIONS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

export function setTitlebarText(text) {
  const el = document.getElementById('titlebar-text');
  if (el) el.textContent = text ? `ACPL — ${text}` : 'ACPL';
}

export function refreshTitlebarTexts() {
  Object.entries(BUTTONS).forEach(([id, { title }]) => {
    const el = document.getElementById(id);
    if (el) el.title = t(title);
  });
}

export function setupTitlebar() {
  guardMenuKeys();
  refreshTitlebarTexts();
  const win = currentWindow();
  if (!win) return; // plain browser (no Tauri): buttons stay inert

  Object.entries(BUTTONS).forEach(([id, { run }]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('mousedown', (e) => e.stopPropagation()); // not a drag start
    el.addEventListener('click', () => { run(win).catch((e) => console.error(`[titlebar] ${id} failed:`, e)); });
  });

  syncMaximized(win);
  win.onResized(() => syncMaximized(win));
  win.onFocusChanged(({ payload: focused }) => setBodyFlag('window-unfocused', !focused));
}
