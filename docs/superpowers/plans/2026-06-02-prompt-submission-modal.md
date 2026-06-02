# Prompt Submission Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cramped in-sidebar shortcut submission bar with a polished, site-native centered modal ("Prompt Submission") that has a title, clear selection summary, model picker, an Advanced settings accordion (Reasoning Level, Output Type, Secondary Topics, Custom Instructions), and Preview + Direct Submit.

**Architecture:** A pure `assemblePrompt()` helper (Node-tested) builds the final prompt from a base + advanced settings. A new `prompt-submit-modal.js` component renders a centered overlay (mirroring the existing `prompt-modal` visual language) and is opened by app.js via an `open-submit-modal` event with callbacks wired to the existing selection helpers. The sidebar bar collapses to a single "Review & Submit →" trigger. Reasoning Level + Custom Instructions persist in `settings.js`; Output Type + Secondary Topics are per-submission.

**Tech Stack:** Vanilla ES modules (browser), Node 18+ `node:assert` test scripts, Playwright for integration. No test framework in repo.

Spec: `docs/superpowers/specs/2026-06-02-prompt-submission-modal-design.md`.

---

### Task 1: Pure `assemblePrompt` helper

**Files:**
- Create: `js/utils/prompt-assembly.js`
- Create: `tools/test_prompt_assembly.mjs`

- [ ] **Step 1: Write the failing test**

Create `tools/test_prompt_assembly.mjs`:

```javascript
import assert from 'node:assert/strict';
import { assemblePrompt } from '../js/utils/prompt-assembly.js';

// Bare base, no options → unchanged.
assert.equal(assemblePrompt('BASE', {}), 'BASE');

// Reasoning hint prepends; output/secondary/custom append in order.
const full = assemblePrompt('BASE', {
  reasoningHint: 'Be brief.',
  outputClause: 'Provide a comprehensive overview of {primary_topic}',
  secondaryTopic: 'Trade policy',
  secondaryClauseTpl: 'Also consider the intersection with {secondary_topic}.',
  customInstructions: 'Use British English.',
  topicName: 'Inflation',
});
assert.equal(full,
  'Be brief.\n\nBASE\n\n' +
  'Provide a comprehensive overview of Inflation\n\n' +
  'Also consider the intersection with Trade policy.\n\n' +
  'Use British English.');

// Missing pieces drop their block entirely (no blank lines).
assert.equal(assemblePrompt('BASE', { customInstructions: 'X' }), 'BASE\n\nX');
assert.equal(assemblePrompt('BASE', { reasoningHint: 'R' }), 'R\n\nBASE');

// Secondary topic given but no template → skip (nothing to format).
assert.equal(assemblePrompt('BASE', { secondaryTopic: 'X' }), 'BASE');

// Output clause with no topicName leaves placeholder literal-free by substituting empty.
assert.equal(assemblePrompt('BASE', { outputClause: 'Cover {primary_topic} well' }),
  'BASE\n\nCover  well');

console.log('OK: assemblePrompt');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/test_prompt_assembly.mjs`
Expected: FAIL — import error, `assemblePrompt` not exported.

- [ ] **Step 3: Write minimal implementation**

Create `js/utils/prompt-assembly.js`:

```javascript
// Pure prompt assembly — no DOM. Builds the final submission prompt from a
// base prompt plus the modal's advanced settings. Order: reasoning hint
// (prepended), base, output-type clause, secondary-topic clause, custom
// instructions. Each optional block is included only when present, joined by
// a blank line. Placeholders {primary_topic}/{secondary_topic} are substituted.
export function assemblePrompt(base, opts) {
  opts = opts || {};
  const parts = [];
  if (opts.reasoningHint) parts.push(opts.reasoningHint);
  parts.push(base);
  if (opts.outputClause) {
    parts.push(opts.outputClause.replace(/\{primary_topic\}/g, opts.topicName || ''));
  }
  if (opts.secondaryTopic && opts.secondaryClauseTpl) {
    parts.push(opts.secondaryClauseTpl.replace(/\{secondary_topic\}/g, opts.secondaryTopic));
  }
  if (opts.customInstructions) parts.push(opts.customInstructions);
  return parts.join('\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/test_prompt_assembly.mjs`
Expected: `OK: assemblePrompt`

- [ ] **Step 5: Commit**

