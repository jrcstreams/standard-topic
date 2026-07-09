// Unified AI-Insight modal. Opened via the `open-insight-modal` CustomEvent with
//   { type: 'news'|'trend'|'shortcut', ...payload }
// Renders a clean, centered modal (matching the search / topics modals) with the
// AI brief, sources, and "Explore further with AI". Supports modal-over-modal
// stacking: opening one from inside another keeps a "← Back to …" action.
import { renderBriefBody, resolveSource } from './newsfeed.js?v=20260706-revamp532';
import { aiProvenanceHTML } from '../utils/ai-provenance.js?v=20260706-revamp532';
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
  // New unified layout owns its own sticky header + scroll behavior — the old
  // top/bottom fade overlays + condensed-reveal toggles conflict (scroll glitch).
  if (panelEl.querySelector('.im-stickyhead')) return;
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
// Small left/right chevrons for the discreet Back / Prev / Next head links.
const HNAV_L = '<svg class="im-headnav-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const HNAV_R = '<svg class="im-headnav-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
// Section-icon badge for "Sources & Coverage" — matches the brief section glyphs
// (link icon = related links/sources).
const SOURCES_BADGE = '<span class="ai-result-sub-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>';
// Action-link icons — Ask AI (sparkle) + Web Search (magnifier); Google Trends
// keeps its external ↗ (ARROW). Small inline marks before each label (#213).
const ICON_ASK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.6 4.6a2 2 0 0 0 1.3 1.3L19.5 10l-4.6 1.6a2 2 0 0 0-1.3 1.3L12 17l-1.6-4.6a2 2 0 0 0-1.3-1.3L4.5 10l4.6-1.6a2 2 0 0 0 1.3-1.3z"/></svg>';
const ICON_WEB = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
const ICON_GLOBE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/></svg>';
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
// Sleek single-line nav row (#trending): Back (to the originating list / stacked
// parent) on the left + clean Prev/Next buttons on the right — no item names, no
// bulky cards. Replaces the header "Back to …" + the big prev/next bar.
function navRowHTML(nav) {
  const stackBack = stack.length ? stack[stack.length - 1].label : '';
  const backLabel = stackBack || (nav && nav.backLabel ? `Back to ${nav.backLabel}` : '');
  const hasList = nav && Array.isArray(nav.list) && nav.list.length > 1;
  const hasPrev = hasList && nav.index > 0;
  const hasNext = hasList && nav.index < nav.list.length - 1;
  if (!backLabel && !hasList) return '';
  const kind = (nav && nav.itemKind) ? nav.itemKind : 'item';
  const CL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  const CR = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  const back = backLabel
    ? `<button type="button" class="im-navrow-back" id="im-back">${CL}<span>${esc(backLabel)}</span></button>`
    : '<span aria-hidden="true"></span>';
  const pn = hasList ? `<div class="im-navrow-pn">
      <button type="button" class="im-navrow-btn" data-navdir="prev"${hasPrev ? '' : ' disabled'} aria-label="Previous ${esc(kind)}">${CL}<span>Prev</span></button>
      <button type="button" class="im-navrow-btn" data-navdir="next"${hasNext ? '' : ' disabled'} aria-label="Next ${esc(kind)}"><span>Next</span>${CR}</button>
    </div>` : '';
  return `<div class="im-navrow">${back}${pn}</div>`;
}
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
// ===== New unified insight layout (Trending / News / AI Insights) ==========
// The whole header is ONE sticky grey zone: discreet Back / Prev / Next text
// links on top, then the item title (shrinks on scroll) + meta + action links,
// then the AI Brief subnav (title · pills · a discreet AI-generated notice).
function stickyHeadHTML({ title, metaLine, actions, nav, accHTML }) {
  const hasList = nav && Array.isArray(nav.list) && nav.list.length > 1;
  // The ‹ arrow carries the "go back" sense, so the label is just the destination
  // ("All Trending"), not "Back to All Trending".
  const backLabel = nav && nav.backLabel ? nav.backLabel : '';
  const hasPrev = hasList && nav.index > 0, hasNext = hasList && nav.index < nav.list.length - 1;
  const k = (nav && nav.itemKind) || 'item';
  const kind = k.charAt(0).toUpperCase() + k.slice(1);
  const controls = (backLabel || hasList) ? `<div class="im-headnav">
      ${backLabel ? `<button type="button" class="im-headnav-link im-headnav-back" id="im-back">${HNAV_L}${esc(backLabel)}</button>` : '<span aria-hidden="true"></span>'}
      ${hasList ? `<span class="im-headnav-pn">
        <button type="button" class="im-headnav-link" data-navdir="prev"${hasPrev ? '' : ' disabled'}>${HNAV_L}Previous ${esc(kind)}</button>
        <button type="button" class="im-headnav-link" data-navdir="next"${hasNext ? '' : ' disabled'}>Next ${esc(kind)}${HNAV_R}</button>
      </span>` : ''}
    </div>` : '';
  return `<div class="im-stickyhead" id="im-stickyhead">
    ${controls}
    <div class="im-overhead">
      ${metaLine ? `<div class="im-over-eyebrow">${metaLine}</div>` : ''}
      <h2 class="im-over-title" id="im-over-title">${esc(title)}</h2>
      ${actions ? `<div class="im-over-links">${actions}</div>` : ''}
      ${accHTML || ''}
    </div>
  </div>`;
}
// One in-page section with an anchor + name (drives the subnav pills + scroll-spy).
function msecHTML(id, name, innerHTML, empty) {
  return `<section class="im-msec${empty ? ' is-empty' : ''}" id="${id}" data-name="${escAttr(name)}">${innerHTML}</section>`;
}
// Smoothly scroll a horizontally-overflowing pill rail so the pill for `secId`
// is centered (no-op when nothing overflows). Used by the scroll-spy so the
// active section's pill is always visible even when it's cut off the edge.
function centerPill(railEl, secId) {
  const pill = railEl.querySelector(`.im-pill[data-pill="${secId}"]`);
  if (!pill) return;
  const c = railEl.getBoundingClientRect(), p = pill.getBoundingClientRect();
  const target = railEl.scrollLeft + (p.left - c.left) - (c.width - p.width) / 2;
  railEl.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
}
// (Re)build the AI Brief subnav pills from the non-empty sections, wire click-to-
// scroll (offset by the sticky header), and start the scroll-spy that highlights
// the section currently under the header.
let _imScrollHandler = null;
function buildBriefNav() {
  const pillsEl = panelEl.querySelector('#im-briefnav-pills');
  const body = panelEl.querySelector('.im-body');
  const head = panelEl.querySelector('#im-stickyhead');
  if (!pillsEl || !body) return;
  const secs = () => [...panelEl.querySelectorAll('.im-msec')].filter((s) => !s.classList.contains('is-empty'));
  const list = secs();
  pillsEl.innerHTML = list.map((s) => `<button type="button" class="im-pill" data-pill="${s.id}">${esc(s.dataset.name || '')}</button>`).join('');
  pillsEl.querySelectorAll('.im-pill').forEach((p) => p.addEventListener('click', () => {
    const sec = document.getElementById(p.dataset.pill); if (!sec) return;
    const off = (head ? head.offsetHeight : 0) + 10;
    const target = body.scrollTop + (sec.getBoundingClientRect().top - body.getBoundingClientRect().top) - off;
    body.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }));
  let lastActive = null;
  const update = () => {
    const limit = (head ? head.offsetHeight : 0) + body.getBoundingClientRect().top + 14;
    const ls = secs(); let active = ls[0];
    for (const s of ls) { if (s.getBoundingClientRect().top <= limit) active = s; }
    if (!active) return;
    // At the very bottom, the last section is active even if it's too short to
    // reach the header threshold (otherwise Sources never highlights).
    if (body.scrollHeight > body.clientHeight + 8 && body.scrollTop + body.clientHeight >= body.scrollHeight - 4) active = ls[ls.length - 1];
    pillsEl.querySelectorAll('.im-pill').forEach((p) => p.classList.toggle('is-active', p.dataset.pill === active.id));
    // Keep the active pill in view: when the section under the header changes,
    // smoothly scroll the (overflowing) pill rail so the active pill is centered.
    if (active.id !== lastActive) { lastActive = active.id; centerPill(pillsEl, active.id); }
  };
  if (_imScrollHandler) body.removeEventListener('scroll', _imScrollHandler);
  let raf = 0;
  _imScrollHandler = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; update(); }); };
  body.addEventListener('scroll', _imScrollHandler, { passive: true });
  update();
}
// Consistent section header (icon chip + name) for every in-page section, so
// Related Searches / Why Trending / Summary / Sources & Coverage all match.
const SEC_ICON = {
  related: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  why: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>',
  summary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="7" y1="12" x2="14" y2="12"/><line x1="7" y1="16" x2="11" y2="16"/></svg>',
  takeaways: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  matters: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>',
  timeline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
  sources: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
};
function secHeadHTML(key, name) {
  // Per-section "AI Generated Text" tag (own line, left-aligned) carries provenance
  // now that the single "AI Brief" label is gone (#183/#184) — consistent with the
  // AI Insights modal. Skipped on Sources + Related (not generated prose).
  const tag = (key === 'sources' || key === 'related') ? '' : `<div class="im-sec-aitag-row"><span class="im-sec-aitag">${SPARK}<span>AI Generated Text</span></span></div>`;
  return `<div class="im-msec-head"><span class="im-msec-ic">${SEC_ICON[key] || SEC_ICON.summary}</span><h3 class="im-msec-name">${esc(name)}</h3></div>${tag}`;
}

