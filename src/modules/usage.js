// Background Usage (Quota) Probe Module
//
// Quota is per account, not per session. Instead of injecting `/usage` into the
// user's visible terminal, we briefly launch the CLI in a hidden PTY (never attached
// to xterm), send `/usage` (codex: `/status`), parse the result and kill it.
// The result is applied to every folder that uses the same CLI.
//
// Probe records are immutable snapshots replaced on every step; what to do with the screen
// so far is decided by the pure `probeDecision`.

import { t } from './i18n.js';
import { getFolders, getFolder, getActiveFolderId, updateFolder, updateFoldersWhere } from './state.js';
import { renderUsageStatusBar, debouncedRenderSessionTabs } from './ui.js';
import { markUsageProbe } from './session.js';
import { usageOf } from './folder-model.js';
import { uniq } from './util.js';
// Parsing lives in usage-parser.js (pure, unit tested)
import { stripAnsi, parseUsageText, parseRateLimitWindows, mergeWindows } from './usage-parser.js';

export { parseRateLimitWindows };

const PROBE_PREFIX = '__usage_probe_';
const USAGE_INTERVAL_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 35 * 1000;
const PROBE_FALLBACK_SEND_MS = 14 * 1000;
const PROBE_READY_DELAY_MS = 1500;
const PROBE_RESEND_MS = 8 * 1000;
// Claude's panel renders per-model windows a moment after the first one ("Refreshing…")
const PROBE_SETTLE_MS = 3000;
const PROBE_MIN_GAP_MS = 60 * 1000;
const PROBE_BUFFER_MAX = 400000;
const PROBE_BUFFER_KEEP = 200000;

const PROBE_COMMANDS = {
  claude: { launch: 'claude', usage: '/usage' },
  // Update check off: an "Update now" dialog would otherwise swallow our keystrokes
  codex: { launch: 'codex -c check_for_update_on_startup=false', usage: '/status' },
  antigravity: { launch: 'agy', usage: '/usage' },
};

// Patterns that tell us the CLI's interactive UI has finished loading
const READY_PATTERNS = {
  claude: /Claude\s*Code\s*v|Welcome\s*back|Tips\s*for\s*getting\s*started|\?\s*for\s*shortcuts|shift\+tab\s*to\s*cycle/i,
  codex: /OpenAI\s*Codex|To\s*get\s*started|\/approvals|\?\s*for\s*shortcuts/i,
  antigravity: /Antigravity\s*CLI|Google\s*AI|Gemini\s*3\.|\?\s*for\s*shortcuts|type\s*\/[a-z]+/i,
};

const TRUST_PATTERN = /Do\s+you\s+trust\s+(?:the\s+)?(?:files|this\s+folder|the\s+contents|this\s+directory)/i;
// Update dialogs must never be confirmed by the probe; Esc skips them
const UPDATE_PATTERN = /Update\s+available|Update\s+now/i;

let probes = Object.freeze({}); // cli -> probe record
let lastProbeAt = Object.freeze({}); // cli -> timestamp
let usageByCli = Object.freeze({}); // cli -> { windows, updatedAt } last known quota
let schedulerTimer = null;

const setProbe = (cli, patch) => {
  const prev = probes[cli];
  probes = Object.freeze({ ...probes, [cli]: Object.freeze({ ...prev, ...patch }) });
  return probes[cli];
};
const dropProbe = (cli) => {
  probes = Object.freeze(Object.fromEntries(Object.entries(probes).filter(([k]) => k !== cli)));
};
const write = (probe, data) => window.api.writePty({ sessionId: probe.sessionId, data });
// Timers are registered on the record so finishProbe can clear them all
const later = (cli, fn, ms) => {
  const id = setTimeout(fn, ms);
  if (probes[cli]) setProbe(cli, { timers: [...probes[cli].timers, id] });
  return id;
};

export const isProbeSession = (sessionId) => typeof sessionId === 'string' && sessionId.startsWith(PROBE_PREFIX);
export const supportsUsageProbe = (cli) => !!PROBE_COMMANDS[cli];

