// Living "AI Intelligence" component. A self-contained block that navigates in
// place: paths grid → that path's section menu → a section's AI analysis, with
// a back stack and slide transitions. Each path = a shortcut `group`
// (discover→Now, topic-specific→For This Topic, analyze→Analyze, learn→Learn);
// its sections come from the single cached per-(topic,group) brief, so once a
// path loads, hopping between its sections is instant.
import { renderBriefBody } from './newsfeed.js?v=20260609-revamp35';
import { getModels } from '../utils/data.js';
import { openModel } from '../utils/ai-models.js';

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

const LOGO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.6l1.62 6.32a3 3 0 0 0 2.46 2.46L22.4 12l-6.32 1.62a3 3 0 0 0-2.46 2.46L12 22.4l-1.62-6.32a3 3 0 0 0-2.46-2.46L1.6 12l6.32-1.62a3 3 0 0 0 2.46-2.46z"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const CHEV = '<svg class="aii-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
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
    return `<div class="aii-sub">
      <button type="button" class="aii-back" data-back="sections">${BACK}<span>${esc(p.label || '')}</span></button>
      <h3 class="aii-content-title">${esc(s.name)}</h3>
      <div class="aii-content-body">${renderBriefBody(s.body, (c && c.sources) || null)}</div>
      <div class="aii-explore">
        <button type="button" class="aii-explore-btn" aria-expanded="false"><span>Explore further with AI</span>${CHEV}</button>
        <div class="aii-explore-panel"></div>
      </div>
    </div>`;
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
  function modelListHTML() {
    return `<div class="aii-model-list">${(getModels() || []).map((m) => `<button type="button" class="aii-model" data-model="${escAttr(m.id)}"><span class="aii-model-name">${esc(m.name)}</span>${m.description ? `<span class="aii-model-desc">${esc(m.description)}</span>` : ''}</button>`).join('')}</div>`;
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
    const exBtn = stage.querySelector('.aii-explore-btn');
    const exPanel = stage.querySelector('.aii-explore-panel');
    if (exBtn) exBtn.addEventListener('click', () => {
      const open = exBtn.getAttribute('aria-expanded') !== 'true';
      exBtn.setAttribute('aria-expanded', String(open));
      exPanel.classList.toggle('is-open', open);
      if (open && !exPanel.dataset.ready) { exPanel.innerHTML = modelListHTML(); exPanel.dataset.ready = '1'; }
    });
    if (exPanel) exPanel.addEventListener('click', (e) => {
      const m = e.target.closest('.aii-model'); if (!m) return;
      const model = (getModels() || []).find((x) => x.id === m.dataset.model); if (!model) return;
      openModel(model, explorePrompt());
    });
  }

  go('paths', 'fwd');
  return { destroy() { container.innerHTML = ''; } };
}
