// Files dragged from Explorer onto the window (Tauri drag-drop events, real file paths).
//   chat pane      -> images go to that chat's attachment tray
//   terminal pane  -> image paths are typed into the CLI (Claude Code / Codex pick image
//                     paths up as attachments in their interactive UI)
// Anywhere else the current session gets them.

import { chatInstances, termInstances, getActiveFolderId, getFolder } from './state.js';
import { attachDroppedFiles } from './chat.js';
import { IMAGE_FILE_RE } from './attachments.js';

const HOVER_CLASS = 'file-drop-target';

// Tauri reports physical pixels; the page works in CSS pixels
const elementAt = (position) => (position
  ? document.elementFromPoint(position.x / window.devicePixelRatio, position.y / window.devicePixelRatio)
  : null);

const findId = (registry, container) => Object.keys(registry).find((id) => registry[id].container === container) || null;

// { kind, id, el } of the session whose container is (or holds) `el`, or null
const sessionIn = (el, kind, selector, registry) => {
  const container = el && el.closest(selector);
  const id = container && findId(registry, container);
  return id ? { kind, id, el: container } : null;
};

// { kind: 'chat' | 'terminal', id, el } of the session under the pointer (or the current one)
function sessionAt(position) {
  const el = elementAt(position);
  const under = sessionIn(el, 'chat', '.chat-instance', chatInstances)
    || sessionIn(el, 'terminal', '.terminal-instance', termInstances);
  if (under) return under;
  const current = getFolder(getActiveFolderId());
  if (!current || !current.isActive) return null;
  return current.runningMode === 'chat' && chatInstances[current.id]
    ? { kind: 'chat', id: current.id, el: chatInstances[current.id].container }
    : { kind: 'terminal', id: current.id, el: termInstances[current.id] && termInstances[current.id].container };
}

// Drag-over fires continuously: only the highlighted element is touched, and only on change
let hovered = null;
const setHover = (el) => {
  if (el === hovered) return;
  if (hovered) hovered.classList.remove(HOVER_CLASS);
  hovered = el || null;
  if (hovered) hovered.classList.add(HOVER_CLASS);
};
const clearHover = () => setHover(null);

// PowerShell-safe quoting for paths typed into a terminal session
const quotePath = (p) => (/[\s']/.test(p) ? `'${p.replace(/'/g, "''")}'` : p);

export function setupFileDrop() {
  window.api.onFileDragOver((payload) => {
    const target = sessionAt(payload && payload.position);
    setHover(target && target.el);
  });
  window.api.onFileDragLeave(clearHover);
  window.api.onFileDrop((payload) => {
    clearHover();
    const images = ((payload && payload.paths) || []).filter((p) => IMAGE_FILE_RE.test(p));
    const target = sessionAt(payload && payload.position);
    if (!images.length || !target || !target.id) return;
    if (target.kind === 'chat') attachDroppedFiles(target.id, images);
    else window.api.writePty({ sessionId: target.id, data: `${images.map(quotePath).join(' ')} ` });
  });
}
