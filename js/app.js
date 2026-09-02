import { initRouter, onRoute, getCurrentRoute, navigate as routerNavigate, routeHash, replaceRoute } from './utils/router.js?v=20260815-revamp763';
import { loadAllData, getTopicBySlug, getParentTopics, getFeaturedTopics, getSubtopics, getShortcutsForTopic, getRelatedTopics, getTopicsGroupedByParent, getAllShortcutIconKeys, getExternalSearches, getExternalSearchCategories, searchTopics, getModels, getDefaultModelId, getModelById, fetchWithTimeout } from './utils/data.js';
import { getPreferredModelId, setPreferredModelId, submitPrompt, openModel, copyPrompt } from './utils/ai-models.js?v=20260605-polish30';
import { assemblePrompt } from './utils/prompt-assembly.js';
import { REASONING_LEVELS, getReasoningLevel, getCustomInstructions } from './utils/settings.js';
import { renderIcon, preloadIcons, getIconEmoji } from './utils/icons.js';
import { topicIconSVG } from './utils/topic-icons.js?v=20260716-revamp588';
import { getTopicDescription } from './utils/topic-descriptions.js?v=20260706-revamp574';
import { renderSearchBar, initSearchOverlay } from './components/search-modal.js?v=20260728-revamp668';
import { installHowItWorks, howItWorksLinkHTML } from './utils/how-it-works.js?v=20260828-revamp1038';
import { renderNewsFeed, renderBriefBody, listHTML as newsListHTML, wireNewsAI } from './components/newsfeed.js?v=20260817-revamp772';
// prompt-generator (~127KB, Prompts flows only) is lazy-loaded via loadPromptGen() so it
// splits out of the initial bundle — see B3.4. (prompt-builder-modal.js was a retired
// no-op takeover; removed.)
import { initPromptModal } from './components/prompt-modal.js?v=20260706-revamp574';
import { renderTrending, renderTrendingHome, renderTrendingModal } from './components/trending.js?v=20260720-revamp609';
import { fetchTrending } from './utils/trending.js';
import { DEFAULT_GROUP_DEFS, groupShortcuts, renderTIAccordion, webSourceItem } from './components/ti-shortcuts.js';
import { initTrendingDetailModal } from './components/trending-detail-modal.js?v=20260706-revamp574';
import { initInsightModal } from './components/insight-modal.js?v=20260706-revamp574';
import { renderAIIntelligence, renderDailyIntelligence, fetchDailyBrief } from './components/ai-intelligence.js?v=20260817-revamp772';
import { exploreFurtherHTML, exploreAIModelsHTML, wireExploreFurther } from './utils/explore-further.js?v=20260812-revamp718';
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

// revamp867 — self-heal a stale cached bundle. In-app (SPA) navigation never
// re-fetches app.js, so an old tab can keep running an old build indefinitely.
// On boot, compare the running app.js to the one the current index.html points
// to; if they differ, reload once (guarded against loops).
(function selfHealStaleBundle() {
  try {
    const running = [...document.scripts].map((x) => x.src).find((x) => /\/dist\/app\.[A-Za-z0-9]+\.js/.test(x));
    if (!running) return;
    fetch('/?_sh=' + Date.now(), { cache: 'no-store' })
      .then((r) => r.text())
      .then((html) => {
        const m = html.match(/dist\/app\.[A-Za-z0-9]+\.js/);
        if (!m) return;
        const fresh = m[0];
        if (running.indexOf(fresh) !== -1) return;                 // already current
        if (sessionStorage.getItem('st-sh') === fresh) return;     // tried this build already
        sessionStorage.setItem('st-sh', fresh);
        location.reload();
      })
      .catch(() => {});
  } catch (_) {}
})();

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
  installHowItWorks();
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
  // Route through navigate() so the back-target stack records the move — the
  // dropdown opens from the #/trending route handler. Opening directly (old
  // behavior) skipped recordBackTarget, which left "Back to …" pointing at the
  // page BEFORE the one the user was actually on (revamp764). A pending var
  // carries the expand request into the route-driven open.
  window.addEventListener('open-trending-list', (e) => {
    const ex = e && e.detail && e.detail.expand;
    pendingTrendingExpand = ex || null;
    const cur = getCurrentRoute();
    if (cur && cur.type === 'trending') {
      const c = document.getElementById('content');
      if (c) renderNavDdPage(c, trendingNavDdCfg());
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    navigate('#/trending');
  });
  // All Topics is a dropdown now: every open-all-topics-modal dispatch (picker
  // "All Topics", search) opens the single clean Topics nav dropdown.
  window.addEventListener('open-all-topics-modal', () => {
    const cur = getCurrentRoute();
    if (cur && cur.type === 'topics') window.scrollTo({ top: 0, behavior: 'smooth' });
    else navigate('#/topics');
  });

  // Esc closes the open nav dropdown (search/prompt also reset their deep-link
  // route). Skip when the Review & Submit dropdown is stacked on top — it
  // handles its own Esc first, so one press peels one layer.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !navDdOpen) return;
    if (document.querySelector('.prompt-modal-overlay.is-open')) return;
    userCloseNavDropdown();
  });

  // (Removed the "Site updated — tap to refresh" pill per #img316 — it was
  // intrusive. Returning visitors pick up new assets on their next full load.)

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
    // Remember where we came from so sub-pages can offer a named "Back to …",
    // and keep an open panel's back bar in step with the fresh stack.
    try { recordBackTarget(route); refreshNavDdBackbar(); } catch (_) {}
    // Nav dropdowns are transient overlays — close on any navigation. EXCEPTION:
    // the Prompt Builder dropdown is route-driven (#/prompt-generator) and may
    // re-fire the route from a child picker — keep it. Topics / Trending /
    // Prompts dropdowns are route-driven too (#/topics, #/trending,
    // #/prompts[/view]) — keep each open across its own route.
    const keepPrompt = route.type === 'prompt-generator' && navDdOpen && navDdOpen.key === 'prompt';
    const keepDd = navDdOpen && route.type === navDdOpen.key && ['topics', 'trending', 'prompts'].includes(route.type);
    if (!keepPrompt && !keepDd) closeNavDropdown();
    // Search (#/search) and Custom (#/custom/{term}) are REAL pages now
    // (revamp765): they render in #content like any other route. Term changes
    // re-fire the route while the page stays mounted — the live panel expands/
    // collapses in place instead of remounting.
    const isSearchRoute = route.type === 'search' || route.type === 'custom';
    const isPromptRoute = route.type === 'prompt-generator';
    // revamp819: topics / trending / prompts render their OWN pages now, so
    // they no longer map to home-with-an-overlay. Only the prompt builder is
    // still an overlay route.
    const isDdRoute = false;
    const isOverlayRoute = isPromptRoute;
    const baseRoute = isOverlayRoute ? { type: 'home', slug: 'home', tab: 'newsfeed' } : route;
    const baseKey = baseRoute.type === 'home' ? 'home'
      : baseRoute.type === 'topic' ? 'topic:' + baseRoute.slug
      : isSearchRoute ? 'searchpage'
      : baseRoute.type;   // topics/trending/prompts key off their own type now

    // Only (re)render when the page actually changes, so typing inside the
    // open prompts dropdown (or refining a search term) doesn't tear the page
    // down beneath it.
    const staySearch = isSearchRoute && lastBaseRouteKey === 'searchpage' && searchPageCtl;
    if (!(isOverlayRoute && lastBaseRouteKey === 'home') && !staySearch) {
      renderLayout(baseRoute);
      renderPage(baseRoute);
      lastBaseRouteKey = baseKey;
      // revamp1094: write --subnav-height SYNCHRONOUSLY right after render (a
      // forced measure), so #content's padding-top calc is correct on the FIRST
      // paint. Previously it was only set in a rAF/ResizeObserver, so for a frame
      // (up to the 320ms condense settle) the padding used a stale height — the
      // subnav overlapped/mis-positioned the content until it "jumped" into place.
      try { setSubnavHeightVar(true); } catch (_) {}
      requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        setSubnavHeightVar(true);
      });
    } else if (staySearch) {
      // Same search page, new term → drive the live panel.
      const t = route.type === 'custom' ? decodeURIComponent(route.term || '') : '';
      try { if (t) searchPageCtl.expand(t); else searchPageCtl.collapse(); } catch (_) {}
    }

    if (isPromptRoute) openPromptBuilderNavDropdown(); else closePromptBuilderNavDropdown();
    // Route-driven nav dropdowns (stale ones were already closed above).
    if (route.type === 'topics') renderPageNavBar('topics');
    else if (route.type === 'trending') renderPageNavBar('trending');
    else if (route.type === 'prompts') renderPageNavBar('prompts');
    else if (route.type === 'search' || route.type === 'custom') renderPageNavBar('search');

    // Always refresh the bottom-nav active tab from the REAL route — overlay
    // routes (search/custom) skip renderLayout, so its internal call is missed.
    renderBottomNav(route);

    // Fire GA4 page_view after the DOM has the right document.title.
    trackPageView(routeHash() || '#/', document.title);
  });

  // revamp890: was its own 90ms timer racing two other 90ms timers (the nav fit
  // and the bus), each landing in a different rAF — so --subnav-height could be
  // measured while --nav-h was mid-change. One bus = one settle pass, in order.
  // revamp1077: force each resize-settle write. The memo skip is right for the
  // ResizeObserver's frame-by-frame writes, but on the resize BUS it let a value
  // cached at a transitional height survive a real layout change — leaving
  // #content over-padded (content "too far" from the subnav) and its calc()
  // height too short (grey showing below on Trending) until the next navigation.
  onResize('subnav-height', () => setSubnavHeightVar(true), 20);  // measures against --nav-h

  initRouter();

  // Re-render layout if the viewport crosses the mobile breakpoint
  // (home behaves differently on mobile vs desktop)
  // revamp890: this tore down and rebuilt #site-header / #sub-header / #content
  // from inside an UNDEBOUNCED resize handler — dragging slowly across 640px
  // fired a full re-render (and every re-bind under it) on frame after frame.
  // matchMedia's change event fires exactly ONCE per crossing, which is the
  // actual semantics wanted here.
  const __mq = window.matchMedia(MOBILE_QUERY);
  let lastMobile = __mq.matches;
  const onBreakpointCross = () => {
    const nowMobile = __mq.matches;
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
        // Topic sub-pages live in the URL now (revamp763), so the re-render
        // naturally restores the page the user was on — no tab seeding needed.
        // Search/Custom are real pages too (revamp765) — they re-render like any
        // route. Only the dropdown-backed routes still render home beneath and
        // re-open the overlay on top.
        const isOverlay = route.type === 'prompt-generator';
        const base = isOverlay ? { type: 'home', slug: 'home', tab: 'newsfeed' } : route;
        // Preserve an OPEN subnav topic-picker across the breakpoint crossing — the
        // full re-render rebuilds the sub-header, which silently closed it (#img75).
        const pickerWasOpen = !!document.querySelector('#sub-header .topic-subnav-picker.is-open');
        renderLayout(base); renderPage(base);
        // revamp1080: the ROUTER rebuilds the static-page sub-header via
        // renderPageNavBar after renderLayout/renderPage — but this manual
        // breakpoint-cross re-render skipped it, so crossing desktop↔mobile on
        // Trending / Topics / Prompts / Search cleared the identity band and never
        // restored it (subnav height → 0, #content geometry went out of whack).
        if (base.type === 'topics') renderPageNavBar('topics');
        else if (base.type === 'trending') renderPageNavBar('trending');
        else if (base.type === 'prompts') renderPageNavBar('prompts');
        else if (base.type === 'search' || base.type === 'custom') renderPageNavBar('search');
        if (pickerWasOpen) {
          requestAnimationFrame(() => document.querySelector('#sub-header .topic-subnav-picker .tsp-btn')?.click());
        }
        if (route.type === 'prompt-generator') {
          openPromptBuilderNavDropdown();
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
        requestAnimationFrame(() => setSubnavHeightVar(true));
      }
    }
  };
  if (typeof __mq.addEventListener === 'function') __mq.addEventListener('change', onBreakpointCross);
  else if (typeof __mq.addListener === 'function') __mq.addListener(onBreakpointCross);  // Safari <14
});

// Unified layout:
//  - Homepage: Google-style hero; sticky bar fades in after ~180px scroll
//  - Every other page: same sticky bar visible from page load (no scroll trigger)
//    Content area gets top padding (via body.sticky-always) so it isn't hidden.
let heroScrollHandler = null;

// ─── revamp890: keyed resize/scroll bus ──────────────────────────────────────
// Per-render code used to call window.addEventListener('resize', …) directly.
// Because most of those callbacks were anonymous they could never be removed,
// so every route change stacked another copy — ~3 per navigation. After a dozen
// pages, dozens of measure-and-write handlers all fired on every resize frame,
// which is what made the site progressively jitter and flash.
//
// Subscribing BY KEY makes re-registration replace the previous callback, so a
// re-render can never accumulate. All subscribers are then run inside a SINGLE
// debounced rAF, so a resize drag triggers one batched layout pass per settle
// instead of N interleaved read/write cycles.
const __resizeSubs = new Map();
const __scrollSubs = new Map();
let __resizeTimer = null;
let __resizeQueued = false;
let __resizePending = false;

function __runResizeSubs() {
  __resizeQueued = false;
  // Priority order matters: whatever publishes a CSS variable that others
  // measure against must run first. --nav-h (main-nav-fit) feeds #sub-header's
  // `top`, so the subnav height must be measured only after the nav settles.
  const subs = [...__resizeSubs.entries()].sort((a, b) => a[1].__pri - b[1].__pri);
  subs.forEach(([, fn]) => { try { fn(); } catch (_) {} });
  // revamp1075: if another resize arrived while this pass was queued — most
  // importantly applyDock's own corrective synthetic resize — run ONE trailing
  // pass rather than dropping it. Previously that event was silently swallowed
  // (`if (__resizeQueued) return`), so the fitters never re-measured and the
  // page could stay not-full-width until the next real resize/navigation.
  if (__resizePending) {
    __resizePending = false;
    __resizeQueued = true;
    requestAnimationFrame(__runResizeSubs);
  }
}

// key: stable string id. fn: callback. Re-registering the same key replaces it.
// pri: lower runs earlier (default 100).
function onResize(key, fn, pri) {
  fn.__pri = typeof pri === 'number' ? pri : 100;
  __resizeSubs.set(key, fn);
}
function offResize(key) {
  __resizeSubs.delete(key);
}
// Scroll subscribers run un-debounced (scroll must feel immediate) but are
// batched into one rAF so multiple subscribers share a single frame.
function onScroll(key, fn) {
  __scrollSubs.set(key, fn);
}
function offScroll(key) {
  __scrollSubs.delete(key);
}

let __scrollQueued = false;
window.addEventListener('resize', () => {
  clearTimeout(__resizeTimer);
  __resizeTimer = setTimeout(() => {
    if (__resizeQueued) { __resizePending = true; return; }
    __resizeQueued = true;
    requestAnimationFrame(__runResizeSubs);
  }, 90);
}, { passive: true });

window.addEventListener('scroll', () => {
  if (__scrollQueued || !__scrollSubs.size) return;
  __scrollQueued = true;
  requestAnimationFrame(() => {
    __scrollQueued = false;
    __scrollSubs.forEach((fn) => { try { fn(); } catch (_) {} });
  });
}, { passive: true });

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

// revamp1075: `force` bypasses the memo. The memoised skip (below) is right for
// the ResizeObserver's frame-by-frame writes, but it also meant a value that got
// cached at a transitional height (e.g. the tall EXPANDED bar measured mid tab-
// switch → 105px for a resting 46px strip) stayed pinned forever, over-padding
// #content and under-sizing its scroller (the "subnav offset / stuck" bug).
// Discrete events (route change, tab switch, hero condense settle) pass force so
// the var is always re-written from the current resting box.
function setSubnavHeightVar(force) {
  const sub = document.getElementById('sub-header');
  if (!sub) return;
  const h = sub.offsetHeight;
  // revamp890: skip redundant writes. Re-setting a custom property to the same
  // value still invalidates style for every rule that consumes it.
  // Also: `h > 0` alone meant that when the subnav is emptied (search/custom
  // routes clear it), the PREVIOUS page's height stuck around and every
  // calc(--nav-h + --subnav-height) reserved phantom space. Clear it instead.
  if (force || h !== setSubnavHeightVar._h) {
    setSubnavHeightVar._h = h;
    if (h > 0) document.documentElement.style.setProperty('--subnav-height', `${h}px`);
    else document.documentElement.style.removeProperty('--subnav-height');
  }
  // The grey identity bar height (topic page). The name-picker dropdown hangs off
  // THIS bar's bottom so it overlays the (lower-hierarchy) control tabs. Falls back
  // to the whole subnav where there's no separate control bar (home).
  const title = sub.querySelector('.topic-subnav-title');
  const th = title ? title.offsetHeight : h;
  if (th > 0 && (force || th !== setSubnavHeightVar._th)) {
    setSubnavHeightVar._th = th;
    document.documentElement.style.setProperty('--subnav-title-h', `${th}px`);
  }
}

// Observe the subnav for any size change (CSS transitions, content
// reflow, viewport resize) and keep --subnav-height in lockstep so
// the body's padding-top tracks smoothly when the Content Shortcuts
// bar collapses/expands.
function observeSubnavHeight() {
  const sub = document.getElementById('sub-header');
  if (!sub || typeof ResizeObserver === 'undefined') return;
  if (subnavResizeObs) subnavResizeObs.disconnect();
  // revamp890: the callback wrote --subnav-height, which drives #content's
  // padding-top — resizing content, which could re-enter the observer. Batch
  // into one rAF and skip no-op writes so the loop can't chase itself frame by
  // frame (the topic-page shudder).
  let roQueued = false;
  subnavResizeObs = new ResizeObserver(() => {
    if (roQueued) return;
    roQueued = true;
    requestAnimationFrame(() => { roQueued = false; setSubnavHeightVar(); });
  });
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
let __bodyHeadH = null;         // revamp890: cached .topic-bodyhead height
function wireTopicHeroCondense() {
  if (topicHeroScrollHandler) document.removeEventListener('scroll', topicHeroScrollHandler, true);
  __bodyHeadH = null;
  // revamp890: the threshold derives from .topic-bodyhead's height, which was
  // re-measured (offsetHeight = forced layout) on EVERY scroll event. It only
  // changes on render/resize, so cache it and invalidate there instead.
  onResize('topic-bodyhead-h', () => { __bodyHeadH = null; });
  let queued = false;
  topicHeroScrollHandler = (e) => {
    const t = e.target;
    let st;
    if (t === document || t === window || (t && t.nodeType === 9)) {
      // The tab-less topic landing scrolls the DOCUMENT (the per-panel scrollers
      // only existed in the tabbed layout), and a document scroll event's target
      // is the document itself — not an element under #content. Without this the
      // band never un-hides on the landing page (revamp774).
      st = (document.scrollingElement || document.documentElement).scrollTop || 0;
    } else {
      if (!t || t.nodeType !== 1 || typeof t.closest !== 'function') return;
      // Only react to scrolls inside the topic content area.
      if (!t.closest('#content')) return;
      st = t.scrollTop || 0;
    }
    // Threshold: on desktop the sticky picker should only appear once the BODY
    // topic header (title + subtopics) has mostly scrolled away — so derive it
    // from that header's height. On mobile the header is display:none (height 0)
    // so it falls back to the small hero-condense threshold.
    if (__bodyHeadH === null) {
      const bh = document.querySelector('.topic-bodyhead');
      __bodyHeadH = bh ? bh.offsetHeight : 0;
    }
    const bhH = __bodyHeadH;
    // revamp1035: the bar used to arrive at (headHeight - 24), i.e. while ~24px
    // of the header was still on screen — and since the bar is a full-width
    // opaque band at top:0, that overlap is what read as a wash over the title
    // and pills. Wait until the header has FULLY cleared before showing it.
    const onThresh = Math.max(36, bhH + 6);
    const offThresh = Math.max(12, bhH - 30);
    // Hysteresis so it doesn't flicker at the boundary.
    const condensed = document.body.classList.contains('topic-hero-condensed');
    const next = !condensed && st > onThresh ? true
      : (condensed && st < offThresh ? false : null);
    if (next === null) return;                     // no state change → no write
    // revamp890: batch the class write into a frame. Toggling it inline from a
    // capture-phase scroll handler resized the sticky band mid-scroll, which
    // the --subnav-height ResizeObserver then chased frame-by-frame.
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      document.body.classList.toggle('topic-hero-condensed', next);
      // revamp1075: the condense changes the subnav's height; force a remeasure
      // now and once more after the CSS transition settles so --subnav-height
      // never lags behind the band (which left #content mis-padded and the bar
      // reading as "stuck/offset").
      setSubnavHeightVar(true);
      clearTimeout(setSubnavHeightVar._settle);
      setSubnavHeightVar._settle = setTimeout(() => setSubnavHeightVar(true), 320);
    });
  };
  // revamp890: was `true` (a bare capture flag), which also made this listener
  // NON-PASSIVE — a blocking scroll handler on document for every descendant
  // scroll. Passive + capture keeps the behaviour without blocking the
  // compositor.
  document.addEventListener('scroll', topicHeroScrollHandler, { passive: true, capture: true });
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
            <div class="tsp-group-label">Related Topics</div>
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

// Desktop body topic-header (revamp774): the topic name leads the landing page
// as its own section — a real page title with the related topics as quiet inline
// links beneath it, over a hairline. The sticky subnav band is hidden until the
// reader scrolls past this (wireTopicHeroCondense derives its threshold from this
// element's height), so the topic name is never on screen twice.
//
// "More" doubles as the picker's `.tsp-btn`: it appears only when the links
// overflow one line (wireSubtopicsMore), and opens the same dropdown the subnav
// band's "Change Topic" uses. Mobile keeps the band as the control — CSS hides
// this header below 900px.
// Every topic has its own generated hero graphic — its icon rendered as a
// halftone in the one site palette (scripts/gen-topic-art.py builds all 99
// from topics.json + topic-icons.js, so slug -> file is total by
// construction; rerun the generator when a topic or icon changes).
function topicHeroArt(topic) {
  return `/assets/hero/topics/${(topic && topic.slug) || 'world'}.webp?v=2`;
}

function topicBodyHeadHTML(topic) {
  const related = (getRelatedTopics(topic) || []).filter((t) => t && t.slug);
  const desc = getTopicDescription(topic.slug) || '';
  // revamp979: the subtopics are PILL BUTTONS now, led by an "Overview" pill.
  // On a subtopic page Overview points at the parent hub (the useful
  // destination — you're already on the subtopic); on a parent it points at
  // itself and reads as the active state.
  // Overview is THIS page's overview, so it's always the active pill. The
  // parent hub is then the first link after it (#img590).
  const parent = topic.parent ? getTopicBySlug(topic.parent) : null;
  const rest = related.filter((t) => t.slug !== topic.slug && (!parent || t.slug !== parent.slug));
  const ordered = parent ? [parent].concat(rest) : rest;
  // revamp1044: the "Overview" pill is retired — the page title already tells
  // you where you are. The subtopic links stand on their own.
  const pills = ordered.map((t) => `<a class="tbh-sub" href="#/topic/${escapeAttr(t.slug)}">${escapeHTML(t.name)}</a>`).join('');
  return `
    <header class="topic-bodyhead topic-subnav-picker" data-topic-picker>
      <a class="tbh-back" href="#/topics">${TBH_BACK_CHEV}<span>Topics</span></a>
      <div class="tbh-titlerow">
        <span class="tbh-titleic" aria-hidden="true">${topicIconSVG(topic.icon || 'globe', '')}</span>
        <h1 class="tbh-title">${escapeHTML(topic.name)}</h1>
      </div>
      ${desc ? `<p class="tbh-desc">${escapeHTML(desc)}</p>` : ''}
      <div class="tbh-subswrap">
        <nav class="tbh-subs" aria-label="Subtopics">
          ${pills}
          <button type="button" class="tbh-more tsp-btn" data-tbh-more hidden
                  aria-expanded="false" aria-controls="tsp-panel-body">More<span class="tbh-more-chev" aria-hidden="true">${TBH_MORE_CHEV}</span></button>
        </nav>
      </div>
      ${topicPickerPanelHTML(topic, 'tsp-panel-body')}
    </header>`;
}

