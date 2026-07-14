// Homepage Trending Now card. Lists US Google-Trends searches (via
// /api/trending); each row links to the Custom Search page. Title +
// separator match News Feed / Topic Intelligence; the list is a tight
// fixed-height scroll area with top/bottom fade + chevron affordances
// (no expand button) reusing the shared .scroll-fade indicators.
import { fetchTrending } from '../utils/trending.js';
import { renderTrendExpansionBody } from './trend-expansion.js?v=20260706-revamp565';
import { wireInsightTabs } from '../utils/insight-tabs.js?v=20260706-revamp565';
import { wireExploreFurther } from '../utils/explore-further.js?v=20260706-revamp565';
import { aiSparkInline } from '../utils/ai-provenance.js?v=20260706-revamp565';

function escapeHTML(str) { const d = document.createElement('div'); d.textContent = str ?? ''; return d.innerHTML; }
function escapeAttr(str) { return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

const CHEV = `<svg class="trending-row-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
const CHEV_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>`;
const CHEV_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
// Open-action icon (arrow up-right) — trend rows OPEN the AI insight modal.
const OPEN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>`;

function rowHTML(topic, idx) {
  const q = topic.query;
  return `
    <li class="trending-row-item">
      <button type="button" class="trending-row" data-idx="${idx}" title="Open ${escapeAttr(q)}">
        <span class="trending-row-text">${escapeHTML(q)}</span>
        ${CHEV}
      </button>
    </li>`;
}

function metaHTML(fetched) {
  const updated = fetched ? `<span class="trending-meta-dot" aria-hidden="true">·</span><span class="trending-updated">Updated ${escapeHTML(relativeTime(fetched))}</span>` : '';
  return `<div class="trending-meta"><span class="trending-attr">via Google Trends</span>${updated}</div>`;
}

function shell(bodyHTML, fetched) {
  return `
    <div class="sidebar-card trending-card">
      <h3 class="trending-title">Trending Now</h3>
      ${metaHTML(fetched)}
      ${bodyHTML}
    </div>`;
}

function listShell(topics) {
  return `
    <div class="trending-list-wrap">
      <ul class="trending-list trending-scroll" id="trending-scroll">${topics.map((t, i) => rowHTML(t, i)).join('')}</ul>
      <div class="scroll-fade scroll-fade-top" aria-hidden="true"><span class="scroll-fade-chev">${CHEV_UP}</span></div>
      <div class="scroll-fade scroll-fade-bottom" aria-hidden="true"><span class="scroll-fade-chev">${CHEV_DOWN}</span></div>
    </div>`;
}

function skeleton() {
  const rows = Array.from({ length: 8 }, () => `<li class="trending-skel-row"></li>`).join('');
  return shell(`<div class="trending-list-wrap"><ul class="trending-list trending-scroll trending-skeleton">${rows}</ul></div>`, null);
}

// Toggle the top/bottom fade overlays based on scroll position.
function wireScrollFade(container) {
  const wrap = container.querySelector('.trending-list-wrap');
  const scroll = container.querySelector('#trending-scroll');
  if (!wrap || !scroll) return;
  const update = () => {
    const top = scroll.scrollTop;
    const max = scroll.scrollHeight - scroll.clientHeight;
    wrap.classList.toggle('has-overflow-top', top > 2);
    wrap.classList.toggle('has-overflow-bottom', max > 2 && top < max - 2);
  };
  scroll.addEventListener('scroll', update, { passive: true });
  requestAnimationFrame(update);
  setTimeout(update, 150); // re-check after fonts/layout settle
}

// ===== Trend cards (rich SerpAPI data) ================================
// Approx. search count → compact label: 200000 → "200K+", 2e6 → "2M+".
function formatVolume(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M+`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K+`;
  return `${n}`;
}
// increase_percentage 1000 → "+1,000%". Google reports "Breakout" (very high) as huge numbers.
function formatPercent(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  return `+${n.toLocaleString('en-US')}%`;
}
// startedAt → "Trending for 5h" style duration.
function durationLabel(iso) {
  if (!iso) return '';
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return '';
  const mins = Math.max(0, Math.round((Date.now() - start) / 60000));
  if (mins < 60) return `${mins || 1}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}
