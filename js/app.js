import { initRouter, onRoute, getCurrentRoute } from './utils/router.js';
import { loadAllData, getTopicBySlug, getParentTopics, getFeaturedTopics, getSubtopics, getShortcutsForTopic, getRelatedTopics, getTopicsGroupedByParent, getAllShortcutIconKeys, getExternalSearches, getExternalSearchCategories, searchTopics, getModels, getDefaultModelId, getModelById } from './utils/data.js';
import { getPreferredModelId, setPreferredModelId, submitPrompt, openModel, copyPrompt } from './utils/ai-models.js?v=20260605-polish30';
import { assemblePrompt } from './utils/prompt-assembly.js';
import { REASONING_LEVELS, getReasoningLevel, getCustomInstructions } from './utils/settings.js';
import { renderIcon, preloadIcons, getIconEmoji } from './utils/icons.js';
import { topicIconSVG } from './utils/topic-icons.js';
import { getTopicDescription } from './utils/topic-descriptions.js?v=20260630-revamp409';
import { renderSearchBar, initSearchOverlay, openSearchOverlay } from './components/search-modal.js?v=20260607-polish50';
import { renderNewsFeed, renderBriefBody, listHTML as newsListHTML, wireNewsAI } from './components/newsfeed.js?v=20260630-revamp409';
import { renderShortcuts } from './components/shortcuts.js';
import { renderRelatedTopics } from './components/related-topics.js';
import { renderPromptGenerator } from './components/prompt-generator.js?v=20260630-revamp409';
import { initPromptBuilderModal, openPromptBuilderModal, closePromptBuilderModal } from './components/prompt-builder-modal.js?v=20260630-revamp409';
import { initPromptModal } from './components/prompt-modal.js?v=20260630-revamp409';
import { renderTrending, renderTrendingTopics, renderTrendingHome, renderTrendingModal } from './components/trending.js?v=20260630-revamp409';
import { fetchTrending } from './utils/trending.js';
import { DEFAULT_GROUP_DEFS, groupShortcuts, renderTIAccordion, webSourceItem, TI_SECTION_META } from './components/ti-shortcuts.js';
import { initTrendingDetailModal } from './components/trending-detail-modal.js?v=20260630-revamp409';
import { initInsightModal } from './components/insight-modal.js?v=20260630-revamp409';
import { renderAIIntelligence } from './components/ai-intelligence.js?v=20260630-revamp409';
import { initAIIntelligenceModal } from './components/ai-intelligence-modal.js?v=20260630-revamp409';
import { renderWebSources } from './components/websources.js?v=20260630-revamp409';
import { initTrendingListModal } from './components/trending-list-modal.js?v=20260630-revamp409';
import { initDiscoverModal } from './components/discover-modal.js';
import { initAllTopicsModal } from './components/all-topics-modal.js?v=20260630-revamp409';
import { initRelatedTopicsModal } from './components/related-topics-modal.js';
import { initPromptPreviewModal } from './components/prompt-preview-modal.js?v=20260630-revamp409';
import { trackPageView, track } from './utils/analytics.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  // Apply per-group accent colors from data.assignments.groups so
  // admin-managed colors take effect at render time.
  applyGroupAccentColors();
  // Preload shortcut icon SVGs (non-blocking — renders emoji until resolved)
  preloadIcons(getAllShortcutIconKeys());
  initPromptModal();
  initScrollFades();
  initTrendingDetailModal();
  initInsightModal();
  initTrendingListModal();
  initDiscoverModal();
  initAllTopicsModal();
  initRelatedTopicsModal();
  initPromptPreviewModal();
  initSearchOverlay();
  initSearchPageModal();
  initPromptBuilderModal();
  initAIIntelligenceModal();
  setupGlobalTabPillDelegation();
  wireSubnavPickerOutsideClose();

  // Esc closes the open nav dropdown (search also resets its deep-link route).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navDdOpen) userCloseNavDropdown();
  });

  onRoute((route) => {
    // Nav dropdowns are transient overlays — close on any navigation. EXCEPTION:
    // the Search dropdown IS route-driven (#/search, #/custom) and updates its
    // own URL as the term changes, so keep it open across search routes.
    const isSearchNav = (route.type === 'search' || route.type === 'custom');
    if (!(isSearchNav && navDdOpen && navDdOpen.key === 'search')) closeNavDropdown();
    // Search (#/search) and Custom (#/custom/{term}) routes don't render
    // their own page — they open the Search modal over the home layout.
    const isSearchRoute = route.type === 'search' || route.type === 'custom';
    const isPromptRoute = route.type === 'prompt-generator';
    // These routes don't render their own page — they open a modal over home.
    const isOverlayRoute = isSearchRoute || isPromptRoute;
    const baseRoute = isOverlayRoute ? { type: 'home', slug: 'home', tab: 'newsfeed' } : route;

    // Only (re)render the underlying page when the base actually changes, so
    // typing/clearing inside an open modal doesn't tear down home beneath it.
    if (!(isOverlayRoute && lastBaseRouteKey === 'home')) {
      renderLayout(baseRoute);
      renderPage(baseRoute);
      lastBaseRouteKey = baseRoute.type === 'home' ? 'home'
        : baseRoute.type === 'topic' ? 'topic:' + baseRoute.slug
        : baseRoute.type;
      requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        setSubnavHeightVar();
      });
    }

    if (isSearchRoute) {
      openSearchPageModal(route.type === 'custom' ? decodeURIComponent(route.term || '') : '');
    } else {
      closeSearchPageModal({ silent: true });
    }
    if (isPromptRoute) openPromptBuilderModal(); else closePromptBuilderModal();

    // Always refresh the bottom-nav active tab from the REAL route — overlay
    // routes (search/custom) skip renderLayout, so its internal call is missed.
    renderBottomNav(route);

    // Fire GA4 page_view after the DOM has the right document.title.
    trackPageView(window.location.hash || '#/', document.title);
  });

  window.addEventListener('resize', setSubnavHeightVar, { passive: true });

  initRouter();

  // Re-render layout if the viewport crosses the mobile breakpoint
  // (home behaves differently on mobile vs desktop)
  let lastMobile = window.matchMedia(MOBILE_QUERY).matches;
  window.addEventListener('resize', () => {
    const nowMobile = window.matchMedia(MOBILE_QUERY).matches;
    if (nowMobile !== lastMobile) {
      lastMobile = nowMobile;
      const route = getCurrentRoute();
      if (route) renderLayout(route);
    }
  }, { passive: true });
});

// Unified layout:
//  - Homepage: Google-style hero; sticky bar fades in after ~180px scroll
//  - Every other page: same sticky bar visible from page load (no scroll trigger)
//    Content area gets top padding (via body.sticky-always) so it isn't hidden.
let heroScrollHandler = null;

const MOBILE_QUERY = '(max-width: 640px)';

let subnavResizeObs = null;

// Toggles `.is-stuck` on the custom-search sticky bar when it pins to
// the top, so the bar's shadow/hairline only shows once it's a fixed
// subnav (flat at rest). Uses a sentinel one pixel above the bar:
// when the sentinel scrolls out the top, the bar is stuck.
let customStickyObs = null;
function setupCustomStickyBar(stickyEl) {
  if (customStickyObs) { customStickyObs.disconnect(); customStickyObs = null; }
  if (!stickyEl || typeof IntersectionObserver === 'undefined') return;
  const sentinel = document.createElement('div');
  sentinel.className = 'custom-search-sticky-sentinel';
  sentinel.setAttribute('aria-hidden', 'true');
  stickyEl.parentNode.insertBefore(sentinel, stickyEl);
  customStickyObs = new IntersectionObserver(
    ([entry]) => stickyEl.classList.toggle('is-stuck', !entry.isIntersecting),
    { threshold: 0, rootMargin: '-64px 0px 0px 0px' }
  );
  customStickyObs.observe(sentinel);
}

function setSubnavHeightVar() {
  const sub = document.getElementById('sub-header');
  if (!sub) return;
  const h = sub.offsetHeight;
  if (h > 0) document.documentElement.style.setProperty('--subnav-height', `${h}px`);
}

// Observe the subnav for any size change (CSS transitions, content
// reflow, viewport resize) and keep --subnav-height in lockstep so
// the body's padding-top tracks smoothly when the Content Shortcuts
// bar collapses/expands.
function observeSubnavHeight() {
  const sub = document.getElementById('sub-header');
  if (!sub || typeof ResizeObserver === 'undefined') return;
  if (subnavResizeObs) subnavResizeObs.disconnect();
  subnavResizeObs = new ResizeObserver(() => setSubnavHeightVar());
  subnavResizeObs.observe(sub);
}

// Mobile/tabular topic hero condense (#92): when the active tab panel scrolls,
// collapse the tall hero (icon + big title + description + Related) into a slim
// sticky bar (icon + title + tabs). The app scrolls INSIDE each panel
// (.aii-stage / .newsfeed-scroll-wrap), so a single capturing scroll listener
// on document catches whichever panel is scrolling. CSS does the visual collapse
// under body.topic-hero-condensed; --subnav-height (ResizeObserver) keeps the
// content padding in lockstep as the band shrinks.
let topicHeroScrollHandler = null;
function wireTopicHeroCondense() {
  if (topicHeroScrollHandler) document.removeEventListener('scroll', topicHeroScrollHandler, true);
  topicHeroScrollHandler = (e) => {
    const t = e.target;
    if (!t || t.nodeType !== 1 || typeof t.closest !== 'function') return;
    // Only react to scrolls inside the topic content area.
    if (!t.closest('#content')) return;
    const st = t.scrollTop || 0;
    // Threshold: on desktop the sticky picker should only appear once the BODY
    // topic header (title + subtopics) has mostly scrolled away — so derive it
    // from that header's height. On mobile the header is display:none (height 0)
    // so it falls back to the small hero-condense threshold.
    const bh = document.querySelector('.topic-bodyhead');
    const bhH = bh ? bh.offsetHeight : 0;
    const onThresh = Math.max(36, bhH - 24);
    const offThresh = Math.max(12, bhH - 64);
    // Hysteresis so it doesn't flicker at the boundary.
    const condensed = document.body.classList.contains('topic-hero-condensed');
    if (!condensed && st > onThresh) document.body.classList.add('topic-hero-condensed');
    else if (condensed && st < offThresh) document.body.classList.remove('topic-hero-condensed');
  };
  document.addEventListener('scroll', topicHeroScrollHandler, true);
  document.body.classList.remove('topic-hero-condensed');
}

// ── Topic picker (revamp377) ─────────────────────────────────────────────────
// A dropdown/accordion of the current topic's family: two action buttons (Home,
// View All Topics) on top, then the parent (as an "Overview" header) over the
// sibling/subtopic list with the active topic highlighted. Used in two places:
//   • the mobile subnav button (default <900),
//   • the DESKTOP body topic-header chevron + the on-scroll sticky bar (#70).
const TSP_CHEV = '<svg class="tsp-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

// The shared dropdown panel (wrap + inner). `panelId` keeps aria-controls unique.
// Layout (revamp389): a quiet actions row (Home · All Topics, with an X to close),
// the parent "Overview" landing, then the subtopics as a responsive GRID (no rail).
function topicPickerPanelHTML(topic, panelId) {
  const parent = topic.parent ? (getTopicBySlug(topic.parent) || topic) : topic;
  const family = getSubtopics(parent.slug);   // parent's children = this topic + siblings (or its own subtopics)
  const parentActive = parent.slug === topic.slug;
  const CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
  const cellHTML = (t) => {
    const active = t.slug === topic.slug;
    return `<a href="#/topic/${t.slug}" class="tsp-cell${active ? ' is-active' : ''}"${active ? ' aria-current="page"' : ''}>
        <span class="tsp-cell-ic">${topicIconSVG(t.icon || 'globe', 'tsp-ic-svg')}</span>
        <span class="tsp-cell-name">${escapeHTML(t.name)}</span>
        ${active ? `<span class="tsp-cell-check" aria-hidden="true">${CHECK}</span>` : ''}
      </a>`;
  };
  const HOME_IC = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/></svg>';
  const GRID_IC = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
  const X_IC = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  return `
    <div class="tsp-panelwrap">
      <div class="tsp-panel" id="${escapeHTML(panelId)}" role="region" aria-label="Browse topics">
        <div class="tsp-panel-inner">
          <div class="tsp-bar">
            <span class="tsp-bar-actions">
              <a href="#/" class="tsp-action" data-tsp-home>${HOME_IC}<span>Home</span></a>
              <a href="#" class="tsp-action" data-tsp-all>${GRID_IC}<span>All Topics</span></a>
            </span>
            <button type="button" class="tsp-close" data-tsp-close aria-label="Close">${X_IC}</button>
          </div>
          <a href="#/topic/${parent.slug}" class="tsp-parent-row${parentActive ? ' is-active' : ''}"${parentActive ? ' aria-current="page"' : ''}>
            <span class="tsp-parent-ic">${topicIconSVG(parent.icon || 'globe', 'tsp-ic-svg')}</span>
            <span class="tsp-parent-name">${escapeHTML(parent.name)}</span>
            <span class="tsp-parent-kicker">Overview</span>
            ${parentActive ? `<span class="tsp-cell-check" aria-hidden="true">${CHECK}</span>` : ''}
          </a>
          ${family.length ? `<div class="tsp-grid">${family.map(cellHTML).join('')}</div>` : ''}
        </div>
      </div>
    </div>`;
}

// Mobile subnav button + desktop on-scroll sticky bar trigger (icon + name + chevron).
function subnavPickerHTML(topic) {
  return `
    <div class="topic-subnav-picker" data-topic-picker>
      <button type="button" class="tsp-btn" aria-expanded="false" aria-controls="tsp-panel-nav">
        <span class="tsp-btn-lead">
          <span class="tsp-btn-ico">${topicIconSVG(topic.icon || 'globe', 'tsp-ic-svg')}</span>
          <span class="tsp-btn-name">${escapeHTML(topic.name)}</span>
        </span>
        ${TSP_CHEV}
      </button>
      ${topicPickerPanelHTML(topic, 'tsp-panel-nav')}
    </div>`;
}

// Homepage subnav picker (#88): "Home" label + a dropdown of the featured topics.
// Same component family as the topic picker, but the dropdown OMITS the Home
// quick-action (you're already home) and has no parent "Overview" row.
function homeSubnavPickerHTML() {
  const featured = getFeaturedTopics() || [];
  const HOME_IC = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/></svg>';
  const GRID_IC = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
  const X_IC = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const cellHTML = (t) => `<a href="#/topic/${t.slug}" class="tsp-cell">
      <span class="tsp-cell-ic">${topicIconSVG(t.icon || 'globe', 'tsp-ic-svg')}</span>
      <span class="tsp-cell-name">${escapeHTML(t.name)}</span>
    </a>`;
  return `
    <div class="topic-subnav-picker is-home-picker" data-topic-picker>
      <button type="button" class="tsp-btn" aria-expanded="false" aria-controls="tsp-panel-home">
        <span class="tsp-btn-lead">
          <span class="tsp-btn-ico">${HOME_IC}</span>
          <span class="tsp-btn-name">Home</span>
        </span>
        ${TSP_CHEV}
      </button>
      <div class="tsp-panelwrap">
        <div class="tsp-panel" id="tsp-panel-home" role="region" aria-label="Browse topics">
          <div class="tsp-panel-inner">
            <div class="tsp-bar">
              <span class="tsp-bar-actions">
                <a href="#" class="tsp-action" data-tsp-all>${GRID_IC}<span>All Topics</span></a>
              </span>
              <button type="button" class="tsp-close" data-tsp-close aria-label="Close">${X_IC}</button>
            </div>
            <div class="tsp-grid">${featured.map(cellHTML).join('')}</div>
          </div>
        </div>
      </div>
    </div>`;
}

// Desktop body topic-header (#70): big topic title + subtopic links row, with a
// chevron that opens the same picker panel. Lives at the top of the topic body;
// scrolls away as the sticky subnav picker takes over.
function topicBodyHeadHTML(topic) {
  const related = getRelatedTopics(topic) || [];
  const subsHTML = related.map(t =>
    `<a href="#/topic/${t.slug}" class="tbh-sub${t.isParent ? ' tbh-sub-parent' : ''}">${escapeHTML(t.name)}</a>`
  ).join('');
  return `
    <div class="topic-bodyhead topic-subnav-picker" data-topic-picker>
      <div class="tbh-row">
        <h1 class="tbh-title">${escapeHTML(topic.name)}</h1>
        <button type="button" class="tbh-toggle tsp-btn" aria-expanded="false" aria-controls="tsp-panel-body" aria-label="Change topic">${TSP_CHEV}</button>
      </div>
      ${subsHTML ? `<div class="tbh-subs">${subsHTML}<button type="button" class="tbh-more" data-tbh-more hidden>More${TSP_CHEV}</button></div>` : ''}
      ${topicPickerPanelHTML(topic, 'tsp-panel-body')}
    </div>`;
}

// Subtopics show inline under the title; "More" is an INLINE continuation of the
// links that appears ONLY when some subtopics don't fit one line (then trailing
// links are hidden so "More" sits right after the last visible one). Clicking it
// opens the full topic picker. No-op on mobile (the body header is display:none).
function wireSubtopicsMore(root) {
  const subs = root.querySelector('.tbh-subs');
  const picker = root.querySelector('[data-topic-picker]');
  if (!subs || !picker) return;
  const more = subs.querySelector('[data-tbh-more]');
  if (!more) return;
  const links = [...subs.querySelectorAll('.tbh-sub')];
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    picker.querySelector('.tsp-btn')?.click();
  });
  const fit = () => {
    links.forEach((l) => { l.style.display = ''; });
    more.hidden = true;
    if (!links.length || !links[0].offsetParent) return;          // hidden (mobile) → skip
    const top0 = links[0].offsetTop;
    const linksWrap = links.some((l) => l.offsetTop > top0 + 2);
    if (!linksWrap) return;                                        // all fit → no "More"
    more.hidden = false;
    // Hide trailing links until "More" + the visible links all sit on line one.
    for (let i = links.length - 1; i >= 0; i--) {
      const fits = more.offsetTop <= top0 + 2 &&
        !links.some((l) => l.style.display !== 'none' && l.offsetTop > top0 + 2);
      if (fits) break;
      links[i].style.display = 'none';
    }
  };
  requestAnimationFrame(fit);
  setTimeout(fit, 250);
  window.addEventListener('resize', () => requestAnimationFrame(fit), { passive: true });
}

// Phase 4: topic-page AI Insights sections open as INLINE dropdowns on the page
// (no modal). Each path tile toggles a panel right under the tiles that mounts
// the AI Insights builder for that section, with its own nav/topic-switcher
// hidden (the page tiles ARE the nav). One open at a time.
// The five AI Insights tracks, in display order — shared by the topic-page
// tiles and the main-nav "AI Insights" topic-tree dropdown (Phase 3). The group
// ids match the AI component's builder groups.
const AII_NAV_GROUPS = [
  { group: 'discover',       label: 'Get Caught Up' },
  { group: 'topic-specific', label: 'Deep Dive' },
  { group: 'learn',          label: '101 Resources' },
  { group: 'websearch',      label: 'Web Search' },
  { group: 'external',       label: 'Prompt Library' },
];

// Deep-link into a topic page's inline AI section. If we're already on that
// topic, open it in place (the inline wiring listens on the window); otherwise
// stash the request and navigate — wireTopicAiiInline consumes it on render.
let pendingInlineAii = null;
function openTopicInsightInline(slug, group) {
  const cur = getCurrentRoute();
  if (cur && cur.type === 'topic' && cur.slug === slug) {
    window.dispatchEvent(new CustomEvent('aii-inline-open', { detail: { slug, group } }));
  } else {
    pendingInlineAii = { slug, group };
    navigate('#/topic/' + slug);
  }
}

// ── Shared main-nav dropdown shell (Phase 3 + Phase 5) ───────────────────────
// One body-appended full-width panel that drops below the header (the header
// stays clickable above it). Different nav buttons fill it with different
// content (AI Insights topic tree, Topics tree, Trending list) via a config.
const X_IC_NAVDD = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
let navDdOpen = null;   // { key, triggerId } of the currently-open dropdown
let navDdSuppressClose = false;   // guards the re-entrant close-all-modals dispatch on open

function ensureNavDropdown() {
  let overlay = document.getElementById('st-nav-overlay');
  let panel = document.getElementById('st-nav-panel');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'aii-nav-overlay'; overlay.id = 'st-nav-overlay';
    document.body.appendChild(overlay);
  }
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'aii-nav-dd'; panel.id = 'st-nav-panel';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false');
    document.body.appendChild(panel);
    // Single top-level overlay invariant: when any modal opens it fires
    // close-all-modals — drop the nav dropdown too. (We don't fire it ourselves
    // on close, to avoid clobbering modals we deliberately open from a row.)
    window.addEventListener('close-all-modals', () => { if (!navDdSuppressClose) closeNavDropdown(); });
  }
  return { overlay, panel };
}

function closeNavDropdown() {
  const overlay = document.getElementById('st-nav-overlay');
  const panel = document.getElementById('st-nav-panel');
  if (panel) panel.classList.remove('is-open');
  if (overlay) overlay.classList.remove('is-open');
  if (navDdOpen && navDdOpen.triggerId) document.getElementById(navDdOpen.triggerId)?.setAttribute('aria-expanded', 'false');
  navDdOpen = null;
}
// Back-compat alias used by the route-change/Esc handlers.
function closeAiInsightsNavDropdown() { closeNavDropdown(); }

function updateNavDdFades() {
  const host = document.querySelector('#st-nav-panel .aii-nav-dd-scrollwrap');
  const sc = document.querySelector('#st-nav-panel [data-navdd-scroll]');
  if (!host || !sc) return;
  const t = sc.scrollTop, m = sc.scrollHeight - sc.clientHeight;
  host.classList.toggle('fade-top', t > 4);
  host.classList.toggle('fade-bot', m > 6 && t < m - 4);
}

// A route-aware user close: search resets its deep-link route back home; other
// dropdowns just close. Wired to the close button, overlay click, and Esc.
function userCloseNavDropdown() {
  if (navDdOpen && navDdOpen.key === 'search') {
    const hash = window.location.hash || '';
    const onSearchRoute = hash.startsWith('#/custom/') || hash === '#/search';
    closeNavDropdown();
    if (onSearchRoute) navigate('#/');
    return;
  }
  closeNavDropdown();
}

// cfg: { key, triggerId, title, subtitle, spark, ariaLabel, bareHead, className, subBarHTML, contentHTML, wire(panel) }
function openNavDropdown(cfg) {
  const { overlay, panel } = ensureNavDropdown();
  // Close any open modal first (the nav dropdown is the single top-level layer).
  // Guard the re-entrant close-all-modals handler so it doesn't cancel this open.
  navDdSuppressClose = true;
  window.dispatchEvent(new CustomEvent('close-all-modals'));
  navDdSuppressClose = false;
  panel.setAttribute('aria-label', cfg.ariaLabel || cfg.title || '');
  panel.className = 'aii-nav-dd' + (cfg.className ? ' ' + cfg.className : '');
  const head = cfg.bareHead
    ? `<div class="aii-nav-dd-head aii-nav-dd-head-bare"><button type="button" class="aii-nav-dd-close" data-navdd-close aria-label="Close">${X_IC_NAVDD}</button></div>`
    : `<div class="aii-nav-dd-head">
        <div class="aii-nav-dd-titles">
          <div class="aii-nav-dd-title">${cfg.spark ? '<span class="aii-nav-dd-spark">✦</span> ' : ''}${escapeHTML(cfg.title || '')}</div>
          ${cfg.subtitle ? `<div class="aii-nav-dd-sub">${escapeHTML(cfg.subtitle)}</div>` : ''}
        </div>
        <button type="button" class="aii-nav-dd-close" data-navdd-close aria-label="Close">${X_IC_NAVDD}</button>
      </div>`;
  panel.innerHTML = `
    <div class="aii-nav-dd-inner">
      ${head}
      ${cfg.subBarHTML ? `<div class="aii-nav-dd-subbar">${cfg.subBarHTML}</div>` : ''}
      <div class="aii-nav-dd-scrollwrap has-fade">
        <div class="aii-nav-dd-scroll" data-navdd-scroll>${cfg.contentHTML || ''}</div>
      </div>
    </div>`;
  const closeFn = cfg.onClose || closeNavDropdown;
  panel.querySelector('[data-navdd-close]')?.addEventListener('click', closeFn);
  overlay.onclick = closeFn;
  const sc = panel.querySelector('[data-navdd-scroll]');
  if (sc) sc.addEventListener('scroll', updateNavDdFades, { passive: true });
  if (typeof cfg.wire === 'function') cfg.wire(panel);
  panel.classList.add('is-open');
  overlay.classList.add('is-open');
  navDdOpen = { key: cfg.key, triggerId: cfg.triggerId };
  if (cfg.triggerId) document.getElementById(cfg.triggerId)?.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(updateNavDdFades);
}