// Subtopics show inline under the title; "More" is an INLINE continuation of the
// links that appears ONLY when some subtopics don't fit one line (then trailing
// links are hidden so "More" sits right after the last visible one). Clicking it
// opens the full topic picker. No-op on mobile (the body header is display:none).
// A paged scroll indicator for the phone tools rail (#img640). One dot per
// page of tiles, so a clipped rail reads as "there is more, here is where you
// are" instead of just looking cut off. Dots are also targets — tapping one
// pages the rail. Rebuilt on resize because the page count is derived from the
// rail's own width, which changes with the breakpoint.
function wireRailDots(list) {
  if (!list || list.dataset.railDots) return;
  list.dataset.railDots = '1';
  const dots = document.createElement('div');
  dots.className = 'tpr-dots';
  list.insertAdjacentElement('afterend', dots);
  let pages = 0;
  const mark = () => {
    if (!pages) return;
    const max = Math.max(1, list.scrollWidth - list.clientWidth);
    const i = Math.min(pages - 1, Math.round((list.scrollLeft / max) * (pages - 1)));
    Array.prototype.forEach.call(dots.children, (d, k) => d.classList.toggle('is-active', k === i));
  };
  const build = () => {
    const scrollable = list.scrollWidth - list.clientWidth > 4;
    dots.classList.toggle('is-on', scrollable);
    if (!scrollable) { dots.innerHTML = ''; pages = 0; return; }
    const n = Math.max(2, Math.ceil(list.scrollWidth / Math.max(1, list.clientWidth)));
    if (n !== pages) {
      pages = n;
      dots.innerHTML = Array.from({ length: n }, (_, i) =>
        `<button type="button" class="tpr-dot" aria-label="Tools page ${i + 1}"></button>`).join('');
      Array.prototype.forEach.call(dots.children, (d, i) => d.addEventListener('click', () => {
        list.scrollTo({ left: i * list.clientWidth, behavior: 'smooth' });
      }));
    }
    mark();
  };
  list.addEventListener('scroll', mark, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(build).observe(list);
  build();
}

function wireSubtopicsMore(root) {
  const subs = root.querySelector('.tbh-subs');
  const picker = root.querySelector('[data-topic-picker]');
  if (!subs || !picker) return;
  const more = subs.querySelector('[data-tbh-more]');
  if (!more) return;
  const links = [...subs.querySelectorAll('.tbh-sub')];
  // When "More" IS the picker's trigger (revamp774) wireSubnavPicker already owns
  // its click — re-firing .tsp-btn here would recurse into itself.
  if (more !== picker.querySelector('.tsp-btn')) {
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      picker.querySelector('.tsp-btn')?.click();
    });
  }
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
  onResize('subtopics-more', fit);   // revamp890: keyed — replaces on re-render
}