// Brief failure state with a Try-again button (#2). The AI brief is generated
// on demand, so an "unavailable" is almost always a transient API error or a
// momentary daily-grounding-cap blip — a retry usually succeeds. `retry` re-runs
// the same loader (which resets the skeleton first).
function failBriefHTML(msg) {
  return `<div class="im-empty im-brief-fail"><p>${esc(msg || 'AI brief unavailable right now.')}</p><button type="button" class="im-brief-retry">Try again</button></div>`;
}
function wireBriefRetry(secsBody, retry) {
  secsBody.querySelector('.im-brief-retry')?.addEventListener('click', retry);
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
  // Fallback: no rich related coverage (common on single news stories) — list the
  // AI's cited grounding sources so the brief always shows where it came from.
  if (!rows.length) {
    for (const s of (Array.isArray(sources) ? sources : [])) {
      if (rows.length >= 10) break;
      const uri = (s && (s.url || s.uri)) || (typeof s === 'string' ? s : ''); if (!uri) continue;
      const k = uri.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
      let host = ''; try { host = new URL(uri).hostname.replace(/^www\./i, ''); } catch (_) {}
      const title = String((s && s.title) || '').trim();
      const label = (title && !/^https?:/i.test(title)) ? title : host;
      if (!label) continue;
      rows.push(coverageRow(uri, label, (title && host && title !== host) ? [host] : []));
    }
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
  const showBack = !opts.hideBack && (stack.length > 0 || !!(nav && nav.backLabel));
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
  const TRIGGERS = '.im-actbtn, .im-qlink-btn, .im-cond-act, .im-ef-trigger';
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
  { keys: ['key takeaways', 'key takeaway', 'key points'], label: 'Takeaways' },
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
// Map a news brief section name to one of the shared section icons (SEC_ICON).
function newsSecIcon(name) {
  const n = String(name || '').toLowerCase();
  if (/what happened/.test(n)) return 'summary';
  if (/takeaway|key point/.test(n)) return 'takeaways';
  if (/matters|background/.test(n)) return 'matters';
  if (/timeline/.test(n)) return 'timeline';
  return 'summary';
}
function renderNews(d) {
  const host = hostOf(d.url) || (d.source_name || '');
  const when = relTime(d.date);
  const title = d.title || 'News story';
  // Eyebrow ABOVE the title — publisher chip + when (matches the Trending layout).
  const metaLine = `${host ? `<span class="im-eyebrow-cat">${esc(host)}</span>` : ''}${when ? `<span class="im-eyebrow-time">${esc(when)}</span>` : ''}`;
  // Action links — View Original (real link) + Ask AI + Web Search (icon dropdowns).
  const actions = [
    d.url ? `<a class="im-qlink" href="${escAttr(d.url)}" target="_blank" rel="noopener noreferrer"><span>View Original</span>${ARROW}</a>` : '',
    `<button type="button" class="im-qlink im-qlink-btn" data-panel="explore" aria-expanded="false">${ICON_ASK}<span>Ask AI</span>${CHEV}</button>`,
    `<button type="button" class="im-qlink im-qlink-btn" data-panel="web" aria-expanded="false">${ICON_GLOBE}<span>Web Search</span>${CHEV}</button>`,
  ].filter(Boolean).join('');
  panelEl.innerHTML = `
    ${brandHeaderHTML(null, { brandLabel: 'News Insights', icon: NEWS_FEED_ICON, hideBack: true })}
    <div class="im-body">
      ${stickyHeadHTML({ title, metaLine, actions, nav: d.nav, accHTML: `
        <div class="im-acc" data-body="explore" id="im-explore-panel"></div>
        <div class="im-acc" data-body="web" id="im-web-panel"></div>` })}
      <div class="im-secs">
        <div id="im-secs-body">${msecHTML('msec-brief', 'Brief', briefSkeleton())}</div>
      </div>
    </div>`;
  const prompt = newsPromptFor(d);
  const ctx = { prompt, sources: [], headlines: [], origUrl: d.url || '', webTerm: d.title || '', onReview: () => window.dispatchEvent(new CustomEvent('open-prompt-modal', { detail: { basePrompt: prompt, topicName: d.title || '', name: 'AI Insight · News', count: 1 } })) };
  wireActions(ctx);
  buildBriefNav();
  const loadNewsBrief = () => {
    const secsBody = panelEl.querySelector('#im-secs-body');
    if (!secsBody) return;
    secsBody.classList.remove('ai-reveal');
    secsBody.innerHTML = msecHTML('msec-brief', 'Brief', briefSkeleton());
    const t0 = Date.now();
    (async () => {
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'news', url: d.url || '', title: d.title || '', description: d.description || '', date: d.date || '' }) });
      const data = res.ok ? await res.json() : null;
      await holdLoader(t0);
      if (panelEl.querySelector('#im-secs-body') !== secsBody) return;
      if (data && data.content) {
        ctx.sources = data.sources || [];
        ctx.headlines = Array.isArray(data.headlines) ? data.headlines : [];
        // Split the brief into named sections (What Happened / Key Takeaways /
        // Why It Matters / Timeline) and render each as a scroll-spy section with
        // an icon head + the AI sparkle on its first sentence (flagFirst).
        const sections = splitSections(normalizeNewsBrief(data.content));
        const secHTML = sections.length
          ? sections.map((s, i) => {
              const key = newsSecIcon(s.name);
              return msecHTML(`msec-news-${i}`, s.name, secHeadHTML(key, s.name) + renderBriefBody(s.body, null));
            }).join('')
          : msecHTML('msec-brief', 'Brief', secHeadHTML('summary', 'Brief') + renderBriefBody(data.content, null));
        const cov = coverageListHTML(ctx.headlines, ctx.sources, ctx.origUrl);
        const covSec = cov ? msecHTML('msec-sources', 'Sources', secHeadHTML('sources', 'Sources') + `<div class="im-coverage-list">${cov}</div>`) : '';
        // All sections in ONE container so :last-child (no border) is the true last.
        secsBody.innerHTML = secHTML + covSec; secsBody.classList.add('ai-reveal');
        buildBriefNav();
      } else { secsBody.innerHTML = failBriefHTML('AI brief unavailable right now.'); wireBriefRetry(secsBody, loadNewsBrief); }
    } catch (_) { if (panelEl.querySelector('#im-secs-body') === secsBody) { secsBody.innerHTML = failBriefHTML('AI brief unavailable right now.'); wireBriefRetry(secsBody, loadNewsBrief); } }
    })();
  };
  loadNewsBrief();
}

