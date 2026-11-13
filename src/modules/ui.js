// UI Components & DOM Rendering Module

import { t, getCurrentLang } from './i18n.js';
import {
  getFolders,
  getFolder,
  updateFolder,
  updateFolders,
  getActiveFolderId,
  setActiveFolderId,
  getPendingCloseFolderId,
  setPendingCloseFolderId,
  getCurrentTheme,
  setCurrentTheme,
  getWelcomeContainerInstance,
  setWelcomeContainerInstance,
  termInstances,
  chatInstances
} from './state.js';
import {
  BROWSER_CLIS,
  renderPanes,
  showSession,
  hidePanes,
  removeSession,
  panesEmpty,
  focusedSession,
  refreshPaneHeaders,
  browserSlotOf,
  markLaunchedWithBrowser,
  showDropZones,
  hideDropZones,
  dropTargetOf,
  highlightDropTarget,
  dropFolder
} from './panes.js';
import { saveAllConfig, debouncedSaveConfig } from './config.js';
import {
  getCommandToRun,
  createTerminalInstance,
  fitAndResizeTerminal,
  updateXtermTheme
} from './terminal.js';
import {
  getViewMode,
  startChatSession,
  resetChat,
  destroyChatInstance,
  refreshChatTexts
} from './chat.js';
import { runUsageProbe, applyCachedUsage } from './usage.js';
import {
  KNOWN_CLIS,
  touchFolder,
  togglePinned,
  patchFolder,
  getFolderSections,
  isSectionCollapsed,
  toggleSection,
  UNGROUPED,
  addGroup,
  renameGroup,
  removeGroup,
  moveGroup,
  setFolderGroup,
  getDiscovered,
  refreshDiscovered,
  addOrSelectFolderByPath,
  suggestCli,
  getScanRoots,
  addScanRoot,
  removeScanRoot
} from './folders.js';
import { openFolderSettings } from './folder-settings.js';
import {
  resolveResumeId,
  buildSessionCommand,
  watchForNewSession,
  stopSessionWatch,
  flushSessionWatch
} from './session.js';

import { displayName, badgeText } from './folder-model.js';
import {
  escapeHtml,
  basename,
  shortPath,
  formatAgo as formatAgoWith,
  formatDuration,
  formatShortDate,
  debounce
} from './util.js';
import { inlineInput, onActions, beginPointerDrag, notifyOverlay } from './dom.js';
import { setTitlebarText, refreshTitlebarTexts, setSessionActionsEnabled } from './titlebar.js';
import { systemStatusSlot } from './sysmon.js';

// Show one runtime container (terminal / chat / welcome), hide the rest
const setVisible = (el, visible, display = 'block') => {
  el.classList.toggle('active', visible);
  el.style.display = visible ? display : 'none';
};


const THEMES = {
  light: { icon: '☀️', label: 'lightTheme' },
  dark: { icon: '🌙', label: 'darkTheme' },
};

const setText = (selector, text) => {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
};

export function applyTheme(theme) {
  const name = theme === 'light' ? 'light' : 'dark';
  setCurrentTheme(name);
  document.body.className = `theme-${name}`;
  setText('#theme-icon', THEMES[name].icon);
  setText('#theme-text', t(THEMES[name].label));
  Object.values(termInstances).forEach(updateXtermTheme);
}

export function toggleTheme() {
  applyTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
  saveAllConfig();
}

// Static texts of index.html: selector -> { text, title } i18n keys
const STATIC_TEXTS = [
  ['#btn-add-folder .sidebar-text', { text: 'addFolder' }],
  ['#btn-new-group', { title: 'newGroupTitle' }],
  ['#btn-new-group .new-group-btn-label', { text: 'newGroupBtn' }],
  ['#btn-open-switcher', { title: 'switcherBtnTitle' }],
  ['#btn-open-switcher .switcher-btn-label', { text: 'switcherBtn' }],
  ['#btn-theme-toggle', { title: 'themeToggleTitle' }],
  ['#btn-extract-chat', { text: 'extractChatBtn', title: 'extractChatTitle' }],
  ['#btn-export-report', { text: 'reportPdfBtn', title: 'reportPdfTitle' }],
  ['#select-lang', { title: 'langSelectTitle' }],
  ['#btn-save', { title: 'saveConfigTitle' }],
  ['#btn-save .sidebar-text', { text: 'saveConfigBtn' }],
  ['#confirm-modal .modal-title', { text: 'modalCloseTitle' }],
  ['#confirm-modal .modal-desc', { text: 'modalCloseDesc' }],
  ['#modal-btn-confirm', { text: 'modalConfirm' }],
  ['#modal-btn-cancel', { text: 'modalCancel' }],
];

