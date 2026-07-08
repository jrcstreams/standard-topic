// Knowledge Prompt Generator — guided wizard mode.
// Multi-step flow with cards, chips, and a final review/submit screen.
//
// Supports per-field flags in prompt-generator.json:
//   multiSelect: true   → users can select multiple values
//   allowCustom: true   → users can add custom string values
//   options[].requiresInput → when this option is selected, asks the
//                              user for an extra value substituted into
//                              the option's clause via {key} placeholder

import { getPromptGenData, getModels, getDefaultModelId, getModelById, getParentTopics, getFeaturedTopics, getAllTopics, searchTopics, getSubmissionMethods, getTopicsGroupedByParent } from '../utils/data.js';
import { getPreferredModelId, setPreferredModelId, submitPrompt, isUrlTooLong, shouldCopyOnOpen } from '../utils/ai-models.js';
import { topicIconSVG } from '../utils/topic-icons.js';
import { track } from '../utils/analytics.js';

const state = {
  step: 0,
  values: {},          // { fieldKey: 'value' (single) or ['v1','v2'] (multi) }
  customValues: {},    // { fieldKey: { 'c<id>': 'custom string' } }
  extraInputs: {},     // { 'requiresInputKey': 'value' } (e.g. compare_to)
  modelId: null,
  customizations: '',
  visited: new Set(), // Step indices the user has visited
};

// Snapshot / restore for the Cancel button in picker modals. Modals
// mutate `state` live as the user clicks options, so "Done" requires
// no commit step — but "Cancel" needs to revert what was added/removed
// during the modal session. Snapshot is captured on open; restore
// (via Cancel) puts state back to that baseline.
function snapshotState() {
  return {
    values: JSON.parse(JSON.stringify(state.values || {})),
    customValues: JSON.parse(JSON.stringify(state.customValues || {})),
    extraInputs: JSON.parse(JSON.stringify(state.extraInputs || {})),
    customizations: state.customizations || '',
  };
}
function restoreState(snap) {
  if (!snap) return;
  state.values = JSON.parse(JSON.stringify(snap.values));
  state.customValues = JSON.parse(JSON.stringify(snap.customValues));
  state.extraInputs = JSON.parse(JSON.stringify(snap.extraInputs));
  state.customizations = snap.customizations;
}

let pgData = null;
let modelsData = null;
let stepDefs = [];
let containerEl = null;

// ── Inline (dropdown) mode ───────────────────────────────────────────────────
// When the builder is mounted inside the Prompts nav dropdown, its picker + submit
// steps render as in-panel "buffer" views (a back-button stack) INSTEAD of the
// centered, body-level modal overlays used on the full-page builder — so the whole
// flow stays inside the dropdown. `pbInlineHost` is the dropdown host element;
// `pbInlineStack` holds the view renderers, with [0] = the card grid (render()).
let pbInlineHost = null;
let pbInlineStack = [];
const PB_BACK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';

function pbInlineGo(renderFn) { pbInlineStack.push(renderFn); renderFn(); }
function pbInlineBack() {
  if (pbInlineStack.length > 1) pbInlineStack.pop();
  const top = pbInlineStack[pbInlineStack.length - 1];
  if (top) top();
}
// Render the shared buffer chrome (Back + title + body + optional Cancel/Done
// footer) into the inline host; returns the body element to fill. `onCancel`
// runs on Back/Cancel (before popping); `onDone` runs on Done (before popping).
function pbInlineChrome({ title, footer = true, doneLabel = 'Done', onDone, onCancel }) {
  pbInlineHost.innerHTML = `
    <div class="pb-inline-view">
      <button type="button" class="prompts-back pb-inline-back" data-pb-back>${PB_BACK_SVG}<span>Back</span></button>
      ${title ? `<h2 class="pb-inline-title">${escapeHTML(title)}</h2>` : ''}
      <div class="pb-inline-body" data-pb-body></div>
      ${footer ? `<div class="pb-inline-foot">
        <button type="button" class="pb-inline-ghost" data-pb-cancel>Cancel</button>
        <button type="button" class="pb-inline-cta" data-pb-done>${escapeHTML(doneLabel)}</button>
      </div>` : ''}
    </div>`;
  const back = () => { if (onCancel) onCancel(); pbInlineBack(); };
  pbInlineHost.querySelector('[data-pb-back]').addEventListener('click', back);
  pbInlineHost.querySelector('[data-pb-cancel]')?.addEventListener('click', back);
  pbInlineHost.querySelector('[data-pb-done]')?.addEventListener('click', () => { if (onDone) onDone(); pbInlineBack(); });
  return pbInlineHost.querySelector('[data-pb-body]');
}

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

export function renderPromptGenerator(container, opts = {}) {
  pgData = getPromptGenData();
  modelsData = getModels();
  containerEl = container;

  // Inline (dropdown) mode: pickers + submit render as in-panel buffer views.
  pbInlineHost = opts.inline ? container : null;
  pbInlineStack = opts.inline ? [render] : [];
  submitInlineEl = null;   // drop any stale inline submit target from a prior mount
  if (pbInlineHost) container.classList.add('pb-inline');

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

// Lucide-style inline SVG icons for the Output Type option cards.
// Stroke-only, currentColor — picks up the navy in .wiz-card-icon.
const cardIcons = {
  'overview':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="7" y="3" width="10" height="18" rx="1.5"/>' +
      '<line x1="10" y1="8" x2="14" y2="8"/>' +
      '<line x1="10" y1="12" x2="14" y2="12"/>' +
      '<line x1="10" y1="16" x2="13" y2="16"/>' +
    '</svg>',
  'research-summary':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<line x1="4" y1="20" x2="20" y2="20"/>' +
      '<rect x="5" y="11" width="3" height="9"/>' +
      '<rect x="10.5" y="6" width="3" height="14"/>' +
      '<rect x="16" y="14" width="3" height="6"/>' +
    '</svg>',
  'explainer':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M9 18h6"/>' +
      '<path d="M10 22h4"/>' +
      '<path d="M15.09 14A6 6 0 1 0 8.91 14a4 4 0 0 1 1.41 2.39h3.36A4 4 0 0 1 15.09 14z"/>' +
    '</svg>',
  'comparison':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3" y="5" width="7" height="14" rx="1"/>' +
      '<rect x="14" y="5" width="7" height="14" rx="1"/>' +
      '<line x1="10" y1="12" x2="14" y2="12"/>' +
    '</svg>',
  'timeline':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<line x1="3" y1="12" x2="21" y2="12"/>' +
      '<circle cx="7" cy="12" r="2"/>' +
      '<circle cx="12" cy="12" r="2"/>' +
      '<circle cx="17" cy="12" r="2"/>' +
    '</svg>',
  'case-study':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="11" cy="11" r="6"/>' +
      '<line x1="21" y1="21" x2="15.65" y2="15.65"/>' +
    '</svg>',
  'analysis':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<polyline points="3 17 9 11 13 15 21 7"/>' +
      '<polyline points="14 7 21 7 21 14"/>' +
    '</svg>',
  'forecast':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<polyline points="3 12 8 7 12 11 21 4"/>' +
      '<polyline points="14 4 21 4 21 11"/>' +
    '</svg>',
};
// Fallback for unmapped option values — a neutral bullet shape so
// no emoji ever leaks through.
const CARD_ICON_FALLBACK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="3" fill="currentColor"/>' +
  '</svg>';
const CARD_ICON_CUSTOM =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 20h9"/>' +
    '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>' +
  '</svg>';
const CARD_ICON_PLUS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<line x1="12" y1="5" x2="12" y2="19"/>' +
    '<line x1="5" y1="12" x2="19" y2="12"/>' +
  '</svg>';

// ---------- Helpers: field metadata + state ----------

function getField(fieldKey) {
  return pgData.fields.find(f => f.key === fieldKey);
}
function getOptionsFor(fieldKey) {
  return getField(fieldKey)?.options || [];
}
function getFieldDescription(fieldKey) {
  return getField(fieldKey)?.description || '';
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
    updateActionBar();
  });
}

