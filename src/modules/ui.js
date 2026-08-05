// UI Components & DOM Rendering Module

import { t, getCurrentLang } from './i18n.js';
import {
  getFolders,
  setFolders,
  getActiveFolderId,
  setActiveFolderId,
  getPendingCloseFolderId,
  setPendingCloseFolderId,
  getCurrentTheme,
  setCurrentTheme,
  getWelcomeContainerInstance,
  setWelcomeContainerInstance,
  termInstances,
  hasAutoCheckedUsageMap
} from './state.js';
import { saveAllConfig, debouncedSaveConfig } from './config.js';
import {
  getCommandToRun,
  createTerminalInstance,
  fitAndResizeTerminal,
  updateXtermTheme,
  getQuotaDisplayText
} from './terminal.js';

let tabUsageUpdateTimer = null;

export function getFolderBasename(folderPath) {
  if (!folderPath) return 'New Folder';
  const parts = folderPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || folderPath;
}

export function getFolderDisplayName(folder) {
  if (folder.alias && folder.alias.trim().length > 0) {
    return folder.alias.trim();
  }
  return getFolderBasename(folder.path);
}

export function getShortBadgeText(folder) {
  if (folder.alias && folder.alias.trim().length > 0) {
    return folder.alias.trim().substring(0, 2);
  }
  const basename = getFolderBasename(folder.path);
  const isEnglish = /^[a-zA-Z0-9_]/.test(basename);
  if (isEnglish) {
    return basename.substring(0, 3);
  } else {
    return basename.substring(0, 2);
  }
}

export function applyTheme(theme) {
  const newTheme = theme === 'light' ? 'light' : 'dark';
  setCurrentTheme(newTheme);
  document.body.className = 'theme-' + newTheme;

  const themeIcon = document.getElementById('theme-icon');
  const themeText = document.getElementById('theme-text');

  if (newTheme === 'light') {
    if (themeIcon) themeIcon.textContent = '☀️';
    if (themeText) themeText.textContent = t('lightTheme');
  } else {
    if (themeIcon) themeIcon.textContent = '🌙';
    if (themeText) themeText.textContent = t('darkTheme');
  }

  Object.keys(termInstances).forEach((id) => updateXtermTheme(termInstances[id]));
}

export function toggleTheme() {
  const newTheme = getCurrentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
  saveAllConfig();
}

export function updateUILanguage() {
  const btnAddFolder = document.getElementById('btn-add-folder');
  const btnCheckUsage = document.getElementById('btn-check-usage');
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  const themeText = document.getElementById('theme-text');
  const selectLang = document.getElementById('select-lang');
  const btnSave = document.getElementById('btn-save');
  const btnExtractChat = document.getElementById('btn-extract-chat');
  const btnExportReport = document.getElementById('btn-export-report');
  const confirmModal = document.getElementById('confirm-modal');
  const modalBtnConfirm = document.getElementById('modal-btn-confirm');
  const modalBtnCancel = document.getElementById('modal-btn-cancel');

  const btnAddFolderSpan = btnAddFolder ? btnAddFolder.querySelector('.sidebar-text') : null;
  if (btnAddFolderSpan) btnAddFolderSpan.textContent = t('addFolder');

  if (btnCheckUsage) {
    const btnCheckUsageSpan = btnCheckUsage.querySelector('.sidebar-text');
    if (btnCheckUsageSpan) btnCheckUsageSpan.textContent = t('checkUsage');
    btnCheckUsage.title = t('checkUsageTitle');
  }

  if (themeText) {
    themeText.textContent = getCurrentTheme() === 'dark' ? t('darkTheme') : t('lightTheme');
  }
  if (btnThemeToggle) btnThemeToggle.title = t('themeToggleTitle');

  if (selectLang) {
    selectLang.value = getCurrentLang();
    selectLang.title = t('langSelectTitle');
  }

  const statusBoxSpan = document.querySelector('.status-box .sidebar-text');
  if (statusBoxSpan) statusBoxSpan.textContent = t('statusSyncing');
  const statusBox = document.querySelector('.status-box');
  if (statusBox) statusBox.title = t('statusSyncTitle');

  if (btnSave) {
    const btnSaveSpan = btnSave.querySelector('.sidebar-text');
    if (btnSaveSpan) btnSaveSpan.textContent = t('saveConfigBtn');
    btnSave.title = t('saveConfigTitle');
  }

  if (btnExtractChat) {
    btnExtractChat.textContent = t('extractChatBtn');
    btnExtractChat.title = t('extractChatTitle');
  }

  if (btnExportReport) {
    btnExportReport.textContent = t('reportPdfBtn');
    btnExportReport.title = t('reportPdfTitle');
  }

  if (confirmModal) {
    const modalTitle = confirmModal.querySelector('.modal-title');
    if (modalTitle) modalTitle.textContent = t('modalCloseTitle');
    const modalDesc = confirmModal.querySelector('.modal-desc');
    if (modalDesc) modalDesc.textContent = t('modalCloseDesc');
    if (modalBtnConfirm) modalBtnConfirm.textContent = t('modalConfirm');
    if (modalBtnCancel) modalBtnCancel.textContent = t('modalCancel');
  }

  renderFolderCards();
  renderSessionTabs();

  let welcomeInstance = getWelcomeContainerInstance();
  if (welcomeInstance && welcomeInstance.style.display !== 'none') {
    renderWelcomeManual(true);
  }
}

