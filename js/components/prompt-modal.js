// Prompt preview + AI model selection modal (M2 compact card design).
// Opens when user clicks an AI Shortcut. Layout:
//   [✕ close]
//   [icon] Shortcut Name
//   [prompt preview]
//   AI Model              📋 Copy only
//   [model grid]
//   [Copy & Open ChatGPT →]
//   disclaimer

import { getModels, getDefaultModelId, getModelById } from '../utils/data.js';
import {
  getPreferredModelId,
  setPreferredModelId,
  submitPrompt,
  isUrlTooLong,
  supportsUrlPrompt,
  shouldCopyOnOpen,
} from '../utils/ai-models.js';

let modalEl = null;

export function initPromptModal() {
  modalEl = document.createElement('div');
  modalEl.className = 'prompt-modal-overlay';
  modalEl.id = 'prompt-modal-overlay';
  modalEl.style.display = 'none';
  document.body.appendChild(modalEl);

  window.addEventListener('open-prompt-modal', (e) => {
    openModal(e.detail.prompt, e.detail.name, e.detail.icon);
  });

  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalEl.style.display !== 'none') {
      closeModal();
    }
  });
}

function openModal(prompt, shortcutName, shortcutIcon) {
  const models = getModels();
  const defaultId = getDefaultModelId();
  const preferredId = getPreferredModelId(defaultId);
  let selectedModelId = preferredId;

  renderModalContent(prompt, shortcutName, shortcutIcon, models, selectedModelId);
  modalEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalEl.style.display = 'none';
  document.body.style.overflow = '';
}

function renderModalContent(prompt, shortcutName, shortcutIcon, models, selectedModelId) {
  const selectedModel = getModelById(selectedModelId) || models[0];
  const tooLong = isUrlTooLong(selectedModel, prompt);
  const submitLabel = shouldCopyOnOpen(selectedModel)
    ? `Copy & Open ${selectedModel.name} →`
    : `Open ${selectedModel.name} →`;

  modalEl.innerHTML = `
    <div class="prompt-modal">
      <button class="prompt-modal-close" id="prompt-modal-close" aria-label="Close">✕</button>

      <div class="prompt-modal-shortcut">
        ${shortcutIcon ? `<span class="prompt-modal-shortcut-icon" aria-hidden="true">${escapeHTML(shortcutIcon)}</span>` : ''}
        <div class="prompt-modal-shortcut-name">${escapeHTML(shortcutName || 'Submit Prompt')}</div>
      </div>

      <div class="prompt-modal-preview">${escapeHTML(prompt)}</div>

      <div class="prompt-modal-model-row">
        <span class="prompt-modal-label">AI Model</span>
        <button class="prompt-modal-copy-link" id="prompt-modal-copy" type="button">
          <svg class="prompt-modal-copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span class="prompt-modal-copy-text">Copy Prompt Text</span>
        </button>
      </div>
      <div class="prompt-modal-models" id="prompt-modal-models">
        ${models.map(m => `
          <button class="prompt-modal-model-btn ${m.id === selectedModelId ? 'selected' : ''}" type="button" data-model-id="${m.id}">
            ${escapeHTML(m.name)}
          </button>
        `).join('')}
      </div>

      ${tooLong ? `
        <div class="prompt-modal-warning">
          This prompt may be too long to submit via URL. Use "Copy only" then paste manually after the page opens.
        </div>` : ''}

      <button class="prompt-modal-submit" id="prompt-modal-submit" type="button">
        ${escapeHTML(submitLabel)}
      </button>

      <p class="prompt-modal-disclaimer">
        Standard Topic is not responsible for actions taken once you leave this site.
      </p>
    </div>
  `;

  document.getElementById('prompt-modal-close').addEventListener('click', closeModal);

  document.getElementById('prompt-modal-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(prompt); } catch (_) {}
    const textEl = document.querySelector('#prompt-modal-copy .prompt-modal-copy-text');
    if (!textEl) return;
    const orig = textEl.textContent;
    textEl.textContent = '✓ Copied!';
    setTimeout(() => { textEl.textContent = orig; }, 1800);
  });

  document.getElementById('prompt-modal-models').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-model-id]');
    if (!btn) return;
    selectedModelId = btn.dataset.modelId;
    setPreferredModelId(selectedModelId);

    // Surgical update — no full re-render, no flash of the modal
    document.querySelectorAll('.prompt-modal-model-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.modelId === selectedModelId);
    });
    const submitBtn = document.getElementById('prompt-modal-submit');
    const newModel = getModelById(selectedModelId);
    if (submitBtn && newModel) {
      submitBtn.textContent = shouldCopyOnOpen(newModel)
        ? `Copy & Open ${newModel.name} →`
        : `Open ${newModel.name} →`;
    }
  });

  document.getElementById('prompt-modal-submit').addEventListener('click', async () => {
    const model = getModelById(selectedModelId);
    if (!model) return;
    await submitPrompt(model, prompt);
    closeModal();
  });
}

function escapeHTML(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