// Update the sticky action bar (Submit + Clear) to reflect current state.
// Called on every state mutation so the buttons track reality without
// requiring a full re-render.
function updateActionBar() {
  const submitBtn = document.getElementById('wiz-open-preview');
  const clearBtn = document.getElementById('wiz-restart');
  if (!submitBtn || !clearBtn) return;
  const prompt = assemblePrompt();
  const isEmpty = !prompt;
  const isPristine = Object.keys(state.values || {}).length === 0
    && !state.customizations
    && Object.keys(state.customValues || {}).length === 0
    && Object.keys(state.extraInputs || {}).length === 0
    && !state.editedPrompt;
  // Always "Submit Prompt" + enabled — a missing primary topic is caught on click
  // with a clean modal, rather than a disabled/renamed button (#img364/365).
  submitBtn.disabled = false;
  submitBtn.classList.remove('is-empty');
  submitBtn.classList.add('is-ready');
  const labelEl = submitBtn.querySelector('span');
  if (labelEl) labelEl.textContent = 'Submit Prompt';
  clearBtn.disabled = isPristine;
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

// ---------- Card grid (main builder view) ----------
//
// Replaces the long flat form with a grid of summary cards. Each
// card represents a group of related fields. Clicking a card opens
// a modal containing the relevant pickers (or, for Topics, defers
// to the existing openTopicPicker flow).

// Inline Lucide-style SVG icons. Stroke-only, currentColor — picks
// up the navy in .pb-card-icon. Sized 22x22 via the wrapper.
const PB_ICONS = {
  topics:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' +
    '</svg>',
  output:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<line x1="4" y1="6"  x2="20" y2="6"/>' +
      '<line x1="4" y1="12" x2="14" y2="12"/>' +
      '<line x1="4" y1="18" x2="18" y2="18"/>' +
    '</svg>',
  sources:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>' +
      '<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' +
    '</svg>',
  scope:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="10"/>' +
      '<line x1="2" y1="12" x2="22" y2="12"/>' +
      '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>' +
    '</svg>',
  custom:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 20h9"/>' +
      '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>' +
    '</svg>',
};

const PB_CARDS = [
  { key: 'topics',  label: 'Topics',
    desc: 'What this prompt should focus on.',
    fields: ['primaryTopic', 'secondaryTopic'], required: true },
  { key: 'output',  label: 'Output Style',
    desc: 'Type, format, length, and tone.',
    fields: ['outputType', 'format', 'length', 'audience', 'tone'] },
  { key: 'sources', label: 'Sources & Citations',
    desc: 'References and how to cite them.',
    fields: ['sources', 'citations'] },
  { key: 'scope',   label: 'Scope',
    desc: 'Time window and geographic focus.',
    fields: ['recency', 'geographic'] },
  { key: 'custom',  label: 'Custom Instructions',
    desc: 'Framing, exclusions, extra detail.',
    fields: ['customizations'] },
];

function pbOptionLabel(fieldKey, valueKey) {
  const field = pgData.fields?.find(f => f.key === fieldKey);
  if (!field?.options) return valueKey;
  const opt = field.options.find(o => (o.value || o.id) === valueKey);
  return opt?.label || valueKey;
}

function pbCardSummaryItems(card) {
  const items = [];
  for (const f of card.fields) {
    if (f === 'primaryTopic') {
      getPrimaryTopics().forEach(t => items.push(t));
    } else if (f === 'secondaryTopic') {
      getSecondaryTopics().forEach(t => items.push(t));
    } else if (f === 'customizations') {
      if (state.customizations) {
        const t = state.customizations.trim();
        items.push(t.length > 60 ? t.slice(0, 60) + '…' : t);
      }
    } else {
      const vals = state.values?.[f];
      if (Array.isArray(vals)) {
        vals.forEach(v => items.push(pbOptionLabel(f, v)));
      } else if (vals) {
        items.push(pbOptionLabel(f, vals));
      }
    }
  }
  return items;
}

function renderPbCardsHTML() {
  return PB_CARDS.map(card => {
    const items = pbCardSummaryItems(card);
    const summaryHTML = items.length
      ? `<div class="pb-card-summary">${
          items.slice(0, 5).map(s => `<span class="pb-card-chip">${escapeHTML(s)}</span>`).join('') +
          (items.length > 5 ? `<span class="pb-card-more">+${items.length - 5} more</span>` : '')
        }</div>`
      : '';
    // The trailing action chip replaces both the old ">" arrow and
    // the separate "+ Add" CTA — one element doing both jobs in the
    // space the chevron used to waste. Label flips between "Add +"
    // (empty card) and "Edit" (has selections).
    const actionLabel = items.length ? 'Edit' : 'Add +';
    return `
      <button type="button" class="pb-card${items.length ? ' has-items' : ''}" data-pb-card="${card.key}">
        <div class="pb-card-head">
          <span class="pb-card-icon" aria-hidden="true">${PB_ICONS[card.key] || ''}</span>
          <span class="pb-card-title">${escapeHTML(card.label)}</span>
          ${card.required ? '<span class="pb-card-req">Required</span>' : ''}
          <span class="pb-card-action" aria-hidden="true">${actionLabel}</span>
        </div>
        <p class="pb-card-desc">${escapeHTML(card.desc)}</p>
        ${summaryHTML}
      </button>
    `;
  }).join('');
}

function refreshPbCards() {
  const grid = document.getElementById('pb-card-grid');
  if (grid) grid.innerHTML = renderPbCardsHTML();
  // Re-bind clicks (innerHTML wipes them).
  document.querySelectorAll('.pb-card').forEach(card => {
    card.addEventListener('click', () => openPbCardModal(card.dataset.pbCard));
  });
  updatePreview();
  // CRITICAL: the bottom action bar lives on the main wiz panel and
  // is keyed off assemblePrompt(). Without this, picking a topic
  // updates the card chip but leaves the submit button stuck in its
  // "Add Topic(s) to Submit / disabled" state.
  updateActionBar();
}

function openPbCardModal(key) {
  const card = PB_CARDS.find(c => c.key === key);
  if (!card) return;

  // Inline (dropdown) mode: render the card config as an in-panel buffer view.
  // Snapshot ONCE here (not per re-render) so Cancel reverts everything done in
  // this card session — including changes made in a nested picker.
  if (pbInlineHost) { const snap = snapshotState(); return pbInlineGo(() => renderCardBuffer(card, snap)); }

  // Build the buffer-modal overlay for every card. Different bodies
  // for different cards: topics uses its own chip-list sections that
  // delegate to the existing topic-picker overlay; other cards
  // embed the standard chip/card field pickers; custom is a textarea.
  const overlay = document.createElement('div');
  overlay.className = 'pb-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', card.label);
  document.body.appendChild(overlay);
  overlay.innerHTML = `
    <div class="pb-modal-card">
      <header class="pb-modal-head">
        <button type="button" class="pb-modal-close" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18"/>
            <line x1="18" y1="6" x2="6" y2="18"/>
          </svg>
        </button>
        <h2 class="pb-modal-title">${escapeHTML(card.label)}</h2>
      </header>
      <div class="pb-modal-body" id="pb-modal-body"></div>
      <footer class="pb-modal-foot">
        <button type="button" class="pb-modal-cancel">Cancel</button>
        <button type="button" class="pb-modal-done">Done</button>
      </footer>
    </div>
  `;
  const body = overlay.querySelector('#pb-modal-body');

  // Snapshot state on open so Cancel can revert. The user may toggle
  // chips, edit the textarea, etc. — all of which mutate `state`
  // immediately. Without a snapshot, Cancel has nothing to roll back
  // to and silently behaves identically to Done.
  const snap = snapshotState();
  const close = () => {
    overlay.remove();
    refreshPbCards();
  };
  const cancel = () => {
    restoreState(snap);
    close();
  };
  overlay.querySelector('.pb-modal-close').addEventListener('click', cancel);
  overlay.querySelector('.pb-modal-done').addEventListener('click', close);
  overlay.querySelector('.pb-modal-cancel').addEventListener('click', cancel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cancel(); });

  fillPbCardBody(card, body);
}

// Shared per-card body population, used by both the overlay modal (full page) and
// the inline buffer view (dropdown). Fills `body` with the card's picker fields.
function fillPbCardBody(card, body) {
  const key = card.key;
  if (key === 'topics') {
    renderTopicsModalBody(body);
    return;
  }

  if (key === 'custom') {
    body.innerHTML = `
      <p class="pb-modal-desc">Add any extra instructions — specific framing, exclusions, or detail you'd like the AI to focus on.</p>
      <textarea class="pb-modal-textarea" placeholder="Anything else to add..." id="pb-modal-custom">${escapeHTML(state.customizations || '')}</textarea>
    `;
    body.querySelector('#pb-modal-custom').addEventListener('input', (e) => {
      state.customizations = e.target.value;
    });
    return;
  }

  // Generic field modal (output / sources / scope)
  body.innerHTML = card.fields.map(f => `
    <section class="pb-modal-section">
      <h3 class="pb-modal-section-title">${escapeHTML(getFieldLabel(f))}</h3>
      <p class="pb-modal-section-desc">${escapeHTML(getFieldDescription(f))}</p>
      <div data-field="${f}"></div>
      <div class="wiz-extras" data-extras-field="${f}"></div>
    </section>
  `).join('');
  card.fields.forEach(f => {
    const host = body.querySelector(`[data-field="${f}"]`);
    if (!host) return;
    // Output Type used a big box-grid; now uses the same "+ Select" bar + dropdown
    // as Format/Length/etc. for a consistent, compact card (#img348/351/352).
    populateChipGrid(host, f);
    const extras = body.querySelector(`[data-extras-field="${f}"]`);
    if (extras) renderExtraInputs(extras, f);
  });
}