export function syncInputValuesToFolders() {
  const folderListContainer = document.getElementById('folder-list-container');
  if (!folderListContainer) return;
  const cards = folderListContainer.querySelectorAll('.folder-card');
  const folders = getFolders();

  cards.forEach((card) => {
    const folderId = card.getAttribute('data-folder-id');
    const folder = folders.find((f) => f.id === folderId);
    if (folder) {
      const aliasInput = card.querySelector('[data-action="alias-input"]');
      const cliSelect = card.querySelector('[data-action="cli-change"]');
      const customInput = card.querySelector('[data-action="custom-cmd"]');

      if (aliasInput) folder.alias = aliasInput.value;
      if (cliSelect) folder.cli = cliSelect.value;
      if (customInput) folder.customCommand = customInput.value;
    }
  });
}

export function renderWelcomeManual(force = false) {
  let welcomeInstance = getWelcomeContainerInstance();
  const terminalsWrapper = document.getElementById('terminals-wrapper');

  if (!welcomeInstance || force) {
    const manualCardHTML = `
      <div class="welcome-manual-card">
        <div class="welcome-title-row">
          <span style="font-size: 1.5rem;">⚡</span>
          <h2>${t('welcomeHeader')}</h2>
        </div>

        <div class="welcome-step-list">
          <div class="welcome-step-item">
            <span class="welcome-step-num">1.</span>
            <span>${t('welcomeStep1')}</span>
          </div>
          <div class="welcome-step-item">
            <span class="welcome-step-num">2.</span>
            <span>${t('welcomeStep2')}</span>
          </div>
          <div class="welcome-step-item">
            <span class="welcome-step-num">3.</span>
            <span>${t('welcomeStep3')}</span>
          </div>
          <div class="welcome-step-item">
            <span class="welcome-step-num">4.</span>
            <span>${t('welcomeStep4')}</span>
          </div>
          <div class="welcome-step-item">
            <span class="welcome-step-num">5.</span>
            <span>${t('welcomeStep5')}</span>
          </div>
          <div class="welcome-step-item">
            <span class="welcome-step-num">6.</span>
            <span>${t('welcomeStep6')}</span>
          </div>
        </div>

        <div class="welcome-note-box">
          <div>${t('welcomeNote')}</div>
        </div>

        <div class="welcome-tip-box">
          ${t('welcomeTip')}
        </div>

        <div class="welcome-footer-action">
          ${t('welcomeFooter')}
        </div>

        <div class="welcome-credits">
          ${t('welcomeCredits')}
        </div>
      </div>
    `;

    if (welcomeInstance && force) {
      welcomeInstance.innerHTML = manualCardHTML;
    } else if (!welcomeInstance) {
      const welcomeDiv = document.createElement('div');
      welcomeDiv.className = 'terminal-instance welcome-manual-container';
      welcomeDiv.id = 'term-container-welcome';
      welcomeDiv.innerHTML = manualCardHTML;
      terminalsWrapper.appendChild(welcomeDiv);
      welcomeInstance = welcomeDiv;
      setWelcomeContainerInstance(welcomeInstance);
    }
  }

  Object.keys(termInstances).forEach((id) => {
    const inst = termInstances[id];
    inst.container.classList.remove('active');
    inst.container.style.display = 'none';
  });

  welcomeInstance.style.display = 'flex';
  welcomeInstance.classList.add('active');
}

