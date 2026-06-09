// Unified prompt review + submission modal.
//
// Opened from the AI Shortcuts selection bar ("Review & Submit") via the
// `open-prompt-modal` CustomEvent. Owns the whole submission flow on a
// single screen, top to bottom:
//   1. editable prompt preview (re-assembles live from advanced settings)
//   2. AI model picker (collapsible accordion) + discreet "Model info" popover
//   3. Advanced settings (collapsible)
//   4. Submit button
//   5. discreet disclaimer line
//
// Anchored panel that opens over the AI Shortcuts card. Width snaps to
// the card but enforces a usable minimum and shifts horizontally to
// stay on-screen.

import { getModels, getDefaultModelId, getModelById, getSubmissionMethods, getPromptGenData } from '../utils/data.js';
import {
  getPreferredModelId,
  setPreferredModelId,
  openModel,
  copyPrompt,
} from '../utils/ai-models.js?v=20260605-polish30';
import { REASONING_LEVELS } from '../utils/settings.js';
import { assemblePrompt } from '../utils/prompt-assembly.js';
import { renderIcon } from '../utils/icons.js';
import { track } from '../utils/analytics.js';

let overlayEl = null;
let panelEl = null;
let modalState = null;

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
  panelEl.setAttribute('aria-label', 'Review and submit prompt');
  panelEl.style.display = 'none';
  // Centered takeover: the panel lives inside the flex overlay so it stays
  // viewport-centered (no JS positioning / anchoring to the shortcuts card).
  overlayEl.appendChild(panelEl);

  window.addEventListener('open-prompt-modal', (e) => {
    const d = e.detail || {};
    openModal({
      basePrompt: d.basePrompt != null ? d.basePrompt : (d.prompt || ''),
      topicName: d.topicName || '',
      shortcutName: d.name,
      iconKey: d.iconKey,
      count: d.count,
    });
  });

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') closeModal();
  });
}

function openModal({ basePrompt, topicName, shortcutName, iconKey, count }) {
  const models = getModels();
  const defaultId = getDefaultModelId();
  const preferredId = getPreferredModelId(defaultId);
  modalState = {
    basePrompt,
    topicName: topicName || '',
    editedPrompt: null,
    shortcutName,
    iconKey,
    count: typeof count === 'number' ? count : 1,
    selectedModelId: preferredId,
    models,
    modelOpen: false,
    advancedOpen: false,
    modelInfoOpen: false,
    // Per-submission advanced settings. These are ONE-OFFS — they live only
    // in this modal instance, start neutral every time it opens, and are
    // never written to the persistent site settings (the Settings panel owns
    // those). So nothing here survives a refresh or carries to the next prompt.
    perSubmission: { reasoning: 'standard', outputType: '', secondaryTopic: '', customInstructions: '' },
    isClosing: false,
  };
  renderPanelContent();

  overlayEl.style.display = 'flex';
  panelEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // eslint-disable-next-line no-unused-expressions
  panelEl.offsetWidth; // commit initial transform before adding .is-open
  overlayEl.classList.add('is-open');
  panelEl.classList.add('is-open');
}

