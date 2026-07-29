// Multi-Folder Session State
let folders = []; // [{ id, path, alias, cli, customCommand, isActive: false, usage: { tokens: 0, cost: 0.0, sessionQuota: null, weekQuota: null } }]
let activeFolderId = null;
let pendingCloseFolderId = null;
let currentTheme = 'dark';
let currentLang = 'ko';

// Map of xterm instances: { [folderId]: { term, fitAddon, isSpawned, container } }
const termInstances = {};

// Welcome manual HTML element instance
let welcomeContainerInstance = null;

// i18n Translation Dictionary
const i18n = {
  ko: {
    sidebarTitle: '⚡ AI CLI Launcher',
    sidebarSubtitle: 'OS Shell Integration',
    toggleSidebarTitle: '사이드바 토글',
    addFolder: '작업 폴더 추가',
    checkUsage: '현재 사용량 확인하기',
    checkUsageTitle: '현재 계정 사용량(Quota) 확인하기',
    darkTheme: 'Dark 모드',
    lightTheme: 'Light 모드',
    themeToggleTitle: '테마 전환',
    langSelectTitle: '언어 변경 / Language',
    statusSyncing: '설정 자동 동기화 중',
    statusSyncTitle: '설정 자동 보존 (AppData + 실행 경로 이중 동기화)',
    saveConfigBtn: '설정 저장 (directory.json)',
    saveConfigTitle: '설정 저장 (directory.json)',
    extractChatBtn: '📝 대화 추출',
    extractChatTitle: '현재 세션의 전체 대화내용을 텍스트 파일로 순수 추출',
    reportPdfBtn: '📄 보고서 출력',
    reportPdfTitle: '현재 대화내용을 PDF 보고서로 추출',

    // Folder card
    aliasPlaceholder: '🏷️ 별칭 지정 (선택)',
    customCmdPlaceholder: '예: claude --verbose',
    customInputLabel: '직접 입력',
    launchBtn: '▶ 실행',
    launchBtnTitle: '이 위치에서 CLI 세션 시작',
    runningStatus: '● 실행 중',
    closeBtn: '⏹ 닫기',
    closeBtnTitleActive: '세션 닫기',
    closeBtnTitleDisabled: '실행 중인 세션 없음',
    deleteFolderTitle: '목록에서 삭제',
    deleteFolderBtn: '🗑️ 목록에서 삭제',
    sessionActiveDot: '세션 활성화 중 (초록색)',
    sessionInactiveDot: '세션 비활성화됨 (회색)',

    // Session Tabs
    welcomeTab: '사용 안내',

    // Modal
    modalCloseTitle: 'CLI 세션 종료 확인',
    modalCloseDesc: '실행 중인 세션을 종료하시겠습니까?',
    modalConfirm: '종료',
    modalCancel: '취소',

    // Alerts / Messages
    noActiveSession: '현재 실행 중인 세션이 없습니다.',
    sessionNotActive: '현재 선택된 세션이 실행 중이지 않습니다. 세션을 먼저 시작해 주세요.',
    noActiveSessionStartFirst: '활성화된 세션이 없습니다. 실행(▶) 버튼을 먼저 눌러 세션을 연결해 주세요.',
    noActiveSessionForReport: '활성화된 세션이 없습니다. 먼저 폴더 카드의 [▶ 실행] 버튼을 눌러 세션을 연결해 주세요.',
    noContentToExtract: '현재 세션에 추출할 대화 내용이 없습니다.',
    chatSavedSuccess: '현재 세션 대화 내용이 .md 파일로 저장되었습니다!\n\n저장 위치:\n',
    chatSavedError: '대화 추출 저장 중 오류가 발생했습니다: ',
    configSaveSuccess: '사용자 설정(directory.json)이 성공적으로 이중 보존되었습니다!\n\n저장 위치:\n',
    configSaveError: '설정 저장 중 오류가 발생했습니다.\n',

    // PTY start messages
    startingSession: 'PowerShell 세션 시작 중...',
    pathLabel: '경로',
    commandLabel: '실행 명령어',
    sessionLaunchFailed: '세션 실행 실패: ',

    // Welcome Manual
    welcomeHeader: 'ACL - 사용 안내 매뉴얼',
    welcomeStep1: '좌측 <span class="welcome-highlight">[➕ 작업 폴더 추가]</span> 버튼을 눌러 프로젝트 디렉토리를 등록합니다.',
    welcomeStep2: '원하는 AI CLI <span class="welcome-highlight">(Claude / Antigravity / Codex / Etc..)</span>를 선택합니다.',
    welcomeStep3: '폴더 카드의 <span class="welcome-highlight">[▶ 실행]</span> 버튼을 눌러 대화형 세션을 시작합니다.',
    welcomeStep4: '하단 <span class="welcome-highlight">[📊 현재 사용량 확인하기]</span> 버튼으로 플랜 한도(Quota %)를 실시간 체크합니다.',
    welcomeStep5: '상단 <span class="welcome-highlight">[📝 대화 추출]</span> / <span class="welcome-highlight">[📄 보고서 출력]</span> 버튼으로 대화 원문이나 PDF 보고서를 지정 폴더로 자동 저장합니다.',
    welcomeStep6: '하단 <span class="welcome-highlight">[🎨 테마 / 🌐 언어]</span> 설정으로 테마와 언어를 바꿀 수 있습니다 (터미널은 다크 고정).',
    welcomeNote: '📌 <strong>참고사항:</strong> claude가 제대로 구동되지 않는다면 환경변수 PATH에 <code>%USERPROFILE%\\.local\\bin</code> 경로를 추가해주세요.',
    welcomeTip: '💡 <strong>📝 대화 추출 & 📄 보고서 출력 기능:</strong><br> [📝 대화 추출] 버튼을 누르면 AI 호출 없이 현재 화면 텍스트 원문을 즉시 .md 파일로 추출 저장하며, <br>[📄 보고서 출력]은 대화 요약 PDF 문서를 자동 생성합니다.',
    welcomeFooter: '▶ 준비가 되시면 폴더 카드의 [▶ 실행] 버튼을 눌러 세션을 시작하세요!',
    welcomeCredits: '[제작 : 성현우 | GitHub: https://github.com/frost-ix]'
  },
  en: {
    sidebarTitle: '⚡ AI CLI Launcher',
    sidebarSubtitle: 'OS Shell Integration',
    toggleSidebarTitle: 'Toggle Sidebar',
    addFolder: 'Add Folder',
    checkUsage: 'Check Usage',
    checkUsageTitle: 'Check current account quota usage',
    darkTheme: 'Dark Mode',
    lightTheme: 'Light Mode',
    themeToggleTitle: 'Toggle Theme',
    langSelectTitle: 'Language / 언어 변경',
    statusSyncing: 'Auto-syncing config',
    statusSyncTitle: 'Auto-sync Config (AppData + Executable Path)',
    saveConfigBtn: 'Save Settings',
    saveConfigTitle: 'Save Settings',
    extractChatBtn: '📝 Extract Chat',
    extractChatTitle: 'Extract full conversation of current session as raw text file',
    reportPdfBtn: '📄 Export Report',
    reportPdfTitle: 'Export current conversation as PDF report',

    // Folder card
    aliasPlaceholder: '🏷️ Alias (Optional)',
    customCmdPlaceholder: 'e.g. claude --verbose',
    customInputLabel: 'Custom input',
    launchBtn: '▶ Run',
    launchBtnTitle: 'Start CLI Session in this directory',
    runningStatus: '● Running',
    closeBtn: '⏹ Stop',
    closeBtnTitleActive: 'Stop session',
    closeBtnTitleDisabled: 'No running session',
    deleteFolderTitle: 'Delete from list',
    deleteFolderBtn: '🗑️ Delete from list',
    sessionActiveDot: 'Session active (Green)',
    sessionInactiveDot: 'Session inactive (Gray)',

    // Session Tabs
    welcomeTab: 'User Guide',

    // Modal
    modalCloseTitle: 'Confirm Session Termination',
    modalCloseDesc: 'Are you sure you want to terminate the running CLI session?',
    modalConfirm: 'Terminate',
    modalCancel: 'Cancel',

    // Alerts / Messages
    noActiveSession: 'There are no active sessions running.',
    sessionNotActive: 'The selected session is not active. Please start the session first.',
    noActiveSessionStartFirst: 'No active session. Please click the [▶ Run] button first to connect a session.',
    noActiveSessionForReport: 'No active session. Please click the [▶ Run] button on a folder card to connect a session.',
    noContentToExtract: 'No conversation text available to extract in the current session.',
    chatSavedSuccess: 'Current session conversation log has been saved as a .md file!\n\nSaved at:\n',
    chatSavedError: 'An error occurred while saving conversation log: ',
    configSaveSuccess: 'User settings (directory.json) have been saved successfully!\n\nSaved at:\n',
    configSaveError: 'An error occurred while saving settings.\n',

    // PTY start messages
    startingSession: 'Starting PowerShell Session...',
    pathLabel: 'Path',
    commandLabel: 'Command',
    sessionLaunchFailed: 'Session Launch Failed: ',

    // Welcome Manual
    welcomeHeader: 'ACL - User Guide',
    welcomeStep1: 'Click the left <span class="welcome-highlight">[➕ Add Folder]</span> button to register project directories.',
    welcomeStep2: 'Select your preferred AI CLI <span class="welcome-highlight">(Claude / Antigravity / Codex / Etc..)</span>.',
    welcomeStep3: 'Click the <span class="welcome-highlight">[▶ Run]</span> button on the folder card to start an interactive session.',
    welcomeStep4: 'Use the bottom <span class="welcome-highlight">[📊 Check Usage]</span> button to monitor plan quotas (Quota %) in real time.',
    welcomeStep5: 'Use the top <span class="welcome-highlight">[📝 Extract Chat]</span> / <span class="welcome-highlight">[📄 Export Report]</span> buttons to save raw chat or PDF reports.',
    welcomeStep6: 'Customize appearance and language using the bottom <span class="welcome-highlight">[🎨 Theme / 🌐 Language]</span> controls.',
    welcomeNote: '📌 <strong>Note:</strong> If Claude fails to run, add <code>%USERPROFILE%\\.local\\bin</code> to your PATH environment variable.',
    welcomeTip: '💡 <strong>📝 Extract Chat & 📄 Export Report:</strong><br> [📝 Extract Chat] instantly exports current terminal buffer text into a .md file without AI calls, while <br>[📄 Export Report] generates a PDF document summary.',
    welcomeFooter: '▶ When ready, click [▶ Run] on a folder card to launch a session!',
    welcomeCredits: '[Author: Sung Hyunwoo | GitHub: https://github.com/frost-ix]'
  }
};

