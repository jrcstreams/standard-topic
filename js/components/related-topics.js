// Related Topics grid component

import { getRelatedTopics, getTopicBySlug } from '../utils/data.js';

export function renderRelatedTopics(container, route) {
  const isHome = route.type === 'home';
  const topic = getTopicBySlug(route.slug);
  const title = isHome ? 'Featured Topics' : 'Related Topics';

  if (!topic) {
    container.innerHTML = `
      <div class="section-header">
        <span class="section-icon">🔗</span>
        <h2>${title}</h2>
      </div>
      <p class="related-empty">No related topics yet.</p>
    `;
    return;
  }

  const related = getRelatedTopics(topic);

  let html = `
    <div class="section-header">
      <span class="section-icon">🔗</span>
      <h2>${title}</h2>
    </div>
  `;

  if (related.length === 0) {
    html += `<p class="related-empty">No related topics yet.</p>`;
    container.innerHTML = html;
    return;
  }

  html += `<div class="related-grid">`;

  // If on a parent topic page (not home), show self as "Active Page"
  if (!isHome && !topic.parent) {
    html += `
      <div class="related-card active-page">
        <span class="related-dot"></span>
        <span class="related-name">${escapeHTML(topic.name)}</span>
        <span class="related-active-label">Active Page</span>
      </div>
    `;
  }

  related.forEach(r => {
    html += `
      <a href="#/topic/${r.slug}" class="related-card">
        <span class="related-dot"></span>
        <span class="related-name">${escapeHTML(r.name)}</span>
        <span class="related-arrow">↗</span>
      </a>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
