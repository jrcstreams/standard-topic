// Homepage Trending Topics card. Lists US Google-Trends searches (via
// /api/trending); each row links to the Custom Search page. Shows 7 rows
// collapsed, expands to the full ~20 in a scroll area. Matches the Topic
// Intelligence sidebar card's look & feel.
import { fetchTrending } from '../utils/trending.js';

const COLLAPSED_COUNT = 7;

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

const FLAME = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1 3-1.5 4.5-2.5 6S8 12 9 13c.5-1 1.5-1.5 2-2.5.8 1.2 2 2 2 3.7a3 3 0 0 1-6 0c0-.6.1-1.1.3-1.6C5.5 14 4.5 16 4.5 18a7.5 7.5 0 0 0 15 0c0-4.5-4-6-7.5-16z"/></svg>`;
const CHEV = `<svg class="trending-row-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;

function rowHTML(topic) {
  const q = topic.query;
  return `
    <li class="trending-row-item">
      <a class="trending-row" href="#/custom/${encodeURIComponent(q)}" title="Search ${escapeAttr(q)}">
        <span class="trending-row-text">${escapeHTML(q)}</span>
        ${CHEV}
      </a>
    </li>`;
}

function listMarkup(topics, expanded) {
  const shown = expanded ? topics : topics.slice(0, COLLAPSED_COUNT);
  const remaining = topics.length - COLLAPSED_COUNT;
  const moreBtn = remaining > 0
    ? `<button type="button" class="trending-more" id="trending-more" aria-expanded="${expanded}">
         ${expanded ? 'Show less' : `Show more (${remaining})`}
       </button>`
    : '';
  return `
    <ul class="trending-list ${expanded ? 'is-expanded' : ''}">${shown.map(rowHTML).join('')}</ul>
    ${moreBtn}`;
}

function shell(bodyHTML, fetched) {
  const updated = fetched ? `<span class="trending-updated">Updated ${escapeHTML(relativeTime(fetched))}</span>` : '';
  return `
    <div class="sidebar-card trending-card">
      <div class="sidebar-card-header trending-header">
        <span class="trending-icon" aria-hidden="true">${FLAME}</span>
        <div class="trending-heading">
          <h3 class="sidebar-card-title trending-title">Trending Topics</h3>
          <span class="trending-attr">via Google Trends</span>
        </div>
      </div>
      <div class="trending-body" id="trending-body">${bodyHTML}</div>
      <div class="trending-foot">${updated}</div>
    </div>`;
}

function skeleton() {
  const rows = Array.from({ length: COLLAPSED_COUNT }, () => `<li class="trending-skel-row"></li>`).join('');
  return shell(`<ul class="trending-list trending-skeleton">${rows}</ul>`, null);
}

export function renderTrending(container) {
  container.innerHTML = skeleton();

  fetchTrending().then(({ topics, fetched }) => {
    if (!topics.length) {
      container.innerHTML = shell(`<p class="trending-empty">Trending is taking a break — check back soon.</p>`, fetched);
      return;
    }
    let expanded = false;
    const paint = () => {
      container.innerHTML = shell(listMarkup(topics, expanded), fetched);
      const moreBtn = container.querySelector('#trending-more');
      if (moreBtn) moreBtn.addEventListener('click', () => { expanded = !expanded; paint(); });
    };
    paint();
  }).catch(() => {
    container.innerHTML = shell(`<p class="trending-empty">Trending is taking a break — check back soon.</p>`, null);
  });
}
