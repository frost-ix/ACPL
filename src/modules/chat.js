// Chat (Speech Bubble) UI Module
//
// Each message is sent through PowerShell to the CLI's non-interactive JSON mode:
//   claude -p --output-format stream-json ... [--resume <id>]
//   codex exec --json ... [resume <id>] -
// Output lines arrive as `chat:event` and are rendered as bubbles / tool rows.

import { t } from './i18n.js';
import { getFolder, updateFolder, chatInstances } from './state.js';
import { renderUsageStatusBar } from './ui.js';
import { applyUsageForCli, parseRateLimitWindows, addFolderUsage } from './usage.js';
import { setSessionRef, clearSessionRef, loadTranscript } from './session.js';
import { lastTurns } from './transcript.js';
import { escapeHtml, clip, oneLine, appendCapped } from './util.js';
import { isNearBottom } from './dom.js';
import {
  attachCommandPalette,
  loadDiskCommands,
  rememberReportedCommands,
  expandCommand
} from './chat-commands.js';

const CHAT_CLIS = ['claude', 'codex'];
const TOOL_RESULT_MAX = 4000;
// `/btw` side questions run as a separate process keyed `${folderId}${SIDE_SUFFIX}`
const SIDE_SUFFIX = '__btw';
const BTW_RE = /^\/btw(?:\s+([\s\S]*))?$/;
const CLEAR_RE = /^\/clear\s*$/i;
// Resumed conversation: how many earlier turns (user message + answer) are shown
const HISTORY_TURNS = 20;

const PERMISSION_OPTIONS = {
  claude: [
    { value: 'acceptEdits', key: 'permAcceptEdits' },
    { value: 'default', key: 'permDefault' },
    { value: 'plan', key: 'permPlan' },
    { value: 'bypassPermissions', key: 'permBypass' },
  ],
  codex: [
    { value: 'workspace-write', key: 'permWorkspaceWrite' },
    { value: 'read-only', key: 'permReadOnly' },
    { value: 'danger-full-access', key: 'permFullAccess' },
  ],
};

export function supportsChat(cli) {
  return CHAT_CLIS.includes(cli);
}

// viewMode defaults to chat for CLIs that support it
export function getViewMode(folder) {
  if (!folder || !supportsChat(folder.cli)) return 'terminal';
  return folder.viewMode === 'terminal' ? 'terminal' : 'chat';
}

// Lightweight markdown: code fences, inline code, bold, headings, line breaks
function renderMarkdown(text) {
  const parts = String(text || '').split(/```/);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const nl = part.indexOf('\n');
      const lang = nl >= 0 ? part.slice(0, nl).trim() : '';
      const code = nl >= 0 && /^[\w+#.-]*$/.test(lang) ? part.slice(nl + 1) : part;
      return `<pre class="chat-code"><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`;
    }
    return escapeHtml(part)
      .replace(/`([^`\n]+)`/g, '<code class="chat-inline-code">$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/^#{1,6}\s+(.+)$/gm, '<strong class="chat-heading">$1</strong>')
      .replace(/\n/g, '<br>');
  }).join('');
}

function getPermissionValue(folder) {
  const options = PERMISSION_OPTIONS[folder.cli] || [];
  const found = options.find((o) => o.value === folder.chatPermission);
  return found ? found.value : (options[0] ? options[0].value : '');
}

function renderPermissionOptions(inst, folder) {
  const options = PERMISSION_OPTIONS[folder.cli] || [];
  const current = getPermissionValue(folder);
  inst.permSelect.innerHTML = options
    .map((o) => `<option value="${o.value}" ${o.value === current ? 'selected' : ''}>${escapeHtml(t(o.key))}</option>`)
    .join('');
  inst.permSelect.title = t('chatPermTitle');
}

export function createChatInstance(folderId) {
  if (chatInstances[folderId]) return chatInstances[folderId];

  const terminalsWrapper = document.getElementById('terminals-wrapper');
  const container = document.createElement('div');
  container.className = 'chat-instance';
  container.id = `chat-container-${folderId}`;
  container.style.display = 'none';
  container.innerHTML = `
    <div class="chat-messages"></div>
    <div class="chat-queue"></div>
    <div class="chat-composer">
      <textarea class="chat-input" rows="1" spellcheck="false"></textarea>
      <div class="chat-composer-bar">
        <select class="chat-perm-select"></select>
        <span class="chat-status"></span>
        <button class="chat-send-btn"></button>
      </div>
    </div>
  `;
  terminalsWrapper.appendChild(container);

  const inst = {
    container,
    listEl: container.querySelector('.chat-messages'),
    queueEl: container.querySelector('.chat-queue'),
    inputEl: container.querySelector('.chat-input'),
    permSelect: container.querySelector('.chat-perm-select'),
    statusEl: container.querySelector('.chat-status'),
    sendBtn: container.querySelector('.chat-send-btn'),
    messages: [],
    resumeId: null,
    isBusy: false,
    cancelled: false,
    gotResult: false,
    stderrTail: [],
    currentBubble: null, // { el, msg } of the assistant bubble being streamed
    toolRows: {}, // tool id -> { el, msg }
    streamedMsgIds: new Set(),
    queue: [], // [{ text, el }] messages typed while the AI is still answering
    toolGroup: null, // { el, rows: [] } consecutive tool calls collapsed into one line
  };
  chatInstances[folderId] = inst;

  inst.palette = attachCommandPalette(inst, () => getFolder(folderId));

  inst.inputEl.addEventListener('keydown', (e) => {
    if (inst.palette.handleKeydown(e)) return;
    // isComposing: do not send while the Korean IME is still composing
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      submitInput(folderId);
    }
  });
  inst.inputEl.addEventListener('input', () => autoResize(inst.inputEl));
  inst.sendBtn.addEventListener('click', () => {
    if (inst.isBusy) cancelChat(folderId);
    else submitInput(folderId);
  });
  inst.permSelect.addEventListener('change', (e) => updateFolder(folderId, { chatPermission: e.target.value }));

  refreshChatTexts(folderId);
  return inst;
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 220) + 'px';
}

