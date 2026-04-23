// Prompt preview + AI model selection modal.
// Opens when user clicks an AI Shortcut. Redesigned to match the
// prompt generator submission modal style with categorized models.

import { getModels, getDefaultModelId, getModelById, getSubmissionMethods } from '../utils/data.js';
import {
  getPreferredModelId,
  setPreferredModelId,
  submitPrompt,
  isUrlTooLong,
  shouldCopyOnOpen,
} from '../utils/ai-models.js';
import { renderIcon } from '../utils/icons.js';

let modalEl = null;

export function initPromptModal() {
  modalEl = document.createElement('div');
  modalEl.className = 'prompt-modal-overlay';
  modalEl.id = 'prompt-modal-overlay';
  modalEl.style.display = 'none';
  document.body.appendChild(modalEl);

  window.addEventListener('open-prompt-modal', (e) => {
    openModal(e.detail.prompt, e.detail.name, e.detail.iconKey);
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

function openModal(prompt, shortcutName, iconKey) {
  const models = getModels();
  const defaultId = getDefaultModelId();
  const preferredId = getPreferredModelId(defaultId);
  let selectedModelId = preferredId;

  renderModalContent(prompt, shortcutName, iconKey, models, selectedModelId);
  modalEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalEl.style.display = 'none';
  document.body.style.overflow = '';
}

function getSubmitLabel(model) {
  if (!model) return 'Submit Prompt';
  return shouldCopyOnOpen(model)
    ? `Copy prompt and open ${model.name}`
    : `Open ${model.name}`;
}

function renderModalContent(prompt, shortcutName, iconKey, models, selectedModelId) {
  const selectedModel = getModelById(selectedModelId) || models[0];
  const tooLong = isUrlTooLong(selectedModel, prompt);
  const methods = getSubmissionMethods();
  const methodOrder = ['direct', 'populates', 'paste'];

  // Group models by submission method
  const grouped = {};
  methodOrder.forEach(m => { grouped[m] = []; });
  models.forEach(m => {
    const method = m.submissionMethod || 'direct';
    if (!grouped[method]) grouped[method] = [];
    grouped[method].push(m);
  });

  // Build model sections HTML
  let modelSectionsHTML = '';
  methodOrder.forEach(method => {
    const group = grouped[method];
    if (!group || group.length === 0) return;
    const meta = methods[method] || {};
    modelSectionsHTML += `
      <div class="prompt-modal-method-section">
        <div class="prompt-modal-method-label">${escapeHTML(meta.label || method)}</div>
        <div class="prompt-modal-method-desc">${escapeHTML(meta.description || '')}</div>
        <div class="prompt-modal-method-models">
          ${group.map(m => `
            <button class="prompt-modal-model-btn ${m.id === selectedModelId ? 'selected' : ''}" type="button" data-model-id="${m.id}">
              ${escapeHTML(m.name)}
            </button>
          `).join('')}
        </div>
      </div>
    `;
  });

  modalEl.innerHTML = `
    <div class="prompt-modal">
      <div class="prompt-modal-header">
        <div class="prompt-modal-shortcut">
          ${iconKey ? renderIcon(iconKey, 'prompt-modal-shortcut-icon') : ''}
          <div class="prompt-modal-shortcut-name">${escapeHTML(shortcutName || 'Submit Prompt')}</div>
        </div>
        <div class="prompt-modal-header-actions">
          <button class="prompt-modal-action-btn" id="prompt-modal-copy" type="button">Copy</button>
          <button class="prompt-modal-action-btn prompt-modal-close-btn" id="prompt-modal-close" type="button" aria-label="Close">✕</button>
        </div>
      </div>

      <div class="prompt-modal-preview">${escapeHTML(prompt)}</div>

      <div class="prompt-modal-models-section">
        <span class="prompt-modal-label">Choose AI Model</span>
        ${modelSectionsHTML}
      </div>

      ${tooLong ? `
        <div class="prompt-modal-warning">
          This prompt may be too long to submit via URL. Use "Copy" then paste manually after the page opens.
        </div>` : ''}

      <div class="prompt-modal-buttons">
        <button class="prompt-modal-submit" id="prompt-modal-submit" type="button">
          ${escapeHTML(getSubmitLabel(selectedModel))}
        </button>
        <button class="prompt-modal-open-only" id="prompt-modal-open-only" type="button">
          Open ${escapeHTML(selectedModel.name)} only
        </button>
      </div>

      <p class="prompt-modal-clipboard-hint">If prompt doesn't load directly into model, paste text from clipboard.</p>
      <p class="prompt-modal-disclaimer">
        Standard Topic is not responsible for actions taken once you leave this site.
      </p>
    </div>
  `;

  document.getElementById('prompt-modal-close').addEventListener('click', closeModal);

  document.getElementById('prompt-modal-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(prompt); } catch (_) {}
    const btn = document.getElementById('prompt-modal-copy');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.textContent = orig; }, 1800);
  });

  modalEl.querySelectorAll('.prompt-modal-method-models').forEach(section => {
    section.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-model-id]');
      if (!btn) return;
      selectedModelId = btn.dataset.modelId;
      setPreferredModelId(selectedModelId);

      modalEl.querySelectorAll('.prompt-modal-model-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.modelId === selectedModelId);
      });
      const newModel = getModelById(selectedModelId);
      const submitBtn = document.getElementById('prompt-modal-submit');
      if (submitBtn && newModel) {
        submitBtn.textContent = getSubmitLabel(newModel);
      }
      const openBtn = document.getElementById('prompt-modal-open-only');
      if (openBtn && newModel) {
        openBtn.textContent = `Open ${newModel.name} only`;
      }
    });
  });

  document.getElementById('prompt-modal-submit').addEventListener('click', async () => {
    const model = getModelById(selectedModelId);
    if (!model) return;
    await submitPrompt(model, prompt);
    closeModal();
  });

  document.getElementById('prompt-modal-open-only').addEventListener('click', () => {
    const model = getModelById(selectedModelId);
    if (!model) return;
    const url = model.urlTemplate.replace('{prompt}', '');
    window.open(url, '_blank');
    closeModal();
  });
}

function escapeHTML(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
