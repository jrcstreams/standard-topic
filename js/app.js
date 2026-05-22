import { initRouter, onRoute, getCurrentRoute } from './utils/router.js';
import { loadAllData, getTopicBySlug, getParentTopics, getFeaturedTopics, getShortcutsForTopic, getRelatedTopics, getTopicsGroupedByParent, getAllShortcutIconKeys, getExternalSearches, getModels, getDefaultModelId, getModelById } from './utils/data.js';
import { getPreferredModelId, setPreferredModelId, submitPrompt } from './utils/ai-models.js';
import { renderIcon, preloadIcons, getIconEmoji } from './utils/icons.js';
import { topicIconSVG } from './utils/topic-icons.js';
import { renderSearchBar, initSearchOverlay } from './components/search-modal.js';
import { renderNewsFeed } from './components/newsfeed.js';
import { renderShortcuts } from './components/shortcuts.js';
import { renderRelatedTopics } from './components/related-topics.js';
import { renderPromptGenerator } from './components/prompt-generator.js';
import { initPromptModal } from './components/prompt-modal.js';
import { initDiscoverModal } from './components/discover-modal.js';
import { initAllTopicsModal } from './components/all-topics-modal.js';
import { initRelatedTopicsModal } from './components/related-topics-modal.js';
import { initPromptPreviewModal } from './components/prompt-preview-modal.js';
import { initSettingsModal } from './components/settings-modal.js';
import { applyReasoningLevelToPrompt } from './utils/settings.js';
import { trackPageView, track } from './utils/analytics.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  // Preload shortcut icon SVGs (non-blocking — renders emoji until resolved)
  preloadIcons(getAllShortcutIconKeys());
  initPromptModal();
  initDiscoverModal();
  initAllTopicsModal();
  initRelatedTopicsModal();
  initPromptPreviewModal();
  initSettingsModal();
  initSearchOverlay();
  setupGlobalTabPillDelegation();

  onRoute((route) => {
    renderLayout(route);
    renderPage(route);
    // Scroll to top after render — use rAF to ensure DOM is settled
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      setSubnavHeightVar();
    });
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
  document.body.classList.remove('sticky-always', 'has-subnav', 'home-mode', 'show-subnav-tabs', 'app-mode');

  // Always render the main sticky bar
  renderStickyHeroBar(siteHeader, route);

  // All pages: main nav always fixed + visible.
  document.body.classList.add('sticky-always');
  siteHeader.classList.add('is-revealed');

  // App-mode: home / topic / custom routes lock the page to viewport
  // height so the two cards behave like an application panel rather
  // than long-scroll content. The footer was removed for this reason.
  if (route.type === 'home' || route.type === 'topic' || route.type === 'custom') {
    document.body.classList.add('app-mode');
  }

  // Title group: icon + name. Hamburger now lives permanently in the
  // main nav next to the brand, so the subnav title is free to sit
  // hard-left without competing with a menu trigger.
  const titleGroup = (iconKey, title) => `
    <div class="topic-banner-titlegroup">
      <div class="topic-banner-titleinner">
        ${topicIconSVG(iconKey, 'topic-banner-icon')}
        <h1 class="topic-banner-title">${escapeHTML(title)}</h1>
      </div>
    </div>
  `;

  if (isHome) {
    document.body.classList.add('home-mode', 'has-subnav');
    subHeader.classList.add('is-subnav');

    const allParents = getFeaturedTopics();
    const topicsHTML = allParents.map(t =>
      `<a href="#/topic/${t.slug}" class="subnav-topic-link">${escapeHTML(t.name)}</a>`
    ).join('');

    subHeader.innerHTML = `
      <div class="topic-banner">
        <div class="topic-banner-row">
          ${titleGroup('house', 'Home')}
          <div class="subnav-topics-inline home-subnav-topics">
            ${topicsHTML}
            <a href="#" class="subnav-action-link subnav-all-topics-link" id="subnav-all-topics-desktop">All Topics +</a>
          </div>
          ${tabPillsRow({ showRelated: false, showAllTopics: false })}
        </div>
      </div>
    `;

    // Two "All Topics +" elements share the same behavior — desktop
    // copy lives inside the chips row, mobile copy lives inside the
    // tab-pill group. Wire both with the same handler.
    subHeader.querySelectorAll('#subnav-all-topics, #subnav-all-topics-desktop').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const searchBar = document.querySelector('.search-bar');
        if (searchBar) searchBar.click();
      });
    });

    if (heroEl) heroEl.innerHTML = '';

    trimOverflowLinks();
    setupResponsiveNav();

    wireChipStripScrollEnd();
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

  // Topic / custom pages also get a sub-nav below the main nav
  if (route.type === 'topic' || route.type === 'custom') {
    document.body.classList.add('has-subnav');
    subHeader.classList.add('is-subnav');

    if (route.type === 'topic') {
      const topic = getTopicBySlug(route.slug);
      if (!topic) return;
      const related = getRelatedTopics(topic);
      // Plain related-topic links — no trailing "More +" CTA. The
      // chip strip scrolls horizontally (with mouse arrows on
      // desktop) so every topic stays reachable.
      const relatedLinksHTML = related.map(t =>
        `<a href="#/topic/${t.slug}" class="subnav-topic-link">${escapeHTML(t.name)}</a>`
      ).join('');

      subHeader.innerHTML = `
        <div class="topic-banner">
          <div class="topic-banner-row">
            ${titleGroup(topic.icon || 'globe', topic.name)}
            ${related.length > 0 ? `
              <div class="subnav-topics-inline">
                ${relatedLinksHTML}
              </div>
            ` : ''}
            ${tabPillsRow({ showRelated: false })}
          </div>
        </div>
      `;

      observeSubnavHeight();
      trimOverflowLinks();
      setupResponsiveNav();
      wireChipStripScrollEnd();
      wireSubnavCompactMeasure();
    } else {
      renderSubNav(subHeader, { title: route.term, iconKey: 'search', prefix: 'Search' });
      observeSubnavHeight();
      setupResponsiveNav();
    }
  }

  if (route.type === 'about' || route.type === 'terms') {
    document.body.classList.add('has-subnav');
    subHeader.classList.add('is-subnav');
    const title = route.type === 'about' ? 'About' : 'Terms & Conditions';
    subHeader.innerHTML = `
      <div class="topic-banner">
        <div class="topic-banner-row">
          ${titleGroup('book', title)}
        </div>
      </div>
    `;
  }

  if (route.type === 'prompt-generator' || route.type === 'about' || route.type === 'terms') {
    setupResponsiveNav();
  }
}

