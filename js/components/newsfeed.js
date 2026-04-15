// News Feed section.
// On dedicated topic pages / home: external search CTAs (labeled
// "Discover More") followed by the RSS iframe.
// On custom search pages: external search CTAs only (no iframe — the
// custom term isn't a real RSS feed).

import { getExternalSearches } from '../utils/data.js';

export function renderNewsFeed(container, topic, isHome, opts = {}) {
  const { isCustom = false, customTerm = '' } = opts;
  const title = isCustom ? 'News Results' : (isHome ? 'Main News Feed' : 'News Feed');
  const query = isCustom ? customTerm : (topic?.name || '');
  const searches = getExternalSearches();
  const feedId = isCustom ? null : topic?.rssFeedId;

  let html = `
    <div class="section-header">
      <span class="section-icon">📡</span>
      <h2>${escapeHTML(title)}</h2>
    </div>
  `;

  // External search CTAs — always shown. Labeled "Discover More" when
  // an RSS iframe follows; standalone when it's the only thing (custom).
  if (searches.length > 0 && query) {
    if (!isCustom) {
      html += `<div class="discover-more-label">Discover More:</div>`;
    }
    html += `<div class="discover-grid">`;
    searches.forEach(s => {
      const url = s.urlTemplate.replace(/\{query\}/g, encodeURIComponent(query));
      html += `
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="discover-link">
          <span class="discover-link-icon" aria-hidden="true">${s.icon}</span>
          <span class="discover-link-name">${escapeHTML(s.name)}</span>
          <span class="discover-link-arrow" aria-hidden="true">↗</span>
        </a>
      `;
    });
    html += `</div>`;
  }

  // RSS iframe (only on real topic pages / home)
  if (!isCustom) {
    if (feedId) {
      html += `
        <div class="newsfeed-embed">
          <rssapp-wall id="${feedId}"></rssapp-wall>
        </div>
      `;
    } else {
      html += `
        <div class="newsfeed-placeholder">
          <p>News feed coming soon for this topic.</p>
        </div>
      `;
    }
  }

  container.innerHTML = html;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