export function refreshChatTexts(folderId) {
  const inst = chatInstances[folderId];
  const folder = getFolder(folderId);
  if (!inst || !folder) return;
  inst.inputEl.placeholder = t('chatPlaceholder');
  renderPermissionOptions(inst, folder);
  updateBusyUi(inst);
}

function updateBusyUi(inst) {
  inst.sendBtn.textContent = inst.isBusy ? t('chatStop') : t('chatSend');
  inst.sendBtn.classList.toggle('busy', inst.isBusy);
  inst.inputEl.placeholder = inst.isBusy ? t('chatPlaceholderBusy') : t('chatPlaceholder');
  // The "waiting for the answer" indicator lives in the conversation; the composer only
  // shows how many messages are queued.
  inst.statusEl.textContent = inst.isBusy && inst.queue && inst.queue.length
    ? t('chatQueued').replace('{n}', inst.queue.length)
    : '';
  if (inst.isBusy) showTyping(inst);
  else hideTyping(inst);
}

// --- "Generating response..." bubble, always the last item of the conversation ---
function showTyping(inst) {
  if (!inst.typingEl) {
    const el = document.createElement('div');
    el.className = 'chat-row chat-row-assistant chat-row-typing';
    el.innerHTML = `
      <div class="chat-bubble chat-bubble-assistant chat-typing-bubble">
        <span class="chat-typing"><span></span><span></span><span></span></span>
        <span class="chat-typing-label"></span>
        <span class="chat-typing-elapsed"></span>
      </div>`;
    inst.typingEl = el;
  }
  inst.typingEl.querySelector('.chat-typing-label').textContent = t('chatThinking');
  if (inst.listEl.lastElementChild !== inst.typingEl) {
    keepingBottom(inst, () => inst.listEl.appendChild(inst.typingEl));
  }
  const tick = () => {
    const secs = Math.floor((Date.now() - (inst.busySince || Date.now())) / 1000);
    const el = inst.typingEl && inst.typingEl.querySelector('.chat-typing-elapsed');
    if (el) el.textContent = secs >= 3 ? `${secs}s` : '';
  };
  tick();
  if (!inst.typingTimer) inst.typingTimer = setInterval(tick, 1000);
}

function hideTyping(inst) {
  if (inst.typingTimer) {
    clearInterval(inst.typingTimer);
    inst.typingTimer = null;
  }
  if (inst.typingEl) inst.typingEl.remove();
}

// New conversation items go above the typing bubble
function appendToList(inst, el) {
  const typing = inst.typingEl;
  if (typing && typing.parentNode === inst.listEl) inst.listEl.insertBefore(el, typing);
  else inst.listEl.appendChild(el);
}

// Last real item (ignores the typing bubble)
function lastListItem(inst) {
  const last = inst.listEl.lastElementChild;
  return last && last === inst.typingEl ? last.previousElementSibling : last;
}

function scrollToBottom(inst) {
  inst.listEl.scrollTop = inst.listEl.scrollHeight;
}

// Runs a DOM change and keeps the list pinned to the bottom if it was there before
function keepingBottom(inst, fn) {
  const stick = isNearBottom(inst.listEl);
  const result = fn();
  if (stick) scrollToBottom(inst);
  return result;
}

const userHtml = (text) => escapeHtml(text).replace(/\n/g, '<br>');

// user / assistant bubble, or a notice line (system / error)
function addMessage(inst, msg) {
  inst.messages = [...inst.messages, msg];
  const el = document.createElement('div');
  el.className = `chat-row chat-row-${msg.role}`;
  if (msg.role === 'user' || msg.role === 'assistant') {
    el.innerHTML = `<div class="chat-bubble chat-bubble-${msg.role}">${msg.role === 'user' ? userHtml(msg.text) : renderMarkdown(msg.text)}</div>`;
  } else {
    el.innerHTML = '<div class="chat-notice"></div>';
    el.firstElementChild.textContent = msg.text;
  }
  keepingBottom(inst, () => appendToList(inst, el));
  return { el, msg };
}

