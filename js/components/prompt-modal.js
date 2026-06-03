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
  submitPrompt,
} from '../utils/ai-models.js';
import {
  REASONING_LEVELS, getReasoningLevel, setReasoningLevel,
  getCustomInstructions, setCustomInstructions,
} from '../utils/settings.js';
import { assemblePrompt } from '../utils/prompt-assembly.js';
import { renderIcon } from '../utils/icons.js';
import { track } from '../utils/analytics.js';

const ANCHOR_SELECTOR = '.shortcuts-sidebar[data-multi]';
const MOBILE_BREAKPOINT = 640;
const PANEL_VIEWPORT_PAD = 12;
const PANEL_MIN_WIDTH = 540;
const PANEL_MAX_WIDTH = 780;

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
  panelEl.setAttribute('aria-label', 'Review and submit prompt');
  panelEl.style.display = 'none';
  document.body.appendChild(panelEl);

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
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') {
      // Esc dismisses an open Model-info popover first, then the modal.
      if (modalState && modalState.modelInfoOpen) { setModelInfoOpen(false); return; }
      closeModal();
    }
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
    perSubmission: { outputType: '', secondaryTopic: '' },
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
  document.removeEventListener('click', onDocClickForPopover);

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
  const reasoning = REASONING_LEVELS.find(l => l.id === getReasoningLevel());
  const ot = simpleOutputOptions().find(o => o.value === modalState.perSubmission.outputType);
  return {
    reasoningHint: reasoning && reasoning.hint ? reasoning.hint : '',
    outputClause: ot ? ot.clause : '',
    secondaryTopic: modalState.perSubmission.secondaryTopic.trim(),
    secondaryClauseTpl: secondaryClauseTpl(),
    customInstructions: getCustomInstructions(),
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

  const modelBtnsHTML = models.map(m => `
    <button class="pm-model" type="button" data-model-id="${m.id}" ${m.id === selectedModelId ? 'aria-pressed="true"' : 'aria-pressed="false"'}>
      <span class="pm-model-name">${escapeHTML(m.name)}</span>
    </button>
  `).join('');

  const otOptions = '<option value="">— None —</option>' + simpleOutputOptions().map(o =>
    `<option value="${escapeAttr(o.value)}"${o.value === perSubmission.outputType ? ' selected' : ''}>${escapeHTML(o.label)}</option>`).join('');
  const reasoningOptions = REASONING_LEVELS.map(l =>
    `<option value="${escapeAttr(l.id)}"${l.id === getReasoningLevel() ? ' selected' : ''}>${escapeHTML(l.name)}</option>`).join('');

  panelEl.innerHTML = `
    <div class="pm-header">
      <div class="pm-title">
        ${modalState.iconKey && count === 1 ? renderIcon(modalState.iconKey, 'pm-title-icon') : ''}
        <div class="pm-title-text">
          <span class="pm-title-eyebrow">${eyebrow}</span>
          <h3 class="pm-title-name">${escapeHTML(title)}</h3>
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
          <button type="button" class="pm-modelinfo-link" id="pm-modelinfo-link" aria-expanded="false">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5.4"/><path d="M7 6.2v3.4" stroke-linecap="round"/><circle cx="7" cy="4.4" r="0.55" fill="currentColor" stroke="none"/></svg>
            Model info
          </button>
          <div class="pm-modelinfo-pop" id="pm-modelinfo-pop" hidden role="dialog" aria-label="Model info"></div>
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
          <label class="pm-field"><span class="pm-flabel">Custom instructions</span>
            <textarea id="pm-custom" class="pm-input-control pm-adv-textarea" rows="3" placeholder="Applies to every submission this session">${escapeHTML(getCustomInstructions())}</textarea></label>
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

  // Model info popover
  panelEl.querySelector('#pm-modelinfo-link').addEventListener('click', (e) => {
    e.stopPropagation();
    setModelInfoOpen(!modalState.modelInfoOpen);
  });
  document.addEventListener('click', onDocClickForPopover);

  // Advanced settings
  panelEl.querySelector('#pm-adv-toggle').addEventListener('click', () => {
    modalState.advancedOpen = !modalState.advancedOpen;
    toggleDisclosure('#pm-adv-toggle', '#pm-adv-body', modalState.advancedOpen);
  });
  panelEl.querySelector('#pm-reasoning').addEventListener('change', (e) => {
    setReasoningLevel(e.target.value); regenPreview();
  });
  panelEl.querySelector('#pm-output').addEventListener('change', (e) => {
    modalState.perSubmission.outputType = e.target.value; regenPreview();
  });
  panelEl.querySelector('#pm-secondary').addEventListener('input', (e) => {
    modalState.perSubmission.secondaryTopic = e.target.value; regenPreview();
  });
  panelEl.querySelector('#pm-custom').addEventListener('input', (e) => {
    setCustomInstructions(e.target.value); regenPreview();
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
// (if open) the model-info popover — without a full re-render.
function syncModelUI() {
  const model = selectedModel();
  const current = panelEl.querySelector('#pm-model-current');
  if (current) current.textContent = model ? model.name : 'Choose a model';
  const submit = panelEl.querySelector('#pm-submit');
  if (submit) { submit.textContent = getSubmitLabel(model); submit.disabled = !model; }
  if (modalState.modelInfoOpen) populateModelInfo();
}

function populateModelInfo() {
  const pop = panelEl.querySelector('#pm-modelinfo-pop');
  if (!pop) return;
  const model = selectedModel();
  const helper = modelHelperText(model);
  const modelHomeUrl = model ? (model.chatUrl || (model.urlTemplate || '').replace('{prompt}', '')) : '';
  pop.innerHTML = model ? `
    <div class="pm-modelinfo-pop-head">
      <a href="${modelHomeUrl}" target="_blank" rel="noopener noreferrer" class="pm-meta-link">${escapeHTML(model.name)}</a>
    </div>
    ${helper ? `<p class="pm-modelinfo-pop-text">${escapeHTML(helper)}</p>` : ''}
  ` : '<p class="pm-modelinfo-pop-text">No model selected.</p>';
}

function setModelInfoOpen(open) {
  modalState.modelInfoOpen = open;
  const pop = panelEl.querySelector('#pm-modelinfo-pop');
  const link = panelEl.querySelector('#pm-modelinfo-link');
  if (link) link.setAttribute('aria-expanded', String(open));
  if (!pop) return;
  if (open) { populateModelInfo(); pop.hidden = false; }
  else pop.hidden = true;
}

function onDocClickForPopover(e) {
  if (!modalState || !modalState.modelInfoOpen) return;
  const wrap = panelEl.querySelector('.pm-modelinfo');
  if (wrap && !wrap.contains(e.target)) setModelInfoOpen(false);
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
  await submitPrompt(model, prompt);
  closeModal();
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
