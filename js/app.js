import { initRouter, onRoute, getCurrentRoute, navigate as routerNavigate, routeHash, replaceRoute } from './utils/router.js?v=20260728-revamp667';
import { loadAllData, getTopicBySlug, getParentTopics, getFeaturedTopics, getSubtopics, getShortcutsForTopic, getRelatedTopics, getTopicsGroupedByParent, getAllShortcutIconKeys, getExternalSearches, getExternalSearchCategories, searchTopics, getModels, getDefaultModelId, getModelById, fetchWithTimeout } from './utils/data.js';
import { getPreferredModelId, setPreferredModelId, submitPrompt, openModel, copyPrompt } from './utils/ai-models.js?v=20260605-polish30';
import { assemblePrompt } from './utils/prompt-assembly.js';
import { REASONING_LEVELS, getReasoningLevel, getCustomInstructions } from './utils/settings.js';
import { renderIcon, preloadIcons, getIconEmoji } from './utils/icons.js';
import { topicIconSVG } from './utils/topic-icons.js?v=20260716-revamp588';
import { getTopicDescription } from './utils/topic-descriptions.js?v=20260706-revamp574';
import { renderSearchBar, initSearchOverlay } from './components/search-modal.js?v=20260728-revamp668';
import { renderNewsFeed, renderBriefBody, listHTML as newsListHTML, wireNewsAI } from './components/newsfeed.js?v=20260717-revamp591';
// prompt-generator (~127KB, Prompts flows only) is lazy-loaded via loadPromptGen() so it
// splits out of the initial bundle — see B3.4. (prompt-builder-modal.js was a retired
// no-op takeover; removed.)
import { initPromptModal } from './components/prompt-modal.js?v=20260706-revamp574';
import { renderTrending, renderTrendingHome, renderTrendingModal } from './components/trending.js?v=20260720-revamp609';
import { fetchTrending } from './utils/trending.js';
import { DEFAULT_GROUP_DEFS, groupShortcuts, renderTIAccordion, webSourceItem } from './components/ti-shortcuts.js';
import { initTrendingDetailModal } from './components/trending-detail-modal.js?v=20260706-revamp574';
import { initInsightModal } from './components/insight-modal.js?v=20260706-revamp574';
import { renderAIIntelligence } from './components/ai-intelligence.js?v=20260728-revamp667';
import { exploreFurtherHTML, wireExploreFurther } from './utils/explore-further.js?v=20260720-revamp609';
import { initAIIntelligenceModal } from './components/ai-intelligence-modal.js?v=20260717-revamp592';
import { renderWebSources } from './components/websources.js?v=20260706-revamp574';
import { initTrendingListModal } from './components/trending-list-modal.js?v=20260706-revamp574';
import { initRelatedTopicsModal } from './components/related-topics-modal.js';
import { initPromptPreviewModal } from './components/prompt-preview-modal.js?v=20260716-revamp588';
import { trackPageView, track } from './utils/analytics.js';

// Lazy-load the prompt-generator wizard (~127KB) only when a Prompts flow first opens,
// so esbuild splits it into its own chunk instead of the initial bundle (B3.4). The
// module is a singleton, so the import promise is cached after the first load.
let _promptGenModule = null;
function loadPromptGen() {
  return _promptGenModule || (_promptGenModule = import('./components/prompt-generator.js'));
}

