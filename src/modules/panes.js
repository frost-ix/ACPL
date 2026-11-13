// Session Panes — up to 2 x 2 sessions side by side, arranged by drag & drop, plus a browser
// panel right of a session (when there are at most 2 sessions).
//
// The arrangement is the pure layout model (layout-model.js) kept in the store; this module
// renders it: each cell gets a small header and hosts the session's existing chat / terminal
// container (moved, never re-created, so conversations and terminals keep their state).

import { t } from './i18n.js';
import { getLayout, setLayout, getFolder, getActiveFolderId, chatInstances, termInstances } from './state.js';
import * as P from './layout-model.js';
import { displayName } from './folder-model.js';
import { escapeHtml, debounce } from './util.js';
import { onActions, beginPointerDrag, notifyOverlay, trackPointer } from './dom.js';
import { syncBrowsers, setBrowsersHidden, browserUrl, onBrowserUrl, navigateBrowser, browserHistory } from './browser-pane.js';
import { fitAndResizeTerminal } from './terminal.js';
import { focusChatInput } from './chat.js';
import { selectActiveFolder, launchFolderSession } from './ui.js';

export const BROWSER_CLIS = ['claude', 'codex'];
const cellEls = new Map(); // cell key -> element (runtime DOM handles)
const headHtmlOf = new WeakMap(); // cell element -> last header HTML
let launchedWithBrowser = Object.freeze([]); // terminal sessions started with their panel

const wrapper = () => document.getElementById('terminals-wrapper');

function gridEl() {
  let grid = document.getElementById('pane-grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.id = 'pane-grid';
    grid.className = 'pane-grid';
    wrapper().appendChild(grid);
  }
  return grid;
}

// The live chat / terminal element of a running session
function containerOf(id) {
  const folder = getFolder(id);
  if (!folder || !folder.isActive) return null;
  if (folder.runningMode === 'chat') return chatInstances[id] ? chatInstances[id].container : null;
  return termInstances[id] ? termInstances[id].container : null;
}

const isSessionContainer = (node) => node.classList
  && (node.classList.contains('terminal-instance') || node.classList.contains('chat-instance'));

// Back to the wrapper, hidden: the element survives outside the grid
function park(node) {
  node.classList.remove('active');
  node.style.display = 'none';
  wrapper().appendChild(node);
}

function setBody(body, node) {
  if (body.firstElementChild === node) return;
  [...body.children].filter(isSessionContainer).forEach(park);
  body.replaceChildren(node);
}

// --- Queries used by other modules ---
export const browserSlotOf = (id) => {
  const b = P.browserOf(getLayout(), id);
  return b ? b.slot : null;
};
export const isInPanes = (id) => P.hasSession(getLayout(), id);
export const focusedSession = () => getLayout().focused;
export const panesEmpty = () => P.isEmpty(getLayout());

export function markLaunchedWithBrowser(id, on) {
  const others = launchedWithBrowser.filter((x) => x !== id);
  launchedWithBrowser = Object.freeze(on ? [...others, id] : others);
}

// --- Cells ---
function sessionHeaderHtml(id, layout) {
  const folder = getFolder(id);
  if (!folder) return '';
  const hasBrowser = !!P.browserOf(layout, id);
  const cliOk = BROWSER_CLIS.includes(folder.cli);
  const browserTitle = !cliOk ? t('browserCliUnsupported')
    : hasBrowser ? t('browserClose')
    : P.canOpenBrowser(layout, id) ? t('browserOpen') : t('browserLimit');
  const disabled = !cliOk || (!hasBrowser && !P.canOpenBrowser(layout, id));
  const single = P.sessionIds(layout).length === 1 && !hasBrowser;
  return `
    <span class="pane-dot ${folder.isActive ? 'on' : ''}"></span>
    <span class="pane-title">${escapeHtml(displayName(folder))}</span>
    <span class="pane-cli">${escapeHtml(folder.cli)}</span>
    <span class="pane-spacer"></span>
    <button class="pane-btn ${hasBrowser ? 'on' : ''}" data-action="browser" title="${escapeHtml(browserTitle)}" ${disabled ? 'disabled' : ''}>🌐</button>
    ${single ? '' : `<button class="pane-btn" data-action="close-pane" title="${escapeHtml(t('paneClose'))}">✕</button>`}`;
}

const placeholderHtml = (id) => {
  const folder = getFolder(id);
  return `<div class="pane-placeholder">
    <span>${escapeHtml(folder ? displayName(folder) : '')}</span>
    <button class="pane-launch" data-action="launch">▶ ${escapeHtml(t('paneLaunch'))}</button>
  </div>`;
};