const TREND_UP_SVG = `<svg class="trending-topics-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>`;
// Small green up-trend mark shown next to each trend term.
const TREND_CARD_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>`;
// AI Insights spark — same mark/branding as the News Feed AI Insights label,
// reused as the mini-header inside each trend's insight dropdown.
const AI_SPARK_SVG = `<svg class="trend-ai-spark" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/></svg>`;
// Filled blue sparkle for the mobile "View AI Insights" button (matches the news
// card's AI Insights pill).
const AI_SPARK_FILLED = `<svg viewBox="0 0 24 24" width="15" height="15" fill="#2563eb" aria-hidden="true"><path d="M12 2l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 10.5l-4.4 1.85a2 2 0 0 0-1.25 1.25L12 19l-2.9-5.4a2 2 0 0 0-1.25-1.25L3.45 10.5l4.4-1.85a2 2 0 0 0 1.25-1.25z"/></svg>`;
// The SAME animated loader the news-card AI Insights use (twinkling sparkle +
// animated dots + shimmer skeletons) — shared via the global .ni-loader CSS so
// trending "generating insights" reads identically (#img520). No per-term text.
function niStyleLoaderHTML() {
  return `<div class="ni-loader"><div class="ni-loader-head"><span class="ni-spark">${AI_SPARK_SVG}</span><span class="ni-loader-tx">Generating insights<span class="ni-dots" aria-hidden="true"></span></span></div><span class="ni-skel"></span><span class="ni-skel"></span><span class="ni-skel ni-skel-short"></span></div>`;
}

// Google returns trend queries lowercase ("jalen brunson") — title-case them.
function titleCase(s) {
  return String(s || '').toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
}

// Some older cached briefs leaked the raw "**SUMMARY:** … **DETAIL:** …"
// scaffold into the stored summary. Keep only the one-liner, label-free.
export function cleanSummary(s) {
  let t = String(s || '').replace(/[*_]+/g, '').trim();
  const m = t.match(/summary\s*:\s*([\s\S]*?)(?:\s*detail\s*:|$)/i);
  if (m) t = m[1];
  return t.replace(/^\s*(summary|detail)\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
}

// Trend cards open one combined, grounded AI brief (see showTrendBrief).

// Compact 2-row card: [category · trending-for] on top, term below. Clicking
// the card opens an attached dropdown of quick insight links (no modal).
// History "clock" mark for trends that WERE trending (not active now).
const TREND_PAST_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>`;

function trendCardHTML(topic, idx, opts) {
  opts = opts || {};
  const cat = (topic.categories && topic.categories[0]) || '';
  const dur = durationLabel(topic.startedAt);
  const title = titleCase(topic.query);
  // Line 2: either the live "Since X ago" or a caller-supplied label (the
  // "Earlier" section passes "Was trending X ago").
  const meta = opts.metaText != null ? opts.metaText : [cat, dur ? `Since ${dur} ago` : ''].filter(Boolean).join(' · ');
  const icon = opts.past ? TREND_PAST_ICON : TREND_CARD_ICON;
  return `
    <div class="trend-card${opts.past ? ' trend-card--past' : ''}" data-idx="${idx}" data-query="${escapeAttr(title)}" data-cat="${escapeAttr(cat)}" data-started="${escapeAttr(topic.startedAt || '')}" data-breakdown="${escapeAttr(JSON.stringify(Array.isArray(topic.trendBreakdown) ? topic.trendBreakdown.slice(0, 8) : []))}">
      <button type="button" class="trend-card-trigger" aria-expanded="false" title="Quick insights on ${escapeAttr(title)}">
        <span class="trend-card-main">
          <span class="trend-card-head">
            <span class="trend-card-icon" aria-hidden="true">${icon}</span>
            <span class="trend-card-title">${escapeHTML(title)}</span>
          </span>
          ${meta ? `<span class="trend-card-meta">${escapeHTML(meta)}</span>` : ''}
          ${topic.summary && cleanSummary(topic.summary) ? `<span class="trend-card-summary">${escapeHTML(cleanSummary(topic.summary))}</span>` : ''}
        </span>
        <span class="trend-card-chev trend-card-open" aria-hidden="true">${OPEN_ICON}</span>
      </button>
      <div class="trend-card-actions">
        <button type="button" class="trend-card-aibtn" data-trend-ai aria-expanded="false">${AI_SPARK_FILLED}<span class="trend-card-aibtn-open">View AI Insights</span><span class="trend-card-aibtn-close">Close AI Insights</span></button>
      </div>
    </div>`;
}