```bash
git add js/utils/prompt-assembly.js tools/test_prompt_assembly.mjs
git commit -m "Add pure assemblePrompt helper for prompt submission"
```

---

### Task 2: Custom Instructions in settings + Settings modal

**Files:**
- Modify: `js/utils/settings.js`
- Modify: `js/components/settings-modal.js`

- [ ] **Step 1: Add getter/setter in `settings.js`**

In `js/utils/settings.js`, add `customInstructions: 'st_settings_custom_instructions'`
to the `KEYS` object, and append these exports after `applyReasoningLevelToPrompt`:

```javascript
export function getCustomInstructions() {
  return read(KEYS.customInstructions) || '';
}

export function setCustomInstructions(text) {
  write(KEYS.customInstructions, (text || '').trim());
}
```

- [ ] **Step 2: Verify module parses**

Run: `node --check js/utils/settings.js`
Expected: exit 0, no output.

- [ ] **Step 3: Surface it in the Settings modal**

In `js/components/settings-modal.js`:

(a) Add to the imports from `../utils/settings.js`: `getCustomInstructions, setCustomInstructions`.

(b) In the open/snapshot block, extend `saved` to include custom instructions. Find:
```javascript
  saved = {
```
and add a `customInstructions: getCustomInstructions(),` line inside that object (so
`pending = { ...saved }` carries it).

(c) In `isDirty()` (the function returning the `pending !== saved` comparison), add:
```javascript
    || pending.customInstructions !== saved.customInstructions
```
to the boolean expression.

(d) In `saveChanges()`, after the reasoning-level write, add:
```javascript
  setCustomInstructions(pending.customInstructions);
```

(e) In the render function, after the Reasoning level section's closing markup, add a
Custom Instructions section (match the existing section markup style):
```javascript
  const customInstructionsHTML = `
    <div class="settings-section">
      <h4 class="settings-section-title">Custom instructions</h4>
      <p class="settings-section-desc">Added to the end of every prompt you submit. Applies across the site this session.</p>
      <textarea class="settings-custom-instructions" data-setting="custom-instructions"
        rows="3" placeholder="e.g. Use British English. Prefer bullet points."
        style="width:100%;font-family:var(--font-family);font-size:0.88rem;padding:0.55rem 0.65rem;border:1px solid var(--color-border);border-radius:8px;resize:vertical;">${escapeHTML(pending.customInstructions || '')}</textarea>
    </div>`;
```
Insert `${customInstructionsHTML}` into the modal body template right after the
reasoning-level section. (If `escapeHTML` isn't already imported in this file, use the
existing escaping helper used elsewhere in the file, or inline-escape with a small
local function.)

(f) Wire input. In the modal's click/`initSettingsModal` event area, add an `input`
listener (the settings modal uses a delegated handler on its root element — add an
`input` handler alongside the existing `click` handler):
```javascript
  root.addEventListener('input', (e) => {
    const ci = e.target.closest('[data-setting="custom-instructions"]');
    if (ci && pending) pending.customInstructions = ci.value;
  });
```
(Use the same root element variable the existing click handler is attached to.)

- [ ] **Step 4: Verify**

Run: `node --check js/components/settings-modal.js && node --check js/utils/settings.js`
Expected: exit 0 for both. (Visual check happens in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add js/utils/settings.js js/components/settings-modal.js
git commit -m "Settings: add session-persistent Custom Instructions field"
```

---

### Task 3: The Prompt Submission modal component + styles

**Files:**
- Create: `js/components/prompt-submit-modal.js`
- Modify: `css/styles.css` (append a styles block)
- Modify: `js/app.js` (import + init)

- [ ] **Step 1: Create the component**

Create `js/components/prompt-submit-modal.js`:

```javascript
// Centered "Prompt Submission" modal for AI shortcut selections. Opened via the
// `open-submit-modal` CustomEvent with a context object; app.js owns the selection
// state and passes callbacks. Mirrors the prompt-modal visual language.
import { getModels } from '../utils/data.js';
import { getPromptGenData } from '../utils/data.js';
import { REASONING_LEVELS, getReasoningLevel, setReasoningLevel,
         getCustomInstructions, setCustomInstructions } from '../utils/settings.js';
import { escapeHTML } from '../utils/dom.js';

let overlayEl = null;
let panelEl = null;
let ctx = null;            // { count, topicName, selectedModelId, callbacks }
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
  render();
  // focus the panel for accessibility
  panelEl.focus?.();
}