document.addEventListener('DOMContentLoaded', async () => {
  // Boot must never leave a silent blank page: if the core data fetches fail
  // (bad deploy, CDN hiccup, offline), show a minimal reload fallback instead.
  try {
    await loadAllData();
  } catch (err) {
    console.error('boot: loadAllData failed', err);
    try { track('client_error', { where: 'boot', message: String(err && err.message || err).slice(0, 150) }); } catch (_) {}
    const content = document.getElementById('content') || document.body;
    content.innerHTML = `
      <div style="max-width:420px;margin:18vh auto 0;padding:0 24px;text-align:center;font-family:system-ui,sans-serif;">
        <h1 style="font-size:1.3rem;color:#1e2d44;margin-bottom:10px;">Something went wrong loading Standard Topic</h1>
        <p style="color:#718096;font-size:0.95rem;line-height:1.5;margin-bottom:20px;">A network hiccup stopped the site from starting. It's usually momentary.</p>
        <button type="button" id="boot-retry" style="padding:11px 26px;border:none;border-radius:999px;background:#1e2d44;color:#fff;font-size:0.95rem;font-weight:600;cursor:pointer;">Reload</button>
      </div>`;
    document.getElementById('boot-retry')?.addEventListener('click', () => window.location.reload());
    return;
  }
  // Apply per-group accent colors from data.assignments.groups so
  // admin-managed colors take effect at render time.
  applyGroupAccentColors();
  // Preload shortcut icon SVGs (non-blocking — renders emoji until resolved)
  preloadIcons(getAllShortcutIconKeys());
  initPromptModal();
  initScrollFades();
  initTrendingDetailModal();
  initInsightModal();
  // Trending list modal retired (Phase-5 follow-up) — "View more trending" /
  // open-trending-list now open the Trending nav dropdown instead (see below).
  // All Topics modal retired — every "All Topics" entry (picker action, search)
  // now opens the single clean Topics nav dropdown (see the listener below).
  initRelatedTopicsModal();
  initPromptPreviewModal();
  initSearchOverlay();
  initSearchPageModal();
  initAIIntelligenceModal();
  setupGlobalTabPillDelegation();
  wireSubnavPickerOutsideClose();

  // Trending is a dropdown now: every "View more trending" / open-trending-list
  // (and the retired detail modal's "back") opens the Trending nav dropdown.
  window.addEventListener('open-trending-list', (e) => openTrendingNavDropdown(e && e.detail && e.detail.expand));
  // All Topics is a dropdown now: every open-all-topics-modal dispatch (picker
  // "All Topics", search) opens the single clean Topics nav dropdown.
  window.addEventListener('open-all-topics-modal', () => openTopicsNavDropdown());

  // Esc closes the open nav dropdown (search/prompt also reset their deep-link
  // route). Skip when the Review & Submit dropdown is stacked on top — it
  // handles its own Esc first, so one press peels one layer.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !navDdOpen) return;
    if (document.querySelector('.prompt-modal-overlay.is-open')) return;
    userCloseNavDropdown();
  });

  // Stale-tab guard: a long-lived SPA tab never refetches assets on hash
  // navigation, so deploys land invisibly and the tab keeps running old CSS/JS
  // (the source of several "still broken" mysteries). Poll index.html for a newer
  // asset version and surface a one-tap refresh pill when this tab is outdated.
  // Version = the hashed bundle name (/dist/app.<hash>.js) post-B3.2, or the legacy
  // /js/app.js?v=<ver> form if serving unbundled. Match either.
  const _src = ((document.querySelector('script[type="module"]') || {}).src || '');
  const runningV = _src.match(/app\.([A-Za-z0-9]{6,})\.js/)?.[1] || _src.match(/app\.js\?v=([\w-]+)/)?.[1];
  const checkForNewVersion = async () => {
    if (!runningV || document.getElementById('st-update-pill')) return;
    try {
      const res = await fetch('/index.html', { cache: 'no-store' });
      if (!res.ok) return;
      const _html = await res.text();
      const v = _html.match(/dist\/app\.([A-Za-z0-9]{6,})\.js/)?.[1] || _html.match(/app\.js\?v=([\w-]+)/)?.[1];
      if (v && v !== runningV) {
        const b = document.createElement('button');
        b.id = 'st-update-pill'; b.type = 'button';
        b.textContent = 'Site updated — tap to refresh';
        b.addEventListener('click', () => window.location.reload());
        document.body.appendChild(b);
      }
    } catch (_) {}
  };
  setInterval(checkForNewVersion, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForNewVersion(); });
  setTimeout(checkForNewVersion, 20 * 1000);

  // Touch: clear lingering focus visuals after a tap. A tapped button/link keeps
  // :focus styling until the NEXT tap, which reads as a "phantom pressed" control
  // carrying over across views. Touch taps only — keyboard/mouse focus untouched,
  // and form fields are exempt so the on-screen keyboard never closes.
  document.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    setTimeout(() => {
      const el = document.activeElement;
      if (el && el !== document.body && !el.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) {
        try { el.blur(); } catch (_) {}
      }
    }, 150);
  }, { passive: true, capture: true });

  onRoute((route) => {
    // Per-route <title> (SEO 2a) — set before trackPageView so GA4 gets it too.
    try { document.title = documentTitleFor(route); } catch (_) {}
    // Nav dropdowns are transient overlays — close on any navigation. EXCEPTION:
    // the Search dropdown IS route-driven (#/search, #/custom) and updates its
    // own URL as the term changes, so keep it open across search routes. The
    // Prompt Builder dropdown is likewise route-driven (#/prompt-generator) and
    // may re-fire the route from a child picker — keep it too.
    const keepSearch = (route.type === 'search' || route.type === 'custom') && navDdOpen && navDdOpen.key === 'search';
    const keepPrompt = route.type === 'prompt-generator' && navDdOpen && navDdOpen.key === 'prompt';
    // Topics / Trending / Prompts dropdowns are route-driven too (#/topics,
    // #/trending, #/prompts[/view]) — keep each open across its own route (the
    // Prompts dropdown re-fires the route as its view changes).
    const keepDd = navDdOpen && route.type === navDdOpen.key && ['topics', 'trending', 'prompts'].includes(route.type);
    if (!keepSearch && !keepPrompt && !keepDd) closeNavDropdown();
    // Search (#/search) and Custom (#/custom/{term}) routes don't render
    // their own page — they open the Search modal over the home layout.
    const isSearchRoute = route.type === 'search' || route.type === 'custom';
    const isPromptRoute = route.type === 'prompt-generator';
    const isDdRoute = ['topics', 'trending', 'prompts'].includes(route.type);
    // These routes don't render their own page — they open a modal over home.
    const isOverlayRoute = isSearchRoute || isPromptRoute || isDdRoute;
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
    if (isPromptRoute) openPromptBuilderNavDropdown(); else closePromptBuilderNavDropdown();
    // Route-driven nav dropdowns (stale ones were already closed above).
    if (route.type === 'topics') openTopicsNavDropdown();
    else if (route.type === 'trending') openTrendingNavDropdown();
    else if (route.type === 'prompts') openPromptsNavDropdown(route.view);

    // Always refresh the bottom-nav active tab from the REAL route — overlay
    // routes (search/custom) skip renderLayout, so its internal call is missed.
    renderBottomNav(route);

    // Fire GA4 page_view after the DOM has the right document.title.
    trackPageView(routeHash() || '#/', document.title);
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
      // Re-render the FULL page, not just the chrome. renderLayout alone rebuilds
      // the sub-header (fresh path-tabs with no click handlers) while the old body
      // stays put — leaving the tabs dead and the wrong one lit (#132/#137). Also
      // refresh the subnav-height var after the DOM settles.
      if (route) {
        // Capture an OPEN news-story AI Insights panel (card URL + active tab) so we
        // can re-open it after the re-render — otherwise crossing the breakpoint
        // silently closed it (#img230).
        let openNews = null;
        try {
          const oc = document.querySelector('#section-newsfeed .news-card--open[data-url]');
          if (oc) openNews = { url: oc.dataset.url, tab: oc.querySelector('[data-news-panel-body] .ins-tab.is-active')?.textContent?.trim() || '' };
        } catch (_) {}
        // Preserve the topic page's active tab across the re-render: if the AI
        // Insights tab (+ a sub-group like Catch Up) is showing, seed pendingInlineAii
        // so the fresh render reopens it instead of snapping back to News Feed
        // (#img271/#img272). Only the AI tab needs this — News Feed is the default.
        try {
          if (route.type === 'topic' && route.slug) {
            const activePtab = document.querySelector('#topic-paths-nav .ptab.is-active');
            if (activePtab && activePtab.dataset.ptab === 'ai') {
              const sub = document.querySelector('.topic-ai-subnav .tai-tab.is-active');
              pendingInlineAii = { slug: route.slug, group: (sub && sub.dataset.tai) || 'discover' };
            } else if (activePtab && activePtab.dataset.ptab && activePtab.dataset.ptab !== 'news') {
              // Prompts / Explore Further survive the breakpoint crossing too —
              // only News Feed (the default) needs no seeding (#img626).
              pendingInlineAii = { slug: route.slug, group: activePtab.dataset.ptab };
            }
          }
        } catch (_) {}
        // Search / Custom / Prompt are OVERLAY routes with no page of their own —
        // rendering them directly as a page gives "Page not found" (#img211). Render
        // the base (home) beneath, exactly like the main route handler, then re-open
        // the overlay on top.
        const isOverlay = ['search', 'custom', 'prompt-generator', 'topics', 'trending', 'prompts'].includes(route.type);
        const base = isOverlay ? { type: 'home', slug: 'home', tab: 'newsfeed' } : route;
        // Preserve an OPEN subnav topic-picker across the breakpoint crossing — the
        // full re-render rebuilds the sub-header, which silently closed it (#img75).
        const pickerWasOpen = !!document.querySelector('#sub-header .topic-subnav-picker.is-open');
        renderLayout(base); renderPage(base);
        if (pickerWasOpen) {
          requestAnimationFrame(() => document.querySelector('#sub-header .topic-subnav-picker .tsp-btn')?.click());
        }
        if (route.type === 'search' || route.type === 'custom') {
          openSearchPageModal(route.type === 'custom' ? decodeURIComponent(route.term || '') : '');
        } else if (route.type === 'prompt-generator') {
          openPromptBuilderNavDropdown();
        } else if (route.type === 'topics') {
          openTopicsNavDropdown();
        } else if (route.type === 'trending') {
          openTrendingNavDropdown();
        } else if (route.type === 'prompts') {
          openPromptsNavDropdown(route.view);
        }
        if (openNews) {
          // Re-open after the fresh news feed settles; then restore the active tab.
          setTimeout(() => {
            let card = null;
            try { card = document.querySelector(`#section-newsfeed .news-card[data-url="${(window.CSS && CSS.escape) ? CSS.escape(openNews.url) : openNews.url}"]`); } catch (_) {}
            const aiBtn = card && card.querySelector('.news-act[data-news-panel="ai"]');
            if (aiBtn && card.dataset.url) {
              aiBtn.click();
              if (openNews.tab) setTimeout(() => {
                const t = [...card.querySelectorAll('.ins-tab')].find((x) => x.textContent.trim() === openNews.tab);
                if (t && !t.classList.contains('is-active')) t.click();
              }, 450);
            }
          }, 250);
        }
        requestAnimationFrame(setSubnavHeightVar);
      }
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
  // The grey identity bar height (topic page). The name-picker dropdown hangs off
  // THIS bar's bottom so it overlays the (lower-hierarchy) control tabs. Falls back
  // to the whole subnav where there's no separate control bar (home).
  const title = sub.querySelector('.topic-subnav-title');
  const th = title ? title.offsetHeight : h;
  if (th > 0) document.documentElement.style.setProperty('--subnav-title-h', `${th}px`);
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
// Small chevron for the "Change Topic" control (distinct class so it isn't hidden
// by the topic-name chevron's ≤560 rule).
const CHANGE_CHEV = '<svg class="tcb-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

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
  // Layout (#img71-74): actions row on TOP (View All Topics + Search Custom Topic,
  // left; ✕ right) over a faint separator, then a "{Parent} Topics" group label
  // (side-menu header style), then the grid with the PARENT PAGE FIRST followed by
  // its subtopics. No footer / bottom separator.
  return `
    <div class="tsp-panelwrap">
      <div class="tsp-panel" id="${escapeHTML(panelId)}" role="region" aria-label="Browse topics">
        <div class="tsp-panel-inner">
          <div class="tsp-actions">
            <a href="#" class="tsp-foot-btn" data-tsp-all>${GRID_IC}<span>View All Topics</span></a>
            <a href="#/search" class="tsp-foot-btn tsp-foot-btn--primary" data-tsp-search><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>Search Custom Topic</span></a>
            <button type="button" class="tsp-close tsp-close--row" data-tsp-close aria-label="Close">${X_IC}</button>
          </div>
          <div class="tsp-scroll">
            <div class="tsp-group-label">${escapeHTML(parent.name)} Topics</div>
            <div class="tsp-grid">${(() => {
              // ACTIVE page first, parent second (unless the parent IS active),
              // then the rest in their designated order (#img121).
              const rest = family.filter((t) => t.slug !== parent.slug && t.slug !== topic.slug);
              const lead = parentActive ? [parent] : [topic, parent];
              return lead.concat(rest).map(cellHTML).join('');
            })()}</div>
          </div>
        </div>
      </div>
    </div>`;
}

// Mobile subnav button + desktop on-scroll sticky bar trigger (icon + name + chevron).
function subnavPickerHTML(topic) {
  return `
    <div class="topic-subnav-picker" data-topic-picker>
      <button type="button" class="tsp-btn tsp-btn-browse" aria-expanded="false" aria-controls="tsp-panel-nav" aria-label="Change topic">
        <span class="tsp-btn-lead">
          <span class="tsp-btn-name">Change Topic</span>
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
      <button type="button" class="tsp-btn tsp-btn-browse" aria-expanded="false" aria-controls="tsp-panel-home">
        <span class="tsp-btn-lead">
          <span class="tsp-btn-name">Browse Topics</span>
        </span>
        ${TSP_CHEV}
      </button>
      <div class="tsp-panelwrap">
        <div class="tsp-panel" id="tsp-panel-home" role="region" aria-label="Browse topics">
          <div class="tsp-panel-inner">
            <div class="tsp-actions">
              <a href="#" class="tsp-foot-btn" data-tsp-all>${GRID_IC}<span>View All Topics</span></a>
              <a href="#/search" class="tsp-foot-btn tsp-foot-btn--primary" data-tsp-search><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>Search Custom Topic</span></a>
              <button type="button" class="tsp-close tsp-close--row" data-tsp-close aria-label="Close">${X_IC}</button>
            </div>
            <div class="tsp-scroll">
              <div class="tsp-group-label">Featured Topics</div>
              <div class="tsp-grid">${featured.map(cellHTML).join('')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

// Desktop body topic-header: the SAME compact subnav bar the mobile sticky
// header uses — an icon + topic name + chevron in a soft bar, whose dropdown
// holds the subtopics. No big title, no inline subtopic links (those live in the
// dropdown). The path controls sit in their own row below.
function topicBodyHeadHTML(topic) {
  return `
    <div class="topic-bodyhead topic-subnav-picker" data-topic-picker>
      <button type="button" class="tsp-btn tbh-bar" aria-expanded="false" aria-controls="tsp-panel-body" aria-label="Change topic">
        <span class="tsp-btn-lead">
          <span class="tsp-btn-ico">${topicIconSVG(topic.icon || 'globe', 'tsp-ic-svg')}</span>
          <span class="tsp-btn-name">${escapeHTML(topic.name)}</span>
        </span>
        ${TSP_CHEV}
      </button>
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
  { group: 'discover',       label: 'Catch Up' },
  { group: 'topic-specific', label: 'Deep Dive' },
  { group: 'learn',          label: '101 Info' },
  { group: 'websearch',      label: 'Web Search' },
  { group: 'external',       label: 'Prompts' },
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
  resetNavTriggers();
  navDdOpen = null;
}
// The nav dropdown triggers whose lit "active" pill must be mutually exclusive —
// exactly one (the open dropdown) lit at a time. Reset them ALL, not just the last
// tracked one, so no switch path can leave two pills lit (#img206/#img207).
const NAV_TRIGGER_IDS = ['nav-search', 'nav-topics', 'nav-trending', 'nav-prompts', 'sticky-nav-more'];
function resetNavTriggers() {
  NAV_TRIGGER_IDS.forEach((id) => document.getElementById(id)?.setAttribute('aria-expanded', 'false'));
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
  const hash = routeHash() || '';
  if (navDdOpen && navDdOpen.key === 'search') {
    const onSearchRoute = hash.startsWith('#/custom/') || hash === '#/search';
    closeNavDropdown();
    if (onSearchRoute) navigate('#/');
    return;
  }
  if (navDdOpen && navDdOpen.key === 'prompt') {
    const onPromptRoute = hash.startsWith('#/prompt-generator');
    closeNavDropdown();
    if (onPromptRoute) navigate('#/');
    return;
  }
  // Topics / Trending / Prompts: route-driven the same way — closing while on the
  // dropdown's own route returns home so the URL reflects the dismissal.
  if (navDdOpen && ['topics', 'trending', 'prompts'].includes(navDdOpen.key)) {
    const pfx = '#/' + navDdOpen.key;
    const onDdRoute = hash === pfx || hash.startsWith(pfx + '/');
    closeNavDropdown();
    if (onDdRoute) navigate('#/');
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
          ${Array.isArray(cfg.headButtons) && cfg.headButtons.length
            ? `<div class="aii-nav-dd-headbtns">${cfg.headButtons.map((b, i) => `<a href="${escapeAttr(b.href || '#')}" class="aii-nav-dd-headbtn${b.primary ? ' is-primary' : ''}" data-navdd-headbtn="${i}">${b.icon || ''}<span>${escapeHTML(b.label)}</span></a>`).join('')}</div>`
            : ''}
          ${cfg.headLink ? `<a href="${escapeAttr(cfg.headLink.href)}" class="aii-nav-dd-headlink" data-navdd-headlink><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>${escapeHTML(cfg.headLink.label)}</span></a>` : ''}
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
  // Head action buttons (e.g. Topics: Homepage · Search Custom Topic).
  if (Array.isArray(cfg.headButtons)) {
    panel.querySelectorAll('[data-navdd-headbtn]').forEach((el) => {
      const b = cfg.headButtons[Number(el.dataset.navddHeadbtn)];
      if (b && typeof b.onClick === 'function') el.addEventListener('click', (e) => { e.preventDefault(); b.onClick(); });
    });
  }
  overlay.onclick = closeFn;
  const sc = panel.querySelector('[data-navdd-scroll]');
  if (sc) sc.addEventListener('scroll', updateNavDdFades, { passive: true });
  if (typeof cfg.wire === 'function') cfg.wire(panel);
  panel.classList.add('is-open');
  overlay.classList.add('is-open');
  navDdOpen = { key: cfg.key, triggerId: cfg.triggerId };
  // Clear every trigger first (a direct open — e.g. the Search fix — doesn't route
  // through closeNavDropdown, so the previously-open trigger could stay lit), then
  // light only this one.
  resetNavTriggers();
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

const AIIDD_ARROW = '<svg class="aiidd-arrow" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';
// Icons for the Topics-dropdown head buttons (Homepage · Search Custom Topic).
const NAVDD_HOME_IC = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const NAVDD_SEARCH_IC = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

// ── The main-nav "Prompts" dropdown ──────────────────────────────────────────
// Two paths: "Build a Custom Prompt" (the prompt builder, inline) and "Prompt
// Library" (pick a topic → its ready-made prompts). Replaces the AI Insights
// nav dropdown — topic pages + custom search now cover AI Insights.
const PROMPTS_BACK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const PROMPTS_BUILD_IC = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const PROMPTS_LIB_IC = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
const AI_SPARK_INLINE = '<svg class="ph-spark" viewBox="0 0 24 24" width="13" height="13" fill="#2563eb" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg>';

// Prompt Library topic tree — accordions whose rows SELECT a topic (show its
// prompts inline) instead of navigating.
function promptLibTreeHTML() {
  const groups = getTopicsGroupedByParent() || [];
  const row = (t, all) => `<button type="button" class="${all ? 'aiidd-vall' : 'aiidd-vlink'} prompts-lib-topic" data-lib-topic data-slug="${escapeAttr(t.slug)}" data-name="${escapeAttr(t.name)}"><span class="aiidd-vlink-ic" aria-hidden="true">${topicIconSVG(t.icon || 'globe', '')}</span><span class="aiidd-vlink-name">${all ? `All ${escapeHTML(t.name)}` : escapeHTML(t.name)}</span>${all ? AIIDD_CHEV_R : ''}</button>`;
  const block = ({ parent, subtopics }) => {
    const subs = subtopics || [];
    return `<section class="aiidd-parent" data-open="false">
      <button type="button" class="aiidd-parent-head" data-aiidd-toggle aria-expanded="false">
        <span class="aiidd-parent-ic">${topicIconSVG(parent.icon || 'globe', 'tsp-ic-svg')}</span>
        <span class="aiidd-parent-name">${escapeHTML(parent.name)}</span>
        ${TSP_CHEV}
      </button>
      <div class="aiidd-parent-body"><div class="aiidd-vlist">${row(parent, true)}${subs.map((s) => row(s, false)).join('')}</div></div>
    </section>`;
  };
  return `<div class="aiidd-tree">${groups.map(block).join('')}</div>`;
}

function wirePromptsDropdown(panel, initialView) {
  const root = panel.querySelector('[data-prompts-root]');
  if (!root) return;
  // Keep the URL in step with the visible view (#/prompts · /build · /library) when
  // the dropdown is route-driven — replaceState so view switches don't re-render.
  const syncViewHash = (seg) => {
    const h = routeHash() || '';
    if (!(h === '#/prompts' || h.startsWith('#/prompts/'))) return;
    const target = seg ? `#/prompts/${seg}` : '#/prompts';
    if (h !== target) { try { replaceRoute(target); } catch (_) {} }
  };
  let ctl = null;
  const destroyCtl = () => { if (ctl && ctl.destroy) { try { ctl.destroy(); } catch (_) {} } ctl = null; };
  // The shell head IS the view header — update its title + subtitle per view so
  // there's no duplicate heading inside the body.
  const setHead = (title, sub) => {
    const t = panel.querySelector('.aii-nav-dd-title'); if (t) t.textContent = title;
    const s = panel.querySelector('.aii-nav-dd-sub'); if (s) s.textContent = sub;
  };
  const fades = () => [200, 700, 1500].forEach((d) => setTimeout(updateNavDdFades, d));
  // Back button lives ABOVE the view title (in the head), not below it in the body
  // (#img222/#img223/#img224). Pass null to remove it (the landing view).
  const setBack = (label, onClick) => {
    const titles = panel.querySelector('.aii-nav-dd-titles');
    if (!titles) return;
    titles.querySelector('[data-prompts-back]')?.remove();
    if (!label) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'prompts-back'; b.setAttribute('data-prompts-back', '');
    b.innerHTML = `${PROMPTS_BACK}<span>Back to ${escapeHTML(label)}</span>`;
    b.addEventListener('click', onClick);
    titles.insertBefore(b, titles.firstChild);
  };

  // Fire a ready-made prompt (featured card or a topic-card preview row) in the
  // prompt modal — same event path the rest of the site uses.
  const openShortcutPrompt = (s, topicName) => {
    if (!s || !s.prompt) return;
    window.dispatchEvent(new CustomEvent('open-prompt-modal', {
      detail: { basePrompt: s.prompt, topicName: topicName || '', name: s.name || 'Prompt', count: 1 },
    }));
  };

  // Per-topic preview cards (Card View): icon + name, first 3 prompts, View all.
  const topicCardsHTML = () => {
    const groups = getTopicsGroupedByParent() || [];
    const flat = [];
    groups.forEach(({ parent, subtopics }) => { flat.push(parent, ...(subtopics || [])); });
    const cards = flat.map((t) => {
      let sc = []; try { sc = (getShortcutsForTopic(t.slug) || []).filter((s) => s && s.name && s.prompt); } catch (_) {}
      if (!sc.length) return '';
      const rows = sc.slice(0, 3).map((s, i) =>
        `<button type="button" class="ph-card-prompt" data-ph-prompt data-slug="${escapeAttr(t.slug)}" data-i="${i}">${AI_SPARK_INLINE}<span>${escapeHTML(s.name)}</span></button>`).join('');
      return `<div class="ph-topic-card">
        <div class="ph-card-head"><span class="ph-card-ic">${topicIconSVG(t.icon || 'globe', 'tsp-ic-svg')}</span><span class="ph-card-name">${escapeHTML(t.name)}</span></div>
        <div class="ph-card-list">${rows}</div>
        <button type="button" class="ph-card-more" data-ph-more data-slug="${escapeAttr(t.slug)}" data-name="${escapeAttr(t.name)}">View all ${sc.length} prompts ${AIIDD_ARROW}</button>
      </div>`;
    }).join('');
    return `<div class="ph-topic-grid">${cards}</div>`;
  };

  const showLanding = () => {
    destroyCtl();
    setHead('Prompts', 'Ready-made prompts for every topic — or build your own.');
    setBack(null);
    const view = (localStorage.getItem('st_promptlib_view') === 'flat') ? 'flat' : 'cards';
    root.innerHTML = `
      <div class="prompts-home">
        <div class="ph-hero">
          <h2 class="ph-title">Ask better questions.</h2>
          <p class="ph-sub">Expert-built prompts for 100+ topics, ready to run in ChatGPT, Claude, Gemini and more.</p>
        </div>
        <button type="button" class="ph-build" data-prompt-build>
          <span class="ph-build-ic">${PROMPTS_BUILD_IC}</span>
          <span class="ph-build-tx"><span class="ph-build-title">Build a Custom Prompt</span><span class="ph-build-sub">Compose your own — topics, scope, output style &amp; citations</span></span>
          <span class="ph-build-go" aria-hidden="true">${AIIDD_ARROW}</span>
        </button>
        <section class="ph-featured" data-ph-featured hidden>
          <div class="ph-sec-head"><h3 class="ph-sec-title">Featured Prompts</h3></div>
          <div class="ph-feat-grid" data-ph-feat-grid></div>
        </section>
        <section class="ph-lib">
          <div class="ph-sec-head ph-sec-head--toggle">
            <h3 class="ph-sec-title">Browse by Topic</h3>
            <div class="ph-viewtoggle" role="tablist" aria-label="Library view">
              <button type="button" data-ph-view="cards" class="${view === 'cards' ? 'is-active' : ''}">Card View</button>
              <button type="button" data-ph-view="flat" class="${view === 'flat' ? 'is-active' : ''}">Flatten Topics</button>
            </div>
          </div>
          <div class="ph-body" data-ph-body></div>
        </section>
      </div>`;
    root.querySelector('[data-prompt-build]').addEventListener('click', showBuild);

    // Featured picks — data/featured-prompts.json (admin-editable), resolved
    // against the live shortcut assignments; missing names skip silently.
    fetchWithTimeout('/data/featured-prompts.json', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        const wrap = root.querySelector('[data-ph-feat-grid]');
        const sec = root.querySelector('[data-ph-featured]');
        if (!wrap || !sec || !cfg || !Array.isArray(cfg.featured)) return;
        const cards = cfg.featured.map((f, idx) => {
          const t = getTopicBySlug(f.topic); if (!t) return '';
          let sc = []; try { sc = getShortcutsForTopic(f.topic) || []; } catch (_) { return ''; }
          const s = sc.find((x) => x && x.name === f.name);
          if (!s || !s.prompt) return '';
          return `<button type="button" class="ph-feat-card" data-ph-feat="${idx}">
            <span class="ph-feat-topic">${topicIconSVG(t.icon || 'globe', 'ph-feat-topic-ic')}<span>${escapeHTML(t.name)}</span></span>
            <span class="ph-feat-name">${escapeHTML(s.name)}</span>
            ${s.description ? `<span class="ph-feat-desc">${escapeHTML(s.description)}</span>` : ''}
          </button>`;
        }).join('');
        if (!cards) return;
        wrap.innerHTML = cards;
        sec.hidden = false;
        wrap.querySelectorAll('[data-ph-feat]').forEach((b) => b.addEventListener('click', () => {
          const f = cfg.featured[Number(b.dataset.phFeat)]; if (!f) return;
          const t = getTopicBySlug(f.topic);
          let sc = []; try { sc = getShortcutsForTopic(f.topic) || []; } catch (_) {}
          openShortcutPrompt(sc.find((x) => x && x.name === f.name), t ? t.name : '');
        }));
        requestAnimationFrame(updateNavDdFades);
      }).catch(() => {});

    // Library body — Card View / Flatten Topics toggle (persisted).
    const body = root.querySelector('[data-ph-body]');
    const renderView = (v) => {
      if (v === 'flat') {
        body.innerHTML = `<div class="prompts-lib" data-lib>${promptLibTreeHTML()}</div>`;
        const lib = body.querySelector('[data-lib]');
        wireNavDdAccordions(lib);
        lib.querySelectorAll('[data-lib-topic]').forEach((b) => b.addEventListener('click', () => showTopicPrompts(b.dataset.slug, b.dataset.name)));
      } else {
        body.innerHTML = topicCardsHTML();
        body.querySelectorAll('[data-ph-prompt]').forEach((b) => b.addEventListener('click', () => {
          let sc = []; try { sc = (getShortcutsForTopic(b.dataset.slug) || []).filter((s) => s && s.name && s.prompt); } catch (_) {}
          const t = getTopicBySlug(b.dataset.slug);
          openShortcutPrompt(sc[Number(b.dataset.i)], t ? t.name : '');
        }));
        body.querySelectorAll('[data-ph-more]').forEach((b) => b.addEventListener('click', () => showTopicPrompts(b.dataset.slug, b.dataset.name)));
      }
      requestAnimationFrame(updateNavDdFades);
    };
    root.querySelectorAll('[data-ph-view]').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll('[data-ph-view]').forEach((x) => x.classList.toggle('is-active', x === b));
      try { localStorage.setItem('st_promptlib_view', b.dataset.phView); } catch (_) {}
      renderView(b.dataset.phView);
    }));
    renderView(view);
    syncViewHash(null);
    requestAnimationFrame(updateNavDdFades);
  };

  const showBuild = () => {
    destroyCtl();
    setHead('Build a Custom Prompt', 'Craft a knowledge prompt and send it to your AI model.');
    setBack('Prompts Overview', showLanding);
    root.innerHTML = `<div class="pb-navdd-host" data-pb-host></div>`;
    loadPromptGen().then((m) => m.renderPromptGenerator(root.querySelector('[data-pb-host]'), { inline: true })).catch(() => {});
    syncViewHash('build');
    fades();
  };

  const showLibrary = () => {
    destroyCtl();
    setHead('Prompt Library', 'Pick a topic to see its ready-made prompts.');
    setBack('Prompts Overview', showLanding);
    root.innerHTML = `<div class="prompts-lib" data-lib>${promptLibTreeHTML()}</div>`;
    const lib = root.querySelector('[data-lib]');
    wireNavDdAccordions(lib);
    lib.querySelectorAll('[data-lib-topic]').forEach((b) => b.addEventListener('click', () => showTopicPrompts(b.dataset.slug, b.dataset.name)));
    syncViewHash('library');
    requestAnimationFrame(updateNavDdFades);
  };

  const showTopicPrompts = (slug, name) => {
    destroyCtl();
    setHead(`${name} Prompts`, 'Ready-made prompts for this topic. Pick one to expand and copy it.');
    // prompts-topic-host → CSS hides the mounted AI component's own chrome so ONLY
    // the clean prompt list shows.
    setBack('Prompt Library', showLibrary);
    root.innerHTML = `<div class="pb-navdd-host prompts-topic-host" data-pb-host></div>`;
    let shortcuts = []; try { shortcuts = getShortcutsForTopic(slug) || []; } catch (_) {}
    const descriptions = {}; const icons = {};
    try { shortcuts.forEach((s) => { if (s && s.name) { descriptions[s.name] = s.description || ''; icons[s.name] = s.icon || ''; } }); } catch (_) {}
    const t = getTopicBySlug(slug); const label = t ? t.name : name;
    ctl = renderAIIntelligence(root.querySelector('[data-pb-host]'), {
      inModal: true, initialBuilder: true, initialGroup: 'external', lockTopic: true,
      sectionAccordions: true,
      topic: label, label, descriptions, icons, shortcuts, topicKey: slug,
    });
    fades();
  };

  // Expose the view switcher for route changes while mounted, then show the
  // requested initial view (a #/prompts/build|library deep-link) or the landing.
  promptsDdShowView = (v) => { if (v === 'build') showBuild(); else if (v === 'library') showLibrary(); else showLanding(); };
  promptsDdShowView(initialView || null);
}

