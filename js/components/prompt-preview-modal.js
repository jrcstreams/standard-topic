// Live Prompt Preview modal — opens from the "Preview" pill in the
// prompt-generator subnav. Shows the currently-assembled prompt in a
// focused modal, independent of how far the user has scrolled in the
// wizard body.

import { getAssembledPrompt } from './prompt-generator.js';

let overlayEl = null;

export function initPromptPreviewModal() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'prompt-preview-modal-overlay';
  overlayEl.style.display = 'none';
  document.body.appendChild(overlayEl);

  window.addEventListener('open-prompt-preview-modal', () => open());

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') close();
  });
}

function open() {
  const prompt = getAssembledPrompt();
  const isEmpty = !prompt;

  overlayEl.innerHTML = `
    <div class="prompt-preview-modal-card" role="dialog" aria-label="Live prompt preview">
      <button type="button" class="prompt-preview-modal-close" aria-label="Close">✕</button>
      <div class="prompt-preview-modal-head">
        <span class="prompt-preview-modal-dot" aria-hidden="true"></span>
        <h3 class="prompt-preview-modal-title">Live Prompt Preview</h3>
      </div>
      <div class="prompt-preview-modal-body ${isEmpty ? 'is-empty' : ''}">
        ${isEmpty ? 'Fill in a Primary Topic to see your prompt build here…' : escapeHTML(prompt)}
      </div>
      ${isEmpty ? '' : `
        <div class="prompt-preview-modal-foot">
          <button type="button" class="prompt-preview-modal-copy" id="prompt-preview-copy">📋 Copy Prompt</button>
          <span class="prompt-preview-modal-hint">Updates live as you refine options.</span>
        </div>
      `}
    </div>
  `;
  overlayEl.style.display = 'flex';

  overlayEl.querySelector('.prompt-preview-modal-close').addEventListener('click', close);
  const copyBtn = overlayEl.querySelector('#prompt-preview-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(prompt);
      const orig = copyBtn.textContent;
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyBtn.textContent = orig; }, 1600);
    });
  }
}

function close() {
  overlayEl.style.display = 'none';
  overlayEl.innerHTML = '';
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