function toggleNavDropdown(cfg) {
  const panel = document.getElementById('st-nav-panel');
  if (panel && panel.classList.contains('is-open') && navDdOpen && navDdOpen.key === cfg.key) { closeNavDropdown(); return; }
  closeNavDropdown();
  openNavDropdown(cfg);
}

// Shared accordion wiring for the topic-tree dropdowns.
function wireNavDdAccordions(panel) {
  panel.querySelectorAll('[data-aiidd-toggle]').forEach((btn) => btn.addEventListener('click', () => {
    const sec = btn.closest('.aiidd-parent');
    const open = sec.getAttribute('data-open') === 'true';
    sec.setAttribute('data-open', String(!open));
    btn.setAttribute('aria-expanded', String(!open));
    requestAnimationFrame(updateNavDdFades);
  }));
}

// ── Phase 3: the main-nav "AI Insights" topic-tree dropdown ──────────────────
// Every parent topic is an accordion; expanding shows the parent + its
// subtopics, each with the five AI tracks as chips. Clicking a chip routes to
// that topic page and opens the matching inline section.
function aiInsightsTopicTreeHTML() {
  const groups = getTopicsGroupedByParent() || [];
  const chipsFor = (t) => `<div class="aiidd-chips">${AII_NAV_GROUPS.map((g) =>
    `<button type="button" class="aiidd-chip" data-aiidd-go data-slug="${escapeHTML(t.slug)}" data-group="${escapeHTML(g.group)}">${escapeHTML(g.label)}</button>`
  ).join('')}</div>`;
  const topicRow = (t, isParent) => `
    <div class="aiidd-topic${isParent ? ' aiidd-topic-parent' : ''}">
      <a href="#/topic/${t.slug}" class="aiidd-topic-name" data-aiidd-topic>
        <span class="aiidd-topic-ic">${topicIconSVG(t.icon || 'globe', 'tsp-ic-svg')}</span>
        <span class="aiidd-topic-tx">${escapeHTML(t.name)}</span>
      </a>
      ${chipsFor(t)}
    </div>`;
  const block = ({ parent, subtopics }) => {
    const subs = subtopics || [];
    return `<section class="aiidd-parent" data-open="false">
      <button type="button" class="aiidd-parent-head" data-aiidd-toggle aria-expanded="false">
        <span class="aiidd-parent-ic">${topicIconSVG(parent.icon || 'globe', 'tsp-ic-svg')}</span>
        <span class="aiidd-parent-name">${escapeHTML(parent.name)}</span>
        ${subs.length ? `<span class="aiidd-parent-count">${subs.length}</span>` : ''}
        ${TSP_CHEV}
      </button>
      <div class="aiidd-parent-body">
        ${topicRow(parent, true)}
        ${subs.map((t) => topicRow(t, false)).join('')}
      </div>
    </section>`;
  };
  return `<div class="aiidd-tree">${groups.map(block).join('')}</div>`;
}

function openAiInsightsNavDropdown() {
  openNavDropdown({
    key: 'insights', triggerId: 'nav-insights', spark: true,
    title: 'AI Insights', ariaLabel: 'AI Insights',
    subtitle: 'Pick a topic, then the kind of intelligence you want.',
    contentHTML: aiInsightsTopicTreeHTML(),
    wire: (panel) => {
      wireNavDdAccordions(panel);
      panel.querySelectorAll('[data-aiidd-go]').forEach((chip) => chip.addEventListener('click', (e) => {
        e.preventDefault();
        closeNavDropdown();
        openTopicInsightInline(chip.dataset.slug, chip.dataset.group);
      }));
      panel.querySelectorAll('[data-aiidd-topic]').forEach((a) => a.addEventListener('click', () => closeNavDropdown()));
    },
  });
}
function toggleAiInsightsNavDropdown() {
  toggleNavDropdown({ key: 'insights', triggerId: 'nav-insights', spark: true,
    title: 'AI Insights', ariaLabel: 'AI Insights',
    subtitle: 'Pick a topic, then the kind of intelligence you want.',
    contentHTML: aiInsightsTopicTreeHTML(),
    wire: (panel) => {
      wireNavDdAccordions(panel);
      panel.querySelectorAll('[data-aiidd-go]').forEach((chip) => chip.addEventListener('click', (e) => {
        e.preventDefault(); closeNavDropdown(); openTopicInsightInline(chip.dataset.slug, chip.dataset.group);
      }));
      panel.querySelectorAll('[data-aiidd-topic]').forEach((a) => a.addEventListener('click', () => closeNavDropdown()));
    },
  });
}

// ── Phase 5: the main-nav "Topics" topic-tree dropdown ───────────────────────
// Same accordion shell, but the rows are plain topic links (no AI track chips):
// a flat "All {parent}" link + each subtopic. Replaces the All Topics modal.
function topicsTreeHTML() {
  const groups = getTopicsGroupedByParent() || [];
  const block = ({ parent, subtopics }) => {
    const subs = subtopics || [];
    if (!subs.length) {
      return `<a href="#/topic/${parent.slug}" class="aiidd-parent aiidd-parent-flat" data-aiidd-link>
        <span class="aiidd-parent-ic">${topicIconSVG(parent.icon || 'globe', 'tsp-ic-svg')}</span>
        <span class="aiidd-parent-name">${escapeHTML(parent.name)}</span>
        <span class="aiidd-flat-arrow" aria-hidden="true">${TSP_CHEV}</span>
      </a>`;
    }
    const links = `<a href="#/topic/${parent.slug}" class="aiidd-tlink aiidd-tlink-all" data-aiidd-link>All ${escapeHTML(parent.name)}</a>`
      + subs.map((s) => `<a href="#/topic/${s.slug}" class="aiidd-tlink" data-aiidd-link>${escapeHTML(s.name)}</a>`).join('');
    return `<section class="aiidd-parent" data-open="false">
      <button type="button" class="aiidd-parent-head" data-aiidd-toggle aria-expanded="false">
        <span class="aiidd-parent-ic">${topicIconSVG(parent.icon || 'globe', 'tsp-ic-svg')}</span>
        <span class="aiidd-parent-name">${escapeHTML(parent.name)}</span>
        <span class="aiidd-parent-count">${subs.length}</span>
        ${TSP_CHEV}
      </button>
      <div class="aiidd-parent-body"><div class="aiidd-tlinks">${links}</div></div>
    </section>`;
  };
  return `<div class="aiidd-tree">${groups.map(block).join('')}</div>`;
}
function toggleTopicsNavDropdown() {
  toggleNavDropdown({
    key: 'topics', triggerId: 'nav-topics',
    title: 'All Topics', ariaLabel: 'All topics',
    subtitle: 'Browse every topic and its subtopics.',
    contentHTML: topicsTreeHTML(),
    wire: (panel) => {
      wireNavDdAccordions(panel);
      panel.querySelectorAll('[data-aiidd-link]').forEach((a) => a.addEventListener('click', () => closeNavDropdown()));
    },
  });
}

// ── Phase 5: the main-nav "Trending" dropdown ────────────────────────────────
// Hosts the same renderTrendingModal() the old modal used: an AI-legend sub-bar
// + the live trend-card grid (which scrolls inside the shell). Clicking a card
// opens its detail view (still a takeover) and closes the dropdown.
function toggleTrendingNavDropdown() {
  toggleNavDropdown({
    key: 'trending', triggerId: 'nav-trending',
    title: 'Trending', ariaLabel: 'Trending now',
    subtitle: "What's being searched for right now.",
    subBarHTML: '<div class="tlm-controlbar" data-trend-controls></div>',
    contentHTML: '<div data-trend-grid></div>',
    wire: (panel) => {
      const controls = panel.querySelector('[data-trend-controls]');
      const grid = panel.querySelector('[data-trend-grid]');
      try { renderTrendingModal(controls, grid); } catch (_) {}
      // A trend card opens its detail takeover — close the dropdown behind it.
      grid.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('.trend-card:not(.trend-card-skel)')) closeNavDropdown();
      });
      // Refresh the scroll fades once the async trend load paints.
      [350, 900, 1800].forEach((d) => setTimeout(updateNavDdFades, d));
    },
  });
}

function wireTopicAiiInline(section, topic, descriptions, icons) {
  // IMPORTANT: the AI component re-renders its OWN innards (rebuilding `.aii-stage`
  // and wiping anything we appended) whenever the 899.98px breakpoint is crossed —
  // which on a real phone fires on address-bar show/hide + orientation. So we must
  // (a) attach the intercept to the STABLE `section` element (never replaced), and
  // (b) look up the current stage + (re)create the inline panel FRESH on each open.
  let activeGroup = null; let ctl = null;
  const getStage = () => section.querySelector('.aii-stage');
  const getPanel = (create) => {
    const stage = getStage();
    if (!stage) return null;
    let panel = stage.querySelector('.aii-inline-panel');
    if (!panel && create) { panel = document.createElement('div'); panel.className = 'aii-inline-panel'; panel.hidden = true; stage.appendChild(panel); }
    return panel;
  };
  const clearTiles = () => section.querySelectorAll('.aii-bcard.is-active').forEach((b) => { b.classList.remove('is-active'); b.setAttribute('aria-expanded', 'false'); });
  const close = () => {
    activeGroup = null;
    if (ctl && ctl.destroy) { try { ctl.destroy(); } catch (_) {} }
    ctl = null;
    const panel = getPanel(false);
    if (panel) { panel.hidden = true; panel.innerHTML = ''; }
    clearTiles();
  };
  const isOpen = () => { const p = getPanel(false); return !!(p && !p.hidden); };
  const openGroup = (group, tile) => {
    if (activeGroup === group && isOpen()) { close(); return; }
    close();
    const panel = getPanel(true);
    if (!panel) return;
    activeGroup = group; panel.hidden = false;
    if (tile) { tile.classList.add('is-active'); tile.setAttribute('aria-expanded', 'true'); }
    ctl = renderAIIntelligence(panel, {
      inModal: true, initialBuilder: true, initialGroup: group, lockTopic: true,
      topic: topic.name, label: topic.name, descriptions, icons, topicKey: topic.slug,
    });
    // Capped scroll area gets the same clean top/bottom fades (#89).
    const sc = panel.querySelector('.aii-builder-secs');
    if (sc) {
      panel.classList.add('has-fade');
      const upd = () => { const t = sc.scrollTop, m = sc.scrollHeight - sc.clientHeight; panel.classList.toggle('fade-top', t > 4); panel.classList.toggle('fade-bot', m > 6 && t < m - 4); };
      sc.addEventListener('scroll', upd, { passive: true });
      [0, 450, 1400].forEach((d) => setTimeout(upd, d));
    }
    requestAnimationFrame(() => panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  // Capture-phase on the STABLE section: intercept the tile click BEFORE the
  // component's own modal-open handler (and before any post-re-render rewire),
  // and open the section inline instead.
  section.addEventListener('click', (e) => {
    const tile = e.target.closest && e.target.closest('.aii-bcard[data-builder-open]');
    if (!tile || !section.contains(tile)) return;
    e.stopPropagation(); e.preventDefault();
    openGroup(tile.dataset.group, tile);
  }, true);

  // Deep-link support (Phase 3): open a given track by group id, locating its
  // tile so it highlights. Used by both the same-page event and the pending
  // post-navigation request.
  const openByGroup = (group) => {
    const tile = section.querySelector(`.aii-bcard[data-group="${group}"]`);
    openGroup(group, tile);
  };
  // Same-page deep-links arrive as a window event (the picker is on the nav,
  // not in this section). Re-register on the window each render, dropping the
  // prior page's handler so we never stack duplicates.
  if (window.__aiiInlineHandler) window.removeEventListener('aii-inline-open', window.__aiiInlineHandler);
  window.__aiiInlineHandler = (e) => { if (e.detail && e.detail.slug === topic.slug) openByGroup(e.detail.group); };
  window.addEventListener('aii-inline-open', window.__aiiInlineHandler);
  // Cross-page deep-link: a nav-dropdown click stashed a request then navigated
  // here. Consume it once the tiles exist (next frame).
  if (pendingInlineAii && pendingInlineAii.slug === topic.slug) {
    const g = pendingInlineAii.group; pendingInlineAii = null;
    requestAnimationFrame(() => openByGroup(g));
  }
}

function closeAllPickers(except) {
  document.querySelectorAll('.topic-subnav-picker.is-open').forEach((p) => {
    if (p === except) return;
    p.classList.remove('is-open');
    p.querySelector('.tsp-btn')?.setAttribute('aria-expanded', 'false');
  });
}

// Toggle the topic-picker panel's top/bottom scroll fades (host = .tsp-panel).
function updatePickerFades(picker) {
  const inner = picker.querySelector('.tsp-panel-inner');
  const host = picker.querySelector('.tsp-panel');
  if (!inner || !host) return;
  host.classList.add('has-fade');
  const top = inner.scrollTop;
  const max = inner.scrollHeight - inner.clientHeight;
  host.classList.toggle('fade-top', top > 4);
  host.classList.toggle('fade-bot', max > 6 && top < max - 4);
}

// Wire EVERY picker found in `root` (a topic page now has two — the desktop body
// header + the subnav-band button; CSS shows one at a time per width/scroll).
function wireSubnavPicker(root) {
  root.querySelectorAll('[data-topic-picker]').forEach((picker) => {
    const btn = picker.querySelector('.tsp-btn');
    if (!btn) return;
    const isBodyHead = picker.classList.contains('topic-bodyhead');
    const panelwrap = picker.querySelector('.tsp-panelwrap');
    const setOpen = (on) => {
      if (on) closeAllPickers(picker);
      // Desktop body header: drop the full-width card so it overlays (covers) the
      // inline subtopics row — measured BEFORE the open class hides that row.
      if (on && isBodyHead && panelwrap) {
        const subs = picker.querySelector('.tbh-subs');
        if (subs && window.matchMedia('(min-width: 900px)').matches) panelwrap.style.top = subs.offsetTop + 'px';
        else panelwrap.style.top = '';
      }
      picker.classList.toggle('is-open', on);
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) requestAnimationFrame(() => updatePickerFades(picker));
    };
    // Top/bottom fades on the (capped) panel scroll area — shown only when there's
    // hidden content above/below.
    const inner = picker.querySelector('.tsp-panel-inner');
    if (inner) inner.addEventListener('scroll', () => updatePickerFades(picker), { passive: true });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!picker.classList.contains('is-open'));
    });
    picker.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { setOpen(false); btn.focus(); }
    });
    // Explicit X close.
    picker.querySelector('[data-tsp-close]')?.addEventListener('click', (e) => { e.stopPropagation(); setOpen(false); btn.focus(); });
    // Navigating (a topic cell, the parent row, or Home) closes the panel before
    // the route re-renders (the re-render rebuilds a fresh, collapsed picker).
    picker.querySelectorAll('.tsp-cell, .tsp-parent-row, [data-tsp-home]').forEach((a) =>
      a.addEventListener('click', () => setOpen(false)));
    picker.querySelector('[data-tsp-all]')?.addEventListener('click', (e) => {
      e.preventDefault();
      setOpen(false);
      window.dispatchEvent(new CustomEvent('open-all-topics-modal'));
    });
  });
}

// One-time: clicking anywhere outside an open picker collapses it. Delegated so
// it survives subnav re-renders without accumulating per-render listeners.
let subnavPickerOutsideWired = false;
function wireSubnavPickerOutsideClose() {
  if (subnavPickerOutsideWired) return;
  subnavPickerOutsideWired = true;
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.topic-subnav-picker.is-open').forEach((open) => {
      if (!open.contains(e.target)) {
        open.classList.remove('is-open');
        open.querySelector('.tsp-btn')?.setAttribute('aria-expanded', 'false');
      }
    });
  });
}

function renderLayout(route) {
  const siteHeader = document.getElementById('site-header');
  const subHeader = document.getElementById('sub-header');
  const heroEl = document.getElementById('hero');
  const isHome = route.type === 'home';
  const isMobile = window.matchMedia(MOBILE_QUERY).matches;
  const wasOnHomeDesktop = document.body.classList.contains('home-mode')
    && !document.body.classList.contains('sticky-always');

  // Clean up any prior scroll listener before switching modes
  if (heroScrollHandler) {
    window.removeEventListener('scroll', heroScrollHandler);
    heroScrollHandler = null;
  }

  // Reset classes / sub-header on every render. We DON'T clear the hero
  // when staying within home desktop — the hero content is identical
  // across home tabs and re-rendering it causes layout shift / scroll
  // clamp (which kicks the user out of the sticky-revealed state).
  siteHeader.className = 'is-sticky-hero';
  subHeader.className = '';
  subHeader.innerHTML = '';
  const stayingInHomeDesktop = isHome && !isMobile && wasOnHomeDesktop;
  if (heroEl && !stayingInHomeDesktop) heroEl.innerHTML = '';
  document.body.classList.remove('sticky-always', 'has-subnav', 'home-mode', 'show-subnav-tabs', 'app-mode', 'custom-mode', 'home-search');

  // Always render the main sticky bar + the mobile bottom tab nav
  renderStickyHeroBar(siteHeader, route);
  renderBottomNav(route);

  // All pages: main nav always fixed + visible.
  document.body.classList.add('sticky-always');
  siteHeader.classList.add('is-revealed');

  // App-mode: home / topic routes lock the page to viewport
  // height so the two cards behave like an application panel rather
  // than long-scroll content. Custom-search pages opt out — they
  // scroll naturally so the in-page sticky search bar can pin to
  // the top as the user scrolls past it.
  if (route.type === 'topic') {
    document.body.classList.add('app-mode');
  }
  // Home keeps the app-mode grid (section placement) but adds home-search,
  // which unlocks scrolling so the search hero can sit on top.
  if (route.type === 'home') {
    document.body.classList.add('app-mode', 'home-search');
  }

  // Custom-search pages scroll naturally (no app-mode lock) and carry
  // no subnav — the page's own title + search bar pin to the top as a
  // sticky bar instead. The custom-mode class lets CSS trim the
  // content's top padding (which otherwise reserves room for a subnav
  // that isn't there) and drive the sticky-bar offset.
  if (route.type === 'custom') {
    document.body.classList.add('custom-mode');
  }

  // Title group: icon + name. Hamburger now lives permanently in the
  // main nav next to the brand, so the subnav title is free to sit
  // hard-left without competing with a menu trigger.
  // When a kind label ("Topic") is present, the pill replaces the icon
  // (icon dropped for topic pages); other title-subnav pages keep their icon.
  const titleGroup = (iconKey, title, kindLabel = '') => `
    <div class="topic-banner-titlegroup">
      <div class="topic-banner-titleinner">
        ${kindLabel
          ? `<span class="topic-banner-kind">${escapeHTML(kindLabel)}</span>`
          : topicIconSVG(iconKey, 'topic-banner-icon')}
        <h1 class="topic-banner-title">${escapeHTML(title)}</h1>
      </div>
    </div>
  `;

  if (isHome) {
    document.body.classList.add('home-mode', 'has-subnav');
    subHeader.classList.add('is-subnav');

    // Homepage now uses the SAME dropdown picker as topic pages (#88) — a "Home"
    // label whose dropdown lists the featured topics (replaces the old chip row).
    subHeader.innerHTML = `
      <div class="topic-banner">
        <div class="topic-banner-row topic-banner-row--home-picker">
          ${homeSubnavPickerHTML()}
        </div>
      </div>
    `;
    wireSubnavPicker(subHeader);

    if (heroEl) heroEl.innerHTML = '';

    setupResponsiveNav();
    wireSubnavCompactMeasure();
    return;
  }

  // Prompt generator: title-only subnav.
  if (route.type === 'prompt-generator') {
    document.body.classList.add('has-subnav');
    subHeader.classList.add('is-subnav');
    subHeader.innerHTML = `
      <div class="topic-banner">
        <div class="topic-banner-row">
          ${titleGroup('sparkles', 'Prompt Builder')}
        </div>
      </div>
    `;
    observeSubnavHeight();
    wireSubnavCompactMeasure();
    return;
  }

  // Topic pages get a subnav below the main nav. Custom-search
  // pages no longer use the subnav — their search lives at the top
  // of the page content instead so the input + dropdown can be
  // a normal scrollable part of the page (no z-index / overflow
  // gymnastics fighting with the subnav strip).
  if (route.type === 'topic') {
    document.body.classList.add('has-subnav');
    subHeader.classList.add('is-subnav');

    const topic = getTopicBySlug(route.slug);
    if (!topic) return;
    const related = getRelatedTopics(topic);
    const relatedLinksHTML = related.map(t =>
      `<a href="#/topic/${t.slug}" class="subnav-topic-link">${escapeHTML(t.name)}</a>`
    ).join('');
    const topicDesc = getTopicDescription(topic.slug);
    // Mobile/tabular renders this markup as a hero (icon + big title +
    // one-sentence description + Related chips + section tabs); desktop styles it
    // as the compact identity line (title + chips). The hero icon, description,
    // and inline tabs are mobile-only (CSS).
    subHeader.innerHTML = `
      <div class="topic-banner">
        <div class="topic-banner-row">
          <span class="topic-hero-ico" aria-hidden="true">${topicIconSVG(topic.icon || 'globe', 'topic-hero-ico-svg')}</span>
          ${titleGroup(topic.icon || 'globe', topic.name, 'Topic')}
          ${topicDesc ? `<p class="topic-banner-desc">${escapeHTML(topicDesc)}</p>` : ''}
          ${related.length > 0 ? `
            <div class="topic-hero-related">
              <span class="subnav-lead-label" aria-hidden="true">Related</span>
              <div class="subnav-topics-inline">
                ${relatedLinksHTML}
              </div>
            </div>
          ` : ''}
          ${subnavPickerHTML(topic)}
          <nav class="subnav-tabs" aria-label="Section navigation">
            <button type="button" class="tab-pill tab-pill-newsfeed" data-tab="newsfeed">News Feed</button>
            <button type="button" class="tab-pill tab-pill-shortcuts" data-tab="shortcuts">AI Insights</button>
            <button type="button" class="tab-pill tab-pill-websources" data-tab="websources">Web Search</button>
          </nav>
        </div>
      </div>
    `;

    observeSubnavHeight();
    trimOverflowLinks();
    setupResponsiveNav();
    wireChipStripScrollEnd();
    wireSubnavCompactMeasure();
    wireTopicHeroCondense();
    wireSubnavPicker(subHeader);
  }

  if (route.type === 'about' || route.type === 'terms') {
    document.body.classList.add('has-subnav');
    subHeader.classList.add('is-subnav');
    const title = route.type === 'about' ? 'About' : 'Terms & Conditions';
    const icon = route.type === 'about' ? 'book-open' : 'scroll-text';
    subHeader.innerHTML = `
      <div class="topic-banner">
        <div class="topic-banner-row">
          ${titleGroup(icon, title)}
        </div>
      </div>
    `;
  }

  if (route.type === 'prompt-generator' || route.type === 'about' || route.type === 'terms') {
    setupResponsiveNav();
  }
}

