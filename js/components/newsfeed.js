// News Feed section.
// On dedicated topic pages / home: external search CTAs (labeled
// "Discover More") followed by the RSS iframe.
// On custom search pages: external search CTAs only (no iframe — the
// custom term isn't a real RSS feed).

import { getExternalSearches } from '../utils/data.js';

export function renderNewsFeed(container, topic, isHome, opts = {}) {
  const { isCustom = false, customTerm = '' } = opts;
  const title = isCustom ? 'Content Shortcuts' : 'News Feed';
  const query = isCustom ? customTerm : (topic?.name || '');
  const searches = getExternalSearches();
  const feedId = isCustom ? null : topic?.rssFeedId;

  // Header: matches sidebar-card-header treatment. On topic/home
  // pages, additional feeds collapse into a single pill that opens
  // a modal listing the sources.
  const feedDesc = isCustom
    ? 'Quick links to search engines and platforms for this topic.'
    : 'Latest news and developments.';

  const topicPill = (!isCustom && !isHome && query)
    ? `<span class="section-topic-pill">${escapeHTML(query)}</span>`
    : '';

  let inner = `
    <div class="newsfeed-card-header">
      <h3 class="newsfeed-card-title">${escapeHTML(title)} ${topicPill}</h3>
      <span class="sidebar-card-desc">${feedDesc}</span>
  `;
  if (!isCustom && !isHome && searches.length > 0 && query) {
    inner += `
      <button type="button" class="feeds-pill" id="open-discover-feeds">
        <span class="feeds-pill-label">More Content Shortcuts</span>
        <span class="feeds-pill-icon" aria-hidden="true">+</span>
      </button>
    `;
  }
  inner += `</div>`;

  // On custom pages, the feed sources ARE the primary content — render
  // as flat-list rows matching AI Shortcuts style exactly.
  if (isCustom && searches.length > 0 && query) {
    inner += `<div class="sidebar-shortcut-list">`;
    searches.forEach(s => {
      const url = s.urlTemplate.replace(/\{query\}/g, encodeURIComponent(query));
      inner += `
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="sidebar-shortcut">
          <span class="sidebar-shortcut-icon" aria-hidden="true">${s.icon}</span>
          <span class="sidebar-shortcut-name">${escapeHTML(s.name)}</span>
          <span class="sidebar-shortcut-chev" aria-hidden="true">›</span>
        </a>
      `;
    });
    inner += `</div>`;
  }

  // RSS feed via same-origin proxy iframe. The proxy page loads the
  // rssapp-wall widget at full content height and reports its body
  // scrollHeight to us via postMessage. Width: 100% on the iframe
  // element — inherently responsive, no JS needed.
  if (!isCustom) {
    if (feedId) {
      inner += `
        <div class="newsfeed-embed">
          <iframe src="rss-embed.html?id=${feedId}"
                  class="newsfeed-iframe"
                  id="rss-iframe-${feedId}"
                  frameborder="0"
                  scrolling="no"></iframe>
        </div>
      `;
    } else {
      inner += `
        <div class="newsfeed-placeholder">
          <p>News feed coming soon for this topic.</p>
        </div>
      `;
    }
  }

  const cardClass = isCustom ? 'newsfeed-card sidebar-card shortcuts-sidebar' : 'newsfeed-card';
  container.innerHTML = `<div class="${cardClass}">${inner}</div>`;

  const feedsBtn = container.querySelector('#open-discover-feeds');
  if (feedsBtn) {
    feedsBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('open-discover-modal', {
        detail: { query, searches },
      }));
    });
  }

  // Same-origin proxy sends us rssHeight via postMessage. Set the
  // iframe height to match so the card wraps the content exactly.
  const rssIframe = container.querySelector('.newsfeed-iframe');
  if (rssIframe && feedId && !isCustom) {
    window.addEventListener('message', (e) => {
      if (!e.data || !e.data.rssHeight) return;
      if (e.source !== rssIframe.contentWindow) return;
      rssIframe.style.height = e.data.rssHeight + 'px';
    });
  }
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