// Deep-link into a topic's sub-page (revamp763): sub-pages are real URLs now, so
// this is just a navigation. `group` may be a legacy accordion-row key, builder
// group, or old tab key — topicSubpageFor normalizes all of them.
function openTopicInsightInline(slug, group) {
  const page = topicSubpageFor(group);
  navigate('#/topic/' + slug + (page ? '/' + page : ''));
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
  // Topics / Trending / Prompts are pages now — there's no ✕ to press, but Esc
  // still needs an exit. Send it to the same place the "Back to …" bar points, so
  // the keyboard and the visible affordance agree.
  if (navDdOpen && ['topics', 'trending', 'prompts'].includes(navDdOpen.key)) {
    const pfx = '#/' + navDdOpen.key;
    const onDdRoute = hash === pfx || hash.startsWith(pfx + '/');
    closeNavDropdown();
    if (onDdRoute) navigate(backTarget().hash);
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
  // Topics / Trending / Prompts are PAGES, not overlays (revamp719): no ✕, no
  // click-outside-to-dismiss — a "Back to …" bar takes the ✕'s place.
  const asPage = ['topics', 'trending', 'prompts'].includes(cfg.key);
  // The Prompt Builder is page-like too, so it gets the same way back — but it
  // keeps its ✕ (it can be opened ON TOP of work you want to return to). The
  // Search panel is a true overlay over whatever you were reading: no back bar.
  const wantsBackBar = asPage;
  const closeBtn = asPage ? '' : `<button type="button" class="aii-nav-dd-close" data-navdd-close aria-label="Close">${X_IC_NAVDD}</button>`;
  const backBar = wantsBackBar ? backBarHTML() : '';
  const head = cfg.bareHead
    ? `<div class="aii-nav-dd-head aii-nav-dd-head-bare">${closeBtn}</div>`
    : `<div class="aii-nav-dd-head">
        <div class="aii-nav-dd-titles">
          <div class="aii-nav-dd-title">${cfg.icon ? `<span class="navdd-headic" aria-hidden="true">${cfg.icon}</span>` : ''}${cfg.spark ? '<span class="aii-nav-dd-spark">✦</span> ' : ''}${escapeHTML(cfg.title || '')}</div>
          ${cfg.subtitle ? `<div class="aii-nav-dd-sub">${escapeHTML(cfg.subtitle)}</div>` : ''}
          ${cfg.headSearch ? `<form class="navdd-headsearch" data-navdd-headsearch role="search">
              <span class="navdd-headsearch-ic" aria-hidden="true">${NAVDD_SEARCH_IC}</span>
              <input type="search" class="navdd-headsearch-input" placeholder="${escapeAttr(cfg.headSearch)}" aria-label="${escapeAttr(cfg.headSearch)}" autocomplete="off">
            </form>` : ''}
          ${Array.isArray(cfg.headButtons) && cfg.headButtons.length
            ? `<div class="aii-nav-dd-headbtns">${cfg.headButtonsLabel ? `<span class="aii-nav-dd-headbtns-label">${escapeHTML(cfg.headButtonsLabel)}</span>` : ''}${cfg.headButtons.map((b, i) => `<a href="${escapeAttr(b.href || '#')}" class="aii-nav-dd-headbtn${b.primary ? ' is-primary' : ''}" data-navdd-headbtn="${i}">${b.icon || ''}<span>${escapeHTML(b.label)}</span></a>`).join('')}</div>`
            : ''}
          ${cfg.headLink ? `<a href="${escapeAttr(cfg.headLink.href)}" class="aii-nav-dd-headlink" data-navdd-headlink><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>${escapeHTML(cfg.headLink.label)}</span></a>` : ''}
        </div>
        ${closeBtn}
      </div>`;
  panel.innerHTML = `
    <div class="aii-nav-dd-inner">
      ${backBar}
      ${head}
      ${cfg.subBarHTML ? `<div class="aii-nav-dd-subbar">${cfg.subBarHTML}</div>` : ''}
      <div class="aii-nav-dd-scrollwrap has-fade">
        <div class="aii-nav-dd-scroll" data-navdd-scroll>${cfg.contentHTML || ''}</div>
      </div>
    </div>`;
  const closeFn = cfg.onClose || closeNavDropdown;
  panel.querySelector('[data-navdd-close]')?.addEventListener('click', closeFn);
  panel.querySelector('[data-navdd-headsearch]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = (e.currentTarget.querySelector('input')?.value || '').trim();
    if (v) navigate(`#/custom/${encodeURIComponent(v)}`);
  });
  // Head action buttons (e.g. Topics: Homepage · Search Custom Topic).
  if (Array.isArray(cfg.headButtons)) {
    panel.querySelectorAll('[data-navdd-headbtn]').forEach((el) => {
      const b = cfg.headButtons[Number(el.dataset.navddHeadbtn)];
      if (b && typeof b.onClick === 'function') el.addEventListener('click', (e) => { e.preventDefault(); b.onClick(); });
    });
  }
  // Page-mode panels ignore overlay clicks — dismissing a page by clicking beside
  // it is exactly the pseudo-page behavior we're removing.
  overlay.onclick = asPage ? null : closeFn;
  const sc = panel;   // the PANEL scrolls now, not an inner div
  // revamp890: `panel` is a PERSISTENT element, so binding here on every
  // dropdown open stacked a fresh listener each time (ten opens = ten fade
  // recalcs per scroll event). Remove the previous binding before re-adding.
  if (sc) {
    if (sc.__ddFades) sc.removeEventListener('scroll', sc.__ddFades);
    sc.__ddFades = updateNavDdFades;
    sc.addEventListener('scroll', updateNavDdFades, { passive: true });
  }
  wireNavDdCondense(panel);
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
const PROMPTS_BUILD_IC = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const PROMPTS_LIB_IC = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
const AI_SPARK_INLINE = '<svg class="ph-spark" viewBox="0 0 24 24" width="13" height="13" fill="#2563eb" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg>';

// ── "Prompts by Topic" as a DIRECTORY (revamp737) ────────────────────────────
// One header per parent topic, then a flat list of accordions beneath it: the
// parent itself first, then each of its subtopics. Opening a topic reveals that
// topic's whole prompt set in place — a "Topic-Specific Prompts" section and an
// "Evergreen Prompts" section, each prompt its own accordion holding the full
// preview + model picker + submit. Nothing drills to another view: every prompt
// Standard Topic offers can be run from this one page.
const PH_ARROW_L = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
// revamp960: a featured prompt row carries the prompt's OWN registry icon, the
// same way a featured topic row carries the topic icon — the two homepage cards
// were listing topics with glyphs and prompts with nothing, which is what made
// the prompt list read as naked indented text.
const PROMPT_ROW_IC_FALLBACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="m9 10 1.2 2.3L12.5 13l-2.3 1.2L9 16.5 7.8 14.2 5.5 13l2.3-.7z" fill="currentColor" stroke="none"/></svg>';
function promptRowIconSVG(sh) {
  try {
    const key = sh && sh.icon;
    if (key) { const svg = renderIcon(key, ''); if (svg && /^<svg/.test(svg)) return svg; }
  } catch (_) {}
  return PROMPT_ROW_IC_FALLBACK;
}
// The wand that marks the AI Prompts card on the homepage — reused as the
// Featured Prompts head mark on the Prompts page so the two heads match.
const PROMPTS_FEAT_HEAD_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>';
// Quick-link glyphs under the homepage search bar (revamp978).
const QL_BRIEF_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.5 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-8"/><path d="M8 8h6M8 12h6M8 16h4"/><path d="M19.5 2.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="currentColor" stroke="none"/></svg>';
const QL_TREND_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>';
// Topic-page header controls (revamp979).
const TBH_BACK_CHEV = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const TBH_MORE_CHEV = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const PH_ARROW_R = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
const PDIR_CHEV = '<svg class="pdir-chev" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
function promptDirectoryHTML() {
  const groups = getTopicsGroupedByParent() || [];
  // revamp941: mirrors the All Topics subtopic link — icon + name, no chevron,
  // no per-cell chrome — so the two directories read as one component.
  const cell = (t) => `<button type="button" class="pdir-cell" data-pdir-topic data-slug="${escapeAttr(t.slug)}" data-name="${escapeAttr(t.name)}">
      <span class="pdir-cell-ic" aria-hidden="true">${topicIconSVG(t.icon || 'globe', '')}</span>
      <span class="pdir-cell-name">${escapeHTML(t.name)}</span>
    </button>`;
  const block = ({ parent, subtopics }) => `<section class="pdir-card" data-pdir-card>
      <button type="button" class="pdir-cardhead" aria-expanded="false">
        <span class="pdir-card-ic" aria-hidden="true">${topicIconSVG(parent.icon || 'globe', '')}</span>
        <span class="pdir-card-tx">
          <span class="pdir-card-name">${escapeHTML(parent.name)}</span>
        </span>
        ${PDIR_CHEV}
      </button>
      <div class="pdir-cardbody" hidden>
        <div class="pdir-grid">${cell(parent)}${(subtopics || []).map(cell).join('')}</div>
      </div>
    </section>`;
  return `<div class="pdir">${groups.map(block).join('')}</div>`;
}
const PDIR_CHEV_R = '<svg class="pdir-cell-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';

// Parent cards open to a grid of their topics; picking one swaps that card's body
// to that topic's full prompt set in place (with a way back), so the page never
// navigates away from the directory.
function wirePromptDirectory(root, ctls) {
  root.querySelectorAll('[data-pdir-card]').forEach((card) => {
    const head = card.querySelector('.pdir-cardhead');
    const bodyEl = card.querySelector('.pdir-cardbody');
    if (!head || !bodyEl) return;
    const gridHTML = bodyEl.innerHTML;
    const wireCells = () => {
      bodyEl.querySelectorAll('[data-pdir-topic]').forEach((cellBtn) => {
        cellBtn.addEventListener('click', () => {
          const slug = cellBtn.dataset.slug; const name = cellBtn.dataset.name;
          bodyEl.classList.add('is-topic');
          const parentName = card.querySelector('.pdir-card-name').textContent;
          let tIcon = ''; try { const tt = getTopicBySlug(slug); tIcon = topicIconSVG((tt && tt.icon) || 'globe', ''); } catch (_) {}
          card.classList.add('is-topicview');
          // revamp926: the drilled-in topic TAKES OVER the card header — its
          // name and icon replace the parent's, and a "Back to {parent}" link
          // appears above the title in a header that grows to fit it. The body
          // no longer repeats the name, so there's one title, not two.
          const icEl = head.querySelector('.pdir-card-ic');
          const nameEl = head.querySelector('.pdir-card-name');
          if (!card.__headOrig) {
            card.__headOrig = { ic: icEl ? icEl.innerHTML : '', name: nameEl ? nameEl.textContent : '' };
          }
          if (icEl && tIcon) icEl.innerHTML = tIcon;
          if (nameEl) nameEl.textContent = name;
          // revamp956: the back link lives in the BODY, above the section
          // headers — not in the header band, where it competed with the topic
          // title it had just replaced.
          card.querySelector('.pdir-headbar')?.remove();
          card.classList.remove('is-headback');
          bodyEl.innerHTML = `<div class="pdir-topicview">
            <button type="button" class="pdir-bodyback">${BACKBAR_CHEV}<span>Back to ${escapeHTML(parentName)}</span></button>
            <div class="pdir-topichost prompts-topic-host"></div>
          </div>`;
          const host = bodyEl.querySelector('.pdir-topichost');
          let shortcuts = [];
          try { shortcuts = getShortcutsForTopic(slug) || []; } catch (_) {}
          const descriptions = {}; const icons = {};
          shortcuts.forEach((sc) => { if (sc && sc.name) { descriptions[sc.name] = sc.description || ''; icons[sc.name] = sc.icon || ''; } });
          try {
            const c = renderAIIntelligence(host, {
              inModal: true, initialBuilder: true, initialGroup: 'external', lockTopic: true,
              topic: name, label: name, descriptions, icons, shortcuts, topicKey: slug,
            });
            if (ctls) ctls.push(c);
          } catch (err) {
            console.error('prompt directory mount failed', slug, err);
            host.innerHTML = '<p class="aii-empty">Couldn’t load these prompts.</p>';
          }
          // ✕ collapses the parent card outright, rather than stepping back to
          // the topic grid the way the back link does.
          const restoreHead = () => {
            card.classList.remove('is-headback');
            const o = card.__headOrig;
            if (o) {
              const ic2 = head.querySelector('.pdir-card-ic');
              const nm2 = head.querySelector('.pdir-card-name');
              if (ic2) ic2.innerHTML = o.ic;
              if (nm2) nm2.textContent = o.name;
            }
            card.querySelector('.pdir-headbar')?.remove();
          };
          card.__restoreHead = restoreHead;
          bodyEl.querySelector('.pdir-bodyback')?.addEventListener('click', (e) => {
            e.stopPropagation();
            restoreHead();
            bodyEl.classList.remove('is-topic');
            card.classList.remove('is-topicview');
            bodyEl.innerHTML = gridHTML;
            wireCells();
            requestAnimationFrame(updateNavDdFades);
          });
          requestAnimationFrame(updateNavDdFades);
        });
      });
    };
    wireCells();
    head.addEventListener('click', () => {
      const open = !card.classList.contains('is-open');
      // revamp926: collapsing while drilled in resets the header and the body
      // back to the topic grid, so re-opening never shows a stale sub-topic.
      if (!open && card.classList.contains('is-topicview')) {
        if (card.__restoreHead) card.__restoreHead();
        card.classList.remove('is-topicview');
        bodyEl.classList.remove('is-topic');
        bodyEl.innerHTML = gridHTML;
        wireCells();
      }
      bodyEl.hidden = !open;
      card.classList.toggle('is-open', open);
      head.setAttribute('aria-expanded', String(open));
      requestAnimationFrame(updateNavDdFades);
    });
  });
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
  // Every AI-component instance the directory has mounted, so switching views
  // tears them all down rather than leaking one per opened topic.
  let dirCtls = [];
  const destroyDirCtls = () => {
    dirCtls.forEach((c) => { if (c && c.destroy) { try { c.destroy(); } catch (_) {} } });
    dirCtls = [];
  };
  const destroyCtl = () => {
    if (ctl && ctl.destroy) { try { ctl.destroy(); } catch (_) {} }
    ctl = null;
    destroyDirCtls();
  };
  // The shell head IS the view header — update its title + subtitle per view so
  // there's no duplicate heading inside the body.
  const setHead = (title, sub) => {
    const t = panel.querySelector('.aii-nav-dd-title');
    if (t) {
      // revamp1135 — preserve the page-title icon (textContent would wipe it,
      // which is why the Prompts page showed no icon).
      const ic = t.querySelector('.navdd-headic');
      t.textContent = title;
      if (ic) t.insertBefore(ic, t.firstChild);
    }
    const s = panel.querySelector('.aii-nav-dd-sub'); if (s) s.textContent = sub;
  };
  // The header action buttons only make sense on the landing view.
  const setHeadBtns = (show) => { const b = panel.querySelector('.aii-nav-dd-headbtns'); if (b) b.style.display = show ? '' : 'none'; };
  const fades = () => [200, 700, 1500].forEach((d) => setTimeout(updateNavDdFades, d));
  // Back button lives ABOVE the view title (in the head), not below it in the body
  // (#img222/#img223/#img224). Pass null to remove it (the landing view).
  const setBack = (label, onClick) => {
    const titles = panel.querySelector('.aii-nav-dd-titles');
    if (!titles) return;
    titles.querySelector('[data-prompts-back]')?.remove();
    // A view-level back link REPLACES the page-level "Back to …" bar — two
    // stacked back links read as a bug rather than a hierarchy (#img26).
    const pageBar = panel.querySelector('.page-backbar');
    if (pageBar) pageBar.hidden = !!label;
    if (!label) return;
    // Built from the SAME markup as backBarHTML so the two are indistinguishable
    // — the view-level link used its own pill and chevron, which is why the back
    // control looked different from page to page (#img62-66).
    const wrap = document.createElement('div');
    wrap.className = 'page-backbar page-backbar--inview';
    wrap.setAttribute('data-prompts-back', '');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'page-backbtn';
    b.innerHTML = `${BACKBAR_CHEV}<span class="page-backbtn-tx">Back to ${escapeHTML(label)}</span>`;
    b.addEventListener('click', onClick);
    wrap.appendChild(b);
    titles.insertBefore(wrap, titles.firstChild);
  };

  const showLanding = () => {
    destroyCtl();
    setHead('Prompts', 'Ready-made prompts for every topic, or build your own.');
    setBack(null);
    setHeadBtns(true);
    // revamp1082: full rebuild of the Prompts landing — one full-width scroll,
    // no sub-tabs, no narrow Build sidebar. Featured Prompts (multi-column) →
    // Prompts by Topic → a full-width Build a Prompt promo at the very bottom
    // that expands the builder inline in place (so it has the whole bottom of
    // the page to grow into).
    root.innerHTML = `
      <div class="prompts-home prompts-home--v2">
        <section class="ph-featured" data-ph-featured hidden>
          <div class="ph-sec-head ph-sec-head--card">
            <div class="ph-sec-headrow">
              <span class="ph-sec-ic" aria-hidden="true">${PROMPTS_FEAT_HEAD_IC}</span>
              <h3 class="ph-sec-title">Featured Prompts</h3>
            </div>
            <p class="ph-sec-sub">Handpicked to get you started.</p>
          </div>
          <div class="ph-flist" data-ph-rail></div>
          <button type="button" class="ph-flist-more" data-ph-more hidden></button>
        </section>

        <section class="ph-lib">
          <div class="ph-sec-head ph-sec-head--card ph-sec-head--hastoggle">
            <div class="ph-sec-head-tx">
              <div class="ph-sec-headrow">
                <span class="ph-sec-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></span>
                <h3 class="ph-sec-title">Prompts by Topic</h3>
              </div>
              <p class="ph-sec-sub">Explore by category. Open one to run any prompt right here.</p>
            </div>
            <button type="button" class="trend-sports-toggle pdir-expandall" data-pdir-expandall role="switch" aria-checked="false" title="Expand every category"><span class="trend-sports-toggle-label">Expand all</span><span class="trend-sports-toggle-track"><span class="trend-sports-toggle-thumb"></span></span></button>
          </div>
          <div class="ph-body" data-ph-body></div>
        </section>

        <section class="ph-buildzone" data-ph-buildzone>
          <div class="ph-buildpromo" data-ph-buildpromo>
            <span class="ph-build-ic" aria-hidden="true">${PROMPTS_BUILD_HEAD_IC}</span>
            <div class="ph-buildpromo-tx">
              <h3 class="ph-build-title">Build a Prompt</h3>
              <p class="ph-build-sub">Start from scratch and shape a prompt around any topic — every option laid out in one place, no digging through menus.</p>
            </div>
            <button type="button" class="ph-build-btn" data-cta-build>Start building${PH_ARROW_R}</button>
          </div>
          <div class="ph-buildhost" data-ph-build-host hidden></div>
        </section>
      </div>`;

    // The Build promo expands the builder INLINE at the bottom of the page
    // (rather than swapping to a separate view), so the whole prompt form shows
    // in one vertical scroll. Loaded lazily on first open.
    {
      const buildzone = root.querySelector('[data-ph-buildzone]');
      const buildHost = root.querySelector('[data-ph-build-host]');
      let buildLoaded = false;
      root.querySelectorAll('[data-cta-build]').forEach((b) => b.addEventListener('click', () => {
        buildzone.classList.add('is-building');
        buildHost.hidden = false;
        if (!buildLoaded) {
          buildLoaded = true;
          loadPromptGen()
            .then((m) => m.renderPromptGenerator(buildHost, { inline: true }))
            .catch(() => {});
        }
        requestAnimationFrame(() => buildzone.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        syncViewHash('build');
      }));
    }

    // ── Featured rail ──────────────────────────────────────────────────────
    // A horizontally scrollable card row. Clicking a card turns THAT card into a
    // focused prompt panel in place (with a way back) rather than navigating.
    fetchWithTimeout('/data/featured-prompts.json', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        const rail = root.querySelector('[data-ph-rail]');
        const sec = root.querySelector('[data-ph-featured]');
        if (!rail || !sec || !cfg || !Array.isArray(cfg.featured)) return;
        const picks = [];
        cfg.featured.forEach((f) => {
          const t = getTopicBySlug(f.topic); if (!t) return;
          let sc = []; try { sc = getShortcutsForTopic(f.topic) || []; } catch (_) { return; }
          const sh = sc.find((x) => x && x.name === f.name);
          if (sh && sh.prompt) picks.push({ sh, topic: t });
        });
        if (!picks.length) return;
        // revamp1014: the featured list is the shared prompt component — every
        // row is a bordered accordion that opens in place with Edit / Model /
        // Copy / Settings / Run, instead of swapping the section into a
        // single-prompt "focus" view. {topic} is resolved per pick because the
        // featured set spans topics.
        try {
          dirCtls.push(renderAIIntelligence(rail, promptEmbedScope(picks.map((pk) => ({
            ...pk.sh, evergreen: false,
            prompt: resolveTopicPlaceholder(pk.sh.prompt, pk.topic.name),
          })))));
        } catch (_) {}
        sec.hidden = false;
        const moreBtn = sec.querySelector('[data-ph-more]');
        if (moreBtn) {
          const CAP = 6;
          if (picks.length > CAP) {
            moreBtn.hidden = false;
            const sync = () => { moreBtn.textContent = sec.classList.contains('is-expanded') ? 'Show less' : 'Show more'; };
            sync();
            moreBtn.addEventListener('click', () => { sec.classList.toggle('is-expanded'); sync(); });
          }
        }
        requestAnimationFrame(updateNavDdFades);
      }).catch(() => {});

    // ── Prompts by Topic ───────────────────────────────────────────────────
    const body = root.querySelector('[data-ph-body]');
    body.innerHTML = promptDirectoryHTML();
    wirePromptDirectory(body, dirCtls);
    // revamp1128 — "Expand all" opens/closes every Prompts-by-Topic category.
    const pdirSw = root.querySelector('[data-pdir-expandall]');
    if (pdirSw && !pdirSw.__wired) {
      pdirSw.__wired = true;
      pdirSw.addEventListener('click', () => {
        const on = pdirSw.getAttribute('aria-checked') !== 'true';
        pdirSw.setAttribute('aria-checked', String(on));
        body.querySelectorAll('.pdir-card').forEach((card) => {
          const bEl = card.querySelector('.pdir-cardbody');
          const hd = card.querySelector('.pdir-cardhead');
          card.classList.toggle('is-open', on);
          if (bEl) bEl.hidden = !on;
          if (hd) hd.setAttribute('aria-expanded', String(on));
        });
      });
    }
    // revamp1146 — Prompts page tab nav (tab mode only): switch between the
    // Featured Prompts and Prompts by Topic sections.
    const pTabs = root.querySelector('[data-prompts-viewtabs]');
    const pHome = root.querySelector('.prompts-home--v2');
    if (pTabs && pHome && !pTabs.__wired) {
      pTabs.__wired = true;
      pTabs.querySelectorAll('[data-pview]').forEach((b) => b.addEventListener('click', () => {
        const v = b.dataset.pview;
        pHome.classList.toggle('pview-topics', v === 'topics');
        pHome.classList.toggle('pview-featured', v === 'featured');
        pTabs.querySelectorAll('[data-pview]').forEach((x) => { const on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-selected', String(on)); });
        window.scrollTo(0, 0);
      }));
    }
    syncViewHash(null);
    requestAnimationFrame(updateNavDdFades);
  };

  const showBuild = () => {
    destroyCtl();
    setHead('Build a Prompt', 'Craft a knowledge prompt and send it to your AI model.');
    setHeadBtns(false); setBack('Back to Prompts', showLanding);
    root.innerHTML = `<div class="pb-navdd-host" data-pb-host></div>`;
    loadPromptGen().then((m) => m.renderPromptGenerator(root.querySelector('[data-pb-host]'), { inline: true })).catch(() => {});
    syncViewHash('build');
    fades();
  };

  const showLibrary = () => {
    destroyCtl();
    setHead('Prompt Library', 'Every topic and subtopic, with its full prompt set.');
    setHeadBtns(false); setBack('Back to Prompts', showLanding);
    root.innerHTML = promptDirectoryHTML();
    wirePromptDirectory(root, dirCtls);
    syncViewHash('library');
    requestAnimationFrame(updateNavDdFades);
  };

  // Expose the view switcher for route changes while mounted, then show the
  // requested initial view (a #/prompts/build|library deep-link) or the landing.
  promptsDdShowView = (v) => { if (v === 'build') showBuild(); else if (v === 'library') showLibrary(); else showLanding(); };
  // Drill INTO the Prompt Library (revamp764 — the retired dedicated
  // single-topic view is gone): open the topic's parent card in the directory,
  // open that topic's prompt set in place, then expand the named prompt. The
  // pieces mount async, so each step retries a few frames (#img372).
  promptsDdOpenPrompt = (slug, name, promptName) => {
    showLibrary();
    const t = getTopicBySlug(slug);
    const parent = t && t.parent ? (getTopicBySlug(t.parent) || t) : t;
    const parentName = (parent && parent.name) || name;
    const card = [...root.querySelectorAll('.pdir-card')].find((c) => {
      const nm = c.querySelector('.pdir-card-name');
      return nm && nm.textContent.trim() === parentName;
    });
    if (!card) return;
    if (!card.classList.contains('is-open')) card.querySelector('.pdir-cardhead')?.click();
    const expandPrompt = (attempt) => {
      const sums = card.querySelectorAll('.pdir-topichost .aii-fi-accsum');
      const match = [...sums].find((s) => {
        const nm = s.querySelector('.aii-fi-acc-name');
        return nm && nm.textContent.trim() === promptName;
      });
      if (match) {
        if (match.getAttribute('aria-expanded') !== 'true') match.click();
        requestAnimationFrame(() => { try { match.scrollIntoView({ block: 'center' }); } catch (_) {} });
      } else if (attempt < 14) {
        setTimeout(() => expandPrompt(attempt + 1), 70);
      }
    };
    const openTopic = (attempt) => {
      const cell = card.querySelector(`[data-pdir-topic][data-slug="${slug}"]`);
      if (cell) { cell.click(); expandPrompt(0); }
      else if (attempt < 14) setTimeout(() => openTopic(attempt + 1), 70);
    };
    openTopic(0);
  };
  promptsDdShowView(initialView || null);
}

const PROMPTS_BUILD_HEAD_IC = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="m16.5 3.5 4 4L7 21l-4 1 1-4z"/></svg>';
function promptsNavDdCfg(view) {
  return {
    key: 'prompts', triggerId: 'nav-prompts', className: 'aii-nav-dd-prompts',
    title: 'Prompts', ariaLabel: 'Prompts',
    subtitle: 'Ready-made prompts for every topic, or build your own.',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    // revamp893: "Build Prompt" is no longer a header action — it's a card at the
    // top of the body, beside Featured Prompts (see showLanding).
    headButtons: [],
    contentHTML: '<div class="prompts-dd" data-prompts-root></div>',
    onClose: userCloseNavDropdown,
    wire: (panel) => wirePromptsDropdown(panel, view),
  };
}
// View switcher exposed while the Prompts dropdown is mounted, so a route change
// (#/prompts ↔ /build ↔ /library, e.g. via back/forward) swaps views in place.
let promptsDdShowView = null;
// Set while the Prompts dropdown is mounted: drill straight to a topic's prompt
// list and expand a specific prompt (used by the homepage Popular Prompts chips).
let promptsDdOpenPrompt = null;
// Open the Prompt Library to a specific prompt (topic list → expand that prompt),
// retrying until the dropdown has mounted and exposed its drill-in hook (#img372).
function openPromptInLibrary(slug, name, promptName) {
  const drill = (attempt) => {
    if (promptsDdOpenPrompt) { promptsDdOpenPrompt(slug, name, promptName); return; }
    if (attempt < 24) setTimeout(() => drill(attempt + 1), 60);
  };
  if (navDdOpen && navDdOpen.key === 'prompts') { drill(0); return; }
  navigate('#/prompts/library');
  drill(0);
}
function openPromptsNavDropdown(view) {
  if (navDdOpen && navDdOpen.key === 'prompts') { if (promptsDdShowView) promptsDdShowView(view || null); return; }
  openNavDropdown(promptsNavDdCfg(view || null));
}
// Route-driven toggle shared by the three deep-linkable dropdowns: open → close
// (returning home if on the route); closed → navigate to the route (or open
// directly when the hash is already there, where navigate() would no-op).
function navDdRouteToggle(key, openFn) {
  // revamp824 — Topics / Trending / Prompts are REAL PAGES. This used to fall
  // back to openFn() when you were already on the route, which re-opened the
  // old fixed overlay ON TOP of the page: the same page rendered two different
  // ways depending on how you got there, and the sticky subnav vanished behind
  // the sheet. On-route is now a no-op (scroll home instead) — the overlay path
  // is gone for these three.
  if (['topics', 'trending', 'prompts'].includes(key)) {
    const target = '#/' + key;
    const h = routeHash() || '';
    if (h === target || h.startsWith(target + '/')) window.scrollTo({ top: 0, behavior: 'smooth' });
    else navigate(target);
    return;
  }
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
    const links = `<a href="#/topic/${parent.slug}" class="aiidd-vall" data-aiidd-link><span class="aiidd-vlink-ic" aria-hidden="true">${topicIconSVG(parent.icon || 'globe', '')}</span><span class="aiidd-vlink-name">${escapeHTML(parent.name)}</span>${AIIDD_CHEV_R}</a>`
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
  // revamp1047: a small page header over the tree — the grey subnav only names
  // the page; this explains what the list does.
  const GRID_HEAD_IC = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
  const head = `<header class="aiidd-pagehead">
    <div class="aiidd-pagehead-tx">
      <div class="aiidd-headrow">
        <span class="aiidd-head-ic" aria-hidden="true">${GRID_HEAD_IC}</span>
        <h2 class="aiidd-pagehead-title">All Topics</h2>
      </div>
      <p class="aiidd-pagehead-sub">Expand a topic section to reach its parent topic and subtopic pages.</p>
    </div>
    <button type="button" class="trend-sports-toggle aiidd-expandall" data-topics-expandall role="switch" aria-checked="false" title="Expand every topic's subtopics"><span class="trend-sports-toggle-label">Expand all</span><span class="trend-sports-toggle-track"><span class="trend-sports-toggle-thumb"></span></span></button>
  </header>`;
  // revamp1122 — Featured Topics: a handpicked mix across parents AND subtopics
  // (news-heavy, broad appeal), in a multi-column grid above All Topics.
  const FEATURED_TOPIC_SLUGS = [
    'artificial-intelligence', 'world', 'us-politics', 'markets', 'cryptocurrency',
    'technology', 'nfl', 'health-wellness', 'astronomy-space', 'cybersecurity',
    'economy', 'climate-environment', 'middle-east', 'entertainment', 'soccer',
  ];
  const featItems = FEATURED_TOPIC_SLUGS.map((slug) => {
    const t = getTopicBySlug(slug);
    if (!t) return '';
    return `<a href="#/topic/${t.slug}" class="tfeat-item" data-aiidd-link>
      <span class="tfeat-ic" aria-hidden="true">${topicIconSVG(t.icon || 'globe', '')}</span>
      <span class="tfeat-name">${escapeHTML(t.name)}</span>
      <span class="tfeat-arrow" aria-hidden="true">${AIIDD_CHEV_R}</span>
    </a>`;
  }).join('');
  const FEAT_TOPICS_IC = '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.72 5.51 6.08.88-4.4 4.29 1.04 6.06L12 16.98l-5.44 2.86 1.04-6.06-4.4-4.29 6.08-.88z"/></svg>';
  const featuredSection = `<section class="tfeat-section">
    <header class="aiidd-pagehead tfeat-head">
      <div class="aiidd-pagehead-tx">
        <div class="aiidd-headrow">
          <span class="aiidd-head-ic" aria-hidden="true">${FEAT_TOPICS_IC}</span>
          <h2 class="aiidd-pagehead-title">Featured Topics</h2>
        </div>
        <p class="aiidd-pagehead-sub">A handpicked mix of the most-followed areas, across parent topics and subtopics.</p>
      </div>
    </header>
    <div class="tfeat-grid">${featItems}</div>
  </section>`;
  // The "All Topics" head loses its subtext label in this context — the section
  // header carries the meaning. Keep it for the accordion tree below.
  return `${featuredSection}${head}<div class="aiidd-tree">${groups.map(block).join('')}</div>`;
}
function topicsNavDdCfg() {
  return {
    key: 'topics', triggerId: 'nav-topics', className: 'aii-nav-dd-topics',
    title: 'Topics', ariaLabel: 'All topics',
    // The glyph the condensed bar shows beside the name (revamp810).
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    subtitle: 'Browse every topic and its subtopics.',
    // One head button: Search Custom Topic (the Homepage button was dropped — the
    // brand/Home nav already covers it, #img77).
    // revamp809: the search field is replaced by a view toggle — Condensed
    // (parents closed, the default) or Expanded (every subtopic list open).
    // revamp937: a compact "List: Condensed | Expanded" control rather than two
    // large pills — it rides beside the subtitle on wide screens.
    contentHTML: topicsTreeHTML(),
    onClose: userCloseNavDropdown,
    wire: (panel) => {
      wireNavDdAccordions(panel);
      panel.querySelectorAll('[data-aiidd-link]').forEach((a) => a.addEventListener('click', () => closeNavDropdown()));
      // revamp1108: one "Expand all" switch drives it — inline beside "Navigate
      // Topics" on wide screens, in the grey subnav once it takes over. Both
      // controls call the same setView, which keeps every switch in sync.
      const inlineSw = panel.querySelector('[data-topics-expandall]');
      const setView = (expanded) => {
        panel.classList.toggle('is-topics-expanded', expanded);
        panel.querySelectorAll('.aiidd-parent').forEach((sec) => {
          sec.setAttribute('data-open', expanded ? 'true' : 'false');
          const head = sec.querySelector('.aiidd-parent-head');
          if (head) head.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        });
        if (inlineSw) inlineSw.setAttribute('aria-checked', String(expanded));
        document.querySelector('#sub-header [data-topics-expand]')?.setAttribute('aria-checked', String(expanded));
      };
      window.__topicsSetView = setView;
      inlineSw?.addEventListener('click', () => setView(inlineSw.getAttribute('aria-checked') !== 'true'));
      setView(false);
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
  if (!expandQuery && pendingTrendingExpand) { expandQuery = pendingTrendingExpand; pendingTrendingExpand = null; }
  return {
    key: 'trending', triggerId: 'nav-trending', className: 'aii-nav-dd-trending',
    title: 'Trending', ariaLabel: 'Trending now',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>',
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
  // A route-driven open (no arg) consumes any expand request stashed by the
  // open-trending-list handler before it navigated here.
  if (!expandQuery && pendingTrendingExpand) { expandQuery = pendingTrendingExpand; pendingTrendingExpand = null; }
  if (navDdOpen && navDdOpen.key === 'trending' && !expandQuery) return;
  openNavDropdown(trendingNavDdCfg(expandQuery));
}
let pendingTrendingExpand = null;

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
// ── Topic sub-pages (revamp763) ──────────────────────────────────────────────
// The tabbed topic page is gone. The topic LANDING hosts the AI Briefings
// card, two gateway cards (Web Resources / AI Prompts) and the news feed; each
// former tab is now a full flip SUB-PAGE at its own URL (/topic/{slug}/{page}),
// reached by real navigation, with a sticky "Back to {Topic}" bar rendered in
// the sub-header where the tab strip used to live.
const TOPIC_SUBPAGES = {
  intelligence: { label: 'AI Briefings' },
  websources:   { label: 'Web Resources' },
  prompts:      { label: 'AI Prompts' },
};
// Legacy URL segments / deep-link keys → the sub-page that replaced them, so old
// links (#/topic/x/ai-insights, /explore, /shortcuts, builder groups) still land
// somewhere sensible.
const TOPIC_SUBPAGE_ALIAS = {
  'ai-insights': 'intelligence', briefing: 'intelligence', catchup: 'intelligence',
  deepdive: 'intelligence', overview: 'intelligence', discover: 'intelligence',
  'topic-specific': 'intelligence', learn: 'intelligence', ai: 'intelligence',
  explore: 'websources', websearch: 'websources',
  shortcuts: 'prompts', 'topic-prompts': 'prompts', 'evergreen-prompts': 'prompts', external: 'prompts',
};
// revamp777: the topic sub-pages are RETIRED. AI Briefings and AI Prompts
// expand inline on the landing page, and Web Resources is gone entirely (the
// search page covers that job better — nobody searches a bare topic name on
// YouTube). Every legacy sub-page URL now resolves to the landing; the router
// rewrites the address so the old deep links keep working.
function topicSubpageFor() { return null; }
function isLegacyTopicSubpage(tab) {
  return !!(tab && (TOPIC_SUBPAGES[tab] || TOPIC_SUBPAGE_ALIAS[tab]));
}
// Leading icons for the topic-page cards and rows.
const TOPIC_AI_ICONS = {
  discover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5"/></svg>',
  deepdive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.2" y1="16.2" x2="21" y2="21"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  learn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 9L12 4 2 9l10 5 10-5z"/><path d="M6 11.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5"/></svg>',
  'topic-specific': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 9 9 9 9 0 0 1-9 9"/><polyline points="12 21 8.5 17.5 12 14"/><line x1="12" y1="7.5" x2="12" y2="12"/><line x1="12" y1="12" x2="15.5" y2="14"/></svg>',
  models: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="3"/><line x1="12" y1="4" x2="12" y2="8"/><circle cx="12" cy="3" r="1.3"/><line x1="9" y1="13" x2="9" y2="15"/><line x1="15" y1="13" x2="15" y2="15"/></svg>',
  websearch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>',
};
const SUBPAGE_ARROW = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';

// Which of the day's two waves a briefing came from (revamp779). The crons run
// at 12:00 UTC (8am ET) and 00:00 UTC (8pm ET), so an ET clock splits them
// cleanly — anything stamped between 4am and 4pm ET is that morning's edition,
// everything else is the night's. Reads "Last Updated: August 17 (Morning
// Edition)" so the card says WHICH briefing you're looking at, not just when.
function diEditionParts(iso) {
  try {
    const d = new Date(iso);
    const et = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...opts }).format(d);
    const hour = Number(et({ hour: 'numeric', hour12: false }));
    return {
      day: et({ month: 'short', day: 'numeric' }),
      time: et({ hour: 'numeric', minute: '2-digit' }) + ' ET',
      edition: hour >= 4 && hour < 16 ? 'Morning Edition' : 'Night Edition',
    };
  } catch (_) { return null; }
}
// A masthead dateline, not a status light (revamp782): the edition's own glyph
// — sun for the morning wave, moon for the night — then the date and the
// edition name. No chrome, no pulsing dot.
// The same filled spark every other AI surface uses for provenance.
const DI_SPARK_TWO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.5 3l1.55 4.4a2 2 0 0 0 1.25 1.25L17.7 10.2l-4.4 1.55a2 2 0 0 0-1.25 1.25L10.5 17.4l-1.55-4.4a2 2 0 0 0-1.25-1.25L3.3 10.2l4.4-1.55a2 2 0 0 0 1.25-1.25z"/><path d="M17.8 14.6l.75 2.15 2.15.75-2.15.75-.75 2.15-.75-2.15-2.15-.75 2.15-.75z"/></svg>';
// revamp852 — the AI Briefings preview card, shared by the homepage, the
// topic pages and the hub's Today's Briefing. A darker-blue header band carries
// the (colour-flipped) sparkle icon + title, with an optional "View Intelligence
// Hub" access-link riding right of the title; the light body below holds the
// sublabel, the Today's Briefing header + edition stamp, a "Topic: X" data
// label, the summary, and the "View briefing" control.
function diHeroCardHTML(o) {
  o = o || {};
  const X_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const headerTitle = o.headerTitle || 'AI Briefings';
  // revamp898: no "Topic:" prefix — the name reads as an all-caps standfirst
  // directly beneath AI Briefing title.
  const topicRow = o.topicLabel ? `<div class="tdi-topiclabel"><span class="tdi-topiclabel-v">${escapeHTML(o.topicLabel)}</span></div>` : '';
  const hubTag = o.hubTagline ? `<p class="tdi-hubline"><a href="#/intelligence">Access the AI Briefings Hub${SUBPAGE_ARROW}</a></p>` : '';
  const HUB_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M21.2 12h-2M4.8 12h-2M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4M18.5 18.5l-1.4-1.4M6.9 6.9L5.5 5.5"/></svg>';
  const HUB_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3.5"/></svg>';
  const HUB_AI = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.6l1.85 5.25a3 3 0 0 0 1.8 1.8L20.9 11.5l-5.25 1.85a3 3 0 0 0-1.8 1.8L12 20.4l-1.85-5.25a3 3 0 0 0-1.8-1.8L3.1 11.5l5.25-1.85a3 3 0 0 0 1.8-1.8z"/></svg>';
  const hubCard = o.hubCard ? `<aside class="tdi-hubcard">
        <div class="tdi-hubcard-head">
          <h4 class="tdi-hubcard-title">View more AI Briefings</h4>
        </div>
        <p class="tdi-hubcard-sub tdi-hubcard-sub--d">Briefings across 100+ topics, refreshed morning and night.</p>
        <p class="tdi-hubcard-sub tdi-hubcard-sub--m">Briefings across 100+ topics, refreshed morning and night.</p>
        <div class="tdi-hubcard-feats">
          <div class="tdi-hubfeat"><span class="tdi-hubfeat-ic">${HUB_AI}</span><span class="tdi-hubfeat-tx">AI-generated</span></div>
          <div class="tdi-hubfeat"><span class="tdi-hubfeat-ic">${HUB_SUN}</span><span class="tdi-hubfeat-tx">Updates twice daily</span></div>
          <div class="tdi-hubfeat"><span class="tdi-hubfeat-ic">${HUB_DOC}</span><span class="tdi-hubfeat-tx">100+ topics</span></div>
        </div>
        <!-- revamp897: ONE text link for every breakpoint — the desktop pill and
             the separate mobile variant have collapsed into this. -->
        <a class="tdi-hubcard-go tdi-hubcard-cta" href="#/intelligence">Access AI Briefings${SUBPAGE_ARROW}</a>
      </aside>` : '';
  // revamp895: the standalone card (topic pages + the hub's own Today card)
  // drops the header band too — the card IS the Daily Read, so a separate
  // "AI Briefings" title bar around it was redundant chrome.
  const header = (o.hubCard || o.noHeader) ? '' : `
    <div class="tdi-hero-head">
      <div class="tdi-hero-titlerow">
        <span class="tdi-hero-ic" aria-hidden="true">${DI_SPARK_TWO}</span>
        <h2 class="tdi-card-title">${escapeHTML(headerTitle)}</h2>
        <button type="button" class="tdi-headclose" data-di-toggle aria-label="Close briefing">${X_SVG}<span>Close Briefing</span></button>
      </div>
      <p class="tdi-hero-sub">${escapeHTML(o.sublabel || '')}</p>
      ${hubTag}
    </div>`;
  return `${header}
    <div class="tdi-hero-body${o.hubCard ? ' tdi-hero-body--split' : ''}">
      ${o.art ? `<div class="tdi-art" data-tdi-art aria-hidden="true"><img class="tdi-art-img" data-tdi-art-img
          src="/assets/briefing/morning-1280.webp?v=3"
          srcset="/assets/briefing/morning-800.webp?v=3 800w, /assets/briefing/morning-1280.webp?v=3 1280w"
          sizes="(max-width: 1023px) 100vw, 640px" alt="" decoding="async" loading="lazy"></div>` : ''}
      <div class="tdi-bodygrid">
        <div class="tdi-briefcol">
          ${o.art ? `
          <!-- revamp987: with the art variant the hierarchy is eyebrow →
               headline → one meta line, so the card reads top-down and gets
               shorter. The eyebrow's wording and glyph follow the edition and
               are filled by applyBriefArt(). -->
          <div class="tdi-eyebrow" data-tdi-eyebrow>
            <span class="tdi-eyebrow-ic" data-tdi-eyebrow-ic aria-hidden="true">${DI_SUN}</span>
            <span class="tdi-eyebrow-tx" data-tdi-eyebrow-tx>Today\u2019s Briefing</span>
          </div>
          <div class="tdi-todayhead">
            <h3 class="tdi-today-title">Your 5-minute AI briefing</h3>
          </div>
          <!-- revamp1043: the topic pill sits on its own line; the date + publish
               time run below it (weightier), no separator pill on the same row. -->
          <div class="tdi-metarow tdi-metarow--stack">
            ${o.topicLabel ? `<span class="tdi-topiclabel tdi-topiclabel--inline">${escapeHTML(o.topicLabel)}</span>` : ''}
            <span class="tdi-date" data-tdi-date></span>
          </div>` : `
          <div class="tdi-todayhead">
            <h3 class="tdi-today-title">AI Briefing</h3>
          </div>
          ${topicRow}
          <!-- revamp915: the edition stamp sits UNDER the topic standfirst,
               above the summary — CSS order couldn't do this because the stamp
               used to live inside .tdi-todayhead alongside the title. -->
          <div class="tdi-stamprow"><span class="tdi-date" data-tdi-date></span></div>`}
          <button type="button" class="tdi-cardprov how-aigen" data-how-it-works>${DI_SPARK}<span>AI-generated content included</span>${DI_INFO_ICON}</button>
          <p class="tdi-summary" data-tdi-summary>Preparing today\u2019s briefing\u2026</p>
          <div class="tdi-actions">
            <button type="button" class="tdi-go tdi-go--brief" data-di-toggle aria-expanded="false">
              <span class="tdi-go-open">Read Briefing</span><span class="tdi-go-close">Hide briefing</span>${SUBPAGE_ARROW}
            </button>
            ${o.allBriefingsCta ? `<a class="tdi-go tdi-go--all" href="#/intelligence">All Briefings${SUBPAGE_ARROW}</a>` : ''}
          </div>
        </div>
        ${hubCard}
      </div>
      <div class="tdi-expand" data-di-expand><div class="tdi-expand-inner">
        <!-- revamp894: the collapsed card's identity (title, edition stamp,
             topic) is hidden while open, which left the reader with no idea
             what they were reading. Carry it into the open state, with an X to
             close in the top-right. [data-tdi-date] is filled by the same
             querySelectorAll that fills the collapsed stamp. -->
        <!-- revamp1037: only the close control survives here. The "AI Briefing"
             title + sparkle restated the card you already opened, and the topic
             and date are the briefing's own masthead line now. -->
        <div class="tdi-openhead tdi-openhead--bare">
          <button type="button" class="tdi-openx" data-di-toggle aria-label="Close briefing">${X_SVG}</button>
        </div>
        <div data-di-host></div>
        <div class="tdi-closefoot">
          <button type="button" class="tdi-closefoot-btn" data-di-toggle>${X_SVG}<span>Close Briefing</span></button>
        </div>
      </div></div>
    </div>`;
}
const DI_SPARK = '<svg class="tdi-cardprov-ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg>';
// revamp1043: circled-i affordance on the preview card's AI-generated label.
const DI_INFO_ICON = '<svg class="how-info-ic" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.3"/><line x1="12" y1="11.4" x2="12" y2="16.4"/><line x1="12" y1="7.6" x2="12.01" y2="7.6"/></svg>';
// revamp1066: AI Prompts icon — prompt text lines with a sparkle (retired the
// magic-wand). Distinct from the briefing sparkle, reads as "AI prompt".
const PROMPTS_HEAD_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h9M4 11h6M4 16h9"/><path d="M18.2 3.5l.85 2.35 2.35.85-2.35.85-.85 2.35-.85-2.35L15 6.7l2.35-.85z"/></svg>';
// revamp1059: icons for the page tab-nav (News Feed / AI Briefing / Trending /
// AI Prompts) so the tabs read as pill buttons like the search-page filters.
const PAGE_TAB_ICON = {
  news: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1z"/><path d="M19 8h1a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2"/><path d="M8 8h7M8 12h7M8 16h4"/></svg>',
  brief: DI_SPARK_TWO,
  trend: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>',
  tools: PROMPTS_HEAD_ICON,
};
const pageTabIcon = (k) => PAGE_TAB_ICON[k] ? `<span class="tvt-ic" aria-hidden="true">${PAGE_TAB_ICON[k]}</span>` : '';
const DI_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4"/></svg>';
const DI_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.2 14.4A8.6 8.6 0 0 1 9.6 3.8a8.6 8.6 0 1 0 10.6 10.6z"/></svg>';
// Morning/evening briefing art (revamp980). The edition isn't known until the
// brief lands, so the card renders with the morning art and swaps if it turns
// out to be the night edition. The two images are lit very differently — the
// morning one fades to near-white on the left, the evening one is dark navy —
// so the card also flips its text colour via .is-evening.
function applyBriefArt(root, iso) {
  if (!root || !iso) return;
  const parts = typeof diEditionParts === 'function' ? diEditionParts(iso) : null;
  const night = parts ? /night|evening/i.test(parts.edition || '') : false;
  const name = night ? 'evening' : 'morning';
  root.querySelectorAll('[data-tdi-art-img]').forEach((img) => {
    img.src = `/assets/briefing/${name}-1280.webp?v=3`;
    img.srcset = `/assets/briefing/${name}-800.webp?v=3 800w, /assets/briefing/${name}-1280.webp?v=3 1280w`;
  });
  root.querySelectorAll('.tdi-card').forEach((c) => c.classList.toggle('is-evening', night));
  root.querySelectorAll('[data-tdi-eyebrow-tx]').forEach((el) => {
    el.textContent = night ? '\u2018Tonight\u2019s Briefing'.slice(1) : 'Today\u2019s Briefing';
  });
  root.querySelectorAll('[data-tdi-eyebrow-ic]').forEach((el) => { el.innerHTML = night ? DI_MOON : DI_SUN; });
}

function diEditionStampHTML(iso) {
  const p = diEditionParts(iso);
  if (!p) return '';
  // revamp1016: briefings publish ONCE a day now (7pm ET), so "Morning /
  // Night Edition" no longer distinguishes anything — the date carries it.
  const CAL = '<svg class="tdi-stamp-cal" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/></svg>';
  // revamp1043: the preview stamp carries the date AND the publish time (abbrev
  // month, bare time + zone), matching the expanded masthead.
  const CLK = '<svg class="tdi-stamp-clk" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/></svg>';
  const timePart = p.time ? `<span class="tdi-stamp-sep" aria-hidden="true">·</span><span class="tdi-stamp-val tdi-stamp-time">${CLK}<span>${escapeHTML(p.time)}</span></span>` : '';
  return `<span class="tdi-stamp-val">${CAL}<span>${escapeHTML(p.day)}</span></span>${timePart}`;
}





// revamp819: Topics / Trending / Prompts render as REAL PAGES. The nav-dd
// shell is a fixed overlay with its own scroller — that is why their sticky
// subnav could never sit above them and why the page never truly scrolled.
// Same cfg, same contentHTML, same wire(): just mounted into #content.
function renderNavDdPage(container, cfg) {
  container.innerHTML = `
    <div class="ndp aii-nav-dd-pagelike ${cfg.className || ''}">
      <div class="aii-nav-dd-inner">
        ${backBarHTML()}
        <div class="aii-nav-dd-head">
          <div class="aii-nav-dd-titles">
            <div class="aii-nav-dd-title">${cfg.icon ? `<span class="navdd-headic" aria-hidden="true">${cfg.icon}</span>` : ''}${escapeHTML(cfg.title || '')}</div>
            ${cfg.subtitle ? `<div class="aii-nav-dd-sub">${escapeHTML(cfg.subtitle)}</div>` : ''}
            ${Array.isArray(cfg.headButtons) && cfg.headButtons.length
              ? `<div class="aii-nav-dd-headbtns">${cfg.headButtonsLabel ? `<span class="aii-nav-dd-headbtns-label">${escapeHTML(cfg.headButtonsLabel)}</span>` : ''}${cfg.headButtons.map((b, i) => `<a href="${escapeAttr(b.href || '#')}" class="aii-nav-dd-headbtn${b.primary ? ' is-primary' : ''}" data-navdd-headbtn="${i}">${b.icon || ''}<span>${escapeHTML(b.label)}</span></a>`).join('')}</div>`
              : ''}
          </div>
        </div>
        ${cfg.subBarHTML ? `<div class="aii-nav-dd-subbar">${cfg.subBarHTML}</div>` : ''}
        <div class="aii-nav-dd-scrollwrap">
          <div class="aii-nav-dd-scroll">${cfg.contentHTML || ''}</div>
        </div>
      </div>
    </div>`;
  const root = container.querySelector('.ndp');
  try { if (typeof cfg.wire === 'function') cfg.wire(root); } catch (err) { console.error('page wire failed', cfg.key, err); }
  return root;
}

// ─── revamp949: Featured AI Briefings row ────────────────────────────────────
// The same briefing cards the hub uses, mountable anywhere. Reads CACHE-ONLY so
// rendering it can never trigger a paid generation (revamp908), and opens a
// briefing in place inside a bordered card.
// Fill a line-clamped preview so it ends on a COMPLETE SENTENCE (revamp976).
//
// The real problem turned out to be the clamp, not the cut: every daily summary
// sampled was a SINGLE sentence of 169-226 characters, and the 3-line box holds
// about 150 — so roughly a quarter of every one was hidden. The clamp is now 5
// lines (revamp977 CSS), which fits them whole.
//
// This stays as a backstop for a summary that still overflows: add sentences
// back one at a time and keep the last that fits. It no-ops on single-sentence
// text, which is the normal case.
//
// Splitting is deliberately conservative. A naive /(?<=[.!?])\s+/ split treats
// "U.S." as a sentence end and truncated Business & Finance to "Escalating
// trade tensions between the U.S." on production. A boundary now requires a
// following capital AND must not sit after a dotted acronym or a known
// abbreviation.
const SENTENCE_ABBR = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sen|Rep|Gov|Gen|Lt|Sgt|St|Jr|Sr|Inc|Ltd|Co|Corp|vs|etc|al|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec|No|Vol|Fig|Est)\.$/;
function splitSentences(text) {
  const out = [];
  const re = /[.!?]+(?=\s)/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const before = text.slice(Math.max(0, end - 30), end);
    const after = text.slice(end).replace(/^\s+/, '');
    if (!/^["'\u201c\u2018(]?[A-Z]/.test(after)) continue;   // next must open a sentence
    if (/(?:\b[A-Z]\.){1,}$/.test(before)) continue;         // U.S. / A.B.C.
    if (SENTENCE_ABBR.test(before)) continue;                // Aug. / Inc. / Dr.
    out.push(text.slice(last, end).trim());
    last = end;
  }
  const tail = text.slice(last).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}
function setClampedSummary(el, text) {
  if (!el) return;
  const full = String(text || '');
  el.textContent = full;
  if (!el.clientHeight) return;                 // not laid out — leave it to CSS
  const fits = () => el.scrollHeight <= el.clientHeight + 1;
  if (fits()) return;
  const parts = splitSentences(full);
  if (parts.length <= 1) return;                // one sentence — nothing to trim to
  let out = '';
  for (const part of parts) {
    const next = out ? out + ' ' + part : part;
    el.textContent = next;
    if (!fits()) break;
    out = next;
  }
  el.textContent = out || full;
}

function renderFeaturedBriefings(host, opts) {
  if (!host) return;
  const o = opts || {};
  let picks = [];
  try { picks = (getFeaturedTopics() || []).filter((t) => t && t.slug && t.slug !== 'home').slice(0, 4); } catch (_) {}
  if (!picks.length) return;
  const X_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const X_BIG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  // revamp999: the homepage sidebar's compact form — head + the single
  // cross-topic briefing card, no 4-up topic grid (that lives on /intelligence).
  if (o.compact) {
    host.innerHTML = `
      <div class="hb-head hf-labelhead">
        <h3 class="hb-title"><span class="hb-head-ic hb-head-ic--brief" aria-hidden="true">${DI_SPARK_TWO}</span>${escapeHTML(o.title || "Today's AI Briefing")}</h3>
      </div>
      <div class="hb-hero hb-hero--side" data-home-briefing>
        <div class="tdi-card tdi-card--v3 tdi-card--hero2 tdi-card--home">${diHeroCardHTML({
          noHeader: true, hubLink: false, art: true, topicLabel: 'Global Briefing',
          sublabel: 'Your daily briefing across every topic we cover.',
          allBriefingsCta: true,
        })}</div>
      </div>`;
    wireHomeDailyIntelligence(host);
    fetchDailyBrief('home', false, true).then((d) => {
      if (d && d.generatedAt && host.isConnected) applyBriefArt(host, d.generatedAt);
    }).catch(() => {});
    return;
  }

  const card = (t) => `
    <button type="button" class="dih-item" data-fb-item="${escapeAttr(t.name)}" data-fb-slug="${escapeAttr(t.slug)}">
      <span class="dih-item-head">
        <span class="dih-item-ic" aria-hidden="true">${topicIconSVG(t.icon || 'globe', '')}</span>
        <span class="dih-item-name">${escapeHTML(t.name)}</span>
      </span>
      <span class="dih-item-sum" data-fb-sum>Loading your briefing…</span>
      <span class="dih-item-go">Read briefing${SUBPAGE_ARROW}</span>
    </button>`;
  // revamp951: header matches the Featured Topics / Prompts cards — icon chip,
  // same title size, subtext beneath.
  const FB_ICON = o.icon || DI_SPARK_TWO;

  // revamp982 — HERO layout (homepage): the site's own daily briefing leads as a
  // large card carrying the morning/evening art, with four topic briefings
  // beside it. Per the spec the topic cards NAVIGATE to their topic page; only
  // the lead briefing opens inline here.
  if (o.hero) {
    const topicCard = (t) => `
      <a class="hb-card" href="#/topic/${escapeAttr(t.slug)}">
        <span class="hb-card-head">
          <span class="hb-card-ic" aria-hidden="true">${topicIconSVG(t.icon || 'globe', '')}</span>
          <span class="hb-card-name">${escapeHTML(t.name)}</span>
        </span>
        <span class="hb-card-desc">${escapeHTML(getTopicDescription(t.slug) || '')}</span>
        <span class="hb-card-go">Read${SUBPAGE_ARROW}</span>
      </a>`;
    host.innerHTML = `
      <div class="hb-head">
        <span class="hb-head-ic" aria-hidden="true">${FB_ICON}</span>
        <h3 class="hb-title">${escapeHTML(o.title || "Today's AI Briefing")}</h3>
        ${o.moreHref ? `<a class="hb-all" href="${escapeAttr(o.moreHref)}">${escapeHTML(o.moreLabel || 'Explore all briefings')}${SUBPAGE_ARROW}</a>` : ''}
      </div>
      <div class="hb-grid">
        <div class="hb-hero" data-home-briefing>
          <div class="tdi-card tdi-card--v3 tdi-card--hero2 tdi-card--home">${diHeroCardHTML({
            noHeader: true, hubLink: false, art: true, topicLabel: 'Global Briefing',
            sublabel: 'Your daily briefing across every topic we cover.',
          })}</div>
        </div>
        <div class="hb-cards">${picks.map(topicCard).join('')}</div>
      </div>`;
    wireHomeDailyIntelligence(host);
    // The art follows the edition once the brief lands.
    fetchDailyBrief('home', false, true).then((d) => {
      if (d && d.generatedAt && host.isConnected) applyBriefArt(host, d.generatedAt);
    }).catch(() => {});
    return;
  }

  host.innerHTML = `
    <div class="hf-head fb-head">
      <div class="hf-headrow">
        <span class="hf-ic" aria-hidden="true">${FB_ICON}</span>
        <h3 class="hf-title">${escapeHTML(o.title || 'Featured AI Briefings')}</h3>
      </div>
      ${o.sub ? `<p class="hf-sub">${escapeHTML(o.sub)}</p>` : ''}
    </div>
    <div class="dih-items fb-items">${picks.map(card).join('')}</div>
    <div class="fb-brief" data-fb-brief hidden>
      <div class="fb-briefbar">
        <button type="button" class="fb-closelink" data-fb-close>${X_SVG}<span>Close Briefing</span></button>
        <button type="button" class="fb-closex" data-fb-close aria-label="Close briefing">${X_BIG}</button>
      </div>
      <div class="fb-brieftitle" data-fb-brieftitle></div>
      <div data-fb-host></div>
    </div>
    ${o.moreHref ? `<div class="fb-foot"><a class="hf-cta" href="${escapeAttr(o.moreHref)}">${escapeHTML(o.moreLabel || 'See all')}${SUBPAGE_ARROW}</a></div>` : ''}`;

  // Summaries, cache-only.
  host.querySelectorAll('[data-fb-item]').forEach((btn) => {
    const name = btn.dataset.fbItem;
    fetchDailyBrief(name, false, true).then((d) => {
      if (!btn.isConnected) return;
      const sum = btn.querySelector('[data-fb-sum]');
      if (sum) setClampedSummary(sum, (d && d.summary) ? d.summary : 'Briefing publishes with the next edition.');
    }).catch(() => {});
  });

  const list = host.querySelector('.fb-items');
  const brief = host.querySelector('[data-fb-brief]');
  const briefHost = host.querySelector('[data-fb-host]');
  const briefTitle = host.querySelector('[data-fb-brieftitle]');
  const foot = host.querySelector('.fb-foot');
  const showList = () => {
    brief.hidden = true; list.hidden = false;
    if (foot) foot.hidden = false;
    briefHost.innerHTML = '';
    host.classList.remove('is-brief');
  };
  host.querySelectorAll('[data-fb-item]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.fbItem, slug = btn.dataset.fbSlug;
      // revamp1037: no separate open-head. The briefing's own masthead already
      // carries topic + date + last-updated on one line, so this duplicated it.
      briefTitle.innerHTML = '';
      briefHost.innerHTML = '';
      renderDailyIntelligence(briefHost, { topic: name, label: name, slug, inline: true });
      list.hidden = true; brief.hidden = false;
      if (foot) foot.hidden = true;
      host.classList.add('is-brief');
      try { host.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) {}
    });
  });
  host.querySelectorAll('[data-fb-close]').forEach((b) => b.addEventListener('click', showList));
}

// revamp818: the AI Briefings hub — a REAL page (own route, own
// renderer, normal scroll), not a dropdown over home. Three bands: what Daily
// Intelligence is, today's cross-topic briefing, then every parent topic's
// briefing as a card grid you can read straight down.
function renderIntelligenceHub(container) {
  let groups = [];
  try { groups = (getTopicsGroupedByParent() || []).filter((g) => g && g.parent && g.parent.slug !== 'home'); } catch (_) {}

  // revamp822: topics are BLOCKS inside their parent's card, not cards of
  // their own. Clicking one turns the whole parent card into that briefing.
  // Up to four featured topics lead the page. Falls back to the first parents
  // when no featured set is configured.
  const featuredBriefs = (() => {
    let f = [];
    try { f = (getFeaturedTopics() || []).slice(0, 4); } catch (_) {}
    if (!f.length) f = (groups || []).slice(0, 4).map((g) => g.parent).filter(Boolean);
    return f;
  })();
  const item = (t) => `
    <button type="button" class="dih-item" data-dih-item="${escapeAttr(t.name)}" data-dih-slug="${escapeAttr(t.slug)}">
      <span class="dih-item-head">
        <span class="dih-item-ic" aria-hidden="true">${topicIconSVG(t.icon || 'globe', '')}</span>
        <span class="dih-item-name">${escapeHTML(t.name)}</span>
      </span>
      <span class="tdi-date dih-item-stamp" data-dih-stamp-for="${escapeAttr(t.name)}"></span>
      <span class="dih-item-sum" data-dih-sum="${escapeAttr(t.name)}">Loading your briefing…</span>
      <span class="dih-item-go">Read briefing${SUBPAGE_ARROW}</span>
    </button>`;

  // revamp1093: page hero (blue band, icon + title + subtext) matching the
  // topic / Home / Trending / Prompts pages. Desktop-only; in tab mode the grey
  // #sub-header title bar shows instead (CSS hides this).
  const AIB_HERO_IC = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8z"/></svg>';
  // Section-head icons (matching the Prompts page treatment): a sparkle for the
  // "Featured" section, a grid for the "by Topic" directory.
  const SEC_IC_FEATURED = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M19 14l.7 1.9L21.6 17l-1.9.7L19 20l-.7-1.9L16.4 17l1.9-.7z"/></svg>';
  const SEC_IC_BYTOPIC = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
  container.innerHTML = `
    <div class="dih">
      ${backBarHTML()}
      <section class="page-hero page-hero--dih">
        <div class="page-hero-inner">
          <div class="page-hero-headrow">
            <span class="page-hero-ic" aria-hidden="true">${AIB_HERO_IC}</span>
            <h1 class="page-hero-title">AI Briefings</h1>
          </div>
          <p class="page-hero-sub">A daily briefing on every topic: the big picture, what changed, and why it matters.</p>
        </div>
      </section>

      <!-- revamp947: the lone Cross-Topic card is replaced by a Featured
           Briefings row. It is a [data-dih-group] like every other section, so
           the existing lazy-fill and open-a-briefing wiring applies unchanged —
           it just renders permanently open with a plain header instead of a
           toggle. -->
      <section class="dih-group dih-group--featured is-open" data-dih-group>
        <div class="dih-featuredhead ph-sec-head ph-sec-head--card">
          <div class="ph-sec-headrow">
            <span class="ph-sec-ic" aria-hidden="true">${DI_SPARK_TWO}</span>
            <h2 class="ph-sec-title dih-bytopic-title">Featured Briefings</h2>
          </div>
          <p class="ph-sec-sub dih-bytopic-sub">A few of today's briefings to start with.</p>
        </div>
        <div class="dih-groupbody">
          <div class="dih-items">${featuredBriefs.map(item).join('')}</div>
          <div class="dih-brief" data-dih-brief hidden>
            <div class="dih-brief-bar">
              <button type="button" class="dih-brief-back fb-closelink" data-dih-back><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span>Close Briefing</span></button>
              <button type="button" class="dih-brief-close fb-closex" data-dih-back aria-label="Close briefing">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="dih-brief-title" data-dih-brief-title></div>
            <div data-dih-host></div>
          </div>
        </div>
      </section>

      <div class="dih-bytopic-head ph-sec-head ph-sec-head--card">
        <div class="ph-sec-headrow">
          <span class="ph-sec-ic" aria-hidden="true">${SEC_IC_BYTOPIC}</span>
          <h2 class="ph-sec-title dih-bytopic-title">Briefings by Topic</h2>
        </div>
        <p class="ph-sec-sub dih-bytopic-sub">Every topic gets its own briefing, twice a day. Browse them all here.</p>
      </div>


      <div class="dih-groups" data-dih-groups>
        ${groups.map((g) => `
          <section class="dih-group" id="dih-${escapeAttr(g.parent.slug)}" data-dih-group>
            <!-- revamp933: parent groups are real accordions now — closed on
                 load, bordered, two across, matching the accordion pattern used
                 on Prompts and the search results. -->
            <button type="button" class="dih-grouphead" data-dih-grouptoggle aria-expanded="false">
              <span class="dih-groupident">
                <span class="dih-group-ic" aria-hidden="true">${topicIconSVG(g.parent.icon || 'globe', '')}</span>
                <h2 class="dih-grouptitle">${escapeHTML(g.parent.name)}</h2>
              </span>
              ${PDIR_CHEV}
            </button>
            <div class="dih-groupbody" hidden>
            <div class="dih-items">${[g.parent, ...(g.subtopics || [])].map(item).join('')}</div>
            <div class="dih-brief" data-dih-brief hidden>
              <!-- revamp949: a close-link on the left and a larger X on the
                   right, in place of the back link. -->
              <div class="dih-brief-bar">
                <button type="button" class="dih-brief-back fb-closelink" data-dih-back><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span>Close Briefing</span></button>
                <button type="button" class="dih-brief-close fb-closex" data-dih-back aria-label="Close briefing">
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div class="dih-brief-title" data-dih-brief-title></div>
              <div data-dih-host></div>
            </div>
            </div>
          </section>`).join('')}
      </div>

      <aside class="dih-foot">
        <span class="dih-foot-ic" aria-hidden="true">${DI_SPARK_TWO}</span>
        <div class="dih-foot-tx">
          <p class="dih-foot-title">New briefings every morning and evening.</p>
          <p class="dih-foot-sub">Stay informed with AI-powered insights across every topic.</p>
        </div>
        <a class="dih-foot-cta" href="#/topics">Explore all topics${SUBPAGE_ARROW}</a>
      </aside>
    </div>`;

  // revamp824 — the legend jumps for real. A bare "#dih-slug" anchor left the
  // scroll to the browser, which puts the heading UNDER the fixed nav + sticky
  // bar; and if that section is open on a briefing, the offset is stale by the
  // time the layout settles. Measure the chrome and scroll it ourselves.
  // revamp933: parent groups open/close like every other accordion on the site.
  // Closed on load, so the page opens as a scannable list of sections rather
  // than ~100 briefing cards.
  const setGroupOpen = (sec, open) => {
    const head = sec.querySelector('[data-dih-grouptoggle]');
    const body = sec.querySelector('.dih-groupbody');
    if (!head || !body) return;
    body.hidden = !open;
    sec.classList.toggle('is-open', open);
    head.setAttribute('aria-expanded', String(open));
  };
  container.querySelectorAll('[data-dih-grouptoggle]').forEach((head) => {
    head.addEventListener('click', () => {
      const sec = head.closest('[data-dih-group]');
      setGroupOpen(sec, !sec.classList.contains('is-open'));
    });
  });

  container.querySelectorAll('.dih-legend-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const id = (chip.getAttribute('href') || '').replace(/^#/, '');
      const sec = id && container.querySelector('#' + CSS.escape(id));
      if (!sec) return;
      // Jumping to a section opens it — landing on a collapsed header would
      // look like the jump had failed.
      setGroupOpen(sec, true);
      const nav = document.getElementById('site-header');
      const sub = document.getElementById('sub-header');
      // Count the sticky bar even when it is still hidden: any jump target sits
      // past the reveal threshold, so it WILL be there by the time we land.
      const chrome = () => (nav ? nav.offsetHeight : 0) + (sub ? sub.offsetHeight : 0);
      const want = () => Math.max(0, window.scrollY + sec.getBoundingClientRect().top - chrome() - 14);
      window.scrollTo({ top: want(), behavior: 'smooth' });
      // The sections below fill their summaries lazily as they come into view,
      // so the document grows WHILE the smooth scroll is running and the target
      // slides out from under it. Re-aim until it stops moving.
      let tries = 0;
      const settle = () => {
        if (++tries > 6) return;
        const off = want() - window.scrollY;
        if (Math.abs(off) > 6) window.scrollTo({ top: want(), behavior: 'smooth' });
        setTimeout(settle, 260);
      };
      setTimeout(settle, 420);
    });
  });

  // Today's briefing: a preview that expands, same as the topic cards.
  const todayCard = container.querySelector('.dih-today-card');
  if (todayCard) {
    const host = todayCard.querySelector('[data-di-expand]');
    const inner = host?.firstElementChild;
    const btns = [...todayCard.querySelectorAll('[data-di-toggle]')];
    let loaded = false;
    try { if (inner) inner.inert = true; } catch (_) {}
    const setOpen = (on) => {
      btns.forEach((b) => b.setAttribute('aria-expanded', on ? 'true' : 'false'));
      todayCard.classList.toggle('is-open', on);
      try { if (inner) inner.inert = !on; } catch (_) {}
      if (!on || loaded || !inner) return;
      loaded = true;
      renderDailyIntelligence(inner.querySelector('[data-di-host]') || inner, {
        topic: 'home', label: 'Today', slug: 'home', inline: true,
      });
    };
    btns.forEach((b) => b.addEventListener('click', () => setOpen(b.getAttribute('aria-expanded') !== 'true')));
    fetchDailyBrief('home').then((d) => {
      if (!d || !todayCard.isConnected) return;
      const sEl = todayCard.querySelector('[data-tdi-summary]');
      if (sEl && d.summary) sEl.textContent = d.summary;
      if (d.generatedAt) {
        const stampHTML = diEditionStampHTML(d.generatedAt);
        todayCard.querySelectorAll('[data-tdi-date], [data-tdi-date-reflow]').forEach((el) => { el.innerHTML = stampHTML; });
      }
    }).catch(() => {});
  }

  // A parent card flips between its list of topics and one topic's briefing.
  let openGroup = null;
  const showList = (group) => {
    group.classList.remove('is-brief');
    const brief = group.querySelector('[data-dih-brief]');
    if (brief) brief.hidden = true;
    if (openGroup === group) openGroup = null;
  };
  container.querySelectorAll('[data-dih-group]').forEach((group) => {
    const brief = group.querySelector('[data-dih-brief]');
    const host = group.querySelector('[data-dih-host]');
    const title = group.querySelector('[data-dih-brief-title]');
    group.querySelectorAll('[data-dih-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (openGroup && openGroup !== group) showList(openGroup);
        const name = btn.dataset.dihItem;
        const slug = btn.dataset.dihSlug;
        // revamp1037: the open-head is gone — "AI Briefing" + sparkle repeated
        // the section it sits in, and the topic/date it carried are now the
        // briefing's own masthead line (topic pill · date · updated).
        if (title) title.innerHTML = '';
        if (host) { host.innerHTML = ''; renderDailyIntelligence(host, { topic: name, label: name, slug, inline: true }); }
        if (brief) brief.hidden = false;
        group.classList.add('is-brief');
        openGroup = group;
        try {
          const r = group.getBoundingClientRect();
          if (r.top < 70 || r.top > window.innerHeight * 0.5) group.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } catch (_) {}
      });
    });
    group.querySelectorAll('[data-dih-back]').forEach((b) => b.addEventListener('click', () => {
      showList(group);
      try { group.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) {}
    }));
  });

  // The topic blocks carry a bottom hairline as a row separator, but the LAST
  // visual row shouldn't (the card edge divides it, #img291). Column count is
  // responsive, so find the bottom row by offsetTop and mark it.
  const markLastRows = () => {
    container.querySelectorAll('[data-dih-group] .dih-items').forEach((list) => {
      const items = [...list.children];
      if (!items.length) return;
      let maxTop = -1;
      items.forEach((i) => { i.classList.remove('is-lastrow'); if (i.offsetTop > maxTop) maxTop = i.offsetTop; });
      items.forEach((i) => { if (Math.abs(i.offsetTop - maxTop) < 2) i.classList.add('is-lastrow'); });
    });
  };
  markLastRows();
  // Bind the resize handler ONCE (it re-reads the live DOM each fire), rather
  // than stacking a new listener on every hub render (revamp860).
  if (renderIntelligenceHub._lrHandler) window.removeEventListener('resize', renderIntelligenceHub._lrHandler);
  let lrTimer = null;
  renderIntelligenceHub._lrHandler = () => { clearTimeout(lrTimer); lrTimer = setTimeout(() => { try { markLastRows(); } catch (_) {} }, 120); };
  window.addEventListener('resize', renderIntelligenceHub._lrHandler, { passive: true });

  // ~100 summaries fetch lazily as their block scrolls into view — but a fast
  // scroll (or a legend jump past several sections) can bring dozens into range
  // at once, and firing them together earns a 403 from the API. Queue them
  // behind a small concurrency gate so a burst becomes a trickle (revamp826).
  const pending = new Set();
  const queue = [];
  let inFlight = 0;
  const MAX_INFLIGHT = 4;
  const pump = () => {
    while (inFlight < MAX_INFLIGHT && queue.length) {
      const job = queue.shift();
      inFlight++;
      job().finally(() => { inFlight--; pump(); });
    }
  };
  const fill = (el) => {
    const name = el.dataset.dihItem;
    if (!name || pending.has(name)) return;
    pending.add(name);
    queue.push(() => fillNow(el));
    pump();
  };
  const fillNow = async (el) => {
    const sum = el.querySelector('[data-dih-sum]');
    const stamp = el.querySelector('[data-dih-stamp-for]');
    try {
      // revamp908: the hub lazy-loads a card per topic. Reading CACHE-ONLY
      // means scrolling the hub can never trigger paid generation — the crons
      // stay the only writer. Cards with no brief yet show the pending note.
      const d = await fetchDailyBrief(el.dataset.dihItem, false, true);
      if (!el.isConnected) return;
      if (sum) setClampedSummary(sum, (d && d.summary) ? d.summary : 'Briefing publishes with the next edition.');
      if (stamp && d && d.generatedAt) stamp.innerHTML = diEditionStampHTML(d.generatedAt);
    } catch (_) {
      if (sum) sum.textContent = 'Briefing publishes with the next edition.';
    }
  };
  const items = [...container.querySelectorAll('[data-dih-item]')];
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); fill(e.target); } });
    }, { rootMargin: '400px 0px' });
    items.forEach((c) => io.observe(c));
  } else {
    items.forEach(fill);
  }
}