// Mobile-only body-tab navigator. Renders at the TOP of the topic
// layout (inside .topic-layout) — visually attached to the panel
// content it controls, distinct from the subnav band above. CSS
// hides it at >=900px (where shortcuts is in the sidebar and news
// fills the rest of the layout) and on custom pages (shortcuts-only
// — nothing to switch between).
// Fixed top/bottom fade overlays that hint the page body can scroll up/down.
// They sit BELOW the fixed header + subnav (top fade starts at the subnav's
// bottom) so the chrome is never covered, and below modals (z-index 50).
function initScrollFades() {
  if (document.querySelector('.pg-scroll-fade-bottom')) return;
  const top = document.createElement('div'); top.className = 'pg-scroll-fade pg-scroll-fade-top';
  const bot = document.createElement('div'); bot.className = 'pg-scroll-fade pg-scroll-fade-bottom';
  document.body.append(top, bot);
  const sub = document.getElementById('sub-header');
  const update = () => {
    const b = sub ? Math.max(0, Math.round(sub.getBoundingClientRect().bottom)) : 0;
    top.style.top = b + 'px';
    const y = window.scrollY || 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    top.classList.toggle('is-on', y > 8);
    bot.classList.toggle('is-on', max - y > 8);
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(update).observe(document.getElementById('content') || document.body);
  update();
}

function bodyTabsRow(opts = {}) {
  const { showRelated = false, showTrending = false, showSearchTrends = false, showWebSources = false, showShortcuts = true } = opts;
  // Order: (Search & Trends) → News Feed → (Trending) → Intelligence → (Related).
  const tabs = [];
  if (showSearchTrends) {
    tabs.push(`<button type="button" class="tab-pill tab-pill-searchtrends" data-tab="searchtrends">
       <span class="tab-pill-label-long">Search &amp; Trends</span>
       <span class="tab-pill-label-short">Search &amp; Trends</span>
     </button>`);
  }
  tabs.push(
    `<button type="button" class="tab-pill tab-pill-newsfeed" data-tab="newsfeed">
       <svg class="tab-pill-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></svg>
       <span class="tab-pill-label-long">News Feed</span>
       <span class="tab-pill-label-short">News Feed</span>
     </button>`,
  );
  if (showTrending) {
    tabs.push(`<button type="button" class="tab-pill tab-pill-trending" data-tab="trending">
       <span class="tab-pill-label-long">Trending</span>
       <span class="tab-pill-label-short">Trending</span>
     </button>`);
  }
  if (showShortcuts) {
    tabs.push(`<button type="button" class="tab-pill tab-pill-shortcuts" data-tab="shortcuts">
       <svg class="tab-pill-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/></svg>
       <span class="tab-pill-label-long">AI Insights</span>
       <span class="tab-pill-label-short">AI Insights</span>
     </button>`);
  }
  if (showWebSources) {
    tabs.push(`<button type="button" class="tab-pill tab-pill-websources" data-tab="websources">
       <span class="tab-pill-label-long">Web Search</span>
       <span class="tab-pill-label-short">Web Search</span>
     </button>`);
  }
  if (showRelated) {
    tabs.push(`<button type="button" class="tab-pill tab-pill-related" data-tab="related">Related</button>`);
  }
  return `<nav class="body-tabs" aria-label="Section navigation">${tabs.join('')}</nav>`;
}

// On every render, sync the active tab from the current route's
// `tab` field (parsed from the URL hash, e.g. #/topic/fintech/shortcuts).
// The click handler is attached once via setupGlobalTabPillDelegation,
// so pills always work — but the active state needs setting on each
// render so refreshes / direct links land on the right tab.
function setupTabPills() {
  const route = getCurrentRoute();
  const tab = route?.tab || 'newsfeed';
  // Must clear EVERY tab class (incl. websources) — otherwise switching topics
  // from a Web Sources tab leaves active-tab-websources on the body and the
  // stale section bleeds onto the new topic page alongside the new tab.
  ['searchtrends', 'newsfeed', 'trending', 'shortcuts', 'websources', 'related'].forEach(t =>
    document.body.classList.remove(`active-tab-${t}`)
  );
  document.body.classList.add(`active-tab-${tab}`);
  document.querySelectorAll('.body-tabs .tab-pill, #sub-header .tab-pill').forEach(p =>
    p.classList.toggle('active', p.dataset.tab === tab)
  );
}

let tabPillDelegationBound = false;
function setupGlobalTabPillDelegation() {
  if (tabPillDelegationBound) return;
  tabPillDelegationBound = true;
  document.addEventListener('click', (e) => {
    const pill = e.target.closest('.body-tabs .tab-pill, #sub-header .tab-pill');
    if (!pill) return;
    e.preventDefault();
    const tab = pill.dataset.tab;
    if (!tab) return;
    // Swap the body class for the visible-section CSS rules.
    ['searchtrends', 'newsfeed', 'trending', 'shortcuts', 'websources', 'related'].forEach(t =>
      document.body.classList.remove(`active-tab-${t}`)
    );
    document.body.classList.add(`active-tab-${tab}`);
    document.querySelectorAll('.body-tabs .tab-pill, #sub-header .tab-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.tab === tab)
    );
    // The newly-shown panel starts at the top, so re-expand the topic hero.
    document.body.classList.remove('topic-hero-condensed');
    // Update the URL (without re-rendering) so refresh / shared links
    // preserve the active tab. News tab is the default — no extra
    // path segment for it. Shortcuts / Related get appended.
    const route = getCurrentRoute();
    if (!route) return;
    let newHash = null;
    if (route.type === 'home') {
      newHash = tab === 'searchtrends' ? '#/' : `#/${tab}`;
    } else if (route.type === 'topic') {
      newHash = tab === 'newsfeed'
        ? `#/topic/${route.slug}`
        : `#/topic/${route.slug}/${tab}`;
    }
    if (newHash && newHash !== window.location.hash) {
      history.replaceState(null, '', newHash);
      // Keep currentRoute.tab in sync without re-firing the router,
      // so a subsequent click reads the right "current" state.
      route.tab = tab;
    }
  });
}

// Custom-search subnav — renders the search term inside a button
// that visually reads as an editable search field. Click anywhere
// on it reopens the Topics modal with the term pre-filled so the
// user can refine the search rather than retype it. The "Edit"
// affordance on the right makes the click target's purpose
// explicit at a glance.
function renderCustomSearchBar(container, term) {
  container.innerHTML = `
    <div class="custom-search-input-wrap" data-role="custom-search">
      <span class="custom-search-input-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      </span>
      <input
        type="text"
        class="custom-search-input"
        data-role="custom-search-input"
        value="${escapeAttr(term)}"
        placeholder="Search any topic"
        autocomplete="off"
        spellcheck="false"
        aria-label="Search topic"
      />
      <button type="button" class="custom-search-clear" data-action="clear" aria-label="Clear">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <div class="custom-search-dropdown" data-role="dropdown" hidden></div>
    </div>
  `;
  wireCustomSearchInput(container, term);
}

// Live-search input wiring for the custom-search subnav.
// As the user types, debounced 280ms:
//   - re-renders the shortcuts section in-place with the new term
//     (so the AI shortcuts / web sources update to use the new query)
//   - rewrites the URL via history.replaceState so refresh / share
//     captures the current term, without firing hashchange (which
//     would re-render the entire layout and blow away focus)
//   - re-renders the autocomplete dropdown with matching topics
// Enter / clicking a topic does navigate (hashchange) so the route
// type can transition from custom → topic when the user picks a real
// topic from the dropdown.
function wireCustomSearchInput(container, initialTerm) {
  const wrap = container.querySelector('[data-role="custom-search"]');
  const input = container.querySelector('[data-role="custom-search-input"]');
  const dropdown = container.querySelector('[data-role="dropdown"]');
  const clearBtn = container.querySelector('[data-action="clear"]');
  if (!wrap || !input || !dropdown) return;

  let debounceTimer = null;
  let highlightedIdx = -1;
  let currentMatches = [];

  const updateClearVisible = () => {
    clearBtn.style.display = input.value.trim() ? 'inline-flex' : 'none';
  };
  updateClearVisible();

  const renderDropdown = (q) => {
    const matches = q ? searchTopics(q).slice(0, 6) : [];
    currentMatches = matches;
    highlightedIdx = -1;
    if (!q) {
      dropdown.hidden = true;
      dropdown.innerHTML = '';
      return;
    }
    const matchHTML = matches.map((m, i) => {
      const parent = m.parentName
        ? `<span class="custom-search-result-parent">${escapeHTML(m.parentName)}</span>`
        : '';
      return `
        <div class="custom-search-result" data-slug="${escapeAttr(m.slug)}" data-idx="${i}" role="button" tabindex="-1">
          <span class="custom-search-result-name">${highlightCustomMatch(m.name, q)}</span>
          ${parent}
          <span class="custom-search-result-arrow" aria-hidden="true">›</span>
        </div>
      `;
    }).join('');
    dropdown.innerHTML = `
      ${matchHTML || `<div class="custom-search-empty">No matching topics</div>`}
      <div class="custom-search-custom-cta" data-action="custom" role="button" tabindex="-1">
        <span class="custom-search-custom-badge" aria-hidden="true">+</span>
        <span class="custom-search-custom-text">
          <span class="custom-search-custom-action">Use as custom topic</span>
          <span class="custom-search-custom-term">${escapeHTML(q)}</span>
        </span>
      </div>
    `;
    dropdown.hidden = false;
  };

  const liveUpdate = (q) => {
    const trimmed = q.trim();
    const newHash = trimmed ? `#/custom/${encodeURIComponent(trimmed)}` : '#/';
    if (window.location.hash !== newHash && trimmed) {
      history.replaceState(null, '', newHash);
    }
    const shortcutsSection = document.querySelector('#section-shortcuts');
    if (shortcutsSection) {
      const route = { type: 'custom', term: trimmed, tab: 'shortcuts' };
      renderShortcutsSidebar(shortcutsSection, route, false, true, trimmed);
    }
  };

  input.addEventListener('input', () => {
    updateClearVisible();
    const q = input.value;
    renderDropdown(q.trim());
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => liveUpdate(q), 280);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) renderDropdown(input.value.trim());
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentMatches.length === 0) return;
      highlightedIdx = Math.min(highlightedIdx + 1, currentMatches.length - 1);
      updateHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightedIdx = Math.max(highlightedIdx - 1, -1);
      updateHighlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const term = input.value.trim();
      if (highlightedIdx >= 0 && currentMatches[highlightedIdx]) {
        navigate(`#/topic/${currentMatches[highlightedIdx].slug}`);
      } else if (term) {
        navigate(`#/custom/${encodeURIComponent(term)}`);
      }
      dropdown.hidden = true;
    } else if (e.key === 'Escape') {
      dropdown.hidden = true;
      input.blur();
    }
  });

  const updateHighlight = () => {
    dropdown.querySelectorAll('.custom-search-result').forEach((el, i) => {
      el.classList.toggle('is-highlighted', i === highlightedIdx);
    });
  };

  dropdown.addEventListener('mousedown', (e) => {
    const result = e.target.closest('.custom-search-result');
    const customCta = e.target.closest('[data-action="custom"]');
    if (result) {
      e.preventDefault();
      navigate(`#/topic/${result.dataset.slug}`);
      dropdown.hidden = true;
    } else if (customCta) {
      e.preventDefault();
      const term = input.value.trim();
      if (term) navigate(`#/custom/${encodeURIComponent(term)}`);
      dropdown.hidden = true;
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    updateClearVisible();
    dropdown.hidden = true;
    input.focus();
    history.replaceState(null, '', '#/');
    // Re-render shortcuts section as empty/home state.
    const shortcutsSection = document.querySelector('#section-shortcuts');
    if (shortcutsSection) {
      const route = { type: 'custom', term: '', tab: 'shortcuts' };
      renderShortcutsSidebar(shortcutsSection, route, false, true, '');
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (!wrap.contains(e.target)) {
      dropdown.hidden = true;
    }
  });
}

function highlightCustomMatch(name, query) {
  const idx = name.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHTML(name);
  const before = name.slice(0, idx);
  const match = name.slice(idx, idx + query.length);
  const after = name.slice(idx + query.length);
  return `${escapeHTML(before)}<strong>${escapeHTML(match)}</strong>${escapeHTML(after)}`;
}

// navigate helper — uses router's hash navigation so the route handler
// fires and the layout updates accordingly.
function navigate(hash) {
  window.location.hash = hash;
}

// Unified subnav renderer for custom search pages. When a `prefix` is
// supplied (e.g. "Search:" on custom-search routes) the title renders
// as a labelled value: bold prefix + lighter term, with desktop and
// mobile layouts styled in CSS.
function renderSubNav(container, { title, iconKey, prefix }) {
  const titleHTML = prefix
    ? `<h1 class="topic-banner-title topic-banner-title-search">
         <span class="topic-banner-title-prefix">${escapeHTML(prefix)}</span>
         <span class="topic-banner-title-term">${escapeHTML(title)}</span>
       </h1>`
    : `<h1 class="topic-banner-title">${escapeHTML(title)}</h1>`;
  container.innerHTML = `
    <div class="topic-banner">
      <div class="topic-banner-row">
        <div class="topic-banner-titlegroup">
          <div class="topic-banner-titleinner">
            ${iconKey ? topicIconSVG(iconKey, 'topic-banner-icon') : ''}
            ${titleHTML}
          </div>
        </div>
      </div>
    </div>
  `;
}

// On home desktop, reveal main nav AND transition subnav (top: 0 → top: 56px)
// at the same scroll point. Threshold = roughly when subnav reaches viewport top.
function setupHomeStickyReveal(mainEl, subEl) {
  const heroEl = document.getElementById('hero');
  const computeThreshold = () => Math.max(0, (heroEl?.offsetHeight || 200) - 56);
  let threshold = computeThreshold();

  heroScrollHandler = () => {
    // >= so that landing at exactly threshold (clean tab-switch position)
    // also counts as revealed
    const passed = window.scrollY >= threshold;
    mainEl.classList.toggle('is-revealed', passed);
    if (subEl) subEl.classList.toggle('with-mainnav', passed);
  };
  window.addEventListener('scroll', heroScrollHandler, { passive: true });
  window.addEventListener('resize', () => {
    threshold = computeThreshold();
  }, { passive: true });
  heroScrollHandler();
}

// Hide subnav topic links that overflow the container. Runs on render,
// Wire the chip strip's right-edge scroll detection: toggles
// .is-at-end so the CSS fade lifts when the user reaches the last
// item, letting "All Topics +" / "More +" sit fully visible
// without being cut off by the mask gradient. Also wires + manages
// left/right scroll arrows that are visible only on hover-capable
// devices (desktop with mouse) — touch devices can swipe natively.
function wireChipStripScrollEnd() {
  const chipStrip = document.querySelector('#sub-header.is-subnav .subnav-topics-inline');
  if (!chipStrip) return;

  // Inject left/right arrow buttons as siblings of the chip strip
  // so they can absolute-position over the strip's edges. Skip
  // re-injection if they were added on a previous render.
  let parent = chipStrip.parentElement;
  // Wrap the chip strip in a relative container the first time we
  // see it so the arrows can position against it instead of the
  // (grid) parent.
  let wrap = chipStrip.previousElementSibling?.classList?.contains('subnav-chip-wrap')
    ? chipStrip.previousElementSibling
    : null;
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'subnav-chip-wrap';
    parent.insertBefore(wrap, chipStrip);
    wrap.appendChild(chipStrip);
    // Move trailing siblings that belong with the chips (e.g. the
    // home subnav's "All Topics +" link, which now lives INSIDE
    // .subnav-topics-inline so this isn't usually needed).
  }
  // Ensure left/right arrow buttons exist as siblings of the strip
  let leftBtn = wrap.querySelector(':scope > .subnav-chip-arrow-left');
  let rightBtn = wrap.querySelector(':scope > .subnav-chip-arrow-right');
  if (!leftBtn) {
    leftBtn = document.createElement('button');
    leftBtn.type = 'button';
    leftBtn.className = 'subnav-chip-arrow subnav-chip-arrow-left';
    leftBtn.setAttribute('aria-label', 'Scroll topics left');
    leftBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 6 9 12 15 18"/></svg>';
    wrap.insertBefore(leftBtn, chipStrip);
  }
  if (!rightBtn) {
    rightBtn = document.createElement('button');
    rightBtn.type = 'button';
    rightBtn.className = 'subnav-chip-arrow subnav-chip-arrow-right';
    rightBtn.setAttribute('aria-label', 'Scroll topics right');
    rightBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';
    wrap.appendChild(rightBtn);
  }

  const updateScrollState = () => {
    const atStart = chipStrip.scrollLeft <= 1;
    const atEnd = chipStrip.scrollLeft + chipStrip.clientWidth >= chipStrip.scrollWidth - 1;
    const overflowing = chipStrip.scrollWidth > chipStrip.clientWidth + 1;
    chipStrip.classList.toggle('is-at-end', atEnd);
    chipStrip.classList.toggle('is-at-start', atStart);
    wrap.classList.toggle('has-scroll', overflowing);
    wrap.classList.toggle('can-scroll-left', overflowing && !atStart);
    wrap.classList.toggle('can-scroll-right', overflowing && !atEnd);
  };
  chipStrip.addEventListener('scroll', updateScrollState, { passive: true });
  // Re-evaluate after layout settles (fonts, images, etc.)
  requestAnimationFrame(updateScrollState);
  setTimeout(updateScrollState, 250);

  const stepBy = () => Math.max(120, Math.round(chipStrip.clientWidth * 0.7));
  leftBtn.onclick = () => chipStrip.scrollBy({ left: -stepBy(), behavior: 'smooth' });
  rightBtn.onclick = () => chipStrip.scrollBy({ left:  stepBy(), behavior: 'smooth' });
}

// In tabbed-nav widths the page title + tab pills sit on the same
// row. If the title text would wrap (run into a second line because
// it's too long for the available width), swap "News Feed" for the
// shorter "News" label (handled in CSS via body.subnav-compact).
// We detect wrap by comparing the title element's rendered height
// against a single-line threshold — robust whether the title bumps
// horizontally or breaks to a new line.
let subnavCompactResizeHandler = null;
let subnavCompactLastWidth = null;
function wireSubnavCompactMeasure() {
  const titleGroupEl = document.querySelector('#sub-header.is-subnav .topic-banner-titlegroup');
  const titleEl = document.querySelector('#sub-header.is-subnav .topic-banner-title');
  const tabPillsEl = document.querySelector('#sub-header.is-subnav .subnav-tab-pills');
  if (!titleGroupEl || !titleEl || !tabPillsEl) {
    document.body.classList.remove('subnav-title-shrunk');
    document.body.classList.remove('subnav-title-shrunk-2');
    return;
  }
  const isWrapping = () => {
    const cs = getComputedStyle(titleEl);
    const fontSize = parseFloat(cs.fontSize) || 16;
    const lineHeightRaw = parseFloat(cs.lineHeight);
    const lineHeight = isNaN(lineHeightRaw) ? fontSize * 1.2 : lineHeightRaw;
    return titleEl.offsetHeight > lineHeight * 1.4;
  };
  const measure = () => {
    document.body.classList.remove('subnav-title-shrunk');
    document.body.classList.remove('subnav-title-shrunk-2');
    if (!window.matchMedia('(max-width: 899.98px)').matches) return;

    // Belt-and-suspenders: pre-apply a tier based on a length +
    // viewport heuristic BEFORE measuring. With the title now on
    // its own full-width row (chips + tabs are stacked below), it
    // gets far more horizontal room than it did when sharing a
    // row with the pills, so the thresholds are loosened to keep
    // nearly all titles at the default size. Only the longest
    // names ("Defense, Security, Foreign Policy", etc.) still
    // need to scale at the narrowest widths.
    const titleText = (titleEl.textContent || '').trim();
    const len = titleText.length;
    const vw = window.innerWidth;
    let preTier = 0;
    if (vw <= 380) {
      if (len > 28) preTier = 2;
      else if (len > 20) preTier = 1;
    } else if (vw <= 480) {
      if (len > 32) preTier = 2;
      else if (len > 24) preTier = 1;
    } else if (vw <= 700) {
      if (len > 38) preTier = 1;
    }
    // 700-899: full width comfortably fits every current topic
    // name at the default 1.5rem size; no pre-tier.
    if (preTier >= 1) document.body.classList.add('subnav-title-shrunk');
    if (preTier >= 2) document.body.classList.add('subnav-title-shrunk-2');

    // Then verify with the actual layout: if still wrapping,
    // escalate one more tier; if NOT wrapping at a lower tier
    // than we pre-applied, we leave the pre-applied tier alone
    // (the heuristic erred conservatively — better slightly small
    // than wrapping).
    titleEl.getBoundingClientRect();
    if (isWrapping()) {
      if (!document.body.classList.contains('subnav-title-shrunk')) {
        document.body.classList.add('subnav-title-shrunk');
      } else if (!document.body.classList.contains('subnav-title-shrunk-2')) {
        document.body.classList.add('subnav-title-shrunk-2');
      }
    }
  };
  if (subnavCompactResizeHandler) {
    window.removeEventListener('resize', subnavCompactResizeHandler);
  }
  subnavCompactLastWidth = window.innerWidth;
  subnavCompactResizeHandler = () => {
    if (window.innerWidth === subnavCompactLastWidth) return;
    subnavCompactLastWidth = window.innerWidth;
    measure();
  };
  window.addEventListener('resize', subnavCompactResizeHandler, { passive: true });
  // Multiple measure passes: immediate, after a frame, after fonts
  // load, and a 600ms safety net. Each is idempotent so re-running
  // is cheap.
  measure();
  requestAnimationFrame(measure);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(measure).catch(() => {});
  }
  setTimeout(measure, 250);
  setTimeout(measure, 700);
}

