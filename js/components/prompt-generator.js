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
  visited: new Set(), // Step indices the user has visited
};

let pgData = null;
let modelsData = null;
let stepDefs = [];
let containerEl = null;

// Exposed for the live-preview modal so it can pull the current prompt
// at open time without depending on hidden DOM.
export function getAssembledPrompt() {
  return assemblePrompt();
}

// Defensive re-render of the subnav step pills — they can get blanked
// out when the subnav container is re-rendered by unrelated code paths
// (e.g., resize handlers, layout shifts). This runs periodically during
// the wizard's lifetime to keep them in sync.
let subnavResizeHandler = null;
function ensureSubnavStepsPresent() {
  const host = document.getElementById('prompt-gen-steps');
  if (!host) return;
  if (host.children.length === 0 && stepDefs.length > 0) {
    renderStepsInSubnav();
  }
}

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
  state.visited = new Set([0]);

  stepDefs = buildStepDefinitions();
  render();

  // Re-render step pills on resize — defends against the subnav being
  // rewritten by unrelated code paths and the pills getting wiped when
  // the viewport changes.
  if (subnavResizeHandler) {
    window.removeEventListener('resize', subnavResizeHandler);
  }
  subnavResizeHandler = () => {
    // Always re-render — cheap, and guarantees fresh state after any
    // layout shift or breakpoint crossing.
    renderStepsInSubnav();
  };
  window.addEventListener('resize', subnavResizeHandler, { passive: true });
}

// ---------- Step definitions ----------