function openTrendChat(card) {
  const term = card.dataset.query || '';
  window.dispatchEvent(new CustomEvent('open-prompt-modal', {
    detail: { basePrompt: `Explain what "${term}" is and why it's trending right now — what just happened, the background, and the latest developments.`, topicName: term, name: 'Trending · AI', count: 1 },
  }));
}

// Trend AI brief opens in the unified insight modal — with the full trend list
// as nav context so the modal can offer Prev/Next trend + "Back to Trending".
async function showTrendBrief(card) {
  const clicked = card.dataset.query || '';
  const parseBd = (c) => { try { return JSON.parse(c.dataset.breakdown || '[]'); } catch (_) { return []; } };
  // Prev/Next should walk the FULL trending set, not just the few cards visible
  // on a homepage/topic preview — so fetch the full list (cached) for the nav.
  let list = [], index = -1;
  try {
    const topics = (await fetchTrending()).topics || [];
    list = topics.map((t) => ({ type: 'trend', query: titleCase(t.query), category: (t.categories && t.categories[0]) || '', startedAt: t.startedAt || '', trendBreakdown: Array.isArray(t.trendBreakdown) ? t.trendBreakdown.slice(0, 8) : [] }));
    index = list.findIndex((e) => e.query === clicked);
  } catch (_) { /* fall back to the rendered grid below */ }
  if (index < 0) {
    // Offline / fetch failed — derive from the rendered grid.
    const grid = card.closest('.trend-card-grid');
    const cards = grid ? [...grid.querySelectorAll('.trend-card:not(.trend-card-skel)')] : [card];
    list = cards.map((c) => ({ type: 'trend', query: c.dataset.query || '', category: c.dataset.cat || '', startedAt: c.dataset.started || '', trendBreakdown: parseBd(c) }));
    index = cards.indexOf(card); if (index < 0) index = 0;
  }
  window.dispatchEvent(new CustomEvent('open-insight-modal', { detail: {
    ...list[index],
    nav: { list, index, backLabel: 'View All Trending', backEvent: 'open-trending-list', itemKind: 'trend' },
  } }));
}

// Clicking a trend card opens its single combined AI brief.
function wireTrendCards(container) {
  container.querySelectorAll('.trend-card').forEach(card => {
    if (card.classList.contains('trend-card-skel')) return;
    card.querySelector('.trend-card-trigger')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showTrendBrief(card);
    });
  });
}

const TREND_EXP_CLOSE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

