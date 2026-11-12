// Conversation Session Persistence Module
//
// A PTY dies with the app, so "keeping" a conversation means remembering the CLI's own
// session id per folder and relaunching with that CLI's resume option:
//   claude      : start `claude --session-id <uuid>` (we choose the id) -> `claude --resume <id>`
//   codex       : id discovered from ~/.codex/sessions rollout (cwd match)  -> `codex resume <id>`
//   antigravity : id discovered from ~/.gemini/antigravity-cli/conversations -> `agy --conversation <id>`
// Chat mode reuses the same id (claude -p --resume / codex exec resume).
// Never use --continue/--last: the hidden usage probe also starts sessions in the same folder.

import { debouncedSaveConfig } from './config.js';
import { getFolder, updateFolder, chatInstances } from './state.js';
import { SAFE_ID, supportsResume, withSessionRef, withoutSessionRef } from './folder-model.js';

export { supportsResume } from './folder-model.js';

const WATCH_INTERVAL_MS = 4000;
const WATCH_MAX_MS = 20 * 60 * 1000;

const watchers = new Map(); // folderId -> { timer, lookup } (runtime handles)
let probingClis = Object.freeze([]); // CLIs whose hidden usage probe is running

// Called by the usage probe. Discovery already ignores probe sessions (codex: no user
// message, agy: only slash commands); pausing the watcher meanwhile is extra safety.
export function markUsageProbe(cli, active) {
  const others = probingClis.filter((c) => c !== cli);
  probingClis = Object.freeze(active ? [...others, cli] : others);
}

export const isResumeEnabled = (folder) => !!folder && folder.resumeSession !== false;

export function getSessionRef(folder) {
  const ref = folder && folder.sessionRefs && folder.sessionRefs[folder.cli];
  return ref && SAFE_ID.test(ref.id || '') ? ref : null;
}

// Remember the CLI's conversation id of a folder (saved only when the id changes)
export function setSessionRef(folderId, cli, id) {
  const folder = getFolder(folderId);
  if (!folder || !supportsResume(cli) || !SAFE_ID.test(id || '')) return;
  const prev = folder.sessionRefs && folder.sessionRefs[cli];
  updateFolder(folderId, (f) => ({ sessionRefs: withSessionRef(f.sessionRefs, cli, id) }));
  if (!prev || prev.id !== id) debouncedSaveConfig();
}

export function clearSessionRef(folderId) {
  updateFolder(folderId, (f) => ({ sessionRefs: withoutSessionRef(f.sessionRefs, f.cli) }));
  debouncedSaveConfig();
}

// Conversation id of the folder: the running chat's id, else the saved one
export function getConversationId(folder) {
  if (!folder || !supportsResume(folder.cli)) return null;
  const inst = chatInstances[folder.id];
  if (inst && inst.resumeId) return inst.resumeId;
  const ref = getSessionRef(folder);
  return ref ? ref.id : null;
}

// The CLI's history file of a conversation, parsed by the backend
export async function loadTranscript(folder, id = getConversationId(folder)) {
  if (!folder || !id || !window.api.readTranscript) return { found: false, messages: [] };
  const res = await window.api.readTranscript({ cli: folder.cli, id, cwd: folder.path });
  return res && Array.isArray(res.messages) ? res : { found: false, messages: [] };
}

// Returns the id to resume, or null (resume off / nothing saved / CLI no longer has it).
export async function resolveResumeId(folder) {
  if (!isResumeEnabled(folder) || !supportsResume(folder.cli)) return null;
  const ref = getSessionRef(folder);
  if (!ref) return null;
  const res = await window.api.sessionLookup({ cli: folder.cli, id: ref.id });
  if (res && res.exists) return ref.id;
  // Missing on disk (e.g. claude session that never got a message) -> start fresh
  clearSessionRef(folder.id);
  return null;
}

const newUuid = () => (window.crypto && window.crypto.randomUUID
  ? window.crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

// How each CLI continues a conversation
const RESUME_ARGS = {
  claude: (id) => `--resume ${id}`,
  codex: (id) => `resume ${id}`,
  antigravity: (id) => `--conversation ${id}`,
};

// Terminal launch command with resume / pre-assigned session id. Returns { command, resumed }.
export function buildSessionCommand(folder, baseCommand, resumeId) {
  if (!baseCommand || !supportsResume(folder.cli)) return { command: baseCommand, resumed: false };
  if (resumeId && RESUME_ARGS[folder.cli]) {
    return { command: `${baseCommand} ${RESUME_ARGS[folder.cli](resumeId)}`, resumed: true };
  }
  if (folder.cli === 'claude') {
    const id = newUuid();
    setSessionRef(folder.id, 'claude', id);
    return { command: `${baseCommand} --session-id ${id}`, resumed: false };
  }
  return { command: baseCommand, resumed: false };
}

// codex / antigravity pick their own id: poll until the new conversation shows up on disk.
export function watchForNewSession(folder, sinceMs) {
  stopSessionWatch(folder.id);
  if (folder.cli !== 'codex' && folder.cli !== 'antigravity') return;
  const folderId = folder.id;
  const cli = folder.cli;
  const startedAt = Date.now();

  const lookup = async (force) => {
    const f = getFolder(folderId);
    if (!f || f.cli !== cli) return true;
    if (!force && (!f.isActive || Date.now() - startedAt > WATCH_MAX_MS)) return true;
    if (probingClis.includes(cli)) return false;
    const res = await window.api.sessionLookup({ cli, cwd: f.path, sinceMs });
    if (res && res.id) setSessionRef(folderId, cli, res.id);
    return !!(res && res.id);
  };
  const timer = setInterval(async () => {
    if (await lookup(false)) stopSessionWatch(folderId);
  }, WATCH_INTERVAL_MS);
  watchers.set(folderId, { timer, lookup });
}

export function stopSessionWatch(folderId) {
  const w = watchers.get(folderId);
  if (w) clearInterval(w.timer);
  watchers.delete(folderId);
}

// Session is being closed: one last lookup so a short conversation is still remembered
export async function flushSessionWatch(folderId) {
  const w = watchers.get(folderId);
  if (!w) return;
  stopSessionWatch(folderId);
  try {
    await w.lookup(true);
  } catch (e) {
    // ignore
  }
}