function buildStepDefinitions() {
  return [
    { id: 'topic', label: 'Topic', icon: '🎯',
      title: 'What do you want to learn about?',
      description: 'Choose one or more primary topics. Add secondary topics to blend ideas.',
      required: true, render: renderTopicStep,
      isComplete: () => getPrimaryTopics().length > 0 },
    { id: 'content', label: 'Content', icon: '📋',
      title: 'What kind of content do you want?',
      description: 'Content type, approach, sources, recency, and citations — all in one place.',
      render: renderContentStep },
    { id: 'style', label: 'Style', icon: '🎨',
      title: 'How should it be written?',
      description: 'Format, length, audience, tone, region, and any custom instructions.',
      render: renderStyleStep },
    { id: 'review', label: 'Review', icon: '✓',
      title: 'Review your prompt and choose a model',
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
  return true;
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

// Add / remove the × button on a chip or card based on selection.
function ensureRemoveX(el, value, selected) {
  const isCard = el.classList.contains('wiz-card');
  const cls = isCard ? 'wiz-card-remove' : 'wiz-chip-remove';
  const existing = el.querySelector('.' + cls);
  if (selected && !existing) {
    const span = document.createElement('span');
    span.className = cls;
    span.setAttribute('data-remove', value);
    span.setAttribute('aria-label', 'Remove');
    span.textContent = '×';
    el.appendChild(span);
  } else if (!selected && existing) {
    existing.remove();
  }
}

// Debounced preview update — avoids reassembling the prompt on every keystroke.
let previewTimer = null;
function schedulePreview() {
  if (previewTimer) cancelAnimationFrame(previewTimer);
  previewTimer = requestAnimationFrame(() => {
    previewTimer = null;
    updatePreview();
  });
}

// Primary/secondary topics are stored as arrays of plain strings.
function getPrimaryTopics() {
  const v = state.values.primaryTopic;
  if (Array.isArray(v)) return v.filter(s => typeof s === 'string' && s.trim());
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}
function getSecondaryTopics() {
  const v = state.values.secondaryTopic;
  if (Array.isArray(v)) return v.filter(s => typeof s === 'string' && s.trim());
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}
function addTopic(key, value) {
  const v = (value || '').trim();
  if (!v) return;
  const arr = key === 'primaryTopic' ? getPrimaryTopics() : getSecondaryTopics();
  if (arr.includes(v)) return;
  state.values[key] = [...arr, v];
}
function removeTopic(key, value) {
  const arr = (key === 'primaryTopic' ? getPrimaryTopics() : getSecondaryTopics())
    .filter(t => t !== value);
  if (arr.length === 0) delete state.values[key];
  else state.values[key] = arr;
}

// ---------- Top-level render (two-panel, single-page) ----------

function render() {
  const prompt = assemblePrompt();
  const isEmpty = !prompt;
  const models = getModels();
  const primary = getPrimaryTopics();
  const secondary = getSecondaryTopics();

  const topicChips = (items, key) => items.map(t => `
    <span class="wiz-inline-chip" data-key="${key}" data-value="${escapeAttr(t)}">
      ${escapeHTML(t)}
      <button type="button" class="wiz-inline-chip-x" aria-label="Remove">×</button>
    </span>
  `).join('');

  containerEl.innerHTML = `
    <div class="wiz-two-panel">
      <div class="wiz-fields">
        <div class="wiz-intro">
          <p class="wiz-intro-text">Build a tailored AI prompt in seconds. Choose your topics, customize the content style and delivery, and watch your prompt come together in the live preview. When you're ready, pick your preferred AI model and submit.</p>
        </div>

        <div class="wiz-field-row wiz-topics-row">
          <div class="wiz-field-half">
            <label class="wiz-field-label">Primary Topic(s) <span class="wiz-req">required</span></label>
            <div class="wiz-topic-chips" id="wiz-primary-chips">
              ${topicChips(primary, 'primaryTopic')}
              <button type="button" class="wiz-topic-add-inline" id="wiz-primary-add">${primary.length ? '+ Add more' : '+ Add topic'}</button>
            </div>
          </div>
          <div class="wiz-field-half">
            <label class="wiz-field-label">Secondary Topic(s) <span class="wiz-opt">(optional)</span></label>
            <div class="wiz-topic-chips" id="wiz-secondary-chips">
              ${topicChips(secondary, 'secondaryTopic')}
              <button type="button" class="wiz-topic-add-inline" id="wiz-secondary-add">${secondary.length ? '+ Add more' : '+ Add topic'}</button>
            </div>
          </div>
        </div>

        <div class="wiz-field-group">
          <label class="wiz-field-label">Content Type</label>
          <div data-field="contentType" id="wiz-field-contentType"></div>
          <div class="wiz-extras" data-extras-field="contentType"></div>
        </div>

        <div class="wiz-field-group">
          <label class="wiz-field-label">Approach <span class="wiz-opt">(optional)</span></label>
          <div data-field="contentGeneration" id="wiz-field-contentGeneration"></div>
          <div class="wiz-extras" data-extras-field="contentGeneration"></div>
        </div>

        <div class="wiz-field-row">
          <div class="wiz-field-half">
            <label class="wiz-field-label">Sources</label>
            <div data-field="sources" id="wiz-field-sources"></div>
            <div class="wiz-extras" data-extras-field="sources"></div>
          </div>
          <div class="wiz-field-half">
            <label class="wiz-field-label">Time Period</label>
            <div data-field="recency" id="wiz-field-recency"></div>
            <div class="wiz-extras" data-extras-field="recency"></div>
          </div>
        </div>

        <div class="wiz-field-row">
          <div class="wiz-field-half">
            <label class="wiz-field-label">Format</label>
            <div data-field="format" id="wiz-field-format"></div>
          </div>
          <div class="wiz-field-half">
            <label class="wiz-field-label">Length</label>
            <div data-field="length" id="wiz-field-length"></div>
          </div>
        </div>

        <div class="wiz-field-row">
          <div class="wiz-field-half">
            <label class="wiz-field-label">Reading Level</label>
            <div data-field="audience" id="wiz-field-audience"></div>
          </div>
          <div class="wiz-field-half">
            <label class="wiz-field-label">Tone</label>
            <div data-field="tone" id="wiz-field-tone"></div>
          </div>
        </div>

        <div class="wiz-field-row">
          <div class="wiz-field-half">
            <label class="wiz-field-label">Citations</label>
            <div data-field="citations" id="wiz-field-citations"></div>
          </div>
          <div class="wiz-field-half">
            <label class="wiz-field-label">Geographic Focus</label>
            <div data-field="geographic" id="wiz-field-geographic"></div>
          </div>
        </div>

        <div class="wiz-field-group">
          <label class="wiz-field-label">Custom Instructions <span class="wiz-opt">(optional)</span></label>
          <textarea class="wiz-custom-textarea" id="wiz-custom" placeholder="Add any extra instructions...">${escapeHTML(state.customizations || '')}</textarea>
        </div>
      </div>

    </div>

    <div class="wiz-action-bar">
      <button type="button" class="wiz-action-btn" id="wiz-open-preview" ${isEmpty ? 'disabled' : ''}>
        <span class="wiz-action-indicator ${isEmpty ? '' : 'has-content'}"></span>
        <span>Preview Prompt and Submit</span>
      </button>
      <button type="button" class="wiz-action-restart" id="wiz-restart">Start Over</button>
    </div>
  `;

  // Populate chip grids for all fields
  populateChipGrid(document.getElementById('wiz-field-contentType'), 'contentType');
  populateChipGrid(document.getElementById('wiz-field-contentGeneration'), 'contentGeneration');
  populateChipGrid(document.getElementById('wiz-field-sources'), 'sources');
  populateChipGrid(document.getElementById('wiz-field-recency'), 'recency');
  populateChipGrid(document.getElementById('wiz-field-format'), 'format');
  populateChipGrid(document.getElementById('wiz-field-length'), 'length');
  populateChipGrid(document.getElementById('wiz-field-audience'), 'audience');
  populateChipGrid(document.getElementById('wiz-field-tone'), 'tone');
  populateChipGrid(document.getElementById('wiz-field-citations'), 'citations');
  populateChipGrid(document.getElementById('wiz-field-geographic'), 'geographic');

  // Render extras for fields that have requiresInput
  ['contentType', 'contentGeneration', 'sources', 'recency'].forEach(fk => {
    const extras = document.querySelector(`[data-extras-field="${fk}"]`);
    if (extras) renderExtraInputs(extras, fk);
  });

  // Topic chip remove handlers
  containerEl.querySelectorAll('.wiz-inline-chip-x').forEach(btn => {
    btn.addEventListener('click', () => {
      const chip = btn.closest('.wiz-inline-chip');
      removeTopic(chip.dataset.key, chip.dataset.value);
      render();
    });
  });

  // Topic add buttons
  document.getElementById('wiz-primary-add')?.addEventListener('click', () => {
    openTopicPicker('Add Primary Topics', primary, (values) => {
      state.values.primaryTopic = values;
      if (values.length === 0) delete state.values.primaryTopic;
      render();
    });
  });
  document.getElementById('wiz-secondary-add')?.addEventListener('click', () => {
    openTopicPicker('Add Secondary Topics', secondary, (values) => {
      state.values.secondaryTopic = values;
      if (values.length === 0) delete state.values.secondaryTopic;
      render();
    });
  });

  // Custom instructions
  document.getElementById('wiz-custom')?.addEventListener('input', (e) => {
    state.customizations = e.target.value;
    schedulePreview();
  });

  // Open the unified preview+submit modal
  document.getElementById('wiz-open-preview')?.addEventListener('click', () => {
    openPromptSubmitModal();
  });

  // Restart
  document.getElementById('wiz-restart')?.addEventListener('click', () => {
    state.values = {};
    state.customValues = {};
    state.extraInputs = {};
    state.customizations = '';
    state.editedPrompt = null;
    state.isEditingPrompt = false;
    render();
  });

  updatePreview();
}

function renderStepsInSubnav() {
  // No-op — single-page builder has no step nav
}

// A step is "complete" if the user has filled in something for it
function isStepComplete(idx) {
  const def = stepDefs[idx];
  if (!def) return false;
  if (def.isFinal) return false;
  const fieldsByStep = {
    topic: ['primaryTopic'],
    content: ['contentType', 'contentGeneration', 'sources', 'recency', 'citations'],
    style: ['format', 'length', 'audience', 'tone', 'geographic'],
  };
  const keys = fieldsByStep[def.id] || [];
  const hasField = keys.some(k => {
    const v = state.values[k];
    if (Array.isArray(v)) return v.length > 0;
    return !!(typeof v === 'string' ? v.trim() : v);
  });
  // Style stage also counts custom free-text instructions as progress
  if (def.id === 'style' && !hasField && (state.customizations || '').trim()) return true;
  return hasField;
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
  const primary = getPrimaryTopics();
  const secondary = getSecondaryTopics();

  const chipRow = (items, key) => items.map(t => `
    <span class="wiz-topic-chip" data-key="${key}" data-value="${escapeAttr(t)}">
      ${escapeHTML(t)}
      <button type="button" class="wiz-topic-chip-remove" aria-label="Remove">×</button>
    </span>
  `).join('');

  host.innerHTML = `
    <label class="wiz-label">Primary Topic${primary.length > 1 ? 's' : ''} <span class="wiz-required">*</span></label>
    <div class="wiz-topic-chips" id="wiz-primary-chips">
      ${chipRow(primary, 'primaryTopic')}
      <button type="button" class="wiz-topic-add" id="wiz-primary-add">
        <span aria-hidden="true">＋</span> ${primary.length === 0 ? 'Add primary topic' : 'Add more'}
      </button>
    </div>

    <label class="wiz-label" style="margin-top: 1.25rem;">Secondary Topic${secondary.length > 1 ? 's' : ''} <span class="wiz-optional">(optional)</span></label>
    <div class="wiz-topic-chips" id="wiz-secondary-chips">
      ${chipRow(secondary, 'secondaryTopic')}
      <button type="button" class="wiz-topic-add" id="wiz-secondary-add">
        <span aria-hidden="true">＋</span> ${secondary.length === 0 ? 'Add secondary topic' : 'Add more'}
      </button>
    </div>
  `;

  host.querySelectorAll('.wiz-topic-chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const chip = btn.closest('.wiz-topic-chip');
      removeTopic(chip.dataset.key, chip.dataset.value);
      renderTopicStep(host);
      updateNextEnabled();
      updatePreview();
    });
  });

  host.querySelector('#wiz-primary-add').addEventListener('click', () => {
    openTopicPicker('Add Primary Topics', primary, (values) => {
      state.values.primaryTopic = values;
      if (values.length === 0) delete state.values.primaryTopic;
      renderTopicStep(host);
      updateNextEnabled();
      updatePreview();
    });
  });

  host.querySelector('#wiz-secondary-add').addEventListener('click', () => {
    openTopicPicker('Add Secondary Topics', secondary, (values) => {
      state.values.secondaryTopic = values;
      if (values.length === 0) delete state.values.secondaryTopic;
      renderTopicStep(host);
      updatePreview();
    });
  });
}

