// Slim modal shown when a Trending Now row is clicked. Renders the term,
// related searches (clickable chips that drill into their own trend view),
// a Google Trends link, the admin-managed Trending 101 shortcuts, and the
// Topic-Intelligence accordions scoped to the term ("Trending Intelligence").
// Opened via `open-trending-detail` with the full trending item. Shortcut
// clicks reuse the existing prompt modal (`open-prompt-modal`). A history
// stack lets related-term views offer a "← back" link.
import { getTrending101, getTrendingIntelligenceShortcuts, getExternalSearches, getExternalSearchCategories } from '../utils/data.js';
import { groupShortcuts, renderTIAccordion, webSourceItem } from './ti-shortcuts.js';
import { renderBriefBody } from './newsfeed.js';

let overlayEl = null;
let panelEl = null;
let stack = [];          // previous items (for the back link)
let current = null;
let cameFromList = false; // opened from the global Trending list modal?

function isListOpen() {
  const el = document.querySelector('.tlm-panel');
  return !!el && getComputedStyle(el).display !== 'none';
}

function escapeHTML(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function escapeAttr(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
function titleCase(s) { return String(s || '').replace(/\b\w/g, c => c.toUpperCase()); }
function gtUrl(term) { return `https://trends.google.com/trends/explore?q=${encodeURIComponent(term)}&geo=US`; }
// Related "In the news" links from our news feed (data.headlines) — the same
// clean blue-link list AI Intelligence uses. Empty string when none.
function inTheNewsHTML(headlines) {
  const list = Array.isArray(headlines) ? headlines : [];
  const seen = new Set(); const rows = [];
  for (const h of list) {
    const uri = (h && (h.url || h.uri)) || ''; if (!uri) continue;
    const key = uri.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
    let host = ''; try { host = new URL(uri).hostname.replace(/^www\./i, ''); } catch (_) {}
    let title = (h && h.title) || ''; if (!title) title = host; if (!title) continue;
    rows.push(`<li class="aii-hl-row"><a class="aii-hl-link" href="${escapeAttr(uri)}" target="_blank" rel="noopener noreferrer">${escapeHTML(title)}</a>${host ? `<span class="aii-hl-src">${escapeHTML(host)}</span>` : ''}</li>`);
    if (rows.length >= 6) break;
  }
  if (!rows.length) return '';
  return `<div class="aii-hl"><div class="aii-hl-head">In the news</div><ul class="aii-hl-list">${rows.join('')}</ul></div>`;
}
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

  window.addEventListener('open-trending-detail', (e) => openFresh(e.detail));
  overlayEl.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') close();
  });
}

function shortcutRow(s, term) {
  const prompt = (s.prompt || '').replace(/\{topic\}/gi, term);
  const desc = s.description ? `<span class="td-row-desc">${escapeHTML(s.description)}</span>` : '';
  return `<li><button type="button" class="td-shortcut" data-prompt="${escapeAttr(prompt)}" data-name="${escapeAttr(s.name)}" data-icon="${escapeAttr(s.icon || '')}">
      <span class="td-row-text"><span class="td-row-name">${escapeHTML(s.name)}</span>${desc}</span>
      <svg class="td-row-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
    </button></li>`;
}

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

