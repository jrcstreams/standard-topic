// Prompt preview + AI model selection modal.
//
// The modal opens as an *anchored panel* over the AI Shortcuts card —
// it positions itself at the card's top-left, matches its width, and
// extends downward as needed. Falls back to centered if the anchor is
// missing (e.g. multi-submit dispatched from a context without a card).

import { getModels, getDefaultModelId, getModelById, getSubmissionMethods } from '../utils/data.js';
import {
  getPreferredModelId,
  setPreferredModelId,
  submitPrompt,
  shouldCopyOnOpen,
} from '../utils/ai-models.js';
import { renderIcon } from '../utils/icons.js';

const ANCHOR_SELECTOR = '.shortcuts-sidebar[data-multi]';
const MOBILE_BREAKPOINT = 640;
const PANEL_VIEWPORT_PAD = 12; // px breathing room from viewport edges

let overlayEl = null;   // backdrop (catches outside clicks, dims page)
let panelEl = null;     // the actual panel; positioned over the anchor
let modalState = null;
let positionRaf = null;
let positionListenersBound = false;

export function initPromptModal() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'prompt-modal-overlay';
  overlayEl.setAttribute('aria-hidden', 'true');
  overlayEl.style.display = 'none';
  document.body.appendChild(overlayEl);

  panelEl = document.createElement('div');
  panelEl.className = 'prompt-modal-panel';
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-modal', 'true');
  panelEl.style.display = 'none';
  document.body.appendChild(panelEl);

  window.addEventListener('open-prompt-modal', (e) => {
    openModal(e.detail.prompt, e.detail.name, e.detail.iconKey);
  });

  // Click on backdrop closes; clicks inside the panel don't bubble here.
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') {
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
    isClosing: false,
  };
  renderPanelContent();

  overlayEl.style.display = 'block';
  panelEl.style.display = 'block';
  document.body.style.overflow = 'hidden';

  // Initial position before paint, then animate in.
  positionPanel();
  // Force reflow so the initial scale state is committed before adding .is-open.
  // eslint-disable-next-line no-unused-expressions
  panelEl.offsetWidth;
  overlayEl.classList.add('is-open');
  panelEl.classList.add('is-open');

  bindPositionListeners();
}

function closeModal() {
  if (!modalState || modalState.isClosing) return;
  modalState.isClosing = true;

  unbindPositionListeners();

  overlayEl.classList.remove('is-open');
  panelEl.classList.remove('is-open');
  panelEl.classList.add('is-closing');

  const onEnd = () => {
    panelEl.removeEventListener('transitionend', onEnd);
    panelEl.style.display = 'none';
    overlayEl.style.display = 'none';
    panelEl.classList.remove('is-closing');
    panelEl.style.cssText = '';
    document.body.style.overflow = '';
    modalState = null;
  };
  // Fallback in case transitionend is missed.
  panelEl.addEventListener('transitionend', onEnd);
  setTimeout(() => { if (modalState && modalState.isClosing) onEnd(); }, 280);
}

function bindPositionListeners() {
  if (positionListenersBound) return;
  positionListenersBound = true;
  window.addEventListener('resize', schedulePosition, { passive: true });
  window.addEventListener('scroll', schedulePosition, { passive: true });
}
function unbindPositionListeners() {
  if (!positionListenersBound) return;
  positionListenersBound = false;
  window.removeEventListener('resize', schedulePosition);
  window.removeEventListener('scroll', schedulePosition);
  if (positionRaf) cancelAnimationFrame(positionRaf);
  positionRaf = null;
}
function schedulePosition() {
  if (positionRaf) return;
  positionRaf = requestAnimationFrame(() => {
    positionRaf = null;
    positionPanel();
  });
}

function positionPanel() {
  const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
  const anchor = document.querySelector(ANCHOR_SELECTOR);

  if (isMobile || !anchor) {
    // Mobile or missing anchor: centered, near-full-width sheet.
    const w = Math.min(window.innerWidth - PANEL_VIEWPORT_PAD * 2, 560);
    const left = Math.round((window.innerWidth - w) / 2);
    const top = Math.max(PANEL_VIEWPORT_PAD, Math.round(window.innerHeight * 0.06));
    const maxH = window.innerHeight - top - PANEL_VIEWPORT_PAD;
    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;
    panelEl.style.width = `${w}px`;
    panelEl.style.maxHeight = `${maxH}px`;
    panelEl.dataset.anchored = 'false';
    return;
  }

  const rect = anchor.getBoundingClientRect();
  // Clamp so the panel stays fully on-screen if user has scrolled the
  // shortcuts card partly out of view.
  const top = Math.max(PANEL_VIEWPORT_PAD, Math.min(rect.top, window.innerHeight - 200));
  const left = Math.max(PANEL_VIEWPORT_PAD, rect.left);
  const width = Math.min(rect.width, window.innerWidth - PANEL_VIEWPORT_PAD * 2);
  const maxH = window.innerHeight - top - PANEL_VIEWPORT_PAD;

  panelEl.style.left = `${left}px`;
  panelEl.style.top = `${top}px`;
  panelEl.style.width = `${width}px`;
  panelEl.style.maxHeight = `${maxH}px`;
  panelEl.dataset.anchored = 'true';
}

function getCurrentPrompt() {
  return modalState.editedPrompt ?? modalState.originalPrompt;
}

function getSubmitLabel(model) {
  if (!model) return 'Submit Prompt';
  return shouldCopyOnOpen(model)
    ? `Copy & Open ${model.name}`
    : `Open ${model.name}`;
}

function renderPanelContent() {
  const { shortcutName, iconKey, models, selectedModelId, isEditing } = modalState;
  const prompt = getCurrentPrompt();

  const modelBtnsHTML = models.map(m => `
    <button class="prompt-modal-model-btn ${m.id === selectedModelId ? 'selected' : ''}" type="button" data-model-id="${m.id}">
      ${escapeHTML(m.name)}
    </button>
  `).join('');

  panelEl.innerHTML = `
    <div class="prompt-modal-panel-inner">
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

      <div class="prompt-modal-body">
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
    renderPanelContent();
  });

  document.getElementById('prompt-modal-models').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-model-id]');
    if (!btn) return;
    modalState.selectedModelId = btn.dataset.modelId;
    setPreferredModelId(modalState.selectedModelId);
    panelEl.querySelectorAll('.prompt-modal-model-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.modelId === modalState.selectedModelId);
    });
    updateSubmitArea();
  });
}

function enterEdit() {
  if (modalState.isEditing) return;
  modalState.isEditing = true;
  renderPanelContent();
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
  renderPanelContent();
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
