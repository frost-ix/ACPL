// Chat Slash-Command Palette
//
// Typing "/" in the chat input shows the commands of the folder's CLI:
//   claude : names reported by the CLI itself (stream-json `system/init` -> slash_commands,
//            cached per CLI) + commands/skills found on disk (with descriptions)
//   codex  : custom prompts in ~/.codex/prompts. `codex exec` has no slash commands,
//            so the prompt body is expanded by the app before sending.
//   app    : commands the app emulates because headless mode lacks them (claude /btw, see chat.js)

import { t, getCurrentLang } from './i18n.js';
import { escapeHtml } from './util.js';

const CACHE_KEY = (cli) => `acpl.slashCommands.${cli}`;

// Handled by the app itself (the CLI's headless mode does not offer them)
const CLEAR_COMMAND = { name: 'clear', ko: '대화 비우고 새 대화 시작 (이전 기록 파일은 유지)', en: 'Clear the chat and start a new conversation (history file is kept)' };
const APP_COMMANDS = {
  claude: [
    { name: 'btw', ko: '진행 중인 작업을 멈추지 않고 곁가지 질문하기 (도구 없음, 기록 안 남음)', en: 'Ask a side question without interrupting the current task (no tools, not saved)' },
    CLEAR_COMMAND,
  ],
  codex: [CLEAR_COMMAND],
};

// Fallback until the CLI reports its own list
const BUILTIN = {
  claude: [
    { name: 'compact', ko: '대화 내용을 요약해 컨텍스트 줄이기', en: 'Summarize the conversation to free context' },
    { name: 'context', ko: '컨텍스트 사용량 보기', en: 'Show context usage' },
    { name: 'cost', ko: '이 세션 비용/토큰 보기', en: 'Show session cost and tokens' },
    { name: 'init', ko: 'CLAUDE.md 생성', en: 'Create CLAUDE.md for this project' },
    { name: 'review', ko: '변경 사항 코드 리뷰', en: 'Review the current changes' },
  ],
  codex: [],
};

// `${cli}|${cwd}` -> [{ name, description, source, content }] (replaced, never edited in place)
let diskCache = Object.freeze({});
const diskKey = (folder) => `${folder.cli}|${folder.path}`;

function readReported(cli) {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY(cli)) || '[]');
    return Array.isArray(v) ? v.filter((n) => typeof n === 'string') : [];
  } catch (e) {
    return [];
  }
}