function createSessionCell(cell) {
  const el = document.createElement('section');
  el.className = 'pane-cell pane-session';
  el.setAttribute('data-id', cell.id);
  el.innerHTML = '<header class="pane-head"></header><div class="pane-body"></div>';
  // Clicking anywhere in a cell makes it the current session (capture: before xterm / inputs)
  el.addEventListener('mousedown', () => {
    if (getActiveFolderId() !== cell.id) selectActiveFolder(cell.id);
  }, true);
  onActions(el, {
    browser: () => toggleBrowser(cell.id),
    'close-pane': () => closePane(cell.id),
    launch: () => launchFolderSession(cell.id),
  });
  // Drag the header to move the pane (sides) or swap it with another one (middle)
  el.querySelector('.pane-head').addEventListener('mousedown', (e) => {
    if (e.target.closest('[data-action]') || P.sessionIds(getLayout()).length < 2) return;
    const folder = getFolder(cell.id);
    beginPointerDrag(e, {
      label: folder ? displayName(folder) : '',
      resolve: dropTargetOf,
      highlight: highlightDropTarget,
      onStart: () => showDropZones(cell.id),
      onEnd: hideDropZones,
      drop: (target) => dropFolder(cell.id, target),
    });
  });
  // Terminals follow their cell's size
  const refit = debounce(() => { if (termInstances[cell.id]) fitAndResizeTerminal(cell.id); }, 40);
  new ResizeObserver(refit).observe(el.querySelector('.pane-body'));
  return el;
}

function createBrowserCell(cell) {
  const el = document.createElement('section');
  el.className = 'pane-cell pane-browser';
  el.setAttribute('data-owner', cell.owner);
  el.innerHTML = `
    <header class="pane-head browser-head">
      <button class="pane-btn" data-action="back" title="${escapeHtml(t('browserBack'))}">◀</button>
      <button class="pane-btn" data-action="forward" title="${escapeHtml(t('browserForward'))}">▶</button>
      <button class="pane-btn" data-action="reload" title="${escapeHtml(t('browserReload'))}">⟳</button>
      <input class="browser-url" data-slot="${cell.slot}" spellcheck="false" placeholder="${escapeHtml(t('browserAddressPlaceholder'))}" />
      <button class="pane-btn" data-action="close-browser" title="${escapeHtml(t('browserClose'))}">✕</button>
    </header>
    <div class="browser-note hidden">
      <span>${escapeHtml(t('browserTerminalRestart'))}</span>
      <button class="pane-launch" data-action="relaunch">${escapeHtml(t('browserRestartBtn'))}</button>
    </div>
    <div class="pane-body browser-body"></div>`;
  const slot = () => cell.slot;
  onActions(el, {
    back: () => browserHistory(slot(), 'back'),
    forward: () => browserHistory(slot(), 'forward'),
    reload: () => browserHistory(slot(), 'reload'),
    'close-browser': () => toggleBrowser(cell.owner),
    relaunch: () => launchFolderSession(cell.owner),
  });
  const input = el.querySelector('.browser-url');
  input.value = browserUrl(cell.slot);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) navigateBrowser(cell.slot, input.value);
  });
  return el;
}

// Only when it changed: a click that also focuses the cell must still reach its button
function updateHeader(el, id, layout) {
  const headHtml = sessionHeaderHtml(id, layout);
  if (headHtmlOf.get(el) === headHtml) return;
  headHtmlOf.set(el, headHtml);
  el.querySelector('.pane-head').innerHTML = headHtml;
}

// Session names / states changed (alias, launch, exit): headers only, no re-layout
export function refreshPaneHeaders() {
  const layout = getLayout();
  cellEls.forEach((el) => {
    const id = el.getAttribute('data-id');
    if (id) updateHeader(el, id, layout);
  });
}

function updateCell(el, cell, layout, focused) {
  el.style.gridRow = `${cell.row}`;
  el.style.gridColumn = `${cell.col} / span ${cell.colSpan}`;
  if (cell.kind === 'browser') {
    const owner = getFolder(cell.owner);
    // A running terminal session only gets the panel's tools when it is (re)launched with it
    const needsRestart = !!(owner && owner.isActive && owner.runningMode === 'terminal' && !launchedWithBrowser.includes(cell.owner));
    el.querySelector('.browser-note').classList.toggle('hidden', !needsRestart);
    return;
  }
  el.classList.toggle('focused', cell.id === focused);
  updateHeader(el, cell.id, layout);
  const body = el.querySelector('.pane-body');
  const container = containerOf(cell.id);
  if (container) {
    setBody(body, container);
    container.classList.add('active');
    container.style.display = container.classList.contains('chat-instance') ? 'flex' : 'block';
  } else if (!body.querySelector('.pane-placeholder')) {
    [...body.children].filter(isSessionContainer).forEach(park);
    body.innerHTML = placeholderHtml(cell.id);
  }
}

