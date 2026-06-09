// Unified AI-Insight modal. Opened via the `open-insight-modal` CustomEvent with
//   { type: 'news'|'trend'|'shortcut', ...payload }
// Renders a clean, centered modal (matching the search / topics modals) with the
// AI brief, sources, and "Explore further with AI". Supports modal-over-modal
// stacking: opening one from inside another keeps a "← Back to …" action.
import { renderBriefBody } from './newsfeed.js?v=20260609-revamp35';
import { getModels, getExternalSearches, getExternalSearchCategories } from '../utils/data.js';
import { openModel, copyPrompt } from '../utils/ai-models.js';

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
  const update = () => {
    top.style.top = (head ? head.offsetHeight : 0) + 'px';
    const scrollable = body.scrollHeight > body.clientHeight + 2;
    top.classList.toggle('is-on', scrollable && body.scrollTop > 2);
    bot.classList.toggle('is-on', scrollable && body.scrollTop < body.scrollHeight - body.clientHeight - 2);
  };
  body.addEventListener('scroll', update, { passive: true });
  if (window.ResizeObserver) { const ro = new ResizeObserver(update); ro.observe(body); }
  if (window.MutationObserver) { const mo = new MutationObserver(update); mo.observe(body, { childList: true, subtree: true }); panelEl._imFadeMO = mo; }
  requestAnimationFrame(update); setTimeout(update, 400);
}
// Bring an accordion's header to the top of the scrollable body so the content
// that just expanded starts where the reader is looking (with a small offset).
function scrollHeaderToTop(el) {
  const body = panelEl && panelEl.querySelector('.im-body');
  if (!body || !el) return;
  // Let the expand layout settle first, then scroll the header near the top.
  requestAnimationFrame(() => {
    const delta = el.getBoundingClientRect().top - body.getBoundingClientRect().top - 10;
    if (Math.abs(delta) > 4) body.scrollTo({ top: body.scrollTop + delta, behavior: 'smooth' });
  });
}

const SPARK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>';
const CHEV = '<svg class="im-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
// Filled mark for the brand lockup — reads as a logo at larger size, vs the
// thin outline SPARK used for small inline labels.
const LOGO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.6l1.62 6.32a3 3 0 0 0 2.46 2.46L22.4 12l-6.32 1.62a3 3 0 0 0-2.46 2.46L12 22.4l-1.62-6.32a3 3 0 0 0-2.46-2.46L1.6 12l6.32-1.62a3 3 0 0 0 2.46-2.46z"/></svg>';
// Right chevron — "drill into this sub-level" affordance (Web Sources → category).
const CHEVR = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

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
function brandHeaderHTML() {
  const showBack = stack.length > 0;
  const backLabel = stack.length ? stack[stack.length - 1].label : '';
  return `<div class="im-head im-head--brand">
    <span class="im-brandlock"><span class="im-logo">${LOGO}</span><span class="im-brandname">AI Insights</span></span>
    <span class="im-head-actions">
      ${showBack ? `<button type="button" class="im-back" id="im-back"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>${esc(backLabel)}</button>` : ''}
      <button type="button" class="im-close" id="im-close" aria-label="Close"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg></button>
    </span>
  </div>`;
}

function briefSkeleton() {
  return '<div class="im-brief" id="im-brief"><div class="ai-result-body ai-result-loading">Generating AI brief…</div></div>';
}

