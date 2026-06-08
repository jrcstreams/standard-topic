// Unified AI-Insight modal. Opened via the `open-insight-modal` CustomEvent with
//   { type: 'news'|'trend'|'shortcut', ...payload }
// Renders a clean, centered modal (matching the search / topics modals) with the
// AI brief, sources, and "Explore further with AI". Supports modal-over-modal
// stacking: opening one from inside another keeps a "← Back to …" action.
import { renderBriefBody } from './newsfeed.js';
import { getModels } from '../utils/data.js';
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

const SPARK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>';
const CHEV = '<svg class="im-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

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
  panelEl.style.display = 'block';
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
    <div class="im-submit-row">
      <button type="button" class="im-submitbtn im-submitbtn-primary" data-act="direct">Direct Submit</button>
      <button type="button" class="im-submitbtn" data-act="review">Review Prompt</button>
    </div>
  </div>`;
}

// Wire the shared bottom actions + explore flow. `ctx` provides the prompt +
// review handler + sources.
function wireActions(ctx) {
  const explorePanel = panelEl.querySelector('#im-explore-panel');
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
        body && body.classList.add('is-open');
      }
    });
  });
  if (explorePanel) explorePanel.addEventListener('click', (e) => {
    const modelBtn = e.target.closest('.im-model');
    const back = e.target.closest('.im-back-step');
    const submit = e.target.closest('.im-submitbtn');
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
}

function render() {
  if (!current) return;
  if (current.type === 'news') renderNews(current);
  else if (current.type === 'trend') renderTrend(current);
  else renderNews(current);
  panelEl.querySelector('#im-close')?.addEventListener('click', close);
  panelEl.querySelector('#im-back')?.addEventListener('click', goBack);
  panelEl.scrollTop = 0;
}

// ---- News -----------------------------------------------------------------
function newsPromptFor(d) {
  return `Give me a thorough, accurate briefing on this news story — what happened, why it matters, background, a timeline, and the latest developments.\n\n"${d.title || ''}"${d.description ? `\n\n${d.description}` : ''}${d.url ? `\n\nSource: ${d.url}` : ''}`;
}
function renderNews(d) {
  const host = hostOf(d.url) || (d.source_name || '');
  const when = relTime(d.date);
  const sub = [
    host ? `<a class="im-source-link" href="${escAttr(d.url)}" target="_blank" rel="noopener noreferrer">${esc(host)} ${ARROW}</a>` : '',
    when ? `<span class="im-when">${esc(when)}</span>` : '',
  ].filter(Boolean).join('<span class="im-dot">·</span>');
  panelEl.innerHTML = `
    ${headerHTML('AI Insights', d.title || 'News story', sub)}
    <div class="im-body">
      <p class="im-disclaimer">AI-generated summary — verify important details with the linked sources.</p>
      ${d.description ? `<div class="im-rss"><span class="im-rss-label">From the source</span><p>${esc(d.description)}</p></div>` : ''}
      ${briefSkeleton()}
      ${actionsHTML(false)}
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
        briefEl.innerHTML = `<div class="im-brief-head">${SPARK}<span>AI Brief</span></div>${renderBriefBody(data.content, null)}`;
      } else { briefEl.innerHTML = '<p class="im-empty">AI brief unavailable right now.</p>'; }
    } catch (_) { if (panelEl.querySelector('#im-brief') === briefEl) briefEl.innerHTML = '<p class="im-empty">AI brief unavailable.</p>'; }
    // (Re)build the actions now that we know whether there are sources.
    const body = panelEl.querySelector('.im-body');
    if (body) {
      body.querySelector('.im-actions')?.remove();
      body.querySelectorAll('.im-acc').forEach(p => p.remove());
      body.insertAdjacentHTML('beforeend', actionsHTML(sources.length > 0));
      wireActions({ prompt, sources, onReview: () => window.dispatchEvent(new CustomEvent('open-prompt-modal', { detail: { basePrompt: prompt, topicName: d.title || '', name: 'AI Insight · News', count: 1 } })) });
    }
  })();
}

// ---- Trend (filled in next pass) -----------------------------------------
function renderTrend(d) {
  const cat = d.category || (Array.isArray(d.categories) ? d.categories[0] : '') || '';
  const since = relTime(d.startedAt);
  const sub = [cat, since ? `Trending since ${since}` : ''].filter(Boolean).join('<span class="im-dot">·</span>');
  const title = String(d.query || '').replace(/\b\w/g, c => c.toUpperCase());
  panelEl.innerHTML = `
    ${headerHTML('AI Insights · Trending', title, sub)}
    <div class="im-body">
      <p class="im-disclaimer">AI-generated summary — verify important details with the linked sources.</p>
      ${briefSkeleton()}
      ${actionsHTML(false)}
    </div>`;
  const prompt = `Explain what "${d.query}" is and why it's trending right now — what just happened, the background, and the latest developments.`;
  (async () => {
    const briefEl = panelEl.querySelector('#im-brief');
    let sources = [];
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'trend', query: d.query }) });
      const data = res.ok ? await res.json() : null;
      if (panelEl.querySelector('#im-brief') !== briefEl) return;
      if (data && data.content) {
        sources = data.sources || [];
        const summary = data.summary ? `<p class="im-trend-summary">${esc(data.summary)}</p>` : '';
        briefEl.innerHTML = `${summary}<div class="im-brief-head">${SPARK}<span>AI Brief</span></div>${renderBriefBody(data.content, null)}`;
      } else { briefEl.innerHTML = '<p class="im-empty">No AI brief generated for this trend yet.</p>'; }
    } catch (_) { if (panelEl.querySelector('#im-brief') === briefEl) briefEl.innerHTML = '<p class="im-empty">AI brief unavailable.</p>'; }
    const body = panelEl.querySelector('.im-body');
    if (body) {
      body.querySelector('.im-actions')?.remove();
      body.querySelectorAll('.im-acc').forEach(p => p.remove());
      body.insertAdjacentHTML('beforeend', actionsHTML(sources.length > 0));
      wireActions({ prompt, sources, onReview: () => window.dispatchEvent(new CustomEvent('open-prompt-modal', { detail: { basePrompt: prompt, topicName: d.query, name: 'Trending · AI', count: 1 } })) });
    }
  })();
}
