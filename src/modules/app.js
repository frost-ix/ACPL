// Application Controller & Entry Point

import { setLanguage, t, getCurrentLang } from './i18n.js';
import {
  setFolders,
  getFolders,
  getActiveFolderId,
  setPendingCloseFolderId
} from './state.js';
import { saveAllConfig } from './config.js';
import {
  createTerminalInstance,
  fitAndResizeTerminal,
  debouncedFitAndResize,
  triggerManualUsageCheck,
  setupPtyListeners
} from './terminal.js';
import { exportConversationChatRaw, exportConversationReportPDF } from './extract.js';
import {
  applyTheme,
  toggleTheme,
  updateUILanguage,
  renderFolderCards,
  renderSessionTabs,
  renderWelcomeManual,
  selectActiveFolder,
  closeFolderSessionConfirmed,
  syncInputValuesToFolders
} from './ui.js';

let resizerAnimationFrame = null;

function initSidebarResizer() {
  const sidebar = document.getElementById('sidebar');
  const sidebarResizer = document.getElementById('sidebar-resizer');
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  let isResizing = false;

  if (!sidebarResizer) return;

  sidebarResizer.addEventListener('mousedown', () => {
    isResizing = true;
    sidebarResizer.classList.add('resizing');
    sidebar.classList.add('is-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    if (resizerAnimationFrame) cancelAnimationFrame(resizerAnimationFrame);

    resizerAnimationFrame = requestAnimationFrame(() => {
      const maxAllowedWidth = window.innerWidth / 3;
      const snapThreshold = 135;

      let newWidth = e.clientX;

      if (newWidth <= snapThreshold) {
        sidebar.classList.add('collapsed');
        sidebar.style.width = '';
        if (btnToggleSidebar) btnToggleSidebar.textContent = '▶';
      } else {
        sidebar.classList.remove('collapsed');
        const clampedWidth = Math.max(260, Math.min(newWidth, maxAllowedWidth));
        sidebar.style.width = `${clampedWidth}px`;
        if (btnToggleSidebar) btnToggleSidebar.textContent = '◀';
      }
    });
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      if (resizerAnimationFrame) cancelAnimationFrame(resizerAnimationFrame);

      sidebarResizer.classList.remove('resizing');
      sidebar.classList.remove('is-resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const folders = getFolders();
      const activeCount = folders.filter((f) => f.isActive).length;
      const activeFolderId = getActiveFolderId();
      if (activeCount > 0 && activeFolderId) {
        fitAndResizeTerminal(activeFolderId);
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  setupPtyListeners();

  const config = await window.api.loadConfig();

  if (config && config.lang) {
    setLanguage(config.lang);
  } else {
    setLanguage('ko');
  }

  if (config && config.theme) {
    applyTheme(config.theme);
  } else {
    applyTheme('dark');
  }

  updateUILanguage();

  let initialFolders = [];
  if (config && config.folders && config.folders.length > 0) {
    initialFolders = config.folders.map((f) => ({
      id: f.id || 'folder_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      path: f.path || 'C:\\',
      alias: f.alias || '',
      cli: f.cli || 'claude',
      customCommand: f.customCommand || '',
      isActive: false,
      usage: { tokens: 0, cost: 0.0, sessionQuota: null, weekQuota: null },
    }));
  } else {
    initialFolders = [
      {
        id: 'folder_default',
        path: 'C:\\',
        alias: '',
        cli: 'claude',
        customCommand: '',
        isActive: false,
        usage: { tokens: 0, cost: 0.0, sessionQuota: null, weekQuota: null },
      },
    ];
  }

  setFolders(initialFolders);

  initialFolders.forEach((f) => {
    createTerminalInstance(f.id);
  });

  renderFolderCards();
  renderSessionTabs();
  initSidebarResizer();

  const activeSessions = initialFolders.filter((f) => f.isActive);
  if (activeSessions.length === 0) {
    renderWelcomeManual();
  } else if (initialFolders.length > 0) {
    selectActiveFolder(initialFolders[0].id);
  }

  const sidebar = document.getElementById('sidebar');
  const terminalsWrapper = document.getElementById('terminals-wrapper');
  if (window.ResizeObserver && terminalsWrapper) {
    const mainObserver = new ResizeObserver(() => {
      if (sidebar && !sidebar.classList.contains('is-resizing')) {
        const folders = getFolders();
        const activeCount = folders.filter((f) => f.isActive).length;
        const activeFolderId = getActiveFolderId();
        if (activeCount > 0 && activeFolderId) {
          debouncedFitAndResize(activeFolderId);
        }
      }
    });
    mainObserver.observe(terminalsWrapper);
  }

  // Sidebar Toggle Button
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  if (btnToggleSidebar) {
    btnToggleSidebar.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      sidebar.style.width = '';
      const isCollapsed = sidebar.classList.contains('collapsed');
      btnToggleSidebar.textContent = isCollapsed ? '▶' : '◀';

      setTimeout(() => {
        const folders = getFolders();
        const activeCount = folders.filter((f) => f.isActive).length;
        const activeFolderId = getActiveFolderId();
        if (activeCount > 0 && activeFolderId) {
          fitAndResizeTerminal(activeFolderId);
        }
      }, 50);
    });
  }

  // Theme Toggle Button
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', () => {
      toggleTheme();
    });
  }

  // Language Select
  const selectLang = document.getElementById('select-lang');
  if (selectLang) {
    selectLang.value = getCurrentLang();
    selectLang.addEventListener('change', (e) => {
      setLanguage(e.target.value);
      updateUILanguage();
      saveAllConfig();
    });
  }

  // Check Usage Button
  const btnCheckUsage = document.getElementById('btn-check-usage');
  if (btnCheckUsage) {
    btnCheckUsage.addEventListener('click', () => {
      triggerManualUsageCheck();
    });
  }

  // Export PDF Report Button
  const btnExportReport = document.getElementById('btn-export-report');
  if (btnExportReport) {
    btnExportReport.addEventListener('click', () => {
      exportConversationReportPDF();
    });
  }

  // Extract Raw Chat Button
  const btnExtractChat = document.getElementById('btn-extract-chat');
  if (btnExtractChat) {
    btnExtractChat.addEventListener('click', () => {
      exportConversationChatRaw();
    });
  }

  // Add Folder Button
  const btnAddFolder = document.getElementById('btn-add-folder');
  if (btnAddFolder) {
    btnAddFolder.addEventListener('click', async () => {
      syncInputValuesToFolders();
      const selectedPath = await window.api.openFolder();
      if (selectedPath) {
        const folders = getFolders();
        const newId = 'folder_' + Date.now();
        const newFolder = {
          id: newId,
          path: selectedPath,
          alias: '',
          cli: 'claude',
          customCommand: '',
          isExpanded: false,
          isActive: false,
          usage: { tokens: 0, cost: 0.0, sessionQuota: null, weekQuota: null },
        };
        folders.push(newFolder);
        setFolders(folders);
        createTerminalInstance(newId);
        renderFolderCards();
        saveAllConfig();
      }
    });
  }

  // Save Settings Button
  const btnSave = document.getElementById('btn-save');
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const res = await saveAllConfig();
      if (res && res.success) {
        alert(`${t('configSaveSuccess')}${res.path}`);
      } else {
        alert(`${t('configSaveError')}${res && res.error ? res.error : ''}`);
      }
    });
  }

  // Modal Buttons
  const confirmModal = document.getElementById('confirm-modal');
  const modalBtnConfirm = document.getElementById('modal-btn-confirm');
  const modalBtnCancel = document.getElementById('modal-btn-cancel');

  if (modalBtnCancel) {
    modalBtnCancel.addEventListener('click', () => {
      setPendingCloseFolderId(null);
      if (confirmModal) confirmModal.classList.add('hidden');
    });
  }

  if (modalBtnConfirm) {
    modalBtnConfirm.addEventListener('click', () => {
      closeFolderSessionConfirmed();
    });
  }

  // Save Config on App Exit
  if (window.api && window.api.onSaveBeforeQuit) {
    window.api.onSaveBeforeQuit(async () => {
      await saveAllConfig();
      if (window.api.confirmQuit) {
        window.api.confirmQuit();
      }
    });
  }
});
