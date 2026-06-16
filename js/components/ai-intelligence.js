// Living "AI Intelligence" component. A self-contained block that navigates in
// place: paths grid → that path's section menu → a section's AI analysis, with
// a back stack and slide transitions. Each path = a shortcut `group`
// (discover→Now, topic-specific→For This Topic, analyze→Analyze, learn→Learn);
// its sections come from the single cached per-(topic,group) brief, so once a
// path loads, hopping between its sections is instant.
import { renderBriefBody, resolveSource } from './newsfeed.js?v=20260616-revamp209';
import { aiProvenanceHTML } from '../utils/ai-provenance.js?v=20260616-revamp209';
import { getModels, getModelById, getDefaultModelId, getExternalSearches, getExternalSearchCategories } from '../utils/data.js';
import { openModel, copyPrompt, getPreferredModelId, setPreferredModelId } from '../utils/ai-models.js';
import { renderIcon } from '../utils/icons.js';

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

// Per-section relevance split for the "In the news" list. A group overview is ONE
// generation, so its grounding citations / fed headlines are pooled across all
// sections; when Gemini doesn't return per-section attribution we'd otherwise show
// the same flat list under every insight. Instead, assign each story to the
// section whose name+body it best matches (token overlap — the synthesized body
// names the specific people/events each story is about) and keep only the ones
// that belong to the current section.
const HL_STOP = new Set(['news','this','that','with','from','have','will','your','they','them','their','there','about','would','could','should','what','when','where','which','were','been','more','than','then','some','into','over','after','also','these','those','said','says','amid','year','years','week','time','today','latest','update','updates','report','reports','first','here','your','have']);
function hlTokens(s) {
  const out = new Set();
  const m = String(s || '').toLowerCase().match(/[a-z0-9]{4,}/g);
  if (m) for (const t of m) if (!HL_STOP.has(t)) out.add(t);
  return out;
}
function poolForSection(pool, sections, curIdx) {
  if (!sections.length) return pool;
  const secTok = sections.map((s) => hlTokens(`${s.name || ''} ${s.body || ''}`));
  const out = [];
  for (const story of pool) {
    const tt = hlTokens(story.title || '');
    if (!tt.size) continue;
    let best = -1; let bestScore = 0;
    for (let i = 0; i < sections.length; i++) {
      let score = 0;
      for (const t of tt) if (secTok[i].has(t)) score++;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best === curIdx) out.push(story); // best>-1 only when bestScore>0
  }
  return out;
}