export function selectActiveFolder(folderId, isLaunching = false) {
  setActiveFolderId(folderId);

  const folderListContainer = document.getElementById('folder-list-container');
  if (folderListContainer) {
    const allCards = folderListContainer.querySelectorAll('.folder-card');
    allCards.forEach((c) => {
      if (c.getAttribute('data-folder-id') === folderId) {
        c.classList.add('active-selected');
      } else {
        c.classList.remove('active-selected');
      }
    });
  }

  renderSessionTabs();

  const folders = getFolders();
  const targetFolder = folders.find((f) => f.id === folderId);
  const hasAnyActiveSession = folders.some((f) => f.isActive);
  let welcomeInstance = getWelcomeContainerInstance();

  if (!hasAnyActiveSession && !isLaunching && (!targetFolder || !targetFolder.isActive)) {
    renderWelcomeManual();
    return;
  }

  if (welcomeInstance) {
    welcomeInstance.classList.remove('active');
    welcomeInstance.style.display = 'none';
  }

  Object.keys(termInstances).forEach((id) => {
    const inst = termInstances[id];
    if (id === folderId) {
      inst.container.style.display = 'block';
      inst.container.classList.add('active');
      requestAnimationFrame(() => {
        setTimeout(() => fitAndResizeTerminal(folderId), 30);
      });
    } else {
      inst.container.classList.remove('active');
      inst.container.style.display = 'none';
    }
  });
}

export async function launchFolderSession(folderId) {
  syncInputValuesToFolders();
  const folders = getFolders();
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return;

  if (folder.isActive) {
    await window.api.killPty({ sessionId: folderId });
  }

  let inst = termInstances[folderId];
  if (!inst) {
    inst = createTerminalInstance(folderId);
  }

  selectActiveFolder(folderId, true);

  const commandToRun = getCommandToRun(folder.cli, folder.customCommand);

  inst.term.clear();
  inst.sessionRawText = '';
  inst.term.write(`\x1b[32m[${t('startingSession')}]\x1b[0m\r\n`);
  inst.term.write(`\x1b[36m${t('pathLabel')}: ${folder.path}\x1b[0m\r\n`);
  if (commandToRun) {
    inst.term.write(`\x1b[36m${t('commandLabel')}: ${commandToRun}\x1b[0m\r\n\r\n`);
  }

  fitAndResizeTerminal(folderId);

  const result = await window.api.spawnPty({
    sessionId: folderId,
    folderPath: folder.path,
    commandToRun,
    cols: inst.term.cols || 80,
    rows: inst.term.rows || 30,
  });

  if (result.success) {
    folder.isActive = true;
    if (!folder.usage) folder.usage = { tokens: 0, cost: 0.0, sessionQuota: null, weekQuota: null };
    inst.isSpawned = true;

    hasAutoCheckedUsageMap[folderId] = false;
  } else {
    folder.isActive = false;
    inst.term.write(`\x1b[31m[${t('sessionLaunchFailed')}${result.error}]\x1b[0m\r\n`);
  }

  renderFolderCards();
  selectActiveFolder(folderId);
  debouncedSaveConfig();
}

export function openCloseModal(folderId) {
  const folders = getFolders();
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return;

  if (!folder.isActive) {
    alert(t('noActiveSession'));
    return;
  }

  setPendingCloseFolderId(folderId);
  const displayName = getFolderDisplayName(folder);
  const cliName = folder.cli.toUpperCase();

  const confirmModal = document.getElementById('confirm-modal');
  const modalSessionDesc = document.getElementById('modal-session-desc');
  const currentLang = getCurrentLang();

  if (modalSessionDesc) {
    modalSessionDesc.textContent = currentLang === 'en'
      ? `Are you sure you want to terminate [${displayName}] (${cliName}) session and running CLI?`
      : `[${displayName}] (${cliName}) 세션 및 실행 중인 CLI를 종료하시겠습니까?`;
  }
  if (confirmModal) {
    confirmModal.classList.remove('hidden');
  }
}