// revamp814: the homepage brief. Same card component and same open/close
// behaviour as the topic pages; only the scope differs.
// The "View Intelligence Hub" access-link rides right of the DI title when it
// fits; when the ident + link would overflow the header it drops below the
// sublabel (revamp852). Measured, with a resize listener.
// revamp860: the hub link is a body button now, not a header link, so there is
// nothing to fit — and this used to stack a resize listener on EVERY render,
// which piled up across navigations into resize/scroll thrash (flicker). No-op.
function fitDiHub() {}

function wireHomeDailyIntelligence(root) {
  const card = root.querySelector('.tdi-card--home');
  if (!card) return;
  const host = card.querySelector('[data-di-expand]');
  const inner = host?.firstElementChild;
  const btns = [...card.querySelectorAll('[data-di-toggle]')];
  if (!host || !inner || !btns.length) return;
  let loaded = false;
  try { inner.inert = true; } catch (_) {}
  const setOpen = (on) => {
    btns.forEach((b) => b.setAttribute('aria-expanded', on ? 'true' : 'false'));
    card.classList.toggle('is-open', on);
    try { inner.inert = !on; } catch (_) {}
    if (!on || loaded) return;
    loaded = true;
    renderDailyIntelligence(inner.querySelector('[data-di-host]') || inner, {
      topic: 'home', label: 'Today', slug: 'home', inline: true,
    });
  };
  btns.forEach((b) => b.addEventListener('click', () => setOpen(b.getAttribute('aria-expanded') !== 'true')));

  fitDiHub(card);

  fetchDailyBrief('home').then((d) => {
    if (!d || !card.isConnected) return;
    const sEl = card.querySelector('[data-tdi-summary]');
    if (sEl && d.summary) sEl.textContent = d.summary;
    if (d.generatedAt) {
      const stamp = diEditionStampHTML(d.generatedAt);
      card.querySelectorAll('[data-tdi-date], [data-tdi-date-reflow], [data-tdi-date-lg]').forEach((el) => { el.innerHTML = stamp; });
    }
  }).catch(() => {});
}

