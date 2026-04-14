// Knowledge Prompt Generator — guided wizard mode.
// Multi-step flow with cards, chips, and a final review/submit screen.
//
// Supports per-field flags in prompt-generator.json:
//   multiSelect: true   → users can select multiple values
//   allowCustom: true   → users can add custom string values
//   options[].requiresInput → when this option is selected, asks the
//                              user for an extra value substituted into
//                              the option's clause via {key} placeholder

import { getPromptGenData, getModels, getDefaultModelId, getModelById, getParentTopics, getAllTopics, searchTopics } from '../utils/data.js';
import { getPreferredModelId, setPreferredModelId, submitPrompt, isUrlTooLong, shouldCopyOnOpen } from '../utils/ai-models.js';

const state = {
  step: 0,
  values: {},          // { fieldKey: 'value' (single) or ['v1','v2'] (multi) }
  customValues: {},    // { fieldKey: { 'c<id>': 'custom string' } }
  extraInputs: {},     // { 'requiresInputKey': 'value' } (e.g. compare_to)
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

  state.step = 0;
  state.values = {};
  state.customValues = {};
  state.extraInputs = {};
  state.modelId = getPreferredModelId(getDefaultModelId());
  state.customizations = '';

  stepDefs = buildStepDefinitions();
  render();
}

// ---------- Step definitions ----------

function buildStepDefinitions() {
  return [
    { id: 'topic', label: 'Topic', title: 'What topic do you want to learn about?',
      description: 'Pick a popular topic or type your own. You can also add a secondary topic to combine ideas.',
      required: true, render: renderTopicStep,
      isComplete: () => !!state.values.primaryTopic?.trim() },
    { id: 'contentType', label: 'Content Type', title: 'What kind of content do you want?',
      description: 'Pick one or more — combine formats if you want, or add a custom one.',
      render: renderContentTypeStep },
    { id: 'contentGeneration', label: 'Approach', title: 'How should the AI approach this?',
      description: 'Optional. Pick one or more approaches the AI should take.',
      render: (host) => {
        host.innerHTML = `<div data-field="contentGeneration"></div><div class="wiz-extras" data-extras-field="contentGeneration"></div>`;
        populateChipGrid(host.querySelector('[data-field="contentGeneration"]'), 'contentGeneration');
        renderExtraInputs(host.querySelector('[data-extras-field="contentGeneration"]'), 'contentGeneration');
      } },
    { id: 'sourcesAndTime', label: 'Sources & Time', title: 'Where should the information come from?',
      description: 'Source types (multi-select), time period, and citation style.',
      render: renderSourcesAndTimeStep },
    { id: 'formatAndLength', label: 'Format & Length', title: 'How should the answer be structured?',
      description: 'Pick a format and approximate length.',
      render: renderFormatAndLengthStep },
    { id: 'audienceAndTone', label: 'Audience & Tone', title: 'Who is this for, and what voice?',
      description: 'Set the reading level and writing tone.',
      render: renderAudienceAndToneStep },
    { id: 'geoAndCustom', label: 'Region & Custom', title: 'Anything else?',
      description: 'Optional regional focus(es) and any custom instructions you want to add.',
      render: renderGeoAndCustomStep },
    { id: 'review', label: 'Review & Submit', title: 'Review your prompt and choose a model',
      description: 'Edit the model and submit when ready.',
      isFinal: true, render: renderReviewStep },
  ];
}

const cardIcons = {
  'overview': '📋', 'research-summary': '📊', 'explainer': '💡',
  'comparison': '🔍', 'timeline': '📅', 'case-study': '🔬',
};

// ---------- Helpers: field metadata + state ----------

