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

// Copy text to the clipboard (best-effort). Returns true on success.
// Used to copy the prompt the moment a model is expanded, so the actual
// submit click can open the model synchronously (see openModel).
export async function copyPrompt(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (_) { return false; }
}

// Open the model's URL in a new tab. SYNCHRONOUS — no await before
// window.open, so the call stays inside the user's click gesture and is
// not caught by the browser's popup blocker. The prompt is expected to
// already be on the clipboard (copied on model-expand).
export function openModel(model, prompt) {
  const url = buildPromptUrl(model, prompt);
  window.open(url, '_blank');
  return url;
}

export function fillPromptTemplate(template, topicName) {
  return template.replace(/\{topic\}/gi, topicName);
}