function promptsNavDdCfg(view) {
  return {
    key: 'prompts', triggerId: 'nav-prompts', className: 'aii-nav-dd-prompts',
    title: 'Prompts', ariaLabel: 'Prompts',
    subtitle: 'Build your own or browse the ready-made library.',
    contentHTML: '<div class="prompts-dd" data-prompts-root></div>',
    onClose: userCloseNavDropdown,
    wire: (panel) => wirePromptsDropdown(panel, view),
  };
}
// View switcher exposed while the Prompts dropdown is mounted, so a route change
// (#/prompts ↔ /build ↔ /library, e.g. via back/forward) swaps views in place.
let promptsDdShowView = null;
function openPromptsNavDropdown(view) {
  if (navDdOpen && navDdOpen.key === 'prompts') { if (promptsDdShowView) promptsDdShowView(view || null); return; }
  openNavDropdown(promptsNavDdCfg(view || null));
}
// Route-driven toggle shared by the three deep-linkable dropdowns: open → close
// (returning home if on the route); closed → navigate to the route (or open
// directly when the hash is already there, where navigate() would no-op).
function navDdRouteToggle(key, openFn) {
  if (navDdOpen && navDdOpen.key === key) { userCloseNavDropdown(); return; }
  const target = '#/' + key;
  const h = routeHash() || '';
  if (h === target || h.startsWith(target + '/')) openFn();
  else navigate(target);
}
function togglePromptsNavDropdown() {
  navDdRouteToggle('prompts', () => {
    const h = routeHash() || '';
    openPromptsNavDropdown(h.startsWith('#/prompts/') ? h.slice('#/prompts/'.length) : null);
  });
}

