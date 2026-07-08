// Living "AI Intelligence" component. A self-contained block that navigates in
// place: paths grid → that path's section menu → a section's AI analysis, with
// a back stack and slide transitions. Each path = a shortcut `group`
// (discover→Now, topic-specific→For This Topic, analyze→Analyze, learn→Learn);
// its sections come from the single cached per-(topic,group) brief, so once a
// path loads, hopping between its sections is instant.
import { renderBriefBody, resolveSource } from './newsfeed.js?v=20260706-revamp503';
import { aiProvenanceHTML } from '../utils/ai-provenance.js?v=20260706-revamp503';
import { getModels, getModelById, getDefaultModelId, getExternalSearches, getExternalSearchCategories, getTopicsGroupedByParent, getShortcutsForTopic, getShortcutsDirectory, getSubmissionMethods, getPromptGenData } from '../utils/data.js';
import { openModel, copyPrompt, getPreferredModelId, setPreferredModelId } from '../utils/ai-models.js';
import { assemblePrompt } from '../utils/prompt-assembly.js';
import { REASONING_LEVELS } from '../utils/settings.js';
import { renderIcon } from '../utils/icons.js';
import { topicIconSVG } from '../utils/topic-icons.js';
import { insightTabsHTML, wireInsightTabs } from '../utils/insight-tabs.js?v=20260706-revamp503';
import { exploreFurtherHTML, wireExploreFurther } from '../utils/explore-further.js?v=20260706-revamp503';

