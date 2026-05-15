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
  html += `<span class="quick-links-label">Quick Content</span>`;
  html += `<div class="quick-links-scrollwrap"><div class="quick-links-list">`;
  searches.forEach(s => {
    const url = s.urlTemplate.replace(/\{query\}/g, encodeURIComponent(query));
    const brand = s.name.toLowerCase().split(' ')[0];
    html += `
      <a href="${url}" target="_blank" rel="noopener noreferrer" class="quick-link" data-brand="${escapeHTML(brand)}">
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

  const header = `
    <div class="newsfeed-card-header">
      <h3 class="newsfeed-card-title">News Feed</h3>
    </div>
  `;

  const fadeTop = `
    <div class="scroll-fade scroll-fade-top" aria-hidden="true">
      <span class="scroll-fade-chev">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
      </span>
    </div>
  `;
  const fadeBottom = `
    <div class="scroll-fade scroll-fade-bottom" aria-hidden="true">
      <span class="scroll-fade-chev">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </span>
    </div>
  `;

  let body;
  if (feedId) {
    body = `
      ${header}
      ${fadeTop}
      <div class="newsfeed-embed">
        <iframe src="rss-embed.html?id=${feedId}"
                class="newsfeed-iframe"
                id="rss-iframe-${feedId}"
                frameborder="0"
                scrolling="no"></iframe>
      </div>
      ${fadeBottom}
    `;
  } else {
    body = `
      ${header}
      <div class="newsfeed-placeholder">
        <p>News feed coming soon for this topic.</p>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="newsfeed-card">
      <div class="newsfeed-scroll-wrap">${body}</div>
    </div>
  `;

  const rssIframe = container.querySelector('.newsfeed-iframe');
  if (rssIframe && feedId) {
    window.addEventListener('message', (e) => {
      if (!e.data || !e.data.rssHeight) return;
      if (e.source !== rssIframe.contentWindow) return;
      rssIframe.style.height = e.data.rssHeight + 'px';
    });
  }

  // Measure the sticky header's height and expose as a CSS custom
  // property on the wrap. The top scroll-fade uses this to sit just
  // below the sticky header instead of behind it.
  const wrap = container.querySelector('.newsfeed-scroll-wrap');
  const headerEl = container.querySelector('.newsfeed-card-header');
  if (wrap && headerEl) {
    const setHeaderH = () => {
      const h = headerEl.offsetHeight;
      if (h > 0) wrap.style.setProperty('--newsfeed-header-h', h + 'px');
    };
    requestAnimationFrame(setHeaderH);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(setHeaderH).observe(headerEl);
    }
  }

  // Scroll-fade overlay state for the news feed wrap, mirrors the
  // shortcuts list-wrap pattern.
  if (wrap && feedId) {
    let rafId = null;
    const updateOverflow = () => {
      rafId = null;
      const max = wrap.scrollHeight - wrap.clientHeight;
      const hasOverflow = max > 1;
      wrap.classList.toggle('has-overflow-top', hasOverflow && wrap.scrollTop > 1);
      wrap.classList.toggle('has-overflow-bottom', hasOverflow && wrap.scrollTop < max - 1);
    };
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(updateOverflow);
    };
    wrap.addEventListener('scroll', schedule, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(schedule).observe(wrap);
    }
    requestAnimationFrame(updateOverflow);
  }
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
