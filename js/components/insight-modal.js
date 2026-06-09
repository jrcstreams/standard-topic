// Unified AI-Insight modal. Opened via the `open-insight-modal` CustomEvent with
//   { type: 'news'|'trend'|'shortcut', ...payload }
// Renders a clean, centered modal (matching the search / topics modals) with the
// AI brief, sources, and "Explore further with AI". Supports modal-over-modal
// stacking: opening one from inside another keeps a "← Back to …" action.
import { renderBriefBody } from './newsfeed.js?v=20260609-revamp63';
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
  const update = () => {
    top.style.top = (head ? head.offsetHeight : 0) + 'px';
    const scrollable = body.scrollHeight > body.clientHeight + 2;
    top.classList.toggle('is-on', scrollable && body.scrollTop > 2);
    bot.classList.toggle('is-on', scrollable && body.scrollTop < body.scrollHeight - body.clientHeight - 2);
    // Condensed title bar: reveal once the overview card has scrolled out of view.
    if (article) panelEl.classList.toggle('is-scrolled', article.getBoundingClientRect().bottom < body.getBoundingClientRect().top + 6);
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
const ARROW = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>';
const CHEV = '<svg class="im-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
// Brand mark — a clean, flat 4-point sparkle (the same spark used inline),
// filled white on the navy tile. Simple and on-brand (no glossy facets).
const LOGO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg>';
// Right chevron — "drill into this sub-level" affordance (Web Sources → category).
const CHEVR = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
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
  overlayEl.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlayEl.style.display !== 'none') close(); });
}