// Homepage variant (Phase 5): clicking a trend card EXPANDS its grounded brief
// INLINE (accordion) instead of opening a modal. The expanded card spans the
// full grid width; one card open at a time; a Close (or re-click) collapses it.
function wireTrendCardsInline(container) {
  const collapse = (card) => {
    card.classList.remove('is-expanded');
    card.querySelector('.trend-card-trigger')?.setAttribute('aria-expanded', 'false');
    card.querySelector('[data-trend-ai]')?.setAttribute('aria-expanded', 'false');
    card.querySelector('.trend-card-exp')?.remove();
  };
  const openCard = async (card) => {
    container.querySelectorAll('.trend-card.is-expanded').forEach((c) => { if (c !== card) collapse(c); });
    const term = card.dataset.query || '';
    card.classList.add('is-expanded');
    card.querySelector('.trend-card-trigger')?.setAttribute('aria-expanded', 'true');
    card.querySelector('[data-trend-ai]')?.setAttribute('aria-expanded', 'true');
    let exp = card.querySelector('.trend-card-exp');
    if (!exp) { exp = document.createElement('div'); exp.className = 'trend-card-exp'; card.appendChild(exp); }
    exp.innerHTML = `<div class="ni-inner">${niStyleLoaderHTML()}</div>`;
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'trend', query: term }) });
      const data = res.ok ? await res.json() : null;
      if (!data || data.unavailable || !data.content) {
        exp.innerHTML = `<div class="trend-exp-fail"><span class="trend-exp-tx">This brief is still being generated — check back shortly.</span> <button type="button" class="trend-exp-retry">Try again</button></div>`;
        exp.querySelector('.trend-exp-retry')?.addEventListener('click', () => openCard(card));
        return;
      }
      // Still the expanded card? (user may have collapsed while fetching)
      if (!card.classList.contains('is-expanded')) return;
      exp.innerHTML = `<button type="button" class="trend-exp-close" aria-label="Close">${TREND_EXP_CLOSE}</button>${renderTrendExpansionBody(term, data)}`;
      exp.querySelector('.trend-exp-close')?.addEventListener('click', (e) => { e.stopPropagation(); collapse(card); });
      wireInsightTabs(exp);
      wireExploreFurther(exp);
    } catch (_) {
      exp.innerHTML = `<div class="trend-exp-fail"><span class="trend-exp-tx">Couldn't load this brief.</span> <button type="button" class="trend-exp-retry">Try again</button></div>`;
      exp.querySelector('.trend-exp-retry')?.addEventListener('click', () => openCard(card));
    }
  };
  container.querySelectorAll('.trend-card').forEach((card) => {
    if (card.classList.contains('trend-card-skel')) return;
    const toggle = (e) => {
      e.stopPropagation();
      if (card.classList.contains('is-expanded')) collapse(card);
      else openCard(card);
    };
    // Desktop: the whole card row is the trigger. Mobile: the explicit
    // "View AI Insights" button is the affordance. Both toggle the same brief.
    card.querySelector('.trend-card-trigger')?.addEventListener('click', toggle);
    card.querySelector('[data-trend-ai]')?.addEventListener('click', toggle);
  });
}

function trendCardsHead(fetched) {
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>';
  return `
    <div class="trending-topics-head">
      <div class="trending-topics-titlerow">
        <span class="trending-topics-logo">${ICON}</span>
        <h3 class="trending-topics-title"><span>Trending</span></h3>
        ${fetched ? `<span class="trending-topics-updated">Updated ${escapeHTML(relativeTime(fetched))}</span>` : ''}
      </div>
    </div>`;
}
// Legend pill (upper-left of the card body): defines the two card glyphs — the
// blue sparkle (AI-generated text) and the trend up-arrow (via Google Trends).
// The two items sit side by side and wrap as whole units when space is tight.
function trendLegendRow() {
  // Just the "✦ = AI-generated text" marker (the trend-icon "via Google Trends"
  // reference was noise) — sized between the card and the modal legend (#166).
  return `<div class="trend-legend-row">
    <div class="trend-legend trend-legend--solo">
      <span class="trend-legend-item">${aiSparkInline()}<span>Trend summaries are AI-generated.</span></span>
    </div>
  </div>`;
}

function trendCardsShell(topics, { fetched, viewAll }) {
  return `
    <div class="trending-topics">
      ${trendCardsHead(fetched)}
      ${trendLegendRow()}
      <div class="trend-card-grid">${topics.map((t, i) => trendCardHTML(t, i)).join('')}</div>
      ${viewAll ? `<button type="button" class="trending-topics-viewall" data-action="view-all-trending">View all trending ${CHEV}</button>` : ''}
    </div>`;
}

function trendCardsSkeleton() {
  const cards = Array.from({ length: 6 }, () => `<div class="trend-card trend-card-skel"></div>`).join('');
  return `<div class="trending-topics">${trendCardsHead(null)}<div class="trend-card-grid">${cards}</div></div>`;
}

