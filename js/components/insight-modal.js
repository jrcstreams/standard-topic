// Unified AI-Insight modal. Opened via the `open-insight-modal` CustomEvent with
//   { type: 'news'|'trend'|'shortcut', ...payload }
// Renders a clean, centered modal (matching the search / topics modals) with the
// AI brief, sources, and "Explore further with AI". Supports modal-over-modal
// stacking: opening one from inside another keeps a "← Back to …" action.
import { renderBriefBody, resolveSource } from './newsfeed.js?v=20260612-revamp176';
import { aiProvenanceHTML } from '../utils/ai-provenance.js?v=20260612-revamp176';
import { getModels, getModelById, getDefaultModelId, getExternalSearches, getExternalSearchCategories } from '../utils/data.js';
import { openModel, copyPrompt, getPreferredModelId, setPreferredModelId } from '../utils/ai-models.js';

let overlayEl = null;
let panelEl = null;
let stack = [];      // [{ entry, label }] — previous modals for the back action
let current = null;  // active entry { type, ... }

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function escAttr(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
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
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./i, ''); } catch { return ''; } }
// Keep the "Generating AI insights…" loader up for at least ~1s even when the
// brief is cached/instant — gives the generation a moment of presence without
// making anyone wait longer than necessary.
const MIN_LOADER_MS = 1000;
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function holdLoader(t0) { const left = MIN_LOADER_MS - (Date.now() - t0); if (left > 0) await sleep(left); }
// Top/bottom fade overlays on the panel that signal the body can scroll up or
// down. Re-created each render (innerHTML wipes them); a MutationObserver keeps
// them in sync as async content (the brief) loads in.
function setupModalFades() {
  const body = panelEl && panelEl.querySelector('.im-body');
  if (!body) return;
  if (panelEl._imFadeMO) { try { panelEl._imFadeMO.disconnect(); } catch (_) {} }
  const top = document.createElement('div'); top.className = 'im-fade im-fade-top';
  const bot = document.createElement('div'); bot.className = 'im-fade im-fade-bottom';
  panelEl.append(top, bot);
  const head = panelEl.querySelector('.im-head');
  const article = panelEl.querySelector('.im-article');
  const briefHead = panelEl.querySelector('#im-brief-head');
  const update = () => {
    top.style.top = (head ? head.offsetHeight : 0) + 'px';
    const scrollable = body.scrollHeight > body.clientHeight + 2;
    top.classList.toggle('is-on', scrollable && body.scrollTop > 2);
    bot.classList.toggle('is-on', scrollable && body.scrollTop < body.scrollHeight - body.clientHeight - 2);
    const bodyTop = body.getBoundingClientRect().top;
    // Condensed title bar: reveal once the overview card has scrolled out of view.
    if (article) panelEl.classList.toggle('is-scrolled', article.getBoundingClientRect().bottom < bodyTop + 6);
    // Discreet "AI Brief" sticky: reveal once the AI Brief header scrolls up
    // under the main header (#89).
    if (briefHead) panelEl.classList.toggle('is-brief-scrolled', briefHead.getBoundingClientRect().bottom < bodyTop + 6);
  };
  body.addEventListener('scroll', update, { passive: true });
  if (window.ResizeObserver) { const ro = new ResizeObserver(update); ro.observe(body); }
  if (window.MutationObserver) { const mo = new MutationObserver(update); mo.observe(body, { childList: true, subtree: true }); panelEl._imFadeMO = mo; }
  requestAnimationFrame(update); setTimeout(update, 400);
}
// Bring an accordion's header near the top of the scroll area when it expands.
// Lands it BELOW the top scroll-fade (38px) so the button stays clearly
// readable — anchoring it to the very top hid it under the fade.
function scrollHeaderToTop(el) {
  const body = panelEl && panelEl.querySelector('.im-body');
  if (!body || !el) return;
  requestAnimationFrame(() => {
    const delta = el.getBoundingClientRect().top - body.getBoundingClientRect().top - 50;
    // Only scroll DOWN to reveal expanded content — never yank the button up
    // under the fade when it's already comfortably in view.
    if (delta > 8) body.scrollTo({ top: body.scrollTop + delta, behavior: 'smooth' });
  });
}

const SPARK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/></svg>';
// FILLED sparkle — the exact mark used to flag AI-generated text on the homepage
// (ai-provenance SPARK_FILL). Used for the inline section flags + the legend so
// the modal's "AI-generated text" marker matches the rest of the app (#101/#102).
const SPARK_FILL = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg>';
// Inline "this block is AI" tag, attached directly to the brief body (the
// "AI Brief" header sits above the action buttons + rule, so the prose itself
// reads unmarked without it).
const AIGEN_TAG = `<div class="aigen-tag">${SPARK}<span>AI-generated</span></div>`;
const ARROW = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>';
const CHEV = '<svg class="im-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
// Brand mark — a clean, flat 4-point sparkle (the same spark used inline),
// filled white on the navy tile. Simple and on-brand (no glossy facets).
const LOGO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg>';
// News Feed (document) glyph — used as the News AI Insights modal's title icon (#90).
const NEWS_FEED_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="7" y1="12" x2="14" y2="12"/><line x1="7" y1="16" x2="11" y2="16"/></svg>';
// Right chevron — "drill into this sub-level" affordance (Web Sources → category).
const CHEVR = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
// Section-icon badge for "Sources & Coverage" — matches the brief section glyphs
// (link icon = related links/sources).
const SOURCES_BADGE = '<span class="ai-result-sub-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>';
// Explore-further icons: paper-plane (Direct Submit) + eye (Review Prompt).
const ICON_SEND = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2.5L11 13"/><path d="M21.5 2.5L15 21l-4-8-8-4z"/></svg>';
const ICON_EYE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';

// The model a Direct Submit goes to (the user's preferred / site default).
function preferredModelIM() {
  const id = getPreferredModelId(getDefaultModelId());
  return getModelById(id) || (getModels() || [])[0] || null;
}

