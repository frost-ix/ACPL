// Terminal Instance & PTY Management Module

import { getFolder, getFolders, updateFolder, termInstances, getCurrentTheme } from './state.js';
import { renderFolderCards, renderSessionIndicators, renderWelcomeManual, renderUsageStatusBar } from './ui.js';
import { isProbeSession, handleProbeData, handleProbeExit, addFolderUsage } from './usage.js';
import { flushSessionWatch } from './session.js';
import { removeSession } from './panes.js';
import { debounce } from './util.js';

// xterm palettes per app theme (the terminal follows the theme like the rest of the window)
const ONE_DARK_PRO_THEME = Object.freeze({
  background: '#282c34',
  foreground: '#abb2bf',
  cursor: '#528bff',
  cursorAccent: '#282c34',
  selectionBackground: '#3e4451',
  black: '#3f4451',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#d7dae0',
  brightBlack: '#4f5666',
  brightRed: '#ff616e',
  brightGreen: '#a5e075',
  brightYellow: '#f0a45d',
  brightBlue: '#4dc4ff',
  brightMagenta: '#de73ff',
  brightCyan: '#4cd1e0',
  brightWhite: '#e6e6e6',
});

// One Light. "white" is a mid gray so CLIs that print white text stay readable on the light background.
const ONE_LIGHT_THEME = Object.freeze({
  background: '#fafafa',
  foreground: '#383a42',
  cursor: '#526fff',
  cursorAccent: '#fafafa',
  selectionBackground: '#d7dae0',
  black: '#383a42',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#696c77',
  brightBlack: '#4f525e',
  brightRed: '#ca1243',
  brightGreen: '#3f8f3e',
  brightYellow: '#986801',
  brightBlue: '#2f62d0',
  brightMagenta: '#8a1f88',
  brightCyan: '#0e7490',
  brightWhite: '#383a42',
});

const xtermTheme = () => ({ ...(getCurrentTheme() === 'light' ? ONE_LIGHT_THEME : ONE_DARK_PRO_THEME) });

const TERMINAL_FONT_FAMILY = '"Cascadia Mono", Consolas, "Courier New", monospace';

const CLI_COMMANDS = { claude: 'claude', antigravity: 'agy', codex: 'codex' };

// CLI Command Resolver
export const getCommandToRun = (cli, customCmd) => (cli === 'etc' ? customCmd || '' : CLI_COMMANDS[cli] || '');

// Rough token estimate of terminal output: wide (CJK ...) chars ~1.5, others ~0.25
export function estimateTokensFromText(text) {
  if (!text) return 0;
  const clean = text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
  const wide = (clean.match(/[܁-￿]/g) || []).length;
  return Math.ceil(wide * 1.5 + (clean.length - wide) * 0.25);
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

    if (cols > 0 && rows > 0 && (inst.lastCols !== cols || inst.lastRows !== rows)) {
      inst.lastCols = cols;
      inst.lastRows = rows;
      window.api.resizePty({ sessionId: folderId, cols, rows });
    }
  } catch (err) {
    // Ignore layout shift errors
  }
}

export const debouncedFitAndResize = debounce(fitAndResizeTerminal, 40);

export function updateXtermTheme(inst) {
  if (inst && inst.term) {
    inst.term.options.theme = xtermTheme();
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
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 14,
    scrollback: 100000,
    theme: xtermTheme(),
  });

  let fitAddon = null;
  if (FitAddonClass) {
    fitAddon = new FitAddonClass();
    term.loadAddon(fitAddon);
  }

  term.open(termContainer);

  term.onData((data) => {
    window.api.writePty({ sessionId: folderId, data });
  });

  termInstances[folderId] = {
    term,
    fitAddon,
    isSpawned: false,
    container: termContainer,
    sessionRawText: '',
    lastCols: 0,
    lastRows: 0,
  };

  return termInstances[folderId];
}

// IPC Data & Exit Listeners
export function setupPtyListeners() {
  window.api.onPtyData(({ sessionId, data }) => {
    // Hidden usage probe sessions never reach the screen
    if (isProbeSession(sessionId)) {
      handleProbeData(sessionId, data);
      return;
    }

    const inst = termInstances[sessionId];
    if (inst) {
      if (inst.term) inst.term.write(data);
      inst.sessionRawText = (inst.sessionRawText || '') + data;
    }
    addFolderUsage(sessionId, estimateTokensFromText(data));
  });

  window.api.onPtyExit(({ sessionId }) => {
    if (isProbeSession(sessionId)) {
      handleProbeExit(sessionId);
      return;
    }

    const folder = getFolder(sessionId);
    // A chat-mode session does not own a PTY; ignore exits of a previously killed terminal
    if (folder && folder.runningMode === 'chat') return;
    if (folder) updateFolder(sessionId, { isActive: false });
    removeSession(sessionId);
    flushSessionWatch(sessionId);
    const inst = termInstances[sessionId];
    if (inst) inst.isSpawned = false;
    renderFolderCards();
    renderSessionIndicators();
    renderUsageStatusBar();
    if (!getFolders().some((f) => f.isActive)) renderWelcomeManual();
  });
}
