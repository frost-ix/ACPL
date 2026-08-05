// Chat Extraction & PDF Report Module

import { t, getCurrentLang } from './i18n.js';
import { getFolders, getActiveFolderId, termInstances } from './state.js';
import { getFolderDisplayName } from './ui.js';

// Extract raw text from xterm buffer (excluding initial PowerShell startup headers)
export function getTerminalBufferText(folderId) {
  const inst = termInstances[folderId];
  if (!inst) return '';

  let textLines = [];

  if (inst.term && inst.term.buffer) {
    const buffer = inst.term.buffer.active || inst.term.buffer.normal;
    if (buffer) {
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i);
        if (!line) continue;

        const lineStr = line.translateToString(true);

        if (line.isWrapped && textLines.length > 0) {
          textLines[textLines.length - 1] += lineStr;
        } else {
          textLines.push(lineStr);
        }
      }
    }
  }

  const hasBufferContent = textLines.some((l) => l.trim().length > 0);

  let resultLines = [];
  if (hasBufferContent) {
    resultLines = textLines;
  } else if (inst.sessionRawText) {
    const cleanRaw = inst.sessionRawText
      .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
    resultLines = cleanRaw.split('\n');
  }

  if (resultLines.length === 0) return '';

  let cliStartIndex = 0;
  for (let i = 0; i < resultLines.length; i++) {
    const trimmed = resultLines[i].trim();
    if (!trimmed) continue;

    const isPowerShellStartup =
      trimmed.includes('[PowerShell 세션 시작 중...]') ||
      trimmed.startsWith('경로:') ||
      trimmed.startsWith('실행 명령어:') ||
      trimmed.includes('Windows PowerShell') ||
      trimmed.includes('Copyright (C) Microsoft Corporation') ||
      trimmed.includes('All rights reserved.') ||
      trimmed.includes('Try the new cross-platform PowerShell') ||
      trimmed.includes('Install the latest PowerShell');

    if (isPowerShellStartup) {
      cliStartIndex = i + 1;
    } else {
      break;
    }
  }

  let filteredLines = resultLines.slice(cliStartIndex);

  // Trim trailing whitespace on each line
  let cleanedLines = filteredLines.map((line) => line.replace(/\s+$/, ''));

  // Clean leading blank lines
  while (cleanedLines.length > 0 && cleanedLines[0].trim() === '') {
    cleanedLines.shift();
  }

  // Clean trailing blank lines
  while (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1].trim() === '') {
    cleanedLines.pop();
  }

  // Fallback: if filtering resulted in empty text, return original non-blank lines
  if (cleanedLines.length === 0 && resultLines.length > 0) {
    const nonBlank = resultLines.map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim().length > 0);
    if (nonBlank.length > 0) {
      return nonBlank.join('\n');
    }
  }

  // Collapse 3 or more consecutive blank lines down to a single blank line
  return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n');
}

export async function exportConversationChatRaw() {
  const activeFolderId = getActiveFolderId();
  if (!activeFolderId) {
    alert(t('noActiveSessionStartFirst'));
    return;
  }

  const folders = getFolders();
  const folder = folders.find((f) => f.id === activeFolderId);
  if (!folder) return;

  const rawText = getTerminalBufferText(activeFolderId);
  if (!rawText || rawText.trim().length === 0) {
    alert(t('noContentToExtract'));
    return;
  }

  const selectedPath = await window.api.openFolder();
  if (!selectedPath) return;

  const btnExtractChat = document.getElementById('btn-extract-chat');
  if (btnExtractChat) btnExtractChat.blur();
  const inst = termInstances[activeFolderId];
  if (inst && inst.term) {
    inst.term.focus();
  }

  const displayName = getFolderDisplayName(folder).replace(/[\/\\:\*\?"<>\|]/g, '_');
  const now = new Date();
  const dateStr = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') + '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');

  const currentLang = getCurrentLang();
  const filename = currentLang === 'en'
    ? `${displayName}_ChatExtract_${dateStr}.md`
    : `${displayName}_대화추출_${dateStr}.md`;

  const mdContent = `# AI CLI PowerShell Session Raw Extract
- Folder: ${folder.path}
- Timestamp: ${now.toLocaleString()}
- CLI: ${folder.cli}

\`\`\`text
${rawText}
\`\`\`
`;

  const res = await window.api.saveExportFile({
    folderPath: selectedPath,
    filename: filename,
    content: mdContent,
  });

  if (res && res.success) {
    alert(`${t('chatSavedSuccess')}${res.filePath}`);
  } else {
    alert(`${t('chatSavedError')}${res && res.error ? res.error : ''}`);
  }
}

export async function exportConversationReportPDF() {
  const activeFolderId = getActiveFolderId();
  if (!activeFolderId) {
    alert(t('noActiveSessionForReport'));
    return;
  }

  const folders = getFolders();
  const folder = folders.find((f) => f.id === activeFolderId);
  if (!folder || !folder.isActive) {
    alert(t('sessionNotActive'));
    return;
  }

  const selectedPath = await window.api.openFolder();
  if (!selectedPath) return;

  const btnExportReport = document.getElementById('btn-export-report');
  if (btnExportReport) btnExportReport.blur();
  const inst = termInstances[activeFolderId];
  if (inst && inst.term) {
    inst.term.focus();
  }

  const normalizedPath = selectedPath.replace(/\\/g, '/');
  const currentLang = getCurrentLang();
  const promptText = currentLang === 'en'
    ? `Please summarize the current conversation concisely into key points and generate a PDF report file in the "${normalizedPath}" folder immediately. (Bullet points only, omit extra explanations)`
    : `현재 대화 내용을 핵심 위주로 명확히 요약하여 "${normalizedPath}" 폴더에 PDF 보고서 파일로 즉시 생성해줘. (단답형 핵심 작성, 부연설명 생략)`;

  await window.api.writePty({ sessionId: activeFolderId, data: promptText });

  setTimeout(() => {
    window.api.writePty({ sessionId: activeFolderId, data: '\r' });
    if (inst && inst.term) {
      inst.term.focus();
    }
  }, 60);
}
