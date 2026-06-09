// Living "AI Intelligence" component. A self-contained block that navigates in
// place: paths grid → that path's section menu → a section's AI analysis, with
// a back stack and slide transitions. Each path = a shortcut `group`
// (discover→Now, topic-specific→For This Topic, analyze→Analyze, learn→Learn);
// its sections come from the single cached per-(topic,group) brief, so once a
// path loads, hopping between its sections is instant.
import { renderBriefBody } from './newsfeed.js?v=20260609-revamp41';
import { getModels, getModelById, getDefaultModelId } from '../utils/data.js';
import { openModel, copyPrompt, getPreferredModelId } from '../utils/ai-models.js';

// Display metadata for the paths (the navigation categories). Each `group`
// matches a shortcut group + the server-side data/ai-paths.json (which also
// holds the refresh class). Kept inline so the component never depends on a
// freshly-changed data.js (the no-version singleton).
const PATHS = [
  { group: 'discover',       label: 'Now',            subtitle: "What's happening right now." },
  { group: 'topic-specific', label: 'For This Topic', subtitle: 'Insights tailored to this topic.' },
  { group: 'analyze',        label: 'Analysis',        subtitle: 'Deeper analytical lenses and tradeoffs.' },
  { group: 'learn',          label: 'Learn',          subtitle: 'Background, fundamentals, and context.' },
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
  const re = /^##\s+(.+)$/gm;
  const idx = []; let m;
  while ((m = re.exec(text))) idx.push({ name: m[1].trim(), start: m.index, headEnd: m.index + m[0].length });
  if (!idx.length) return [];
  return idx.map((s, i) => ({ name: s.name, body: text.slice(s.headEnd, i + 1 < idx.length ? idx[i + 1].start : text.length).trim() }));
}