// Topic picker overlay: full library + custom typing, callback-style.
// The input is rendered ONCE and stays alive across keystrokes; only the
// results body below is re-rendered as the user types.
// Multi-select topic picker overlay.
// Accepts `initialSelected` (array of topic strings) and `onConfirm(values[])`
// called once when the user clicks Done. Users can toggle library chips,
// search, and type custom topics — building up a list of selections.
let topicPickerEl = null;
function openTopicPicker(label, initialSelected, onConfirm) {
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

  // Working selection — a copy of the initial list
  const selected = new Set(Array.isArray(initialSelected) ? initialSelected : []);
  let highlightIdx = -1;
  let currentResults = [];

  const close = () => {
    topicPickerEl.style.display = 'none';
    document.body.style.overflow = '';
  };
  const done = () => {
    onConfirm(Array.from(selected));
    close();
  };
  const toggle = (val) => {
    const t = (val || '').trim();
    if (!t) return;
    if (selected.has(t)) selected.delete(t);
    else selected.add(t);
    renderSelectedRow();
    renderBody();
  };

  topicPickerEl.innerHTML = `
    <div class="search-overlay-card wiz-topic-picker-card">
      <div class="search-overlay-input-row">
        <svg class="search-bar-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="search-overlay-input" id="wiz-topic-overlay-input"
               placeholder="Search or type a custom topic"
               autocomplete="off" spellcheck="false">
        <button class="search-overlay-close" type="button" id="wiz-topic-overlay-close" aria-label="Close">✕</button>
      </div>
      <div class="wiz-topic-selected-row" id="wiz-topic-overlay-selected"></div>
      <div class="search-overlay-body shortcuts-sidebar" id="wiz-topic-overlay-body"></div>
      <div class="wiz-topic-picker-foot">
        <span class="wiz-topic-picker-count" id="wiz-topic-overlay-count"></span>
        <button type="button" class="wiz-topic-picker-done" id="wiz-topic-overlay-done">Done</button>
      </div>
    </div>
  `;

  const inputEl = topicPickerEl.querySelector('#wiz-topic-overlay-input');
  const bodyEl = topicPickerEl.querySelector('#wiz-topic-overlay-body');
  const selectedRowEl = topicPickerEl.querySelector('#wiz-topic-overlay-selected');
  const countEl = topicPickerEl.querySelector('#wiz-topic-overlay-count');

  function renderSelectedRow() {
    if (selected.size === 0) {
      selectedRowEl.innerHTML = `<span class="wiz-topic-overlay-empty">No topics selected yet.</span>`;
    } else {
      selectedRowEl.innerHTML = Array.from(selected).map(t => `
        <span class="wiz-topic-overlay-sel" data-value="${escapeAttr(t)}">
          ${escapeHTML(t)}
          <button type="button" class="wiz-topic-overlay-sel-remove" aria-label="Remove">×</button>
        </span>
      `).join('');
      selectedRowEl.querySelectorAll('.wiz-topic-overlay-sel-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const chip = btn.closest('.wiz-topic-overlay-sel');
          toggle(chip.dataset.value);
        });
      });
    }
    countEl.textContent = `${selected.size} selected`;
  }

  function refreshChipStates() {
    bodyEl.querySelectorAll('.wiz-topic-overlay-chip').forEach(b => {
      b.classList.toggle('is-selected', selected.has(b.dataset.name));
    });
  }

  function renderBody() {
    const query = inputEl.value;
    const q = query.trim().toLowerCase();
    let html = '';

    if (q.length > 0) {
      const matches = searchTopics(query);
      currentResults = [
        { type: 'custom', name: query.trim() },
        ...matches.map(m => ({ type: 'topic', name: m.name, parent: m.parentName })),
      ];
      const customSel = selected.has(query.trim());
      html += `
        <div class="search-overlay-custom wiz-topic-result" data-idx="0">
          <span class="search-custom-badge">${customSel ? '✓' : '+'}</span>
          ${customSel ? 'Added' : 'Add'} "<strong>${escapeHTML(query.trim())}</strong>"
        </div>
      `;
      if (matches.length > 0) {
        matches.forEach((m, i) => {
          const isSel = selected.has(m.name);
          html += `
            <div class="sidebar-shortcut wiz-topic-result ${isSel ? 'is-selected' : ''}" data-idx="${i + 1}">
              <span class="wiz-topic-check">${isSel ? '✓' : ''}</span>
              <span class="sidebar-shortcut-name">${escapeHTML(m.name)}</span>
              ${m.parentName ? `<span class="wiz-topic-parent-hint">in ${escapeHTML(m.parentName)}</span>` : ''}
            </div>
          `;
        });
      }
    } else {
      currentResults = [];
      groups.forEach(group => {
        const parentSel = selected.has(group.parent.name);
        html += `
          <div class="search-overlay-group">
            <div class="sidebar-shortcut search-parent-row wiz-topic-row ${parentSel ? 'is-selected' : ''}" data-name="${escapeAttr(group.parent.name)}">
              <span class="wiz-topic-check">${parentSel ? '✓' : ''}</span>
              <span class="sidebar-shortcut-name">${escapeHTML(group.parent.name)}</span>
            </div>
            <div class="sidebar-shortcut-list search-subtopic-list">
              ${group.subtopics.map(s => {
                const sel = selected.has(s.name);
                return `
                  <div class="sidebar-shortcut search-subtopic-row wiz-topic-row ${sel ? 'is-selected' : ''}" data-name="${escapeAttr(s.name)}">
                    <span class="wiz-topic-check">${sel ? '✓' : ''}</span>
                    <span class="sidebar-shortcut-name">${escapeHTML(s.name)}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      });
    }

    bodyEl.innerHTML = html;

    bodyEl.querySelectorAll('.wiz-topic-row').forEach(row => {
      row.addEventListener('click', () => toggle(row.dataset.name));
    });
    bodyEl.querySelectorAll('.wiz-topic-result').forEach(r => {
      r.addEventListener('click', () => {
        const idx = parseInt(r.dataset.idx, 10);
        if (currentResults[idx]) {
          toggle(currentResults[idx].name);
          if (idx === 0) { inputEl.value = ''; renderBody(); }
          else renderBody();
        }
      });
    });
  }

  // Debounce renderBody on input — rebuilding the full topic list on
  // every keystroke was causing visible lag.
  let inputTimer = null;
  inputEl.addEventListener('input', () => {
    highlightIdx = -1;
    if (inputTimer) clearTimeout(inputTimer);
    inputTimer = setTimeout(() => renderBody(), 120);
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIdx >= 0 && currentResults[highlightIdx]) {
        toggle(currentResults[highlightIdx].name);
        inputEl.value = '';
        renderBody();
      } else if (currentResults.length > 0) {
        toggle(currentResults[0].name);
        inputEl.value = '';
        renderBody();
      } else if (inputEl.value.trim()) {
        toggle(inputEl.value.trim());
        inputEl.value = '';
        renderBody();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      done();
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

  topicPickerEl.querySelector('#wiz-topic-overlay-close').addEventListener('click', done);
  topicPickerEl.querySelector('#wiz-topic-overlay-done').addEventListener('click', done);

  topicPickerEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  renderSelectedRow();
  renderBody();
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouch) {
    inputEl.focus();
  }

  topicPickerEl.onclick = (e) => {
    if (e.target === topicPickerEl) done();
  };
}

