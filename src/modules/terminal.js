// Terminal Instance & PTY Management Module

import { t } from './i18n.js';
import {
  getFolders,
  getActiveFolderId,
  termInstances,
  isCheckingUsageMap,
  hasAutoCheckedUsageMap
} from './state.js';
import { debouncedRenderSessionTabs, renderFolderCards, renderSessionTabs, renderWelcomeManual } from './ui.js';

let resizeDebounceTimer = null;

// CLI Command Resolver
export function getCommandToRun(cli, customCmd) {
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

// Token & Quota Helper Functions
export function estimateTokensFromText(text) {
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

// Format Quota Limit Display for Tabs
export function getQuotaDisplayText(folder) {
  if (!folder || !folder.usage) return 'Quota: 0%';

  const { sessionQuota, weekQuota, geminiQuota, claudeQuota, tokens } = folder.usage;

  if (typeof geminiQuota === 'number' && typeof claudeQuota === 'number') {
    return `Gem: ${geminiQuota}% | Cld: ${claudeQuota}%`;
  }
  if (typeof geminiQuota === 'number') {
    return `Gem: ${geminiQuota}%`;
  }
  if (typeof claudeQuota === 'number') {
    return `Cld: ${claudeQuota}%`;
  }

  if (typeof sessionQuota === 'number' && typeof weekQuota === 'number') {
    return `5h: ${sessionQuota}% | Wk: ${weekQuota}%`;
  }
  if (typeof sessionQuota === 'number') {
    return `5h: ${sessionQuota}%`;
  }
  if (typeof weekQuota === 'number') {
    return `Wk: ${weekQuota}%`;
  }

  const estimatedPercent = Math.min(100, Math.ceil((tokens / 200000) * 100));
  return `Quota: ${estimatedPercent}%`;
}

// Dynamic Terminal Resize Function
export function fitAndResizeTerminal(folderId) {
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

export function debouncedFitAndResize(folderId) {
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(() => {
    fitAndResizeTerminal(folderId);
  }, 40);
}

export function updateXtermTheme(inst) {
  const darkThemeOptions = {
    background: '#090d16',
    foreground: '#f8fafc',
    cursor: '#3b82f6',
    selectionBackground: '#334155',
  };
  if (inst && inst.term) {
    inst.term.options.theme = darkThemeOptions;
  }
}

export function createTerminalInstance(folderId) {
  if (termInstances[folderId]) return termInstances[folderId];

  const terminalsWrapper = document.getElementById('terminals-wrapper');
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
    const folders = getFolders();
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
    const sidebar = document.getElementById('sidebar');
    const observer = new ResizeObserver(() => {
      if (getActiveFolderId() === folderId && sidebar && !sidebar.classList.contains('is-resizing')) {
        debouncedFitAndResize(folderId);
      }
    });
    observer.observe(termContainer);
  }

  return termInstances[folderId];
}

// Trigger Usage Check & Cancel Overlay
export function triggerUsageCheckForSession(sessionId, isManual = false) {
  if (!sessionId) return;

  const folders = getFolders();
  const folder = folders.find((f) => f.id === sessionId);
  if (!folder || !folder.isActive) {
    if (isManual) {
      alert(t('sessionNotActive'));
    }
    return;
  }

  if (isCheckingUsageMap[sessionId]) return;
  isCheckingUsageMap[sessionId] = true;

  const rawCmd = (folder.cli === 'codex') ? '/status' : '/usage';

  window.api.writePty({ sessionId, data: rawCmd });

  setTimeout(() => {
    window.api.writePty({ sessionId, data: '\r' });
  }, 100);

  const delay = (folder.cli === 'antigravity' || folder.cli === 'codex') ? 1400 : 950;

  setTimeout(() => {
    window.api.writePty({ sessionId, data: '\x1b' });
    isCheckingUsageMap[sessionId] = false;
  }, delay);
}

export function triggerManualUsageCheck() {
  const activeFolderId = getActiveFolderId();
  if (!activeFolderId) {
    alert(t('noActiveSessionStartFirst'));
    return;
  }
  triggerUsageCheckForSession(activeFolderId, true);
}

// IPC Data & Exit Listeners
export function setupPtyListeners() {
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

    const folders = getFolders();
    const folder = folders.find((f) => f.id === sessionId);
    if (folder) {
      if (!folder.usage) folder.usage = { tokens: 0, cost: 0.0, sessionQuota: null, weekQuota: null };
      
      const cleanData = data.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

      // Antigravity CLI Parser
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

      // Codex Parser
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

      // Claude Parser
      const sessionMatch = cleanData.match(/(?:5시간\s*한도|Current\s*session)[^0-9]*([0-9]{1,3})%/i);
      if (sessionMatch && sessionMatch[1]) {
        folder.usage.sessionQuota = parseInt(sessionMatch[1], 10);
      }

      const weekMatch = cleanData.match(/(?:주간\s*·?\s*전체\s*모델|Current\s*week\s*\(All\s*models\)|Current\s*week)[^0-9]*([0-9]{1,3})%/i);
      if (weekMatch && weekMatch[1]) {
        folder.usage.weekQuota = parseInt(weekMatch[1], 10);
      }

      // Generic % fallback
      if (folder.usage.sessionQuota === null && folder.usage.weekQuota === null && folder.usage.geminiQuota === undefined) {
        const genericMatch = cleanData.match(/([0-9]{1,3})%\s*(?:한도|사용량|quota|limit|used)/i);
        if (genericMatch && genericMatch[1]) {
          folder.usage.sessionQuota = parseInt(genericMatch[1], 10);
        }
      }

      // Auto usage check trigger
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

  window.api.onPtyExit(({ sessionId }) => {
    const folders = getFolders();
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
}