function getField(fieldKey) {
  return pgData.fields.find(f => f.key === fieldKey);
}
function getOptionsFor(fieldKey) {
  return getField(fieldKey)?.options || [];
}
function isFieldMulti(fieldKey) {
  return !!getField(fieldKey)?.multiSelect;
}
function isFieldAllowCustom(fieldKey) {
  return !!getField(fieldKey)?.allowCustom;
}
function getValuesArray(fieldKey) {
  const v = state.values[fieldKey];
  if (Array.isArray(v)) return v;
  if (v) return [v];
  return [];
}
function isValueSelected(fieldKey, value) {
  return getValuesArray(fieldKey).includes(value);
}
function toggleValue(fieldKey, value) {
  if (isFieldMulti(fieldKey)) {
    const arr = [...getValuesArray(fieldKey)];
    const idx = arr.indexOf(value);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(value);
    if (arr.length === 0) delete state.values[fieldKey];
    else state.values[fieldKey] = arr;
  } else {
    if (state.values[fieldKey] === value) delete state.values[fieldKey];
    else state.values[fieldKey] = value;
  }
}
function addCustomValue(fieldKey, customStr) {
  const text = (customStr || '').trim();
  if (!text) return;
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  if (!state.customValues[fieldKey]) state.customValues[fieldKey] = {};
  state.customValues[fieldKey][id] = text;
  // Add to selection
  if (isFieldMulti(fieldKey)) {
    state.values[fieldKey] = [...getValuesArray(fieldKey), id];
  } else {
    state.values[fieldKey] = id;
  }
}
function removeValue(fieldKey, value) {
  // For multi: remove from array; for single: clear if matches
  if (isFieldMulti(fieldKey)) {
    const arr = getValuesArray(fieldKey).filter(v => v !== value);
    if (arr.length === 0) delete state.values[fieldKey];
    else state.values[fieldKey] = arr;
  } else if (state.values[fieldKey] === value) {
    delete state.values[fieldKey];
  }
  // If the value was a custom value, also remove from customValues
  if (state.customValues[fieldKey] && value in state.customValues[fieldKey]) {
    delete state.customValues[fieldKey][value];
  }
}
function getCustomLabel(fieldKey, valueId) {
  return state.customValues[fieldKey]?.[valueId];
}

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
      <div class="wiz-preview">
        <div class="wiz-preview-head">
          <span class="wiz-preview-label">Live Prompt Preview</span>
        </div>
        <div class="wiz-preview-body" id="wiz-preview-body"></div>
      </div>` : ''}

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
  host.innerHTML = `
    <label class="wiz-label">Primary Topic <span class="wiz-required">*</span></label>
    <button type="button" class="wiz-topic-picker" id="wiz-primary-picker">
      <span class="wiz-topic-picker-icon">🔍</span>
      <span class="wiz-topic-picker-value" id="wiz-primary-value">
        ${state.values.primaryTopic
          ? escapeHTML(state.values.primaryTopic)
          : '<span class="wiz-topic-picker-placeholder">Click to choose a topic or type your own</span>'}
      </span>
      <span class="wiz-topic-picker-chevron" aria-hidden="true">▾</span>
    </button>

    <label class="wiz-label" style="margin-top: 1.25rem;">Secondary Topic <span class="wiz-optional">(optional)</span></label>
    <button type="button" class="wiz-topic-picker" id="wiz-secondary-picker">
      <span class="wiz-topic-picker-icon">🔍</span>
      <span class="wiz-topic-picker-value" id="wiz-secondary-value">
        ${state.values.secondaryTopic
          ? escapeHTML(state.values.secondaryTopic)
          : '<span class="wiz-topic-picker-placeholder">Combine with another topic (optional)</span>'}
      </span>
      <span class="wiz-topic-picker-chevron" aria-hidden="true">▾</span>
    </button>
  `;

  host.querySelector('#wiz-primary-picker').addEventListener('click', () => {
    openTopicPicker('Primary Topic', state.values.primaryTopic, (value) => {
      state.values.primaryTopic = value;
      document.getElementById('wiz-primary-value').textContent = value;
      updateNextEnabled();
      updatePreview();
    });
  });

  host.querySelector('#wiz-secondary-picker').addEventListener('click', () => {
    openTopicPicker('Secondary Topic', state.values.secondaryTopic, (value) => {
      state.values.secondaryTopic = value;
      document.getElementById('wiz-secondary-value').textContent = value;
      updatePreview();
    });
  });
}

// Topic picker overlay: full library + custom typing, callback-style
let topicPickerEl = null;
function openTopicPicker(label, initialValue, onSelect) {
  if (!topicPickerEl) {
    topicPickerEl = document.createElement('div');
    topicPickerEl.className = 'wiz-topic-overlay';
    document.body.appendChild(topicPickerEl);
  }
  const all = getAllTopics().filter(t => t.slug !== 'home');
  const groups = getParentTopics().map(parent => ({
    parent,
    subtopics: all.filter(t => t.parent === parent.slug),
  }));

  let query = initialValue || '';
  let highlightIdx = -1;
  let currentResults = [];

  const close = () => {
    topicPickerEl.style.display = 'none';
    document.body.style.overflow = '';
  };
  const choose = (val) => {
    if (val == null) val = query.trim();
    if (!val) return;
    onSelect(val);
    close();
  };

  function rerender() {
    const q = query.trim().toLowerCase();
    let html = `
      <div class="wiz-topic-overlay-card">
        <div class="wiz-topic-overlay-input-row">
          <span class="wiz-topic-overlay-icon">🔍</span>
          <input type="text" class="wiz-topic-overlay-input" id="wiz-topic-overlay-input"
                 placeholder="Search or type a topic"
                 value="${escapeAttr(query)}" autocomplete="off" spellcheck="false">
          <button type="button" class="wiz-topic-overlay-close" id="wiz-topic-overlay-close" aria-label="Close">✕</button>
        </div>
        <div class="wiz-topic-overlay-body">
    `;

    if (q.length > 0) {
      // Search mode: custom option + matching topics
      const matches = searchTopics(query);
      currentResults = [
        { type: 'custom', name: query.trim() },
        ...matches.map(m => ({ type: 'topic', name: m.name, parent: m.parentName })),
      ];
      html += `
        <div class="wiz-topic-overlay-result wiz-topic-overlay-result-custom" data-idx="0">
          <span class="wiz-topic-overlay-badge">+</span>
          Use "<strong>${escapeHTML(query.trim())}</strong>" as a custom topic
        </div>
      `;
      if (matches.length > 0) {
        html += `<div class="wiz-topic-overlay-section-label">Library Matches</div>`;
        matches.forEach((m, i) => {
          html += `
            <div class="wiz-topic-overlay-result" data-idx="${i + 1}">
              <span>${escapeHTML(m.name)}</span>
              ${m.parentName ? `<span class="wiz-topic-overlay-result-parent">in ${escapeHTML(m.parentName)}</span>` : ''}
            </div>
          `;
        });
      }
    } else {
      // Browse mode: all parents + subtopics
      currentResults = [];
      groups.forEach(group => {
        html += `
          <div class="wiz-topic-overlay-group">
            <div class="wiz-topic-overlay-group-label">${escapeHTML(group.parent.name)}</div>
            <div class="wiz-topic-overlay-chips">
              <button type="button" class="wiz-topic-overlay-chip wiz-topic-overlay-chip-parent" data-name="${escapeAttr(group.parent.name)}">${escapeHTML(group.parent.name)}</button>
              ${group.subtopics.map(s => `
                <button type="button" class="wiz-topic-overlay-chip" data-name="${escapeAttr(s.name)}">${escapeHTML(s.name)}</button>
              `).join('')}
            </div>
          </div>
        `;
      });
    }

    html += `</div></div>`;
    topicPickerEl.innerHTML = html;

    const input = document.getElementById('wiz-topic-overlay-input');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    input.addEventListener('input', () => {
      query = input.value;
      highlightIdx = -1;
      rerender();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightIdx >= 0 && currentResults[highlightIdx]) {
          choose(currentResults[highlightIdx].name);
        } else if (currentResults.length > 0) {
          // First topic match if exists, else custom
          const first = currentResults.find(r => r.type === 'topic') || currentResults[0];
          choose(first.name);
        } else if (query.trim()) {
          choose(query.trim());
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightIdx = Math.min(highlightIdx + 1, currentResults.length - 1);
        updateOverlayHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightIdx = Math.max(highlightIdx - 1, 0);
        updateOverlayHighlight();
      }
    });

    document.getElementById('wiz-topic-overlay-close').addEventListener('click', close);

    topicPickerEl.querySelectorAll('.wiz-topic-overlay-chip').forEach(b => {
      b.addEventListener('click', () => choose(b.dataset.name));
    });
    topicPickerEl.querySelectorAll('.wiz-topic-overlay-result').forEach(r => {
      r.addEventListener('click', () => {
        const idx = parseInt(r.dataset.idx, 10);
        if (currentResults[idx]) choose(currentResults[idx].name);
      });
    });
  }

  function updateOverlayHighlight() {
    topicPickerEl.querySelectorAll('.wiz-topic-overlay-result').forEach((el, i) => {
      el.classList.toggle('highlighted', i === highlightIdx);
    });
  }

  // Click outside the card closes
  topicPickerEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  rerender();

  topicPickerEl.onclick = (e) => {
    if (e.target === topicPickerEl) close();
  };
}

function renderContentTypeStep(host) {
  host.innerHTML = `<div class="wiz-cards-wrap"></div><div class="wiz-extras" data-extras-field="contentType"></div>`;
  populateCardGrid(host.querySelector('.wiz-cards-wrap'), 'contentType');
  renderExtraInputs(host.querySelector('.wiz-extras'), 'contentType');
}

function renderSourcesAndTimeStep(host) {
  host.innerHTML = `
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Source Types <span class="wiz-optional">(pick one or more)</span></label>
      <div data-field="sources"></div>
      <div class="wiz-extras" data-extras-field="sources"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Time Period</label>
      <div data-field="recency"></div>
      <div class="wiz-extras" data-extras-field="recency"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Citations</label>
      <div data-field="citations"></div>
    </div>
  `;
  populateChipGrid(host.querySelector('[data-field="sources"]'), 'sources');
  populateChipGrid(host.querySelector('[data-field="recency"]'), 'recency');
  populateChipGrid(host.querySelector('[data-field="citations"]'), 'citations');
  renderExtraInputs(host.querySelector('[data-extras-field="sources"]'), 'sources');
  renderExtraInputs(host.querySelector('[data-extras-field="recency"]'), 'recency');
}

function renderFormatAndLengthStep(host) {
  host.innerHTML = `
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Output Format</label>
      <div data-field="format"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Length</label>
      <div data-field="length"></div>
    </div>
  `;
  populateChipGrid(host.querySelector('[data-field="format"]'), 'format');
  populateChipGrid(host.querySelector('[data-field="length"]'), 'length');
}

function renderAudienceAndToneStep(host) {
  host.innerHTML = `
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Reading Level</label>
      <div data-field="audience"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Writing Tone</label>
      <div data-field="tone"></div>
    </div>
  `;
  populateChipGrid(host.querySelector('[data-field="audience"]'), 'audience');
  populateChipGrid(host.querySelector('[data-field="tone"]'), 'tone');
}

function renderGeoAndCustomStep(host) {
  host.innerHTML = `
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Geographic Focus <span class="wiz-optional">(pick one or more)</span></label>
      <div data-field="geographic"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Custom Instructions <span class="wiz-optional">(optional)</span></label>
      <textarea class="wiz-textarea" id="wiz-custom"
                placeholder="Add any extra instructions, e.g. 'Include code examples' or 'Avoid jargon'">${escapeHTML(state.customizations || '')}</textarea>
    </div>
  `;
  populateChipGrid(host.querySelector('[data-field="geographic"]'), 'geographic');
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
              ${escapeHTML(m.name)}
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
    // Surgical update — don't re-render the whole step
    host.querySelectorAll('.wiz-model-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.modelId === state.modelId);
    });
    const submitBtn = host.querySelector('#wiz-submit');
    if (submitBtn) submitBtn.textContent = getSubmitLabel();
  });

  host.querySelector('#wiz-submit').addEventListener('click', async () => {
    const model = getModelById(state.modelId);
    if (!model) return;
    await submitPrompt(model, prompt);
  });

  host.querySelector('#wiz-restart').addEventListener('click', () => {
    state.step = 0;
    state.values = {};
    state.customValues = {};
    state.extraInputs = {};
    state.customizations = '';
    render();
    window.scrollTo(0, 0);
  });
}

// ---------- Card grid (Content Type step) ----------

function populateCardGrid(host, fieldKey) {
  const opts = getOptionsFor(fieldKey);
  const customMap = state.customValues[fieldKey] || {};
  const allowCustom = isFieldAllowCustom(fieldKey);

  let html = `<div class="wiz-cards">`;
  opts.forEach(opt => {
    const selected = isValueSelected(fieldKey, opt.value);
    html += `
      <button class="wiz-card ${selected ? 'selected' : ''}" type="button" data-value="${escapeAttr(opt.value)}">
        <div class="wiz-card-icon">${cardIcons[opt.value] || '•'}</div>
        <div class="wiz-card-label">${escapeHTML(opt.label)}</div>
      </button>
    `;
  });
  // Custom card-style chips
  Object.entries(customMap).forEach(([id, label]) => {
    if (!isValueSelected(fieldKey, id)) return;
    html += `
      <div class="wiz-card selected wiz-card-custom" data-value="${escapeAttr(id)}">
        <div class="wiz-card-icon">✏️</div>
        <div class="wiz-card-label">${escapeHTML(label)}</div>
        <button class="wiz-card-remove" type="button" data-remove="${escapeAttr(id)}" aria-label="Remove">×</button>
      </div>
    `;
  });
  if (allowCustom) {
    html += `
      <button class="wiz-card wiz-card-add" type="button" data-add-custom="true">
        <div class="wiz-card-icon">＋</div>
        <div class="wiz-card-label">Add custom</div>
      </button>
    `;
  }
  html += `</div>`;
  host.innerHTML = html;

  attachChipHandlers(host, fieldKey, '.wiz-card', '.wiz-card-add', '.wiz-card-remove');
}

// ---------- Chip grid (most fields) ----------

function populateChipGrid(host, fieldKey) {
  const opts = getOptionsFor(fieldKey);
  const customMap = state.customValues[fieldKey] || {};
  const allowCustom = isFieldAllowCustom(fieldKey);

  let html = `<div class="wiz-chip-grid">`;
  opts.forEach(opt => {
    const selected = isValueSelected(fieldKey, opt.value);
    html += `
      <button class="wiz-chip ${selected ? 'selected' : ''}" type="button" data-value="${escapeAttr(opt.value)}">
        ${escapeHTML(opt.label)}
      </button>
    `;
  });
  Object.entries(customMap).forEach(([id, label]) => {
    if (!isValueSelected(fieldKey, id)) return;
    html += `
      <span class="wiz-chip selected wiz-chip-custom" data-value="${escapeAttr(id)}">
        ${escapeHTML(label)}
        <button class="wiz-chip-remove" type="button" data-remove="${escapeAttr(id)}" aria-label="Remove">×</button>
      </span>
    `;
  });
  if (allowCustom) {
    html += `
      <button class="wiz-chip wiz-chip-add" type="button" data-add-custom="true">
        + Add custom
      </button>
    `;
  }
  html += `</div>`;
  host.innerHTML = html;

  attachChipHandlers(host, fieldKey, '.wiz-chip', '.wiz-chip-add', '.wiz-chip-remove');
}

// Shared click handlers for both card and chip grids
function attachChipHandlers(host, fieldKey, itemSelector, addSelector, removeSelector) {
  host.querySelectorAll(itemSelector).forEach(el => {
    if (el.matches(addSelector)) return; // handled separately
    el.addEventListener('click', (e) => {
      // Don't toggle when clicking the remove button
      if (e.target.closest(removeSelector)) return;
      const value = el.dataset.value;
      if (!value) return;
      toggleValue(fieldKey, value);
      // If this was a custom value being deselected, also remove it
      if (!isValueSelected(fieldKey, value) && state.customValues[fieldKey]?.[value]) {
        delete state.customValues[fieldKey][value];
      }
      rerenderField(fieldKey);
    });
  });
  host.querySelectorAll(removeSelector).forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeValue(fieldKey, btn.dataset.remove);
      rerenderField(fieldKey);
    });
  });
  const addBtn = host.querySelector(addSelector);
  if (addBtn) {
    addBtn.addEventListener('click', () => openCustomInput(addBtn, fieldKey));
  }
}

// Inline custom input that replaces the "+ Add custom" button
function openCustomInput(triggerEl, fieldKey) {
  const wrap = document.createElement('div');
  wrap.className = 'wiz-custom-input-wrap';
  wrap.innerHTML = `
    <input type="text" class="wiz-custom-input" placeholder="Type and press Enter…" autofocus>
    <button class="wiz-custom-add-btn" type="button">Add</button>
    <button class="wiz-custom-cancel-btn" type="button" aria-label="Cancel">✕</button>
  `;
  triggerEl.parentNode.replaceChild(wrap, triggerEl);
  const input = wrap.querySelector('.wiz-custom-input');
  const addBtn = wrap.querySelector('.wiz-custom-add-btn');
  const cancelBtn = wrap.querySelector('.wiz-custom-cancel-btn');

  input.focus();

  const submit = () => {
    const text = input.value.trim();
    if (text) {
      addCustomValue(fieldKey, text);
    }
    rerenderField(fieldKey);
  };
  const cancel = () => {
    rerenderField(fieldKey);
  };

  addBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', cancel);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}

// Rerender just the chip/card grid for one field, and its extras input area
function rerenderField(fieldKey) {
  if (fieldKey === 'contentType') {
    const wrap = document.querySelector('.wiz-cards-wrap');
    if (wrap) populateCardGrid(wrap, fieldKey);
  } else {
    const fieldRoot = document.querySelector(`[data-field="${fieldKey}"]`);
    if (fieldRoot) populateChipGrid(fieldRoot, fieldKey);
  }
  // Re-render extras for fields that may have requiresInput
  const extras = document.querySelector(`[data-extras-field="${fieldKey}"]`);
  if (extras) renderExtraInputs(extras, fieldKey);

  updatePreview();
  updateNextEnabled();
}

// Render the extra input fields for any selected option that has requiresInput
function renderExtraInputs(host, fieldKey) {
  if (!host) return;
  const selectedValues = getValuesArray(fieldKey);
  const opts = getOptionsFor(fieldKey);
  const needed = [];
  selectedValues.forEach(v => {
    const opt = opts.find(o => o.value === v);
    if (opt?.requiresInput) needed.push({ option: opt, req: opt.requiresInput });
  });
  if (needed.length === 0) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = needed.map(({ option, req }) => `
    <div class="wiz-extra-input">
      <label class="wiz-extra-label">
        ${escapeHTML(req.label)}
        <span class="wiz-extra-context">— for "${escapeHTML(option.label)}"</span>
        ${req.optional ? `<span class="wiz-optional">(optional)</span>` : ''}
      </label>
      <input type="text" class="wiz-input wiz-extra-field"
             data-extra-key="${escapeAttr(req.key)}"
             placeholder="${escapeAttr(req.placeholder || '')}"
             value="${escapeAttr(state.extraInputs[req.key] || '')}">
    </div>
  `).join('');

  host.querySelectorAll('.wiz-extra-field').forEach(input => {
    input.addEventListener('input', () => {
      state.extraInputs[input.dataset.extraKey] = input.value;
      updatePreview();
    });
  });
}

// ---------- Footer / preview ----------

function updateNextEnabled() {
  const def = stepDefs[state.step];
  const nextBtn = document.getElementById('wiz-next');
  if (!nextBtn) return;
  if (def.required && !def.isComplete?.()) nextBtn.setAttribute('disabled', '');
  else nextBtn.removeAttribute('disabled');
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
  return shouldCopyOnOpen(m)
    ? `Copy & Open ${m.name} →`
    : `Open ${m.name} →`;
}

// ---------- Prompt assembly ----------

function assemblePrompt() {
  const primaryTopic = (state.values.primaryTopic || '').trim();
  const secondaryTopic = (state.values.secondaryTopic || '').trim();
  if (!primaryTopic) return '';

  const sub = (text) => {
    let out = text
      .replace(/\{primary_topic\}/g, primaryTopic)
      .replace(/\{secondary_topic\}/g, secondaryTopic || primaryTopic);
    Object.entries(state.extraInputs).forEach(([k, v]) => {
      const placeholder = v?.trim() || `[${k.replace(/_/g, ' ')}]`;
      out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), placeholder);
    });
    return out;
  };

  // Helper: clauses for any single-select-style usage
  const clausesForField = (fieldKey) => {
    const values = getValuesArray(fieldKey);
    if (values.length === 0) return [];
    const opts = getOptionsFor(fieldKey);
    return values.map(value => {
      const opt = opts.find(o => o.value === value);
      if (opt) return opt.clause ? sub(opt.clause) : null;
      const customLabel = getCustomLabel(fieldKey, value);
      return customLabel ? generateCustomClause(fieldKey, customLabel) : null;
    }).filter(Boolean);
  };

  // ---- Section 1: Opener (from Content Type) ----
  // Single value → use full clause as-is.
  // Multiple values → bulleted list of labels (no redundancy).
  const opener = buildOpener(primaryTopic, sub);

  // ---- Sections 2+: Group supporting clauses by category for cleaner prose
  const sections = [];

  // Approach
  const approach = clausesForField('contentGeneration');
  if (approach.length > 0) sections.push(approach.map(endWithPeriod).join(' '));

  // Sources / Time / Citations — combined paragraph
  const sourceTimeCite = [
    ...clausesForField('sources'),
    ...clausesForField('recency'),
    ...clausesForField('citations'),
  ];
  if (sourceTimeCite.length > 0) sections.push(sourceTimeCite.map(endWithPeriod).join(' '));

  // Format & Length — combined
  const formatLen = [
    ...clausesForField('format'),
    ...clausesForField('length'),
  ];
  if (formatLen.length > 0) sections.push(formatLen.map(endWithPeriod).join(' '));

  // Audience & Tone — combined
  const audTone = [
    ...clausesForField('audience'),
    ...clausesForField('tone'),
  ];
  if (audTone.length > 0) sections.push(audTone.map(endWithPeriod).join(' '));

  // Geographic — multi-select friendly: combine into one sentence
  const geoValues = getValuesArray('geographic');
  if (geoValues.length === 1) {
    const c = clausesForField('geographic')[0];
    if (c) sections.push(endWithPeriod(c));
  } else if (geoValues.length > 1) {
    const labels = geoValues.map(v => {
      const opt = getOptionsFor('geographic').find(o => o.value === v);
      if (opt) return opt.label;
      return getCustomLabel('geographic', v);
    }).filter(Boolean);
    sections.push(`Cover the following geographic perspectives: ${joinList(labels)}.`);
  }

  // Secondary topic clause
  if (secondaryTopic && pgData.secondaryTopicClause) {
    sections.push(sub(pgData.secondaryTopicClause));
  }

  // Custom instructions (free text)
  const customText = (state.customizations || '').trim();
  if (customText) sections.push(`Additional instructions: ${customText}`);

  const parts = [opener];
  parts.push(...sections);
  if (sections.length > 0) parts.push(pgData.closingLine);
  return parts.join('\n\n');
}

// Build the opener paragraph from Content Type selections.
// 1 selection → use the option's full clause (e.g., "Provide a comprehensive overview of X.")
// 2+ selections → "Provide the following about X:" with bulleted labels (no redundancy)
function buildOpener(primaryTopic, sub) {
  const values = getValuesArray('contentType');
  if (values.length === 0) return sub(pgData.baseTemplate);

  if (values.length === 1) {
    const v = values[0];
    const opt = getOptionsFor('contentType').find(o => o.value === v);
    if (opt?.clause) return endWithPeriod(sub(opt.clause));
    const custom = getCustomLabel('contentType', v);
    return custom ? `Provide ${custom} about ${primaryTopic}.` : sub(pgData.baseTemplate);
  }

  // Multiple — bullet list with short labels
  const items = values.map(v => {
    const opt = getOptionsFor('contentType').find(o => o.value === v);
    if (opt) {
      let label = opt.label;
      if (opt.requiresInput) {
        const extra = state.extraInputs[opt.requiresInput.key]?.trim();
        if (extra) label += ` with ${extra}`;
      }
      return label;
    }
    return getCustomLabel('contentType', v);
  }).filter(Boolean);

  return `Provide the following about ${primaryTopic}:\n` + items.map(s => `• ${s}`).join('\n');
}

// "a, b, and c" / "a and b" / "a"
function joinList(arr) {
  if (arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
}

function endWithPeriod(s) {
  if (!s) return s;
  return /[.!?]$/.test(s.trim()) ? s : s + '.';
}

// Generic clause for custom values, varies by field
function generateCustomClause(fieldKey, customStr) {
  switch (fieldKey) {
    case 'contentType': return `Provide ${customStr} on the topic`;
    case 'contentGeneration': return `Approach this with ${customStr}`;
    case 'sources': return `Draw from ${customStr}`;
    case 'geographic': return `Focus on ${customStr}`;
    default: return customStr;
  }
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