// --- Usage on folders (store updates) ---
const patchUsage = (pred, fn) => updateFoldersWhere(pred, (f) => ({ usage: { ...usageOf(f), ...fn(usageOf(f)) } }));

function setRefreshing(cli, value) {
  patchUsage((f) => f.cli === cli, () => ({ isRefreshing: value }));
  renderUsageStatusBar();
}

// Token / cost counters of one folder (chat results, terminal output estimate)
export function addFolderUsage(folderId, tokens, cost = 0) {
  if (!getFolder(folderId) || (!tokens && !cost)) return;
  updateFolder(folderId, (f) => {
    const u = usageOf(f);
    return { usage: { ...u, tokens: u.tokens + tokens, cost: u.cost + cost } };
  });
  debouncedRenderSessionTabs();
}

// Apply quota values to every folder that uses this CLI (quota is account-wide).
export function applyUsageForCli(cli, parsed) {
  if (!parsed || !Array.isArray(parsed.windows) || parsed.windows.length === 0) return;
  const updatedAt = Date.now();
  const prev = usageByCli[cli] || { windows: [] };
  const windows = mergeWindows(prev.windows, parsed.windows);
  usageByCli = Object.freeze({ ...usageByCli, [cli]: { windows, updatedAt } });
  patchUsage((f) => f.cli === cli, () => ({ windows, updatedAt }));
  renderUsageStatusBar();
  debouncedRenderSessionTabs();
}

// Copy the last known quota of this CLI into a (newly launched) folder.
export function applyCachedUsage(folderId) {
  const folder = getFolder(folderId);
  if (!folder) return;
  const cached = usageByCli[folder.cli];
  patchUsage((f) => f.id === folderId, () => ({
    windows: cached ? cached.windows : [],
    updatedAt: cached ? cached.updatedAt : undefined,
  }));
}

function pickProbeFolder(cli) {
  const folders = getFolders().filter((f) => f.cli === cli && f.path);
  const activeId = getActiveFolderId();
  return folders.find((f) => f.id === activeId && f.isActive)
    || folders.find((f) => f.isActive)
    || folders[0]
    || null;
}

export async function runUsageProbe(cli, { force = false } = {}) {
  const cmd = PROBE_COMMANDS[cli];
  if (!cmd || probes[cli]) return;
  if (!force && Date.now() - (lastProbeAt[cli] || 0) < PROBE_MIN_GAP_MS) return;
  const folder = pickProbeFolder(cli);
  if (!folder) return;

  lastProbeAt = Object.freeze({ ...lastProbeAt, [cli]: Date.now() });
  setProbe(cli, {
    cli,
    sessionId: PROBE_PREFIX + cli,
    buffer: '',
    sendCount: 0,
    sendOffset: 0,
    trustAnswered: false,
    updateDismissed: false,
    readyTimer: null,
    settleTimer: null,
    timers: [],
  });
  markUsageProbe(cli, true);
  setRefreshing(cli, true);

  later(cli, () => { if (probes[cli] && !probes[cli].sendCount) sendUsageCommand(cli); }, PROBE_FALLBACK_SEND_MS);
  later(cli, () => finishProbe(cli), PROBE_TIMEOUT_MS);

  const res = await window.api.spawnPty({
    sessionId: PROBE_PREFIX + cli,
    folderPath: folder.path,
    commandToRun: cmd.launch,
    cols: 120,
    rows: 50,
  });
  if (!res || !res.success) finishProbe(cli);
}

function sendUsageCommand(cli) {
  const probe = probes[cli];
  if (!probe) return;
  const next = setProbe(cli, { sendCount: probe.sendCount + 1, sendOffset: probe.buffer.length });
  write(next, PROBE_COMMANDS[cli].usage);
  later(cli, () => { if (probes[cli]) write(probes[cli], '\r'); }, 150);

  // Resend once if nothing could be parsed (e.g. the UI was not ready yet)
  if (next.sendCount < 2) {
    later(cli, () => {
      const p = probes[cli];
      if (!p || p.settleTimer) return;
      write(p, '\x1b');
      later(cli, () => sendUsageCommand(cli), 400);
    }, PROBE_RESEND_MS);
  }
}

