// Folder List Service
//
// Applies the pure transitions of folder-model.js to the immutable store and persists them.
//   - sections   : running (always on top) / user groups / ungrouped / archive
//   - one card per path (can be turned off), discovery, missing-path flags

import * as M from './folder-model.js';
import {
  getFolders,
  getFolder,
  updateFolders,
  updateFolder,
  getGroups,
  setGroups,
  getScanRoots,
  setScanRoots,
  isMergeSamePath,
  setMergeSamePath as storeMergeSamePath
} from './state.js';
import { debouncedSaveConfig } from './config.js';
import { createTerminalInstance } from './terminal.js';
import { normalizePath } from './util.js';

export { KNOWN_CLIS, UNGROUPED, suggestCli } from './folder-model.js';
export { getGroups, getScanRoots, isMergeSamePath } from './state.js';

const DISCOVER_TTL_MS = 60 * 1000;

// Persisting helper: apply a store change, then save
const saved = (fn) => (...args) => {
  const result = fn(...args);
  debouncedSaveConfig();
  return result;
};

// --- Folder transitions ---
export const touchFolder = saved((id) => updateFolder(id, M.touched()));
export const togglePinned = saved((id) => updateFolder(id, M.pinToggled));
export const toggleArchived = saved((id) => updateFolder(id, M.archiveToggled));
export const patchFolder = saved((id, patch) => updateFolder(id, patch));
export const setFolderGroup = saved((id, groupId) =>
  updateFolder(id, { groupId: groupId && getGroups().some((g) => g.id === groupId) ? groupId : null }));

// Turning it on merges at the next app start (a running session may sit in a duplicate card)
export const setMergeSamePath = (on, save = true) => {
  storeMergeSamePath(on);
  if (save) debouncedSaveConfig();
};

// --- Groups ---
export const addGroup = saved((name) => setGroups(M.addedGroup(getGroups(), name)));
export const renameGroup = saved((id, name) => setGroups(M.renamedGroup(getGroups(), id, name)));
export const moveGroup = saved((id, delta) => setGroups(M.movedGroup(getGroups(), id, delta)));
// Folders of a deleted group become ungrouped (nothing else is removed)
export const removeGroup = saved((id) => {
  setGroups(M.removedGroup(getGroups(), id));
  updateFolders((list) => M.ungroup(list, id));
});

// --- Sidebar sections ---
// Group sections remember their folding in the config; the others only for this run.
let collapsedSections = Object.freeze({ archived: true, discovered: true });

export const isSectionCollapsed = (section) =>
  (section.group ? !!section.group.collapsed : !!collapsedSections[section.key]);

export const toggleSection = (section) => {
  if (section.group) {
    setGroups(M.groupCollapseToggled(getGroups(), section.group.id));
    debouncedSaveConfig();
  } else {
    collapsedSections = Object.freeze({ ...collapsedSections, [section.key]: !isSectionCollapsed(section) });
  }
};

export const getFolderSections = (displayName) => M.buildSections(getFolders(), getGroups(), displayName);

// --- Adding ---
// Returns the folder. With merging on, an existing card of the same path is reused (and unarchived).
export function addOrSelectFolderByPath(path, cli = 'claude') {
  const existing = isMergeSamePath() ? M.findByPath(getFolders(), path) : null;
  if (existing) return patchFolder(existing.id, { archived: false });
  const folder = M.createFolder({ path, cli });
  updateFolders((list) => [...list, folder]);
  createTerminalInstance(folder.id);
  debouncedSaveConfig();
  return getFolder(folder.id);
}

// --- Missing paths --- (true when a flag changed)
export async function refreshMissingPaths() {
  const folders = getFolders();
  if (!window.api.pathsExist || !folders.length) return false;
  const exists = await window.api.pathsExist(folders.map((f) => f.path));
  if (!Array.isArray(exists)) return false;
  // Applied by id: the list may have changed while the backend was checking
  const missing = new Map(M.withMissingFlags(folders, exists).map((f) => [f.id, f.missing]));
  const changed = folders.some((f) => !!f.missing !== missing.get(f.id));
  if (changed) updateFolders((list) => list.map((f) => (missing.has(f.id) ? { ...f, missing: missing.get(f.id) } : f)));
  return changed;
}

// --- Discovery (projects found in the CLIs' history + git repos under root folders) ---
let discovered = Object.freeze([]);
let discoveredAt = 0;
let discovering = null;

const invalidateDiscovery = () => { discoveredAt = 0; };

export const addScanRoot = (path) => {
  const roots = getScanRoots();
  if (!path || roots.some((r) => normalizePath(r) === normalizePath(path))) return false;
  setScanRoots([...roots, path]);
  invalidateDiscovery();
  debouncedSaveConfig();
  return true;
};

export const removeScanRoot = saved((path) => {
  setScanRoots(getScanRoots().filter((r) => r !== path));
  invalidateDiscovery();
});

// Discovered projects that are not registered yet (newest first)
export const getDiscovered = () => M.unregistered(discovered, getFolders());

export async function refreshDiscovered(force = false) {
  if (!window.api.discoverProjects) return getDiscovered();
  if (!force && discoveredAt && Date.now() - discoveredAt < DISCOVER_TTL_MS) return getDiscovered();
  if (!discovering) {
    discovering = window.api
      .discoverProjects({ roots: getScanRoots(), maxAgeDays: 60 })
      .then((list) => {
        discovered = Object.freeze(Array.isArray(list) ? list : []);
        discoveredAt = Date.now();
      })
      .finally(() => { discovering = null; });
  }
  await discovering;
  return getDiscovered();
}
