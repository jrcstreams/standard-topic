// Knowledge Prompt Generator — guided wizard mode.
// Multi-step flow with cards, chips, and a final review/submit screen.
// Mobile-first: cards stack, footer nav buttons stay sticky.

import { getPromptGenData, getModels, getDefaultModelId, getModelById, getParentTopics } from '../utils/data.js';
import { getPreferredModelId, setPreferredModelId, submitPrompt, isUrlTooLong } from '../utils/ai-models.js';

// Wizard state — reset on each render
const state = {
  step: 0,
  values: {},   // { primaryTopic, secondaryTopic, contentType, ... }
  modelId: null,
  customizations: '',
};

let pgData = null;
let modelsData = null;
let stepDefs = [];
let containerEl = null;

// ---------- Public entry point ----------

export function renderPromptGenerator(container) {
  pgData = getPromptGenData();
  modelsData = getModels();
  containerEl = container;

  // Reset state on each fresh render of the page
  state.step = 0;
  state.values = {};
  state.modelId = getPreferredModelId(getDefaultModelId());
  state.customizations = '';

  stepDefs = buildStepDefinitions();
  render();
}

// ---------- Step definitions ----------

function buildStepDefinitions() {
  return [
    {
      id: 'topic',
      label: 'Topic',
      title: 'What topic do you want to learn about?',
      description: 'Pick a popular topic or type your own. You can also add a secondary topic to combine ideas.',
      required: true,
      render: renderTopicStep,
      isComplete: () => !!state.values.primaryTopic?.trim(),
    },
    {
      id: 'contentType',
      label: 'Content Type',
      title: 'What kind of content do you want?',
      description: 'Pick the format of the answer the AI should produce.',
      render: renderContentTypeStep,
    },
    {
      id: 'contentGeneration',
      label: 'Approach',
      title: 'How should the AI approach this?',
      description: 'Optional. Choose how the AI should treat the information — analysis, summary, comparison, etc.',
      render: (host) => renderChipChoiceStep(host, 'contentGeneration'),
    },
    {
      id: 'sourcesAndTime',
      label: 'Sources & Time',
      title: 'Where should the information come from?',
      description: 'Choose source types, time period, and citation style.',
      render: renderSourcesAndTimeStep,
    },
    {
      id: 'formatAndLength',
      label: 'Format & Length',
      title: 'How should the answer be structured?',
      description: 'Pick a format and approximate length.',
      render: renderFormatAndLengthStep,
    },
    {
      id: 'audienceAndTone',
      label: 'Audience & Tone',
      title: 'Who is this for, and what voice?',
      description: 'Set the reading level and writing tone.',
      render: renderAudienceAndToneStep,
    },
    {
      id: 'geoAndCustom',
      label: 'Region & Custom',
      title: 'Anything else?',
      description: 'Optional regional focus and any custom instructions you want to add.',
      render: renderGeoAndCustomStep,
    },
    {
      id: 'review',
      label: 'Review & Submit',
      title: 'Review your prompt and choose a model',
      description: 'Edit the model and submit when ready.',
      isFinal: true,
      render: renderReviewStep,
    },
  ];
}

const cardIcons = {
  'overview': '📋',
  'research-summary': '📊',
  'explainer': '💡',
  'comparison': '🔍',
  'timeline': '📅',
  'case-study': '🔬',
};

// ---------- Top-level render ----------