// on container size changes, after fonts load, and on full page load so
// the chip count converges on the same correct value regardless of when
// layout happens to settle.
let trimResizeHandler = null;
let trimResizeObserver = null;
function trimOverflowLinks() {
  const container = document.querySelector('.subnav-topics-inline');
  if (!container) return;

  const doTrim = () => {
    const links = container.querySelectorAll('.subnav-topic-link');
    const moreLink = container.querySelector('.subnav-more-link');
    // The home subnav has an "All Topics +" action link pinned to the
    // right (margin-left:auto). Reserve its width like we do for More+.
    const actionLink = container.querySelector('.subnav-action-link');

    // Reset visibility before measuring. The relatedBtn reset is important:
    // when left visible from a prior collapsed state, it eats horizontal
    // space (margin-left: auto), shrinks the container's measured width,
    // and traps the row in the collapsed state forever even after the
    // viewport grows back.
    container.style.display = '';
    links.forEach(l => l.style.display = '');
    if (moreLink) moreLink.style.display = '';
    if (actionLink) actionLink.style.display = '';
    const homeAllTopicsReset = document.getElementById('subnav-all-topics-desktop');
    if (homeAllTopicsReset) homeAllTopicsReset.style.display = '';
    container.classList.remove('is-empty');
    const relatedBtnReset = document.getElementById('subnav-related-btn');
    if (relatedBtnReset) relatedBtnReset.style.display = 'none';

    // Bail on a non-laid-out container. The home sticky subnav has zero width
    // until it scrolls into view; measuring then would push every chip past a
    // ~0 cutoff and hide them all — and (because a 0-width box rarely re-fires
    // the observer cleanly) trap the row collapsed even after it gains width.
    // Leaving everything visible here is the safe default; the ResizeObserver
    // re-runs doTrim once the row actually has a width. (#383)
    const rect = container.getBoundingClientRect();
    if (rect.width < 1) return;

    // Both the TOPIC subnav (related-topic chips) and the HOME subnav (featured
    // topics + "All Topics +") are horizontal scrollers now — trimming would
    // just hide the overflow with no affordance. Leave EVERY chip in place and
    // let the strip scroll (arrows + edge fade wired by wireChipStripScrollEnd).
    // Neither has a "More +" link, so this guard covers both (#69/#70).
    if (!moreLink) {
      container.classList.remove('is-empty');
      return;
    }

    // Fit-to-width (#383): show as many chips as fit, drop the rest, and keep
    // "All Topics +" pinned in place as the "More" affordance — a half-clipped
    // chip in a horizontal scroller (the previous behavior) reads as broken at
    // awkward widths. When too few chips fit, collapse to no chips (just the
    // "All Topics +" entry point) rather than show a cramped one or two.
    const containerRight = rect.right;
    // First measure with "More +" / "All Topics +" reserved so we can
    // drop links to make room.
    const moreWidth = moreLink ? moreLink.offsetWidth + 20 : 0;
    const actionWidth = actionLink ? actionLink.offsetWidth + 20 : 0;
    let cutoff = containerRight - moreWidth - actionWidth;

    // Tail-only hiding: once any chip overflows past the cutoff,
    // hide every chip after it too. Previously this iterated each
    // link independently and hid any whose right edge crossed
    // the cutoff — which produced a non-sequential visible list
    // when a wide chip overflowed but the next (narrower) chip
    // still fit. Result: e.g. World, Business, Politics, Science,
    // Technology, Sports, *Media*, All Topics + — with
    // Entertainment skipped between Sports and Media because it
    // was too wide for the slot it would have taken. The user
    // reads that as "All Topics + is in a weird mid-list
    // position." Consecutive-run hiding restores the expected
    // order.
    let visibleCount = 0;
    let hiddenCount = 0;
    let hideRest = false;
    links.forEach(l => {
      if (hideRest || l.getBoundingClientRect().right > cutoff) {
        l.style.display = 'none';
        hiddenCount++;
        hideRest = true;
      } else {
        visibleCount++;
      }
    });

    // Threshold rules:
    // - Home subnav (action link, no More+): show ≥4 featured chips
    //   on the SAME row as the title group. Otherwise collapse to
    //   just "All Topics +". Without the wrap check the row could
    //   flip back to showing chips at narrower widths once the row
    //   wraps to a new line (the wrapped chip row gets the full
    //   parent width, so suddenly more fit again), producing a
    //   show/hide/show/hide stagger as the viewport shrinks.
    // - Topic subnav (More+ + Related Topics+ fallback): show ≥3
    //   chips + More+, otherwise hide the inline row and show
    //   "Related Topics +" (handled by the relatedBtn block below).
    const isHomeRow = !!actionLink && !moreLink;
    if (isHomeRow && links.length >= 2) {
      const row = container.parentElement;
      const titleGroup = row?.querySelector('.topic-banner-titlegroup');
      const isWrapped = !!titleGroup && container.offsetTop > titleGroup.offsetTop + 4;
      if (isWrapped || visibleCount < 2) {
        links.forEach(l => l.style.display = 'none');
        visibleCount = 0;
        hiddenCount = links.length;
      }
    }

    // If nothing was hidden, "More +" is redundant — hide it and re-check
    // the last link in case reclaiming the More-width lets one more link fit.
    if (moreLink) {
      if (hiddenCount === 0) {
        moreLink.style.display = 'none';
      } else {
        moreLink.style.display = '';
      }
    }

    // Show/hide the "Related Topics +" condensed button based on visible count.
    // When fewer than 3 inline links fit, collapse the chip row to zero
    // visible items and reveal the button. We don't hide the container
    // itself — that would make container.getBoundingClientRect() return
    // 0 width on the next measure, causing the row to stay collapsed
    // even after the viewport grew back. Hiding only the children keeps
    // the container measurable so widening cleanly restores the chips.
    const relatedBtn = document.getElementById('subnav-related-btn');
    if (relatedBtn) {
      if (visibleCount < 3) {
        links.forEach(l => l.style.display = 'none');
        if (moreLink) moreLink.style.display = 'none';
        visibleCount = 0;
        hiddenCount = links.length;
        relatedBtn.style.display = 'inline-block';
      } else {
        relatedBtn.style.display = 'none';
      }
    }

    // No visible chips left → hide the leading title↔chips separator.
    // (CSS reads .is-empty to suppress .subnav-topics-inline::before.)
    container.classList.toggle('is-empty', visibleCount === 0);

    // Home subnav: the desktop "All Topics +" link only exists as a
    // continuation of the featured-chips row. If no chips are visible
    // (e.g. the viewport is too narrow for any to fit), drop the link
    // too so the row reads as just the page title.
    const homeAllTopics = document.getElementById('subnav-all-topics-desktop');
    if (homeAllTopics) {
      homeAllTopics.style.display = visibleCount === 0 ? 'none' : '';
    }
  };

  const scheduleTrim = () => requestAnimationFrame(doTrim);

  // Initial run after layout settles
  scheduleTrim();

  // Re-run when fonts finish loading (chip widths shift once Inter loads).
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleTrim);
  }

  // Re-run on full page load (covers any late-arriving stylesheet/asset
  // that might shift container width).
  if (document.readyState !== 'complete') {
    window.addEventListener('load', scheduleTrim, { once: true });
  }

  // Re-run on viewport resize.
  if (trimResizeHandler) window.removeEventListener('resize', trimResizeHandler);
  trimResizeHandler = scheduleTrim;
  window.addEventListener('resize', trimResizeHandler, { passive: true });

  // Re-run on actual container size changes — catches scrollbar appear/disappear,
  // drawer toggles, font-swap reflows, anything that shifts the chip area's
  // available width independent of viewport resize.
  if (trimResizeObserver) trimResizeObserver.disconnect();
  if (typeof ResizeObserver !== 'undefined') {
    trimResizeObserver = new ResizeObserver(scheduleTrim);
    trimResizeObserver.observe(container);
  }
}

// Responsive nav: CSS handles breakpoints, JS just sets up the class
function setupResponsiveNav() {
  // No JS measurement needed — CSS media queries handle all breakpoints
}

// Main-bar topic nav (.sticky-nav-topics) fit-to-width. The row is flex:1 with
// overflow:hidden, so without trimming the tail topic + the "More" button get
// half-clipped at narrow desktop widths (#74). Show as many whole topic links as
// fit, hide the rest, and keep "More" visible whenever anything was hidden.
let stickyNavTrimHandler = null;
function trimStickyNav() {
  const nav = document.querySelector('.sticky-nav-topics');
  if (!nav) return;
  const moreBtn = nav.querySelector('.sticky-nav-more');
  const links = [...nav.querySelectorAll('.sticky-nav-topic')];
  if (!links.length) return;

  const run = () => {
    // Reset to all-visible before measuring.
    links.forEach((l) => { l.style.display = ''; });
    if (moreBtn) moreBtn.style.display = '';
    const avail = nav.clientWidth;
    if (avail < 1) return;                       // not laid out yet
    const gap = parseFloat(getComputedStyle(nav).columnGap || getComputedStyle(nav).gap) || 18;
    const moreW = moreBtn ? moreBtn.offsetWidth + gap : 0;

    // Walk the links; once one (plus the reserved "More") would overflow,
    // hide it and every link after it (no half-clipped tail chip).
    let used = 0;
    let hideRest = false;
    links.forEach((l, i) => {
      if (hideRest) { l.style.display = 'none'; return; }
      const next = used + (i ? gap : 0) + l.offsetWidth;
      if (next + moreW > avail) { l.style.display = 'none'; hideRest = true; }
      else used = next;
    });

    // "More" stays visible always — it opens the full topic list, so even when
    // every featured link fits, the rest of the catalog is one click away (#88).
    if (moreBtn) moreBtn.style.display = '';
  };

  requestAnimationFrame(run);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => requestAnimationFrame(run));
  if (stickyNavTrimHandler) window.removeEventListener('resize', stickyNavTrimHandler);
  stickyNavTrimHandler = () => requestAnimationFrame(run);
  window.addEventListener('resize', stickyNavTrimHandler, { passive: true });
}

// theScore-style mobile top bar: the page label shown next to the back
// button on sub-pages (topic / about / terms / prompt builder / search).
// Empty string on home (the brand shows instead).
function pageLabelFor(route) {
  if (!route) return '';
  switch (route.type) {
    case 'topic': { const t = getTopicBySlug(route.slug); return t ? t.name : ''; }
    case 'about': return 'About';
    case 'terms': return 'Terms';
    case 'prompt-generator': return 'Prompt Builder';
    case 'search': return 'Search';
    case 'custom': return route.term ? `“${route.term}”` : 'Search';
    default: return '';
  }
}

function renderStickyHeroBar(container, route) {
  const featured = getFeaturedTopics();
  const NAVMENU_CHEV = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  // Mobile/tabular header page-name panel (#79/#80): the current page name +,
  // for topics, its icon. Empty on home (panel hidden). Built once here so the
  // header markup stays tidy.
  // Topic pages no longer use the header panel on mobile — the topic title +
  // inline tabs live in the subnav instead (#91). Identity-only pages
  // (About/Terms/Prompt) keep the header panel; home stays brand-only.
  const pgLabel = (route && route.type === 'topic') ? '' : pageLabelFor(route);
  const pgNameHTML = pgLabel ? `<span class="sticky-page-text">${escapeHTML(pgLabel)}</span>` : '';
  // Desktop main-nav topic links — render the FULL featured set (not a hardcoded
  // six) so wide screens show as many as fit; trimStickyNav fits-to-width and
  // keeps "More" so the rest stay reachable (#88).
  const navTopicLinksHTML = featured
    .map((t) => `<a href="#/topic/${escapeAttr(t.slug)}" class="sticky-nav-topic">${escapeHTML(t.name)}</a>`)
    .join('');
  // Each featured parent is an accordion: tap the row to reveal its subtopics
  // (so every topic is reachable from the menu); the parent itself is reachable
  // via a prominent "All {name}" link at the top of the nested list. Parents
  // with no subtopics stay a plain link.
  const featuredLinksHTML = featured.map(t => {
    const subs = getSubtopics(t.slug);
    if (!subs.length) {
      return `<a href="#/topic/${t.slug}" class="navmenu-topic-link">
        <span class="navmenu-topic-icon">${topicIconSVG(t.icon || 'globe', '')}</span>
        <span class="navmenu-topic-name">${escapeHTML(t.name)}</span>
      </a>`;
    }
    const subsHTML = subs.map(s => `<a href="#/topic/${escapeAttr(s.slug)}" class="navmenu-subtopic-link">${escapeHTML(s.name)}</a>`).join('');
    return `<details class="navmenu-topic-acc">
      <summary class="navmenu-topic-summary">
        <span class="navmenu-topic-icon">${topicIconSVG(t.icon || 'globe', '')}</span>
        <span class="navmenu-topic-name">${escapeHTML(t.name)}</span>
        <span class="navmenu-topic-chev" aria-hidden="true">${NAVMENU_CHEV}</span>
      </summary>
      <div class="navmenu-subtopics">
        <a href="#/topic/${escapeAttr(t.slug)}" class="navmenu-subtopic-link navmenu-subtopic-parent"><span>All ${escapeHTML(t.name)}</span><svg class="navmenu-subtopic-arrow" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg></a>
        ${subsHTML}
      </div>
    </details>`;
  }).join('');

  container.innerHTML = `
    <div class="sticky-hero-inner">
      <button class="nav-hamburger" id="nav-hamburger" aria-label="Open menu">
        <span></span><span></span><span></span>
      </button>
      <a href="#/" class="sticky-brand" id="sticky-brand-link">
        <span class="sticky-title">Standard Topic</span>
      </a>
      <span class="sticky-page-name">${pgNameHTML}</span>
      <button type="button" class="nav-search-mobile" id="nav-search-mobile" aria-label="Search">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </button>
      <nav class="sticky-nav-topics" aria-label="Top topics">
        ${navTopicLinksHTML}
        <button type="button" class="sticky-nav-more" id="sticky-nav-more" aria-haspopup="dialog">More
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </nav>
      <div class="sticky-actions navbtns">
        <a href="#/" class="navbtn" id="nav-home" aria-label="Home">
          <span class="navbtn-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span>
          <span class="navbtn-label">Home</span>
        </a>
        <button type="button" class="navbtn" id="nav-search" aria-label="Search">
          <span class="navbtn-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
          <span class="navbtn-label">Search</span>
        </button>
        <button type="button" class="navbtn navbtn-ai" id="nav-insights" aria-label="AI Insights">
          <span class="navbtn-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg></span>
          <span class="navbtn-label"><span class="nl-full">AI Insights</span><span class="nl-short">Insights</span></span>
        </button>
        <button type="button" class="navbtn" id="nav-trending" aria-label="Trending">
          <span class="navbtn-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></span>
          <span class="navbtn-label"><span class="nl-full">Trending</span><span class="nl-short">Trends</span></span>
        </button>
        <button type="button" class="navbtn" id="nav-topics" aria-label="Topics" aria-haspopup="dialog">
          <span class="navbtn-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></svg></span>
          <span class="navbtn-label">Topics</span>
        </button>
      </div>
    </div>

  `;

  // "More" in the desktop topic nav + the "Topics" nav button both open the
  // full-width Topics topic-tree dropdown (Phase 5 — replaces the modal).
  document.getElementById('sticky-nav-more')?.addEventListener('click', (e) => {
    e.stopPropagation(); toggleTopicsNavDropdown();
  });
  document.getElementById('nav-topics')?.addEventListener('click', (e) => {
    e.stopPropagation(); toggleTopicsNavDropdown();
  });
  // Highlight the active top-level topic in the nav.
  if (route && route.type === 'topic' && route.slug) {
    document.querySelector(`.sticky-nav-topic[href="#/topic/${route.slug}"]`)?.classList.add('is-active');
  }
  // Home icon shows the solid white "active page" pill on the homepage.
  if (!route || route.type === 'home' || location.hash === '' || location.hash === '#' || location.hash === '#/') {
    document.getElementById('nav-home')?.classList.add('is-active');
  }

  // AI Insights — opens the full-width topic-tree dropdown (Phase 3): pick a
  // topic, then a track, and we route to that topic page with its inline
  // section open. No modal.
  const navInsightsBtn = document.getElementById('nav-insights');
  if (navInsightsBtn) {
    navInsightsBtn.setAttribute('aria-haspopup', 'dialog');
    navInsightsBtn.setAttribute('aria-expanded', 'false');
    navInsightsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleAiInsightsNavDropdown(); });
  }

  // Trending — opens the full-width Trending dropdown (Phase 5 — replaces the
  // modal) with the live trend-card grid.
  const navTrendingBtn = document.getElementById('nav-trending');
  if (navTrendingBtn) {
    navTrendingBtn.setAttribute('aria-haspopup', 'dialog');
    navTrendingBtn.setAttribute('aria-expanded', 'false');
    navTrendingBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleTrendingNavDropdown(); });
  }

  // Search — toggles the full-width Search dropdown (Phase 5). Route-driven so
  // deep-links (#/search, #/custom) + copy-link still work; clicking while open
  // closes it (and resets the search route).
  const navSearchBtn = document.getElementById('nav-search');
  if (navSearchBtn) {
    navSearchBtn.setAttribute('aria-haspopup', 'dialog');
    navSearchBtn.setAttribute('aria-expanded', 'false');
    navSearchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isSearchModalOpen()) userCloseSearchModal(); else navigate('#/search');
    });
  }

  // Nav menu panel — appended to body so it's not clipped by header overflow
  let navOverlay = document.getElementById('navmenu-overlay');
  let navPanel = document.getElementById('navmenu-panel');
  if (!navOverlay) {
    navOverlay = document.createElement('div');
    navOverlay.className = 'navmenu-overlay';
    navOverlay.id = 'navmenu-overlay';
    document.body.appendChild(navOverlay);
  }
  if (!navPanel) {
    navPanel = document.createElement('div');
    navPanel.className = 'navmenu-panel';
    navPanel.id = 'navmenu-panel';
    document.body.appendChild(navPanel);
  }
  navPanel.innerHTML = `
    <div class="navmenu-head">
      <button class="navmenu-close" id="navmenu-close" aria-label="Close menu">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="6" y1="6" x2="18" y2="18"/>
          <line x1="18" y1="6" x2="6" y2="18"/>
        </svg>
      </button>
      <a href="#/" class="navmenu-brand" id="navmenu-brand-link">
        <span class="navmenu-title">Standard Topic</span>
      </a>
      <div class="navmenu-head-actions">
        <a href="#/" class="navmenu-home" id="navmenu-home" aria-label="Home">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
            <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          </svg>
        </a>
      </div>
    </div>
    <div class="navmenu-featured-label navmenu-section-label">Search</div>
    <div class="navmenu-search" id="navmenu-search-container"></div>
    <div class="navmenu-featured-label navmenu-section-label">Navigate</div>
    <nav class="navmenu-quicklinks">
      <button type="button" class="navmenu-quicklink navmenu-cta" id="navmenu-all-topics">
        <svg class="navmenu-cta-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1"/>
          <rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/>
          <rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
        <span class="navmenu-cta-label">View All Topics</span>
        <svg class="navmenu-cta-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="13 6 19 12 13 18"/>
        </svg>
      </button>
      <button type="button" class="navmenu-quicklink navmenu-cta" id="navmenu-ai-insights">
        <svg class="navmenu-cta-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/>
        </svg>
        <span class="navmenu-cta-label">AI Insights</span>
        <svg class="navmenu-cta-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="13 6 19 12 13 18"/>
        </svg>
      </button>
      <button type="button" class="navmenu-quicklink navmenu-cta" id="navmenu-trending">
        <svg class="navmenu-cta-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="3 17 9 11 13 15 21 7"/>
          <polyline points="15 7 21 7 21 13"/>
        </svg>
        <span class="navmenu-cta-label">Trending</span>
        <svg class="navmenu-cta-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="13 6 19 12 13 18"/>
        </svg>
      </button>
      <a href="#/prompt-generator" class="navmenu-quicklink navmenu-cta" id="navmenu-prompt-link">
        <svg class="navmenu-cta-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
        </svg>
        <span class="navmenu-cta-label">Prompt Builder</span>
        <svg class="navmenu-cta-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="13 6 19 12 13 18"/>
        </svg>
      </a>
    </nav>
    <div class="navmenu-scroll">
      <div class="navmenu-featured-label">Topics</div>
      <div class="navmenu-topics">${featuredLinksHTML}</div>
    </div>
    <div class="navmenu-footer-sticky">
      <div class="navmenu-footer-links">
        <a href="#/about" class="navmenu-link">About</a>
        <a href="#/terms" class="navmenu-link">Terms</a>
        <a href="https://github.com/jrcstreams/standard-topic" target="_blank" rel="noopener noreferrer" class="navmenu-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
          GitHub
        </a>
      </div>
    </div>
  `;
  renderSearchBar(document.getElementById('navmenu-search-container'), route, { variant: 'search' });

  const scrollEl = navPanel.querySelector('.navmenu-scroll');
  const updateScrollOverflow = () => {
    if (!scrollEl) return;
    const more = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight > 2;
    scrollEl.classList.toggle('has-overflow-bottom', more);
  };
  if (scrollEl) {
    scrollEl.addEventListener('scroll', updateScrollOverflow, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(updateScrollOverflow).observe(scrollEl);
    }
  }

  const closeMenu = () => { navPanel.classList.remove('is-open'); navOverlay.classList.remove('is-open'); document.body.style.overflow = ''; };
  const openMenu = () => { navPanel.classList.add('is-open'); navOverlay.classList.add('is-open'); document.body.style.overflow = 'hidden'; requestAnimationFrame(updateScrollOverflow); };

  container.querySelector('#nav-hamburger').addEventListener('click', openMenu);
  navOverlay.addEventListener('click', closeMenu);
  navPanel.querySelector('#navmenu-close').addEventListener('click', closeMenu);
  navPanel.querySelectorAll('a, #navmenu-all-topics').forEach(link => {
    link.addEventListener('click', closeMenu);
  });
  navPanel.querySelector('#navmenu-all-topics')?.addEventListener('click', () => {
    closeMenu();
    toggleTopicsNavDropdown();
  });
  navPanel.querySelector('#navmenu-trending')?.addEventListener('click', () => {
    closeMenu();
    toggleTrendingNavDropdown();
  });
  navPanel.querySelector('#navmenu-ai-insights')?.addEventListener('click', () => {
    closeMenu();
    openAiInsightsNavDropdown();
  });

  // Mobile top-bar search icon (kept upper-right even though Search is also
  // in the bottom nav) — opens the search modal.
  container.querySelector('#nav-search-mobile')?.addEventListener('click', () => navigate('#/search'));

  // Clicking logo/title always goes home with News Feed active —
  // even if already on #/, force re-render so mobile tab resets.
  container.querySelector('#sticky-brand-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (window.location.hash === '#/' || window.location.hash === '' || window.location.hash === '#') {
      // Already on home — force re-render with newsfeed tab
      ['searchtrends', 'newsfeed', 'trending', 'shortcuts', 'websources', 'related'].forEach(t =>
        document.body.classList.remove(`active-tab-${t}`));
      document.body.classList.add('active-tab-newsfeed');
      document.querySelectorAll('#sub-header .tab-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.tab === 'newsfeed');
      });
      window.scrollTo(0, 0);
    } else {
      window.location.hash = '#/';
    }
  });

  // Fit the main-bar topic row so the tail topic + "More" never half-clip (#74).
  trimStickyNav();
}