function renderContentStep(host) {
  host.innerHTML = `
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Content Type</label>
      <div class="wiz-cards-wrap"></div>
      <div class="wiz-extras" data-extras-field="contentType"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Approach <span class="wiz-optional">(optional)</span></label>
      <div data-field="contentGeneration"></div>
      <div class="wiz-extras" data-extras-field="contentGeneration"></div>
    </div>
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
  populateCardGrid(host.querySelector('.wiz-cards-wrap'), 'contentType');
  populateChipGrid(host.querySelector('[data-field="contentGeneration"]'), 'contentGeneration');
  populateChipGrid(host.querySelector('[data-field="sources"]'), 'sources');
  populateChipGrid(host.querySelector('[data-field="recency"]'), 'recency');
  populateChipGrid(host.querySelector('[data-field="citations"]'), 'citations');
  renderExtraInputs(host.querySelector('[data-extras-field="contentType"]'), 'contentType');
  renderExtraInputs(host.querySelector('[data-extras-field="contentGeneration"]'), 'contentGeneration');
  renderExtraInputs(host.querySelector('[data-extras-field="sources"]'), 'sources');
  renderExtraInputs(host.querySelector('[data-extras-field="recency"]'), 'recency');
}

function renderStyleStep(host) {
  host.innerHTML = `
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Output Format</label>
      <div data-field="format"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Length</label>
      <div data-field="length"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Reading Level</label>
      <div data-field="audience"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Writing Tone</label>
      <div data-field="tone"></div>
    </div>
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
  populateChipGrid(host.querySelector('[data-field="format"]'), 'format');
  populateChipGrid(host.querySelector('[data-field="length"]'), 'length');
  populateChipGrid(host.querySelector('[data-field="audience"]'), 'audience');
  populateChipGrid(host.querySelector('[data-field="tone"]'), 'tone');
  populateChipGrid(host.querySelector('[data-field="geographic"]'), 'geographic');
  const ta = host.querySelector('#wiz-custom');
  ta.addEventListener('input', () => {
    state.customizations = ta.value;
    schedulePreview();
  });
}