function updateToolEl(el, msg) {
  const stateEl = el.querySelector('.chat-tool-state');
  const resultEl = el.querySelector('.chat-tool-result');
  stateEl.textContent = msg.status === 'error' ? ' ✗' : msg.status === 'done' ? ' ✓' : ' …';
  el.classList.toggle('error', msg.status === 'error');
  el.classList.toggle('no-result', !msg.result);
  resultEl.textContent = msg.result || '';
  resultEl.style.display = msg.result ? '' : 'none';
}

function appendAssistantText(inst, text, { newBubble = false } = {}) {
  if (!text) return;
  if (newBubble || !inst.currentBubble) {
    inst.currentBubble = addMessage(inst, { role: 'assistant', text: '' });
  }
  const { el, msg } = inst.currentBubble;
  const next = replaceMessage(inst, msg, { text: msg.text + text });
  inst.currentBubble = { el, msg: next };
  keepingBottom(inst, () => { el.firstElementChild.innerHTML = renderMarkdown(next.text); });
}

// "mcp__plugin_playwright_playwright__browser_click" -> "playwright.browser_click"
function shortToolName(name) {
  const s = String(name || 'tool');
  if (s.startsWith('mcp__')) {
    const parts = s.split('__').filter(Boolean);
    const server = (parts[1] || '').replace(/^plugin_/, '').split('_').pop();
    return `${server}.${parts.slice(2).join('_') || ''}`;
  }
  return s;
}

const shortSummary = (summary) => clip(oneLine(summary), 60);

// Message records are immutable: an update swaps the record in inst.messages
function replaceMessage(inst, oldMsg, patch) {
  const next = { ...oldMsg, ...patch };
  inst.messages = inst.messages.map((m) => (m === oldMsg ? next : m));
  return next;
}

// Pure: header of a collapsed run of tool calls -> { namesHtml, stateHtml, hasError }
function toolGroupSummary(msgs) {
  const count = (status) => msgs.filter((m) => m.status === status).length;
  const running = count('running');
  const errors = count('error');
  const done = msgs.length - running - errors;
  const many = msgs.length > 1;
  const names = msgs.reduce((acc, m) => {
    const n = shortToolName(m.name);
    return acc.set(n, (acc.get(n) || 0) + 1);
  }, new Map());
  const namesHtml = many
    ? [...names.entries()]
      .map(([n, c]) => `<span class="chat-tool-name">${escapeHtml(n)}</span>${c > 1 ? `<span class="tg-count">×${c}</span>` : ''}`)
      .join('<span class="tg-sep"> · </span>')
    : `<span class="chat-tool-name">${escapeHtml(shortToolName(msgs[0].name))}</span> <span class="chat-tool-summary">${escapeHtml(shortSummary(msgs[0].summary))}</span>`;
  const stateHtml = [
    running ? `<span class="tg-running">… ${running}</span>` : '',
    done ? `<span class="tg-done">✓${many ? ` ${done}` : ''}</span>` : '',
    errors ? `<span class="tg-error">✗${many ? ` ${errors}` : ''}</span>` : '',
  ].filter(Boolean).join(' ');
  return { namesHtml, stateHtml, hasError: errors > 0 };
}

// Consecutive tool calls are collapsed into one line:
//   ▸ ⚙ PowerShell ×2 · Glob · Write   ✓ 4        (click to see each call)
function ensureToolGroup(inst) {
  const g = inst.toolGroup;
  if (g && lastListItem(inst) === g.el) return g;
  const el = document.createElement('div');
  el.className = 'chat-row chat-row-tool';
  el.innerHTML = `
    <details class="chat-tool-group">
      <summary><span class="tg-names"></span><span class="tg-state"></span></summary>
      <div class="tg-body"></div>
    </details>`;
  keepingBottom(inst, () => appendToList(inst, el));
  inst.toolGroup = { el, body: el.querySelector('.tg-body'), rows: [] };
  return inst.toolGroup;
}

function updateToolGroupHeader(group) {
  const { namesHtml, stateHtml, hasError } = toolGroupSummary(group.rows.map((r) => r.msg));
  group.el.querySelector('.tg-names').innerHTML = namesHtml;
  group.el.querySelector('.tg-state').innerHTML = stateHtml;
  group.el.classList.toggle('error', hasError);
}

