// Prompt preview + AI model selection modal

import { getModels, getDefaultModelId, getModelById } from '../utils/data.js';
import { getPreferredModelId, setPreferredModelId, submitPrompt, isUrlTooLong, supportsUrlPrompt, shouldCopyOnOpen } from '../utils/ai-models.js';

let modalEl = null;

export function initPromptModal() {
  // Create modal container once
  modalEl = document.createElement('div');
  modalEl.className = 'prompt-modal-overlay';
  modalEl.id = 'prompt-modal-overlay';
  modalEl.style.display = 'none';
  document.body.appendChild(modalEl);

  // Listen for open events
  window.addEventListener('open-prompt-modal', (e) => {
    openModal(e.detail.prompt, e.detail.name);
  });

  // Close on overlay click
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalEl.style.display !== 'none') {
      closeModal();
    }
  });
}

function openModal(prompt, shortcutName) {
  const models = getModels();
  const defaultId = getDefaultModelId();
  const preferredId = getPreferredModelId(defaultId);
  let selectedModelId = preferredId;

  renderModalContent(prompt, shortcutName, models, selectedModelId);
  modalEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalEl.style.display = 'none';
  document.body.style.overflow = '';
}

function renderModalContent(prompt, shortcutName, models, selectedModelId) {
  const selectedModel = getModelById(selectedModelId) || models[0];
  const tooLong = isUrlTooLong(selectedModel, prompt);

  const submitLabel = shouldCopyOnOpen(selectedModel)
    ? `Copy & Open ${selectedModel.name} →`
    : `Open ${selectedModel.name} →`;

  modalEl.innerHTML = `
    <div class="prompt-modal">
      <div class="prompt-modal-header">
        <h3>Submit Prompt</h3>
        <button class="prompt-modal-close" id="prompt-modal-close">✕</button>
      </div>

      <div class="prompt-modal-section">
        <label class="prompt-modal-label">Prompt Preview</label>
        <div class="prompt-modal-preview" id="prompt-modal-preview">${escapeHTML(prompt)}</div>
      </div>

      <div class="prompt-modal-copy-row">
        <button class="prompt-modal-copy-btn" id="prompt-modal-copy">📋 Copy Prompt Text</button>
      </div>

      <div class="prompt-modal-section">
        <label class="prompt-modal-label">Choose AI Model</label>
        <div class="prompt-modal-models" id="prompt-modal-models">
          ${models.map(m => `
            <button class="prompt-modal-model-btn ${m.id === selectedModelId ? 'selected' : ''}"
                    data-model-id="${m.id}">
              ${escapeHTML(m.name)}${!supportsUrlPrompt(m) ? ' <span class="model-copy-tag">paste</span>' : ''}
            </button>
          `).join('')}
        </div>
      </div>

      ${tooLong ? `
        <div class="prompt-modal-warning">
          This prompt may be too long to submit via URL. Use "Copy Prompt Text" and then "Open Model" to manually paste it.
        </div>
      ` : ''}

      <button class="prompt-modal-submit" id="prompt-modal-submit">
        ${submitLabel}
      </button>

      <p class="prompt-modal-disclaimer">
        Standard Topic is not responsible for actions taken once you leave this site. You will be redirected to a third-party AI platform.
      </p>
    </div>
  `;

  // Close button
  document.getElementById('prompt-modal-close').addEventListener('click', closeModal);

  // Copy button
  document.getElementById('prompt-modal-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(prompt);
    const btn = document.getElementById('prompt-modal-copy');
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy Prompt Text'; }, 2000);
  });

  // Model selection
  document.getElementById('prompt-modal-models').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-model-id]');
    if (!btn) return;
    selectedModelId = btn.dataset.modelId;
    setPreferredModelId(selectedModelId);
    renderModalContent(prompt, shortcutName, models, selectedModelId);
  });

  // Submit
  document.getElementById('prompt-modal-submit').addEventListener('click', async () => {
    const model = getModelById(selectedModelId);
    await submitPrompt(model, prompt);
    closeModal();
  });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
