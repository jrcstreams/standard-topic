// renderNewsFeed: news cards for topic + home pages.
//
// Two-tier feed:
//   1. LIVE — /api/feeds/{slug} (rss.app proxy, ~50 fresh stories), shown first.
//   2. ARCHIVE — "Load older stories" pages further back through the stored
//      history (/api/news/{slug}?before=… keyset cursor), appended seamlessly.
// Plus client-side filters over the loaded set: search (server full-text over
// the whole archive), time range, source/site, and newest/oldest sort.
//
// newsCardHTML/wireNewsAI/listHTML are exported so the Search modal can reuse
// the exact same card + AI-insight behavior for archive results.

import { getModels, getExternalSearches, getExternalSearchCategories } from '../utils/data.js';
import { openModel, copyPrompt } from '../utils/ai-models.js';
import { insightTabsHTML, wireInsightTabs } from '../utils/insight-tabs.js?v=20260706-revamp569';
import { exploreFurtherHTML, wireExploreFurther } from '../utils/explore-further.js?v=20260706-revamp569';

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Hostname without "www.", lowercased. Falls back to the raw value
// if the URL is unparseable (rss.app occasionally returns bare
// strings for sources rather than full URLs).
function sourceHost(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return String(rawUrl).replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  }
}

// Short relative-time formatter (e.g. "12m", "2h", "3d"). Anything older
// than ~5 years falls back to the localized date string.
function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 45) return 'now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return diffMin + 'm';
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return diffHr + 'h';
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return diffDay + 'd';
  const diffWk = Math.round(diffDay / 7);
  if (diffWk < 5) return diffWk + 'w';
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return diffMo + 'mo';
  const diffYr = Math.round(diffDay / 365);
  if (diffYr < 5) return diffYr + 'y';
  return new Date(iso).toLocaleDateString();
}

