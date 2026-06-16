// Homepage Trending Now card. Lists US Google-Trends searches (via
// /api/trending); each row links to the Custom Search page. Title +
// separator match News Feed / Topic Intelligence; the list is a tight
// fixed-height scroll area with top/bottom fade + chevron affordances
// (no expand button) reusing the shared .scroll-fade indicators.
import { fetchTrending } from '../utils/trending.js';
import { renderTrendExpansionBody } from './trend-expansion.js';
import { aiSparkInline } from '../utils/ai-provenance.js?v=20260616-revamp225';

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
function trendCardHTML(topic, idx) {
  const cat = (topic.categories && topic.categories[0]) || '';
  const dur = durationLabel(topic.startedAt);
  const title = titleCase(topic.query);
  // Line 2: the topic/category and how long it's been trending, sentence-case.
  const meta = [cat, dur ? `Since ${dur} ago` : ''].filter(Boolean).join(' · ');
  return `
    <div class="trend-card" data-idx="${idx}" data-query="${escapeAttr(title)}" data-cat="${escapeAttr(cat)}" data-started="${escapeAttr(topic.startedAt || '')}" data-breakdown="${escapeAttr(JSON.stringify(Array.isArray(topic.trendBreakdown) ? topic.trendBreakdown.slice(0, 8) : []))}">
      <button type="button" class="trend-card-trigger" aria-expanded="false" title="Quick insights on ${escapeAttr(title)}">
        <span class="trend-card-main">
          <span class="trend-card-head">
            <span class="trend-card-icon" aria-hidden="true">${TREND_CARD_ICON}</span>
            <span class="trend-card-title">${escapeHTML(title)}</span>
          </span>
          ${meta ? `<span class="trend-card-meta">${escapeHTML(meta)}</span>` : ''}
          ${topic.summary && cleanSummary(topic.summary) ? `<span class="trend-card-summary">${aiSparkInline()}${escapeHTML(cleanSummary(topic.summary))}</span>` : ''}
        </span>
        <span class="trend-card-chev trend-card-open" aria-hidden="true">${OPEN_ICON}</span>
      </button>
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
    nav: { list, index, backLabel: 'All Trending', backEvent: 'open-trending-list', itemKind: 'trend' },
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

function trendCardsHead(fetched) {
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>';
  return `
    <div class="trending-topics-head">
      <div class="trending-topics-titlerow">
        <span class="trending-topics-logo">${ICON}</span>
        <h3 class="trending-topics-title"><span>Trending</span></h3>
        ${fetched ? `<span class="trending-topics-updated">Updated ${escapeHTML(relativeTime(fetched))}</span>` : ''}
      </div>
      <p class="trending-topics-sub">What's being searched for right now.</p>
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
      <span class="trend-legend-item">${aiSparkInline()}<span>= AI-generated text</span></span>
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

// Render the "Trending Topics" card grid with a Category filter. limit caps how
// many cards; viewAll adds a "View all trending →" button (opens the modal).
export function renderTrendingTopics(container, { limit = 20, viewAll = false } = {}) {
  container.innerHTML = trendCardsSkeleton();
  const state = { all: [], fetched: null, category: 'all' };
  const catList = () => [...new Set(state.all.map(ttCatOf).filter(Boolean))]
    .sort((a, b) => (ttCatRank(a) - ttCatRank(b)) || a.localeCompare(b));

  function controlsHTML() {
    const cats = catList();
    if (!cats.length) return '';
    const opts = ['all'].concat(cats).map(c =>
      `<option value="${escapeAttr(c)}"${state.category === c ? ' selected' : ''}>${c === 'all' ? 'All categories' : escapeHTML(c)}</option>`).join('');
    return `<div class="trend-controls trend-controls-grid"><label class="trend-select-field"><span class="trend-select-label">Category</span>
        <select class="trend-select trend-cat-select" aria-label="Filter by category">${opts}</select></label></div>`;
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
export function renderTrendingModal(controlsEl, gridEl) {
  gridEl.innerHTML = `<div class="trend-card-grid">${Array.from({ length: 8 }, () => '<div class="trend-card trend-card-skel"></div>').join('')}</div>`;
  const TLM_INITIAL = 16, TLM_STEP = 16;
  const state = { all: [], category: 'all', shown: TLM_INITIAL };
  const catList = () => [...new Set(state.all.map(ttCatOf).filter(Boolean))]
    .sort((a, b) => (ttCatRank(a) - ttCatRank(b)) || a.localeCompare(b));

  function controlsHTML() {
    const cats = catList();
    const catSel = cats.length ? `<label class="tlm-catfield"><span class="tlm-catfield-label">Category</span>
        <select class="trend-select trend-cat-select" aria-label="Filter by category">${['all'].concat(cats).map((c) =>
          `<option value="${escapeAttr(c)}"${state.category === c ? ' selected' : ''}>${c === 'all' ? 'All categories' : escapeHTML(c)}</option>`).join('')}</select></label>` : '';
    return `<div class="tlm-controlbar-inner">
      <div class="trend-legend trend-legend--solo">
        <span class="trend-legend-item">${aiSparkInline()}<span>= AI-generated text</span></span>
      </div>
      ${catSel}
    </div>`;
  }
  function visible() {
    return state.category === 'all' ? state.all : state.all.filter((t) => ttCatOf(t) === state.category);
  }
  function renderGrid() {
    const all = visible();
    if (!all.length) { gridEl.innerHTML = '<p class="trending-empty">No trends in this category right now.</p>'; return; }
    const shown = all.slice(0, state.shown);
    const more = all.length - shown.length;
    // Cap the list to an initial batch + a "View more" button that reveals the
    // rest (client-side) — only when more are actually available.
    gridEl.innerHTML = `<div class="trend-card-grid">${shown.map((t, i) => trendCardHTML(t, i)).join('')}</div>${
      more > 0 ? `<div class="trend-loadmore-row"><button type="button" class="trend-loadmore" data-loadmore>View more trends <span class="trend-loadmore-count">+${more}</span></button></div>` : ''}`;
    wireTrendCards(gridEl);
    gridEl.querySelector('[data-loadmore]')?.addEventListener('click', () => { state.shown += TLM_STEP; renderGrid(); });
  }
  function renderControls() {
    controlsEl.innerHTML = controlsHTML();
    controlsEl.querySelector('.trend-cat-select')?.addEventListener('change', (e) => { state.category = e.target.value; state.shown = TLM_INITIAL; renderGrid(); });
  }

  fetchTrending().then(({ topics }) => {
    if (!topics.length) { controlsEl.innerHTML = ''; gridEl.innerHTML = '<p class="trending-empty">Trending is taking a break — check back soon.</p>'; return; }
    state.all = topics;
    renderControls();
    renderGrid();
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
        <p class="trending-topics-sub">What's being searched for right now.</p>
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
    wireTrendCards(grid);
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