export function initInsightModal() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'im-overlay';
  overlayEl.style.display = 'none';
  document.body.appendChild(overlayEl);

  panelEl = document.createElement('div');
  panelEl.className = 'im-panel';
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-modal', 'true');
  panelEl.setAttribute('aria-label', 'AI insight');
  panelEl.style.display = 'none';
  document.body.appendChild(panelEl);

  window.addEventListener('open-insight-modal', (e) => openFresh(e.detail));
  // Open stacked from within another modal: { entry, backLabel }.
  window.addEventListener('open-insight-modal-stacked', (e) => openStacked(e.detail && e.detail.entry, e.detail && e.detail.backLabel));
  // Single-modal coordinator: another top-level modal opening closes this one,
  // so a trend/news detail is never STACKED over the Trending list — it replaces
  // it (and "Back to Trending" reopens the list).
  window.addEventListener('close-all-modals', close);
  overlayEl.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlayEl.style.display !== 'none') close(); });
}

// iOS Safari ignores `body { overflow: hidden }` for touch scrolling, so the
// background steals the gesture and the modal "won't scroll". Lock the body
// with position:fixed (preserving + restoring scroll position and any prior
// inline styles a parent takeover may have set) so every gesture lands inside
// the modal's own scroll container.
let scrollLock = null;
function lockScroll() {
  if (scrollLock) return; // already locked (e.g. opened from a takeover) — keep it
  const b = document.body;
  const y = window.scrollY || window.pageYOffset || 0;
  scrollLock = { y, position: b.style.position, top: b.style.top, width: b.style.width, overflow: b.style.overflow };
  b.style.position = 'fixed';
  b.style.top = `-${y}px`;
  b.style.width = '100%';
  b.style.overflow = 'hidden';
}
function unlockScroll() {
  if (!scrollLock) return;
  const b = document.body;
  const { y, position, top, width, overflow } = scrollLock;
  b.style.position = position;
  b.style.top = top;
  b.style.width = width;
  b.style.overflow = overflow;
  scrollLock = null;
  if (position !== 'fixed') window.scrollTo(0, y); // restore unless a parent lock remains
}

function openFresh(entry) {
  if (!entry || !entry.type) return;
  // Close any other top-level modal first (e.g. the Trending list) so this
  // detail REPLACES it rather than stacking over it. This modal isn't open yet,
  // so its own close-all listener no-ops here.
  window.dispatchEvent(new CustomEvent('close-all-modals'));
  stack = [];
  current = entry;
  render();
  overlayEl.style.display = 'block';
  panelEl.style.display = 'flex';
  lockScroll();
}
function openStacked(entry, backLabel) {
  if (!entry) return;
  if (current) stack.push({ entry: current, label: backLabel || 'Back' });
  current = entry;
  render();
}
function goBack() {
  const prev = stack.pop();
  if (prev) { current = prev.entry; render(); return; }
  // No stacked parent — if this entry came from a list (Trending / News Feed),
  // "back" returns there: dispatch the list event (Trending) or just close to
  // the feed (News). #13/in-modal-nav.
  const nav = current && current.nav;
  if (nav && nav.backEvent) { close(); window.dispatchEvent(new CustomEvent(nav.backEvent)); return; }
  close();
}
// Jump to the previous/next item in the originating list (Trending/News), in
// place — same modal, new "page".
function navTo(i) {
  const nav = current && current.nav;
  if (!nav || !Array.isArray(nav.list) || i < 0 || i >= nav.list.length) return;
  current = { ...nav.list[i], nav: { ...nav, index: i } };
  render();
}
function titleCaseIM(s) { return String(s || '').replace(/\b\w/g, (c) => c.toUpperCase()); }
function navItemName(e) { return e && e.type === 'trend' ? titleCaseIM(e.query) : (e && e.title) || ''; }
// Prev/Next bar — previous on the left, next on the right, each with the item's
// name. Hidden when there's no originating list.
function navBarHTML(nav) {
  if (!nav || !Array.isArray(nav.list) || nav.list.length < 2) return '';
  const prev = nav.index > 0 ? nav.list[nav.index - 1] : null;
  const next = nav.index < nav.list.length - 1 ? nav.list[nav.index + 1] : null;
  if (!prev && !next) return '';
  const kind = nav.itemKind || 'item';
  const cell = (e, dir) => e
    ? `<button type="button" class="im-pn im-pn-${dir}" data-navdir="${dir}">
         ${dir === 'prev' ? '<span class="im-pn-arrow">‹</span>' : ''}
         <span class="im-pn-tx"><span class="im-pn-dir">${dir === 'prev' ? 'Previous' : 'Next'} ${esc(kind)}</span><span class="im-pn-name">${esc(navItemName(e))}</span></span>
         ${dir === 'next' ? '<span class="im-pn-arrow">›</span>' : ''}
       </button>`
    : '<span class="im-pn im-pn-empty" aria-hidden="true"></span>';
  return `<div class="im-prevnext">${cell(prev, 'prev')}${cell(next, 'next')}</div>`;
}
// News story prev/next — clean "Previous Story / Next Story" arrow links.
function storyNavHTML(nav, compact) {
  if (!nav || !Array.isArray(nav.list) || nav.list.length < 2) return '';
  const hasPrev = nav.index > 0, hasNext = nav.index < nav.list.length - 1;
  if (!hasPrev && !hasNext) return '';
  const cls = compact ? 'im-storynav im-storynav--compact' : 'im-storynav';
  return `<div class="${cls}">
    ${hasPrev ? `<button type="button" class="im-storynav-link" data-navdir="prev"><span class="im-storynav-arrow" aria-hidden="true">‹</span>Previous Story</button>` : '<span class="im-storynav-spacer" aria-hidden="true"></span>'}
    ${hasNext ? `<button type="button" class="im-storynav-link im-storynav-link--next" data-navdir="next">Next Story<span class="im-storynav-arrow" aria-hidden="true">›</span></button>` : '<span class="im-storynav-spacer" aria-hidden="true"></span>'}
  </div>`;
}
// "Sources & Coverage" — real related articles from our feed (hyperlinked
// headline + publisher · date). Prefers the rich RSS `headlines` (which carry a
// title/publisher/date); falls back to the grounding citations (publisher domain
// only) when we have no related coverage.
function coverageRow(uri, title, metaParts) {
  const meta = (metaParts || []).filter(Boolean).join(' · ');
  return `<a class="im-cov-row" href="${escAttr(uri)}" target="_blank" rel="noopener noreferrer"><span class="im-cov-text"><span class="im-cov-title">${esc(title)}</span>${meta ? `<span class="im-cov-host">${esc(meta)}</span>` : ''}</span>${ARROW}</a>`;
}
function coverageListHTML(headlines, sources, origUrl) {
  const seen = new Set(); const rows = [];
  // Rich related coverage from our own feed only — every row is a real article
  // with a headline + publisher · date. We deliberately do NOT render the bare
  // grounding-citation domains here: they have no headline, so they read as a
  // wall of raw links and mix awkwardly with the rich rows (#96/#97). The cited
  // publishers still live in the brief's "Sources:" line + the Sources panel.
  // Relevance is enforced server-side (newsRelated term-overlap), so only stories
  // genuinely about THIS story reach us.
  for (const h of (Array.isArray(headlines) ? headlines : [])) {
    if (rows.length >= 12) break;
    const uri = (h && (h.url || h.uri)) || ''; if (!uri) continue;
    const k = uri.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
    const title = String((h && h.title) || '').trim(); if (!title || /^https?:/i.test(title)) continue;
    let host = ''; try { host = new URL(uri).hostname.replace(/^www\./i, ''); } catch (_) {}
    rows.push(coverageRow(uri, title, [(h.source || '').trim() || host, relTime(h.date)]));
  }
  return rows.join('');
}
function close() {
  overlayEl.style.display = 'none';
  panelEl.style.display = 'none';
  unlockScroll();
  stack = [];
  current = null;
}

