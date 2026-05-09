// Page-section renderers for the body of topic / home / custom routes.
//
//   renderContentShortcuts: external-search CTA grid (Google News, Bing,
//     YouTube, Wikipedia, etc). Used as a full page section on topic
//     pages and custom-search pages.
//
//   renderNewsFeed: RSS embed for topics that have a feed. Used on
//     topic pages and the homepage. Custom routes don't have a feed.

import { getExternalSearches } from '../utils/data.js';

export function renderContentShortcuts(container, query, opts = {}) {
  const searches = getExternalSearches();
  if (!query || searches.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = `<div class="quick-links" aria-label="Search ${escapeHTML(query)} on other platforms">`;
  html += `<span class="quick-links-label">Content Shortcuts</span>`;
  html += `<div class="quick-links-scrollwrap"><div class="quick-links-list">`;
  searches.forEach(s => {
    const url = s.urlTemplate.replace(/\{query\}/g, encodeURIComponent(query));
    const brand = s.name.toLowerCase().split(' ')[0];
    html += `
      <a href="${url}" target="_blank" rel="noopener noreferrer" class="quick-link" data-brand="${escapeHTML(brand)}">
        <span class="quick-link-dot" aria-hidden="true"></span>
        <span class="quick-link-name">${escapeHTML(s.name)}</span>
      </a>
    `;
  });
  html += `</div></div></div>`;
  container.innerHTML = html;

  // Direction-aware edge fades to hint that the link list scrolls
  // sideways when it overflows. Toggles classes on the scroll wrapper
  // based on scrollLeft / scrollWidth so each fade appears only when
  // there's actually content to scroll toward in that direction.
  const wrap = container.querySelector('.quick-links-scrollwrap');
  const list = container.querySelector('.quick-links-list');
  if (wrap && list) {
    const update = () => {
      const max = list.scrollWidth - list.clientWidth;
      const hasOverflow = max > 1;
      wrap.classList.toggle('has-overflow-left', hasOverflow && list.scrollLeft > 1);
      wrap.classList.toggle('has-overflow-right', hasOverflow && list.scrollLeft < max - 1);
    };
    list.addEventListener('scroll', update, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(update).observe(list);
    } else {
      window.addEventListener('resize', update, { passive: true });
    }
    requestAnimationFrame(update);
  }
}

export function renderNewsFeed(container, topic, isHome) {
  const query = topic?.name || '';
  const feedId = topic?.rssFeedId;

  const topicPill = (!isHome && query)
    ? `<span class="section-topic-pill">${escapeHTML(query)}</span>`
    : '';

  let inner = `
    <div class="newsfeed-card-header">
      <h3 class="newsfeed-card-title">News Feed ${topicPill}</h3>
      <span class="sidebar-card-desc">Latest news and developments.</span>
    </div>
  `;

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

  container.innerHTML = `<div class="newsfeed-card">${inner}</div>`;

  const rssIframe = container.querySelector('.newsfeed-iframe');
  if (rssIframe && feedId) {
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
