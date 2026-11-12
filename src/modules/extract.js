// Chat Extraction & PDF Report Module
//
// Both prefer the CLI's own history file (whole conversation, also from before an app restart);
// the screen content is the fallback for CLIs without one.

import { t, getCurrentLang } from './i18n.js';
import { getFolder, getActiveFolderId, termInstances } from './state.js';
import { serializeChat, submitChatPrompt, focusChatInput } from './chat.js';
import { getConversationId, loadTranscript } from './session.js';
import { transcriptToMarkdown } from './transcript.js';
import { displayName } from './folder-model.js';
import { fileStamp, sanitizeFilename } from './util.js';

const isEnglish = () => getCurrentLang() === 'en';

const exportFilename = (folder, kind) => {
  const names = { transcript: ['Transcript', '대화기록'], screen: ['ChatExtract', '대화추출'] }[kind];
  return `${sanitizeFilename(displayName(folder))}_${names[isEnglish() ? 0 : 1]}_${fileStamp()}.md`;
};

// Whole conversation from the CLI's history file, or null (no saved id / unsupported CLI)
async function buildTranscriptMarkdown(folder) {
  const id = getConversationId(folder);
  if (!id) return null;
  const transcript = await loadTranscript(folder, id);
  return transcript.found && transcript.messages.length
    ? transcriptToMarkdown(folder, displayName(folder), transcript, id)
    : null;
}

// --- Screen buffer fallback (pure text cleanup) ---
const STARTUP_LINE_TESTS = [
  (s) => s.includes('[PowerShell 세션 시작 중...]'),
  (s) => s.startsWith('경로:'),
  (s) => s.startsWith('실행 명령어:'),
  (s) => s.includes('Windows PowerShell'),
  (s) => s.includes('Copyright (C) Microsoft Corporation'),
  (s) => s.includes('All rights reserved.'),
  (s) => s.includes('Try the new cross-platform PowerShell'),
  (s) => s.includes('Install the latest PowerShell'),
];
const isStartupLine = (s) => STARTUP_LINE_TESTS.some((test) => test(s));

// Lines after the PowerShell banner / launch header (blank lines between them are skipped too)
const dropStartupHeader = (lines) => {
  const firstReal = lines.findIndex((l) => l.trim() && !isStartupLine(l.trim()));
  return firstReal < 0 ? [] : lines.slice(firstReal);
};

const trimBlankEdges = (lines) => {
  const first = lines.findIndex((l) => l.trim());
  if (first < 0) return [];
  const last = lines.length - 1 - [...lines].reverse().findIndex((l) => l.trim());
  return lines.slice(first, last + 1);
};

export function cleanTerminalText(lines) {
  if (!lines.length) return '';
  const cleaned = trimBlankEdges(dropStartupHeader(lines).map((l) => l.replace(/\s+$/, '')));
  // Fallback: everything was header -> keep the non-blank original lines
  const result = cleaned.length ? cleaned : lines.map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  // Collapse 3 or more consecutive blank lines down to a single blank line
  return result.join('\n').replace(/\n{3,}/g, '\n\n');
}

// xterm buffer -> lines (wrapped rows joined). The scrollback holds up to 100k rows, so the
// result is built in a local array (O(n)) instead of copying it per row; nothing leaks out.
const bufferLines = (buffer) => {
  const out = [];
  for (let i = 0; i < buffer.length; i += 1) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && out.length) out[out.length - 1] += text;
    else out.push(text);
  }
  return out;
};

const rawLines = (raw) => raw
  .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
  .replace(/\r\n?/g, '\n')
  .split('\n');

// Text of the current session as shown on screen
export function getTerminalBufferText(folderId) {
  const folder = getFolder(folderId);
  if (folder && folder.runningMode === 'chat') return serializeChat(folderId);
  const inst = termInstances[folderId];
  if (!inst) return '';
  const buffer = inst.term && inst.term.buffer && (inst.term.buffer.active || inst.term.buffer.normal);
  const lines = buffer ? bufferLines(buffer) : [];
  const hasContent = lines.some((l) => l.trim());
  return cleanTerminalText(hasContent ? lines : rawLines(inst.sessionRawText || ''));
}