export function updateUILanguage() {
  STATIC_TEXTS.forEach(([selector, keys]) => {
    const el = document.querySelector(selector);
    if (!el) return;
    if (keys.text) el.textContent = t(keys.text);
    if (keys.title) el.title = t(keys.title);
  });
  setText('#theme-text', t(THEMES[getCurrentTheme()].label));
  refreshTitlebarTexts();
  const selectLang = document.getElementById('select-lang');
  if (selectLang) selectLang.value = getCurrentLang();

  renderFolderCards();
  renderSessionIndicators();
  Object.keys(chatInstances).forEach(refreshChatTexts);

  const welcome = getWelcomeContainerInstance();
  if (welcome && welcome.style.display !== 'none') renderWelcomeManual(true);
}

const WELCOME_STEPS = 6;

const welcomeHtml = () => `
  <div class="welcome-manual-card">
    <div class="welcome-title-row">
      <span style="font-size: 1.5rem;">⚡</span>
      <h2>${t('welcomeHeader')}</h2>
    </div>
    <div class="welcome-step-list">
      ${Array.from({ length: WELCOME_STEPS }, (_, i) => `
        <div class="welcome-step-item">
          <span class="welcome-step-num">${i + 1}.</span>
          <span>${t(`welcomeStep${i + 1}`)}</span>
        </div>`).join('')}
    </div>
    <div class="welcome-note-box"><div>${t('welcomeNote')}</div></div>
    <div class="welcome-tip-box">${t('welcomeTip')}</div>
    <div class="welcome-footer-action">${t('welcomeFooter')}</div>
    <div class="welcome-credits">${t('welcomeCredits')}</div>
  </div>`;

export function renderWelcomeManual(force = false) {
  let welcomeInstance = getWelcomeContainerInstance();
  if (!welcomeInstance) {
    welcomeInstance = document.createElement('div');
    welcomeInstance.className = 'terminal-instance welcome-manual-container';
    welcomeInstance.id = 'term-container-welcome';
    welcomeInstance.innerHTML = welcomeHtml();
    document.getElementById('terminals-wrapper').appendChild(welcomeInstance);
    setWelcomeContainerInstance(welcomeInstance);
  } else if (force) {
    welcomeInstance.innerHTML = welcomeHtml();
  }

  hidePanes();
  setVisible(welcomeInstance, true, 'flex');
}

// Highlight the selected row; re-render when a row has to appear in (or leave) a folded section
function syncSelectedRow(folderId) {
  const list = document.getElementById('folder-list-container');
  if (!list) return;
  const rowOf = (id) => list.querySelector(`.folder-card[data-folder-id="${CSS.escape(id)}"]`);
  // A folder shown only because it was selected inside a folded group -> hide it again
  const stale = [...list.querySelectorAll('.folder-card.kept-selected')]
    .some((c) => c.getAttribute('data-folder-id') !== folderId);
  if (stale || (folderId && !rowOf(folderId))) renderFolderCards();
  list.querySelectorAll('.folder-card').forEach((c) => {
    c.classList.toggle('active-selected', c.getAttribute('data-folder-id') === folderId);
  });
  const row = folderId && rowOf(folderId);
  if (row) row.scrollIntoView({ block: 'nearest' });
}

export function selectActiveFolder(folderId, isLaunching = false) {
  setActiveFolderId(folderId);
  syncSelectedRow(folderId);
  renderSessionIndicators();

  const target = getFolder(folderId);
  if (!isLaunching && !getFolders().some((f) => f.isActive) && !(target && target.isActive)) {
    renderWelcomeManual();
    return;
  }
  const welcome = getWelcomeContainerInstance();
  if (welcome) setVisible(welcome, false);
  // A running (or starting) session is shown in the panes; selecting a stopped folder only
  // changes the sidebar selection
  if (target && (target.isActive || isLaunching)) showSession(folderId);
  else if (panesEmpty()) {
    const running = getFolders().find((f) => f.isActive);
    if (running) showSession(running.id);
  } else renderPanes();
}