// Inline card config buffer (dropdown mode): the same fields as the overlay modal,
// rendered as an in-panel view with Back/Cancel (revert) and Done (keep). Both
// return to the card grid via the buffer stack.
function renderCardBuffer(card, snap) {
  const body = pbInlineChrome({
    title: card.label,
    onCancel: () => restoreState(snap),
    onDone: () => {},
  });
  fillPbCardBody(card, body);
}

// Topics card buffer modal — two sections (Primary + Secondary)
// with current selections as removable chips, each section's
// "Browse Topics" CTA opening the existing topic-picker overlay
// (which carries the same accordion-style topic browser the rest
// of the site uses).
function renderTopicsModalBody(body) {
  const re = () => renderTopicsModalBody(body);
  // Same "+ Select" bar + dropdown pattern as the Output Style fields — chips for
  // what's picked, "+ Select"/"+ Add more" opens the accordion topic picker inline.
  // No subtexts under the headers (#img341/343/344/349/350).
  const sectionHTML = (titleHTML, items, keyClass) => `
    <section class="pb-modal-section">
      <h3 class="pb-modal-section-title">${titleHTML}</h3>
      <div class="wiz-topic-chips" data-pb-topic-key="${keyClass}" id="pb-topicbar-${keyClass}">
        ${items.map(t => `
          <span class="wiz-inline-chip" data-remove="${escapeAttr(t)}">
            ${escapeHTML(t)}
            <button type="button" class="wiz-inline-chip-x" aria-label="Remove">×</button>
          </span>
        `).join('')}
        <button type="button" class="wiz-topic-add-inline" data-browse="${keyClass}">${items.length ? '+ Add more' : '+ Select'}</button>
      </div>
    </section>
  `;
  body.innerHTML = `
    ${sectionHTML('Primary Topic(s) <span class="pb-req-tag">Required</span>', getPrimaryTopics(), 'primaryTopic')}
    ${sectionHTML('Secondary Topic(s) <span class="pb-optional-tag">Optional</span>', getSecondaryTopics(), 'secondaryTopic')}
  `;
  // Chip remove (× on each selected chip).
  body.querySelectorAll('.wiz-inline-chip-x').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const chip = btn.closest('.wiz-inline-chip');
      const key = chip.closest('.wiz-topic-chips').dataset.pbTopicKey;
      removeTopic(key, chip.dataset.remove);
      re();
    });
  });
  // Open the accordion picker on bar / "+ Select" click. Inside an expanded card
  // it drops INLINE beneath the bar (nested); otherwise the overlay picker.
  const inCard = !!(pbInlineHost && containerEl && containerEl.querySelector('.pb-card.is-expanded'));
  const openFor = (key) => {
    const initial = key === 'primaryTopic' ? getPrimaryTopics() : getSecondaryTopics();
    const label = key === 'primaryTopic' ? 'Add Primary Topics' : 'Add Secondary Topics';
    const apply = (values) => {
      state.values[key] = values;
      if (values.length === 0) delete state.values[key];
      re();
    };
    if (inCard) {
      const section = body.querySelector(`#pb-topicbar-${key}`).closest('.pb-modal-section');
      const existing = section.querySelector('.pb-nested-picker');
      body.querySelectorAll('.pb-nested-picker').forEach((n) => n.remove());
      if (existing) return;
      const nested = document.createElement('div');
      nested.className = 'pb-nested-picker';
      section.appendChild(nested);
      openAccordionTopicPicker(label, initial, apply, { container: nested, onClose: () => re() });
      requestAnimationFrame(() => { try { nested.scrollIntoView({ block: 'nearest' }); } catch (_) {} });
    } else {
      openAccordionTopicPicker(label, initial, apply);
    }
  };
  body.querySelectorAll('.wiz-topic-chips').forEach(bar => {
    bar.addEventListener('click', (e) => {
      if (e.target.closest('.wiz-inline-chip-x')) return;
      openFor(bar.dataset.pbTopicKey);
    });
  });
}

// Inline checkbox indicator used in the accordion picker — sits where
// the bullet/dot used to be. Empty box when unchecked, navy filled
// box with white check SVG when checked. Fixed size both states so
// the row width never shifts on toggle.
const ACC_CHECK_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
function accCheckHTML(isChecked) {
  return `<span class="pb-acc-check ${isChecked ? 'is-checked' : ''}" aria-hidden="true">${isChecked ? ACC_CHECK_SVG : ''}</span>`;
}

