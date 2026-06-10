// Web Sources card with the same in-place path navigation as the AI
// Intelligence component: a card with a branded header, a list of source
// CATEGORIES (Search & reference, Social, Audio & video, …), and — on clicking
// a category — a flip to that category's sources with a "Back to all web
// sources" link. The category's source list lives in the next "path" of the
// card (the card simply grows if the list is long).
import { getExternalSearches, getExternalSearchCategories } from '../utils/data.js';

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function escAttr(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

// Brand mark — a clean "layered sources" glyph (white on the navy tile).
const LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const EXT = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>';

// Per-category icon + one-line blurb (mirrors the old accordion meta).
const CAT = {
  search: { blurb: 'Search engines, encyclopedias, and reference.', icon: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' },
  noai:   { blurb: 'Web search with AI features turned off.', icon: '<path d="M12 2 4 5v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5z"/><line x1="4.5" y1="4" x2="19.5" y2="20"/>' },
  social: { blurb: 'Communities, threads, posts, newsletters, and long-form.', icon: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>' },
  media:  { blurb: 'Podcasts, video, and explainers.', icon: '<rect x="2" y="5" width="20" height="14" rx="2"/><polygon points="10 9 15 12 10 15"/>' },
  _:      { blurb: '', icon: '<circle cx="12" cy="12" r="9"/>' },
};
function catSvg(key) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(CAT[key] || CAT._).icon}</svg>`; }

export function renderWebSources(container, topic) {
  const topicName = (topic && topic.name) || '';
  const all = getExternalSearches() || [];
  const cats = getExternalSearchCategories() || [];
  const order = cats.slice();
  const known = new Set(order.map((c) => c.key));
  const leftovers = all.filter((s) => !known.has(s.category));
  if (leftovers.length) order.push({ key: '__other', label: 'Other' });
  const itemsFor = (key) => key === '__other' ? leftovers : all.filter((s) => s.category === key);
  const paths = order.filter((c) => itemsFor(c.key).length);

  let view = 'cats';
  let curKey = null;

  container.innerHTML = `
    <div class="ws">
      <div class="ws-head">
        <div class="ws-head-top"><span class="ws-logo">${LOGO}</span><span class="ws-brand">Web Sources</span></div>
        <p class="ws-headsub">Search platforms and primary content sources.</p>
      </div>
      <div class="ws-stage"></div>
    </div>`;
  const stage = container.querySelector('.ws-stage');
  if (!paths.length) { stage.innerHTML = '<p class="ws-empty">No web sources available.</p>'; return { destroy() { container.innerHTML = ''; } }; }

  function catsHTML() {
    return `<div class="ws-pathlist">${paths.map((c) => {
      const blurb = (CAT[c.key] || {}).blurb || '';
      return `<button type="button" class="ws-pathrow" data-cat="${escAttr(c.key)}">
        <span class="ws-pathrow-icon">${catSvg(c.key)}</span>
        <span class="ws-pathrow-text"><span class="ws-pathrow-name">${esc(c.label)}</span>${blurb ? `<span class="ws-pathrow-sub">${esc(blurb)}</span>` : ''}</span>
        ${ARROW}
      </button>`;
    }).join('')}</div>`;
  }
  function sourcesHTML() {
    const c = order.find((x) => x.key === curKey) || {};
    const blurb = (CAT[curKey] || {}).blurb || '';
    const rows = itemsFor(curKey).map((s) => {
      const url = String(s.urlTemplate || '').replace(/\{query\}/g, encodeURIComponent(topicName));
      return `<a class="ws-srcrow" href="${escAttr(url)}" target="_blank" rel="noopener noreferrer">
        <span class="ws-srcrow-text"><span class="ws-srcrow-name">${esc(s.name)}</span>${s.description ? `<span class="ws-srcrow-desc">${esc(s.description)}</span>` : ''}</span>${EXT}
      </a>`;
    }).join('');
    return `<div class="ws-sub">
      <button type="button" class="ws-back">${BACK}<span>Back to all web sources</span></button>
      <div class="ws-subhead">
        <span class="ws-subhead-icon">${catSvg(curKey)}</span>
        <div class="ws-subhead-text"><span class="ws-subhead-name">${esc(c.label || '')}</span>${blurb ? `<span class="ws-subhead-sub">${esc(blurb)}</span>` : ''}</div>
      </div>
      <div class="ws-srclist">${rows}</div>
    </div>`;
  }
  function go(v, dir) {
    view = v;
    stage.innerHTML = v === 'cats' ? catsHTML() : sourcesHTML();
    stage.classList.remove('aii-anim-fwd', 'aii-anim-back');
    void stage.offsetWidth;
    stage.classList.add(dir === 'back' ? 'aii-anim-back' : 'aii-anim-fwd');
    wire();
  }
  function wire() {
    stage.querySelectorAll('.ws-pathrow').forEach((b) => b.addEventListener('click', () => { curKey = b.dataset.cat; go('sources', 'fwd'); }));
    stage.querySelector('.ws-back')?.addEventListener('click', () => go('cats', 'back'));
  }
  go('cats', 'fwd');
  return { destroy() { container.innerHTML = ''; } };
}
