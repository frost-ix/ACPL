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

// { kind: 'chat' | 'terminal', id, el } of the session under the pointer (or the current one)
function sessionAt(position) {
  const el = elementAt(position);
  const chat = el && el.closest('.chat-instance');
  if (chat) return { kind: 'chat', id: findId(chatInstances, chat), el: chat };
  const term = el && el.closest('.terminal-instance');
  if (term && findId(termInstances, term)) return { kind: 'terminal', id: findId(termInstances, term), el: term };
  const current = getFolder(getActiveFolderId());
  if (!current || !current.isActive) return null;
  return current.runningMode === 'chat' && chatInstances[current.id]
    ? { kind: 'chat', id: current.id, el: chatInstances[current.id].container }
    : { kind: 'terminal', id: current.id, el: termInstances[current.id] && termInstances[current.id].container };
}

const clearHover = () => document.querySelectorAll(`.${HOVER_CLASS}`).forEach((el) => el.classList.remove(HOVER_CLASS));

// PowerShell-safe quoting for paths typed into a terminal session
const quotePath = (p) => (/[\s']/.test(p) ? `'${p.replace(/'/g, "''")}'` : p);

export function setupFileDrop() {
  window.api.onFileDragOver((payload) => {
    clearHover();
    const target = sessionAt(payload && payload.position);
    if (target && target.el) target.el.classList.add(HOVER_CLASS);
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
