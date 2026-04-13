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
      <div class="pg-summary" id="pg-summary">Select options below to build your prompt...</div>
    </div>

    <div class="pg-form" id="pg-form">
  `;

  // Render rows
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

  // Live preview updates
  const form = document.getElementById('pg-form');
  const summary = document.getElementById('pg-summary');
  const customizations = document.getElementById('pg-customizations');

  const updatePreview = () => {
    summary.textContent = assemblePrompt(pgData, form, customizations.value);
  };

  form.addEventListener('change', updatePreview);
  customizations.addEventListener('input', updatePreview);

  // Actions
  document.getElementById('pg-submit').addEventListener('click', () => {
    const prompt = assemblePrompt(pgData, form, customizations.value);
    if (!prompt || prompt === pgData.baseTemplate.replace('{primary_topic}', '').trim()) {
      summary.textContent = 'Please fill in at least a Primary Topic to generate a prompt.';
      return;
    }
    window.dispatchEvent(new CustomEvent('open-prompt-modal', {
      detail: { prompt, name: 'Knowledge Prompt' },
    }));
  });

  document.getElementById('pg-copy').addEventListener('click', async () => {
    const prompt = assemblePrompt(pgData, form, customizations.value);
    await navigator.clipboard.writeText(prompt);
    const btn = document.getElementById('pg-copy');
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = 'Copy Prompt Text'; }, 2000);
  });

  document.getElementById('pg-clear').addEventListener('click', () => {
    form.querySelectorAll('select').forEach(s => { s.selectedIndex = 0; });
    form.querySelectorAll('input[type="text"]').forEach(i => { i.value = ''; });
    customizations.value = '';
    summary.textContent = 'Select options below to build your prompt...';
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
          <option value="">Select or type</option>
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

  // Default: select with options
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

function assemblePrompt(pgData, form, customizations) {
  const fields = pgData.fields;
  const primaryInput = form.querySelector('[data-field="primaryTopic"]');
  const secondaryInput = form.querySelector('[data-field="secondaryTopic"]');
  const primaryTopic = primaryInput?.value?.trim() || '';
  const secondaryTopic = secondaryInput?.value?.trim() || '';

  if (!primaryTopic) {
    return pgData.baseTemplate.replace(/\{primary_topic\}/g, '[topic]');
  }

  // Check if any content-type field was selected to use its clause as the opener
  let parts = [];
  let hasContentClause = false;

  fields.forEach(field => {
    if (field.type === 'model-select' || field.type === 'text') return;
    const select = form.querySelector(`[data-field="${field.key}"]`);
    if (!select || !select.value) return;

    const option = (field.options || []).find(o => o.value === select.value);
    if (!option || !option.clause) return;

    const clause = option.clause
      .replace(/\{primary_topic\}/g, primaryTopic)
      .replace(/\{secondary_topic\}/g, secondaryTopic || '[secondary topic]');

    if (field.key === 'contentType') {
      hasContentClause = true;
    }

    parts.push(clause);
  });

  // If no content type clause, use base template
  if (!hasContentClause) {
    parts.unshift(pgData.baseTemplate.replace(/\{primary_topic\}/g, primaryTopic));
  }

  // Add secondary topic clause if provided
  if (secondaryTopic && pgData.secondaryTopicClause) {
    parts.push(pgData.secondaryTopicClause.replace(/\{secondary_topic\}/g, secondaryTopic));
  }

  // Add customizations
  if (customizations.trim()) {
    parts.push('Additional instructions: ' + customizations.trim());
  }

  // Add closing line
  parts.push(pgData.closingLine);

  return parts.join('\n\n');
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