function t(key) {
  return (i18n[currentLang] && i18n[currentLang][key]) || (i18n['ko'][key] || key);
}

// Debounce & Animation Frame Timers
let resizeDebounceTimer = null;
let saveDebounceTimer = null;
let tabUsageUpdateTimer = null;
let resizerAnimationFrame = null;

// Track usage checking in progress flag per session
const isCheckingUsageMap = {};
const hasAutoCheckedUsageMap = {};

// CLI Command Resolver
function getCommandToRun(cli, customCmd) {
  switch (cli) {
    case 'claude':
      return 'claude';
    case 'antigravity':
      return 'agy';
    case 'codex':
      return 'codex';
    case 'etc':
      return customCmd || '';
    default:
      return '';
  }
}

// Synchronize existing input values from DOM to folders data model before re-rendering
function syncInputValuesToFolders() {
  if (!folderListContainer) return;
  const cards = folderListContainer.querySelectorAll('.folder-card');
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

// Token & Quota Helper Functions
function estimateTokensFromText(text) {
  if (!text) return 0;
  const cleanText = text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
  let count = 0;
  for (let i = 0; i < cleanText.length; i++) {
    const code = cleanText.charCodeAt(i);
    if (code > 0x0700) {
      count += 1.5;
    } else {
      count += 0.25;
    }
  }
  return Math.ceil(count);
}

// Format Quota Limit Display for Tabs (Supports Claude, Antigravity & Codex)
function getQuotaDisplayText(folder) {
  if (!folder || !folder.usage) return 'Quota: 0%';

  const { sessionQuota, weekQuota, geminiQuota, claudeQuota, tokens } = folder.usage;

  // Antigravity CLI Quota Display (Gemini & Claude/GPT groups)
  if (typeof geminiQuota === 'number' && typeof claudeQuota === 'number') {
    return `Gem: ${geminiQuota}% | Cld: ${claudeQuota}%`;
  }
  if (typeof geminiQuota === 'number') {
    return `Gem: ${geminiQuota}%`;
  }
  if (typeof claudeQuota === 'number') {
    return `Cld: ${claudeQuota}%`;
  }

  // Claude & Codex CLI Quota Display (5h Limit & Weekly Limit)
  if (typeof sessionQuota === 'number' && typeof weekQuota === 'number') {
    return `5h: ${sessionQuota}% | Wk: ${weekQuota}%`;
  }
  if (typeof sessionQuota === 'number') {
    return `5h: ${sessionQuota}%`;
  }
  if (typeof weekQuota === 'number') {
    return `Wk: ${weekQuota}%`;
  }

  // Estimated Quota % fallback
  const estimatedPercent = Math.min(100, Math.ceil((tokens / 200000) * 100));
  return `Quota: ${estimatedPercent}%`;
}

// Elements
const sidebar = document.getElementById('sidebar');
const sidebarResizer = document.getElementById('sidebar-resizer');
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const folderListContainer = document.getElementById('folder-list-container');
const btnAddFolder = document.getElementById('btn-add-folder');
const btnCheckUsage = document.getElementById('btn-check-usage');
const btnSave = document.getElementById('btn-save');
const sessionTabsBar = document.getElementById('session-tabs-bar');
const terminalsWrapper = document.getElementById('terminals-wrapper');
const btnExportReport = document.getElementById('btn-export-report');
const btnExtractChat = document.getElementById('btn-extract-chat');

// Theme Elements
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const themeIcon = document.getElementById('theme-icon');
const themeText = document.getElementById('theme-text');
const selectLang = document.getElementById('select-lang');

// Modal Elements
const confirmModal = document.getElementById('confirm-modal');
const modalSessionDesc = document.getElementById('modal-session-desc');
const modalBtnConfirm = document.getElementById('modal-btn-confirm');
const modalBtnCancel = document.getElementById('modal-btn-cancel');

// --- Helper Functions ---

function getFolderBasename(folderPath) {
  if (!folderPath) return 'New Folder';
  const parts = folderPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || folderPath;
}

function getFolderDisplayName(folder) {
  if (folder.alias && folder.alias.trim().length > 0) {
    return folder.alias.trim();
  }
  return getFolderBasename(folder.path);
}

function getShortBadgeText(folder) {
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

// --- Theme Management ---

function applyTheme(theme) {
  currentTheme = theme === 'light' ? 'light' : 'dark';
  document.body.className = 'theme-' + currentTheme;

  if (currentTheme === 'light') {
    themeIcon.textContent = '☀️';
    themeText.textContent = t('lightTheme');
  } else {
    themeIcon.textContent = '🌙';
    themeText.textContent = t('darkTheme');
  }

  const darkThemeOptions = {
    background: '#090d16',
    foreground: '#f8fafc',
    cursor: '#3b82f6',
    selectionBackground: '#334155',
  };

  const updateXtermTheme = (inst) => {
    if (inst && inst.term) {
      inst.term.options.theme = darkThemeOptions;
    }
  };

  Object.keys(termInstances).forEach((id) => updateXtermTheme(termInstances[id]));
}

function toggleTheme() {
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
  saveAllConfig();
}

function updateUILanguage() {
  const btnAddFolderSpan = btnAddFolder ? btnAddFolder.querySelector('.sidebar-text') : null;
  if (btnAddFolderSpan) btnAddFolderSpan.textContent = t('addFolder');

  if (btnCheckUsage) {
    const btnCheckUsageSpan = btnCheckUsage.querySelector('.sidebar-text');
    if (btnCheckUsageSpan) btnCheckUsageSpan.textContent = t('checkUsage');
    btnCheckUsage.title = t('checkUsageTitle');
  }

  if (themeText) {
    themeText.textContent = currentTheme === 'dark' ? t('darkTheme') : t('lightTheme');
  }
  if (btnThemeToggle) btnThemeToggle.title = t('themeToggleTitle');

  if (selectLang) {
    selectLang.value = currentLang;
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

  if (welcomeContainerInstance && welcomeContainerInstance.style.display !== 'none') {
    renderWelcomeManual(true);
  }
}

async function saveAllConfig() {
  syncInputValuesToFolders(); // Sync data before saving
  const configToSave = {
    theme: currentTheme,
    lang: currentLang,
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

function debouncedSaveConfig() {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    saveAllConfig();
  }, 300);
}

// Dynamic Terminal Resize Function
function fitAndResizeTerminal(folderId) {
  if (!folderId || folderId === 'welcome') return;

  const inst = termInstances[folderId];
  if (!inst || !inst.fitAddon || !inst.term) return;

  try {
    inst.fitAddon.fit();
    const cols = inst.term.cols;
    const rows = inst.term.rows;

    if (cols > 0 && rows > 0) {
      const safeRows = Math.max(1, rows - 1);
      inst.term.resize(cols, safeRows);
      window.api.resizePty({ sessionId: folderId, cols, rows: safeRows });
    }
  } catch (err) {
    // Ignore layout shift errors
  }
}

function debouncedFitAndResize(folderId) {
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(() => {
    fitAndResizeTerminal(folderId);
  }, 40);
}

// Create & Render HTML Centered Welcome Manual Container (FINAL FIXED MANUAL TEXT)
function renderWelcomeManual(force = false) {
  if (!welcomeContainerInstance || force) {
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

    if (welcomeContainerInstance && force) {
      welcomeContainerInstance.innerHTML = manualCardHTML;
    } else if (!welcomeContainerInstance) {
      const welcomeDiv = document.createElement('div');
      welcomeDiv.className = 'terminal-instance welcome-manual-container';
      welcomeDiv.id = 'term-container-welcome';
      welcomeDiv.innerHTML = manualCardHTML;
      terminalsWrapper.appendChild(welcomeDiv);
      welcomeContainerInstance = welcomeDiv;
    }
  }

  Object.keys(termInstances).forEach((id) => {
    const inst = termInstances[id];
    inst.container.classList.remove('active');
    inst.container.style.display = 'none';
  });

  welcomeContainerInstance.style.display = 'flex';
  welcomeContainerInstance.classList.add('active');
}

// --- Terminal Instance Management ---

function createTerminalInstance(folderId) {
  if (termInstances[folderId]) return termInstances[folderId];

  const termContainer = document.createElement('div');
  termContainer.className = 'terminal-instance';
  termContainer.id = `term-container-${folderId}`;
  termContainer.style.display = 'none';
  terminalsWrapper.appendChild(termContainer);

  const TerminalClass = window.Terminal;
  const FitAddonClass = (window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon;

  const term = new TerminalClass({
    cursorBlink: true,
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 14,
    scrollback: 100000,
    theme: {
      background: '#090d16',
      foreground: '#f8fafc',
      cursor: '#3b82f6',
      selectionBackground: '#334155',
    },
  });

  let fitAddon = null;
  if (FitAddonClass) {
    fitAddon = new FitAddonClass();
    term.loadAddon(fitAddon);
  }

  term.open(termContainer);

  term.onData((data) => {
    window.api.writePty({ sessionId: folderId, data });
    const folder = folders.find((f) => f.id === folderId);
    if (folder) {
      if (!folder.usage) folder.usage = { tokens: 0, cost: 0.0, sessionQuota: null, weekQuota: null };
      const addedTokens = estimateTokensFromText(data);
      folder.usage.tokens += addedTokens;
      debouncedRenderSessionTabs();
    }
  });

  termInstances[folderId] = {
    term,
    fitAddon,
    isSpawned: false,
    container: termContainer,
    sessionRawText: '',
  };

  if (window.ResizeObserver) {
    const observer = new ResizeObserver(() => {
      if (activeFolderId === folderId && !sidebar.classList.contains('is-resizing')) {
        debouncedFitAndResize(folderId);
      }
    });
    observer.observe(termContainer);
  }

  return termInstances[folderId];
}

function selectActiveFolder(folderId, isLaunching = false) {
  activeFolderId = folderId;

  // Update selection CSS class on folder cards without re-rendering to preserve input state
  const allCards = folderListContainer.querySelectorAll('.folder-card');
  allCards.forEach((c) => {
    if (c.getAttribute('data-folder-id') === folderId) {
      c.classList.add('active-selected');
    } else {
      c.classList.remove('active-selected');
    }
  });

  renderSessionTabs();

  const targetFolder = folders.find((f) => f.id === folderId);
  const hasAnyActiveSession = folders.some((f) => f.isActive);

  if (!hasAnyActiveSession && !isLaunching && (!targetFolder || !targetFolder.isActive)) {
    renderWelcomeManual();
    return;
  }

  if (welcomeContainerInstance) {
    welcomeContainerInstance.classList.remove('active');
    welcomeContainerInstance.style.display = 'none';
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

// --- PTY Session Operations ---

async function launchFolderSession(folderId) {
  syncInputValuesToFolders(); // Sync inputs first
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return;

  // Clean kill previous PTY session process if already running before respawning
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

    // Reset automatic usage check flag for event-driven detection
    hasAutoCheckedUsageMap[folderId] = false;

    // Guaranteed Backup Timeouts for Usage Check (Handles slower CLI load times / sign ins)
    const scheduleBackupCheck = (delayMs) => {
      setTimeout(() => {
        if (!folder.isActive) return;
        const hasParsedQuota = folder.usage && (
          typeof folder.usage.sessionQuota === 'number' ||
          typeof folder.usage.weekQuota === 'number' ||
          typeof folder.usage.geminiQuota === 'number' ||
          typeof folder.usage.claudeQuota === 'number'
        );
        if (!hasParsedQuota && !hasAutoCheckedUsageMap[folderId] && !isCheckingUsageMap[folderId]) {
          hasAutoCheckedUsageMap[folderId] = true;
          triggerUsageCheckForSession(folderId, false);
        }
      }, delayMs);
    };

    scheduleBackupCheck(4000);
    scheduleBackupCheck(7500);
  } else {
    folder.isActive = false;
    inst.term.write(`\x1b[31m[${t('sessionLaunchFailed')}${result.error}]\x1b[0m\r\n`);
  }

  renderFolderCards();
  selectActiveFolder(folderId);
  debouncedSaveConfig();
}

function openCloseModal(folderId) {
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return;

  if (!folder.isActive) {
    alert(t('noActiveSession'));
    return;
  }

  pendingCloseFolderId = folderId;
  const displayName = getFolderDisplayName(folder);
  const cliName = folder.cli.toUpperCase();

  modalSessionDesc.textContent = currentLang === 'en'
    ? `Are you sure you want to terminate [${displayName}] (${cliName}) session and running CLI?`
    : `[${displayName}] (${cliName}) 세션 및 실행 중인 CLI를 종료하시겠습니까?`;
  confirmModal.classList.remove('hidden');
}

async function closeFolderSessionConfirmed() {
  if (!pendingCloseFolderId) return;

  const folderId = pendingCloseFolderId;
  pendingCloseFolderId = null;
  confirmModal.classList.add('hidden');

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

function removeFolderCard(folderId) {
  window.api.killPty({ sessionId: folderId });

  if (termInstances[folderId]) {
    try {
      if (termInstances[folderId].term) {
        termInstances[folderId].term.dispose();
      }
    } catch (e) {}
    terminalsWrapper.removeChild(termInstances[folderId].container);
    delete termInstances[folderId];
  }

  folders = folders.filter((f) => f.id !== folderId);

  const activeFolders = folders.filter((f) => f.isActive);
  if (activeFolders.length > 0) {
    selectActiveFolder(activeFolders[0].id);
  } else {
    activeFolderId = folders.length > 0 ? folders[0].id : null;
    renderFolderCards();
    renderSessionTabs();
    renderWelcomeManual();
  }

  debouncedSaveConfig();
}

// --- Trigger Manual / Auto Usage Check & Auto ESC Cancel Return ---
function triggerUsageCheckForSession(sessionId, isManual = false) {
  if (!sessionId) return;

  const folder = folders.find((f) => f.id === sessionId);
  if (!folder || !folder.isActive) {
    if (isManual) {
      alert(t('sessionNotActive'));
    }
    return;
  }

  // Prevent multiple concurrent checks on the same session
  if (isCheckingUsageMap[sessionId]) return;

  isCheckingUsageMap[sessionId] = true;

  const rawCmd = (folder.cli === 'codex') ? '/status' : '/usage';

  // 1. Send command text first
  window.api.writePty({ sessionId, data: rawCmd });

  // 2. Send Enter (\r) after 100ms delay so TUI accepts the submission
  setTimeout(() => {
    window.api.writePty({ sessionId, data: '\r' });
  }, 100);

  // 3. Send ESC (\x1b) after delay to close TUI overlay cleanly after rendering
  const delay = (folder.cli === 'antigravity' || folder.cli === 'codex') ? 1400 : 950;

  setTimeout(() => {
    window.api.writePty({ sessionId, data: '\x1b' });
    isCheckingUsageMap[sessionId] = false;
  }, delay);
}

function triggerManualUsageCheck() {
  if (!activeFolderId) {
    alert(t('noActiveSessionStartFirst'));
    return;
  }
  triggerUsageCheckForSession(activeFolderId, true);
}

// --- Export Conversation Report as PDF to Specified Folder ---
async function exportConversationReportPDF() {
  if (!activeFolderId) {
    alert(t('noActiveSessionForReport'));
    return;
  }

  const folder = folders.find((f) => f.id === activeFolderId);
  if (!folder || !folder.isActive) {
    alert(t('sessionNotActive'));
    return;
  }

  const selectedPath = await window.api.openFolder();
  if (!selectedPath) return;

  // 1. Remove Focus from Export Button & Focus Active Terminal
  if (btnExportReport) btnExportReport.blur();
  const inst = termInstances[activeFolderId];
  if (inst && inst.term) {
    inst.term.focus();
  }

  const normalizedPath = selectedPath.replace(/\\/g, '/');
  // High-speed, Token-minimized & Clean PDF Report Prompt
  const promptText = currentLang === 'en'
    ? `Please summarize the current conversation concisely into key points and generate a PDF report file in the "${normalizedPath}" folder immediately. (Bullet points only, omit extra explanations)`
    : `현재 대화 내용을 핵심 위주로 명확히 요약하여 "${normalizedPath}" 폴더에 PDF 보고서 파일로 즉시 생성해줘. (단답형 핵심 작성, 부연설명 생략)`;

  // 2. Write Prompt Text first
  await window.api.writePty({ sessionId: activeFolderId, data: promptText });

  // 3. Immediately trigger Enter (\r) to execute prompt submission automatically
  setTimeout(() => {
    window.api.writePty({ sessionId: activeFolderId, data: '\r' });
    if (inst && inst.term) {
      inst.term.focus();
    }
  }, 60);
}

// Extract raw text from xterm buffer (all lines since CLI session opened, excluding PowerShell startup headers)
function getTerminalBufferText(folderId) {
  const inst = termInstances[folderId];
  if (!inst) return '';

  let textLines = [];

  if (inst.term && inst.term.buffer) {
    const buffer = inst.term.buffer.normal || inst.term.buffer.active;
    if (buffer) {
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i);
        if (!line) continue;

        const lineStr = line.translateToString(true);

        // Handle line wrapping: concatenate continuation lines without extra newlines
        if (line.isWrapped && textLines.length > 0) {
          textLines[textLines.length - 1] += lineStr;
        } else {
          textLines.push(lineStr);
        }
      }
    }
  }

  let resultLines = textLines;

  // Fallback to accumulated sessionRawText (with ANSI escape codes stripped) if buffer text is empty
  if (resultLines.length === 0 && inst.sessionRawText) {
    const cleanRaw = inst.sessionRawText
      .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
    resultLines = cleanRaw.split('\n');
  }

  // Filter out PowerShell startup headers & launch command prompts so extraction starts strictly when CLI opens
  let cliStartIndex = 0;
  for (let i = 0; i < resultLines.length; i++) {
    const trimmed = resultLines[i].trim();

    const isPowerShellStartup =
      trimmed.includes('[PowerShell 세션 시작 중...]') ||
      trimmed.startsWith('경로:') ||
      trimmed.startsWith('실행 명령어:') ||
      trimmed.includes('Windows PowerShell') ||
      trimmed.includes('Copyright (C) Microsoft Corporation') ||
      trimmed.includes('All rights reserved.') ||
      trimmed.includes('Try the new cross-platform PowerShell') ||
      trimmed.includes('Install the latest PowerShell') ||
      /^PS\s+[A-Za-z]:\\.*?>/i.test(trimmed);

    if (isPowerShellStartup) {
      cliStartIndex = i + 1;
    } else if (trimmed.length > 0) {
      break;
    }
  }

  let filteredLines = resultLines.slice(cliStartIndex);

  // Clean leading blank lines
  while (filteredLines.length > 0 && filteredLines[0].trim() === '') {
    filteredLines.shift();
  }

  // Clean trailing blank lines
  while (filteredLines.length > 0 && filteredLines[filteredLines.length - 1].trim() === '') {
    filteredLines.pop();
  }

  return filteredLines.join('\n');
}

// --- Export Raw Chat Conversation Content to Specified Folder ---
async function exportConversationChatRaw() {
  if (!activeFolderId) {
    alert(t('noActiveSessionStartFirst'));
    return;
  }

  const folder = folders.find((f) => f.id === activeFolderId);
  if (!folder) return;

  const rawText = getTerminalBufferText(activeFolderId);
  if (!rawText || rawText.trim().length === 0) {
    alert(t('noContentToExtract'));
    return;
  }

  const selectedPath = await window.api.openFolder();
  if (!selectedPath) return;

  // 1. Remove Focus from Extract Button & Focus Active Terminal
  if (btnExtractChat) btnExtractChat.blur();
  const inst = termInstances[activeFolderId];
  if (inst && inst.term) {
    inst.term.focus();
  }

  const displayName = getFolderDisplayName(folder).replace(/[\/\\:\*\?"<>\|]/g, '_');
  const now = new Date();
  const dateStr = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') + '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');

  const filename = currentLang === 'en'
    ? `${displayName}_ChatExtract_${dateStr}.md`
    : `${displayName}_대화추출_${dateStr}.md`;

  const mdContent = `# AI CLI PowerShell Session Raw Extract
- Folder: ${folder.path}
- Timestamp: ${now.toLocaleString()}
- CLI: ${folder.cli}

\`\`\`text
${rawText}
\`\`\`
`;

  const res = await window.api.saveExportFile({
    folderPath: selectedPath,
    filename: filename,
    content: mdContent,
  });

  if (res && res.success) {
    alert(`${t('chatSavedSuccess')}${res.filePath}`);
  } else {
    alert(`${t('chatSavedError')}${res && res.error ? res.error : ''}`);
  }
}

// --- Render Functions ---

function renderFolderCards() {
  syncInputValuesToFolders(); // Always preserve existing input values before re-rendering
  folderListContainer.innerHTML = '';

  folders.forEach((folder) => {
    // Default accordion state: closed (isExpanded = false)
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

    // Precision Input Event Handler for Alias without full re-rendering
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

function renderSessionTabs() {
  sessionTabsBar.innerHTML = '';

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

function debouncedRenderSessionTabs() {
  if (tabUsageUpdateTimer) clearTimeout(tabUsageUpdateTimer);
  tabUsageUpdateTimer = setTimeout(() => {
    renderSessionTabs();
  }, 200);
}

// --- IPC Data Listeners & Official Claude /usage Quota Parser ---

window.api.onPtyData(({ sessionId, data }) => {
  const inst = termInstances[sessionId];
  if (inst) {
    if (inst.term) inst.term.write(data);
    if (typeof inst.sessionRawText === 'string') {
      inst.sessionRawText += data;
    } else {
      inst.sessionRawText = data;
    }
  }

  const folder = folders.find((f) => f.id === sessionId);
  if (folder) {
    if (!folder.usage) folder.usage = { tokens: 0, cost: 0.0, sessionQuota: null, weekQuota: null };
    
    const cleanData = data.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

    // CLI-specific Quota Parsers

    // 1. Antigravity Models & Quota Parser (/usage - Reverse Remaining % to Used % so it starts from 0% like Claude)
    if (folder.cli === 'antigravity') {
      const geminiMatch = cleanData.match(/GEMINI\s*MODELS[\s\S]*?Weekly\s*Limit[\s\S]*?([0-9.]+)\s*%/i);
      if (geminiMatch && geminiMatch[1]) {
        const remaining = parseFloat(geminiMatch[1]);
        folder.usage.geminiQuota = Math.max(0, Math.min(100, Math.round(100 - remaining)));
      } else {
        const gemRem = cleanData.match(/([0-9.]+)\s*%\s*remaining/i);
        if (gemRem && gemRem[1]) {
          const remaining = parseFloat(gemRem[1]);
          folder.usage.geminiQuota = Math.max(0, Math.min(100, Math.round(100 - remaining)));
        }
      }

      const claudeGptMatch = cleanData.match(/CLAUDE\s*(?:AND|&)\s*GPT\s*MODELS[\s\S]*?Weekly\s*Limit[\s\S]*?([0-9.]+)\s*%/i);
      if (claudeGptMatch && claudeGptMatch[1]) {
        const remaining = parseFloat(claudeGptMatch[1]);
        folder.usage.claudeQuota = Math.max(0, Math.min(100, Math.round(100 - remaining)));
      }
    }

    // 2. Codex Usage Limits Parser (/status)
    if (folder.cli === 'codex') {
      const codex5h = cleanData.match(/5h\s*limit\s*:\s*\[[^\]]*\]\s*([0-9]{1,3})%\s*used/i);
      if (codex5h && codex5h[1]) {
        folder.usage.sessionQuota = parseInt(codex5h[1], 10);
      }

      const codexWk = cleanData.match(/Weekly\s*limit\s*:\s*\[[^\]]*\]\s*([0-9]{1,3})%\s*used/i);
      if (codexWk && codexWk[1]) {
        folder.usage.weekQuota = parseInt(codexWk[1], 10);
      }
    }

    // 3. Claude Session & Weekly Quota Parser (/usage)
    const sessionMatch = cleanData.match(/(?:5시간\s*한도|Current\s*session)[^0-9]*([0-9]{1,3})%/i);
    if (sessionMatch && sessionMatch[1]) {
      folder.usage.sessionQuota = parseInt(sessionMatch[1], 10);
    }

    const weekMatch = cleanData.match(/(?:주간\s*·?\s*전체\s*모델|Current\s*week\s*\(All\s*models\)|Current\s*week)[^0-9]*([0-9]{1,3})%/i);
    if (weekMatch && weekMatch[1]) {
      folder.usage.weekQuota = parseInt(weekMatch[1], 10);
    }

    // Generic % parser fallback
    if (folder.usage.sessionQuota === null && folder.usage.weekQuota === null && folder.usage.geminiQuota === undefined) {
      const genericMatch = cleanData.match(/([0-9]{1,3})%\s*(?:한도|사용량|quota|limit|used)/i);
      if (genericMatch && genericMatch[1]) {
        folder.usage.sessionQuota = parseInt(genericMatch[1], 10);
      }
    }

    // Event-driven automatic usage check trigger upon CLI completion load (signing in aware)
    if (!hasAutoCheckedUsageMap[sessionId] && !isCheckingUsageMap[sessionId]) {
      const isSigningIn = /signing\s*in/i.test(cleanData) || /authenticating/i.test(cleanData);
      let isCliLoaded = false;

      if (!isSigningIn) {
        if (folder.cli === 'claude') {
          isCliLoaded = /Claude\s*Code\s*v/i.test(cleanData) ||
                        /Welcome\s*back/i.test(cleanData) ||
                        /Tips\s*for\s*getting\s*started/i.test(cleanData) ||
                        /shift\+tab\s*to\s*cycle/i.test(cleanData) ||
                        /plan\s*mode/i.test(cleanData) ||
                        />\s*$/m.test(cleanData) ||
                        /claude/i.test(cleanData);
        } else if (folder.cli === 'antigravity') {
          isCliLoaded = /Antigravity\s*CLI/i.test(cleanData) ||
                        /Google\s*AI/i.test(cleanData) ||
                        /Gemini\s*3\./i.test(cleanData) ||
                        /\?\s*for\s*shortcuts/i.test(cleanData) ||
                        /Models\s*&\s*Quota/i.test(cleanData) ||
                        /GEMINI\s*MODELS/i.test(cleanData) ||
                        /type\s*\/[a-z]+/i.test(cleanData);
        } else if (folder.cli === 'codex') {
          isCliLoaded = /OpenAI\s*Codex/i.test(cleanData) ||
                        /To\s*get\s*started/i.test(cleanData) ||
                        /\/status\s*–/i.test(cleanData) ||
                        /\/approvals/i.test(cleanData) ||
                        /Token\s*Usage/i.test(cleanData) ||
                        /Usage\s*Limits/i.test(cleanData) ||
                        /5h\s*limit/i.test(cleanData);
        } else {
          isCliLoaded = cleanData.length > 30;
        }
      }

      if (isCliLoaded && !hasAutoCheckedUsageMap[sessionId] && !isCheckingUsageMap[sessionId]) {
        hasAutoCheckedUsageMap[sessionId] = true;
        // Wait for CLI interactive TUI prompt to finish loading event listeners
        const initDelay = (folder.cli === 'antigravity' || folder.cli === 'codex') ? 1400 : 950;
        setTimeout(() => {
          if (folder.isActive) {
            triggerUsageCheckForSession(sessionId, false);
          }
        }, initDelay);
      }
    }

    const addedTokens = estimateTokensFromText(data);
    folder.usage.tokens += addedTokens;

    debouncedRenderSessionTabs();
  }
});

window.api.onPtyExit(({ sessionId, exitCode }) => {
  const folder = folders.find((f) => f.id === sessionId);
  if (folder) {
    folder.isActive = false;
  }
  const inst = termInstances[sessionId];
  if (inst) {
    inst.isSpawned = false;
  }
  renderFolderCards();
  renderSessionTabs();

  const activeSessions = folders.filter((f) => f.isActive);
  if (activeSessions.length === 0) {
    renderWelcomeManual();
  }
});

// Window Resize Event
window.addEventListener('resize', () => {
  const activeSessions = folders.filter((f) => f.isActive);
  if (activeSessions.length === 0) {
    // Centered HTML manual handles resize
  } else if (activeFolderId) {
    debouncedFitAndResize(activeFolderId);
  }
});

// --- Mouse Drag Resizer Logic ---
function initSidebarResizer() {
  let isResizing = false;

  sidebarResizer.addEventListener('mousedown', (e) => {
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
        btnToggleSidebar.textContent = '▶';
      } else {
        sidebar.classList.remove('collapsed');
        const clampedWidth = Math.max(260, Math.min(newWidth, maxAllowedWidth));
        sidebar.style.width = `${clampedWidth}px`;
        btnToggleSidebar.textContent = '◀';
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

      const activeCount = folders.filter((f) => f.isActive);
      if (activeCount.length === 0) {
        // Welcome manual handles resize
      } else if (activeFolderId) {
        fitAndResizeTerminal(folderId);
      }
    }
  });
}

// --- Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
  const config = await window.api.loadConfig();

  if (config && config.lang) {
    currentLang = config.lang;
  } else {
    currentLang = 'ko';
  }

  if (config && config.theme) {
    applyTheme(config.theme);
  } else {
    applyTheme('dark');
  }

  updateUILanguage();

  if (config && config.folders && config.folders.length > 0) {
    folders = config.folders.map((f) => ({
      id: f.id || 'folder_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      path: f.path || 'C:\\',
      alias: f.alias || '',
      cli: f.cli || 'claude',
      customCommand: f.customCommand || '',
      isActive: false,
      usage: { tokens: 0, cost: 0.0, sessionQuota: null, weekQuota: null },
    }));
  } else {
    folders = [
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

  folders.forEach((f) => {
    createTerminalInstance(f.id);
  });

  renderFolderCards();
  renderSessionTabs();
  initSidebarResizer();

  const activeSessions = folders.filter((f) => f.isActive);
  if (activeSessions.length === 0) {
    renderWelcomeManual();
  } else if (folders.length > 0) {
    selectActiveFolder(folders[0].id);
  }

  if (window.ResizeObserver) {
    const mainObserver = new ResizeObserver(() => {
      if (!sidebar.classList.contains('is-resizing')) {
        const activeCount = folders.filter((f) => f.isActive).length;
        if (activeCount === 0) {
          // Centered HTML manual handles resize
        } else if (activeFolderId) {
          debouncedFitAndResize(activeFolderId);
        }
      }
    });
    mainObserver.observe(terminalsWrapper);
  }

  // Toggle button event
  btnToggleSidebar.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    sidebar.style.width = '';
    const isCollapsed = sidebar.classList.contains('collapsed');
    btnToggleSidebar.textContent = isCollapsed ? '▶' : '◀';

    setTimeout(() => {
      const activeCount = folders.filter((f) => f.isActive);
      if (activeCount.length === 0) {
        // Welcome manual handles resize
      } else if (activeFolderId) {
        fitAndResizeTerminal(activeFolderId);
      }
    }, 50);
  });

  // Theme Toggle Event
  btnThemeToggle.addEventListener('click', () => {
    toggleTheme();
  });

  // Language Select Event
  if (selectLang) {
    selectLang.value = currentLang;
    selectLang.addEventListener('change', (e) => {
      currentLang = e.target.value;
      updateUILanguage();
      saveAllConfig();
    });
  }

  // Usage Check Button Event
  btnCheckUsage.addEventListener('click', () => {
    triggerManualUsageCheck();
  });

  // Export PDF Report Button Event
  btnExportReport.addEventListener('click', () => {
    exportConversationReportPDF();
  });

  // Extract Raw Chat Button Event
  if (btnExtractChat) {
    btnExtractChat.addEventListener('click', () => {
      exportConversationChatRaw();
    });
  }

  btnAddFolder.addEventListener('click', async () => {
    syncInputValuesToFolders(); // Sync before adding
    const selectedPath = await window.api.openFolder();
    if (selectedPath) {
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
      createTerminalInstance(newId);
      renderFolderCards();
      saveAllConfig();
    }
  });

  btnSave.addEventListener('click', async () => {
    const res = await saveAllConfig();
    if (res && res.success) {
      alert(`${t('configSaveSuccess')}${res.path}`);
    } else {
      alert(`${t('configSaveError')}${res && res.error ? res.error : ''}`);
    }
  });

  modalBtnCancel.addEventListener('click', () => {
    pendingCloseFolderId = null;
    confirmModal.classList.add('hidden');
  });

  modalBtnConfirm.addEventListener('click', () => {
    closeFolderSessionConfirmed();
  });

  // Save Config on App Exit Interception
  if (window.api && window.api.onSaveBeforeQuit) {
    window.api.onSaveBeforeQuit(async () => {
      await saveAllConfig();
      if (window.api.confirmQuit) {
        window.api.confirmQuit();
      }
    });
  }
});