export async function closeFolderSessionConfirmed() {
  const pendingId = getPendingCloseFolderId();
  if (!pendingId) return;

  const folderId = pendingId;
  setPendingCloseFolderId(null);

  const confirmModal = document.getElementById('confirm-modal');
  if (confirmModal) confirmModal.classList.add('hidden');

  const folders = getFolders();
  const folder = folders.find((f) => f.id === folderId);
  if (folder) {
    folder.isActive = false;
  }

  await window.api.killPty({ sessionId: folderId });

  const inst = termInstances[folderId];
  if (inst) {
    inst.isSpawned = false;
    inst.term.clear();
  }

  const activeFolders = folders.filter((f) => f.isActive);
  if (activeFolders.length > 0) {
    selectActiveFolder(activeFolders[0].id);
  } else {
    renderFolderCards();
    renderSessionTabs();
    renderWelcomeManual();
  }
}

export function removeFolderCard(folderId) {
  window.api.killPty({ sessionId: folderId });

  const terminalsWrapper = document.getElementById('terminals-wrapper');
  if (termInstances[folderId]) {
    try {
      if (termInstances[folderId].term) {
        termInstances[folderId].term.dispose();
      }
    } catch (e) {}
    if (termInstances[folderId].container && termInstances[folderId].container.parentNode) {
      terminalsWrapper.removeChild(termInstances[folderId].container);
    }
    delete termInstances[folderId];
  }

  let folders = getFolders();
  folders = folders.filter((f) => f.id !== folderId);
  setFolders(folders);

  let activeFolderId = getActiveFolderId();
  if (activeFolderId === folderId) {
    const activeFolders = folders.filter((f) => f.isActive);
    if (activeFolders.length > 0) {
      activeFolderId = activeFolders[0].id;
    } else if (folders.length > 0) {
      activeFolderId = folders[0].id;
    } else {
      activeFolderId = null;
    }
  }

  renderFolderCards();
  renderSessionTabs();

  if (activeFolderId) {
    selectActiveFolder(activeFolderId);
  } else {
    renderWelcomeManual();
  }

  saveAllConfig();
}