// ── Phase 5: the main-nav "Topics" topic-tree dropdown ───────────────────────
// Same accordion shell, but the rows are plain topic links (no AI track chips):
// a flat "All {parent}" link + each subtopic. Replaces the All Topics modal.
const AIIDD_CHEV_R = '<svg class="aiidd-vall-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';
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
    // Clean vertical list: a prominent "All {Parent} ›" link, then each subtopic
    // on its own row. No count badge.
    const links = `<a href="#/topic/${parent.slug}" class="aiidd-vall" data-aiidd-link><span class="aiidd-vlink-ic" aria-hidden="true">${topicIconSVG(parent.icon || 'globe', '')}</span><span class="aiidd-vlink-name">All ${escapeHTML(parent.name)}</span>${AIIDD_CHEV_R}</a>`
      + subs.map((s) => `<a href="#/topic/${s.slug}" class="aiidd-vlink" data-aiidd-link><span class="aiidd-vlink-ic" aria-hidden="true">${topicIconSVG(s.icon || 'globe', '')}</span><span class="aiidd-vlink-name">${escapeHTML(s.name)}</span></a>`).join('');
    return `<section class="aiidd-parent" data-open="false">
      <button type="button" class="aiidd-parent-head" data-aiidd-toggle aria-expanded="false">
        <span class="aiidd-parent-ic">${topicIconSVG(parent.icon || 'globe', 'tsp-ic-svg')}</span>
        <span class="aiidd-parent-name">${escapeHTML(parent.name)}</span>
        ${TSP_CHEV}
      </button>
      <div class="aiidd-parent-body"><div class="aiidd-vlist">${links}</div></div>
    </section>`;
  };
  return `<div class="aiidd-tree">${groups.map(block).join('')}</div>`;
}
function topicsNavDdCfg() {
  return {
    key: 'topics', triggerId: 'nav-topics',
    title: 'All Topics', ariaLabel: 'All topics',
    subtitle: 'Browse every topic and its subtopics.',
    // One head button: Search Custom Topic (the Homepage button was dropped — the
    // brand/Home nav already covers it, #img77).
    headButtons: [
      { label: 'Search Custom Topic', href: '#/search', primary: true, icon: NAVDD_SEARCH_IC, onClick: () => { openSearchFromNav(); } },
    ],
    contentHTML: topicsTreeHTML(),
    onClose: userCloseNavDropdown,
    wire: (panel) => {
      wireNavDdAccordions(panel);
      panel.querySelectorAll('[data-aiidd-link]').forEach((a) => a.addEventListener('click', () => closeNavDropdown()));
    },
  };
}
function toggleTopicsNavDropdown() { navDdRouteToggle('topics', openTopicsNavDropdown); }
function openTopicsNavDropdown() { if (!(navDdOpen && navDdOpen.key === 'topics')) openNavDropdown(topicsNavDdCfg()); }

// ── Phase 5: the main-nav "Trending" dropdown ────────────────────────────────
// Hosts renderTrendingModal (AI-legend sub-bar + live trend-card grid). Cards
// expand their brief IN PLACE inside the dropdown (inline:true) — no detail
// modal. "View more trending" everywhere routes here (open-trending-list).
function trendingNavDdCfg(expandQuery) {
  return {
    key: 'trending', triggerId: 'nav-trending', className: 'aii-nav-dd-trending',
    title: 'Trending', ariaLabel: 'Trending now',
    subtitle: "What's being searched for right now.",
    subBarHTML: '<div class="tlm-controlbar" data-trend-controls></div>',
    contentHTML: '<div data-trend-grid></div>',
    onClose: userCloseNavDropdown,
    wire: (panel) => {
      const controls = panel.querySelector('[data-trend-controls]');
      const grid = panel.querySelector('[data-trend-grid]');
      try { renderTrendingModal(controls, grid, { inline: true, expandQuery }); } catch (_) {}
      grid.addEventListener('click', () => { [60, 260].forEach((d) => setTimeout(updateNavDdFades, d)); });
      [350, 900, 1800].forEach((d) => setTimeout(updateNavDdFades, d));
    },
  };
}
function toggleTrendingNavDropdown() { navDdRouteToggle('trending', () => openTrendingNavDropdown()); }
function openTrendingNavDropdown(expandQuery) {
  if (navDdOpen && navDdOpen.key === 'trending' && !expandQuery) return;
  openNavDropdown(trendingNavDdCfg(expandQuery));
}

// ── Phase 6: the Prompt Builder dropdown ─────────────────────────────────────
// Route-driven (#/prompt-generator), like Search: hosts the existing
// renderPromptGenerator wizard inside the shared full-width dropdown instead of
// a centered takeover. No dedicated nav button — launched from the hamburger /
// homepage links / the route.
function isPromptBuilderOpen() {
  const panel = document.getElementById('st-nav-panel');
  return !!(panel && panel.classList.contains('is-open') && navDdOpen && navDdOpen.key === 'prompt');
}
function openPromptBuilderNavDropdown() {
  // Route can re-fire while already open (a child picker navigates) — don't tear
  // down the in-progress builder.
  if (isPromptBuilderOpen()) return;
  openNavDropdown({
    key: 'prompt', triggerId: null, className: 'aii-nav-dd-prompt',
    title: 'Prompt Builder', ariaLabel: 'Prompt Builder',
    subtitle: 'Build a knowledge prompt and send it to your AI model.',
    contentHTML: '<div class="pb-navdd-host" data-pb-host></div>',
    onClose: userClosePromptBuilder,
    wire: (panel) => {
      loadPromptGen().then((m) => m.renderPromptGenerator(panel.querySelector('[data-pb-host]'), { inline: true }));
      [200, 700, 1500].forEach((d) => setTimeout(updateNavDdFades, d));
    },
  });
}
function closePromptBuilderNavDropdown() { if (isPromptBuilderOpen()) closeNavDropdown(); }
// ✕ / overlay / Esc: close and, on the #/prompt-generator deep-link, return home.
function userClosePromptBuilder() {
  const onRoute = (routeHash() || '').startsWith('#/prompt-generator');
  closePromptBuilderNavDropdown();
  if (onRoute) navigate('#/');
}

// The topic page's tabbed "Paths" package: News first, then the five AI tracks.
// Topic page: a TWO-item control subnav (revamp453). "AI Insights & Resources"
// then reveals four sub-options in its own strip.
const TOPIC_PATH_TABS = [
  { key: 'news', label: 'News Feed' },
  { key: 'ai',   label: 'AI Insights' },
  { key: 'prompts', label: 'Prompts' },
  { key: 'explore', label: 'Explore Further' },
];
// Sub-options under "AI Insights" (Prompts moved out to its own top-level tab).
const TOPIC_AI_GROUPS = [
  { key: 'discover',       label: 'Catch Up' },
  { key: 'topic-specific', label: 'Deep Dive' },
  { key: 'learn',          label: '101 Info' },
];
const TOPIC_AI_GROUP_KEYS = new Set(TOPIC_AI_GROUPS.map((g) => g.key));