function headerHTML(eyebrow, title, subHTML) {
  const showBack = stack.length > 0;
  const backLabel = stack.length ? stack[stack.length - 1].label : '';
  return `<div class="im-head">
    <div class="im-head-bar">
      ${showBack ? `<button type="button" class="im-back" id="im-back"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>${esc(backLabel)}</button>` : '<span class="im-eyebrow-wrap"><span class="im-spark">' + SPARK + '</span><span class="im-eyebrow">' + esc(eyebrow) + '</span></span>'}
      <button type="button" class="im-close" id="im-close" aria-label="Close"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg></button>
    </div>
    ${showBack ? `<span class="im-eyebrow-wrap"><span class="im-spark">${SPARK}</span><span class="im-eyebrow">${esc(eyebrow)}</span></span>` : ''}
    <h3 class="im-title">${esc(title)}</h3>
    ${subHTML ? `<div class="im-sub">${subHTML}</div>` : ''}
  </div>`;
}

// Brand-only header: the "AI Insights" lockup is the card title (the article
// title moves into the Article Overview section below). Keeps the back action
// when stacked.
function brandHeaderHTML(condensed, opts = {}) {
  const brandLabel = opts.brandLabel || 'AI Insights';
  const icon = opts.icon || LOGO;
  const nav = current && current.nav;
  // Back action: a stacked parent wins; otherwise the originating list
  // ("Back to Trending" / "Back to News Feed").
  const showBack = stack.length > 0 || !!(nav && nav.backLabel);
  const backLabel = stack.length ? stack[stack.length - 1].label
    : (nav && nav.backLabel ? `Back to ${nav.backLabel}` : '');
  // Story Prev/Next now lives in the TOP header row (#87), freeing the body so
  // the overview starts higher. Only for list-backed news (Trending uses the
  // stacked prev/next bar elsewhere).
  const headerNav = opts.headerNav && nav && Array.isArray(nav.list) && nav.list.length > 1;
  const hasPrev = headerNav && nav.index > 0;
  const hasNext = headerNav && nav.index < nav.list.length - 1;
  const headNav = headerNav ? `<span class="im-head-nav">
      <button type="button" class="im-head-navbtn" data-navdir="prev"${hasPrev ? '' : ' disabled'} aria-label="Previous story"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg><span>Prev</span></button>
      <button type="button" class="im-head-navbtn" data-navdir="next"${hasNext ? '' : ' disabled'} aria-label="Next story"><span>Next</span><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
    </span>` : '';
  // condensed = { title, meta } — a compact title bar that fades in once the
  // overview card scrolls out of view. NO prev/next arrows now (#85); the title
  // is left-aligned and the actions sit next to "View original" (#86).
  const condMeta = condensed && (condensed.meta || condensed.url) ? `<span class="im-condensed-meta">${condensed.meta ? `<span class="im-condensed-pub">${esc(condensed.meta)}</span>` : ''}${condensed.url ? `<a class="im-condensed-link" href="${escAttr(condensed.url)}" target="_blank" rel="noopener noreferrer">View original ${ARROW}</a>` : ''}</span>` : '';
  const condActs = opts.condActions ? `<span class="im-condensed-acts">
      <button type="button" class="im-cond-act" data-panel="sources">Sources</button>
      <button type="button" class="im-cond-act" data-panel="explore">Ask AI</button>
      <button type="button" class="im-cond-act" data-panel="web">Web Search</button>
      ${opts.condGoogleTrends ? `<a class="im-cond-act" href="${escAttr(opts.condGoogleTrends)}" target="_blank" rel="noopener noreferrer">Google Trends ${ARROW}</a>` : ''}
    </span>` : '';
  const cond = condensed && condensed.title ? `<div class="im-condensed">
      <div class="im-condensed-top"><span class="im-condensed-title">${esc(condensed.title)}</span></div>
      <div class="im-condensed-sub">${condMeta}${condActs}</div>
    </div>` : '';
  return `<div class="im-head im-head--brand">
    <div class="im-head-row">
      <span class="im-brandlock"><span class="im-logo">${icon}</span><span class="im-brandname">${esc(brandLabel)}</span></span>
      <span class="im-head-actions">
        ${headNav}
        ${showBack ? `<button type="button" class="im-back" id="im-back"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>${esc(backLabel)}</button>` : ''}
        <button type="button" class="im-close" id="im-close" aria-label="Close"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg></button>
      </span>
    </div>
    ${cond}
    ${opts.briefSticky ? `<div class="im-brief-sticky"><span class="im-brief-sticky-logo">${SPARK}</span><span class="im-brief-sticky-title">AI Brief</span><span class="im-brief-sticky-note">Text in this section is generated by AI.</span></div>` : ''}
  </div>`;
}