// --- Actions ---
// Folder picker; focus goes back to the session afterwards
async function pickTargetFolder(buttonId, folderId) {
  const selectedPath = await window.api.openFolder();
  if (!selectedPath) return null;
  const btn = document.getElementById(buttonId);
  if (btn) btn.blur();
  const inst = termInstances[folderId];
  if (inst && inst.term) inst.term.focus();
  return selectedPath;
}

const screenExtractMarkdown = (folder, rawText, now = new Date()) => `# AI CLI PowerShell Session Raw Extract
- Folder: ${folder.path}
- Timestamp: ${now.toLocaleString()}
- CLI: ${folder.cli}

\`\`\`text
${rawText}
\`\`\`
`;

export async function exportConversationChatRaw() {
  const folderId = getActiveFolderId();
  if (!folderId) {
    alert(t('noActiveSessionStartFirst'));
    return;
  }
  const folder = getFolder(folderId);
  if (!folder) return;

  const transcriptMd = await buildTranscriptMarkdown(folder);
  const rawText = transcriptMd ? '' : getTerminalBufferText(folderId);
  if (!transcriptMd && !rawText.trim()) {
    alert(t('noContentToExtract'));
    return;
  }
  const selectedPath = await pickTargetFolder('btn-extract-chat', folderId);
  if (!selectedPath) return;

  const res = await window.api.saveExportFile({
    folderPath: selectedPath,
    filename: exportFilename(folder, transcriptMd ? 'transcript' : 'screen'),
    content: transcriptMd || screenExtractMarkdown(folder, rawText),
  });
  alert(res && res.success
    ? `${t('chatSavedSuccess')}${res.filePath}`
    : `${t('chatSavedError')}${(res && res.error) || ''}`);
}

const reportPrompt = (dir) => (isEnglish()
  ? `Please summarize the current conversation concisely into key points and generate a PDF report file in the "${dir}" folder immediately. (Bullet points only, omit extra explanations)`
  : `현재 대화 내용을 핵심 위주로 명확히 요약하여 "${dir}" 폴더에 PDF 보고서 파일로 즉시 생성해줘. (단답형 핵심 작성, 부연설명 생략)`);

// Report from the full history file: saved next to the report, then handed to the AI,
// so turns from before an app restart / compaction are included too
async function buildReportPrompt(folder, selectedPath) {
  const dir = selectedPath.replace(/\\/g, '/');
  const transcriptMd = await buildTranscriptMarkdown(folder);
  if (!transcriptMd) return reportPrompt(dir);
  const saved = await window.api.saveExportFile({
    folderPath: selectedPath,
    filename: exportFilename(folder, 'transcript'),
    content: transcriptMd,
  });
  return saved && saved.success && saved.filePath
    ? t('reportPromptTranscript').replace('{file}', saved.filePath.replace(/\\/g, '/')).replace('{dir}', dir)
    : reportPrompt(dir);
}

export async function exportConversationReportPDF() {
  const folderId = getActiveFolderId();
  if (!folderId) {
    alert(t('noActiveSessionForReport'));
    return;
  }
  const folder = getFolder(folderId);
  if (!folder || !folder.isActive) {
    alert(t('sessionNotActive'));
    return;
  }
  const selectedPath = await pickTargetFolder('btn-export-report', folderId);
  if (!selectedPath) return;
  const promptText = await buildReportPrompt(folder, selectedPath);

  if (folder.runningMode === 'chat') {
    if (!submitChatPrompt(folderId, promptText)) alert(t('chatBusy'));
    focusChatInput(folderId);
    return;
  }
  await window.api.writePty({ sessionId: folderId, data: promptText });
  setTimeout(() => {
    window.api.writePty({ sessionId: folderId, data: '\r' });
    const inst = termInstances[folderId];
    if (inst && inst.term) inst.term.focus();
  }, 60);
}
