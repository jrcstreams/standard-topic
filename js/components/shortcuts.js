// AI Shortcuts grid component

import { getEvergreenShortcuts, getSpecificShortcuts, getTopicBySlug } from '../utils/data.js';
import { fillPromptTemplate } from '../utils/ai-models.js';

export function renderShortcuts(container, route) {
  const isCustom = route.type === 'custom';
  const topicName = isCustom ? route.term : (getTopicBySlug(route.slug)?.name || route.slug);
  const topic = isCustom ? null : getTopicBySlug(route.slug);

  const title = isCustom
    ? `AI Shortcuts for <em>${escapeHTML(route.term)}</em>`
    : 'AI Shortcuts';

  let html = `
    <div class="section-header">
      <span class="section-icon">⚡</span>
      <h2>${title}</h2>
    </div>
  `;

  const evergreen = isCustom
    ? getEvergreenShortcuts(null)
    : getEvergreenShortcuts(topic);
  const specific = (!isCustom && route.slug !== 'home')
    ? getSpecificShortcuts(route.slug)
    : [];
  // When BOTH evergreen and topic-specific shortcuts exist, show a label
  // before the evergreen group so the two sections are clearly separated.
  const showEvergreenLabel = evergreen.length > 0 && specific.length > 0;

  if (evergreen.length > 0) {
    if (showEvergreenLabel) {
      html += `<h3 class="shortcuts-section-label">Evergreen Shortcuts</h3>`;
    }
    html += `<div class="shortcuts-grid">`;
    evergreen.forEach(shortcut => {
      const prompt = fillPromptTemplate(shortcut.prompt, topicName);
      html += buildShortcutCard(shortcut, prompt);
    });
    html += `</div>`;
  }

  if (specific.length > 0) {
    html += `
      <h3 class="shortcuts-section-label">Topic-Specific Shortcuts</h3>
      <div class="shortcuts-grid">
    `;
    specific.forEach(shortcut => {
      const prompt = fillPromptTemplate(shortcut.prompt, topicName);
      html += buildShortcutCard(shortcut, prompt);
    });
    html += `</div>`;
  }

  container.innerHTML = html;

  container.querySelectorAll('.shortcut-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt;
      const name = card.dataset.name;
      window.dispatchEvent(new CustomEvent('open-prompt-modal', {
        detail: { prompt, name },
      }));
    });
  });
}

function buildShortcutCard(shortcut, prompt) {
  return `
    <button class="shortcut-card" data-prompt="${escapeAttr(prompt)}" data-name="${escapeAttr(shortcut.name)}">
      <span class="shortcut-icon">${getIconEmoji(shortcut.icon)}</span>
      <span class="shortcut-name">${escapeHTML(shortcut.name)}</span>
    </button>
  `;
}

function getIconEmoji(icon) {
  const map = {
    'zap': '⚡', 'globe': '🌍', 'cpu': '🤖', 'trending-up': '📈',
    'calendar': '📅', 'rocket': '🚀', 'microscope': '🔬', 'landmark': '🏛️',
    'trophy': '🏆', 'leaf': '🌿', 'heart': '❤️', 'bar-chart': '📊',
    'tool': '🔧', 'laptop': '💻', 'flask': '🧪', 'briefcase': '💼',
    'home': '🏠',
  };
  return map[icon] || '🔗';
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