function renderReviewStep(host) {
  const prompt = (state.editedPrompt ?? assemblePrompt());
  const tooLong = isUrlTooLong(getModelById(state.modelId) || modelsData[0], prompt);
  const isEditing = state.isEditingPrompt === true;
  host.innerHTML = `
    <div class="wiz-review">
      <div class="wiz-review-section">
        <div class="wiz-review-head">
          <label class="wiz-sub-label">Your Prompt</label>
          <div class="wiz-review-actions">
            <button class="wiz-btn-inline" id="wiz-copy-btn" type="button">📋 Copy</button>
            <button class="wiz-btn-inline" id="wiz-edit-btn" type="button">${isEditing ? '✓ Done' : '✎ Edit'}</button>
          </div>
        </div>
        ${isEditing
          ? `<textarea class="wiz-prompt-edit" id="wiz-prompt-edit">${escapeHTML(prompt)}</textarea>`
          : `<div class="wiz-prompt-box">${escapeHTML(prompt)}</div>`}
        ${state.editedPrompt != null && !isEditing
          ? `<button class="wiz-prompt-reset" id="wiz-prompt-reset" type="button">Reset to generated prompt</button>`
          : ''}
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
    const text = state.isEditingPrompt
      ? host.querySelector('#wiz-prompt-edit').value
      : prompt;
    await navigator.clipboard.writeText(text);
    const btn = host.querySelector('#wiz-copy-btn');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });

  host.querySelector('#wiz-edit-btn').addEventListener('click', () => {
    if (state.isEditingPrompt) {
      // Save edits
      const ta = host.querySelector('#wiz-prompt-edit');
      state.editedPrompt = ta.value;
      state.isEditingPrompt = false;
    } else {
      state.isEditingPrompt = true;
    }
    renderReviewStep(host);
  });

  host.querySelector('#wiz-prompt-reset')?.addEventListener('click', () => {
    state.editedPrompt = null;
    renderReviewStep(host);
  });

  if (isEditing) {
    const ta = host.querySelector('#wiz-prompt-edit');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

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
    const finalPrompt = state.isEditingPrompt
      ? host.querySelector('#wiz-prompt-edit').value
      : prompt;
    await submitPrompt(model, finalPrompt);
  });

  host.querySelector('#wiz-restart').addEventListener('click', () => {
    state.step = 0;
    state.values = {};
    state.customValues = {};
    state.extraInputs = {};
    state.customizations = '';
    state.editedPrompt = null;
    state.isEditingPrompt = false;
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
        ${selected ? `<span class="wiz-card-remove" data-remove="${escapeAttr(opt.value)}" aria-label="Remove">×</span>` : ''}
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
        ${selected ? `<span class="wiz-chip-remove" data-remove="${escapeAttr(opt.value)}" aria-label="Remove">×</span>` : ''}
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

// Shared click handlers — uses EVENT DELEGATION on the host so that
// dynamically-added elements (notably the × remove button that appears
// when an option becomes selected) work without re-attaching listeners
// on every toggle.
//
// CRITICAL: attach only once per host. rerenderField() re-runs populate
// which calls us again; without this guard, each rerender stacked
// another listener and clicks fired N times, causing the "multi-select
// forgets selections" bug.
function attachChipHandlers(host, fieldKey, itemSelector, addSelector, removeSelector) {
  if (host.dataset.handlersAttached === 'true') return;
  host.dataset.handlersAttached = 'true';
  const opts = getOptionsFor(fieldKey);

  // Single delegated listener handles everything.
  host.addEventListener('click', (e) => {
    // Remove (×) click — highest priority, prevents chip toggle.
    const removeBtn = e.target.closest(removeSelector);
    if (removeBtn && host.contains(removeBtn)) {
      e.stopPropagation();
      e.preventDefault();
      removeValue(fieldKey, removeBtn.dataset.remove);
      rerenderField(fieldKey);
      return;
    }
    // Add custom click
    const addBtn = e.target.closest(addSelector);
    if (addBtn && host.contains(addBtn)) {
      e.preventDefault();
      openCustomInput(addBtn, fieldKey);
      return;
    }
    // Regular chip/card click
    const item = e.target.closest(itemSelector);
    if (!item || !host.contains(item)) return;
    if (item.matches(addSelector)) return;
    const value = item.dataset.value;
    if (!value) return;

    const wasSelected = isValueSelected(fieldKey, value);
    toggleValue(fieldKey, value);
    const isCustom = !!state.customValues[fieldKey]?.[value];
    // Custom deselected → purge from customValues; requires full rerender
    if (isCustom && !isValueSelected(fieldKey, value)) {
      delete state.customValues[fieldKey][value];
      rerenderField(fieldKey);
      return;
    }
    const opt = opts.find(o => o.value === value);
    if (opt?.requiresInput) {
      item.classList.toggle('selected', !wasSelected);
      ensureRemoveX(item, value, !wasSelected);
      const extras = document.querySelector(`[data-extras-field="${fieldKey}"]`);
      if (extras) renderExtraInputs(extras, fieldKey);
      schedulePreview();
      updateNextEnabled();
      return;
    }
    item.classList.toggle('selected', !wasSelected);
    ensureRemoveX(item, value, !wasSelected);
    schedulePreview();
    updateNextEnabled();
  });
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
      schedulePreview();
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

// Unified preview + model selection + submit modal
let submitModalEl = null;
function openPromptSubmitModal() {
  if (!submitModalEl) {
    submitModalEl = document.createElement('div');
    submitModalEl.className = 'wiz-submit-overlay';
    document.body.appendChild(submitModalEl);
  }

  const prompt = (state.editedPrompt ?? assemblePrompt()).trim();
  const models = getModels();
  const isEmpty = !prompt;

  submitModalEl.innerHTML = `
    <div class="wiz-submit-card">
      <button type="button" class="wiz-submit-close" id="wiz-submit-close" aria-label="Close">✕</button>

      <div class="wiz-submit-section">
        <div class="wiz-submit-prompt-head">
          <h3 class="wiz-submit-label">Your Prompt</h3>
          <div class="wiz-submit-prompt-actions">
            <button type="button" class="wiz-submit-action-btn" id="wiz-submit-copy">Copy</button>
            <button type="button" class="wiz-submit-action-btn" id="wiz-submit-edit">${state.isEditingPrompt ? 'Done Editing' : 'Edit Prompt'}</button>
          </div>
        </div>
        ${state.isEditingPrompt
          ? `<textarea class="wiz-submit-textarea" id="wiz-submit-textarea">${escapeHTML(prompt)}</textarea>`
          : `<div class="wiz-submit-prompt-text">${isEmpty ? 'No prompt generated yet.' : escapeHTML(prompt)}</div>`
        }
        ${state.editedPrompt != null && !state.isEditingPrompt ? `<button class="wiz-submit-reset" id="wiz-submit-reset">Reset to generated prompt</button>` : ''}
      </div>

      <div class="wiz-submit-section">
        <h3 class="wiz-submit-label">Choose AI Model</h3>
        <div class="wiz-submit-models" id="wiz-submit-models">
          ${models.map(m => `
            <button class="wiz-submit-model ${m.id === state.modelId ? 'is-active' : ''}" type="button" data-model-id="${m.id}">
              ${escapeHTML(m.name)}
            </button>
          `).join('')}
        </div>
      </div>

      <button class="wiz-submit-go" id="wiz-submit-go" type="button" ${isEmpty ? 'disabled' : ''}>${escapeHTML(getSubmitLabel())}</button>
      <p class="wiz-submit-disclaimer">You will be redirected to a third-party AI platform.</p>
    </div>
  `;

  submitModalEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const closeModal = () => {
    submitModalEl.style.display = 'none';
    document.body.style.overflow = '';
  };

  submitModalEl.querySelector('#wiz-submit-close').addEventListener('click', closeModal);
  submitModalEl.addEventListener('click', (e) => { if (e.target === submitModalEl) closeModal(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape' && submitModalEl.style.display !== 'none') {
      closeModal();
      document.removeEventListener('keydown', esc);
    }
  });

  // Copy
  submitModalEl.querySelector('#wiz-submit-copy')?.addEventListener('click', async () => {
    const text = state.isEditingPrompt
      ? submitModalEl.querySelector('#wiz-submit-textarea')?.value
      : (state.editedPrompt ?? prompt);
    await navigator.clipboard.writeText(text);
    const btn = submitModalEl.querySelector('#wiz-submit-copy');
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });

  // Edit toggle
  submitModalEl.querySelector('#wiz-submit-edit')?.addEventListener('click', () => {
    if (state.isEditingPrompt) {
      state.editedPrompt = submitModalEl.querySelector('#wiz-submit-textarea')?.value ?? null;
      state.isEditingPrompt = false;
    } else {
      state.isEditingPrompt = true;
    }
    openPromptSubmitModal(); // re-render modal
  });

  // Reset
  submitModalEl.querySelector('#wiz-submit-reset')?.addEventListener('click', () => {
    state.editedPrompt = null;
    openPromptSubmitModal();
  });

  // Model selection
  submitModalEl.querySelector('#wiz-submit-models')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-model-id]');
    if (!btn) return;
    state.modelId = btn.dataset.modelId;
    setPreferredModelId(state.modelId);
    submitModalEl.querySelectorAll('.wiz-submit-model').forEach(b => {
      b.classList.toggle('is-active', b.dataset.modelId === state.modelId);
    });
    const goBtn = submitModalEl.querySelector('#wiz-submit-go');
    if (goBtn) goBtn.textContent = getSubmitLabel();
  });

  // Submit
  submitModalEl.querySelector('#wiz-submit-go')?.addEventListener('click', async () => {
    const model = getModelById(state.modelId);
    if (!model) return;
    const finalPrompt = state.isEditingPrompt
      ? submitModalEl.querySelector('#wiz-submit-textarea')?.value
      : (state.editedPrompt ?? assemblePrompt());
    await submitPrompt(model, finalPrompt.trim());
    closeModal();
  });
}

function updatePreview() {
  if (state.isEditingPrompt) return;
  const body = document.getElementById('wiz-preview-body');
  if (!body) return;
  const prompt = (state.editedPrompt ?? assemblePrompt()).trim();
  body.textContent = prompt || 'Add a topic to start building your prompt...';
  body.classList.toggle('is-empty', !prompt);

  // Update submit button state
  const submitBtn = document.getElementById('wiz-submit');
  if (submitBtn) {
    submitBtn.disabled = !prompt;
  }

  // Update mobile preview indicator
  const indicator = document.querySelector('.wiz-mobile-preview-indicator');
  if (indicator) indicator.classList.toggle('has-content', !!prompt);
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
  const primaryList = getPrimaryTopics();
  const secondaryList = getSecondaryTopics();
  if (primaryList.length === 0) return '';

  const primaryPhrase = joinList(primaryList);
  const secondaryPhrase = secondaryList.length ? joinList(secondaryList) : '';

  const sub = (text) => {
    let out = text
      .replace(/\{primary_topic\}/g, primaryPhrase)
      .replace(/\{secondary_topic\}/g, secondaryPhrase || primaryPhrase);
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
  const opener = buildOpener(primaryPhrase, sub);

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

  // Secondary topic clause — "compare/relate to X and Y"
  if (secondaryPhrase && pgData.secondaryTopicClause) {
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
function buildOpener(primaryPhrase, sub) {
  const values = getValuesArray('contentType');
  if (values.length === 0) return sub(pgData.baseTemplate);

  if (values.length === 1) {
    const v = values[0];
    const opt = getOptionsFor('contentType').find(o => o.value === v);
    if (opt?.clause) return endWithPeriod(sub(opt.clause));
    const custom = getCustomLabel('contentType', v);
    return custom ? `Provide ${custom} about ${primaryPhrase}.` : sub(pgData.baseTemplate);
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

  return `Provide the following about ${primaryPhrase}:\n` + items.map(s => `• ${s}`).join('\n');
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
