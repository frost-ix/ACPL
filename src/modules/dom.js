// Shared DOM helpers (sidebar, folder settings dialog, quick switcher, chat).

// Delegated clicks on [data-action] elements inside `root`.
// handlers: { [action]: (actionEl, event) => void }. Returns the remover.
export function onActions(root, handlers, { stop = true } = {}) {
  const listener = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const handler = handlers[el.getAttribute('data-action')];
    if (!handler) return;
    if (stop) e.stopPropagation();
    handler(el, e);
  };
  root.addEventListener('click', listener);
  return () => root.removeEventListener('click', listener);
}

// Inline text input. mode 'replace': swaps `target` for the input; mode 'after': hides
// `target` and shows the input right after it. Enter / blur = commit, Esc = cancel.
// onCommit(value) runs only for a non-empty value that differs from `initial`.
export function inlineInput(target, { initial = '', placeholder = '', className = '', mode = 'replace', onCommit, onDone }) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = className;
  input.value = initial;
  input.placeholder = placeholder;
  input.spellcheck = false;
  if (mode === 'after') {
    target.classList.add('hidden');
    target.after(input);
  } else {
    target.replaceWith(input);
  }
  input.focus();
  input.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (mode === 'after') {
      input.remove();
      target.classList.remove('hidden');
    }
    if (commit && value && value !== initial && onCommit) onCommit(value);
    if (onDone) onDone();
  };
  ['click', 'mousedown'].forEach((type) => input.addEventListener(type, (e) => e.stopPropagation()));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  return input;
}

// --- Overlay notifications ---
// Native browser panels are drawn above the page, so they step aside while an HTML overlay
// (dialog, Ctrl+K, drag & drop) is shown. Overlays report here; browser-pane.js listens.
let overlayListeners = Object.freeze([]);
export const onOverlayChange = (fn) => { overlayListeners = Object.freeze([...overlayListeners, fn]); };
export const notifyOverlay = (reason, open) => overlayListeners.forEach((fn) => fn(reason, open));

// Full-screen overlay with one card; closes on a backdrop click or Esc.
// Returns { overlay, card, open(), close(), isOpen() }.
let overlaySeq = 0;
export function createOverlay({ overlayClass, cardClass, onClose }) {
  const overlay = document.createElement('div');
  overlay.className = `${overlayClass} hidden`;
  overlay.innerHTML = `<div class="${cardClass}"></div>`;
  document.body.appendChild(overlay);
  const card = overlay.firstElementChild;
  const reason = `overlay-${overlaySeq += 1}`;
  const isOpen = () => !overlay.classList.contains('hidden');
  const close = () => {
    if (!isOpen()) return;
    overlay.classList.add('hidden');
    notifyOverlay(reason, false);
    if (onClose) onClose();
  };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close();
  });
  const open = () => {
    overlay.classList.remove('hidden');
    notifyOverlay(reason, true);
  };
  return { overlay, card, isOpen, close, open };
}

/**
 * Mouse based drag (Tauri's file-drop handler blocks HTML5 drag & drop on Windows).
 * Starts after a small move; a ghost label follows the pointer.
 *   resolve(element) -> drop target | null   (element under the pointer)
 *   highlight(target, on)                     (hover feedback)
 *   onStart() / onEnd()                       (e.g. show / hide drop zones)
 *   drop(target)
 */
const DRAG_THRESHOLD_PX = 6;

// Follows the pointer until the button is released (drags, splitters, sidebar width)
export function trackPointer({ onMove, onEnd = () => {} }) {
  const move = (ev) => onMove(ev);
  const up = (ev) => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    onEnd(ev);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

export function beginPointerDrag(e, { label, resolve, highlight = () => {}, onStart = () => {}, onEnd = () => {}, drop }) {
  if (e.button !== 0) return;
  const start = { x: e.clientX, y: e.clientY };
  let ghost = null;
  let target = null;

  const setTarget = (next) => {
    if (next === target || (next && target && next.key === target.key)) return;
    if (target) highlight(target, false);
    target = next;
    if (target) highlight(target, true);
  };
  const onMove = (ev) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD_PX) return;
      ghost = document.createElement('div');
      ghost.className = 'folder-drag-ghost';
      ghost.textContent = label;
      document.body.appendChild(ghost);
      document.body.classList.add('folder-dragging');
      notifyOverlay('drag', true);
      onStart();
    }
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 8}px)`;
    setTarget(resolve(document.elementFromPoint(ev.clientX, ev.clientY)));
  };
  const onUp = () => {
    if (!ghost) return;
    ghost.remove();
    document.body.classList.remove('folder-dragging');
    const dropped = target;
    setTarget(null);
    onEnd();
    notifyOverlay('drag', false);
    if (dropped) drop(dropped);
  };
  trackPointer({ onMove, onEnd: onUp });
}

export const isNearBottom = (el, slack = 80) => el.scrollHeight - el.scrollTop - el.clientHeight < slack;

// Clipboard write; falls back to a hidden textarea + execCommand when the async API is refused.
// Resolves to true on success.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}