// Mobile bottom tab bar (Home / Search / Trending / Topics). Rendered once
// and appended to <body> so it's never clipped by header/content overflow;
// active state is refreshed on every route render. Hidden ≥900px via CSS.
//
// Active state has two sources: the current route (home/search) AND any open
// modal (Insights / Trending / Topics) — a modal opened from the bar should
// light its tab while it's up. `botnavModalTab` wins over the route tab; it's
// set by the open-* events and cleared when the last modal closes (every modal
// toggles document.body.style.overflow, so its return to '' is the signal).
let botnavModalTab = null;
let botnavRouteTab = '';
function applyBotnavActive() {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  const active = botnavModalTab || botnavRouteTab;
  nav.querySelectorAll('.botnav-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === active));
}
function renderBottomNav(route) {
  // Bottom nav removed entirely (revamp390) — the main nav now carries Home /
  // Search / AI Insights / Trending / Topics as labeled buttons at every width.
  document.getElementById('bottom-nav')?.remove();
  return;
  // eslint-disable-next-line no-unreachable
  let nav = document.getElementById('bottom-nav');
  if (!nav) {
    nav = document.createElement('nav');
    nav.id = 'bottom-nav';
    nav.setAttribute('aria-label', 'Primary');
    nav.innerHTML = `
      <a href="#/" class="botnav-tab" data-tab="home" id="botnav-home" aria-label="Home">
        <span class="botnav-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span>
        <span class="botnav-label">Home</span>
      </a>
      <button type="button" class="botnav-tab" data-tab="search" id="botnav-search" aria-label="Search">
        <span class="botnav-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
        <span class="botnav-label">Search</span>
      </button>
      <button type="button" class="botnav-tab" data-tab="insights" id="botnav-insights" aria-label="AI Insights">
        <span class="botnav-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/></svg></span>
        <span class="botnav-label">AI Insights</span>
      </button>
      <button type="button" class="botnav-tab" data-tab="trending" id="botnav-trending" aria-label="Trending">
        <span class="botnav-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></span>
        <span class="botnav-label">Trending</span>
      </button>
      <button type="button" class="botnav-tab" data-tab="topics" id="botnav-topics" aria-label="All topics">
        <span class="botnav-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></svg></span>
        <span class="botnav-label">Topics</span>
      </button>`;
    document.body.appendChild(nav);
    // Search is route-driven (#/search), but light its tab immediately too —
    // otherwise switching FROM another bar modal leaves the old tab lit, since
    // the close→reopen handoff never returns body.overflow to '' for the
    // observer to clear the forced tab. (#3)
    nav.querySelector('#botnav-search').addEventListener('click', () => { botnavModalTab = 'search'; applyBotnavActive(); navigate('#/search'); });
    // AI Insights: the global entry — opens the modal "anew" (topic picker first).
    nav.querySelector('#botnav-insights').addEventListener('click', () => window.dispatchEvent(new CustomEvent('open-ai-intelligence', { detail: { pickTopic: true } })));
    nav.querySelector('#botnav-trending').addEventListener('click', () => window.dispatchEvent(new CustomEvent('open-trending-list')));
    nav.querySelector('#botnav-topics').addEventListener('click', () => window.dispatchEvent(new CustomEvent('open-all-topics-modal')));
    // Home: native href handles routing; if already home, force a re-render
    // so the homepage resets to the top (mirrors the brand-link behavior).
    nav.querySelector('#botnav-home').addEventListener('click', (e) => {
      // Close any open bar modal (Topics / Trending / AI Insights / Search) when
      // tapping Home — otherwise the modal stays up over the homepage.
      window.dispatchEvent(new CustomEvent('close-all-modals'));
      const h = window.location.hash;
      if (h === '#/' || h === '' || h === '#') { e.preventDefault(); window.scrollTo(0, 0); }
    });
    // [304] Light the matching tab while its modal is open. The open events set
    // the forced tab; a MutationObserver on the body's style attribute clears it
    // once the modal closes (overflow returns from 'hidden' to '').
    window.addEventListener('open-ai-intelligence', () => { botnavModalTab = 'insights'; applyBotnavActive(); });
    window.addEventListener('open-trending-list', () => { botnavModalTab = 'trending'; applyBotnavActive(); });
    window.addEventListener('open-all-topics-modal', () => { botnavModalTab = 'topics'; applyBotnavActive(); });
    new MutationObserver(() => {
      if (document.body.style.overflow !== 'hidden' && botnavModalTab) { botnavModalTab = null; applyBotnavActive(); }
    }).observe(document.body, { attributes: true, attributeFilter: ['style'] });
  }
  // The hash is the source of truth: search/custom open as modals over the
  // HOME layout (renderLayout runs with baseRoute=home), so check the real
  // route from the hash BEFORE the home fallback.
  let active = '';
  const h = (window.location.hash || '').toLowerCase();
  if (h.startsWith('#/search') || h.startsWith('#/custom')) active = 'search';
  else if (route && route.type === 'home') active = 'home';
  botnavRouteTab = active;
  applyBotnavActive();
}

function renderHero(container, route) {
  container.innerHTML = `
    <div class="hero-inner hero-C">
      <a href="#/" class="hero-brand">
        <img src="assets/logo-light.png" alt="Standard Topic" class="hero-brand-logo">
        <h1 class="hero-brand-title">Standard Topic</h1>
      </a>
      <p class="hero-tagline">News, Resources and AI Knowledge. On any topic.</p>
      <div class="hero-actions">
        <div class="hero-search-wrap" id="search-bar-container"></div>
        <a href="#/prompt-generator" class="hero-build-link">
          Build a prompt +
        </a>
      </div>
    </div>
  `;
  renderSearchBar(document.getElementById('search-bar-container'), route);
}


function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Two-column topic layout (L2 + L4 hybrid) ----------

function cleanupTopicLayoutObservers() {
  ['searchtrends', 'newsfeed', 'trending', 'shortcuts', 'websources', 'related'].forEach(t => {
    document.body.classList.remove(`active-tab-${t}`);
  });
}


function renderTopicLayout(container, { topic, route, isHome, isCustom = false, customTerm = '' }) {
  cleanupTopicLayoutObservers();

  if (isCustom) {
    // Custom: in-page header with intro copy + sticky search bar,
    // then the Topic Intelligence section (Web Sources, Discover,
    // Learn, Analyze) as the page body. No subnav (handled in the
    // route block above) and no app-mode constraint — the page
    // scrolls naturally so the search bar's sticky behavior works.
    // The intro header scrolls away; the sticky block (search bar +
    // Topic Intelligence header) pins below the nav and collapses to a
    // compact bar — title, search, and the TI line transition together.
    container.innerHTML = `
      <div class="topic-layout is-custom" id="topic-layout">
        <div class="custom-search-head">
          <h1 class="custom-search-page-title">Custom Topic Search</h1>
          <p class="custom-search-page-intro">Type any topic and we'll build out web sources, AI shortcuts, and analysis tools tailored to it.</p>
        </div>
        <div class="custom-search-sticky">
          <div class="custom-search-page-bar">
            <span class="custom-search-bar-title" aria-hidden="true">Custom Topic Search</span>
            <div class="custom-search-page-bar-input" data-role="custom-search-bar"></div>
          </div>
          <div class="custom-ti-sep" aria-hidden="true"></div>
        </div>
        <section class="layout-section" id="section-shortcuts"></section>
      </div>
    `;
    const barContainer = container.querySelector('[data-role="custom-search-bar"]');
    if (barContainer) renderCustomSearchBar(barContainer, customTerm);
    setupCustomStickyBar(container.querySelector('.custom-search-sticky'));
  } else if (isHome) {
    // Homepage. Desktop: a full-width "Search & Trends" section (search hero +
    // trending cards) on top, then the Intelligence | News Feed columns below.
    // Mobile: three tabs — Search & Trends / News Feed / Intelligence — each a
    // direct-child section the tab switcher shows one at a time.
    // AI Intelligence lives on topic/search pages, not home. Home is the
    // full-width search hero + trending (2-up on desktop), then News Feed.
    container.innerHTML = `
      <div class="topic-layout home-grid" id="topic-layout">
        ${bodyTabsRow({ showSearchTrends: true, showShortcuts: false })}
        <div class="home-cards">
          <div class="home-search-hero" id="home-search-hero"></div>
          <section class="layout-section" id="section-aii-home"></section>
          <a href="#/prompt-generator" class="home-promo" aria-label="Open the Prompt Builder">
            <div class="home-promo-inner">
              <div class="home-promo-head"><span class="home-promo-ic" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6z"/></svg></span><h3 class="home-promo-title">Smarter prompts, better answers.</h3></div>
              <p class="home-promo-text">Turn any topic into a well crafted ready-to-run prompt.</p>
              <span class="home-promo-btn">
                Open Prompt Builder
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>
              </span>
            </div>
          </a>
        </div>
        <div class="home-main">
          <section class="layout-section" id="section-newsfeed"></section>
        </div>
        <aside class="home-side">
          <section class="home-trending" id="home-trending"></section>
        </aside>
      </div>
    `;
    homeSearchPanelCtl = renderSearchPanel(container.querySelector('#home-search-hero'), { mode: 'inline' });
    // Trending is now the only sidebar card, so it can run much longer.
    renderTrendingHome(container.querySelector('#home-trending'), { limit: 14 });
    const aiiHome = container.querySelector('#section-aii-home');
    if (aiiHome) {
      const homeDesc = {}; const homeIcons = {};
      try { (getShortcutsForTopic('home') || []).forEach((s) => { if (s && s.name) { homeDesc[s.name] = s.description || ''; homeIcons[s.name] = s.icon || ''; } }); } catch (_) {}
      renderAIIntelligence(aiiHome, { topic: 'home', label: "today's world", descriptions: homeDesc, icons: homeIcons, hideGroups: ['topic-specific'], topicKey: 'home' });
    }
  } else {
    // Topic pages: a desktop 35/65 split — SIDEBAR (AI Intelligence, then Web
    // Sources) + MAIN (News Feed, Related). The wrappers are display:contents
    // below 1024px, so the mobile tab navigator (which shows ONE section at a
    // time) is unaffected; at ≥1024 they become the two columns (#14).
    // AI Insights (full-width) on top — Web Search + External Insights are now
    // folded into it as tabs, so there's no longer a separate Web Sources card —
    // then the News Feed full-width below as a responsive grid. On mobile this is a
    // single stacked scroll (no section tabs). (#layout-revamp)
    // Topic pages: a full-width stack — the AI Insights & Resources card on top,
    // then the News Feed — at every width (#285). Direct sections (no sidebar
    // wrappers) so the band reads as one continuous column.
    container.innerHTML = `
      <div class="topic-layout topic-band" id="topic-layout">
        ${topic ? topicBodyHeadHTML(topic) : ''}
        <section class="layout-section" id="section-shortcuts"></section>
        <section class="layout-section" id="section-newsfeed"></section>
      </div>
    `;
    if (topic) { wireSubnavPicker(container); wireSubtopicsMore(container); }
  }

  const trendingSection = container.querySelector('#section-trending');
  const shortcutsSection = container.querySelector('#section-shortcuts');
  const feedSection = container.querySelector('#section-newsfeed');

  if (trendingSection) renderTrending(trendingSection);
  if (shortcutsSection) {
    if (topic && !isHome && !isCustom) {
      // Topic pages get the living AI Intelligence component. Map each
      // shortcut's name → its description so the section menu can show a
      // one-line summary under each insight.
      const descriptions = {}; const icons = {};
      try { (getShortcutsForTopic(topic.slug) || []).forEach((s) => { if (s && s.name) { descriptions[s.name] = s.description || ''; icons[s.name] = s.icon || ''; } }); } catch (_) {}
      renderAIIntelligence(shortcutsSection, { topic: topic.name, label: topic.name, descriptions, icons, topicKey: topic.slug });
      wireTopicAiiInline(shortcutsSection, topic, descriptions, icons);
    } else {
      renderShortcutsSidebar(shortcutsSection, route, isHome, isCustom, customTerm);
    }
  }
  // Web Search is no longer a standalone topic-page card — it's folded into the AI
  // Insights component as a tab. (renderWebSources is still used elsewhere.)
  if (feedSection) {
    renderNewsFeed(feedSection, topic, isHome);
  }

  // Wire mobile tab pills (no-op when the pills aren't rendered, e.g.
  // on custom-search pages or at desktop widths where CSS hides them).
  setupTabPills();
}

// Render the Related Topics inline section that shows up on topic
// pages when the user taps "Related +" on mobile. Mirrors the
// shortcuts/news feed card shape: orange accent header + scrollable
// list of related topic links below.
function renderRelatedSection(container, topic) {
  const items = getRelatedTopics(topic) || [];
  const list = items.length === 0
    ? `<p class="sidebar-empty">No related topics yet.</p>`
    : `<div class="sidebar-shortcut-list">
         ${items.map(t => `
           <a class="sidebar-shortcut related-link" href="#/topic/${t.slug}" title="${escapeAttr(t.name)}">
             ${topicIconSVG(t.icon || 'globe', 'sidebar-shortcut-icon')}
             <span class="sidebar-shortcut-name">${escapeHTML(t.name)}</span>
             <span class="sidebar-shortcut-chev" aria-hidden="true">›</span>
           </a>
         `).join('')}
       </div>`;
  const pillHTML = topic?.name
    ? `<span class="section-topic-pill">${escapeHTML(topic.name)}</span>`
    : '';
  container.innerHTML = `
    <div class="related-panel">
      <h3 class="related-title">Related Topics${pillHTML}</h3>
      <div class="related-scroll-wrap">
        ${list}
      </div>
    </div>
  `;
}

const TAB_PANELS = ['newsfeed', 'trending', 'shortcuts', 'websources', 'related'];

function setActiveTabPanel(tabId) {
  TAB_PANELS.forEach(t => document.body.classList.remove(`active-tab-${t}`));
  document.body.classList.add(`active-tab-${tabId}`);
  document.querySelectorAll('#sub-header .tab-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.tab === tabId);
  });
}

function attachTabPanelHandlers() {
  document.querySelectorAll('#sub-header .tab-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      const tabId = pill.dataset.tab;
      if (!tabId) return;
      e.preventDefault();
      e.stopPropagation();
      const isDesktop = window.matchMedia('(min-width: 1024px)').matches;

      if (isDesktop) {
        // Desktop: scroll-jump to the section.
        const target = document.getElementById(`section-${tabId}`);
        if (target) {
          const mainNav = document.getElementById('site-header');
          const subnav = document.getElementById('sub-header');
          const mainH = mainNav?.classList.contains('is-revealed') ? mainNav.offsetHeight : 0;
          const subH = subnav?.offsetHeight || 0;
          const stickyOffset = mainH + subH + 12;
          const rawY = target.getBoundingClientRect().top + window.scrollY - stickyOffset;
          const heroEl = document.getElementById('hero');
          const heroThreshold = heroEl ? Math.max(0, heroEl.offsetHeight - 64) : 0;
          const y = Math.max(rawY, heroThreshold);
          window.scrollTo({ top: y, behavior: 'smooth' });
        }
        setActiveTabPanel(tabId);
      } else {
        setActiveTabPanel(tabId);
        // On home, if the user is already in/past the sticky zone, clamp
        // to the hero threshold so tapping a tab doesn't yank them back
        // into the hero. Use >= with a small tolerance so the SECOND
        // click (where currentY === threshold from the first click)
        // doesn't snap to 0.
        const heroEl = document.getElementById('hero');
        const heroThreshold = heroEl ? Math.max(0, heroEl.offsetHeight - 64) : 0;
        const currentY = window.scrollY;
        const target = currentY + 4 >= heroThreshold && heroThreshold > 0
          ? heroThreshold
          : 0;
        window.scrollTo({ top: target, behavior: 'auto' });
      }
    });
  });
}

// ---------- Sidebar renderers (compact vertical lists) ----------

// Groups that get an AI overview brief (per topic), and the spark icon.
const TI_AI_LENSES = new Set(['discover', 'learn', 'analyze', 'topic-specific']);
const TI_AI_LABELS = { discover: 'Discover', learn: 'Learn', analyze: 'Analysis', 'topic-specific': 'Topic Insights' };

// Prompt templates for "explore deeper" / "run full overview" — admin-tunable
// in data/insight-templates.json (lazy-loaded, with safe fallbacks).
let __insightTemplates = null;
async function getInsightTemplates() {
  if (__insightTemplates) return __insightTemplates;
  try {
    const res = await fetch('data/insight-templates.json');
    __insightTemplates = res.ok ? await res.json() : {};
  } catch (_) { __insightTemplates = {}; }
  __insightTemplates = Object.assign({
    sectionDeeper: '{shortcutPrompt}\n\nI already have this summary — go significantly deeper than it, with more detail, more recent developments, and sources where relevant:\n\n{sectionContent}',
    overviewRun: 'Give me a comprehensive "{groupLabel}" briefing on {scopeLabel}. Cover each of these areas as its own section, current and specific:\n{sectionNames}\n\nGo deeper than headline level — include the why and what-to-watch for each area.',
  }, __insightTemplates);
  return __insightTemplates;
}

function timeAgoLabel(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return '';
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'Updated just now';
  if (h < 24) return `Updated ${h}h ago`;
  return `Updated ${Math.floor(h / 24)}d ago`;
}

// Split a generated overview into [{name, body}] on "## " headers. Content
// from before the overview redesign has no sections → caller falls back to a
// single block.
function splitOverviewSections(content) {
  const text = String(content || '');
  const first = text.search(/^##\s+/m);
  if (first === -1) return []; // legacy pre-section brief → single-block fallback
  const parts = text.slice(first).split(/^##\s+/m).filter((p) => p.trim());
  const sections = [];
  for (const p of parts) {
    const nl = p.indexOf('\n');
    if (nl === -1) continue;
    sections.push({ name: p.slice(0, nl).trim(), body: p.slice(nl + 1).trim() });
  }
  return sections;
}

// Group AI overview — auto-loaded when a Discover/Learn/Analyze/Topic-Insights
// accordion opens (home + topic pages; custom pages keep plain shortcut rows).
// One pre-generated overview per group, sectioned per shortcut; each section
// can be explored deeper in a model via the prompt modal.
async function loadGroupOverview(el, topicArg, group, items, scopeLabel) {
  if (!el || el.dataset.state === 'loading' || el.dataset.state === 'done') return;
  el.dataset.state = 'loading';
  const label = TI_AI_LABELS[group] || 'AI';
  el.innerHTML = `<div class="ti-overview-loading" aria-hidden="true">${'<div class="ti-overview-skel"></div>'.repeat(3)}</div>`;
  let data = null;
  try {
    const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'shortcut', topic: topicArg, group }) });
    data = res.ok ? await res.json() : null;
  } catch (_) { data = null; }
  const tpl = await getInsightTemplates();
  if (!data || !data.content) {
    el.innerHTML = `<p class="ti-overview-unavailable">Overview is being generated — check back shortly.</p>`;
    el.dataset.state = 'error'; // allow retry on next open
    return;
  }

  const byName = new Map(items.map((s) => [s.name.trim().toLowerCase(), s]));
  const sectionNames = items.map((s) => `- ${s.name}`).join('\n');
  const fullPrompt = String(tpl.overviewRun || '')
    .replace('{groupLabel}', label)
    .replace('{scopeLabel}', scopeLabel)
    .replace('{sectionNames}', sectionNames);
  const ago = timeAgoLabel(data.generatedAt);
  const sections = splitOverviewSections(data.content);

  let html = `<div class="ti-overview-head">
    <span class="ai-result-label">${escapeHTML(label)} overview</span><span class="ai-result-badge">AI</span>
    ${ago ? `<span class="ti-overview-ago">${escapeHTML(ago)}</span>` : ''}
    <button type="button" class="ti-overview-run">Run full overview ↗</button>
  </div>`;
  if (sections.length) {
    // Each section is its own mini-accordion — the user clicks through the
    // briefing (e.g. Beginner's Guide, Glossary) and expands what they want.
    html += `<div class="ti-ov-minis">` + sections.map((sec, i) => `
      <details class="ti-ov-mini"${i === 0 ? ' open' : ''}>
        <summary class="ti-ov-mini-summary">
          <span class="ti-ov-mini-name">${escapeHTML(sec.name)}</span>
          <svg class="ti-ov-mini-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="ti-ov-mini-body">
          ${renderBriefBody(sec.body, null)}
          ${byName.has(sec.name.trim().toLowerCase()) ? `<button type="button" class="ai-result-deeper ti-ov-deeper" data-name="${escapeAttr(sec.name)}">Explore further with AI ↗</button>` : ''}
        </div>
      </details>`).join('') + `</div>`;
  } else {
    // Legacy (pre-section) cached brief — single block until the cron migrates it.
    html += `<div class="ti-ov-section is-active">${renderBriefBody(data.content, null)}</div>`;
  }
  if (data.sources && data.sources.length) html += renderBriefBody('', data.sources, { noFavicons: true }); // text-only source links
  el.innerHTML = html;
  el.dataset.state = 'done';

  el.querySelector('.ti-overview-run')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('open-prompt-modal', {
      detail: { basePrompt: fullPrompt, name: `${label} overview · ${scopeLabel}`, count: 1 },
    }));
  });
  el.querySelectorAll('.ti-ov-deeper').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sc = byName.get(String(btn.dataset.name || '').trim().toLowerCase());
      const sec = sections.find((s) => s.name === btn.dataset.name);
      if (!sc) return;
      const deeper = String(tpl.sectionDeeper || '')
        .replace('{shortcutPrompt}', sc.prompt)
        .replace('{sectionContent}', (sec && sec.body) || '');
      window.dispatchEvent(new CustomEvent('open-prompt-modal', {
        detail: { basePrompt: deeper, name: sc.name, iconKey: sc.icon || '', count: 1 },
      }));
    });
  });
}