// Mobile-only tab pill row that switches the active application
// section between News, Shortcuts, and (on topic pages) Related Topics.
// CSS hides it at >=900px (where shortcuts is in the sidebar and news
// fills the rest of the layout) and on custom pages (no news feed,
// shortcuts is the page).
function tabPillsRow(opts = {}) {
  const { showRelated = false, showAllTopics = false } = opts;
  const pills = [
    `<button type="button" class="tab-pill tab-pill-newsfeed active" data-tab="newsfeed">
       <span class="tab-pill-label-long">News Feed</span>
       <span class="tab-pill-label-short">News</span>
     </button>`,
    `<button type="button" class="tab-pill tab-pill-shortcuts" data-tab="shortcuts">Shortcuts</button>`,
  ];
  if (showRelated) {
    pills.push(`<button type="button" class="tab-pill tab-pill-related" data-tab="related">Related Topics</button>`);
  }
  if (showAllTopics) {
    pills.push(`<a href="#" class="tab-pill tab-pill-all-topics" id="subnav-all-topics">All Topics +</a>`);
  }
  return `<div class="subnav-tab-pills">${pills.join('')}</div>`;
}

// On every render, sync the active tab from the current route's
// `tab` field (parsed from the URL hash, e.g. #/topic/fintech/shortcuts).
// The click handler is attached once via setupGlobalTabPillDelegation,
// so pills always work — but the active state needs setting on each
// render so refreshes / direct links land on the right tab.
function setupTabPills() {
  const route = getCurrentRoute();
  const tab = route?.tab || 'newsfeed';
  ['newsfeed', 'shortcuts', 'related'].forEach(t =>
    document.body.classList.remove(`active-tab-${t}`)
  );
  document.body.classList.add(`active-tab-${tab}`);
  document.querySelectorAll('#sub-header .tab-pill').forEach(p =>
    p.classList.toggle('active', p.dataset.tab === tab)
  );
}

