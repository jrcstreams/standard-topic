// renderNewsFeed: news content for topic + home pages.
//
// Two rendering modes:
//   - Iframe mode (default): embed rss.app's widget directly via
//     rss-embed.html. This is the original behavior.
//   - API mode (?api=1 on the URL): fetch from /api/feeds/{slug}
//     (our own Vercel function that wraps the rss.app v1 API) and
//     render cards from JSON. Same outer card/title/scroll-wrap
//     shell so layout/CSS hooks downstream are untouched.
//
// The query flag lets us roll out the API path one tab at a time
// without breaking the default for everyone else. Once we're
// confident the API path is solid the iframe branch goes away
// (kept for now per the migration plan's "do not delete" rule).

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// "?api=1" anywhere on the URL flips the renderer to API mode.
function useApiRenderer() {
  try {
    return new URLSearchParams(window.location.search).has('api');
  } catch {
    return false;
  }
}

// Hostname without "www.", lowercased. Falls back to the raw value
// if the URL is unparseable (rss.app occasionally returns bare
// strings for sources rather than full URLs).
function sourceHost(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return String(rawUrl).replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  }
}

// Short relative-time formatter matching the iframe's display
// (e.g. "12m", "2h", "3d"). Anything older than a year falls back
// to the localized date string.
function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 45) return 'now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return diffMin + 'm';
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return diffHr + 'h';
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return diffDay + 'd';
  const diffWk = Math.round(diffDay / 7);
  if (diffWk < 5) return diffWk + 'w';
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return diffMo + 'mo';
  const diffYr = Math.round(diffDay / 365);
  if (diffYr < 5) return diffYr + 'y';
  return new Date(iso).toLocaleDateString();
}

// One news card. Description is plain-text only — rss.app items
// sometimes include HTML in description, but rendering arbitrary
// upstream HTML in our shell would (a) inherit unwanted markup
// and (b) be a small XSS surface. We strip tags client-side via
// the escapeHTML round-trip.
function newsCardHTML(item) {
  const url = item?.url || item?.link || '';
  const title = item?.title || '';
  const desc = item?.description || item?.summary || '';
  const pubDate = item?.pub_date || item?.published_at || item?.date || '';
  const host = sourceHost(url);
  const rel = relativeTime(pubDate);

  // Plain-text snippet from description: parse via the browser's
  // own HTML parser by setting textContent indirectly through a
  // detached div. Cap at ~220 chars + ellipsis to match the
  // visual rhythm of the iframe cards.
  const tmp = document.createElement('div');
  tmp.innerHTML = desc;
  let descText = (tmp.textContent || '').trim();
  if (descText.length > 220) descText = descText.slice(0, 217).trimEnd() + '…';

  const metaParts = [];
  if (host) metaParts.push(`<span class="news-card-source">${escapeHTML(host)}</span>`);
  if (host && rel) metaParts.push(`<span class="news-card-meta-sep" aria-hidden="true">·</span>`);
  if (rel) metaParts.push(`<time class="news-card-time">${escapeHTML(rel)}</time>`);

  return `
    <article class="news-card">
      <a class="news-card-link"
         href="${escapeAttr(url)}"
         target="_blank"
         rel="noopener noreferrer">
        <h4 class="news-card-title">${escapeHTML(title)}</h4>
        ${descText ? `<p class="news-card-desc">${escapeHTML(descText)}</p>` : ''}
        ${metaParts.length ? `<footer class="news-card-meta">${metaParts.join('')}</footer>` : ''}
      </a>
    </article>
  `;
}

function listHTML(items) {
  if (!items || items.length === 0) {
    return `<div class="news-empty"><p>No news yet — check back soon.</p></div>`;
  }
  return `<div class="news-list">${items.map(newsCardHTML).join('')}</div>`;
}

async function renderApiMode(scrollWrap, topic, isHome) {
  // Home uses the dedicated "home" slug in topics.json.
  const slug = isHome ? 'home' : topic?.slug;
  if (!slug) {
    scrollWrap.innerHTML = `<div class="news-error"><p>News feed unavailable.</p></div>`;
    return;
  }

  scrollWrap.innerHTML = `<div class="news-loading"><p>Loading news…</p></div>`;

  try {
    const res = await fetch(`/api/feeds/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      // 404 means the slug isn't in topics.json — surface as
      // empty rather than a hard error, since the user has
      // navigated to a real page.
      if (res.status === 404) {
        scrollWrap.innerHTML = `<div class="news-empty"><p>No news yet for this topic.</p></div>`;
        return;
      }
      throw new Error(`API ${res.status}`);
    }
    const payload = await res.json();
    if (payload?.noFeed) {
      scrollWrap.innerHTML = `<div class="newsfeed-placeholder"><p>News feed coming soon for this topic.</p></div>`;
      return;
    }
    scrollWrap.innerHTML = listHTML(payload?.items);
  } catch (err) {
    scrollWrap.innerHTML = `<div class="news-error"><p>News feed temporarily unavailable. Refresh to try again.</p></div>`;
  }
}

function renderIframeMode(scrollWrap, feedId) {
  const body = feedId
    ? `<div class="newsfeed-embed">
         <iframe src="rss-embed.html?id=${feedId}&v=20260523b"
                 class="newsfeed-iframe"
                 id="rss-iframe-${feedId}"
                 frameborder="0"
                 scrolling="no"></iframe>
       </div>`
    : `<div class="newsfeed-placeholder"><p>News feed coming soon for this topic.</p></div>`;
  scrollWrap.innerHTML = body;

  const rssIframe = scrollWrap.querySelector('.newsfeed-iframe');
  if (rssIframe && feedId) {
    window.addEventListener('message', (e) => {
      if (!e.data || e.source !== rssIframe.contentWindow) return;
      if (e.data.rssHeight) {
        rssIframe.style.height = e.data.rssHeight + 'px';
        return;
      }
      // Wheel forwarding: the iframe captures wheel events even when
      // its body is overflow:hidden, so without this the iframe's
      // body-padding / grid-inset region (left/right of the cards)
      // becomes a dead zone for scrolling the feed.
      if (e.data.rssWheel && scrollWrap) {
        const { deltaY, deltaMode } = e.data.rssWheel;
        const pxY = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * scrollWrap.clientHeight : deltaY;
        scrollWrap.scrollBy({ top: pxY, behavior: 'auto' });
      }
    });
  }
}

export function renderNewsFeed(container, topic, isHome) {
  const feedId = topic?.rssFeedId;
  const topicName = (!isHome && topic?.name) ? topic.name : '';
  const pillHTML = topicName
    ? `<span class="section-topic-pill">${escapeHTML(topicName)}</span>`
    : '';

  container.innerHTML = `
    <div class="newsfeed-card">
      <h3 class="newsfeed-title">News Feed${pillHTML}</h3>
      <div class="newsfeed-scroll-wrap"></div>
    </div>
  `;
  const scrollWrap = container.querySelector('.newsfeed-scroll-wrap');

  if (useApiRenderer()) {
    renderApiMode(scrollWrap, topic, isHome);
  } else {
    renderIframeMode(scrollWrap, feedId);
  }
}