// Display metadata for the paths (the navigation categories). Each `group`
// matches a shortcut group + the server-side data/ai-paths.json (which also
// holds the refresh class). Kept inline so the component never depends on a
// freshly-changed data.js (the no-version singleton).
const PATHS = [
  { group: 'discover',       label: "What's Happening Now",   tab: 'Catch Up', subtitle: 'The latest news, moves, and developments.', cardTitle: 'The big picture, quickly' },
  { group: 'topic-specific', label: 'Deep Dive',              tab: 'Deep Dive',     subtitle: 'The key developments in depth — plus the tradeoffs and what they mean.', cardTitle: 'Go beneath the headlines' },
  { group: 'learn',          label: 'Learn',                   tab: '101 Info', subtitle: 'Background, fundamentals, and key context.',  cardTitle: 'Start from the basics' },
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
// Diagonal "open this" affordance on each preview link — signals the row opens an insight.
const OPEN_DIAG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const EXT = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>';
const CHEV = '<svg class="aii-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
// Section-icon badge for "Sources & Coverage" (link glyph) — matches the brief
// section glyphs + the News/Trend modals (#129).
const SOURCES_BADGE = '<span class="ai-result-sub-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>';
const EXPLORE_BADGE = '<span class="ai-result-sub-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg></span>';
// Small inline spark for the "AI Brief" eyebrow (matches the news modal).
const SPARK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/></svg>';
const SEARCH_ICON = '<svg class="aii-topic-search-ic" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
// Trending-style head chevrons (sized by .im-headnav-arrow CSS) + action-link icons.
const HNAV_L = '<svg class="im-headnav-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const HNAV_R = '<svg class="im-headnav-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
const ICON_ASK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.6 4.6a2 2 0 0 0 1.3 1.3L19.5 10l-4.6 1.6a2 2 0 0 0-1.3 1.3L12 17l-1.6-4.6a2 2 0 0 0-1.3-1.3L4.5 10l4.6-1.6a2 2 0 0 0 1.3-1.3z"/></svg>';
const ICON_GLOBE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/></svg>';
// Home-promo feature-row icons.
const ICON_FEAT_GLOBE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/></svg>';
const ICON_FEAT_BOLT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 4 14 11 14 11 22 20 10 13 10 13 2"/></svg>';
const ICON_FEAT_REFRESH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
const ICON_FEAT_SEARCH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
// In-page section icons (match the News/Trend modal SEC_ICON set).
const AII_SEC_ICON = {
  summary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="7" y1="12" x2="14" y2="12"/><line x1="7" y1="16" x2="11" y2="16"/></svg>',
  takeaways: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  sources: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
};
function aiiSecIconKey(name) {
  const n = String(name || '').toLowerCase();
  if (/takeaway|key point|highlight/.test(n)) return 'takeaways';
  if (/source|coverage/.test(n)) return 'sources';
  return 'summary';
}
function aiiSecHead(key, name) {
  // Icon sits inline-left of the title (top-aligned; title wraps in its own column,
  // never under the icon). The "AI Generated Text" tag is ALWAYS on its own line,
  // left-aligned, below the head — never inline with the title.
  const tag = key === 'sources' ? '' : `<div class="im-sec-aitag-row"><span class="im-sec-aitag">${LOGO}<span>AI Generated Text</span></span></div>`;
  return `<div class="im-msec-head"><span class="im-msec-ic">${AII_SEC_ICON[key] || AII_SEC_ICON.summary}</span><h3 class="im-msec-name">${esc(name)}</h3></div>${tag}`;
}
function aiiMsec(id, name, inner) { return `<section class="im-msec" id="${id}" data-name="${escAttr(name)}">${inner}</section>`; }
// Paper-plane (Direct Submit — "send it off") and an eye (Review — "preview").
const ICON_SEND = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2.5L11 13"/><path d="M21.5 2.5L15 21l-4-8-8-4z"/></svg>';
// Brief generating loader — spark pulse + shimmer bars (occupies the space the
// brief will fill). Shown briefly on section open even when cached.
function genLoaderHTML() {
  return `<div class="aii-gen"><div class="aii-gen-spark">${SPARK}</div><div class="aii-gen-label">Generating AI insights…</div><div class="aii-gen-bars"><span></span><span></span><span></span><span></span></div></div>`;
}
const ICON_EYES = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_COPY_MINI = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="8" height="9" rx="1.2"/><path d="M9.5 3.5V2.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1"/></svg>';
const ICON_GEAR = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
const ICONS = {
  discover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 10.5 10.5 8.5 15.5 13.5 13.5"/></svg>',
  learn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15a2 2 0 0 0-2-1.5H2z"/><path d="M22 5a2 2 0 0 0-2-2h-6a2 2 0 0 0-2 2v15a2 2 0 0 1 2-1.5h8z"/></svg>',
  analyze: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="13"/><line x1="12" y1="20" x2="12" y2="8"/><line x1="18" y1="20" x2="18" y2="4"/></svg>',
  'topic-specific': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15 9 22 9.3 16.5 13.9 18.5 21 12 16.8 5.5 21 7.5 13.9 2 9.3 9 9"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>',
  websearch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>',
  _: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>',
};
// Per-track accent — gives each launcher tile its own identifiable colour
// (icon chip tint + hover edge), so the card reads as a real product (#167).
const AII_ACCENTS = { discover: '#2563eb', 'topic-specific': '#d97706', analyze: '#7c3aed', learn: '#0d9488', websearch: '#7c3aed', external: '#4f46e5', _: '#2563eb' };

// scope: { topic: '<Topic Name>' | 'home', label: '<display>' }
export function renderAIIntelligence(container, scope) {
  // Hide paths that don't apply to this scope (e.g. "For This Topic" on the
  // homepage, which has no topic-specific content).
  const hide = scope.hideGroups || [];
  const paths = PATHS.filter((p) => !hide.includes(p.group));
  // Two static (non-AI) tabs/tiles folded into the AI Insights card, after the
  // builders: "Web Search" (the web platform picker) and "External Insights" (the
  // shortcut prompts to explore in an external model). External Insights is LAST.
  const EXTERNAL_GROUP = 'external';
  const WEBSEARCH_GROUP = 'websearch';
  const webSearchTab = { group: WEBSEARCH_GROUP, tab: 'Web Search', subtitle: "Search this topic across the web's primary sources and platforms." };
  const externalTab = { group: EXTERNAL_GROUP, tab: 'Prompts', subtitle: 'Ready-made prompts to run this topic in the AI model of your choice.' };
  // Caller-supplied EXTRA tabs (custom search folds News + Trending in here):
  // each { group, tab, subtitle, icon (svg string), render(wrapEl) } is a static
  // (non-AI) tab whose body the caller renders. Inserted after the AI paths and
  // before Web Search + External Insights (External Insights stays LAST).
  const extraTabs = (Array.isArray(scope.extraTabs) ? scope.extraTabs : []).filter((t) => t && t.group);
  const extraGroups = new Set(extraTabs.map((t) => t.group));
  const isStaticGroup = (g) => g === EXTERNAL_GROUP || g === WEBSEARCH_GROUP || extraGroups.has(g);
  // Resolve a group key to its tab descriptor (AI path / built-in static / extra).
  function tabByGroup(g) {
    return paths.find((p) => p.group === g)
      || (g === WEBSEARCH_GROUP ? webSearchTab : (g === EXTERNAL_GROUP ? externalTab : null))
      || extraTabs.find((e) => e.group === g)
      || null;
  }
  // Default tab set: the AI paths, then any caller extra tabs, then Web Search +
  // External Insights (External stays LAST). A caller can override the exact set
  // AND order via scope.builderTabOrder (a list of group keys) — e.g. custom
  // search drops the AI-generation tabs and leads with External Insights.
  const builderTabs = () => {
    if (Array.isArray(scope.builderTabOrder) && scope.builderTabOrder.length) {
      return scope.builderTabOrder.map(tabByGroup).filter(Boolean);
    }
    return paths.concat(extraTabs).concat([webSearchTab, externalTab]);
  };
  // Section-header icon for a builder tab — caller's extra-tab icon first, then the
  // path glyph, then the generic fallback.
  function builderTabIcon(group) {
    const e = extraTabs.find((x) => x.group === group);
    return (e && e.icon) || ICONS[group] || ICONS._;
  }
  // Two-level builder nav (the redesign): a MAIN nav of "AI Brief / External
  // Insights / Web Search", and — when AI Brief is active — a SUBNAV of the four
  // brief sections (Get Caught Up / Deep Dive / Analysis / 101 Resources). Used in
  // the modal (full PATHS). Custom search (scope.builderTabOrder, no brief groups)
  // keeps the flat single-row tabs instead.
  const isBriefGroup = (g) => paths.some((p) => p.group === g);
  const twoLevelNav = () => paths.length > 0 && !(Array.isArray(scope.builderTabOrder) && scope.builderTabOrder.length);
  // Remember the last AI-brief section so re-selecting the "AI Brief" main tab
  // returns to where the user was (defaults to the first path).
  let lastBriefGroup = (paths[0] && paths[0].group) || null;
  // When the topic-picker is opened FROM a builder (via the topic caret), remember
  // which builder so the picker can offer a "Back" link to return to it (#172).
  let pickerReturnGroup = null;
  // Normalized description lookup: brief section headers can differ from the
  // shortcut names by case/whitespace, so an exact map miss left cards blank.
  const normName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const descByNorm = {};
  Object.keys(scope.descriptions || {}).forEach((k) => { descByNorm[normName(k)] = scope.descriptions[k]; });
  const lookupDesc = (name) => (scope.descriptions && scope.descriptions[name]) || descByNorm[normName(name)] || '';
  const cache = {};               // group -> { sections, generatedAt, sources, loading, error }
  const builderCache = {};        // group -> { content, generatedAt, sources, headlines, loading, error } (the new master-prompt insight)
  let view = 'paths';             // 'paths' | 'sections' | 'content' | 'builder'
  let curGroup = null;
  let curIdx = 0;
  let aiiObserver = null;         // tab-mode: watches the overview card (root = .aii-stage scroller) to toggle the sticky condensed bar
  let aiiSpyHandler = null, aiiSpyRoot = null;   // modal content view: AI Brief pill scroll-spy
  // Tab mode: on a topic page at mobile width, the paths become a secondary tab
  // bar (under the primary News Feed / AI Intelligence / Web Sources tabs)
  // instead of the flip-nav landing list.
  // NOT inside the modal — the modal always runs the full flip-nav (topic → path
  // → insight → brief); tab mode is only the inline AI Intelligence tab on a
  // narrow topic page. (The modal hands off + closes on resize to mobile anyway.)
  // Mobile topic-page inline context (kept only for CSS/section sizing — it now
  // shows the SAME track-picker launcher as desktop, not an in-body flip-nav).
  const tabMode = !scope.inModal
    && scope.topic !== 'home'
    && typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(max-width: 899.98px)').matches;
  // Launcher = every NON-modal surface: the homepage promo card AND every topic
  // page (desktop + mobile). It lists the tracks; clicking one opens the MODAL
  // deep-linked to that topic+track. AI Insights is ALWAYS experienced in the modal.
  const launcher = !scope.inModal;
  // Flow mode = the full flip-nav (topic → path → insight). Runs ONLY in the modal.
  const flowMode = scope.inModal;
  const scrollRootEl = () => container.closest('.aii-modal-body, .search-panel-results') || stage;

  const topicTitle = scope.topic === 'home' ? "Today's World" : (scope.label || scope.topic || '');

  // Sticky modal header (#173): a "Back" pill, the topic title (left-aligned,
  // click to re-pick the topic), the "Updated …" stamp to its right, and the
  // current path/insight context row below. Rebuilt per view by updateTopbar().
  function updateTopbar() {
    const tb = container.querySelector('[data-topbar]');
    if (!tb) return;
    // The topic picker AND the content view (which now owns a Trending-style
    // sticky head) hide this topbar; only paths/sections picker pages use it.
    if (view === 'topic' || view === 'content' || view === 'builder') { tb.hidden = true; tb.innerHTML = ''; return; }
    tb.hidden = false;
    const p = paths.find((x) => x.group === curGroup) || {};
    const back = `<button type="button" class="im-headnav-link im-headnav-back aii-tb-back" data-tb-back>${HNAV_L}Back</button>`;
    if (view === 'sections') {
      // Insight picker: the TOPIC is a small grey/black pill (context, not headline),
      // and the chosen TRACK is the prominent header. No "Updated" stamp here — that
      // belongs on the insight page itself.
      tb.innerHTML = `${back}
        <div class="aii-tophead aii-tophead--sections"><span class="aii-top-topic-pill">${esc(topicTitle)}</span></div>
        <div class="aii-top-context"><span class="aii-top-context-ic aii-icon-${escAttr(curGroup)}">${ICONS[curGroup] || ICONS._}</span><div class="aii-top-context-tx"><span class="aii-top-context-name">${esc(p.label || '')}</span>${p.subtitle ? `<span class="aii-top-context-sub">${esc(p.subtitle)}</span>` : ''}</div></div>`;
    } else {
      // Track picker: the topic title is the page heading.
      tb.innerHTML = `${back}<div class="aii-tophead"><h2 class="aii-top-topic-name">${esc(topicTitle)}</h2></div>`;
    }
    tb.querySelector('[data-tb-back]')?.addEventListener('click', onBack);
  }
  function onBack() {
    if (view === 'content') go('sections', 'back');
    else if (view === 'sections') go('paths', 'back');
    else if (view === 'paths') go('topic', 'back');
  }

  // Step 1 — pick a topic. Browse the SAME parent→subtopic hierarchy as the All
  // Topics modal (accordions), or search to filter to a flat result list.
  function topicResultBtn(key, name, parentName) {
    return `<button type="button" class="at-sub aii-tp-result" data-tp-key="${escAttr(key)}"><span class="aii-tp-result-name">${esc(name)}</span>${parentName ? `<span class="aii-tp-result-parent">${esc(parentName)}</span>` : ''}</button>`;
  }
  function topicListHTML(filter) {
    const f = String(filter || '').toLowerCase().trim();
    if (f) {
      const term = String(filter).trim();
      const items = (scope.allTopics || []).filter((t) => String(t.name).toLowerCase().includes(f) || String(t.parentName || '').toLowerCase().includes(f));
      // ALWAYS offer to run the typed term as a custom search (so any term works,
      // not just known topics) — #221.
      const customCta = `<button type="button" class="aii-tp-custom" data-tp-custom="${escAttr(term)}">
        <span class="aii-tp-custom-badge" aria-hidden="true">+</span>
        <span class="aii-tp-custom-tx"><span class="aii-tp-custom-action">Search</span><span class="aii-tp-custom-term">${esc(term)}</span></span>
        ${ARROW}
      </button>`;
      const list = items.length
        ? `<div class="aii-tp-results">${items.map((t) => topicResultBtn(t.key, t.name, t.parentName)).join('')}</div>`
        : '<p class="aii-tp-empty">No matching topic — search it as a custom term:</p>';
      return list + customCta;
    }
    const accent = '#475569';
    const home = `<button type="button" class="at-acc-flat aii-tp-home" data-tp-key="home" style="--ti-accent:#3261a0;">
        <span class="at-acc-flat-icon">${topicIconSVG('globe', '')}</span>
        <span class="at-acc-flat-name">Today's World</span>
        <span class="at-acc-flat-chev">${ARROW}</span>
      </button>`;
    const accs = getTopicsGroupedByParent().map(({ parent, subtopics }) => {
      if (!subtopics.length) {
        return `<button type="button" class="at-acc-flat" data-tp-key="${escAttr(parent.slug)}" style="--ti-accent:${accent};">
          <span class="at-acc-flat-icon">${topicIconSVG(parent.icon || 'globe', '')}</span>
          <span class="at-acc-flat-name">${esc(parent.name)}</span>
          <span class="at-acc-flat-chev">${ARROW}</span>
        </button>`;
      }
      const subs = `<button type="button" class="at-sub at-sub-parent" data-tp-key="${escAttr(parent.slug)}">All ${esc(parent.name)}<span class="at-sub-arrow" aria-hidden="true">${ARROW}</span></button>`
        + subtopics.map((s) => `<button type="button" class="at-sub" data-tp-key="${escAttr(s.slug)}">${esc(s.name)}</button>`).join('');
      return `<details class="ti-accordion at-acc" style="--ti-accent:${accent};">
        <summary class="ti-accordion-summary">
          <span class="ti-accordion-icon" aria-hidden="true">${topicIconSVG(parent.icon || 'globe', '')}</span>
          <span class="ti-accordion-title">${esc(parent.name)}</span>
          <span class="ti-accordion-chev" aria-hidden="true">${CHEV}</span>
        </summary>
        <div class="ti-accordion-body"><div class="at-subs">${subs}</div></div>
      </details>`;
    }).join('');
    return `${home}<div class="ti-accordions aii-tp-accs">${accs}</div>`;
  }
  function topicViewHTML() {
    // "Back" link — only when we arrived here from a builder (the topic caret), so
    // the user can return to the insight they were reading (#172).
    const backLink = pickerReturnGroup ? `<button type="button" class="aii-tp-back" data-tp-back><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg><span>Back</span></button>` : '';
    return `<div class="aii-tp">
      ${backLink}
      <div class="aii-tp-head">
        <h3 class="aii-tp-title">Get AI insights on any topic</h3>
        <p class="aii-tp-sub">Search any term or browse by topic.</p>
      </div>
      <div class="aii-tp-field">
        <span class="aii-tp-fieldlabel">Search</span>
        <div class="aii-tp-searchwrap aii-tp-searchwrap--lg">${SEARCH_ICON}<input type="text" class="aii-tp-search" placeholder="Search any topic or term…" aria-label="Search any topic or term"></div>
      </div>
      <div class="aii-tp-browselabel" data-tp-browselabel>Browse by Topic</div>
      <div class="aii-tp-list" data-tp-list>${topicListHTML('')}</div>
    </div>`;
  }
  function wireTopicView() {
    const search = stage.querySelector('.aii-tp-search');
    const list = stage.querySelector('[data-tp-list]');
    // "Back" → return to the builder we came from (#172).
    stage.querySelector('[data-tp-back]')?.addEventListener('click', () => {
      const g = pickerReturnGroup; pickerReturnGroup = null;
      if (g) { curGroup = g; go('builder', 'back'); }
    });
    // "Search <term>" → run the typed term as a custom search (#221).
    const wireCustom = () => stage.querySelectorAll('[data-tp-custom]').forEach((b) => b.addEventListener('click', () => {
      const term = b.dataset.tpCustom; if (!term) return;
      window.dispatchEvent(new CustomEvent('close-all-modals'));
      window.location.hash = '#/custom/' + encodeURIComponent(term);
    }));
    wireCustom();
    if (!list) return;
    const browseLabel = stage.querySelector('[data-tp-browselabel]');
    // Edge fades: hint there are more topics above/below the scroll window. Top
    // fade only once scrolled (so the first row reads crisp at rest), bottom fade
    // whenever the list overflows below the fold.
    const updateFade = () => {
      list.classList.toggle('aii-tp-list--fadetop', list.scrollTop > 4);
      list.classList.toggle('aii-tp-list--fadebot', list.scrollTop + list.clientHeight < list.scrollHeight - 4);
    };
    const wireKeys = () => list.querySelectorAll('[data-tp-key]').forEach((b) => b.addEventListener('click', () => { if (scope.onChangeTopic) scope.onChangeTopic(b.dataset.tpKey); }));
    if (search) search.addEventListener('input', () => {
      const q = search.value.trim();
      if (browseLabel) browseLabel.textContent = q ? 'Results' : 'Browse by Topic';
      list.innerHTML = topicListHTML(search.value); wireKeys(); wireCustom();
      requestAnimationFrame(updateFade);
    });
    // Enter runs the typed term as a custom search (or opens the first matching
    // topic if there's an exact-ish match) — #225.
    if (search) search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const term = search.value.trim(); if (!term) return;
      e.preventDefault();
      const firstKey = list.querySelector('[data-tp-key]')?.dataset.tpKey;
      const exact = (scope.allTopics || []).find((t) => String(t.name).toLowerCase() === term.toLowerCase());
      if (exact && scope.onChangeTopic) { scope.onChangeTopic(exact.key); return; }
      window.dispatchEvent(new CustomEvent('close-all-modals'));
      window.location.hash = '#/custom/' + encodeURIComponent(term);
    });
    list.addEventListener('scroll', updateFade, { passive: true });
    wireKeys();
    requestAnimationFrame(updateFade);
  }

  container.innerHTML = `
    <div class="aii${tabMode ? ' aii-tabmode' : ''}${flowMode ? ' aii-flow' : ''}${launcher ? ' aii-launcher' : ''}${launcher && scope.topic === 'home' ? ' aii-launcher-cta' : ''}">
      <div class="aii-head">
        <div class="aii-head-row">
          <div class="aii-head-top"><span class="aii-logo">${LOGO}</span><span class="aii-brand">AI Insights &amp; Resources</span></div>
        </div>
        <p class="aii-headsub">Get the perspectives and tools you need to stay ahead.</p>
      </div>
      ${flowMode ? '<div class="aii-topbar" data-topbar hidden></div>' : ''}
      <div class="aii-stage" data-view="paths"></div>
    </div>`;
  const stage = container.querySelector('.aii-stage');
  if (flowMode) setupExploreDelegation();   // one-time: handles head + inline explore menus

  function setActiveSubtab() {
    if (!tabMode) return;
    container.querySelectorAll('.aii-subtab').forEach((b) => b.classList.toggle('is-active', b.dataset.group === curGroup));
  }
  function go(v, dir) {
    view = v; stage.dataset.view = v;
    container.dataset.aiiGroup = curGroup || '';   // expose for the modal→tab hand-off (#13)
    container.dataset.aiiView = v;                  // expose the step so the modal can swap its header chrome
    if (scope.onView) try { scope.onView(v); } catch (_) {}
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
    return view === 'topic' ? topicViewHTML()
      : view === 'paths' ? pathsHTML()
      : view === 'builder' ? builderHTML()
      : view === 'sections' ? sectionsHTML()
      : contentHTML();
  }

  // Launcher (#167). HOME → a 3-step promo that sells the click-through (pick a
  // topic → pick a path → get insights) with one CTA into the modal's Step 1.
  // TOPIC PAGES (topic already chosen) → the direct track tiles (pick a path).
  const ICON_TOPICS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></svg>';
  // HOME promo (#237/#263): a value-prop on the dark flagship card — bold display
  // headline + a DISTINCT lighter tagline, a neutral feature row, and a real teal
  // CTA button. The whole card is still the CTA (the button is the cue).
  function launcherStepsHTML() {
    return `<div class="aii-promo aii-promo--cta">
      <div class="aii-promo-head"><span class="aii-promo-ic" aria-hidden="true">${LOGO}</span><h3 class="aii-promo-headline">Understand any topic, fast.</h3></div>
      <p class="aii-promo-line">Pick a topic or search anything and get AI-generated insights.</p>
      <span class="aii-promo-btn">Explore AI Insights ${RIGHT_ARROW}</span>
    </div>`;
  }
  // The topic SLUG for preview lookups (modal sets scope.topicKey; the in-body
  // launcher gets it from app.js; home is its own key).
  function topicKeyForPreviews() {
    return scope.topicKey || (scope.topic === 'home' ? 'home' : '');
  }
  // A rich TRACK CARD — the shared centerpiece of every "Choose a track" surface
  // (in-body launcher on topic pages + home, AND the modal's path picker). Shows
  // the track identity (icon + title + tagline), up to 3 curated insight teasers
  // that link straight in, and a "view all" action. Markup is identical across
  // contexts; only the click wiring differs (see wireTrackCards).
  // Preview/teaser shortcuts for a track card. Admin-curated picks first
  // (window.__assignmentsData.featuredShortcuts, keyed `${slug}_${group}` →
  // `${group}`), then filled from the topic's own shortcuts in that group so a
  // card is never empty. Computed in-component (no new data.js export) to dodge
  // the no-version data.js singleton cache.
  function trackPreviewsFor(group) {
    const key = topicKeyForPreviews();
    let dir = [];
    try { dir = getShortcutsDirectory() || []; } catch (_) {}
    const dirMap = {};
    dir.forEach((s) => { if (s && s.id) dirMap[s.id] = s; });
    const featured = (typeof window !== 'undefined' && window.__assignmentsData && window.__assignmentsData.featuredShortcuts) || {};
    const ids = featured[`${key}_${group}`] || featured[group] || [];
    const list = ids.map((id) => dirMap[id]).filter(Boolean);
    if (list.length < 3) {
      const have = new Set(list.map((s) => s.id));
      let topical = [];
      try { topical = getShortcutsForTopic(key) || []; } catch (_) {}
      for (const s of topical) { if (list.length >= 3) break; if (s.group === group && !have.has(s.id)) { list.push(s); have.add(s.id); } }
    }
    return list.slice(0, 3);
  }
  function trackCardHTML(p) {
    let previews = [];
    try { previews = trackPreviewsFor(p.group) || []; } catch (_) {}
    // Preview teasers are NAME-ONLY on the track-picker cards — condensed quick
    // links into each track (the summary text only adds clutter when you're still
    // choosing). The blurb lives on the section page one tap further in.
    const prevHTML = previews.map((s) => `
      <button type="button" class="aii-tcp" data-group="${escAttr(p.group)}" data-shortcut="${escAttr(s.id)}" data-insight="${escAttr(s.name)}">
        <span class="aii-tcp-name">${esc(s.name)}</span>
        <span class="aii-tcp-go" aria-hidden="true">${OPEN_DIAG}</span>
      </button>`).join('');
    return `<div class="aii-trackcard" data-group="${escAttr(p.group)}">
      <button type="button" class="aii-trackcard-head" data-group="${escAttr(p.group)}">
        <span class="aii-trackcard-ic aii-icon-${escAttr(p.group)}">${ICONS[p.group] || ICONS._}</span>
        <span class="aii-trackcard-name">${esc(p.tab || p.label)}</span>
        <span class="aii-trackcard-go" aria-hidden="true">${RIGHT_ARROW}</span>
        <span class="aii-trackcard-sub">${esc(p.subtitle)}</span>
      </button>
      ${prevHTML ? `<div class="aii-trackcard-previews">${prevHTML}</div>` : ''}
      <button type="button" class="aii-trackcard-more" data-group="${escAttr(p.group)}">Explore ${esc(p.tab || p.label)} ${RIGHT_ARROW}</button>
    </div>`;
  }
  // Wire a grid of track cards. `open(group, insightName|null)` is supplied per
  // context: the launcher opens the modal (deep-linked to the track, or straight to
  // a specific insight when a preview is clicked); the modal drills in place.
  function wireTrackCards(root, open) {
    root.querySelectorAll('.aii-trackcard-head, .aii-trackcard-more').forEach((b) => b.addEventListener('click', () => open(b.dataset.group, null)));
    root.querySelectorAll('.aii-tcp').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); open(b.dataset.group, b.dataset.insight || null); }));
  }

  // ===== Desktop sidebar (≥900): collapsible sections =======================
  // The desktop topic sidebar is a stack of collapsible sections — one per track
  // (Live / Research / Analysis / Learn), plus a "Sources" section that folds the
  // old Web Sources card in. All open by default; the header toggles each open/shut.
  // The FULL set of a track's insight shortcuts (no slice) so we can show the
  // first few and offer "View more" when there are extras.
  function trackItemsFor(group) {
    const key = topicKeyForPreviews();
    let dir = [];
    try { dir = getShortcutsDirectory() || []; } catch (_) {}
    const dirMap = {};
    dir.forEach((s) => { if (s && s.id) dirMap[s.id] = s; });
    const featured = (typeof window !== 'undefined' && window.__assignmentsData && window.__assignmentsData.featuredShortcuts) || {};
    const ids = featured[`${key}_${group}`] || featured[group] || [];
    const list = ids.map((id) => dirMap[id]).filter(Boolean);
    const have = new Set(list.map((s) => s.id));
    let topical = [];
    try { topical = getShortcutsForTopic(key) || []; } catch (_) {}
    for (const s of topical) { if (s.group === group && !have.has(s.id)) { list.push(s); have.add(s.id); } }
    return list;
  }
  const SIDEBAR_PREVIEW = 4;   // items shown before "View more"
  function sidebarSecHTML(p) {
    let items = [];
    try { items = trackItemsFor(p.group) || []; } catch (_) {}
    const shown = items.slice(0, SIDEBAR_PREVIEW);
    const itemsHTML = shown.map((s) => `
      <button type="button" class="aii-tcp" data-group="${escAttr(p.group)}" data-shortcut="${escAttr(s.id)}" data-insight="${escAttr(s.name)}">
        <span class="aii-tcp-name">${esc(s.name)}</span>
        <span class="aii-tcp-go" aria-hidden="true">${OPEN_DIAG}</span>
      </button>`).join('');
    const more = items.length > shown.length
      ? `<button type="button" class="aii-sec-more" data-group="${escAttr(p.group)}">View more ${RIGHT_ARROW}</button>`
      : '';
    const body = itemsHTML
      ? `<div class="aii-sec-items">${itemsHTML}</div>${more}`
      : '<p class="aii-sec-empty">Insights are being generated — check back shortly.</p>';
    return `<div class="aii-sec aii-sec-${escAttr(p.group)}" data-group="${escAttr(p.group)}" data-open="true">
      <button type="button" class="aii-sec-head" aria-expanded="true">
        <span class="aii-sec-dot aii-dot-${escAttr(p.group)}" aria-hidden="true"></span>
        <span class="aii-sec-name">${esc(p.tab || p.label)}</span>
        <span class="aii-sec-chev" aria-hidden="true">${CHEV}</span>
      </button>
      <div class="aii-sec-body"><div class="aii-sec-inner">${body}</div></div>
    </div>`;
  }
  // Sources section — the old Web Sources card, folded in. Body is the same
  // category accordion (webCatsHTML) so each category keeps its own dropdown.
  function sidebarSourcesHTML() {
    return `<div class="aii-sec aii-sec-sources" data-open="true">
      <button type="button" class="aii-sec-head" aria-expanded="true">
        <span class="aii-sec-dot aii-dot-sources" aria-hidden="true"></span>
        <span class="aii-sec-name">Web Search</span>
        <span class="aii-sec-chev" aria-hidden="true">${CHEV}</span>
      </button>
      <div class="aii-sec-body"><div class="aii-sec-inner aii-sec-inner--sources">${webCatsHTML()}</div></div>
    </div>`;
  }
  // The new launcher tile: one card per builder (Get Caught Up / Deep Dive /
  // Analysis / 101 Resources). The WHOLE card opens the modal straight to that
  // group's master-prompt insight — no track→section picker.
  function builderCardHTML(p) {
    // Icon sits INLINE with the title (head row); the summary sits BELOW. Desktop
    // = a horizontal row of these; mobile = a condensed icon grid (icon over the
    // label, summary hidden) — both driven by CSS off this one markup.
    return `<button type="button" class="aii-bcard aii-bcard-${escAttr(p.group)}" data-builder-open data-group="${escAttr(p.group)}">
      <span class="aii-bcard-head"><span class="aii-bcard-ic">${ICONS[p.group] || ICONS._}</span><span class="aii-bcard-name">${esc(p.tab || p.label)}</span></span>
      ${p.subtitle ? `<span class="aii-bcard-sub">${esc(p.subtitle)}</span>` : ''}
      <span class="aii-bcard-go" aria-hidden="true">${RIGHT_ARROW}</span>
    </button>`;
  }
  function wireSidebarSecs(root, open) {
    // Builder card → open the modal straight to that group's insight.
    root.querySelectorAll('[data-builder-open]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); open(b.dataset.group, null); }));
    // Header → toggle the section open/shut (legacy collapsible sections, if present).
    root.querySelectorAll('.aii-sec > .aii-sec-head').forEach((b) => b.addEventListener('click', () => {
      const sec = b.closest('.aii-sec');
      const isOpen = sec.getAttribute('data-open') === 'true';
      sec.setAttribute('data-open', String(!isOpen));
      b.setAttribute('aria-expanded', String(!isOpen));
    }));
    // Preview item → open the modal at that specific insight.
    root.querySelectorAll('.aii-tcp').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); open(b.dataset.group, b.dataset.insight || null); }));
    // "View more" → open the modal at that track's full insight list.
    root.querySelectorAll('.aii-sec-more').forEach((b) => b.addEventListener('click', () => open(b.dataset.group, null)));
    // The Sources category dropdowns are native <details> — no JS needed.
  }
  // Topic-page launcher (desktop + mobile tab): a prominent "Choose an intelligence
  // track" heading + the rich track cards. Each card opens the MODAL deep-linked to
  // that topic+track.
  function launcherPromoHTML() {
    if (scope.topic === 'home') return launcherStepsHTML();
    // Topic pages: the 4 builder cards, then Web Search + External Insights (last).
    // Each row opens the modal straight to that tab.
    return `<div class="aii-bcards">${builderTabs().map(builderCardHTML).join('')}</div>`;
  }
  function pathsHTML() {
    const intro = flowMode ? `<div class="aii-paths-introwrap">
      <h3 class="aii-paths-intro">Choose an intelligence track</h3>
      <p class="aii-paths-introsub">Grounded, cited analysis on this topic, refreshed live. Pick a track, or jump straight to an insight.</p>
    </div>` : '';
    return `${intro}<div class="aii-pathlist aii-trackgrid">${paths.map(trackCardHTML).join('')}</div>`;
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
      const desc = lookupDesc(s.name);
      return `<button type="button" class="aii-menu-card" data-idx="${i}"><span class="aii-menu-card-ic aii-icon-${escAttr(curGroup)}">${sectionIcon(s.name)}</span><span class="aii-menu-card-tx"><span class="aii-menu-name">${esc(s.name)}</span>${desc ? `<span class="aii-menu-desc">${esc(desc)}</span>` : ''}</span></button>`;
    }).join('')}</div>`;
    const updated = c && c.generatedAt ? `<span class="aii-updated">Updated ${esc(relTime(c.generatedAt))}</span>` : '';
    // In the modal the sticky topbar owns Back + path context; tab mode keeps
    // its own in-stage backrow + subhead.
    const header = flowMode ? '' : `
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
    // The modal content view now carries its own Trending-style sticky head, so
    // the old external condensed bar is retired — always cleared/collapsed.
    if (!scope.inModal) return;
    const ext = container.querySelector('[data-cond-ext]');
    if (!ext) return;
    ext.classList.remove('is-on'); ext.innerHTML = ''; ext.setAttribute('aria-hidden', 'true');
  }
  // The MODAL insight page — built to match the Trending modal exactly: a
  // Trending-style sticky head (Back to path / Prev·Next insight · identifier ·
  // action links · AI Brief subnav pills) then im-msec sections + Sources &
  // Coverage last. Reuses the shared im- classes so visual updates stay in lockstep.
  function contentHTMLModal() {
    const c = cache[curGroup]; const p = paths.find((x) => x.group === curGroup) || {};
    const sects = (c && c.sections) || [];
    const s = sects[curIdx] || { name: '', body: '' };
    const prev = curIdx > 0 ? sects[curIdx - 1] : null;
    const next = curIdx < sects.length - 1 ? sects[curIdx + 1] : null;
    const backLabel = p.tab || p.label || 'Insights';
    const updated = (c && c.generatedAt) ? `<span class="im-eyebrow-time">Updated ${esc(relTime(c.generatedAt))}</span>` : '';
    // Identifier (matches Trending/News): the topic as a prominent solid chip +
    // the "Updated" dateline on the SAME line. The path isn't repeated here — the
    // "Back to <path>" head link already names it. The insight is the big title.
    const eyebrow = `<span class="im-eyebrow-cat">${esc(topicTitle)}</span>${updated}`;
    const controls = `<div class="im-headnav">
        <button type="button" class="im-headnav-link im-headnav-back" data-aii-back="sections">${HNAV_L}${esc(backLabel)}</button>
        <span class="im-headnav-pn">
          <button type="button" class="im-headnav-link" data-pn="prev"${prev ? '' : ' disabled'}>${HNAV_L}Previous</button>
          <button type="button" class="im-headnav-link" data-pn="next"${next ? '' : ' disabled'}>Next${HNAV_R}</button>
        </span>
      </div>`;
    const actions = `<button type="button" class="im-qlink im-qlink-btn aii-qlink-btn" data-acc="explore" aria-expanded="false">${ICON_ASK}<span>Ask AI</span>${CHEV}</button><button type="button" class="im-qlink im-qlink-btn aii-qlink-btn" data-acc="web" aria-expanded="false">${ICON_GLOBE}<span>Web Search</span>${CHEV}</button>`;
    return `<div class="aii-sub aii-content aii-content--modal">
      <div class="im-stickyhead">
        ${controls}
        <div class="im-overhead">
          <div class="im-over-eyebrow">${eyebrow}</div>
          <h2 class="im-over-title">${esc(s.name)}</h2>
          <div class="im-over-links">${actions}</div>
          <div class="im-acc" data-accbody="explore"></div>
          <div class="im-acc" data-accbody="web"></div>
        </div>
      </div>
      <div class="im-secs">
        <div data-aii-secs>${genLoaderHTML()}</div>
      </div>
    </div>`;
  }
  // Fill the modal content sections once the (brief) loader has shown: sectionize
  // the insight into im-msec blocks (Summary / Key Takeaways …) + Sources & Coverage.
  function fillAiiSecs() {
    const wrap = stage.querySelector('[data-aii-secs]');
    if (!wrap) return;
    const c = cache[curGroup]; const s = (c && c.sections[curIdx]) || { body: '' };
    setTimeout(() => {
      if (stage.querySelector('[data-aii-secs]') !== wrap) return;
      const parts = splitSections(sectionizeInsight(s.body));
      const list = parts.length ? parts : [{ name: 'Summary', body: String(s.body || '') }];
      let html = list.map((part, i) => {
        const key = aiiSecIconKey(part.name);
        return aiiMsec(`aii-msec-${i}`, part.name, aiiSecHead(key, part.name) + renderBriefBody(part.body, null));
      }).join('');
      // Only RICH rows (real headline + publisher · date), like the Trending/News
      // Sources list — drop bare grounding-citation domains (e.g. "pbs.org") that
      // give the reader no context on what they're clicking.
      const items = sectionNewsItems().filter((x) => x.title && x.meta && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(x.title).trim()));
      const covRows = items.map((x) => `<a class="im-cov-row" href="${escAttr(x.uri)}" target="_blank" rel="noopener noreferrer"><span class="im-cov-text"><span class="im-cov-title">${esc(x.title)}</span><span class="im-cov-host">${esc(x.meta)}</span></span>${EXT}</a>`).join('');
      if (covRows) html += aiiMsec('aii-msec-sources', 'Sources', aiiSecHead('sources', 'Sources') + `<div class="im-coverage-list">${covRows}</div>`);
      wrap.innerHTML = html;
      wrap.classList.add('ai-reveal');
      buildAiiBriefNav();
    }, 700);
  }
  // ── The NEW "Insight Builder" view ──────────────────────────────────────────
  // One in-depth grounded master-prompt insight per group (Get Caught Up / Deep
  // Dive / Analysis / 101 Resources), shown with a Trending-style sticky head, the
  // insight body as im-msec sections, a "Further Insights" drill-down (the original
  // shortcuts → pick a model + explore), then Sources.
  function builderHTML() {
    const isStatic = isStaticGroup(curGroup);
    const exPrompt = explorePrompt();
    // ── FLAT nav (revamp379): every destination in one row — Get Caught Up,
    // Deep Dive, 101 Resources, Web Search, Prompt Library. No "AI Brief" group. ─
    const tabs = builderTabs().map((x) => `<button type="button" class="aii-ftab${x.group === curGroup ? ' is-active' : ''}" role="tab" aria-selected="${x.group === curGroup}" data-tab-group="${escAttr(x.group)}">${esc(x.tab || x.label)}</button>`).join('');
    const navHTML = `<nav class="aii-flatnav" role="tablist">${tabs}</nav>`;
    // Centered topic switcher (caret opens the topic picker). Locked for custom search.
    const topicEl = scope.lockTopic
      ? `<div class="aii-builder-topic aii-builder-topic--locked${scope.resultsFor ? ' aii-builder-topic--resultsfor' : ''}">${scope.resultsFor ? '<span class="aii-builder-resultsfor">Results for </span>' : ''}<span class="aii-builder-topic-tx">${scope.resultsFor ? `‘${esc(topicTitle)}’` : esc(topicTitle)}</span></div>`
      : `<button type="button" class="aii-builder-topic aii-builder-topic--btn" data-repick aria-label="Change topic"><span class="aii-builder-topic-tx">${esc(topicTitle)}</span><span class="aii-topic-caret" aria-hidden="true">${CHEV}</span></button>`;
    const viewLink = scope.topicKey ? `<button type="button" class="aii-view-topic" data-view-topic>View Topic Page${RIGHT_ARROW}</button>` : '';
    // No per-section intro card anymore — the nav supplies the section identity and
    // the top summary describes the modal. "Explore further" moves to the TOP of the
    // body (brief groups only), above the first section.
    // "Explore further" now lives in its own collapsed drawer above Sources (built
    // in renderInsightInto) — the head keeps just the freshness meta.
    const briefTop = isStatic ? '' : `<div class="aii-brief-top">
        <span class="aii-brief-meta" data-brief-meta></span>
      </div>`;
    return `<div class="aii-sub aii-content aii-content--modal aii-builder aii-builder--flat">
      <div class="aii-builder-topbar">
        <div class="aii-builder-toprow">${topicEl}</div>
        ${navHTML}
        ${viewLink}
      </div>
      <div class="aii-builder-secs">
        ${briefTop}
        <div data-aii-builder>${genLoaderHTML()}</div>
      </div>
    </div>`;
  }
  // Switch builder section. The two-level nav's card vs compact-header markup
  // differs by section type, so re-render the builder view in place (+ re-wire)
  // rather than swap individual fields.
  function switchBuilder(group) {
    if (!group || group === curGroup || !builderTabs().some((x) => x.group === group)) return;
    curGroup = group;
    if (isBriefGroup(group)) lastBriefGroup = group;
    if (!isStaticGroup(group) && !builderCache[group]) loadBuilder(group);
    stage.innerHTML = builderHTML();
    wire();
    scrollRootEl().scrollTo({ top: 0 });
  }
  // Click a MAIN nav tab → jump to that area; "AI Brief" returns to the last
  // brief section the user viewed (defaults to the first path).
  function switchMain(key) {
    const target = key === 'external' ? EXTERNAL_GROUP
      : key === 'websearch' ? WEBSEARCH_GROUP
      : (lastBriefGroup || (paths[0] && paths[0].group) || 'discover');
    switchBuilder(target);
  }
  // Fill the builder body once loaded (kick off the fetch if needed). Shows the
  // generating loader until the insight resolves, then reveals it.
  function fillAiiBuilder() {
    const wrap = stage.querySelector('[data-aii-builder]');
    if (!wrap) return;
    // Static tabs → no AI generation. Web Search = web platform picker;
    // External Insights = the topic's shortcut prompts.
    if (curGroup === WEBSEARCH_GROUP) { renderWebSearchInto(wrap); return; }
    if (curGroup === EXTERNAL_GROUP) { renderExternalInto(wrap); return; }
    // Caller-supplied extra tab (e.g. custom search's News / Trending): the caller
    // renders the body (and manages its own loading/empty state).
    const extra = extraTabs.find((x) => x.group === curGroup);
    if (extra && extra.render) { try { extra.render(wrap); } catch (_) { wrap.innerHTML = ''; } wrap.classList.add('ai-reveal'); return; }
    const reveal = () => { if (stage.querySelector('[data-aii-builder]') === wrap && view === 'builder') renderBuilderInto(wrap); };
    const bc = builderCache[curGroup];
    if (bc && !bc.loading) setTimeout(reveal, 600);   // cached → brief loader moment, then reveal
    else loadBuilder(curGroup).then(reveal);
  }
  function renderBuilderInto(wrap) {
    const bc = builderCache[curGroup] || {};
    // The "Updated …" stamp moves OUT of the head and INTO the Summary tab, above
    // the first section (#img115).
    const meta = stage.querySelector('[data-brief-meta]');
    if (meta) meta.innerHTML = '';
    const updatedHTML = bc.generatedAt ? `<div class="aii-updated-row"><span class="aii-brief-updated">Updated ${esc(relTime(bc.generatedAt))}</span></div>` : '';
    if (bc.error || !bc.content) {
      wrap.innerHTML = '<p class="aii-empty">This insight is being generated — check back shortly.</p>';
      return;
    }
    const parts = splitSections(bc.content);
    // Drop repeated sections (model occasionally re-writes earlier ones → dup
    // headings) AND empty-body sections (truncated at the token cap = a trailing
    // heading with no body). Keep the first of each heading.
    const seenSec = new Set();
    const uniqParts = parts.filter((p) => {
      const n = String(p.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (!n || seenSec.has(n)) return false;
      if (!String(p.body || '').trim()) return false;
      seenSec.add(n); return true;
    });
    const list = uniqParts.length ? uniqParts : [{ name: 'Overview', body: String(bc.content) }];
    // Each section is a clamped PREVIEW with a Show more / less toggle (long
    // insights stay scannable). Further Insights + Ask AI now live in the
    // External Tools tab, so sections carry only their body.
    // Summary tab = the "Updated" stamp, then the AI-generated sections (full text).
    const summaryHTML = updatedHTML + list.map((part, i) => {
      const key = aiiSecIconKey(part.name);
      const body = `<div class="aii-sec-body">${renderBriefBody(part.body, null)}</div>`;
      return aiiMsec(`aii-msec-${i}`, part.name, aiiSecHead(key, part.name) + body);
    }).join('');
    const items = builderNewsItems().filter((x) => x.title && x.meta && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(x.title).trim()));
    const covRows = items.map((x) => `<a class="im-cov-row" href="${escAttr(x.uri)}" target="_blank" rel="noopener noreferrer"><span class="im-cov-text"><span class="im-cov-title">${esc(x.title)}</span><span class="im-cov-host">${esc(x.meta)}</span></span>${EXT}</a>`).join('');
    // Explore Further tab = the shared clean-dropdown component (External AI Models
    // with Send-to / Direct Submit / Review, then web categories).
    const efP = explorePrompt();
    const exploreHTML = exploreFurtherHTML({ prompt: efP, webTerm: scope.label || scope.topic || '', name: curSectionName() });
    // Split into 3 TABS: Summary (default) / Explore Further / Sources.
    const tabs = [
      { key: 'summary', label: 'Summary', html: summaryHTML },
      { key: 'explore', label: 'Explore Further', html: exploreHTML },
    ];
    if (covRows) tabs.push({ key: 'sources', label: 'Sources', html: `<div class="im-coverage-list aii-sources-list">${covRows}</div>` });
    wrap.innerHTML = insightTabsHTML(tabs, 'aii-instabs');
    wrap.classList.add('ai-reveal');
    wireInsightTabs(wrap);
    wireExploreFurther(wrap);
    wireSectionClamps();
  }
  // External Insights tab — the topic's shortcut prompts as an explore accordion.
  function renderExternalInto(wrap) {
    const fi = furtherInsightsHTML((scope.shortcuts || []).filter((s) => s && (s.prompt || s.name)));
    wrap.innerHTML = fi || '<p class="aii-empty">No further insights available for this topic.</p>';
    wrap.classList.add('ai-reveal');
    wireBuilderContent();
  }
  // Web Search tab — the web platform picker (search types → platforms), folded in
  // from the old standalone Web Sources card.
  function renderWebSearchInto(wrap) {
    wrap.innerHTML = `<div class="aii-ext-block aii-ext-ws">
      <p class="aii-fi-intro">Pick a source type, then choose a platform to open your search there.</p>
      ${webCatsHTML()}</div>`;
    wrap.classList.add('ai-reveal');
  }
  // Further Insights — the original shortcut prompts as an accordion explore list.
  function furtherInsightsHTML(list) {
    if (!list || !list.length) return '';
    const topicName = scope.label || scope.topic || '';
    const fiPrompt = (s) => String(s.prompt || `Give me a thorough, current briefing on "${s.name}" for ${topicName}. Be specific and cite sources.`).replace(/\{TOPIC\}/g, topicName);
    const rows = list.map((s) => `
      <div class="aii-fi-acc">
        <button type="button" class="aii-fi-accsum" aria-expanded="false">
          <span class="aii-fi-acc-tx"><span class="aii-fi-acc-name">${esc(s.name)}</span>${s.description ? `<span class="aii-fi-acc-desc">${esc(s.description)}</span>` : ''}</span>
          <span class="aii-fi-acc-chev">${CHEV}</span>
        </button>
        <div class="aii-emenu-host" data-explore-prompt="${escAttr(fiPrompt(s))}" data-explore-name="${escAttr(s.name)}"></div>
      </div>`).join('');
    return `<div class="aii-ext-block aii-fi">
      <div class="aii-fi-acclist">${rows}</div></div>`;
  }
  // Inline-toggle for an emenu (discreet explore link, Further-Insights row): opens
  // its OWN Ask-AI menu (model picker / Direct / Review) in place. Actions handled
  // by setupExploreDelegation (reads the prompt from the host's data attributes).
  function toggleEmenu(btn) {
    const host = btn.parentElement.querySelector('.aii-emenu-host');
    if (!host) return;
    const willOpen = !host.classList.contains('is-open');
    if (willOpen && !host.dataset.ready) { host.innerHTML = exploreHomeHTML(); host.dataset.ready = '1'; }
    host.classList.toggle('is-open', willOpen);
    btn.setAttribute('aria-expanded', String(willOpen));
  }
  // Wire the content area after a render: Further-Insights accordions + section
  // Show-more toggles. (The discreet brief-head explore link is wired in wire().)
  function wireBuilderContent() {
    stage.querySelectorAll('.aii-fi-accsum').forEach((b) => b.addEventListener('click', () => toggleEmenu(b)));
    wireSectionClamps();
  }
  // Clamp long section bodies to a preview; show a "Show more / less" toggle only
  // when the body actually overflows the clamp.
  function wireSectionClamps() {
    stage.querySelectorAll('.aii-sec-more').forEach((btn) => {
      const msec = btn.closest('.im-msec'); const clamp = msec && msec.querySelector('[data-sec-clamp]');
      if (!clamp) return;
      // Reveal the toggle only if clamped content overflows.
      requestAnimationFrame(() => { if (clamp.scrollHeight > clamp.clientHeight + 6) btn.hidden = false; });
      btn.addEventListener('click', () => {
        const expanded = msec.classList.toggle('is-expanded');
        const tx = btn.querySelector('.aii-sec-more-tx'); if (tx) tx.textContent = expanded ? 'Show less' : 'Show more';
      });
    });
  }
  // Open a builder tab (or the External Tools tab) straight into the modal view.
  function openBuilder(group, dir) {
    if (!builderTabs().some((p) => p.group === group)) return;
    curGroup = group; curIdx = 0;
    if (!isStaticGroup(group) && !builderCache[group]) loadBuilder(group);
    go('builder', dir || 'fwd');
  }

  function contentHTML() {
    if (flowMode) return contentHTMLModal();
    const c = cache[curGroup]; const p = paths.find((x) => x.group === curGroup) || {};
    const s = (c && c.sections[curIdx]) || { name: '', body: '' };
    const desc = lookupDesc(s.name);
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
          <button type="button" class="im-qlink im-qlink-btn aii-qlink-btn" data-acc="explore" aria-expanded="false"><span>Ask AI</span>${CHEV}</button>
          <button type="button" class="im-qlink im-qlink-btn aii-qlink-btn" data-acc="web" aria-expanded="false"><span>Web Search</span>${CHEV}</button>
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
    if (bulletsTxt) parts.push(`### Takeaways\n${bulletsTxt}`);
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
    return dedupNewsRows(feed, cites);
  }
  // Builder insight is ONE generation, so its sources/headlines are a flat pool —
  // no per-section split. Take the pool whole (objects keyed by section are
  // flattened defensively for older payloads).
  function builderNewsItems() {
    const c = builderCache[curGroup]; if (!c) return [];
    const flat = (v) => (Array.isArray(v) ? v : Object.values(v || {}).flat());
    return dedupNewsRows(flat(c.headlines), flat(c.sources));
  }
  // Dedup the rich feed rows + grounding citations into display rows (title +
  // publisher · date), by URL AND normalized title. Shared by the section + builder
  // sources lists.
  function dedupNewsRows(feed, cites) {
    const list = (feed || []).concat(cites || []);
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
    // date), so the type + styling match across the family (#143). Drop bare
    // grounding-citation domains — they give no context on what's being clicked.
    const rows = sectionNewsItems()
      .filter((x) => x.title && x.meta && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(x.title).trim()))
      .map((x) =>
      `<a class="im-cov-row" href="${escAttr(x.uri)}" target="_blank" rel="noopener noreferrer"><span class="im-cov-text"><span class="im-cov-title">${esc(x.title)}</span><span class="im-cov-host">${esc(x.meta)}</span></span>${EXT}</a>`);
    if (!rows.length) return '';
    return `<div class="im-coverage im-coverage--inline"><div class="im-section-title im-section-title--icon">${SOURCES_BADGE}<span>Sources</span></div><div class="im-coverage-list">${rows.join('')}</div></div>`;
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
  // Load the NEW master-prompt "builder" insight for a group (one in-depth grounded
  // generation, not the old per-shortcut sections). Kept in its own cache so the
  // legacy per-section flow is untouched.
  async function loadBuilder(group, attempt = 0) {
    if (attempt === 0 && builderCache[group] && !builderCache[group].loading && !builderCache[group].error) return builderCache[group];
    builderCache[group] = { loading: true };
    // Briefs generate on demand — an empty/failed response is usually a transient
    // rate/grounding blip, so auto-retry a couple times before marking it errored.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'shortcut', topic: scope.topic, group, builder: 1 }) });
      const data = res.ok ? await res.json() : null;
      if (data && data.content) {
        builderCache[group] = { content: data.content, generatedAt: data.generatedAt, sources: data.sources || [], headlines: data.headlines || [], loading: false };
      } else if (attempt < 2) {
        await sleep(700 + attempt * 700); return loadBuilder(group, attempt + 1);
      } else {
        builderCache[group] = { loading: false, error: true };
      }
    } catch (_) {
      if (attempt < 2) { await sleep(700 + attempt * 700); return loadBuilder(group, attempt + 1); }
      builderCache[group] = { loading: false, error: true };
    }
    return builderCache[group];
  }

  // Generic explore prompt for the head "Ask AI" (no specific section). Per-section
  // / Further-Insights menus carry their own prompt via the host's data attributes.
  function explorePrompt() {
    if (view === 'builder') {
      const p = paths.find((x) => x.group === curGroup) || {};
      return `Give me a thorough, current "${p.tab || p.label || ''}" briefing on ${scope.label}. Be specific and cite sources.`;
    }
    const c = cache[curGroup]; const s = (c && c.sections[curIdx]) || {};
    return `Give me a thorough, current briefing on "${s.name || ''}" for ${scope.label}. Be specific and cite sources.`;
  }
  function curSectionName() {
    if (view === 'builder') { const p = paths.find((x) => x.group === curGroup) || {}; return p.tab || p.label || ''; }
    const c = cache[curGroup]; const s = (c && c.sections[curIdx]) || {};
    return s.name || '';
  }
  // Resolve the prompt/name for an explore action from the nearest host's data
  // attributes (per-section / Further-Insights), falling back to the generic
  // head prompt. Plus the host element whose innerHTML the Direct→Leave step swaps.
  function exploreCtxOf(el) {
    const c = el && el.closest('[data-explore-prompt]');
    if (c) return { prompt: c.getAttribute('data-explore-prompt') || '', name: c.getAttribute('data-explore-name') || '' };
    return { prompt: explorePrompt(), name: curSectionName() };
  }
  function exploreHostOf(el) { return el.closest('.aii-emenu-host') || el.closest('[data-accbody="explore"]'); }
  // ONE stage-level delegation for every explore menu (head panel + all inline
  // dropdowns) — attached once (stage persists across view renders).
  function setupExploreDelegation() {
    stage.addEventListener('change', (e) => {
      const sel = e.target.closest('.aii-explore-select'); if (!sel) return;
      setPreferredModelId(sel.value);
      const m = preferredModel(); const host = exploreHostOf(sel);
      const mn = host && host.querySelector('.aii-explore-mn'); if (mn && m) mn.textContent = m.name;
      // Keep an open inline review's Submit label in sync with the shared Send-to.
      const rl = host && host.querySelector('[data-review-submitlabel]'); if (rl && m) rl.textContent = `Submit to ${m.name}`;
      const rd = host && host.querySelector('[data-review-disc]'); if (rd) rd.textContent = reviewDiscText(m);
    });
    stage.addEventListener('click', (e) => {
      const trigger = e.target.closest('.aii-explore-opt, .aii-leave-go');
      if (!trigger) return;
      const host = exploreHostOf(trigger); const ctx = exploreCtxOf(trigger);
      if (trigger.classList.contains('aii-explore-opt')) {
        // Each option (Direct Submit / Review Prompt) is an accordion: clicking it
        // drops its panel DIRECTLY beneath that row, rotates its chevron, and stays
        // mutually exclusive with the other (#img309/#img310).
        if (!host) return;
        const wasActive = trigger.classList.contains('is-active');
        host.querySelectorAll('.aii-review-panel, .aii-leave-panel').forEach((p) => p.remove());
        host.querySelectorAll('.aii-explore-opt.is-active').forEach((o) => o.classList.remove('is-active'));
        if (wasActive) return;   // re-click closes
        if (trigger.dataset.opt === 'review') {
          const panel = document.createElement('div');
          panel.className = 'aii-review-panel';
          panel.innerHTML = exploreReviewHTML(ctx);
          trigger.insertAdjacentElement('afterend', panel);
          wireExploreReview(panel, ctx);
          trigger.classList.add('is-active');
          // No auto-focus — on mobile it forces the field to its focused (larger)
          // size + pops the keyboard on open; let the user tap to edit (#img331).
        } else {
          // Direct Submit → an INLINE "leaving the site" confirm right below it.
          copyPrompt(ctx.prompt);   // copy now so Continue opens synchronously
          const panel = document.createElement('div');
          panel.className = 'aii-leave-panel';
          panel.innerHTML = exploreLeaveInlineHTML();
          trigger.insertAdjacentElement('afterend', panel);
          trigger.classList.add('is-active');
        }
      } else if (trigger.classList.contains('aii-leave-go')) {
        const model = preferredModel(); if (!model) return;
        openModel(model, ctx.prompt);
      }
    });
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
        <span class="aii-explore-chev">${CHEV}</span>
      </button>
      <button type="button" class="aii-explore-opt" data-opt="review">
        <span class="aii-explore-ic">${ICON_EYES}</span>
        <span class="aii-explore-tx"><span class="aii-explore-name">Review Prompt</span><span class="aii-explore-sub">Preview &amp; tweak it before you send</span></span>
        <span class="aii-explore-chev">${CHEV}</span>
      </button>
    </div>`;
  }
  // Direct Submit → an inline "leaving the site" confirm (flat, no card/back).
  function exploreLeaveInlineHTML() {
    const m = preferredModel();
    const name = m ? m.name : 'the AI model';
    return `<div class="aii-leave-inline">
      <p class="aii-leave-body">Continue opens <strong>${esc(name)}</strong> in a new tab. If the prompt doesn't auto-fill, it's copied to your clipboard — just paste it in.</p>
      <button type="button" class="aii-leave-go">Continue ${ARROW}</button>
    </div>`;
  }

  // ── Inline "Review Prompt" (replaces the old Review & Submit MODAL) ──────────
  // Expands IN the explore dropdown so the user edits the prompt + picks options
  // right here (#img266-#img270). Advanced settings mirror the retired modal.
  function simpleOutputOptions() {
    const pg = getPromptGenData() || {};
    const f = (pg.fields || []).find((x) => x.key === 'outputType') || { options: [] };
    return (f.options || []).filter((o) => !o.requiresInput);
  }
  function secondaryClauseTpl() { const pg = getPromptGenData() || {}; return pg.secondaryTopicClause || ''; }
  function reviewDiscText(m) { return `Opens ${m ? m.name : 'the AI model'} in a new tab — the prompt auto-fills or is copied to your clipboard. Standard Topic isn’t responsible for actions taken once you leave the site.`; }
  function exploreReviewHTML(ctx) {
    const m = preferredModel();
    const reasoningOpts = REASONING_LEVELS.map((l) => `<option value="${escAttr(l.id)}"${l.id === 'standard' ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
    const otOpts = '<option value="">None</option>' + simpleOutputOptions().map((o) => `<option value="${escAttr(o.value)}">${esc(o.label)}</option>`).join('');
    return `<div class="aii-review" data-step="review">
      <div class="aii-review-field">
        <div class="aii-review-lblrow"><span class="aii-review-lbl">Prompt Preview</span><button type="button" class="aii-review-reset" data-review-reset hidden>Reset</button></div>
        <div class="aii-review-tawrap"><textarea class="aii-review-ta" data-review-ta aria-label="Prompt — editable">${esc(ctx.prompt)}</textarea><button type="button" class="aii-review-copy" data-review-copy aria-label="Copy prompt" title="Copy">${ICON_COPY_MINI}</button></div>
      </div>
      <div class="aii-review-adv" data-review-adv hidden>
        <div class="aii-review-grid">
          <label class="aii-review-fld"><span class="aii-review-flbl">Reasoning level</span><span class="aii-explore-select-wrap"><select class="aii-review-reasoning">${reasoningOpts}</select>${CHEV}</span></label>
          <label class="aii-review-fld"><span class="aii-review-flbl">Output type</span><span class="aii-explore-select-wrap"><select class="aii-review-output">${otOpts}</select>${CHEV}</span></label>
        </div>
        <label class="aii-review-fld"><span class="aii-review-flbl">Secondary topics</span><input type="text" class="aii-review-secondary" placeholder="e.g. trade policy"></label>
        <label class="aii-review-fld"><span class="aii-review-flbl">Custom instructions <span class="aii-review-flbl-note">— this submission only</span></span><textarea class="aii-review-custom" rows="2" placeholder="A one-off instruction for this prompt"></textarea></label>
      </div>
      <div class="aii-review-footer">
        <button type="button" class="aii-review-editbtn" data-review-edit aria-expanded="false">${ICON_GEAR}<span>Edit Settings</span></button>
        <button type="button" class="aii-review-submit" data-review-submit${m ? '' : ' disabled'}>${ICON_SEND}<span data-review-submitlabel>${esc(m ? `Submit to ${m.name}` : 'Submit prompt')}</span></button>
      </div>
      <p class="aii-review-disc" data-review-disc>${esc(reviewDiscText(m))}</p>
    </div>`;
  }
  function wireExploreReview(host, ctx) {
    const base = ctx.prompt || '';
    const topicName = scope.label || scope.topic || '';
    const ps = { reasoning: 'standard', outputType: '', secondaryTopic: '', customInstructions: '' };
    let edited = null;
    const ta = host.querySelector('[data-review-ta]');
    const resetBtn = host.querySelector('[data-review-reset]');
    const advOpts = () => {
      const r = REASONING_LEVELS.find((l) => l.id === ps.reasoning);
      const ot = simpleOutputOptions().find((o) => o.value === ps.outputType);
      return { reasoningHint: r && r.hint ? r.hint : '', outputClause: ot ? ot.clause : '', secondaryTopic: ps.secondaryTopic.trim(), secondaryClauseTpl: secondaryClauseTpl(), customInstructions: ps.customInstructions.trim(), topicName };
    };
    const assembled = () => assemblePrompt(base, advOpts());
    const regen = () => { edited = null; if (ta) ta.value = assembled(); if (resetBtn) resetBtn.hidden = true; };
    ta && ta.addEventListener('input', () => { edited = (ta.value === assembled()) ? null : ta.value; if (resetBtn) resetBtn.hidden = (edited == null); });
    resetBtn && resetBtn.addEventListener('click', regen);
    host.querySelector('[data-review-copy]')?.addEventListener('click', async (e) => { e.stopPropagation(); try { await navigator.clipboard.writeText(ta ? ta.value : base); } catch (_) {} });
    const submitBtn = host.querySelector('[data-review-submit]');
    // Edit Settings toggles the advanced fields (reasoning/format/custom) inline.
    const editBtn = host.querySelector('[data-review-edit]');
    const adv = host.querySelector('[data-review-adv]');
    editBtn && editBtn.addEventListener('click', () => {
      const open = adv && adv.hidden;
      if (adv) adv.hidden = !open;
      editBtn.classList.toggle('is-open', !!open);
      editBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    host.querySelector('.aii-review-reasoning')?.addEventListener('change', (e) => { ps.reasoning = e.target.value; regen(); });
    host.querySelector('.aii-review-output')?.addEventListener('change', (e) => { ps.outputType = e.target.value; regen(); });
    host.querySelector('.aii-review-secondary')?.addEventListener('input', (e) => { ps.secondaryTopic = e.target.value; regen(); });
    host.querySelector('.aii-review-custom')?.addEventListener('input', (e) => { ps.customInstructions = e.target.value; regen(); });
    submitBtn && submitBtn.addEventListener('click', () => {
      const m = preferredModel();
      if (!m) return;
      const prompt = ta ? ta.value : assembled();
      openModel(m, prompt); copyPrompt(prompt);
      const note = document.createElement('p');
      note.className = 'aii-review-done';
      note.textContent = `Opened ${m.name} · prompt copied to your clipboard — paste it in if it didn’t auto-fill.`;
      (host.querySelector('.aii-review-footer') || submitBtn).replaceWith(note);
    });
  }

  function teardownSticky() {
    if (aiiObserver) { aiiObserver.disconnect(); aiiObserver = null; }
    if (aiiSpyHandler && aiiSpyRoot) { aiiSpyRoot.removeEventListener('scroll', aiiSpyHandler); }
    aiiSpyHandler = aiiSpyRoot = null;
  }
  // Tab mode: reveal the condensed "path · section" bar once the overview card
  // scrolls out of the top of the brief. The scroll container is .aii-stage
  // (overflow:auto) — NOT the window — so the observer is rooted on it and the bar
  // is position:sticky;top:0 inside it. Tapping the bar scrolls the stage to top.
  function setupSticky() {
    teardownSticky();
    // Modal content now uses a real position:sticky head (no observer) — this
    // reveal-on-scroll condensed bar is TAB MODE only.
    if (!tabMode || view !== 'content' || typeof IntersectionObserver === 'undefined') return;
    const ov = stage.querySelector('.aii-ovcard');
    const cond = stage.querySelector('.aii-condensed');
    if (!ov || !cond) return;
    const scrollRoot = stage;
    aiiObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const top = e.rootBounds ? e.rootBounds.top : 0;
        cond.classList.toggle('is-on', !e.isIntersecting && e.boundingClientRect.top <= top + 1);
      }
    }, { root: scrollRoot, threshold: 0 });
    aiiObserver.observe(ov);
    const condTop = cond.querySelector('[data-cond-top]') || cond;
    condTop.addEventListener('click', () => scrollRoot.scrollTo({ top: 0, behavior: 'smooth' }));
  }
  // Modal content view: build the AI Brief scroll-spy pills (same behavior as the
  // Trending modal's buildBriefNav, but rooted on .aii-modal-body's scroller).
  function buildAiiBriefNav() {
    const pillsEl = stage.querySelector('[data-aii-pills]');
    const head = stage.querySelector('.im-stickyhead');
    const scrollRoot = scrollRootEl();
    if (!pillsEl) return;
    const secs = () => [...stage.querySelectorAll('.im-msec')];
    const list = secs();
    pillsEl.innerHTML = list.map((s) => `<button type="button" class="im-pill" data-pill="${s.id}">${esc(s.dataset.name || '')}</button>`).join('');
    pillsEl.querySelectorAll('.im-pill').forEach((p) => p.addEventListener('click', () => {
      const sec = document.getElementById(p.dataset.pill); if (!sec) return;
      const off = (head ? head.offsetHeight : 0) + 10;
      const target = scrollRoot.scrollTop + (sec.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top) - off;
      scrollRoot.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }));
    let lastActive = null;
    const update = () => {
      const limit = (head ? head.offsetHeight : 0) + scrollRoot.getBoundingClientRect().top + 14;
      const ls = secs(); let active = ls[0];
      for (const s of ls) { if (s.getBoundingClientRect().top <= limit) active = s; }
      if (!active) return;
      // At the very bottom, the last section (Sources) is active even if it's too
      // short to reach the header threshold.
      if (scrollRoot.scrollHeight > scrollRoot.clientHeight + 8 && scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - 4) active = ls[ls.length - 1];
      pillsEl.querySelectorAll('.im-pill').forEach((p) => p.classList.toggle('is-active', p.dataset.pill === active.id));
      // Auto-scroll the overflowing pill rail so the active pill stays in view.
      if (active.id !== lastActive) {
        lastActive = active.id;
        const ap = pillsEl.querySelector(`.im-pill[data-pill="${active.id}"]`);
        if (ap) {
          const c = pillsEl.getBoundingClientRect(), p = ap.getBoundingClientRect();
          pillsEl.scrollTo({ left: Math.max(0, pillsEl.scrollLeft + (p.left - c.left) - (c.width - p.width) / 2), behavior: 'smooth' });
        }
      }
    };
    if (aiiSpyHandler && aiiSpyRoot) aiiSpyRoot.removeEventListener('scroll', aiiSpyHandler);
    let raf = 0;
    aiiSpyRoot = scrollRoot;
    aiiSpyHandler = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; update(); }); };
    scrollRoot.addEventListener('scroll', aiiSpyHandler, { passive: true });
    update();
  }

  // Open one of the content-page actions. `btn` is the clicked control (a card
  // quicklink OR a condensed-bar button); `fromCond` means it came from the
  // sticky bar (which lives away from the scrolled overview card, so we always
  // open the panel and jump the scroller to the top to bring it into view).
  function openAcc(btn, fromCond) {
    const name = btn.dataset.acc;
    const scrollRoot = scrollRootEl();
    if (name === 'sources') {
      const cov = stage.querySelector('#aii-msec-sources') || stage.querySelector('.aii-headlines');
      if (cov && (cov.id === 'aii-msec-sources' || cov.firstChild)) cov.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const body = stage.querySelector(`[data-accbody="${name}"]`);
    const willOpen = fromCond || btn.getAttribute('aria-expanded') !== 'true';
    stage.querySelectorAll('.aii-actbtn, .aii-qlink-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    stage.querySelectorAll('.aii-acc, .im-acc').forEach((a) => a.classList.remove('is-open'));
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
    // Modal content view (Trending-style): fill the sections + wire the head's
    // Back / Prev·Next insight links (the action links + pills wire below/inside).
    if (flowMode && view === 'content') {
      fillAiiSecs();
      stage.querySelectorAll('[data-aii-back]').forEach((b) => b.addEventListener('click', () => go(b.dataset.aiiBack, 'back')));
      stage.querySelectorAll('.im-headnav-link[data-pn]').forEach((b) => b.addEventListener('click', () => {
        if (b.hasAttribute('disabled')) return;
        const c = cache[curGroup]; const n = (c && c.sections.length) || 0;
        const ni = b.dataset.pn === 'next' ? curIdx + 1 : curIdx - 1;
        if (ni < 0 || ni >= n) return;
        curIdx = ni; go('content', b.dataset.pn === 'next' ? 'fwd' : 'back');
      }));
    }
    // Builder view (the new master-prompt insight): fill the body once loaded +
    // wire the head's Back / Prev·Next BUILDER links.
    if (flowMode && view === 'builder') {
      fillAiiBuilder();
      // Flat nav tabs (revamp379) — every destination switches the builder directly.
      stage.querySelectorAll('.aii-ftab, .aii-tab, .aii-stab').forEach((t) => t.addEventListener('click', () => switchBuilder(t.dataset.tabGroup)));
      stage.querySelector('[data-repick]')?.addEventListener('click', () => { pickerReturnGroup = curGroup; go('topic', 'back'); });
      // Discreet "View Topic Page" link → close the modal onto that topic's page.
      stage.querySelector('[data-view-topic]')?.addEventListener('click', () => {
        const key = scope.topicKey; if (!key) return;
        window.dispatchEvent(new CustomEvent('close-all-modals'));
        window.location.hash = key === 'home' ? '#/' : ('#/topic/' + key);
      });
      // Discreet "Explore further with external AI models" link (brief head) → opens
      // its Ask-AI menu in place.
      stage.querySelector('[data-explore-toggle]')?.addEventListener('click', (e) => toggleEmenu(e.currentTarget));
    }
    // Section content: briefly show the generating loader (even when cached)
    // then reveal the brief — gives the AI a moment of presence.
    const bodyEl = stage.querySelector('.aii-content-body[data-loading]');
    if (bodyEl) {
      const c = cache[curGroup]; const s = (c && c.sections[curIdx]) || { body: '' };
      setTimeout(() => {
        if (stage.querySelector('.aii-content-body') !== bodyEl) return;
        bodyEl.removeAttribute('data-loading');
        bodyEl.innerHTML = renderBriefBody(sectionizeInsight(s.body), null);
        bodyEl.classList.add('ai-reveal');
        // Reveal the real headline links with the brief (they're not part of the
        // synthesized body, so they live in their own block below the rule).
        const hl = stage.querySelector('.aii-headlines');
        if (hl) { hl.innerHTML = headlineListHTML(); if (hl.firstChild) hl.classList.add('ai-reveal'); }
        const prov = stage.querySelector('.aii-prov-slot');
        if (prov) { prov.innerHTML = aiProvenanceHTML(sectionNewsItems(), { badge: false }); prov.hidden = !prov.textContent.trim(); }
      }, 1000);
    }
    if (view === 'paths') {
      // Track cards drill into the chosen track. A preview teaser deep-links
      // straight to that insight's brief; the header/Explore lands on the list.
      wireTrackCards(stage, (group) => openBuilder(group));
    }
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
    // Explore-menu interactions (model select + Direct/Review/Continue) are handled
    // ONCE by setupExploreDelegation() for the head panel AND every inline dropdown.
  }

  // Jump straight into a path's sections (used by the desktop→mobile hand-off and
  // the deep-linked flow entry).
  function openGroup(group, insightName) {
    if (!paths.some((p) => p.group === group)) return;
    curGroup = group; curIdx = 0;
    go('sections', 'fwd');
    loadGroup(curGroup).then(() => {
      // Deep-link: a preview teaser carries its insight name — jump straight to that
      // section's brief (not just the track's insight list). Falls back to the
      // sections list if the brief doesn't have a matching section.
      if (insightName) {
        const c = cache[curGroup];
        const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const target = norm(insightName);
        const idx = ((c && c.sections) || []).findIndex((s) => norm(s.name) === target);
        if (idx >= 0 && stage.dataset.view === 'sections') { curIdx = idx; go('content', 'fwd'); return; }
      }
      if (view === 'sections' && stage.dataset.view === 'sections') { stage.innerHTML = sectionsHTML(); wire(); updateTopbar(); }
    });
  }
  if (launcher) {
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
      // Track surfaces open the MODAL — a preview deep-links straight to that
      // insight, the header/Explore/View-more lands on the track's insight list.
      const openTrack = (group, insight) => window.dispatchEvent(new CustomEvent('open-ai-intelligence', { detail: {
        topic: scope.topic, label: scope.label, group, insight, builder: true,
        hideGroups: scope.hideGroups || [], descriptions: scope.descriptions || {},
      } }));
      // Topic pages (desktop sidebar AND mobile/tabular) render the collapsible
      // sections now (#91), so wire those — track-card wiring is retired here.
      wireSidebarSecs(stage, openTrack);
      // "Or search any topic or term" → opens the modal at Step 1 (the picker + search).
      stage.querySelector('[data-aii-search]')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('open-ai-intelligence', { detail: { pickTopic: true } })));
    }
  } else if (flowMode && scope.pickTopic) {
    // Modal entered "anew" (bottom nav / homepage CTA) → Step 1: pick a topic.
    go('topic', 'fwd');
  } else if (flowMode && scope.initialGroup && builderTabs().some((p) => p.group === scope.initialGroup)) {
    // Modal deep-linked to a track. The new default opens straight to that group's
    // builder insight; the legacy per-section flow remains for old deep-links.
    if (scope.initialBuilder) openBuilder(scope.initialGroup);
    else openGroup(scope.initialGroup, scope.initialInsight);
  } else if (flowMode) {
    // Modal default (incl. after picking a topic in the "anew" flow) → straight
    // into the first builder; the tabs handle switching from here.
    openBuilder((paths[0] && paths[0].group) || 'discover');
  } else {
    // Modal default → the path picker.
    go('paths', 'fwd');
  }
  // Responsive: tabMode is fixed at render, so re-render when the breakpoint is
  // crossed (the track-picker layout differs slightly desktop vs mobile).
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