const ansiLine = (color, text) => `\x1b[${color}m${text}\x1b[0m\r\n`;

// Chat (speech bubble) mode: no PTY, each message runs the CLI in JSON mode through PowerShell
function launchChat(folderId, resumeId) {
  updateFolder(folderId, { runningMode: 'chat', isActive: true });
  const termInst = termInstances[folderId];
  if (termInst) {
    termInst.isSpawned = false;
    termInst.term.clear();
  }
  startChatSession(folderId, resumeId);
}

async function launchTerminal(folderId, resumeId) {
  const folder = updateFolder(folderId, { runningMode: 'terminal' });
  resetChat(folderId);
  const inst = termInstances[folderId] || createTerminalInstance(folderId);
  selectActiveFolder(folderId, true);

  // A browser panel next to the session: its Playwright MCP goes on the command line
  const slot = browserSlotOf(folderId);
  const browserArgs = slot !== null && BROWSER_CLIS.includes(folder.cli)
    ? (await window.api.browserLaunchArgs(folder.cli, slot)) || ''
    : '';
  markLaunchedWithBrowser(folderId, !!browserArgs);
  const base = getCommandToRun(folder.cli, folder.customCommand);
  const { command, resumed } = buildSessionCommand(folder, base ? base + browserArgs : base, resumeId);
  const launchedAt = Date.now();
  inst.term.clear();
  inst.sessionRawText = '';
  inst.term.write(ansiLine(32, `[${t(resumed ? 'resumingSession' : 'startingSession')}]`));
  inst.term.write(ansiLine(36, `${t('pathLabel')}: ${folder.path}`));
  if (command) inst.term.write(`${ansiLine(36, `${t('commandLabel')}: ${command}`)}\r\n`);
  fitAndResizeTerminal(folderId);

  const result = await window.api.spawnPty({
    sessionId: folderId,
    folderPath: folder.path,
    commandToRun: command,
    cols: inst.term.cols || 80,
    rows: inst.term.rows || 30,
  });
  updateFolder(folderId, { isActive: !!result.success });
  inst.isSpawned = !!result.success;
  if (!result.success) {
    inst.term.write(ansiLine(31, `[${t('sessionLaunchFailed')}${result.error}]`));
    return false;
  }
  // codex / agy choose their own id -> pick it up from disk once the conversation starts
  if (!resumed) watchForNewSession(getFolder(folderId), launchedAt);
  return true;
}

// Folders whose launch is in progress (a second launch would kill and restart the first)
let launching = Object.freeze([]);
const setLaunching = (id, on) => {
  launching = Object.freeze(on ? [...launching, id] : launching.filter((x) => x !== id));
};

export async function launchFolderSession(folderId) {
  if (launching.includes(folderId)) return;
  setLaunching(folderId, true);
  try {
    await launchFolderSessionNow(folderId);
  } finally {
    setLaunching(folderId, false);
  }
}

async function launchFolderSessionNow(folderId) {
  const folder = getFolder(folderId);
  if (!folder) return;
  if (folder.isActive) await window.api.killPty({ sessionId: folderId });

  stopSessionWatch(folderId);
  applyCachedUsage(folderId);
  touchFolder(folderId);

  // Saved conversation of this folder (null = new conversation)
  const resumeId = await resolveResumeId(getFolder(folderId));
  const started = getViewMode(folder) === 'chat'
    ? (launchChat(folderId, resumeId), true)
    : await launchTerminal(folderId, resumeId);

  renderFolderCards();
  selectActiveFolder(folderId);
  debouncedSaveConfig();
  if (started) runUsageProbe(folder.cli);
}

export function openCloseModal(folderId) {
  const folder = getFolder(folderId);
  if (!folder) return;
  if (!folder.isActive) {
    alert(t('noActiveSession'));
    return;
  }
  setPendingCloseFolderId(folderId);
  const name = displayName(folder);
  const cliName = folder.cli.toUpperCase();
  const desc = document.getElementById('modal-session-desc');
  if (desc) {
    desc.textContent = getCurrentLang() === 'en'
      ? `Are you sure you want to terminate [${name}] (${cliName}) session and running CLI?`
      : `[${name}] (${cliName}) 세션 및 실행 중인 CLI를 종료하시겠습니까?`;
  }
  setConfirmModal(true);
}