// Bottom actions (Sources + Explore-further) — shared across types.
function actionsHTML(hasSources) {
  return `<div class="im-actions">
      ${hasSources ? `<button type="button" class="im-actbtn" data-panel="sources" aria-expanded="false"><span>Sources</span>${CHEV}</button>` : ''}
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

function exploreChooseHTML() {
  const models = getModels() || [];
  return `<div class="im-substep"><div class="im-subhead">Choose model</div><div class="im-model-list">${
    models.map(m => `<button type="button" class="im-model" data-model="${escAttr(m.id)}"><span class="im-model-name">${esc(m.name)}</span>${m.description ? `<span class="im-model-desc">${esc(m.description)}</span>` : ''}</button>`).join('')
  }</div></div>`;
}
function exploreSubmitHTML(model) {
  return `<div class="im-substep">
    <button type="button" class="im-back-step">← Models</button>
    <div class="im-subhead">Prompt submission · ${esc(model.name)}</div>
    <div class="im-model-list">
      <button type="button" class="im-model" data-act="direct"><span class="im-model-name">Direct Submit</span><span class="im-model-desc">Open ${esc(model.name)} with the prompt sent automatically.</span></button>
      <button type="button" class="im-model" data-act="review"><span class="im-model-name">Review Prompt</span><span class="im-model-desc">Preview and tweak the prompt before you send it.</span></button>
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
        if (name === 'explore' && explorePanel && !explorePanel.dataset.ready) { explorePanel.innerHTML = exploreChooseHTML(); explorePanel.dataset.ready = '1'; }
        if (name === 'websources' && wsPanel && !wsPanel.dataset.ready) { wsPanel.innerHTML = webSourcesCategoriesHTML(); wsPanel.dataset.ready = '1'; }
        body && body.classList.add('is-open');
        scrollHeaderToTop(btn);
      }
    });
  });
  if (explorePanel) explorePanel.addEventListener('click', (e) => {
    const modelBtn = e.target.closest('.im-model[data-model]');
    const submit = e.target.closest('.im-model[data-act]');
    const back = e.target.closest('.im-back-step');
    if (modelBtn) {
      e.stopPropagation();
      const model = (getModels() || []).find(m => m.id === modelBtn.dataset.model);
      if (!model) return;
      explorePanel.innerHTML = exploreSubmitHTML(model);
      explorePanel.dataset.model = model.id;
      copyPrompt(ctx.prompt);
    } else if (back) {
      e.stopPropagation();
      explorePanel.innerHTML = exploreChooseHTML();
      delete explorePanel.dataset.model;
    } else if (submit) {
      e.stopPropagation();
      const model = (getModels() || []).find(m => m.id === explorePanel.dataset.model);
      if (!model) return;
      if (submit.dataset.act === 'direct') openModel(model, ctx.prompt);
      else ctx.onReview();
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
    ${brandHeaderHTML()}
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
      </section>
    </div>`;
  const prompt = newsPromptFor(d);
  (async () => {
    const briefEl = panelEl.querySelector('#im-brief');
    let sources = [];
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'news', url: d.url || '', title: d.title || '', description: d.description || '', date: d.date || '' }) });
      const data = res.ok ? await res.json() : null;
      if (panelEl.querySelector('#im-brief') !== briefEl) return;
      if (data && data.content) {
        sources = data.sources || [];
        briefEl.innerHTML = renderBriefBody(data.content, null);
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
  const meta = [cat ? `<span>${esc(cat)}</span>` : '', since ? `<span class="im-when">Trending since ${esc(since)}</span>` : '']
    .filter(Boolean).join('<span class="im-dot">·</span>');
  panelEl.innerHTML = `
    ${brandHeaderHTML()}
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
    const briefEl = panelEl.querySelector('#im-brief');
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'trend', query: d.query }) });
      const data = res.ok ? await res.json() : null;
      if (panelEl.querySelector('#im-brief') !== briefEl) return;
      if (data && data.content) {
        const cleanSum = cleanSummary(data.summary);
        const summary = cleanSum ? `<p class="im-trend-summary">${esc(cleanSum)}</p>` : '';
        briefEl.innerHTML = `${summary}${renderBriefBody(cleanTrendContent(data.content), null)}`;
      } else { briefEl.innerHTML = '<p class="im-empty">No AI brief generated for this trend yet.</p>'; }
    } catch (_) { if (panelEl.querySelector('#im-brief') === briefEl) briefEl.innerHTML = '<p class="im-empty">AI brief unavailable.</p>'; }
  })();
}

// ---- AI Intelligence overview --------------------------------------------
function splitSections(content) {
  const text = String(content || '');
  const re = /^##\s+(.+)$/gm;
  const idx = []; let m;
  while ((m = re.exec(text))) idx.push({ name: m[1].trim(), start: m.index, headEnd: m.index + m[0].length });
  if (!idx.length) return [];
  return idx.map((s, i) => ({ name: s.name, body: text.slice(s.headEnd, i + 1 < idx.length ? idx[i + 1].start : text.length).trim() }));
}
function renderOverview(d) {
  const lens = d.label || 'AI';
  const topicLabel = d.scopeTopic || 'this topic';
  panelEl.innerHTML = `
    ${brandHeaderHTML()}
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
        <div class="im-brief im-brief-ov" id="im-brief"><div class="ai-result-body ai-result-loading">Loading ${esc(lens)} overview…</div></div>
      </section>
    </div>`;
  const prompt = `Give me a thorough "${lens}" overview of ${topicLabel} — be specific and current.`;
  (async () => {
    const briefEl = panelEl.querySelector('#im-brief');
    let sources = [];
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'shortcut', topic: d.topic, group: d.group }) });
      const data = res.ok ? await res.json() : null;
      if (panelEl.querySelector('#im-brief') !== briefEl) return;
      if (data && data.content) {
        sources = data.sources || [];
        const sections = splitSections(data.content);
        briefEl.innerHTML = sections.length
          ? sections.map((s, i) => `<details class="im-ovsec"${i === 0 ? ' open' : ''}><summary class="im-ovsec-sum"><span>${esc(s.name)}</span>${CHEV}</summary><div class="im-ovsec-body">${renderBriefBody(s.body, null)}</div></details>`).join('')
          : renderBriefBody(data.content, null);
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