// Generating state — a centered, animated block that occupies roughly the
// space the brief will fill (spark pulse + label + shimmering text bars).
function genLoaderHTML(label) {
  return `<div class="im-gen">
    <div class="im-gen-spark">${LOGO}</div>
    <div class="im-gen-label">${esc(label || 'Generating AI insights…')}</div>
    <div class="im-gen-bars"><span></span><span></span><span></span><span></span><span></span></div>
  </div>`;
}
function briefSkeleton(label) {
  return `<div class="im-brief" id="im-brief">${genLoaderHTML(label)}</div>`;
}

// Bottom actions — the same three across every AI brief surface:
//   1) Sources and citations  2) Explore further with AI  3) Explore further on web
// (1) lists the brief's cited sources (a "View original article" row leads it on
// news). (3) opens the full Web Sources platform picker for the term.
// `sources:false` omits the "Sources & citations" panel — used on trends, where
// the cited grounding now renders as the visible "In the news" list instead, so a
// collapsible Sources panel would just duplicate it.
function actionsHTML({ sources = true } = {}) {
  return `<div class="im-actions im-actions-row">
      ${sources ? `<button type="button" class="im-actbtn" data-panel="sources" aria-expanded="false"><span>Sources</span>${CHEV}</button>` : ''}
      <button type="button" class="im-actbtn im-actbtn-primary" data-panel="explore" aria-expanded="false"><span>Ask AI</span>${CHEV}</button>
      <button type="button" class="im-actbtn" data-panel="web" aria-expanded="false"><span>Web Search</span>${CHEV}</button>
    </div>
    ${sources ? '<div class="im-acc" data-body="sources" id="im-sources-panel"></div>' : ''}
    <div class="im-acc" data-body="explore" id="im-explore-panel"></div>
    <div class="im-acc" data-body="web" id="im-web-panel"></div>`;
}

// Cited sources for "Sources and citations". On a news story `origUrl` adds a
// leading "View original article" row back to the publisher.
function sourcesListHTML(sources, origUrl) {
  const rows = [];
  if (origUrl) {
    rows.push(`<a class="im-source-row im-source-row--orig" href="${escAttr(origUrl)}" target="_blank" rel="noopener noreferrer"><span>View original article</span>${ARROW}</a>`);
  }
  const seen = new Set();
  for (const s of (sources || [])) {
    const uri = s.uri || s.url || '';
    const label = (s.title && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.title)) ? s.title : (hostOf(uri) || s.title || 'source');
    const key = label.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(`<a class="im-source-row" href="${escAttr(uri)}" target="_blank" rel="noopener noreferrer"><span>${esc(label)}</span>${ARROW}</a>`);
  }
  return rows.length ? `<div class="im-source-list">${rows.join('')}</div>` : '<p class="im-empty">No sources cited for this brief.</p>';
}

