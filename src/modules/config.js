// Configuration Persistence Module

import { getFolders, getCurrentTheme } from './state.js';
import { getCurrentLang } from './i18n.js';
import { syncInputValuesToFolders } from './ui.js';

let saveDebounceTimer = null;

export async function saveAllConfig() {
  syncInputValuesToFolders(); // Sync DOM data before saving
  const folders = getFolders();
  const configToSave = {
    theme: getCurrentTheme(),
    lang: getCurrentLang(),
    folders: folders.map((f) => ({
      id: f.id,
      path: f.path,
      alias: f.alias || '',
      cli: f.cli,
      customCommand: f.customCommand || '',
    })),
  };
  const res = await window.api.saveConfig(configToSave);
  return res;
}

export function debouncedSaveConfig() {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    saveAllConfig();
  }, 300);
}
