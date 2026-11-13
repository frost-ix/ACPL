// Chat Image Attachments
//
// Images reach the AI as files: pasted (Ctrl+V), picked (📎) or dropped images are copied into
// the app's attachments folder (lib.rs save_attachment / import_attachment). On send, claude is
// told the paths and reads them (it gets read access to that folder), codex gets `-i <file>`.

import { t } from './i18n.js';
import { escapeHtml, basename } from './util.js';

export const MAX_IMAGES = 10;
export const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

// Pure: the prompt sent to the CLI for a message with images
export function promptWithImages(cli, text, images) {
  const body = text.trim() || (images.length ? t('attachDefaultPrompt') : '');
  if (!images.length || cli !== 'claude') return body;
  return `${body}\n\n[Attached image files — open each with the Read tool]\n${images.map((i) => `- ${i.path}`).join('\n')}`;
}

// Pure: thumbnails of a sent message (user bubble)
export const imagesHtml = (images) => (images && images.length
  ? `<div class="chat-msg-images">${images.map((i) => `<img src="${escapeHtml(i.preview || '')}" title="${escapeHtml(i.name)}" alt="">`).join('')}</div>`
  : '');

const readAsDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

// Thumbnails live in memory and in the chat history, so they are scaled down (the AI gets the
// full file). Small images and undecodable ones are kept as they are.
const THUMB_MAX_PX = 320;
const thumbScale =(w, h, max = THUMB_MAX_PX) => Math.min(1, max / Math.max(w, h, 1));

const thumbnailOf = (dataUrl) => new Promise((resolve) => {
  if (!dataUrl) return resolve('');
  const img = new Image();
  img.onload = () => {
    const scale = thumbScale(img.naturalWidth, img.naturalHeight);
    if (scale === 1) return resolve(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    resolve(canvas.toDataURL('image/webp', 0.85));
  };
  img.onerror = () => resolve(dataUrl);
  img.src = dataUrl;
});

/**
 * Image tray of one chat composer. inst.attachments is an immutable list of
 * { path, name, preview }. Returns { addFiles(paths), take() }.
 */
export function attachImageTray(inst) {
  const tray = inst.container.querySelector('.chat-attachments');
  inst.attachments = Object.freeze([]);

  const render = () => {
    tray.innerHTML = inst.attachments.map((a, i) => `
      <div class="chat-att" title="${escapeHtml(a.name)}">
        <img src="${escapeHtml(a.preview)}" alt="">
        <button class="chat-att-remove" data-index="${i}" title="${escapeHtml(t('attachRemove'))}">×</button>
      </div>`).join('');
    tray.classList.toggle('hidden', inst.attachments.length === 0);
  };

  const add = (item) => {
    if (inst.attachments.length >= MAX_IMAGES) {
      window.alert(t('attachLimit').replace('{n}', MAX_IMAGES));
      return;
    }
    inst.attachments = Object.freeze([...inst.attachments, Object.freeze(item)]);
    render();
  };

  const addBlob = async (blob, name) => {
    const data = await readAsDataUrl(blob);
    const path = await window.api.saveAttachment(name, data);
    if (path) add({ path, name, preview: await thumbnailOf(data) });
    else window.alert(t('attachFailed'));
  };

  const addFile = async (source) => {
    const path = await window.api.importAttachment(source);
    if (!path) {
      window.alert(`${t('attachFailed')}\n${source}`);
      return;
    }
    add({ path, name: basename(source), preview: await thumbnailOf(await window.api.attachmentPreview(path)) });
  };

  tray.addEventListener('click', (e) => {
    const btn = e.target.closest('.chat-att-remove');
    if (!btn) return;
    const index = Number(btn.getAttribute('data-index'));
    inst.attachments = Object.freeze(inst.attachments.filter((_, i) => i !== index));
    render();
  });

  // Ctrl+V of a screenshot / copied image; plain text paste is left alone
  inst.inputEl.addEventListener('paste', (e) => {
    const files = [...((e.clipboardData && e.clipboardData.items) || [])]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    e.preventDefault();
    files.forEach((file) => addBlob(file, file.name && file.name !== 'image.png'
      ? file.name
      : `pasted.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`));
  });

  inst.attachBtn.addEventListener('click', async () => {
    for (const path of await window.api.openImages()) await addFile(path);
    inst.inputEl.focus();
  });

  return {
    addFiles: async (paths) => {
      for (const path of paths.filter((p) => IMAGE_FILE_RE.test(p))) await addFile(path);
    },
    // The images of the message being sent; the tray empties
    take: () => {
      const images = inst.attachments;
      inst.attachments = Object.freeze([]);
      render();
      return images;
    },
    // Back into the tray (queued message cancelled); the files are still in the folder
    restore: (images) => {
      inst.attachments = Object.freeze([...inst.attachments, ...images].slice(0, MAX_IMAGES));
      render();
    },
  };
}
