// Prompt preview + AI model selection modal.
//
// Anchored panel that opens over the AI Shortcuts card. Width snaps to
// the card but enforces a usable minimum and shifts horizontally to
// stay on-screen.

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
const PANEL_VIEWPORT_PAD = 12;
const PANEL_MIN_WIDTH = 480;
const PANEL_MAX_WIDTH = 720;

let overlayEl = null;
let panelEl = null;
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

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') closeModal();
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
  panelEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  positionPanel();
  // eslint-disable-next-line no-unused-expressions
  panelEl.offsetWidth; // commit initial transform before adding .is-open
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
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isMobile = vw <= MOBILE_BREAKPOINT;
  const anchor = document.querySelector(ANCHOR_SELECTOR);

  if (isMobile || !anchor) {
    const w = Math.min(vw - PANEL_VIEWPORT_PAD * 2, PANEL_MAX_WIDTH);
    const left = Math.round((vw - w) / 2);
    const top = Math.max(PANEL_VIEWPORT_PAD, Math.round(vh * 0.06));
    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;
    panelEl.style.width = `${w}px`;
    panelEl.style.maxHeight = `${vh - top - PANEL_VIEWPORT_PAD}px`;
    panelEl.dataset.anchored = 'mobile';
    return;
  }

  const rect = anchor.getBoundingClientRect();
  const maxAllowed = Math.min(PANEL_MAX_WIDTH, vw - PANEL_VIEWPORT_PAD * 2);
  const desired = Math.max(PANEL_MIN_WIDTH, rect.width);
  const width = Math.min(desired, maxAllowed);

  // Prefer aligning the panel's left edge to the card's left edge. If
  // the card is narrower than the panel, the panel extends rightward —
  // shift it left if that would clip the viewport edge.
  let left = rect.left;
  if (left + width > vw - PANEL_VIEWPORT_PAD) {
    left = Math.max(PANEL_VIEWPORT_PAD, vw - width - PANEL_VIEWPORT_PAD);
  }
  if (left < PANEL_VIEWPORT_PAD) left = PANEL_VIEWPORT_PAD;

  const top = Math.max(PANEL_VIEWPORT_PAD, Math.min(rect.top, vh - 240));
  const maxH = vh - top - PANEL_VIEWPORT_PAD;

  panelEl.style.left = `${left}px`;
  panelEl.style.top = `${top}px`;
  panelEl.style.width = `${width}px`;
  panelEl.style.maxHeight = `${maxH}px`;
  panelEl.dataset.anchored = 'desktop';
}

function getCurrentPrompt() {
  return modalState.editedPrompt ?? modalState.originalPrompt;
}

function getSubmitLabel(model) {
  if (!model) return 'Send Prompt';
  return `Send Prompt with ${model.name}`;
}