export function renderFolderCards() {
  syncInputValuesToFolders();
  const folderListContainer = document.getElementById('folder-list-container');
  if (!folderListContainer) return;
  folderListContainer.innerHTML = '';

  const folders = getFolders();
  const activeFolderId = getActiveFolderId();

  folders.forEach((folder) => {
    if (typeof folder.isExpanded === 'undefined') {
      folder.isExpanded = false;
    }

    const isSelected = folder.id === activeFolderId;
    const card = document.createElement('div');
    card.className = `folder-card ${isSelected ? 'active-selected' : ''} ${folder.isExpanded ? 'expanded' : 'collapsed'}`;
    card.setAttribute('data-folder-id', folder.id);

    const displayName = getFolderDisplayName(folder);
    const badgeText = getShortBadgeText(folder);
    const toggleIcon = folder.isExpanded ? '▼' : '▶';

    card.innerHTML = `
      <div class="folder-card-header" data-action="toggle-header">
        <span class="folder-toggle-icon" data-action="toggle-header">${toggleIcon}</span>
        <div class="folder-info" title="${folder.path}">
          <div class="status-dot ${folder.isActive ? 'active' : 'inactive'}" title="${folder.isActive ? t('sessionActiveDot') : t('sessionInactiveDot')}"></div>
          <span class="folder-badge-tag">${badgeText}</span>
          <div class="folder-name-group">
            <span class="folder-path-text">📁 ${displayName}</span>
          </div>
        </div>
        <div class="folder-card-header-actions">
          <button class="btn-card-launch-mini" data-action="launch" title="${t('launchBtnTitle')}">▶</button>
          <button class="btn-card-close-mini ${folder.isActive ? 'active' : 'disabled'}" data-action="close" title="${folder.isActive ? t('closeBtnTitleActive') : t('closeBtnTitleDisabled')}">⏹</button>
        </div>
      </div>

      <div class="folder-card-body ${folder.isExpanded ? '' : 'hidden'}">
        <div class="folder-card-subpath" title="${folder.path}">${folder.path}</div>
        <div class="folder-card-controls">
          <input type="text" class="folder-alias-input" data-action="alias-input" 
                 placeholder="${t('aliasPlaceholder')}" value="${folder.alias || ''}" spellcheck="false" autocomplete="off" />

          <select class="cli-select-sm" data-action="cli-change">
            <option value="claude" ${folder.cli === 'claude' ? 'selected' : ''}>Claude (claude)</option>
            <option value="antigravity" ${folder.cli === 'antigravity' ? 'selected' : ''}>Antigravity (agy)</option>
            <option value="codex" ${folder.cli === 'codex' ? 'selected' : ''}>Codex (codex)</option>
            <option value="etc" ${folder.cli === 'etc' ? 'selected' : ''}>Etc.. (${t('customInputLabel')})</option>
          </select>

          <input type="text" class="input-custom-sm ${folder.cli === 'etc' ? '' : 'hidden'}" 
                 data-action="custom-cmd" 
                 placeholder="${t('customCmdPlaceholder')}" 
                 value="${folder.customCommand || ''}" spellcheck="false" autocomplete="off" />
        </div>

        <div class="folder-card-actions">
          <button class="btn-card-action btn-card-delete-full" data-action="delete" title="${t('deleteFolderTitle')}">${t('deleteFolderBtn')}</button>
        </div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      const action = actionBtn ? actionBtn.getAttribute('data-action') : null;

      if (action === 'delete') {
        e.stopPropagation();
        e.preventDefault();
        removeFolderCard(folder.id);
      } else if (action === 'launch') {
        e.stopPropagation();
        e.preventDefault();
        launchFolderSession(folder.id);
      } else if (action === 'close') {
        e.stopPropagation();
        e.preventDefault();
        openCloseModal(folder.id);
      } else if (action === 'toggle-header') {
        e.stopPropagation();
        folder.isExpanded = !folder.isExpanded;
        selectActiveFolder(folder.id);
        renderFolderCards();
      } else {
        selectActiveFolder(folder.id);
      }
    });

    const aliasInputEl = card.querySelector('[data-action="alias-input"]');
    const cliSelectEl = card.querySelector('[data-action="cli-change"]');
    const customInputEl = card.querySelector('[data-action="custom-cmd"]');

    [aliasInputEl, cliSelectEl, customInputEl].forEach((el) => {
      if (!el) return;
      el.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('mousedown', (e) => e.stopPropagation());
      el.addEventListener('keydown', (e) => e.stopPropagation());
      el.addEventListener('keyup', (e) => e.stopPropagation());
    });

    aliasInputEl.addEventListener('input', (e) => {
      folder.alias = e.target.value;
      const nameTextEl = card.querySelector('.folder-path-text');
      const badgeTagEl = card.querySelector('.folder-badge-tag');
      
      if (nameTextEl) {
        nameTextEl.textContent = '📁 ' + getFolderDisplayName(folder);
      }
      if (badgeTagEl) {
        badgeTagEl.textContent = getShortBadgeText(folder);
      }
      debouncedRenderSessionTabs();
      debouncedSaveConfig();
    });

    cliSelectEl.addEventListener('change', (e) => {
      folder.cli = e.target.value;
      if (folder.cli === 'etc') {
        customInputEl.classList.remove('hidden');
      } else {
        customInputEl.classList.add('hidden');
      }
      debouncedSaveConfig();
    });

    customInputEl.addEventListener('input', (e) => {
      folder.customCommand = e.target.value;
      debouncedSaveConfig();
    });

    folderListContainer.appendChild(card);
  });
}

export function renderSessionTabs() {
  const sessionTabsBar = document.getElementById('session-tabs-bar');
  if (!sessionTabsBar) return;
  sessionTabsBar.innerHTML = '';

  const folders = getFolders();
  const activeFolderId = getActiveFolderId();
  const activeSessions = folders.filter((f) => f.isActive);

  activeSessions.forEach((folder) => {
    const isSelected = folder.id === activeFolderId;
    const tab = document.createElement('div');
    tab.className = `session-tab ${isSelected ? 'active' : ''}`;

    const displayName = getFolderDisplayName(folder);
    tab.title = `${displayName} (${folder.cli})`;

    if (!folder.usage) folder.usage = { tokens: 0, cost: 0.0, sessionQuota: null, weekQuota: null };

    const quotaText = getQuotaDisplayText(folder);

    tab.innerHTML = `
      <div class="tab-status-dot active"></div>
      <span class="tab-title-text">${displayName} (${folder.cli})</span>
      <span class="tab-usage-badge" title="현재 세션 Quota 한도">${quotaText}</span>
    `;

    tab.addEventListener('click', () => {
      selectActiveFolder(folder.id);
    });

    sessionTabsBar.appendChild(tab);
  });
}

export function debouncedRenderSessionTabs() {
  if (tabUsageUpdateTimer) clearTimeout(tabUsageUpdateTimer);
  tabUsageUpdateTimer = setTimeout(() => {
    renderSessionTabs();
  }, 200);
}
