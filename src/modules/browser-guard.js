// Browser behaviour that makes no sense in an app window.
//
// The backend already switches off WebView2's browser shortcuts (disable_browser_shortcuts in
// lib.rs). This is the page-side fallback for older WebView2 runtimes, plus the browser's own
// right-click menu (Back / Refresh / Print / Inspect).

// Pure: is this key event a browser shortcut (reload, print, find, zoom, devtools, history)?
export function isBrowserShortcut(e) {
  const key = (e.key || '').toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  if (['f5', 'f3', 'f7', 'f12', 'browserback', 'browserforward', 'browserrefresh', 'browsersearch'].includes(key)) return true;
  if (e.altKey && !ctrl && (key === 'arrowleft' || key === 'arrowright')) return true; // history
  if (!ctrl || e.altKey) return false;
  if (['r', 'p', 'u', 's', 'o', 'f', 'g', 'h', 'j', '=', '+', '-', '0'].includes(key) && !e.shiftKey) return true;
  if (e.shiftKey && ['r', 'i', 'j', 'c', 'p', 'delete'].includes(key)) return true;
  return false;
}

// The terminal handles (and cancels) its own keys: Ctrl+R there is the shell's history search
const inTerminal = (target) => !!(target && target.closest && target.closest('.xterm'));

const isEditable = (target) => !!(target && target.closest
  && target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));

const hasTextSelection = () => {
  const sel = window.getSelection && window.getSelection();
  return !!(sel && String(sel).trim());
};

export function setupBrowserGuard() {
  window.addEventListener('keydown', (e) => {
    if (!inTerminal(e.target) && isBrowserShortcut(e)) e.preventDefault();
  }, true);
  // Right-click: keep the edit menu (inputs, terminal input, selected text), drop the page menu
  window.addEventListener('contextmenu', (e) => {
    if (!isEditable(e.target) && !hasTextSelection()) e.preventDefault();
  }, true);
  // Mouse back / forward buttons
  window.addEventListener('mouseup', (e) => {
    if (e.button === 3 || e.button === 4) e.preventDefault();
  }, true);
}
