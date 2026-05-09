// Page-section renderers for the body of topic / home / custom routes.
//
//   renderContentShortcuts: external-search CTA grid (Google News, Bing,
//     YouTube, Wikipedia, etc). Used as a full page section on topic
//     pages and custom-search pages.
//
//   renderNewsFeed: RSS embed for topics that have a feed. Used on
//     topic pages and the homepage. Custom routes don't have a feed.

import { getExternalSearches } from '../utils/data.js';

// Brand-recognizable single-color SVG marks. Filled with currentColor
// so the per-brand color is set via CSS variable on the link.
const BRAND_GLYPHS = {
  google: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.35 11.1H12v3.8h5.4c-.8 2.4-3 4.1-5.4 4.1-3.2 0-5.8-2.6-5.8-5.8s2.6-5.8 5.8-5.8c1.5 0 2.9.6 3.9 1.5l2.7-2.7C16.7 4.5 14.5 3.5 12 3.5 6.8 3.5 2.5 7.7 2.5 13s4.3 9.5 9.5 9.5c5 0 8.9-3.7 8.9-9 0-.6 0-1.1-.1-1.7z"/></svg>',
  reddit: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12.07c0-1.21-.97-2.18-2.17-2.18-.59 0-1.13.24-1.52.62-1.5-1.07-3.55-1.76-5.83-1.85l1-4.7 3.27.7c.04.83.72 1.49 1.55 1.49.86 0 1.55-.69 1.55-1.55s-.69-1.55-1.55-1.55c-.61 0-1.13.36-1.39.87L13.04 3c-.18-.04-.36.08-.4.26l-1.11 5.23c-2.31.07-4.39.76-5.92 1.85-.39-.38-.92-.62-1.51-.62-1.2 0-2.17.97-2.17 2.18 0 .85.49 1.59 1.21 1.95-.04.21-.06.43-.06.65 0 3.21 3.7 5.81 8.27 5.81s8.27-2.6 8.27-5.81c0-.22-.02-.43-.06-.64.71-.36 1.21-1.1 1.21-1.96zM7 13.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5c0 .83-.67 1.5-1.5 1.5S7 14.33 7 13.5zm8.71 4.49c-.7.7-1.97 1.04-3.69 1.04l-.02-.02-.02.02c-1.72 0-2.99-.34-3.69-1.04-.13-.13-.13-.34 0-.48.13-.13.34-.13.48 0 .56.56 1.65.83 3.21.83l.02.02.02-.02c1.55 0 2.65-.27 3.21-.83.13-.13.34-.13.48 0 .14.14.14.35 0 .48zM15.5 15c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5c0 .83-.67 1.5-1.5 1.5z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.6 3.6 12 3.6 12 3.6s-7.6 0-9.4.5A3 3 0 0 0 .5 6.2C0 8 0 12 0 12s0 4 .5 5.8a3 3 0 0 0 2.1 2.1c1.8.5 9.4.5 9.4.5s7.6 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.8.5-5.8.5-5.8s0-4-.5-5.8zM9.6 15.5v-7l6.3 3.5-6.3 3.5z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
};

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
    const glyph = BRAND_GLYPHS[brand] || '';
    html += `
      <a href="${url}" target="_blank" rel="noopener noreferrer" class="quick-link" data-brand="${escapeHTML(brand)}">
        <span class="quick-link-glyph" aria-hidden="true">${glyph}</span>
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
