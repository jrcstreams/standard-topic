// Settings modal — session-scoped preferences. Two settings for
// now: default AI model + reasoning level. Both reset when the
// browser session ends (per-device).
//
// Edits are staged in a `pending` object — Save Changes commits
// them to sessionStorage; Cancel discards them; Reset to site
// default snaps pending back to the admin-configured defaults.

import { getModels, getDefaultModelId } from '../utils/data.js';
import {
  getDefaultModelOverride, setDefaultModelOverride,
  getReasoningLevel, setReasoningLevel,
  REASONING_LEVELS,
} from '../utils/settings.js';

let overlayEl = null;
let pending = null;   // { modelId, reasoningId }
let saved = null;     // snapshot of what's in sessionStorage on open

export function initSettingsModal() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'settings-modal-overlay';
  overlayEl.style.display = 'none';
  overlayEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlayEl);

  window.addEventListener('open-settings-modal', () => open());

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) { tryClose(); return; }
    if (e.target.closest('[data-action="close"]')) { tryClose(); return; }
    if (e.target.closest('[data-action="cancel"]')) { cancelChanges(); return; }
    if (e.target.closest('[data-action="save"]'))   { saveChanges(); return; }
    if (e.target.closest('[data-action="reset"]'))  { resetToDefault(); return; }
    const modelOpt = e.target.closest('.settings-option[data-setting="model"]');
    if (modelOpt) {
      pending.modelId = modelOpt.dataset.value;
      render();
      return;
    }
    const reasonOpt = e.target.closest('.settings-option[data-setting="reasoning"]');
    if (reasonOpt) {
      pending.reasoningId = reasonOpt.dataset.value;
      render();
      return;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') tryClose();
  });
}

function open() {
  if (!overlayEl) initSettingsModal();
  // Snapshot current values into "saved" baseline. Pending starts
  // identical and diverges as the user toggles options.
  const adminDefault = getDefaultModelId();
  saved = {
    modelId: getDefaultModelOverride() || adminDefault,
    reasoningId: getReasoningLevel(),
  };
  pending = { ...saved };
  render();
  overlayEl.style.display = 'flex';
  overlayEl.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function close() {
  if (!overlayEl) return;
  overlayEl.style.display = 'none';
  overlayEl.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  pending = null;
  saved = null;
}

function isDirty() {
  return pending && saved && (
    pending.modelId !== saved.modelId ||
    pending.reasoningId !== saved.reasoningId
  );
}

function tryClose() {
  if (isDirty()) {
    const ok = window.confirm('Discard unsaved changes?');
    if (!ok) return;
  }
  close();
}

function saveChanges() {
  if (!pending) return;
  const adminDefault = getDefaultModelId();
  // Only persist a model override if it differs from the admin default
  // — otherwise clear the override so "default" stays semantically true.
  if (pending.modelId && pending.modelId !== adminDefault) {
    setDefaultModelOverride(pending.modelId);
  } else {
    setDefaultModelOverride(null);
  }
  setReasoningLevel(pending.reasoningId);
  saved = { ...pending };
  // Notify any open panels (e.g. the shortcuts multi-controls model
  // picker) so they re-read the preference instead of showing the
  // stale value they captured at render time.
  window.dispatchEvent(new CustomEvent('preferred-model-changed'));
  close();
}

function cancelChanges() {
  // Cancel always closes — no need to re-render the modal back to
  // its saved baseline.
  close();
}

function resetToDefault() {
  const adminDefault = getDefaultModelId();
  pending = { modelId: adminDefault, reasoningId: 'standard' };
  render();
}

function render() {
  const models = getModels();
  const adminDefaultId = getDefaultModelId();
  const dirty = isDirty();

  const modelChips = models.map(m => {
    const isCurrent = m.id === pending.modelId;
    const isAdminDefault = m.id === adminDefaultId;
    return `
      <button type="button"
              class="settings-option ${isCurrent ? 'is-selected' : ''}"
              data-setting="model"
              data-value="${escapeAttr(m.id)}"
              aria-pressed="${isCurrent}">
        <span class="settings-option-label">${escapeHTML(m.name)}</span>
        ${isAdminDefault ? '<span class="settings-option-tag">default</span>' : ''}
      </button>
    `;
  }).join('');

  const reasoningChips = REASONING_LEVELS.map(l => {
    const isCurrent = l.id === pending.reasoningId;
    return `
      <button type="button"
              class="settings-option settings-option-stacked ${isCurrent ? 'is-selected' : ''}"
              data-setting="reasoning"
              data-value="${escapeAttr(l.id)}"
              aria-pressed="${isCurrent}">
        <span class="settings-option-label">${escapeHTML(l.name)}</span>
        <span class="settings-option-desc">${escapeHTML(l.desc)}</span>
      </button>
    `;
  }).join('');

  overlayEl.innerHTML = `
    <div class="settings-modal-card" role="dialog" aria-label="Settings">
      <header class="settings-modal-head">
        <div class="settings-modal-head-text">
          <h2 class="settings-modal-title">
            <span class="settings-modal-title-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </span>
            <span>Settings</span>
          </h2>
          <p class="settings-modal-intro">Tune your Standard Topic experience. Choices reset when your browser session ends.</p>
        </div>
        <button class="settings-modal-close" type="button" data-action="close" aria-label="Close settings">✕</button>
      </header>

      <div class="settings-modal-body">
        <section class="settings-section">
          <div class="settings-section-head">
            <h3 class="settings-section-title">Default AI model</h3>
            <p class="settings-section-desc">Preset for new prompt submissions. You can still switch models inside any prompt modal.</p>
          </div>
          <div class="settings-option-grid">${modelChips}</div>
        </section>

        <section class="settings-section">
          <div class="settings-section-head">
            <h3 class="settings-section-title">Reasoning level</h3>
            <p class="settings-section-desc">Depth of response added to every prompt before it's submitted.</p>
          </div>
          <div class="settings-option-grid settings-option-grid-stacked">${reasoningChips}</div>
        </section>
      </div>

      <footer class="settings-modal-foot">
        <button type="button" class="settings-modal-btn settings-modal-btn-reset" data-action="reset">
          Reset to site default
        </button>
        <div class="settings-modal-foot-right">
          <button type="button" class="settings-modal-btn settings-modal-btn-secondary" data-action="cancel" ${dirty ? '' : 'disabled'}>
            Cancel
          </button>
          <button type="button" class="settings-modal-btn settings-modal-btn-primary ${dirty ? 'is-active' : ''}" data-action="save" ${dirty ? '' : 'disabled'}>
            Save changes
          </button>
        </div>
      </footer>
    </div>
  `;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;').replace(/&/g, '&amp;');
}
