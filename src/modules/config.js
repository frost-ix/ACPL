// Configuration Persistence Module
//
// The saved config is a pure projection of the store (see folder-model.js toConfig).

import { getFolders, getCurrentTheme, getGroups, getScanRoots, isMergeSamePath } from './state.js';
import { getCurrentLang } from './i18n.js';
import { toConfig } from './folder-model.js';
import { debounce } from './util.js';

export const buildConfig = () => ({
  theme: getCurrentTheme(),
  lang: getCurrentLang(),
  scanRoots: getScanRoots(),
  mergeSamePath: isMergeSamePath(),
  groups: getGroups(),
  folders: getFolders().map(toConfig),
});

export const saveAllConfig = () => window.api.saveConfig(buildConfig());

export const debouncedSaveConfig = debounce(saveAllConfig, 300);
