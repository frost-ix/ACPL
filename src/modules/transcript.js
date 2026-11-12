// Conversation Transcripts — pure functions.
//
// The backend parses the CLIs' own history files (see session.js loadTranscript) into
// [{ role: user|assistant|tool|tool_result, text, name?, toolId?, isError?, ts? }].
// These helpers pick the turns to show and render the Markdown export.

import { t, getCurrentLang } from './i18n.js';

// Last `n` turns (a turn starts at a user message). Returns { messages, totalTurns, hiddenTurns }.
export function lastTurns(messages, n) {
  const starts = messages.flatMap((m, i) => (m.role === 'user' ? [i] : []));
  const totalTurns = starts.length;
  return totalTurns <= n
    ? { messages, totalTurns, hiddenTurns: 0 }
    : { messages: messages.slice(starts[totalTurns - n]), totalTurns, hiddenTurns: totalTurns - n };
}

const locale = () => (getCurrentLang() === 'en' ? 'en-US' : 'ko-KR');

const formatTs = (ts) => {
  if (!ts) return '';
  const d = /^\d+$/.test(ts) ? new Date(Number(ts)) : new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale());
};

const quote = (text) => String(text || '').split('\n').map((l) => `> ${l}`).join('\n');

const toolLines = (m, result) => [
  `> 🔧 **${m.name || 'tool'}** ${m.text ? `\`${m.text.replace(/`/g, "'")}\`` : ''}${result && result.isError ? ' ✗' : ''}`,
  ...(result && result.text && result.text.trim()
    ? ['', '<details><summary>output</summary>', '', '```text', result.text.replace(/```/g, "'''"), '```', '', '</details>']
    : []),
  '',
];

// Markdown lines of one message (turn = number of the user message it belongs to)
const messageLines = (m, turn, results) => {
  if (m.role === 'user') {
    const when = formatTs(m.ts);
    return ['---', '', `## ${turn}. ${t('chatYou')}${when ? `  _(${when})_` : ''}`, '', m.text, ''];
  }
  if (m.role === 'assistant') return ['### AI', '', m.text, ''];
  if (m.role === 'tool') return toolLines(m, m.toolId && results.get(m.toolId));
  return []; // tool results are printed with their call
};

// Full conversation as Markdown (tool calls as one line, their output folded)
export function transcriptToMarkdown(folder, displayName, transcript, id) {
  const results = new Map(transcript.messages.filter((m) => m.role === 'tool_result' && m.toolId).map((m) => [m.toolId, m]));
  // Turn number of every message (running count of user messages; O(n), counter is local)
  let count = 0;
  const turns = transcript.messages.map((m) => (count += m.role === 'user' ? 1 : 0));
  const header = [
    `# ${t('transcriptTitle')} — ${displayName}`,
    '',
    `- ${t('settingsPathLabel')}: ${folder.path}`,
    `- CLI: ${folder.cli}`,
    `- ${t('transcriptIdLabel')}: ${id}`,
    `- ${t('transcriptSourceLabel')}: ${transcript.path || ''}`,
    `- ${t('transcriptExportedLabel')}: ${new Date().toLocaleString(locale())}`,
    '',
    ...(transcript.partial ? [quote(t('historyPartial')), ''] : []),
  ];
  return [...header, ...transcript.messages.flatMap((m, i) => messageLines(m, turns[i], results))]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}