function renderPanelContent() {
  const { shortcutName, iconKey, models, selectedModelId, isEditing } = modalState;
  const prompt = getCurrentPrompt();
  const isEdited = modalState.editedPrompt != null && !isEditing;

  const modelBtnsHTML = models.map(m => `
    <button class="pm-model" type="button" data-model-id="${m.id}" ${m.id === selectedModelId ? 'aria-pressed="true"' : 'aria-pressed="false"'}>
      <span class="pm-model-name">${escapeHTML(m.name)}</span>
    </button>
  `).join('');

  panelEl.innerHTML = `
    <div class="pm-header">
      <div class="pm-title">
        ${iconKey ? renderIcon(iconKey, 'pm-title-icon') : ''}
        <h3 class="pm-title-name">${escapeHTML(shortcutName || 'Submit Prompt')}</h3>
        <span class="pm-title-tag">AI Shortcut</span>
      </div>
      <button type="button" class="pm-close" id="pm-close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>
      </button>
    </div>

    <div class="pm-body">
      <section class="pm-section">
        <div class="pm-section-head">
          <span class="pm-section-label">Prompt</span>
          ${isEdited ? '<button type="button" class="pm-reset" id="pm-reset">Reset to original</button>' : ''}
        </div>
        <div class="pm-preview-wrap ${isEditing ? 'is-editing' : ''}">
          ${isEditing
            ? `<textarea class="pm-textarea" id="pm-textarea">${escapeHTML(prompt)}</textarea>`
            : `<div class="pm-preview" id="pm-preview" tabindex="0" role="button" aria-label="Click to edit prompt">${escapeHTML(prompt)}</div>`
          }
          <div class="pm-preview-actions">
            <button type="button" class="pm-icon-btn" id="pm-copy" aria-label="Copy prompt" title="Copy">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="8" height="9" rx="1.2"/><path d="M9.5 3.5V2.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1"/></svg>
            </button>
            <button type="button" class="pm-icon-btn" id="pm-edit" aria-label="${isEditing ? 'Save prompt' : 'Edit prompt'}" title="${isEditing ? 'Save' : 'Edit'}">
              ${isEditing
                ? `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5,7.5 5.5,10.5 11.5,4"/></svg>`
                : `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.2l2.3 2.3-7 7H2.5v-2.3l7-7z"/></svg>`
              }
            </button>
          </div>
        </div>
      </section>

      <section class="pm-section">
        <div class="pm-section-label">AI Model</div>
        <div class="pm-models" id="pm-models">${modelBtnsHTML}</div>
      </section>

      <section class="pm-submit-area" id="pm-submit-area" hidden></section>
    </div>
  `;

  bindEvents();
  if (selectedModelId) updateSubmitArea();
}

function bindEvents() {
  panelEl.querySelector('#pm-close').addEventListener('click', closeModal);

  panelEl.querySelector('#pm-copy').addEventListener('click', async (e) => {
    e.stopPropagation();
    const text = modalState.isEditing
      ? panelEl.querySelector('#pm-textarea')?.value ?? ''
      : getCurrentPrompt();
    try { await navigator.clipboard.writeText(text); } catch (_) {}
    flashIconBtn(e.currentTarget, 'copied');
  });

  panelEl.querySelector('#pm-edit').addEventListener('click', (e) => {
    e.stopPropagation();
    enterEditOrSave();
  });

  const preview = panelEl.querySelector('#pm-preview');
  if (preview) {
    preview.addEventListener('click', enterEdit);
    preview.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enterEdit(); }
    });
  }

  panelEl.querySelector('#pm-reset')?.addEventListener('click', (e) => {
    e.stopPropagation();
    modalState.editedPrompt = null;
    renderPanelContent();
  });

  panelEl.querySelector('#pm-models').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-model-id]');
    if (!btn) return;
    modalState.selectedModelId = btn.dataset.modelId;
    setPreferredModelId(modalState.selectedModelId);
    panelEl.querySelectorAll('.pm-model').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.modelId === modalState.selectedModelId ? 'true' : 'false');
    });
    updateSubmitArea();
  });
}

function flashIconBtn(btn, state) {
  btn.classList.add(`is-${state}`);
  setTimeout(() => btn.classList.remove(`is-${state}`), 1200);
}

function enterEdit() {
  if (modalState.isEditing) return;
  modalState.isEditing = true;
  renderPanelContent();
}

function enterEditOrSave() {
  if (modalState.isEditing) {
    const ta = panelEl.querySelector('#pm-textarea');
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
  const area = panelEl.querySelector('#pm-submit-area');
  if (!area) return;
  if (!model) { area.hidden = true; return; }
  const methods = getSubmissionMethods();
  const method = model.submissionMethod || 'direct';
  const meta = methods[method] || {};
  area.hidden = false;
  const helper = meta.description ? meta.description.replace(/\{model\}/g, model.name) : '';
  const modelHomeUrl = model.urlTemplate.replace('{prompt}', '');
  area.innerHTML = `
    <div class="pm-section-label">Prompt Submission</div>
    <div class="pm-actions">
      <button class="pm-submit" id="pm-submit" type="button">${escapeHTML(getSubmitLabel(model))}</button>
    </div>
    <div class="pm-meta">
      ${helper ? `<div class="pm-meta-line">
        <span class="pm-meta-label">Model info:</span>
        <a href="${modelHomeUrl}" target="_blank" rel="noopener noreferrer" class="pm-meta-link">${escapeHTML(model.name)}</a>
        <span class="pm-meta-text">— ${escapeHTML(helper)}</span>
      </div>` : ''}
      <div class="pm-meta-line">
        <span class="pm-meta-label">Disclaimer:</span>
        <span class="pm-meta-text">Standard Topic isn't responsible for actions taken once you leave this site.</span>
      </div>
    </div>
  `;
  area.querySelector('#pm-submit').addEventListener('click', async () => {
    if (modalState.isEditing) {
      const ta = panelEl.querySelector('#pm-textarea');
      if (ta) modalState.editedPrompt = ta.value;
    }
    await submitPrompt(model, getCurrentPrompt());
    closeModal();
  });
}

function escapeHTML(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
