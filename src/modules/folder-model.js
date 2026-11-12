// Folder Model — pure functions over plain, immutable data.
//
// Nothing here touches the DOM, the store or the backend: every function takes values and
// returns new values (inputs are never modified). folders.js applies them to the store.

import { normalizePath, basename, byAll, sortedBy } from './util.js';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const ARCHIVE_DAYS = 30;
export const KNOWN_CLIS = ['claude', 'antigravity', 'codex', 'etc'];
export const UNGROUPED = '__none';

// --- Saved conversations (session refs) ---
export const RESUMABLE_CLIS = ['claude', 'codex', 'antigravity'];
export const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const supportsResume = (cli) => RESUMABLE_CLIS.includes(cli);

// Keeps only well-formed refs of resumable CLIs: { [cli]: { id, updatedAt } }
export const sanitizeSessionRefs = (raw) => Object.fromEntries(
  Object.entries(raw && typeof raw === 'object' ? raw : {})
    .filter(([cli, r]) => supportsResume(cli) && r && SAFE_ID.test(r.id || ''))
    .map(([cli, r]) => [cli, { id: r.id, updatedAt: Number(r.updatedAt) || 0 }])
);

export const withSessionRef = (refs, cli, id, now = Date.now()) => ({ ...(refs || {}), [cli]: { id, updatedAt: now } });

export const withoutSessionRef = (refs, cli) =>
  Object.fromEntries(Object.entries(refs || {}).filter(([k]) => k !== cli));

export const inferLastUsed = (folder) =>
  Object.values(folder.sessionRefs || {}).reduce((max, r) => Math.max(max, Number(r && r.updatedAt) || 0), 0);

// --- Display ---
const aliasOf = (folder) => (folder.alias || '').trim();

export const displayName = (folder) => aliasOf(folder) || basename(folder.path);

// Collapsed-sidebar badge: 2 chars of the alias / non-latin name, 3 of a latin name
export const badgeText = (folder) => {
  const alias = aliasOf(folder);
  if (alias) return alias.substring(0, 2);
  const name = basename(folder.path);
  return name.substring(0, /^[a-zA-Z0-9_]/.test(name) ? 3 : 2);
};

// --- Usage (quota) ---
export const emptyUsage = () => ({ tokens: 0, cost: 0, windows: [] });
export const usageOf = (folder) => ({ ...emptyUsage(), ...((folder && folder.usage) || {}) });

// --- Creating / (de)serializing ---
export const newId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

export const createFolder = ({ path, cli = 'claude', id = newId('folder'), now = Date.now() }) => ({
  id,
  path,
  alias: '',
  cli: KNOWN_CLIS.includes(cli) ? cli : 'claude',
  customCommand: '',
  viewMode: 'chat',
  chatPermission: '',
  resumeSession: true,
  sessionRefs: {},
  pinned: false,
  archived: false,
  groupId: null,
  lastUsedAt: now,
  isActive: false,
  usage: emptyUsage(),
});

// directory.json entry -> folder (runtime fields reset)
export const fromConfig = (raw) => {
  const base = {
    ...createFolder({ path: raw.path || 'C:\\', cli: raw.cli || 'claude', id: raw.id || newId('folder'), now: 0 }),
    alias: raw.alias || '',
    customCommand: raw.customCommand || '',
    viewMode: raw.viewMode === 'terminal' ? 'terminal' : 'chat',
    chatPermission: raw.chatPermission || '',
    resumeSession: raw.resumeSession !== false,
    sessionRefs: sanitizeSessionRefs(raw.sessionRefs),
    pinned: !!raw.pinned,
    archived: !!raw.archived,
    groupId: typeof raw.groupId === 'string' ? raw.groupId : null,
    lastUsedAt: Number(raw.lastUsedAt) || 0,
  };
  return { ...base, lastUsedAt: base.lastUsedAt || inferLastUsed(base) };
};

// folder -> directory.json entry (only what is worth persisting)
export const toConfig = (f) => ({
  id: f.id,
  path: f.path,
  alias: f.alias || '',
  cli: f.cli,
  customCommand: f.customCommand || '',
  viewMode: f.viewMode || 'chat',
  chatPermission: f.chatPermission || '',
  resumeSession: f.resumeSession !== false,
  sessionRefs: f.sessionRefs || {},
  pinned: !!f.pinned,
  archived: !!f.archived,
  groupId: f.groupId || null,
  lastUsedAt: f.lastUsedAt || 0,
});

export const sanitizeGroups = (list) => (Array.isArray(list) ? list : [])
  .filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string')
  .map((g) => ({ id: g.id, name: g.name, collapsed: !!g.collapsed }));

export const sanitizeRoots = (list) => (Array.isArray(list) ? list : [])
  .filter((p) => typeof p === 'string' && p.trim());

// --- Folder transitions (return a patch) ---
export const touched = (now = Date.now()) => ({ lastUsedAt: now, archived: false });
export const pinToggled = (f) => ({ pinned: !f.pinned, archived: f.pinned ? f.archived : false });
export const archiveToggled = (f) => ({ archived: !f.archived, pinned: f.archived ? f.pinned : false });

