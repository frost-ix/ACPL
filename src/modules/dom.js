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

// Full-screen overlay with one card; closes on a backdrop click or Esc.
// Returns { overlay, card, open(), close(), isOpen() }.
export function createOverlay({ overlayClass, cardClass, onClose }) {
  const overlay = document.createElement('div');
  overlay.className = `${overlayClass} hidden`;
  overlay.innerHTML = `<div class="${cardClass}"></div>`;
  document.body.appendChild(overlay);
  const card = overlay.firstElementChild;
  const isOpen = () => !overlay.classList.contains('hidden');
  const close = () => {
    if (!isOpen()) return;
    overlay.classList.add('hidden');
    if (onClose) onClose();
  };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close();
  });
  return { overlay, card, isOpen, close, open: () => overlay.classList.remove('hidden') };
}

export const isNearBottom = (el, slack = 80) => el.scrollHeight - el.scrollTop - el.clientHeight < slack;
