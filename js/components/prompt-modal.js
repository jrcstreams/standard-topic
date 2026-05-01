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
let modalState = null;

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
  modalState = {
    originalPrompt: prompt,
    editedPrompt: null,
    isEditing: false,
    shortcutName,
    iconKey,
    selectedModelId: preferredId,
    models,
  };
  renderModalContent();
  modalEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalEl.style.display = 'none';
  document.body.style.overflow = '';
  modalState = null;
}

function getCurrentPrompt() {
  return modalState.editedPrompt ?? modalState.originalPrompt;
}

function getSubmitLabel(model) {
  if (!model) return 'Submit Prompt';
  return shouldCopyOnOpen(model)
    ? `Copy prompt and open ${model.name}`
    : `Open ${model.name}`;
}

function renderModalContent() {
  const { shortcutName, iconKey, models, selectedModelId, isEditing } = modalState;
  const prompt = getCurrentPrompt();
  const methods = getSubmissionMethods();

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
          <button class="prompt-modal-action-btn" id="prompt-modal-edit" type="button">
            ${isEditing ? 'Done' : 'Edit'}
          </button>
          <button class="prompt-modal-action-btn" id="prompt-modal-copy" type="button">Copy</button>
          <button class="prompt-modal-action-btn prompt-modal-close-btn" id="prompt-modal-close" type="button" aria-label="Close">✕</button>
        </div>
      </div>

      <div class="prompt-modal-section">
        <div class="prompt-modal-section-label">
          Prompt Preview
          ${!isEditing ? '<span class="prompt-modal-edit-hint">click to edit</span>' : ''}
          ${modalState.editedPrompt != null && !isEditing ? '<button type="button" class="prompt-modal-reset" id="prompt-modal-reset">Reset</button>' : ''}
        </div>
        ${isEditing
          ? `<textarea class="prompt-modal-preview-edit" id="prompt-modal-preview-edit" autofocus>${escapeHTML(prompt)}</textarea>`
          : `<div class="prompt-modal-preview" id="prompt-modal-preview" role="button" tabindex="0">${escapeHTML(prompt)}</div>`
        }
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

  bindEvents();
  if (selectedModelId) updateSubmitArea();
}

function bindEvents() {
  document.getElementById('prompt-modal-close').addEventListener('click', closeModal);

  document.getElementById('prompt-modal-copy').addEventListener('click', async () => {
    const text = modalState.isEditing
      ? document.getElementById('prompt-modal-preview-edit')?.value ?? ''
      : getCurrentPrompt();
    try { await navigator.clipboard.writeText(text); } catch (_) {}
    const btn = document.getElementById('prompt-modal-copy');
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });

  document.getElementById('prompt-modal-edit').addEventListener('click', enterEditOrSave);

  // Click-to-edit on the preview itself
  const preview = document.getElementById('prompt-modal-preview');
  if (preview) {
    preview.addEventListener('click', enterEdit);
    preview.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enterEdit(); }
    });
  }

  document.getElementById('prompt-modal-reset')?.addEventListener('click', (e) => {
    e.stopPropagation();
    modalState.editedPrompt = null;
    renderModalContent();
  });

  document.getElementById('prompt-modal-models').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-model-id]');
    if (!btn) return;
    modalState.selectedModelId = btn.dataset.modelId;
    setPreferredModelId(modalState.selectedModelId);
    modalEl.querySelectorAll('.prompt-modal-model-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.modelId === modalState.selectedModelId);
    });
    updateSubmitArea();
  });
}

function enterEdit() {
  if (modalState.isEditing) return;
  modalState.isEditing = true;
  renderModalContent();
}

function enterEditOrSave() {
  if (modalState.isEditing) {
    const ta = document.getElementById('prompt-modal-preview-edit');
    if (ta) {
      const newVal = ta.value;
      modalState.editedPrompt = (newVal === modalState.originalPrompt) ? null : newVal;
    }
    modalState.isEditing = false;
  } else {
    modalState.isEditing = true;
  }
  renderModalContent();
}

function updateSubmitArea() {
  const { selectedModelId } = modalState;
  const model = getModelById(selectedModelId);
  const area = document.getElementById('prompt-modal-submit-area');
  if (!area) return;
  if (!model) { area.style.display = 'none'; return; }
  const methods = getSubmissionMethods();
  const method = model.submissionMethod || 'direct';
  const meta = methods[method] || {};
  area.style.display = '';
  area.innerHTML = `
    <button class="prompt-modal-submit" id="prompt-modal-submit" type="button">
      ${escapeHTML(getSubmitLabel(model))}
    </button>
    <div class="prompt-modal-method-title">${escapeHTML(meta.label || '')}</div>
    <div class="prompt-modal-method-info">${escapeHTML(meta.description || '')}</div>
    <ul class="prompt-modal-footer-list">
      <li><a href="#" class="prompt-modal-open-link" id="prompt-modal-open-only">🔗 Open ${escapeHTML(model.name)} only</a></li>
      <li>If prompt doesn't load directly into model, paste text from clipboard.</li>
      <li>Standard Topic is not responsible for actions taken once you leave this site.</li>
    </ul>
  `;
  area.querySelector('#prompt-modal-submit').addEventListener('click', async () => {
    // If user is editing, capture the latest text first
    if (modalState.isEditing) {
      const ta = document.getElementById('prompt-modal-preview-edit');
      if (ta) modalState.editedPrompt = ta.value;
    }
    await submitPrompt(model, getCurrentPrompt());
    closeModal();
  });
  area.querySelector('#prompt-modal-open-only').addEventListener('click', (e) => {
    e.preventDefault();
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
