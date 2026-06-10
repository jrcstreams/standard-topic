// Living "AI Intelligence" component. A self-contained block that navigates in
// place: paths grid → that path's section menu → a section's AI analysis, with
// a back stack and slide transitions. Each path = a shortcut `group`
// (discover→Now, topic-specific→For This Topic, analyze→Analyze, learn→Learn);
// its sections come from the single cached per-(topic,group) brief, so once a
// path loads, hopping between its sections is instant.
import { renderBriefBody } from './newsfeed.js?v=20260610-revamp83';
import { getModels, getModelById, getDefaultModelId, getExternalSearches, getExternalSearchCategories } from '../utils/data.js';
import { openModel, copyPrompt, getPreferredModelId, setPreferredModelId } from '../utils/ai-models.js';

// Display metadata for the paths (the navigation categories). Each `group`
// matches a shortcut group + the server-side data/ai-paths.json (which also
// holds the refresh class). Kept inline so the component never depends on a
// freshly-changed data.js (the no-version singleton).
const PATHS = [
  { group: 'discover',       label: "What's Happening Now",   tab: "What's Happening", subtitle: 'The latest news, moves, and developments.' },
  { group: 'topic-specific', label: 'Topic-Specific Insights', tab: 'Topic Insights',   subtitle: 'Go deeper on what makes this topic tick.' },
  { group: 'analyze',        label: 'Analysis',                tab: 'Analysis',         subtitle: 'Deeper lenses, tradeoffs, and what it all means.' },
  { group: 'learn',          label: 'Learn',                   tab: 'Learn',            subtitle: 'Background, fundamentals, and key context.' },
];

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
function splitSections(content) {
  const text = String(content || '');
  // Tolerate header drift: the model sometimes wraps headers in bold
  // (**## Name**), uses ### , or trailing **. Match all and clean the name.
  const re = /^[ \t]*(?:\*\*)?#{2,3}\s+(.+?)\s*$/gm;
  const idx = []; let m;
  while ((m = re.exec(text))) {
    // The model sometimes echoes the generation scaffold ("Name — section
    // brief: <prompt>") into the header; keep only the clean section name.
    const name = m[1].replace(/\*\*/g, '').replace(/\s*[—–-]\s*section brief\s*:.*/i, '').replace(/[:#\s]+$/, '').trim();
    idx.push({ name, start: m.index, headEnd: m.index + m[0].length });
  }
  if (!idx.length) return [];
  return idx.map((s, i) => ({ name: s.name, body: text.slice(s.headEnd, i + 1 < idx.length ? idx[i + 1].start : text.length).trim() }));
}

// Brand mark — a clean, flat 4-point sparkle (the same spark used inline),
// filled white on the navy tile. Simple and on-brand (no glossy facets).
const LOGO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const EXT = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>';
const CHEV = '<svg class="aii-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
// Small inline spark for the "AI Brief" eyebrow (matches the news modal).
const SPARK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/></svg>';
// Paper-plane (Direct Submit — "send it off") and an eye (Review — "preview").
const ICON_SEND = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2.5L11 13"/><path d="M21.5 2.5L15 21l-4-8-8-4z"/></svg>';
// Brief generating loader — spark pulse + shimmer bars (occupies the space the
// brief will fill). Shown briefly on section open even when cached.
function genLoaderHTML() {
  return `<div class="aii-gen"><div class="aii-gen-spark">${SPARK}</div><div class="aii-gen-label">Generating AI insights…</div><div class="aii-gen-bars"><span></span><span></span><span></span><span></span></div></div>`;
}
const ICON_EYES = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICONS = {
  discover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 10.5 10.5 8.5 15.5 13.5 13.5"/></svg>',
  learn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15a2 2 0 0 0-2-1.5H2z"/><path d="M22 5a2 2 0 0 0-2-2h-6a2 2 0 0 0-2 2v15a2 2 0 0 1 2-1.5h8z"/></svg>',
  analyze: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="13"/><line x1="12" y1="20" x2="12" y2="8"/><line x1="18" y1="20" x2="18" y2="4"/></svg>',
  'topic-specific': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15 9 22 9.3 16.5 13.9 18.5 21 12 16.8 5.5 21 7.5 13.9 2 9.3 9 9"/></svg>',
  _: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>',
};

// scope: { topic: '<Topic Name>' | 'home', label: '<display>' }
export function renderAIIntelligence(container, scope) {
  // Hide paths that don't apply to this scope (e.g. "For This Topic" on the
  // homepage, which has no topic-specific content).
  const hide = scope.hideGroups || [];
  const paths = PATHS.filter((p) => !hide.includes(p.group));
  const cache = {};               // group -> { sections, generatedAt, sources, loading, error }
  let view = 'paths';             // 'paths' | 'sections' | 'content'
  let curGroup = null;
  let curIdx = 0;
  // Tab mode: on a topic page at mobile width, the paths become a secondary tab
  // bar (under the primary News Feed / AI Intelligence / Web Sources tabs)
  // instead of the flip-nav landing list.
  const tabMode = scope.topic !== 'home'
    && typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(max-width: 899.98px)').matches;

  const subtabsHTML = () => `<nav class="aii-subtabs">${paths.map((p) => `<button type="button" class="aii-subtab" data-group="${escAttr(p.group)}">${esc(p.tab || p.label)}</button>`).join('')}</nav>`;

  container.innerHTML = `
    <div class="aii${tabMode ? ' aii-tabmode' : ''}">
      <div class="aii-head">
        <div class="aii-head-top"><span class="aii-logo">${LOGO}</span><span class="aii-brand">AI Intelligence</span></div>
        <p class="aii-headsub">Pick a path and explore live AI insights.</p>
      </div>
      ${tabMode ? subtabsHTML() : ''}
      <div class="aii-stage" data-view="paths"></div>
    </div>`;
  const stage = container.querySelector('.aii-stage');

  function setActiveSubtab() {
    if (!tabMode) return;
    container.querySelectorAll('.aii-subtab').forEach((b) => b.classList.toggle('is-active', b.dataset.group === curGroup));
  }
  function go(v, dir) {
    view = v; stage.dataset.view = v;
    stage.innerHTML = viewHTML();
    stage.classList.remove('aii-anim-fwd', 'aii-anim-back');
    void stage.offsetWidth;
    stage.classList.add(dir === 'back' ? 'aii-anim-back' : 'aii-anim-fwd');
    wire();
    setActiveSubtab();
    if (dir === 'fwd' && view !== 'paths') ensureVisible();
  }
  function viewHTML() {
    return view === 'paths' ? pathsHTML() : view === 'sections' ? sectionsHTML() : contentHTML();
  }

  function pathsHTML() {
    return `<div class="aii-pathlist">${paths.map((p) => `
      <button type="button" class="aii-pathrow" data-group="${escAttr(p.group)}">
        <span class="aii-pathrow-icon aii-icon-${escAttr(p.group)}">${ICONS[p.group] || ICONS._}</span>
        <span class="aii-pathrow-text"><span class="aii-pathrow-name">${esc(p.label)}</span><span class="aii-pathrow-sub">${esc(p.subtitle)}</span></span>
        <span class="aii-pathrow-go">${ARROW}</span>
      </button>`).join('')}</div>`;
  }
  function sectionsHTML() {
    const p = paths.find((x) => x.group === curGroup) || {};
    const c = cache[curGroup];
    let body;
    if (!c || c.loading) body = `<div class="aii-loading">Loading ${esc(p.label || '')}…</div>`;
    else if (c.error || !c.sections.length) body = `<p class="aii-empty">This overview is being generated — check back shortly.</p>`;
    else body = `<div class="aii-menu">${c.sections.map((s, i) => {
      const desc = (scope.descriptions && scope.descriptions[s.name]) || '';
      return `<button type="button" class="aii-menu-row" data-idx="${i}"><span class="aii-menu-text"><span class="aii-menu-name">${esc(s.name)}</span>${desc ? `<span class="aii-menu-desc">${esc(desc)}</span>` : ''}</span>${ARROW}</button>`;
    }).join('')}</div>`;
    const updated = c && c.generatedAt ? `<span class="aii-updated">Updated ${esc(relTime(c.generatedAt))}</span>` : '';
    return `<div class="aii-sub">
      <div class="aii-backrow">
        <button type="button" class="aii-back" data-back="paths">${BACK}<span>Back to AI Intelligence</span></button>
        ${updated}
      </div>
      <div class="aii-subhead">
        <span class="aii-subhead-icon aii-icon-${escAttr(curGroup)}">${ICONS[curGroup] || ICONS._}</span>
        <div class="aii-subhead-text">
          <span class="aii-subhead-name">${esc(p.label || '')}</span>
          ${p.subtitle ? `<span class="aii-subhead-sub">${esc(p.subtitle)}</span>` : ''}
        </div>
      </div>
      ${body}
    </div>`;
  }
  function contentHTML() {
    const c = cache[curGroup]; const p = paths.find((x) => x.group === curGroup) || {};
    const s = (c && c.sections[curIdx]) || { name: '', body: '' };
    const hasSrc = !!(c && c.sources && c.sources.length);
    const desc = (scope.descriptions && scope.descriptions[s.name]) || '';
    return `<div class="aii-sub aii-content">
      <button type="button" class="aii-back" data-back="sections">${BACK}<span>Back to ${esc(p.label || 'menu')}</span></button>
      <div class="aii-overview aii-overview-plain">
        <div class="aii-overview-eyebrow">${esc(p.label || '')}</div>
        <h3 class="aii-overview-title">${esc(s.name)}</h3>
        ${desc ? `<p class="aii-overview-sub">${esc(desc)}</p>` : ''}
      </div>
      <div class="aii-brief-head">${SPARK}<span>AI Brief</span></div>
      <p class="aii-brief-note">The below is an AI-generated summary of the topic at hand. Please verify important details with the linked sources.</p>
      <div class="aii-actions aii-actions-row">
        <button type="button" class="aii-actbtn" data-acc="sources" aria-expanded="false"><span><span class="actlbl-long">Sources &amp; citations</span><span class="actlbl-short">Sources</span></span>${CHEV}</button>
        <button type="button" class="aii-actbtn" data-acc="explore" aria-expanded="false"><span>Explore with AI</span>${CHEV}</button>
        <button type="button" class="aii-actbtn" data-acc="web" aria-expanded="false"><span>Explore on web</span>${CHEV}</button>
      </div>
      <div class="aii-acc" data-accbody="sources"></div>
      <div class="aii-acc" data-accbody="explore"></div>
      <div class="aii-acc" data-accbody="web"></div>
      <hr class="aii-rule">
      <div class="aii-content-body" data-loading="1">${genLoaderHTML()}</div>
    </div>`;
  }
  function sourceRowsHTML() {
    // sources is either a flat array (news/trend, ungrounded fallback, or older
    // cached overviews) or a per-section map { sectionName: [...] }. For a map,
    // show only the current section's sources (falls back to the union if that
    // section has none, so the list is never wrongly empty).
    const all = (cache[curGroup] && cache[curGroup].sources) || [];
    const curName = ((cache[curGroup] && cache[curGroup].sections[curIdx]) || {}).name || '';
    let src;
    if (Array.isArray(all)) src = all;
    else {
      src = (all && all[curName]) || [];
      if (!src.length) src = Object.values(all || {}).flat();
    }
    const seen = new Set(); const rows = [];
    for (const x of src) {
      const uri = x.uri || x.url || '';
      let label = x.title || '';
      try { if (!label || /^https?:/i.test(label)) label = new URL(uri).hostname.replace(/^www\./i, ''); } catch (_) {}
      const key = (label || '').toLowerCase(); if (!key || seen.has(key)) continue; seen.add(key);
      rows.push(`<a class="aii-src-row" href="${escAttr(uri)}" target="_blank" rel="noopener noreferrer"><span>${esc(label)}</span>${ARROW}</a>`);
    }
    return rows.length ? `<div class="aii-src-list">${rows.join('')}</div>` : '<p class="aii-empty">No sources cited for this brief.</p>';
  }
  // "Explore further on web" — the full Web Sources platform picker (source
  // types → platforms), searching this topic. Mirrors the Web Sources card.
  function webCatsHTML() {
    const cats = getExternalSearchCategories() || [];
    const searches = getExternalSearches() || [];
    const avail = cats.filter((c) => searches.some((s) => s.category === c.key));
    if (!avail.length) return '<p class="aii-empty">No web sources available.</p>';
    return `<div class="aii-web">${avail.map((c) => `<button type="button" class="aii-web-cat" data-cat="${escAttr(c.key)}"><span>${esc(c.label)}</span>${ARROW}</button>`).join('')}</div>`;
  }
  function webListHTML(catKey) {
    const term = scope.label || scope.topic || '';
    const items = (getExternalSearches() || []).filter((s) => s.category === catKey);
    const rows = items.map((s) => {
      const url = String(s.urlTemplate || '').replace(/\{query\}/g, encodeURIComponent(term));
      return `<a class="aii-web-row" href="${escAttr(url)}" target="_blank" rel="noopener noreferrer"><span class="aii-web-row-text"><span class="aii-web-row-name">${esc(s.name)}</span>${s.description ? `<span class="aii-web-row-desc">${esc(s.description)}</span>` : ''}</span>${EXT}</a>`;
    }).join('');
    return `<div class="aii-web"><button type="button" class="aii-web-back">${BACK}<span>All source types</span></button><div class="aii-web-rows">${rows || '<p class="aii-empty">No sources here.</p>'}</div></div>`;
  }
  // Keep the just-navigated view in view (fixes the page anchoring past the
  // component when you drill in). Only nudges when the block is out of comfort.
  function ensureVisible() {
    const rect = container.getBoundingClientRect();
    const top = 112; // clears the fixed header + subnav
    if (rect.top < top || rect.top > window.innerHeight * 0.6) {
      window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - top), behavior: 'smooth' });
    }
  }

  async function loadGroup(group) {
    if (cache[group] && !cache[group].loading) return cache[group];
    cache[group] = { sections: [], loading: true };
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'shortcut', topic: scope.topic, group }) });
      const data = res.ok ? await res.json() : null;
      cache[group] = data && data.content
        ? { sections: splitSections(data.content), generatedAt: data.generatedAt, sources: data.sources || [], loading: false }
        : { sections: [], loading: false, error: true };
    } catch (_) { cache[group] = { sections: [], loading: false, error: true }; }
    return cache[group];
  }

  function explorePrompt() {
    const c = cache[curGroup]; const s = (c && c.sections[curIdx]) || {};
    return `Give me a thorough, current briefing on "${s.name || ''}" for ${scope.label}. Be specific and cite sources.`;
  }
  function curSectionName() {
    const c = cache[curGroup]; const s = (c && c.sections[curIdx]) || {};
    return s.name || '';
  }
  // The model a Direct Submit goes to (the user's preferred / site default).
  function preferredModel() {
    const id = getPreferredModelId(getDefaultModelId());
    return getModelById(id) || (getModels() || [])[0] || null;
  }

  // Explore-further panel, step 1: pick a model, then choose how to send.
  function modelOptionsHTML() {
    const m = preferredModel();
    return (getModels() || []).map((x) => `<option value="${escAttr(x.id)}"${m && x.id === m.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  }
  function exploreHomeHTML() {
    const m = preferredModel();
    return `<div class="aii-explore" data-step="home">
      <label class="aii-explore-model"><span class="aii-explore-model-lead">Send to</span>
        <span class="aii-explore-select-wrap"><select class="aii-explore-select" aria-label="Choose AI model">${modelOptionsHTML()}</select>${CHEV}</span></label>
      <button type="button" class="aii-explore-opt" data-opt="direct">
        <span class="aii-explore-ic">${ICON_SEND}</span>
        <span class="aii-explore-tx"><span class="aii-explore-name">Direct Submit</span><span class="aii-explore-sub">Open <span class="aii-explore-mn">${esc(m ? m.name : 'an AI model')}</span> with this prompt</span></span>
        ${ARROW}
      </button>
      <button type="button" class="aii-explore-opt" data-opt="review">
        <span class="aii-explore-ic">${ICON_EYES}</span>
        <span class="aii-explore-tx"><span class="aii-explore-name">Review Prompt</span><span class="aii-explore-sub">Preview &amp; tweak it before you send</span></span>
        ${ARROW}
      </button>
    </div>`;
  }
  // Explore-further panel, step 2 (Direct Submit): "leaving the site" confirm.
  function exploreLeaveHTML() {
    const m = preferredModel();
    const name = m ? m.name : 'the AI model';
    return `<div class="aii-explore" data-step="leave">
      <div class="aii-leave-card">
        <button type="button" class="aii-leave-back">${BACK}<span>Back</span></button>
        <p class="aii-leave-title">You're leaving Standard Topic</p>
        <p class="aii-leave-body">Continue opens <strong>${esc(name)}</strong> in a new tab. If the prompt doesn't auto-fill, it's copied to your clipboard — just paste it in. You may need to be signed in.</p>
        <button type="button" class="aii-leave-go">Continue ${ARROW}</button>
      </div>
    </div>`;
  }

  function wire() {
    // Section content: briefly show the generating loader (even when cached)
    // then reveal the brief — gives the AI a moment of presence.
    const bodyEl = stage.querySelector('.aii-content-body[data-loading]');
    if (bodyEl) {
      const c = cache[curGroup]; const s = (c && c.sections[curIdx]) || { body: '' };
      setTimeout(() => {
        if (stage.querySelector('.aii-content-body') !== bodyEl) return;
        bodyEl.removeAttribute('data-loading');
        bodyEl.innerHTML = renderBriefBody(s.body, null);
        bodyEl.classList.add('ai-reveal');
      }, 1000);
    }
    stage.querySelectorAll('.aii-pathrow').forEach((b) => b.addEventListener('click', async () => {
      curGroup = b.dataset.group;
      go('sections', 'fwd');
      await loadGroup(curGroup);
      // Re-render the menu in place if the user is still on this path.
      if (view === 'sections' && stage.dataset.view === 'sections') { stage.innerHTML = sectionsHTML(); wire(); }
    }));
    stage.querySelectorAll('.aii-menu-row').forEach((b) => b.addEventListener('click', () => { curIdx = Number(b.dataset.idx); go('content', 'fwd'); }));
    stage.querySelectorAll('.aii-back').forEach((b) => b.addEventListener('click', () => go(b.dataset.back, 'back')));
    // Sources + Explore accordions (above the brief). Only one open at a time.
    stage.querySelectorAll('.aii-actbtn').forEach((btn) => btn.addEventListener('click', () => {
      const name = btn.dataset.acc;
      const body = stage.querySelector(`[data-accbody="${name}"]`);
      const willOpen = btn.getAttribute('aria-expanded') !== 'true';
      stage.querySelectorAll('.aii-actbtn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
      stage.querySelectorAll('.aii-acc').forEach((a) => a.classList.remove('is-open'));
      if (willOpen) {
        btn.setAttribute('aria-expanded', 'true');
        if (body && !body.dataset.ready) {
          body.innerHTML = name === 'sources' ? sourceRowsHTML() : name === 'web' ? webCatsHTML() : exploreHomeHTML();
          body.dataset.ready = '1';
        }
        body && body.classList.add('is-open');
      }
    }));
    // "Explore further on web": source-type → platforms → back, in place.
    const webBody = stage.querySelector('[data-accbody="web"]');
    if (webBody) webBody.addEventListener('click', (e) => {
      const catBtn = e.target.closest('.aii-web-cat');
      const back = e.target.closest('.aii-web-back');
      if (catBtn) { webBody.innerHTML = webListHTML(catBtn.dataset.cat); }
      else if (back) { webBody.innerHTML = webCatsHTML(); }
    });
    const exBody = stage.querySelector('[data-accbody="explore"]');
    // Model choice persists (Direct Submit + Review both honor it).
    if (exBody) exBody.addEventListener('change', (e) => {
      const sel = e.target.closest('.aii-explore-select'); if (!sel) return;
      setPreferredModelId(sel.value);
      const m = preferredModel();
      const mn = exBody.querySelector('.aii-explore-mn');
      if (mn && m) mn.textContent = m.name;
    });
    if (exBody) exBody.addEventListener('click', (e) => {
      const opt = e.target.closest('.aii-explore-opt');
      const back = e.target.closest('.aii-leave-back');
      const go = e.target.closest('.aii-leave-go');
      if (opt) {
        if (opt.dataset.opt === 'review') {
          // Hand off to the full Review & Submit takeover modal.
          window.dispatchEvent(new CustomEvent('open-prompt-modal', { detail: {
            basePrompt: explorePrompt(), topicName: scope.label, name: curSectionName(), count: 1,
          } }));
        } else {
          // Direct Submit → confirm leaving the site. Copy now so the later
          // Continue click can open the model synchronously (no popup block).
          copyPrompt(explorePrompt());
          exBody.innerHTML = exploreLeaveHTML();
        }
      } else if (back) {
        exBody.innerHTML = exploreHomeHTML();
      } else if (go) {
        const model = preferredModel(); if (!model) return;
        openModel(model, explorePrompt());
      }
    });
  }

  // Secondary tab bar (mobile tab mode): each tab opens that path's section
  // menu directly. Wired once (the subtabs live outside the re-rendered stage).
  async function openTab(group) {
    if (curGroup === group && (view === 'sections' || view === 'content')) return;
    curGroup = group; curIdx = 0;
    go('sections', 'fwd');
    await loadGroup(curGroup);
    if (curGroup === group && stage.dataset.view === 'sections') { stage.innerHTML = sectionsHTML(); wire(); setActiveSubtab(); }
  }
  if (tabMode) {
    container.querySelectorAll('.aii-subtab').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.group)));
    openTab(paths[0].group);          // default to the first path's sections
  } else {
    go('paths', 'fwd');
  }
  // Responsive: tabMode is fixed at render, so without this the first-render
  // layout (desktop paths-grid OR mobile secondary-tab nav) would stick across
  // a viewport resize. Re-render whenever the breakpoint is crossed.
  if (typeof window !== 'undefined' && window.matchMedia && scope.topic !== 'home') {
    if (container._aiiMq && container._aiiMqHandler) {
      container._aiiMq.removeEventListener('change', container._aiiMqHandler);
    }
    const mq = window.matchMedia('(max-width: 899.98px)');
    const handler = () => renderAIIntelligence(container, scope);
    mq.addEventListener('change', handler);
    container._aiiMq = mq;
    container._aiiMqHandler = handler;
  }
  return { destroy() {
    if (container._aiiMq && container._aiiMqHandler) container._aiiMq.removeEventListener('change', container._aiiMqHandler);
    container._aiiMq = container._aiiMqHandler = null;
    container.innerHTML = '';
  } };
}
