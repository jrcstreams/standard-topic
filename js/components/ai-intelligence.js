// Living "AI Intelligence" component. A self-contained block that navigates in
// place: paths grid → that path's section menu → a section's AI analysis, with
// a back stack and slide transitions. Each path = a shortcut `group`
// (discover→Now, topic-specific→For This Topic, analyze→Analyze, learn→Learn);
// its sections come from the single cached per-(topic,group) brief, so once a
// path loads, hopping between its sections is instant.
import { renderBriefBody, resolveSource } from './newsfeed.js?v=20260612-revamp170';
import { aiProvenanceHTML } from '../utils/ai-provenance.js?v=20260612-revamp170';
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

  container.innerHTML = `
    <div class="aii${tabMode ? ' aii-tabmode' : ''}">
      <div class="aii-head">
        <div class="aii-head-top"><span class="aii-logo">${LOGO}</span><span class="aii-brand">AI Intelligence</span><span class="aii-live"><span class="aii-live-dot" aria-hidden="true"></span>Live</span></div>
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
    container.dataset.aiiGroup = curGroup || '';   // expose for the modal→tab hand-off (#13)
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
        <span class="aii-pathrow-text"><span class="aii-pathrow-name">${esc(p.tab || p.label)}</span><span class="aii-pathrow-sub">${esc(p.subtitle)}</span></span>
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
        <button type="button" class="aii-back" data-back="paths">${BACK}<span>Back</span></button>
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
    const desc = (scope.descriptions && scope.descriptions[s.name]) || '';
    // Tab mode: a condensed "path · section" bar that sticks to the top of the
    // scrolling brief (.aii-stage is the scroll container — the window doesn't
    // scroll here) once the overview card scrolls out of view. Collapsed to zero
    // until an IntersectionObserver (rooted on .aii-stage) reveals it, so it
    // overlays the top edge without shifting the brief. Tapping it scrolls back up.
    const stickyCtx = tabMode || scope.inModal;   // sticky sub-header in tab mode AND the modal
    const condensed = stickyCtx
      ? `<button type="button" class="aii-condensed" aria-hidden="true">
           <span class="aii-condensed-eyebrow">${esc(p.label || '')}</span>
           <span class="aii-condensed-title">${esc(s.name)}</span>
         </button>`
      : '';
    return `<div class="aii-sub aii-content">
      ${condensed}
      <button type="button" class="aii-back" data-back="sections">${BACK}<span>Back</span></button>
      <div class="aii-overview ${stickyCtx ? 'aii-ovcard' : 'aii-overview-plain'}">
        <div class="aii-overview-eyebrow">${esc(p.label || '')}</div>
        <h3 class="aii-overview-title">${esc(s.name)}</h3>
        ${desc ? `<p class="aii-overview-sub">${esc(desc)}</p>` : ''}
      </div>
      <div class="aii-brief-head">${SPARK}<span>AI Brief</span></div>
      <p class="aii-brief-note">The below is an AI-generated summary of the topic at hand. Please verify important details with the linked sources.</p>
      <div class="ai-prov-slot aii-prov-slot"></div>
      <div class="aii-actions aii-actions-row">
        <button type="button" class="aii-actbtn" data-acc="explore" aria-expanded="false"><span>Explore with AI</span>${CHEV}</button>
        <button type="button" class="aii-actbtn" data-acc="web" aria-expanded="false"><span>Explore on web</span>${CHEV}</button>
      </div>
      <div class="aii-acc" data-accbody="explore"></div>
      <div class="aii-acc" data-accbody="web"></div>
      <hr class="aii-rule">
      <div class="aigen-tag">${SPARK}<span>AI-generated</span></div>
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
    const rows = sectionNewsItems().map((x) =>
      `<li class="aii-hl-row"><a class="aii-hl-link" href="${escAttr(x.uri)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>${x.meta ? `<span class="aii-hl-src">${esc(x.meta)}</span>` : ''}</li>`);
    if (!rows.length) return '';
    return `<div class="aii-hl"><div class="aii-hl-head">Sources &amp; Coverage</div><ul class="aii-hl-list">${rows.join('')}</ul></div>`;
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
    const cond = stage.querySelector('.aii-condensed');
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
    cond.addEventListener('click', () => scrollRoot.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  function wire() {
    setupSticky();
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
        // Reveal the real headline links with the brief (they're not part of the
        // synthesized body, so they live in their own block below the rule).
        const hl = stage.querySelector('.aii-headlines');
        if (hl) { hl.innerHTML = headlineListHTML(); if (hl.firstChild) hl.classList.add('ai-reveal'); }
        const prov = stage.querySelector('.aii-prov-slot');
        if (prov) prov.innerHTML = aiProvenanceHTML(sectionNewsItems(), { badge: false });
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
          body.innerHTML = name === 'web' ? webCatsHTML() : exploreHomeHTML();
          body.dataset.ready = '1';
        }
        body && body.classList.add('is-open');
      }
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
    // Render the path tiles as a launcher; clicking one opens the modal.
    stage.innerHTML = pathsHTML();
    stage.querySelectorAll('.aii-pathrow').forEach((b) => b.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('open-ai-intelligence', { detail: {
        topic: scope.topic, label: scope.label, group: b.dataset.group,
        hideGroups: scope.hideGroups || [], descriptions: scope.descriptions || {},
      } }));
    }));
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
