// Knowledge Prompt Generator page

import { getPromptGenData, getModels, getDefaultModelId, getModelById } from '../utils/data.js';
import { getPreferredModelId, setPreferredModelId } from '../utils/ai-models.js';

export function renderPromptGenerator(container) {
  const pgData = getPromptGenData();
  const fields = pgData.fields;
  const models = getModels();

  // Group fields by row
  const rows = {};
  fields.forEach(f => {
    if (!rows[f.row]) rows[f.row] = [];
    rows[f.row].push(f);
  });

  let html = `
    <div class="section-header">
      <span class="section-icon">⚙️</span>
      <h2>AI Knowledge Prompt Generator</h2>
    </div>

    <div class="pg-summary-section">
      <label class="pg-label">Knowledge Prompt Summary</label>
      <div class="pg-summary" id="pg-summary">Fill in at least a Primary Topic to see your prompt build here...</div>
    </div>

    <div class="pg-form" id="pg-form">
  `;

  Object.keys(rows).sort().forEach(rowNum => {
    html += `<div class="pg-row">`;
    rows[rowNum].forEach(field => {
      html += renderField(field, models);
    });
    html += `</div>`;
  });

  html += `
    </div>

    <div class="pg-customizations">
      <label class="pg-label">Customizations</label>
      <textarea class="pg-textarea" id="pg-customizations" placeholder="Add additional instructions here"></textarea>
    </div>

    <div class="pg-actions">
      <button class="pg-btn pg-btn-primary" id="pg-submit">Submit Prompt</button>
      <button class="pg-btn pg-btn-secondary" id="pg-copy">Copy Prompt Text</button>
      <button class="pg-btn pg-btn-danger" id="pg-clear">Clear Prompt</button>
      <button class="pg-btn pg-btn-outline" id="pg-open-model">Open Model</button>
    </div>

    <ul class="pg-notes">
      <li>Prompt submission will open a new tab and directly submit or queue a prompt through the chosen AI model/platform.</li>
      <li>Some pre-generated prompts may be too long to submit through this site. You may use the "Copy Prompt" button and then the "Open Model" to manually submit the full prompt.</li>
    </ul>
  `;

  container.innerHTML = html;

  const form = document.getElementById('pg-form');
  const summary = document.getElementById('pg-summary');
  const customizations = document.getElementById('pg-customizations');

  const updatePreview = () => {
    const prompt = assemblePrompt(pgData, form, customizations.value);
    if (!prompt) {
      summary.textContent = 'Fill in at least a Primary Topic to see your prompt build here...';
      summary.classList.add('pg-summary-empty');
    } else {
      summary.textContent = prompt;
      summary.classList.remove('pg-summary-empty');
    }
  };

  // Listen for BOTH change (select) and input (text) events
  form.addEventListener('change', updatePreview);
  form.addEventListener('input', updatePreview);
  customizations.addEventListener('input', updatePreview);

  document.getElementById('pg-submit').addEventListener('click', () => {
    const prompt = assemblePrompt(pgData, form, customizations.value);
    if (!prompt) {
      summary.textContent = 'Please fill in at least a Primary Topic to generate a prompt.';
      summary.classList.add('pg-summary-error');
      setTimeout(() => summary.classList.remove('pg-summary-error'), 2500);
      return;
    }
    window.dispatchEvent(new CustomEvent('open-prompt-modal', {
      detail: { prompt, name: 'Knowledge Prompt' },
    }));
  });

  document.getElementById('pg-copy').addEventListener('click', async () => {
    const prompt = assemblePrompt(pgData, form, customizations.value);
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    const btn = document.getElementById('pg-copy');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });

  document.getElementById('pg-clear').addEventListener('click', () => {
    form.querySelectorAll('select').forEach(s => { s.selectedIndex = 0; });
    form.querySelectorAll('input[type="text"]').forEach(i => { i.value = ''; });
    customizations.value = '';
    updatePreview();
  });

  document.getElementById('pg-open-model').addEventListener('click', () => {
    const modelSelect = form.querySelector('[data-field="model"]');
    const modelId = modelSelect?.value || getPreferredModelId(getDefaultModelId());
    const model = getModelById(modelId);
    if (model) {
      window.open(model.urlTemplate.replace('{prompt}', ''), '_blank');
    }
  });
}