function close() {
  overlayEl.style.display = 'none';
  panelEl.style.display = 'none';
  ctx = null;
}

// Build the assembled prompt from the current selection + advanced settings.
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
  const modelName = (models.find(m => m.id === selId) || models[0] || {}).name || 'ChatGPT';
  const allSelected = ctx.allSelected;

  const otField = outputTypeField();
  const otOptions = '<option value="">— None —</option>' + (otField.options || []).map(o =>
    `<option value="${escapeHTML(o.value)}"${o.value === perSubmission.outputType ? ' selected' : ''}>${escapeHTML(o.label)}</option>`).join('');
  const reasoningOptions = REASONING_LEVELS.map(l =>
    `<option value="${l.id}"${l.id === getReasoningLevel() ? ' selected' : ''}>${escapeHTML(l.name)}</option>`).join('');

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
        <select id="psm-model" class="psm-select">
          ${models.map(m => `<option value="${escapeHTML(m.id)}"${m.id === selId ? ' selected' : ''}>${escapeHTML(m.name)}</option>`).join('')}
        </select>
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
          <input id="psm-secondary" class="psm-input" type="text" placeholder="e.g. trade policy" value="${escapeHTML(perSubmission.secondaryTopic)}"></label>
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

  // Advanced inputs
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
```

- [ ] **Step 2: Confirm `escapeHTML` location**

Run: `grep -rn "export function escapeHTML" js/utils/`
Expected: a path is printed. If `escapeHTML` lives in a different module than
`js/utils/dom.js`, update the import path at the top of `prompt-submit-modal.js` to
match the printed path. Then run `node --check js/components/prompt-submit-modal.js`
(expected exit 0).

- [ ] **Step 3: Append modal styles**

Append to `css/styles.css`:

```css
/* === Prompt Submission modal === */
.psm-overlay { position: fixed; inset: 0; background: rgba(15,26,46,0.55); z-index: 1000; }
.psm-panel {
  position: fixed; z-index: 1001; top: 50%; left: 50%; transform: translate(-50%,-50%);
  width: min(520px, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); overflow: auto;
  background: var(--color-bg); border-radius: 14px; box-shadow: 0 24px 60px rgba(15,26,46,0.32);
  outline: none;
}
.psm-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 1.1rem 1.25rem 0.9rem; border-bottom: 1px solid var(--color-border);
}
.psm-eyebrow { display: block; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--color-text-muted); }
.psm-title { margin: 0.15rem 0 0; font-family: var(--font-display); font-size: 1.2rem;
  font-weight: 600; letter-spacing: -0.02em; color: var(--color-primary); }
.psm-close { background: none; border: none; color: var(--color-text-muted); cursor: pointer;
  padding: 0.25rem; border-radius: 6px; }
.psm-close:hover { background: var(--color-bg-light); color: var(--color-text); }
.psm-body { padding: 1rem 1.25rem 1.25rem; }
.psm-selrow { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.95rem; }
.psm-count { font-size: 0.95rem; color: var(--color-text); }
.psm-count strong { color: var(--color-primary); }
.psm-selutils { display: inline-flex; align-items: center; gap: 0.4rem; }
.psm-link { background: none; border: none; color: var(--color-primary-light); font-size: 0.85rem;
  font-weight: 600; cursor: pointer; padding: 0.1rem 0.2rem; font-family: inherit; }
.psm-link:hover { text-decoration: underline; }
.psm-link:disabled { color: var(--color-text-light); cursor: default; text-decoration: none; }
.psm-dot { color: var(--color-text-light); }
.psm-modelrow { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.9rem; }
.psm-label, .psm-flabel { font-size: 0.82rem; font-weight: 600; color: var(--color-text-muted); }
.psm-select, .psm-input, .psm-textarea {
  font-family: var(--font-family); font-size: 0.9rem; padding: 0.45rem 0.6rem;
  border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-bg); color: var(--color-text);
}
.psm-modelrow .psm-select { flex: 1; }
.psm-adv-toggle { display: inline-flex; align-items: center; gap: 0.45rem; background: none; border: none;
  font-family: inherit; font-size: 0.86rem; font-weight: 600; color: var(--color-primary); cursor: pointer;
  padding: 0.5rem 0; }
