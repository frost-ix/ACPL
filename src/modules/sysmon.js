// System Monitor for the status bar: system CPU, system memory, and the memory used by ACPL
// with everything it started (CLI sessions, WebView). Polled from the backend; the latest
// sample is an immutable snapshot rendered by the pure `systemStatusHtml`.

import { t } from './i18n.js';
import { escapeHtml, formatBytes } from './util.js';

const POLL_MS = 2000;
const ELEMENT_ID = 'sb-system';

let sample = null; // frozen { cpu, memUsed, memTotal, appMem }
let timer = null;

const level = (pct) => (pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : '');

const meter = (label, pct, text, title) => `
  <span class="sb-item sb-quota sb-sys ${level(pct)}" title="${escapeHtml(title)}">
    <span class="sb-muted">${label}</span>
    <span class="sb-bar"><span style="width:${Math.round(pct)}%"></span></span>
    <span class="sb-pct">${escapeHtml(text)}</span>
  </span>`;

// Pure: status bar HTML of one sample ('' until the first sample arrived)
export function systemStatusHtml(s = sample) {
  if (!s) return '';
  const memPct = s.memTotal ? (100 * s.memUsed) / s.memTotal : 0;
  return [
    typeof s.cpu === 'number' ? meter('CPU', s.cpu, `${Math.round(s.cpu)}%`, t('sysCpuTitle')) : '',
    s.memTotal ? meter('MEM', memPct, `${formatBytes(s.memUsed)} / ${formatBytes(s.memTotal)}`, t('sysMemTitle')) : '',
    s.appMem ? `<span class="sb-item sb-app" title="${escapeHtml(t('sysAppTitle'))}"><span class="sb-muted">ACPL</span> ${escapeHtml(formatBytes(s.appMem))}</span>` : '',
  ].join('');
}

// The status bar is re-rendered elsewhere; only this element is refreshed here
const paint = () => {
  const el = document.getElementById(ELEMENT_ID);
  if (el) el.innerHTML = systemStatusHtml();
};

export const systemStatusSlot = () => `<span id="${ELEMENT_ID}" class="sb-system">${systemStatusHtml()}</span>`;

async function poll() {
  if (!window.api.systemUsage || document.hidden) return;
  const next = await window.api.systemUsage();
  if (next) {
    sample = Object.freeze({ ...next });
    paint();
  }
}

export function startSystemMonitor() {
  if (timer) return;
  poll();
  timer = setInterval(poll, POLL_MS);
}
