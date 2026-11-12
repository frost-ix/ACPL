// Quick Folder Switcher (Ctrl+K)
//
// Search registered folders and discovered projects by name / path / CLI / group.
// Enter: running -> show it, otherwise launch it (a discovered project is added first).
// Candidate building, scoring and ranking are pure functions (rankCandidates).

import { t } from './i18n.js';
import { getFolders, getGroups } from './state.js';
import { getDiscovered, refreshDiscovered } from './folders.js';
import { displayName } from './folder-model.js';
import { selectActiveFolder, launchFolderSession, addDiscoveredProject } from './ui.js';
import { createOverlay } from './dom.js';
import { escapeHtml, basename, byAll } from './util.js';

const MAX_RESULTS = 60;
const DISCOVERED_WHEN_EMPTY = 10;

// --- Pure part ---
export const toCandidates = (folders, groups, discovered) => {
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  return {
    folders: folders.map((f) => ({
      kind: 'folder',
      folder: f,
      name: displayName(f),
      path: f.path,
      cli: f.cli,
      group: groupName.get(f.groupId) || '',
      lastUsed: f.lastUsedAt || 0,
    })),
    found: discovered.map((d) => ({
      kind: 'discovered',
      item: d,
      name: basename(d.path),
      path: d.path,
      cli: d.sources.join(' '),
      group: '',
      lastUsed: d.lastUsedMs || 0,
    })),
  };
};

// Every space-separated token must appear somewhere; name hits rank above path hits. -1 = no match
export const scoreCandidate = (c, tokens) => {
  const name = c.name.toLowerCase();
  const hay = [name, c.path, c.cli, c.kind === 'folder' ? c.folder.alias : '', c.group].join(' ').toLowerCase();
  return tokens.reduce((sum, tok) => {
    if (sum < 0 || !hay.includes(tok)) return -1;
    if (name.startsWith(tok)) return sum + 30;
    return sum + (name.includes(tok) ? 20 : 5);
  }, 0);
};

const isRunning = (c) => c.kind === 'folder' && !!c.folder.isActive;

const rank = byAll(
  (a, b) => b.score - a.score,
  (a, b) => (isRunning(b) ? 1 : 0) - (isRunning(a) ? 1 : 0),
  (a, b) => b.lastUsed - a.lastUsed
);

// Empty query: running first, then most recently used, then a few discovered projects
export const rankCandidates = ({ folders, found }, query) => {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    const regs = folders.map((c) => ({ ...c, score: 0 })).sort(rank);
    return [...regs, ...found.slice(0, DISCOVERED_WHEN_EMPTY).map((c) => ({ ...c, score: 0 }))].slice(0, MAX_RESULTS);
  }
  // Registered folders beat discovered ones with the same score
  const scored = (list, penalty) => list
    .map((c) => ({ ...c, score: scoreCandidate(c, tokens) }))
    .filter((c) => c.score >= 0)
    .map((c) => ({ ...c, score: c.score - penalty }));
  return [...scored(folders, 0), ...scored(found, 1)].sort(rank).slice(0, MAX_RESULTS);
};

const tag = (cls, text, title = '') => `<span class="sw-tag ${cls}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(text)}</span>`;

const tagsHtml = (c) => {
  if (c.kind === 'discovered') return tag('sw-new', t('switcherTagNew'));
  const f = c.folder;
  return [
    c.group ? tag('sw-group', `🗂 ${c.group}`) : '',
    f.isActive ? tag('sw-running', t('switcherTagRunning')) : '',
    f.archived ? tag('', t('switcherTagArchived')) : '',
    f.missing ? tag('sw-missing', '⚠', t('missingPathTitle')) : '',
  ].join('');
};

const itemHtml = (c, i, activeIndex) => `
  <div class="switcher-item ${i === activeIndex ? 'active' : ''}" data-index="${i}">
    <span class="sw-dot ${isRunning(c) ? 'on' : ''}"></span>
    <span class="sw-name">${c.kind === 'folder' && c.folder.pinned ? '📌 ' : ''}${escapeHtml(c.name)}</span>
    <span class="sw-cli">${escapeHtml(c.kind === 'folder' ? c.cli : '')}</span>
    ${tagsHtml(c)}
    <span class="sw-path">${escapeHtml(c.path)}</span>
  </div>`;

// --- UI ---
let view = null; // { dialog, inputEl, listEl }
let state = Object.freeze({ items: [], index: 0 });

function render() {
  const { items, index } = state;
  view.listEl.innerHTML = items.length
    ? items.map((c, i) => itemHtml(c, i, index)).join('')
    : `<div class="switcher-empty">${escapeHtml(t('switcherEmpty'))}</div>`;
  const active = view.listEl.querySelector('.switcher-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function update(index = 0) {
  const items = rankCandidates(toCandidates(getFolders(), getGroups(), getDiscovered()), view.inputEl.value);
  state = Object.freeze({ items, index: index < items.length ? index : 0 });
  render();
}

function move(delta) {
  const n = state.items.length;
  if (!n) return;
  state = Object.freeze({ ...state, index: (state.index + delta + n) % n });
  render();
}

async function choose(i) {
  const c = state.items[i];
  if (!c) return;
  closeSwitcher();
  if (c.kind === 'discovered') await addDiscoveredProject(c.item, true);
  else if (c.folder.isActive) selectActiveFolder(c.folder.id);
  else await launchFolderSession(c.folder.id);
}

const KEYS = {
  ArrowDown: () => move(1),
  ArrowUp: () => move(-1),
  Enter: () => choose(state.index),
  Escape: () => closeSwitcher(),
};

function ensureView() {
  if (view) return;
  const dialog = createOverlay({ overlayClass: 'switcher-overlay', cardClass: 'switcher-card' });
  dialog.card.innerHTML = `
    <input type="text" class="switcher-input" spellcheck="false" autocomplete="off" />
    <div class="switcher-list"></div>
    <div class="switcher-hint"></div>`;
  view = { dialog, inputEl: dialog.card.querySelector('.switcher-input'), listEl: dialog.card.querySelector('.switcher-list') };
  view.inputEl.addEventListener('input', () => update(0));
  view.inputEl.addEventListener('keydown', (e) => {
    if (e.isComposing || !KEYS[e.key]) return;
    e.preventDefault();
    e.stopPropagation();
    KEYS[e.key]();
  });
  view.listEl.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.switcher-item');
    if (!item) return;
    e.preventDefault();
    choose(Number(item.getAttribute('data-index')));
  });
}

export function openSwitcher() {
  ensureView();
  view.inputEl.placeholder = t('switcherPlaceholder');
  view.dialog.card.querySelector('.switcher-hint').textContent = t('switcherHint');
  view.inputEl.value = '';
  view.dialog.open();
  update(0);
  view.inputEl.focus();
  // Pick up newly discovered projects in the background
  refreshDiscovered().then(() => { if (view.dialog.isOpen()) update(state.index); });
}

export function closeSwitcher() {
  if (view) view.dialog.close();
}

// Ctrl+K anywhere (capture phase, so the terminal does not swallow it).
// e.code: works while the Korean IME is on (e.key would be 'ㅏ').
export function setupSwitcherShortcut() {
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.code !== 'KeyK') return;
    e.preventDefault();
    e.stopPropagation();
    if (view && view.dialog.isOpen()) closeSwitcher();
    else openSwitcher();
  }, true);
}