// Accordion-card topic picker that matches the site's Topics modal:
// parent topics render as bordered cards with icon + name + chevron;
// the entire head row expands the card (no auto-select on tap). Inside
// the expanded body, the parent topic itself appears as the first
// selectable row, followed by its subtopics. Search input filters to
// matching topics + a "type your own" option. Done returns selected.
//
// Outer scaffolding (overlay, header, search input, footer) is built
// ONCE on open. Only `.pb-acc-content` re-renders on input/select/
// expand, keeping the search input stable and avoiding the mobile
// focus-jump flash that hits whenever the soft keyboard tries to
// reflow after a node swap.
let accordionPickerEl = null;
function openAccordionTopicPicker(label, initialSelected, onConfirm, opts) {
  // Three mounts: opts.container = render INLINE into that element (nested picker
  // inside an expanded card, #img49); pbInlineHost = a buffer view; else overlay.
  const nestedEl = opts && opts.container;
  const inline = !nestedEl && !!pbInlineHost;

  if (!inline && !nestedEl && accordionPickerEl) { accordionPickerEl.remove(); accordionPickerEl = null; }

  const selected = new Set(initialSelected || []);
  let expandedSlug = null;
  let query = '';
  // Assigned per mount (inline buffer vs overlay) below.
  let contentEl, bodyEl, searchInput;

  const close = () => {
    if (nestedEl) { if (opts && opts.onClose) opts.onClose(); return; }
    if (inline) { pbInlineBack(); return; }
    accordionPickerEl?.remove(); accordionPickerEl = null;
  };
  const confirm = () => {
    onConfirm(Array.from(selected));
    close();
  };
  const toggle = (name) => {
    const t = (name || '').trim();
    if (!t) return;
    if (selected.has(t)) selected.delete(t);
    else selected.add(t);
    renderContent();
  };

  function renderSelectedRow() {
    if (selected.size === 0) return '';
    return `
      <div class="pb-acc-selected">
        ${Array.from(selected).map(t => `
          <span class="pb-acc-selchip" data-acc-remove="${escapeAttr(t)}">
            ${escapeHTML(t)}
            <button type="button" class="pb-acc-selchip-x" aria-label="Remove">×</button>
          </span>
        `).join('')}
      </div>
    `;
  }

  function renderBrowse() {
    const groups = getTopicsGroupedByParent();
    return `
      <div class="pb-modal-section-desc" style="margin-bottom: 0.6rem;">Tap a topic to expand it, then pick the parent or any subtopic.</div>
      <div class="pb-acc-list">
        ${groups.map(g => {
          const isOpen = expandedSlug === g.parent.slug;
          const parentSel = selected.has(g.parent.name);
          return `
            <div class="pb-acc-card ${isOpen ? 'is-open' : ''}${parentSel ? ' is-selected' : ''}">
              <button type="button" class="pb-acc-head" data-acc-expand="${g.parent.slug}" aria-expanded="${isOpen ? 'true' : 'false'}">
                <span class="pb-acc-icon">${topicIconSVG(g.parent.icon || 'globe', '')}</span>
                <span class="pb-acc-name">${escapeHTML(g.parent.name)}</span>
                ${parentSel ? `<span class="pb-acc-tick" aria-hidden="true">✓</span>` : ''}
                <span class="pb-acc-chev" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 4.5 6 7.5 9 4.5"/></svg>
                </span>
              </button>
              <div class="pb-acc-body">
                <button type="button" class="pb-acc-sub pb-acc-sub-parent ${parentSel ? 'is-selected' : ''}"
                        data-acc-toggle="${escapeAttr(g.parent.name)}">
                  ${accCheckHTML(parentSel)}
                  <span class="pb-acc-sub-name"><strong>${escapeHTML(g.parent.name)}</strong> <em class="pb-acc-sub-hint">(parent topic)</em></span>
                </button>
                ${g.subtopics.length ? `
                  <ul class="pb-acc-sublist">
                    ${g.subtopics.map(sub => {
                      const isSel = selected.has(sub.name);
                      return `
                        <li>
                          <button type="button" class="pb-acc-sub ${isSel ? 'is-selected' : ''}"
                                  data-acc-toggle="${escapeAttr(sub.name)}">
                            ${accCheckHTML(isSel)}
                            <span class="pb-acc-sub-name">${escapeHTML(sub.name)}</span>
                          </button>
                        </li>
                      `;
                    }).join('')}
                  </ul>
                ` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderSearchResults(q) {
    const matches = searchTopics(q);
    const queryTrim = q.trim();
    const customSel = selected.has(queryTrim);
    return `
      <div class="pb-acc-results">
        <button type="button" class="pb-acc-custom" data-acc-toggle="${escapeAttr(queryTrim)}">
          <span class="pb-acc-custom-plus">${customSel ? '✓' : '+'}</span>
          <span>${customSel ? 'Added' : 'Add'} "<strong>${escapeHTML(queryTrim)}</strong>" as a custom topic</span>
        </button>
        ${matches.map(m => {
          const isSel = selected.has(m.name);
          return `
            <button type="button" class="pb-acc-result ${isSel ? 'is-selected' : ''}" data-acc-toggle="${escapeAttr(m.name)}">
              ${accCheckHTML(isSel)}
              <span class="pb-acc-result-name">${escapeHTML(m.name)}</span>
              ${m.parentName ? `<span class="pb-acc-result-parent">in ${escapeHTML(m.parentName)}</span>` : ''}
            </button>
          `;
        }).join('')}
        ${matches.length === 0 ? `<p class="pb-acc-empty">No matching topics — try adding it as a custom topic.</p>` : ''}
      </div>
    `;
  }

  // Search-bar + content shell, shared by the overlay (full page) and the inline
  // buffer (dropdown). Only `.pb-acc-content` is rewritten on each render so the
  // search input keeps focus and the mobile soft-keyboard stays put.
  const ACC_INNER = `
    <div class="pb-acc-search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="search" class="pb-acc-search-input" placeholder="Search a topic or type your own..." autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    </div>
    <div class="pb-acc-content"></div>`;

  function renderContent() {
    // Preserve scroll position across re-renders so toggling an item
    // doesn't bounce the user up to where the selected-chip strip
    // grew (and out from under their finger).
    const scrollY = bodyEl.scrollTop;
    contentEl.innerHTML = renderSelectedRow() + (query.trim() ? renderSearchResults(query) : renderBrowse());
    bodyEl.scrollTop = scrollY;
    bindContentEvents();
  }

  function bindContentEvents() {
    contentEl.querySelectorAll('[data-acc-toggle]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle(btn.dataset.accToggle);
      });
    });
    contentEl.querySelectorAll('[data-acc-expand]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const slug = btn.dataset.accExpand;
        expandedSlug = (expandedSlug === slug) ? null : slug;
        renderContent();
      });
    });
    contentEl.querySelectorAll('[data-acc-remove]').forEach(chip => {
      chip.querySelector('.pb-acc-selchip-x')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle(chip.dataset.accRemove);
      });
    });
  }

  // Mount the picker — either as a body-level overlay (full page) or as an
  // in-panel buffer view inside the dropdown (inline). Both share ACC_INNER +
  // renderContent; only the surrounding chrome + wiring differ.
  function mountAndWire() {
    if (nestedEl) {
      // Nested inline picker inside an expanded card — no chrome, live Done/Close.
      nestedEl.classList.add('pb-accordion-body', 'pb-nested-body');
      nestedEl.innerHTML = `${ACC_INNER}<div class="pb-nested-foot"><button type="button" class="pb-nested-done">Done</button></div>`;
      bodyEl = nestedEl;
      nestedEl.querySelector('.pb-nested-done').addEventListener('click', confirm);
    } else if (inline) {
      const body = pbInlineChrome({
        title: label, doneLabel: 'Done',
        onDone: () => onConfirm(Array.from(selected)),
        onCancel: () => {},
      });
      body.classList.add('pb-accordion-body');
      body.innerHTML = ACC_INNER;
      bodyEl = body;
    } else {
      accordionPickerEl = document.createElement('div');
      accordionPickerEl.className = 'pb-modal-overlay pb-accordion-overlay';
      document.body.appendChild(accordionPickerEl);
      accordionPickerEl.innerHTML = `
        <div class="pb-modal-card pb-accordion-card">
          <header class="pb-modal-head">
            <button type="button" class="pb-modal-close" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18"/>
                <line x1="18" y1="6" x2="6" y2="18"/>
              </svg>
            </button>
            <h2 class="pb-modal-title">${escapeHTML(label)}</h2>
          </header>
          <div class="pb-modal-body pb-accordion-body">${ACC_INNER}</div>
          <footer class="pb-modal-foot">
            <button type="button" class="pb-modal-cancel">Cancel</button>
            <button type="button" class="pb-modal-done">Done</button>
          </footer>
        </div>`;
      bodyEl = accordionPickerEl.querySelector('.pb-modal-body');
      accordionPickerEl.querySelector('.pb-modal-close').addEventListener('click', close);
      accordionPickerEl.querySelector('.pb-modal-done').addEventListener('click', confirm);
      accordionPickerEl.querySelector('.pb-modal-cancel').addEventListener('click', close);
      accordionPickerEl.addEventListener('click', (e) => { if (e.target === accordionPickerEl) close(); });
    }
    contentEl = bodyEl.querySelector('.pb-acc-content');
    searchInput = bodyEl.querySelector('.pb-acc-search-input');
    searchInput.addEventListener('input', (e) => {
      query = e.target.value;
      renderContent();
    });
    // Enter adds the current query as a custom topic (no need to
    // hunt for the "+ Add as custom" CTA).
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const t = (query || '').trim();
        if (!t) return;
        if (!selected.has(t)) selected.add(t);
        query = '';
        searchInput.value = '';
        renderContent();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    renderContent();
  }

  // Nested: render in place. Inline: push onto the buffer stack. Overlay: mount over the page.
  if (nestedEl) mountAndWire();
  else if (inline) pbInlineGo(mountAndWire);
  else mountAndWire();
}

function getFieldLabel(fieldKey) {
  const field = pgData.fields?.find(f => f.key === fieldKey);
  return field?.label || fieldKey;
}

// ── Inline card accordion (dropdown builder) ─────────────────────────────────
// A card expands IN PLACE (accordion) to reveal its picker — no view swap — with
// a sticky Done/Cancel always in view. Only one card open at a time.
function collapsePbCard() {
  if (!containerEl) return;
  containerEl.querySelectorAll('.pb-card.is-expanded').forEach((el) => {
    el.classList.remove('is-expanded');
    el.querySelector('.pb-card-config')?.remove();
  });
}
function expandPbCard(cardEl, key) {
  const card = PB_CARDS.find((c) => c.key === key);
  if (!card) return;
  collapsePbCard();
  const snap = snapshotState();
  cardEl.classList.add('is-expanded');
  const cfg = document.createElement('div');
  cfg.className = 'pb-card-config';
  cfg.innerHTML = `
    <div class="pb-card-config-body" data-cfg-body></div>
    <div class="pb-card-config-foot">
      <button type="button" class="pb-cfg-ghost" data-cfg-cancel>Cancel</button>
      <button type="button" class="pb-cfg-cta" data-cfg-done>Done</button>
    </div>`;
  cardEl.appendChild(cfg);
  // Clicks inside the config must NOT bubble to the card head (which toggles).
  cfg.addEventListener('click', (e) => e.stopPropagation());
  fillPbCardBody(card, cfg.querySelector('[data-cfg-body]'));
  cfg.querySelector('[data-cfg-cancel]').addEventListener('click', () => { restoreState(snap); collapsePbCard(); refreshPbCards(); updatePreview(); updateActionBar(); });
  cfg.querySelector('[data-cfg-done]').addEventListener('click', () => { collapsePbCard(); refreshPbCards(); updatePreview(); updateActionBar(); });
  requestAnimationFrame(() => { try { cfg.scrollIntoView({ block: 'nearest' }); } catch (_) {} });
}
function togglePbCardInline(cardEl, key) {
  if (cardEl.classList.contains('is-expanded')) collapsePbCard();
  else expandPbCard(cardEl, key);
}