// Preferred category order (shared): these first, then the rest A→Z, Other last.
const TT_CAT_ORDER = ['Politics', 'Entertainment', 'Sports', 'Law and Government'];
function ttCatRank(c) { const i = TT_CAT_ORDER.indexOf(c); if (i !== -1) return i; return c === 'Other' ? 999 : 500; }
function ttCatOf(t) { return (t.categories && t.categories[0]) || ''; }
// Sports-exclude state (Trending dropdown only). In-memory, NOT persisted — every
// fresh load defaults to sports INCLUDED; toggling off applies only for the session
// so "Include Sports Trends" is reliably on by default (#img437/438).
let sportsExcluded = false;
function isExcludeSports() { return sportsExcluded; }
function setExcludeSports(v) { sportsExcluded = !!v; }
function ttIsSports(t) { return /^sports$/i.test(ttCatOf(t) || ''); }
const TREND_SPORTS_TOGGLE_HTML = () => {
  const inc = !isExcludeSports();
  return `<button type="button" class="trend-sports-toggle" data-trend-sports-toggle role="switch" aria-checked="${inc ? 'true' : 'false'}" title="Show or hide sports trends">
    <span class="trend-sports-toggle-label">Include Sports Trends</span>
    <span class="trend-sports-toggle-track"><span class="trend-sports-toggle-thumb"></span></span>
  </button>`;
};

// Render the "Trending Topics" card grid with a Category filter. limit caps how
// many cards; viewAll adds a "View all trending →" button (opens the modal).
export function renderTrendingTopics(container, { limit = 20, viewAll = false } = {}) {
  container.innerHTML = trendCardsSkeleton();
  const state = { all: [], fetched: null, category: 'all' };
  const catList = () => [...new Set(state.all.map(ttCatOf).filter(Boolean))]
    .sort((a, b) => (ttCatRank(a) - ttCatRank(b)) || a.localeCompare(b));

  function controlsHTML() {
    // Category filter removed (#73).
    return '';
  }
  function visible() {
    const items = state.category === 'all' ? state.all : state.all.filter(t => ttCatOf(t) === state.category);
    return items.slice(0, limit);
  }
  function renderGrid() {
    const grid = container.querySelector('.trend-card-grid');
    if (!grid) return;
    const shown = visible();
    grid.innerHTML = shown.length ? shown.map((t, i) => trendCardHTML(t, i)).join('') : '<p class="trending-empty">No trends in this category right now.</p>';
    wireTrendCards(container);
  }
  function renderShell() {
    const shown = visible();
    container.innerHTML = `
      <div class="trending-topics">
        ${trendCardsHead(state.fetched)}
        <div class="trend-controls-legend">${controlsHTML()}${trendLegendRow()}</div>
        <div class="trend-card-grid">${shown.map((t, i) => trendCardHTML(t, i)).join('')}</div>
        ${viewAll ? `<button type="button" class="trending-topics-viewall" data-action="view-all-trending">View all trending ${CHEV}</button>` : ''}
      </div>`;
    wireTrendCards(container);
    container.querySelector('.trend-cat-select')?.addEventListener('change', (e) => { state.category = e.target.value; renderGrid(); });
    container.querySelector('[data-action="view-all-trending"]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('open-trending-list'));
    });
  }

  fetchTrending().then(({ topics, fetched }) => {
    if (!topics.length) {
      container.innerHTML = `<div class="trending-topics">${trendCardsHead(null)}<p class="trending-empty">Trending is taking a break — check back soon.</p></div>`;
      return;
    }
    state.all = topics; state.fetched = fetched;
    renderShell();
  }).catch(() => {
    container.innerHTML = `<div class="trending-topics"><div class="trending-topics-head"><h3 class="trending-topics-title">Trending Topics</h3></div><p class="trending-empty">Trending is taking a break — check back soon.</p></div>`;
  });
}

// Back-compat name used by the Trending modal — full card grid, no cap badge.
export function renderTrending(container) {
  renderTrendingTopics(container, { limit: 20, viewAll: false });
}