// The static "close session?" dialog (index.html); browser panels step aside while it is open
export function setConfirmModal(open) {
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.classList.toggle('hidden', !open);
  notifyOverlay('confirm', open);
}

// Re-render the list and show `nextId` (or the welcome card when there is none)
function showFolderOrWelcome(nextId) {
  renderFolderCards();
  renderSessionIndicators();
  if (nextId) selectActiveFolder(nextId);
  else renderWelcomeManual();
}

const firstRunningId = () => (getFolders().find((f) => f.isActive) || {}).id || null;
// Next session to show: the pane that keeps the focus, else any running one
const nextShownId = () => focusedSession() || firstRunningId();

export async function closeFolderSessionConfirmed() {
  const folderId = getPendingCloseFolderId();
  if (!folderId) return;
  setPendingCloseFolderId(null);
  setConfirmModal(false);

  const folder = getFolder(folderId);
  if (folder) updateFolder(folderId, { isActive: false });
  removeSession(folderId);
  flushSessionWatch(folderId);
  if (folder && folder.runningMode === 'chat') resetChat(folderId);
  else await window.api.killPty({ sessionId: folderId });

  const inst = termInstances[folderId];
  if (inst) {
    inst.isSpawned = false;
    inst.term.clear();
  }
  showFolderOrWelcome(nextShownId());
}

function disposeTerminal(folderId) {
  const inst = termInstances[folderId];
  if (!inst) return;
  try {
    if (inst.term) inst.term.dispose();
  } catch (e) {
    // already disposed
  }
  if (inst.container) inst.container.remove();
  delete termInstances[folderId];
}

export function removeFolderCard(folderId) {
  stopSessionWatch(folderId);
  removeSession(folderId);
  window.api.killPty({ sessionId: folderId });
  destroyChatInstance(folderId);
  disposeTerminal(folderId);
  updateFolders((list) => list.filter((f) => f.id !== folderId));

  // The removed folder was selected: fall back to a shown / running one, else the first folder
  const current = getActiveFolderId();
  const first = getFolders()[0];
  showFolderOrWelcome(current !== folderId ? current : nextShownId() || (first && first.id) || null);
  saveAllConfig();
}

const CLI_SHORT = { claude: 'claude', antigravity: 'agy', codex: 'codex', etc: 'etc' };

const agoLabels = () => ({ now: t('agoJustNow'), minutes: t('agoMinutes'), hours: t('agoHours'), days: t('agoDays') });
const formatAgo = (ms) => formatAgoWith(ms, agoLabels());

// Pure: inner HTML of a folder row. Two lines:  ● name ................ 📌 ⚙ ▶ ⏹
//                                                [cli] …\parent\name        3h ago
// The class names (folder-card, folder-info, folder-badge-tag, ...) are kept for the
// collapsed-sidebar styles.
// Collapsed sidebar only: one button in the card corner. It shows the status dot and turns
// into ▶ (not running) or ⏹ (running) while the pointer is on the button itself.
const runToggleHtml = (folder) => {
  const running = !!folder.isActive;
  return `<button class="btn-run-toggle ${running ? 'running' : ''}" data-action="${running ? 'close' : 'launch'}"
    title="${escapeHtml(t(running ? 'closeBtnTitleActive' : 'launchBtnTitle'))}">
    <span class="rt-dot"></span><span class="rt-icon">${running ? '⏹' : '▶'}</span></button>`;
};