function render() {
  const item = current;
  const term = item.query;
  const since = relTime(item.startedAt);
  const cat = item.category || (Array.isArray(item.categories) ? item.categories[0] : '') || '';
  const subParts = [cat, since ? `Trending since ${since}` : ''].filter(Boolean).join(' · ');
  const related = Array.isArray(item.trendBreakdown) ? item.trendBreakdown.slice(0, 8) : [];
  const t101 = getTrending101();
  const trendsUrl = item.googleTrendsUrl || gtUrl(term);
  const showBack = stack.length > 0 || cameFromList;
  const backName = stack.length ? titleCase(stack[stack.length - 1].query) : 'Trending';

  panelEl.innerHTML = `
    <div class="td-header">
      <button type="button" class="td-close" id="td-close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>
      </button>
      ${showBack ? `<button type="button" class="td-back" id="td-back"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>${escapeHTML(backName)}</button>` : ''}
      <span class="td-eyebrow">Trending Now</span>
      <h3 class="td-title">${escapeHTML(titleCase(term))}</h3>
      <div class="td-headmeta">
        ${subParts ? `<span class="td-sub">${escapeHTML(subParts)}</span>` : ''}
        <a class="td-trends-link" href="${escapeAttr(trendsUrl)}" target="_blank" rel="noopener noreferrer">View on Google Trends <span aria-hidden="true">↗</span></a>
      </div>
    </div>
    <div class="td-body">
      <section class="td-section td-ai-section">
        <div class="td-section-label"><span class="ai-result-badge">AI</span> Why it's trending</div>
        <div class="td-ai-brief" id="td-ai-brief"><div class="ai-result-body ai-result-loading">Generating AI brief…</div></div>
      </section>
      ${related.length ? `<div class="td-related">
        <span class="td-related-label">Related searches</span>
        <div class="td-related-chips">${related.map(r => `<button type="button" class="td-related-chip" data-term="${escapeAttr(r)}">${escapeHTML(r)}</button>`).join('')}</div>
      </div>` : ''}
      ${t101.length ? `<section class="td-section">
        <div class="td-section-label">Trending 101</div>
        <ul class="td-shortcut-list">${t101.map(s => shortcutRow(s, term)).join('')}</ul>
      </section>` : ''}
      <section class="td-section">
        <div class="td-section-label">Trending Intelligence</div>
        ${trendingIntelligenceHTML(term)}
      </section>
    </div>`;

  panelEl.querySelector('#td-close').addEventListener('click', close);
  const back = panelEl.querySelector('#td-back');
  if (back) back.addEventListener('click', goBack);
  panelEl.querySelectorAll('.td-shortcut').forEach(btn => {
    btn.addEventListener('click', () => {
      // No iconKey — the Review & Submit modal shouldn't show an emoji/icon
      // for trending shortcuts.
      window.dispatchEvent(new CustomEvent('open-prompt-modal', {
        detail: { basePrompt: btn.dataset.prompt || '', topicName: term, name: btn.dataset.name, count: 1 },
      }));
    });
  });
  panelEl.querySelectorAll('.td-related-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const t = chip.dataset.term;
      if (t) navigateTo({ query: t, googleTrendsUrl: gtUrl(t) });
    });
  });
  panelEl.scrollTop = 0;
  panelEl.querySelector('.td-body').scrollTop = 0;

  // Lazy-load the grounded AI brief (same layer the homepage trend cards use).
  (async () => {
    const briefEl = panelEl.querySelector('#td-ai-brief');
    if (!briefEl) return;
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'trend', query: term }) });
      const data = res.ok ? await res.json() : null;
      if (panelEl.querySelector('#td-ai-brief') !== briefEl) return; // a newer render replaced it
      if (data && data.content) {
        const summary = data.summary ? `<p class="td-ai-summary">${escapeHTML(data.summary)}</p>` : '';
        briefEl.innerHTML = summary + renderBriefBody(data.content, data.sources) + inTheNewsHTML(data.headlines);
      } else {
        briefEl.innerHTML = '<p class="td-ai-empty">No AI brief generated for this trend yet.</p>';
      }
    } catch (_) {
      if (panelEl.querySelector('#td-ai-brief') === briefEl) briefEl.innerHTML = '<p class="td-ai-empty">AI brief unavailable.</p>';
    }
  })();
}

function openFresh(item) {
  if (!item || !item.query) return;
  stack = [];
  current = item;
  cameFromList = isListOpen();   // remember so we can offer "← Trending"
  render();
  overlayEl.style.display = 'block';
  panelEl.style.display = 'flex';
  panelEl.classList.remove('is-in'); void panelEl.offsetWidth; panelEl.classList.add('is-in');
  document.body.style.overflow = 'hidden';
}

function navigateTo(item) {
  if (!item || !item.query) return;
  if (current) stack.push(current);
  current = item;
  render();
}

function goBack() {
  if (stack.length) { current = stack.pop(); render(); return; }
  if (cameFromList) { revealList(); }
}

// Back to the Trending list modal: hide this detail view but leave the list
// (which is still open underneath) on screen.
function revealList() {
  overlayEl.style.display = 'none';
  panelEl.style.display = 'none';
  panelEl.classList.remove('is-in');
  panelEl.innerHTML = '';
  stack = [];
  current = null;
  cameFromList = false;
  // Leave body overflow hidden — the list modal still owns it.
}

// Full close (✕ / overlay / Esc) — also dismiss the list modal if it's open.
function close() {
  overlayEl.style.display = 'none';
  panelEl.style.display = 'none';
  panelEl.classList.remove('is-in');
  panelEl.innerHTML = '';
  stack = [];
  current = null;
  if (cameFromList) window.dispatchEvent(new CustomEvent('close-trending-list'));
  cameFromList = false;
  document.body.style.overflow = '';
}
