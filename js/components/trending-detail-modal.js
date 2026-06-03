// Slim modal shown when a Trending Now row is clicked. Renders the term,
// related searches + a Google Trends link, the admin-managed Trending 101
// shortcuts, and the Topic-Intelligence accordions scoped to the term
// ("Trending Intelligence"). Opened via the `open-trending-detail` event
// with the full trending item. Shortcut clicks reuse the existing prompt
// modal (`open-prompt-modal`).
import { getTrending101, getTrendingIntelligenceShortcuts, getExternalSearches, getExternalSearchCategories } from '../utils/data.js';
import { groupShortcuts, renderTIAccordion, webSourceItem } from './ti-shortcuts.js';

let overlayEl = null;
let panelEl = null;

function escapeHTML(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function escapeAttr(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
function titleCase(s) { return String(s || '').replace(/\b\w/g, c => c.toUpperCase()); }
function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return `${m || 1} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function initTrendingDetailModal() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'td-overlay';
  overlayEl.style.display = 'none';
  document.body.appendChild(overlayEl);

  panelEl = document.createElement('div');
  panelEl.className = 'td-panel';
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-modal', 'true');
  panelEl.setAttribute('aria-label', 'Trending topic');
  panelEl.style.display = 'none';
  document.body.appendChild(panelEl);

  window.addEventListener('open-trending-detail', (e) => open(e.detail));
  overlayEl.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') close();
  });
}

function shortcutRow(s, term) {
  const prompt = (s.prompt || '').replace(/\{topic\}/gi, term);
  const desc = s.description ? `<span class="td-row-desc">${escapeHTML(s.description)}</span>` : '';
  return `<button type="button" class="td-shortcut" data-prompt="${escapeAttr(prompt)}" data-name="${escapeAttr(s.name)}" data-icon="${escapeAttr(s.icon || '')}">
      <span class="td-row-text"><span class="td-row-name">${escapeHTML(s.name)}</span>${desc}</span>
      <svg class="td-row-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
    </button>`;
}

// Topic-Intelligence accordions (Web Sources + Discover/Learn/Analyze/More)
// scoped to the trending term, reusing the shared TI builders.
function trendingIntelligenceHTML(term) {
  let html = '<div class="ti-accordions">';

  const searches = getExternalSearches();
  if (searches.length) {
    const cats = getExternalSearchCategories();
    const order = cats.length ? cats.slice() : [{ key: '__all', label: '' }];
    const known = new Set(order.map(c => c.key));
    const leftovers = searches.filter(s => !known.has(s.category));
    if (leftovers.length) order.push({ key: '__other', label: 'Other' });
    const groupsHTML = order.map(cat => {
      const items = cat.key === '__other' ? leftovers
        : cat.key === '__all' ? searches
        : searches.filter(s => s.category === cat.key);
      if (!items.length) return '';
      const heading = cat.label ? `<li class="ti-subhead" aria-hidden="true">${escapeHTML(cat.label)}</li>` : '';
      return `<ul class="ti-item-list ti-item-list-grouped">${heading}${items.map(s => webSourceItem(s, term)).join('')}</ul>`;
    }).join('');
    html += renderTIAccordion({ key: 'websources', label: 'Web Sources', open: false, bodyHTML: `<div class="ti-source-groups">${groupsHTML}</div>` });
  }

  const groups = groupShortcuts(getTrendingIntelligenceShortcuts(), {});
  (groups.__order || []).forEach(g => {
    const items = groups[g.key];
    if (!items || !items.length) return;
    html += renderTIAccordion({
      key: g.key, label: g.label, open: false,
      bodyHTML: `<ul class="ti-item-list td-shortcut-list">${items.map(s => shortcutRow(s, term)).join('')}</ul>`,
    });
  });

  html += '</div>';
  return html;
}

function open(item) {
  if (!item || !item.query) return;
  const term = item.query;
  const since = relTime(item.startedAt);
  const cat = item.category || (Array.isArray(item.categories) ? item.categories[0] : '') || '';
  const subParts = [cat, since ? `Trending since ${since}` : ''].filter(Boolean).join(' · ');
  const related = Array.isArray(item.trendBreakdown) ? item.trendBreakdown.slice(0, 6) : [];
  const t101 = getTrending101();

  panelEl.innerHTML = `
    <div class="td-header">
      <div class="td-head-text">
        <span class="td-eyebrow">Trending Now</span>
        <h3 class="td-title">${escapeHTML(titleCase(term))}</h3>
        ${subParts ? `<p class="td-sub">${escapeHTML(subParts)}</p>` : ''}
      </div>
      <button type="button" class="td-close" id="td-close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>
      </button>
    </div>
    <div class="td-body">
      ${related.length ? `<p class="td-related"><span class="td-related-label">Related:</span> ${related.map(escapeHTML).join(' · ')}</p>` : ''}
      ${item.googleTrendsUrl ? `<a class="td-trends-link" href="${escapeAttr(item.googleTrendsUrl)}" target="_blank" rel="noopener noreferrer">View on Google Trends ↗</a>` : ''}
      ${t101.length ? `<section class="td-section">
        <div class="td-section-label">Trending 101</div>
        <ul class="ti-item-list td-shortcut-list">${t101.map(s => shortcutRow(s, term)).join('')}</ul>
      </section>` : ''}
      <section class="td-section">
        <div class="td-section-label">Trending Intelligence</div>
        ${trendingIntelligenceHTML(term)}
      </section>
    </div>`;

  panelEl.querySelector('#td-close').addEventListener('click', close);
  panelEl.querySelectorAll('.td-shortcut').forEach(btn => {
    btn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('open-prompt-modal', {
        detail: { basePrompt: btn.dataset.prompt || '', topicName: term, name: btn.dataset.name, iconKey: btn.dataset.icon, count: 1 },
      }));
    });
  });

  overlayEl.style.display = 'block';
  panelEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  panelEl.scrollTop = 0;
}

function close() {
  overlayEl.style.display = 'none';
  panelEl.style.display = 'none';
  panelEl.innerHTML = '';
  document.body.style.overflow = '';
}