// claude stream-json init: { slash_commands: ['compact', ...], skills: [...] }
export function rememberReportedCommands(cli, names) {
  if (!Array.isArray(names) || names.length === 0) return;
  const clean = [...new Set(names.map((n) => String(n).replace(/^\//, '')).filter(Boolean))];
  try {
    localStorage.setItem(CACHE_KEY(cli), JSON.stringify(clean));
  } catch (e) {
    // ignore quota errors
  }
}

export async function loadDiskCommands(folder) {
  if (!folder || !window.api.listCliCommands) return [];
  const list = await window.api.listCliCommands({ cli: folder.cli, cwd: folder.path });
  diskCache = Object.freeze({ ...diskCache, [diskKey(folder)]: Array.isArray(list) ? list : [] });
  return diskCache[diskKey(folder)];
}

// Pure: merge command sources by name. A later source only fills in what an earlier one lacks
// (description / prompt body), so app & builtin descriptions win over bare CLI names.
export const mergeCommands = (sources) => [...sources.flat().reduce((byName, cmd) => {
  const prev = byName.get(cmd.name);
  if (prev && (prev.description || !cmd.description) && (prev.content || !cmd.content)) return byName;
  return byName.set(cmd.name, { ...prev, ...cmd, description: cmd.description || (prev && prev.description) || '' });
}, new Map()).values()];

export function getCommands(folder) {
  if (!folder) return [];
  const lang = getCurrentLang() === 'en' ? 'en' : 'ko';
  const described = (list, source) => (list[folder.cli] || []).map((b) => ({ name: b.name, description: b[lang], source }));
  return mergeCommands([
    described(APP_COMMANDS, 'app'),
    described(BUILTIN, 'builtin'),
    readReported(folder.cli).map((name) => ({ name, description: '', source: 'cli' })),
    diskCache[diskKey(folder)] || [],
  ]);
}

// Pure: name-prefix matches (sorted) first, then name / description contains.
// No cap: the palette scrolls, so every command stays reachable.
export function filterCommands(list, query) {
  const q = query.toLowerCase();
  const startsWith = (c) => c.name.toLowerCase().startsWith(q);
  const contains = (c) => c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q);
  return [
    ...list.filter(startsWith).sort((a, b) => a.name.localeCompare(b.name)),
    ...list.filter((c) => !startsWith(c) && contains(c)),
  ];
}

// codex: "/name args" -> prompt body with $ARGUMENTS / $1..$9 substituted.
// Returns null when the text is not a known expandable command.
export function expandCommand(folder, text) {
  const m = String(text).match(/^\/([\w:.-]+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const cmd = getCommands(folder).find((c) => c.name === m[1] && c.content);
  if (!cmd) return null;
  const args = (m[2] || '').trim();
  const positional = args ? args.split(/\s+/) : [];
  return cmd.content
    .replace(/\$ARGUMENTS/g, args)
    .replace(/\$([1-9])/g, (_, i) => positional[Number(i) - 1] || '');
}

// Attaches the palette to a chat instance. Returns { handleKeydown(e) -> bool, refresh() }.
export function attachCommandPalette(inst, getFolder) {
  const el = document.createElement('div');
  el.className = 'chat-cmd-palette hidden';
  inst.container.querySelector('.chat-composer').prepend(el);

  // Palette state is replaced as a whole on every change
  let state = Object.freeze({ open: false, items: [], index: 0 });
  const setState = (patch) => { state = Object.freeze({ ...state, ...patch }); };

  const close = () => {
    setState({ open: false });
    el.classList.add('hidden');
  };

  const choose = (i) => {
    const cmd = state.items[i];
    if (!cmd) return;
    inst.inputEl.value = `/${cmd.name} `;
    inst.inputEl.focus();
    inst.inputEl.setSelectionRange(inst.inputEl.value.length, inst.inputEl.value.length);
    close();
  };

  const render = () => {
    if (!state.items.length) {
      el.innerHTML = `<div class="chat-cmd-empty">${escapeHtml(t('chatNoCommands'))}</div>`;
      return;
    }
    el.innerHTML = state.items
      .map((c, i) => `
        <div class="chat-cmd-item ${i === state.index ? 'active' : ''}" data-index="${i}">
          <span class="chat-cmd-name">/${escapeHtml(c.name)}</span>
          <span class="chat-cmd-desc">${escapeHtml(c.description || '')}</span>
          <span class="chat-cmd-src">${escapeHtml(c.source || '')}</span>
        </div>`)
      .join('');
    const active = el.querySelector('.chat-cmd-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  };

  const refresh = () => {
    const v = inst.inputEl.value;
    const m = v.match(/^\/([^\s]*)$/); // only while typing the command word
    const folder = getFolder();
    if (!m || !folder) {
      close();
      return;
    }
    setState({ items: filterCommands(getCommands(folder), m[1]), index: 0, open: true });
    el.classList.remove('hidden');
    render();
  };

  el.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.chat-cmd-item');
    if (!item) return;
    e.preventDefault(); // keep focus in the textarea
    choose(Number(item.getAttribute('data-index')));
  });
  inst.inputEl.addEventListener('input', refresh);
  inst.inputEl.addEventListener('blur', () => setTimeout(close, 120));

  const handleKeydown = (e) => {
    if (!state.open) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!state.items.length) return false;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setState({ index: (state.index + d + state.items.length) % state.items.length });
      render();
      e.preventDefault();
      return true;
    }
    if ((e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.isComposing)) && state.items.length) {
      e.preventDefault();
      choose(state.index);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return true;
    }
    return false;
  };

  return { handleKeydown, refresh, close };
}