// The two landing cards expand IN PLACE (revamp777). Only one is open at a
// time — the open card takes the full width of the row and the other drops
// beneath it, which is also exactly what the stacked mobile layout does.
// Content is rendered lazily on first open, then kept.
function wireTopicLandingCards(root, topic, ctx) {
  const top = root.querySelector('.topic-top');
  fitDiHub(root.querySelector('.tdi-card'));
  // AI Briefings has TWO controls: the pill while it's closed, and the
  // ✕ Close Briefing in the header once it's open (revamp787).
  const cards = {
    di: { btns: [...root.querySelectorAll('[data-di-toggle]')], host: root.querySelector('[data-di-expand]'), sel: '.tdi-card', cls: 'is-di-open', loaded: false },
    pr: { btns: [...root.querySelectorAll('[data-pr-toggle]')], host: root.querySelector('[data-pr-expand]'), sel: '.tpr-card', cls: 'is-pr-open', loaded: false },
  };
  Object.values(cards).forEach((c) => { c.btn = c.btns[0]; });

  const setOpen = (key, on) => {
    const c = cards[key];
    if (!c || !c.btn || !c.host) return;
    if (on) setOpen(key === 'di' ? 'pr' : 'di', false);      // one open card at a time
    // No `hidden` toggle — display:none can't be transitioned. The panel is a
    // 0fr → 1fr grid row instead, so it eases open to whatever height the
    // content turns out to be (including as the fetched briefing arrives).
    const inner = c.host.firstElementChild;
    c.btns.forEach((b) => b.setAttribute('aria-expanded', on ? 'true' : 'false'));
    c.host.closest(c.sel)?.classList.toggle('is-open', on);
    if (top) top.classList.toggle(c.cls, on);
    try { if (inner) inner.inert = !on; } catch (_) {}
    if (!on || c.loaded || !inner) return;
    c.loaded = true;
    if (key === 'di') {
      // inline: the card already shows the title and date, so the briefing
      // renders its body alone (no second header, no repeated summary).
      // Render into the host, not the wrapper — the wrapper also holds the
      // bottom Close Briefing so it rides the same open/close animation.
      renderDailyIntelligence(inner.querySelector('[data-di-host]') || inner, {
        topic: topic.name, label: topic.name, slug: topic.slug, inline: true,
      });
    } else {
      renderAIIntelligence(inner.querySelector('[data-pr-host]') || inner, {
        inModal: true, initialBuilder: true, initialGroup: 'external', lockTopic: true,
        topic: topic.name, label: topic.name,
        descriptions: ctx.descriptions, icons: ctx.icons, shortcuts: ctx.shortcuts,
        topicKey: topic.slug,
      });
    }
  };
  // Collapsed panels start inert so their content is never tab-reachable.
  Object.values(cards).forEach((c) => {
    try { if (c.host?.firstElementChild) c.host.firstElementChild.inert = true; } catch (_) {}
  });

  Object.keys(cards).forEach((key) => {
    cards[key].btns.forEach((b) => b.addEventListener('click', () => {
      setOpen(key, b.getAttribute('aria-expanded') !== 'true');
    }));
    // revamp807: the whole card is NOT a click target — only its buttons are.
    // (revamp791 made the closed card clickable; John wants the buttons to own
    // the interaction.)
  });

  // A featured prompt opens the library and drills to that prompt's row.
  root.querySelectorAll('[data-tpr-open]').forEach((b) => {
    b.addEventListener('click', () => {
      const name = b.getAttribute('data-tpr-open') || '';
      setOpen('pr', true);
      if (!name) return;
      const find = () => {
        const rows = [...cards.pr.host.querySelectorAll('.aii-fi-acc-name, .aii-fi-acc-title')];
        if (!rows.length) return false;
        const hit = rows.find((r) => (r.textContent || '').trim() === name.trim());
        if (!hit) return false;
        (hit.closest('button') || hit).click();
        hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return true;
      };
      [120, 420, 900].forEach((d) => setTimeout(() => { try { find(); } catch (_) {} }, d));
    });
  });
}