function closeModal() {
  if (!modalState || modalState.isClosing) return;
  modalState.isClosing = true;

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

/* ---- prompt assembly ---------------------------------------------- */

function outputTypeField() {
  const pg = getPromptGenData() || {};
  const f = (pg.fields || []).find(x => x.key === 'outputType');
  return f || { options: [] };
}
// Output-type options safe for one-tap shortcut submission: those that do
// NOT require an extra user input (Comparison's "compare to", Case Study's
// "specific case", etc. carry a `requiresInput` and are excluded — they
// belong in the full Prompt Builder, not a quick submit).
function simpleOutputOptions() {
  return (outputTypeField().options || []).filter(o => !o.requiresInput);
}
function secondaryClauseTpl() {
  const pg = getPromptGenData() || {};
  return pg.secondaryTopicClause || '';
}

function currentAdvancedOpts() {
  const ps = modalState.perSubmission;
  const reasoning = REASONING_LEVELS.find(l => l.id === ps.reasoning);
  const ot = simpleOutputOptions().find(o => o.value === ps.outputType);
  return {
    reasoningHint: reasoning && reasoning.hint ? reasoning.hint : '',
    outputClause: ot ? ot.clause : '',
    secondaryTopic: ps.secondaryTopic.trim(),
    secondaryClauseTpl: secondaryClauseTpl(),
    customInstructions: ps.customInstructions.trim(),
    topicName: modalState.topicName || '',
  };
}

function getAssembledPrompt() {
  return assemblePrompt(modalState.basePrompt, currentAdvancedOpts());
}
function getCurrentPrompt() {
  return modalState.editedPrompt ?? getAssembledPrompt();
}

function selectedModel() {
  return getModelById(modalState.selectedModelId) || modalState.models[0] || null;
}
function getSubmitLabel(model) {
  if (!model) return 'Send Prompt';
  return `Send Prompt with ${model.name}`;
}
function modelHelperText(model) {
  if (!model) return '';
  const methods = getSubmissionMethods();
  const method = model.submissionMethod || 'direct';
  const meta = methods[method] || {};
  return meta.description ? meta.description.replace(/\{model\}/g, model.name) : '';
}

/* ---- render -------------------------------------------------------- */

function renderPanelContent() {
  const { count, models, selectedModelId, advancedOpen, modelOpen, perSubmission } = modalState;
  const prompt = getCurrentPrompt();
  const model = selectedModel();

  const eyebrow = 'Review &amp; Submit';
  const title = (count > 1)
    ? `${count} shortcuts selected`
    : (modalState.shortcutName || 'Selected shortcut');
  const topicChip = modalState.topicName
    ? `<span class="pm-topic-chip" title="${escapeAttr(modalState.topicName)}">${escapeHTML(modalState.topicName)}</span>`
    : '';

  const modelBtnsHTML = models.map(m => `
    <button class="pm-model" type="button" data-model-id="${m.id}" ${m.id === selectedModelId ? 'aria-pressed="true"' : 'aria-pressed="false"'}>
      <span class="pm-model-name">${escapeHTML(m.name)}</span>
    </button>
  `).join('');

  const otOptions = '<option value="">— None —</option>' + simpleOutputOptions().map(o =>
    `<option value="${escapeAttr(o.value)}"${o.value === perSubmission.outputType ? ' selected' : ''}>${escapeHTML(o.label)}</option>`).join('');
  const reasoningOptions = REASONING_LEVELS.map(l =>
    `<option value="${escapeAttr(l.id)}"${l.id === perSubmission.reasoning ? ' selected' : ''}>${escapeHTML(l.name)}</option>`).join('');

  panelEl.innerHTML = `
    <div class="pm-header">
      <div class="pm-title">
        ${modalState.iconKey && count === 1 ? renderIcon(modalState.iconKey, 'pm-title-icon') : ''}
        <div class="pm-title-text">
          <span class="pm-title-eyebrow">${eyebrow}</span>
          <h3 class="pm-title-name">${escapeHTML(title)}</h3>
          ${topicChip ? `<div class="pm-title-meta">${topicChip}</div>` : ''}
        </div>
      </div>
      <button type="button" class="pm-close" id="pm-close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>
      </button>
    </div>

    <div class="pm-body">
      <section class="pm-section">
        <div class="pm-section-head">
          <span class="pm-section-label">Prompt Preview</span>
          <button type="button" class="pm-reset" id="pm-reset" ${modalState.editedPrompt == null ? 'hidden' : ''}>Reset to generated</button>
        </div>
        <div class="pm-preview-wrap">
          <textarea class="pm-preview-input" id="pm-preview" aria-label="Prompt text — editable">${escapeHTML(prompt)}</textarea>
          <div class="pm-preview-actions">
            <button type="button" class="pm-icon-btn" id="pm-copy" aria-label="Copy prompt" title="Copy">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="8" height="9" rx="1.2"/><path d="M9.5 3.5V2.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1"/></svg>
            </button>
          </div>
        </div>
      </section>

      <section class="pm-section">
        <div class="pm-section-label">AI Model</div>
        <div class="pm-model-acc">
          <button type="button" class="pm-model-acc-toggle" id="pm-model-toggle" aria-expanded="${modelOpen}" aria-controls="pm-model-body">
            <span class="pm-model-acc-lead">Send to</span>
            <span class="pm-model-acc-current" id="pm-model-current">${escapeHTML(model ? model.name : 'Choose a model')}</span>
            <svg class="pm-disclosure-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 4.5 6 8 9 4.5"/></svg>
          </button>
          <div class="pm-model-acc-body" id="pm-model-body" ${modelOpen ? '' : 'hidden'}>
            <div class="pm-models" id="pm-models">${modelBtnsHTML}</div>
          </div>
        </div>
        <div class="pm-modelinfo">
          <button type="button" class="pm-modelinfo-toggle" id="pm-modelinfo-toggle" aria-expanded="false" aria-controls="pm-modelinfo-body">
            <svg class="pm-disclosure-chev pm-modelinfo-chev" width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 4.5 6 8 9 4.5"/></svg>
            Model info
          </button>
          <div class="pm-modelinfo-body" id="pm-modelinfo-body" hidden></div>
        </div>
      </section>

      <section class="pm-section pm-disclosure-section">
        <button type="button" class="pm-disclosure-toggle" id="pm-adv-toggle" aria-expanded="${advancedOpen}" aria-controls="pm-adv-body">
          <svg class="pm-disclosure-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 4.5 6 8 9 4.5"/></svg>
          <span class="pm-disclosure-title">Advanced settings</span>
          <span class="pm-disclosure-hint">Reasoning, format, custom instructions</span>
        </button>
        <div class="pm-disclosure-body" id="pm-adv-body" ${advancedOpen ? '' : 'hidden'}>
          <div class="pm-field-grid">
            <label class="pm-field"><span class="pm-flabel">Reasoning level</span>
              <select id="pm-reasoning" class="pm-input-control">${reasoningOptions}</select></label>
            <label class="pm-field"><span class="pm-flabel">Output type</span>
              <select id="pm-output" class="pm-input-control">${otOptions}</select></label>
          </div>
          <label class="pm-field"><span class="pm-flabel">Secondary topics</span>
            <input id="pm-secondary" class="pm-input-control" type="text" placeholder="e.g. trade policy" value="${escapeAttr(perSubmission.secondaryTopic)}"></label>
          <label class="pm-field"><span class="pm-flabel">Custom instructions <span class="pm-flabel-note">— this submission only</span></span>
            <textarea id="pm-custom" class="pm-input-control pm-adv-textarea" rows="3" placeholder="A one-off instruction for this prompt">${escapeHTML(perSubmission.customInstructions)}</textarea></label>
        </div>
      </section>

      <section class="pm-section pm-submit-area">
        <div class="pm-section-label">Prompt Submission</div>
        <div class="pm-actions">
          <button class="pm-submit" id="pm-submit" type="button"${model ? '' : ' disabled'}>${escapeHTML(getSubmitLabel(model))}</button>
        </div>
        <p class="pm-disclaimer">Standard Topic isn’t responsible for actions taken once you leave this site.</p>
      </section>
    </div>
  `;

  bindEvents();
}

function bindEvents() {
  panelEl.querySelector('#pm-close').addEventListener('click', closeModal);

  const ta = panelEl.querySelector('#pm-preview');
  ta.addEventListener('input', () => {
    modalState.editedPrompt = (ta.value === getAssembledPrompt()) ? null : ta.value;
    toggleReset();
  });

  panelEl.querySelector('#pm-copy').addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(ta.value); } catch (_) {}
    flashIconBtn(e.currentTarget, 'copied');
  });

  panelEl.querySelector('#pm-reset').addEventListener('click', () => {
    modalState.editedPrompt = null;
    ta.value = getAssembledPrompt();
    toggleReset();
  });

  // Model accordion
  panelEl.querySelector('#pm-model-toggle').addEventListener('click', () => {
    modalState.modelOpen = !modalState.modelOpen;
    toggleDisclosure('#pm-model-toggle', '#pm-model-body', modalState.modelOpen);
  });
  panelEl.querySelector('#pm-models').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-model-id]');
    if (!btn) return;
    modalState.selectedModelId = btn.dataset.modelId;
    setPreferredModelId(modalState.selectedModelId);
    panelEl.querySelectorAll('.pm-model').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.modelId === modalState.selectedModelId ? 'true' : 'false');
    });
    syncModelUI();
    // Collapse the accordion to confirm the choice.
    modalState.modelOpen = false;
    toggleDisclosure('#pm-model-toggle', '#pm-model-body', false);
  });

  // Model info — discreet inline accordion
  panelEl.querySelector('#pm-modelinfo-toggle').addEventListener('click', () => {
    modalState.modelInfoOpen = !modalState.modelInfoOpen;
    if (modalState.modelInfoOpen) buildModelInfoBody();
    toggleDisclosure('#pm-modelinfo-toggle', '#pm-modelinfo-body', modalState.modelInfoOpen);
  });

  // Advanced settings — all per-submission one-offs, kept in modalState only.
  panelEl.querySelector('#pm-adv-toggle').addEventListener('click', () => {
    modalState.advancedOpen = !modalState.advancedOpen;
    toggleDisclosure('#pm-adv-toggle', '#pm-adv-body', modalState.advancedOpen);
  });
  panelEl.querySelector('#pm-reasoning').addEventListener('change', (e) => {
    modalState.perSubmission.reasoning = e.target.value; regenPreview();
  });
  panelEl.querySelector('#pm-output').addEventListener('change', (e) => {
    modalState.perSubmission.outputType = e.target.value; regenPreview();
  });
  panelEl.querySelector('#pm-secondary').addEventListener('input', (e) => {
    modalState.perSubmission.secondaryTopic = e.target.value; regenPreview();
  });
  panelEl.querySelector('#pm-custom').addEventListener('input', (e) => {
    modalState.perSubmission.customInstructions = e.target.value; regenPreview();
  });

  panelEl.querySelector('#pm-submit').addEventListener('click', doSubmit);
}

