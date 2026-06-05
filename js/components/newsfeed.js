// renderNewsFeed: news cards for topic + home pages.
//
// Fetches /api/feeds/{slug} — a Vercel serverless function that
// wraps the rss.app v1 API — and renders the items array as
// news-card markup inside the page's .newsfeed-scroll-wrap.
//
// The previous iframe-based implementation (embedding rss.app's
// widget directly via rss-embed.html) is archived under
// _archive/iframe-rendering-legacy/ for reference.

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

// Short relative-time formatter matching the prior iframe display
// (e.g. "12m", "2h", "3d"). Anything older than ~5 years falls
// back to the localized date string.
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

// Per-story "AI Insights" expander: a small trigger that reveals a few
// one-tap insight prompts. Clicking one opens the shared prompt modal
// (open-prompt-modal) pre-filled so the user can submit it to an AI model.
const AI_SPARK_SVG = '<svg class="news-ai-spark" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/></svg>';
const AI_CHEV_SVG = '<svg class="news-ai-chev" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const NEWS_INSIGHTS = [
  { key: 'explain', label: 'Explain', ask: 'Explain this news story in clear, simple terms — what happened and why it matters.' },
  { key: 'background', label: 'Background', ask: 'Give the background and context behind this news story: the key players, the history, and what led up to it.' },
  { key: 'timeline', label: 'Timeline', ask: 'Lay out a timeline of the key events leading up to and surrounding this news story.' },
  { key: 'keypoints', label: 'Key Points', ask: 'Summarize the key points and main takeaways from this news story as a short list of bullet points.' },
];

function buildInsightPrompt(kind, title, desc, url) {
  const meta = NEWS_INSIGHTS.find(i => i.key === kind) || NEWS_INSIGHTS[0];
  const story = `"${title}"${desc ? `\n\n${desc}` : ''}${url ? `\n\nSource: ${url}` : ''}`;
  return { label: meta.label, prompt: `${meta.ask}\n\n${story}` };
}

// Wire the AI Insights dropdown triggers + option buttons within a list.
function wireNewsAI(root) {
  const closeAll = (except) => root.querySelectorAll('.news-ai.is-open').forEach(ai => {
    if (ai !== except) {
      ai.classList.remove('is-open');
      ai.querySelector('.news-ai-trigger')?.setAttribute('aria-expanded', 'false');
    }
  });
  root.querySelectorAll('.news-ai-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const ai = trigger.closest('.news-ai');
      const willOpen = !ai.classList.contains('is-open');
      closeAll(ai);
      ai.classList.toggle('is-open', willOpen);
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
  });
  root.querySelectorAll('.news-ai-opt').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.news-card');
      if (card) {
        const { label, prompt } = buildInsightPrompt(
          btn.dataset.insight, card.dataset.title || '', card.dataset.desc || '', card.dataset.url || '');
        window.dispatchEvent(new CustomEvent('open-prompt-modal', {
          detail: { basePrompt: prompt, topicName: card.dataset.title || '', name: `AI Insight · ${label}`, count: 1 },
        }));
      }
      closeAll(null);
    });
  });
  // Outside-click / Escape closes any open dropdown (attached once per host).
  if (!root.__newsAIClose) {
    root.__newsAIClose = true;
    document.addEventListener('click', () => closeAll(null));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(null); });
  }
}

function newsAIHTML() {
  return `
    <div class="news-ai">
      <button type="button" class="news-ai-trigger" aria-expanded="false">${AI_SPARK_SVG}<span>AI Insights</span>${AI_CHEV_SVG}</button>
      <div class="news-ai-panel"><div class="news-ai-panel-inner">
        ${NEWS_INSIGHTS.map(o => `<button type="button" class="news-ai-opt" data-insight="${o.key}">${escapeHTML(o.label)}</button>`).join('')}
      </div></div>
    </div>`;
}

// One news card.
function newsCardHTML(item) {
  const url = item?.url || item?.link || '';
  const title = item?.title || '';
  // rss.app v1 returns plain-text snippets in `description_text`
  // (no HTML). Older/alternate shapes (`description`, `summary`,
  // `content_text`) kept as defensive fallbacks in case a feed
  // type returns a different envelope.
  const descRaw = item?.description_text
    || item?.content_text
    || item?.description
    || item?.summary
    || '';
  // rss.app v1 returns ISO timestamps as `date_published`. Legacy
  // names kept as fallbacks.
  const pubDate = item?.date_published
    || item?.pub_date
    || item?.published_at
    || item?.date
    || '';
  const host = sourceHost(url);
  const rel = relativeTime(pubDate);

  // The description field is already plain-text from rss.app's
  // API — but run it through the HTML parser anyway to defang
  // anything unexpected. Visual truncation is handled by CSS
  // line-clamp on .news-card-desc so the full text stays in the
  // DOM for screen readers and SEO.
  const tmp = document.createElement('div');
  tmp.innerHTML = descRaw;
  const descText = (tmp.textContent || '').trim();

  const metaParts = [];
  if (host) metaParts.push(`<span class="news-card-source">${escapeHTML(host)}</span>`);
  if (host && rel) metaParts.push(`<span class="news-card-meta-sep" aria-hidden="true">·</span>`);
  if (rel) metaParts.push(`<time class="news-card-time">${escapeHTML(rel)}</time>`);

  return `
    <article class="news-card" data-title="${escapeAttr(title)}" data-desc="${escapeAttr(descText.slice(0, 500))}" data-url="${escapeAttr(url)}">
      <a class="news-card-link"
         href="${escapeAttr(url)}"
         target="_blank"
         rel="noopener noreferrer">
        <h4 class="news-card-title">${escapeHTML(title)}</h4>
        ${descText ? `<p class="news-card-desc">${escapeHTML(descText)}</p>` : ''}
      </a>
      <div class="news-card-foot">
        <div class="news-card-meta">${metaParts.join('')}</div>
        ${newsAIHTML()}
      </div>
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
    wireNewsAI(scrollWrap);
  } catch (err) {
    scrollWrap.innerHTML = `<div class="news-error"><p>News feed temporarily unavailable. Refresh to try again.</p></div>`;
  }
}

const NEWS_ICON = '<svg class="section-head-icon section-head-icon--news" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></svg>';

export function renderNewsFeed(container, topic, isHome) {
  const topicName = (!isHome && topic?.name) ? topic.name : '';
  const pillHTML = topicName
    ? `<span class="section-topic-pill">${escapeHTML(topicName)}</span>`
    : '';

  // Homepage gets the Trending-style card header (blue newspaper icon +
  // subtext); topic pages keep the bare sticky title.
  const headHTML = isHome
    ? `<div class="newsfeed-head section-card-head">
         <h3 class="newsfeed-title section-card-title">${NEWS_ICON}<span class="newsfeed-title-main">News Feed</span></h3>
         <p class="section-card-sub">Latest stories and developments, powered by RSS.app</p>
       </div>`
    : `<h3 class="newsfeed-title"><span class="newsfeed-title-main">News Feed</span>${pillHTML}</h3>`;

  container.innerHTML = `
    <div class="newsfeed-card">
      ${headHTML}
      <div class="newsfeed-scroll-wrap"></div>
    </div>
  `;
  const scrollWrap = container.querySelector('.newsfeed-scroll-wrap');
  renderApiMode(scrollWrap, topic, isHome);
}