function renderField(field, models) {
  if (field.type === 'model-select') {
    const defaultId = getPreferredModelId(getDefaultModelId());
    const options = models.map(m =>
      `<option value="${m.id}" ${m.id === defaultId ? 'selected' : ''}>${escapeHTML(m.name)}</option>`
    ).join('');
    return `
      <div class="pg-field">
        <label class="pg-field-label">${escapeHTML(field.label)}</label>
        <select class="pg-select" data-field="${field.key}">
          ${options}
        </select>
      </div>
    `;
  }

  if (field.type === 'text') {
    return `
      <div class="pg-field">
        <label class="pg-field-label">${escapeHTML(field.label)}</label>
        <input type="text" class="pg-input" data-field="${field.key}" placeholder="${field.placeholder || 'Type here'}">
      </div>
    `;
  }

  const options = (field.options || []).map(o =>
    `<option value="${o.value}">${escapeHTML(o.label)}</option>`
  ).join('');

  return `
    <div class="pg-field">
      <label class="pg-field-label">${escapeHTML(field.label)}</label>
      <select class="pg-select" data-field="${field.key}">
        <option value="">Select here</option>
        ${options}
      </select>
    </div>
  `;
}

// Fixed assembly logic:
// - Returns empty string if no primary topic (caller shows placeholder)
// - Uses contentType clause as opener if selected, otherwise base template
// - Each other field contributes ONE natural clause, joined with proper flow
// - No duplication, no contradiction between clauses
// - Only adds closing line if we have multiple parts (feels tacked on otherwise)
function assemblePrompt(pgData, form, customizations) {
  const fields = pgData.fields;
  const getValue = (key) => {
    const el = form.querySelector(`[data-field="${key}"]`);
    return el?.value?.trim() || '';
  };

  const primaryTopic = getValue('primaryTopic');
  const secondaryTopic = getValue('secondaryTopic');

  // Empty state — caller will show placeholder
  if (!primaryTopic) return '';

  const substitute = (text) => text
    .replace(/\{primary_topic\}/g, primaryTopic)
    .replace(/\{secondary_topic\}/g, secondaryTopic || primaryTopic);

  // 1. Opener: contentType clause OR base template
  const contentTypeValue = getValue('contentType');
  let opener;
  if (contentTypeValue) {
    const contentTypeField = fields.find(f => f.key === 'contentType');
    const option = contentTypeField?.options?.find(o => o.value === contentTypeValue);
    opener = option?.clause ? substitute(option.clause) + '.' : substitute(pgData.baseTemplate);
  } else {
    opener = substitute(pgData.baseTemplate);
  }

  // 2. Supporting clauses from other fields (excluding primaryTopic, secondaryTopic, model, contentType)
  const supportingKeys = ['contentGeneration', 'sources', 'recency', 'citations', 'format', 'length', 'audience', 'tone', 'geographic'];
  const supportingClauses = [];
  supportingKeys.forEach(key => {
    const value = getValue(key);
    if (!value) return;
    const field = fields.find(f => f.key === key);
    const option = field?.options?.find(o => o.value === value);
    if (option?.clause) {
      supportingClauses.push(substitute(option.clause) + '.');
    }
  });

  // 3. Secondary topic clause
  const secondaryClause = (secondaryTopic && pgData.secondaryTopicClause)
    ? substitute(pgData.secondaryTopicClause)
    : null;

  // 4. User customizations
  const customText = (customizations || '').trim();
  const customClause = customText ? `Additional instructions: ${customText}` : null;

  // Assemble
  const parts = [opener];
  if (supportingClauses.length > 0) {
    parts.push(supportingClauses.join(' '));
  }
  if (secondaryClause) parts.push(secondaryClause);
  if (customClause) parts.push(customClause);

  // Only add closing line if we have supporting content — otherwise it feels tacked on
  if (supportingClauses.length > 0 || secondaryClause || customClause) {
    parts.push(pgData.closingLine);
  }

  return parts.join('\n\n');
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