function render() {
  const def = stepDefs[state.step];
  const totalSteps = stepDefs.length;
  const stepNumber = state.step + 1;
  const progress = ((state.step + 1) / totalSteps) * 100;

  containerEl.innerHTML = `
    <div class="wiz">
      <div class="wiz-head">
        <div class="wiz-head-row">
          <div class="wiz-head-icon" aria-hidden="true">⚙</div>
          <div class="wiz-head-text">
            <div class="wiz-head-title">Build a Knowledge Prompt</div>
            <div class="wiz-head-step">Step ${stepNumber} of ${totalSteps} · ${escapeHTML(def.label)}</div>
          </div>
        </div>
        <div class="wiz-progress" aria-hidden="true">
          <div class="wiz-progress-bar" style="width: ${progress}%"></div>
        </div>
      </div>

      <div class="wiz-body">
        <h2 class="wiz-step-title">${escapeHTML(def.title)}</h2>
        ${def.description ? `<p class="wiz-step-desc">${escapeHTML(def.description)}</p>` : ''}
        <div class="wiz-step-content" id="wiz-step-content"></div>
      </div>

      ${!def.isFinal ? `
      <details class="wiz-preview">
        <summary>
          <span class="wiz-preview-label">Live Prompt Preview</span>
          <span class="wiz-preview-toggle" aria-hidden="true">▾</span>
        </summary>
        <div class="wiz-preview-body" id="wiz-preview-body"></div>
      </details>` : ''}

      <div class="wiz-foot">
        <button class="wiz-btn-back" id="wiz-back" type="button" ${state.step === 0 ? 'disabled' : ''}>← Back</button>
        <div class="wiz-foot-right">
          ${!def.required && !def.isFinal ? `<button class="wiz-btn-skip" id="wiz-skip" type="button">Skip</button>` : ''}
          ${!def.isFinal ? `<button class="wiz-btn-next" id="wiz-next" type="button" ${def.required && !def.isComplete?.() ? 'disabled' : ''}>Next →</button>` : ''}
        </div>
      </div>
    </div>
  `;

  def.render(document.getElementById('wiz-step-content'));
  if (!def.isFinal) updatePreview();
  attachFooter(def);
}

function attachFooter(def) {
  document.getElementById('wiz-back')?.addEventListener('click', () => {
    if (state.step > 0) { state.step--; render(); window.scrollTo(0, 0); }
  });
  document.getElementById('wiz-skip')?.addEventListener('click', advance);
  document.getElementById('wiz-next')?.addEventListener('click', () => {
    if (def.required && !def.isComplete?.()) return;
    advance();
  });
}

function advance() {
  if (state.step < stepDefs.length - 1) {
    state.step++;
    render();
    window.scrollTo(0, 0);
  }
}

// ---------- Step renderers ----------

function renderTopicStep(host) {
  const popular = getParentTopics().slice(0, 6);
  host.innerHTML = `
    <label class="wiz-label">Primary Topic <span class="wiz-required">*</span></label>
    <input type="text" class="wiz-input" id="wiz-primary"
           placeholder="e.g. Climate change, Quantum computing"
           value="${escapeAttr(state.values.primaryTopic || '')}" autofocus>
    ${popular.length > 0 ? `
    <div class="wiz-popular-row">
      <span class="wiz-popular-label">Or pick one:</span>
      ${popular.map(t => `
        <button class="wiz-pop-chip" type="button" data-name="${escapeAttr(t.name)}">${escapeHTML(t.name)}</button>
      `).join('')}
    </div>` : ''}
    <label class="wiz-label" style="margin-top: 1.25rem;">Secondary Topic <span class="wiz-optional">(optional)</span></label>
    <input type="text" class="wiz-input" id="wiz-secondary"
           placeholder="Combine with another topic, e.g. Economics"
           value="${escapeAttr(state.values.secondaryTopic || '')}">
  `;

  const primary = host.querySelector('#wiz-primary');
  const secondary = host.querySelector('#wiz-secondary');

  primary.addEventListener('input', () => {
    state.values.primaryTopic = primary.value;
    updateNextEnabled();
    updatePreview();
  });
  primary.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && state.values.primaryTopic?.trim()) advance();
  });
  secondary.addEventListener('input', () => {
    state.values.secondaryTopic = secondary.value;
    updatePreview();
  });

  host.querySelectorAll('.wiz-pop-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const name = chip.dataset.name;
      primary.value = name;
      state.values.primaryTopic = name;
      updateNextEnabled();
      updatePreview();
    });
  });
}

