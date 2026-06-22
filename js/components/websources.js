// Web Sources — its own panel, mirroring the AI Insights sidebar look: a branded
// "Web Sources" header over a stack of collapsible sections, ONE per source
// category (Search & Reference, No AI Web Sources, Social/Discussion/Writing,
// Audio & Video). Each section expands to its source links. On desktop it sits
// as a separate card BELOW the AI Insights sidebar; on mobile it's its own tab.
import { getExternalSearches, getExternalSearchCategories } from '../utils/data.js';

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function escAttr(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

// Brand mark — a layered "sources" glyph (white on the navy tile), matching the
// AI Insights logo treatment.
const LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg>';
const CHEV = '<svg class="aii-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const EXT = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>';

export function renderWebSources(container, topic) {
  const term = (topic && topic.name) || '';
  const all = getExternalSearches() || [];
  const cats = getExternalSearchCategories() || [];
  const avail = cats.filter((c) => all.some((s) => s.category === c.key));

  const sectionsHTML = avail.map((c) => {
    const rows = all.filter((s) => s.category === c.key).map((s) => {
      const url = String(s.urlTemplate || '').replace(/\{query\}/g, encodeURIComponent(term));
      return `<a class="aii-tcp ws-src" href="${escAttr(url)}" target="_blank" rel="noopener noreferrer">
        <span class="aii-tcp-name">${esc(s.name)}</span>
        <span class="ws-src-ext" aria-hidden="true">${EXT}</span>
      </a>`;
    }).join('');
    // Categories collapse like dropdowns — closed by default so the panel stays
    // compact; tap a category to reveal its sources.
    return `<div class="aii-sec ws-cat-sec" data-open="false">
      <button type="button" class="aii-sec-head" aria-expanded="false">
        <span class="aii-sec-dot ws-dot" aria-hidden="true"></span>
        <span class="aii-sec-name">${esc(c.label)}</span>
        <span class="aii-sec-chev" aria-hidden="true">${CHEV}</span>
      </button>
      <div class="aii-sec-body"><div class="aii-sec-inner"><div class="aii-sec-items ws-srcs">${rows}</div></div></div>
    </div>`;
  }).join('');

  const body = sectionsHTML
    ? `<div class="aii-secs ws-secs">${sectionsHTML}</div>`
    : '<p class="aii-empty">No web sources available.</p>';

  container.innerHTML = `
    <div class="aii ws-panel">
      <div class="aii-head">
        <div class="aii-head-top"><span class="aii-logo">${LOGO}</span><span class="aii-brand">Web Sources</span></div>
      </div>
      <div class="aii-stage">${body}</div>
    </div>`;

  // Collapse/expand each category section (native click toggle on the head).
  container.querySelectorAll('.ws-cat-sec > .aii-sec-head').forEach((b) => {
    b.addEventListener('click', () => {
      const sec = b.closest('.aii-sec');
      const open = sec.getAttribute('data-open') === 'true';
      sec.setAttribute('data-open', String(!open));
      b.setAttribute('aria-expanded', String(!open));
    });
  });

  return { destroy() { container.innerHTML = ''; } };
}