function addToolRow(inst, id, name, summary) {
  inst.currentBubble = null;
  const msg = { role: 'tool', name, summary, status: 'running', result: '' };
  inst.messages = [...inst.messages, msg];
  const group = ensureToolGroup(inst);
  const el = document.createElement('details');
  el.className = 'chat-tool';
  el.innerHTML = '<summary><span class="chat-tool-name"></span><span class="chat-tool-summary"></span><span class="chat-tool-state"></span></summary><pre class="chat-tool-result"></pre>';
  el.querySelector('.chat-tool-name').textContent = shortToolName(name);
  el.querySelector('.chat-tool-summary').textContent = summary ? ` ${shortSummary(summary)}` : '';
  el.title = summary || '';
  updateToolEl(el, msg);
  group.body.appendChild(el);
  const row = { el, msg, group };
  group.rows = [...group.rows, row];
  updateToolGroupHeader(group);
  if (id) inst.toolRows = { ...inst.toolRows, [id]: row };
  return row;
}

function setToolStatus(inst, row, patch) {
  row.msg = replaceMessage(inst, row.msg, patch);
  updateToolEl(row.el, row.msg);
  if (row.group) updateToolGroupHeader(row.group);
}

function finishToolRow(inst, id, result, isError) {
  const row = inst.toolRows[id];
  if (!row) return;
  const text = typeof result === 'string' ? result : stringifyToolResult(result);
  setToolStatus(inst, row, {
    status: isError ? 'error' : 'done',
    result: text.length > TOOL_RESULT_MAX ? `${text.slice(0, TOOL_RESULT_MAX)}\n…` : text,
  });
}

// Calls that never reported back (cancelled / crashed / not in a history file)
function settleRunningTools(inst, status) {
  Object.values(inst.toolRows)
    .filter((row) => row.msg.status === 'running')
    .forEach((row) => setToolStatus(inst, row, { status }));
}

function stringifyToolResult(content) {
  if (content == null) return '';
  if (Array.isArray(content)) {
    return content.map((c) => (c && c.type === 'text' ? c.text : (c && c.type ? `[${c.type}]` : ''))).join('\n');
  }
  if (typeof content === 'object') return JSON.stringify(content, null, 2);
  return String(content);
}

const TOOL_INPUT_KEYS = ['file_path', 'path', 'notebook_path', 'command', 'pattern', 'url', 'query', 'description', 'prompt'];

function summarizeToolInput(input) {
  if (!input || typeof input !== 'object') return '';
  const v = TOOL_INPUT_KEYS.map((k) => input[k]).find(Boolean) || '';
  return clip(typeof v === 'string' ? v : JSON.stringify(v), 140);
}

// --- Pure readers of CLI events (shared by the main chat and /btw) ---
const errorText = (detail) => `${t('chatErrorPrefix')}${detail || ''}`;

const claudeTextDelta = (ev) => {
  const e = ev.event || {};
  return e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta' ? e.delta.text : null;
};

const claudeResultUsage = (ev) => {
  const u = ev.usage || {};
  return {
    tokens: (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
    cost: ev.total_cost_usd || 0,
  };
};

// Error text of a failed `result` event, or null
const claudeResultError = (ev) => (ev.is_error || (ev.subtype && ev.subtype !== 'success')
  ? ev.result || (Array.isArray(ev.errors) ? ev.errors.join('\n') : '') || ev.subtype
  : null);

const claudeRateLimits = (ev) => {
  const info = ev.rate_limit_info || {};
  return parseRateLimitWindows(info.unifiedWindows || info.windows);
};

const codexToolName = (item, itemType) => ({
  command_execution: 'Shell',
  web_search: 'WebSearch',
  file_change: 'Edit',
})[itemType] || `${item.server || 'mcp'}.${item.tool || ''}`;

function recordUsage(folderId, { tokens, cost }) {
  addFolderUsage(folderId, tokens, cost);
  renderUsageStatusBar();
}

// Keep the CLI's conversation id on the folder so it survives an app restart
function rememberSession(folder, inst, id) {
  inst.resumeId = id;
  setSessionRef(folder.id, folder.cli, id);
}

// --- Claude stream-json events ---
function handleClaudeEvent(folder, inst, ev) {
  switch (ev.type) {
    case 'system':
      if (ev.subtype === 'init') {
        if (ev.session_id) rememberSession(folder, inst, ev.session_id);
        // The CLI reports what it can run -> palette list
        rememberReportedCommands(folder.cli, [...(ev.slash_commands || []), ...(ev.skills || [])]);
      }
      break;

    case 'stream_event': {
      const e = ev.event || {};
      if (e.type === 'message_start' && e.message) {
        inst.streamedMsgIds.add(e.message.id);
      } else if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'text') {
        inst.currentBubble = null;
      } else {
        const delta = claudeTextDelta(ev);
        if (delta) appendAssistantText(inst, delta);
      }
      break;
    }

    case 'assistant': {
      const message = ev.message || {};
      const streamed = message.id && inst.streamedMsgIds.has(message.id);
      (message.content || []).forEach((block) => {
        if (block.type === 'text' && !streamed) appendAssistantText(inst, block.text, { newBubble: true });
        else if (block.type === 'tool_use') addToolRow(inst, block.id, block.name, summarizeToolInput(block.input));
      });
      break;
    }

    case 'user': {
      const content = (ev.message && ev.message.content) || [];
      (Array.isArray(content) ? content : [])
        .filter((block) => block.type === 'tool_result')
        .forEach((block) => finishToolRow(inst, block.tool_use_id, block.content, block.is_error));
      break;
    }

    case 'rate_limit_event':
      applyUsageForCli('claude', claudeRateLimits(ev));
      break;

    case 'result': {
      inst.gotResult = true;
      if (ev.session_id) rememberSession(folder, inst, ev.session_id);
      recordUsage(folder.id, claudeResultUsage(ev));
      const error = claudeResultError(ev);
      if (error) addMessage(inst, { role: 'error', text: errorText(error) });
      break;
    }

    default:
      break;
  }
}