// --- List transitions ---
export const findByPath = (folders, path) => {
  const key = normalizePath(path);
  return folders.find((f) => normalizePath(f.path) === key) || null;
};

// Two cards of the same path folded into one. Saved conversations are kept per CLI.
const mergePair = (keep, f) => {
  const newer = (f.lastUsedAt || 0) > (keep.lastUsedAt || 0);
  const refs = Object.entries(f.sessionRefs || {}).reduce((acc, [cli, ref]) => (
    !acc[cli] || (ref.updatedAt || 0) > (acc[cli].updatedAt || 0) ? { ...acc, [cli]: ref } : acc
  ), keep.sessionRefs || {});
  return {
    ...keep,
    ...(newer ? { cli: f.cli, viewMode: f.viewMode, chatPermission: f.chatPermission } : {}),
    sessionRefs: refs,
    alias: keep.alias || f.alias || '',
    customCommand: keep.customCommand || f.customCommand || '',
    groupId: keep.groupId || f.groupId || null,
    pinned: !!(keep.pinned || f.pinned),
    archived: !!(keep.archived && f.archived),
    lastUsedAt: Math.max(keep.lastUsedAt || 0, f.lastUsedAt || 0),
  };
};

// One card per path; the first card of a path keeps its id and position.
// (The Map is local to the call, so the function stays pure; re-setting a key keeps its order.)
export const mergeDuplicates = (folders) => {
  const byPath = new Map();
  folders.forEach((f) => {
    const key = normalizePath(f.path);
    byPath.set(key, byPath.has(key) ? mergePair(byPath.get(key), f) : f);
  });
  return [...byPath.values()];
};

// Folders unused for ARCHIVE_DAYS go to the archive (pinned / running ones never do)
export const autoArchived = (folders, now = Date.now()) => {
  const limit = now - ARCHIVE_DAYS * DAY_MS;
  return folders.map((f) => (
    !f.pinned && !f.isActive && f.lastUsedAt && f.lastUsedAt < limit && !f.archived ? { ...f, archived: true } : f
  ));
};

export const withMissingFlags = (folders, exists) => folders.map((f, i) => ({ ...f, missing: exists[i] === false }));

export const ungroup = (folders, groupId) => folders.map((f) => (f.groupId === groupId ? { ...f, groupId: null } : f));

// --- Groups ---
export const addedGroup = (groups, name, id = newId('group')) => {
  const clean = String(name || '').trim();
  return clean ? [...groups, { id, name: clean, collapsed: false }] : groups;
};

export const renamedGroup = (groups, id, name) => {
  const clean = String(name || '').trim();
  return clean ? groups.map((g) => (g.id === id ? { ...g, name: clean } : g)) : groups;
};

export const removedGroup = (groups, id) => groups.filter((g) => g.id !== id);

export const movedGroup = (groups, id, delta) => {
  const i = groups.findIndex((g) => g.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= groups.length) return groups;
  return groups.map((g, k) => (k === i ? groups[j] : k === j ? groups[i] : g));
};

export const groupCollapseToggled = (groups, id) =>
  groups.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g));

// --- Sidebar sections ---
// [{ key, kind: running|group|ungrouped|archived, group?, folders }]
// Running folders are listed only on top; group sections are kept even when empty
// so folders can be dropped into them. Inside a section: pinned, then recently used, then name.
export const buildSections = (folders, groups, displayName) => {
  const order = byAll(
    (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0),
    (a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0),
    (a, b) => displayName(a).localeCompare(displayName(b))
  );
  const groupIds = new Set(groups.map((g) => g.id));
  const kindOf = (f) => {
    if (f.isActive) return 'running';
    if (f.archived) return 'archived';
    return f.groupId && groupIds.has(f.groupId) ? f.groupId : UNGROUPED;
  };
  const pick = (key) => sortedBy(folders.filter((f) => kindOf(f) === key), order);

  const running = pick('running');
  const ungrouped = pick(UNGROUPED);
  const archived = pick('archived');
  return [
    ...(running.length ? [{ key: 'running', kind: 'running', folders: running }] : []),
    ...groups.map((g) => ({ key: g.id, kind: 'group', group: g, folders: pick(g.id) })),
    ...(ungrouped.length || groups.length ? [{ key: UNGROUPED, kind: 'ungrouped', folders: ungrouped }] : []),
    ...(archived.length ? [{ key: 'archived', kind: 'archived', folders: archived }] : []),
  ];
};

// --- Discovery ---
export const suggestCli = (item) =>
  ['claude', 'codex', 'antigravity'].find((c) => ((item && item.sources) || []).includes(c)) || 'claude';

export const unregistered = (discovered, folders) => {
  const known = new Set(folders.map((f) => normalizePath(f.path)));
  return discovered.filter((d) => !known.has(normalizePath(d.path)));
};
