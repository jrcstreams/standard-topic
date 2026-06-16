// Renders the expanded body of a trend card: a sources bar (cited sources),
// "Web Explore" + "AI Explore" accordions (submit the term to engines/models),
// and the full grounded brief. Reuses the news/TI building blocks so the look
// matches AI insights elsewhere.
import { renderBriefBody, resolveSource, sourceChip } from './newsfeed.js?v=20260616-revamp224';
import { renderTIAccordion, webSourceItem } from './ti-shortcuts.js';
import { getExternalSearches, getExternalSearchCategories, getModels } from '../utils/data.js';

function escapeAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeHTML(str) { const d = document.createElement('div'); d.textContent = str ?? ''; return d.innerHTML; }

// Horizontal-scroll bar of the brief's cited sources (deduped). Empty if none.
function sourcesBar(sources) {
  if (!sources || !sources.length) return '';
  const seen = new Set();
  const chips = [];
  for (const s of sources) {
    const r = resolveSource(s);
    const key = (r.label || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    chips.push(sourceChip(r));
  }
  if (!chips.length) return '';
  return `<div class="trend-exp-sources"><span class="trend-exp-sources-label">Sources</span><div class="trend-exp-sources-scroll">${chips.join('')}</div></div>`;
}

// Web Explore: external search engines grouped by category, term substituted.
function webExploreHTML(term) {
  const searches = getExternalSearches() || [];
  if (!searches.length) return '';
  const cats = getExternalSearchCategories() || [];
  const order = cats.length ? cats.slice() : [{ key: '__all', label: '' }];
  const known = new Set(order.map((c) => c.key));
  const leftovers = searches.filter((s) => !known.has(s.category));
  if (leftovers.length) order.push({ key: '__other', label: 'Other' });
  const groupsHTML = order.map((cat) => {
    const items = cat.key === '__other' ? leftovers
      : cat.key === '__all' ? searches
      : searches.filter((s) => s.category === cat.key);
    if (!items.length) return '';
    const heading = cat.label ? `<li class="ti-subhead" aria-hidden="true">${escapeHTML(cat.label)}</li>` : '';
    return `<ul class="ti-item-list ti-item-list-grouped">${heading}${items.map((s) => webSourceItem(s, term)).join('')}</ul>`;
  }).join('');
  return renderTIAccordion({ key: 'websources', label: 'Web Explore', open: false, bodyHTML: `<div class="ti-source-groups">${groupsHTML}</div>` });
}

// AI Explore: each AI model opened with the trend term as its prompt.
function aiModelItem(model, term) {
  const prompt = `Explain what "${term}" is and why it's trending right now — what just happened and brief context.`;
  const url = String(model.urlTemplate || model.chatUrl || '').replace(/\{prompt\}/g, encodeURIComponent(prompt));
  const desc = model.description ? `<span class="ti-item-desc">${escapeHTML(model.description)}</span>` : '';
  return `<li class="ti-item-row"><a class="ti-item ti-item-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" data-name="${escapeAttr(model.name)}" title="Ask ${escapeAttr(model.name)}"><span class="ti-item-name">${escapeHTML(model.name)}</span>${desc}</a></li>`;
}
function aiExploreHTML(term) {
  const models = getModels() || [];
  if (!models.length) return '';
  const list = `<ul class="ti-item-list">${models.map((m) => aiModelItem(m, term)).join('')}</ul>`;
  return renderTIAccordion({ key: 'discover', label: 'AI Explore', open: false, bodyHTML: list });
}

// Full expanded body. `brief` = { content, sources } from /api/insight.
export function renderTrendExpansionBody(term, brief) {
  const content = (brief && brief.content) || '';
  const sources = (brief && brief.sources) || [];
  return [
    sourcesBar(sources),
    `<div class="trend-exp-explore">${webExploreHTML(term)}${aiExploreHTML(term)}</div>`,
    `<div class="trend-exp-full">${renderBriefBody(content, [])}</div>`,
  ].join('');
}