const folderRowHtml = (folder) => {
  const path = escapeHtml(folder.path);
  const cliOptions = KNOWN_CLIS
    .map((c) => `<option value="${c}" ${folder.cli === c ? 'selected' : ''}>${CLI_SHORT[c]}</option>`)
    .join('');
  return `
    <div class="folder-card-header">
      <div class="folder-info" title="${path}">
        <div class="status-dot ${folder.isActive ? 'active' : 'inactive'}" title="${folder.isActive ? t('sessionActiveDot') : t('sessionInactiveDot')}"></div>
        <span class="folder-badge-tag">${escapeHtml(badgeText(folder))}</span>
        ${runToggleHtml(folder)}
        <div class="folder-name-group"><span class="folder-path-text">${escapeHtml(displayName(folder))}</span></div>
        ${folder.missing ? `<span class="folder-missing" title="${escapeHtml(t('missingPathTitle'))}">⚠</span>` : ''}
      </div>
      <div class="folder-card-header-actions">
        <button class="btn-row-icon btn-row-pin ${folder.pinned ? 'on' : ''}" data-action="pin" title="${t(folder.pinned ? 'unpinTitle' : 'pinTitle')}">📌</button>
        <button class="btn-row-icon" data-action="settings" title="${t('folderSettingsTitle')}">⚙</button>
        <button class="btn-card-launch-mini" data-action="launch" title="${t('launchBtnTitle')}">▶</button>
        ${folder.isActive ? `<button class="btn-card-close-mini active" data-action="close" title="${t('closeBtnTitleActive')}">⏹</button>` : ''}
      </div>
    </div>
    <div class="folder-row-sub">
      <select class="row-cli-select" data-action="cli-quick" title="${escapeHtml(t('cliQuickTitle'))}" ${folder.isActive ? 'disabled' : ''}>${cliOptions}</select>
      <span class="folder-row-path" title="${path}">${escapeHtml(shortPath(folder.path))}</span>
      <span class="folder-row-ago">${escapeHtml(formatAgo(folder.lastUsedAt))}</span>
    </div>`;
};

function renderFolderRow(folder, activeFolderId) {
  const id = folder.id;
  const row = document.createElement('div');
  row.className = [
    'folder-card folder-row',
    id === activeFolderId ? 'active-selected' : '',
    folder.missing ? 'missing' : '',
    folder.archived ? 'archived' : '',
  ].filter(Boolean).join(' ');
  row.setAttribute('data-folder-id', id);
  row.title = `${displayName(folder)} (${folder.cli})\n${folder.path}`; // the collapsed sidebar shows only the badge
  row.innerHTML = folderRowHtml(folder);

  row.addEventListener('mousedown', (e) => startRowDrag(e, id));
  // e.detail > 1: 2nd click of a double click — one run / stop per gesture
  const once = (fn) => (el, e) => { if (!e || e.detail <= 1) fn(); };
  onActions(row, {
    launch: once(() => launchFolderSession(id)),
    close: once(() => openCloseModal(id)),
    settings: () => openFolderSettings(id),
    pin: () => {
      togglePinned(id);
      renderFolderCards();
    },
  });
  // Any other click selects the folder (the CLI select handles its own clicks)
  row.addEventListener('click', (e) => {
    if (!e.target.closest('[data-action]')) selectActiveFolder(id);
  });
  // Double click = launch (or just show it when it is already running)
  row.addEventListener('dblclick', (e) => {
    if (e.target.closest('[data-action]')) return;
    if ((getFolder(id) || {}).isActive) selectActiveFolder(id);
    else launchFolderSession(id);
  });
  row.querySelector('[data-action="cli-quick"]').addEventListener('change', (e) => {
    const next = patchFolder(id, { cli: e.target.value });
    if (next.cli === 'etc' && !next.customCommand) openFolderSettings(id);
  });
  return row;
}

// `mini`: short tag shown instead of the label when the sidebar is collapsed
function renderSectionHeader(key, label, count, collapsed, extraHtml = '', mini = '') {
  const el = document.createElement('div');
  el.className = `folder-section-header ${collapsed ? 'collapsed' : ''}`;
  el.setAttribute('data-section', key);
  el.title = label;
  el.innerHTML = `<span class="fs-caret">${collapsed ? '▸' : '▾'}</span><span class="fs-mini">${escapeHtml(mini)}</span><span class="fs-label">${escapeHtml(label)}</span><span class="fs-count">${count}</span>${extraHtml}`;
  return el;
}

const SECTION_MINI = { running: '▶', ungrouped: '📂', archived: '🗄' };
const sectionMini = (section) => (section.group ? section.group.name.trim().slice(0, 2) : SECTION_MINI[section.kind] || '');

const SECTION_LABELS = { running: 'sectionRunning', ungrouped: 'sectionUngrouped', archived: 'sectionArchived' };

const sectionLabel = (section) => (section.group ? `🗂 ${section.group.name}` : t(SECTION_LABELS[section.kind]));

