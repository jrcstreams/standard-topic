// Homepage Trending Now card. Lists US Google-Trends searches (via
// /api/trending); each row links to the Custom Search page. Title +
// separator match News Feed / Topic Intelligence; the list is a tight
// fixed-height scroll area with top/bottom fade + chevron affordances
// (no expand button) reusing the shared .scroll-fade indicators.
import { fetchTrending } from '../utils/trending.js';

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

// Quick-insight links shown when a trend is clicked — each opens the shared
// prompt modal (open-prompt-modal) so the user can submit it to an AI model.
const TREND_INSIGHTS = [
  { key: 'explain', label: 'Explain', ask: 'Explain what "{term}" is and why it\'s in the news right now.' },
  { key: 'why', label: 'Why now', ask: 'Why is "{term}" trending right now — what just happened?' },
  { key: 'background', label: 'Background', ask: 'Give the background and context on "{term}".' },
  { key: 'latest', label: 'Latest', ask: 'What\'s the latest news and key developments on "{term}"?' },
];

// Compact 2-row card: [category · trending-for] on top, term below. Clicking
// the card opens an attached dropdown of quick insight links (no modal).
function trendCardHTML(topic, idx) {
  const cat = (topic.categories && topic.categories[0]) || '';
  const dur = durationLabel(topic.startedAt);
  const title = titleCase(topic.query);
  // Line 2: the topic/category and how long it's been trending, sentence-case.
  const meta = [cat, dur ? `trending ${dur}` : ''].filter(Boolean).join(' · ');
  return `
    <div class="trend-card" data-idx="${idx}" data-query="${escapeAttr(title)}">
      <button type="button" class="trend-card-trigger" aria-expanded="false" title="Quick insights on ${escapeAttr(title)}">
        <span class="trend-card-main">
          <span class="trend-card-head">
            <span class="trend-card-icon" aria-hidden="true">${TREND_CARD_ICON}</span>
            <span class="trend-card-title">${escapeHTML(title)}</span>
          </span>
          ${meta ? `<span class="trend-card-meta">${escapeHTML(meta)}</span>` : ''}
        </span>
        <span class="trend-card-chev" aria-hidden="true">${CHEV_DOWN}</span>
      </button>
      <div class="trend-card-panel"><div class="trend-card-panel-inner">
        <div class="trend-ai-head">${AI_SPARK_SVG}<span>AI Insights</span></div>
        ${TREND_INSIGHTS.map(o => `<button type="button" class="trend-ai-opt" data-insight="${o.key}">${escapeHTML(o.label)}</button>`).join('')}
      </div></div>
    </div>`;
}

// Wire trend-card dropdowns: click toggles its menu; option → prompt modal.
function wireTrendCards(container) {
  const closeAll = (except) => container.querySelectorAll('.trend-card.is-open').forEach(c => {
    if (c !== except) { c.classList.remove('is-open'); c.querySelector('.trend-card-trigger')?.setAttribute('aria-expanded', 'false'); }
  });
  container.querySelectorAll('.trend-card').forEach(card => {
    if (card.classList.contains('trend-card-skel')) return;
    const trigger = card.querySelector('.trend-card-trigger');
    trigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !card.classList.contains('is-open');
      closeAll(card);
      card.classList.toggle('is-open', willOpen);
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    card.querySelectorAll('.trend-ai-opt').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const term = card.dataset.query || '';
        const meta = TREND_INSIGHTS.find(i => i.key === opt.dataset.insight) || TREND_INSIGHTS[0];
        window.dispatchEvent(new CustomEvent('open-prompt-modal', {
          detail: { basePrompt: meta.ask.replace(/\{term\}/g, term), topicName: term, name: `Trending · ${meta.label}`, count: 1 },
        }));
        closeAll(null);
      });
    });
  });
  if (!container.__trendClose) {
    container.__trendClose = true;
    document.addEventListener('click', () => closeAll(null));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(null); });
  }
}

function trendCardsHead(fetched) {
  return `
    <div class="trending-topics-head">
      <div class="trending-topics-titlerow">
        <h3 class="trending-topics-title"><span>Trending</span></h3>
        ${fetched ? `<span class="trending-topics-updated">Updated ${escapeHTML(relativeTime(fetched))}</span>` : ''}
      </div>
      <p class="trending-topics-sub">Trending search terms from <a class="trending-topics-src" href="https://trends.google.com/trending" target="_blank" rel="noopener noreferrer">Google Trends</a></p>
    </div>`;
}

function trendCardsShell(topics, { fetched, viewAll }) {
  return `
    <div class="trending-topics">
      ${trendCardsHead(fetched)}
      <div class="trend-card-grid">${topics.map((t, i) => trendCardHTML(t, i)).join('')}</div>
      ${viewAll ? `<button type="button" class="trending-topics-viewall" data-action="view-all-trending">View all trending ${CHEV}</button>` : ''}
    </div>`;
}

function trendCardsSkeleton() {
  const cards = Array.from({ length: 6 }, () => `<div class="trend-card trend-card-skel"></div>`).join('');
  return `<div class="trending-topics">${trendCardsHead(null)}<div class="trend-card-grid">${cards}</div></div>`;
}

// Render the "Trending Topics" card grid. limit caps how many cards;
// viewAll adds a "View all trending →" button (opens the Trending modal).
export function renderTrendingTopics(container, { limit = 20, viewAll = false } = {}) {
  container.innerHTML = trendCardsSkeleton();
  fetchTrending().then(({ topics, fetched }) => {
    if (!topics.length) {
      container.innerHTML = `<div class="trending-topics">${trendCardsHead(null)}<p class="trending-empty">Trending is taking a break — check back soon.</p></div>`;
      return;
    }
    const shown = topics.slice(0, limit);
    container.innerHTML = trendCardsShell(shown, { fetched, viewAll });
    wireTrendCards(container);
    container.querySelector('[data-action="view-all-trending"]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('open-trending-list'));
    });
  }).catch(() => {
    container.innerHTML = `<div class="trending-topics"><div class="trending-topics-head"><h3 class="trending-topics-title">Trending Topics</h3></div><p class="trending-empty">Trending is taking a break — check back soon.</p></div>`;
  });
}

// Back-compat name used by the Trending modal — full card grid, no cap badge.
export function renderTrending(container) {
  renderTrendingTopics(container, { limit: 20, viewAll: false });
}
