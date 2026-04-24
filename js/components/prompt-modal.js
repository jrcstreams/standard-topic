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
  const methods = getSubmissionMethods();

  // All model buttons (flat, no categories initially)
  const modelBtnsHTML = models.map(m => `
    <button class="prompt-modal-model-btn ${m.id === selectedModelId ? 'selected' : ''}" type="button" data-model-id="${m.id}">
      ${escapeHTML(m.name)}
    </button>
  `).join('');

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

      <div class="prompt-modal-section">
        <div class="prompt-modal-section-label">Prompt Preview</div>
        <div class="prompt-modal-preview">${escapeHTML(prompt)}</div>
      </div>

      <div class="prompt-modal-section">
        <div class="prompt-modal-label">Choose AI Model</div>
        <div class="prompt-modal-models" id="prompt-modal-models">
          ${modelBtnsHTML}
        </div>
      </div>

      <div class="prompt-modal-submit-area" id="prompt-modal-submit-area" style="display:none"></div>
    </div>
  `;

  function updateSubmitArea() {
    const model = getModelById(selectedModelId);
    if (!model) { document.getElementById('prompt-modal-submit-area').style.display = 'none'; return; }
    const method = model.submissionMethod || 'direct';
    const meta = methods[method] || {};
    const area = document.getElementById('prompt-modal-submit-area');
    area.style.display = '';
    area.innerHTML = `
      <button class="prompt-modal-submit" id="prompt-modal-submit" type="button">
        ${escapeHTML(getSubmitLabel(model))}
      </button>
      <div class="prompt-modal-method-title">${escapeHTML(meta.label || '')}</div>
      <div class="prompt-modal-method-info">${escapeHTML(meta.description || '')}</div>
      <ul class="prompt-modal-footer-list">
        <li><a href="#" class="prompt-modal-open-link" id="prompt-modal-open-only">Open ${escapeHTML(model.name)} only</a></li>
        <li>If prompt doesn't load directly into model, paste text from clipboard.</li>
        <li>Standard Topic is not responsible for actions taken once you leave this site.</li>
      </ul>
    `;
    area.querySelector('#prompt-modal-submit').addEventListener('click', async () => {
      await submitPrompt(model, prompt);
      closeModal();
    });
    area.querySelector('#prompt-modal-open-only').addEventListener('click', (e) => {
      e.preventDefault();
      const url = model.urlTemplate.replace('{prompt}', '');
      window.open(url, '_blank');
      closeModal();
    });
  }

  document.getElementById('prompt-modal-close').addEventListener('click', closeModal);

  document.getElementById('prompt-modal-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(prompt); } catch (_) {}
    const btn = document.getElementById('prompt-modal-copy');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.textContent = orig; }, 1800);
  });

  document.getElementById('prompt-modal-models').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-model-id]');
    if (!btn) return;
    selectedModelId = btn.dataset.modelId;
    setPreferredModelId(selectedModelId);
    modalEl.querySelectorAll('.prompt-modal-model-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.modelId === selectedModelId);
    });
    updateSubmitArea();
  });

  // Show submit area if a model is already selected
  if (selectedModelId) updateSubmitArea();
}

function escapeHTML(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