// Render the body of a topic page (revamp777: the landing is the only page).
function renderTopicSubpage(container, topic, descriptions, icons, page) {
  const body = container.querySelector('#topic-tab-body');
  if (!body) return;
  let shortcuts = [];
  try { shortcuts = getShortcutsForTopic(topic.slug) || []; } catch (_) {}
  try {
    // revamp777: the websources / prompts / intelligence sub-page branches are
    // gone — everything lives on the landing page below.
    // ── Landing page (revamp765) ─────────────────────────────────────────────
    // revamp777: two equal cards — AI Briefings and AI Prompts — sit side
    // by side on wide screens and stack below 1024px. Either one EXPANDS IN
    // PLACE: the opened card takes the full width and the other drops beneath
    // it, so neither ever navigates away. The news feed follows under its own
    // "News Feed" head.
    // revamp1006: the rail card lists EVERY prompt for the topic — it is the
    // last component in the right column, so it can simply run long (John:
    // "whether there's 30 or 100").
    const featuredPrompts = shortcuts;
    body.innerHTML = `<div class="topic-home">
      <div class="aii-tabhead-spacer"></div>
      ${topicBodyHeadHTML(topic)}
      <div class="topic-viewtabs" data-topic-viewtabs role="tablist" aria-label="Topic sections">
        <button type="button" class="tvt is-active" role="tab" aria-selected="true" data-tview="news">${pageTabIcon('news')}<span class="tvt-tx"><span class="tvt-long">News Feed</span><span class="tvt-short">News</span></span></button>
        <button type="button" class="tvt" role="tab" aria-selected="false" data-tview="brief">${pageTabIcon('brief')}<span class="tvt-tx">AI Briefing</span></button>
        <button type="button" class="tvt" role="tab" aria-selected="false" data-tview="tools">${pageTabIcon('tools')}<span class="tvt-tx"><span class="tvt-long">AI Prompts</span><span class="tvt-short">Prompts</span></span></button>
      </div>
      <div class="topic-top">
        <section class="topic-top-main">
          <h3 class="trail-head"><span class="trail-head-ic trail-head-ic--brief" aria-hidden="true">${DI_SPARK_TWO}</span>AI Briefing</h3>
          <div class="tdi-card tdi-card--v3 tdi-card--hero2" data-tdi>${diHeroCardHTML({ sublabel: 'A fresh briefing on this topic, every day.', hubLink: false, topicLabel: topic.name, noHeader: true, art: true })}
          </div>
        </section>
        <section class="topic-top-side">
          <h3 class="trail-head"><span class="trail-head-ic trail-head-ic--prompts" aria-hidden="true">${PROMPTS_HEAD_ICON}</span>AI Prompts</h3>
          <div class="tpr-card" data-tpr>
            <div class="tpr-head">
            </div>
            <div class="tpr-inline" data-pr-host></div>
          </div>
        </section>
      </div>
      <div class="topic-news-wrap">
        <section id="section-newsfeed" class="layout-section"></section>
      </div>
    </div>`;
    // The page-title header carries the second topic picker (revamp774) and the
    // overflow "More" for its related-topic links. wireTopicHeroCondense is what
    // slides the subnav band back in once the header scrolls away — it had been
    // dead code since the tabbed layout went away.
    wireSubnavPicker(body);
    wireSubtopicsMore(body);
    // revamp1012: the prompts component renders INLINE in the rail — the rows
    // are the accordions, so a prompt opens in place with its Run/Copy/Model
    // panel instead of swapping in a separate library view. Same component the
    // tab view uses, so the behaviour is identical everywhere.
    {
      const host = body.querySelector('.topic-top-side [data-pr-host]');
      if (host) {
        renderAIIntelligence(host, {
          inModal: true, initialBuilder: true, initialGroup: 'external', lockTopic: true,
          topic: topic.name, label: topic.name,
          descriptions, icons, shortcuts,
          topicKey: topic.slug,
        });
      }
    }
    // Topic view tabs: container classes drive which section shows in the
    // narrow tabbed layout; on wide screens the tabs row is display:none and
    // the classes are inert (all sections show in the two-column grid).
    {
      const home = body.querySelector('.topic-home');
      body.querySelectorAll('[data-tview]').forEach((b) => b.addEventListener('click', () => {
        const v = b.dataset.tview;
        // revamp1098: each tab is its own state — switching tabs always opens at
        // the top, never carrying the previous tab's scroll position.
        try { (document.scrollingElement || document.documentElement).scrollTop = 0; window.scrollTo(0, 0); } catch (_) {}
        home.classList.toggle('tview-brief', v === 'brief');
        home.classList.toggle('tview-tools', v === 'tools');
        body.querySelectorAll('[data-tview]').forEach((x) => {
          const on = x === b;
          x.classList.toggle('is-active', on);
          x.setAttribute('aria-selected', String(on));
        });
        // The tab IS the destination: Today's Briefing lands with the brief
        // open and readable; AI Prompts lands inside the library. No second
        // click on a teaser card.
        const top = home.querySelector('.topic-top');
        if (v === 'brief' && top && !top.classList.contains('is-di-open')) {
          home.querySelector('[data-di-toggle]')?.click();
        }
        // The tab's reading surface is white; the night edition's navy card
        // theme (is-evening) would put light text on it. Park the class while
        // the tab is active and restore it on the way out.
        home.querySelectorAll('.tdi-card').forEach((c) => {
          if (v === 'brief') {
            if (c.classList.contains('is-evening')) { c.classList.add('was-evening'); c.classList.remove('is-evening'); }
          } else if (c.classList.contains('was-evening')) {
            c.classList.remove('was-evening'); c.classList.add('is-evening');
          }
        });
        // revamp1075: switching tabs swaps the panel (and can toggle the brief
        // open), changing the subnav/hero geometry — force --subnav-height to
        // re-measure so #content padding tracks the new panel instead of lagging.
        requestAnimationFrame(() => { try { setSubnavHeightVar(true); } catch (_) {} });
      }));
    }
    wireTopicHeroCondense();
    wireTopicLandingCards(body, topic, { descriptions, icons, shortcuts });
    renderNewsFeed(body.querySelector('#section-newsfeed'), topic, false);
    // Fill the AI Briefings card's summary + date once the brief lands.
    // The fetch is cached (shared with the sub-page), so tapping through is
    // instant. The summary is ALWAYS the real one — it regenerates with the
    // briefing every morning, so no evergreen fallback copy.
    fetchDailyBrief(topic.name).then((d) => {
      if (!d || !body.isConnected) return;
      const sEl = body.querySelector('[data-tdi-summary]');
      const dEl = body.querySelector('[data-tdi-date]');
      if (sEl && d.summary) sEl.textContent = d.summary;
      else if (sEl && d.content) sEl.textContent = String(d.content).replace(/^##.+$/gm, '').replace(/\*\*/g, '').trim().split(/(?<=[.!?])\s/)[0] || '';
      // Two stamps, one datum: the compact one rides the title line while the
      // card is closed; the larger one leads the brief when it's open.
      if (d.generatedAt) {
        const stamp = diEditionStampHTML(d.generatedAt);
        body.querySelectorAll('[data-tdi-date], [data-tdi-date-reflow], [data-tdi-date-lg]').forEach((el) => { el.innerHTML = stamp; });
        applyBriefArt(body, d.generatedAt);
      }
    }).catch(() => {});
  } catch (err) {
    console.error('topic page render failed', err);
    body.innerHTML = '<div class="aii-empty" style="padding:26px 4px;color:var(--color-text-muted);">Couldn’t load this page. Refresh to retry.</div>';
  }
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
  root.querySelectorAll('[data-topic-picker]').forEach((picker, pickerIdx) => {
    const btn = picker.querySelector('.tsp-btn');
    if (!btn) return;
    const isBodyHead = picker.classList.contains('topic-bodyhead');
    const panelwrap = picker.querySelector('.tsp-panelwrap');
    const setOpen = (on) => {
      if (on) closeAllPickers(picker);
      // Desktop body header: drop the full-width card so it overlays (covers) the
      // inline subtopics row — measured BEFORE the open class hides that row.
      if (on && isBodyHead && panelwrap) {
        // Anchor to the strip's TOP RULE (revamp788) — measuring .tbh-subs left
        // the panel floating a row below it, so its edges never met the subnav.
        // revamp809: anchor at EVERY width. This was gated to >=900px, so on
        // phones the panel fell back to CSS top:100% and opened below the
        // strip with a dead band above it (#img175/176).
        const subs = picker.querySelector('.tbh-subswrap') || picker.querySelector('.tbh-subs');
        if (subs) panelwrap.style.top = subs.offsetTop + 'px';
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
    // A topic page wires TWO pickers (body-head + subnav band), so the key must
    // be per-picker — a shared key would let the second registration silently
    // replace the first.
    onResize(`subnav-picker-grid:${isBodyHead ? 'body' : 'subnav'}:${pickerIdx}`,
      () => { if (picker.classList.contains('is-open')) fitGridCols(); });
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
  // revamp1075: drop the memoised subnav-height so this route always re-measures
  // and re-writes --subnav-height from scratch. Without this, a height cached on
  // a previous page (or at a transitional size) could stick and mis-pad #content.
  setSubnavHeightVar._h = setSubnavHeightVar._th = -1;
  const stayingInHomeDesktop = isHome && !isMobile && wasOnHomeDesktop;
  if (heroEl && !stayingInHomeDesktop) heroEl.innerHTML = '';
  document.body.classList.remove('sticky-always', 'has-subnav', 'home-mode', 'show-subnav-tabs', 'app-mode', 'custom-mode', 'home-search', 'home-subnav-on', 'pagenav-mode', 'pagenav-on');

  // Always render the main sticky bar + the mobile bottom tab nav
  renderStickyHeroBar(siteHeader, route);
  if (!window.__ttModeBound) { window.__ttModeBound = true; onResize('topic-view-mode', updateTopicViewMode, 5); }
  updateTopicViewMode();
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

  // Search + custom-search pages scroll naturally (no app-mode lock) and carry
  // no subnav. The custom-mode class lets CSS trim the content's top padding
  // (which otherwise reserves room for a subnav that isn't there).
  if (route.type === 'custom' || route.type === 'search') {
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
    // revamp1000: at rest the docked sidebar IS the nav, so the top bar and a
    // grey "Home" ident bar only slide in once the page scrolls (#img663-668).
    // The body carries its own "Home" page title instead.
    document.body.classList.add('home-mode');
    subHeader.classList.add('is-subnav', 'is-home-ident', 'home-mode');
    subHeader.innerHTML = `
      <div class="topic-banner"><div class="topic-banner-row home-ident-row">
        <div class="subnav-ident">
          <span class="subnav-ident-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/></svg></span>
          <span class="subnav-ident-name">Home</span>
        </div>
      </div></div>
      <!-- revamp1025: the tab rows live INSIDE the subnav, not in #content.
           In #content they inherited four levels of padding, were clipped by
           overflow-x: clip, and could never line up with the bar above them.
           Here they are part of the same fixed, full-width, sidebar-offset
           element by construction. -->
      <div class="home-viewtabs topic-viewtabs" data-home-viewtabs role="tablist" aria-label="Home sections">
        <button type="button" class="tvt is-active" role="tab" aria-selected="true" data-hview="news">${pageTabIcon('news')}<span class="tvt-tx"><span class="tvt-long">News Feed</span><span class="tvt-short">News</span></span></button>
        <button type="button" class="tvt" role="tab" aria-selected="false" data-hview="brief">${pageTabIcon('brief')}<span class="tvt-tx"><span class="tvt-long">AI Briefings</span><span class="tvt-short">AI Briefs</span></span></button>
        <button type="button" class="tvt" role="tab" aria-selected="false" data-hview="trend">${pageTabIcon('trend')}<span class="tvt-tx"><span class="tvt-long">Trending</span><span class="tvt-short">Trends</span></span></button>
        <button type="button" class="tvt" role="tab" aria-selected="false" data-hview="tools">${pageTabIcon('tools')}<span class="tvt-tx"><span class="tvt-long">AI Prompts</span><span class="tvt-short">Prompts</span></span></button>
      </div>
      <div class="home-subfilters" data-home-subfilters></div>`;
    if (!window.__homeScrollWire) {
      window.__homeScrollWire = true;
      const onScroll = () => {
        if (!document.body.classList.contains('home-search')) return;
        document.body.classList.toggle('home-scrolled', (window.scrollY || 0) > 12);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    document.body.classList.toggle('home-scrolled', (window.scrollY || 0) > 12);
    if (heroEl) heroEl.innerHTML = '';
    setupResponsiveNav();
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
      ${(() => {
        // Sub-pages get a sticky back bar where the tab strip used to live; the
        // landing page needs no second bar at all (revamp763).
        const page = topicSubpageFor(route.tab);
        if (!page) return '';
        const BACK_ARW = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
        return `<div class="topic-subnav-controls topic-subnav-controls--back">
          <div class="topic-backbar-inner">
            <a class="topic-backbar" href="#/topic/${escapeAttr(topic.slug)}">${BACK_ARW}<span>Back to ${escapeHTML(topic.name)} page</span></a>
            <span class="topic-backbar-here">${escapeHTML(TOPIC_SUBPAGES[page].label)}</span>
          </div>
        </div>`;
      })()}
    `;

    observeSubnavHeight();
    setupResponsiveNav();
    wireSubnavPicker(subHeader);
  }

  if (route.type === 'intelligence') {
    // revamp820: hidden on arrival, sliding in as a sticky bar once the title
    // block scrolls away — and no back link inside it.
    document.body.classList.add('has-subnav', 'pagenav-mode');
    subHeader.className = 'is-subnav static-page pagenav';
    // revamp1149 — section tabs in the sub-header band (tab mode): Featured
    // Briefings / Briefings by Topic. Active state on body.bview-topics.
    const bOnTopics = document.body.classList.contains('bview-topics');
    const briefTabs = `
      <div class="prompts-subnav-tabs" data-brief-subnav-tabs role="tablist" aria-label="Briefings sections">
        <button type="button" class="pst-tab${bOnTopics ? '' : ' is-active'}" data-bview="featured"><span class="pst-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M10.5 3l1.55 4.4a2 2 0 0 0 1.25 1.25L17.7 10.2l-4.4 1.55a2 2 0 0 0-1.25 1.25L10.5 17.4l-1.55-4.4a2 2 0 0 0-1.25-1.25L3.3 10.2l4.4-1.55a2 2 0 0 0 1.25-1.25z"/></svg></span>Featured Briefings</button>
        <button type="button" class="pst-tab${bOnTopics ? ' is-active' : ''}" data-bview="topics"><span class="pst-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></svg></span>Briefings by Topic</button>
      </div>`;
    subHeader.innerHTML = `
      <div class="topic-subnav-title">
        <div class="topic-subnav-inner">
          <div class="subnav-ident">
            <span class="subnav-ident-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M10.5 3l1.55 4.4a2 2 0 0 0 1.25 1.25L17.7 10.2l-4.4 1.55a2 2 0 0 0-1.25 1.25L10.5 17.4l-1.55-4.4a2 2 0 0 0-1.25-1.25L3.3 10.2l4.4-1.55a2 2 0 0 0 1.25-1.25z"/><path d="M17.8 14.6l.75 2.15 2.15.75-2.15.75-.75 2.15-.75-2.15-2.15-.75 2.15-.75z"/></svg></span>
            <span class="subnav-ident-name">AI Briefings</span>
          </div>
        </div>
      </div>${briefTabs}`;
    subHeader.querySelectorAll('[data-brief-subnav-tabs] [data-bview]').forEach((b) => b.addEventListener('click', () => {
      const topics = b.dataset.bview === 'topics';
      document.body.classList.toggle('bview-topics', topics);
      subHeader.querySelectorAll('[data-brief-subnav-tabs] [data-bview]').forEach((x) => x.classList.toggle('is-active', x === b));
      window.scrollTo(0, 0);
    }));
    observeSubnavHeight();
    wirePageNavReveal();
    return;
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
          ${backBarHTML()}
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
  // revamp890: this ran on EVERY scroll event, on every page, interleaving a
  // getBoundingClientRect read, a style.top write, a scrollHeight read and two
  // class writes — two forced reflows per event. Now: the sub-header's bottom
  // is only re-measured when the layout actually changes (resize / content
  // resize), and the per-scroll path writes only when a fade flips.
  let subBottom = 0;
  let lastTopOn = null, lastBotOn = null;
  const measure = () => {
    let b = sub ? Math.max(0, Math.round(sub.getBoundingClientRect().bottom)) : 0;
    // revamp1114: the topic/home tab strip is a SEPARATE fixed element BELOW the
    // subnav, so the sub-header's bottom left the fade washing over the tab strip
    // (#img1159/1160). #content's padding-top already reserves the full fixed
    // chrome height (nav + subnav + tab strip), and it's scroll-independent —
    // start the fade there so it always sits below all the top chrome.
    const content = document.getElementById('content');
    if (content) {
      const pt = Math.round(parseFloat(getComputedStyle(content).paddingTop) || 0);
      if (pt > b) b = pt;
    }
    subBottom = b;
    top.style.top = subBottom + 'px';
  };
  const update = () => {
    const y = window.scrollY || 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const tOn = y > 8;
    const bOn = max - y > 8;
    if (tOn !== lastTopOn) { lastTopOn = tOn; top.classList.toggle('is-on', tOn); }
    if (bOn !== lastBotOn) { lastBotOn = bOn; bot.classList.toggle('is-on', bOn); }
  };
  onScroll('page-scroll-fades', update);
  onResize('page-scroll-fades', () => { measure(); update(); });
  if (window.ResizeObserver) {
    let roQueued = false;
    new ResizeObserver(() => {
      if (roQueued) return;
      roQueued = true;
      requestAnimationFrame(() => { roQueued = false; measure(); update(); });
    }).observe(document.getElementById('content') || document.body);
  }
  measure();
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

  // revamp890: only WRITE when the state actually flips. classList.toggle with
  // an unchanged value still dirties style on some engines, and this ran on
  // every scroll event — so the sticky hero/subnav were being re-resolved
  // continuously while scrolling, which is what made them flash and stutter.
  let lastPassed = null;
  heroScrollHandler = () => {
    // >= so that landing at exactly threshold (clean tab-switch position)
    // also counts as revealed
    const passed = window.scrollY >= threshold;
    if (passed === lastPassed) return;
    lastPassed = passed;
    mainEl.classList.toggle('is-revealed', passed);
    if (subEl) subEl.classList.toggle('with-mainnav', passed);
  };
  window.addEventListener('scroll', heroScrollHandler, { passive: true });
  onResize('home-sticky-threshold', () => {
    threshold = computeThreshold();
    lastPassed = null;          // re-evaluate against the new threshold
    heroScrollHandler();
  });
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
  // revamp890: onto the keyed bus — re-registration replaces, so this can never
  // accumulate across renders. (The width guard stays: it ignores height-only
  // resizes, i.e. the mobile keyboard opening.)
  subnavCompactLastWidth = window.innerWidth;
  onResize('subnav-compact-measure', () => {
    if (window.innerWidth === subnavCompactLastWidth) return;
    subnavCompactLastWidth = window.innerWidth;
    measure();
  }, 40);
  // revamp890: measure() strips its shrink classes, measures, then re-adds them.
  // Running it at 250ms and 700ms meant real paints landed between those passes,
  // so the subnav title visibly jumped to full size and shrank back TWICE after
  // the page had settled. The only passes that can legitimately change the
  // outcome are the first frame and fonts-ready (metrics change when the webfont
  // swaps in) — the timeouts were duplicating work and causing the flash.
  measure();
  requestAnimationFrame(measure);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(measure).catch(() => {});
  }
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
  // revamp890: this was the one resize path with NO debounce — it re-ran the
  // whole write(display)/read(offsetWidth) trim loop on every resize FRAME,
  // while fitMainNav ran at settle+90ms. The two share the same header row, so
  // they fought each other: per-frame trimming against a nav whose stage
  // classes changed only at settle. On the bus it runs once, after the fit.
  onResize('sticky-nav-trim', run, 30);
}

// theScore-style mobile top bar: the page label shown next to the back
// button on sub-pages (topic / about / terms / prompt builder / search).
// Empty string on home (the brand shows instead).
// ── "Back to …" ──────────────────────────────────────────────────────────────
// Sub-pages (Topics / Trending / Prompts / Search / Prompt Builder / About /
// Terms) are real destinations, so each offers a named way back. We keep a small
// navigation STACK rather than a single "last page": Science → Topics → Trending
// reads "Back to Science", then "Back to Topics"; stepping back to Topics
// restores "Back to Science". Going back pops instead of pushing, so the trail
// never grows while the user retraces it.
const NAV_STACK_MAX = 12;
let navStack = [];
// A stable identity + display label for any route we might return to.
function navEntryFor(route) {
  if (!route) return null;
  switch (route.type) {
    case 'home': return { key: 'home', label: 'Home', hash: '#/' };
    case 'topic': {
      const t = getTopicBySlug(route.slug);
      return { key: 'topic:' + route.slug, label: t ? t.name : 'Topic', hash: `#/topic/${route.slug}` };
    }
    case 'topics': return { key: 'topics', label: 'Topics', hash: '#/topics' };
    case 'trending': return { key: 'trending', label: 'Trending', hash: '#/trending' };
    case 'prompts': return { key: 'prompts', label: 'Prompts', hash: '#/prompts' };
    case 'prompt-generator': return { key: 'prompt-generator', label: 'Prompt Builder', hash: '#/prompt-generator' };
    // Search and every /custom/{term} refinement share ONE identity — refining
    // a search must not flood the stack with near-identical "Search" entries
    // (recordBackTarget updates the stored hash in place instead).
    case 'search': return { key: 'search', label: 'Search', hash: '#/search' };
    case 'custom': return { key: 'search', label: 'Search', hash: `#/custom/${route.term || ''}` };
    case 'about': return { key: 'about', label: 'About', hash: '#/about' };
    case 'terms': return { key: 'terms', label: 'Terms', hash: '#/terms' };
    default: return null;
  }
}
function recordBackTarget(route) {
  const entry = navEntryFor(route);
  if (!entry) return;
  const top = navStack[navStack.length - 1];
  // Same page — keep the stored return hash current (e.g. /custom/{term}
  // refinements update the one Search entry in place).
  if (top && top.key === entry.key) { top.hash = entry.hash; return; }
  const prev = navStack[navStack.length - 2];
  if (prev && prev.key === entry.key) { navStack.pop(); return; }  // stepped back
  navStack.push(entry);
  if (navStack.length > NAV_STACK_MAX) navStack.shift();
}
// Live-refresh the open panel's "Back to …" bar. Route changes can fire while a
// page-mode panel stays open (search term edits, prompts view swaps) — without
// this the bar keeps whatever target it was born with.
function refreshNavDdBackbar() {
  const panel = document.getElementById('st-nav-panel');
  if (!panel || !panel.classList.contains('is-open')) return;
  const a = panel.querySelector('a.page-backbtn[data-backbar]');
  if (!a) return;
  const bt = backTarget();
  try { a.setAttribute('href', bt.hash); } catch (_) {}
  const tx = a.querySelector('.page-backbtn-tx');
  if (tx) tx.textContent = `Back to ${bt.label}`;
}
// { label, hash } for the current back destination — the entry BELOW the one
// we're on. Always resolvable: a cold deep-link falls back to Home.
function backTarget() {
  const prev = navStack[navStack.length - 2];
  if (prev) return { label: prev.label, hash: prev.hash };
  return { label: 'Home', hash: '#/' };
}
const BACKBAR_CHEV = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
// The bar itself — a text link, not a button. `data-backbar` marks it so any
// surface can drop this in.
function backBarHTML() {
  // revamp1011: retired. Every page carries its identity in the grey bar, and
  // the sidebar is always one click away, so the "Back to X" links were a
  // third navigation voice saying nothing new.
  return '';
}

// Scrolling a nav-dropdown page condenses its header: the "Back to …" bar and the
// head action buttons are resting-state chrome, so they fold away as soon as the
// user starts reading and return when they scroll back to the top.
function wireNavDdCondense(panel) {
  // These pages used to scroll inside the panel. They scroll the DOCUMENT now,
  // so [data-navdd-scroll] is absent and this bailed at the `if (!sc) return`
  // below — which is why the header never condensed on Prompts or Trending
  // (revamp795). Fall back to the page scroller.
  // The element EXISTS but no longer scrolls — the page does. So don't pick by
  // presence: read whichever is actually scrolled, and listen to both.
  const inner = panel.querySelector('[data-navdd-scroll]');
  const doc = document.scrollingElement || document.documentElement;
  const activeScroller = () => (inner && inner.scrollTop > 0 ? inner
    : (doc.scrollTop > 0 ? doc : (inner && inner.scrollHeight > inner.clientHeight + 8 ? inner : doc)));
  const sc = { get scrollTop() { return Math.max(inner ? inner.scrollTop : 0, doc.scrollTop); },
               set scrollTop(v) { const t = activeScroller(); t.scrollTop = v; } };
  // Measure ONLY the chrome that collapses. The previous version measured
  // .aii-nav-dd-inner, which CONTAINS the scroller — so the "delta" was the whole
  // panel's height, the compensation was garbage, and every scroll event yanked
  // the list. That's the non-stop glitch.
  const chrome = () => {
    let h = 0;
    panel.querySelectorAll(':scope > .aii-nav-dd-inner > .aii-nav-dd-head, :scope > .aii-nav-dd-inner > .aii-nav-dd-subbar, :scope > .aii-nav-dd-inner > .page-backbar')
      .forEach((el) => { h += el.getBoundingClientRect().height; });
    return h;
  };
  if (!sc) return;
  // The header sits OUTSIDE the scroller, so shrinking it makes the scroll
  // viewport taller — the browser keeps scrollTop, so every row jumps up by the
  // height we removed. Animating that height made it a continuous shudder.
  //
  // So: collapse in ONE frame (no height transition) and compensate scrollTop by
  // the exact delta, which leaves the content visually still while the header
  // changes. Hysteresis on top of that stops the two states chasing each other.
  let on = false;
  let busy = false;
  const setState = (next) => {
    if (next === on || busy) return;
    busy = true;
    const before = chrome();
    on = next;
    panel.classList.toggle('is-condensed', on);
    // Force layout so the new height is real before we measure it.
    const after = chrome();
    const delta = before - after;
    if (delta) sc.scrollTop = Math.max(0, sc.scrollTop + delta);
    syncStickyTop();      // revamp890: only when the head actually changed size
    requestAnimationFrame(() => { busy = false; });
  };
  // The sub-bar sticks BELOW the head, so it needs the head's live height — which
  // changes when the head condenses.
  const syncStickyTop = () => {
    const h = panel.querySelector('.aii-nav-dd-head');
    if (h) panel.style.setProperty('--navdd-head-h', `${Math.round(h.getBoundingClientRect().height)}px`);
  };
  // revamp890: `apply` used to call syncStickyTop() on EVERY scroll event — a
  // getBoundingClientRect read followed by a CSS-var write that other rules
  // consume as `top:`, i.e. a forced reflow per event. The head's height only
  // changes when `is-condensed` actually flips (or on resize), so sync there
  // instead of continuously.
  const apply = () => {
    const y = sc.scrollTop;
    if (!on && y > 48) setState(true);
    else if (on && y < 8) setState(false);
  };
  syncStickyTop();
  // revamp890: these listeners were added on EVERY dropdown open against a
  // PERSISTENT panel element and never removed, so each open stacked another
  // copy — by the tenth open, ten rect-reads + ten CSS-var writes ran per
  // scroll event. Keyed subscriptions replace instead of accumulating, and the
  // inner listener is removed before re-binding.
  onResize('navdd-sticky-top', syncStickyTop);
  if (inner) {
    if (inner.__navddApply) inner.removeEventListener('scroll', inner.__navddApply);
    inner.__navddApply = apply;
    inner.addEventListener('scroll', apply, { passive: true });
  }
  onScroll('navdd-condense', apply);
  apply();
}


// revamp810: Topics / Trending / Prompts get the topic pages' actual sticky
// bar — #sub-header, a full-bleed fixed element. Restyling each panel's own
// in-flow head could never match it (the ground stops at the content gutters).
//
// This is a second run at revamp801, which I rolled back. What killed that one
// was NOT the bar: it was a #content padding override bundled in with it, which
// disturbed the homepage. This version touches the bar and nothing else.
function renderPageNavBar(kind) {
  const subHeader = document.getElementById('sub-header');
  if (!subHeader) return;
  const ICONS = {
    topics: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    trending: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>',
    prompts: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    // revamp914: Search reuses this exact subnav — same grey sticky bar as
    // Topics / Trending / Prompts, with a search glyph and one action.
    search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.2" y2="16.2"/></svg>',
  };
  const NAMES = { topics: 'Topics', trending: 'Trending', prompts: 'Prompts', search: 'Search' };
  const name = NAMES[kind] || '';
  if (!name) return;
  document.body.classList.add('has-subnav', 'pagenav-mode');
  subHeader.className = 'is-subnav static-page pagenav';
  // revamp1010: Search's bar carries no action — the input IS the control.
  const action = kind === 'search'
    ? ''
    : kind === 'prompts'
    // revamp1082: Build lives inline at the bottom of the Prompts page now — the
    // subnav no longer carries a Build Prompt action.
    ? ''
    : (kind === 'topics'
      // revamp1047: Condensed/Expanded is now a single toggle (like "Include
      // Sports Trends") — off = condensed, on = every subtopic list expanded.
      ? '<button type="button" class="trend-sports-toggle pagenav-toggle" data-topics-expand role="switch" aria-checked="false" title="Expand every topic\'s subtopics"><span class="trend-sports-toggle-label">Expand all</span><span class="trend-sports-toggle-track"><span class="trend-sports-toggle-thumb"></span></span></button>'
      : '');
  // revamp1148 — the Prompts page carries its section tabs INSIDE the sub-header
  // band (like the other pages), not floating in the content. Active state is
  // held on the body (body.pview-topics) so it survives sub-header re-renders.
  const pOnTopics = document.body.classList.contains('pview-topics');
  const PV_IC = { featured: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 21 3-1 12.5-12.5a2.1 2.1 0 0 0-3-3L3 17z"/><path d="m15 5 3 3"/></svg>', topics: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></svg>' };
  const promptsTabs = kind === 'prompts' ? `
    <div class="prompts-subnav-tabs" data-prompts-subnav-tabs role="tablist" aria-label="Prompts sections">
      <button type="button" class="pst-tab${pOnTopics ? '' : ' is-active'}" data-pview="featured"><span class="pst-ic" aria-hidden="true">${PV_IC.featured}</span>Featured Prompts</button>
      <button type="button" class="pst-tab${pOnTopics ? ' is-active' : ''}" data-pview="topics"><span class="pst-ic" aria-hidden="true">${PV_IC.topics}</span>Prompts by Topic</button>
    </div>` : '';
  subHeader.innerHTML = `
    <div class="topic-subnav-title">
      <div class="topic-subnav-inner">
        <div class="subnav-ident">
          <span class="subnav-ident-ico${kind === 'trending' ? ' is-trend' : ''}">${ICONS[kind]}</span>
          <span class="subnav-ident-name">${name}</span>
        </div>
        ${action}
      </div>
    </div>${promptsTabs}`;
  subHeader.querySelectorAll('[data-prompts-subnav-tabs] [data-pview]').forEach((b) => b.addEventListener('click', () => {
    const topics = b.dataset.pview === 'topics';
    document.body.classList.toggle('pview-topics', topics);
    subHeader.querySelectorAll('[data-prompts-subnav-tabs] [data-pview]').forEach((x) => x.classList.toggle('is-active', x === b));
    window.scrollTo(0, 0);
  }));
  // The Topics bar's expand toggle drives the page's condensed/expanded views.
  subHeader.querySelector('[data-topics-expand]')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const want = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', String(want));
    // revamp1108: both the grey-nav switch and the inline "Expand all" switch
    // drive the same setView, kept in sync.
    if (typeof window.__topicsSetView === 'function') window.__topicsSetView(want);
  });
  // revamp914: "Start New Search" clears the field and returns to the empty
  // search page, scrolled back to the input.
  subHeader.querySelector('[data-pagenav-newsearch]')?.addEventListener('click', () => {
    navigate('#/search');
    requestAnimationFrame(() => {
      const input = document.querySelector('.search-panel--modal .search-panel-input');
      if (input) { input.value = ''; input.focus(); }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
  try { observeSubnavHeight(); } catch (_) {}
  wirePageNavReveal();
}

// Hidden until the page's own title block scrolls away, mirroring
// body.topic-hero-condensed on the topic pages.
let pageNavScrollHandler = null;
function wirePageNavReveal() {
  if (pageNavScrollHandler) {
    window.removeEventListener('scroll', pageNavScrollHandler);
    document.removeEventListener('scroll', pageNavScrollHandler, true);
  }
  // Don't assume WHAT scrolls. These panels have sometimes scrolled the
  // document and sometimes an inner element, and every previous attempt at this
  // bar (and at wireTopicHeroCondense, and at wireNavDdCondense) broke by
  // picking one. Listen in the capture phase so element scrolls are caught too,
  // and take whichever offset is largest.
  // revamp890: only write when the state actually flips. This toggled a class
  // on <body> — invalidating style for the whole document — on every scroll
  // event, and because the same function was bound to BOTH window (bubble) and
  // document (capture) it ran twice per event.
  let lastOn = null;
  const apply = (e) => {
    const doc = document.scrollingElement || document.documentElement;
    let y = Math.max(doc.scrollTop || 0, window.scrollY || 0);
    const t = e && e.target;
    if (t && t.nodeType === 1 && typeof t.scrollTop === 'number') y = Math.max(y, t.scrollTop);
    const on = y > 90;
    if (on === lastOn) return;
    lastOn = on;
    document.body.classList.toggle('pagenav-on', on);
  };
  pageNavScrollHandler = apply;
  // Capture on document already sees window/document scrolls, so the separate
  // window binding was pure duplication.
  document.addEventListener('scroll', apply, { passive: true, capture: true });
  document.body.classList.remove('pagenav-on');
  apply();
}

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
const TOPIC_TAB_LABEL = {
  intelligence: 'AI Briefings', 'ai-insights': 'AI Briefings',
  prompts: 'AI Prompts', shortcuts: 'AI Prompts',
  websources: 'Web Resources', explore: 'Web Resources',
};
function documentTitleFor(route) {
  if (!route) return `${SITE_TITLE_SUFFIX} — News, Resources and AI Knowledge on Any Topic`;
  switch (route.type) {
    case 'home': return `${SITE_TITLE_SUFFIX} — News, Resources and AI Knowledge on Any Topic`;
    case 'topic': {
      const t = getTopicBySlug(route.slug);
      if (!t) return `${SITE_TITLE_SUFFIX}`;
      // revamp777: sub-pages are retired — a legacy /prompts or /websources URL
      // renders (and is rewritten to) the topic page, so it takes the topic's
      // own title rather than the old tab-suffixed one.
      return `${t.name} — News, Resources & AI Insights | ${SITE_TITLE_SUFFIX}`;
    }
    case 'custom': return route.term ? `${route.term} — Search | ${SITE_TITLE_SUFFIX}` : `Search | ${SITE_TITLE_SUFFIX}`;
    case 'search': return `Search | ${SITE_TITLE_SUFFIX}`;
    case 'intelligence': return `AI Briefings | ${SITE_TITLE_SUFFIX}`;
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
  // revamp890: this used to reset every nav class AND drop --nav-h before
  // re-deriving them, so each resize event painted a wide/unstyled nav for a
  // frame before snapping back — the visible header flash. It also wrote the
  // class list ~9 times per resize. Now the whole ladder is resolved against a
  // detached snapshot of the class list and committed ONCE, only if it differs
  // from what's already applied.
  const STAGE_CLASSES = ['nav-wrap', 'nav-stacked', 'nav-short-trending', 'nav-small-text', 'nav-tiny-text', 'nav-drop-prompts', 'nav-drop-home', 'nav-icon-search', 'nav-tiny-title', 'nav-micro-text'];
  const before = STAGE_CLASSES.filter((c) => inner.classList.contains(c)).join(' ');
  inner.classList.remove(...STAGE_CLASSES);
  // NOTE: --nav-h is deliberately NOT cleared here. It used to be removed
  // synchronously and only re-set inside the rAF below, so while the nav was
  // wrapped the cascade fell back to :root's --nav-h for a frame — the fixed
  // subnav (top: var(--nav-h)) and #content (padding-top: calc(--nav-h + …))
  // both jumped ~40px and snapped back. It is now only ever overwritten with a
  // real measured value, or cleared once we know we're single-row.
  // The search bar is pushed to the far right by a flexible nav group, which
  // means the group absorbs slack and the row can never "overflow" — so every
  // measurement below is taken with `.nav-measuring`, which un-flexes the group
  // back to its natural content width. Without this the squeeze stages never
  // fire and the nav silently crushes at narrow widths instead.
  const fits = () => {
    inner.classList.add('nav-measuring');
    const ok = inner.scrollWidth <= inner.clientWidth + 1;
    inner.classList.remove('nav-measuring');
    return ok;
  };
  // Squeeze order. Topics / Trending / Prompts are the three links that must
  // survive — they are never dropped. We shed Home, collapse Search to its icon,
  // then shrink the three labels in stages, and only as a last resort shrink the
  // site title + hamburger to buy the labels more room (revamp738).
  // revamp836 — the links (Home / Topics / AI Briefings / Trending /
  // Prompts) all stay full-length. When they can't fit on the brand's row, the
  // whole link group drops to a clean second row beneath the brand + Search,
  // rather than shrinking labels or dropping items. Search is never touched.
  // revamp871 — escalate on the SINGLE row first to keep links up top longest:
  // 1) drop Home, 2) collapse Search to just its icon, 3) shrink the labels.
  // Only when all three still don't fit do we wrap to a second row (re-adding
  // Home there, dropping it again if that row itself wraps).
  if (!fits()) inner.classList.add('nav-drop-home');
  if (!fits()) inner.classList.add('nav-icon-search');
  if (!fits()) inner.classList.add('nav-small-text');
  if (!fits()) {
    inner.classList.remove('nav-drop-home', 'nav-icon-search', 'nav-small-text');
    inner.classList.add('nav-wrap');
    // The two-row nav is taller than the single-row --nav-h, and the header is
    // position:fixed — so publish its REAL height, or the second row would sit
    // over the page (content padding + sticky subnav both offset by --nav-h).
    requestAnimationFrame(() => {
      if (!inner.classList.contains('nav-wrap')) return;
      // Align the wrapped link row under the SITE TITLE (not the hamburger):
      // measure the brand's left edge relative to the bar's content box and
      // indent the row by that much (#img283).
      const brand = inner.querySelector('.sticky-brand');
      if (brand) {
        const cs = getComputedStyle(inner);
        const padL = parseFloat(cs.paddingLeft) || 0;
        const indent = Math.max(0, Math.round(brand.getBoundingClientRect().left - inner.getBoundingClientRect().left - padL));
        inner.style.setProperty('--nav-links-indent', indent + 'px');
      }
      // If the links themselves wrap to a SECOND line, drop "Home" — it's the
      // most expendable label — to pull them back onto one row (#img312).
      const links = inner.querySelector('#nav-links');
      if (links) {
        inner.classList.remove('nav-drop-home', 'nav-links-sm', 'nav-links-xs');
        const btn = links.querySelector('.navbtn');
        const oneLine = btn ? btn.offsetHeight : 0;
        const wraps = () => oneLine && links.offsetHeight > oneLine * 1.6;
        // Drop "Home" first; if the links still wrap to a second line, shrink
        // them in steps until they fit on one row (#img328).
        if (wraps()) inner.classList.add('nav-drop-home');
        if (wraps()) inner.classList.add('nav-links-sm');
        if (wraps()) inner.classList.add('nav-links-xs');
      }
      const h = Math.round(inner.getBoundingClientRect().height);
      if (h > 0) document.documentElement.style.setProperty('--nav-h', h + 'px');
    });
  } else {
    document.documentElement.style.removeProperty('--nav-h');
  }
}


// revamp1009 — the topic page's layout mode keys on CONTENT width, not the
// viewport: a collapsed sidebar at 1100px has room for the two-column layout
// that a docked sidebar at the same viewport does not. Two thresholds:
//   < 1160 content px → the news grid drops to one column (tnews-1col)
//   <  900 content px → the whole page goes tabbed (tt-on)
function updateTopicViewMode() {
  // revamp1075: derive `docked` from the LIVE dock decision, not the nav-docked
  // class. The class is only re-toggled at the discrete 900px matchMedia
  // crossing (or on navigation), while THIS runs on every resize-bus tick — so
  // reading the class raced a stale value, computing content-width against the
  // wrong sidebar offset and leaving the page not-full-width after a resize.
  const docked = window.__dockState ? window.__dockState()
    : document.body.classList.contains('nav-docked');
  const sbw = docked ? (window.innerWidth <= 1280 ? 264 : 320) : 0;
  const cw = window.innerWidth - sbw;
  const wasTt = document.body.classList.contains('tt-on');
  const isTt = cw < 900;
  document.body.classList.toggle('tt-on', isTt);
  document.body.classList.toggle('tnews-1col', cw < 1160);
  // revamp1087: leaving tab mode → desktop shows every section at once, so an
  // in-page tab choice made in tab mode (an OPEN briefing, a selected sub-view)
  // must not carry over — the crossing here doesn't hit the 640px breakpoint
  // that would otherwise re-render, so reset the state explicitly.
  if (wasTt && !isTt) {
    document.querySelectorAll('.topic-home').forEach((h) => h.classList.remove('tview-brief', 'tview-tools'));
    document.querySelectorAll('.topic-top.is-di-open').forEach((t) => t.classList.remove('is-di-open'));
    document.querySelectorAll('[data-tview]').forEach((b) => { const on = b.dataset.tview === 'news'; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)); });
    document.querySelectorAll('.home-sections.home-v2').forEach((g) => g.classList.remove('hview-brief', 'hview-trend', 'hview-tools'));
    document.querySelectorAll('[data-hview]').forEach((b) => { const on = b.dataset.hview === 'news'; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)); });
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
      <div class="sticky-actions navbtns" id="nav-links">
        <a href="#/" class="navbtn" id="nav-home" aria-label="Home">
          <span class="navbtn-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span>
          <span class="navbtn-label">Home</span>
        </a>
        <a href="#/intelligence" class="navbtn" id="nav-daily" aria-label="AI Briefings">
          <span class="navbtn-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg></span>
          <span class="navbtn-label"><span class="nl-full">AI Briefings</span><span class="nl-short">Briefings</span></span>
        </a>
        <button type="button" class="navbtn" id="nav-trending" aria-label="Trending">
          <span class="navbtn-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></span>
          <span class="navbtn-label">Trending</span>
        </button>
        <button type="button" class="navbtn" id="nav-prompts" aria-label="Prompts" aria-haspopup="dialog" aria-expanded="false">
          <span class="navbtn-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></span>
          <span class="navbtn-label">Prompts</span>
        </button>
      </div>
      <button type="button" class="navbtn nav-searchbar" id="nav-search" aria-label="Search">
        <span class="navbtn-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
        <span class="navbtn-label nav-searchbar-ph">Search</span>
      </button>
      <button type="button" class="navbtn navbtn--topics-right" id="nav-topics" aria-label="Topics" aria-haspopup="dialog">
        <span class="navbtn-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></svg></span>
        <span class="navbtn-label">Topics</span>
      </button>
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
  // revamp1134 — the standalone listing pages light their own nav button too.
  if (route && route.type === 'intelligence') document.getElementById('nav-daily')?.classList.add('is-active');
  if (route && route.type === 'trending') document.getElementById('nav-trending')?.classList.add('is-active');
  if (route && route.type === 'prompts') document.getElementById('nav-prompts')?.classList.add('is-active');

  // Prompts — opens a dropdown with two paths: Build a Custom Prompt (the prompt
  // builder inline) and Prompt Library (pick a topic → its ready-made prompts).
  // (AI Insights is no longer a nav section — topic pages + custom search cover it.)
  document.getElementById('nav-prompts')?.addEventListener('click', (e) => { e.stopPropagation(); togglePromptsNavDropdown(); });

  // AI Briefings — a plain link to the hub (router intercepts the href).
  document.getElementById('nav-daily')?.addEventListener('click', () => { closeNavDropdown(); });

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
    // Debounce: fitMainNav reads scrollWidth (forced reflow), toggles nav
    // classes and mutates --nav-h — doing that on every resize frame during a
    // drag reflows the whole page repeatedly and flickers. Run once the resize
    // settles, plus one rAF for the initial snap (revamp869).
    // revamp890: onto the shared bus so the nav fit and the subnav-height
    // measurement happen in one ordered settle pass instead of two racing ones.
    onResize('main-nav-fit', fitMainNav, 10);   // publishes --nav-h first
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
      <a href="#/" class="navmenu-brand" id="navmenu-brand-link">
        <span class="navmenu-title">Standard Topic</span>
      </a>
      <button class="navmenu-collapse" id="navmenu-collapse" aria-label="Collapse sidebar" title="Collapse sidebar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/><polyline points="15 10 13 12 15 14"/>
        </svg>
      </button>
    </div>
    <!-- navmenu-title font-size is synced to the main nav's .sticky-title at runtime
         (see syncNavmenuTitleSize) so the two always match at every viewport width. -->
    <!-- revamp1047: the sidebar search is a button (matching the collapsed-nav
         Search button and the quicklink CTAs below), not an input — it opens the
         search page/overlay. -->
    <button type="button" class="navmenu-searchbtn" id="navmenu-searchbtn" aria-label="Search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <span class="navmenu-searchbtn-label">Search</span>
    </button>
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
      <a href="#/topics" class="navmenu-quicklink navmenu-cta" id="navmenu-topics-link">
        <svg class="navmenu-cta-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.4"/>
          <rect x="14" y="3" width="7" height="7" rx="1.4"/>
          <rect x="3" y="14" width="7" height="7" rx="1.4"/>
          <rect x="14" y="14" width="7" height="7" rx="1.4"/>
        </svg>
        <span class="navmenu-cta-label">Topic Pages</span>
        <svg class="navmenu-cta-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="13 6 19 12 13 18"/>
        </svg>
      </a>
      <a href="#/intelligence" class="navmenu-quicklink navmenu-cta" id="navmenu-daily-link">
        <svg class="navmenu-cta-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/>
        </svg>
        <span class="navmenu-cta-label">AI Briefings</span>
        <svg class="navmenu-cta-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="13 6 19 12 13 18"/>
        </svg>
      </a>
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
      // revamp890: renderStickyHeroBar runs on EVERY route change and rebuilds
      // navPanel.innerHTML just above, so this observer used to be re-created
      // per navigation while the old one stayed alive on a detached node.
      if (window.__navmenuRO) window.__navmenuRO.disconnect();
      window.__navmenuRO = new ResizeObserver(updateScrollOverflow);
      window.__navmenuRO.observe(scrollEl);
    }
  }

  const closeMenu = () => {
    navPanel.classList.remove('is-open'); navOverlay.classList.remove('is-open'); document.body.style.overflow = '';
  };
  // ── Docked sidebar (revamp998): on wide screens the panel is the site's
  //    primary chrome — pinned open by default, content flowing beside it,
  //    with the whole page usable while it shows. The overlay drawer remains
  //    the sub-1200px behaviour. Preference persists across visits. ──
  const DOCK_MQ = window.matchMedia('(min-width: 900px)');
  // revamp1036: the sidebar IS the site's primary navigation, so a docked
  // sidebar is the default at any width that can hold one.
  // revamp1157: a manual collapse holds for the REST OF THE SESSION — resizing
  // across the dock threshold no longer undoes it. Closing the sidebar is a
  // deliberate choice; the layout shouldn't second-guess it every time the
  // window changes size. Leaving it open keeps the old behaviour: it re-docks
  // on its own at any width that can hold it. The choice is session-scoped —
  // a fresh page load starts expanded again (see the startup clear below).
  const dockWanted = () => { try { return localStorage.getItem('st:sidebar') !== 'closed'; } catch (_) { return true; } };
  const setDockPref = (open) => { try { localStorage.setItem('st:sidebar', open ? 'open' : 'closed'); } catch (_) {} };
  const applyDock = () => {
    const docked = DOCK_MQ.matches && dockWanted();
    document.body.classList.toggle('nav-docked', docked);
    navPanel.classList.toggle('is-docked', docked);
    if (docked) {
      navPanel.classList.remove('is-open');
      navOverlay.classList.remove('is-open');
      document.body.style.overflow = '';
    }
    updateTopicViewMode();
    // Layout under the panel changes width — let the fitters re-measure.
    try { window.dispatchEvent(new Event('resize')); } catch (_) {}
  };
  window.__applyDock = applyDock;
  // revamp1075: the live dock decision, so updateTopicViewMode (which runs on
  // every resize-bus tick) can compute the sidebar offset without depending on
  // the nav-docked class having already been re-toggled this frame.
  window.__dockState = () => DOCK_MQ.matches && dockWanted();
  if (!window.__dockMQBound) {
    window.__dockMQBound = true;
    DOCK_MQ.addEventListener('change', () => {
      // revamp1157: no state reset here — a session collapse survives every
      // resize. Widening only re-docks when the user never collapsed (or has
      // re-opened it with the desktop hamburger) — what dockWanted() says.
      if (window.__applyDock) window.__applyDock();
    });
  }
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
  onResize('navmenu-title-size', () => { if (navPanel.classList.contains('is-open')) syncNavmenuTitleSize(); });

  const openMenu = () => { resetMenu(); syncNavmenuTitleSize(); navPanel.classList.add('is-open'); navOverlay.classList.add('is-open'); document.body.style.overflow = 'hidden'; requestAnimationFrame(updateScrollOverflow); };

  // The hamburger: below 1200px it opens the overlay drawer; at desktop it
  // re-docks the sidebar. One control, two spellings of "show the nav".
  container.querySelector('#nav-hamburger').addEventListener('click', () => {
    if (DOCK_MQ.matches) { setDockPref(true); applyDock(); }
    else openMenu();
  });
  navOverlay.addEventListener('click', closeMenu);
  // The collapse control in the sidebar head: undocks on desktop (state kept
  // for next visit), plain close for the overlay drawer.
  navPanel.querySelector('#navmenu-collapse').addEventListener('click', () => {
    if (document.body.classList.contains('nav-docked')) { setDockPref(false); applyDock(); }
    else closeMenu();
  });
  // Docked = the site is usable ALONGSIDE the nav, so navigating must not
  // close it; the overlay drawer still dismisses on any link.
  const closeUnlessDocked = () => { if (!document.body.classList.contains('nav-docked')) closeMenu(); };
  navPanel.querySelectorAll('a, #navmenu-all-topics').forEach(link => {
    link.addEventListener('click', closeUnlessDocked);
  });
  navPanel.querySelector('#navmenu-all-topics')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeUnlessDocked();
    toggleTopicsNavDropdown();
  });

  navPanel.querySelector('#navmenu-trending')?.addEventListener('click', () => {
    closeUnlessDocked();
    toggleTrendingNavDropdown();
  });
  navPanel.querySelector('#navmenu-prompts')?.addEventListener('click', () => {
    closeUnlessDocked();
    // navigate (not a direct open) so the back-target stack records the move.
    navigate('#/prompts');
  });
  // revamp1047: the sidebar Search button opens the search surface (same as the
  // top-bar Search), rather than an inline input.
  navPanel.querySelector('#navmenu-searchbtn')?.addEventListener('click', () => {
    closeUnlessDocked();
    openSearchFromNav();
  });

  // revamp1052: a manual collapse only lasts the session — every fresh page
  // load defaults the sidebar to expanded on any width that can hold it. So
  // clear the stored 'closed' flag once at startup; a mid-session collapse
  // still persists until the next refresh (and, since revamp1157, across any
  // amount of resizing in between).
  try { if (localStorage.getItem('st:sidebar') === 'closed') localStorage.removeItem('st:sidebar'); } catch (_) {}
  applyDock();

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


// revamp1014 — ONE prompt surface site-wide. Any host that shows prompts embeds
// the AI Intelligence component in `promptsOnly` mode, which emits the bare
// accordion list: bordered rows that expand in place into the prompt preview
// with Edit / Model / Copy / Settings / Run. Hosts differ only in CSS.
function resolveTopicPlaceholder(prompt, topicName) {
  return String(prompt || '').replace(/\{topic\}/gi, topicName || 'this topic');
}
function promptEmbedScope(shortcuts, extra) {
  // sectionIcon() resolves per-row glyphs through scope.icons[name] and falls
  // back to one generic mark for the whole group — so the map has to be built
  // from the picks or every row wears the same wand.
  const icons = {}; const descriptions = {};
  (shortcuts || []).forEach((sc) => {
    if (!sc || !sc.name) return;
    if (sc.icon) icons[sc.name] = sc.icon;
    if (sc.description) descriptions[sc.name] = sc.description;
  });
  return {
    // initialBuilder + initialGroup are what land the component on its prompt
    // library view; without them it renders its default shell and no rows.
    inModal: true, initialBuilder: true, initialGroup: 'external',
    promptsOnly: 'specific', lockTopic: true,
    topic: 'home', label: '', shortcuts, descriptions, icons,
    ...(extra || {}),
  };
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
    // The grey hero zone holds ONLY the search hero (title + tagline + bar). The
    // old quicklinks strip is now two proper cards — Featured Topics / Featured
    // Prompts — living on the WHITE band with the rest of the content (revamp763):
    // each card = title, chip list, and a footer link out to the full directory.
    const HQ_ARROW = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';
    // revamp1085: a blue hero band at the top of Home, mirroring the topic-page
    // header — title + subtext + a row of featured-topic chips to jump straight in.
    let heroTopics = [];
    try { heroTopics = (getFeaturedTopics() || []).filter((t) => t && t.slug && t.slug !== 'home').slice(0, 10); } catch (_) {}
    const HOME_HERO_IC = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>';
    const homeHeroHTML = `
      <section class="home-hero home-hero--noic" data-home-hero>
        <div class="home-hero-inner">
          <div class="home-hero-headrow">
            <h1 class="home-hero-title">What's Happening</h1>
          </div>
          <p class="home-hero-sub">Real news and clear insight on any topic.</p>
          ${heroTopics.length ? `<div class="home-hero-chips">${heroTopics.map((t) => `<a href="#/topic/${escapeAttr(t.slug)}" class="home-hero-chip">${escapeHTML(t.name)}</a>`).join('')}</div>` : ''}
        </div>
      </section>`;
    container.innerHTML = `
      <div class="topic-layout home-grid" id="topic-layout">
        ${homeHeroHTML}
        ${bodyTabsRow({ showSearchTrends: true })}
        <div class="home-sections home-v2">
          <!-- revamp999: the hero and its grey band are gone (search lives in
               the sidebar now). Column 1 is ALL news — one feed whose first tab
               is Today's News. Column 2 stacks the briefing, trending, AI
               Research Tools and Explore Topics. -->
          <div class="home-main">
            <section class="layout-section" id="section-newsfeed"></section>
          </div>
          <aside class="home-side">
            <section class="home-featbriefs hs-block" data-home-featbriefs aria-label="Today's AI Briefing"></section>
            <section class="home-trending hs-block" id="home-trending"></section>
            <section class="hf-card hf-card--prompts hf-card--labelled hs-block" data-hf="prompts">
              <div class="hb-head hf-labelhead">
                <h3 class="hb-title"><span class="hb-head-ic hb-head-ic--prompts" aria-hidden="true">${PROMPTS_HEAD_ICON}</span>AI Prompts</h3>
              </div>
              <div class="hf-chips" data-hq-prompts></div>
              <div class="hs-morefoot"><button type="button" class="hs-morelink" data-explore-prompts>View more prompts${SUBPAGE_ARROW}</button></div>
            </section>
          </aside>
        </div>
      </div>
    `;
    homeSearchPanelCtl = null;
    // Trending is now the only sidebar card, so it can run much longer.
    // revamp981: a shorter sidebar list — "View more trending" carries the rest
    // through to the trending page rather than the sidebar being the whole list.
    // revamp1104: render the FULL trend set; on desktop the sidebar CSS-caps it to
    // 12 (+ "View more trending"), but in tab mode the Trends tab shows them all.
    renderTrendingHome(container.querySelector('#home-trending'), { limit: 60 });
    // revamp1031b: one rAF was not enough — the feed renders asynchronously and
    // the browser re-anchors to its remembered offset once the page grows tall
    // enough to allow it. Reset across the settle window instead, and stop as
    // soon as the visitor scrolls themselves so we never fight them.
    try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (_) {}
    {
      let cancelled = false;
      const stop = () => { cancelled = true; };
      window.addEventListener('wheel', stop, { once: true, passive: true });
      window.addEventListener('touchstart', stop, { once: true, passive: true });
      window.addEventListener('keydown', stop, { once: true });
      [0, 60, 200, 500, 900, 1500].forEach((d) => setTimeout(() => {
        if (!cancelled && (window.scrollY || 0) > 0) window.scrollTo(0, 0);
      }, d));
    }
    {
      const grid = container.querySelector('.home-v2');
      // revamp1025: the tabs live in #sub-header, so query the document.
      document.querySelectorAll('[data-hview]').forEach((b) => b.addEventListener('click', () => {
        const v = b.dataset.hview;
        // revamp1098: each home tab is its own state — always opens at the top.
        try { (document.scrollingElement || document.documentElement).scrollTop = 0; window.scrollTo(0, 0); } catch (_) {}
        grid.classList.toggle('hview-brief', v === 'brief');
        grid.classList.toggle('hview-trend', v === 'trend');
        grid.classList.toggle('hview-tools', v === 'tools');
        document.querySelectorAll('[data-hview]').forEach((x) => {
          const on = x === b;
          x.classList.toggle('is-active', on);
          x.setAttribute('aria-selected', String(on));
        });
        // The filter row belongs to the news tab only.
        const slot = document.querySelector('[data-home-subfilters]');
        if (slot) slot.classList.toggle('is-on', v === 'news');
        // revamp1040: adding/removing the filter row changes the sub-header
        // height, which drives #content's top padding via --subnav-height. The
        // ResizeObserver was not catching the tab-switch, so leaving the news
        // tab left ~50px of phantom reserved space above the section (the
        // "empty band" on brief/trend/tools). Re-measure once the layout settles.
        requestAnimationFrame(() => { try { setSubnavHeightVar(true); } catch (_) {} });
        // The tab IS the destination: AI Briefing lands with the brief open
        // rather than a teaser you then have to click (matches topic pages).
        if (v === 'brief') {
          const card = container.querySelector('.home-featbriefs .tdi-card');
          if (card && !card.classList.contains('is-open')) {
            container.querySelector('.home-featbriefs [data-di-toggle]')?.click();
          }
        }
      }));
    }
    // revamp949: the homepage leads with a Featured AI Briefings row built from
    // the same cards as the AI Briefings page.
    renderFeaturedBriefings(container.querySelector('[data-home-featbriefs]'), {
      compact: true,
      title: 'AI Briefing',
      // A briefing page with a spark — reads at chip size, unlike the bare
      // sparkle, and sits with the grid/wand marks on the cards below.
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.5 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-8"/><path d="M8 8h6M8 12h6M8 16h4"/><path d="M19.5 2.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="currentColor" stroke="none"/></svg>',
      moreHref: '#/intelligence', moreLabel: 'Explore all briefings (200+)',
    });
    {
      const tWrap = container.querySelector('[data-hq-topics]');
      if (tWrap) {
        // Render 15 so the three-column layout (>=1366px) fills 5 per column,
        // matching the Prompts card's five rows. CSS visibility caps trim by
        // viewport below that: 12 in two columns, 6 on phones, 5 when narrow.
        let feats = []; try { feats = (getFeaturedTopics() || []).filter((t) => t && t.slug && t.slug !== 'home').slice(0, 15); } catch (_) {}
        // revamp948: topic ICON instead of a bullet mark, matching the
        // subtopic links inside the All Topics accordion.
        tWrap.innerHTML = feats.map((t) => `<a href="#/topic/${escapeAttr(t.slug)}" class="hq-row"><span class="hq-row-ic" aria-hidden="true">${topicIconSVG(t.icon || 'globe', '')}</span><span class="hq-row-name">${escapeHTML(t.name)}</span></a>`).join('');
      }
      // Featured Prompts — the same featured set the Prompt Library leads with.
      // The card shell (title + footer link) is there from the start; the chips
      // fill in once the data lands.
      const pWrap = container.querySelector('[data-hq-prompts]');
      if (pWrap) {
        fetchWithTimeout('/data/featured-prompts.json', { headers: { Accept: 'application/json' } })
          .then((r) => (r.ok ? r.json() : null))
          .then((cfg) => {
            if (!cfg || !Array.isArray(cfg.featured)) return;
            // revamp1047: the homepage AI Prompts list now shows a fuller set
            // (~18) — the featured picks first, then backfilled from featured
            // topics' own prompt sets so the section reads as a real library.
            const CAP = 18;
            const picks = [];
            const seen = new Set();
            const add = (s, topic, slug) => {
              if (picks.length >= CAP) return;
              if (!s || !s.prompt) return;
              const key = (slug || '') + '::' + (s.name || '');
              if (seen.has(key)) return; seen.add(key);
              picks.push({ s, tn: topic ? topic.name : '', slug });
            };
            for (const f of cfg.featured) {
              if (picks.length >= CAP) break;
              let sc = []; try { sc = getShortcutsForTopic(f.topic) || []; } catch (_) { continue; }
              const sMatch = sc.find((x) => x && x.name === f.name);
              add(sMatch, getTopicBySlug(f.topic), f.topic);
            }
            // Backfill to CAP from featured topics' non-evergreen shortcuts.
            if (picks.length < CAP) {
              let feats = []; try { feats = (getFeaturedTopics() || []).filter((t) => t && t.slug && t.slug !== 'home'); } catch (_) {}
              for (const t of feats) {
                if (picks.length >= CAP) break;
                let sc = []; try { sc = getShortcutsForTopic(t.slug) || []; } catch (_) { continue; }
                for (const s of sc) { if (picks.length >= CAP) break; if (s && s.prompt && !s.evergreen) add(s, t, t.slug); }
              }
            }
            if (!picks.length) return;
            // revamp1014: the SAME prompt component the topic rail and the tab
            // view use, so a featured prompt opens in place with its Run / Copy
            // / Model panel instead of navigating to the library. These picks
            // span topics, so {topic} is resolved per pick before handing them
            // over — the component's own substitution is single-scope.
            renderAIIntelligence(pWrap, promptEmbedScope(picks.map((pk) => ({
              ...pk.s, evergreen: false,
              prompt: resolveTopicPlaceholder(pk.s.prompt, pk.tn),
            }))));
          }).catch(() => {});
      }
    }
    // "All topics" — opens the full All-Topics dropdown so visitors can jump into a
    // dedicated topic page.
    container.querySelector('[data-explore-topics]')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('open-all-topics-modal'));
    });
    // Prompt Library nudge — routes to the Prompts page (navigate, not a direct
    // open, so the back-target stack records the move).
    container.querySelector('[data-explore-prompts]')?.addEventListener('click', (e) => {
      e.preventDefault();
      navigate('#/prompts');
    });
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
    // Legacy /intelligence, /websources, /prompts links land on the topic page
    // itself now — rewrite the address so the URL matches what's rendered.
    if (route && isLegacyTopicSubpage(route.tab)) {
      const clean = location.pathname.startsWith('/topic/')
        ? `/topic/${topic.slug}` : `#/topic/${topic.slug}`;
      try { history.replaceState(null, '', clean); } catch (_) {}
    }
    renderTopicSubpage(container, topic, descriptions, icons, null);
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
    // Topic pages returned above (renderTopicSubpage) — only custom/home layouts
    // reach here, and they use the shortcuts sidebar.
    renderShortcutsSidebar(shortcutsSection, route, isHome, isCustom, customTerm);
  }
  // Web Search is no longer a standalone topic-page card — it's folded into the AI
  // Insights component as a tab. (renderWebSources is still used elsewhere.)
  if (feedSection) {
    // revamp999: home is ONE tabbed feed — Today's News first, topic tabs after
    // (the old separate bottom Latest News is absorbed into it).
    if (isHome) renderNewsFeed(feedSection, topic, true, '', 'homev2');
    else renderNewsFeed(feedSection, topic, isHome);
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

// Footer year, stamped at runtime so it never goes stale (revamp983).
try {
  const el = document.getElementById('st-footer-copy');
  if (el) el.textContent = `\u00a9 ${new Date().getFullYear()} Standard Topic. All rights reserved.`;
} catch (_) {}

// revamp1054: icons for the search top-zone filter tabs (keyed by builder group).
const SEARCH_TAB_ICON = {
  external: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H17a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 18.5z"/><path d="M8 8h7M8 12h7M8 16h4"/></svg>',
  news: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1z"/><path d="M19 8h1a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2"/><path d="M8 8h7M8 12h7M8 16h4"/></svg>',
  explore: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
};
function renderSearchPanel(container, { mode = 'inline', term = '' } = {}) {
  const isModal = mode === 'modal';
  container.innerHTML = `
    <div class="search-panel search-panel--${mode}" data-state="collapsed">
      ${isModal ? '<div class="search-panel-topfold search-topzone">' : ''}
      <div class="search-panel-hero"><div class="search-panel-hero-inner">
        ${isModal
          ? `<h2 class="search-panel-title">Search</h2>
             <p class="search-panel-sublede">Find the insights and resources you need.</p>`
          : `<h2 class="search-panel-title">Search. Discover. Stay&nbsp;Informed.</h2>
             <p class="search-panel-tagline">Real news. AI insights. All in one place.</p>`}
      </div></div>
      <div class="search-panel-barrow">
        <form class="search-panel-form" role="search" autocomplete="off">
          <button type="submit" class="search-panel-icon" aria-label="Search" title="Search">${SEARCH_ICON_SVG}</button>
          <input class="search-panel-input" type="search" placeholder="Search any topic, headline or question for insights…" aria-label="Search any topic" value="${escapeAttr(term)}">
          <button type="button" class="search-panel-copylink" aria-label="Copy a shareable link to this search" title="Copy link to this search">${LINK_ICON_SVG}</button>
          <button type="button" class="search-panel-clear" aria-label="Clear search" hidden>${X_ICON_SVG}</button>
        </form>
        <div class="search-panel-suggest" role="listbox" hidden></div>
      </div>
      ${isModal ? '<div class="search-topzone-tabs" data-search-tabs-slot></div>' : ''}
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
  // revamp890: was a raw (non-passive) listener that only unregistered on the
  // NEXT resize after its input was detached — so every visit to a search
  // surface left another live handler behind until the user happened to resize.
  // Keyed: re-registration replaces, and a detached input drops the entry.
  onResize('search-panel-placeholder', () => {
    if (!document.contains(input)) { offResize('search-panel-placeholder'); return; }
    syncPlaceholder();
  });
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

  // Quick links under the search bar (revamp978). Replaces the old two-group
  // starter chips. Fixed set in PRIORITY order — the row trims from the END as
  // width runs out, so the first three (Today's Briefing, Trending, World) are
  // the ones that always survive.
  const QUICK_LINKS = [
    { key: 'briefing', label: "Today's Briefing", icon: QL_BRIEF_IC },
    { key: 'trending', label: 'Trending',         icon: QL_TREND_IC },
    { key: 'topic',    label: 'World',            slug: 'world' },
    { key: 'topic',    label: 'Politics',         slug: 'politics' },
    { key: 'topic',    label: 'AI',               slug: 'artificial-intelligence' },
    { key: 'topic',    label: 'Science',          slug: 'science' },
    { key: 'topic',    label: 'Markets',          slug: 'markets' },
  ];
  const QL_MIN_VISIBLE = 3;

  function fillStarterChips() {
    if (isModal) return;
    const wrap = panelEl.querySelector('.search-panel-starters');
    if (!wrap) return;
    wrap.classList.add('sp-quick');
    wrap.innerHTML = QUICK_LINKS.map((l) => {
      const ic = l.slug ? topicIconSVG(((getTopicBySlug(l.slug) || {}).icon) || 'globe', '') : l.icon;
      const inner = `<span class="sp-ql-ic" aria-hidden="true">${ic}</span><span class="sp-ql-tx">${escapeHTML(l.label)}</span>`;
      return l.slug
        ? `<a class="sp-ql" href="#/topic/${escapeAttr(l.slug)}" data-ql>${inner}</a>`
        : `<button type="button" class="sp-ql" data-ql data-ql-act="${escapeAttr(l.key)}">${inner}</button>`;
    }).join('');
    wrap.hidden = false;

    wrap.querySelector('[data-ql-act="trending"]')?.addEventListener('click', () => navigate('#/trending'));
    // Today's Briefing opens the homepage briefing once that section exists
    // (phase 3); until then it falls through to the briefings hub.
    wrap.querySelector('[data-ql-act="briefing"]')?.addEventListener('click', () => {
      const el = document.querySelector('[data-home-briefing]');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.querySelector('[data-home-brief-open]')?.click();
        return;
      }
      navigate('#/intelligence');
    });
    // Measure after layout settles — fonts and the row's own width aren't
    // final on the same frame the markup lands.
    requestAnimationFrame(() => fitQuickLinks(wrap));
  }

  // Hide trailing links that don't fit on one row, never dropping below three.
  // Measured rather than breakpoint-guessed, because the label widths differ.
  function fitQuickLinks(wrap) {
    const items = [...wrap.querySelectorAll('[data-ql]')];
    if (!items.length) return;
    items.forEach((el) => { el.hidden = false; });
    const avail = wrap.clientWidth;
    if (!avail) return;
    const gap = parseFloat(getComputedStyle(wrap).columnGap || '8') || 8;
    let used = 0;
    items.forEach((el, i) => {
      const w = el.getBoundingClientRect().width;
      const next = used + w + (i ? gap : 0);
      if (i >= QL_MIN_VISIBLE && next > avail) { el.hidden = true; return; }
      used = next;
    });
  }
  fillStarterChips();
  onResize('home-quicklinks', () => {
    const w = panelEl.querySelector('.search-panel-starters');
    if (w && !isModal) fitQuickLinks(w);
  }, 60);

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
      group: 'explore', tab: 'Web Resources', subtitle: 'Send this to an AI model, or open it in web sources.', icon: SP_TREND_SEC_ICON,
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
    // revamp1054: relocate the results-filter tabs into the search top-zone
    // (centered under the bar, on the coloured band) as icon pills. The
    // component's own flat-nav is hidden; these mirror + drive it.
    requestAnimationFrame(() => syncSearchTabs(aiHost));
  }
  // Mirror the component's flat-nav as centered icon-pill tabs in the top zone.
  function syncSearchTabs(aiHost) {
    const slot = panelEl.querySelector('[data-search-tabs-slot]');
    if (!slot || !aiHost.isConnected) return;
    const flatnav = aiHost.querySelector('.aii-flatnav');
    if (!flatnav) { slot.innerHTML = ''; return; }
    const tabs = [...flatnav.querySelectorAll('.aii-ftab')].map((b) => ({
      group: b.dataset.tabGroup, label: b.textContent.trim(), active: b.classList.contains('is-active'),
    }));
    slot.innerHTML = tabs.map((tb) => `<button type="button" class="stz-tab${tb.active ? ' is-active' : ''}" data-stz-group="${escapeAttr(tb.group)}">${SEARCH_TAB_ICON[tb.group] || ''}<span>${escapeHTML(tb.label)}</span></button>`).join('');
    slot.querySelectorAll('[data-stz-group]').forEach((btn) => btn.addEventListener('click', () => {
      aiHost.querySelector(`.aii-ftab[data-tab-group="${btn.dataset.stzGroup}"]`)?.click();
      requestAnimationFrame(() => syncSearchTabs(aiHost));
    }));
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
        return `<button type="button" class="search-panel-suggest-row is-trend" data-i="${i}" role="option"><span class="search-panel-suggest-ic" aria-hidden="true">${SP_TREND_ICON}</span><span class="search-panel-suggest-name">${escapeHTML(it.query)}</span><span class="search-panel-suggest-tag">Trending</span></button>`;
      }
      if (it.type === 'topic') {
        // Topic row: a grey icon chip on the left (matching the trend row) + a grey
        // "Topic" pill on the right. No parent name — just the type marker.
        return `<button type="button" class="search-panel-suggest-row is-topic" data-i="${i}" role="option"><span class="search-panel-suggest-ic" aria-hidden="true">${topicIconSVG(it.icon || 'globe', '')}</span><span class="search-panel-suggest-name">${escapeHTML(it.name)}</span><span class="search-panel-suggest-tag search-panel-suggest-tag--topic">Topic</span></button>`;
      }
      // Custom "search this term" — a distinct ACTION row (divider above + primary
      // accent + leading search chip + trailing arrow), not another plain result.
      return `<button type="button" class="search-panel-suggest-row is-custom" data-i="${i}" role="option"><span class="search-panel-suggest-name">Search “${escapeHTML(it.term)}”</span><span class="search-panel-suggest-submit" aria-hidden="true"><span>Search</span><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg></span></button>`;
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
// until the user scrolls PAST the search-area quicklinks (featured topic pills +
// the Prompt Library nudge) — they carry the topic-picking promo up top, so the
// subnav would be duplicative until they're gone.
let homeSubnavRevealHandler = null;
function setupHomeSubnavReveal() {
  if (homeSubnavRevealHandler) { window.removeEventListener('scroll', homeSubnavRevealHandler); homeSubnavRevealHandler = null; }
  document.body.classList.remove('home-subnav-on');
  // revamp890: getComputedStyle(documentElement) is one of the most expensive
  // forced style recalcs there is, and this called it on EVERY scroll event
  // just to read --nav-h. --nav-h only changes on resize (fitMainNav), so cache
  // it and refresh there. Also write only when the state flips.
  let navH = 60;
  let lastOn = null;
  const readNavH = () => {
    navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 60;
  };
  readNavH();
  homeSubnavRevealHandler = () => {
    // The hero (title + search bar) is the last thing in the grey zone now that
    // the quicklinks strip became the Featured cards on the white band.
    const strip = document.getElementById('home-search-hero');
    if (!strip) return;
    const on = strip.getBoundingClientRect().bottom <= navH + 4;
    if (on === lastOn) return;
    lastOn = on;
    document.body.classList.toggle('home-subnav-on', on);
  };
  window.addEventListener('scroll', homeSubnavRevealHandler, { passive: true });
  onResize('home-subnav-navh', () => { readNavH(); lastOn = null; homeSubnavRevealHandler(); });
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

// Search is a REAL page now (revamp765) — #/search and #/custom render in
// #content like any route. The old nav-dropdown overlay is gone; these small
// shims keep the panel-internal call sites working.
let searchPageCtl = null;
function initSearchPageModal() { /* search renders as a page — see renderSearchPage */ }

// Legacy name, called from inside the search panel when a typeahead pick
// navigates away — a page navigation replaces the page, nothing to close.
function closeSearchPageModal() {}

// Legacy name, called from the panel's close affordance: leave the search page.
function userCloseSearchModal() {
  navigate(backTarget().hash || '#/');
}

// Nav-triggered Search: on a search page already → leave it; else navigate in.
function openSearchFromNav() {
  const h = routeHash() || '';
  if (h === '#/search' || h.startsWith('#/custom')) { userCloseSearchModal(); return; }
  navigate('#/search');
}

// The search page body: back bar + the shared search panel (modal-mode markup:
// hero fold + input + results) in normal page flow — one document scroll.
function renderSearchPage(container, term) {
  container.innerHTML = `<div class="search-page">
    ${backBarHTML()}
    <div class="search-page-host" data-search-host></div>
  </div>`;
  searchPageCtl = renderSearchPanel(container.querySelector('[data-search-host]'), { mode: 'modal', term });
  // Submits keep the URL shareable; the route handler's staySearch guard makes
  // the resulting route change drive THIS live panel rather than remounting.
  searchPageCtl.onExpand = (t) => {
    const target = '#/custom/' + encodeURIComponent(t);
    if (routeHash() !== target) navigate(target);
  };
  searchPageCtl.onCollapse = () => {
    if ((routeHash() || '').startsWith('#/custom/')) navigate('#/search');
  };
  if (!term || !term.trim()) setTimeout(() => { try { searchPageCtl.focus(); } catch (_) {} }, 80);
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

  if (route.type === 'intelligence') {
    renderIntelligenceHub(content);
    return;
  }

  if (route.type === 'topics') { renderNavDdPage(content, topicsNavDdCfg()); return; }
  if (route.type === 'trending') { renderNavDdPage(content, trendingNavDdCfg()); return; }
  if (route.type === 'prompts') { renderNavDdPage(content, promptsNavDdCfg(route.view)); return; }

  if (route.type === 'search' || route.type === 'custom') {
    renderSearchPage(content, route.type === 'custom' ? decodeURIComponent(route.term || '') : '');
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