const GROUP_ACTIONS_HTML = () => `
  <span class="fs-group-actions">
    <button class="btn-row-icon" data-action="group-up" title="${t('moveGroupUpTitle')}">↑</button>
    <button class="btn-row-icon" data-action="group-down" title="${t('moveGroupDownTitle')}">↓</button>
    <button class="btn-row-icon" data-action="group-rename" title="${t('renameGroupTitle')}">✎</button>
    <button class="btn-row-icon" data-action="group-delete" title="${t('deleteGroupTitle')}">×</button>
  </span>`;

// Store change followed by a fresh sidebar
const andRender = (fn) => (...args) => {
  fn(...args);
  renderFolderCards();
};

function renameGroupInline(header, group) {
  inlineInput(header.querySelector('.fs-label'), {
    initial: group.name,
    placeholder: t('newGroupPlaceholder'),
    className: 'group-name-input',
    onCommit: (name) => renameGroup(group.id, name),
    onDone: renderFolderCards,
  });
}

function renderSection(section, activeFolderId) {
  const { group } = section;
  const collapsed = isSectionCollapsed(section);
  const wrap = document.createElement('div');
  wrap.className = `folder-section folder-section-${section.kind}`;
  // Drop targets for dragging a folder into a group
  if (section.kind === 'group') wrap.setAttribute('data-drop', group.id);
  if (section.kind === 'ungrouped') wrap.setAttribute('data-drop', UNGROUPED);

  const header = renderSectionHeader(section.key, sectionLabel(section), section.folders.length, collapsed, group ? GROUP_ACTIONS_HTML() : '', sectionMini(section));
  if (group) {
    onActions(header, {
      'group-rename': () => renameGroupInline(header, group),
      'group-delete': () => {
        if (window.confirm(t('groupDeleteConfirm').replace('{name}', group.name))) andRender(removeGroup)(group.id);
      },
      'group-up': () => andRender(moveGroup)(group.id, -1),
      'group-down': () => andRender(moveGroup)(group.id, 1),
    });
    header.addEventListener('dblclick', (e) => {
      if (!e.target.closest('[data-action]')) renameGroupInline(header, group);
    });
  }
  header.addEventListener('click', (e) => {
    if (!e.target.closest('[data-action]')) andRender(toggleSection)(section);
  });
  wrap.appendChild(header);

  // The selected folder stays visible even inside a folded section (marked so it can be
  // hidden again as soon as another folder gets selected, see syncSelectedRow)
  section.folders
    .filter((f) => !collapsed || f.id === activeFolderId)
    .forEach((f) => {
      const row = renderFolderRow(f, activeFolderId);
      row.classList.toggle('kept-selected', collapsed);
      wrap.appendChild(row);
    });
  if (!collapsed && !section.folders.length && section.kind === 'group') {
    const empty = document.createElement('div');
    empty.className = 'folder-section-empty';
    empty.textContent = t('groupEmptyHint');
    wrap.appendChild(empty);
  }
  return wrap;
}

// "New group" button in the sidebar (above "find folder"): swaps itself for a name input
// of the same size. Enter = create, Esc / empty = cancel.
export function startNewGroupInput() {
  const btn = document.getElementById('btn-new-group');
  if (!btn || btn.classList.contains('hidden')) return;
  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebar.classList.contains('collapsed')) {
    const toggle = document.getElementById('btn-toggle-sidebar');
    if (toggle) toggle.click(); // the input needs the full-width sidebar
  }
  inlineInput(btn, {
    mode: 'after',
    placeholder: t('newGroupPlaceholder'),
    className: 'new-group-input',
    onCommit: andRender(addGroup),
  });
}

export function renderFolderCards() {
  const list = document.getElementById('folder-list-container');
  if (!list) return;
  const { scrollTop } = list;
  const activeFolderId = getActiveFolderId();
  list.replaceChildren(
    ...getFolderSections(displayName).map((section) => renderSection(section, activeFolderId)),
    renderDiscoveredSection()
  );
  list.scrollTop = scrollTop;
}

// --- Drag & drop (mouse based, dom.js beginPointerDrag) ---
// Sidebar group sections as drop targets
const groupTargetOf = (el) => {
  const section = el && el.closest && el.closest('.folder-section[data-drop]');
  if (!section) return null;
  const groupId = section.getAttribute('data-drop');
  return { type: 'group', key: `g:${groupId}`, groupId, el: section };
};