// Trending MODAL variant (#81): the legend + category filter live in the modal's
// STICKY header (always visible) and only the card grid scrolls in the body. The
// modal passes two mount points — `controlsEl` (in the header, under the subtext)
// and `gridEl` (the scrolling body).
export function renderTrendingModal(controlsEl, gridEl, opts = {}) {
  // opts.inline → trend cards expand their brief IN PLACE (Phase-5 dropdown),
  // instead of opening the retired detail modal.
  const wireCards = opts.inline ? wireTrendCardsInline : wireTrendCards;
  gridEl.innerHTML = `<div class="trend-card-grid">${Array.from({ length: 8 }, () => '<div class="trend-card trend-card-skel"></div>').join('')}</div>`;
  const TLM_INITIAL = 16, EARLIER_MAX = 24;
  const state = { all: [], earlier: [], category: 'all', expanded: false,
    // Trend to auto-open when launched from the Search dropdown (#img319). Kept for
    // a short window so it survives loadEarlier()'s re-render, which was collapsing
    // it right after it opened.
    autoExpand: (opts.inline && opts.expandQuery) ? String(opts.expandQuery).toLowerCase().trim() : null };
  if (state.autoExpand) setTimeout(() => { state.autoExpand = null; }, 2500);
  const catList = () => [...new Set(state.all.map(ttCatOf).filter(Boolean))]
    .sort((a, b) => (ttCatRank(a) - ttCatRank(b)) || a.localeCompare(b));

  function controlsHTML() {
    // AI-generated legend + the sports include/exclude toggle (dropdown only).
    return `<div class="tlm-controlbar-inner">
      <div class="trend-legend trend-legend--solo">
        <span class="trend-legend-item">${aiSparkInline()}<span>Trend summaries are AI-generated.</span></span>
      </div>
      ${TREND_SPORTS_TOGGLE_HTML()}
    </div>`;
  }
  function visible() {
    let list = state.category === 'all' ? state.all : state.all.filter((t) => ttCatOf(t) === state.category);
    if (isExcludeSports()) list = list.filter((t) => !ttIsSports(t));
    return list;
  }
  function earlierVisible() {
    let list = state.category === 'all' ? state.earlier : state.earlier.filter((t) => ttCatOf(t) === state.category);
    if (isExcludeSports()) list = list.filter((t) => !ttIsSports(t));
    return list.slice(0, EARLIER_MAX);
  }
  function renderGrid() {
    const all = visible();
    const earlier = earlierVisible();
    if (!all.length && !earlier.length) { gridEl.innerHTML = '<p class="trending-empty">No trends in this category right now.</p>'; return; }
    const shown = state.expanded ? all : all.slice(0, TLM_INITIAL);
    const hiddenLive = all.length - shown.length;
    let html = '';
    if (shown.length) html += `<div class="trend-card-grid">${shown.map((t, i) => trendCardHTML(t, i)).join('')}</div>`;
    // "Earlier" (terms that WERE trending, not now) flows in below the live grid —
    // but ONLY once "View more" is clicked, so it's never a standalone bottom bucket.
    if (state.expanded && earlier.length) {
      html += `<div class="trend-earlier">
        <div class="trend-earlier-head"><span class="trend-earlier-title">Earlier</span><span class="trend-earlier-sub">Recently trending, not right now</span></div>
        <div class="trend-card-grid">${earlier.map((t, i) => trendCardHTML(t, 5000 + i, { metaText: t._meta, past: true })).join('')}</div>
      </div>`;
    }
    // A single "View more" reveals the rest of the live set AND the Earlier section.
    const moreCount = hiddenLive + (state.expanded ? 0 : earlier.length);
    if (!state.expanded && moreCount > 0) {
      html += `<div class="trend-loadmore-row"><button type="button" class="trend-loadmore" data-loadmore>View more trends <span class="trend-loadmore-count">+${moreCount}</span></button></div>`;
    }
    gridEl.innerHTML = html;
    wireCards(gridEl);
    gridEl.querySelector('[data-loadmore]')?.addEventListener('click', () => { state.expanded = true; renderGrid(); });
    // Re-apply the Search-launched auto-open on EVERY render (survives loadEarlier's
    // re-render); if it's not in the shown set, reveal the rest first (#img319).
    if (state.autoExpand) {
      let card = [...gridEl.querySelectorAll('.trend-card')].find((c) => (c.dataset.query || '').toLowerCase().trim() === state.autoExpand);
      if (!card && !state.expanded && (hiddenLive || earlier.length)) { state.expanded = true; renderGrid(); return; }
      if (card && !card.classList.contains('is-expanded')) {
        requestAnimationFrame(() => {
          card = [...gridEl.querySelectorAll('.trend-card')].find((c) => (c.dataset.query || '').toLowerCase().trim() === state.autoExpand);
          if (card && !card.classList.contains('is-expanded')) { card.querySelector('.trend-card-trigger')?.click(); try { card.scrollIntoView({ block: 'nearest' }); } catch (_) {} }
        });
      }
    }
  }
  function renderControls() {
    controlsEl.innerHTML = controlsHTML();
    controlsEl.querySelector('.trend-cat-select')?.addEventListener('change', (e) => { state.category = e.target.value; state.expanded = false; renderGrid(); });
    // Sports include/exclude toggle — filters the live + Earlier lists and backfills
    // the shown set with non-sports trends; the reveal count resets so it re-fills.
    controlsEl.querySelector('[data-trend-sports-toggle]')?.addEventListener('click', () => {
      setExcludeSports(!isExcludeSports());
      state.expanded = false;
      renderControls();
      renderGrid();
    });
  }
  // Pull the last 3 days of stored trends, drop anything still live (matched by
  // query), and present the rest as "Earlier". Cross-checks against state.all so
  // a currently-trending term is never duplicated into the past section.
  function loadEarlier() {
    let from, to;
    try { const now = Date.now(); to = new Date(now).toISOString(); from = new Date(now - 3 * 24 * 3600 * 1000).toISOString(); } catch (_) { return; }
    const liveSet = new Set(state.all.map((t) => String(t.query || '').toLowerCase().trim()));
    fetch(`/api/trending-history?mode=range&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&sort=recent&limit=80`, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const items = (d && d.items) || [];
        const mapped = []; const seen = new Set();
        for (const it of items) {
          const q = String(it.query || '').trim();
          const key = q.toLowerCase();
          if (!q || liveSet.has(key) || seen.has(key)) continue;
          seen.add(key);
          // Use the term's OWN started_at (Google's per-term "trending since") for
          // the label — last_seen is the shared batch-snapshot time, so it made
          // every Earlier row read the same "35m ago" (#img262). started_at varies
          // per term and reads as roughly when it was hot.
          const stamp = it.started_at || it.last_active || it.last_seen;
          const ago = durationLabel(stamp);
          mapped.push({
            query: q,
            categories: it.category ? [it.category] : [],
            startedAt: it.started_at || '',
            trendBreakdown: [],
            _startedAt: stamp || '',
            _meta: [it.category, ago ? `Was trending ${ago} ago` : ''].filter(Boolean).join(' · '),
          });
        }
        // Order by trend recency (most-recently-started first) — the server sorts
        // by the uniform last_seen, which leaves same-batch rows effectively random.
        mapped.sort((a, b) => new Date(b._startedAt || 0).getTime() - new Date(a._startedAt || 0).getTime());
        state.earlier = mapped;
        if (mapped.length) renderGrid();
      })
      .catch(() => {});
  }

  fetchTrending().then(({ topics }) => {
    if (!topics.length) { controlsEl.innerHTML = ''; gridEl.innerHTML = '<p class="trending-empty">Trending is taking a break — check back soon.</p>'; return; }
    state.all = topics;
    renderControls();
    renderGrid();   // renderGrid applies state.autoExpand (survives loadEarlier re-render)
    loadEarlier();
  }).catch(() => { controlsEl.innerHTML = ''; gridEl.innerHTML = '<p class="trending-empty">Trending is taking a break — check back soon.</p>'; });
}