.psm-adv-toggle[aria-expanded="true"] .psm-chev { transform: rotate(180deg); }
.psm-chev { transition: transform 0.15s; }
.psm-adv { display: flex; flex-direction: column; gap: 0.7rem; padding: 0.4rem 0 0.6rem;
  border-top: 1px dashed var(--color-border); margin-top: 0.1rem; }
.psm-field { display: flex; flex-direction: column; gap: 0.25rem; }
.psm-textarea { resize: vertical; min-height: 56px; }
.psm-actions { display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: 1.1rem; }
.psm-btn { display: inline-flex; align-items: center; gap: 0.45rem; font-family: inherit;
  font-size: 0.92rem; font-weight: 600; padding: 0.55rem 1.1rem; border-radius: 9px; cursor: pointer; border: 1px solid var(--color-border); }
.psm-btn-secondary { background: var(--color-bg); color: var(--color-text); }
.psm-btn-secondary:hover { border-color: var(--color-primary-light); }
.psm-btn-primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.psm-btn-primary:hover { background: var(--color-primary-dark); }
@media (max-width: 640px) {
  .psm-panel { width: calc(100vw - 1rem); border-radius: 12px; }
}
```

- [ ] **Step 4: Init in app.js**

In `js/app.js`, near the other modal inits (search for `initPromptModal`), add the
import and call:
```javascript
import { initPromptSubmitModal } from './components/prompt-submit-modal.js';
```
and, wherever `initPromptModal()` is invoked at startup, add `initPromptSubmitModal();`
right after it.

- [ ] **Step 5: Syntax check + commit**

Run: `node --check js/components/prompt-submit-modal.js && node --check js/app.js`
Expected: exit 0 for both.

```bash
git add js/components/prompt-submit-modal.js css/styles.css js/app.js
git commit -m "Add centered Prompt Submission modal component + styles"
```

---

### Task 4: Wire the sidebar trigger + open the modal

**Files:**
- Modify: `js/app.js` (the `shortcuts-multi-submit-wrap` markup ~line 1408, and the
  multi-select wiring ~lines 1548–1751)

- [ ] **Step 1: Replace the inline bar markup with a trigger**

In `js/app.js`, replace the entire `<div class="shortcuts-multi-submit-wrap" ...> ... </div>`
block (the one containing `multi-controls-head`, `multi-controls-model-row`, and
`multi-controls-buttons`) with this compact trigger:

```javascript
        <div class="shortcuts-multi-submit-wrap" role="region" aria-label="Prompt submission" aria-hidden="true">
          <span class="shortcuts-multi-count" aria-live="polite">
            <strong id="shortcuts-multi-submit-count">0</strong>
            <span class="shortcuts-multi-count-label"> shortcuts selected</span>
          </span>
          <div class="shortcuts-multi-trigger-utils">
            <button type="button" class="shortcuts-multi-clear" id="shortcuts-multi-clear">Clear</button>
            <button type="button" class="shortcuts-multi-review" id="shortcuts-multi-review">
              <span>Review &amp; Submit</span>
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="8" x2="12" y2="8"/><polyline points="8 4 12 8 8 12"/></svg>
            </button>
          </div>
        </div>
```

- [ ] **Step 2: Update the JS handles + remove dead refs**

In `renderShortcutsSidebar` (around lines 1548–1556), the code currently grabs
`submitBtn` (`#shortcuts-multi-submit`), `previewBtn` (`#shortcuts-multi-preview`),
`selectAllBtn` (`#shortcuts-multi-select-all`), `modelBtn`, `modelMenu`, etc. Replace
that block of `querySelector` lookups with:

```javascript
  const reviewBtn = container.querySelector('#shortcuts-multi-review');
  const clearBtn = container.querySelector('#shortcuts-multi-clear');
  const submitWrap = container.querySelector('.shortcuts-multi-submit-wrap');
  const countEl = container.querySelector('#shortcuts-multi-submit-count');
```

Delete the now-unused model-picker wiring in this function: the `modelBtn` / `modelMenu`
/ `multi-controls-model-*` setup block and its event listeners (the dropdown lived in
the inline bar, which no longer exists; the modal owns the model `<select>`). Keep
`refreshModelChoice()` — it's reused — but simplify it to just return the current model
object without writing to a now-removed label element:

```javascript
  const refreshModelChoice = () => {
    const models = getModels();
    const preferredId = getPreferredModelId(getDefaultModelId());
    return getModelById(preferredId) || models[0] || null;
  };
```

