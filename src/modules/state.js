// Global Application State Store

let folders = [];
let activeFolderId = null;
let pendingCloseFolderId = null;
let currentTheme = 'dark';

// Map of xterm instances: { [folderId]: { term, fitAddon, isSpawned, container, sessionRawText } }
export const termInstances = {};

// Track usage checking status maps
export const isCheckingUsageMap = {};
export const hasAutoCheckedUsageMap = {};

let welcomeContainerInstance = null;

export function getFolders() {
  return folders;
}

export function setFolders(newFolders) {
  folders = newFolders;
}

export function getActiveFolderId() {
  return activeFolderId;
}

export function setActiveFolderId(id) {
  activeFolderId = id;
}

export function getPendingCloseFolderId() {
  return pendingCloseFolderId;
}

export function setPendingCloseFolderId(id) {
  pendingCloseFolderId = id;
}

export function getCurrentTheme() {
  return currentTheme;
}

export function setCurrentTheme(theme) {
  currentTheme = theme;
}

export function getWelcomeContainerInstance() {
  return welcomeContainerInstance;
}

export function setWelcomeContainerInstance(el) {
  welcomeContainerInstance = el;
}