// "Sources & Coverage" under a trend brief — the SAME rich rows (headline +
// publisher · date) the news modal uses, so trends match (#114). Rich coverage
// only (no bare grounding domains); the cited publishers stay in the "Sources:"
// line above. Hidden when we have no related coverage.
function inTheNewsHTML(sources, headlines) {
  const rows = coverageListHTML(headlines, sources, '');
  if (!rows) return '';
  return `<div class="im-coverage im-coverage--inline" id="im-coverage"><div class="im-section-title im-section-title--icon">${SOURCES_BADGE}<span>Sources</span></div><div class="im-coverage-list">${rows}</div></div>`;
}

// Related searches — show a tidy first row, collapse the rest behind a "+N more"
// toggle, and truncate any one over-long term to a single ellipsised line (the
// full term stays in the tooltip + drill-in). Keeps the card from ballooning
// when Google hands us a dozen verbose related queries (#155).
const REL_VISIBLE = 6;
const REL_MAX = 16;
function relatedSearchesHTML(breakdown) {
  const terms = (Array.isArray(breakdown) ? breakdown : [])
    .map((s) => String(s || '').trim()).filter(Boolean).slice(0, REL_MAX);
  if (!terms.length) return '';
  const hidden = Math.max(0, terms.length - REL_VISIBLE);
  const chips = terms.map((r, i) =>
    `<button type="button" class="im-related-chip${i >= REL_VISIBLE ? ' is-extra' : ''}" data-term="${escAttr(r)}" title="${escAttr(r)}"><span class="im-related-chip-tx">${esc(r)}</span></button>`).join('');
  const more = hidden ? `<button type="button" class="im-related-more" data-rel-more aria-expanded="false">+${hidden} more</button>` : '';
  return `<div class="im-related">
    <span class="im-related-label">Related searches</span>
    <div class="im-related-chips">${chips}${more}</div>
  </div>`;
}

