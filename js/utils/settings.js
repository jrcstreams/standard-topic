// User-facing session settings — values reset when the browser
// session ends (sessionStorage) so they're per-device and per-
// session. The Settings modal reads + writes through these helpers.

const KEYS = {
  defaultModelId: 'st_settings_default_model_id',
  reasoningLevel: 'st_settings_reasoning_level',
  customInstructions: 'st_settings_custom_instructions',
};

function read(key) {
  try { return sessionStorage.getItem(key); } catch (_) { return null; }
}

function write(key, value) {
  try {
    if (value === null || value === undefined || value === '') {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, value);
    }
  } catch (_) { /* ignore */ }
}

export function getDefaultModelOverride() {
  return read(KEYS.defaultModelId);
}

export function setDefaultModelOverride(modelId) {
  write(KEYS.defaultModelId, modelId);
}

// Reasoning-level options. The `hint` is prepended to the prompt
// when the user submits, nudging the AI to match the requested
// depth. Standard sends no hint (just the bare prompt).
export const REASONING_LEVELS = [
  { id: 'brief',    name: 'Brief',    desc: 'Quick, scannable answer.',                          hint: 'Keep your response concise — a tight summary in just a few sentences. Skip preamble and stick to the essentials.' },
  { id: 'standard', name: 'Standard', desc: 'Balanced response — the default.',                  hint: '' },
  { id: 'detailed', name: 'Detailed', desc: 'Thorough response with structure and context.',    hint: 'Provide a thorough response with clear structure (headings or lists where useful) and supporting context. Cover the key facets without rambling.' },
  { id: 'deep',     name: 'Deep',     desc: 'In-depth analysis covering nuance and edge cases.', hint: 'Provide an in-depth analysis. Cover nuances, edge cases, counter-arguments, supporting evidence, and underlying assumptions. Organize the response logically.' },
];

export function getReasoningLevel() {
  return read(KEYS.reasoningLevel) || 'standard';
}

export function setReasoningLevel(levelId) {
  write(KEYS.reasoningLevel, levelId);
}

export function getReasoningHint() {
  const level = REASONING_LEVELS.find(l => l.id === getReasoningLevel());
  return level?.hint || '';
}

// Wraps a prompt with the current reasoning-level hint, if any.
export function applyReasoningLevelToPrompt(prompt) {
  const hint = getReasoningHint();
  if (!hint) return prompt;
  return `${hint}\n\n${prompt}`;
}

// Free-text instructions appended to every submitted prompt this session.
export function getCustomInstructions() {
  return read(KEYS.customInstructions) || '';
}

export function setCustomInstructions(text) {
  write(KEYS.customInstructions, (text || '').trim());
}