// Per-story "AI Insights" expander: a small trigger that reveals a few
// one-tap insight prompts. Clicking one opens the shared prompt modal
// (open-prompt-modal) pre-filled so the user can submit it to an AI model.
const AI_SPARK_SVG = '<svg class="news-ai-spark" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/></svg>';
const AI_CHEV_SVG = '<svg class="news-ai-chev" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
// The stronger FILLED blue sparkle (matches the AI Insights mark used elsewhere)
// — the AI Insights action uses this instead of a fully-blue button.
const AI_SPARK_FILLED_SVG = '<svg class="news-ai-spark-filled" viewBox="0 0 24 24" width="14" height="14" fill="#2563eb" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg>';
const SHARE_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
const LINK_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
// Renders a brief's body: "### Section" subheaders, "- "/"• " bullets, and
// source citation links. Shared shape for news (sectioned) + trend (prose).
function hostFromUri(u) { try { return new URL(u).hostname.replace(/^www\./i, ''); } catch { return 'source'; } }
const SRC_GLOBE_SVG = '<svg class="ai-source-favicon ai-source-globe" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/></svg>';
// Gemini grounding returns redirect URIs (vertexaisearch.cloud.google.com/...)
// with the real publisher in `title`. Resolve a clean domain for the chip:
// prefer a domain-shaped title, else the uri host when it isn't a redirect.
export function resolveSource(s) {
  const t = String(s.title || '').trim();
  const host = hostFromUri(s.uri);
  const redirect = /vertexaisearch|grounding-api|googleusercontent|^google\.com$/i.test(host);
  const domain = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)
    ? t.toLowerCase().replace(/^www\./, '')
    : (redirect ? '' : host);
  return { uri: s.uri, title: t, domain, label: domain || t || host };
}
export function sourceChip(r, opts = {}) {
  // opts.noFavicons → text-only chip (used by the AI Intelligence overview).
  const fav = opts.noFavicons ? '' : (r.domain
    ? `<img class="ai-source-favicon" src="https://www.google.com/s2/favicons?domain=${escapeAttr(r.domain)}&sz=64" alt="" width="14" height="14" loading="lazy" referrerpolicy="no-referrer">`
    : SRC_GLOBE_SVG);
  const cls = opts.noFavicons ? 'ai-source-chip ai-source-chip--plain' : 'ai-source-chip';
  return `<a class="${cls}" href="${escapeAttr(r.uri)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(r.title || r.label)}">${fav}<span>${escapeHTML(r.label)}</span></a>`;
}
// A small glyph that represents each brief section, so a brief reads as packaged
// intelligence (What Happened ⚡ / Key Takeaways ✔ / Why It Matters ◎ / Timeline ◷ …).
// Matched on the section label's keywords; falls back to a sparkle.
function sectionIcon(label) {
  const l = String(label || '').toLowerCase();
  const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  let inner;
  if (/why.*trend|is this trend|trending now/.test(l)) inner = '<path d="M3 17l6-6 4 4 8-8"/><polyline points="17 7 21 7 21 11"/>'; // trend-up (Why Is This Trending)
  else if (/take ?away|key point|highlight|bottom line/.test(l)) inner = '<path d="M9 11l3 3 9-9"/><path d="M20.5 12.5V19a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2H15"/>'; // check-list
  else if (/timeline|chronolog|sequence|how it unfolded/.test(l)) inner = '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>'; // clock
  else if (/why it matter|so what|impact|implication|stakes|significan/.test(l)) inner = '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>'; // target
  else if (/what happen|develop|latest|happening|the news|the event/.test(l)) inner = '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'; // bolt
  else if (/background|context|history|origin|backstory/.test(l)) inner = '<circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="11.5"/><line x1="12" y1="8" x2="12.01" y2="8"/>'; // info
  else if (/player|people|who|key figure|stakeholder|cast/.test(l)) inner = '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5"/><path d="M20.5 20a5.5 5.5 0 0 0-4-5.3"/>'; // people
  else if (/overview|summary|the story|in brief|snapshot/.test(l)) inner = '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 20 9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>'; // doc
  else if (/what.?s next|outlook|forecast|ahead|to watch|future/.test(l)) inner = '<path d="M3 17l6-6 4 4 8-8"/><polyline points="17 7 21 7 21 11"/>'; // trend
  else inner = '<path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/>'; // sparkle
  return `<span class="ai-result-sub-ic">${svg(inner)}</span>`;
}
export function renderBriefBody(content, sources, opts = {}) {
  // Escape, then render light markdown: **bold**, *italic*, and drop any stray
  // asterisks the model leaves behind (so "*The Prince*" / a lone "**" never
  // show raw).
  const fmt = (s) => escapeHTML(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
    .replace(/\*+/g, '');
  const isEmpty = (h) => !h.replace(/<[^>]+>/g, '').trim();
  // Optional inline "AI-generated" sparkle on the FIRST line of each section
  // (news brief only) — flags that the section text is AI-written.
  const flagSpan = opts.aiFlag ? `<span class="ai-flag" aria-label="AI-generated" title="AI-generated text">${opts.aiFlag}</span>` : '';
  // Flag the first content line even when there's no section header (opts.flagFirst)
  // — used when each section is rendered headerless (its title lives outside).
  let pendingFlag = !!(opts.flagFirst && flagSpan);
  const lines = String(content || '').split('\n');
  let html = ''; let inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    if (/^#{1,4}\s+/.test(line)) { closeList(); const raw2 = line.replace(/^#{1,4}\s+/, ''); html += `<div class="ai-result-sub">${sectionIcon(raw2)}<span class="ai-result-sub-tx">${fmt(raw2)}</span></div>`; if (flagSpan) pendingFlag = true; }
    else if (/^[*\-•]\s+/.test(line)) {
      const inner = fmt(line.replace(/^([*\-•]\s+)+/, ''));
      if (isEmpty(inner)) continue;          // skip a bullet that was just "**" etc.
      if (!inList) { html += '<ul class="ai-result-list">'; inList = true; }
      const lead = pendingFlag ? flagSpan : ''; pendingFlag = false;
      html += `<li>${lead}${inner}</li>`;
    } else { closeList(); const p = fmt(line); if (!isEmpty(p)) { const lead = pendingFlag ? flagSpan : ''; pendingFlag = false; html += `<p>${lead}${p}</p>`; } }
  }
  closeList();
  let src = '';
  if (sources && sources.length) {
    const seen = new Set();
    const chips = [];
    for (const s of sources) {
      const r = resolveSource(s);
      const key = (r.label || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      chips.push(sourceChip(r, opts));
    }
    if (chips.length) src = `<div class="ai-result-sources"><span class="ai-result-sources-label">Sources</span>${chips.join('')}</div>`;
  }
  return `<div class="ai-result-body">${html}</div>${src}`;
}

const CHEV_SM = '<svg class="ai-ins-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const ARROW_SM = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>';

// The prompt we hand off to an external model for a deeper dive on this story.
function newsStoryPrompt(card) {
  const title = card.dataset.title || '';
  const desc = card.dataset.desc || '';
  const url = card.dataset.url || '';
  return `Give me a thorough, accurate briefing on this news story — what happened, why it matters, background, a timeline, and the latest developments.\n\n"${title}"${desc ? `\n\n${desc}` : ''}${url ? `\n\nSource: ${url}` : ''}`;
}

// "Review Prompt" path → the full prompt modal.
function openNewsChat(card) {
  window.dispatchEvent(new CustomEvent('open-prompt-modal', {
    detail: { basePrompt: newsStoryPrompt(card), topicName: card.dataset.title || '', name: 'AI Insight · News', count: 1 },
  }));
}

// Clean list of cited sources (no favicons) for the Sources accordion.
function renderInsightSources(sources) {
  const seen = new Set(); const rows = [];
  for (const s of (sources || [])) {
    const r = resolveSource(s);
    const key = (r.label || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(`<a class="ai-ins-source-row" href="${escapeAttr(r.uri)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(r.title || r.label)}"><span class="ai-ins-source-name">${escapeHTML(r.label)}</span>${ARROW_SM}</a>`);
  }
  return rows.length ? `<div class="ai-ins-source-list">${rows.join('')}</div>` : '<p class="ai-ins-empty">No sources cited.</p>';
}

// Explore panel, step 1: pick a model.
function exploreChooseModelHTML() {
  const models = getModels() || [];
  const rows = models.map(m =>
    `<button type="button" class="ai-ins-model" data-model="${escapeAttr(m.id)}"><span class="ai-ins-model-name">${escapeHTML(m.name)}</span>${m.description ? `<span class="ai-ins-model-desc">${escapeHTML(m.description)}</span>` : ''}</button>`).join('');
  return `<div class="ai-ins-substep" data-step="choose"><div class="ai-ins-subhead">Choose model</div><div class="ai-ins-model-list">${rows}</div></div>`;
}
// Explore panel, step 2: submit or review for the chosen model.
function exploreSubmitHTML(model) {
  return `<div class="ai-ins-substep" data-step="submit">
    <button type="button" class="ai-ins-back">← Models</button>
    <div class="ai-ins-subhead">Prompt submission · ${escapeHTML(model.name)}</div>
    <div class="ai-ins-submit-row">
      <button type="button" class="ai-ins-submitbtn ai-ins-submitbtn-primary" data-act="direct">Direct Submit</button>
      <button type="button" class="ai-ins-submitbtn" data-act="review">Review Prompt</button>
    </div>
  </div>`;
}
// Explore panel, step 3 (Direct Submit): "leaving the site" confirm.
function exploreLeaveHTML(model) {
  return `<div class="ai-ins-substep" data-step="leave">
    <button type="button" class="ai-ins-back" data-back="submit">← Back</button>
    <div class="ai-ins-leave-card">
      <p class="ai-ins-leave-title">You're leaving Standard Topic</p>
      <p class="ai-ins-leave-body">Continue opens <strong>${escapeHTML(model.name)}</strong> in a new tab. If the prompt doesn't auto-fill, it's copied to your clipboard — just paste it in. You may need to be signed in.</p>
      <button type="button" class="ai-ins-submitbtn ai-ins-submitbtn-primary" data-act="continue">Continue →</button>
    </div>
  </div>`;
}

// One combined, grounded AI brief inline under the card (click toggles). Falls
// back to chat if the AI layer is unavailable / the daily cap is hit.
// AI Insights open in the unified insight modal — with the surrounding feed as
// nav context so the modal offers Prev/Next story + "Back to News Feed".
function showNewsBrief(card) {
  const list = card.closest('.news-list');
  const cards = list ? [...list.querySelectorAll('.news-card[data-url]')] : [card];
  const entries = cards.map((c) => ({ type: 'news', url: c.dataset.url || '', title: c.dataset.title || '', description: c.dataset.desc || '', date: c.dataset.date || '' }));
  let index = cards.indexOf(card); if (index < 0) index = 0;
  window.dispatchEvent(new CustomEvent('open-insight-modal', { detail: {
    ...entries[index],
    nav: { list: entries, index, itemKind: 'story' },
  } }));
}

// Wire the Sources / Explore accordions + the model → submit flow.
function wireInsightPanel(region, card) {
  const explorePanel = region.querySelector('[data-body="explore"]');
  region.querySelectorAll('.ai-ins-actbtn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.dataset.panel;
      const body = region.querySelector(`[data-body="${name}"]`);
      const willOpen = btn.getAttribute('aria-expanded') !== 'true';
      // Close every panel first.
      region.querySelectorAll('.ai-ins-actbtn').forEach(b => b.setAttribute('aria-expanded', 'false'));
      region.querySelectorAll('.ai-ins-panel').forEach(p => p.classList.remove('is-open'));
      if (willOpen) {
        btn.setAttribute('aria-expanded', 'true');
        if (name === 'explore' && !explorePanel.dataset.ready) {
          explorePanel.innerHTML = exploreChooseModelHTML();
          explorePanel.dataset.ready = '1';
        }
        body.classList.add('is-open');
      }
    });
  });
  // Explore flow: choose model → submit step → direct/review.
  explorePanel.addEventListener('click', (e) => {
    const modelBtn = e.target.closest('.ai-ins-model');
    const back = e.target.closest('.ai-ins-back');
    const submit = e.target.closest('.ai-ins-submitbtn');
    if (modelBtn) {
      e.stopPropagation();
      const model = (getModels() || []).find(m => m.id === modelBtn.dataset.model);
      if (!model) return;
      explorePanel.innerHTML = exploreSubmitHTML(model);
      explorePanel.dataset.model = model.id;
      // Copy-on-expand so a paste-style model has the prompt ready and the
      // later Direct Submit window.open stays inside the click gesture.
      copyPrompt(newsStoryPrompt(card));
    } else if (back) {
      e.stopPropagation();
      const model = (getModels() || []).find(m => m.id === explorePanel.dataset.model);
      // Back from the leaving-site confirm returns to the submit step; back
      // from the submit step returns to the model list.
      if (back.dataset.back === 'submit' && model) {
        explorePanel.innerHTML = exploreSubmitHTML(model);
      } else {
        explorePanel.innerHTML = exploreChooseModelHTML();
        delete explorePanel.dataset.model;
      }
    } else if (submit) {
      e.stopPropagation();
      const model = (getModels() || []).find(m => m.id === explorePanel.dataset.model);
      if (!model) return;
      if (submit.dataset.act === 'direct') {
        // Confirm leaving the site first. Prompt already copied on model-expand.
        explorePanel.innerHTML = exploreLeaveHTML(model);
      } else if (submit.dataset.act === 'continue') {
        openModel(model, newsStoryPrompt(card));
      } else {
        openNewsChat(card);
      }
    }
  });
}

