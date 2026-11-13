// Pane Layout Model — pure functions over immutable data.
//
// The session area is a 2 x 2 grid of positions:   0 | 1
//                                                   2 | 3
// A cell holds a session { kind: 'session', id } or the browser panel of the session on its
// left { kind: 'browser', owner, slot }.
// Rules
//   - up to 4 sessions
//   - browser panels only while there are at most 2 sessions; with browsers the sessions are
//     stacked in column 0 and each panel sits right of its owner ("2 - 2")
//   - a row with one cell lets it span both columns; an empty first row collapses (normalize)

import { deepFreeze } from './util.js';

export const MAX_SESSIONS = 4;
export const MAX_BROWSER_SESSIONS = 2;
export const BROWSER_SLOTS = [0, 1];
export const SIDES = ['left', 'right', 'top', 'bottom', 'center'];

const at = (row, col) => row * 2 + col;
const rowOf = (pos) => Math.floor(pos / 2);
const colOf = (pos) => pos % 2;
const session = (id) => ({ kind: 'session', id });
const browser = (owner, slot) => ({ kind: 'browser', owner, slot });

const freeze = (layout) => deepFreeze({ cells: { ...layout.cells }, focused: layout.focused || null });

export const emptyLayout = () => freeze({ cells: {}, focused: null });

const entries = (L) => Object.entries(L.cells).map(([p, c]) => [Number(p), c]).sort((a, b) => a[0] - b[0]);

export const sessionIds = (L) => entries(L).filter(([, c]) => c.kind === 'session').map(([, c]) => c.id);
export const posOf = (L, id) => (entries(L).find(([, c]) => c.kind === 'session' && c.id === id) || [-1])[0];
export const hasSession = (L, id) => posOf(L, id) >= 0;
export const browsers = (L) => entries(L).map(([, c]) => c).filter((c) => c.kind === 'browser');
export const browserOf = (L, id) => browsers(L).find((b) => b.owner === id) || null;
export const isEmpty = (L) => Object.keys(L.cells).length === 0;

const rowUsed = (cells, row) => !!(cells[at(row, 0)] || cells[at(row, 1)]);

// Row 0 is never empty while row 1 has cells, and a lone cell sits in column 0
// (it spans the row anyway; this keeps positions predictable for later drops)
const normalize = (L) => {
  const rowsUp = rowUsed(L.cells, 0) || !rowUsed(L.cells, 1)
    ? L.cells
    : Object.fromEntries(entries(L).map(([p, c]) => [p - 2, c]));
  const cells = Object.fromEntries(Object.entries(rowsUp).map(([p, c]) => {
    const pos = Number(p);
    const lone = colOf(pos) === 1 && !rowsUp[pos - 1];
    return [lone ? pos - 1 : pos, c];
  }));
  return { ...L, cells };
};

const withoutKeys = (cells, positions) => Object.fromEntries(
  Object.entries(cells).filter(([p]) => !positions.includes(Number(p)))
);

// Positions of a session and of its browser panel
const ownedPositions = (L, id) => entries(L)
  .filter(([, c]) => (c.kind === 'session' && c.id === id) || (c.kind === 'browser' && c.owner === id))
  .map(([p]) => p);

const firstSession = (L) => sessionIds(L)[0] || null;

export const focus = (L, id) => (hasSession(L, id) ? freeze({ ...L, focused: id }) : L);

// Session (and its panel) leave the grid
export function remove(L, id) {
  if (!hasSession(L, id)) return L;
  const next = normalize({ cells: withoutKeys(L.cells, ownedPositions(L, id)), focused: L.focused });
  return freeze({ ...next, focused: next.focused === id || !hasSession(next, next.focused) ? firstSession(next) : next.focused });
}

// Show a session: already placed -> focus it; else it takes the focused cell (or the empty grid)
export function show(L, id) {
  if (hasSession(L, id)) return focus(L, id);
  if (isEmpty(L)) return freeze({ cells: { 0: session(id) }, focused: id });
  const target = hasSession(L, L.focused) ? L.focused : firstSession(L);
  return place(L, id, target, 'center') || L;
}

/**
 * Drop `id` next to (or onto) the session `targetId`. `id` may already be in the grid (move).
 * Returns the new layout, or null when the drop is not allowed (grid full, browser rules ...).
 */
export function place(L0, id, targetId, side) {
  if (!SIDES.includes(side)) return null;
  if (id === targetId) return side === 'center' ? focus(L0, id) : null;
  // Moving a pane that is already on screen
  if (hasSession(L0, id) && hasSession(L0, targetId)) {
    if (side === 'center') return swap(L0, id, targetId);
    // with browser panels a session moves together with its panel: rows trade places
    if (browsers(L0).length) return side === 'top' || side === 'bottom' ? swap(L0, id, targetId) : null;
  }
  const L = remove(L0, id);
  // empty grid: the whole area is one drop target
  if (isEmpty(L)) return side === 'center' ? freeze({ cells: { 0: session(id) }, focused: id }) : null;
  const t = posOf(L, targetId);
  if (t < 0) return null;
  const r = rowOf(t);
  const c = colOf(t);

  let cells;
  if (side === 'center') {
    // replaces the target (its panel closes)
    cells = { ...withoutKeys(L.cells, ownedPositions(L, targetId)), [t]: session(id) };
  } else if (side === 'left' || side === 'right') {
    if (L.cells[at(r, 1 - c)]) return null; // row is full (or holds a browser panel)
    const col = side === 'left' ? 0 : 1;
    cells = { ...withoutKeys(L.cells, [t]), [at(r, 1 - col)]: L.cells[t], [at(r, col)]: session(id) };
  } else {
    if (rowUsed(L.cells, 0) && rowUsed(L.cells, 1)) return null; // both rows used
    cells = side === 'bottom'
      ? { ...L.cells, [at(1, 0)]: session(id) }
      : { ...Object.fromEntries(entries(L).map(([p, cell]) => [p + 2, cell])), [at(0, 0)]: session(id) };
  }

  const next = normalize({ cells, focused: id });
  const count = sessionIds(next).length;
  if (count > MAX_SESSIONS) return null;
  if (browsers(next).length && count > MAX_BROWSER_SESSIONS) return null;
  return freeze(next);
}

