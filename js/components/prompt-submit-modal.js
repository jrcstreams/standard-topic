// Centered "Prompt Submission" modal for AI shortcut selections. Opened via the
// `open-submit-modal` CustomEvent with a context object; app.js owns the selection
// state and passes callbacks. Mirrors the prompt-modal visual language.
import { getModels, getPromptGenData } from '../utils/data.js';
import {
  REASONING_LEVELS, getReasoningLevel, setReasoningLevel,
  getCustomInstructions, setCustomInstructions,
} from '../utils/settings.js';

let overlayEl = null;
let panelEl = null;
let ctx = null;            // { count, allSelected, topicName, selectedModelId, callbacks }
let advancedOpen = false;
let perSubmission = { outputType: '', secondaryTopic: '' };

function outputTypeField() {
  const pg = getPromptGenData() || {};
  const f = (pg.fields || []).find(x => x.key === 'outputType');
  return f || { options: [] };
}
function secondaryClauseTpl() {
  const pg = getPromptGenData() || {};
  return pg.secondaryTopicClause || '';
}

export function initPromptSubmitModal() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'psm-overlay';
  overlayEl.style.display = 'none';
  document.body.appendChild(overlayEl);

  panelEl = document.createElement('div');
  panelEl.className = 'psm-panel';
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-modal', 'true');
  panelEl.setAttribute('aria-label', 'Prompt Submission');
  panelEl.setAttribute('tabindex', '-1');
  panelEl.style.display = 'none';
  document.body.appendChild(panelEl);

  window.addEventListener('open-submit-modal', (e) => open(e.detail));
  overlayEl.addEventListener('click', () => close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') close();
  });
}

function open(detail) {
  ctx = detail || {};
  advancedOpen = false;
  perSubmission = { outputType: '', secondaryTopic: '' };
  overlayEl.style.display = '';
  panelEl.style.display = '';
  document.body.style.overflow = 'hidden';
  render();
  panelEl.focus();
}

function close() {
  overlayEl.style.display = 'none';
  panelEl.style.display = 'none';
  document.body.style.overflow = '';
  ctx = null;
}

// Build the advanced-settings options object consumed by assemblePrompt (app.js).
function currentAdvancedOpts() {
  const reasoning = REASONING_LEVELS.find(l => l.id === getReasoningLevel());
  const ot = outputTypeField().options.find(o => o.value === perSubmission.outputType);
  return {
    reasoningHint: reasoning && reasoning.hint ? reasoning.hint : '',
    outputClause: ot ? ot.clause : '',
    secondaryTopic: perSubmission.secondaryTopic.trim(),
    secondaryClauseTpl: secondaryClauseTpl(),
    customInstructions: getCustomInstructions(),
    topicName: ctx.topicName || '',
  };
}