// Brief "Copied" confirmation on a share/copy button.
function flashCopied(btn, msg) {
  const label = btn.querySelector('span');
  const orig = label ? label.textContent : '';
  btn.classList.add('is-copied');
  if (label) label.textContent = msg;
  setTimeout(() => { btn.classList.remove('is-copied'); if (label) label.textContent = orig; }, 1500);
}

// Wire the AI Insights dropdown triggers + option buttons within a list.
// Close any open inline news panel within `root` (one open at a time).
function closeNewsPanels(root, except) {
  root.querySelectorAll('.news-card--open').forEach((card) => {
    if (card === except) return;
    card.classList.remove('news-card--open');
    const p = card.querySelector('[data-news-panel-body]');
    if (p) { p.hidden = true; p.innerHTML = ''; p.dataset.kind = ''; }
    card.querySelectorAll('.news-act[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  });
}
// One-time: as the user scrolls, close an open panel once its card leaves view.
let newsPanelScrollWired = false;
function wireNewsPanelScrollClose() {
  if (newsPanelScrollWired) return;
  newsPanelScrollWired = true;
  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const open = document.querySelector('.news-card--open');
      if (!open) return;
      const r = open.getBoundingClientRect();
      // Closed once the card's header has scrolled well out of view.
      if (r.bottom < 80 || r.top > (window.innerHeight || 800) - 40) {
        open.classList.remove('news-card--open');
        const p = open.querySelector('[data-news-panel-body]');
        if (p) { p.hidden = true; p.innerHTML = ''; p.dataset.kind = ''; }
        open.querySelectorAll('.news-act[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
      }
    });
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
}

export function wireNewsAI(root) {
  wireNewsPanelScrollClose();
  // The whole card reads as one clickable unit (it has a card-level hover), so a
  // click on any non-interactive area opens the story — same as the title link /
  // View Story button. This keeps the cursor consistently a pointer instead of
  // flickering between pointer (over the title) and default (over the meta) (#img183).
  root.querySelectorAll('.news-card[data-url]').forEach((card) => {
    card.addEventListener('click', (e) => {
      // Let real interactive elements (links, buttons, the open insights panel,
      // the share popover) handle their own clicks.
      if (e.target.closest('a, button, [data-news-panel-body], .news-share-wrap')) return;
      const url = card.dataset.url;
      if (url) window.open(url, '_blank', 'noopener');
    });
  });
  // AI Insights / Web Search → toggle a clean inline dropdown under the card.
  root.querySelectorAll('.news-act[data-news-panel]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.news-card');
      const panel = card?.querySelector('[data-news-panel-body]');
      if (!panel) return;
      const kind = btn.dataset.newsPanel;                       // 'ai' | 'web'
      const sameOpen = !panel.hidden && panel.dataset.kind === kind;
      closeNewsPanels(root);                                    // only one open at a time
      if (sameOpen) return;                                     // clicking the open one closes it
      panel.dataset.kind = kind;
      panel.hidden = false;
      card.classList.add('news-card--open');
      btn.setAttribute('aria-expanded', 'true');
      if (kind === 'ai') renderNewsBriefInto(panel, card);
      else renderNewsWebInto(panel, card);
    });
  });
  // Prefetch-on-intent: warm the AI brief on hover (after a short delay so a quick
  // pass-over doesn't trigger it) or on the pointerdown that precedes a tap. The
  // click then reuses the in-flight request, so the panel opens near-instantly.
  root.querySelectorAll('.news-act-ai[data-news-panel="ai"]').forEach((btn) => {
    const card = btn.closest('.news-card');
    if (!card || !card.dataset.url) return;
    let hoverTimer = 0;
    btn.addEventListener('mouseenter', () => { hoverTimer = setTimeout(() => niPrefetchBrief(card), 120); });
    btn.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); });
    btn.addEventListener('pointerdown', () => niPrefetchBrief(card), { passive: true });
  });
  // Share — one button toggles a smooth accordion with Copy Link + Share via.
  root.querySelectorAll('.news-share-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const panel = btn.closest('.news-card')?.querySelector('.news-share-panel');
      if (!panel) return;
      const willOpen = !panel.classList.contains('is-open');
      // Close any other open share panels first.
      root.querySelectorAll('.news-share-panel.is-open').forEach(p => p.classList.remove('is-open'));
      root.querySelectorAll('.news-share-toggle[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
      panel.classList.toggle('is-open', willOpen);
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) {
        setTimeout(() => document.addEventListener('click', function close() {
          panel.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false');
        }, { once: true }), 0);
      }
    });
  });
  // Copy Link / Share via inside the panel.
  root.querySelectorAll('.news-share-opt').forEach(opt => {
    opt.addEventListener('click', async (e) => {
      e.stopPropagation();
      const card = opt.closest('.news-card');
      const url = card?.dataset.url || '';
      const title = card?.dataset.title || '';
      const panel = opt.closest('.news-share-panel');
      if (!url) return;
      if (opt.dataset.act === 'copy') {
        try { await navigator.clipboard.writeText(url); }
        catch (_) { const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (_) {} ta.remove(); }
        flashCopied(opt, 'Copied');
      } else if (navigator.share) {
        try { await navigator.share({ title, url }); } catch (_) { /* cancelled */ }
      } else {
        try { await navigator.clipboard.writeText(url); } catch (_) {}
        flashCopied(opt, 'Link copied');
      }
      if (panel) { setTimeout(() => panel.classList.remove('is-open'), 400); }
    });
  });
}