// Wire the topic-page control subnav: News Feed → the news feed; AI Insights &
// Resources → a second-level sub-strip (Catch Up / Deep Dive / 101 Info / Prompts),
// each mounting that group's builder. Also drives deep-links from the nav dropdown.
function wireTopicPathTabs(container, topic, descriptions, icons) {
  const nav = document.getElementById('topic-paths-nav');
  const body = container.querySelector('#topic-tab-body');
  if (!nav || !body) return;
  let active = null; let ctl = null; let subGroup = 'discover';

  // L1 active indicator: a single underline BAR that slides between News Feed /
  // AI Insights / Prompt Library on selection (instead of a filled pill, #img598).
  const ptabBar = document.createElement('span');
  ptabBar.className = 'ptab-underline';
  ptabBar.setAttribute('aria-hidden', 'true');
  nav.appendChild(ptabBar);
  const placePtabBar = () => {
    const act = nav.querySelector('.ptab.is-active');
    if (!act) { ptabBar.style.width = '0px'; return; }
    ptabBar.style.left = `${act.offsetLeft}px`;
    ptabBar.style.width = `${act.offsetWidth}px`;
    // Hug the WORD (a true text underline), not the row's bottom edge (#img602).
    ptabBar.style.top = `${act.offsetTop + act.offsetHeight - 4}px`;
  };
  // Tight-fit fallback (#img625): when the four tabs overflow the row, first
  // drop the type a notch (.ptabs-compact), then shorten "News Feed"→"News",
  // and worst-case "Explore Further"→"Explore". Fully reversible on resize.
  const PTAB_FULL = { news: 'News Feed', explore: 'Explore Further' };
  const PTAB_SHORT = { news: 'News', explore: 'Explore' };
  const fitPtabs = () => {
    nav.classList.remove('ptabs-compact');
    Object.keys(PTAB_FULL).forEach((k) => {
      const b = nav.querySelector(`.ptab[data-ptab="${k}"]`);
      if (b && b.textContent !== PTAB_FULL[k]) b.textContent = PTAB_FULL[k];
    });
    const fits = () => nav.scrollWidth <= nav.clientWidth + 1;
    if (!fits()) nav.classList.add('ptabs-compact');
    if (!fits()) { const b = nav.querySelector('.ptab[data-ptab="news"]'); if (b) b.textContent = PTAB_SHORT.news; }
    if (!fits()) { const b = nav.querySelector('.ptab[data-ptab="explore"]'); if (b) b.textContent = PTAB_SHORT.explore; }
    placePtabBar();
  };
  window.addEventListener('resize', fitPtabs);
  requestAnimationFrame(fitPtabs);

  const destroyCtl = () => { if (ctl && ctl.destroy) { try { ctl.destroy(); } catch (_) {} } ctl = null; };
  const mountGroup = (subBody, gkey) => {
    destroyCtl();
    subBody.innerHTML = '';
    let shortcuts = [];
    try { shortcuts = getShortcutsForTopic(topic.slug) || []; } catch (_) {}
    ctl = renderAIIntelligence(subBody, {
      inModal: true, initialBuilder: true, initialGroup: gkey, lockTopic: true,
      topic: topic.name, label: topic.name, descriptions, icons, shortcuts, topicKey: topic.slug,
    });
  };
  const renderAI = () => {
    body.innerHTML = `<div class="topic-ai-wrap">
      <div class="aii-tabhead topic-ai-head">
        <p class="aii-tabhead-tx">AI-generated briefings to get caught up, go deeper or start with the basics.</p>
      </div>
      <nav class="topic-ai-subnav" role="tablist" aria-label="AI Insights sections">${TOPIC_AI_GROUPS.map((g) => `<button type="button" class="tai-tab${g.key === subGroup ? ' is-active' : ''}" role="tab" data-tai="${escapeAttr(g.key)}" aria-selected="${g.key === subGroup ? 'true' : 'false'}">${escapeHTML(g.label)}</button>`).join('')}</nav>
      <div class="topic-ai-body" id="topic-ai-body"></div>
    </div>`;
    const subBody = body.querySelector('#topic-ai-body');
    const subNav = body.querySelector('.topic-ai-subnav');
    // Sticky Catch Up row: the header scrolls away and the row pins on the way
    // down; on the way back up it un-sticks natively as the header returns. Cast
    // the drop shadow ONLY while stuck (header out of view) and fade it, so the
    // transition in/out reads smooth rather than a hard snap (#img651).
    const aiHead = body.querySelector('.topic-ai-head');
    try { if (window.__aiHeadIO) window.__aiHeadIO.disconnect(); } catch (_) {}
    const aiScroller = document.querySelector('#content');
    if (aiHead && subNav && aiScroller && 'IntersectionObserver' in window) {
      window.__aiHeadIO = new IntersectionObserver(([e]) => {
        subNav.classList.toggle('is-stuck', e.intersectionRatio <= 0.01);
      }, { root: aiScroller, threshold: [0, 0.01, 1] });
      window.__aiHeadIO.observe(aiHead);
    }
    const selectSub = (gkey) => {
      if (!TOPIC_AI_GROUP_KEYS.has(gkey)) gkey = 'discover';
      subGroup = gkey;
      subNav.querySelectorAll('.tai-tab').forEach((b) => { const on = b.dataset.tai === gkey; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)); });
      mountGroup(subBody, gkey);
      requestAnimationFrame(() => { try { window.scrollTo({ top: 0 }); } catch (_) {} });
    };
    subNav.querySelectorAll('.tai-tab').forEach((b) => b.addEventListener('click', () => selectSub(b.dataset.tai)));
    selectSub(subGroup);
  };
  const renderContent = (key) => {
    destroyCtl();
    body.innerHTML = '';
    try {
      if (key === 'news') {
        // Column wrapper so the news content fills the row — #topic-tab-body is a
        // flex row (#img652). No page header on News Feed: title/topic/subtext all
        // dropped, the feed sits straight under the L1 tab bar.
        const wrap = document.createElement('div');
        wrap.className = 'topic-news-wrap';
        const sec = document.createElement('section');
        sec.id = 'section-newsfeed'; sec.className = 'layout-section';
        wrap.appendChild(sec);
        body.appendChild(wrap);
        renderNewsFeed(sec, topic, false);
        return;
      }
      if (key === 'explore') {
        // Explore Further is a first-class L1 tab now (#img619) — the shared
        // AI-models + web-sources explorer, headed like the Prompt Library sections.
        const host = document.createElement('div');
        host.className = 'topic-explore-host';
        body.appendChild(host);
        const efPrompt = `Give me a thorough, current briefing on ${topic.name}. Be specific and cite sources.`;
        // Page header (main = tab title, subheader = topic, subtext), matching the
        // Prompts tab (#img650). Subtext rewritten without the em-dash.
        // Intro text + separator dropped (#img74): the accordion headers carry the
        // explanation; a top spacer keeps breathing room below the subnav.
        const efHead = `<div class="aii-tabhead-spacer"></div>`;
        // Grey-band section header matching the Prompts tab (.aii-secacc): title +
        // subtext atop the clipped accordion card, open by default and collapsible.
        const EF_CHEV = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
        const efBody = exploreFurtherHTML({ prompt: efPrompt, webTerm: topic.name, name: topic.name });
        const efSec = `<details class="aii-secacc ef-secacc" open><summary class="aii-secacc-sum"><span class="aii-secacc-tx"><span class="aii-secacc-title">AI Models &amp; Web Sources</span><span class="aii-secacc-sub">External AI models plus web sources across search, social, video and fact-checking.</span></span><span class="aii-secacc-chev">${EF_CHEV}</span></summary><div class="aii-secacc-body">${efBody}</div></details>`;
        host.innerHTML = efHead + efSec;
        wireExploreFurther(host);
        return;
      }
      if (key === 'prompts') {
        // Prompt Library tab: the topic's ready-made prompts split into Topic-Specific
        // + Evergreen accordions. Reuses the AI component's external (prompts) group;
        // the host class hides its builder chrome so only the clean library shows.
        const host = document.createElement('div');
        host.className = 'topic-prompt-lib-host prompts-topic-host';
        body.appendChild(host);
        let shortcuts = [];
        try { shortcuts = getShortcutsForTopic(topic.slug) || []; } catch (_) {}
        ctl = renderAIIntelligence(host, {
          inModal: true, initialBuilder: true, initialGroup: 'external', lockTopic: true,
          sectionAccordions: true,
          topic: topic.name, label: topic.name, descriptions, icons, shortcuts, topicKey: topic.slug,
        });
        return;
      }
      renderAI();
    } catch (err) {
      // A render throw must never leave a blank/broken tab (was the "nothing
      // occurs" #137). Show a retry instead so a re-click always re-renders.
      console.error('topic tab render failed', err);
      body.innerHTML = '<div class="aii-empty" style="padding:26px 4px;color:var(--color-text-muted);">Couldn’t load this section. Tap the tab again to retry.</div>';
    }
  };
  const selectTab = (key) => {
    // Prompts moved to its own top-level tab — route the old 'external' group there.
    if (key === 'external') key = 'prompts';
    // A group key (from a deep-link) opens AI Insights on that sub-group.
    else if (TOPIC_AI_GROUP_KEYS.has(key)) { subGroup = key; key = 'ai'; }
    else if (key === 'websearch') { subGroup = 'discover'; key = 'ai'; }
    if (!TOPIC_PATH_TABS.some((t) => t.key === key)) key = 'news';
    nav.querySelectorAll('.ptab').forEach((b) => {
      const on = b.dataset.ptab === key;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    placePtabBar();
    // Is this tab's content ACTUALLY present? (Not just "we set active last time" —
    // a prior render may have failed, leaving it blank.) Only skip the re-render
    // when the content is really there.
    const present = key === 'news' ? body.querySelector('#section-newsfeed')
      : key === 'prompts' ? body.querySelector('.topic-prompt-lib-host')
      : key === 'explore' ? body.querySelector('.topic-explore-host')
      : body.querySelector('.topic-ai-wrap');
    const same = active === key;
    active = key;
    if (same && present) {
      if (key === 'ai') {
        const subNav = body.querySelector('.topic-ai-subnav');
        if (subNav) { subNav.querySelectorAll('.tai-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tai === subGroup)); mountGroup(body.querySelector('#topic-ai-body'), subGroup); }
      }
      return;
    }
    renderContent(key);
    requestAnimationFrame(() => { try { window.scrollTo({ top: 0 }); } catch (_) {} });
  };
  // Keep the URL in sync with the active L1 tab so each tab is deep-linkable:
  // #/topic/{slug} (News Feed, the default) · /ai-insights · /prompts · /explore.
  // replaceState (no hashchange) so tab clicks don't re-render the page.
  const TAB_URL_SEG = { ai: 'ai-insights', prompts: 'prompts', explore: 'explore' };
  const syncTabHash = (key) => {
    if (!(routeHash() || '').startsWith('#/topic/')) return;
    const seg = TAB_URL_SEG[key];
    const newHash = seg ? `#/topic/${topic.slug}/${seg}` : `#/topic/${topic.slug}`;
    if (routeHash() !== newHash) {
      try { replaceRoute(newHash); } catch (_) {}
      const r = getCurrentRoute();
      if (r && r.type === 'topic') r.tab = seg || 'newsfeed';
      // Keep the <title> in step with the active tab (SEO 2a).
      try { document.title = documentTitleFor({ type: 'topic', slug: topic.slug, tab: seg || 'newsfeed' }); } catch (_) {}
    }
  };
  const selectTabAndSync = (key) => { selectTab(key); syncTabHash(active); };
  nav.querySelectorAll('.ptab').forEach((b) => b.addEventListener('click', () => selectTabAndSync(b.dataset.ptab)));

  // Deep-link from the AI Insights nav dropdown (same-page event + cross-page
  // pending request) → open the matching sub-group.
  if (window.__aiiInlineHandler) window.removeEventListener('aii-inline-open', window.__aiiInlineHandler);
  window.__aiiInlineHandler = (e) => { if (e.detail && e.detail.slug === topic.slug) selectTabAndSync(e.detail.group); };
  window.addEventListener('aii-inline-open', window.__aiiInlineHandler);

  // Initial tab: a URL deep-link (#/topic/{slug}/{ai-insights|prompts|explore})
  // seeds it; a pending in-app deep-link (nav dropdown / breakpoint re-render) wins.
  const URL_SEG_TAB = { 'ai-insights': 'ai', prompts: 'prompts', explore: 'explore' };
  let initial = 'news';
  const curRoute = getCurrentRoute();
  if (curRoute && curRoute.type === 'topic' && curRoute.slug === topic.slug && URL_SEG_TAB[curRoute.tab]) initial = URL_SEG_TAB[curRoute.tab];
  if (pendingInlineAii && pendingInlineAii.slug === topic.slug) { initial = pendingInlineAii.group; pendingInlineAii = null; }
  selectTabAndSync(initial);
}

function closeAllPickers(except) {
  document.querySelectorAll('.topic-subnav-picker.is-open').forEach((p) => {
    if (p === except) return;
    p.classList.remove('is-open');
    p.querySelector('.tsp-btn')?.setAttribute('aria-expanded', 'false');
  });
}

// Home reset — used by the site title + the Home nav icon. Navigates home and
// tears down every open overlay (nav dropdown, modals, topic pickers) so home is
// always a clean slate (#img10).
function resetToHome(e) {
  if (e) e.preventDefault();
  window.dispatchEvent(new CustomEvent('close-all-modals'));
  try { closeNavDropdown(); } catch (_) {}
  try { closeAllPickers(); } catch (_) {}
  const h = routeHash() || '';
  if (h === '#/' || h === '' || h === '#') {
    try { window.scrollTo(0, 0); } catch (_) {}
  } else {
    navigate('#/');
  }
}

// Toggle the topic-picker panel's bottom scroll hint. The scroll area is .tsp-scroll
// (the subtopic list); .has-more drives the faint down-arrow above the sticky footer.
function updatePickerFades(picker) {
  const scroll = picker.querySelector('.tsp-scroll');
  const inner = picker.querySelector('.tsp-panel-inner');
  if (!scroll || !inner) return;
  const top = scroll.scrollTop;
  const max = scroll.scrollHeight - scroll.clientHeight;
  inner.classList.toggle('has-more', max > 6 && top < max - 4);
  inner.classList.toggle('scrolled', top > 4);
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
      // Re-check after the open (grid-rows) transition settles — at rAF the panel
      // isn't laid out yet, so the scroll height reads 0 and the arrow never shows.
      if (on) { requestAnimationFrame(() => { updatePickerFades(picker); fitGridCols(); }); setTimeout(() => { updatePickerFades(picker); fitGridCols(); }, 320); }
    };
    // Top/bottom fades on the (capped) panel scroll area — shown only when there's
    // hidden content above/below.
    const scrollEl = picker.querySelector('.tsp-scroll');
    if (scrollEl) scrollEl.addEventListener('scroll', () => updatePickerFades(picker), { passive: true });
    // Responsive column control with an overflow layer (#img75): topic names stay on
    // ONE line (nowrap). Start from the CSS-derived column count, then drop columns
    // until no name overflows its cell — so long names trigger the next column
    // breakpoint EARLIER than the width breakpoints alone would.
    const fitGridCols = () => {
      const grid = picker.querySelector('.tsp-grid');
      if (!grid || !grid.offsetParent) return;
      grid.style.gridTemplateColumns = '';                       // reset → CSS decides base count
      let cols = (getComputedStyle(grid).gridTemplateColumns || '').split(' ').filter(Boolean).length || 1;
      const overflows = () => [...grid.querySelectorAll('.tsp-cell-name')]
        .some((n) => n.scrollWidth > n.clientWidth + 1);
      let guard = 8;
      while (cols > 1 && overflows() && guard--) {
        cols -= 1;
        grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      }
    };
    window.addEventListener('resize', () => { if (picker.classList.contains('is-open')) requestAnimationFrame(fitGridCols); }, { passive: true });
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
    picker.querySelectorAll('.tsp-cell, .tsp-parent-row, .tsp-parent-hub, [data-tsp-home]').forEach((a) =>
      a.addEventListener('click', () => setOpen(false)));
    picker.querySelector('[data-tsp-all]')?.addEventListener('click', (e) => {
      e.preventDefault();
      setOpen(false);
      window.dispatchEvent(new CustomEvent('open-all-topics-modal'));
    });
    picker.querySelector('[data-tsp-search]')?.addEventListener('click', (e) => {
      e.preventDefault();
      setOpen(false);
      navigate('#/search');
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
  document.body.classList.remove('sticky-always', 'has-subnav', 'home-mode', 'show-subnav-tabs', 'app-mode', 'custom-mode', 'home-search', 'home-subnav-on');

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
    // home-mode also on #sub-header so the many `#sub-header...:not(.home-mode)` topic
    // rules (which check the class on the wrong element) correctly skip the home subnav.
    subHeader.classList.add('is-subnav', 'home-mode');

    // Homepage now uses the SAME dropdown picker as topic pages (#88) — a "Home"
    // label whose dropdown lists the featured topics (replaces the old chip row).
    subHeader.innerHTML = `
      <div class="topic-banner">
        <div class="topic-banner-row topic-banner-row--home-picker">
          <div class="subnav-ident">
            <span class="subnav-ident-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/></svg></span>
            <span class="subnav-ident-name">Home</span>
          </div>
          <span class="subnav-ident-sep" aria-hidden="true"></span>
          ${homeSubnavPickerHTML()}
        </div>
      </div>
    `;
    wireSubnavPicker(subHeader);
    setupHomeSubnavReveal();

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
    // The topic subnav is ONE cohesive sticky unit at every width (revamp440):
    // the topic-name picker bar on top, then the path tabs (News · Catch Up · …)
    // directly below it — both living in the fixed #sub-header so they read as a
    // true subnav under the main nav (not a boxed section floating in the body).
    // Two connected bars (revamp453): a GREY identity bar (topic icon + name +
    // dropdown arrow — styled like the homepage bar) on top, then a WHITE control
    // bar (News Feed | AI Insights) below it. The name-picker dropdown hangs off
    // the grey bar and OVERLAYS the control bar (controls are lower in hierarchy).
    subHeader.innerHTML = `
      <div class="topic-subnav-title">
        <div class="topic-subnav-inner">
          <div class="subnav-ident">
            <span class="subnav-ident-ico">${topicIconSVG(topic.icon || 'globe', '')}</span>
            <span class="subnav-ident-name">${escapeHTML(topic.name)}</span>
          </div>
          <span class="subnav-ident-sep" aria-hidden="true"></span>
          ${subnavPickerHTML(topic)}
        </div>
      </div>
      <div class="topic-subnav-controls">
        <nav class="topic-paths-nav" role="tablist" id="topic-paths-nav" aria-label="Topic sections">
          ${TOPIC_PATH_TABS.map((t, i) => `<button type="button" class="ptab${i === 0 ? ' is-active' : ''}" role="tab" data-ptab="${escapeAttr(t.key)}" aria-selected="${i === 0 ? 'true' : 'false'}">${escapeHTML(t.label)}</button>`).join('')}
        </nav>
      </div>
    `;

    observeSubnavHeight();
    setupResponsiveNav();
    wireSubnavPicker(subHeader);
  }

  if (route.type === 'about' || route.type === 'terms') {
    document.body.classList.add('has-subnav');
    // static-page: opts the grey identity-bar styling in without app-mode's
    // viewport lock (these are long-scroll pages).
    subHeader.classList.add('is-subnav', 'static-page');
    const title = route.type === 'about' ? 'About' : 'Terms & Conditions';
    const iconSvg = route.type === 'about'
      ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';
    // Same identity-bar pattern as topic pages (icon + name, grey fill) so the
    // static pages' subnav matches the rest of the site (#img93/97).
    subHeader.innerHTML = `
      <div class="topic-subnav-title">
        <div class="topic-subnav-inner">
          <div class="subnav-ident">
            <span class="subnav-ident-ico">${iconSvg}</span>
            <span class="subnav-ident-name">${title}</span>
          </div>
        </div>
      </div>
    `;
    observeSubnavHeight();
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
  const { showSearchTrends = false } = opts;
  // Home body tabs: (Search & Trends) → News Feed. The retired Trending / AI-Insights /
  // Web-Search / Related pill branches were removed (B4.6) — no caller ever enabled them
  // (topic pages use a separate tab system). Output is identical to before.
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
    if (newHash && newHash !== routeHash()) {
      replaceRoute(newHash);
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
    if (routeHash() !== newHash && trimmed) {
      replaceRoute(newHash);
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
    replaceRoute('#/');
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

// navigate helper — delegates to the router's History-API navigation so the route
// handler fires and the layout updates. Accepts "#/x" (legacy) or "/x" targets.
function navigate(hash) {
  routerNavigate(hash);
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

// Per-route <title> so each surface has a distinct, descriptive title (SEO 2a) —
// crawlers, browser tabs, shared links, and GA4 page_view (which reads
// document.title) all get the right one instead of the static homepage title.
const SITE_TITLE_SUFFIX = 'Standard Topic';
const TOPIC_TAB_LABEL = { 'ai-insights': 'AI Insights', prompts: 'Prompts', explore: 'Explore Further' };
function documentTitleFor(route) {
  if (!route) return `${SITE_TITLE_SUFFIX} — News, Resources and AI Knowledge on Any Topic`;
  switch (route.type) {
    case 'home': return `${SITE_TITLE_SUFFIX} — News, Resources and AI Knowledge on Any Topic`;
    case 'topic': {
      const t = getTopicBySlug(route.slug);
      if (!t) return `${SITE_TITLE_SUFFIX}`;
      const tab = TOPIC_TAB_LABEL[route.tab];
      return tab
        ? `${t.name} ${tab} — ${SITE_TITLE_SUFFIX}`
        : `${t.name} — News, Resources & AI Insights | ${SITE_TITLE_SUFFIX}`;
    }
    case 'custom': return route.term ? `${route.term} — Search | ${SITE_TITLE_SUFFIX}` : `Search | ${SITE_TITLE_SUFFIX}`;
    case 'search': return `Search | ${SITE_TITLE_SUFFIX}`;
    case 'trending': return `Trending | ${SITE_TITLE_SUFFIX}`;
    case 'topics': return `All Topics | ${SITE_TITLE_SUFFIX}`;
    case 'prompts': return `Prompts | ${SITE_TITLE_SUFFIX}`;
    case 'prompt-generator': return `Prompt Builder | ${SITE_TITLE_SUFFIX}`;
    case 'about': return `About | ${SITE_TITLE_SUFFIX}`;
    case 'terms': return `Terms | ${SITE_TITLE_SUFFIX}`;
    default: return `${SITE_TITLE_SUFFIX} — News, Resources and AI Knowledge on Any Topic`;
  }
}

// Measured main-nav fit (mirrors fitPtabs for the topic tabs): keep EVERY item
// until the row would truly overflow, then peel back the least-important thing —
// shorten Trending→"Trends", then drop Prompts, then Home, then shrink the title.
// Reading scrollWidth forces a sync reflow so each step re-measures. Reversible.
function fitMainNav() {
  const inner = document.querySelector('.sticky-hero-inner');
  if (!inner) return;
  inner.classList.remove('nav-stacked', 'nav-short-trending', 'nav-small-text', 'nav-drop-prompts', 'nav-drop-home', 'nav-icon-search', 'nav-tiny-title');
  const fits = () => inner.scrollWidth <= inner.clientWidth + 1;
  // Buttons start HORIZONTAL (icon+label inline, left-grouped after the title). Break
  // to STACKED (icon over label, right-aligned) EARLY — before the horizontal row
  // crowds the title — by stacking once the buttons come within BUFFER px of the
  // container's right edge, not only at hard overflow (#img76).
  const navbtns = inner.querySelector('.sticky-actions.navbtns');
  if (navbtns) {
    const cs = getComputedStyle(inner);
    const innerRight = inner.getBoundingClientRect().right - (parseFloat(cs.paddingRight) || 0);
    if (navbtns.getBoundingClientRect().right > innerRight - 44) inner.classList.add('nav-stacked');
  }
  if (!inner.classList.contains('nav-stacked') && !fits()) inner.classList.add('nav-stacked');
  if (!fits()) inner.classList.add('nav-short-trending');
  // Squeeze order (#img235): smaller nav text → drop Home → Search collapses to
  // its light icon button → drop Prompts → shrink the title.
  if (!fits()) inner.classList.add('nav-small-text');
  if (!fits()) inner.classList.add('nav-drop-home');
  if (!fits()) inner.classList.add('nav-icon-search');
  if (!fits()) inner.classList.add('nav-drop-prompts');
  if (!fits()) inner.classList.add('nav-tiny-title');
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
        <button type="button" class="navbtn" id="nav-topics" aria-label="Topics" aria-haspopup="dialog">
          <span class="navbtn-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></svg></span>
          <span class="navbtn-label">Topics</span>
        </button>
        <button type="button" class="navbtn" id="nav-trending" aria-label="Trending">
          <span class="navbtn-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></span>
          <span class="navbtn-label"><span class="nl-full">Trending</span><span class="nl-short">Trends</span></span>
        </button>
        <button type="button" class="navbtn" id="nav-prompts" aria-label="Prompts" aria-haspopup="dialog" aria-expanded="false">
          <span class="navbtn-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></span>
          <span class="navbtn-label">Prompts</span>
        </button>
        <button type="button" class="navbtn" id="nav-search" aria-label="Search">
          <span class="navbtn-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
          <span class="navbtn-label">Search</span>
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
  if (!route || route.type === 'home' || routeHash() === '' || routeHash() === '#' || routeHash() === '#/') {
    document.getElementById('nav-home')?.classList.add('is-active');
  }

  // Prompts — opens a dropdown with two paths: Build a Custom Prompt (the prompt
  // builder inline) and Prompt Library (pick a topic → its ready-made prompts).
  // (AI Insights is no longer a nav section — topic pages + custom search cover it.)
  document.getElementById('nav-prompts')?.addEventListener('click', (e) => { e.stopPropagation(); togglePromptsNavDropdown(); });

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
      openSearchFromNav();
    });
  }

  // Fit the nav to the row: drop items only when they'd actually overflow.
  if (!window.__navFitBound) {
    window.addEventListener('resize', () => requestAnimationFrame(fitMainNav));
    window.__navFitBound = true;
  }
  requestAnimationFrame(fitMainNav);

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
      <button type="button" class="navmenu-info" id="navmenu-info" aria-label="About this site" aria-haspopup="true" aria-expanded="false">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
        </svg>
      </button>
      <div class="navmenu-info-pop" id="navmenu-info-pop">
        <a href="#/about">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>
          About
        </a>
        <a href="#/terms">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
          Terms
        </a>
        <a href="https://github.com/jrcstreams/standard-topic" target="_blank" rel="noopener noreferrer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
          GitHub
        </a>
      </div>
    </div>
    <!-- navmenu-title font-size is synced to the main nav's .sticky-title at runtime
         (see syncNavmenuTitleSize) so the two always match at every viewport width. -->
    <nav class="navmenu-quicklinks">
      <a href="#/" class="navmenu-quicklink navmenu-cta" id="navmenu-home-link">
        <svg class="navmenu-cta-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
          <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        </svg>
        <span class="navmenu-cta-label">Home</span>
        <svg class="navmenu-cta-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="13 6 19 12 13 18"/>
        </svg>
      </a>
      <button type="button" class="navmenu-quicklink navmenu-cta" id="navmenu-search">
        <svg class="navmenu-cta-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <span class="navmenu-cta-label">Search</span>
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
      <button type="button" class="navmenu-quicklink navmenu-cta" id="navmenu-prompts">
        <svg class="navmenu-cta-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
        </svg>
        <span class="navmenu-cta-label">Prompts</span>
        <svg class="navmenu-cta-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="13 6 19 12 13 18"/>
        </svg>
      </button>
    </nav>
    <div class="navmenu-scroll">
      <div class="navmenu-featured-label">Topics</div>
      <a href="#" class="navmenu-viewall" id="navmenu-all-topics">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1"/>
          <rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/>
          <rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
        <span>View All Topics</span>
        <svg class="navmenu-viewall-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="13 6 19 12 13 18"/>
        </svg>
      </a>
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

  const closeMenu = () => {
    navPanel.classList.remove('is-open'); navOverlay.classList.remove('is-open'); document.body.style.overflow = '';
    navPanel.querySelector('#navmenu-info-pop')?.classList.remove('is-open');
    navPanel.querySelector('#navmenu-info')?.setAttribute('aria-expanded', 'false');
  };
  // Always open to the DEFAULT view: collapse any expanded topic accordion and
  // reset the scroll position so it never reopens where you left off (#img26).
  const resetMenu = () => {
    navPanel.querySelectorAll('.navmenu-topic-acc[open]').forEach((d) => { d.open = false; });
    if (scrollEl) scrollEl.scrollTop = 0;
  };
  // Match the menu title to the MAIN NAV title's computed size at the current
  // viewport (the sticky-title size varies across ~6 breakpoints — copying the
  // computed value keeps the two in lockstep without duplicating those rules).
  const syncNavmenuTitleSize = () => {
    const src = container.querySelector('.sticky-title');
    const dst = navPanel.querySelector('.navmenu-title');
    if (src && dst) {
      const cs = getComputedStyle(src);
      dst.style.fontSize = cs.fontSize;
      dst.style.letterSpacing = cs.letterSpacing;
    }
  };
  window.addEventListener('resize', () => { if (navPanel.classList.contains('is-open')) syncNavmenuTitleSize(); }, { passive: true });

  const openMenu = () => { resetMenu(); syncNavmenuTitleSize(); navPanel.classList.add('is-open'); navOverlay.classList.add('is-open'); document.body.style.overflow = 'hidden'; requestAnimationFrame(updateScrollOverflow); };

  container.querySelector('#nav-hamburger').addEventListener('click', openMenu);
  navOverlay.addEventListener('click', closeMenu);
  navPanel.querySelector('#navmenu-close').addEventListener('click', closeMenu);
  navPanel.querySelectorAll('a, #navmenu-all-topics').forEach(link => {
    link.addEventListener('click', closeMenu);
  });
  navPanel.querySelector('#navmenu-all-topics')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeMenu();
    toggleTopicsNavDropdown();
  });

  // Info popover (ⓘ next to the title): mini dropdown with About / Terms / GitHub.
  const infoBtn = navPanel.querySelector('#navmenu-info');
  const infoPop = navPanel.querySelector('#navmenu-info-pop');
  const closeInfoPop = () => { infoPop?.classList.remove('is-open'); infoBtn?.setAttribute('aria-expanded', 'false'); };
  infoBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = infoPop.classList.toggle('is-open');
    infoBtn.setAttribute('aria-expanded', String(open));
  });
  navPanel.addEventListener('click', (e) => {
    if (!e.target.closest('#navmenu-info') && !e.target.closest('#navmenu-info-pop')) closeInfoPop();
  });
  navPanel.querySelector('#navmenu-trending')?.addEventListener('click', () => {
    closeMenu();
    toggleTrendingNavDropdown();
  });
  navPanel.querySelector('#navmenu-prompts')?.addEventListener('click', () => {
    closeMenu();
    openPromptsNavDropdown();
  });
  navPanel.querySelector('#navmenu-search')?.addEventListener('click', () => {
    closeMenu();
    navigate('#/search');
  });

  // Mobile top-bar search icon (kept upper-right even though Search is also
  // in the bottom nav) — opens the search modal.
  container.querySelector('#nav-search-mobile')?.addEventListener('click', () => navigate('#/search'));

  // Clicking the logo/title OR the Home icon is a COMPLETE reset — go to the
  // homepage AND close any open dropdown / modal / topic picker. That's the whole
  // point of the home affordances (#img10).
  container.querySelector('#sticky-brand-link')?.addEventListener('click', resetToHome);
  container.querySelector('#nav-home')?.addEventListener('click', resetToHome);

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
      const h = routeHash();
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
  const h = (routeHash() || '').toLowerCase();
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
        ${bodyTabsRow({ showSearchTrends: true })}
        <div class="home-cards">
          <div class="home-search-hero" id="home-search-hero"></div>
          <div class="home-featstrip home-featstrip--rich" aria-label="Explore Standard Topic">
            <div class="featstrip-item featstrip-item--rich">
              <button type="button" class="featstrip-head" data-explore-topics aria-label="Explore all topics">
                <span class="featstrip-ic" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></svg></span>
                <span class="featstrip-tx"><span class="featstrip-title">Explore Topics</span><span class="featstrip-sub">Browse 100+ topic hubs</span></span>
                <span class="featstrip-arrow" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg></span>
              </button>
              <div class="featstrip-previews" data-fs-topics></div>
            </div>
            <div class="featstrip-item featstrip-item--rich">
              <button type="button" class="featstrip-head" data-explore-prompts aria-label="Open the prompt library">
                <span class="featstrip-ic" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></span>
                <span class="featstrip-tx"><span class="featstrip-title">Prompt Library</span><span class="featstrip-sub">Ready-made for every topic</span></span>
                <span class="featstrip-arrow" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg></span>
              </button>
              <div class="featstrip-previews" data-fs-prompts></div>
            </div>
          </div>
        </div>
        <div class="home-sections">
          <div class="home-main">
            <section class="layout-section" id="section-newsfeed"></section>
          </div>
          <aside class="home-side">
            <section class="home-trending" id="home-trending"></section>
          </aside>
        </div>
      </div>
    `;
    homeSearchPanelCtl = renderSearchPanel(container.querySelector('#home-search-hero'), { mode: 'inline' });
    // Trending is now the only sidebar card, so it can run much longer.
    renderTrendingHome(container.querySelector('#home-trending'), { limit: 14 });
    // The Topics promo card (replaces the home AI Insights card, #424) — opens the
    // full All-Topics dropdown so visitors can jump into a dedicated topic page.
    container.querySelector('[data-explore-topics]')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('open-all-topics-modal'));
    });
    // Prompts promo (#img15) — opens the Prompts dropdown (Build a Custom Prompt +
    // Prompt Library) rather than jumping straight to the builder.
    container.querySelector('[data-explore-prompts]')?.addEventListener('click', (e) => {
      e.preventDefault();
      openPromptsNavDropdown();
    });
    // Preview rows inside the two cards (#img231): featured topic chips + the
    // first three Featured Prompts (same data file as the Prompt Library).
    {
      const tWrap = container.querySelector('[data-fs-topics]');
      if (tWrap) {
        let feats = []; try { feats = (getFeaturedTopics() || []).filter((t) => t && t.slug && t.slug !== 'home').slice(0, 5); } catch (_) {}
        tWrap.innerHTML = feats.map((t) => `<a href="#/topic/${escapeAttr(t.slug)}" class="fs-chip">${topicIconSVG(t.icon || 'globe', 'fs-chip-ic')}<span>${escapeHTML(t.name)}</span></a>`).join('');
      }
      const pWrap = container.querySelector('[data-fs-prompts]');
      if (pWrap) {
        fetchWithTimeout('/data/featured-prompts.json', { headers: { Accept: 'application/json' } })
          .then((r) => (r.ok ? r.json() : null))
          .then((cfg) => {
            if (!cfg || !Array.isArray(cfg.featured)) return;
            const picks = [];
            for (const f of cfg.featured) {
              if (picks.length >= 3) break;
              let sc = []; try { sc = getShortcutsForTopic(f.topic) || []; } catch (_) { continue; }
              const sMatch = sc.find((x) => x && x.name === f.name);
              const t = getTopicBySlug(f.topic);
              if (sMatch && sMatch.prompt) picks.push({ s: sMatch, tn: t ? t.name : '' });
            }
            pWrap.innerHTML = picks.map((pk, i) => `<button type="button" class="fs-chip fs-chip--prompt" data-fs-prompt="${i}"><svg class="fs-chip-spark" viewBox="0 0 24 24" width="12" height="12" fill="#2563eb" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg><span>${escapeHTML(pk.s.name)}</span></button>`).join('');
            pWrap.querySelectorAll('[data-fs-prompt]').forEach((b) => b.addEventListener('click', (e) => {
              e.stopPropagation();
              const pk = picks[Number(b.dataset.fsPrompt)]; if (!pk) return;
              window.dispatchEvent(new CustomEvent('open-prompt-modal', { detail: { basePrompt: pk.s.prompt, topicName: pk.tn, name: pk.s.name, count: 1 } }));
            }));
          }).catch(() => {});
      }
    }
  } else if (topic && !isCustom) {
    // Topic pages: ONE cohesive tabbed "Paths" package at every width. A second
    // subnav (tab strip) below the title — News · Catch Up · Deep Dive · 101 Info
    // · Web Search · Prompts — with a sticky per-tab body header + scrolling
    // content. News is the default tab.
    // The topic-name bar + path tabs live in the fixed #sub-header now (built in
    // renderSubHeader) — the body is JUST the active tab's content, which scrolls
    // under the sticky subnav. No per-tab section title (the active tab already
    // names the section, #img14).
    container.innerHTML = `
      <div class="topic-layout topic-band topic-tabbed" id="topic-layout">
        <div class="topic-tabpanel" role="tabpanel">
          <div class="topic-tab-body layout-section" id="topic-tab-body"></div>
        </div>
      </div>
    `;
    const descriptions = {}; const icons = {};
    try { (getShortcutsForTopic(topic.slug) || []).forEach((s) => { if (s && s.name) { descriptions[s.name] = s.description || ''; icons[s.name] = s.icon || ''; } }); } catch (_) {}
    wireTopicPathTabs(container, topic, descriptions, icons);
    return;
  } else {
    // Custom-search pages keep the stacked shortcuts + news layout.
    container.innerHTML = `
      <div class="topic-layout topic-band" id="topic-layout">
        <section class="layout-section" id="section-shortcuts"></section>
        <section class="layout-section" id="section-newsfeed"></section>
      </div>
    `;
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

// Prompt templates for "explore deeper" / "run full overview" — admin-tunable
// in data/insight-templates.json (lazy-loaded, with safe fallbacks).
let __insightTemplates = null;
async function getInsightTemplates() {
  if (__insightTemplates) return __insightTemplates;
  try {
    const res = await fetch('/data/insight-templates.json');
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
    // Shortcut groups render as plain accordions of rows (rows send users out to
    // external models / web sources). The old "lens row → generated group
    // OVERVIEW" path (a legacy per-section Gemini generation) was retired — AI
    // insights are now the topic-page Insight Builders only.
    groupOrder.forEach(g => {
      const items = groups[g.key];
      if (!items || items.length === 0) return;
      html += renderTIAccordion({
        key: g.key,
        label: g.label,
        open: false,
        bodyHTML: `<ul class="ti-item-list ti-item-list-shortcuts" data-group="${escapeAttr(g.key)}">${items.map(s => tiShortcutItem(s, topicName, g.key)).join('')}</ul>`,
      });
    });
  }
  html += `</div>`; /* close .ti-accordions */
  html += `</div>`; /* close .shortcuts-scroll-wrap */
  html += `<div class="shortcuts-toast" id="shortcuts-toast" role="status" aria-live="polite"></div>`;
  html += `</div>`; /* close .shortcuts-sidebar */
  html += webSourcesCardHTML; /* Web Sources as its own sibling section */
  container.innerHTML = html;

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
        track('shortcut_submit', { model: model.id, route: routeHash() || '#/' });
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
      track('content_shortcut_click', { name, route: routeHash() || '#/' });
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
    track('direct_submit', { model: model.id, count: sub.count, route: routeHash() || '#/' });
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
      route: routeHash() || '#/',
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
      ${isModal ? '<div class="search-panel-topfold">' : ''}
      <div class="search-panel-hero"><div class="search-panel-hero-inner">
        ${isModal
          ? `<h2 class="search-panel-title">Search</h2>
             <p class="search-panel-tagline">News, Resources and AI Knowledge</p>
             <p class="search-panel-herohint">Type a topic, term, or headline and we'll pull together the latest news, web sources, and AI insights.</p>`
          : `<h2 class="search-panel-title">Search. Discover. Stay&nbsp;Informed.</h2>
             <p class="search-panel-tagline">Real news. AI insights. All in one place.</p>`}
      </div></div>
      <div class="search-panel-barrow">
        <form class="search-panel-form" role="search" autocomplete="off">
          <span class="search-panel-icon" aria-hidden="true">${SEARCH_ICON_SVG}</span>
          <input class="search-panel-input" type="search" placeholder="Search any topic, headline or question for insights…" aria-label="Search any topic" value="${escapeAttr(term)}">
          <button type="button" class="search-panel-copylink" aria-label="Copy a shareable link to this search" title="Copy link to this search">${LINK_ICON_SVG}</button>
          <button type="button" class="search-panel-clear" aria-label="Clear search" hidden>${X_ICON_SVG}</button>
        </form>
        <div class="search-panel-suggest" role="listbox" hidden></div>
      </div>
      ${isModal ? '</div>' : ''}
      ${!isModal ? `<div class="search-panel-starters" aria-label="Popular topics"></div>` : ''}
      <div class="search-panel-results"><div class="search-panel-results-inner"></div></div>
    </div>`;

  const panelEl = container.querySelector('.search-panel');
  const form = panelEl.querySelector('.search-panel-form');
  const input = panelEl.querySelector('.search-panel-input');
  const suggestEl = panelEl.querySelector('.search-panel-suggest');
  const clearBtn = panelEl.querySelector('.search-panel-clear');
  const resultsInner = panelEl.querySelector('.search-panel-results-inner');
  const copyLinkBtn = panelEl.querySelector('.search-panel-copylink');
  function syncClear() { if (clearBtn) clearBtn.hidden = !input.value; }
  // Placeholder shortens on narrower screens so it doesn't get cut off (#img459).
  function syncPlaceholder() {
    const w = window.innerWidth;
    input.placeholder = w <= 560 ? 'Search for insights…'
      : w <= 900 ? 'Search a topic for insights…'
      : 'Search any topic, headline or question for insights…';
  }
  syncPlaceholder();
  const onSpResize = () => { if (!document.contains(input)) { window.removeEventListener('resize', onSpResize); return; } syncPlaceholder(); };
  window.addEventListener('resize', onSpResize);
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
    // Home inline card: now that live trends are in, add the Trending group.
    fillStarterChips();
  }).catch(() => {});

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
    const order = ['external'];   // Prompts = the external-model shortcuts (primary tab)
    if (opts.news) { extraTabs.push({ group: 'news', tab: 'News', subtitle: 'Latest stories matching your search.', icon: SP_NEWS_ICON, render: (wrap) => renderSearchNewsInto(wrap, t) }); order.push('news'); }
    // "Explore Further" — the SAME shared component used on trending / news / topic
    // insights (Explore with External AI Models first, then the web categories),
    // replacing the old bare "Web Search" tab. Trending is no longer a tab (#img215).
    extraTabs.push({
      group: 'explore', tab: 'Explore Further', subtitle: 'Send this to an AI model, or open it in web sources.', icon: SP_TREND_SEC_ICON,
      render: (wrap) => {
        wrap.innerHTML = `<div class="search-xf">${exploreFurtherHTML({ prompt: `Explain "${t}" and give me the latest, most important information on it. Be specific and cite sources.`, webTerm: t, name: t, subDesc: 'Explore this search with ChatGPT, Claude, Gemini & more' })}</div>`;
        try { wireExploreFurther(wrap.querySelector('.search-xf')); } catch (_) {}
      },
    });
    order.push('explore');
    return {
      inModal: true,              // flowMode → the builder (pill-tab) shell
      initialBuilder: true,
      initialGroup: 'external',   // land on the external-model shortcuts
      lockTopic: true,
      resultsFor: true,           // header reads "Results for ‘term’" (#img218)
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
    // Homepage inline panel: open the search dropdown/modal (same as mobile + the
    // nav Search) instead of rendering results inside the hero card. Every entry
    // point (Enter, a suggestion row, a trend chip) routes through here.
    if (!isModal) { hideSuggest(); navigate('#/custom/' + encodeURIComponent(t)); return; }
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
      const nr = await fetchWithTimeout(`/api/news-search?q=${encodeURIComponent(term)}&limit=12`, { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null).catch(() => null);
      stories = (nr && nr.stories) || [];
    } catch (_) { stories = []; }
    spContentCache[term] = Object.assign(spContentCache[term] || {}, { news: stories });
    return stories;
  }
  async function spFetchTrends(term) {
    if (spContentCache[term] && spContentCache[term].trends) return spContentCache[term].trends;
    let items = [];
    try {
      const tr = await fetchWithTimeout(`/api/trending-history?mode=search&q=${encodeURIComponent(term)}&limit=12`, { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null).catch(() => null);
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

// Homepage-only (#img193): the sticky subnav (Home | Browse Topics) stays hidden
// until the user scrolls PAST the Explore Topics / Prompt Library mini-cards —
// they carry the topic-picking promo up top, so the subnav would be duplicative.
let homeSubnavRevealHandler = null;
function setupHomeSubnavReveal() {
  if (homeSubnavRevealHandler) { window.removeEventListener('scroll', homeSubnavRevealHandler); homeSubnavRevealHandler = null; }
  document.body.classList.remove('home-subnav-on');
  homeSubnavRevealHandler = () => {
    const strip = document.querySelector('.home-featstrip');
    if (!strip) return;
    const navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 60;
    document.body.classList.toggle('home-subnav-on', strip.getBoundingClientRect().bottom <= navH + 4);
  };
  window.addEventListener('scroll', homeSubnavRevealHandler, { passive: true });
  homeSubnavRevealHandler();
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

// Open Search RELIABLY from a nav click, regardless of the current hash. The
// naive `navigate('#/search')` is a no-op when the hash is ALREADY a search/custom
// route — which happens whenever you open Search, switch to another dropdown (that
// closes the search panel but leaves the hash at #/search), then click Search
// again. In that case no hashchange fires and the route handler never opens search.
// So: if the hash already reads search/custom, open the panel directly; otherwise
// navigate (which renders home underneath + opens search). Either path guarantees
// the search modal opens on every click.
function openSearchFromNav() {
  if (isSearchModalOpen()) { userCloseSearchModal(); return; }
  const h = routeHash() || '';
  if (h === '#/search' || h === '#/custom' || h.startsWith('#/custom/')) {
    openSearchPageModal(h.startsWith('#/custom/') ? decodeURIComponent(h.slice('#/custom/'.length)) : '');
  } else {
    navigate('#/search');
  }
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
  const hash = routeHash() || '';
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
    if (routeHash() !== target) navigate(target);
  };
  // Clearing inside the panel drops back to the empty-search route.
  searchPanelModalCtl.onCollapse = () => {
    if ((routeHash() || '').startsWith('#/custom/')) navigate('#/search');
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
    loadPromptGen().then((m) => m.renderPromptGenerator(content));
    return;
  }

  if (route.type === 'about') {
    content.innerHTML = `
      <div class="about-page">
        <p class="about-lead">Standard Topic is a topic-first way to stay informed: live news, AI-generated briefings, and ready-to-run prompts for 100 curated topics — or any topic you search.</p>

        <div class="about-section">
          <h3>What's on a topic page</h3>
          <p>Every topic page organizes coverage around the subject, not the outlet. Each one combines:</p>
          <ul>
            <li><strong>News Feed</strong> — a live feed aggregated from established publishers, refreshed throughout the day and sorted newest-first.</li>
            <li><strong>AI Insights</strong> — briefings generated for each topic (Get Caught Up, Deep Dive, Analysis, and 101 Resources), refreshed on a schedule so they stay current, with the sources they draw from listed alongside.</li>
            <li><strong>Prompts</strong> — ready-made prompts that open in the AI model of your choice, plus a Prompt Builder for composing your own with topics, scope, output style, and citations.</li>
          </ul>
          <p>If a subject isn't in the library, use Search to build a page around any term — news results, external searches, and prompts included.</p>
        </div>

        <div class="about-section">
          <h3>How AI is used here</h3>
          <p>Two kinds of AI appear on the site, and both are clearly labeled:</p>
          <ul>
            <li><strong>Generated on the site</strong> — AI Insights, the homepage news brief, and trending briefs are produced by Standard Topic using Google's Gemini models with live web grounding. Generated content carries a "✦ AI" label and lists its sources.</li>
            <li><strong>Opens in your model</strong> — prompt cards and the Prompt Builder compose a prompt and open it in the platform you choose: ChatGPT, Claude, Gemini, Perplexity, Copilot, or Google AI Mode. Those responses come from that platform, not from this site.</li>
          </ul>
          <p>AI-generated content can be incomplete or inaccurate. Sources are listed on every generated briefing so you can verify — for anything that matters, click through to the reporting itself.</p>
        </div>

        <div class="about-section">
          <h3>Your model, your choice</h3>
          <p>Wherever a prompt leaves the site, you pick the destination. Your selected model and preferences are saved in your browser only — there are no accounts and no profiles.</p>
        </div>

        <div class="about-section">
          <h3>Open source</h3>
          <p>The full source code is public. Read it, follow what's planned, or fork it.</p>
          <a href="https://github.com/jrcstreams/standard-topic" target="_blank" rel="noopener noreferrer" class="about-cta-link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
            <span>View on GitHub</span>
          </a>
        </div>

        <div class="about-section about-creator">
          <h3>Created by</h3>
          <p>Standard Topic was built by <strong>John Choudhari</strong>, a builder with over a decade in digital media and communications, focused on how AI is changing the way people read, search, and learn.</p>
          <div class="about-cta-row">
            <a href="https://johnchoud.com" target="_blank" rel="noopener noreferrer" class="about-cta-link">Portfolio</a>
            <a href="https://www.linkedin.com/in/johnchoudhari/" target="_blank" rel="noopener noreferrer" class="about-cta-link">LinkedIn</a>
          </div>
        </div>

        <div class="about-section about-disclaimer">
          <h3>Terms &amp; contact</h3>
          <p>The <a href="#/terms">Terms &amp; Conditions</a> cover data practices, analytics, third-party services, and acceptable use. For questions, corrections, or feedback, reach out via <a href="https://johnchoud.com" target="_blank" rel="noopener noreferrer">johnchoud.com</a>.</p>
        </div>
      </div>
    `;
    return;
  }

  if (route.type === 'terms') {
    content.innerHTML = `
      <div class="about-page">
        <p class="about-lead">The rules for using Standard Topic, written to be read.</p>
        <p class="about-updated">Last updated: July 2026</p>

        <div class="about-section">
          <h3>1. Agreement</h3>
          <p>By accessing or using Standard Topic (the "Site"), you agree to these Terms. If you do not agree with them, please do not use the Site.</p>
        </div>

        <div class="about-section">
          <h3>2. What the Site Provides</h3>
          <p>Standard Topic is a free, non-commercial, open-source service that organizes public information by topic:</p>
          <ul>
            <li><strong>Topic pages</strong> — curated pages combining news, AI-generated briefings, prompts, and reference links for a subject.</li>
            <li><strong>News feeds</strong> — headlines aggregated server-side from publicly available RSS sources via the rss.app API. The Site stores headlines, summaries, and links in its own database to power feeds, search, and history; no rss.app widget or tracker loads in your browser.</li>
            <li><strong>AI-generated briefings</strong> — topic briefings, news summaries, and trending summaries generated by the Site using Google's Gemini models with live web grounding. Generated content is labeled "✦ AI" and lists its sources.</li>
            <li><strong>AI shortcuts and Prompt Builder</strong> — preset or custom prompts that open in a third-party AI platform of your choice (ChatGPT, Claude, Gemini, Perplexity, Copilot, Google AI Mode) in a new tab. Responses from those platforms come from the platform, not from the Site.</li>
          </ul>
        </div>

        <div class="about-section">
          <h3>3. Accounts and Personal Data</h3>
          <p>There is no sign-up. The Site does not ask for your name, email address, or other personal details, does not set advertising cookies, and does not sell or share data with ad networks.</p>
          <p>Some features — news feeds, generated briefings, news search — are served by the Site's backend. Those requests are not tied to accounts or identity profiles. Vercel (the hosting provider) and any third-party platform you interact with may keep standard technical logs under their own policies.</p>
        </div>

        <div class="about-section">
          <h3>4. Analytics</h3>
          <p>The Site uses Google Analytics 4 for aggregate usage measurement — page views, feature usage, and which AI models are selected. It is configured with privacy defaults enabled: IP anonymization, Google Signals off, and ad personalization off. The Site does not log prompt text, Prompt Builder input, or anything else intended to identify you. Blocking analytics with a browser extension does not affect the Site's functionality.</p>
        </div>

        <div class="about-section">
          <h3>5. Local Browser Storage</h3>
          <p>Your browser's <code>localStorage</code> holds a small number of interface preferences, such as your default AI model. This data stays on your device and can be cleared through your browser settings at any time.</p>
        </div>

        <div class="about-section">
          <h3>6. Third-Party Services</h3>
          <p>The Site relies on or links to services operated by third parties:</p>
          <ul>
            <li><strong>AI platforms</strong> — OpenAI (ChatGPT), Anthropic (Claude), Google (Gemini, Google AI Mode), Microsoft (Copilot), and Perplexity, for prompts you choose to send.</li>
            <li><strong>AI generation</strong> — Google's Gemini API, used server-side to produce the Site's generated briefings.</li>
            <li><strong>News aggregation</strong> — the rss.app API, used server-side to collect publisher headlines.</li>
            <li><strong>Search and reference links</strong> — Google News, DuckDuckGo, Reddit, X, YouTube.</li>
            <li><strong>Hosting</strong> — Vercel serves the Site; GitHub hosts the source code.</li>
          </ul>
          <p>Standard Topic is not affiliated with, endorsed by, or sponsored by any of these services. Trademarks belong to their owners. When you follow an external link or send a prompt to a third-party platform, that platform's terms and privacy policy apply.</p>
        </div>

        <div class="about-section">
          <h3>7. AI-Generated Content on the Site</h3>
          <p>Briefings and summaries generated by the Site are produced automatically, refreshed on a schedule, and labeled as AI-generated with their sources listed. Despite grounding in live sources, generated content can be incomplete, outdated, or inaccurate, and may not reflect every development on a topic.</p>
          <p>Generated content is provided for general information only and is not professional advice. Do not rely on it for medical, legal, financial, safety-critical, or otherwise consequential decisions — verify significant claims against the listed sources or other primary reporting.</p>
        </div>

        <div class="about-section">
          <h3>8. AI Output from Third-Party Platforms</h3>
          <p>Prompts you send through AI shortcuts or the Prompt Builder are processed by the third-party platform you select. The Site does not control and accepts no responsibility for the accuracy, completeness, or character of those responses, or for how the platform handles or stores your prompt. The same no-professional-advice caution in Section 7 applies.</p>
        </div>

        <div class="about-section">
          <h3>9. News Content</h3>
          <p>Headlines, summaries, and articles belong to their originating publishers. The Site displays headlines and links and does not write, edit, or endorse individual stories. For corrections or copyright concerns about an article, contact the publisher; publishers or rights holders who want a feed removed from the Site can use the contact route in Section 16.</p>
        </div>

        <div class="about-section">
          <h3>10. Intellectual Property</h3>
          <p>The source code is open source at <a href="https://github.com/jrcstreams/standard-topic" target="_blank" rel="noopener noreferrer">github.com/jrcstreams/standard-topic</a>; reuse is governed by the repository's license. The Standard Topic name, written copy, and original design belong to the Site's creator. Third-party names and marks appear for identification only.</p>
        </div>

        <div class="about-section">
          <h3>11. Acceptable Use</h3>
          <p>Use the Site for lawful, personal, informational purposes. You agree not to:</p>
          <ul>
            <li>use the Site to violate the law or the rights of others;</li>
            <li>disrupt, overload, or attempt to abuse the Site or its backend services;</li>
            <li>scrape, mirror, or republish the Site as your own;</li>
            <li>use AI shortcuts or the Prompt Builder to produce content that is illegal, harmful, or in violation of the receiving platform's terms.</li>
          </ul>
        </div>

        <div class="about-section">
          <h3>12. No Warranties</h3>
          <p>The Site is provided "as is" and "as available," without warranties of any kind, express or implied — including merchantability, fitness for a particular purpose, accuracy, and non-infringement. Availability and features may change or be interrupted at any time.</p>
        </div>

        <div class="about-section">
          <h3>13. Limitation of Liability</h3>
          <p>To the fullest extent permitted by law, Standard Topic and its creator are not liable for indirect, incidental, special, consequential, or punitive damages, or for lost data, revenue, or profits, arising from use of the Site, any linked third-party service, or any content (including AI-generated content) obtained through it. Total direct liability is limited to the amount you paid to use the Site.</p>
        </div>

        <div class="about-section">
          <h3>14. Changes to These Terms</h3>
          <p>These Terms may be updated from time to time; the "Last updated" date above reflects the current version. Continued use of the Site after an update constitutes acceptance of the revised Terms.</p>
        </div>

        <div class="about-section">
          <h3>15. Termination</h3>
          <p>There are no accounts, so ending use simply means no longer visiting the Site. The Site may be modified, suspended, or discontinued at any time without notice.</p>
        </div>

        <div class="about-section">
          <h3>16. Governing Law and Contact</h3>
          <p>These Terms are governed by the laws applicable at the Site creator's place of residence, without regard to conflict-of-law rules. If any provision is found unenforceable, the remainder stays in effect.</p>
          <p>Questions about these Terms, corrections, or removal requests: reach out via <a href="https://johnchoud.com" target="_blank" rel="noopener noreferrer">johnchoud.com</a>.</p>
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