// ---- Trend ----------------------------------------------------------------
function renderTrend(d) {
  const cat = d.category || (Array.isArray(d.categories) ? d.categories[0] : '') || '';
  const since = relTime(d.startedAt);
  const title = String(d.query || '').replace(/\b\w/g, c => c.toUpperCase());
  const gtUrl = `https://trends.google.com/trends/explore?q=${encodeURIComponent(d.query || '')}&geo=US`;
  // Google Trends is no longer a loud action link — it's the dateline itself:
  // "Trending since X" links out to the Google Trends explore page (discreet ↗).
  const timeHTML = since
    ? `<a class="im-eyebrow-time im-eyebrow-time--link" href="${escAttr(gtUrl)}" target="_blank" rel="noopener noreferrer" title="View on Google Trends">Trending since ${esc(since)}${ARROW}</a>`
    : '';
  const metaLine = `${cat ? `<span class="im-eyebrow-cat">${esc(cat)}</span>` : ''}${timeHTML}`;
  // Related Searches is now its own brief section (Summary → Related → Sources),
  // not a header dropdown.
  const relBody = (Array.isArray(d.trendBreakdown) && d.trendBreakdown.length) ? relatedSearchesHTML(d.trendBreakdown) : '';
  // Ask AI / Web Search are no longer header buttons — they live in an "Explore
  // Further" section below Related Searches as two accordions (#186).
  panelEl.innerHTML = `
    ${brandHeaderHTML(null, { brandLabel: 'Trending Insights', hideBack: true })}
    <div class="im-body">
      ${stickyHeadHTML({ title, metaLine, actions: '', nav: d.nav })}
      <div class="im-secs">
        <div id="im-secs-body">${msecHTML('msec-brief', 'Summary', briefSkeleton())}</div>
      </div>
    </div>`;
  const prompt = `Explain what "${d.query}" is and why it's trending right now — what just happened, the background, and the latest developments.`;
  const ctx = { prompt, sources: [], origUrl: '', webTerm: d.query, onReview: () => window.dispatchEvent(new CustomEvent('open-prompt-modal', { detail: { basePrompt: prompt, topicName: d.query, name: 'Trending · AI', count: 1 } })) };
  wireActions(ctx);
  buildBriefNav();
  const loadTrendBrief = () => {
    const secsBody = panelEl.querySelector('#im-secs-body');
    if (!secsBody) return;
    secsBody.classList.remove('ai-reveal');
    secsBody.innerHTML = msecHTML('msec-brief', 'Summary', briefSkeleton());
    const t0 = Date.now();
    (async () => {
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'trend', query: d.query }) });
      const data = res.ok ? await res.json() : null;
      await holdLoader(t0);
      if (panelEl.querySelector('#im-secs-body') !== secsBody) return;
      if (data && data.content) {
        const cleanSum = cleanSummary(data.summary);
        let detail = cleanTrendContent(data.content);
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
        // ONE "Summary" section — the reasoning one-liner (already shown on the
        // trend card) is folded away; the grounded detail IS the summary.
        const summaryBody = detail || cleanSum;
        const sum = summaryBody ? msecHTML('msec-summary', 'Summary', secHeadHTML('summary', 'Summary') + renderBriefBody(summaryBody, null)) : '';
        // Related Searches sits between Summary and Sources.
        const relatedSec = relBody ? msecHTML('msec-related', 'Related Searches', secHeadHTML('related', 'Related Searches') + relBody) : '';
        const cov = coverageListHTML(data.headlines, data.sources, '');
        const covSec = cov ? msecHTML('msec-sources', 'Sources', secHeadHTML('sources', 'Sources') + `<div class="im-coverage-list">${cov}</div>`) : '';
        // "Explore Further" (#186): Ask AI → "External AI Model Insights" + "Web
        // Search" as two in-section accordions, below Related Searches.
        const exploreFurther = `<section class="im-msec im-ef-sec" id="msec-explore" data-name="Explore Further">
          <div class="im-msec-head"><span class="im-msec-ic">${SEC_ICON.matters}</span><h3 class="im-msec-name">Explore Further</h3></div>
          <div class="im-ef">
            <div class="im-ef-acc">
              <button type="button" class="im-ef-trigger" data-panel="explore" aria-expanded="false"><span class="im-ef-trigger-ic">${ICON_ASK}</span><span class="im-ef-trigger-tx">External AI Model Insights</span><span class="im-ef-chev">${CHEV}</span></button>
              <div class="im-acc" data-body="explore" id="im-explore-panel"></div>
            </div>
            <div class="im-ef-acc">
              <button type="button" class="im-ef-trigger" data-panel="web" aria-expanded="false"><span class="im-ef-trigger-ic">${ICON_GLOBE}</span><span class="im-ef-trigger-tx">Web Search</span><span class="im-ef-chev">${CHEV}</span></button>
              <div class="im-acc" data-body="web" id="im-web-panel"></div>
            </div>
          </div>
        </section>`;
        // All sections in ONE container so :last-child (no border) is the true last.
        secsBody.innerHTML = sum + relatedSec + exploreFurther + covSec; secsBody.classList.add('ai-reveal');
        wireRelatedChips(title);
        wireActions(ctx);   // re-wire the relocated Explore-Further accordions + panels
        buildBriefNav();
      } else { secsBody.innerHTML = failBriefHTML('No AI brief generated for this trend yet.'); wireBriefRetry(secsBody, loadTrendBrief); }
    } catch (_) { if (panelEl.querySelector('#im-secs-body') === secsBody) { secsBody.innerHTML = failBriefHTML('AI brief unavailable right now.'); wireBriefRetry(secsBody, loadTrendBrief); } }
    })();
  };
  loadTrendBrief();
}
// Related-search chips drill into that term as a new (stacked) trend page; the
// "+N more" toggle reveals the collapsed chips.
function wireRelatedChips(title) {
  panelEl.querySelectorAll('.im-related-chip').forEach((chip) => {
    chip.addEventListener('click', () => { const t = chip.dataset.term; if (t) openStacked({ type: 'trend', query: t }, `Back to ${title}`); });
  });
  const relMore = panelEl.querySelector('[data-rel-more]');
  if (relMore) {
    const hiddenCount = panelEl.querySelectorAll('.im-related-chip.is-extra').length;
    relMore.addEventListener('click', () => {
      const wrap = relMore.closest('.im-related-chips');
      const expanded = wrap.classList.toggle('is-expanded');
      relMore.setAttribute('aria-expanded', String(expanded));
      relMore.textContent = expanded ? 'Show less' : `+${hiddenCount} more`;
    });
  }
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