// ── Inline News Insights (Phase 2b, revamp400) ───────────────────────────────
// "AI Insights" / "Web Search" open as clean dropdowns RIGHT under the card
// (no modal). The AI Insights dropdown shows just the brief — What Happened
// downwards (no story title / publisher / web-search inside it).
const NI_VIEW_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>';
const NI_GLOBE_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>';
const NI_ARROW_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>';
const NI_CLOSEUP_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>';
// A quiet "Close AI Insights" affordance at the very bottom of the brief — reads
// as the natural end of the section (we also auto-close on scroll).
function niCloseFootHTML() {
  return `<div class="ni-closefoot"><button type="button" class="ni-close-btn" data-ni-close>${NI_CLOSEUP_SVG}<span>Close AI Insights</span></button></div>`;
}
const NI_SEC_ICON = {
  summary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="7" y1="12" x2="14" y2="12"/><line x1="7" y1="16" x2="11" y2="16"/></svg>',
  takeaways: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  matters: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>',
  timeline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
  sources: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
};
const NEWS_SEC_MAP = [
  { keys: ['what happened', 'explanation'], label: 'What Happened' },
  { keys: ['key takeaways', 'key takeaway', 'key points', 'takeaways'], label: 'Takeaways' },
  { keys: ['why it matters', 'why this matters', 'background'], label: 'Why It Matters' },
  { keys: ['timeline'], label: 'Timeline' },
];
function niNormalize(content) {
  const text = String(content || '');
  const re = /^#{1,4}\s+(.+?)\s*$/gm;
  const heads = []; let m;
  while ((m = re.exec(text))) heads.push({ title: m[1].trim(), start: m.index, contentStart: re.lastIndex });
  if (!heads.length) return text;
  const sections = heads.map((h, i) => ({ title: h.title, body: text.slice(h.contentStart, i + 1 < heads.length ? heads[i + 1].start : text.length).replace(/^\n+/, '').replace(/\s+$/, '') }));
  const norm = (t) => t.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const buckets = NEWS_SEC_MAP.map(() => null); const extras = [];
  for (const s of sections) {
    const n = norm(s.title);
    const idx = NEWS_SEC_MAP.findIndex((g) => g.keys.includes(n));
    if (idx >= 0 && !buckets[idx]) buckets[idx] = { label: NEWS_SEC_MAP[idx].label, body: s.body };
    else extras.push({ label: s.title, body: s.body });
  }
  const ordered = buckets.filter(Boolean).concat(extras);
  return ordered.length ? ordered.map((s) => `### ${s.label}\n${s.body}`).join('\n\n') : text;
}
function niSplit(content) {
  const text = String(content || '');
  const re = /^[ \t]*(?:\*\*)?#{2,3}\s+(.+?)\s*$/gm;
  const idx = []; let m;
  while ((m = re.exec(text))) { const name = m[1].replace(/\*\*/g, '').replace(/[:#\s]+$/, '').trim(); idx.push({ name, start: m.index, headEnd: m.index + m[0].length }); }
  if (!idx.length) return [];
  return idx.map((s, i) => ({ name: s.name, body: text.slice(s.headEnd, i + 1 < idx.length ? idx[i + 1].start : text.length).trim() }));
}
function niSecIconKey(name) {
  const n = String(name || '').toLowerCase();
  if (/what happened/.test(n)) return 'summary';
  if (/takeaway|key point/.test(n)) return 'takeaways';
  if (/matters|background/.test(n)) return 'matters';
  if (/timeline/.test(n)) return 'timeline';
  return 'summary';
}
function niSecHead(name) {
  const key = niSecIconKey(name);
  return `<div class="ni-sec-head"><span class="ni-sec-ic">${NI_SEC_ICON[key] || NI_SEC_ICON.summary}</span><h4 class="ni-sec-name">${escapeHTML(name)}</h4></div>
    <div class="ni-aitag-row"><span class="ni-aitag">${AI_SPARK_SVG}<span>AI Generated Text</span></span></div>`;
}
function niSourcesHTML(headlines, sources, origUrl) {
  // Reuse the shared .ai-ins-source-row styling (trends / topic AI Insights) so
  // the News Sources list looks consistent across surfaces (#img332). "View
  // original article" keeps its arrow INLINE next to the text, not right-aligned.
  const rows = [];
  if (origUrl) rows.push(`<a class="ai-ins-source-row ai-ins-source-row--orig" href="${escapeAttr(origUrl)}" target="_blank" rel="noopener noreferrer"><span class="ai-ins-source-name">View original article ${ARROW_SM}</span></a>`);
  const list = (Array.isArray(headlines) && headlines.length ? headlines : (sources || []));
  const seen = new Set();
  for (const s of list) {
    const r = resolveSource(s);
    const key = (r.label || '').toLowerCase();
    if (!key || !r.uri || seen.has(key)) continue;
    seen.add(key);
    rows.push(`<a class="ai-ins-source-row" href="${escapeAttr(r.uri)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(r.title || r.label)}"><span class="ai-ins-source-name">${escapeHTML(r.label)}</span>${ARROW_SM}</a>`);
  }
  return rows.length ? `<section class="ni-sec ni-sec-sources"><div class="ni-sec-head"><span class="ni-sec-ic">${NI_SEC_ICON.sources}</span><h4 class="ni-sec-name">Sources</h4></div><div class="ai-ins-source-list">${rows.join('')}</div></section>` : '';
}
function niWebHTML(term) {
  const cats = getExternalSearchCategories() || [];
  const searches = getExternalSearches() || [];
  const avail = cats.filter((c) => searches.some((s) => s.category === c.key));
  if (!avail.length) return '<p class="ni-empty">No web sources available.</p>';
  return `<div class="ni-web">${avail.map((c) => {
    const rows = searches.filter((s) => s.category === c.key).map((s) => {
      const url = String(s.urlTemplate || '').replace(/\{query\}/g, encodeURIComponent(term || ''));
      return `<a class="ni-source-row" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer"><span class="ni-source-tx"><span class="ni-source-name">${escapeHTML(s.name)}</span>${s.description ? `<span class="ni-source-desc">${escapeHTML(s.description)}</span>` : ''}</span>${NI_ARROW_SVG}</a>`;
    }).join('');
    return `<details class="ni-webcat" name="ni-webcat"><summary class="ni-webcat-sum"><span>${escapeHTML(c.label)}</span>${AI_CHEV_SVG}</summary><div class="ni-source-list">${rows}</div></details>`;
  }).join('')}</div>`;
}
// Explore Further tab (news): a FLAT list of option accordions — "Explore with
// External AI Models" first (model links carry the story briefing prompt), then
// each web-search category. Matches the trending / topic Explore Further shape.
function niModelRow(model, prompt) {
  const url = String(model.urlTemplate || model.chatUrl || '').replace(/\{prompt\}/g, encodeURIComponent(prompt));
  return `<a class="ni-source-row" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer"><span class="ni-source-tx"><span class="ni-source-name">${escapeHTML(model.name)}</span>${model.description ? `<span class="ni-source-desc">${escapeHTML(model.description)}</span>` : ''}</span>${NI_ARROW_SVG}</a>`;
}
function niExploreListHTML(card) {
  const prompt = newsStoryPrompt(card);
  const term = card.dataset.title || '';
  const models = getModels() || [];
  const aiAcc = models.length
    ? `<details class="ni-webcat" name="ni-explore" open><summary class="ni-webcat-sum"><span>Explore with External AI Models</span>${AI_CHEV_SVG}</summary><div class="ni-source-list">${models.map((m) => niModelRow(m, prompt)).join('')}</div></details>`
    : '';
  const cats = getExternalSearchCategories() || [];
  const searches = getExternalSearches() || [];
  const catAccs = cats.filter((c) => searches.some((s) => s.category === c.key)).map((c) => {
    const rows = searches.filter((s) => s.category === c.key).map((s) => {
      const url = String(s.urlTemplate || '').replace(/\{query\}/g, encodeURIComponent(term));
      return `<a class="ni-source-row" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer"><span class="ni-source-tx"><span class="ni-source-name">${escapeHTML(s.name)}</span>${s.description ? `<span class="ni-source-desc">${escapeHTML(s.description)}</span>` : ''}</span>${NI_ARROW_SVG}</a>`;
    }).join('');
    return `<details class="ni-webcat" name="ni-explore"><summary class="ni-webcat-sum"><span>${escapeHTML(c.label)}</span>${AI_CHEV_SVG}</summary><div class="ni-source-list">${rows}</div></details>`;
  }).join('');
  return `<div class="ni-web ins-explore">${aiAcc}${catAccs}</div>`;
}
// Sources tab body (news) — just the rows (the "Sources" label is the tab).
function niSourcesListHTML(headlines, sources, origUrl) {
  // "View original article" is a blue LINK at the top, then the cited sources as a
  // clean formatted list beneath it (#img407). Headlines/sources may carry `url`
  // OR `uri` — normalise so they aren't dropped (that was the "no sources" bug).
  const rows = [];
  const list = (Array.isArray(headlines) && headlines.length ? headlines : (sources || []));
  const seen = new Set();
  for (const s of list) {
    const uri = s.uri || s.url || '';
    if (!uri) continue;
    const r = resolveSource({ uri, title: s.title });
    // Prefer a real article title; fall back to the domain only when the title IS a
    // bare domain (grounding sources). Formatted title + source·time like the topic
    // AI Insights sections (#img452).
    const isDomainTitle = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(s.title || '').trim());
    const title = (s.title && !isDomainTitle) ? s.title : r.label;
    const key = (title || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const meta = [s.source || r.domain || '', s.date ? relativeTime(s.date) : ''].filter(Boolean).join(' · ');
    rows.push(`<a class="aii-sec-src" href="${escapeAttr(uri)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(title)}"><span class="aii-sec-src-tx"><span class="aii-sec-src-title">${escapeHTML(title)}</span>${meta ? `<span class="aii-sec-src-host">${escapeHTML(meta)}</span>` : ''}</span>${ARROW_SM}</a>`);
  }
  const orig = origUrl ? `<a class="ni-source-orig" href="${escapeAttr(origUrl)}" target="_blank" rel="noopener noreferrer">View original article ${ARROW_SM}</a>` : '';
  const listHTML = rows.length ? `<div class="ai-ins-source-list">${rows.join('')}</div>` : '';
  return (orig || listHTML) ? `${orig}${listHTML}` : '';
}
function niLoaderHTML() {
  return `<div class="ni-loader"><div class="ni-loader-head"><span class="ni-spark">${AI_SPARK_SVG}</span><span class="ni-loader-tx">Generating insights<span class="ni-dots" aria-hidden="true"></span></span></div><span class="ni-skel"></span><span class="ni-skel"></span><span class="ni-skel ni-skel-short"></span></div>`;
}
function niFailHTML() {
  return `<div class="ni-fail"><p>AI insights unavailable right now.</p><button type="button" class="ni-retry" data-ni-retry>Try again</button></div>`;
}
// News briefs are generated ON DEMAND, so an "unavailable" is almost always a
// transient blip (a momentary grounding/rate cap) that clears within a second —
// a retry usually succeeds. So we auto-retry a couple times (loader stays up)
// BEFORE ever showing the fail state, which cuts the visible failure rate a lot.
const NI_MAX_RETRIES = 2;
// Memoized per-card brief fetch. Prefetch-on-intent (hover/touch) and the click
// share ONE in-flight request — so when the user clicks "AI Insights" the brief is
// usually already generated + cached server-side, making the open feel instant
// instead of waiting out a cold generation (#img507). Cleared on failure/empty so a
// later attempt re-fetches; kept on success so re-opening is instant.
function niFetchBrief(card) {
  if (card.__niBrief) return card.__niBrief;
  const d = { type: 'news', url: card.dataset.url || '', title: card.dataset.title || '', description: card.dataset.desc || '', date: card.dataset.date || '' };
  const p = fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => { if (!(data && data.content)) card.__niBrief = null; return data; })
    .catch(() => { card.__niBrief = null; return null; });
  card.__niBrief = p;
  return p;
}
// Warm the cache the moment the user shows intent (hover with a short delay, or the
// pointerdown that precedes a tap/click). Fire-and-forget — the click reuses it.
function niPrefetchBrief(card) {
  if (!card || !card.dataset || !card.dataset.url) return;
  try { niFetchBrief(card); } catch (_) {}
}
async function renderNewsBriefInto(panel, card, attempt = 0) {
  if (attempt === 0) panel.innerHTML = `<div class="ni-inner">${niLoaderHTML()}</div>`;
  const stillOpen = () => panel.dataset.kind === 'ai' && !panel.hidden;
  const d = { url: card.dataset.url || '', title: card.dataset.title || '', description: card.dataset.desc || '', date: card.dataset.date || '' };
  const t0 = Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const showFail = () => {
    panel.innerHTML = `<div class="ni-inner">${niFailHTML()}</div>`;
    panel.querySelector('[data-ni-retry]')?.addEventListener('click', () => renderNewsBriefInto(panel, card, 0));
  };
  const retryOrFail = async () => {
    if (attempt < NI_MAX_RETRIES) {
      await sleep(700 + attempt * 700);         // brief backoff; loader stays up
      if (!stillOpen()) return;
      return renderNewsBriefInto(panel, card, attempt + 1);
    }
    if (stillOpen()) showFail();
  };
  try {
    const data = await niFetchBrief(card);       // shared with hover/touch prefetch
    const left = 500 - (Date.now() - t0); if (left > 0) await sleep(left);
    if (!stillOpen()) return;                    // closed/switched mid-flight
    if (data && data.content) {
      const secs = niSplit(niNormalize(data.content));
      const secHTML = secs.length
        ? secs.map((s) => `<section class="ni-sec">${niSecHead(s.name)}${renderBriefBody(s.body, null)}</section>`).join('')
        : `<section class="ni-sec">${niSecHead('Brief')}${renderBriefBody(data.content, null)}</section>`;
      // 3 TABS: Summary (the AI sections) / Explore Further (External AI Models +
      // web categories) / Sources.
      const sourcesInner = niSourcesListHTML(data.headlines, data.sources, d.url);
      const tabs = [
        { key: 'summary', label: 'Summary', html: secHTML },
        { key: 'explore', label: 'Explore Further', html: exploreFurtherHTML({ prompt: newsStoryPrompt(card), webTerm: card.dataset.title || '', name: card.dataset.title || 'this story', subDesc: 'Dig deeper into this story with ChatGPT, Claude, Gemini & more' }) },
      ];
      if (sourcesInner) tabs.push({ key: 'sources', label: 'Sources', html: sourcesInner });
      panel.innerHTML = `<div class="ni-inner ai-reveal">${insightTabsHTML(tabs, 'ni-tabs')}</div>${niCloseFootHTML()}`;
      wireInsightTabs(panel.querySelector('.ni-inner'));
      wireExploreFurther(panel.querySelector('.ni-inner'));
      wireScrollFades(panel.querySelector('.ni-inner'));
      panel.querySelector('[data-ni-close]')?.addEventListener('click', () => {
        const c = panel.closest('.news-card');
        if (c) {
          c.classList.remove('news-card--open');
          c.querySelectorAll('.news-act[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
          try { c.querySelector('.news-act-ai')?.scrollIntoView({ block: 'nearest' }); } catch (_) {}
        }
        panel.hidden = true; panel.innerHTML = ''; panel.dataset.kind = '';
      });
      return;
    }
    await retryOrFail();                          // unavailable / no content
  } catch (_) {
    if (stillOpen()) await retryOrFail();
  }
}
function renderNewsWebInto(panel, card) {
  panel.innerHTML = `<div class="ni-inner">${niWebHTML(card.dataset.title || '')}</div>`;
  wireScrollFades(panel.querySelector('.ni-inner'));
}
// Clean top/bottom fades on a capped scroll area — show ONLY when there's hidden
// content above/below (host gets .fade-top/.fade-bot; CSS draws the gradients).
function wireScrollFades(scrollEl) {
  const host = scrollEl && scrollEl.closest('.news-panel');
  if (!host) return;
  host.classList.add('has-fade');
  const update = () => {
    const top = scrollEl.scrollTop;
    const max = scrollEl.scrollHeight - scrollEl.clientHeight;
    host.classList.toggle('fade-top', top > 4);
    host.classList.toggle('fade-bot', max > 6 && top < max - 4);
  };
  scrollEl.addEventListener('scroll', update, { passive: true });
  requestAnimationFrame(update);
  setTimeout(update, 260);
}

// Field accessors that work for BOTH rss.app live items and stored archive
// rows (which use url / description / published_at directly).
function itemUrl(it) { return (it && (it.url || it.link)) || ''; }
function itemDescRaw(it) {
  return (it && (it.description_text || it.content_text || it.description || it.summary)) || '';
}
function itemPubRaw(it) {
  return (it && (it.date_published || it.pub_date || it.published_at || it.date)) || '';
}
function itemPubMs(it) {
  const t = new Date(itemPubRaw(it)).getTime();
  return Number.isNaN(t) ? 0 : t;
}
function itemHost(it) {
  return sourceHost(itemUrl(it)) || String((it && it.source_name) || '').replace(/^www\./i, '').toLowerCase();
}

// One news card. Accepts rss.app items OR stored archive rows.
export function newsCardHTML(item) {
  const url = itemUrl(item);
  const title = item?.title || '';
  const descRaw = itemDescRaw(item);
  const pubDate = itemPubRaw(item);
  const host = sourceHost(url) || String(item?.source_name || '');
  const rel = relativeTime(pubDate);

  // The description is plain-text from rss.app's API — but run it through
  // the HTML parser anyway to defang anything unexpected. Visual truncation
  // is handled by CSS line-clamp so the full text stays in the DOM.
  const tmp = document.createElement('div');
  tmp.innerHTML = descRaw;
  const descText = (tmp.textContent || '').trim();

  const metaParts = [];
  if (host) metaParts.push(url
    ? `<a class="news-card-source" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" title="Open on ${escapeHTML(host)}">${escapeHTML(host)}</a>`
    : `<span class="news-card-source">${escapeHTML(host)}</span>`);
  if (host && rel) metaParts.push(`<span class="news-card-meta-sep" aria-hidden="true">·</span>`);
  if (rel) metaParts.push(`<time class="news-card-time">${escapeHTML(rel)}</time>`);

  // Layout (#10/#11/#12): title + summary span the FULL card width via a
  // stretched link (its ::after covers the whole card, so clicking anywhere —
  // including the meta margins — opens the story, with a full-width hover).
  // The foot row carries source · time · share on the left and the AI Insights
  // pill bottom-right; both sit above the stretched link so they stay clickable.
  return `
    <article class="news-card" data-title="${escapeAttr(title)}" data-desc="${escapeAttr(descText.slice(0, 500))}" data-url="${escapeAttr(url)}" data-date="${escapeAttr(pubDate)}">
      <a class="news-card-link"
         href="${escapeAttr(url)}"
         target="_blank"
         rel="noopener noreferrer">
        <h4 class="news-card-title">${escapeHTML(title)}</h4>
        ${descText ? `<p class="news-card-desc">${escapeHTML(descText)}</p>` : ''}
      </a>
      <div class="news-card-foot">
        <div class="news-card-meta">
          ${metaParts.join('')}
          <span class="news-share-wrap">
            <button type="button" class="news-action news-share-toggle" aria-expanded="false" aria-label="Share this story" title="Share">${SHARE_SVG}</button>
            <div class="news-share-panel" aria-hidden="true">
              <div class="news-share-panel-inner">
                <button type="button" class="news-share-opt" data-act="copy">${LINK_SVG}<span>Copy Link</span></button>
                <button type="button" class="news-share-opt" data-act="share">${SHARE_SVG}<span>Share via</span></button>
              </div>
            </div>
          </span>
        </div>
      </div>
      <div class="news-card-actions">
        ${url ? `<a class="news-act" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer"><span>View Story</span>${NI_VIEW_SVG}</a>` : ''}
        <button type="button" class="news-act news-act-ai" data-news-panel="ai" aria-expanded="false">${AI_SPARK_FILLED_SVG}<span class="news-act-ai-open">View AI Insights</span><span class="news-act-ai-close">Close AI Insights</span>${AI_CHEV_SVG}</button>
      </div>
      <div class="news-panel" data-news-panel-body hidden></div>
    </article>
  `;
}

export function listHTML(items) {
  if (!items || items.length === 0) {
    return `<div class="news-empty"><p>No news yet — check back soon.</p></div>`;
  }
  return `<div class="news-list">${items.map(newsCardHTML).join('')}</div>`;
}

// ===== Feed controller (live + archive paging + filters) =================

const TIME_OPTS = [['all', 'All time'], ['day', 'Past 24h'], ['week', 'Past week'], ['month', 'Past month']];
const TIME_WINDOWS = { day: 864e5, week: 6048e5, month: 2592e6 };
const NEWS_SEARCH_SVG = '<svg class="nf-search-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

function filterBarHTML(label) {
  const ph = label ? `Search ${label} news…` : 'Search news…';
  return `
    <div class="newsfeed-filters" role="group" aria-label="Filter news">
      <label class="nf-search-wrap">
        ${NEWS_SEARCH_SVG}
        <input type="search" class="nf-search" placeholder="${escapeAttr(ph)}" aria-label="${escapeAttr(ph)}">
      </label>
      <label class="nf-field nf-sortfield">
        <select class="nf-sort nf-select" aria-label="Sort and filter news">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="day">Past 24 hours</option>
          <option value="week">Past week</option>
          <option value="month">Past month</option>
        </select>
      </label>
    </div>`;
}

async function fetchLiveFeed(slug) {
  const res = await fetch(`/api/feeds/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    if (res.status === 404) return { items: [] };
    throw new Error(`API ${res.status}`);
  }
  const p = await res.json();
  if (p && p.noFeed) return { noFeed: true };
  return { items: Array.isArray(p && p.items) ? p.items : [] };
}