let tabPillDelegationBound = false;
function setupGlobalTabPillDelegation() {
  if (tabPillDelegationBound) return;
  tabPillDelegationBound = true;
  document.addEventListener('click', (e) => {
    const pill = e.target.closest('#sub-header .tab-pill');
    if (!pill) return;
    e.preventDefault();
    const tab = pill.dataset.tab;
    if (!tab) return;
    // Swap the body class for the visible-section CSS rules.
    ['newsfeed', 'shortcuts', 'related'].forEach(t =>
      document.body.classList.remove(`active-tab-${t}`)
    );
    document.body.classList.add(`active-tab-${tab}`);
    document.querySelectorAll('#sub-header .tab-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.tab === tab)
    );
    // Update the URL (without re-rendering) so refresh / shared links
    // preserve the active tab. News tab is the default — no extra
    // path segment for it. Shortcuts / Related get appended.
    const route = getCurrentRoute();
    if (!route) return;
    let newHash = null;
    if (route.type === 'home') {
      newHash = tab === 'newsfeed' ? '#/' : `#/${tab}`;
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
let subnavCompactLastState = null;
let subnavCompactLastWidth = null;
function wireSubnavCompactMeasure() {
  const titleGroupEl = document.querySelector('#sub-header.is-subnav .topic-banner-titlegroup');
  const titleEl = document.querySelector('#sub-header.is-subnav .topic-banner-title');
  const tabPillsEl = document.querySelector('#sub-header.is-subnav .subnav-tab-pills');
  if (!titleGroupEl || !titleEl || !tabPillsEl) {
    document.body.classList.remove('subnav-compact');
    document.body.classList.remove('subnav-title-shrunk');
    subnavCompactLastState = null;
    return;
  }
  // Detect when the title actually wraps to multiple lines OR
  // gets too close to the tab pills. Either condition means we
  // should shrink. Wrap detection is more reliable for the case
  // where the title group itself is in the grid layout (title and
  // tabs on different rows), where the gap-based measure misses
  // the multi-line wrap.
  const isTooLarge = () => {
    const cs = getComputedStyle(titleEl);
    const fontSize = parseFloat(cs.fontSize) || 16;
    const lineHeightRaw = parseFloat(cs.lineHeight);
    const lineHeight = isNaN(lineHeightRaw) ? fontSize * 1.2 : lineHeightRaw;
    const singleLineMax = lineHeight + 6;
    const titleHeight = titleEl.getBoundingClientRect().height;
    if (titleHeight > singleLineMax) return true;
    const titleRight = titleGroupEl.getBoundingClientRect().right;
    const tabsLeft = tabPillsEl.getBoundingClientRect().left;
    // Only compare horizontal gap if title and tabs share the
    // same row (similar y position). In the mobile grid the title
    // is row 1 and tabs are also row 1 — they share. Cramped if
    // gap < 18px.
    const titleTop = titleGroupEl.getBoundingClientRect().top;
    const tabsTop = tabPillsEl.getBoundingClientRect().top;
    if (Math.abs(titleTop - tabsTop) < 24) {
      return (tabsLeft - titleRight) < 18;
    }
    return false;
  };
  // Apply the smallest tier necessary to keep the title on one
  // line. Three tiers:
  //   0 — natural size (1.5rem)
  //   1 — subnav-title-shrunk (1.15rem)
  //   2 — subnav-title-shrunk-2 (0.95rem)
  // Strategy: start from tier 0 (remove all classes), measure. If
  // still too large, escalate to tier 1, measure again. If still
  // too large, escalate to tier 2. Each measurement happens in its
  // own rAF tick so layout settles between class applications.
  const measure = () => {
    if (!window.matchMedia('(max-width: 899.98px)').matches) {
      document.body.classList.remove('subnav-title-shrunk');
      document.body.classList.remove('subnav-title-shrunk-2');
      subnavCompactLastState = false;
      return;
    }
    // Reset to tier 0
    document.body.classList.remove('subnav-title-shrunk');
    document.body.classList.remove('subnav-title-shrunk-2');
    // Force a synchronous layout read by accessing offsetHeight,
    // then test. If too large, escalate.
    void titleEl.offsetHeight;
    if (!isTooLarge()) {
      subnavCompactLastState = 0;
      return;
    }
    document.body.classList.add('subnav-title-shrunk');
    void titleEl.offsetHeight;
    if (!isTooLarge()) {
      subnavCompactLastState = 1;
      return;
    }
    document.body.classList.add('subnav-title-shrunk-2');
    subnavCompactLastState = 2;
  };
  // Listen to window.resize (viewport-driven) instead of
  // ResizeObserver on documentElement — the observer was firing on
  // class-induced height changes too, creating the flicker loop.
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
  // Initial measure deferred to next frame so layout has settled.
  requestAnimationFrame(measure);
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
    const relatedBtnReset = document.getElementById('subnav-related-btn');
    if (relatedBtnReset) relatedBtnReset.style.display = 'none';

    // Every chip stays visible at every viewport — the chip strip
    // is now a horizontal scroller (overflow-x: auto) with arrow
    // affordances on hover-capable pointers. Trim only runs in
    // home-subnav mode, where we still want the "show ≥4 featured
    // chips on row 1 or collapse to All Topics +" logic.
    const isApp = document.body.classList.contains('app-mode');
    const isMobile = window.matchMedia('(max-width: 899.98px)').matches;
    if (isApp && isMobile) {
      container.classList.remove('is-empty');
      return;
    }
    // Topic pages at desktop: also let chips scroll. Only home
    // subnav at desktop still uses trim (for its collapse logic).
    const isHomeAtDesktop = !!actionLink && !moreLink;
    if (!isHomeAtDesktop) {
      container.classList.remove('is-empty');
      return;
    }

    const containerRight = container.getBoundingClientRect().right;
    // First measure with "More +" / "All Topics +" reserved so we can
    // drop links to make room.
    const moreWidth = moreLink ? moreLink.offsetWidth + 20 : 0;
    const actionWidth = actionLink ? actionLink.offsetWidth + 20 : 0;
    let cutoff = containerRight - moreWidth - actionWidth;

    let visibleCount = 0;
    let hiddenCount = 0;
    links.forEach(l => {
      if (l.getBoundingClientRect().right > cutoff) {
        l.style.display = 'none';
        hiddenCount++;
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
    if (isHomeRow && links.length >= 4) {
      const row = container.parentElement;
      const titleGroup = row?.querySelector('.topic-banner-titlegroup');
      const isWrapped = !!titleGroup && container.offsetTop > titleGroup.offsetTop + 4;
      if (isWrapped || visibleCount < 4) {
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

function renderStickyHeroBar(container, route) {
  const featured = getFeaturedTopics();
  const featuredLinksHTML = featured.map(t => `
    <a href="#/topic/${t.slug}" class="navmenu-topic-link">
      <span class="navmenu-topic-icon">${topicIconSVG(t.icon || 'globe', '')}</span>
      <span class="navmenu-topic-name">${escapeHTML(t.name)}</span>
    </a>
  `).join('');

  container.innerHTML = `
    <div class="sticky-hero-inner">
      <button class="nav-hamburger" id="nav-hamburger" aria-label="Open menu">
        <span></span><span></span><span></span>
      </button>
      <a href="#/" class="sticky-brand" id="sticky-brand-link">
        <span class="sticky-title">Standard Topic</span>
      </a>
      <span class="sticky-tagline">News, Resources and AI Knowledge. On any topic.</span>
      <div class="sticky-actions">
        <div class="sticky-search" id="sticky-search-container"></div>
        <a href="#/prompt-generator" class="sticky-cta" id="nav-cta" aria-label="Prompt Builder">
          <svg class="sticky-cta-sparkle" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/>
            <path d="M19 3l.6 1.6L21.2 5.2 19.6 5.8 19 7.4 18.4 5.8 16.8 5.2 18.4 4.6z"/>
          </svg>
          <span class="sticky-cta-full">Prompt Builder</span>
          <span class="sticky-cta-short">Prompt Builder</span>
        </a>
        <a href="#/" class="sticky-home" id="nav-home" aria-label="Home">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
            <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          </svg>
        </a>
        <button type="button" class="sticky-settings" id="nav-settings" aria-label="Settings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </div>

  `;
  renderSearchBar(document.getElementById('sticky-search-container'), route, { compact: true });

  // Settings gear in the main nav — opens the Settings modal.
  document.getElementById('nav-settings')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('open-settings-modal'));
  });

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
        <button type="button" class="navmenu-home navmenu-settings" id="navmenu-settings-head" aria-label="Settings">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="navmenu-search" id="navmenu-search-container"></div>
    <nav class="navmenu-quicklinks">
      <a href="#/prompt-generator" class="navmenu-quicklink navmenu-cta" id="navmenu-prompt-link">
        <svg class="navmenu-cta-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/>
          <path d="M19 3l.6 1.6L21.2 5.2 19.6 5.8 19 7.4 18.4 5.8 16.8 5.2 18.4 4.6z"/>
        </svg>
        <span class="navmenu-cta-label">Prompt Builder</span>
        <svg class="navmenu-cta-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="13 6 19 12 13 18"/>
        </svg>
      </a>
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
    </nav>
    <div class="navmenu-scroll">
      <div class="navmenu-featured-label">Featured Topics</div>
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

  // Settings gear in the navmenu head — closes the menu, opens
  // the Settings modal.
  document.getElementById('navmenu-settings-head')?.addEventListener('click', () => {
    document.body.classList.remove('navmenu-open');
    window.dispatchEvent(new CustomEvent('open-settings-modal'));
  });

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
    const searchBar = document.querySelector('.search-bar');
    if (searchBar) searchBar.click();
  });

  // Clicking logo/title always goes home with News Feed active —
  // even if already on #/, force re-render so mobile tab resets.
  container.querySelector('#sticky-brand-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (window.location.hash === '#/' || window.location.hash === '' || window.location.hash === '#') {
      // Already on home — force re-render with newsfeed tab
      document.body.classList.remove('active-tab-shortcuts', 'active-tab-related');
      document.body.classList.add('active-tab-newsfeed');
      document.querySelectorAll('#sub-header .tab-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.tab === 'newsfeed');
      });
      window.scrollTo(0, 0);
    } else {
      window.location.hash = '#/';
    }
  });
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
  ['newsfeed', 'shortcuts', 'related'].forEach(t => {
    document.body.classList.remove(`active-tab-${t}`);
  });
}


function renderTopicLayout(container, { topic, route, isHome, isCustom = false, customTerm = '' }) {
  cleanupTopicLayoutObservers();

  if (isCustom) {
    // Custom: just AI Shortcuts. No News Feed (no RSS for arbitrary
    // search terms) and no Related (not a real topic).
    container.innerHTML = `
      <div class="topic-layout is-custom" id="topic-layout">
        <section class="layout-section" id="section-shortcuts"></section>
      </div>
    `;
  } else if (isHome) {
    // Homepage: Shortcuts + News Feed. No Related section (home
    // already lists featured topics in the subnav).
    container.innerHTML = `
      <div class="topic-layout" id="topic-layout">
        <section class="layout-section" id="section-shortcuts"></section>
        <section class="layout-section" id="section-newsfeed"></section>
      </div>
    `;
  } else {
    // Topic pages: Shortcuts + News Feed + Related Topics.
    container.innerHTML = `
      <div class="topic-layout" id="topic-layout">
        <section class="layout-section" id="section-shortcuts"></section>
        <section class="layout-section" id="section-newsfeed"></section>
        <section class="layout-section" id="section-related"></section>
      </div>
    `;
  }

  const shortcutsSection = container.querySelector('#section-shortcuts');
  const feedSection = container.querySelector('#section-newsfeed');
  const relatedSection = container.querySelector('#section-related');

  renderShortcutsSidebar(shortcutsSection, route, isHome, isCustom, customTerm);
  if (feedSection) {
    renderNewsFeed(feedSection, topic, isHome);
  }
  if (relatedSection && topic) {
    renderRelatedSection(relatedSection, topic);
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

const TAB_PANELS = ['newsfeed', 'shortcuts', 'related'];

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

function renderShortcutsSidebar(container, route, isHome, isCustom = false, customTerm = '') {
  const topic = isHome ? getTopicBySlug('home') : (isCustom ? null : getTopicBySlug(route.slug));
  const topicName = isCustom ? customTerm : (isHome ? '' : topic?.name || '');

  const topicSlug = isHome ? 'home' : (isCustom ? '_custom' : route.slug);
  const all = getShortcutsForTopic(topicSlug);

  // Content Shortcuts (Google News, Reddit, X, YouTube) — only on topic
  // and custom-search pages where there's a query to send. Home doesn't
  // surface these because there's no specific topic context yet.
  const contentSearches = (!isHome && topicName) ? getExternalSearches() : [];

  const cardClasses = ['sidebar-card', 'shortcuts-sidebar'];

  const titlePillHTML = topicName ? `<span class="section-topic-pill">${escapeHTML(topicName)}</span>` : '';
  // AI Shortcuts run in always-multi-select mode now — clicking a
   // row toggles selection, and a per-row arrow opens the modal for
   // that single shortcut directly. The `data-multi="1"` flag + the
   // .is-multi-select class are set up-front and never toggled off.
  let html = `
    <div class="${cardClasses.join(' ')} is-multi-select" data-multi="1">
      <div class="sidebar-card-header">
        <h3 class="sidebar-card-title">Shortcuts${titlePillHTML}</h3>
      </div>
      ${all.length > 0 ? `
        <div class="shortcuts-multi-submit-wrap" role="region" aria-label="Prompt submission" aria-hidden="true">
          <div class="multi-controls-head">
            <span class="shortcuts-multi-count" aria-live="polite">
              <strong id="shortcuts-multi-submit-count">0</strong>
              <span class="shortcuts-multi-count-label">selected</span>
            </span>
            <div class="multi-controls-utils">
              <button type="button" class="shortcuts-multi-select-all" id="shortcuts-multi-select-all">Select all</button>
              <span class="multi-controls-util-divider" aria-hidden="true">·</span>
              <button type="button" class="shortcuts-multi-clear" id="shortcuts-multi-clear">Clear</button>
            </div>
          </div>
          <div class="multi-controls-model-row">
            <span class="multi-controls-model-label">Send to</span>
            <button type="button" class="multi-controls-model-btn" id="multi-controls-model-btn" aria-haspopup="listbox" aria-expanded="false">
              <span class="multi-controls-model-name" id="multi-controls-model-name">ChatGPT</span>
              <svg class="multi-controls-model-caret" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 4.5 6 8 9 4.5"/>
              </svg>
            </button>
            <ul class="multi-controls-model-menu" id="multi-controls-model-menu" role="listbox" hidden></ul>
          </div>
          <div class="multi-controls-buttons">
            <button type="button" class="shortcuts-multi-preview" id="shortcuts-multi-preview">Preview</button>
            <button type="button" class="shortcuts-multi-submit" id="shortcuts-multi-submit">
              <span>Direct Submit</span>
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

  // Quick Links subsection (external searches — Google News, Reddit, X, YouTube)
  if (contentSearches.length > 0) {
    html += `
      <section class="shortcuts-subsection quick-links-subsection">
        <div class="shortcuts-subsection-header">
          <h4 class="shortcuts-subsection-title">Quick Links</h4>
        </div>
        <ul class="ai-shortcut-bullet-list quick-links-bullet-list">
          ${contentSearches.map(s => quickLinkPill(s, topicName)).join('')}
        </ul>
      </section>
    `;
  }

  // AI Shortcuts subsection — shortcuts are grouped into
  // Discover / Learn / Analyze (and an "Other" bucket for anything
  // unclassified) using a name-keyword heuristic. Each shortcut row
  // is a checkbox + name + direct-access arrow. Multi-select is
  // always on, so no toggle in the header.
  html += `
    <section class="shortcuts-subsection ai-shortcuts-subsection">
      <div class="shortcuts-subsection-header">
        <h4 class="shortcuts-subsection-title">AI Shortcuts</h4>
      </div>
  `;

  if (all.length === 0) {
    html += `<p class="sidebar-empty">No shortcuts yet.</p>`;
  } else {
    const groups = groupShortcuts(all);
    const groupOrder = [
      { key: 'discover', label: 'Discover' },
      { key: 'learn', label: 'Learn' },
      { key: 'analyze', label: 'Analyze' },
      { key: 'other', label: 'More' },
    ];
    groupOrder.forEach(g => {
      const items = groups[g.key];
      if (!items || items.length === 0) return;
      html += `
        <div class="ai-shortcut-group">
          <h5 class="ai-shortcut-group-label">${g.label}</h5>
          <ul class="ai-shortcut-bullet-list">
            ${items.map(s => shortcutBulletItem(s, topicName)).join('')}
          </ul>
        </div>
      `;
    });
    html += `<div class="shortcuts-list-tail-spacer" aria-hidden="true"></div>`;
  }
  html += `</section>`;
  html += `</div>`; /* close .shortcuts-scroll-wrap */
  html += `<div class="shortcuts-toast" id="shortcuts-toast" role="status" aria-live="polite"></div>`;
  html += `</div>`; /* close .shortcuts-sidebar */
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
  container.querySelectorAll('.quick-link-pill').forEach(link => {
    link.addEventListener('click', () => {
      const name = link.dataset.name || '';
      track('content_shortcut_click', { name, route: window.location.hash || '#/' });
    });
  });

  const card = container.querySelector('.sidebar-card');
  const submitBtn = container.querySelector('#shortcuts-multi-submit');
  const previewBtn = container.querySelector('#shortcuts-multi-preview');
  const clearBtn = container.querySelector('#shortcuts-multi-clear');
  const selectAllBtn = container.querySelector('#shortcuts-multi-select-all');
  const submitWrap = container.querySelector('.shortcuts-multi-submit-wrap');
  const countEl = container.querySelector('#shortcuts-multi-submit-count');
  const modelBtn = container.querySelector('#multi-controls-model-btn');
  const modelNameEl = container.querySelector('#multi-controls-model-name');
  const modelMenu = container.querySelector('#multi-controls-model-menu');

  // Model picker — reflects the user's preferred model, and lets
  // them swap it inline. Direct Submit uses this; Preview opens the
  // full prompt modal where the user can also change models.
  const refreshModelChoice = () => {
    if (!modelNameEl) return null;
    const models = getModels();
    const preferredId = getPreferredModelId(getDefaultModelId());
    const current = getModelById(preferredId) || models[0] || null;
    modelNameEl.textContent = current?.name || 'ChatGPT';
    return current;
  };
  if (modelMenu) {
    const models = getModels();
    modelMenu.innerHTML = models.map(m => `
      <li>
        <button type="button" class="multi-controls-model-option" role="option" data-model-id="${escapeAttr(m.id)}">
          ${escapeHTML(m.name)}
        </button>
      </li>
    `).join('');
  }
  refreshModelChoice();
  // Re-read preferred model when the Settings modal saves a change,
  // so the label switches from (e.g.) ChatGPT to Perplexity without
  // the user having to refresh.
  const onPreferredModelChanged = () => refreshModelChoice();
  window.addEventListener('preferred-model-changed', onPreferredModelChanged);
  const closeModelMenu = () => {
    if (!modelMenu || !modelBtn) return;
    modelMenu.hidden = true;
    modelBtn.setAttribute('aria-expanded', 'false');
  };
  modelBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!modelMenu) return;
    const open = !modelMenu.hidden;
    modelMenu.hidden = open;
    modelBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
  });
  modelMenu?.addEventListener('click', (e) => {
    const opt = e.target.closest('.multi-controls-model-option');
    if (!opt) return;
    setPreferredModelId(opt.dataset.modelId);
    refreshModelChoice();
    closeModelMenu();
  });
  document.addEventListener('click', (e) => {
    if (!modelMenu || modelMenu.hidden) return;
    if (modelBtn?.contains(e.target) || modelMenu.contains(e.target)) return;
    closeModelMenu();
  });

  // Submit bar: floats in at the bottom of the card whenever any
  // shortcut is selected, slides out when the selection is empty.
  // Visibility driven by .is-visible class so we can transition.
  const updateSubmit = () => {
    if (!submitBtn || !submitWrap) return;
    const allShortcuts = container.querySelectorAll('.ai-shortcut-select-btn');
    const selected = container.querySelectorAll('.ai-shortcut-select-btn.is-multi-selected');
    const has = selected.length > 0;
    const allSelected = allShortcuts.length > 0 && selected.length === allShortcuts.length;
    submitWrap.classList.toggle('is-visible', has);
    submitWrap.setAttribute('aria-hidden', has ? 'false' : 'true');
    submitBtn.classList.toggle('is-active', has);
    submitBtn.disabled = !has;
    if (previewBtn) previewBtn.disabled = !has;
    if (clearBtn) clearBtn.disabled = !has;
    if (selectAllBtn) selectAllBtn.disabled = allSelected;
    if (countEl) countEl.textContent = String(selected.length);
  };

  // Build the combined prompt + a display name from the current
  // selection. Single selection bypasses the multi-prompt intro.
  // The user's session reasoning-level (Brief / Standard / Detailed
  // / Deep) is prepended to whatever prompt we end up with.
  const buildSubmission = () => {
    const selected = Array.from(container.querySelectorAll('.ai-shortcut-select-btn.is-multi-selected'));
    if (selected.length === 0) return null;
    if (selected.length === 1) {
      const btn = selected[0];
      return {
        prompt: applyReasoningLevelToPrompt(btn.dataset.prompt || ''),
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
      prompt: applyReasoningLevelToPrompt(`${intro}\n\n${combined}`),
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


  clearBtn?.addEventListener('click', () => {
    container.querySelectorAll('.ai-shortcut-select-btn.is-multi-selected')
      .forEach(b => {
        b.classList.remove('is-multi-selected');
        b.setAttribute('aria-pressed', 'false');
      });
    updateSubmit();
  });

  selectAllBtn?.addEventListener('click', () => {
    container.querySelectorAll('.ai-shortcut-select-btn')
      .forEach(b => {
        b.classList.add('is-multi-selected');
        b.setAttribute('aria-pressed', 'true');
      });
    updateSubmit();
  });

  // Preview Submission — opens the existing prompt-modal where the
  // user can review, edit, copy, change AI model, and submit.
  previewBtn?.addEventListener('click', () => {
    const sub = buildSubmission();
    if (!sub) return;
    track(sub.count === 1 ? 'shortcut_click' : 'multi_shortcut_submit', {
      [sub.count === 1 ? 'shortcut_name' : 'count']: sub.count === 1 ? sub.name : sub.count,
      route: window.location.hash || '#/',
    });
    window.dispatchEvent(new CustomEvent('open-prompt-modal', {
      detail: { prompt: sub.prompt, name: sub.name, iconKey: sub.iconKey, count: sub.count },
    }));
  });

  // Direct Submit — fires the prompt straight to the currently
  // chosen AI model (copy-to-clipboard + open the model's chat URL
  // with prompt pre-filled). Skips the preview modal entirely.
  submitBtn?.addEventListener('click', async () => {
    const sub = buildSubmission();
    if (!sub) return;
    const model = refreshModelChoice();
    if (!model) return;
    track('direct_submit', {
      model: model.id,
      count: sub.count,
      route: window.location.hash || '#/',
    });
    try {
      await submitPrompt(model, sub.prompt);
    } catch (err) {
      console.error('Direct submit failed', err);
    }
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
function groupShortcuts(shortcuts) {
  const groups = { discover: [], learn: [], analyze: [], other: [] };
  const learnRE = /(guide|glossary|beginner|primer|fundamentals|basics|deep ?dive|history|background|key players|key terms|how |where to|why )/i;
  const analyzeRE = /(analy|impact|affect|hype|reality|compare| vs | versus |implications|outcome|signal|forecast|prediction|risk|controversy|debate)/i;
  const discoverRE = /(news|snapshot|update|headline|trend|watch|latest|now|today|roundup|hot|spotlight|brief|digest)/i;
  shortcuts.forEach(s => {
    const name = s.name || '';
    if (learnRE.test(name)) groups.learn.push(s);
    else if (analyzeRE.test(name)) groups.analyze.push(s);
    else if (discoverRE.test(name)) groups.discover.push(s);
    else groups.other.push(s);
  });
  return groups;
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
          <p class="about-lead">A single destination for news, AI-powered knowledge shortcuts, and a prompt builder — organized by topic.</p>
        </div>

        <div class="about-section">
          <h3>The Site</h3>
          <p>Standard Topic brings together curated news feeds, AI shortcuts, and a knowledge prompt builder across a growing library of topics. Each topic page gives you a live news feed, one-click AI prompts you can send to your preferred model, and connections to related subjects. You can also search or type any custom topic to build a prompt-ready page around it.</p>
          <h4 class="about-sub-heading">How It Works</h4>
          <ul>
            <li><strong>Topics</strong> — Browse the topic library or search for anything. Each topic has its own page with curated content.</li>
            <li><strong>AI Shortcuts</strong> — Pre-built prompts that open directly in ChatGPT, Claude, Gemini, Perplexity, and other models.</li>
            <li><strong>News Feed</strong> — Live RSS-powered news for every topic, updated continuously.</li>
            <li><strong>Prompt Builder</strong> — Customize topics, content type, format, tone, and more to generate a tailored AI prompt.</li>
          </ul>
          <h4 class="about-sub-heading">Open Source</h4>
          <p>Standard Topic is open source. View the code, report issues, or contribute on GitHub.</p>
          <a href="https://github.com/jrcstreams/standard-topic" target="_blank" rel="noopener noreferrer" class="about-cta-link">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
            <span>View on GitHub</span>
          </a>
        </div>

        <div class="about-section about-creator">
          <h3>Created by</h3>
          <p>Standard Topic was created by <strong>John Choudhari</strong>. John is a lifelong technology enthusiast, with over a decade of experience in the digital media and communications industries.</p>
          <div class="about-cta-row">
            <a href="https://johnchoud.com" target="_blank" rel="noopener noreferrer" class="about-cta-link">Portfolio</a>
            <a href="https://www.linkedin.com/in/johnchoudhari/" target="_blank" rel="noopener noreferrer" class="about-cta-link">LinkedIn</a>
          </div>
        </div>

        <div class="about-section about-disclaimer">
          <h3>Disclaimer</h3>
          <p>Standard Topic provides shortcuts to third-party AI platforms. We are not responsible for the content generated by these platforms or actions taken after leaving this site. AI-generated content should always be verified independently.</p>
          <p>The full Terms &amp; Conditions governing use of this site can be found <a href="#/terms">here</a>.</p>
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
          <p class="about-lead">The rules of the road for using Standard Topic. Short, plain-English, and meant to be read.</p>
          <p class="about-lead" style="font-size:0.9rem;opacity:0.7;">Last updated: May 6, 2026</p>
        </div>

        <div class="about-section">
          <h3>1. Acceptance</h3>
          <p>By accessing or using Standard Topic (the "Site"), you agree to these Terms &amp; Conditions. If you do not agree, do not use the Site. These terms apply every time you visit.</p>
        </div>

        <div class="about-section">
          <h3>2. What the Site Is</h3>
          <p>Standard Topic is a free, non-commercial, open-source tool that organizes publicly available information by topic. The Site offers four core functions:</p>
          <ul>
            <li><strong>Topic pages</strong> that aggregate links and references to a subject.</li>
            <li><strong>News feeds</strong> displayed via embedded RSS widgets provided by rss.app, using publicly available RSS sources.</li>
            <li><strong>AI Shortcuts</strong> that open a preset prompt in a third-party AI service (e.g., ChatGPT, Claude, Gemini, Perplexity) in a new browser tab.</li>
            <li><strong>A Prompt Builder</strong> that composes a text prompt in your browser and lets you send it to an AI service of your choice.</li>
          </ul>
          <p>Standard Topic does not host news content, does not operate any AI model, and does not process your queries on a server. Everything runs in your browser.</p>
        </div>

        <div class="about-section">
          <h3>3. No Accounts, No Personal Data Collected</h3>
          <p>The Site does not require an account. It does not ask for your name, email, or any personal information. It does not set advertising cookies and does not sell or share data with advertising networks.</p>
          <p>The Site's own servers do not receive your prompts, your searches, or your browsing activity. If GitHub (which hosts the Site) or any third-party service you interact with keeps its own logs, those are governed by their respective policies.</p>
        </div>

        <div class="about-section">
          <h3>4. Analytics</h3>
          <p>The Site uses Google Analytics 4 to measure aggregate traffic and usage patterns &mdash; for example, how many people visit a topic page, how often AI Shortcuts are used, and which AI models are most commonly selected. This is used to improve the Site, not to identify you.</p>
          <p>Analytics is configured with privacy-respecting defaults: IP addresses are anonymized before storage, Google Signals (cross-device user graphs) is disabled, and ad-personalization signals are disabled. The Site does not collect prompt text, search terms typed into the Prompt Builder, or any other personally identifying information through analytics. If you'd like to block analytics entirely, any standard tracker-blocker or privacy extension will do so; the Site continues to work normally without it.</p>
        </div>

        <div class="about-section">
          <h3>5. Local Browser Storage</h3>
          <p>The Site uses your browser's <code>localStorage</code> to remember a small number of interface preferences &mdash; for example, which AI model you prefer to send prompts to. This data stays on your device and is never transmitted to Standard Topic or anyone else. You can clear it at any time via your browser settings.</p>
        </div>

        <div class="about-section">
          <h3>6. Third-Party Services &amp; Links</h3>
          <p>The Site links to and embeds content from third parties, including but not limited to:</p>
          <ul>
            <li><strong>AI providers:</strong> OpenAI (ChatGPT), Anthropic (Claude), Google (Gemini), Perplexity, and others.</li>
            <li><strong>Feed embeds:</strong> rss.app widgets loaded from <code>widget.rss.app</code>.</li>
            <li><strong>Search &amp; reference:</strong> Google News, Bing News, DuckDuckGo, Reddit, YouTube, Wikipedia.</li>
            <li><strong>Fonts:</strong> Google Fonts, served from <code>fonts.googleapis.com</code> and <code>fonts.gstatic.com</code>.</li>
            <li><strong>Code hosting:</strong> GitHub, which hosts both the source code and the deployed Site via GitHub Pages.</li>
          </ul>
          <p>Standard Topic is not affiliated with, endorsed by, or sponsored by any of these companies. Their trademarks and logos are the property of their respective owners. When you click a link or submit a prompt to one of these services, you leave the Site and their terms of service and privacy policies apply &mdash; not ours. Review them directly before using those services.</p>
        </div>

        <div class="about-section">
          <h3>7. AI-Generated Content</h3>
          <p>AI Shortcuts and the Prompt Builder produce text that is sent to a third-party AI model of your choice. The model's response is generated entirely by that third party. Standard Topic has no control over and accepts no responsibility for:</p>
          <ul>
            <li>the accuracy, completeness, or timeliness of any AI output;</li>
            <li>content that is inaccurate, biased, offensive, or harmful;</li>
            <li>how the AI provider handles or stores your prompt and response.</li>
          </ul>
          <p>AI output is not professional advice. Do not rely on it for medical, legal, financial, safety-critical, or other consequential decisions. Always verify important information with authoritative sources.</p>
        </div>

        <div class="about-section">
          <h3>8. News &amp; RSS Feeds</h3>
          <p>News feed content is published by third-party outlets and surfaced on the Site via rss.app's embedded widget. Standard Topic does not write, edit, select, or endorse any individual article. Headlines, summaries, images, and links belong to the originating publishers. For copyright concerns or corrections about specific articles, contact the originating publisher directly.</p>
        </div>

        <div class="about-section">
          <h3>9. Intellectual Property</h3>
          <p>The source code of Standard Topic is open source and published at <a href="https://github.com/jrcstreams/standard-topic" target="_blank" rel="noopener noreferrer">github.com/jrcstreams/standard-topic</a>. Any reuse is subject to the license published in that repository.</p>
          <p>The "Standard Topic" name and logo, the site's written copy, and its original visual design are the property of the site's creator. All third-party names, logos, and marks referenced on the Site belong to their respective owners and are used for identification purposes only.</p>
        </div>

        <div class="about-section">
          <h3>10. Acceptable Use</h3>
          <p>You agree to use the Site only for lawful, personal, informational purposes. You agree not to:</p>
          <ul>
            <li>use the Site to violate any law or the rights of others;</li>
            <li>attempt to disrupt, overload, or circumvent the Site or any third-party service it links to;</li>
            <li>scrape, mirror, or republish the Site in a way that misrepresents it as your own;</li>
            <li>use the Prompt Builder or AI Shortcuts to generate content that is illegal, harmful, harassing, or that violates the terms of the receiving AI provider.</li>
          </ul>
        </div>

        <div class="about-section">
          <h3>11. Disclaimer of Warranties</h3>
          <p>The Site is provided on an "AS IS" and "AS AVAILABLE" basis, without warranties of any kind, whether express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, accuracy, or non-infringement. Standard Topic does not warrant that the Site will be uninterrupted, error-free, or secure, or that defects will be corrected.</p>
        </div>

        <div class="about-section">
          <h3>12. Limitation of Liability</h3>
          <p>To the fullest extent permitted by law, Standard Topic and its creator shall not be liable for any indirect, incidental, special, consequential, or punitive damages &mdash; or any loss of data, revenue, or profits &mdash; arising out of or in connection with your use of the Site, any third-party service accessed through the Site, or any content (including AI-generated output) obtained through the Site. Because the Site is free to use, any direct liability is limited to the amount you paid to access it, which is zero.</p>
        </div>

        <div class="about-section">
          <h3>13. Changes to These Terms</h3>
          <p>These terms may be updated from time to time. The "Last updated" date at the top of this page indicates when the current version took effect. Continued use of the Site after an update constitutes acceptance of the revised terms. Material changes will be reflected on this page; you are responsible for reviewing it periodically.</p>
        </div>

        <div class="about-section">
          <h3>14. Termination</h3>
          <p>Because the Site does not require an account, "termination" simply means you stop using it. Standard Topic reserves the right to modify, suspend, or discontinue the Site (or any portion of it) at any time, without notice, for any reason.</p>
        </div>

        <div class="about-section">
          <h3>15. Governing Law</h3>
          <p>These terms are governed by the laws applicable at the place of residence of the Site's creator, without regard to conflict-of-law principles. If any provision is found unenforceable, the remaining provisions remain in full effect.</p>
        </div>

        <div class="about-section">
          <h3>16. Contact</h3>
          <p>Questions, bug reports, or concerns about these terms or the Site can be raised via the project's GitHub repository at <a href="https://github.com/jrcstreams/standard-topic/issues" target="_blank" rel="noopener noreferrer">github.com/jrcstreams/standard-topic/issues</a>.</p>
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
