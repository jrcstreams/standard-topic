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

// Shared glyphs — same language as the AI Insights modal (brand sparkle, chevron,
// paper-plane send). Keeps Review & Submit visually identical to the rest of the
// AI surfaces.
const LOGO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg>';
const CHEV = '<svg class="pm-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const ICON_SEND = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2.5L11 13"/><path d="M21.5 2.5L15 21l-4-8-8-4z"/></svg>';
const ICON_COPY = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="8" height="9" rx="1.2"/><path d="M9.5 3.5V2.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1"/></svg>';
const ICON_X = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>';

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
  if (!model) return 'Submit prompt';
  return `Submit to ${model.name}`;
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
  const { count, models, selectedModelId, advancedOpen, perSubmission } = modalState;
  const prompt = getCurrentPrompt();
  const model = selectedModel();

  const title = (count > 1)
    ? `${count} shortcuts selected`
    : (modalState.shortcutName || 'Selected shortcut');
  const topicChip = modalState.topicName
    ? `<span class="pm-topic-chip" title="${escapeAttr(modalState.topicName)}">${escapeHTML(modalState.topicName)}</span>`
    : '';

  const modelOptions = models.map(m =>
    `<option value="${escapeAttr(m.id)}"${m.id === selectedModelId ? ' selected' : ''}>${escapeHTML(m.name)}</option>`).join('');
  const otOptions = '<option value="">None</option>' + simpleOutputOptions().map(o =>
    `<option value="${escapeAttr(o.value)}"${o.value === perSubmission.outputType ? ' selected' : ''}>${escapeHTML(o.label)}</option>`).join('');
  const reasoningOptions = REASONING_LEVELS.map(l =>
    `<option value="${escapeAttr(l.id)}"${l.id === perSubmission.reasoning ? ' selected' : ''}>${escapeHTML(l.name)}</option>`).join('');

  panelEl.innerHTML = `
    <div class="pm-head">
      <span class="pm-brandlock"><span class="pm-logo">${LOGO}</span><span class="pm-eyebrow">Review &amp; Submit</span></span>
      <button type="button" class="pm-close" id="pm-close" aria-label="Close">${ICON_X}</button>
    </div>

    <div class="pm-body">
      <div class="pm-titlerow">
        <h3 class="pm-title-name">${escapeHTML(title)}</h3>
        ${topicChip}
      </div>

      <section class="pm-section">
        <div class="pm-section-head">
          <span class="pm-section-title">Prompt</span>
          <button type="button" class="pm-reset" id="pm-reset" ${modalState.editedPrompt == null ? 'hidden' : ''}>Reset</button>
        </div>
        <div class="pm-preview-wrap">
          <textarea class="pm-preview" id="pm-preview" aria-label="Prompt text — editable">${escapeHTML(prompt)}</textarea>
          <button type="button" class="pm-copy" id="pm-copy" aria-label="Copy prompt" title="Copy">${ICON_COPY}</button>
        </div>
      </section>

      <section class="pm-section">
        <label class="pm-sendto"><span class="pm-sendto-lead">Send to</span>
          <span class="pm-select-wrap"><select class="pm-select" id="pm-model-select" aria-label="Choose AI model">${modelOptions}</select>${CHEV}</span>
        </label>
        <details class="pm-acc" id="pm-modelinfo">
          <summary class="pm-acc-sum"><span>Model info</span>${CHEV}</summary>
          <div class="pm-acc-body" id="pm-modelinfo-body"></div>
        </details>
      </section>

      <details class="pm-acc pm-adv"${advancedOpen ? ' open' : ''}>
        <summary class="pm-acc-sum"><span class="pm-acc-title">Advanced settings</span><span class="pm-acc-hint">Reasoning, format, custom instructions</span>${CHEV}</summary>
        <div class="pm-acc-body">
          <div class="pm-field-grid">
            <label class="pm-field"><span class="pm-flabel">Reasoning level</span>
              <span class="pm-select-wrap"><select id="pm-reasoning" class="pm-input">${reasoningOptions}</select>${CHEV}</span></label>
            <label class="pm-field"><span class="pm-flabel">Output type</span>
              <span class="pm-select-wrap"><select id="pm-output" class="pm-input">${otOptions}</select>${CHEV}</span></label>
          </div>
          <label class="pm-field"><span class="pm-flabel">Secondary topics</span>
            <input id="pm-secondary" class="pm-input" type="text" placeholder="e.g. trade policy" value="${escapeAttr(perSubmission.secondaryTopic)}"></label>
          <label class="pm-field"><span class="pm-flabel">Custom instructions <span class="pm-flabel-note">— this submission only</span></span>
            <textarea id="pm-custom" class="pm-input pm-adv-textarea" rows="3" placeholder="A one-off instruction for this prompt">${escapeHTML(perSubmission.customInstructions)}</textarea></label>
        </div>
      </details>

      <button class="pm-submit" id="pm-submit" type="button"${model ? '' : ' disabled'}>${ICON_SEND}<span id="pm-submit-label">${escapeHTML(getSubmitLabel(model))}</span></button>
      <p class="pm-disclaimer">Opens ${escapeHTML(model ? model.name : 'the AI model')} in a new tab — the prompt auto-fills or is copied to your clipboard. Standard Topic isn’t responsible for actions taken once you leave the site.</p>
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

  // Model picker — a single "Send to" select (matches the AI Insights modal).
  panelEl.querySelector('#pm-model-select').addEventListener('change', (e) => {
    modalState.selectedModelId = e.target.value;
    setPreferredModelId(modalState.selectedModelId);
    syncModelUI();
  });

  // Model info — native <details>; fill on first open.
  panelEl.querySelector('#pm-modelinfo').addEventListener('toggle', (e) => {
    if (e.target.open) buildModelInfoBody();
  });

  // Advanced settings is a native <details>; track its open state so a re-render
  // (from an edit) keeps it open.
  panelEl.querySelector('.pm-adv').addEventListener('toggle', (e) => {
    modalState.advancedOpen = e.target.open;
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
  const label = panelEl.querySelector('#pm-submit-label');
  if (label) label.textContent = getSubmitLabel(model);
  const submit = panelEl.querySelector('#pm-submit');
  if (submit) submit.disabled = !model;
  const disc = panelEl.querySelector('.pm-disclaimer');
  if (disc) disc.textContent = `Opens ${model ? model.name : 'the AI model'} in a new tab — the prompt auto-fills or is copied to your clipboard. Standard Topic isn’t responsible for actions taken once you leave the site.`;
  const mi = panelEl.querySelector('#pm-modelinfo');
  if (mi && mi.open) buildModelInfoBody();
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
      <a href="${modelHomeUrl}" target="_blank" rel="noopener noreferrer" class="pm-meta-link">${escapeHTML(model.name)}<svg class="pm-meta-link-ic" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg></a>
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
  const submit = panelEl.querySelector('#pm-submit');
  if (submit) {
    const note = document.createElement('p');
    note.className = 'pm-copied-note';
    note.textContent = `Opened ${model.name} · prompt copied to your clipboard — paste it in if it didn’t auto-fill.`;
    submit.replaceWith(note);
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