// Advanced settings changed → discard manual edits and rewrite the preview
// from the freshly assembled prompt. Always reflects the change.
function regenPreview() {
  modalState.editedPrompt = null;
  const ta = panelEl.querySelector('#pm-preview');
  if (ta) ta.value = getAssembledPrompt();
  toggleReset();
}

function toggleReset() {
  const btn = panelEl.querySelector('#pm-reset');
  if (btn) btn.hidden = (modalState.editedPrompt == null);
}

function toggleDisclosure(toggleSel, bodySel, open) {
  const toggle = panelEl.querySelector(toggleSel);
  const body = panelEl.querySelector(bodySel);
  if (toggle) toggle.setAttribute('aria-expanded', String(open));
  if (body) body.hidden = !open;
}

// Reflect the current model in the accordion label, submit button, and
// (if open) the model-info accordion — without a full re-render.
function syncModelUI() {
  const model = selectedModel();
  const current = panelEl.querySelector('#pm-model-current');
  if (current) current.textContent = model ? model.name : 'Choose a model';
  const submit = panelEl.querySelector('#pm-submit');
  if (submit) { submit.textContent = getSubmitLabel(model); submit.disabled = !model; }
  if (modalState.modelInfoOpen) buildModelInfoBody();
}

// Fill the Model info accordion with the model's name, what it is, and how
// submission works — mirroring the detail shown when picking a default model
// in Settings.
function buildModelInfoBody() {
  const body = panelEl.querySelector('#pm-modelinfo-body');
  if (!body) return;
  const model = selectedModel();
  if (!model) { body.innerHTML = '<p class="pm-modelinfo-text">No model selected.</p>'; return; }
  const methods = getSubmissionMethods();
  const method = model.submissionMethod || 'direct';
  const methodMeta = methods[method] || {};
  const methodLabel = methodMeta.label || '';
  const helper = modelHelperText(model);
  const modelHomeUrl = model.chatUrl || (model.urlTemplate || '').replace('{prompt}', '');
  body.innerHTML = `
    <div class="pm-modelinfo-head">
      <a href="${modelHomeUrl}" target="_blank" rel="noopener noreferrer" class="pm-meta-link">${escapeHTML(model.name)}</a>
    </div>
    ${model.description ? `<p class="pm-modelinfo-text">${escapeHTML(model.description)}</p>` : ''}
    ${helper ? `<p class="pm-modelinfo-text pm-modelinfo-method">${methodLabel ? `<strong>${escapeHTML(methodLabel)}.</strong> ` : ''}${escapeHTML(helper)}</p>` : ''}
  `;
}

async function doSubmit() {
  const model = selectedModel();
  if (!model) return;
  const ta = panelEl.querySelector('#pm-preview');
  const prompt = ta ? ta.value : getCurrentPrompt();
  track('prompt_submit', {
    model: model.id,
    shortcut_name: modalState.shortcutName || '',
    count: modalState.count,
    edited: modalState.editedPrompt != null,
  });
  // Open synchronously (still inside the click gesture → no popup block),
  // copy the prompt, then swap the button for a discreet confirmation.
  openModel(model, prompt);
  copyPrompt(prompt);
  const actions = panelEl.querySelector('.pm-submit-area .pm-actions');
  if (actions) {
    actions.innerHTML = `<p class="ti-copied-note pm-copied-note">Prompt copied to clipboard. Paste in ${escapeHTML(model.name)} if not auto-submitted.</p>`;
  }
}

function flashIconBtn(btn, state) {
  btn.classList.add(`is-${state}`);
  setTimeout(() => btn.classList.remove(`is-${state}`), 1200);
}

function escapeHTML(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
function escapeAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