function render() {
  const count = ctx.count || 0;
  const models = getModels();
  const selId = ctx.selectedModelId;
  const allSelected = ctx.allSelected;

  const otField = outputTypeField();
  const otOptions = '<option value="">— None —</option>' + (otField.options || []).map(o =>
    `<option value="${escapeAttr(o.value)}"${o.value === perSubmission.outputType ? ' selected' : ''}>${escapeHTML(o.label)}</option>`).join('');
  const reasoningOptions = REASONING_LEVELS.map(l =>
    `<option value="${escapeAttr(l.id)}"${l.id === getReasoningLevel() ? ' selected' : ''}>${escapeHTML(l.name)}</option>`).join('');
  const modelOptions = models.map(m =>
    `<option value="${escapeAttr(m.id)}"${m.id === selId ? ' selected' : ''}>${escapeHTML(m.name)}</option>`).join('');

  panelEl.innerHTML = `
    <div class="psm-header">
      <div class="psm-title-text">
        <span class="psm-eyebrow">AI Shortcuts</span>
        <h3 class="psm-title">Prompt Submission</h3>
      </div>
      <button type="button" class="psm-close" id="psm-close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>
      </button>
    </div>
    <div class="psm-body">
      <div class="psm-selrow">
        <span class="psm-count"><strong>${count}</strong> shortcut${count === 1 ? '' : 's'} selected</span>
        <span class="psm-selutils">
          <button type="button" id="psm-selectall" class="psm-link"${allSelected ? ' disabled' : ''}>Select all</button>
          <span class="psm-dot">·</span>
          <button type="button" id="psm-clear" class="psm-link">Clear</button>
        </span>
      </div>

      <div class="psm-modelrow">
        <span class="psm-label">Send to</span>
        <select id="psm-model" class="psm-select">${modelOptions}</select>
      </div>

      <button type="button" class="psm-adv-toggle" id="psm-adv-toggle" aria-expanded="${advancedOpen}">
        <svg class="psm-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 4.5 6 8 9 4.5"/></svg>
        Advanced settings
      </button>
      <div class="psm-adv" ${advancedOpen ? '' : 'hidden'}>
        <label class="psm-field"><span class="psm-flabel">Reasoning level</span>
          <select id="psm-reasoning" class="psm-select">${reasoningOptions}</select></label>
        <label class="psm-field"><span class="psm-flabel">Output type</span>
          <select id="psm-output" class="psm-select">${otOptions}</select></label>
        <label class="psm-field"><span class="psm-flabel">Secondary topics</span>
          <input id="psm-secondary" class="psm-input" type="text" placeholder="e.g. trade policy" value="${escapeAttr(perSubmission.secondaryTopic)}"></label>
        <label class="psm-field"><span class="psm-flabel">Custom instructions</span>
          <textarea id="psm-custom" class="psm-textarea" rows="3" placeholder="Applies to every submission this session">${escapeHTML(getCustomInstructions())}</textarea></label>
      </div>

      <div class="psm-actions">
        <button type="button" class="psm-btn psm-btn-secondary" id="psm-preview">Preview</button>
        <button type="button" class="psm-btn psm-btn-primary" id="psm-submit">
          <span>Direct Submit</span>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="8" x2="12" y2="8"/><polyline points="8 4 12 8 8 12"/></svg>
        </button>
      </div>
    </div>`;

  wire();
}

function wire() {
  const $ = (id) => panelEl.querySelector('#' + id);
  $('psm-close').onclick = () => close();
  $('psm-adv-toggle').onclick = () => { advancedOpen = !advancedOpen; render(); };

  $('psm-selectall').onclick = () => { ctx.callbacks.onSelectAll(); refreshSelection(); };
  $('psm-clear').onclick = () => { ctx.callbacks.onClear(); refreshSelection(); };

  $('psm-model').onchange = (e) => { ctx.selectedModelId = e.target.value; ctx.callbacks.onSetModel(e.target.value); };

  $('psm-reasoning').onchange = (e) => setReasoningLevel(e.target.value);
  $('psm-output').onchange = (e) => { perSubmission.outputType = e.target.value; };
  $('psm-secondary').oninput = (e) => { perSubmission.secondaryTopic = e.target.value; };
  $('psm-custom').oninput = (e) => { setCustomInstructions(e.target.value); };

  $('psm-preview').onclick = () => {
    const base = ctx.callbacks.buildBase();
    if (!base) return;
    ctx.callbacks.onPreview(base, currentAdvancedOpts());
    close();
  };
  $('psm-submit').onclick = () => {
    const base = ctx.callbacks.buildBase();
    if (!base) return;
    ctx.callbacks.onDirectSubmit(base, currentAdvancedOpts());
    close();
  };
}

// After Select all / Clear, refresh the count (and close if nothing left).
function refreshSelection() {
  const next = ctx.callbacks.getSelectionInfo();
  ctx.count = next.count;
  ctx.allSelected = next.allSelected;
  if (next.count === 0) { close(); return; }
  render();
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
function escapeAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