- [ ] **Step 3: Update `updateSubmit()` for the trigger**

Find `updateSubmit` (~line 1616). Replace its body's button-state lines (which
referenced `submitBtn`, `previewBtn`, `selectAllBtn`) with trigger-aware logic:

```javascript
    const selected = container.querySelectorAll('.ai-shortcut-select-btn.is-multi-selected');
    const has = selected.length > 0;
    submitWrap.classList.toggle('is-visible', has);
    submitWrap.setAttribute('aria-hidden', has ? 'false' : 'true');
    if (reviewBtn) reviewBtn.disabled = !has;
    if (clearBtn) clearBtn.disabled = !has;
    if (countEl) countEl.textContent = String(selected.length);
```

- [ ] **Step 4: Make `buildSubmission` return the BASE (no reasoning)**

Find `buildSubmission` (~line 1633). Remove the `applyReasoningLevelToPrompt(...)`
wrapping so it returns the bare combined prompt (reasoning is now added by
`assemblePrompt`). The single-selection branch becomes `prompt: btn.dataset.prompt || ''`
and the multi branch becomes `prompt: \`${intro}\n\n${combined}\``. Leave `name`,
`iconKey`, `count` unchanged. (The `applyReasoningLevelToPrompt` import can be removed
from app.js if it has no other use — grep first.)

- [ ] **Step 5: Replace preview/submit/select-all handlers with the modal open**

Replace the `previewBtn?.addEventListener(...)`, `submitBtn?.addEventListener(...)`,
and `selectAllBtn?.addEventListener(...)` blocks (~lines 1710–1751) with a single
review-button handler that opens the modal and passes callbacks. Add this import at the
top of app.js if not present: `import { assemblePrompt } from './utils/prompt-assembly.js';`
and ensure `getModels`, `getPreferredModelId`, `setPreferredModelId`, `submitPrompt`
are already imported (they are). Then:

```javascript
  const selectAllShortcuts = () => {
    container.querySelectorAll('.ai-shortcut-select-btn').forEach(b => {
      b.classList.add('is-multi-selected'); b.setAttribute('aria-pressed', 'true');
    });
    updateSubmit();
  };
  const clearShortcuts = () => {
    container.querySelectorAll('.ai-shortcut-select-btn.is-multi-selected').forEach(b => {
      b.classList.remove('is-multi-selected'); b.setAttribute('aria-pressed', 'false');
    });
    updateSubmit();
  };
  const selectionInfo = () => {
    const all = container.querySelectorAll('.ai-shortcut-select-btn');
    const sel = container.querySelectorAll('.ai-shortcut-select-btn.is-multi-selected');
    return { count: sel.length, allSelected: all.length > 0 && sel.length === all.length };
  };

  clearBtn?.addEventListener('click', clearShortcuts);

  reviewBtn?.addEventListener('click', () => {
    const info = selectionInfo();
    if (info.count === 0) return;
    const model = refreshModelChoice();
    window.dispatchEvent(new CustomEvent('open-submit-modal', {
      detail: {
        count: info.count,
        allSelected: info.allSelected,
        topicName: topicName,
        selectedModelId: model ? model.id : getDefaultModelId(),
        callbacks: {
          onSelectAll: selectAllShortcuts,
          onClear: clearShortcuts,
          onSetModel: (id) => setPreferredModelId(id),
          getSelectionInfo: selectionInfo,
          buildBase: () => { const s = buildSubmission(); return s ? s : null; },
          onPreview: (sub, opts) => {
            const prompt = assemblePrompt(sub.prompt, opts);
            window.dispatchEvent(new CustomEvent('open-prompt-modal', {
              detail: { prompt, name: sub.name, iconKey: sub.iconKey, count: sub.count },
            }));
          },
          onDirectSubmit: async (sub, opts) => {
            const m = refreshModelChoice();
            if (!m) return;
            const prompt = assemblePrompt(sub.prompt, opts);
            track('direct_submit', { model: m.id, count: sub.count, route: window.location.hash || '#/' });
            try { await submitPrompt(m, prompt); } catch (err) { console.error('Direct submit failed', err); }
          },
        },
      },
    }));
  });
```