function render() {
  const prompt = assemblePrompt();
  const isEmpty = !prompt;
  const isPristine = Object.keys(state.values || {}).length === 0
    && !state.customizations
    && Object.keys(state.customValues || {}).length === 0
    && Object.keys(state.extraInputs || {}).length === 0
    && !state.editedPrompt;
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
          <p class="wiz-intro-text">Build knowledge prompts that strategically curate content and deliver clear, high-impact answers. Pick your topics, shape the output, then send straight to your preferred AI model.</p>
        </div>

        <div class="pb-card-grid" id="pb-card-grid">${renderPbCardsHTML()}</div>
      </div>

      <div class="wiz-action-bar">
        <div class="wiz-action-bar-inner">
          <button type="button" class="wiz-action-btn is-ready" id="wiz-open-preview">
            <span>Submit Prompt</span>
          </button>
          <button type="button" class="wiz-action-restart" id="wiz-restart" ${isPristine ? 'disabled' : ''}>Clear Prompt</button>
        </div>
      </div>
      <div class="wiz-action-bar-spacer"></div>
    </div>
  `;

  // Card grid click handlers — inline (dropdown) mode expands the card in place
  // as an accordion; full-page mode opens the picker modal.
  containerEl.querySelectorAll('.pb-card').forEach(card => {
    card.addEventListener('click', () => {
      if (pbInlineHost) togglePbCardInline(card, card.dataset.pbCard);
      else openPbCardModal(card.dataset.pbCard);
    });
  });

  // Open the unified preview+submit modal — but a primary topic is required first.
  document.getElementById('wiz-open-preview')?.addEventListener('click', () => {
    if (getPrimaryTopics().length === 0) { openPrimaryRequiredModal(); return; }
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

  // Inline (dropdown) mode: the action bar sits in normal flow at the bottom of
  // the dropdown content — skip the viewport-fixed placement + footer-dodge that
  // only make sense on the full-page builder.
  if (pbInlineHost) return;

  // Bump action bar up when footer scrolls into view
  setupFooterDodge();

  // Toggle the action bar between sticky-fixed (when content
  // overflows the viewport) and inline (when everything fits on
  // screen, so the bar can sit naturally below the card grid).
  setupActionBarPlacement();
}

let actionBarResizeHandler = null;
let actionBarLastWidth = null;
function setupActionBarPlacement() {
  const measure = () => {
    const panel = document.querySelector('.wiz-two-panel');
    const cardGrid = document.getElementById('pb-card-grid');
    if (!panel || !cardGrid) return;
    const gridBottom = cardGrid.getBoundingClientRect().bottom;
    const viewportH = window.innerHeight;
    const barReserve = 100;
    const fits = gridBottom + barReserve <= viewportH;
    document.body.classList.toggle('pb-action-bar-inline', fits);
  };
  if (actionBarResizeHandler) {
    window.removeEventListener('resize', actionBarResizeHandler);
  }
  actionBarLastWidth = window.innerWidth;
  // Only re-measure on actual VIEWPORT WIDTH changes — not height.
  // On mobile the soft keyboard appearing fires resize with a
  // shorter height, and we don't want the action bar to ping-pong
  // between inline/sticky mid-typing (which was breaking the page
  // layout for the user).
  actionBarResizeHandler = () => {
    if (window.innerWidth === actionBarLastWidth) return;
    actionBarLastWidth = window.innerWidth;
    requestAnimationFrame(measure);
  };
  window.addEventListener('resize', actionBarResizeHandler, { passive: true });
  requestAnimationFrame(measure);
  setTimeout(measure, 250);
}

let footerDodgeHandler = null;
function setupFooterDodge() {
  if (footerDodgeHandler) window.removeEventListener('scroll', footerDodgeHandler);
  const actionBar = document.querySelector('.wiz-action-bar');
  const footer = document.getElementById('site-footer');
  if (!actionBar || !footer) return;

  footerDodgeHandler = () => {
    const footerRect = footer.getBoundingClientRect();
    const windowH = window.innerHeight;
    if (footerRect.top < windowH) {
      const overlap = windowH - footerRect.top;
      actionBar.style.transform = 'translateY(-' + overlap + 'px)';
    } else {
      actionBar.style.transform = '';
    }
  };
  window.addEventListener('scroll', footerDodgeHandler, { passive: true });
  footerDodgeHandler();
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
      <div class="wiz-topic-picker-header">
        <h3 class="wiz-topic-picker-title">${escapeHTML(label)}</h3>
        <button class="search-overlay-close" type="button" id="wiz-topic-overlay-close" aria-label="Close">✕</button>
      </div>
      <div class="search-overlay-input-row">
        <svg class="search-bar-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" class="search-overlay-input" id="wiz-topic-overlay-input"
               placeholder="Search or type a custom topic"
               autocomplete="off" autocapitalize="off" autocorrect="off"
               spellcheck="false" enterkeyhint="done">
      </div>
      <div class="wiz-topic-selected-row" id="wiz-topic-overlay-selected"></div>
      <div class="search-overlay-body shortcuts-sidebar" id="wiz-topic-overlay-body"></div>
      <div class="wiz-topic-picker-foot wiz-topic-picker-foot-left">
        <button type="button" class="wiz-topic-picker-done" id="wiz-topic-overlay-done">Done</button>
      </div>
    </div>
  `;

  const inputEl = topicPickerEl.querySelector('#wiz-topic-overlay-input');
  const bodyEl = topicPickerEl.querySelector('#wiz-topic-overlay-body');
  const selectedRowEl = topicPickerEl.querySelector('#wiz-topic-overlay-selected');

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

      // Featured Topics section at the top
      const featured = getFeaturedTopics();
      if (featured.length > 0) {
        html += `<div class="search-overlay-group">
          <div class="search-featured-header">Featured Topics</div>
          <div class="sidebar-shortcut-list search-subtopic-list">`;
        featured.forEach(t => {
          const sel = selected.has(t.name);
          html += `
            <div class="sidebar-shortcut search-subtopic-row wiz-topic-row search-featured-item ${sel ? 'is-selected' : ''}" data-name="${escapeAttr(t.name)}">
              <span class="wiz-topic-check">${sel ? '✓' : ''}</span>
              <span class="sidebar-shortcut-name">${escapeHTML(t.name)}</span>
            </div>
          `;
        });
        html += `</div></div>`;
      }

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
  // Reset scroll inside the body
  bodyEl.scrollTop = 0;
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouch) {
    inputEl.focus();
  }

  topicPickerEl.onclick = (e) => {
    if (e.target === topicPickerEl) done();
  };
}

function renderContentStep(host) {
  host.classList.add('wiz-step-body', 'wiz-grid-2');
  host.innerHTML = `
    <div class="wiz-sub-section wiz-sub-section-wide">
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
  host.classList.add('wiz-step-body', 'wiz-grid-2');
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
    <div class="wiz-sub-section wiz-sub-section-wide">
      <label class="wiz-sub-label">Geographic Focus <span class="wiz-optional">(pick one or more)</span></label>
      <div data-field="geographic"></div>
    </div>
    <div class="wiz-sub-section wiz-sub-section-wide">
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
        <div class="wiz-card-icon">${cardIcons[opt.value] || CARD_ICON_FALLBACK}</div>
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
        <div class="wiz-card-icon">${CARD_ICON_CUSTOM}</div>
        <div class="wiz-card-label">${escapeHTML(label)}</div>
        <button class="wiz-card-remove" type="button" data-remove="${escapeAttr(id)}" aria-label="Remove">×</button>
      </div>
    `;
  });
  if (allowCustom) {
    html += `
      <button class="wiz-card wiz-card-add" type="button" data-add-custom="true">
        <div class="wiz-card-icon">${CARD_ICON_PLUS}</div>
        <div class="wiz-card-label">Add custom</div>
      </button>
    `;
  }
  html += `</div>`;
  host.innerHTML = html;

  attachChipHandlers(host, fieldKey, '.wiz-card', '.wiz-card-add', '.wiz-card-remove');
}

// ---------- Field picker (topic-picker style for all fields) ----------