// Web Sources level 1 — pick a source type (Search & reference, Audio & video…).
// Web Sources as native <details> accordions (#30) — each source type drops
// its platforms down in place (term substituted). No next-page / back.
function webSourcesCategoriesHTML(term) {
  const cats = getExternalSearchCategories() || [];
  const searches = getExternalSearches() || [];
  const avail = cats.filter((c) => searches.some((s) => s.category === c.key));
  if (!avail.length) return '<p class="im-empty">No web sources available.</p>';
  return `<div class="im-substep im-wscat-acc">${
    avail.map((c) => {
      const rows = (searches.filter((s) => s.category === c.key)).map((s) => {
        const url = String(s.urlTemplate || '').replace(/\{query\}/g, encodeURIComponent(term || ''));
        return `<a class="im-source-row" href="${escAttr(url)}" target="_blank" rel="noopener noreferrer"><span class="im-source-row-text"><span class="im-source-name">${esc(s.name)}</span>${s.description ? `<span class="im-source-desc">${esc(s.description)}</span>` : ''}</span>${ARROW}</a>`;
      }).join('');
      return `<details class="im-wscat" name="im-wscat"><summary class="im-wscat-sum"><span>${esc(c.label)}</span>${CHEV}</summary><div class="im-source-list">${rows}</div></details>`;
    }).join('')
  }</div>`;
}
// Older cached trend briefs sometimes leaked the raw "SUMMARY: …/DETAIL: …"
// scaffold into the stored body. Show only the DETAIL prose when present.
function cleanTrendContent(s) {
  let t = String(s || '');
  const di = t.search(/[*_]*\s*detail\s*[*_]*\s*:/i);
  if (di !== -1) t = t.slice(di).replace(/^[*_\s]*detail\s*[*_]*\s*:\s*[*_]*/i, '');
  t = t.replace(/[*_]*\s*summary\s*[*_]*\s*:[\s\S]*?(?:\n\n|$)/i, '').replace(/^[\s*_]+/, '').trim();
  return t || String(s || '');
}
// Keep only the label-free one-liner from a possibly-dirty stored summary.
function cleanSummary(s) {
  let t = String(s || '').replace(/[*_]+/g, '').trim();
  const m = t.match(/summary\s*:\s*([\s\S]*?)(?:\s*detail\s*:|$)/i);
  if (m) t = m[1];
  return t.replace(/^\s*(summary|detail)\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
}

// Explore-further step 1: choose how to send (matches the AI Intelligence
// component). Direct Submit → leaving-site confirm; Review → full prompt modal.
function imModelOptionsHTML() {
  const m = preferredModelIM();
  return (getModels() || []).map((x) => `<option value="${escAttr(x.id)}"${m && x.id === m.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
}
function exploreHomeHTML() {
  const m = preferredModelIM();
  return `<div class="im-explore" data-step="home">
    <label class="im-explore-model"><span class="im-explore-model-lead">Send to</span>
      <span class="im-explore-select-wrap"><select class="im-explore-select" aria-label="Choose AI model">${imModelOptionsHTML()}</select>${CHEV}</span></label>
    <button type="button" class="im-explore-opt" data-opt="direct">
      <span class="im-explore-ic">${ICON_SEND}</span>
      <span class="im-explore-tx"><span class="im-explore-name">Direct Submit</span><span class="im-explore-sub">Open <span class="im-explore-mn">${esc(m ? m.name : 'an AI model')}</span> with this prompt</span></span>
      ${CHEVR}
    </button>
    <button type="button" class="im-explore-opt" data-opt="review">
      <span class="im-explore-ic">${ICON_EYE}</span>
      <span class="im-explore-tx"><span class="im-explore-name">Review Prompt</span><span class="im-explore-sub">Preview &amp; tweak it before you send</span></span>
      ${CHEVR}
    </button>
  </div>`;
}
// Explore-further step 2 (Direct Submit): "leaving the site" confirm.
function exploreLeaveHTML() {
  const m = preferredModelIM();
  const name = m ? m.name : 'the AI model';
  return `<div class="im-explore" data-step="leave">
    <div class="im-leave-card">
      <button type="button" class="im-leave-back">${'<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'}<span>Back</span></button>
      <p class="im-leave-title">You're leaving Standard Topic</p>
      <p class="im-leave-body">Continue opens <strong>${esc(name)}</strong> in a new tab. If the prompt doesn't auto-fill, it's copied to your clipboard — just paste it in. You may need to be signed in.</p>
      <button type="button" class="im-leave-go">Continue ${ARROW}</button>
    </div>
  </div>`;
}

// Wire the shared bottom actions + explore flow. `ctx` provides the prompt,
// review handler, cited sources, and (for trends) webTerm for Web Sources.
function wireActions(ctx) {
  const explorePanel = panelEl.querySelector('#im-explore-panel');
  const wsPanel = panelEl.querySelector('#im-web-panel');
  const TRIGGERS = '.im-actbtn, .im-qlink-btn, .im-cond-act';
  panelEl.querySelectorAll(TRIGGERS).forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.dataset.panel;
      // Sources is no longer an accordion — it jumps to the Sources & Coverage
      // section at the bottom of the brief (#109).
      if (name === 'sources') {
        const cov = panelEl.querySelector('#im-coverage');
        if (cov && !cov.hidden) cov.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const body = panelEl.querySelector(`[data-body="${name}"]`);
      // A condensed-bar trigger lives in the sticky header while its panel is
      // scrolled out of view up top — so jump the body back to the overview
      // card rather than anchoring to the (fixed) button.
      const fromCond = btn.classList.contains('im-cond-act');
      const wasOpen = !fromCond && btn.getAttribute('aria-expanded') === 'true';
      const willOpen = !wasOpen;
      panelEl.querySelectorAll(TRIGGERS).forEach(b => b.setAttribute('aria-expanded', 'false'));
      panelEl.querySelectorAll('.im-acc').forEach(p => p.classList.remove('is-open'));
      if (willOpen) {
        // Mirror the open state onto every trigger that shares this panel.
        panelEl.querySelectorAll(`[data-panel="${name}"]`).forEach(b => b.setAttribute('aria-expanded', 'true'));
        if (name === 'explore' && explorePanel && !explorePanel.dataset.ready) { explorePanel.innerHTML = exploreHomeHTML(); explorePanel.dataset.ready = '1'; }
        if (name === 'web' && wsPanel && !wsPanel.dataset.ready) { wsPanel.innerHTML = webSourcesCategoriesHTML(ctx.webTerm || ''); wsPanel.dataset.ready = '1'; }
        body && body.classList.add('is-open');
        // Open in place — don't scroll the body (#106), so the reader keeps
        // context. Only a condensed-bar trigger (its panel is up at the overview,
        // scrolled away) jumps the body back to the top.
        if (fromCond) { const bodyEl = panelEl.querySelector('.im-body'); if (bodyEl) bodyEl.scrollTo({ top: 0, behavior: 'smooth' }); }
      }
    });
  });
  if (explorePanel) explorePanel.addEventListener('change', (e) => {
    const sel = e.target.closest('.im-explore-select'); if (!sel) return;
    setPreferredModelId(sel.value);
    const m = preferredModelIM();
    const mn = explorePanel.querySelector('.im-explore-mn');
    if (mn && m) mn.textContent = m.name;
  });
  if (explorePanel) explorePanel.addEventListener('click', (e) => {
    const opt = e.target.closest('.im-explore-opt');
    const back = e.target.closest('.im-leave-back');
    const go = e.target.closest('.im-leave-go');
    if (opt) {
      e.stopPropagation();
      if (opt.dataset.opt === 'review') { ctx.onReview(); }
      else {
        // Direct Submit → confirm leaving the site. Copy now so the later
        // Continue click can open the model synchronously (no popup block).
        copyPrompt(ctx.prompt);
        explorePanel.innerHTML = exploreLeaveHTML();
      }
    } else if (back) {
      e.stopPropagation();
      explorePanel.innerHTML = exploreHomeHTML();
    } else if (go) {
      e.stopPropagation();
      const model = preferredModelIM(); if (!model) return;
      openModel(model, ctx.prompt);
    }
  });
  // Web Sources are now native <details> accordions (#30) — each source type
  // drops its platforms down in place, no JS wiring needed.
}

function render() {
  if (!current) return;
  // News briefs get a FIXED panel height so the modal doesn't shrink while the
  // brief is generating then jump bigger when it loads — keeps Prev/Next usable
  // (#98). Other insight types size to content.
  panelEl.classList.toggle('im-panel--news', current.type === 'news');
  if (current.type === 'news') renderNews(current);
  else if (current.type === 'trend') renderTrend(current);
  else if (current.type === 'overview') renderOverview(current);
  else renderNews(current);
  panelEl.querySelector('#im-close')?.addEventListener('click', close);
  panelEl.querySelector('#im-back')?.addEventListener('click', goBack);
  const navIdx = current && current.nav ? current.nav.index : -1;
  panelEl.querySelectorAll('[data-navdir]').forEach(b => b.addEventListener('click', () => navTo(navIdx + (b.dataset.navdir === 'next' ? 1 : -1))));
  panelEl.scrollTop = 0;
  setupModalFades();
}

// ---- News -----------------------------------------------------------------
// Relabel + reorder a news brief's sections so EXISTING cached briefs (written
// with the old "Explanation / Key Points / Background / Timeline" prompt) render
// with the new vocabulary + order — not just freshly-generated ones.
const NEWS_SECTION_MAP = [
  { keys: ['what happened', 'explanation'], label: 'What Happened' },
  { keys: ['key takeaways', 'key takeaway', 'key points'], label: 'Key Takeaways' },
  { keys: ['why it matters', 'why this matters', 'background'], label: 'Why It Matters' },
  { keys: ['timeline'], label: 'Timeline' },
];
function normalizeNewsBrief(content) {
  const text = String(content || '');
  const re = /^#{1,4}\s+(.+?)\s*$/gm;
  const heads = []; let m;
  while ((m = re.exec(text))) heads.push({ title: m[1].trim(), start: m.index, contentStart: re.lastIndex });
  if (!heads.length) return text; // no section headers — leave prose untouched
  const sections = heads.map((h, i) => ({
    title: h.title,
    body: text.slice(h.contentStart, i + 1 < heads.length ? heads[i + 1].start : text.length).replace(/^\n+/, '').replace(/\s+$/, ''),
  }));
  const norm = (t) => t.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const buckets = NEWS_SECTION_MAP.map(() => null);
  const extras = [];
  for (const s of sections) {
    const n = norm(s.title);
    const idx = NEWS_SECTION_MAP.findIndex(g => g.keys.includes(n));
    if (idx >= 0 && !buckets[idx]) buckets[idx] = { label: NEWS_SECTION_MAP[idx].label, body: s.body };
    else extras.push({ label: s.title, body: s.body }); // unknown section keeps its name, lands at the end
  }
  const ordered = buckets.filter(Boolean).concat(extras);
  return ordered.length ? ordered.map(s => `### ${s.label}\n${s.body}`).join('\n\n') : text;
}
function newsPromptFor(d) {
  return `Give me a thorough, accurate briefing on this news story — what happened, why it matters, background, a timeline, and the latest developments.\n\n"${d.title || ''}"${d.description ? `\n\n${d.description}` : ''}${d.url ? `\n\nSource: ${d.url}` : ''}`;
}
function renderNews(d) {
  const host = hostOf(d.url) || (d.source_name || '');
  const when = relTime(d.date);
  const meta = [
    host ? `<a class="im-pub" href="${escAttr(d.url)}" target="_blank" rel="noopener noreferrer">${esc(host)} ${ARROW}</a>` : '',
    when ? `<span class="im-when">${esc(when)}</span>` : '',
  ].filter(Boolean).join('<span class="im-dot">·</span>');
  panelEl.innerHTML = `
    ${brandHeaderHTML({ title: d.title || 'News story', meta: host, url: d.url || '' }, { brandLabel: 'News AI Insights', condActions: true, icon: NEWS_FEED_ICON, headerNav: true, briefSticky: true })}
    <div class="im-body">
      <section class="im-section im-article">
        ${meta ? `<div class="im-article-meta im-article-meta--top">${meta}</div>` : ''}
        <h3 class="im-article-title">${esc(d.title || 'News story')}</h3>
        ${d.description ? `<p class="im-article-summary">${esc(d.description)}</p>` : ''}
        <div class="im-quicklinks">
          ${d.url ? `<a class="im-qlink" href="${escAttr(d.url)}" target="_blank" rel="noopener noreferrer">View Original ${ARROW}</a>` : ''}
          <button type="button" class="im-qlink im-qlink-btn" data-panel="sources" aria-expanded="false">Sources</button>
          <button type="button" class="im-qlink im-qlink-btn" data-panel="explore" aria-expanded="false">Ask AI</button>
          <button type="button" class="im-qlink im-qlink-btn" data-panel="web" aria-expanded="false">Web Search</button>
        </div>
        <div class="im-acc" data-body="explore" id="im-explore-panel"></div>
        <div class="im-acc" data-body="web" id="im-web-panel"></div>
      </section>
      <section class="im-section im-brief-section">
        <div class="im-aiflag-legend im-aiflag-legend--lg" id="im-brief-head">${SPARK_FILL}<span>= AI-generated text</span></div>
        <p class="im-disclaimer">An AI-generated summary of this story. Please verify important details with the linked sources.</p>
        <div class="ai-prov-slot im-prov-link" id="im-prov" role="link" tabindex="0" title="Jump to Sources &amp; Coverage"></div>
        <hr class="im-rule">
        ${briefSkeleton()}
      </section>
      <section class="im-section im-coverage" id="im-coverage" hidden>
        <div class="im-section-title im-section-title--icon">${SOURCES_BADGE}<span>Sources &amp; Coverage</span></div>
        <div class="im-coverage-list" id="im-coverage-list"></div>
      </section>
    </div>`;
  const prompt = newsPromptFor(d);
  // Wire the quicklink accordions immediately (triggers live in the overview
  // card now). `ctx.sources` is mutated once the brief loads, so the Sources
  // panel + the Sources & Coverage card both fill in then.
  const ctx = { prompt, sources: [], headlines: [], origUrl: d.url || '', webTerm: d.title || '', onReview: () => window.dispatchEvent(new CustomEvent('open-prompt-modal', { detail: { basePrompt: prompt, topicName: d.title || '', name: 'AI Insight · News', count: 1 } })) };
  wireActions(ctx);
  // "Sources:" line under the AI Brief jumps to the Sources & Coverage section (#88).
  const provLink = panelEl.querySelector('#im-prov');
  if (provLink) {
    const jump = () => { const cov = panelEl.querySelector('#im-coverage'); if (cov && !cov.hidden) cov.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    provLink.addEventListener('click', jump);
    provLink.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); } });
  }
  (async () => {
    const t0 = Date.now();
    const briefEl = panelEl.querySelector('#im-brief');
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'news', url: d.url || '', title: d.title || '', description: d.description || '', date: d.date || '' }) });
      const data = res.ok ? await res.json() : null;
      await holdLoader(t0);
      if (panelEl.querySelector('#im-brief') !== briefEl) return;
      if (data && data.content) {
        ctx.sources = data.sources || [];
        ctx.headlines = Array.isArray(data.headlines) ? data.headlines : [];
        briefEl.innerHTML = renderBriefBody(normalizeNewsBrief(data.content), null, { aiFlag: SPARK_FILL }); briefEl.classList.add('ai-reveal');
        const prov = panelEl.querySelector('#im-prov');
        if (prov) { prov.innerHTML = aiProvenanceHTML(ctx.sources, { badge: false }); prov.hidden = !prov.textContent.trim(); }
      } else { briefEl.innerHTML = '<p class="im-empty">AI brief unavailable right now.</p>'; }
    } catch (_) { if (panelEl.querySelector('#im-brief') === briefEl) briefEl.innerHTML = '<p class="im-empty">AI brief unavailable.</p>'; }
    // Fill the Sources & Coverage card from the related coverage.
    const covList = panelEl.querySelector('#im-coverage-list'), cov = panelEl.querySelector('#im-coverage');
    const covRows = coverageListHTML(ctx.headlines, ctx.sources, ctx.origUrl);
    if (cov && covRows) { covList.innerHTML = covRows; cov.hidden = false; }
  })();
}

