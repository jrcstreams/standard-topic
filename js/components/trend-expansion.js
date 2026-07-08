// Renders the expanded body of a trend card: a sources bar (cited sources),
// "Web Explore" + "AI Explore" accordions (submit the term to engines/models),
// and the full grounded brief. Reuses the news/TI building blocks so the look
// matches AI insights elsewhere.
import { renderBriefBody, resolveSource, sourceChip } from './newsfeed.js?v=20260706-revamp516';
import { renderTIAccordion, webSourceItem } from './ti-shortcuts.js';
import { getExternalSearches, getExternalSearchCategories, getModels } from '../utils/data.js';
import { insightTabsHTML } from '../utils/insight-tabs.js?v=20260706-revamp516';
import { exploreFurtherHTML } from '../utils/explore-further.js?v=20260706-revamp516';

// The Explore Further tab uses the shared clean-dropdown component (with the
// Direct Submit / Review flow), consistent across trending / news / topic.
function exploreListHTML(term) {
  const prompt = `Explain what "${term}" is and why it's trending right now — what just happened and brief context.`;
  return exploreFurtherHTML({ prompt, webTerm: term, name: term, subDesc: 'Explore this trend with ChatGPT, Claude, Gemini & more' });
}

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
  return renderTIAccordion({ key: 'websources', label: 'Web Search', open: false, blurb: '', bodyHTML: `<div class="ti-source-groups">${groupsHTML}</div>` });
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
  return renderTIAccordion({ key: 'discover', label: 'Explore with External AI Models', open: false, blurb: '', bodyHTML: list });
}

// ── Rich brief layout (matches the retired trend detail modal) ───────────────
const SPARK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/></svg>';
const TE_ARROW = '<svg class="im-cov-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>';
const TE_SEC_ICON = {
  why: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>',
  summary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="7" y1="12" x2="14" y2="12"/><line x1="7" y1="16" x2="11" y2="16"/></svg>',
  matters: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>',
  sources: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
};
function teRelTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime(); if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins || 1}m ago`;
  const hrs = Math.round(mins / 60); if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
// Strip the leaked "SUMMARY:/DETAIL:" scaffold; keep the label-free one-liner.
function teCleanSummary(s) {
  let t = String(s || '').replace(/[*_]+/g, '').trim();
  const m = t.match(/summary\s*:\s*([\s\S]*?)(?:\s*detail\s*:|$)/i);
  if (m) t = m[1];
  return t.replace(/^\s*(summary|detail)\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
}
function teCleanContent(s) {
  let t = String(s || '');
  const di = t.search(/[*_]*\s*detail\s*[*_]*\s*:/i);
  if (di !== -1) t = t.slice(di).replace(/^[*_\s]*detail\s*[*_]*\s*:\s*[*_]*/i, '');
  t = t.replace(/[*_]*\s*summary\s*[*_]*\s*:[\s\S]*?(?:\n\n|$)/i, '').replace(/^[\s*_]+/, '').trim();
  return t || String(s || '');
}
function teSecHead(key, name, aiTag) {
  const tag = aiTag ? `<div class="im-sec-aitag-row"><span class="im-sec-aitag">${SPARK}<span>AI Generated Text</span></span></div>` : '';
  return `<div class="im-msec-head"><span class="im-msec-ic">${TE_SEC_ICON[key] || TE_SEC_ICON.summary}</span><h3 class="im-msec-name">${escapeHTML(name)}</h3></div>${tag}`;
}
function teSourcesHTML(headlines, sources) {
  const seen = new Set(); const rows = [];
  const row = (uri, title, meta) => `<a class="im-cov-row" href="${escapeAttr(uri)}" target="_blank" rel="noopener noreferrer"><span class="im-cov-text"><span class="im-cov-title">${escapeHTML(title)}</span>${meta ? `<span class="im-cov-host">${escapeHTML(meta)}</span>` : ''}</span>${TE_ARROW}</a>`;
  for (const h of (Array.isArray(headlines) ? headlines : [])) {
    if (rows.length >= 12) break;
    const uri = (h && (h.url || h.uri)) || ''; if (!uri) continue;
    const k = uri.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
    const title = String((h && h.title) || '').trim(); if (!title || /^https?:/i.test(title)) continue;
    let host = ''; try { host = new URL(uri).hostname.replace(/^www\./i, ''); } catch (_) {}
    rows.push(row(uri, title, [(h.source || '').trim() || host, teRelTime(h.date)].filter(Boolean).join(' · ')));
  }
  if (!rows.length) {
    for (const s of (Array.isArray(sources) ? sources : [])) {
      if (rows.length >= 10) break;
      const uri = (s && (s.url || s.uri)) || (typeof s === 'string' ? s : ''); if (!uri) continue;
      const k = uri.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
      let host = ''; try { host = new URL(uri).hostname.replace(/^www\./i, ''); } catch (_) {}
      const title = String((s && s.title) || '').trim();
      const label = (title && !/^https?:/i.test(title)) ? title : host; if (!label) continue;
      rows.push(row(uri, label, (title && host && title !== host) ? host : ''));
    }
  }
  return rows.length ? `<div class="im-coverage-list">${rows.join('')}</div>` : '';
}

// Full expanded body — the retired detail modal's layout: Reasoning + Summary
// (AI Generated Text) → Explore Further (External AI Model Insights + Web
// Search) → Sources. `brief` = { content, summary, sources, headlines }.
export function renderTrendExpansionBody(term, brief) {
  const b = brief || {};
  const why = teCleanSummary(b.summary);
  let detail = teCleanContent(b.content || '');
  // Drop the summary sentence if the detail repeats it up front (like the modal).
  if (why && detail) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const sN = norm(why);
    for (let i = 0; i < 4; i++) {
      const fsm = detail.match(/^.*?[.!?](?=\s|$)/); const fs = fsm ? fsm[0] : '';
      if (!fs || norm(fs) !== sN) break;
      const rest = detail.slice(fs.length).replace(/^[\s).,:;–—-]+/, '').trim();
      if (!rest) break; detail = rest;
    }
  }
  // Split into 3 TABS: Summary (default) / Explore Further / Sources. The reasoning
  // one-liner (already on the trend card) is folded into the grounded summary.
  const summaryBody = detail || why;
  const AITAG = `<div class="im-sec-aitag-row"><span class="im-sec-aitag">${SPARK}<span>AI Generated Text</span></span></div>`;
  const summaryHTML = summaryBody ? `${AITAG}${renderBriefBody(summaryBody, null)}` : '<p class="ins-empty">No summary yet.</p>';
  const src = teSourcesHTML(b.headlines, b.sources);
  const tabs = [
    { key: 'summary', label: 'Summary', html: summaryHTML },
    { key: 'explore', label: 'Explore Further', html: exploreListHTML(term) },
  ];
  if (src) tabs.push({ key: 'sources', label: 'Sources', html: src });
  return `<div class="trend-exp im-secs">${insightTabsHTML(tabs, 'trend-exp-tabs')}</div>`;
}

// A clean collapsible drawer (Explore Further / Sources) — icon + title + chevron
// summary, collapsed by default, matching the news/topic AI-insight drawers.
const TE_DRAWER_CHEV = '<svg class="te-drawer-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
function teDrawerHTML(iconKey, label, bodyHTML) {
  return `<details class="te-drawer"><summary class="te-drawer-sum"><span class="te-drawer-ic">${TE_SEC_ICON[iconKey] || TE_SEC_ICON.summary}</span><span class="te-drawer-title">${escapeHTML(label)}</span>${TE_DRAWER_CHEV}</summary><div class="te-drawer-body">${bodyHTML}</div></details>`;
}