function openFresh(entry) {
  if (!entry || !entry.type) return;
  stack = [];
  current = entry;
  render();
  overlayEl.style.display = 'block';
  panelEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function openStacked(entry, backLabel) {
  if (!entry) return;
  if (current) stack.push({ entry: current, label: backLabel || 'Back' });
  current = entry;
  render();
}
function goBack() {
  const prev = stack.pop();
  if (!prev) { close(); return; }
  current = prev.entry;
  render();
}
function close() {
  overlayEl.style.display = 'none';
  panelEl.style.display = 'none';
  document.body.style.overflow = '';
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
function brandHeaderHTML(condensed) {
  const showBack = stack.length > 0;
  const backLabel = stack.length ? stack[stack.length - 1].label : '';
  // condensed = { title, meta } — a compact title bar that fades in once the
  // overview card scrolls out of view, so the reader keeps context deep in a
  // long brief.
  const condMeta = condensed && (condensed.meta || condensed.url) ? `<span class="im-condensed-meta">${condensed.meta ? `<span class="im-condensed-pub">${esc(condensed.meta)}</span>` : ''}${condensed.url ? `<a class="im-condensed-link" href="${escAttr(condensed.url)}" target="_blank" rel="noopener noreferrer">View original ${ARROW}</a>` : ''}</span>` : '';
  const cond = condensed && condensed.title ? `<div class="im-condensed" aria-hidden="true">
      <span class="im-condensed-title">${esc(condensed.title)}</span>
      ${condMeta}
    </div>` : '';
  return `<div class="im-head im-head--brand">
    <div class="im-head-row">
      <span class="im-brandlock"><span class="im-logo">${LOGO}</span><span class="im-brandname">AI Insights</span></span>
      <span class="im-head-actions">
        ${showBack ? `<button type="button" class="im-back" id="im-back"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>${esc(backLabel)}</button>` : ''}
        <button type="button" class="im-close" id="im-close" aria-label="Close"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg></button>
      </span>
    </div>
    ${cond}
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

// Bottom actions (Sources + Explore-further) — shared across types.
function actionsHTML(hasSources) {
  return `<div class="im-actions">
      ${hasSources ? `<button type="button" class="im-actbtn" data-panel="sources" aria-expanded="false"><span>Web Sources</span>${CHEV}</button>` : ''}
      <button type="button" class="im-actbtn im-actbtn-primary" data-panel="explore" aria-expanded="false"><span>Explore further with AI</span>${CHEV}</button>
    </div>
    ${hasSources ? '<div class="im-acc" data-body="sources" id="im-sources-panel"></div>' : ''}
    <div class="im-acc" data-body="explore" id="im-explore-panel"></div>`;
}

function sourcesListHTML(sources) {
  const seen = new Set(); const rows = [];
  for (const s of (sources || [])) {
    const uri = s.uri || s.url || '';
    const label = (s.title && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.title)) ? s.title : (hostOf(uri) || s.title || 'source');
    const key = label.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(`<a class="im-source-row" href="${escAttr(uri)}" target="_blank" rel="noopener noreferrer"><span>${esc(label)}</span>${ARROW}</a>`);
  }
  return rows.length ? `<div class="im-source-list">${rows.join('')}</div>` : '<p class="im-empty">No sources cited.</p>';
}

// Trend actions: Web Sources (sub-layered) + Explore further with AI. Unlike
// news (which lists the brief's cited sources), trends offer external search
// platforms to dig into the term.
function trendActionsHTML() {
  return `<div class="im-actions">
      <button type="button" class="im-actbtn" data-panel="websources" aria-expanded="false"><span>Web Sources</span>${CHEV}</button>
      <button type="button" class="im-actbtn" data-panel="explore" aria-expanded="false"><span>Explore further with AI</span>${CHEV}</button>
    </div>
    <div class="im-acc" data-body="websources" id="im-websources-panel"></div>
    <div class="im-acc" data-body="explore" id="im-explore-panel"></div>`;
}
// Web Sources level 1 — pick a source type (Search & reference, Audio & video…).
function webSourcesCategoriesHTML() {
  const cats = getExternalSearchCategories() || [];
  const searches = getExternalSearches() || [];
  const avail = cats.filter((c) => searches.some((s) => s.category === c.key));
  if (!avail.length) return '<p class="im-empty">No web sources available.</p>';
  return `<div class="im-substep"><div class="im-subhead">Choose a source type</div><div class="im-wscat-list">${
    avail.map((c) => `<button type="button" class="im-wscat" data-cat="${escAttr(c.key)}"><span>${esc(c.label)}</span>${CHEVR}</button>`).join('')
  }</div></div>`;
}
// Web Sources level 2 — the platforms in the chosen category, term substituted.
function webSourcesListHTML(catKey, term) {
  const cat = (getExternalSearchCategories() || []).find((c) => c.key === catKey);
  const items = (getExternalSearches() || []).filter((s) => s.category === catKey);
  const rows = items.map((s) => {
    const url = String(s.urlTemplate || '').replace(/\{query\}/g, encodeURIComponent(term || ''));
    return `<a class="im-source-row" href="${escAttr(url)}" target="_blank" rel="noopener noreferrer"><span class="im-source-row-text"><span class="im-source-name">${esc(s.name)}</span>${s.description ? `<span class="im-source-desc">${esc(s.description)}</span>` : ''}</span>${ARROW}</a>`;
  }).join('');
  return `<div class="im-substep">
    <button type="button" class="im-back-step im-wsback">← Source types</button>
    <div class="im-subhead">${esc(cat ? cat.label : 'Web Sources')}</div>
    <div class="im-source-list">${rows || '<p class="im-empty">No sources here.</p>'}</div>
  </div>`;
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
  const wsPanel = panelEl.querySelector('#im-websources-panel');
  panelEl.querySelectorAll('.im-actbtn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.dataset.panel;
      const body = panelEl.querySelector(`[data-body="${name}"]`);
      const willOpen = btn.getAttribute('aria-expanded') !== 'true';
      panelEl.querySelectorAll('.im-actbtn').forEach(b => b.setAttribute('aria-expanded', 'false'));
      panelEl.querySelectorAll('.im-acc').forEach(p => p.classList.remove('is-open'));
      if (willOpen) {
        btn.setAttribute('aria-expanded', 'true');
        if (name === 'sources' && body && !body.dataset.ready) { body.innerHTML = sourcesListHTML(ctx.sources); body.dataset.ready = '1'; }
        if (name === 'explore' && explorePanel && !explorePanel.dataset.ready) { explorePanel.innerHTML = exploreHomeHTML(); explorePanel.dataset.ready = '1'; }
        if (name === 'websources' && wsPanel && !wsPanel.dataset.ready) { wsPanel.innerHTML = webSourcesCategoriesHTML(); wsPanel.dataset.ready = '1'; }
        body && body.classList.add('is-open');
        scrollHeaderToTop(btn);
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
  // Web Sources two-level sub-nav: category → its platforms → back.
  if (wsPanel) wsPanel.addEventListener('click', (e) => {
    const catBtn = e.target.closest('.im-wscat');
    const back = e.target.closest('.im-wsback');
    if (catBtn) {
      e.stopPropagation();
      wsPanel.innerHTML = webSourcesListHTML(catBtn.dataset.cat, ctx.webTerm || '');
    } else if (back) {
      e.stopPropagation();
      wsPanel.innerHTML = webSourcesCategoriesHTML();
    }
  });
}

function render() {
  if (!current) return;
  if (current.type === 'news') renderNews(current);
  else if (current.type === 'trend') renderTrend(current);
  else if (current.type === 'overview') renderOverview(current);
  else renderNews(current);
  panelEl.querySelector('#im-close')?.addEventListener('click', close);
  panelEl.querySelector('#im-back')?.addEventListener('click', goBack);
  panelEl.scrollTop = 0;
  setupModalFades();
}

// ---- News -----------------------------------------------------------------
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
    ${brandHeaderHTML({ title: d.title || 'News story', meta: host, url: d.url || '' })}
    <div class="im-body">
      <section class="im-section im-article">
        <div class="im-section-title">Article Overview</div>
        <h3 class="im-article-title">${esc(d.title || 'News story')}</h3>
        ${meta ? `<div class="im-article-meta">${meta}</div>` : ''}
        ${d.description ? `<p class="im-article-summary">${esc(d.description)}</p>` : ''}
        ${d.url ? `<a class="im-orig-link" href="${escAttr(d.url)}" target="_blank" rel="noopener noreferrer">View original article ${ARROW}</a>` : ''}
      </section>
      <section class="im-section im-brief-section">
        <div class="im-section-title im-section-title--brief">${SPARK}<span>AI Brief</span></div>
        <p class="im-disclaimer">The below is an AI-generated summary of the topic at hand from this article. Please verify important details with the linked sources.</p>
        <div class="im-actions-slot" id="im-actions-slot"></div>
        <hr class="im-rule">
        ${briefSkeleton()}
        ${d.url ? `<a class="im-brief-source" href="${escAttr(d.url)}" target="_blank" rel="noopener noreferrer">View original article ${ARROW}</a>` : ''}
      </section>
    </div>`;
  const prompt = newsPromptFor(d);
  (async () => {
    const t0 = Date.now();
    const briefEl = panelEl.querySelector('#im-brief');
    let sources = [];
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'news', url: d.url || '', title: d.title || '', description: d.description || '', date: d.date || '' }) });
      const data = res.ok ? await res.json() : null;
      await holdLoader(t0);
      if (panelEl.querySelector('#im-brief') !== briefEl) return;
      if (data && data.content) {
        sources = data.sources || [];
        briefEl.innerHTML = renderBriefBody(data.content, null); briefEl.classList.add('ai-reveal');
      } else { briefEl.innerHTML = '<p class="im-empty">AI brief unavailable right now.</p>'; }
    } catch (_) { if (panelEl.querySelector('#im-brief') === briefEl) briefEl.innerHTML = '<p class="im-empty">AI brief unavailable.</p>'; }
    // Mount the actions (Sources + Explore) inside the AI Brief header area —
    // below the disclaimer, above the brief content — now that we know whether
    // there are sources to show.
    const slot = panelEl.querySelector('#im-actions-slot');
    if (slot) {
      slot.innerHTML = actionsHTML(sources.length > 0);
      wireActions({ prompt, sources, onReview: () => window.dispatchEvent(new CustomEvent('open-prompt-modal', { detail: { basePrompt: prompt, topicName: d.title || '', name: 'AI Insight · News', count: 1 } })) });
    }
  })();
}

