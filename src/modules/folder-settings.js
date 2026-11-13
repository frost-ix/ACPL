// Folder Settings Dialog
//
// The sidebar shows two compact lines per folder; everything else (alias, group, CLI, view mode,
// custom command, saved conversation, pin / archive, delete, global options) lives here.
// Every change goes to the store right away; the dialog is re-rendered from the store.

import { t } from './i18n.js';
import { getFolder } from './state.js';
import { supportsChat, getViewMode } from './chat.js';
import { supportsResume, isResumeEnabled, getSessionRef, clearSessionRef } from './session.js';
import {
  KNOWN_CLIS,
  getGroups,
  isMergeSamePath,
  setMergeSamePath,
  setFolderGroup,
  patchFolder,
  toggleArchived
} from './folders.js';
import { pinToggled } from './folder-model.js';
import { renderFolderCards, renderSessionIndicators, removeFolderCard } from './ui.js';
import { createOverlay, onActions } from './dom.js';
import { escapeHtml, formatShortDate } from './util.js';

const CLI_LABELS = {
  claude: 'Claude (claude)',
  antigravity: 'Antigravity (agy)',
  codex: 'Codex (codex)',
};

let dialog = null;
let currentId = null;

const option = (value, label, selected) =>
  `<option value="${escapeHtml(value)}" ${selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;

const checkbox = (field, checked, label) => `
  <label class="folder-session-toggle">
    <input type="checkbox" data-field="${field}" ${checked ? 'checked' : ''} />
    <span>${label}</span>
  </label>`;

const sessionRowHtml = (folder) => {
  if (!supportsResume(folder.cli)) return '';
  const ref = getSessionRef(folder);
  const info = ref
    ? `<span class="folder-session-id" title="${escapeHtml(ref.id)}">${escapeHtml(ref.id.slice(0, 8))} · ${formatShortDate(ref.updatedAt)}</span>
       <button class="btn-session-forget" data-action="forget-session" title="${t('forgetSessionTitle')}">${t('forgetSessionBtn')}</button>`
    : `<span class="folder-session-id sb-muted">${t('noSavedSession')}</span>`;
  return `
    <div class="folder-session-row" title="${t('resumeSessionTitle')}">
      ${checkbox('resumeSession', isResumeEnabled(folder), escapeHtml(t('resumeSessionLabel')))}
      ${info}
    </div>`;
};

// Pure: dialog HTML for a folder
const dialogHtml = (folder) => {
  const view = getViewMode(folder);
  return `
    <div class="fs-title">⚙ ${escapeHtml(t('folderSettingsTitle'))}</div>
    <div class="fs-field">
      <span class="fs-label">${escapeHtml(t('settingsPathLabel'))}</span>
      <div class="fs-path ${folder.missing ? 'missing' : ''}" title="${escapeHtml(folder.missing ? t('missingPathTitle') : folder.path)}">${folder.missing ? '⚠ ' : ''}${escapeHtml(folder.path)}</div>
    </div>
    <div class="fs-field fs-row">
      <label class="fs-col">
        <span class="fs-label">${escapeHtml(t('settingsAliasLabel'))}</span>
        <input type="text" class="folder-alias-input" data-field="alias" placeholder="${escapeHtml(t('aliasPlaceholder'))}"
               value="${escapeHtml(folder.alias || '')}" spellcheck="false" autocomplete="off" />
      </label>
      <label class="fs-col">
        <span class="fs-label">${escapeHtml(t('settingsGroupLabel'))}</span>
        <select class="cli-select-sm" data-field="groupId">
          ${option('', t('sectionUngrouped'), !folder.groupId)}
          ${getGroups().map((g) => option(g.id, g.name, folder.groupId === g.id)).join('')}
        </select>
      </label>
    </div>
    <div class="fs-field fs-row">
      <label class="fs-col">
        <span class="fs-label">${escapeHtml(t('settingsCliLabel'))}</span>
        <select class="cli-select-sm" data-field="cli" ${folder.isActive ? 'disabled' : ''} title="${escapeHtml(t('cliQuickTitle'))}">
          ${KNOWN_CLIS.map((c) => option(c, CLI_LABELS[c] || `Etc.. (${t('customInputLabel')})`, folder.cli === c)).join('')}
        </select>
      </label>
      <label class="fs-col">
        <span class="fs-label">${escapeHtml(t('settingsViewLabel'))}</span>
        <select class="cli-select-sm" data-field="viewMode" title="${escapeHtml(t('viewModeTitle'))}" ${supportsChat(folder.cli) ? '' : 'disabled'}>
          ${option('chat', t('viewModeChat'), view === 'chat')}
          ${option('terminal', t('viewModeTerminal'), view === 'terminal')}
        </select>
      </label>
    </div>
    ${folder.cli === 'etc' ? `
    <div class="fs-field">
      <input type="text" class="input-custom-sm" data-field="customCommand" placeholder="${escapeHtml(t('customCmdPlaceholder'))}"
             value="${escapeHtml(folder.customCommand || '')}" spellcheck="false" autocomplete="off" />
    </div>` : ''}
    ${sessionRowHtml(folder)}
    <div class="fs-field fs-row fs-org">
      ${checkbox('pinned', folder.pinned, `📌 ${escapeHtml(t('pinLabel'))}`)}
      ${folder.isActive ? '' : `<button class="btn-card-action" data-action="archive">${escapeHtml(t(folder.archived ? 'unarchiveBtn' : 'archiveBtn'))}</button>`}
    </div>
    <div class="fs-hint">${escapeHtml(t('archiveHint'))}</div>
    <div class="fs-global">
      <div class="fs-label">${escapeHtml(t('globalSettingsLabel'))}</div>
      ${checkbox('mergeSamePath', isMergeSamePath(), escapeHtml(t('mergeSamePathLabel')))}
      <div class="fs-hint">${escapeHtml(t('mergeSamePathHint'))}</div>
    </div>
    <div class="fs-actions">
      <button class="btn-card-delete-full" data-action="delete" title="${escapeHtml(t('deleteFolderTitle'))}">${escapeHtml(t('deleteFolderBtn'))}</button>
      <button class="btn-modal-no" data-action="close">${escapeHtml(t('closeBtn'))}</button>
    </div>`;
};

function render() {
  const folder = getFolder(currentId);
  if (!folder) {
    closeFolderSettings();
    return;
  }
  dialog.card.innerHTML = dialogHtml(folder);
}

// data-field -> how a change is applied (text fields on 'input', the rest on 'change')
const FIELD_HANDLERS = {
  alias: { on: 'input', apply: (id, el) => { patchFolder(id, { alias: el.value }); renderSessionIndicators(); } },
  customCommand: { on: 'input', apply: (id, el) => patchFolder(id, { customCommand: el.value }) },
  groupId: { on: 'change', apply: (id, el) => setFolderGroup(id, el.value || null) },
  // view mode / custom command / saved conversation depend on the CLI
  cli: { on: 'change', apply: (id, el) => { patchFolder(id, { cli: el.value }); render(); } },
  viewMode: { on: 'change', apply: (id, el) => patchFolder(id, { viewMode: el.value }) },
  resumeSession: { on: 'change', apply: (id, el) => patchFolder(id, { resumeSession: el.checked }) },
  pinned: { on: 'change', apply: (id, el) => { if (el.checked !== !!getFolder(id).pinned) patchFolder(id, pinToggled(getFolder(id))); } },
  mergeSamePath: { on: 'change', apply: (id, el) => setMergeSamePath(el.checked) },
};

function onField(e) {
  const handler = FIELD_HANDLERS[e.target.getAttribute('data-field')];
  if (handler && handler.on === e.type && getFolder(currentId)) handler.apply(currentId, e.target);
}

function ensureDialog() {
  if (dialog) return;
  dialog = createOverlay({
    overlayClass: 'modal-overlay folder-settings-overlay',
    cardClass: 'modal-card folder-settings-card',
    onClose: () => {
      currentId = null;
      renderFolderCards();
      renderSessionIndicators();
    },
  });
  dialog.card.addEventListener('input', onField);
  dialog.card.addEventListener('change', onField);
  onActions(dialog.card, {
    close: () => dialog.close(),
    'forget-session': () => {
      clearSessionRef(currentId);
      render();
    },
    archive: () => {
      toggleArchived(currentId);
      render();
    },
    delete: () => {
      if (!window.confirm(t('deleteConfirm'))) return;
      const id = currentId;
      dialog.close();
      removeFolderCard(id);
    },
  });
}

export function openFolderSettings(folderId) {
  ensureDialog();
  currentId = folderId;
  render();
  dialog.open();
  const alias = dialog.card.querySelector('[data-field="alias"]');
  if (alias) alias.focus();
}

export function closeFolderSettings() {
  if (dialog) dialog.close();
}