// --- Codex exec --json events ---
function handleCodexEvent(folder, inst, ev) {
  const item = ev.item || {};
  const itemType = item.type || item.item_type;

  switch (ev.type) {
    case 'thread.started':
      if (ev.thread_id) rememberSession(folder, inst, ev.thread_id);
      break;

    case 'item.started':
      if (['command_execution', 'mcp_tool_call', 'web_search'].includes(itemType)) {
        addToolRow(inst, item.id, codexToolName(item, itemType), item.command || item.query || '');
      }
      break;

    case 'item.completed': {
      // Tool row from item.started, or created now when the start was not seen
      const ensureRow = (summary) => { if (!inst.toolRows[item.id]) addToolRow(inst, item.id, codexToolName(item, itemType), summary); };
      if (itemType === 'agent_message' || itemType === 'assistant_message') {
        appendAssistantText(inst, item.text || '', { newBubble: true });
      } else if (itemType === 'command_execution') {
        ensureRow(item.command || '');
        const failed = item.status === 'failed' || (typeof item.exit_code === 'number' && item.exit_code !== 0);
        finishToolRow(inst, item.id, item.aggregated_output || '', failed);
      } else if (itemType === 'file_change') {
        addToolRow(inst, item.id, 'Edit', (item.changes || []).map((c) => `${c.kind || ''} ${c.path || ''}`.trim()).join(', '));
        finishToolRow(inst, item.id, '', item.status === 'failed');
      } else if (itemType === 'mcp_tool_call' || itemType === 'web_search') {
        ensureRow(item.query || '');
        finishToolRow(inst, item.id, item.result || item.error || '', item.status === 'failed');
      } else if (itemType === 'error') {
        addMessage(inst, { role: 'error', text: errorText(item.message) });
      }
      break;
    }

    case 'turn.completed': {
      inst.gotResult = true;
      const u = ev.usage || {};
      recordUsage(folder.id, { tokens: (u.input_tokens || 0) + (u.output_tokens || 0), cost: 0 });
      break;
    }

    case 'turn.failed':
      inst.gotResult = true;
      addMessage(inst, { role: 'error', text: errorText((ev.error && ev.error.message) || 'turn failed') });
      break;

    case 'error':
      addMessage(inst, { role: 'error', text: errorText(ev.message) });
      break;

    default:
      break;
  }
}

function submitInput(folderId) {
  const inst = chatInstances[folderId];
  if (!inst) return;
  const text = inst.inputEl.value.trim();
  if (!text) return;
  inst.inputEl.value = '';
  autoResize(inst.inputEl);
  inst.palette.close();
  // /clear: handled by the app (see clearConversation)
  if (CLEAR_RE.test(text)) {
    clearConversation(folderId);
    return;
  }
  // /btw goes out right away, even while the main turn is still running
  const folder = getFolder(folderId);
  const btw = folder && folder.cli === 'claude' ? text.match(BTW_RE) : null;
  if (btw) {
    sendSideQuestion(folderId, (btw[1] || '').trim());
    return;
  }
  if (inst.isBusy) {
    enqueuePrompt(inst, text);
    return;
  }
  sendChatPrompt(folderId, text);
}

// Send now, or queue it when the AI is still answering (used by the report button)
export function submitChatPrompt(folderId, text) {
  const inst = chatInstances[folderId];
  if (!inst) return false;
  if (inst.isBusy) {
    enqueuePrompt(inst, text);
    return true;
  }
  sendChatPrompt(folderId, text);
  return true;
}

// --- Input while the AI is answering: queued and sent in order when the turn ends ---
function enqueuePrompt(inst, text) {
  const el = document.createElement('div');
  el.className = 'chat-row chat-row-user chat-row-queued';
  el.innerHTML = `<div class="chat-bubble chat-bubble-user"><span class="chat-queue-tag">${escapeHtml(t('chatQueuedTag'))}</span>${userHtml(text)}</div><button class="chat-queue-remove" title="${escapeHtml(t('chatQueueRemove'))}">×</button>`;
  const item = Object.freeze({ text, el });
  el.querySelector('.chat-queue-remove').addEventListener('click', () => {
    inst.queue = inst.queue.filter((q) => q !== item);
    el.remove();
    updateBusyUi(inst);
  });
  inst.queue = [...inst.queue, item];
  inst.queueEl.appendChild(el);
  updateBusyUi(inst);
}