const highlightTarget = (target, on) => {
  if (target.type === 'group') target.el.classList.toggle('drop-target', on);
  else highlightDropTarget(target, on);
};

function moveToGroup(folderId, dropId) {
  const groupId = dropId === UNGROUPED ? null : dropId;
  if (((getFolder(folderId) || {}).groupId || null) !== groupId) andRender(setFolderGroup)(folderId, groupId);
}

// Common part: the session area shows its drop zones while something is dragged
const paneDrag = (folderId) => ({
  label: displayName(getFolder(folderId)),
  onStart: () => showDropZones(folderId),
  onEnd: hideDropZones,
});

// Folder card: onto a sidebar group (regroup) or onto the session area (show / launch there)
function startRowDrag(e, folderId) {
  const sidebar = document.getElementById('sidebar');
  const collapsed = !!(sidebar && sidebar.classList.contains('collapsed'));
  // Buttons keep their click. Collapsed: the whole card is the run toggle, so a drag may start
  // on it (a plain click still runs / stops; a drag ends elsewhere and never clicks it).
  const handle = e.target.closest('[data-action]');
  if (handle && !(collapsed && handle.classList.contains('btn-run-toggle'))) return;
  beginPointerDrag(e, {
    ...paneDrag(folderId),
    resolve: (el) => groupTargetOf(el) || dropTargetOf(el),
    highlight: highlightTarget,
    drop: (target) => (target.type === 'group' ? moveToGroup(folderId, target.groupId) : dropFolder(folderId, target)),
  });
}


// --- Discovered projects (not registered yet) + root folders ---
const DISCOVERED_SECTION = { key: 'discovered', kind: 'discovered' };
const DISCOVER_SHOWN = 30;

const rescanAndRender = async () => {
  await refreshDiscovered(true);
  renderFolderCards();
};

const discoverBodyHtml = (items) => `
  <div class="discover-hint">${escapeHtml(t('discoverHint'))}</div>
  ${items.length ? '' : `<div class="discover-empty">${escapeHtml(t('discoverEmpty'))}</div>`}
  ${items.slice(0, DISCOVER_SHOWN).map((d, i) => `
    <div class="discover-row" data-index="${i}" title="${escapeHtml(d.path)}">
      <span class="discover-name">${escapeHtml(basename(d.path))}</span>
      <span class="discover-src">${escapeHtml(d.sources.join(' · '))}</span>
      <button class="btn-row-icon" data-action="discover-add" title="${t('discoverAdd')}">＋</button>
      <button class="btn-card-launch-mini" data-action="discover-launch" title="${t('discoverLaunch')}">▶</button>
    </div>`).join('')}
  <div class="discover-roots">
    <div class="discover-roots-label">${escapeHtml(t('rootsLabel'))}</div>
    ${getScanRoots().map((r) => `
      <span class="root-chip" title="${escapeHtml(r)}">${escapeHtml(basename(r))}<button data-action="root-remove" data-root="${escapeHtml(r)}" title="${t('removeRootTitle')}">×</button></span>`).join('')}
    <button class="btn-root-add" data-action="root-add">${escapeHtml(t('addRootBtn'))}</button>
  </div>`;

function renderDiscoveredSection() {
  const items = getDiscovered();
  const collapsed = isSectionCollapsed(DISCOVERED_SECTION);
  const wrap = document.createElement('div');
  wrap.className = 'folder-section folder-section-discovered';
  const header = renderSectionHeader('discovered', t('sectionDiscovered'), items.length, collapsed,
    `<button class="btn-row-icon fs-refresh" data-action="rescan" title="${t('discoverRefresh')}">⟳</button>`);
  onActions(header, { rescan: rescanAndRender });
  header.addEventListener('click', (e) => {
    if (!e.target.closest('[data-action]')) andRender(toggleSection)(DISCOVERED_SECTION);
  });
  wrap.appendChild(header);
  if (collapsed) return wrap;

  const body = document.createElement('div');
  body.className = 'discover-body';
  body.innerHTML = discoverBodyHtml(items);
  const itemOf = (el) => items[Number(el.closest('.discover-row').getAttribute('data-index'))];
  onActions(body, {
    'root-add': async () => {
      const picked = await window.api.openFolder();
      if (picked && addScanRoot(picked)) await rescanAndRender();
    },
    'root-remove': (el) => {
      removeScanRoot(el.getAttribute('data-root'));
      rescanAndRender();
    },
    'discover-add': (el) => addDiscoveredProject(itemOf(el), false),
    'discover-launch': (el) => addDiscoveredProject(itemOf(el), true),
  });
  wrap.appendChild(body);
  return wrap;
}

