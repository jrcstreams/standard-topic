// AI model URL building and prompt submission

const STORAGE_KEY = 'standardtopic_preferred_model';
const MAX_URL_LENGTH = 2000;

export function getPreferredModelId(defaultId) {
  return localStorage.getItem(STORAGE_KEY) || defaultId;
}

export function setPreferredModelId(modelId) {
  localStorage.setItem(STORAGE_KEY, modelId);
}

export function buildPromptUrl(model, prompt) {
  const encoded = encodeURIComponent(prompt);
  const url = model.urlTemplate.replace('{prompt}', encoded);
  return url;
}

export function isUrlTooLong(model, prompt) {
  if (model.method === 'clipboard') return false;
  const url = buildPromptUrl(model, prompt);
  return url.length > MAX_URL_LENGTH;
}

export async function submitPrompt(model, prompt) {
  if (model.method === 'clipboard') {
    await navigator.clipboard.writeText(prompt);
    window.open(model.urlTemplate, '_blank');
    return { method: 'clipboard', copied: true };
  }

  const url = buildPromptUrl(model, prompt);
  window.open(url, '_blank');
  return { method: 'url', url };
}

export function fillPromptTemplate(template, topicName) {
  return template.replace(/\{topic\}/g, topicName);
}