function renderContentTypeStep(host) {
  const opts = getOptionsFor('contentType');
  const current = state.values.contentType || '';
  host.innerHTML = `
    <div class="wiz-cards">
      ${opts.map(opt => `
        <button class="wiz-card ${opt.value === current ? 'selected' : ''}" type="button" data-value="${escapeAttr(opt.value)}">
          <div class="wiz-card-icon">${cardIcons[opt.value] || '•'}</div>
          <div class="wiz-card-label">${escapeHTML(opt.label)}</div>
        </button>
      `).join('')}
    </div>
  `;
  host.querySelectorAll('.wiz-card').forEach(card => {
    card.addEventListener('click', () => {
      state.values.contentType = card.dataset.value;
      host.querySelectorAll('.wiz-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      updatePreview();
    });
  });
}

function renderChipChoiceStep(host, fieldKey) {
  populateChipGrid(host, fieldKey);
}

function renderSourcesAndTimeStep(host) {
  host.innerHTML = `
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Source Types</label>
      <div class="wiz-chip-grid" id="wiz-sources"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Time Period</label>
      <div class="wiz-chip-grid" id="wiz-recency"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Citations</label>
      <div class="wiz-chip-grid" id="wiz-citations"></div>
    </div>
  `;
  populateChipGrid(host.querySelector('#wiz-sources'), 'sources');
  populateChipGrid(host.querySelector('#wiz-recency'), 'recency');
  populateChipGrid(host.querySelector('#wiz-citations'), 'citations');
}

function renderFormatAndLengthStep(host) {
  host.innerHTML = `
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Output Format</label>
      <div class="wiz-chip-grid" id="wiz-format"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Length</label>
      <div class="wiz-chip-grid" id="wiz-length"></div>
    </div>
  `;
  populateChipGrid(host.querySelector('#wiz-format'), 'format');
  populateChipGrid(host.querySelector('#wiz-length'), 'length');
}

function renderAudienceAndToneStep(host) {
  host.innerHTML = `
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Reading Level</label>
      <div class="wiz-chip-grid" id="wiz-audience"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Writing Tone</label>
      <div class="wiz-chip-grid" id="wiz-tone"></div>
    </div>
  `;
  populateChipGrid(host.querySelector('#wiz-audience'), 'audience');
  populateChipGrid(host.querySelector('#wiz-tone'), 'tone');
}

function renderGeoAndCustomStep(host) {
  host.innerHTML = `
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Geographic Focus</label>
      <div class="wiz-chip-grid" id="wiz-geo"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Custom Instructions <span class="wiz-optional">(optional)</span></label>
      <textarea class="wiz-textarea" id="wiz-custom"
                placeholder="Add any extra instructions, e.g. 'Include code examples' or 'Avoid jargon'">${escapeHTML(state.customizations || '')}</textarea>
    </div>
  `;
  populateChipGrid(host.querySelector('#wiz-geo'), 'geographic');
  const ta = host.querySelector('#wiz-custom');
  ta.addEventListener('input', () => {
    state.customizations = ta.value;
    updatePreview();
  });
}

function renderReviewStep(host) {
  const prompt = assemblePrompt();
  const tooLong = isUrlTooLong(getModelById(state.modelId) || modelsData[0], prompt);
  host.innerHTML = `
    <div class="wiz-review">
      <div class="wiz-review-section">
        <label class="wiz-sub-label">Your Prompt</label>
        <div class="wiz-prompt-box">${escapeHTML(prompt)}</div>
        <button class="wiz-btn-secondary" id="wiz-copy-btn" type="button">📋 Copy Prompt</button>
      </div>
      <div class="wiz-review-section">
        <label class="wiz-sub-label">Choose AI Model</label>
        <div class="wiz-model-grid" id="wiz-model-grid">
          ${modelsData.map(m => `
            <button class="wiz-model-btn ${m.id === state.modelId ? 'selected' : ''}" type="button" data-model-id="${m.id}">
              ${escapeHTML(m.name)}${m.method === 'clipboard' ? ' <span class="wiz-model-tag">(copy)</span>' : ''}
            </button>
          `).join('')}
        </div>
      </div>
      ${tooLong ? `<div class="wiz-warning">Prompt may be too long for direct URL submission. Use Copy + Open Model instead.</div>` : ''}
      <button class="wiz-btn-submit" id="wiz-submit" type="button">${escapeHTML(getSubmitLabel())}</button>
      <button class="wiz-btn-restart" id="wiz-restart" type="button">Start Over</button>
      <p class="wiz-disclaimer">Standard Topic is not responsible for actions taken once you leave this site. You will be redirected to a third-party AI platform.</p>
    </div>
  `;

  host.querySelector('#wiz-copy-btn').addEventListener('click', async () => {
    await navigator.clipboard.writeText(prompt);
    const btn = host.querySelector('#wiz-copy-btn');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });

  host.querySelector('#wiz-model-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-model-id]');
    if (!btn) return;
    state.modelId = btn.dataset.modelId;
    setPreferredModelId(state.modelId);
    render();
  });

  host.querySelector('#wiz-submit').addEventListener('click', async () => {
    const model = getModelById(state.modelId);
    if (!model) return;
    await submitPrompt(model, prompt);
  });

  host.querySelector('#wiz-restart').addEventListener('click', () => {
    state.step = 0;
    state.values = {};
    state.customizations = '';
    render();
    window.scrollTo(0, 0);
  });
}