/**
 * Two placed sessions trade places. With browser panels open the whole rows trade places,
 * so every panel stays right of its owner. Returns null when that is not possible.
 */
export function swap(L, a, b) {
  const pa = posOf(L, a);
  const pb = posOf(L, b);
  if (pa < 0 || pb < 0 || a === b) return null;
  const set = (cells, pos, cell) => {
    const { [pos]: _, ...rest } = cells;
    return cell ? { ...rest, [pos]: cell } : rest;
  };
  if (browsers(L).length) {
    const ra = rowOf(pa);
    const rb = rowOf(pb);
    if (ra === rb) return null;
    const cells = [0, 1].reduce((acc, col) => set(set(acc, at(ra, col), L.cells[at(rb, col)]), at(rb, col), L.cells[at(ra, col)]), L.cells);
    return freeze({ cells, focused: a });
  }
  return freeze({ cells: set(set(L.cells, pa, L.cells[pb]), pb, L.cells[pa]), focused: a });
}

// Sides on which `id` may be dropped onto `targetId`
export const dropSides = (L, id, targetId) => SIDES.filter((s) => place(L, id, targetId, s) !== null);

// Sessions stacked in column 0, panels right of their owners
const arrangeWithBrowsers = (ids, slotByOwner, focused) => freeze({
  cells: Object.fromEntries(ids.flatMap((id, row) => [
    [at(row, 0), session(id)],
    ...(slotByOwner.has(id) ? [[at(row, 1), browser(id, slotByOwner.get(id))]] : []),
  ])),
  focused,
});

export const canOpenBrowser = (L, id) => hasSession(L, id) && !browserOf(L, id)
  && sessionIds(L).length <= MAX_BROWSER_SESSIONS && browsers(L).length < BROWSER_SLOTS.length;

export function openBrowser(L, id) {
  if (browserOf(L, id)) return L;
  if (!canOpenBrowser(L, id)) return null;
  const used = browsers(L).map((b) => b.slot);
  const slot = BROWSER_SLOTS.find((s) => !used.includes(s));
  const slots = new Map([...browsers(L).map((b) => [b.owner, b.slot]), [id, slot]]);
  return arrangeWithBrowsers(sessionIds(L), slots, id);
}

export function closeBrowser(L, id) {
  const b = browserOf(L, id);
  if (!b) return L;
  return freeze(normalize({ cells: withoutKeys(L.cells, [entries(L).find(([, c]) => c === b)[0]]), focused: L.focused }));
}

// --- Geometry (fractions of the session area) ---
// sizes: { col, row } = share of the first column / first row (resizable splits)
export const DEFAULT_SIZES = Object.freeze({ col: 0.5, row: 0.5 });
export const SIZE_MIN = 0.15;
export const SIZE_MAX = 0.85;
export const clampRatio = (v) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, v));

// Box { x, y, w, h } (0..1) covered by a rendered cell (see gridCells)
export function cellBox(cell, rows, sizes = DEFAULT_SIZES) {
  const firstCol = cell.col === 1;
  const firstRow = cell.row === 1;
  return {
    x: firstCol ? 0 : sizes.col,
    w: cell.colSpan === 2 ? 1 : firstCol ? sizes.col : 1 - sizes.col,
    y: rows < 2 || firstRow ? 0 : sizes.row,
    h: rows < 2 ? 1 : firstRow ? sizes.row : 1 - sizes.row,
  };
}

// Where the dragged session would end up if dropped there (the real pane area), or null
export function dropPreview(L, id, targetId, side, sizes = DEFAULT_SIZES) {
  const next = targetId ? place(L, id, targetId, side) : show(emptyLayout(), id);
  if (!next) return null;
  const { rows, cells } = gridCells(next);
  const cell = cells.find((c) => c.key === `s:${id}`);
  return cell ? cellBox(cell, rows, sizes) : null;
}

// Resize handles: the column split (over the rows that are split) and the row split
export function splitHandles(L, sizes = DEFAULT_SIZES) {
  const { rows, cells } = gridCells(L);
  const splitRows = [1, 2].filter((r) => cells.some((c) => c.row === r && c.colSpan === 1));
  const top = splitRows.includes(1) ? 0 : sizes.row;
  const bottom = rows < 2 || splitRows.includes(2) ? 1 : sizes.row;
  return {
    col: splitRows.length ? { x: sizes.col, y: top, h: bottom - top } : null,
    row: rows === 2 ? { y: sizes.row } : null,
  };
}

/**
 * Grid placement of every cell for rendering:
 * { rows, cells: [{ key, kind, id | owner, slot?, row, col, colSpan }] } (1-based grid lines)
 */
export function gridCells(L) {
  const rows = [0, 1].filter((r) => rowUsed(L.cells, r));
  return {
    rows: rows.length,
    cells: entries(L).map(([p, cell]) => {
      const span = !L.cells[at(rowOf(p), 1 - colOf(p))];
      return {
        ...cell,
        key: cell.kind === 'session' ? `s:${cell.id}` : `b:${cell.owner}`,
        row: rows.indexOf(rowOf(p)) + 1,
        col: span ? 1 : colOf(p) + 1,
        colSpan: span ? 2 : 1,
      };
    }),
  };
}