// Per-category icon + summary blurb for the Web Sources accordions.
const WS_CAT_META = {
  search:  { blurb: 'Search engines, encyclopedias, and reference.', icon: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' },
  noai:    { blurb: 'Web search with AI features turned off.', icon: '<path d="M12 2 4 5v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5z"/><line x1="4.5" y1="4" x2="19.5" y2="20"/>' },
  social:  { blurb: 'Communities, threads, posts, newsletters, and long-form.', icon: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>' },
  media:   { blurb: 'Podcasts, video, and explainers.', icon: '<rect x="2" y="5" width="20" height="14" rx="2"/><polygon points="10 9 15 12 10 15"/>' },
};

// Builds the Web Sources card: one boxed accordion per category (Search &
// Reference, Social & Discussion, …), the search term substituted into each link.
function buildWebSourcesCard(contentSearches, topicName, scopeLabel) {
  if (!contentSearches || !contentSearches.length) return '';
  const categories = getExternalSearchCategories();
  const order = categories.length ? categories.slice() : [{ key: '__all', label: 'Web Sources' }];
  const known = new Set(order.map(c => c.key));
  const leftovers = contentSearches.filter(s => !known.has(s.category));
  if (leftovers.length) order.push({ key: '__other', label: 'Other' });
  const accordions = order.map(cat => {
    const items = cat.key === '__other' ? leftovers
      : cat.key === '__all' ? contentSearches
      : contentSearches.filter(s => s.category === cat.key);
    if (!items.length) return '';
    const m = WS_CAT_META[cat.key] || {};
    return renderTIAccordion({
      key: 'websources',
      label: cat.label || 'Web Sources',
      open: false,
      blurb: m.blurb || '',
      icon: m.icon,
      bodyHTML: `<ul class="ti-item-list ti-item-list-grouped">${items.map(s => webSourceItem(s, topicName)).join('')}</ul>`,
    });
  }).join('');
  return `
    <div class="sidebar-card section-card websources-section">
      <div class="sidebar-card-header section-card-head">
        <div class="sidebar-card-heading">
          <h3 class="sidebar-card-title section-card-title"><span>Web Sources</span></h3>
          <p class="sidebar-card-subtitle section-card-sub">Search platforms and primary sources for ${scopeLabel}.</p>
        </div>
      </div>
      <div class="ti-accordions ti-accordions-websources">${accordions}</div>
    </div>`;
}

// Renders the standalone Web Sources section/tab for a topic page.
function renderWebSourcesSection(container, topic) {
  if (!container) return;
  const topicName = (topic && topic.name) || '';
  const contentSearches = topicName ? getExternalSearches() : [];
  container.innerHTML = buildWebSourcesCard(contentSearches, topicName, escapeHTML(topicName || 'this topic'));
}

function renderShortcutsSidebar(container, route, isHome, isCustom = false, customTerm = '') {
  const topic = isHome ? getTopicBySlug('home') : (isCustom ? null : getTopicBySlug(route.slug));
  const topicName = isCustom ? customTerm : (isHome ? '' : topic?.name || '');

  const topicSlug = isHome ? 'home' : (isCustom ? '_custom' : route.slug);
  const all = getShortcutsForTopic(topicSlug);

  // Content Shortcuts (Google News, Reddit, X, YouTube) — only on topic
  // and custom-search pages where there's a query to send. Home doesn't
  // surface these because there's no specific topic context yet.
  const contentSearches = (!isHome && topicName) ? getExternalSearches() : [];

  // topic-intelligence-panel: scopes the banded control-panel
  // treatment (dark header band + tinted body) to this panel only.
  // .shortcuts-sidebar is also used by the discover modal, all-topics
  // modal, and prompt-generator wizard topic picker — those should
  // not pick up the navy banded header.
  const cardClasses = ['sidebar-card', 'shortcuts-sidebar', 'topic-intelligence-panel'];

  // Topic Intelligence drops the topic pill in the title — the topic
  // is already identified in the page banner directly above, and the
  // section title needs the horizontal room so "Topic Intelligence"
  // fits on one line in the 320px sidebar.
  const titlePillHTML = '';
  // AI Shortcuts run in always-multi-select mode now — clicking a
   // row toggles selection, and a per-row arrow opens the modal for
   // that single shortcut directly. The `data-multi="1"` flag + the
   // .is-multi-select class are set up-front and never toggled off.
  // The panel is always "Topic Intelligence". On custom-search pages it
  // carries a subtitle showing the search term ("Covering …"); on topic
  // pages it carries the topic name as a quiet under-title sublabel
  // (desktop only — mobile renders the panel header as an eyebrow). Both
  // mirror the News Feed header so the two columns read in parallel.
  // Search results → "Search Intelligence" with the live search term as a
  // sublabel (updated in place as the user edits the input). Everywhere else
  // (home / topic) → "Intelligence" with the topic name sublabel.
  const panelTitle = isCustom ? 'AI Insights' : 'AI Insights';
  // Homepage Intelligence card gets a descriptive subtext. The section icon
  // is intentionally dropped — the accordions inside carry their own icons,
  // so a header icon is redundant. Topic pages keep the topic name as the
  // sublabel; search results keep the live term.
  const isHomeIntel = isHome && !isCustom;
  const intelIconSVG = '';
  const panelSubtitleHTML = (isCustom && topicName)
    ? `<p class="sidebar-card-subtitle ti-topic-sublabel" data-role="search-term-sub">${escapeHTML(topicName)}</p>`
    : isHomeIntel
      ? `<p class="sidebar-card-subtitle section-card-sub">AI-powered knowledge shortcuts</p>`
      : (!isHome && !isCustom && topicName)
        ? `<p class="sidebar-card-subtitle section-card-sub">AI-powered briefings, lenses, and prompts on ${escapeHTML(topicName)}.</p>`
        : '';

  // Model options for the selection bar's "Send to" picker. Pre-selects
  // the user's preferred model so direct Submit + the modal agree.
  const barModels = getModels();
  const barPreferredId = getPreferredModelId(getDefaultModelId());
  const barModelOptions = barModels.map(m =>
    `<option value="${escapeAttr(m.id)}"${m.id === barPreferredId ? ' selected' : ''}>${escapeHTML(m.name)}</option>`).join('');

  let html = `
    <div class="${cardClasses.join(' ')} is-multi-select" data-multi="1">
      <div class="sidebar-card-header">
        <div class="sidebar-card-heading">
          <h3 class="sidebar-card-title section-card-title">${intelIconSVG}<span>${panelTitle}</span>${titlePillHTML}</h3>
          ${panelSubtitleHTML}
        </div>
      </div>
      ${all.length > 0 ? `
        <div class="shortcuts-multi-submit-wrap" role="region" aria-label="Submit prompts" aria-hidden="true">
          <div class="shortcuts-multi-head">
            <span class="shortcuts-multi-eyebrow">Submit Prompts</span>
            <span class="shortcuts-multi-headrow">
              <span class="shortcuts-multi-count-label" id="shortcuts-multi-count-label" aria-live="polite">0 shortcuts selected</span>
              <button type="button" class="shortcuts-multi-clear" id="shortcuts-multi-clear">Clear</button>
            </span>
          </div>
          <label class="shortcuts-multi-modelrow">
            <span class="shortcuts-multi-modellabel">Send to</span>
            <span class="shortcuts-multi-modelselect-wrap">
              <select class="shortcuts-multi-model" id="shortcuts-multi-model" aria-label="Send to AI model">${barModelOptions}</select>
              <svg class="shortcuts-multi-modelselect-chev" width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 4.5 6 8 9 4.5"/></svg>
            </span>
          </label>
          <div class="shortcuts-multi-trigger-utils">
            <button type="button" class="shortcuts-multi-review" id="shortcuts-multi-review">
              <span>Preview</span>
            </button>
            <button type="button" class="shortcuts-multi-submit-direct" id="shortcuts-multi-submit-direct">
              <span>Submit</span>
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="3" y1="8" x2="12" y2="8"/>
                <polyline points="8 4 12 8 8 12"/>
              </svg>
            </button>
          </div>
        </div>
      ` : ''}
      <div class="shortcuts-scroll-wrap">
  `;

  // Accordion sections — Web Sources, then the AI action groups
  // (Discover / Learn / Analyze / More). Each section is a
  // <details> element so it's natively keyboard accessible and
  // doesn't need JS toggle wiring. First section starts open;
  // others closed so the panel reads as a tidy stack of choices.
  html += `<div class="ti-accordions">`;

  // Web Sources live in their OWN section. On topic pages that's a dedicated
  // tab/section (#section-websources, rendered separately). Custom-search pages
  // have no tabs, so there we append the card inline below the AI lenses.
  const webSourcesCardHTML = (isCustom && contentSearches.length)
    ? buildWebSourcesCard(contentSearches, topicName, 'your search')
    : '';

  if (all.length === 0) {
    html += `<p class="sidebar-empty">No shortcuts yet.</p>`;
  } else {
    // Per-topic section overrides (e.g. the homepage sorts otherwise
    // topic-specific shortcuts into Discover / Learn / Analyze).
    const allOverrides = (window.__assignmentsData && window.__assignmentsData.groupOverrides) || {};
    const overrideMap = allOverrides[topicSlug] || {};
    const groups = groupShortcuts(all, overrideMap);
    const groupOrder = groups.__order || [
      { key: 'discover', label: 'Discover' },
      { key: 'learn', label: 'Learn' },
      { key: 'analyze', label: 'Analysis' },
      { key: 'more', label: 'More' },
    ];
    // AI lens groups (home + topic pages) render as a generated GROUP
    // OVERVIEW — the shortcuts are its sections, not separate rows. Custom
    // pages keep plain rows: their query space is unbounded, so we never
    // generate/cache intelligence per custom term (rows send users out to
    // models/web sources instead).
    const hasOverview = (key) => !isCustom && TI_AI_LENSES.has(key);
    groupOrder.forEach(g => {
      const items = groups[g.key];
      if (!items || items.length === 0) return;
      if (hasOverview(g.key)) {
        // Lens rows OPEN the AI insight modal (not an inline accordion).
        const meta = TI_SECTION_META[g.key] || TI_SECTION_META.more;
        html += `<button type="button" class="ti-lens-row" data-overview-group="${escapeAttr(g.key)}" style="--ti-accent: ${meta.accent};">
            <span class="ti-lens-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${meta.icon}</svg></span>
            <span class="ti-lens-text"><span class="ti-lens-title">${escapeHTML(g.label)}</span><span class="ti-lens-blurb">${escapeHTML(meta.blurb || '')}</span></span>
            <span class="ti-lens-open" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg></span>
          </button>`;
      } else {
        html += renderTIAccordion({
          key: g.key,
          label: g.label,
          open: false,
          bodyHTML: `<ul class="ti-item-list ti-item-list-shortcuts" data-group="${escapeAttr(g.key)}">${items.map(s => tiShortcutItem(s, topicName, g.key)).join('')}</ul>`,
        });
      }
    });
  }
  html += `</div>`; /* close .ti-accordions */
  html += `</div>`; /* close .shortcuts-scroll-wrap */
  html += `<div class="shortcuts-toast" id="shortcuts-toast" role="status" aria-live="polite"></div>`;
  html += `</div>`; /* close .shortcuts-sidebar */
  html += webSourcesCardHTML; /* Web Sources as its own sibling section */
  container.innerHTML = html;

  // Lens rows open the unified AI insight modal (overview type).
  if (!isCustom) {
    const overviewTopicArg = isHome ? 'home' : topicName;
    const scopeTopic = isHome ? "today's world" : topicName;
    container.querySelectorAll('[data-overview-group]').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.dataset.overviewGroup;
        window.dispatchEvent(new CustomEvent('open-insight-modal', {
          detail: { type: 'overview', topic: overviewTopicArg, group, label: TI_AI_LABELS[group] || 'AI', scopeTopic },
        }));
      });
    });
  }

  // Quick Links: track clicks for analytics, and intercept clicks
  // while multi-select is on to surface a transient toast (the link
  // is visually muted but still a valid anchor, so we need to
  // explicitly prevent navigation and animate the toast).
  const toastEl = container.querySelector('#shortcuts-toast');
  let toastTimer = null;
  const flashToast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 1800);
  };

  // AI shortcut → model → Submit/Review dropdown wiring (replaces multi-select).
  const closeAllTIShortcuts = (except) => container.querySelectorAll('.ti-shortcut.is-open').forEach(s => {
    if (s === except) return;
    s.classList.remove('is-open');
    s.querySelector('.ti-shortcut-trigger')?.setAttribute('aria-expanded', 'false');
    // Reset the panel to the chooser so reopening never shows a stale confirm.
    const inner = s.querySelector('.ti-shortcut-panel-inner');
    if (inner) inner.innerHTML = tiExploreHomeHTML();
  });
  container.querySelectorAll('.ti-shortcut-trigger').forEach(trig => {
    trig.addEventListener('click', (e) => {
      e.stopPropagation();
      const sc = trig.closest('.ti-shortcut');
      const willOpen = !sc.classList.contains('is-open');
      closeAllTIShortcuts(sc);
      sc.classList.toggle('is-open', willOpen);
      trig.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (!willOpen) { const inner = sc.querySelector('.ti-shortcut-panel-inner'); if (inner) inner.innerHTML = tiExploreHomeHTML(); }
    });
  });
  // Consistent submission flow per shortcut: Direct Submit → leaving-site
  // confirm → open preferred model; Review Prompt → full prompt modal.
  const assembleFor = (basePrompt) => {
    const reasoning = REASONING_LEVELS.find(l => l.id === getReasoningLevel());
    return assemblePrompt(basePrompt, { reasoningHint: reasoning && reasoning.hint ? reasoning.hint : '', customInstructions: getCustomInstructions(), topicName });
  };
  container.querySelectorAll('.ti-shortcut-panel').forEach(panel => {
    panel.addEventListener('change', (e) => {
      const sel = e.target.closest('.ti-explore-select'); if (!sel) return;
      setPreferredModelId(sel.value);
      const m = tiPreferredModel();
      const mn = panel.querySelector('.ti-explore-mn');
      if (mn && m) mn.textContent = m.name;
    });
    panel.addEventListener('click', (e) => {
      e.stopPropagation();
      const sc = panel.closest('.ti-shortcut');
      const inner = panel.querySelector('.ti-shortcut-panel-inner');
      const basePrompt = sc?.dataset.prompt || '';
      const name = sc?.dataset.name || 'Shortcut';
      const opt = e.target.closest('.ti-explore-opt');
      const back = e.target.closest('.ti-leave-back');
      const go = e.target.closest('.ti-leave-go');
      if (opt) {
        if (opt.dataset.opt === 'review') {
          window.dispatchEvent(new CustomEvent('open-prompt-modal', { detail: { basePrompt, name, iconKey: sc?.dataset.iconKey || '', count: 1 } }));
          closeAllTIShortcuts(null);
        } else {
          // Direct → copy now so the later Continue opens the model synchronously.
          copyPrompt(assembleFor(basePrompt));
          if (inner) inner.innerHTML = tiLeaveHTML();
        }
      } else if (back) {
        if (inner) inner.innerHTML = tiExploreHomeHTML();
      } else if (go) {
        const model = tiPreferredModel(); if (!model) return;
        const full = assembleFor(basePrompt);
        track('shortcut_submit', { model: model.id, route: window.location.hash || '#/' });
        openModel(model, full); copyPrompt(full);
        closeAllTIShortcuts(null);
      }
    });
  });
  if (!container.__tiShortcutWired) {
    container.__tiShortcutWired = true;
    document.addEventListener('click', () => closeAllTIShortcuts(null));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllTIShortcuts(null); });
  }

  container.querySelectorAll('.quick-link-pill').forEach(link => {
    link.addEventListener('click', () => {
      const name = link.dataset.name || '';
      track('content_shortcut_click', { name, route: window.location.hash || '#/' });
    });
  });

  const card = container.querySelector('.sidebar-card');
  const reviewBtn = container.querySelector('#shortcuts-multi-review');
  const directBtn = container.querySelector('#shortcuts-multi-submit-direct');
  const clearBtn = container.querySelector('#shortcuts-multi-clear');
  const submitWrap = container.querySelector('.shortcuts-multi-submit-wrap');
  const modelSelect = container.querySelector('#shortcuts-multi-model');
  const countLabelEl = container.querySelector('#shortcuts-multi-count-label');

  // Trigger bar: floats in at the bottom of the card whenever any
  // shortcut is selected, slides out when the selection is empty.
  const updateSubmit = () => {
    if (!submitWrap) return;
    const selected = container.querySelectorAll('.ai-shortcut-select-btn.is-multi-selected');
    const n = selected.length;
    const has = n > 0;
    submitWrap.classList.toggle('is-visible', has);
    submitWrap.setAttribute('aria-hidden', has ? 'false' : 'true');
    if (reviewBtn) reviewBtn.disabled = !has;
    if (directBtn) directBtn.disabled = !has;
    if (clearBtn) clearBtn.disabled = !has;
    if (countLabelEl) countLabelEl.textContent = `${n} shortcut${n === 1 ? '' : 's'} selected`;
  };

  // "Send to" picker persists the preferred model (shared with the modal).
  modelSelect?.addEventListener('change', (e) => setPreferredModelId(e.target.value));

  // Direct Submit — assemble the base prompt (no advanced settings) and
  // send it straight to the picked model, skipping the review modal.
  directBtn?.addEventListener('click', async () => {
    const sub = buildSubmission();
    if (!sub) return;
    const modelId = modelSelect ? modelSelect.value : getPreferredModelId(getDefaultModelId());
    const model = getModelById(modelId) || getModelById(getDefaultModelId());
    if (!model) return;
    // Quick submit honors the session-wide settings (reasoning level +
    // "applies to every submission" custom instructions). Per-submission
    // options (output type, secondary topic) stay modal-only.
    const reasoning = REASONING_LEVELS.find(l => l.id === getReasoningLevel());
    const prompt = assemblePrompt(sub.prompt, {
      reasoningHint: reasoning && reasoning.hint ? reasoning.hint : '',
      customInstructions: getCustomInstructions(),
      topicName,
    });
    track('direct_submit', { model: model.id, count: sub.count, route: window.location.hash || '#/' });
    try { await submitPrompt(model, prompt); } catch (err) { console.error('Direct submit failed', err); }
  });

  // Build the BASE combined prompt + display name from the current
  // selection (single selection bypasses the multi-prompt intro).
  // Advanced settings — reasoning level, output type, secondary topic,
  // custom instructions — are layered on later by assemblePrompt().
  const buildSubmission = () => {
    const selected = Array.from(container.querySelectorAll('.ai-shortcut-select-btn.is-multi-selected'));
    if (selected.length === 0) return null;
    if (selected.length === 1) {
      const btn = selected[0];
      return {
        prompt: btn.dataset.prompt || '',
        name: btn.dataset.name || 'Shortcut',
        iconKey: btn.dataset.iconKey || '',
        count: 1,
      };
    }
    const combined = selected.map((b, i) => {
      const name = b.dataset.name || `Shortcut ${i + 1}`;
      const prompt = b.dataset.prompt || '';
      return `${i + 1}. ${name}\n${prompt}`;
    }).join('\n\n---\n\n');
    const intro = `Please respond to each of the following ${selected.length} prompts in order. Treat each as its own task and clearly label your answers.`;
    return {
      prompt: `${intro}\n\n${combined}`,
      name: `${selected.length} Selected Shortcuts`,
      iconKey: '',
      count: selected.length,
    };
  };

  // Select button (checkbox + name): toggles multi-select state.
  // If the clicked button (and the row beneath it) is hidden under
  // the floating Prompt Submission panel, scroll the scroll-wrap so
  // the user can still see what they just selected.
  container.querySelectorAll('.ai-shortcut-select-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.blur();
      const on = !btn.classList.contains('is-multi-selected');
      btn.classList.toggle('is-multi-selected', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      updateSubmit();
      if (on) ensureRowVisible(btn);
    });
  });

  function ensureRowVisible(btn) {
    if (!submitWrap || !listWrap) return;
    // Wait one frame so the panel's is-visible class + transition
    // start state is applied (so its boundingRect is real).
    requestAnimationFrame(() => {
      const wrapRect = listWrap.getBoundingClientRect();
      const panelRect = submitWrap.getBoundingClientRect();
      // The panel may be position: fixed (mobile) or absolute (desktop);
      // either way its rect tells us its on-screen position.
      const panelTop = panelRect.top || (wrapRect.bottom);
      const btnRect = btn.getBoundingClientRect();
      // Find the next sibling row (within the same group) to also keep
      // visible — gives the user context for what comes after.
      const li = btn.closest('.ai-shortcut-bullet-row');
      const nextLi = li?.nextElementSibling;
      const nextRect = nextLi ? nextLi.getBoundingClientRect() : null;
      const rowBottom = nextRect ? nextRect.bottom : btnRect.bottom;
      const obstruction = panelTop - 8; // 8px breathing room
      if (rowBottom > obstruction) {
        const delta = rowBottom - obstruction;
        listWrap.scrollBy({ top: delta, behavior: 'smooth' });
      }
    });
  }


  const clearShortcuts = () => {
    container.querySelectorAll('.ai-shortcut-select-btn.is-multi-selected').forEach(b => {
      b.classList.remove('is-multi-selected'); b.setAttribute('aria-pressed', 'false');
    });
    updateSubmit();
  };

  clearBtn?.addEventListener('click', clearShortcuts);

  // Review & Submit — opens the unified prompt modal directly. It owns the
  // editable preview, advanced settings, model picker, submit, and the
  // model-info/disclaimer dropdown, all on a single screen.
  reviewBtn?.addEventListener('click', () => {
    const sub = buildSubmission();
    if (!sub) return;
    track(sub.count === 1 ? 'shortcut_click' : 'multi_shortcut_submit', {
      [sub.count === 1 ? 'shortcut_name' : 'count']: sub.count === 1 ? sub.name : sub.count,
      route: window.location.hash || '#/',
    });
    window.dispatchEvent(new CustomEvent('open-prompt-modal', {
      detail: {
        basePrompt: sub.prompt,
        topicName: topicName,
        name: sub.name,
        iconKey: sub.iconKey,
        count: sub.count,
      },
    }));
  });

  // Scroll-fade indicators: toggle has-overflow-top / has-overflow-bottom
  // on the scroll wrap based on the wrap's scroll position. rAF-throttled.
  const listWrap = container.querySelector('.shortcuts-scroll-wrap');
  if (listWrap) {
    let rafId = null;
    const updateOverflow = () => {
      rafId = null;
      const max = listWrap.scrollHeight - listWrap.clientHeight;
      const hasOverflow = max > 1;
      listWrap.classList.toggle('has-overflow-top', hasOverflow && listWrap.scrollTop > 1);
      listWrap.classList.toggle('has-overflow-bottom', hasOverflow && listWrap.scrollTop < max - 1);
    };
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(updateOverflow);
    };
    listWrap.addEventListener('scroll', schedule, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(schedule).observe(listWrap);
    }
    requestAnimationFrame(updateOverflow);
  }

  // In multi-select mode the AI subsection header is sticky, and the
  // multi-submit bar sticks just below it. Measure the subsection
  // header's height so the bar's `top:` lands flush against it.
  const aiSubHeader = container.querySelector('.ai-shortcuts-subsection .shortcuts-subsection-header');
  if (card && aiSubHeader) {
    const setSubH = () => {
      const h = aiSubHeader.offsetHeight;
      if (h > 0) card.style.setProperty('--ai-subheader-h', h + 'px');
    };
    requestAnimationFrame(setSubH);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(setSubH).observe(aiSubHeader);
    }
  }
}

function shortcutItem(shortcut, topicName) {
  const iconHTML = renderIcon(shortcut.icon, 'sidebar-shortcut-icon');
  const prompt = shortcut.prompt.replace(/\{topic\}/gi, topicName);
  return `
    <button class="sidebar-shortcut"
            data-prompt="${escapeAttr(prompt)}"
            data-name="${escapeAttr(shortcut.name)}"
            data-icon-key="${escapeAttr(shortcut.icon)}"
            title="${escapeAttr(shortcut.name)}">
      <span class="sidebar-shortcut-multi-check" aria-hidden="true">✓</span>
      ${iconHTML}
      <span class="sidebar-shortcut-name">${escapeHTML(shortcut.name)}</span>
      <span class="sidebar-shortcut-chev" aria-hidden="true">›</span>
    </button>
  `;
}

// AI action card — single click target. Vertical layout: the icon
// sits inline with the title on the first row (icon acts as a
// small "tag" preceding the name), and the description occupies a
// second row spanning the card's full width. This pattern (vs. a
// fixed icon column on the left) keeps long titles from getting
// squeezed and gives descriptions room to breathe, while the
// in-line icon still carries the group's accent color identity.
// Click toggles multi-select; the marker check replaces the icon
// glyph when selected. Keeps the .sidebar-shortcut +
// .ai-shortcut-select-btn classes so the existing select / submit
// handlers still pick it up.
// === Topic Intelligence accordions ====================================



// AI shortcut row — title + description in a button. Keeps the
// existing multi-select wiring (data-prompt / data-name / etc)
// so the bottom controls (Preview / Direct Submit) still work.
// Individual shortcut icons are NOT rendered in the row — the
// section header carries the visual identity, and dropping the
// per-row icon leaves more room for the title + description.
const TI_CHEV_SVG = '<svg class="ti-chev-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const TI_SUBMIT_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9z"/></svg>';
const TI_REVIEW_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const TI_RIGHT_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
const TI_BACK_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';

// The model a Direct Submit goes to (the user's preferred / site default).
function tiPreferredModel() {
  return getModelById(getPreferredModelId(getDefaultModelId())) || (getModels() || [])[0] || null;
}
// Consistent submission flow (matches the AI Intelligence component + modals):
// Direct Submit (→ leaving-site confirm) / Review Prompt (→ full prompt modal).
function tiExploreHomeHTML() {
  const m = tiPreferredModel();
  const opts = (getModels() || []).map((x) => `<option value="${escapeAttr(x.id)}"${m && x.id === m.id ? ' selected' : ''}>${escapeHTML(x.name)}</option>`).join('');
  return `<div class="ti-explore" data-step="home">
    <label class="ti-explore-model"><span class="ti-explore-model-lead">Send to</span>
      <span class="ti-explore-select-wrap"><select class="ti-explore-select" aria-label="Choose AI model">${opts}</select>${TI_CHEV_SVG}</span></label>
    <button type="button" class="ti-explore-opt" data-opt="direct"><span class="ti-explore-ic">${TI_SUBMIT_SVG}</span><span class="ti-explore-tx"><span class="ti-explore-name">Direct Submit</span><span class="ti-explore-sub">Open <span class="ti-explore-mn">${escapeHTML(m ? m.name : 'an AI model')}</span> with this prompt</span></span><span class="ti-explore-go">${TI_RIGHT_SVG}</span></button>
    <button type="button" class="ti-explore-opt" data-opt="review"><span class="ti-explore-ic">${TI_REVIEW_SVG}</span><span class="ti-explore-tx"><span class="ti-explore-name">Review Prompt</span><span class="ti-explore-sub">Preview &amp; tweak it before you send</span></span><span class="ti-explore-go">${TI_RIGHT_SVG}</span></button>
  </div>`;
}
function tiLeaveHTML() {
  const m = tiPreferredModel();
  const name = m ? m.name : 'the AI model';
  return `<div class="ti-explore" data-step="leave">
    <div class="ti-leave-card"><button type="button" class="ti-leave-back">${TI_BACK_SVG}<span>Back</span></button><p class="ti-leave-title">You're leaving Standard Topic</p><p class="ti-leave-body">Continue opens <strong>${escapeHTML(name)}</strong> in a new tab. If the prompt doesn't auto-fill, it's copied to your clipboard — just paste it in. You may need to be signed in.</p><button type="button" class="ti-leave-go">Continue ${TI_RIGHT_SVG}</button></div>
  </div>`;
}

// AI shortcut row → click expands a model list → click a model expands
// Submit / Review actions. No multi-select; each action acts on this one
// prompt (Submit sends to the model + copies to clipboard; Review opens the
// prompt modal). Drops the .ai-shortcut-select-btn class so the legacy
// multi-select wiring no longer attaches.
function tiShortcutItem(shortcut, topicName, groupKey) {
  const prompt = shortcut.prompt.replace(/\{topic\}/gi, topicName);
  const description = shortcut.description && shortcut.description.trim()
    ? `<span class="ti-item-desc">${escapeHTML(shortcut.description)}</span>`
    : '';
  return `
    <li class="ti-item-row">
      <div class="ti-shortcut" data-prompt="${escapeAttr(prompt)}" data-name="${escapeAttr(shortcut.name)}" data-icon-key="${escapeAttr(shortcut.icon)}" data-group="${escapeAttr(groupKey || '')}" data-id="${escapeAttr(shortcut.id || '')}">
        <button type="button" class="ti-item ti-item-shortcut ti-shortcut-trigger" aria-expanded="false" title="${escapeAttr(shortcut.name)}">
          <span class="ti-item-text">
            <span class="ti-item-name">${escapeHTML(shortcut.name)}</span>
            ${description}
          </span>
          <span class="ti-shortcut-chev" aria-hidden="true">${TI_CHEV_SVG}</span>
        </button>
        <div class="ti-shortcut-panel"><div class="ti-shortcut-panel-inner">${tiExploreHomeHTML()}</div></div>
      </div>
    </li>
  `;
}

function shortcutCard(shortcut, topicName, groupKey) {
  const prompt = shortcut.prompt.replace(/\{topic\}/gi, topicName);
  const iconHTML = renderIcon(shortcut.icon, 'ti-action-card-icon-svg');
  const description = shortcut.description && shortcut.description.trim()
    ? `<span class="ti-action-card-desc">${escapeHTML(shortcut.description)}</span>`
    : '';
  return `
    <li class="ai-shortcut-bullet-row ti-action-card-row">
      <button class="sidebar-shortcut ai-shortcut-select-btn ti-action-card"
              data-prompt="${escapeAttr(prompt)}"
              data-name="${escapeAttr(shortcut.name)}"
              data-icon-key="${escapeAttr(shortcut.icon)}"
              data-group="${escapeAttr(groupKey || '')}"
              aria-pressed="false"
              title="${escapeAttr(shortcut.name)}">
        <span class="ti-action-card-header">
          <span class="ti-action-card-icon" aria-hidden="true">
            ${iconHTML}
            <span class="ai-shortcut-marker ti-action-card-marker" aria-hidden="true">
              <svg class="ai-shortcut-marker-check ti-action-card-check" viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="2 7 6 11 12 3"/>
              </svg>
            </span>
          </span>
          <span class="sidebar-shortcut-name ti-action-card-name">${escapeHTML(shortcut.name)}</span>
        </span>
        ${description}
      </button>
    </li>
  `;
}

