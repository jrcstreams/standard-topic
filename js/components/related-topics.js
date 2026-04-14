// Related Topics grid component
//
// On a topic page: shows topics related to the current one (siblings,
// parent, related-parents).
// On the homepage: shows ALL topics organized by parent → subtopics,
// with a footer note prompting to search for custom topics.

import { getRelatedTopics, getTopicBySlug, getTopicsGroupedByParent } from '../utils/data.js';

export function renderRelatedTopics(container, route) {
  const isHome = route.type === 'home';

  if (isHome) {
    renderAllTopicsHome(container);
    return;
  }

  const topic = getTopicBySlug(route.slug);
  const title = 'Related Topics';

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

  // If on a parent topic page, show self as "Active Page"
  if (!topic.parent) {
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

// All Topics view (homepage) — every parent topic with its subtopics,
// followed by a note pointing to the custom topic search.
function renderAllTopicsHome(container) {
  const groups = getTopicsGroupedByParent();

  let html = `
    <div class="section-header">
      <span class="section-icon">🔗</span>
      <h2>All Topics</h2>
    </div>
  `;

  if (groups.length === 0) {
    html += `<p class="related-empty">No topics yet.</p>`;
    container.innerHTML = html;
    return;
  }

  html += `<div class="all-topics-list">`;
  groups.forEach(group => {
    const subs = group.subtopics || [];
    html += `
      <div class="all-topics-group">
        <a href="#/topic/${group.parent.slug}" class="all-topics-parent">
          <span class="all-topics-parent-accent" aria-hidden="true"></span>
          <span class="all-topics-parent-name">${escapeHTML(group.parent.name)}</span>
          <span class="all-topics-parent-arrow" aria-hidden="true">↗</span>
        </a>
        ${subs.length > 0 ? `
          <div class="all-topics-subgrid">
            ${subs.map(sub => `
              <a href="#/topic/${sub.slug}" class="all-topics-sub">
                <span class="related-dot"></span>
                <span>${escapeHTML(sub.name)}</span>
              </a>
            `).join('')}
          </div>` : ''}
      </div>
    `;
  });
  html += `</div>`;

  html += `
    <div class="all-topics-note">
      Can't find what you're looking for?
      <button type="button" class="all-topics-search-link" id="all-topics-search-trigger">
        Search any custom topic
        <span aria-hidden="true">→</span>
      </button>
    </div>
  `;

  container.innerHTML = html;

  // Open the search overlay when the link is clicked
  container.querySelector('#all-topics-search-trigger')?.addEventListener('click', () => {
    // Find any rendered search-bar trigger and click it (opens overlay)
    document.querySelector('.search-bar')?.click();
  });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
