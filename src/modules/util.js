// Shared pure helpers (no DOM, no app state) — safe to import from anywhere and to unit test.

export const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export const clip = (s, max) => {
  const str = String(s ?? '');
  return str.length > max ? `${str.slice(0, max)}…` : str;
};

export const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Case-insensitive Windows path key ("C:/a/b/" -> "c:\a\b")
export const normalizePath = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

export const pathParts = (p) => String(p || '').replace(/\\/g, '/').split('/').filter(Boolean);

export const basename = (p, fallback = 'New Folder') => {
  const parts = pathParts(p);
  return parts[parts.length - 1] || p || fallback;
};

// "…\parent\name" — enough to tell same-named folders apart
export const shortPath = (p) => {
  const parts = pathParts(p);
  return parts.length > 2 ? `…\\${parts.slice(-2).join('\\')}` : parts.join('\\');
};

export const sanitizeFilename = (s) => String(s || '').replace(/[\/\\:*?"<>|]/g, '_');

const pad2 = (n) => String(n).padStart(2, '0');

// "11/3 09:05"
export const formatShortDate = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// "20261103_090512"
export const fileStamp = (d = new Date()) =>
  `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;

// Relative time with caller-provided labels: { now, minutes, hours, days } ('{n}' placeholder)
export const formatAgo = (ms, labels, now = Date.now()) => {
  if (!ms) return '';
  const mins = Math.floor((now - ms) / 60000);
  const fill = (key, n) => labels[key].replace('{n}', n);
  if (mins < 1) return labels.now;
  if (mins < 60) return fill('minutes', mins);
  const hours = Math.floor(mins / 60);
  return hours < 24 ? fill('hours', hours) : fill('days', Math.floor(hours / 24));
};

// "2h13m" / "3d4h" / "5m" until `target`
export const formatDuration = (ms) => {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${pad2(m)}m`;
  return `${m}m`;
};

// 1536 -> "1.5 KB", 6.4e8 -> "610 MB", 1.7e10 -> "15.8 GB"
export const formatBytes = (bytes) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = bytes > 0 ? Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  const value = bytes / 1024 ** exp;
  return `${value >= 100 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`;
};

export const uniq = (list) => [...new Set(list)];

// Stable sort without touching the input
export const sortedBy = (list, compare) => [...list].sort(compare);

// Compose comparators: the first non-zero result wins
export const byAll = (...compares) => (a, b) => compares.reduce((r, c) => r || c(a, b), 0);

// Keeps the last `max` items (returns a new array)
export const appendCapped = (list, item, max) => [...list, item].slice(-max);

export const debounce = (fn, ms) => {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

// Deep-freeze plain data (objects / arrays); used for the immutable app state
export const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