export async function addDiscoveredProject(item, launch) {
  if (!item) return;
  const folder = addOrSelectFolderByPath(item.path, suggestCli(item));
  renderFolderCards();
  if (launch) await launchFolderSession(folder.id);
  else selectActiveFolder(folder.id);
}

// --- Session tabs & status bar ---
// Quota windows exactly as the CLI reported them (5h, Wk, Wk·Sonnet, Gem·Wk ...)
const quotaItems = (folder) => ((folder && folder.usage && folder.usage.windows) || [])
  .filter((w) => typeof w.pct === 'number')
  .map((w) => ({ label: w.label, value: Math.max(0, Math.min(100, w.pct)), resetText: w.resetText || '', resetsAt: w.resetsAt || null }));

const levelOf = (pct) => (pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok');


// "2h13m" / "3d4h" until reset, or the CLI's own reset text
const formatReset = (item, now = Date.now()) => {
  if (!item.resetsAt) return item.resetText || '';
  return item.resetsAt <= now ? t('resetDue') : formatDuration(item.resetsAt - now);
};

// Where the current session is shown (there is no tab bar): pane headers, window title,
// status bar. Running sessions are listed in the sidebar's "running" section.
export function renderSessionIndicators() {
  const current = getFolder(getActiveFolderId());
  setTitlebarText(current ? `${displayName(current)} (${current.cli})` : '');
  setSessionActionsEnabled(!!(current && current.isActive));
  refreshPaneHeaders();
  renderUsageStatusBar();
}

const quotaItemHtml = (i) => {
  const lvl = levelOf(i.value);
  const reset = formatReset(i);
  // Tooltip: when exactly (system clock / local time), next to the remaining time shown in the bar
  const when = i.resetsAt ? ` (${formatShortDate(i.resetsAt)})` : '';
  const title = `${i.label} ${i.value}%${reset ? ` · ${t('resetsLabel')} ${reset}${when}` : ''}`;
  return `<span class="sb-item sb-quota ${lvl === 'ok' ? '' : lvl}" title="${escapeHtml(title)}"><span class="sb-muted">${escapeHtml(i.label)}</span><span class="sb-bar"><span style="width:${i.value}%"></span></span><span class="sb-pct">${i.value}%</span>${reset ? `<span class="sb-reset">↻ ${escapeHtml(reset)}</span>` : ''}</span>`;
};

const updatedText = (usage) => {
  if (usage.isRefreshing) return t('refreshing');
  if (!usage.updatedAt) return '';
  const mins = Math.floor((Date.now() - usage.updatedAt) / 60000);
  return mins < 1 ? t('justNow') : t('updatedAgo').replace('{n}', mins);
};

export function renderUsageStatusBar() {
  const bar = document.getElementById('usage-status-bar');
  if (!bar) return;
  const folder = getFolder(getActiveFolderId());
  const active = folder && folder.isActive ? folder : null;
  const usage = (active && active.usage) || {};
  const items = active ? quotaItems(active) : [];
  // Left: session · CLI · last update + refresh · quota bars. Right: CPU / memory (always).
  const left = active
    ? `<span class="sb-item sb-name">${escapeHtml(displayName(active))}</span>
       <span class="sb-item sb-cli">${escapeHtml(active.cli || '')}</span>
       <span class="sb-item sb-refresh">
         <span class="sb-muted">${updatedText(usage)}</span>
         <button id="btn-refresh-usage" class="btn-refresh-usage ${usage.isRefreshing ? 'spinning' : ''}" title="${t('refreshUsage')}"><span>⟳</span></button>
       </span>
       ${items.length ? items.map(quotaItemHtml).join('') : `<span class="sb-item sb-muted">${t('notChecked')}</span>`}`
    : `<span class="sb-item sb-muted">${t('noSession')}</span>`;
  bar.innerHTML = `
    <div class="sb-col sb-col-left">${left}</div>
    <div class="sb-col sb-col-right">${systemStatusSlot()}</div>`;
}

export const debouncedRenderSessionIndicators = debounce(renderSessionIndicators, 200);
