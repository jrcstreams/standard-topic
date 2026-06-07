// renderNewsFeed: news cards for topic + home pages.
//
// Two-tier feed:
//   1. LIVE — /api/feeds/{slug} (rss.app proxy, ~50 fresh stories), shown first.
//   2. ARCHIVE — "Load older stories" pages further back through the stored
//      history (/api/news/{slug}?before=… keyset cursor), appended seamlessly.
// Plus client-side filters over the loaded set: search (server full-text over
// the whole archive), time range, source/site, and newest/oldest sort.
//
// newsCardHTML/wireNewsAI/listHTML are exported so the Search modal can reuse
// the exact same card + AI-insight behavior for archive results.

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

// Short relative-time formatter (e.g. "12m", "2h", "3d"). Anything older
// than ~5 years falls back to the localized date string.
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
const SHARE_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
const LINK_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
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

// Map a card's dropdown option → the cached insight type served by /api/insight.
const NEWS_INLINE_MAP = { explain: 'summary', background: 'background', timeline: 'timeline', keypoints: 'keypoints' };
const NEWS_INLINE_LABEL = { summary: 'Summary', background: 'Background', timeline: 'Timeline', keypoints: 'Key points' };

// Escalate to the full chat (the original behavior) for going deeper.
function openNewsChat(card, dataKey) {
  const { label, prompt } = buildInsightPrompt(dataKey, card.dataset.title || '', card.dataset.desc || '', card.dataset.url || '');
  window.dispatchEvent(new CustomEvent('open-prompt-modal', {
    detail: { basePrompt: prompt, topicName: card.dataset.title || '', name: `AI Insight · ${label}`, count: 1 },
  }));
}

// Show a cached/lazy AI insight inline under the card. Falls back to chat if
// the AI layer is unavailable / the daily cap is hit.
async function showNewsInsight(card, dataKey) {
  const insight = NEWS_INLINE_MAP[dataKey];
  if (!insight) { openNewsChat(card, dataKey); return; }
  const label = NEWS_INLINE_LABEL[insight] || 'AI';
  let region = card.querySelector('.ai-result');
  if (!region) { region = document.createElement('div'); region.className = 'ai-result'; card.appendChild(region); }
  region.innerHTML = `<div class="ai-result-head"><span class="ai-result-label">${escapeHTML(label)}</span><span class="ai-result-badge">AI</span></div><div class="ai-result-body ai-result-loading">Generating…</div>`;
  try {
    const res = await fetch('/api/insight', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'news', insight, url: card.dataset.url || '', title: card.dataset.title || '', description: card.dataset.desc || '' }),
    });
    const data = res.ok ? await res.json() : null;
    if (!data || !data.content) { region.remove(); openNewsChat(card, dataKey); return; }
    region.innerHTML = `
      <div class="ai-result-head"><span class="ai-result-label">${escapeHTML(label)}</span><span class="ai-result-badge">AI</span><button type="button" class="ai-result-close" aria-label="Dismiss">✕</button></div>
      <div class="ai-result-body">${escapeHTML(data.content)}</div>
      <button type="button" class="ai-result-deeper">Open in chat ↗</button>`;
    region.querySelector('.ai-result-close')?.addEventListener('click', () => region.remove());
    region.querySelector('.ai-result-deeper')?.addEventListener('click', () => openNewsChat(card, dataKey));
  } catch (_) {
    region.remove();
    openNewsChat(card, dataKey);
  }
}

// Brief "Copied" confirmation on a share/copy button.
function flashCopied(btn, msg) {
  const label = btn.querySelector('span');
  const orig = label ? label.textContent : '';
  btn.classList.add('is-copied');
  if (label) label.textContent = msg;
  setTimeout(() => { btn.classList.remove('is-copied'); if (label) label.textContent = orig; }, 1500);
}