// ===== Homepage trending with Now ⇄ Over-time + category filter ==========
// "Now" = current snapshot (/api/trending). "Over time" = stored history
// (/api/trending-history mode=range), sortable. Category pills are built from
// Google Trends' own categories present in the loaded data.
export function renderTrendingHome(container, { limit = 12 } = {}) {
  const state = { mode: 'now', category: 'all', sort: 'recent', items: [], loading: true };

  const normNow = (topics) => (topics || []).map(t => ({
    query: t.query, categories: t.categories || [], startedAt: t.startedAt,
    summary: t.summary || null, sources: t.sources || null,
    _cat: (t.categories && t.categories[0]) || '',
  }));
  const normOver = (rows) => (rows || []).map(r => ({
    query: r.query, categories: r.category ? [r.category] : [], startedAt: r.started_at,
    summary: r.summary || null, sources: r.sources || null,
    _cat: r.category || '',
  }));
  // Preferred category order: these first (in this order), then the rest
  // alphabetically, with "Other" always last.
  const CAT_ORDER = ['Politics', 'Entertainment', 'Sports', 'Law and Government'];
  const catRank = (c) => {
    const i = CAT_ORDER.indexOf(c);
    if (i !== -1) return i;
    return c === 'Other' ? 999 : 500;
  };
  const catList = () => [...new Set(state.items.map(i => i._cat).filter(Boolean))]
    .sort((a, b) => (catRank(a) - catRank(b)) || a.localeCompare(b));

  async function load() {
    state.loading = true; renderShell();
    try {
      if (state.mode === 'now') {
        const { topics } = await fetchTrending();
        state.items = normNow(topics);
      } else {
        const to = new Date().toISOString();
        const from = new Date(Date.now() - 7 * 864e5).toISOString();
        const res = await fetch(`/api/trending-history?mode=range&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&sort=${encodeURIComponent(state.sort)}&limit=60`, { headers: { Accept: 'application/json' } });
        const data = res.ok ? await res.json() : { items: [] };
        state.items = normOver(data.items);
      }
    } catch (_) { state.items = []; }
    state.loading = false;
    if (state.category !== 'all' && !catList().includes(state.category)) state.category = 'all';
    renderShell();
  }

  function headHTML() {
    const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>';
    return `
      <div class="trending-topics-head">
        <div class="trending-topics-titlerow">
          <span class="trending-topics-logo">${ICON}</span>
          <h3 class="trending-topics-title"><span>Trending</span></h3>
        </div>
      </div>`;
  }

  // Homepage trending has no controls now — category filtering lives in the
  // "View more" trending modal where there's room for it.
  function controlsHTML() { return ''; }

  function renderGrid() {
    const grid = container.querySelector('#trend-home-grid');
    if (!grid) return;
    if (state.loading) { grid.innerHTML = Array.from({ length: 6 }, () => `<div class="trend-card trend-card-skel"></div>`).join(''); return; }
    let items = state.items;
    if (state.category !== 'all') items = items.filter(i => i._cat === state.category);
    // Front-facing slots: prefer category variety — at most one per category,
    // backfilling with the skipped ones only if there aren't enough distinct
    // categories to fill `limit`. (The "View more" modal keeps the full order.)
    const seen = new Set(); const primary = []; const extra = [];
    for (const it of items) {
      const c = it._cat || '';
      if (c && seen.has(c)) extra.push(it); else { seen.add(c); primary.push(it); }
    }
    items = primary.concat(extra).slice(0, limit);
    if (!items.length) { grid.innerHTML = `<p class="trending-empty">No trends ${state.mode === 'over' ? 'in this window yet' : 'right now'}.</p>`; return; }
    grid.innerHTML = items.map((t, i) => trendCardHTML(t, i)).join('');
    // Homepage trends expand their brief inline (Phase 5), no modal.
    wireTrendCardsInline(grid);
  }

  function renderShell() {
    container.innerHTML = `
      <div class="trending-topics trending-home">
        ${headHTML()}
        ${controlsHTML()}
        ${trendLegendRow()}
        <div class="trend-card-grid" id="trend-home-grid"></div>
        <div class="trend-viewmore-row">
          <button type="button" class="trend-viewmore" data-action="view-all-trending">View more trending</button>
        </div>
      </div>`;
    container.querySelector('.trend-cat-select')?.addEventListener('change', (e) => {
      state.category = e.target.value; renderGrid();
    });
    container.querySelector('[data-action="view-all-trending"]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('open-trending-list'));
    });
    renderGrid();
  }

  load();
}