// Web Source chip — compact pill linking out to an external search.
// Distinct from the AI Action cards above so users immediately read
// "external link" vs. "send to an LLM". Icon + name in a single
// horizontal chip; the chip strip wraps to fit the sidebar width.
function webSourceChip(search, topicName) {
  const url = search.urlTemplate.replace(/\{query\}/g, encodeURIComponent(topicName));
  const iconHTML = renderIcon(search.icon, 'ti-web-source-chip-icon');
  // Card shape matches the AI action cards below — icon + name on
  // the header row, evergreen description spanning the card width
  // underneath. Reads as a parallel set of "things you can open"
  // tied to this search, with the difference being external link
  // vs. send-prompt-to-LLM.
  const description = search.description
    ? `<span class="ti-web-source-chip-desc">${escapeHTML(search.description)}</span>`
    : '';
  return `
    <li class="ti-web-source-chip-row">
      <a class="ti-web-source-chip quick-link-pill"
         href="${url}"
         target="_blank"
         rel="noopener noreferrer"
         data-name="${escapeAttr(search.name)}"
         title="Open ${escapeAttr(search.name)} search">
        <span class="ti-web-source-chip-header">
          ${iconHTML}
          <span class="ti-web-source-chip-name">${escapeHTML(search.name)}</span>
        </span>
        ${description}
      </a>
    </li>
  `;
}

// AI shortcut row — single click target. Default state shows a
// bullet dot to the left of the name. Clicking the row toggles
// selection: bullet swaps to a filled-blue checkbox with a white
// check. Submission always routes through the sticky bottom bar.
function shortcutBulletItem(shortcut, topicName) {
  const prompt = shortcut.prompt.replace(/\{topic\}/gi, topicName);
  return `
    <li class="ai-shortcut-bullet-row">
      <button class="sidebar-shortcut ai-shortcut-select-btn"
              data-prompt="${escapeAttr(prompt)}"
              data-name="${escapeAttr(shortcut.name)}"
              data-icon-key="${escapeAttr(shortcut.icon)}"
              aria-pressed="false"
              title="${escapeAttr(shortcut.name)}">
        <span class="ai-shortcut-marker" aria-hidden="true">
          <span class="ai-shortcut-marker-dot"></span>
          <svg class="ai-shortcut-marker-check" viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="2 7 6 11 12 3"/>
          </svg>
        </span>
        <span class="sidebar-shortcut-name">${escapeHTML(shortcut.name)}</span>
      </button>
    </li>
  `;
}

// Bucket AI shortcuts into Discover / Learn / Analyze by name keyword.
// Items that don't match any bucket fall into "other" and render in
// the trailing "More" group. Categories are starter heuristics — a
// `category` field on each shortcut would replace this later.

// Apply per-group accent colors as CSS overrides. Runs once at data
// load — generates a <style> block that sets --ti-accent on each
// .ti-action-group--<id> class to the group's color from data. This
// is how admin-managed colors (set in the admin panel's Shortcut
// Groups tab) propagate into the section underlines + tinted SVG
// icons without needing to ship a new build.
function applyGroupAccentColors() {
  const defs = (window.__assignmentsData && Array.isArray(window.__assignmentsData.groups) && window.__assignmentsData.groups.length)
    ? window.__assignmentsData.groups
    : DEFAULT_GROUP_DEFS;
  const rules = defs
    .filter(g => g.color)
    .map(g => `.ti-action-group--${g.id} { --ti-accent: ${g.color}; }`)
    .join('\n');
  let styleEl = document.getElementById('group-accent-overrides');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'group-accent-overrides';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = rules;
}

// Quick Link bullet row — matches the AI Shortcut bullet item
// structure (dot marker + name) so both lists read as one cohesive
// stack instead of a button grid above a bullet list. The trailing
// "↗" badge signals "this opens externally" without competing with
// the row's text.
function quickLinkPill(search, topicName) {
  const url = search.urlTemplate.replace(/\{query\}/g, encodeURIComponent(topicName));
  return `
    <li class="ai-shortcut-bullet-row quick-link-bullet-row">
      <a class="sidebar-shortcut quick-link-pill"
         href="${url}"
         target="_blank"
         rel="noopener noreferrer"
         data-name="${escapeAttr(search.name)}"
         title="${escapeAttr(search.name)}">
        <span class="ai-shortcut-marker" aria-hidden="true">
          <span class="ai-shortcut-marker-dot"></span>
        </span>
        <span class="sidebar-shortcut-name">${escapeHTML(search.name)}</span>
      </a>
    </li>
  `;
}

// Quick Link row — uses the same .sidebar-shortcut structure as AI
// shortcuts so both lists read as one unified stack. Anchor opens
// the platform search in a new tab; trailing ↗ glyph signals
// external link. In multi-select mode the row gets disabled by CSS
// (.shortcuts-sidebar.is-multi-select .quick-link-row) and a click
// handler in renderShortcutsSidebar surfaces a toast.
function quickLinkItem(search, topicName) {
  const url = search.urlTemplate.replace(/\{query\}/g, encodeURIComponent(topicName));
  const iconHTML = renderIcon(search.icon, 'sidebar-shortcut-icon');
  return `
    <a class="sidebar-shortcut quick-link-row"
       href="${url}"
       target="_blank"
       rel="noopener noreferrer"
       data-name="${escapeAttr(search.name)}"
       title="${escapeAttr(search.name)}">
      ${iconHTML}
      <span class="sidebar-shortcut-name">${escapeHTML(search.name)}</span>
      <span class="sidebar-shortcut-chev quick-link-external" aria-hidden="true">↗</span>
    </a>
  `;
}

function renderRelatedTopicsSidebar(container, route, isHome) {
  if (isHome) {
    // Home "Topics" card — flat-list matching AI Shortcuts style.
    // 8 parent topics + "View All Topics +" CTA.
    const featured = getFeaturedTopics();

    let html = `
      <div class="sidebar-card shortcuts-sidebar topics-card">
        <div class="sidebar-card-header">
          <h3 class="sidebar-card-title">Topics</h3>
          <span class="sidebar-card-desc">Browse curated news feeds and AI tools by subject.</span>
        </div>
        <div class="sidebar-shortcut-list">
    `;
    featured.forEach(t => {
      html += `
        <a href="#/topic/${t.slug}" class="sidebar-shortcut">
          ${topicIconSVG(t.icon || 'globe', 'sidebar-shortcut-icon')}
          <span class="sidebar-shortcut-name">${escapeHTML(t.name)}</span>
          <span class="sidebar-shortcut-chev" aria-hidden="true">›</span>
        </a>
      `;
    });
    html += `</div>
      <div class="topics-card-footer">
        <a href="#" class="topics-card-footer-link" id="topics-view-all-cta">View All Topics +</a>
      </div>
    </div>`;
    container.innerHTML = html;

    container.querySelector('#topics-view-all-cta')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('open-all-topics-modal'));
    });
    return;
  }

  // Topic pages: flat-list card matching AI Shortcuts style.
  // Desktop (non-tabular): show 5 + "View More Related +" to expand.
  // Mobile (tabular): show the full list (no hiding — this IS the
  // dedicated Related Topics tab so the user expects everything).
  const RELATED_CAP = 5;
  const allItems = getRelatedTopicsFor(route, isHome);
  const hasMore = allItems.length > RELATED_CAP;

  let html = `
    <div class="sidebar-card shortcuts-sidebar related-sidebar">
      <div class="sidebar-card-header">
        <h3 class="sidebar-card-title">Related Topics</h3>
        <span class="sidebar-card-desc">Explore related subjects with their own feeds and shortcuts.</span>
      </div>
  `;
  if (allItems.length === 0) {
    html += `<p class="sidebar-empty">No related topics yet.</p>`;
  } else {
    html += `<div class="sidebar-shortcut-list" id="related-topic-list">`;
    allItems.forEach((t, i) => {
      const hiddenClass = (hasMore && i >= RELATED_CAP) ? 'is-overflow-related' : '';
      html += `
        <a href="#/topic/${t.slug}" class="sidebar-shortcut ${hiddenClass}">
          ${topicIconSVG(t.icon || 'globe', 'sidebar-shortcut-icon')}
          <span class="sidebar-shortcut-name">${escapeHTML(t.name)}</span>
          <span class="sidebar-shortcut-chev" aria-hidden="true">›</span>
        </a>
      `;
    });
    html += `</div>`;
  }

  // Footer links — inline row with both actions
  html += `<div class="topics-card-footer">`;
  if (hasMore) {
    html += `<a href="#" class="topics-card-footer-link" id="view-more-related">More Related +</a>`;
    html += `<a href="#" class="topics-card-footer-link" id="view-all-topics-cta">All Topics +</a>`;
  } else {
    html += `<a href="#" class="topics-card-footer-link" id="view-all-topics-cta">View All Topics +</a>`;
  }
  html += `</div>`;

  html += `</div>`;
  container.innerHTML = html;

  // "More Related +" — open modal with full related list
  container.querySelector('#view-more-related')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('open-related-topics-modal', {
      detail: { topics: allItems, title: 'Related Topics' },
    }));
  });

  // "View All Topics +"
  container.querySelector('#view-all-topics-cta')?.addEventListener('click', (e) => {
    e.preventDefault();
    const searchBar = document.querySelector('.search-bar');
    if (searchBar) searchBar.click();
  });
}

// ---------- Data helpers (thin wrappers around data.js) ----------

function getRelatedTopicsFor(route, isHome) {
  if (isHome) return getParentTopics();
  const topic = getTopicBySlug(route.slug);
  return topic ? getRelatedTopics(topic) : [];
}

function escapeAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== Search modal (Custom Topic Search, as a takeover modal) ============
// Tracks the currently-rendered underlying page so search/custom routes can
// open the modal without re-rendering home beneath it on every keystroke.
let lastBaseRouteKey = null;
let searchModalOverlay = null;
let searchModalPanel = null;
let searchModalTerm = '';
let searchPanelModalCtl = null;
let homeSearchPanelCtl = null;

const SEARCH_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
const X_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
const LINK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

// Shared expanding search panel — used by the nav modal (mode:'modal') and
// the homepage hero (mode:'inline'). Renders hero + search bar + suggestions
// + results host, owns the collapse/expand animation, returns a controller.
// Helpers for the Search panel's stored News + Trending results.
function spHost(u) {
  if (!u) return '';
  try { return new URL(u).hostname.replace(/^www\./i, '').toLowerCase(); }
  catch { return String(u).replace(/^https?:\/\//i, '').split('/')[0]; }
}
function spRel(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return (m || 1) + 'm';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h';
  const d = Math.round(h / 24);
  if (d < 7) return d + 'd';
  const w = Math.round(d / 7);
  if (w < 5) return w + 'w';
  return new Date(iso).toLocaleDateString();
}
function spTitleCase(s) { return String(s || '').toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase()); }
// Trending-row mark (line graph) — shared by the search-results Trending tab.
const SP_TREND_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>';

function renderSearchPanel(container, { mode = 'inline', term = '' } = {}) {
  const isModal = mode === 'modal';
  container.innerHTML = `
    <div class="search-panel search-panel--${mode}" data-state="collapsed">
      <div class="search-panel-hero"><div class="search-panel-hero-inner">
        ${isModal
          ? `<h2 class="search-panel-title">Search</h2>
             <p class="search-panel-tagline">News, Resources and AI Knowledge</p>`
          : `<h2 class="search-panel-title">What do you want to know?</h2>
             <p class="search-panel-tagline">News, resources &amp; AI insights on any topic.</p>`}
      </div></div>
      <div class="search-panel-barrow">
        <form class="search-panel-form" role="search" autocomplete="off">
          <span class="search-panel-icon" aria-hidden="true">${SEARCH_ICON_SVG}</span>
          <input class="search-panel-input" type="search" placeholder="Search any topic…" aria-label="Search any topic" value="${escapeAttr(term)}">
          <button type="button" class="search-panel-copylink" aria-label="Copy a shareable link to this search" title="Copy link to this search">${LINK_ICON_SVG}</button>
          <button type="button" class="search-panel-clear" aria-label="Clear search" hidden>${X_ICON_SVG}</button>
        </form>
        <div class="search-panel-suggest" role="listbox" hidden></div>
      </div>
      ${!isModal ? `<div class="search-panel-starters" aria-label="Popular topics"></div>` : ''}
      <div class="search-panel-results"><div class="search-panel-results-inner"></div></div>
      ${isModal
        ? `<div class="search-panel-empty">
             <div class="search-panel-empty-head">
               <span class="search-panel-empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
               <h3 class="search-panel-empty-title">Search anything</h3>
             </div>
             <p class="search-panel-empty-text">Type a topic, term, or headline and we'll pull together the latest news, web sources, and AI insights.</p>
             <div class="search-panel-empty-sec" data-empty-trending hidden>
               <div class="search-panel-empty-sechead"><span class="search-panel-empty-seclabel">Trending</span><button type="button" class="search-panel-empty-more" data-view-trending>View more trending<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg></button></div>
               <div class="search-panel-empty-chips" role="list"></div>
             </div>
             <div class="search-panel-empty-sec" data-empty-featured hidden>
               <div class="search-panel-empty-sechead"><span class="search-panel-empty-seclabel">Featured Topics</span></div>
               <div class="search-panel-empty-topics"></div>
             </div>
           </div>`
        : ''}
    </div>`;

  const panelEl = container.querySelector('.search-panel');
  const form = panelEl.querySelector('.search-panel-form');
  const input = panelEl.querySelector('.search-panel-input');
  const suggestEl = panelEl.querySelector('.search-panel-suggest');
  const clearBtn = panelEl.querySelector('.search-panel-clear');
  const resultsInner = panelEl.querySelector('.search-panel-results-inner');
  const copyLinkBtn = panelEl.querySelector('.search-panel-copylink');
  function syncClear() { if (clearBtn) clearBtn.hidden = !input.value; }
  let currentTerm = '';
  let suggestItems = [];   // [{type:'topic'…} | {type:'trend', query, category} | {type:'custom', term}]
  let activeIdx = -1;

  // Live trending searches feed the typeahead: type "kni" → "Knicks" surfaces as
  // a hot suggestion (#77). fetchTrending() is session-cached, so this is one
  // shared request across the home hero + nav modal. Warm it on panel creation.
  let trendSuggest = [];   // [{query, category, queryLc}]
  let trendTopicsRaw = []; // full trend objects (for opening the trend modal)
  const spTitleCase = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
  fetchTrending().then(({ topics }) => {
    trendTopicsRaw = topics || [];
    trendSuggest = (topics || [])
      .map((t) => {
        const query = spTitleCase(t.query);
        return { query, category: (t.categories && t.categories[0]) || '', queryLc: query.toLowerCase() };
      })
      .filter((t) => t.query);
    // If the user is already mid-type when trends land, refresh the dropdown.
    if (input.value.trim() && panelEl.dataset.state !== 'expanded') refreshSuggestions();
    // Seed the empty-state "trending now" starter chips (modal only).
    fillEmptyChips();
    // Home inline card: now that live trends are in, add the Trending group.
    fillStarterChips();
  }).catch(() => {});

  // Empty-state starter chips (#6): tappable live-trending terms that nudge the
  // user to search. Falls back silently to hidden if no trends are available.
  function fillEmptyChips() {
    if (!isModal) return;
    const sec = panelEl.querySelector('[data-empty-trending]');
    const wrap = panelEl.querySelector('.search-panel-empty-chips');
    if (!wrap || !sec) return;
    const picks = trendSuggest.slice(0, 6);
    if (!picks.length) { sec.hidden = true; return; }
    wrap.innerHTML = picks.map((t) =>
      `<button type="button" class="search-panel-empty-chip" role="listitem">${SP_TREND_ICON}<span>${escapeHTML(t.query)}</span></button>`
    ).join('');
    sec.hidden = false;
    wrap.querySelectorAll('.search-panel-empty-chip').forEach((b, i) => {
      b.addEventListener('click', () => { const q = picks[i] && picks[i].query; if (q) expand(q); });
    });
    // "View more trending" → open the Trending list (closes this search modal).
    sec.querySelector('[data-view-trending]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('close-all-modals'));
      window.dispatchEvent(new CustomEvent('open-trending-list'));
    });
  }
  // Empty-state "Featured Topics" — the parent topics, each linking to its page.
  function fillEmptyFeatured() {
    if (!isModal) return;
    const sec = panelEl.querySelector('[data-empty-featured]');
    const wrap = panelEl.querySelector('.search-panel-empty-topics');
    if (!wrap || !sec) return;
    let topics = [];
    try { topics = (getFeaturedTopics() || []).filter((t) => t && t.slug && t.slug !== 'home'); } catch (_) {}
    if (!topics.length) { sec.hidden = true; return; }
    wrap.innerHTML = topics.map((t) => `<a class="search-panel-empty-topic" href="#/topic/${escapeAttr(t.slug)}">${escapeHTML(t.name)}</a>`).join('');
    sec.hidden = false;
  }

  // Inline (home) starter chips under the bar — two quick-launch groups so the
  // card is an actionable launchpad: a few POPULAR topics (link to the topic page)
  // and a few TRENDING terms (run the search). Re-run once live trends land.
  function fillStarterChips() {
    if (isModal) return;
    const wrap = panelEl.querySelector('.search-panel-starters');
    if (!wrap) return;
    let topics = [];
    try { topics = (getFeaturedTopics() || []).filter((t) => t && t.slug && t.slug !== 'home').slice(0, 5); } catch (_) {}
    const trends = (trendSuggest || []).slice(0, 4);
    if (!topics.length && !trends.length) { wrap.hidden = true; return; }
    const group = (label, chips) => `<div class="sp-starter-group"><span class="sp-starter-label">${label}</span><div class="sp-starter-chips">${chips}</div></div>`;
    const topicChips = topics.map((t) => `<a class="sp-chip" href="#/topic/${escapeAttr(t.slug)}">${escapeHTML(t.name)}</a>`).join('');
    const trendChips = trends.map((t) => `<button type="button" class="sp-chip sp-chip--trend" data-q="${escapeAttr(t.query)}">${SP_TREND_ICON}<span>${escapeHTML(t.query)}</span></button>`).join('');
    wrap.innerHTML = (topics.length ? group('Popular topics', topicChips) : '')
      + (trends.length ? group('Trending now', trendChips) : '');
    wrap.hidden = false;
    // A trend chip opens that trend's insight modal (NOT a search of the card) —
    // same as clicking it in the Trending list (full trend list as Prev/Next nav).
    wrap.querySelectorAll('.sp-chip--trend').forEach((b) => b.addEventListener('click', () => {
      const list = (trendTopicsRaw || []).map((t) => ({ type: 'trend', query: spTitleCase(t.query), category: (t.categories && t.categories[0]) || '', startedAt: t.startedAt || '', trendBreakdown: Array.isArray(t.trendBreakdown) ? t.trendBreakdown.slice(0, 8) : [] }));
      let index = list.findIndex((e) => e.query === b.dataset.q);
      if (index < 0) { if (!list.length) return; index = 0; }
      window.dispatchEvent(new CustomEvent('open-insight-modal', { detail: { ...list[index], nav: { list, index, backLabel: 'View All Trending', backEvent: 'open-trending-list', itemKind: 'trend' } } }));
    }));
  }
  fillStarterChips();
  fillEmptyFeatured();

  // The custom-search results card — the SAME pill-tab shell as the AI Insights
  // modal, but NO on-demand AI generation. Tabs: External Insights (the curated
  // external-model shortcuts — primary, landed on first), then News + Trending
  // (ONLY when they have items), then Web Search. The term is fixed by the search
  // bar above, so the in-card topic re-pick is locked off.
  let aiiSearchCtl = null;
  function customAiiScope(t, opts) {
    opts = opts || {};
    const desc = {}; const icons = {}; let shortcuts = [];
    try {
      shortcuts = getShortcutsForTopic('_custom') || [];
      shortcuts.forEach((s) => { if (s && s.name) { desc[s.name] = s.description || ''; icons[s.name] = s.icon || ''; } });
    } catch (_) {}
    const extraTabs = [];
    const order = ['external'];   // External Insights = the shortcuts (primary tab)
    if (opts.news) { extraTabs.push({ group: 'news', tab: 'News', subtitle: 'Latest stories matching your search.', icon: SP_NEWS_ICON, render: (wrap) => renderSearchNewsInto(wrap, t) }); order.push('news'); }
    if (opts.trends) { extraTabs.push({ group: 'trending', tab: 'Trending', subtitle: 'Trending searches related to your term.', icon: SP_TREND_SEC_ICON, render: (wrap) => renderSearchTrendingInto(wrap, t) }); order.push('trending'); }
    order.push('websearch');      // Web Search last
    return {
      inModal: true,              // flowMode → the builder (pill-tab) shell
      initialBuilder: true,
      initialGroup: 'external',   // land on the external-model shortcuts
      lockTopic: true,
      topic: t, label: t,
      descriptions: desc, icons, shortcuts,
      hideGroups: ['discover', 'topic-specific', 'analyze', 'learn'],  // no AI-generation tabs
      extraTabs,
      builderTabOrder: order,
    };
  }
  function destroyAii() {
    if (aiiSearchCtl && aiiSearchCtl.destroy) { try { aiiSearchCtl.destroy(); } catch (_) {} }
    aiiSearchCtl = null;
  }
  function mountAii(t, opts) {
    destroyAii();
    resultsInner.innerHTML = '';
    const aiHost = document.createElement('div');
    aiHost.className = 'search-aii-host';
    resultsInner.appendChild(aiHost);
    aiiSearchCtl = renderAIIntelligence(aiHost, customAiiScope(t, opts));
  }
  // (Re)render the results for a term. External Insights + Web Search are always
  // present; News + Trending tabs are added only when they have items, so we fetch
  // both first (cached per term), then mount the card with the right tab set.
  // Shared by expand() and the live-edit handler.
  function renderResults(t) {
    destroyAii();
    resultsInner.innerHTML = `<div class="search-content"><div class="search-content-loading">Searching…</div></div>`;
    Promise.all([spFetchNews(t), spFetchTrends(t)]).then(([news, trends]) => {
      if (currentTerm !== t) return;   // term changed mid-fetch — a newer render owns the DOM
      mountAii(t, { news: !!(news && news.length), trends: !!(trends && trends.length) });
    });
  }
  function expand(rawTerm) {
    const t = (rawTerm || '').trim();
    if (!t) return;
    currentTerm = t;
    input.value = t;
    hideSuggest();
    renderResults(t);
    panelEl.dataset.state = 'expanded';
    syncClear();
    ctl.onExpand && ctl.onExpand(t);
  }
  function collapse() {
    currentTerm = '';
    input.value = '';
    panelEl.dataset.state = 'collapsed';
    hideSuggest();
    destroyAii();
    resultsInner.innerHTML = '';
    syncClear();
    ctl.onCollapse && ctl.onCollapse();
  }
  // News + Trending are folded into the AI Insights card's pill-tab row (as extra
  // tabs) — there's no separate outer tab bar. Each renders lazily into the builder
  // body when its tab is clicked; results cache per term so re-clicking doesn't
  // refetch. The icons + section title are supplied by the builder card itself.
  const SP_NEWS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="7" y1="12" x2="14" y2="12"/><line x1="7" y1="16" x2="11" y2="16"/></svg>';
  const SP_TREND_SEC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>';
  const spContentCache = {};   // term -> { news: [...]|null, trends: [...]|null }
  async function spFetchNews(term) {
    if (spContentCache[term] && spContentCache[term].news) return spContentCache[term].news;
    let stories = [];
    try {
      const nr = await fetch(`/api/news-search?q=${encodeURIComponent(term)}&limit=12`, { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null).catch(() => null);
      stories = (nr && nr.stories) || [];
    } catch (_) { stories = []; }
    spContentCache[term] = Object.assign(spContentCache[term] || {}, { news: stories });
    return stories;
  }
  async function spFetchTrends(term) {
    if (spContentCache[term] && spContentCache[term].trends) return spContentCache[term].trends;
    let items = [];
    try {
      const tr = await fetch(`/api/trending-history?mode=search&q=${encodeURIComponent(term)}&limit=12`, { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null).catch(() => null);
      items = (tr && tr.items) || [];
    } catch (_) { items = []; }
    spContentCache[term] = Object.assign(spContentCache[term] || {}, { trends: items });
    return items;
  }
  // News tab body — the builder card already supplies the "News" title/icon, so
  // render just the story cards (no inner "News Feed" header).
  async function renderSearchNewsInto(wrap, term) {
    wrap.innerHTML = `<div class="search-content"><div class="search-content-loading">Searching news…</div></div>`;
    const stories = await spFetchNews(term);
    if (!wrap.isConnected) return;
    wrap.innerHTML = stories.length
      ? `<section class="search-news-section search-news-section--builder">${newsListHTML(stories)}</section>`
      : '<p class="aii-empty">No recent news for this search.</p>';
    wireNewsAI(wrap);
  }
  // Trending tab body — related trending searches; a row opens the unified trend
  // insight modal (same as everywhere else).
  async function renderSearchTrendingInto(wrap, term) {
    wrap.innerHTML = `<div class="search-content"><div class="search-content-loading">Searching trends…</div></div>`;
    const items = await spFetchTrends(term);
    if (!wrap.isConnected) return;
    const rows = items.map((it) => {
      const q = it.query || ''; const cat = it.category || '';
      return `<button type="button" class="search-trend-row" data-trend="${escapeAttr(q)}" data-cat="${escapeAttr(cat)}">
        <span class="search-trend-mark" aria-hidden="true">${SP_TREND_ICON}</span>
        <span class="search-trend-text"><span class="search-trend-name">${escapeHTML(spTitleCase(q))}</span>${cat ? `<span class="search-trend-cat">${escapeHTML(cat)}</span>` : ''}</span>
      </button>`;
    }).join('');
    wrap.innerHTML = rows
      ? `<section class="search-trend-section search-trend-section--builder"><div class="search-trend-list">${rows}</div></section>`
      : '<p class="aii-empty">No trending searches for this term.</p>';
    wrap.querySelectorAll('[data-trend]').forEach((b) => b.addEventListener('click', () => {
      const q = b.dataset.trend; if (!q) return;
      window.dispatchEvent(new CustomEvent('open-insight-modal', { detail: { type: 'trend', query: q, category: b.dataset.cat || '', categories: b.dataset.cat ? [b.dataset.cat] : [] } }));
    }));
  }
  function hideSuggest() { suggestEl.hidden = true; suggestEl.innerHTML = ''; suggestItems = []; activeIdx = -1; }
  function refreshSuggestions() {
    const q = input.value.trim();
    if (!q || panelEl.dataset.state === 'expanded') { hideSuggest(); return; }
    const ql = q.toLowerCase();
    // Hot trends that contain the query — prefix matches rank first, then the
    // shortest (closest) match. Cap so the dropdown stays tidy.
    const trends = trendSuggest
      .filter((t) => t.queryLc.includes(ql))
      .sort((a, b) => {
        const ap = a.queryLc.startsWith(ql) ? 0 : 1, bp = b.queryLc.startsWith(ql) ? 0 : 1;
        return ap - bp || a.query.length - b.query.length;
      })
      .slice(0, 4);
    const trendNames = new Set(trends.map((t) => t.queryLc));
    // Topic matches, minus any that a trend row already covers (avoid dupes).
    const topics = searchTopics(q).filter((t) => !trendNames.has(String(t.name).toLowerCase())).slice(0, 4);
    suggestItems = trends.map((t) => ({ type: 'trend', query: t.query, category: t.category }))
      .concat(topics.map((t) => ({ type: 'topic', slug: t.slug, name: t.name, icon: t.icon })))
      .concat([{ type: 'custom', term: q }]);
    activeIdx = -1;
    suggestEl.innerHTML = suggestItems.map((it, i) => {
      if (it.type === 'trend') {
        return `<button type="button" class="search-panel-suggest-row is-trend" data-i="${i}" role="option"><span class="search-panel-suggest-ic" aria-hidden="true">${SP_TREND_ICON}</span><span class="search-panel-suggest-name">${escapeHTML(it.query)}</span><span class="search-panel-suggest-tag">Trending${it.category ? ` &middot; ${escapeHTML(it.category)}` : ''}</span></button>`;
      }
      if (it.type === 'topic') {
        // Topic row: a grey icon chip on the left (matching the trend row) + a grey
        // "Topic" pill on the right. No parent name — just the type marker.
        return `<button type="button" class="search-panel-suggest-row is-topic" data-i="${i}" role="option"><span class="search-panel-suggest-ic" aria-hidden="true">${topicIconSVG(it.icon || 'globe', '')}</span><span class="search-panel-suggest-name">${escapeHTML(it.name)}</span><span class="search-panel-suggest-tag search-panel-suggest-tag--topic">Topic</span></button>`;
      }
      // Custom "search this term" — a distinct ACTION row (divider above + primary
      // accent + leading search chip + trailing arrow), not another plain result.
      return `<button type="button" class="search-panel-suggest-row is-custom" data-i="${i}" role="option"><span class="search-panel-suggest-ic search-panel-suggest-ic--go" aria-hidden="true">${SEARCH_ICON_SVG}</span><span class="search-panel-suggest-name">Search “${escapeHTML(it.term)}”</span><span class="search-panel-suggest-go" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg></span></button>`;
    }).join('');
    suggestEl.hidden = false;
    suggestEl.querySelectorAll('.search-panel-suggest-row').forEach(row => {
      row.addEventListener('click', () => chooseSuggestion(Number(row.dataset.i)));
    });
  }
  function chooseSuggestion(i) {
    const it = suggestItems[i];
    if (!it) return;
    if (it.type === 'topic') {
      hideSuggest();
      if (isModal) { closeSearchPageModal(); document.body.style.overflow = ''; }
      navigate('#/topic/' + it.slug);
    } else {
      // custom OR trend → run the search for that term (a trend is just a
      // curated, timely query). Same path as any custom search.
      expand(it.type === 'trend' ? it.query : it.term);
    }
  }
  function moveActive(d) {
    if (suggestEl.hidden || !suggestItems.length) return;
    activeIdx = (activeIdx + d + suggestItems.length) % suggestItems.length;
    suggestEl.querySelectorAll('.search-panel-suggest-row').forEach((r, i) => r.classList.toggle('is-active', i === activeIdx));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    if (activeIdx >= 0 && !suggestEl.hidden) { chooseSuggestion(activeIdx); return; }
    // Inline (homepage) submit opens the search MODAL with results rather than
    // expanding in place; the #/custom route drives openSearchPageModal.
    if (isModal) { expand(v); }
    else { hideSuggest(); navigate('#/custom/' + encodeURIComponent(v)); }
  });
  // Live update: once expanded, editing the term re-renders the intelligence
  // so the shortcuts use the new term immediately (no Enter needed). The
  // sublabel under "Search Intelligence" updates instantly for feedback.
  let liveTimer = null;
  input.addEventListener('input', () => {
    syncClear();
    if (panelEl.dataset.state === 'expanded') {
      const v = input.value.trim();
      const sub = resultsInner.querySelector('[data-role="search-term-sub"]');
      if (sub) sub.textContent = v;
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => {
        const t = input.value.trim();
        if (t && t !== currentTerm) {
          currentTerm = t;
          renderResults(t);
        }
      }, 350);
    } else {
      refreshSuggestions();
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Escape' && !suggestEl.hidden) { e.preventDefault(); hideSuggest(); }
  });
  document.addEventListener('click', (e) => { if (!panelEl.contains(e.target)) hideSuggest(); });
  // X behavior: when expanded it resets the search back to the empty hero;
  // when already empty (modal only) it closes the modal. Wired to both the
  // modal's corner close and the inline reset button.
  const onClose = () => {
    // Modal corner-X always closes the modal now that the in-bar clear ✕
    // handles resetting the term. Inline (homepage) just collapses.
    if (isModal) { userCloseSearchModal(); return; }
    if (panelEl.dataset.state === 'expanded') { collapse(); input.focus(); }
  };
  // In-bar clear (✕): wipe the term and drop back to the empty hero. The
  // modal's corner close (ctl.close → onClose) still closes the modal.
  clearBtn?.addEventListener('click', () => {
    input.value = '';
    syncClear();
    if (panelEl.dataset.state === 'expanded') collapse();
    else hideSuggest();
    input.focus();
  });
  syncClear();
  // Copy-link icon in the bar — shares a deep link to this search (with the
  // current term, or the empty search modal when blank).
  copyLinkBtn && copyLinkBtn.addEventListener('click', async () => {
    const t = input.value.trim();
    const url = location.origin + location.pathname + (t ? '#/custom/' + encodeURIComponent(t) : '#/search');
    try { await navigator.clipboard.writeText(url); } catch (_) {
      const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) {} ta.remove();
    }
    copyLinkBtn.classList.add('is-copied');
    setTimeout(() => copyLinkBtn.classList.remove('is-copied'), 1400);
  });
  const ctl = { el: panelEl, input, expand, collapse, refreshSuggestions, close: onClose, onExpand: null, onCollapse: null,
    setTerm(t) { input.value = t || ''; },
    focus() { try { input.focus(); } catch (_) {} } };
  if (term && term.trim()) expand(term);
  return ctl;
}

