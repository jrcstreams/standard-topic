// Prompt Builder modal — the prompt generator now lives in a centered takeover
// modal (matching the Search / Topics / Trends modals) instead of a full page.
// Opened by the #/prompt-generator route (rendered over the home layout, like
// the Search modal). The builder UI itself is the existing renderPromptGenerator
// wizard, rendered into the modal body.

import { renderPromptGenerator } from './prompt-generator.js?v=20260706-revamp504';
import { navigate } from '../utils/router.js';

let overlayEl = null;

const X = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

// Phase 6: the Prompt Builder now runs in the shared full-width nav dropdown
// (see openPromptBuilderNavDropdown in app.js), not this takeover. Kept as a
// no-op so the import site stays stable; the old modal is retired.
export function initPromptBuilderModal() { /* retired — builder lives in the nav dropdown */ }

function isOpen() { return overlayEl && overlayEl.style.display !== 'none'; }

export function openPromptBuilderModal() {
  if (!overlayEl) return;
  // Route can re-fire while already open (e.g. a child picker navigates) —
  // don't tear down the in-progress builder.
  if (isOpen()) return;
  // Fresh open — close any other top-level modal first.
  window.dispatchEvent(new CustomEvent('close-all-modals'));
  overlayEl.innerHTML = `
    <div class="pbm-panel" role="dialog" aria-modal="true" aria-label="Prompt Builder">
      <button type="button" class="pbm-close" aria-label="Close">${X}</button>
      <div class="pbm-head">
        <h2 class="pbm-title">Prompt Builder</h2>
        <p class="pbm-subtext">Build a knowledge prompt and send it to your AI model.</p>
      </div>
      <div class="pbm-body" id="pbm-body"></div>
    </div>`;
  overlayEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  overlayEl.querySelector('.pbm-close').addEventListener('click', userClose);
  renderPromptGenerator(overlayEl.querySelector('#pbm-body'));
}

export function closePromptBuilderModal() {
  if (!isOpen()) return;
  overlayEl.style.display = 'none';
  overlayEl.innerHTML = '';
  document.body.style.overflow = '';
}

// ✕ / overlay / Esc: close and, if we're on the #/prompt-generator deep-link,
// return home so the URL reflects the dismissed modal.
function userClose() {
  const onRoute = (window.location.hash || '').startsWith('#/prompt-generator');
  closePromptBuilderModal();
  if (onRoute) navigate('#/');
}
