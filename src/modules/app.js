// Application Controller & Entry Point

import { setLanguage, t, getCurrentLang } from './i18n.js';
import {
  setFolders,
  getFolders,
  getActiveFolderId,
  setPendingCloseFolderId,
  setGroups,
  setScanRoots,
  setMergeSamePath
} from './state.js';
import { saveAllConfig } from './config.js';
import { createTerminalInstance, fitAndResizeTerminal, debouncedFitAndResize, setupPtyListeners } from './terminal.js';
import { setupChatListeners } from './chat.js';
import { triggerManualUsageCheck, startUsageScheduler } from './usage.js';
import * as M from './folder-model.js';
import { addOrSelectFolderByPath, refreshMissingPaths, refreshDiscovered } from './folders.js';
import { openSwitcher, setupSwitcherShortcut } from './switcher.js';
import { setupTitlebar } from './titlebar.js';
import { startSystemMonitor } from './sysmon.js';
import { setupBrowserGuard } from './browser-guard.js';
import {
  applyTheme,
  toggleTheme,
  updateUILanguage,
  renderFolderCards,
  renderSessionIndicators,
  renderUsageStatusBar,
  renderWelcomeManual,
  selectActiveFolder,
  closeFolderSessionConfirmed,
  setConfirmModal,
  startNewGroupInput
} from './ui.js';
import { setupBrowserPanels } from './browser-pane.js';
import { exportConversationChatRaw, exportConversationReportPDF } from './extract.js';
import { setupPanes } from './panes.js';
import { setupFileDrop } from './file-drop.js';
import { trackPointer } from './dom.js';

const SIDEBAR_MIN = 260;
const SIDEBAR_SNAP = 135;

// Pure: saved config -> initial app data
export function bootState(config) {
  const saved = (config && Array.isArray(config.folders)) ? config.folders : [];
  const mergeSamePath = !(config && config.mergeSamePath === false);
  const loaded = saved.map(M.fromConfig);
  // One card per path (unless turned off); folders unused for a long time go to the archive
  const folders = saved.length
    ? M.autoArchived(mergeSamePath ? M.mergeDuplicates(loaded) : loaded)
    : [M.createFolder({ path: 'C:\\', id: 'folder_default', now: 0 })];
  return {
    folders,
    groups: M.sanitizeGroups(config && config.groups),
    scanRoots: M.sanitizeRoots(config && config.scanRoots),
    mergeSamePath,
    merged: saved.length !== folders.length && saved.length > 0,
  };
}

// The visible terminal follows layout changes
function refitActiveTerminal(fit = fitAndResizeTerminal) {
  const activeId = getActiveFolderId();
  if (activeId && getFolders().some((f) => f.isActive)) fit(activeId);
}

const setSidebarToggleIcon = (sidebar) => {
  const btn = document.getElementById('btn-toggle-sidebar');
  if (btn) btn.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
};

function initSidebarResizer(sidebar) {
  const resizer = document.getElementById('sidebar-resizer');
  if (!resizer) return;
  const setDragging = (on) => {
    resizer.classList.toggle('resizing', on);
    sidebar.classList.toggle('is-resizing', on);
    document.body.style.cursor = on ? 'col-resize' : '';
    document.body.style.userSelect = on ? 'none' : '';
  };

  resizer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    let frame = null;
    setDragging(true);
    trackPointer({
      onMove: (ev) => {
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const collapse = ev.clientX <= SIDEBAR_SNAP;
          sidebar.classList.toggle('collapsed', collapse);
          sidebar.style.width = collapse ? '' : `${Math.max(SIDEBAR_MIN, Math.min(ev.clientX, window.innerWidth / 3))}px`;
          setSidebarToggleIcon(sidebar);
        });
      },
      onEnd: () => {
        if (frame) cancelAnimationFrame(frame);
        setDragging(false);
        refitActiveTerminal();
      },
    });
  });
}

function initSidebarToggle(sidebar) {
  const btn = document.getElementById('btn-toggle-sidebar');
  if (!btn) return;
  btn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    sidebar.style.width = '';
    setSidebarToggleIcon(sidebar);
    setTimeout(() => refitActiveTerminal(), 50);
  });
}