// --- Rendering ---
export function renderPanes() {
  const grid = gridEl();
  const layout = getLayout();
  const { rows, cells } = P.gridCells(layout);
  const keys = cells.map((c) => c.key);

  cellEls.forEach((el, key) => {
    if (keys.includes(key)) return;
    [...el.querySelectorAll('.pane-body > *')].filter(isSessionContainer).forEach(park);
    el.remove();
    cellEls.delete(key);
  });
  cells.forEach((cell) => {
    if (!cellEls.has(cell.key)) {
      const el = cell.kind === 'session' ? createSessionCell(cell) : createBrowserCell(cell);
      cellEls.set(cell.key, el);
      grid.appendChild(el);
    }
    updateCell(cellEls.get(cell.key), cell, layout, layout.focused);
  });
  // Running sessions that are not on screen stay parked
  [...grid.querySelectorAll('.pane-body > *')].filter(isSessionContainer).forEach((node) => {
    if (!cells.some((c) => c.kind === 'session' && containerOf(c.id) === node)) park(node);
  });

  applySizes(grid, rows);
  renderSplitters(grid, layout);
  grid.classList.toggle('multi', cells.length > 1);
  grid.style.display = cells.length ? 'grid' : 'none';
  setBrowsersHidden('no-panes', cells.length === 0);
  syncBrowsers(cells.filter((c) => c.kind === 'browser')
    .map((c) => ({ slot: c.slot, el: cellEls.get(c.key).querySelector('.browser-body') })));
}

// --- Split sizes (drag the borders between panes) ---
let sizes = P.DEFAULT_SIZES; // { col, row } share of the first column / row (view state)

const fr = (share) => `minmax(0, ${share}fr) minmax(0, ${1 - share}fr)`;

function applySizes(grid, rows) {
  grid.style.gridTemplateColumns = fr(sizes.col);
  grid.style.gridTemplateRows = rows >= 2 ? fr(sizes.row) : 'minmax(0, 1fr)';
}

const pct = (v) => `${(v * 100).toFixed(3)}%`;

// One handle element per axis, created once and only re-positioned afterwards
function splitterEl(grid, axis) {
  let handle = grid.querySelector(`.pane-split-${axis}`);
  if (!handle) {
    handle = document.createElement('div');
    handle.className = `pane-split pane-split-${axis}`;
    handle.addEventListener('mousedown', (e) => startResize(e, axis));
    grid.appendChild(handle);
  }
  return handle;
}

function renderSplitters(grid, layout) {
  const { col, row } = P.splitHandles(layout, sizes);
  const place = (axis, box, style) => {
    if (!box) {
      const stale = grid.querySelector(`.pane-split-${axis}`);
      if (stale) stale.remove();
      return;
    }
    Object.assign(splitterEl(grid, axis).style, style(box));
  };
  place('col', col, (b) => ({ left: pct(b.x), top: pct(b.y), height: pct(b.h) }));
  place('row', row, (b) => ({ top: pct(b.y) }));
}

// Native browser panels would swallow the pointer while it crosses them: hidden meanwhile
function startResize(e, axis) {
  if (e.button !== 0) return;
  e.preventDefault();
  const grid = gridEl();
  const rect = grid.getBoundingClientRect();
  const rows = P.gridCells(getLayout()).rows;
  const bodyClass = axis === 'col' ? 'pane-resizing-col' : 'pane-resizing-row';
  notifyOverlay('resize', true);
  document.body.classList.add(bodyClass);
  trackPointer({
    onMove: (ev) => {
      const share = axis === 'col' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
      sizes = Object.freeze({ ...sizes, [axis]: P.clampRatio(share) });
      applySizes(grid, rows);
      renderSplitters(grid, getLayout());
    },
    onEnd: () => {
      document.body.classList.remove(bodyClass);
      notifyOverlay('resize', false);
    },
  });
}

// Show a running session: focus it if placed, else it takes the focused cell
export function showSession(id) {
  setLayout(P.show(getLayout(), id));
  renderPanes();
  const folder = getFolder(id);
  if (folder && folder.runningMode === 'chat') focusChatInput(id);
}

export function hidePanes() {
  gridEl().style.display = 'none';
  setBrowsersHidden('no-panes', true);
}