// Sparkle duo — a large 4-point spark with a small accent spark, reads as a
// designed "AI" mark rather than a single generic star.
const LOGO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2.4l1.18 4.02a3 3 0 0 0 2.04 2.04L21.2 9.6l-3.98 1.18a3 3 0 0 0-2.04 2.04L14 16.8l-1.18-3.98a3 3 0 0 0-2.04-2.04L6.8 9.6l3.98-1.18a3 3 0 0 0 2.04-2.04z" opacity="0.96"/><path d="M6.3 14.4l.52 1.78a1.4 1.4 0 0 0 .95.95l1.78.52-1.78.52a1.4 1.4 0 0 0-.95.95L6.3 21.9l-.52-1.78a1.4 1.4 0 0 0-.95-.95L3.05 18.65l1.78-.52a1.4 1.4 0 0 0 .95-.95z"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const CHEV = '<svg class="aii-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
// Paper-plane (Direct Submit — "send it off") and an eye (Review — "preview").
const ICON_SEND = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2.5L11 13"/><path d="M21.5 2.5L15 21l-4-8-8-4z"/></svg>';
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

  container.innerHTML = `
    <div class="aii">
      <div class="aii-head"><span class="aii-logo">${LOGO}</span><span class="aii-brand">AI Intelligence</span></div>
      <div class="aii-stage" data-view="paths"></div>
    </div>`;
  const stage = container.querySelector('.aii-stage');

  function go(v, dir) {
    view = v; stage.dataset.view = v;
    stage.innerHTML = viewHTML();
    stage.classList.remove('aii-anim-fwd', 'aii-anim-back');
    void stage.offsetWidth;
    stage.classList.add(dir === 'back' ? 'aii-anim-back' : 'aii-anim-fwd');
    wire();
    if (dir === 'fwd' && view !== 'paths') ensureVisible();
  }
  function viewHTML() {
    return view === 'paths' ? pathsHTML() : view === 'sections' ? sectionsHTML() : contentHTML();
  }

  function pathsHTML() {
    const introScope = scope.topic === 'home' ? "today's world" : `the topic of ${scope.label}`;
    return `<p class="aii-intro">Live, AI-generated intelligence on ${esc(introScope)}. Pick a lens — what's happening now, the essentials, deeper analysis, and more — then dive into any insight.</p>
      <div class="aii-grid">${paths.map((p) => `
      <button type="button" class="aii-tile" data-group="${escAttr(p.group)}">
        <span class="aii-tile-icon aii-icon-${escAttr(p.group)}">${ICONS[p.group] || ICONS._}</span>
        <span class="aii-tile-text"><span class="aii-tile-name">${esc(p.label)}</span><span class="aii-tile-sub">${esc(p.subtitle)}</span></span>
        <span class="aii-tile-go">${ARROW}</span>
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
      <button type="button" class="aii-back" data-back="paths">${BACK}<span>AI Intelligence</span></button>
      <div class="aii-subhead"><span class="aii-eyebrow">${esc(p.label || '')}</span><span class="aii-subtopic">${esc(scope.label)}</span>${updated}</div>
      ${body}
    </div>`;
  }
  function contentHTML() {
    const c = cache[curGroup]; const p = paths.find((x) => x.group === curGroup) || {};
    const s = (c && c.sections[curIdx]) || { name: '', body: '' };
    const hasSrc = !!(c && c.sources && c.sources.length);
    return `<div class="aii-sub">
      <button type="button" class="aii-back" data-back="sections">${BACK}<span>${esc(p.label || '')}</span></button>
      <h3 class="aii-content-title">${esc(s.name)}</h3>
      <div class="aii-actions">
        ${hasSrc ? `<button type="button" class="aii-actbtn" data-acc="sources" aria-expanded="false"><span>Sources</span>${CHEV}</button>` : ''}
        <button type="button" class="aii-actbtn" data-acc="explore" aria-expanded="false"><span>Explore further with AI</span>${CHEV}</button>
      </div>
      ${hasSrc ? '<div class="aii-acc" data-accbody="sources"></div>' : ''}
      <div class="aii-acc" data-accbody="explore"></div>
      <hr class="aii-rule">
      <div class="aii-content-body ai-reveal">${renderBriefBody(s.body, null)}</div>
    </div>`;
  }
  function sourceRowsHTML() {
    const src = (cache[curGroup] && cache[curGroup].sources) || [];
    const seen = new Set(); const rows = [];
    for (const x of src) {
      const uri = x.uri || x.url || '';
      let label = x.title || '';
      try { if (!label || /^https?:/i.test(label)) label = new URL(uri).hostname.replace(/^www\./i, ''); } catch (_) {}
      const key = (label || '').toLowerCase(); if (!key || seen.has(key)) continue; seen.add(key);
      rows.push(`<a class="aii-src-row" href="${escAttr(uri)}" target="_blank" rel="noopener noreferrer"><span>${esc(label)}</span>${ARROW}</a>`);
    }
    return rows.length ? `<div class="aii-src-list">${rows.join('')}</div>` : '<p class="aii-empty">No sources cited.</p>';
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

  // Explore-further panel, step 1: choose how to send (direct vs review).
  function exploreHomeHTML() {
    const m = preferredModel();
    return `<div class="aii-explore" data-step="home">
      <button type="button" class="aii-explore-opt" data-opt="direct">
        <span class="aii-explore-ic">${ICON_SEND}</span>
        <span class="aii-explore-tx"><span class="aii-explore-name">Direct Submit</span><span class="aii-explore-sub">Open ${esc(m ? m.name : 'an AI model')} with this prompt</span></span>
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
      <button type="button" class="aii-leave-back">${BACK}<span>Back</span></button>
      <div class="aii-leave-card">
        <p class="aii-leave-title">You're leaving Standard Topic</p>
        <p class="aii-leave-body">Continue opens <strong>${esc(name)}</strong> in a new tab. If the prompt doesn't auto-fill, it's copied to your clipboard — just paste it in. You may need to be signed in.</p>
        <button type="button" class="aii-leave-go">Continue ${ARROW}</button>
      </div>
    </div>`;
  }

  function wire() {
    stage.querySelectorAll('.aii-tile').forEach((b) => b.addEventListener('click', async () => {
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
        if (body && !body.dataset.ready) { body.innerHTML = name === 'sources' ? sourceRowsHTML() : exploreHomeHTML(); body.dataset.ready = '1'; }
        body && body.classList.add('is-open');
      }
    }));
    const exBody = stage.querySelector('[data-accbody="explore"]');
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

  go('paths', 'fwd');
  return { destroy() { container.innerHTML = ''; } };
}