function sendNextQueued(folderId) {
  const inst = chatInstances[folderId];
  if (!inst || inst.isBusy || !inst.queue.length) return;
  const [item, ...rest] = inst.queue;
  inst.queue = rest;
  item.el.remove();
  sendChatPrompt(folderId, item.text);
}

// Stopped by the user: put the queued text back into the input instead of sending it
function restoreQueueToInput(inst) {
  if (!inst.queue.length) return;
  const texts = inst.queue.map((q) => q.text);
  inst.queue.forEach((q) => q.el.remove());
  inst.queue = [];
  const current = inst.inputEl.value.trim();
  inst.inputEl.value = [...texts, current].filter(Boolean).join('\n\n');
  autoResize(inst.inputEl);
}

// --- /btw side question ---
// The CLI only offers /btw in its interactive UI, so the app emulates it: the question runs on a
// throw-away fork of the current conversation with no tools (see build_chat_cli_command, `side`).
// The answer is shown in its own card and never enters the main session.
async function sendSideQuestion(folderId, question) {
  const inst = chatInstances[folderId];
  const folder = getFolder(folderId);
  if (!inst || !folder) return;
  if (!question) {
    addMessage(inst, { role: 'system', text: t('chatBtwUsage') });
    return;
  }
  if (inst.side) {
    addMessage(inst, { role: 'system', text: t('chatBtwBusy') });
    return;
  }

  const msg = { role: 'btw', text: question, answer: '' };
  inst.messages = [...inst.messages, msg];
  const el = document.createElement('div');
  el.className = 'chat-row chat-row-btw';
  el.innerHTML = `
    <div class="chat-btw running">
      <div class="chat-btw-q"><span class="chat-btw-tag">btw</span><span class="chat-btw-question"></span></div>
      <div class="chat-btw-a"><span class="chat-typing"><span></span><span></span><span></span></span></div>
    </div>`;
  el.querySelector('.chat-btw-question').textContent = question;
  appendToList(inst, el);
  scrollToBottom(inst);

  inst.side = { el, msg, answerEl: el.querySelector('.chat-btw-a'), streamedMsgIds: new Set(), gotResult: false, stderrTail: [] };

  const res = await window.api.chatSend({
    sessionId: folderId + SIDE_SUFFIX,
    folderPath: folder.path,
    cli: folder.cli,
    prompt: question,
    resumeId: inst.resumeId,
    side: true,
  });
  if (!res || !res.success) finishSide(inst, errorText(res && res.error));
}

function appendSideText(inst, text) {
  const side = inst.side;
  if (!side || !text) return;
  side.msg = replaceMessage(inst, side.msg, { answer: side.msg.answer + text });
  keepingBottom(inst, () => { side.answerEl.innerHTML = renderMarkdown(side.msg.answer); });
}

function finishSide(inst, error = '') {
  const side = inst.side;
  if (!side) return;
  const card = side.el.firstElementChild;
  card.classList.remove('running');
  card.classList.toggle('error', !!error);
  if (error) side.answerEl.textContent = error;
  else if (!side.msg.answer) side.answerEl.textContent = t('chatBtwNoAnswer');
  inst.side = null;
}

// Same stream as the main chat, reduced to: answer text, usage, errors
function handleSideEvent(folder, inst, ev) {
  const side = inst.side;
  if (!side) return;
  switch (ev.type) {
    case 'stream_event': {
      const e = ev.event || {};
      if (e.type === 'message_start' && e.message) side.streamedMsgIds.add(e.message.id);
      else appendSideText(inst, claudeTextDelta(ev));
      break;
    }
    case 'assistant': {
      const message = ev.message || {};
      if (message.id && side.streamedMsgIds.has(message.id)) break;
      (message.content || []).filter((b) => b.type === 'text').forEach((b) => appendSideText(inst, b.text));
      break;
    }
    case 'rate_limit_event':
      applyUsageForCli('claude', claudeRateLimits(ev));
      break;
    case 'result': {
      side.gotResult = true;
      recordUsage(folder.id, claudeResultUsage(ev));
      const error = claudeResultError(ev);
      if (error) finishSide(inst, errorText(error));
      break;
    }
    default:
      break;
  }
}

function cancelSide(folderId, inst) {
  if (!inst.side) return;
  window.api.chatCancel({ sessionId: folderId + SIDE_SUFFIX });
  inst.side = null;
}

