// Multi-Folder Session State
let folders = []; // [{ id, path, alias, cli, customCommand, isActive: false, usage: { tokens: 0, cost: 0.0, sessionQuota: null, weekQuota: null } }]
let activeFolderId = null;
let pendingCloseFolderId = null;
let currentTheme = 'dark';

// Map of xterm instances: { [folderId]: { term, fitAddon, isSpawned, container } }
const termInstances = {};

// Welcome manual HTML element instance
let welcomeContainerInstance = null;

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
    themeText.textContent = 'Light 모드';
  } else {
    themeIcon.textContent = '🌙';
    themeText.textContent = 'Dark 모드';
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

async function saveAllConfig() {
  syncInputValuesToFolders(); // Sync data before saving
  const configToSave = {
    theme: currentTheme,
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
function renderWelcomeManual() {
  if (!welcomeContainerInstance) {
    const welcomeDiv = document.createElement('div');
    welcomeDiv.className = 'terminal-instance welcome-manual-container';
    welcomeDiv.id = 'term-container-welcome';

    welcomeDiv.innerHTML = `
      <div class="welcome-manual-card">
        <div class="welcome-title-row">
          <span style="font-size: 1.5rem;">⚡</span>
          <h2>ACL - 사용 안내 매뉴얼</h2>
        </div>

        <div class="welcome-step-list">
          <div class="welcome-step-item">
            <span class="welcome-step-num">1.</span>
            <span>좌측 <span class="welcome-highlight">[➕ 작업 폴더 추가]</span> 버튼을 눌러 프로젝트 디렉토리를 등록합니다.</span>
          </div>
          <div class="welcome-step-item">
            <span class="welcome-step-num">2.</span>
            <span>원하는 AI CLI <span class="welcome-highlight">(Claude / Antigravity / Codex / Etc..)</span>를 선택합니다.</span>
          </div>
          <div class="welcome-step-item">
            <span class="welcome-step-num">3.</span>
            <span>폴더 카드의 <span class="welcome-highlight">[▶ 실행]</span> 버튼을 눌러 대화형 세션을 시작합니다.</span>
          </div>
          <div class="welcome-step-item">
            <span class="welcome-step-num">4.</span>
            <span>하단 <span class="welcome-highlight">[📊 현재 사용량 확인하기]</span> 버튼으로 플랜 한도(Quota %)를 실시간 체크합니다.</span>
          </div>
          <div class="welcome-step-item">
            <span class="welcome-step-num">5.</span>
            <span>상단 <span class="welcome-highlight">[📝 대화 추출]</span> / <span class="welcome-highlight">[📄 보고서 출력]</span> 버튼으로 대화 원문이나 PDF 보고서를 지정 폴더로 자동 저장합니다.</span>
          </div>
          <div class="welcome-step-item">
            <span class="welcome-step-num">6.</span>
            <span>하단 <span class="welcome-highlight">[🎨 테마 설정]</span>으로 테마를 바꿀 수 있습니다 (터미널은 다크 고정).</span>
          </div>
        </div>

        <div class="welcome-note-box">
          <div>📌 <strong>참고사항:</strong> claude가 제대로 구동되지 않는다면 환경변수 PATH에 <code>%USERPROFILE%\\.local\\bin</code> 경로를 추가해주세요.</div>
        </div>

        <div class="welcome-tip-box">
          💡 <strong>📝 대화 추출 & 📄 보고서 출력 기능:</strong> [📝 대화 추출] 버튼을 누르면 AI 호출 없이 현재 화면 텍스트 원문을 즉시 .md 파일로 추출 저장하며, [📄 보고서 출력]은 대화 요약 PDF 문서를 자동 생성합니다.
        </div>

        <div class="welcome-footer-action">
          ▶ 준비가 되시면 폴더 카드의 [▶ 실행] 버튼을 눌러 세션을 시작하세요!
        </div>

        <div class="welcome-credits">
          [제작 : 성현우]
        </div>
      </div>
    `;

    terminalsWrapper.appendChild(welcomeDiv);
    welcomeContainerInstance = welcomeDiv;
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
    scrollback: 1000,
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

  let inst = termInstances[folderId];
  if (!inst) {
    inst = createTerminalInstance(folderId);
  }

  selectActiveFolder(folderId, true);

  const commandToRun = getCommandToRun(folder.cli, folder.customCommand);

  inst.term.clear();
  inst.term.write(`\x1b[32m[PowerShell 세션 시작 중...]\x1b[0m\r\n`);
  inst.term.write(`\x1b[36m경로: ${folder.path}\x1b[0m\r\n`);
  if (commandToRun) {
    inst.term.write(`\x1b[36m실행 명령어: ${commandToRun}\x1b[0m\r\n\r\n`);
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

    // Reset automatic usage check flag for event-driven detection upon Claude Code load
    hasAutoCheckedUsageMap[folderId] = false;
  } else {
    folder.isActive = false;
    inst.term.write(`\x1b[31m[세션 실행 실패: ${result.error}]\x1b[0m\r\n`);
  }

  renderFolderCards();
  selectActiveFolder(folderId);
  debouncedSaveConfig();
}

function openCloseModal(folderId) {
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return;

  if (!folder.isActive) {
    alert('현재 실행 중인 세션이 없습니다.');
    return;
  }

  pendingCloseFolderId = folderId;
  const displayName = getFolderDisplayName(folder);
  const cliName = folder.cli.toUpperCase();

  modalSessionDesc.textContent = `[${displayName}] (${cliName}) 세션 및 실행 중인 CLI를 종료하시겠습니까?`;
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

function getUsageCheckCommand(cli) {
  switch (cli) {
    case 'claude':
      return '/usage\r\n';
    case 'antigravity':
      return '/usage\r\n';
    case 'codex':
      return '/status\r\n';
    default:
      return '/usage\r\n';
  }
}

// --- Trigger Manual / Auto Usage Check & Auto ESC Cancel Return ---
function triggerUsageCheckForSession(sessionId, isManual = false) {
  if (!sessionId) return;

  const folder = folders.find((f) => f.id === sessionId);
  if (!folder || !folder.isActive) {
    if (isManual) {
      alert('현재 선택된 세션이 실행 중이지 않습니다. 세션을 먼저 시작해 주세요.');
    }
    return;
  }

  isCheckingUsageMap[sessionId] = true;

  const cmd = getUsageCheckCommand(folder.cli);
  window.api.writePty({ sessionId, data: cmd });

  setTimeout(() => {
    window.api.writePty({ sessionId, data: '\x1b' });
    isCheckingUsageMap[sessionId] = false;
  }, 750);
}

function triggerManualUsageCheck() {
  if (!activeFolderId) {
    alert('활성화된 세션이 없습니다. 실행(▶) 버튼을 먼저 눌러 세션을 연결해 주세요.');
    return;
  }
  triggerUsageCheckForSession(activeFolderId, true);
}

// --- Export Conversation Report as PDF to Specified Folder ---
async function exportConversationReportPDF() {
  if (!activeFolderId) {
    alert('활성화된 세션이 없습니다. 먼저 폴더 카드의 [▶ 실행] 버튼을 눌러 세션을 연결해 주세요.');
    return;
  }

  const folder = folders.find((f) => f.id === activeFolderId);
  if (!folder || !folder.isActive) {
    alert('현재 선택된 세션이 실행 중이지 않습니다. 먼저 세션을 시작해 주세요.');
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
  const promptText = `현재 대화 내용을 핵심 위주로 명확히 요약하여 "${normalizedPath}" 폴더에 PDF 보고서 파일로 즉시 생성해줘. (단답형 핵심 작성, 부연설명 생략)`;

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

// Extract raw text from xterm buffer active lines
function getTerminalBufferText(folderId) {
  const inst = termInstances[folderId];
  if (!inst || !inst.term) return '';

  const buffer = inst.term.buffer.active;
  let textLines = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) {
      textLines.push(line.translateToString(true));
    }
  }

  // Clean trailing blank lines
  while (textLines.length > 0 && textLines[textLines.length - 1].trim() === '') {
    textLines.pop();
  }

  return textLines.join('\n');
}

// --- Export Raw Chat Conversation Content to Specified Folder ---
async function exportConversationChatRaw() {
  if (!activeFolderId) {
    alert('활성화된 세션이 없습니다. 먼저 폴더 카드의 [▶ 실행] 버튼을 눌러 세션을 연결해 주세요.');
    return;
  }

  const folder = folders.find((f) => f.id === activeFolderId);
  if (!folder) return;

  const rawText = getTerminalBufferText(activeFolderId);
  if (!rawText || rawText.trim().length === 0) {
    alert('현재 세션에 추출할 대화 내용이 없습니다.');
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

  const filename = `${displayName}_대화추출_${dateStr}.md`;

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
    alert(`현재 세션 대화 내용이 .md 파일로 저장되었습니다!\n\n저장 위치:\n${res.filePath}`);
  } else {
    alert(`대화 추출 저장 중 오류가 발생했습니다: ${res && res.error ? res.error : ''}`);
  }
}

// --- Render Functions ---

function renderFolderCards() {
  syncInputValuesToFolders(); // Always preserve existing input values before re-rendering
  folderListContainer.innerHTML = '';

  folders.forEach((folder) => {
    const isSelected = folder.id === activeFolderId;
    const card = document.createElement('div');
    card.className = `folder-card ${isSelected ? 'active-selected' : ''}`;
    card.setAttribute('data-folder-id', folder.id);

    const displayName = getFolderDisplayName(folder);
    const badgeText = getShortBadgeText(folder);

    // Guaranteed Always Visible [⏹ 닫기] Buttons (Active vs Disabled)
    card.innerHTML = `
      <div class="folder-card-header">
        <div class="folder-info" title="${folder.path}">
          <div class="status-dot ${folder.isActive ? 'active' : 'inactive'}" title="${folder.isActive ? '세션 활성화 중 (초록색)' : '세션 비활성화됨 (회색)'}"></div>
          <span class="folder-badge-tag">${badgeText}</span>
          <div class="folder-name-group">
            <span class="folder-path-text">📁 ${displayName}</span>
            <span class="folder-path-subtext">${folder.path}</span>
          </div>
        </div>
        <button class="btn-card-launch-mini" data-action="launch" title="실행">▶</button>
        <button class="btn-card-close-mini ${folder.isActive ? 'active' : 'disabled'}" data-action="close" title="${folder.isActive ? '세션 닫기' : '실행 중인 세션 없음'}">⏹</button>
        <button class="btn-icon-delete" data-action="delete" title="목록에서 삭제">🗑️</button>
      </div>

      <div class="folder-card-controls">
        <input type="text" class="folder-alias-input" data-action="alias-input" 
               placeholder="🏷️ 별칭 지정 (선택)" value="${folder.alias || ''}" spellcheck="false" autocomplete="off" />

        <select class="cli-select-sm" data-action="cli-change">
          <option value="claude" ${folder.cli === 'claude' ? 'selected' : ''}>Claude (claude)</option>
          <option value="antigravity" ${folder.cli === 'antigravity' ? 'selected' : ''}>Antigravity (agy)</option>
          <option value="codex" ${folder.cli === 'codex' ? 'selected' : ''}>Codex (codex)</option>
          <option value="etc" ${folder.cli === 'etc' ? 'selected' : ''}>Etc.. (직접 입력)</option>
        </select>

        <input type="text" class="input-custom-sm ${folder.cli === 'etc' ? '' : 'hidden'}" 
               data-action="custom-cmd" 
               placeholder="예: claude --verbose" 
               value="${folder.customCommand || ''}" spellcheck="false" autocomplete="off" />
      </div>

      <div class="folder-card-actions">
        <button class="btn-card-action btn-card-launch" data-action="launch" title="세션 실행">▶ 실행</button>
        <button class="btn-card-action btn-card-close ${folder.isActive ? 'active' : 'disabled'}" data-action="close" title="${folder.isActive ? '세션 닫기' : '실행 중인 세션 없음'}">⏹ 닫기</button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      const target = e.target;
      const action = target.getAttribute('data-action');

      if (action === 'delete') {
        e.stopPropagation();
        removeFolderCard(folder.id);
      } else if (action === 'launch') {
        e.stopPropagation();
        launchFolderSession(folder.id);
      } else if (action === 'close') {
        e.stopPropagation();
        openCloseModal(folder.id);
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

    // Precision Input Event Handler for Alias without card re-rendering
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
  if (inst && inst.term) {
    inst.term.write(data);
  }

  const folder = folders.find((f) => f.id === sessionId);
  if (folder) {
    if (!folder.usage) folder.usage = { tokens: 0, cost: 0.0, sessionQuota: null, weekQuota: null };
    
    const cleanData = data.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

    // CLI-specific Quota Parsers

    // 1. Antigravity Models & Quota Parser (/usage)
    if (folder.cli === 'antigravity') {
      const geminiMatch = cleanData.match(/GEMINI\s*MODELS[\s\S]*?Weekly\s*Limit[\s\S]*?([0-9.]+)\s*%/i);
      if (geminiMatch && geminiMatch[1]) {
        folder.usage.geminiQuota = Math.round(parseFloat(geminiMatch[1]));
      }

      const claudeGptMatch = cleanData.match(/CLAUDE\s*(?:AND|&)\s*GPT\s*MODELS[\s\S]*?Weekly\s*Limit[\s\S]*?([0-9.]+)\s*%/i);
      if (claudeGptMatch && claudeGptMatch[1]) {
        folder.usage.claudeQuota = Math.round(parseFloat(claudeGptMatch[1]));
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

    // Event-driven automatic usage check trigger upon CLI completion load (independent of PC hardware speed)
    if (!hasAutoCheckedUsageMap[sessionId] && !isCheckingUsageMap[sessionId]) {
      let isCliLoaded = false;

      if (folder.cli === 'claude') {
        isCliLoaded = /Claude\s*Code\s*v/i.test(cleanData) ||
                      /Welcome\s*back/i.test(cleanData) ||
                      /Tips\s*for\s*getting\s*started/i.test(cleanData) ||
                      /shift\+tab\s*to\s*cycle/i.test(cleanData) ||
                      /plan\s*mode/i.test(cleanData);
      } else if (folder.cli === 'antigravity') {
        isCliLoaded = /antigravity/i.test(cleanData) ||
                      /Models\s*&\s*Quota/i.test(cleanData) ||
                      /GEMINI\s*MODELS/i.test(cleanData) ||
                      /AGY/i.test(cleanData);
      } else if (folder.cli === 'codex') {
        isCliLoaded = /codex/i.test(cleanData) ||
                      /Token\s*Usage/i.test(cleanData) ||
                      /Usage\s*Limits/i.test(cleanData) ||
                      /5h\s*limit/i.test(cleanData);
      } else {
        isCliLoaded = cleanData.length > 50;
      }

      if (isCliLoaded) {
        hasAutoCheckedUsageMap[sessionId] = true;
        setTimeout(() => {
          if (folder.isActive && !isCheckingUsageMap[sessionId]) {
            triggerUsageCheckForSession(sessionId, false);
          }
        }, 400);
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

  if (config && config.theme) {
    applyTheme(config.theme);
  } else {
    applyTheme('dark');
  }

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
      alert(`사용자 설정(directory.json)이 성공적으로 이중 보존되었습니다!\n\n저장 위치:\n${res.path}`);
    } else {
      alert(`설정 저장 중 오류가 발생했습니다.\n${res && res.error ? res.error : ''}`);
    }
  });

  modalBtnCancel.addEventListener('click', () => {
    pendingCloseFolderId = null;
    confirmModal.classList.add('hidden');
  });

  modalBtnConfirm.addEventListener('click', () => {
    closeFolderSessionConfirmed();
  });
});