// Mobile homepage: fade the search hero as the user scrolls toward the
// sticky tab bar, then latch it dismissed (one-way until reload).
let homeHeroScrollHandler = null;
function setupHomeHeroFade(heroEl) {
  if (homeHeroScrollHandler) { window.removeEventListener('scroll', homeHeroScrollHandler); homeHeroScrollHandler = null; }
  document.body.classList.remove('hero-dismissed');
  document.documentElement.style.setProperty('--hero-fade', '1');
  if (!heroEl) return;
  const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;
  homeHeroScrollHandler = () => {
    if (!isMobile() || document.body.classList.contains('hero-dismissed')) return;
    // Don't fade while the user is mid-search (panel expanded).
    if (heroEl.querySelector('.search-panel[data-state="expanded"]')) return;
    const h = heroEl.offsetHeight || 1;
    const y = window.scrollY;
    const fade = Math.max(0, 1 - y / (h * 0.7));
    document.documentElement.style.setProperty('--hero-fade', String(fade));
    if (y > h) document.body.classList.add('hero-dismissed');   // one-way latch
  };
  window.addEventListener('scroll', homeHeroScrollHandler, { passive: true });
}

// Phase 5: Search now lives in the shared full-width nav dropdown (not a
// takeover). All the search logic + routes + deep-links are unchanged — only
// the host element differs (the dropdown scroll area instead of the modal
// panel). The dropdown's own overlay/Esc/close-all wiring handles dismissal.
function initSearchPageModal() { /* no takeover to build — see openSearchPageModal */ }

function isSearchModalOpen() {
  const panel = document.getElementById('st-nav-panel');
  return !!(panel && panel.classList.contains('is-open') && navDdOpen && navDdOpen.key === 'search');
}

function openSearchPageModal(term) {
  const t = (term || '').trim();
  // Already open — expand/collapse the live panel in place (a term change from a
  // submit routes through here) rather than rebuilding the whole dropdown.
  if (isSearchModalOpen() && searchPanelModalCtl) {
    if (t) searchPanelModalCtl.expand(t); else searchPanelModalCtl.collapse();
    return;
  }
  searchModalTerm = t;
  openNavDropdown({
    key: 'search', triggerId: 'nav-search', bareHead: true, className: 'aii-nav-dd-search',
    ariaLabel: 'Search any topic',
    contentHTML: '<div class="search-navdd-host" data-search-host></div>',
    onClose: userCloseSearchModal,
    wire: (panel) => renderSearchModalBody(panel.querySelector('[data-search-host]'), t),
  });
}

function closeSearchPageModal(opts = {}) {
  if (!isSearchModalOpen()) return;
  searchModalTerm = '';
  searchPanelModalCtl = null;
  closeNavDropdown();
}

// ✕ / overlay / Esc: close and, if we're on a #/search or #/custom deep-link,
// return to home so the URL reflects the dismissed search.
function userCloseSearchModal() {
  const hash = window.location.hash || '';
  const onModalRoute = hash.startsWith('#/custom/') || hash === '#/search';
  closeSearchPageModal();
  if (onModalRoute) navigate('#/');
}

function renderSearchModalBody(host, term) {
  searchPanelModalCtl = renderSearchPanel(host, { mode: 'modal', term });
  // Modal submit keeps the URL shareable; the openSearchPageModal guard makes
  // the resulting route change expand the live panel rather than rebuild it.
  searchPanelModalCtl.onExpand = (t) => {
    const target = '#/custom/' + encodeURIComponent(t);
    if (window.location.hash !== target) navigate(target);
  };
  // Clearing inside the panel drops back to the empty-search route.
  searchPanelModalCtl.onCollapse = () => {
    if ((window.location.hash || '').startsWith('#/custom/')) navigate('#/search');
  };
  // Refresh the shell scroll-fades as results paint; focus the empty search.
  [200, 700, 1500].forEach((d) => setTimeout(updateNavDdFades, d));
  if (!term || !term.trim()) setTimeout(() => { try { searchPanelModalCtl.focus(); } catch (_) {} }, 80);
}

function renderPage(route) {
  const content = document.getElementById('content');
  content.innerHTML = '';
  cleanupTopicLayoutObservers();

  if (route.type === 'home') {
    const topic = getTopicBySlug('home');
    renderTopicLayout(content, { topic, route, isHome: true });
    return;
  }

  if (route.type === 'topic') {
    const topic = getTopicBySlug(route.slug);
    if (!topic) {
      content.innerHTML = `
        <div class="not-found">
          <h2>Topic not found</h2>
          <p>The topic "${route.slug}" doesn't exist. <a href="#/">Go home</a></p>
        </div>
      `;
      return;
    }
    renderTopicLayout(content, { topic, route, isHome: false });
    return;
  }

  if (route.type === 'custom') {
    renderTopicLayout(content, {
      topic: null,
      route,
      isHome: false,
      isCustom: true,
      customTerm: route.term,
    });
    return;
  }

  if (route.type === 'prompt-generator') {
    renderPromptGenerator(content);
    return;
  }

  if (route.type === 'about') {
    content.innerHTML = `
      <div class="about-page">
        <div class="about-hero">
          <h2 class="about-title">About Standard Topic</h2>
          <p class="about-lead">One place to read the news, run AI prompts, and explore any topic — organized so you actually find what you came for.</p>
        </div>

        <div class="about-section">
          <h3>What This Site Does</h3>
          <p>Every topic page combines three things side by side: a live news feed pulled from real publishers, a panel of pre-built AI prompts you can fire off in one click, and a set of quick links out to Google News, Reddit, X, YouTube, and DuckDuckGo. If a topic isn't in the library, type it into Search and the site builds the same panel around your term.</p>
          <h4 class="about-sub-heading">The four things you can do</h4>
          <ul>
            <li><strong>Browse topics</strong> — pick from the topic library, or open Search and type your own.</li>
            <li><strong>Read the news</strong> — every topic page has its own live feed, sorted newest-first.</li>
            <li><strong>Send an AI prompt</strong> — click any Topic Intelligence card and it opens in your preferred model (ChatGPT, Claude, Gemini, Perplexity, Copilot, or Google AI Mode) with the prompt already filled in.</li>
            <li><strong>Build your own prompt</strong> — open Prompt Builder to compose a custom prompt with topics, scope, output style, and citations, then send it where you want.</li>
          </ul>
          <h4 class="about-sub-heading">Your model, your choice</h4>
          <p>When you open Ask AI on any insight, pick the model you want — ChatGPT, Claude, Gemini, Perplexity, Copilot, or Google AI Mode. Your choice stays on your device for the session.</p>
          <h4 class="about-sub-heading">Open source</h4>
          <p>The whole site is open source. View the code, see what's planned, or fork it on GitHub.</p>
          <a href="https://github.com/jrcstreams/standard-topic" target="_blank" rel="noopener noreferrer" class="about-cta-link">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
            <span>View on GitHub</span>
          </a>
        </div>

        <div class="about-section about-creator">
          <h3>Created by</h3>
          <p>Standard Topic was built by <strong>John Choudhari</strong> — a builder with over a decade in digital media and communications, currently focused on how AI changes the way people read, search, and learn.</p>
          <div class="about-cta-row">
            <a href="https://johnchoud.com" target="_blank" rel="noopener noreferrer" class="about-cta-link">Portfolio</a>
            <a href="https://www.linkedin.com/in/johnchoudhari/" target="_blank" rel="noopener noreferrer" class="about-cta-link">LinkedIn</a>
          </div>
        </div>

        <div class="about-section about-disclaimer">
          <h3>A quick note on AI output</h3>
          <p>AI prompts on Standard Topic open in third-party platforms (ChatGPT, Claude, Gemini, Perplexity, and others). The site doesn't generate, host, or vouch for any of the responses you see there — that's between you and the platform.</p>
          <p>The full <a href="#/terms">Terms &amp; Conditions</a> cover the rest.</p>
        </div>
      </div>
    `;
    return;
  }

  if (route.type === 'terms') {
    content.innerHTML = `
      <div class="about-page">
        <div class="about-hero">
          <h2 class="about-title">Terms &amp; Conditions</h2>
          <p class="about-lead">Plain-English rules for using Standard Topic. Read once and you're set.</p>
          <p class="about-lead" style="font-size:0.9rem;opacity:0.7;">Last updated: May 2026</p>
        </div>

        <div class="about-section">
          <h3>1. Using the Site</h3>
          <p>By using Standard Topic (the "Site"), you agree to these terms. Don't agree? Don't use it. That's all this section is.</p>
        </div>

        <div class="about-section">
          <h3>2. What the Site Does</h3>
          <p>Standard Topic is a free, non-commercial, open-source tool that organizes public information by topic. It does four things:</p>
          <ul>
            <li><strong>Topic pages</strong> — curated panels of links, news, and AI shortcuts for a subject.</li>
            <li><strong>News feeds</strong> — articles aggregated from publicly available RSS sources via the rss.app API. The Site fetches and renders the items itself, with no rss.app widget or tracker loaded in your browser.</li>
            <li><strong>AI Shortcuts</strong> — preset prompts that open in a third-party AI service (ChatGPT, Claude, Gemini, Perplexity, Copilot, Google AI Mode) in a new tab.</li>
            <li><strong>Prompt Builder</strong> — a tool to compose a custom prompt in your browser and send it to the AI service of your choice.</li>
          </ul>
          <p>The Site doesn't host news content, doesn't run any AI model, and doesn't process your queries on its own server. The AI responses you see come from the third-party platform you sent the prompt to.</p>
        </div>

        <div class="about-section">
          <h3>3. No Accounts, No Personal Data</h3>
          <p>There's no sign-up. The Site doesn't ask for your name, email, or anything else. It doesn't set advertising cookies and doesn't sell or share data with ad networks.</p>
          <p>The Site's servers don't receive your prompts, your searches, or your browsing activity. Vercel (which hosts the Site) and any third-party platform you interact with may keep their own logs — those are covered by their policies, not these terms.</p>
        </div>

        <div class="about-section">
          <h3>4. Analytics</h3>
          <p>The Site uses Google Analytics 4 to count things in aggregate — page views, which AI models people pick, how often shortcuts get used. It's there to improve the Site, not to identify you.</p>
          <p>Analytics is configured with privacy defaults turned on: IP anonymization, Google Signals off, ad-personalization off. The Site doesn't log prompt text, Prompt Builder input, or anything else that could identify you. Block analytics with a privacy extension if you want; everything else still works.</p>
        </div>

        <div class="about-section">
          <h3>5. Local Browser Storage</h3>
          <p>Your browser's <code>localStorage</code> holds a few interface preferences — like your chosen default AI model and reasoning depth. It stays on your device. The Site never sees it. Clear it via your browser settings at any time.</p>
        </div>

        <div class="about-section">
          <h3>6. Third-Party Services</h3>
          <p>The Site links out to plenty of third parties:</p>
          <ul>
            <li><strong>AI providers</strong> — OpenAI (ChatGPT), Anthropic (Claude), Google (Gemini, Google AI Mode), Microsoft (Copilot), Perplexity.</li>
            <li><strong>News source</strong> — articles fetched server-side from the rss.app API.</li>
            <li><strong>Search and reference</strong> — Google News, DuckDuckGo, Reddit, X (Twitter), YouTube.</li>
            <li><strong>Fonts</strong> — Google Fonts (<code>fonts.googleapis.com</code>, <code>fonts.gstatic.com</code>).</li>
            <li><strong>Hosting</strong> — GitHub hosts the source code; Vercel serves the deployed Site.</li>
          </ul>
          <p>Standard Topic isn't affiliated with, endorsed by, or sponsored by any of them. Trademarks and logos belong to their owners. When you click out or send a prompt, you leave this Site — their terms and privacy policies apply, not ours.</p>
        </div>

        <div class="about-section">
          <h3>7. AI Output</h3>
          <p>AI Shortcuts and Prompt Builder send text to a third-party AI service you pick. The response comes back from that service, not from Standard Topic. We don't control the output and accept no responsibility for:</p>
          <ul>
            <li>whether it's accurate, complete, or up to date;</li>
            <li>output that's wrong, biased, offensive, or harmful;</li>
            <li>how the AI provider handles or stores your prompt and response.</li>
          </ul>
          <p>AI responses are not professional advice. Don't rely on them for medical, legal, financial, safety-critical, or otherwise consequential decisions. Verify anything important with a real source.</p>
        </div>

        <div class="about-section">
          <h3>8. News &amp; RSS Feeds</h3>
          <p>News content comes from third-party publishers via rss.app. The Site fetches and renders the items as plain links — no scripts, widgets, or trackers run on news pages. Standard Topic doesn't write, edit, select, or endorse any individual story. Headlines, summaries, and links belong to the originating publishers. For copyright concerns or corrections, contact the publisher directly.</p>
        </div>

        <div class="about-section">
          <h3>9. Intellectual Property</h3>
          <p>The source code is open source and lives at <a href="https://github.com/jrcstreams/standard-topic" target="_blank" rel="noopener noreferrer">github.com/jrcstreams/standard-topic</a>. Any reuse is subject to the license in that repository.</p>
          <p>The Standard Topic name, written copy, and original design belong to the Site's creator. Third-party names, logos, and marks belong to their respective owners and appear here for identification only.</p>
        </div>

        <div class="about-section">
          <h3>10. Acceptable Use</h3>
          <p>Use the Site for lawful, personal, informational purposes. Don't:</p>
          <ul>
            <li>use it to break the law or trample on someone else's rights;</li>
            <li>try to disrupt, overload, or game the Site or the services it links to;</li>
            <li>scrape, mirror, or repackage the Site as your own;</li>
            <li>use AI Shortcuts or Prompt Builder to generate content that's illegal, harmful, harassing, or that violates the receiving AI provider's terms.</li>
          </ul>
        </div>

        <div class="about-section">
          <h3>11. No Warranties</h3>
          <p>The Site is provided "as is" and "as available," with no warranties of any kind, express or implied — including merchantability, fitness for a purpose, accuracy, or non-infringement. The Site might break, go down, or have bugs. There's no promise it'll be fixed.</p>
        </div>

        <div class="about-section">
          <h3>12. Limitation of Liability</h3>
          <p>To the fullest extent allowed by law, Standard Topic and its creator aren't liable for any indirect, incidental, special, consequential, or punitive damages — or lost data, revenue, or profits — from your use of the Site, any third-party service it links to, or any content (including AI output) you get through it. The Site is free; any direct liability is limited to what you paid to use it, which is nothing.</p>
        </div>

        <div class="about-section">
          <h3>13. Changes to These Terms</h3>
          <p>These terms can change. The "Last updated" date at the top reflects the current version. Continuing to use the Site after a change means you're good with the new version. Big changes get noted here — check back occasionally if you care.</p>
        </div>

        <div class="about-section">
          <h3>14. Stopping Use</h3>
          <p>No account, so "termination" just means you close the tab. The Site can be modified, paused, or shut down at any time, for any reason, without notice.</p>
        </div>

        <div class="about-section">
          <h3>15. Governing Law</h3>
          <p>These terms are governed by the laws applicable at the Site creator's place of residence, without regard to conflict-of-law rules. If any section turns out to be unenforceable, the rest still stands.</p>
        </div>

        <div class="about-section">
          <h3>16. Get in Touch</h3>
          <p>Questions about these terms, bug reports, or anything else about the Site — reach out through the creator's portfolio at <a href="https://johnchoud.com" target="_blank" rel="noopener noreferrer">johnchoud.com</a>.</p>
        </div>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="not-found">
      <h2>Page not found</h2>
      <p><a href="#/">Go home</a></p>
    </div>
  `;
}
