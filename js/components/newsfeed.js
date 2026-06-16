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

import { getModels } from '../utils/data.js';
import { openModel, copyPrompt } from '../utils/ai-models.js';

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
export function wireNewsAI(root) {
  root.querySelectorAll('.news-ai-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = trigger.closest('.news-card');
      if (card) showNewsBrief(card);
    });
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

function newsAIHTML() {
  return `<div class="news-ai"><button type="button" class="news-ai-trigger">${AI_SPARK_SVG}<span>AI Insights</span></button></div>`;
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
  if (host) metaParts.push(`<span class="news-card-source">${escapeHTML(host)}</span>`);
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
          <button type="button" class="news-action news-share-toggle" aria-expanded="false" aria-label="Share this story" title="Share">${SHARE_SVG}</button>
        </div>
        ${newsAIHTML()}
      </div>
      <div class="news-share-panel" aria-hidden="true">
        <div class="news-share-panel-inner">
          <button type="button" class="news-share-opt" data-act="copy">${LINK_SVG}<span>Copy Link</span></button>
          <button type="button" class="news-share-opt" data-act="share">${SHARE_SVG}<span>Share via</span></button>
        </div>
      </div>
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

  async function runSearch(q) {
    state.q = q; state.exhausted = false; resetStories();
    scrollWrap.innerHTML = `<div class="news-loading"><p>${q ? 'Searching…' : 'Loading news…'}</p></div>`; foot.innerHTML = '';
    try {
      if (!q) {
        if (state.liveCache) { addStories(state.liveCache); refreshSources(); renderList(); }
        else await loadLive();
        return;
      }
      const { stories, nextBefore } = await fetchArchive(slug, { q, limit: 30 });
      addStories(stories);
      if (!nextBefore) state.exhausted = true;
      refreshSources(); renderList();
    } catch (_) {
      scrollWrap.innerHTML = `<div class="news-error"><p>Search unavailable. Try again.</p></div>`;
    }
  }

  let searchTimer = null;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = els.search.value.trim();
    searchTimer = setTimeout(() => runSearch(q), 300);
  });
  // One combined select: Newest / Oldest (all-time direction) or a time window.
  els.sort.addEventListener('change', () => {
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
  const FEED_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="7" y1="12" x2="14" y2="12"/><line x1="7" y1="16" x2="11" y2="16"/></svg>';
  const headHTML = `
    <div class="newsfeed-head section-card-head">
      <div class="newsfeed-headtext">
        <h3 class="newsfeed-title section-card-title"><span class="newsfeed-logo">${FEED_ICON}</span><span class="newsfeed-title-main">News Feed</span></h3>
        <p class="section-card-sub">Latest stories and developments.</p>
      </div>
      ${filterBarHTML(label)}
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