// Wire the AI Insights dropdown triggers + option buttons within a list.
export function wireNewsAI(root) {
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
      const dataKey = btn.dataset.insight;
      closeAll(null);
      if (card) showNewsInsight(card, dataKey);
    });
  });
  // Share — native share sheet on mobile (Apple/Android), copy-link fallback.
  root.querySelectorAll('.news-share').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const card = btn.closest('.news-card');
      const url = card?.dataset.url || '';
      const title = card?.dataset.title || '';
      if (!url) return;
      if (navigator.share) {
        try { await navigator.share({ title, url }); } catch (_) { /* user cancelled */ }
      } else {
        try { await navigator.clipboard.writeText(url); } catch (_) {}
        flashCopied(btn, 'Link copied');
      }
    });
  });
  // Copy link — copies the story URL with brief confirmation.
  root.querySelectorAll('.news-copy').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const url = btn.closest('.news-card')?.dataset.url || '';
      if (!url) return;
      try { await navigator.clipboard.writeText(url); }
      catch (_) { const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (_) {} ta.remove(); }
      flashCopied(btn, 'Copied');
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

// Field accessors that work for BOTH rss.app live items and stored archive
// rows (which use url / description / published_at directly).
function itemUrl(it) { return (it && (it.url || it.link)) || ''; }
function itemDescRaw(it) {
  return (it && (it.description_text || it.content_text || it.description || it.summary)) || '';
}
function itemPubRaw(it) {
  return (it && (it.date_published || it.pub_date || it.published_at || it.date)) || '';
}
function itemPubMs(it) {
  const t = new Date(itemPubRaw(it)).getTime();
  return Number.isNaN(t) ? 0 : t;
}
function itemHost(it) {
  return sourceHost(itemUrl(it)) || String((it && it.source_name) || '').replace(/^www\./i, '').toLowerCase();
}

// One news card. Accepts rss.app items OR stored archive rows.
export function newsCardHTML(item) {
  const url = itemUrl(item);
  const title = item?.title || '';
  const descRaw = itemDescRaw(item);
  const pubDate = itemPubRaw(item);
  const host = sourceHost(url) || String(item?.source_name || '');
  const rel = relativeTime(pubDate);

  // The description is plain-text from rss.app's API — but run it through
  // the HTML parser anyway to defang anything unexpected. Visual truncation
  // is handled by CSS line-clamp so the full text stays in the DOM.
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
        <button type="button" class="news-action news-share" aria-label="Share this story">${SHARE_SVG}<span>Share</span></button>
        <button type="button" class="news-action news-copy" aria-label="Copy link to this story">${LINK_SVG}<span>Copy</span></button>
      </div>
    </article>
  `;
}

export function listHTML(items) {
  if (!items || items.length === 0) {
    return `<div class="news-empty"><p>No news yet — check back soon.</p></div>`;
  }
  return `<div class="news-list">${items.map(newsCardHTML).join('')}</div>`;
}

// ===== Feed controller (live + archive paging + filters) =================

const TIME_OPTS = [['all', 'All time'], ['day', 'Past 24h'], ['week', 'Past week'], ['month', 'Past month']];
const TIME_WINDOWS = { day: 864e5, week: 6048e5, month: 2592e6 };
const NEWS_SEARCH_SVG = '<svg class="nf-search-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

function filterBarHTML(label) {
  const ph = label ? `Search ${label} news…` : 'Search news…';
  return `
    <div class="newsfeed-filters" role="group" aria-label="Filter news">
      <label class="nf-search-wrap">
        ${NEWS_SEARCH_SVG}
        <input type="search" class="nf-search" placeholder="${escapeAttr(ph)}" aria-label="${escapeAttr(ph)}">
      </label>
      <div class="nf-filter-row">
        <select class="nf-time" aria-label="Time range">${TIME_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <select class="nf-source" aria-label="Source"><option value="all">All sources</option></select>
        <button type="button" class="nf-sort" data-sort="newest" aria-label="Toggle sort order">Newest</button>
      </div>
    </div>`;
}

async function fetchLiveFeed(slug) {
  const res = await fetch(`/api/feeds/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    if (res.status === 404) return { items: [] };
    throw new Error(`API ${res.status}`);
  }
  const p = await res.json();
  if (p && p.noFeed) return { noFeed: true };
  return { items: Array.isArray(p && p.items) ? p.items : [] };
}