// "Sources & Coverage" under a trend brief — the SAME rich rows (headline +
// publisher · date) the news modal uses, so trends match (#114). Rich coverage
// only (no bare grounding domains); the cited publishers stay in the "Sources:"
// line above. Hidden when we have no related coverage.
function inTheNewsHTML(sources, headlines) {
  const rows = coverageListHTML(headlines, sources, '');
  if (!rows) return '';
  return `<div class="im-coverage im-coverage--inline" id="im-coverage"><div class="im-section-title im-section-title--icon">${SOURCES_BADGE}<span>Sources &amp; Coverage</span></div><div class="im-coverage-list">${rows}</div></div>`;
}

// ---- Trend ----------------------------------------------------------------
function renderTrend(d) {
  const cat = d.category || (Array.isArray(d.categories) ? d.categories[0] : '') || '';
  const since = relTime(d.startedAt);
  const title = String(d.query || '').replace(/\b\w/g, c => c.toUpperCase());
  const meta = [cat ? `<span class="im-cat-pill">${esc(cat)}</span>` : '', since ? `<span class="im-when">Trending since ${esc(since)}</span>` : '']
    .filter(Boolean).join('');
  const gtUrl = `https://trends.google.com/trends/explore?q=${encodeURIComponent(d.query || '')}&geo=US`;
  panelEl.innerHTML = `
    ${brandHeaderHTML({ title, meta: [cat, since ? `Trending since ${since}` : ''].filter(Boolean).join(' · '), gtUrl }, { brandLabel: 'Trending', condActions: true, condGoogleTrends: gtUrl, briefSticky: true })}
    <div class="im-body">
      ${navBarHTML(d.nav)}
      <section class="im-section im-article">
        <h3 class="im-article-title">${esc(title)}</h3>
        ${meta ? `<div class="im-article-meta im-article-meta--top">${meta}</div>` : ''}
        ${Array.isArray(d.trendBreakdown) && d.trendBreakdown.length ? `<div class="im-related">
          <span class="im-related-label">Related searches</span>
          <div class="im-related-chips">${d.trendBreakdown.slice(0, 8).map((r) => `<button type="button" class="im-related-chip" data-term="${escAttr(r)}">${esc(r)}</button>`).join('')}</div>
        </div>` : ''}
        <div class="im-quicklinks">
          <button type="button" class="im-qlink im-qlink-btn" data-panel="sources" aria-expanded="false">Sources</button>
          <button type="button" class="im-qlink im-qlink-btn" data-panel="explore" aria-expanded="false">Ask AI</button>
          <button type="button" class="im-qlink im-qlink-btn" data-panel="web" aria-expanded="false">Web Search</button>
          <a class="im-qlink" href="${escAttr(gtUrl)}" target="_blank" rel="noopener noreferrer">View on Google Trends ${ARROW}</a>
        </div>
        <div class="im-acc" data-body="explore" id="im-explore-panel"></div>
        <div class="im-acc" data-body="web" id="im-web-panel"></div>
      </section>
      <section class="im-section im-brief-section">
        <div class="im-aiflag-legend im-aiflag-legend--lg" id="im-brief-head">${SPARK_FILL}<span>= AI-generated text</span></div>
        <p class="im-disclaimer">The below is an AI-generated summary of why this is trending. Please verify important details with the linked sources.</p>
        <hr class="im-rule">
        ${briefSkeleton()}
      </section>
    </div>`;
  // Related-search chips drill into that term as a new trend page IN THIS modal
  // (stacked, so "Back to {this trend}" returns here).
  panelEl.querySelectorAll('.im-related-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const t = chip.dataset.term; if (!t) return;
      openStacked({ type: 'trend', query: t }, `Back to ${title}`);
    });
  });
  const prompt = `Explain what "${d.query}" is and why it's trending right now — what just happened, the background, and the latest developments.`;
  // Wire the overview-card quicklinks up front (Sources jumps to coverage; Ask AI
  // / Web Search open their panels) so they work before the brief lands.
  const ctx = { prompt, sources: [], origUrl: '', webTerm: d.query, onReview: () => window.dispatchEvent(new CustomEvent('open-prompt-modal', { detail: { basePrompt: prompt, topicName: d.query, name: 'Trending · AI', count: 1 } })) };
  wireActions(ctx);
  (async () => {
    const t0 = Date.now();
    const briefEl = panelEl.querySelector('#im-brief');
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'trend', query: d.query }) });
      const data = res.ok ? await res.json() : null;
      await holdLoader(t0);
      if (panelEl.querySelector('#im-brief') !== briefEl) return;
      if (data && data.content) {
        const cleanSum = cleanSummary(data.summary);
        let detail = cleanTrendContent(data.content);
        // Older cached briefs stored the summary inside the content, so the
        // modal (summary line + detail) showed it twice. Strip a leading exact
        // repeat of the summary from the detail.
        if (cleanSum && detail) {
          const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          const sN = norm(cleanSum);
          for (let i = 0; i < 4; i++) {
            const fsm = detail.match(/^.*?[.!?](?=\s|$)/);
            const fs = fsm ? fsm[0] : '';
            if (!fs || norm(fs) !== sN) break;
            const rest = detail.slice(fs.length).replace(/^[\s).,:;–—-]+/, '').trim();
            if (!rest) break;
            detail = rest;
          }
        }
        ctx.sources = data.sources || [];
        // Two labelled sections, like the news brief: why it's trending (the
        // one-liner) + a fuller summary — each gets its icon + inline AI flag.
        const sectionMd = [
          cleanSum ? `### Why Is This Trending\n${cleanSum}` : '',
          detail ? `### Summary\n${detail}` : '',
        ].filter(Boolean).join('\n\n');
        briefEl.innerHTML = `${renderBriefBody(sectionMd || detail, null, { aiFlag: SPARK_FILL })}${inTheNewsHTML(data.sources, data.headlines)}`; briefEl.classList.add('ai-reveal');
      } else { briefEl.innerHTML = '<p class="im-empty">No AI brief generated for this trend yet.</p>'; }
    } catch (_) { if (panelEl.querySelector('#im-brief') === briefEl) briefEl.innerHTML = '<p class="im-empty">AI brief unavailable.</p>'; }
  })();
}