export function removeSession(id) {
  if (!isInPanes(id)) return;
  setLayout(P.remove(getLayout(), id));
  markLaunchedWithBrowser(id, false);
  renderPanes();
}

function closePane(id) {
  const next = P.remove(getLayout(), id);
  setLayout(next);
  renderPanes();
  if (next.focused && getActiveFolderId() === id) selectActiveFolder(next.focused);
}

function toggleBrowser(id) {
  const layout = getLayout();
  const next = P.browserOf(layout, id) ? P.closeBrowser(layout, id) : P.openBrowser(layout, id);
  if (!next) {
    window.alert(t('browserLimit'));
    return;
  }
  if (!P.browserOf(next, id)) markLaunchedWithBrowser(id, false);
  setLayout(next);
  renderPanes();
}

// --- Drag & drop targets (sidebar folder cards, session tabs) ---
const SIDE_ICONS = { left: '◧', right: '◨', top: '⬒', bottom: '⬓', center: '▣' };

// Zone rectangles inside a cell (fractions): sides are strips, the middle replaces
const ZONE_BOX = {
  left: [0, 0, 0.28, 1],
  right: [0.72, 0, 0.28, 1],
  top: [0.28, 0, 0.44, 0.3],
  bottom: [0.28, 0.7, 0.44, 0.3],
  center: [0.28, 0.3, 0.44, 0.4],
};

const zoneEl = (targetId, side, [x, y, w, h], box) => {
  const z = document.createElement('div');
  z.className = 'pane-drop';
  z.setAttribute('data-side', side);
  z.setAttribute('data-target', targetId || '');
  z.style.left = `${box.left + x * box.width}px`;
  z.style.top = `${box.top + y * box.height}px`;
  z.style.width = `${w * box.width}px`;
  z.style.height = `${h * box.height}px`;
  z.innerHTML = `<span>${SIDE_ICONS[side]}</span>`;
  return z;
};

let draggingId = null; // session being dragged (for the drop preview)

export function showDropZones(dragId) {
  hideDropZones();
  draggingId = dragId;
  const wrap = wrapper();
  const origin = wrap.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'pane-drop-layer';
  // The area the session would really take after the drop (shown for the hovered zone)
  const preview = document.createElement('div');
  preview.className = 'pane-drop-preview hidden';
  layer.appendChild(preview);
  const layout = getLayout();
  const relative = (r) => ({ left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height });

  if (P.isEmpty(layout) || gridEl().style.display === 'none') {
    layer.appendChild(zoneEl(null, 'center', [0, 0, 1, 1], relative(origin)));
  } else {
    cellEls.forEach((el) => {
      const id = el.getAttribute('data-id');
      if (!id || id === dragId) return; // browser cells / the dragged pane itself are no targets
      const box = relative(el.getBoundingClientRect());
      P.dropSides(layout, dragId, id).forEach((side) => layer.appendChild(zoneEl(id, side, ZONE_BOX[side], box)));
    });
  }
  wrap.appendChild(layer);
}

export function hideDropZones() {
  draggingId = null;
  document.querySelectorAll('.pane-drop-layer').forEach((el) => el.remove());
}

export function dropTargetOf(el) {
  const zone = el && el.closest && el.closest('.pane-drop');
  if (!zone) return null;
  const targetId = zone.getAttribute('data-target') || null;
  const side = zone.getAttribute('data-side');
  return { type: 'pane', key: `${targetId}:${side}`, targetId, side, el: zone };
}

export function highlightDropTarget(target, on) {
  if (!target || !target.el) return;
  target.el.classList.toggle('active', on);
  const preview = document.querySelector('.pane-drop-layer .pane-drop-preview');
  if (!preview) return;
  const box = on && draggingId
    ? P.dropPreview(getLayout(), draggingId, target.targetId, target.side, sizes)
    : null;
  preview.classList.toggle('hidden', !box);
  if (box) Object.assign(preview.style, { left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) });
}

// A folder dropped on the pane area: placed there, launched when it is not running yet
export async function dropFolder(id, target) {
  const layout = getLayout();
  const next = target.targetId ? P.place(layout, id, target.targetId, target.side) : P.show(P.emptyLayout(), id);
  if (!next) return;
  setLayout(next);
  const folder = getFolder(id);
  if (folder && folder.isActive) {
    renderPanes();
    selectActiveFolder(id);
  } else {
    renderPanes();
    await launchFolderSession(id);
  }
}

export function setupPanes() {
  onBrowserUrl((slot, url) => {
    const input = document.querySelector(`.browser-url[data-slot="${slot}"]`);
    if (input && document.activeElement !== input) input.value = url;
  });
}