Note: the modal's `buildBase()` callback expects the **submission object** (`{prompt,
name, iconKey, count}`), and `onPreview`/`onDirectSubmit` receive that object as `sub`
plus the advanced `opts`. The component (Task 3) calls `buildBase()` then passes its
result to `onPreview`/`onDirectSubmit` — so update the component's `wire()` preview/
submit handlers to treat the base as the submission object (they already pass it
through as the first arg). No further change needed.

- [ ] **Step 6: Add trigger-bar CSS**

Append to `css/styles.css`:

```css
.shortcuts-multi-trigger-utils { display: inline-flex; align-items: center; gap: 0.6rem; }
.shortcuts-multi-review { display: inline-flex; align-items: center; gap: 0.4rem;
  background: var(--color-primary); color: #fff; border: 1px solid var(--color-primary);
  font-family: inherit; font-weight: 600; font-size: 0.9rem; padding: 0.5rem 0.9rem;
  border-radius: 9px; cursor: pointer; }
.shortcuts-multi-review:hover { background: var(--color-primary-dark); }
.shortcuts-multi-review:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 7: Syntax check + commit**

Run: `node --check js/app.js && node tools/test_prompt_assembly.mjs`
Expected: exit 0; `OK: assemblePrompt`.

```bash
git add js/app.js css/styles.css
git commit -m "Wire sidebar 'Review & Submit' trigger to the new submission modal"
```

---

### Task 5: Browser integration verification

**Files:** none (verification only)

- [ ] **Step 1: Serve**

Run: `(python3 -m http.server 8753 >/tmp/st.log 2>&1 &) ; sleep 1 ; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8753/`
Expected: `200`

- [ ] **Step 2: Verify the flow with Playwright**

Load `http://localhost:8753/#/topic/fintech`, open a Discover/Learn/Analyze accordion,
click two shortcut rows to select them, then click **Review & Submit**. Confirm:
- The trigger bar reads "2 shortcuts selected" and has Clear + Review & Submit.
- The modal opens centered with title "Prompt Submission", eyebrow "AI Shortcuts",
  "2 shortcuts selected", Select all / Clear, a Send-to `<select>`, an Advanced settings
  toggle (collapsed), and Preview + Direct Submit.
- Expanding Advanced settings shows Reasoning level, Output type, Secondary topics,
  Custom instructions in that order.
- Setting Output type + Secondary topics + Custom instructions, then clicking Preview,
  opens the prompt-modal whose text contains the base prompts AND the injected clauses
  (output clause with the topic name, secondary clause, custom instructions).
- Zero `pageerror`/console errors.

- [ ] **Step 3: Verify settings round-trip**

Open the Settings modal, confirm the Custom instructions textarea reflects what was
typed in the modal (and vice versa), and that Reasoning level matches. Confirm no
errors.

- [ ] **Step 4: Mobile spot check**

Resize to 390px wide, repeat the open: modal is full-width with tappable controls.

- [ ] **Step 5: Stop the server**

Run: `pkill -f "http.server 8753"`

---

## Self-Review Notes

- **Spec coverage:** centered modal + title (Task 3); "N shortcuts selected" wording
  (Task 3 `psm-count`, Task 4 trigger); Select all/Clear positioning (Task 3); model
  picker (Task 3); Advanced accordion with the 4 fields in order (Task 3); split
  persistence — Reasoning+Custom via settings.js (Task 2) read/written in modal (Task
  3), Output+Secondary per-submission reset on `open()` (Task 3 `perSubmission` reset);
  `assemblePrompt` order (Task 1); Preview opens prompt-modal with assembled prompt,
  Direct Submit sends it (Task 4); sidebar → "Review & Submit →" trigger, no competing
  direct submit (Task 4); native styling via tokens (Task 3 CSS); a11y Esc/focus (Task
  3); mobile (Task 3 CSS, Task 5).
- **Type consistency:** `assemblePrompt(base, opts)` with keys
  `reasoningHint/outputClause/secondaryTopic/secondaryClauseTpl/customInstructions/topicName`
  is identical across Task 1 (test+impl) and Task 3 (`currentAdvancedOpts`). The
  `open-submit-modal` detail contract (`count, allSelected, topicName, selectedModelId,
  callbacks{onSelectAll,onClear,onSetModel,getSelectionInfo,buildBase,onPreview,
  onDirectSubmit}`) matches between Task 3 (consumer) and Task 4 (producer).
- **Known follow-up to confirm at execution:** `escapeHTML` import path (Task 3 Step 2)
  and that removing the inline model-picker doesn't orphan CSS (harmless if left).