function populateChipGrid(host, fieldKey) {
  const opts = getOptionsFor(fieldKey);
  const customMap = state.customValues[fieldKey] || {};
  const allowCustom = isFieldAllowCustom(fieldKey);
  const selected = getValuesArray(fieldKey);

  // Build selected labels
  const selectedLabels = selected.map(v => {
    const opt = opts.find(o => o.value === v);
    if (opt) return opt.label;
    if (customMap[v]) return customMap[v];
    return v;
  });

  // Render chips + add button (same style as topic chips)
  const chipsHTML = selectedLabels.map((label, i) => `
    <span class="wiz-inline-chip" data-key="${escapeAttr(fieldKey)}" data-value="${escapeAttr(selected[i])}">
      ${escapeHTML(label)}
      <button type="button" class="wiz-inline-chip-x" aria-label="Remove">×</button>
    </span>
  `).join('');

  host.innerHTML = `
    <div class="wiz-topic-chips" id="wiz-field-chips-${fieldKey}">
      ${chipsHTML}
      <button type="button" class="wiz-topic-add-inline" id="wiz-field-add-${fieldKey}">${selectedLabels.length ? '+ Add more' : '+ Select'}</button>
    </div>
  `;

  // Remove chip handlers
  host.querySelectorAll('.wiz-inline-chip-x').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const chip = btn.closest('.wiz-inline-chip');
      removeValue(chip.dataset.key, chip.dataset.value);
      populateChipGrid(host, fieldKey);
      updatePreview();
      updateActionBar();
    });
  });

  // Open picker on add button or container click. Inside an expanded card
  // (accordion mode) it expands INLINE right below the field; otherwise it opens
  // the buffer/overlay picker.
  const refresh = () => { populateChipGrid(host, fieldKey); updatePreview(); updateActionBar(); };
  const inCard = !!(pbInlineHost && containerEl && containerEl.querySelector('.pb-card.is-expanded'));
  const openPicker = () => {
    if (inCard) {
      const sec = host.closest('.pb-modal-section') || host;
      const existing = sec.querySelector('.pb-nested-picker');
      sec.parentElement?.querySelectorAll('.pb-nested-picker').forEach((n) => n.remove());
      if (existing) return;
      const nested = document.createElement('div');
      nested.className = 'pb-nested-picker';
      sec.appendChild(nested);
      openFieldPicker(fieldKey, opts, customMap, allowCustom, refresh, { container: nested, onClose: () => { nested.remove(); refresh(); } });
      requestAnimationFrame(() => { try { nested.scrollIntoView({ block: 'nearest' }); } catch (_) {} });
    } else {
      openFieldPicker(fieldKey, opts, customMap, allowCustom, refresh);
    }
  };
  host.querySelector(`#wiz-field-add-${fieldKey}`)?.addEventListener('click', openPicker);
  host.querySelector(`#wiz-field-chips-${fieldKey}`)?.addEventListener('click', (e) => {
    if (!e.target.closest('.wiz-inline-chip-x') && !e.target.closest('.wiz-topic-add-inline')) openPicker();
  });
}

