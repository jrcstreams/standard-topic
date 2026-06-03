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
      <ul class="trending-list trending-scroll" id="trending-scroll">${topics.map(rowHTML).join('')}</ul>
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

export function renderTrending(container) {
  container.innerHTML = skeleton();

  fetchTrending().then(({ topics, fetched }) => {
    if (!topics.length) {
      container.innerHTML = shell(`<p class="trending-empty">Trending is taking a break — check back soon.</p>`, fetched);
      return;
    }
    container.innerHTML = shell(listShell(topics), fetched);
    wireScrollFade(container);
  }).catch(() => {
    container.innerHTML = shell(`<p class="trending-empty">Trending is taking a break — check back soon.</p>`, null);
  });
}