export async function sendChatPrompt(folderId, text) {
  const inst = chatInstances[folderId];
  const folder = getFolder(folderId);
  if (!inst || !folder || inst.isBusy) return false;

  // codex exec has no slash commands: expand custom prompts (~/.codex/prompts) here
  const prompt = folder.cli === 'codex' ? (expandCommand(folder, text) || text) : text;
  updateFolder(folderId, { lastUsedAt: Date.now() }); // most recently used first in its group

  addMessage(inst, { role: 'user', text });
  scrollToBottom(inst);
  inst.currentBubble = null;
  inst.cancelled = false;
  inst.gotResult = false;
  inst.stderrTail = [];
  inst.isBusy = true;
  inst.busySince = Date.now();
  updateBusyUi(inst);

  const res = await window.api.chatSend({
    sessionId: folderId,
    folderPath: folder.path,
    cli: folder.cli,
    prompt,
    resumeId: inst.resumeId,
    permissionMode: getPermissionValue(folder),
  });

  if (!res || !res.success) {
    inst.isBusy = false;
    updateBusyUi(inst);
    addMessage(inst, { role: 'error', text: errorText(res && res.error) });
    return false;
  }
  return true;
}

export function cancelChat(folderId) {
  const inst = chatInstances[folderId];
  if (!inst || !inst.isBusy) return;
  inst.cancelled = true;
  window.api.chatCancel({ sessionId: folderId });
}

// Clear conversation (new session)
export function resetChat(folderId) {
  const inst = chatInstances[folderId];
  if (!inst) return;
  if (inst.isBusy) {
    // Late output / the exit of the killed run must not show up in the cleared chat
    inst.discardRun = true;
    window.api.chatCancel({ sessionId: folderId });
  }
  cancelSide(folderId, inst);
  inst.messages = [];
  inst.resumeId = null;
  inst.isBusy = false;
  inst.currentBubble = null;
  inst.toolRows = {};
  inst.toolGroup = null;
  inst.queue.forEach((q) => q.el.remove());
  inst.queue = [];
  inst.streamedMsgIds = new Set();
  hideTyping(inst);
  inst.listEl.innerHTML = '';
  updateBusyUi(inst);
}

// /clear — the CLIs only offer it in their interactive UI, and every chat turn resumes the
// saved conversation, so the app does it: empty the view and forget the conversation id;
// the next message starts a new conversation. (The CLI's history file is not deleted.)
function clearConversation(folderId) {
  const inst = chatInstances[folderId];
  if (!inst) return;
  resetChat(folderId);
  clearSessionRef(folderId);
  addMessage(inst, { role: 'system', text: t('chatCleared') });
}

// --- Earlier turns of a resumed conversation, read from the CLI's history file ---
// Rendered into a placeholder that was put in place right away, so a message sent while the
// file is still loading stays below the history.
async function restoreHistory(folderId, id) {
  const inst = chatInstances[folderId];
  const folder = getFolder(folderId);
  if (!inst || !folder) return;
  const placeholder = document.createElement('div');
  placeholder.className = 'chat-history';
  appendToList(inst, placeholder);

  const transcript = await loadTranscript(folder, id);
  if (chatInstances[folderId] !== inst || !placeholder.isConnected) return; // chat was reset
  if (!transcript.found || !transcript.messages.length) {
    placeholder.remove();
    return;
  }
  const { messages, totalTurns, hiddenTurns } = lastTurns(transcript.messages, HISTORY_TURNS);

  // Reuse the normal renderers with the placeholder as the target list
  const saved = {
    listEl: inst.listEl,
    toolGroup: inst.toolGroup,
    currentBubble: inst.currentBubble,
    toolRows: inst.toolRows,
    typingEl: inst.typingEl,
  };
  const before = inst.messages.length;
  Object.assign(inst, { listEl: placeholder, toolGroup: null, currentBubble: null, toolRows: {}, typingEl: null });
  try {
    if (hiddenTurns) {
      addMessage(inst, {
        role: 'system',
        text: t('historyTrimmed').replace('{total}', totalTurns).replace('{n}', HISTORY_TURNS),
      });
    }
    messages.forEach((m) => {
      if (m.role === 'user' || m.role === 'assistant') {
        inst.currentBubble = null;
        addMessage(inst, { role: m.role, text: m.text });
      } else if (m.role === 'tool') {
        addToolRow(inst, m.toolId, m.name || 'tool', m.text);
      } else if (m.role === 'tool_result') {
        finishToolRow(inst, m.toolId, m.text, m.isError);
      }
    });
    // Calls whose result is not in the file (e.g. codex) are finished anyway
    settleRunningTools(inst, 'done');
    if (transcript.partial) addMessage(inst, { role: 'system', text: t('historyPartial') });
    addMessage(inst, { role: 'system', text: t('historyEnd') });
  } finally {
    Object.assign(inst, saved);
    // History goes before anything typed while it was loading
    inst.messages = [...inst.messages.slice(before), ...inst.messages.slice(0, before)];
  }
  scrollToBottom(inst);
}