// ---- AI Intelligence overview --------------------------------------------
function splitSections(content) {
  const text = String(content || '');
  // Tolerate header drift: the model sometimes wraps headers in bold
  // (**## Name**), uses ### , or trailing **. Match all and clean the name.
  const re = /^[ \t]*(?:\*\*)?#{2,3}\s+(.+?)\s*$/gm;
  const idx = []; let m;
  while ((m = re.exec(text))) {
    const name = m[1].replace(/\*\*/g, '').replace(/\s*[—–-]\s*section brief\s*:.*/i, '').replace(/[:#\s]+$/, '').trim();
    idx.push({ name, start: m.index, headEnd: m.index + m[0].length });
  }
  if (!idx.length) return [];
  return idx.map((s, i) => ({ name: s.name, body: text.slice(s.headEnd, i + 1 < idx.length ? idx[i + 1].start : text.length).trim() }));
}
function renderOverview(d) {
  const lens = d.label || 'AI';
  const topicLabel = d.scopeTopic || 'this topic';
  panelEl.innerHTML = `
    ${brandHeaderHTML({ title: topicLabel, meta: lens })}
    <div class="im-body">
      <section class="im-section im-article">
        <div class="im-section-title">${esc(lens)}</div>
        <h3 class="im-article-title">${esc(topicLabel)}</h3>
      </section>
      <section class="im-section im-brief-section">
        <div class="im-aiflag-legend im-aiflag-legend--lg">${SPARK_FILL}<span>= AI-generated text</span></div>
        <p class="im-disclaimer">The below is an AI-generated ${esc(lens)} overview of ${esc(topicLabel)}, compiled from current sources. Please verify important details with the linked sources.</p>
        <div class="im-actions-slot" id="im-actions-slot"></div>
        <hr class="im-rule">
        <div class="im-brief im-brief-ov" id="im-brief">${genLoaderHTML(`Generating ${lens} overview…`)}</div>
      </section>
    </div>`;
  const prompt = `Give me a thorough "${lens}" overview of ${topicLabel} — be specific and current.`;
  (async () => {
    const t0 = Date.now();
    const briefEl = panelEl.querySelector('#im-brief');
    let sources = [];
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'shortcut', topic: d.topic, group: d.group }) });
      const data = res.ok ? await res.json() : null;
      await holdLoader(t0);
      if (panelEl.querySelector('#im-brief') !== briefEl) return;
      if (data && data.content) {
        // Overview sources may be a per-section map { name: [...] }; this modal
        // shows all sections together, so flatten to the de-duped union.
        const raw = data.sources || [];
        if (Array.isArray(raw)) sources = raw;
        else {
          const seen = new Set();
          sources = Object.values(raw).flat().filter((s) => s && s.uri && !seen.has(s.uri) && seen.add(s.uri));
        }
        const sections = splitSections(data.content);
        briefEl.innerHTML = sections.length
          ? sections.map((s, i) => `<details class="im-ovsec"${i === 0 ? ' open' : ''}><summary class="im-ovsec-sum"><span>${esc(s.name)}</span>${CHEV}</summary><div class="im-ovsec-body">${renderBriefBody(s.body, null, { aiFlag: SPARK_FILL })}</div></details>`).join('')
          : renderBriefBody(data.content, null, { aiFlag: SPARK_FILL });
        briefEl.classList.add('ai-reveal');
        wireOvsecScroll();
      } else { briefEl.innerHTML = '<p class="im-empty">Overview is being generated — check back shortly.</p>'; }
    } catch (_) { if (panelEl.querySelector('#im-brief') === briefEl) briefEl.innerHTML = '<p class="im-empty">Overview unavailable.</p>'; }
    // Sources + Explore sit ABOVE the section list (in the AI Brief area).
    const slot = panelEl.querySelector('#im-actions-slot');
    if (slot) {
      slot.innerHTML = actionsHTML();
      wireActions({ prompt, sources, origUrl: '', webTerm: topicLabel, onReview: () => window.dispatchEvent(new CustomEvent('open-prompt-modal', { detail: { basePrompt: prompt, name: lens + ' overview', count: 1 } })) });
    }
  })();
}
// When a section accordion opens, bring its header to the top of the scroll
// area so the just-revealed content starts where the eye is. Click-based (not
// 'toggle') so the default first-section-open never auto-scrolls on load.
function wireOvsecScroll() {
  panelEl.querySelectorAll('.im-ovsec').forEach((det) => {
    const sum = det.querySelector('.im-ovsec-sum');
    if (!sum) return;
    sum.addEventListener('click', () => { requestAnimationFrame(() => { if (det.open) scrollHeaderToTop(sum); }); });
  });
  const body = panelEl.querySelector('.im-body');
  if (body) body.scrollTop = 0;
}