// Field picker overlay — opened from the Output Style / Sources /
// Scope buffer modals' "+ Add" CTAs. Uses the same clean chrome as
// the accordion topic picker: outer scaffolding built once, only
// `.pb-acc-content` re-renders on input/toggle so the search input
// stays mounted and the mobile keyboard doesn't reflow on every
// keystroke. Same checkbox-in-bullet indicator, same navy Done.
let fieldPickerEl = null;
function openFieldPicker(fieldKey, opts, customMap, allowCustom, onDone, mountOpts) {
  const nestedEl = mountOpts && mountOpts.container;
  const inline = !nestedEl && !!pbInlineHost;
  if (!inline && !nestedEl && fieldPickerEl) { fieldPickerEl.remove(); fieldPickerEl = null; }

  const field = getField(fieldKey);
  const label = field?.label || fieldKey;
  const description = field?.description || '';

  let query = '';
  // Assigned per mount (inline buffer vs overlay) below.
  let contentEl, bodyEl, searchInput;

  // Snapshot state on open so Cancel can revert the toggles + custom
  // additions the user made during this picker session.
  const snap = snapshotState();
  const close = () => {
    if (nestedEl) { onDone(); if (mountOpts.onClose) mountOpts.onClose(); return; }
    if (inline) { onDone(); pbInlineBack(); return; }
    fieldPickerEl?.remove();
    fieldPickerEl = null;
    onDone();
  };
  const cancel = () => {
    restoreState(snap);
    close();
  };

  const toggle = (value) => {
    toggleValue(fieldKey, value);
    renderContent();
  };

  const findExistingOptionByLabel = (text) => {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    const opt = opts.find(o => o.label.toLowerCase() === t || o.value.toLowerCase() === t);
    if (opt) return { type: 'opt', value: opt.value };
    const customMapNow = state.customValues[fieldKey] || {};
    for (const [id, lbl] of Object.entries(customMapNow)) {
      if (lbl.toLowerCase() === t) return { type: 'custom', value: id };
    }
    return null;
  };

  const addCustomFromInput = () => {
    const text = (query || '').trim();
    if (!text) return;
    const existing = findExistingOptionByLabel(text);
    if (existing) {
      if (!isValueSelected(fieldKey, existing.value)) toggleValue(fieldKey, existing.value);
    } else if (allowCustom) {
      addCustomValue(fieldKey, text);
    } else {
      return;
    }
    query = '';
    if (searchInput) searchInput.value = '';
    renderContent();
  };

  function renderSelectedRow() {
    const selected = getValuesArray(fieldKey);
    if (selected.length === 0) return '';
    const customMapNow = state.customValues[fieldKey] || {};
    return `
      <div class="pb-acc-selected">
        ${selected.map(v => {
          const opt = opts.find(o => o.value === v);
          const lbl = opt ? opt.label : (customMapNow[v] || v);
          return `
            <span class="pb-acc-selchip" data-acc-remove="${escapeAttr(v)}">
              ${escapeHTML(lbl)}
              <button type="button" class="pb-acc-selchip-x" aria-label="Remove">×</button>
            </span>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderRows() {
    const q = (query || '').trim().toLowerCase();
    const customMapNow = state.customValues[fieldKey] || {};
    const filteredOpts = q ? opts.filter(o => o.label.toLowerCase().includes(q)) : opts.slice();
    const customEntries = Object.entries(customMapNow)
      .filter(([_, lbl]) => !q || lbl.toLowerCase().includes(q));

    let html = '<div class="pb-acc-results">';

    if (q && allowCustom) {
      const exact = findExistingOptionByLabel(query);
      if (!exact) {
        html += `
          <button type="button" class="pb-acc-custom" data-acc-add-custom="1">
            <span class="pb-acc-custom-plus">+</span>
            <span>Add "<strong>${escapeHTML(query.trim())}</strong>" as a custom value</span>
          </button>
        `;
      }
    }

    filteredOpts.forEach(opt => {
      const isSel = isValueSelected(fieldKey, opt.value);
      html += `
        <button type="button" class="pb-acc-result ${isSel ? 'is-selected' : ''}" data-acc-toggle="${escapeAttr(opt.value)}">
          ${accCheckHTML(isSel)}
          <span class="pb-acc-result-name">${escapeHTML(opt.label)}</span>
        </button>
      `;
    });

    customEntries.forEach(([id, lbl]) => {
      const isSel = isValueSelected(fieldKey, id);
      html += `
        <button type="button" class="pb-acc-result ${isSel ? 'is-selected' : ''}" data-acc-toggle="${escapeAttr(id)}">
          ${accCheckHTML(isSel)}
          <span class="pb-acc-result-name">${escapeHTML(lbl)}</span>
          <span class="pb-acc-result-parent">custom</span>
        </button>
      `;
    });

    if (filteredOpts.length === 0 && customEntries.length === 0 && !(q && allowCustom)) {
      html += `<p class="pb-acc-empty">No matches.</p>`;
    }

    html += '</div>';
    return html;
  }

  // Search-bar + content shell, shared by the overlay (full page) and the inline
  // buffer (dropdown). Only `.pb-acc-content` rewrites on input/toggle so the
  // search input stays mounted and the mobile keyboard doesn't thrash.
  const FP_INNER = `
    <div class="pb-acc-search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="search" class="pb-acc-search-input" placeholder="${allowCustom ? 'Search or type to add custom…' : 'Search options…'}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    </div>
    <div class="pb-acc-content"></div>`;

  function renderContent() {
    const scrollY = bodyEl.scrollTop;
    contentEl.innerHTML = renderSelectedRow() + renderRows();
    bodyEl.scrollTop = scrollY;
    bindContentEvents();
  }

  function bindContentEvents() {
    contentEl.querySelectorAll('[data-acc-toggle]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle(btn.dataset.accToggle);
      });
    });
    contentEl.querySelectorAll('[data-acc-remove]').forEach(chip => {
      chip.querySelector('.pb-acc-selchip-x')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle(chip.dataset.accRemove);
      });
    });
    const addCustomBtn = contentEl.querySelector('[data-acc-add-custom]');
    if (addCustomBtn) addCustomBtn.addEventListener('click', addCustomFromInput);
  }

  // Mount as a nested in-card picker, a body-level overlay (full page), or an
  // in-panel buffer (inline).
  function mountAndWire() {
    if (nestedEl) {
      nestedEl.classList.add('pb-accordion-body', 'pb-nested-body');
      nestedEl.innerHTML = `${FP_INNER}<div class="pb-nested-foot"><button type="button" class="pb-nested-done">Done</button></div>`;
      bodyEl = nestedEl;
      nestedEl.querySelector('.pb-nested-done').addEventListener('click', close);
    } else if (inline) {
      const body = pbInlineChrome({
        title: label, doneLabel: 'Done',
        onDone: () => { onDone(); },
        onCancel: () => { restoreState(snap); onDone(); },
      });
      body.classList.add('pb-accordion-body');
      body.innerHTML = FP_INNER;
      bodyEl = body;
    } else {
      fieldPickerEl = document.createElement('div');
      fieldPickerEl.className = 'pb-modal-overlay pb-accordion-overlay';
      document.body.appendChild(fieldPickerEl);
      fieldPickerEl.innerHTML = `
        <div class="pb-modal-card pb-accordion-card">
          <header class="pb-modal-head">
            <button type="button" class="pb-modal-close" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18"/>
                <line x1="18" y1="6" x2="6" y2="18"/>
              </svg>
            </button>
            <div class="pb-modal-title-block">
              <h2 class="pb-modal-title">${escapeHTML(label)}</h2>
              ${description ? `<p class="pb-modal-subtitle">${escapeHTML(description)}</p>` : ''}
            </div>
          </header>
          <div class="pb-modal-body pb-accordion-body">${FP_INNER}</div>
          <footer class="pb-modal-foot">
            <button type="button" class="pb-modal-cancel">Cancel</button>
            <button type="button" class="pb-modal-done">Done</button>
          </footer>
        </div>`;
      bodyEl = fieldPickerEl.querySelector('.pb-modal-body');
      fieldPickerEl.querySelector('.pb-modal-close').addEventListener('click', cancel);
      fieldPickerEl.querySelector('.pb-modal-done').addEventListener('click', close);
      fieldPickerEl.querySelector('.pb-modal-cancel').addEventListener('click', cancel);
      fieldPickerEl.addEventListener('click', (e) => { if (e.target === fieldPickerEl) cancel(); });
    }
    contentEl = bodyEl.querySelector('.pb-acc-content');
    searchInput = bodyEl.querySelector('.pb-acc-search-input');
    searchInput.addEventListener('input', () => {
      query = searchInput.value;
      renderContent();
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCustomFromInput();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    renderContent();
  }

  // Nested: render in place. Inline: push onto the buffer stack. Overlay: mount over the page.
  if (nestedEl) mountAndWire();
  else if (inline) pbInlineGo(mountAndWire);
  else mountAndWire();
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
  const fieldRoot = document.querySelector(`[data-field="${fieldKey}"]`);
  if (fieldRoot) populateChipGrid(fieldRoot, fieldKey);
  // Re-render extras for fields that may have requiresInput
  const extras = document.querySelector(`[data-extras-field="${fieldKey}"]`);
  if (extras) renderExtraInputs(extras, fieldKey);

  updatePreview();
  updateNextEnabled();
  updateActionBar();
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

// Unified preview + model selection + submit modal.
// Uses the same .prompt-modal-overlay / .prompt-modal-panel chrome as
// the AI Shortcuts modal for visual consistency. No anchor on this page,
// so the panel centers itself in the viewport.
let submitOverlayEl = null;
let submitPanelEl = null;
// When set, the Preview/Submit panel renders into this inline element (dropdown
// buffer view) instead of the centered body-level modal.
let submitInlineEl = null;
let submitPositionRaf = null;
let submitPositionListenersBound = false;
const SUBMIT_PANEL_PAD = 12;
const SUBMIT_PANEL_MAX = 720;
// No hard "min" floor — narrow phones drop below 480px wide, and a
// fixed minimum width pushed the panel outside the viewport (left
// edge negative + right edge past viewport).

// Clean "primary topic required" modal shown when Submit is clicked with no primary
// topic. Offers a direct link that opens the Topics card + Primary picker (#img365).
function openPrimaryRequiredModal() {
  document.querySelector('.pb-required-overlay')?.remove();
  const ov = document.createElement('div');
  ov.className = 'pb-required-overlay';
  ov.innerHTML = `
    <div class="pb-required-card" role="dialog" aria-modal="true" aria-label="Primary topic required">
      <span class="pb-required-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg></span>
      <h3 class="pb-required-title">Add a primary topic first</h3>
      <p class="pb-required-body">A prompt needs at least one <strong>primary topic</strong> before you can submit it — that's what the AI focuses on.</p>
      <div class="pb-required-foot">
        <button type="button" class="pb-required-go">Choose a primary topic</button>
        <button type="button" class="pb-required-dismiss">Not now</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('.pb-required-dismiss').addEventListener('click', close);
  ov.querySelector('.pb-required-go').addEventListener('click', () => { close(); jumpToPrimaryTopicPicker(); });
}

// Expand the Topics card and pop open the Primary-topic picker inline.
function jumpToPrimaryTopicPicker() {
  const root = containerEl || document;
  const card = root.querySelector('.pb-card[data-pb-card="topics"]');
  if (!card) { if (!pbInlineHost) openPbCardModal('topics'); return; }
  if (!card.classList.contains('is-expanded')) {
    if (pbInlineHost) togglePbCardInline(card, 'topics'); else { openPbCardModal('topics'); return; }
  }
  try { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) {}
  // Give the expanded body a beat to render, then open the Primary "+ Select".
  setTimeout(() => {
    const bar = root.querySelector('#pb-topicbar-primaryTopic');
    (bar?.querySelector('.wiz-topic-add-inline') || bar)?.click();
  }, 90);
}

// Inline (dropdown) Preview/Submit — renders the same panel as a buffer view.
function renderSubmitBuffer() {
  const body = pbInlineChrome({ title: '', footer: false, onCancel: () => { submitInlineEl = null; } });
  submitInlineEl = body;
  renderSubmitPanel();
}

function openPromptSubmitModal() {
  if (pbInlineHost) { pbInlineGo(renderSubmitBuffer); return; }
  if (!submitOverlayEl) {
    submitOverlayEl = document.createElement('div');
    submitOverlayEl.className = 'prompt-modal-overlay';
    submitOverlayEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(submitOverlayEl);

    submitPanelEl = document.createElement('div');
    submitPanelEl.className = 'prompt-modal-panel';
    submitPanelEl.setAttribute('role', 'dialog');
    submitPanelEl.setAttribute('aria-modal', 'true');
    document.body.appendChild(submitPanelEl);

    submitOverlayEl.addEventListener('click', (e) => {
      if (e.target === submitOverlayEl) closeSubmitModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && submitOverlayEl.style.display === 'block') {
        closeSubmitModal();
      }
    });
  }

  renderSubmitPanel();
  submitOverlayEl.style.display = 'block';
  submitPanelEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  positionSubmitPanel();
  // eslint-disable-next-line no-unused-expressions
  submitPanelEl.offsetWidth;
  submitOverlayEl.classList.add('is-open');
  submitPanelEl.classList.add('is-open');

  if (!submitPositionListenersBound) {
    submitPositionListenersBound = true;
    window.addEventListener('resize', scheduleSubmitPosition, { passive: true });
    window.addEventListener('scroll', scheduleSubmitPosition, { passive: true });
  }
}

function closeSubmitModal() {
  if (!submitOverlayEl) return;
  submitOverlayEl.classList.remove('is-open');
  submitPanelEl.classList.remove('is-open');
  submitPanelEl.classList.add('is-closing');

  const onEnd = () => {
    submitPanelEl.removeEventListener('transitionend', onEnd);
    submitOverlayEl.style.display = 'none';
    submitPanelEl.style.display = 'none';
    submitPanelEl.classList.remove('is-closing');
    submitPanelEl.style.cssText = '';
    document.body.style.overflow = '';
  };
  submitPanelEl.addEventListener('transitionend', onEnd);
  setTimeout(onEnd, 280);

  if (submitPositionListenersBound) {
    submitPositionListenersBound = false;
    window.removeEventListener('resize', scheduleSubmitPosition);
    window.removeEventListener('scroll', scheduleSubmitPosition);
    if (submitPositionRaf) cancelAnimationFrame(submitPositionRaf);
    submitPositionRaf = null;
  }
}

function scheduleSubmitPosition() {
  if (submitPositionRaf) return;
  submitPositionRaf = requestAnimationFrame(() => {
    submitPositionRaf = null;
    positionSubmitPanel();
  });
}

function positionSubmitPanel() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(SUBMIT_PANEL_MAX, vw - SUBMIT_PANEL_PAD * 2);
  const left = Math.round((vw - w) / 2);
  const top = Math.max(SUBMIT_PANEL_PAD, Math.round(vh * 0.06));
  const maxH = vh - top - SUBMIT_PANEL_PAD;
  submitPanelEl.style.left = `${left}px`;
  submitPanelEl.style.top = `${top}px`;
  submitPanelEl.style.width = `${w}px`;
  submitPanelEl.style.maxHeight = `${maxH}px`;
}

function renderSubmitPanel() {
  const el = submitInlineEl || submitPanelEl;
  const prompt = (state.editedPrompt ?? assemblePrompt()).trim();
  const models = getModels();
  const isEmpty = !prompt;
  const isEdited = state.editedPrompt != null && !state.isEditingPrompt;
  const model = getModelById(state.modelId);
  const methods = model ? getSubmissionMethods?.() ?? {} : {};
  const method = model?.submissionMethod || 'direct';
  const meta = methods[method] || {};

  const modelBtnsHTML = models.map(m => `
    <button class="pm-model" type="button" data-model-id="${m.id}" aria-pressed="${m.id === state.modelId ? 'true' : 'false'}">
      <span class="pm-model-name">${escapeHTML(m.name)}</span>
    </button>
  `).join('');

  el.innerHTML = `
    <div class="pm-header">
      <div class="pm-title">
        <span class="pm-title-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/>
            <path d="M19 3l.6 1.6L21.2 5.2 19.6 5.8 19 7.4 18.4 5.8 16.8 5.2 18.4 4.6z"/>
          </svg>
        </span>
        <h3 class="pm-title-name">Preview and Submit Prompt</h3>
      </div>
      <button type="button" class="pm-close" id="wiz-submit-close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>
      </button>
    </div>

    <div class="pm-body">
      <section class="pm-section">
        <div class="pm-section-head">
          <span class="pm-section-label">Prompt</span>
          ${isEdited ? '<button type="button" class="pm-reset" id="wiz-submit-reset">Reset to generated</button>' : ''}
        </div>
        <div class="pm-preview-wrap ${state.isEditingPrompt ? 'is-editing' : ''}">
          ${state.isEditingPrompt
            ? `<textarea class="pm-textarea" id="wiz-submit-textarea">${escapeHTML(prompt)}</textarea>`
            : `<div class="pm-preview ${isEmpty ? 'is-empty' : ''}" id="wiz-submit-preview" tabindex="0" role="button" aria-label="Click to edit prompt">${isEmpty ? 'Add a topic to start building your prompt…' : escapeHTML(prompt)}</div>`
          }
          <div class="pm-preview-actions">
            <button type="button" class="pm-copy-btn" id="wiz-submit-copy" aria-label="Copy prompt">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="8" height="9" rx="1.2"/><path d="M9.5 3.5V2.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1"/></svg>
              <span class="pm-copy-btn-label">Copy</span>
            </button>
            <button type="button" class="pm-icon-btn" id="wiz-submit-edit" aria-label="${state.isEditingPrompt ? 'Save' : 'Edit'} prompt" title="${state.isEditingPrompt ? 'Save' : 'Edit'}">
              ${state.isEditingPrompt
                ? `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5,7.5 5.5,10.5 11.5,4"/></svg>`
                : `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.2l2.3 2.3-7 7H2.5v-2.3l7-7z"/></svg>`
              }
            </button>
          </div>
        </div>
      </section>

      <section class="pm-section">
        <div class="pm-section-label">AI Model</div>
        <div class="pm-models" id="wiz-submit-models">${modelBtnsHTML}</div>
      </section>

      <section class="pm-submit-area">
        <div class="pm-section-label">Prompt Submission</div>
        <div class="pm-actions">
          <button class="pm-submit" id="wiz-submit-go" type="button" ${isEmpty ? 'disabled' : ''}>${escapeHTML(getSubmitLabel())}</button>
        </div>
        ${model ? `
          <div class="pm-meta">
            ${meta.description ? `<div class="pm-meta-line">
              <span class="pm-meta-label">Model info:</span>
              <a href="${model.chatUrl || model.urlTemplate.replace('{prompt}', '')}" target="_blank" rel="noopener noreferrer" class="pm-meta-link">${escapeHTML(model.name)}</a>
              <span class="pm-meta-text">— ${escapeHTML(meta.description.replace(/\{model\}/g, model.name))}</span>
            </div>` : ''}
            <div class="pm-meta-line">
              <span class="pm-meta-label">Disclaimer:</span>
              <span class="pm-meta-text">You'll be redirected to a third-party AI platform. Standard Topic isn't responsible for actions taken once you leave this site.</span>
            </div>
          </div>
        ` : ''}
      </section>
    </div>
  `;

  bindSubmitPanelEvents();
}

function bindSubmitPanelEvents() {
  const el = submitInlineEl || submitPanelEl;
  // Inline mode has no overlay to tear down — "close"/after-submit just pops the
  // buffer view back to the builder.
  const onClose = submitInlineEl ? () => { submitInlineEl = null; pbInlineBack(); } : closeSubmitModal;
  el.querySelector('#wiz-submit-close').addEventListener('click', onClose);

  el.querySelector('#wiz-submit-copy').addEventListener('click', async (e) => {
    e.stopPropagation();
    const text = state.isEditingPrompt
      ? el.querySelector('#wiz-submit-textarea')?.value ?? ''
      : (state.editedPrompt ?? assemblePrompt()).trim();
    // Try the modern async clipboard API first. Falls back to the
    // legacy document.execCommand('copy') flow, which works on
    // older Safari + non-https origins where navigator.clipboard
    // is unavailable. Both paths run sync enough to keep the user
    // gesture context.
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (_) { /* fall through */ }
    if (!copied) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.opacity = '0';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_) { /* give up silently */ }
    }
    const btn = e.currentTarget;
    btn.classList.add('is-copied');
    const labelEl = btn.querySelector('.pm-copy-btn-label');
    if (labelEl) {
      const prev = labelEl.textContent;
      labelEl.textContent = copied ? 'Copied' : 'Copy failed';
      setTimeout(() => { labelEl.textContent = prev; }, 1400);
    }
    setTimeout(() => btn.classList.remove('is-copied'), 1400);
  });

  el.querySelector('#wiz-submit-edit').addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.isEditingPrompt) {
      const ta = el.querySelector('#wiz-submit-textarea');
      if (ta) state.editedPrompt = ta.value;
      state.isEditingPrompt = false;
    } else {
      state.isEditingPrompt = true;
    }
    renderSubmitPanel();
  });

  const preview = el.querySelector('#wiz-submit-preview');
  if (preview) {
    preview.addEventListener('click', () => {
      if (state.isEditingPrompt) return;
      state.isEditingPrompt = true;
      renderSubmitPanel();
    });
    preview.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        state.isEditingPrompt = true;
        renderSubmitPanel();
      }
    });
  }

  el.querySelector('#wiz-submit-reset')?.addEventListener('click', () => {
    state.editedPrompt = null;
    renderSubmitPanel();
  });

  el.querySelector('#wiz-submit-models').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-model-id]');
    if (!btn) return;
    state.modelId = btn.dataset.modelId;
    setPreferredModelId(state.modelId);
    renderSubmitPanel();
  });

  el.querySelector('#wiz-submit-go')?.addEventListener('click', async () => {
    const model = getModelById(state.modelId);
    if (!model) return;
    const finalPrompt = state.isEditingPrompt
      ? el.querySelector('#wiz-submit-textarea')?.value
      : (state.editedPrompt ?? assemblePrompt());
    track('prompt_builder_submit', {
      model: model.id,
      edited: state.editedPrompt != null,
      length: finalPrompt.trim().length,
    });
    await submitPrompt(model, finalPrompt.trim());
    onClose();
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
  if (!m) return 'Send Prompt';
  return `Send Prompt with ${m.name}`;
}
function getOpenOnlyLabel() {
  const m = getModelById(state.modelId);
  if (!m) return 'Open Model Only';
  return `Open ${m.name} only`;
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

  // ---- Section 1: Opener (from Output Type) ----
  const opener = buildOpener(primaryPhrase, sub);

  // ---- Sections 2+: Group supporting clauses by category for cleaner prose
  const sections = [];

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

// Build the opener paragraph from Output Type selections.
// 1 selection → use the option's full clause (e.g., "Provide a comprehensive overview of X.")
// 2+ selections → "Provide the following about X:" with bulleted labels (no redundancy)
function buildOpener(primaryPhrase, sub) {
  const values = getValuesArray('outputType');
  if (values.length === 0) return sub(pgData.baseTemplate);

  if (values.length === 1) {
    const v = values[0];
    const opt = getOptionsFor('outputType').find(o => o.value === v);
    if (opt?.clause) return endWithPeriod(sub(opt.clause));
    const custom = getCustomLabel('outputType', v);
    return custom ? `Provide ${custom} about ${primaryPhrase}.` : sub(pgData.baseTemplate);
  }

  // Multiple — bullet list with short labels
  const items = values.map(v => {
    const opt = getOptionsFor('outputType').find(o => o.value === v);
    if (opt) {
      let label = opt.label;
      if (opt.requiresInput) {
        const extra = state.extraInputs[opt.requiresInput.key]?.trim();
        if (extra) label += ` with ${extra}`;
      }
      return label;
    }
    return getCustomLabel('outputType', v);
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
    case 'outputType': return `Provide ${customStr} on the topic`;
    case 'sources': return `Draw from ${customStr}`;
    case 'recency': return `Focus on information from ${customStr}`;
    case 'citations': return `Use ${customStr} citation style`;
    case 'format': return `Format the response as ${customStr}`;
    case 'length': return `Target a ${customStr} length response`;
    case 'audience': return `Write for a ${customStr} audience`;
    case 'tone': return `Use a ${customStr} tone`;
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