async function addFolderFromPicker() {
  const selectedPath = await window.api.openFolder();
  if (!selectedPath) return;
  // Same path already registered -> just select it (one card per folder)
  const folder = addOrSelectFolderByPath(selectedPath);
  renderFolderCards();
  selectActiveFolder(folder.id);
  saveAllConfig();
}

async function saveConfigWithNotice() {
  const res = await saveAllConfig();
  alert(res && res.success
    ? `${t('configSaveSuccess')}${res.path}`
    : `${t('configSaveError')}${(res && res.error) || ''}`);
}

function closeConfirmModal() {
  setPendingCloseFolderId(null);
  setConfirmModal(false);
}

// id -> click handler of the static buttons in index.html
const BUTTONS = {
  'btn-theme-toggle': toggleTheme,
  'btn-extract-chat': exportConversationChatRaw,
  'btn-export-report': exportConversationReportPDF,
  'btn-add-folder': addFolderFromPicker,
  'btn-new-group': startNewGroupInput,
  'btn-open-switcher': openSwitcher,
  'btn-save': saveConfigWithNotice,
  'modal-btn-cancel': closeConfirmModal,
  'modal-btn-confirm': closeFolderSessionConfirmed,
};

document.addEventListener('DOMContentLoaded', async () => {
  setupBrowserGuard();
  setupBrowserPanels();
  setupPanes();
  setupFileDrop();
  setupTitlebar();
  setupPtyListeners();
  setupChatListeners();
  startUsageScheduler();

  const config = await window.api.loadConfig();
  setLanguage((config && config.lang) || 'ko');
  applyTheme((config && config.theme) || 'dark');
  updateUILanguage();

  const boot = bootState(config);
  setGroups(boot.groups);
  setScanRoots(boot.scanRoots);
  setMergeSamePath(boot.mergeSamePath);
  setFolders(boot.folders);
  boot.folders.forEach((f) => createTerminalInstance(f.id));

  const sidebar = document.getElementById('sidebar');
  renderFolderCards();
  renderSessionIndicators();
  initSidebarResizer(sidebar);
  initSidebarToggle(sidebar);
  renderWelcomeManual(); // nothing runs right after start

  // Background checks: missing folders, projects found in the CLIs' history
  refreshMissingPaths().then((changed) => { if (changed) renderFolderCards(); }).catch(() => {});
  refreshDiscovered(true).then(() => renderFolderCards()).catch(() => {});
  if (boot.merged) saveAllConfig(); // duplicates were merged

  const terminalsWrapper = document.getElementById('terminals-wrapper');
  if (window.ResizeObserver && terminalsWrapper) {
    new ResizeObserver(() => {
      if (!sidebar.classList.contains('is-resizing')) refitActiveTerminal(debouncedFitAndResize);
    }).observe(terminalsWrapper);
  }

  setupSwitcherShortcut();
  Object.entries(BUTTONS).forEach(([id, handler]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => handler());
  });

  const selectLang = document.getElementById('select-lang');
  if (selectLang) {
    selectLang.value = getCurrentLang();
    selectLang.addEventListener('change', (e) => {
      setLanguage(e.target.value);
      updateUILanguage();
      saveAllConfig();
    });
  }

  // Refresh usage button (the status bar is re-rendered, so delegate)
  const usageStatusBar = document.getElementById('usage-status-bar');
  if (usageStatusBar) {
    usageStatusBar.addEventListener('click', (e) => {
      if (e.target.closest('#btn-refresh-usage')) triggerManualUsageCheck();
    });
  }
  renderUsageStatusBar();
  setInterval(renderUsageStatusBar, 30000);
  startSystemMonitor();

  // Save config on app exit
  if (window.api.onSaveBeforeQuit) {
    window.api.onSaveBeforeQuit(async () => {
      await saveAllConfig();
      if (window.api.confirmQuit) window.api.confirmQuit();
    });
  }
});