// ---------- Helpers ----------

function getOptionsFor(fieldKey) {
  const field = pgData.fields.find(f => f.key === fieldKey);
  return field?.options || [];
}

function populateChipGrid(host, fieldKey) {
  const opts = getOptionsFor(fieldKey);
  const current = state.values[fieldKey] || '';
  host.innerHTML = opts.map(opt => `
    <button class="wiz-chip ${opt.value === current ? 'selected' : ''}" type="button" data-value="${escapeAttr(opt.value)}">
      ${escapeHTML(opt.label)}
    </button>
  `).join('');
  host.querySelectorAll('.wiz-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.values[fieldKey] = chip.dataset.value;
      host.querySelectorAll('.wiz-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      updatePreview();
    });
  });
}

function updateNextEnabled() {
  const def = stepDefs[state.step];
  const nextBtn = document.getElementById('wiz-next');
  if (!nextBtn) return;
  if (def.required && !def.isComplete?.()) {
    nextBtn.setAttribute('disabled', '');
  } else {
    nextBtn.removeAttribute('disabled');
  }
}

function updatePreview() {
  const body = document.getElementById('wiz-preview-body');
  if (!body) return;
  const prompt = assemblePrompt();
  body.textContent = prompt || 'Fill in a Primary Topic to see your prompt build here…';
  body.classList.toggle('wiz-preview-empty', !prompt);
}

function getSubmitLabel() {
  const m = getModelById(state.modelId);
  if (!m) return 'Submit Prompt →';
  return m.method === 'clipboard'
    ? `Copy & Open ${m.name} →`
    : `Open in ${m.name} →`;
}

// Mirror the assembly logic from the form version
function assemblePrompt() {
  const primaryTopic = (state.values.primaryTopic || '').trim();
  const secondaryTopic = (state.values.secondaryTopic || '').trim();
  if (!primaryTopic) return '';

  const sub = (text) => text
    .replace(/\{primary_topic\}/g, primaryTopic)
    .replace(/\{secondary_topic\}/g, secondaryTopic || primaryTopic);

  // Opener
  const ctValue = state.values.contentType;
  let opener;
  if (ctValue) {
    const opt = getOptionsFor('contentType').find(o => o.value === ctValue);
    opener = opt?.clause ? sub(opt.clause) + '.' : sub(pgData.baseTemplate);
  } else {
    opener = sub(pgData.baseTemplate);
  }

  // Supporting clauses
  const supportingKeys = ['contentGeneration', 'sources', 'recency', 'citations', 'format', 'length', 'audience', 'tone', 'geographic'];
  const supporting = [];
  supportingKeys.forEach(key => {
    const value = state.values[key];
    if (!value) return;
    const opt = getOptionsFor(key).find(o => o.value === value);
    if (opt?.clause) supporting.push(sub(opt.clause) + '.');
  });

  const secondaryClause = (secondaryTopic && pgData.secondaryTopicClause)
    ? sub(pgData.secondaryTopicClause) : null;

  const customText = (state.customizations || '').trim();
  const customClause = customText ? `Additional instructions: ${customText}` : null;

  const parts = [opener];
  if (supporting.length > 0) parts.push(supporting.join(' '));
  if (secondaryClause) parts.push(secondaryClause);
  if (customClause) parts.push(customClause);
  if (supporting.length > 0 || secondaryClause || customClause) {
    parts.push(pgData.closingLine);
  }
  return parts.join('\n\n');
}

// ---------- Utilities ----------

function escapeHTML(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