// ---- Trend ----------------------------------------------------------------
function renderTrend(d) {
  const cat = d.category || (Array.isArray(d.categories) ? d.categories[0] : '') || '';
  const since = relTime(d.startedAt);
  const title = String(d.query || '').replace(/\b\w/g, c => c.toUpperCase());
  const meta = [cat ? `<span class="im-cat-pill">${esc(cat)}</span>` : '', since ? `<span class="im-when">Trending since ${esc(since)}</span>` : '']
    .filter(Boolean).join('');
  panelEl.innerHTML = `
    ${brandHeaderHTML({ title, meta: [cat, since ? `Trending since ${since}` : ''].filter(Boolean).join(' · ') })}
    <div class="im-body">
      <section class="im-section im-article">
        <div class="im-section-title">Trend Overview</div>
        <h3 class="im-article-title">${esc(title)}</h3>
        ${meta ? `<div class="im-article-meta">${meta}</div>` : ''}
      </section>
      <section class="im-section im-brief-section">
        <div class="im-section-title im-section-title--brief">${SPARK}<span>AI Brief</span></div>
        <p class="im-disclaimer">The below is an AI-generated summary of why this is trending. Please verify important details with the linked sources.</p>
        <div class="im-actions-slot" id="im-actions-slot">${trendActionsHTML()}</div>
        <hr class="im-rule">
        ${briefSkeleton()}
      </section>
    </div>`;
  const prompt = `Explain what "${d.query}" is and why it's trending right now — what just happened, the background, and the latest developments.`;
  // Web Sources + Explore don't depend on the brief, so wire them immediately.
  wireActions({ prompt, webTerm: d.query, sources: [], onReview: () => window.dispatchEvent(new CustomEvent('open-prompt-modal', { detail: { basePrompt: prompt, topicName: d.query, name: 'Trending · AI', count: 1 } })) });
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
        const summary = cleanSum ? `<p class="im-trend-summary">${esc(cleanSum)}</p>` : '';
        briefEl.innerHTML = `${summary}${renderBriefBody(cleanTrendContent(data.content), null)}`; briefEl.classList.add('ai-reveal');
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
    const name = m[1].replace(/\*\*/g, '').replace(/[:#\s]+$/, '').trim();
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
        <div class="im-section-title im-section-title--brief">${SPARK}<span>AI Brief</span></div>
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
        sources = data.sources || [];
        const sections = splitSections(data.content);
        briefEl.innerHTML = sections.length
          ? sections.map((s, i) => `<details class="im-ovsec"${i === 0 ? ' open' : ''}><summary class="im-ovsec-sum"><span>${esc(s.name)}</span>${CHEV}</summary><div class="im-ovsec-body">${renderBriefBody(s.body, null)}</div></details>`).join('')
          : renderBriefBody(data.content, null);
        briefEl.classList.add('ai-reveal');
        wireOvsecScroll();
      } else { briefEl.innerHTML = '<p class="im-empty">Overview is being generated — check back shortly.</p>'; }
    } catch (_) { if (panelEl.querySelector('#im-brief') === briefEl) briefEl.innerHTML = '<p class="im-empty">Overview unavailable.</p>'; }
    // Sources + Explore sit ABOVE the section list (in the AI Brief area).
    const slot = panelEl.querySelector('#im-actions-slot');
    if (slot) {
      slot.innerHTML = actionsHTML(sources.length > 0);
      wireActions({ prompt, sources, onReview: () => window.dispatchEvent(new CustomEvent('open-prompt-modal', { detail: { basePrompt: prompt, name: lens + ' overview', count: 1 } })) });
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