// Brand mark — a clean, flat 4-point sparkle (the same spark used inline),
// filled white on the navy tile. Simple and on-brand (no glossy facets).
const LOGO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
// Horizontal "go" arrow for the promo CTA (slides right on hover).
const RIGHT_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const EXT = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>';
const CHEV = '<svg class="aii-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
// Section-icon badge for "Sources & Coverage" (link glyph) — matches the brief
// section glyphs + the News/Trend modals (#129).
const SOURCES_BADGE = '<span class="ai-result-sub-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>';
// Small inline spark for the "AI Brief" eyebrow (matches the news modal).
const SPARK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/></svg>';
const SEARCH_ICON = '<svg class="aii-topic-search-ic" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
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
// Per-track accent — gives each launcher tile its own identifiable colour
// (icon chip tint + hover edge), so the card reads as a real product (#167).
const AII_ACCENTS = { discover: '#2563eb', 'topic-specific': '#d97706', analyze: '#7c3aed', learn: '#0d9488', _: '#2563eb' };

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
  let aiiObserver = null;         // tab-mode: watches the overview card (root = .aii-stage scroller) to toggle the sticky condensed bar
  // Tab mode: on a topic page at mobile width, the paths become a secondary tab
  // bar (under the primary News Feed / AI Intelligence / Web Sources tabs)
  // instead of the flip-nav landing list.
  const tabMode = scope.topic !== 'home'
    && typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(max-width: 899.98px)').matches;
  // Launcher mode (#13): on the homepage + topic-page DESKTOP, the section is a
  // launcher — clicking a path opens the AI Intelligence MODAL (the in-place
  // flip was a shitshow on those layouts). Inside the modal (scope.inModal) we
  // run the full flip-nav. Topic-page MOBILE stays the inline tab-mode.
  const launcher = !tabMode && !scope.inModal;

  const subtabsHTML = () => `<nav class="aii-subtabs">${paths.map((p) => `<button type="button" class="aii-subtab" data-group="${escAttr(p.group)}">${esc(p.tab || p.label)}</button>`).join('')}</nav>`;

  const topicTitle = scope.topic === 'home' ? "Today's World" : (scope.label || scope.topic || '');

  // Sticky modal header (#173): a "Back" pill, the topic title (left-aligned,
  // click to re-pick the topic), the "Updated …" stamp to its right, and the
  // current path/insight context row below. Rebuilt per view by updateTopbar().
  function updateTopbar() {
    const tb = container.querySelector('[data-topbar]');
    if (!tb) return;
    if (view === 'topic') { tb.hidden = true; tb.innerHTML = ''; return; }
    tb.hidden = false;
    const c = cache[curGroup];
    const p = paths.find((x) => x.group === curGroup) || {};
    const switchable = typeof scope.onChangeTopic === 'function' && Array.isArray(scope.allTopics) && scope.allTopics.length;
    const updated = (c && c.generatedAt && (view === 'sections' || view === 'content'))
      ? `<span class="aii-top-updated">Updated ${esc(relTime(c.generatedAt))}</span>` : '';
    let context = '';
    if (view === 'sections') {
      context = `<div class="aii-top-context"><span class="aii-top-context-ic aii-icon-${escAttr(curGroup)}">${ICONS[curGroup] || ICONS._}</span><div class="aii-top-context-tx"><span class="aii-top-context-name">${esc(p.label || '')}</span>${p.subtitle ? `<span class="aii-top-context-sub">${esc(p.subtitle)}</span>` : ''}</div></div>`;
    } else if (view === 'content') {
      const s = (c && c.sections[curIdx]) || { name: '' };
      context = `<div class="aii-top-context"><span class="aii-top-context-ic">${sectionIcon(s.name)}</span><div class="aii-top-context-tx"><span class="aii-top-context-name">${esc(s.name)}</span><span class="aii-top-context-sub">${esc(p.label || '')}</span></div></div>`;
    }
    tb.innerHTML = `
      <button type="button" class="aii-back-pill" data-tb-back>${BACK}<span>Back</span></button>
      <div class="aii-top-main">
        <button type="button" class="aii-top-topic${switchable ? '' : ' is-static'}" ${switchable ? 'data-tb-topic aria-label="Change topic"' : 'disabled'}>
          <span class="aii-top-topic-name">${esc(topicTitle)}</span>${switchable ? CHEV : ''}
        </button>
        ${updated}
      </div>
      ${context}`;
    tb.querySelector('[data-tb-back]')?.addEventListener('click', onBack);
    tb.querySelector('[data-tb-topic]')?.addEventListener('click', () => go('topic', 'back'));
  }
  function onBack() {
    if (view === 'content') go('sections', 'back');
    else if (view === 'sections') go('paths', 'back');
    else if (view === 'paths') go('topic', 'back');
  }

  // Step 1 — pick a topic: search across Today's World + all 100 topics.
  function topicChipsHTML(filter) {
    const f = String(filter || '').toLowerCase().trim();
    const items = (scope.allTopics || scope.topics || []).filter((t) => !f || String(t.name).toLowerCase().includes(f));
    if (!items.length) return '<p class="aii-tp-empty">No topics found. Try another search.</p>';
    return items.map((t) => `<button type="button" class="aii-tp-chip${t.key === scope.topicKey ? ' is-active' : ''}${t.key === 'home' ? ' aii-tp-chip--home' : ''}" data-tp-key="${escAttr(t.key)}">${esc(t.name)}</button>`).join('');
  }
  function topicViewHTML() {
    return `<div class="aii-tp">
      <div class="aii-tp-head">
        <span class="aii-tp-step">Step 1 of 3 · Topic</span>
        <h3 class="aii-tp-title">What do you want insights on?</h3>
        <p class="aii-tp-sub">Pick Today's World, or search any of 100+ topics.</p>
      </div>
      <div class="aii-tp-searchwrap">${SEARCH_ICON}<input type="text" class="aii-tp-search" placeholder="Search topics…" aria-label="Search topics"></div>
      <div class="aii-tp-grid" data-tp-grid>${topicChipsHTML('')}</div>
    </div>`;
  }
  function wireTopicView() {
    const search = stage.querySelector('.aii-tp-search');
    const grid = stage.querySelector('[data-tp-grid]');
    if (!grid) return;
    const wireChips = () => grid.querySelectorAll('.aii-tp-chip').forEach((ch) => ch.addEventListener('click', () => { if (scope.onChangeTopic) scope.onChangeTopic(ch.dataset.tpKey); }));
    if (search) search.addEventListener('input', () => { grid.innerHTML = topicChipsHTML(search.value); wireChips(); });
    wireChips();
  }

  container.innerHTML = `
    <div class="aii${tabMode ? ' aii-tabmode' : ''}${launcher ? ' aii-launcher' : ''}${launcher && scope.topic === 'home' ? ' aii-launcher-cta' : ''}">
      <div class="aii-head">
        <div class="aii-head-top"><span class="aii-logo">${LOGO}</span><span class="aii-brand">AI Insights</span><span class="aii-live"><span class="aii-live-dot" aria-hidden="true"></span>Live</span></div>
        <p class="aii-headsub">Pick a path and explore live AI insights.</p>
      </div>
      ${scope.inModal ? '<div class="aii-topbar" data-topbar hidden></div>' : ''}
      ${scope.inModal ? '<div class="aii-condensed aii-condensed--ext" data-cond-ext aria-hidden="true"></div>' : ''}
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
    container.dataset.aiiGroup = curGroup || '';   // expose for the modal→tab hand-off (#13)
    stage.innerHTML = viewHTML();
    stage.classList.remove('aii-anim-fwd', 'aii-anim-back');
    void stage.offsetWidth;
    stage.classList.add(dir === 'back' ? 'aii-anim-back' : 'aii-anim-fwd');
    wire();
    setActiveSubtab();
    updateTopbar();
    updateExtCondensed();   // modal: sync/clear the external sticky bar for this view
    if (dir === 'fwd' && view !== 'paths') ensureVisible();
  }
  function viewHTML() {
    return view === 'topic' ? topicViewHTML() : view === 'paths' ? pathsHTML() : view === 'sections' ? sectionsHTML() : contentHTML();
  }

  // Launcher (#167). HOME → a 3-step promo that sells the click-through (pick a
  // topic → pick a path → get insights) with one CTA into the modal's Step 1.
  // TOPIC PAGES (topic already chosen) → the direct track tiles (pick a path).
  const ICON_TOPICS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></svg>';
  function launcherStepsHTML() {
    const STEPS = [
      { n: 1, name: 'Pick a topic', sub: "Today's World or 100+ subjects" },
      { n: 2, name: 'Pick a path', sub: 'Choose an intelligence track' },
      { n: 3, name: 'Get AI insights', sub: 'Live, grounded analysis' },
    ];
    const steps = STEPS.map((s, i) => `<div class="aii-step">
        <span class="aii-step-title"><span class="aii-step-n">${s.n}</span>${esc(s.name)}</span>
        <span class="aii-step-sub">${esc(s.sub)}</span>
      </div>${i < STEPS.length - 1 ? `<span class="aii-step-sep" aria-hidden="true">${RIGHT_ARROW}</span>` : ''}`).join('');
    // No standalone button — the whole card is the CTA (#167). A footer cue +
    // the card's hover state signal that it opens.
    return `<div class="aii-promo aii-promo--steps">
      <p class="aii-promo-line">Live, AI-written intelligence in three quick steps.</p>
      <div class="aii-steps">${steps}</div>
      <span class="aii-promo-cue">Explore AI Insights <span class="aii-promo-cue-arrow">${RIGHT_ARROW}</span></span>
    </div>`;
  }
  function launcherPromoHTML() {
    if (scope.topic === 'home') return launcherStepsHTML();
    const tracks = paths.map((p) => `<button type="button" class="aii-track" data-group="${escAttr(p.group)}" style="--aii-accent:${AII_ACCENTS[p.group] || AII_ACCENTS._}">
        <span class="aii-track-top"><span class="aii-track-ic">${ICONS[p.group] || ICONS._}</span><span class="aii-track-go" aria-hidden="true">${RIGHT_ARROW}</span></span>
        <span class="aii-track-name">${esc(p.tab || p.label)}</span>
        <span class="aii-track-desc">${esc(p.subtitle)}</span>
      </button>`).join('');
    return `<div class="aii-promo">
      <p class="aii-promo-line">Live, AI-written intelligence — pick a track to dive in.</p>
      <div class="aii-promo-grid">${tracks}</div>
    </div>`;
  }
  function pathsHTML() {
    const intro = scope.inModal ? `<p class="aii-paths-intro">Choose an intelligence track</p>` : '';
    return `${intro}<div class="aii-pathlist">${paths.map((p) => `
      <button type="button" class="aii-pathrow" data-group="${escAttr(p.group)}">
        <span class="aii-pathrow-icon aii-icon-${escAttr(p.group)}">${ICONS[p.group] || ICONS._}</span>
        <span class="aii-pathrow-text"><span class="aii-pathrow-name">${esc(p.tab || p.label)}</span><span class="aii-pathrow-sub">${esc(p.subtitle)}</span></span>
        <span class="aii-pathrow-go">${ARROW}</span>
      </button>`).join('')}</div>`;
  }
  // Each section card gets ITS OWN icon (the shortcut's icon from the registry),
  // falling back to the shared path glyph when the caller didn't supply an icon
  // map or the name isn't found (#147). scope.icons is keyed by shortcut name.
  function sectionIcon(name) {
    const slug = scope.icons && scope.icons[name];
    if (slug) {
      const svg = renderIcon(slug);
      if (svg && /^<svg/.test(svg)) return svg;   // emoji fallback → use the path glyph instead
    }
    return ICONS[curGroup] || ICONS._;
  }
  function sectionsHTML() {
    const p = paths.find((x) => x.group === curGroup) || {};
    const c = cache[curGroup];
    let body;
    if (!c || c.loading) body = `<div class="aii-loading">Loading ${esc(p.label || '')}…</div>`;
    else if (c.error || !c.sections.length) body = `<p class="aii-empty">This overview is being generated — check back shortly.</p>`;
    else body = `<div class="aii-menu aii-menu-grid">${c.sections.map((s, i) => {
      const desc = (scope.descriptions && scope.descriptions[s.name]) || '';
      return `<button type="button" class="aii-menu-card" data-idx="${i}"><span class="aii-menu-card-ic aii-icon-${escAttr(curGroup)}">${sectionIcon(s.name)}</span><span class="aii-menu-card-tx"><span class="aii-menu-name">${esc(s.name)}</span>${desc ? `<span class="aii-menu-desc">${esc(desc)}</span>` : ''}</span></button>`;
    }).join('')}</div>`;
    const updated = c && c.generatedAt ? `<span class="aii-updated">Updated ${esc(relTime(c.generatedAt))}</span>` : '';
    // In the modal the sticky topbar owns Back + path context; tab mode keeps
    // its own in-stage backrow + subhead.
    const header = scope.inModal ? '' : `
      <div class="aii-backrow">
        <button type="button" class="aii-back" data-back="paths">${BACK}<span>Back</span></button>
        ${updated}
      </div>
      <div class="aii-subhead">
        <span class="aii-subhead-icon aii-icon-${escAttr(curGroup)}">${ICONS[curGroup] || ICONS._}</span>
        <div class="aii-subhead-text">
          <span class="aii-subhead-name">${esc(p.label || '')}</span>
          ${p.subtitle ? `<span class="aii-subhead-sub">${esc(p.subtitle)}</span>` : ''}
        </div>
      </div>`;
    return `<div class="aii-sub">${header}${body}</div>`;
  }
  // The condensed "topic · path / section" sticky bar (shared by tab mode's
  // inline copy and the modal's external persistent copy).
  function condBarHTML() {
    const c = cache[curGroup]; const p = paths.find((x) => x.group === curGroup) || {};
    const s = (c && c.sections[curIdx]) || { name: '' };
    return `<div class="aii-condensed" aria-hidden="true">
         <button type="button" class="aii-condensed-top" data-cond-top>
           <span class="aii-condensed-eyebrow">${esc(topicTitle)}${p.label ? ` &middot; ${esc(p.label)}` : ''}</span>
           <span class="aii-condensed-title">${esc(s.name)}</span>
         </button>
         <div class="aii-condensed-acts">
           <button type="button" class="aii-cond-act" data-acc="sources">Sources</button>
           <button type="button" class="aii-cond-act" data-acc="explore">Ask AI</button>
           <button type="button" class="aii-cond-act" data-acc="web">Web Search</button>
         </div>
       </div>`;
  }
  // Modal only: keep the external (persistent) condensed bar in sync with the
  // current view. On content views it holds the current insight + acts; elsewhere
  // it's emptied and collapsed. Lives OUTSIDE .aii-stage so the stage's slide
  // transform never breaks its position:sticky (#158).
  function updateExtCondensed() {
    if (!scope.inModal) return;
    const ext = container.querySelector('[data-cond-ext]');
    if (!ext) return;
    if (view !== 'content') { ext.classList.remove('is-on'); ext.innerHTML = ''; ext.setAttribute('aria-hidden', 'true'); return; }
    // condBarHTML() yields a wrapper .aii-condensed; we only want its inner markup
    // since `ext` is itself the .aii-condensed element.
    const tmp = document.createElement('div');
    tmp.innerHTML = condBarHTML();
    ext.innerHTML = tmp.firstElementChild ? tmp.firstElementChild.innerHTML : '';
    ext.querySelectorAll('.aii-cond-act').forEach((btn) => btn.addEventListener('click', (e) => { e.stopPropagation(); openAcc(btn, true); }));
    const condTop = ext.querySelector('[data-cond-top]');
    if (condTop) condTop.addEventListener('click', () => { const sr = container.closest('.aii-modal-body') || container; sr.scrollTo({ top: 0, behavior: 'smooth' }); });
  }
  function contentHTML() {
    const c = cache[curGroup]; const p = paths.find((x) => x.group === curGroup) || {};
    const s = (c && c.sections[curIdx]) || { name: '', body: '' };
    const desc = (scope.descriptions && scope.descriptions[s.name]) || '';
    // Tab mode: a condensed "path · section" bar that sticks to the top of the
    // scrolling brief (.aii-stage is the scroll container — the window doesn't
    // scroll here) once the overview card scrolls out of view. Collapsed to zero
    // until an IntersectionObserver (rooted on .aii-stage) reveals it, so it
    // overlays the top edge without shifting the brief. Tapping it scrolls back up.
    const stickyCtx = tabMode || scope.inModal;   // sticky sub-header in tab mode AND the modal
    // Tab mode keeps the condensed bar INSIDE the scrolling .aii-stage (the stage
    // is its own scroll container there, so position:sticky pins correctly). The
    // MODAL renders the bar OUTSIDE the stage (a persistent sibling in .aii) —
    // .aii-stage's slide animation (transform) would otherwise break sticky, since
    // the modal's scroll container is .aii-modal-body ABOVE the stage (#158).
    const condensed = tabMode ? condBarHTML() : '';
    const sects = (c && c.sections) || [];
    const prev = curIdx > 0 ? sects[curIdx - 1] : null;
    const next = curIdx < sects.length - 1 ? sects[curIdx + 1] : null;
    const updated = c && c.generatedAt ? `<span class="aii-updated">Updated ${esc(relTime(c.generatedAt))}</span>` : '';
    // Prev/Next INSIGHT bar — names the adjacent sections in this path (#136).
    const pnBar = (prev || next) ? `<div class="aii-pn">
        ${prev ? `<button type="button" class="aii-pn-btn" data-pn="prev">${BACK}<span class="aii-pn-tx"><span class="aii-pn-dir">Previous insight</span><span class="aii-pn-name">${esc(prev.name)}</span></span></button>` : '<span class="aii-pn-spacer" aria-hidden="true"></span>'}
        ${next ? `<button type="button" class="aii-pn-btn aii-pn-btn--next" data-pn="next"><span class="aii-pn-tx"><span class="aii-pn-dir">Next insight</span><span class="aii-pn-name">${esc(next.name)}</span></span>${ARROW}</button>` : '<span class="aii-pn-spacer" aria-hidden="true"></span>'}
      </div>` : '';
    // Modal: the sticky topbar owns Back; tab mode keeps its in-stage backrow.
    const backrow = scope.inModal ? '' : `
      <div class="aii-backrow">
        <button type="button" class="aii-back" data-back="sections">${BACK}<span>Back</span></button>
        ${updated}
      </div>`;
    return `<div class="aii-sub aii-content">
      ${condensed}
      ${backrow}
      ${pnBar}
      <div class="aii-overview ${stickyCtx ? 'aii-ovcard' : 'aii-overview-plain'}">
        <div class="aii-ov-toprow"><span class="aii-ov-topicpill">${esc(topicTitle)}</span><span class="aii-ov-eyebrow">${esc(p.label || '')}</span></div>
        <h3 class="aii-overview-title"><span class="aii-overview-title-ic">${sectionIcon(s.name)}</span>${esc(s.name)}</h3>
        ${desc ? `<p class="aii-overview-sub">${esc(desc)}</p>` : ''}
        <div class="im-quicklinks aii-quicklinks">
          <button type="button" class="im-qlink im-qlink-btn aii-qlink-btn" data-acc="sources">Sources</button>
          <button type="button" class="im-qlink im-qlink-btn aii-qlink-btn" data-acc="explore" aria-expanded="false">Ask AI</button>
          <button type="button" class="im-qlink im-qlink-btn aii-qlink-btn" data-acc="web" aria-expanded="false">Web Search</button>
        </div>
        <div class="aii-acc" data-accbody="explore"></div>
        <div class="aii-acc" data-accbody="web"></div>
      </div>
      <div class="im-aiflag-legend im-aiflag-legend--lg aii-aiflag-legend">${LOGO}<span>= AI-generated text</span></div>
      <p class="aii-brief-note">The below is an AI-generated summary of the topic at hand. Please verify important details with the linked sources.</p>
      <div class="ai-prov-slot aii-prov-slot"></div>
      <hr class="aii-rule">
      <div class="aii-content-body" data-loading="1">${genLoaderHTML()}</div>
      <div class="aii-headlines"></div>
    </div>`;
  }
  // "In the news" links for the current section. Grounding citations are the
  // source (the live pages the AI cited — broad reach), with the group RSS feed
  // pooled in as a fallback. The hard part is keeping them per-section: a group
  // overview is ONE generation, so its citations are pooled across all sections.
  //   1. If Gemini returned per-section attribution (a { section: [...] } map),
  //      use this section's slice directly — precise but the minority case.
  //   2. Otherwise split the flat pool ourselves by relevance (poolForSection),
  //      so each insight shows the stories that match IT, not the same shared
  //      list under every section.
  // Returns '' when there's nothing for this section so it's just the intro.
  // The deduped news items for THIS section (grounding citations first, RSS feed
  // pooled in as fallback). Shared by the "In the news" list AND the AI provenance
  // line, so the named publishers match the links shown below.
  // AI Intelligence insight bodies arrive as a flat blob (lead prose + bullets),
  // unlike the news brief's labelled sections. Wrap them into Summary (the lead
  // prose) + Key Takeaways (the bullets) so each insight reads as structured
  // intelligence with section icons + inline AI flags (#143).
  function sectionizeInsight(body) {
    const text = String(body || '').trim();
    if (!text || /^[ \t]*#{2,4}\s+/m.test(text)) return text; // already has headers
    const intro = []; const bullets = [];
    for (const ln of text.split('\n')) {
      if (/^\s*[*\-•]\s+/.test(ln)) bullets.push(ln);
      else if (bullets.length) { if (ln.trim()) bullets.push(ln); }   // wrapped bullet line
      else intro.push(ln);
    }
    const parts = [];
    const introTxt = intro.join('\n').trim();
    const bulletsTxt = bullets.join('\n').trim();
    if (introTxt) parts.push(`### Summary\n${introTxt}`);
    if (bulletsTxt) parts.push(`### Key Takeaways\n${bulletsTxt}`);
    return parts.length ? parts.join('\n\n') : text;
  }
  function sectionNewsItems() {
    const c = cache[curGroup]; if (!c) return [];
    const sections = c.sections || [];
    const curName = (sections[curIdx] || {}).name || '';
    const src = c.sources;
    // Citations for THIS section (grounding — broad reach): the accurate
    // per-section attribution map when Gemini returned one, otherwise split the
    // flat pool by relevance so each insight gets the ones that match IT.
    let cites = [];
    if (src && !Array.isArray(src) && Array.isArray(src[curName])) cites = src[curName];
    else if (Array.isArray(src) && src.length) cites = poolForSection(src, sections, curIdx);
    // Feed stories for THIS section: the server's per-section keyword-matched map
    // (so sections with no relevant citation still show real on-topic headlines
    // from our feed). Older payloads send a flat array — split it as a fallback.
    const hl = c.headlines;
    let feed = [];
    if (hl && !Array.isArray(hl)) feed = hl[curName] || [];
    else if (Array.isArray(hl) && hl.length) feed = poolForSection(hl, sections, curIdx);
    // Prefer the rich RSS feed (title + publisher · date); grounding citations
    // (publisher domain only) fill in behind it.
    const list = feed.concat(cites);
    // Dedup by URL AND by normalized title — the same story often appears in both
    // the grounding citations and the RSS feed under different URLs.
    const seen = new Set(); const seenT = new Set(); const out = [];
    for (const x of list) {
      const uri = x.uri || x.url || ''; if (!uri) continue;
      const ukey = uri.toLowerCase();
      let title, meta;
      if (x && (x.source || x.date)) {                 // rich RSS row
        let host = ''; try { host = new URL(uri).hostname.replace(/^www\./i, ''); } catch (_) {}
        title = String(x.title || '').trim() || host;
        meta = [(x.source || '').trim() || host, relTime(x.date)].filter(Boolean).join(' · ');
      } else {                                          // grounding citation (domain only)
        const dom = resolveSource({ title: x.title, uri }).domain || '';
        title = String(x.title || '').trim(); if (!title || /^https?:/i.test(title)) title = dom;
        meta = (dom && dom.toLowerCase() !== title.toLowerCase()) ? dom : '';
      }
      if (!title) continue;
      const tkey = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen.has(ukey) || (tkey && seenT.has(tkey))) continue;
      seen.add(ukey); if (tkey) seenT.add(tkey);
      out.push({ uri, title, meta });
      if (out.length >= 8) break;
    }
    return out;
  }
  function headlineListHTML() {
    // Same rich rows as the News/Trend Sources & Coverage (title + publisher ·
    // date), so the type + styling match across the family (#143).
    const rows = sectionNewsItems().map((x) =>
      `<a class="im-cov-row" href="${escAttr(x.uri)}" target="_blank" rel="noopener noreferrer"><span class="im-cov-text"><span class="im-cov-title">${esc(x.title)}</span>${x.meta ? `<span class="im-cov-host">${esc(x.meta)}</span>` : ''}</span>${EXT}</a>`);
    if (!rows.length) return '';
    return `<div class="im-coverage im-coverage--inline"><div class="im-section-title im-section-title--icon">${SOURCES_BADGE}<span>Sources &amp; Coverage</span></div><div class="im-coverage-list">${rows.join('')}</div></div>`;
  }
  // "Explore further on web" — the full Web Sources platform picker (source
  // types → platforms), searching this topic. Mirrors the Web Sources card.
  // Each source type is a native <details> accordion — clicking it drops its
  // platforms down IN PLACE (no next-page / back) (#30). One open at a time via
  // the shared name attribute.
  function webCatsHTML() {
    const cats = getExternalSearchCategories() || [];
    const searches = getExternalSearches() || [];
    const term = scope.label || scope.topic || '';
    const avail = cats.filter((c) => searches.some((s) => s.category === c.key));
    if (!avail.length) return '<p class="aii-empty">No web sources available.</p>';
    return `<div class="aii-web aii-web-acc">${avail.map((c) => {
      const rows = (searches.filter((s) => s.category === c.key)).map((s) => {
        const url = String(s.urlTemplate || '').replace(/\{query\}/g, encodeURIComponent(term));
        return `<a class="aii-web-row" href="${escAttr(url)}" target="_blank" rel="noopener noreferrer"><span class="aii-web-row-text"><span class="aii-web-row-name">${esc(s.name)}</span>${s.description ? `<span class="aii-web-row-desc">${esc(s.description)}</span>` : ''}</span>${EXT}</a>`;
      }).join('');
      return `<details class="aii-web-cat" name="aii-web-cat"><summary class="aii-web-cat-sum"><span>${esc(c.label)}</span>${CHEV}</summary><div class="aii-web-rows">${rows}</div></details>`;
    }).join('')}</div>`;
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

  // A cached brief may still contain sections for shortcuts that have since been
  // removed (the brief regenerates on its own slow cadence). Drop any section that
  // no longer maps to a current shortcut for this topic — `scope.descriptions` is
  // keyed by the live shortcut names. Guarded: if we have no description data,
  // don't filter (avoid hiding everything).
  function keepCurrentSections(sections) {
    const keys = new Set(Object.keys(scope.descriptions || {}).map((k) => k.toLowerCase().trim()));
    if (!keys.size) return sections;
    return sections.filter((s) => keys.has(String(s.name || '').toLowerCase().trim()));
  }
  async function loadGroup(group) {
    if (cache[group] && !cache[group].loading) return cache[group];
    cache[group] = { sections: [], loading: true };
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'shortcut', topic: scope.topic, group }) });
      const data = res.ok ? await res.json() : null;
      cache[group] = data && data.content
        ? { sections: keepCurrentSections(splitSections(data.content)), generatedAt: data.generatedAt, sources: data.sources || [], headlines: data.headlines || [], loading: false }
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

  function teardownSticky() { if (aiiObserver) { aiiObserver.disconnect(); aiiObserver = null; } }
  // Tab mode: reveal the condensed "path · section" bar once the overview card
  // scrolls out of the top of the brief. The scroll container is .aii-stage
  // (overflow:auto) — NOT the window — so the observer is rooted on it and the bar
  // is position:sticky;top:0 inside it. Tapping the bar scrolls the stage to top.
  function setupSticky() {
    teardownSticky();
    if ((!tabMode && !scope.inModal) || view !== 'content' || typeof IntersectionObserver === 'undefined') return;
    const ov = stage.querySelector('.aii-ovcard');
    // Tab mode: the bar is inline in the stage. Modal: it's the external,
    // persistent bar (a sibling of the stage — outside the slide transform) (#158).
    const cond = tabMode ? stage.querySelector('.aii-condensed') : container.querySelector('[data-cond-ext]');
    if (!ov || !cond) return;
    // Scroll container differs by context: .aii-stage in tab mode, the modal
    // body (.aii-modal-body — the component's own container) inside the modal.
    const scrollRoot = tabMode ? stage : (container.closest('.aii-modal-body') || container);
    aiiObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const top = e.rootBounds ? e.rootBounds.top : 0;
        cond.classList.toggle('is-on', !e.isIntersecting && e.boundingClientRect.top <= top + 1);
      }
    }, { root: scrollRoot, threshold: 0 });
    aiiObserver.observe(ov);
    // Tab mode wires the inline bar's tap-to-top here; the modal's external bar is
    // wired in updateExtCondensed().
    if (tabMode) {
      const condTop = cond.querySelector('[data-cond-top]') || cond;
      condTop.addEventListener('click', () => scrollRoot.scrollTo({ top: 0, behavior: 'smooth' }));
    }
  }

  // Open one of the content-page actions. `btn` is the clicked control (a card
  // quicklink OR a condensed-bar button); `fromCond` means it came from the
  // sticky bar (which lives away from the scrolled overview card, so we always
  // open the panel and jump the scroller to the top to bring it into view).
  function openAcc(btn, fromCond) {
    const name = btn.dataset.acc;
    const scrollRoot = scope.inModal ? (container.closest('.aii-modal-body') || container) : stage;
    if (name === 'sources') {
      const hl = stage.querySelector('.aii-headlines');
      if (hl && hl.firstChild) hl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const body = stage.querySelector(`[data-accbody="${name}"]`);
    const willOpen = fromCond || btn.getAttribute('aria-expanded') !== 'true';
    stage.querySelectorAll('.aii-actbtn, .aii-qlink-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    stage.querySelectorAll('.aii-acc').forEach((a) => a.classList.remove('is-open'));
    if (willOpen) {
      stage.querySelectorAll(`[data-acc="${name}"]:not(.aii-cond-act)`).forEach((b) => b.setAttribute('aria-expanded', 'true'));
      if (body && !body.dataset.ready) {
        body.innerHTML = name === 'web' ? webCatsHTML() : exploreHomeHTML();
        body.dataset.ready = '1';
      }
      body && body.classList.add('is-open');
      if (fromCond) scrollRoot.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function wire() {
    setupSticky();
    if (view === 'topic') wireTopicView();
    // Section content: briefly show the generating loader (even when cached)
    // then reveal the brief — gives the AI a moment of presence.
    const bodyEl = stage.querySelector('.aii-content-body[data-loading]');
    if (bodyEl) {
      const c = cache[curGroup]; const s = (c && c.sections[curIdx]) || { body: '' };
      setTimeout(() => {
        if (stage.querySelector('.aii-content-body') !== bodyEl) return;
        bodyEl.removeAttribute('data-loading');
        bodyEl.innerHTML = renderBriefBody(sectionizeInsight(s.body), null, { aiFlag: LOGO });
        bodyEl.classList.add('ai-reveal');
        // Reveal the real headline links with the brief (they're not part of the
        // synthesized body, so they live in their own block below the rule).
        const hl = stage.querySelector('.aii-headlines');
        if (hl) { hl.innerHTML = headlineListHTML(); if (hl.firstChild) hl.classList.add('ai-reveal'); }
        const prov = stage.querySelector('.aii-prov-slot');
        if (prov) { prov.innerHTML = aiProvenanceHTML(sectionNewsItems(), { badge: false }); prov.hidden = !prov.textContent.trim(); }
      }, 1000);
    }
    stage.querySelectorAll('.aii-pathrow').forEach((b) => b.addEventListener('click', async () => {
      curGroup = b.dataset.group;
      go('sections', 'fwd');
      await loadGroup(curGroup);
      // Re-render the menu in place if the user is still on this path.
      if (view === 'sections' && stage.dataset.view === 'sections') { stage.innerHTML = sectionsHTML(); wire(); }
    }));
    stage.querySelectorAll('.aii-menu-row, .aii-menu-card').forEach((b) => b.addEventListener('click', () => { curIdx = Number(b.dataset.idx); go('content', 'fwd'); }));
    stage.querySelectorAll('.aii-back').forEach((b) => b.addEventListener('click', () => go(b.dataset.back, 'back')));
    // Prev/Next INSIGHT — step through the path's sections (#136).
    stage.querySelectorAll('.aii-pn-btn[data-pn]').forEach((b) => b.addEventListener('click', () => {
      const c = cache[curGroup]; const n = (c && c.sections.length) || 0;
      const ni = b.dataset.pn === 'next' ? curIdx + 1 : curIdx - 1;
      if (ni < 0 || ni >= n) return;
      curIdx = ni; go('content', b.dataset.pn === 'next' ? 'fwd' : 'back');
    }));
    // Sources / Ask AI / Web Search. Sources jumps to the Sources & Coverage list;
    // Ask AI + Web Search open their panel in place. Only one panel open at a time.
    stage.querySelectorAll('.aii-actbtn, .aii-qlink-btn, .aii-cond-act').forEach((btn) => btn.addEventListener('click', (e) => {
      e.stopPropagation();   // sticky-bar buttons must not also trigger scroll-to-top
      openAcc(btn, btn.classList.contains('aii-cond-act'));
    }));
    // "Explore further on web" is now native <details> accordions (#30) — each
    // source type drops its platforms down in place, no JS wiring needed.
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
    // Deep-link from a desktop→mobile hand-off (#13): open straight to a section.
    if (scope.initialGroup && paths.some((p) => p.group === scope.initialGroup)) openTab(scope.initialGroup);
    else openTab(paths[0].group);     // default to the first path's sections
    // Listen for a hand-off from the desktop modal (resize → mobile): jump to
    // the section the user had open. Stored on the container so re-renders /
    // destroy can detach it (no leak).
    if (container._aiiSectionHandler) window.removeEventListener('aii-open-section', container._aiiSectionHandler);
    container._aiiSectionHandler = (e) => { const g = e && e.detail && e.detail.group; if (g && paths.some((p) => p.group === g)) openTab(g); };
    window.addEventListener('aii-open-section', container._aiiSectionHandler);
  } else if (launcher) {
    // Product launcher (#167). Home: the WHOLE card is the CTA — clicking anywhere
    // opens the modal at Step 1 (topic picker). Topic pages: track tiles → that
    // track's sections.
    stage.innerHTML = launcherPromoHTML();
    if (scope.topic === 'home') {
      const card = container.querySelector('.aii-launcher-cta');
      if (card) {
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        const openStep1 = () => window.dispatchEvent(new CustomEvent('open-ai-intelligence', { detail: { pickTopic: true } }));
        card.addEventListener('click', openStep1);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStep1(); } });
      }
    } else {
      stage.querySelectorAll('.aii-track').forEach((b) => b.addEventListener('click', () => window.dispatchEvent(new CustomEvent('open-ai-intelligence', { detail: {
        topic: scope.topic, label: scope.label, group: b.dataset.group,
        hideGroups: scope.hideGroups || [], descriptions: scope.descriptions || {},
      } }))));
    }
  } else if (scope.inModal && scope.pickTopic) {
    // Entered "anew" (bottom nav / homepage CTA) → Step 1: pick a topic.
    go('topic', 'fwd');
  } else if (scope.inModal && scope.initialGroup && paths.some((p) => p.group === scope.initialGroup)) {
    // Inside the modal, deep-link to the path the user clicked.
    curGroup = scope.initialGroup;
    go('sections', 'fwd');
    loadGroup(curGroup).then(() => { if (view === 'sections' && stage.dataset.view === 'sections') { stage.innerHTML = sectionsHTML(); wire(); } });
  } else {
    go('paths', 'fwd');
  }
  // Responsive: tabMode is fixed at render, so without this the first-render
  // layout (desktop paths-grid OR mobile secondary-tab nav) would stick across
  // a viewport resize. Re-render whenever the breakpoint is crossed.
  if (typeof window !== 'undefined' && window.matchMedia && scope.topic !== 'home' && !scope.inModal) {
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
    teardownSticky();
    if (container._aiiMq && container._aiiMqHandler) container._aiiMq.removeEventListener('change', container._aiiMqHandler);
    container._aiiMq = container._aiiMqHandler = null;
    if (container._aiiSectionHandler) window.removeEventListener('aii-open-section', container._aiiSectionHandler);
    container._aiiSectionHandler = null;
    container.innerHTML = '';
  } };
}