async function fetchArchive(slug, { q = '', before = '', limit = 30 } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (before) params.set('before', before);
  params.set('limit', String(limit));
  const res = await fetch(`/api/news/${encodeURIComponent(slug)}?${params.toString()}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const p = await res.json();
  return { stories: Array.isArray(p && p.stories) ? p.stories : [], nextBefore: (p && p.nextBefore) || null };
}

function startFeed(ctx) {
  const { card, scrollWrap, foot, slug, label } = ctx;
  const els = {
    search: card.querySelector('.nf-search'),
    time: card.querySelector('.nf-time'),
    source: card.querySelector('.nf-source'),
    sort: card.querySelector('.nf-sort'),
  };
  const state = {
    q: '', time: 'all', source: 'all', sort: 'newest',
    stories: [], urls: new Set(), exhausted: false, loading: false,
    liveCache: null, noFeed: false,
  };

  function addStories(arr) {
    let added = 0;
    for (const s of arr || []) {
      const u = itemUrl(s);
      if (!u || state.urls.has(u)) continue;
      state.urls.add(u); state.stories.push(s); added++;
    }
    return added;
  }
  function resetStories() { state.stories = []; state.urls = new Set(); }

  function visible() {
    let arr = state.stories.slice();
    const win = TIME_WINDOWS[state.time];
    if (win) { const cut = Date.now() - win; arr = arr.filter(s => itemPubMs(s) >= cut); }
    if (state.source !== 'all') arr = arr.filter(s => itemHost(s) === state.source);
    arr.sort((a, b) => state.sort === 'oldest' ? itemPubMs(a) - itemPubMs(b) : itemPubMs(b) - itemPubMs(a));
    return arr;
  }

  function refreshSources() {
    const hosts = [...new Set(state.stories.map(itemHost).filter(Boolean))].sort();
    const cur = state.source;
    els.source.innerHTML = `<option value="all">All sources</option>` +
      hosts.map(h => `<option value="${escapeAttr(h)}">${escapeHTML(h)}</option>`).join('');
    if (hosts.includes(cur)) els.source.value = cur; else { els.source.value = 'all'; state.source = 'all'; }
  }

  function renderFoot() {
    if (state.noFeed) { foot.innerHTML = ''; return; }
    if (state.exhausted) {
      foot.innerHTML = state.stories.length ? `<p class="newsfeed-end">You've reached the end of the archive.</p>` : '';
      return;
    }
    foot.innerHTML = `<button type="button" class="newsfeed-loadmore"${state.loading ? ' disabled' : ''}>${state.loading ? 'Loading…' : 'Load older stories'}</button>`;
    foot.querySelector('.newsfeed-loadmore')?.addEventListener('click', loadOlder);
  }

  function renderList() {
    if (state.noFeed) {
      scrollWrap.innerHTML = `<div class="newsfeed-placeholder"><p>News feed coming soon for this topic.</p></div>`;
      renderFoot();
      return;
    }
    const vis = visible();
    if (!vis.length) {
      scrollWrap.innerHTML = `<div class="news-empty"><p>${state.q ? 'No stories match your search.' : 'No stories match these filters.'}</p></div>`;
    } else {
      scrollWrap.innerHTML = `<div class="news-list">${vis.map(newsCardHTML).join('')}</div>`;
      wireNewsAI(scrollWrap);
    }
    renderFoot();
  }

  function oldestBefore() {
    let min = Infinity;
    for (const s of state.stories) { const t = itemPubMs(s); if (t > 0 && t < min) min = t; }
    return Number.isFinite(min) ? new Date(min).toISOString() : '';
  }

  async function loadOlder() {
    if (state.loading || state.exhausted) return;
    state.loading = true; renderFoot();
    try {
      const { stories, nextBefore } = await fetchArchive(slug, { q: state.q, before: oldestBefore(), limit: 30 });
      addStories(stories);
      if (!nextBefore || stories.length === 0) state.exhausted = true;
      state.loading = false;
      refreshSources(); renderList();
    } catch (_) {
      state.loading = false;
      foot.innerHTML = `<button type="button" class="newsfeed-loadmore">Retry</button>`;
      foot.querySelector('.newsfeed-loadmore')?.addEventListener('click', loadOlder);
    }
  }

  async function loadLive() {
    scrollWrap.innerHTML = `<div class="news-loading"><p>Loading news…</p></div>`; foot.innerHTML = '';
    try {
      const r = await fetchLiveFeed(slug);
      if (r.noFeed) { state.noFeed = true; renderList(); return; }
      state.liveCache = (r.items || []).slice();
      addStories(r.items);
      refreshSources(); renderList();
    } catch (_) {
      scrollWrap.innerHTML = `<div class="news-error"><p>News feed temporarily unavailable. Refresh to try again.</p></div>`;
    }
  }

  async function runSearch(q) {
    state.q = q; state.exhausted = false; resetStories();
    scrollWrap.innerHTML = `<div class="news-loading"><p>${q ? 'Searching…' : 'Loading news…'}</p></div>`; foot.innerHTML = '';
    try {
      if (!q) {
        if (state.liveCache) { addStories(state.liveCache); refreshSources(); renderList(); }
        else await loadLive();
        return;
      }
      const { stories, nextBefore } = await fetchArchive(slug, { q, limit: 30 });
      addStories(stories);
      if (!nextBefore) state.exhausted = true;
      refreshSources(); renderList();
    } catch (_) {
      scrollWrap.innerHTML = `<div class="news-error"><p>Search unavailable. Try again.</p></div>`;
    }
  }

  let searchTimer = null;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = els.search.value.trim();
    searchTimer = setTimeout(() => runSearch(q), 300);
  });
  els.time.addEventListener('change', () => { state.time = els.time.value; renderList(); });
  els.source.addEventListener('change', () => { state.source = els.source.value; renderList(); });
  els.sort.addEventListener('click', () => {
    state.sort = state.sort === 'newest' ? 'oldest' : 'newest';
    els.sort.dataset.sort = state.sort;
    els.sort.textContent = state.sort === 'newest' ? 'Newest' : 'Oldest';
    renderList();
  });

  loadLive();
}

export function renderNewsFeed(container, topic, isHome) {
  const slug = isHome ? 'home' : (topic && topic.slug);
  const label = isHome ? '' : ((topic && topic.name) || '');
  const headHTML = `
    <div class="newsfeed-head section-card-head">
      <h3 class="newsfeed-title section-card-title"><span class="newsfeed-title-main">News Feed</span></h3>
      <p class="section-card-sub">Latest stories and developments, powered by RSS.app</p>
    </div>`;

  container.innerHTML = `
    <div class="newsfeed-card">
      ${headHTML}
      ${filterBarHTML(label)}
      <div class="newsfeed-scroll-wrap"></div>
      <div class="newsfeed-foot"></div>
    </div>`;

  const card = container.querySelector('.newsfeed-card');
  const scrollWrap = card.querySelector('.newsfeed-scroll-wrap');
  const foot = card.querySelector('.newsfeed-foot');
  if (!slug) {
    scrollWrap.innerHTML = `<div class="news-error"><p>News feed unavailable.</p></div>`;
    return;
  }
  startFeed({ card, scrollWrap, foot, slug, label });
}