async function fetchArchive(slug, { q = '', before = '', limit = 30 } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (before) params.set('before', before);
  params.set('limit', String(limit));
  const res = await fetch(`/api/news/${encodeURIComponent(slug)}?${params.toString()}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const p = await res.json();
  return { stories: Array.isArray(p && p.stories) ? p.stories : [], nextBefore: (p && p.nextBefore) || null };
}

function startFeed(ctx) {
  const { card, scrollWrap, foot, slug, label } = ctx;
  const els = {
    search: card.querySelector('.nf-search'),
    sort: card.querySelector('.nf-sort'),
  };
  const state = {
    q: '', time: 'all', source: 'all', sort: 'newest',
    stories: [], urls: new Set(), exhausted: false, loading: false,
    liveCache: null, noFeed: false,
  };

  function addStories(arr) {
    let added = 0;
    for (const s of arr || []) {
      const u = itemUrl(s);
      if (!u || state.urls.has(u)) continue;
      state.urls.add(u); state.stories.push(s); added++;
    }
    return added;
  }
  function resetStories() { state.stories = []; state.urls = new Set(); }

  function visible() {
    let arr = state.stories.slice();
    const win = TIME_WINDOWS[state.time];
    if (win) { const cut = Date.now() - win; arr = arr.filter(s => itemPubMs(s) >= cut); }
    arr.sort((a, b) => state.sort === 'oldest' ? itemPubMs(a) - itemPubMs(b) : itemPubMs(b) - itemPubMs(a));
    return arr;
  }

  // Source filtering was removed (curation > per-source filtering); no-op kept
  // so existing call sites stay simple.
  function refreshSources() {}

  function renderFoot() {
    if (state.noFeed) { foot.innerHTML = ''; return; }
    if (state.exhausted) {
      foot.innerHTML = state.stories.length ? `<p class="newsfeed-end">You've reached the end of the archive.</p>` : '';
      return;
    }
    foot.innerHTML = `<button type="button" class="newsfeed-loadmore"${state.loading ? ' disabled' : ''}>${state.loading ? 'Loading…' : 'Load more stories'}</button>`;
    foot.querySelector('.newsfeed-loadmore')?.addEventListener('click', loadOlder);
  }

  function renderList() {
    if (state.noFeed) {
      scrollWrap.innerHTML = `<div class="newsfeed-placeholder"><p>News feed coming soon for this topic.</p></div>`;
      scrollWrap.appendChild(foot);
      renderFoot();
      return;
    }
    const vis = visible();
    if (!vis.length) {
      scrollWrap.innerHTML = `<div class="news-empty"><p>${state.q ? 'No stories match your search.' : 'No stories match these filters.'}</p></div>`;
    } else {
      scrollWrap.innerHTML = `<div class="news-list">${vis.map(newsCardHTML).join('')}</div>`;
      wireNewsAI(scrollWrap);
    }
    // Foot (Load more / end-of-archive) lives at the END of the scroll content,
    // so in tab mode it only appears once you scroll to the bottom of the list
    // — not pinned-and-visible at first load.
    scrollWrap.appendChild(foot);
    renderFoot();
  }

  function oldestBefore() {
    let min = Infinity;
    for (const s of state.stories) { const t = itemPubMs(s); if (t > 0 && t < min) min = t; }
    return Number.isFinite(min) ? new Date(min).toISOString() : '';
  }

  async function loadOlder() {
    if (state.loading || state.exhausted) return;
    const keepTop = scrollWrap.scrollTop; // preserve position (button is in-flow now)
    state.loading = true; renderFoot();
    try {
      const { stories, nextBefore } = await fetchArchive(slug, { q: state.q, before: oldestBefore(), limit: 30 });
      addStories(stories);
      if (!nextBefore || stories.length === 0) state.exhausted = true;
      state.loading = false;
      refreshSources(); renderList();
      scrollWrap.scrollTop = keepTop;
    } catch (_) {
      state.loading = false;
      foot.innerHTML = `<button type="button" class="newsfeed-loadmore">Retry</button>`;
      foot.querySelector('.newsfeed-loadmore')?.addEventListener('click', loadOlder);
    }
  }

  async function loadLive() {
    scrollWrap.innerHTML = `<div class="news-loading"><p>Loading news…</p></div>`; foot.innerHTML = '';
    try {
      const r = await fetchLiveFeed(slug);
      if (r.noFeed) { state.noFeed = true; renderList(); return; }
      state.liveCache = (r.items || []).slice();
      addStories(r.items);
      // If the live feed is thin, top up with a page of archive so there's a
      // FULL feed to scroll before the "Load older stories" button appears —
      // it shouldn't show after just a handful of stories on first load.
      if (state.stories.length < 12 && !state.exhausted) {
        try {
          const { stories, nextBefore } = await fetchArchive(slug, { before: oldestBefore(), limit: 30 });
          addStories(stories);
          if (!nextBefore || stories.length === 0) state.exhausted = true;
        } catch (_) {}
      }
      refreshSources(); renderList();
    } catch (_) {
      scrollWrap.innerHTML = `<div class="news-error"><p>News feed temporarily unavailable. Refresh to try again.</p></div>`;
    }
  }

  // Instant client-side match over the stories ALREADY loaded (the live feed),
  // so typing a visible headline surfaces it immediately — no network wait, no
  // Enter key. All whitespace-separated terms must appear somewhere in the
  // title / summary / source (AND match, case-insensitive).
  function matchLocal(q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const pool = state.liveCache || [];
    return pool.filter((s) => {
      const desc = (() => { const d = document.createElement('div'); d.innerHTML = itemDescRaw(s); return d.textContent || ''; })();
      const host = sourceHost(itemUrl(s)) || String((s && s.source_name) || '');
      const hay = `${s && s.title || ''} ${desc} ${host}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  // Instant pass: reset to just the locally-matched (or all, when cleared)
  // stories and render right away — runs on every keystroke, no debounce.
  function searchLocal(q) {
    state.q = q; state.exhausted = false; resetStories();
    if (!q) {
      if (state.liveCache) addStories(state.liveCache);
      refreshSources(); renderList();
      return;
    }
    const local = matchLocal(q);
    if (local.length) { addStories(local); refreshSources(); renderList(); }
    else { scrollWrap.innerHTML = `<div class="news-loading"><p>Searching…</p></div>`; foot.innerHTML = ''; }
  }

  // Debounced pass: augment the local hits with archive matches (older stories
  // not in the live feed). Guarded so a stale response can't clobber a newer
  // query. For an empty query, fall back to the full live feed.
  async function searchArchive(q) {
    if (!q) {
      if (!state.liveCache) await loadLive();
      return;
    }
    try {
      const { stories, nextBefore } = await fetchArchive(slug, { q, limit: 30 });
      if (state.q !== q) return;
      addStories(stories);
      if (!nextBefore) state.exhausted = true;
      refreshSources(); renderList();
    } catch (_) {
      if (state.q === q && !state.stories.length) {
        scrollWrap.innerHTML = `<div class="news-error"><p>Search unavailable. Try again.</p></div>`;
      }
    }
  }

  // Search + sort controls (restored revamp371). Listeners stay guarded so the
  // feed still works in any context that omits the filter bar.
  let searchTimer = null;
  els.search?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = els.search.value.trim();
    searchLocal(q);                                   // immediate
    searchTimer = setTimeout(() => searchArchive(q), 250); // network-backed
  });
  els.sort?.addEventListener('change', () => {
    const v = els.sort.value;
    if (v === 'oldest') { state.sort = 'oldest'; state.time = 'all'; }
    else if (v === 'newest') { state.sort = 'newest'; state.time = 'all'; }
    else { state.sort = 'newest'; state.time = v; } // day | week | month
    renderList();
  });

  loadLive();
}

export function renderNewsFeed(container, topic, isHome) {
  const slug = isHome ? 'home' : (topic && topic.slug);
  const label = isHome ? '' : ((topic && topic.name) || '');
  // Header (revamp383): big "News Feed" title — NO icon (#316), near-black, no
  // card-in-card, no search/sort controls.
  const headHTML = `
    <div class="newsfeed-head section-card-head">
      <div class="newsfeed-headtext">
        <h3 class="newsfeed-title section-card-title"><span class="newsfeed-logo" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><line x1="8" y1="8" x2="15" y2="8"/><line x1="8" y1="12" x2="15" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg></span><span class="newsfeed-title-main">News Feed</span></h3>
      </div>
    </div>`;

  container.innerHTML = `
    <div class="newsfeed-card">
      ${headHTML}
      <div class="newsfeed-scroll-wrap"></div>
      <div class="newsfeed-foot"></div>
    </div>`;

  const card = container.querySelector('.newsfeed-card');
  const scrollWrap = card.querySelector('.newsfeed-scroll-wrap');
  const foot = card.querySelector('.newsfeed-foot');
  if (!slug) {
    scrollWrap.innerHTML = `<div class="news-error"><p>News feed unavailable.</p></div>`;
    return;
  }
  startFeed({ card, scrollWrap, foot, slug, label });
}
