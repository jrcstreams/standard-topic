// AI model URL building and prompt submission

import { getDefaultModelOverride, setDefaultModelOverride } from './settings.js';

const MAX_URL_LENGTH = 2000;

// Session-scoped preferred model. Reads from the user's Settings
// override (sessionStorage). Falls back to the data-defined default
// (admin-configured) which is passed in by callers.
export function getPreferredModelId(defaultId) {
  return getDefaultModelOverride() || defaultId;
}

export function setPreferredModelId(modelId) {
  setDefaultModelOverride(modelId);
}

// True when the model's URL template contains a {prompt} placeholder
// (meaning we can pre-fill the prompt via URL).
export function supportsUrlPrompt(model) {
  return !!model?.urlTemplate?.includes('{prompt}');
}

// True when the model is configured to copy the prompt to clipboard
// before opening (default true unless explicitly disabled per-model).
export function shouldCopyOnOpen(model) {
  return model?.copyOnOpen !== false;
}

export function buildPromptUrl(model, prompt) {
  if (!supportsUrlPrompt(model)) return model.urlTemplate;
  const encoded = encodeURIComponent(prompt);
  return model.urlTemplate.replace('{prompt}', encoded);
}

export function isUrlTooLong(model, prompt) {
  if (!supportsUrlPrompt(model)) return false;
  const url = buildPromptUrl(model, prompt);
  return url.length > MAX_URL_LENGTH;
}

// Submit a prompt to a model.
// Default behavior: copy the prompt to the clipboard, then open the model's
// URL in a new tab (with prompt pre-filled if the URL template supports it).
// If the model has copyOnOpen: false, the clipboard step is skipped.
export async function submitPrompt(model, prompt) {
  const copying = shouldCopyOnOpen(model);
  if (copying) {
    try { await navigator.clipboard.writeText(prompt); } catch (_) {}
  }
  const url = buildPromptUrl(model, prompt);
  window.open(url, '_blank');
  return { copied: copying, url, supportsUrlPrompt: supportsUrlPrompt(model) };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Submit with a brief loading animation that overtakes `hostEl`: copies the
// prompt to the clipboard, shows a bar that fills to 100% with a
// "Prompt copied… Taking you to {model}" subtext, then navigates to the model.
export async function submitWithLoading(model, prompt, hostEl) {
  const copying = shouldCopyOnOpen(model);
  if (copying) {
    try { await navigator.clipboard.writeText(prompt); } catch (_) {}
  }
  const url = buildPromptUrl(model, prompt);
  const name = model?.name || 'the model';
  if (hostEl) {
    hostEl.innerHTML = `
      <div class="submit-loading" role="status" aria-live="polite">
        <div class="submit-loading-bar"><span class="submit-loading-fill"></span></div>
        <div class="submit-loading-sub">${copying ? 'Prompt copied to clipboard. ' : ''}Taking you to ${escapeHtml(name)}…</div>
      </div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const fill = hostEl.querySelector('.submit-loading-fill');
      if (fill) fill.style.width = '100%';
    }));
  }
  await new Promise(r => setTimeout(r, 1350));
  window.location.href = url;
  return { copied: copying, url };
}

export function fillPromptTemplate(template, topicName) {
  return template.replace(/\{topic\}/gi, topicName);
}