export function startChatSession(folderId, resumeId = null) {
  const inst = createChatInstance(folderId);
  const folder = getFolder(folderId);
  resetChat(folderId);
  refreshChatTexts(folderId);
  if (folder) {
    addMessage(inst, { role: 'system', text: `${t('chatReady').replace('{cli}', folder.cli.toUpperCase())}  (${folder.path})` });
  }
  if (resumeId) {
    inst.resumeId = resumeId;
    addMessage(inst, { role: 'system', text: t('sessionResumedNotice').replace('{id}', resumeId.slice(0, 8)) });
    restoreHistory(folderId, resumeId).catch(() => {});
  }
  // Slash commands found on disk for the palette (refreshed on every launch)
  if (folder) loadDiskCommands(folder).catch(() => {});
  return inst;
}

export function destroyChatInstance(folderId) {
  const inst = chatInstances[folderId];
  if (!inst) return;
  if (inst.isBusy) window.api.chatCancel({ sessionId: folderId });
  cancelSide(folderId, inst);
  hideTyping(inst);
  if (inst.container.parentNode) inst.container.parentNode.removeChild(inst.container);
  delete chatInstances[folderId];
}

export function focusChatInput(folderId) {
  const inst = chatInstances[folderId];
  if (inst) inst.inputEl.focus();
}

// Plain-text transcript for the "extract chat" feature
export function serializeChat(folderId) {
  const inst = chatInstances[folderId];
  if (!inst) return '';
  return inst.messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'user') return `### ${t('chatYou')}\n${m.text}`;
      if (m.role === 'assistant') return `### AI\n${m.text}`;
      if (m.role === 'btw') return `> btw: ${m.text}\n>\n${(m.answer || '').split('\n').map((l) => `> ${l}`).join('\n')}`;
      if (m.role === 'tool') return `> 🔧 ${m.name}${m.summary ? ' ' + m.summary : ''}${m.status === 'error' ? ' (error)' : ''}`;
      return `> ${m.text}`;
    })
    .join('\n\n');
}

// --- Backend events ---
const STDERR_TAIL = 20;

// Which chat a process belongs to: the folder's main chat, or its /btw side run
const routeOf = (sessionId) => {
  const side = sessionId.endsWith(SIDE_SUFFIX);
  const folderId = side ? sessionId.slice(0, -SIDE_SUFFIX.length) : sessionId;
  return { folderId, side, inst: chatInstances[folderId], folder: getFolder(folderId) };
};

const parseEvent = (line) => {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    return null;
  }
};

const failureDetail = (tail, exitCode) => tail.slice(-8).join('\n') || `exit code ${exitCode}`;

function onMainExit(folderId, inst, exitCode) {
  if (inst.discardRun) {
    inst.discardRun = false; // the run was killed by resetChat
    return;
  }
  inst.isBusy = false;
  inst.currentBubble = null;
  settleRunningTools(inst, 'error'); // cancelled / crashed
  const wasCancelled = inst.cancelled;
  if (wasCancelled) {
    addMessage(inst, { role: 'system', text: t('chatStopped') });
    restoreQueueToInput(inst);
  } else if (exitCode !== 0 && !inst.gotResult) {
    addMessage(inst, { role: 'error', text: errorText(failureDetail(inst.stderrTail, exitCode)) });
  }
  inst.cancelled = false;
  updateBusyUi(inst);
  // Messages typed while the AI was answering go out next, in order
  if (!wasCancelled) sendNextQueued(folderId);
}

export function setupChatListeners() {
  window.api.onChatEvent(({ sessionId, line }) => {
    const { side, inst, folder } = routeOf(sessionId);
    if (!inst || !folder || (!side && inst.discardRun)) return;
    const ev = parseEvent(line);
    if (side) {
      if (ev) handleSideEvent(folder, inst, ev); // non-JSON noise of a side run is ignored
    } else if (!ev) {
      // Non-JSON output (e.g. warnings) is shown as a muted notice
      if (line.trim()) addMessage(inst, { role: 'system', text: line });
    } else if (folder.cli === 'codex') {
      handleCodexEvent(folder, inst, ev);
    } else {
      handleClaudeEvent(folder, inst, ev);
    }
  });

  window.api.onChatStderr(({ sessionId, line }) => {
    const { side, inst } = routeOf(sessionId);
    const target = side ? inst && inst.side : inst;
    if (target) target.stderrTail = appendCapped(target.stderrTail, line, STDERR_TAIL);
  });

  window.api.onChatExit(({ sessionId, exitCode }) => {
    const { folderId, side, inst } = routeOf(sessionId);
    if (!inst) return;
    if (!side) {
      onMainExit(folderId, inst, exitCode);
    } else if (inst.side) {
      const failed = exitCode !== 0 && !inst.side.gotResult;
      finishSide(inst, failed ? errorText(failureDetail(inst.side.stderrTail, exitCode)) : '');
    }
  });
}