// Pure: what to do next, given the probe record and the screen text so far
export function probeDecision(probe, clean) {
  if (probe.sendCount) {
    return !probe.settleTimer && Object.keys(parseUsageText(probe.cli, clean)).length ? 'settle' : 'wait';
  }
  if (!probe.updateDismissed && UPDATE_PATTERN.test(clean)) return 'dismiss-update';
  // The folder was registered by the user to run this CLI in; accept the trust prompt for the probe
  // (never while an update dialog is on screen: Enter would confirm the update)
  if (!probe.trustAnswered && !UPDATE_PATTERN.test(clean) && TRUST_PATTERN.test(clean)) return 'accept-trust';
  if (!probe.readyTimer && READY_PATTERNS[probe.cli].test(clean)) return 'ready';
  return 'wait';
}

// Keep the buffer bounded; the send offset moves with the cut
const appendBuffer = (probe, data) => {
  const buffer = probe.buffer + data;
  if (buffer.length <= PROBE_BUFFER_MAX) return { buffer };
  const cut = buffer.length - PROBE_BUFFER_KEEP;
  return { buffer: buffer.slice(cut), sendOffset: Math.max(0, probe.sendOffset - cut) };
};

export function handleProbeData(sessionId, data) {
  const cli = sessionId.slice(PROBE_PREFIX.length);
  if (!probes[cli]) return;
  const probe = setProbe(cli, appendBuffer(probes[cli], data));
  const clean = stripAnsi(probe.sendCount ? probe.buffer.slice(probe.sendOffset) : probe.buffer);

  switch (probeDecision(probe, clean)) {
    case 'dismiss-update': {
      write(probe, '\x1b');
      // Re-arm: send the usage command once the dialog has closed
      if (probe.readyTimer) clearTimeout(probe.readyTimer);
      setProbe(cli, { updateDismissed: true, readyTimer: later(cli, () => sendUsageCommand(cli), PROBE_READY_DELAY_MS + 1000) });
      break;
    }
    case 'accept-trust':
      setProbe(cli, { trustAnswered: true });
      write(probe, '\r');
      break;
    case 'ready':
      setProbe(cli, { readyTimer: later(cli, () => sendUsageCommand(cli), PROBE_READY_DELAY_MS) });
      break;
    case 'settle':
      // Wait briefly so the full panel (session + week) is rendered before reading it
      setProbe(cli, { settleTimer: later(cli, () => finishProbe(cli), PROBE_SETTLE_MS) });
      break;
    default:
      break;
  }
}

export function handleProbeExit(sessionId) {
  finishProbe(sessionId.slice(PROBE_PREFIX.length));
}

function finishProbe(cli) {
  const probe = probes[cli];
  if (!probe) return;
  dropProbe(cli);
  probe.timers.forEach(clearTimeout);
  if (probe.sendCount) applyUsageForCli(cli, parseUsageText(cli, stripAnsi(probe.buffer.slice(probe.sendOffset))));
  window.api.killPty({ sessionId: probe.sessionId });
  markUsageProbe(cli, false);
  setRefreshing(cli, false);
}

const activeClis = () => uniq(getFolders().filter((f) => f.isActive).map((f) => f.cli)).filter(supportsUsageProbe);

export function startUsageScheduler() {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => activeClis().forEach((cli) => runUsageProbe(cli)), USAGE_INTERVAL_MS);
}

export function triggerManualUsageCheck() {
  const folder = getFolder(getActiveFolderId());
  if (!folder) {
    alert(t('noActiveSessionStartFirst'));
    return;
  }
  if (!supportsUsageProbe(folder.cli)) {
    alert(t('usageNotSupported'));
    return;
  }
  runUsageProbe(folder.cli, { force: true });
}
