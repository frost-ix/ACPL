// Application State Store
//
// App data (folders, groups, preferences) is immutable: every value handed out is frozen and
// changes go through the update functions below, which build new objects / arrays.
// Runtime handles bound to the DOM or to processes (xterm / chat instances) are not app data
// and live in the two registries at the bottom.

import { deepFreeze } from './util.js';

let data = deepFreeze({
  folders: [],
  groups: [], // [{ id, name, collapsed }] in display order
  scanRoots: [], // root folders scanned for git repositories
  mergeSamePath: true, // one card per path
  layout: { cells: {}, focused: null }, // session panes (layout-model.js), not persisted
});

let activeFolderId = null;
let pendingCloseFolderId = null;
let currentTheme = 'dark';
let welcomeContainerInstance = null;

const commit = (next) => {
  data = deepFreeze({ ...data, ...next });
  return data;
};

// --- Folders ---
export const getFolders = () => data.folders;
export const getFolder = (id) => data.folders.find((f) => f.id === id) || null;

export const setFolders = (folders) => commit({ folders: [...folders] }).folders;

// fn: folders -> folders
export const updateFolders = (fn) => setFolders(fn(data.folders));

// patch: partial folder, or folder -> partial folder. Returns the new folder (or null).
export const updateFolder = (id, patch) => {
  updateFolders((list) => list.map((f) => (f.id === id ? { ...f, ...(typeof patch === 'function' ? patch(f) : patch) } : f)));
  return getFolder(id);
};

export const updateFoldersWhere = (pred, patch) =>
  updateFolders((list) => list.map((f) => (pred(f) ? { ...f, ...(typeof patch === 'function' ? patch(f) : patch) } : f)));

// --- Groups / preferences ---
export const getGroups = () => data.groups;
export const setGroups = (groups) => commit({ groups: [...groups] }).groups;
export const getScanRoots = () => data.scanRoots;
export const setScanRoots = (roots) => commit({ scanRoots: [...roots] }).scanRoots;
export const isMergeSamePath = () => data.mergeSamePath;
export const setMergeSamePath = (on) => commit({ mergeSamePath: on !== false }).mergeSamePath;

// --- Session panes ---
export const getLayout = () => data.layout;
export const setLayout = (layout) => commit({ layout }).layout;

// --- Selection / theme ---
export const getActiveFolderId = () => activeFolderId;
export const setActiveFolderId = (id) => { activeFolderId = id; };
export const getPendingCloseFolderId = () => pendingCloseFolderId;
export const setPendingCloseFolderId = (id) => { pendingCloseFolderId = id; };
export const getCurrentTheme = () => currentTheme;
export const setCurrentTheme = (theme) => { currentTheme = theme; };
export const getWelcomeContainerInstance = () => welcomeContainerInstance;
export const setWelcomeContainerInstance = (el) => { welcomeContainerInstance = el; };

// --- Runtime registries (DOM / process handles, intentionally mutable) ---
// { [folderId]: { term, fitAddon, isSpawned, container, sessionRawText } }
export const termInstances = {};
// { [folderId]: { container, listEl, inputEl, messages, resumeId, isBusy, ... } }
export const chatInstances = {};
