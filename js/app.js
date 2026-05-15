import { initRouter, onRoute, getCurrentRoute } from './utils/router.js';
import { loadAllData, getTopicBySlug, getParentTopics, getFeaturedTopics, getShortcutsForTopic, getRelatedTopics, getTopicsGroupedByParent, getAllShortcutIconKeys, getExternalSearches } from './utils/data.js';
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
  initSearchOverlay();

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
            <a href="#" class="subnav-action-link subnav-all-topics-link" id="subnav-all-topics">All Topics +</a>
          </div>
          ${tabPillsRow({ showRelated: false })}
        </div>
      </div>
    `;

    subHeader.querySelector('#subnav-all-topics')?.addEventListener('click', (e) => {
      e.preventDefault();
      const searchBar = document.querySelector('.search-bar');
      if (searchBar) searchBar.click();
    });

    if (heroEl) heroEl.innerHTML = '';

    trimOverflowLinks();
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
          ${titleGroup('rocket', 'Build a Knowledge Prompt')}
        </div>
      </div>
    `;
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
      const relatedLinksHTML = related.map(t =>
        `<a href="#/topic/${t.slug}" class="subnav-topic-link">${escapeHTML(t.name)}</a>`
      ).join('') + `<a href="#" class="subnav-more-link" id="subnav-more-related">More +</a>`;

      subHeader.innerHTML = `
        <div class="topic-banner">
          <div class="topic-banner-row">
            ${titleGroup(topic.icon || 'globe', topic.name)}
            ${related.length > 0 ? `
              <div class="subnav-topics-inline">
                ${relatedLinksHTML}
              </div>
              <a href="#" class="subnav-related-btn" id="subnav-related-btn">Related Topics +</a>
            ` : ''}
            ${tabPillsRow({ showRelated: related.length > 0 })}
          </div>
        </div>
      `;

      const openRelatedModal = (e) => {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('open-related-topics-modal', {
          detail: { topics: related, title: 'Related Topics', topicName: topic.name },
        }));
      };
      subHeader.querySelector('#subnav-more-related')?.addEventListener('click', openRelatedModal);
      subHeader.querySelector('#subnav-related-btn')?.addEventListener('click', openRelatedModal);

      observeSubnavHeight();
      trimOverflowLinks();
      setupResponsiveNav();
    } else {
      renderSubNav(subHeader, { title: route.term, iconKey: 'search' });
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
  const { showRelated = false } = opts;
  const pills = [
    `<button type="button" class="tab-pill tab-pill-newsfeed active" data-tab="newsfeed">News</button>`,
    `<button type="button" class="tab-pill tab-pill-shortcuts" data-tab="shortcuts">Shortcuts</button>`,
  ];
  if (showRelated) {
    pills.push(`<button type="button" class="tab-pill tab-pill-related" data-tab="related">Related</button>`);
  }
  return `<div class="subnav-tab-pills">${pills.join('')}</div>`;
}

// Wire pill clicks to switch active sections via body class. Called
// after the page has rendered so the pills and sections are in the
// DOM. Reset to newsfeed on every render.
function setupTabPills() {
  document.body.classList.remove('active-tab-newsfeed', 'active-tab-shortcuts', 'active-tab-related');
  document.body.classList.add('active-tab-newsfeed');
  document.querySelectorAll('#sub-header .tab-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = pill.dataset.tab;
      if (!tab) return;
      ['newsfeed', 'shortcuts', 'related'].forEach(t =>
        document.body.classList.remove(`active-tab-${t}`)
      );
      document.body.classList.add(`active-tab-${tab}`);
      document.querySelectorAll('#sub-header .tab-pill').forEach(p =>
        p.classList.toggle('active', p.dataset.tab === tab)
      );
    });
  });
}

// Unified subnav renderer for custom search pages
function renderSubNav(container, { title, iconKey }) {
  container.innerHTML = `
    <div class="topic-banner">
      <div class="topic-banner-row">
        <div class="topic-banner-titlegroup">
          <div class="topic-banner-titleinner">
            ${iconKey ? topicIconSVG(iconKey, 'topic-banner-icon') : ''}
            <h1 class="topic-banner-title">${escapeHTML(title)}</h1>
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
  const featuredLinksHTML = featured.map(t =>
    `<a href="#/topic/${t.slug}" class="navmenu-topic-link">${escapeHTML(t.name)}</a>`
  ).join('');

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
        <a href="#/prompt-generator" class="sticky-cta" id="nav-cta">
          <span class="sticky-cta-full">Prompt Builder</span>
          <span class="sticky-cta-short">Prompt Builder</span>
          <svg class="sticky-cta-plus" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </a>
      </div>
    </div>

  `;
  renderSearchBar(document.getElementById('sticky-search-container'), route, { compact: true });

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
        <img src="assets/logo-light.png" alt="Standard Topic" class="navmenu-logo">
        <span class="navmenu-title">Standard Topic</span>
      </a>
      <button class="navmenu-close" id="navmenu-close" aria-label="Close menu">✕</button>
    </div>
    <div class="navmenu-search" id="navmenu-search-container"></div>
    <div class="navmenu-prompt-row">
      <button type="button" class="navmenu-link navmenu-link-all-topics" id="navmenu-all-topics">View All Topics</button>
      <a href="#/prompt-generator" class="navmenu-link navmenu-link-prompt">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Prompt Builder
      </a>
    </div>
    <div class="navmenu-divider"></div>
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
  renderSearchBar(document.getElementById('navmenu-search-container'), route);

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
             <span class="sidebar-shortcut-icon">${topicIconSVG(t.icon || 'globe', 'sidebar-shortcut-icon-svg')}</span>
             <span class="sidebar-shortcut-name">${escapeHTML(t.name)}</span>
             <span class="sidebar-shortcut-chev" aria-hidden="true">›</span>
           </a>
         `).join('')}
       </div>`;
  container.innerHTML = `
    <div class="related-panel">
      <div class="related-scroll-wrap">
        <h3 class="related-title">Related Topics</h3>
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

  let html = `
    <div class="${cardClasses.join(' ')}" data-multi="0">
      <div class="sidebar-card-header">
        <h3 class="sidebar-card-title">Shortcuts</h3>
        ${all.length > 0 ? `
          <button type="button" class="multi-toggle" id="multi-toggle" role="switch" aria-checked="false">
            <span class="multi-toggle-label">Multi-select</span>
            <span class="multi-toggle-switch" aria-hidden="true"><span class="multi-toggle-knob"></span></span>
          </button>
        ` : ''}
      </div>
      ${all.length > 0 ? `
        <div class="shortcuts-multi-submit-wrap" hidden>
          <button type="button" class="shortcuts-multi-submit" id="shortcuts-multi-submit">
            <span class="shortcuts-multi-submit-label">Submit Prompts</span>
            <span class="shortcuts-multi-submit-count" id="shortcuts-multi-submit-count">0</span>
          </button>
          <div class="shortcuts-multi-secondary">
            <button type="button" class="shortcuts-multi-select-all" id="shortcuts-multi-select-all">Select all</button>
            <span class="shortcuts-multi-divider" aria-hidden="true">·</span>
            <button type="button" class="shortcuts-multi-clear" id="shortcuts-multi-clear">Clear</button>
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
        <div class="quick-links-grid">
          ${contentSearches.map(s => quickLinkItem(s, topicName)).join('')}
        </div>
      </section>
    `;
  }

  // AI Shortcuts subsection
  html += `
    <section class="shortcuts-subsection ai-shortcuts-subsection">
      <div class="shortcuts-subsection-header">
        <h4 class="shortcuts-subsection-title">AI Shortcuts</h4>
      </div>
  `;

  if (all.length === 0) {
    html += `<p class="sidebar-empty">No shortcuts yet.</p>`;
  } else {
    html += `
      <div class="sidebar-shortcut-list">
        ${all.map(s => shortcutItem(s, topicName)).join('')}
      </div>
    `;
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
  container.querySelectorAll('.quick-link-tile').forEach(link => {
    link.addEventListener('click', (e) => {
      const cardEl = container.querySelector('.shortcuts-sidebar');
      const multiOn = cardEl?.dataset.multi === '1';
      if (multiOn) {
        e.preventDefault();
        flashToast('Quick Links are paused while multi-select is on');
        return;
      }
      const name = link.dataset.name || '';
      track('content_shortcut_click', { name, route: window.location.hash || '#/' });
    });
  });

  const card = container.querySelector('.sidebar-card');
  const toggle = container.querySelector('#multi-toggle');
  const submitBtn = container.querySelector('#shortcuts-multi-submit');
  const clearBtn = container.querySelector('#shortcuts-multi-clear');
  const selectAllBtn = container.querySelector('#shortcuts-multi-select-all');
  const submitWrap = container.querySelector('.shortcuts-multi-submit-wrap');
  const countEl = container.querySelector('#shortcuts-multi-submit-count');

  const updateSubmit = () => {
    if (!submitBtn || !submitWrap) return;
    const multiOn = card.dataset.multi === '1';
    if (!multiOn) {
      submitWrap.hidden = true;
      submitBtn.classList.remove('is-active');
      if (clearBtn) clearBtn.disabled = true;
      if (selectAllBtn) selectAllBtn.disabled = false;
      if (countEl) countEl.textContent = '0';
      return;
    }
    submitWrap.hidden = false;
    const allShortcuts = container.querySelectorAll('.sidebar-shortcut');
    const selected = container.querySelectorAll('.sidebar-shortcut.is-multi-selected');
    const has = selected.length > 0;
    const allSelected = allShortcuts.length > 0 && selected.length === allShortcuts.length;
    submitBtn.classList.toggle('is-active', has);
    submitBtn.disabled = !has;
    if (clearBtn) clearBtn.disabled = !has;
    if (selectAllBtn) selectAllBtn.disabled = allSelected;
    if (countEl) countEl.textContent = String(selected.length);
  };

  toggle?.addEventListener('click', () => {
    const on = card.dataset.multi !== '1';
    card.dataset.multi = on ? '1' : '0';
    card.classList.toggle('is-multi-select', on);
    toggle.setAttribute('aria-checked', on ? 'true' : 'false');
    if (!on) {
      container.querySelectorAll('.sidebar-shortcut.is-multi-selected')
        .forEach(b => b.classList.remove('is-multi-selected'));
    }
    updateSubmit();
  });

  container.querySelectorAll('.sidebar-shortcut').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.blur();
      // Multi-select mode: toggle selection instead of opening modal
      if (card.dataset.multi === '1') {
        btn.classList.toggle('is-multi-selected');
        updateSubmit();
        return;
      }
      const prompt = btn.dataset.prompt;
      const name = btn.dataset.name;
      const iconKey = btn.dataset.iconKey || '';
      track('shortcut_click', { shortcut_name: name, route: window.location.hash || '#/' });
      window.dispatchEvent(new CustomEvent('open-prompt-modal', {
        detail: { prompt, name, iconKey },
      }));
    });
  });

  clearBtn?.addEventListener('click', () => {
    container.querySelectorAll('.sidebar-shortcut.is-multi-selected')
      .forEach(b => b.classList.remove('is-multi-selected'));
    updateSubmit();
  });

  selectAllBtn?.addEventListener('click', () => {
    container.querySelectorAll('.sidebar-shortcut')
      .forEach(b => b.classList.add('is-multi-selected'));
    updateSubmit();
  });

  submitBtn?.addEventListener('click', () => {
    const selected = Array.from(container.querySelectorAll('.sidebar-shortcut.is-multi-selected'));
    if (selected.length === 0) return;
    const combined = selected.map((b, i) => {
      const name = b.dataset.name || `Shortcut ${i + 1}`;
      const prompt = b.dataset.prompt || '';
      return `${i + 1}. ${name}\n${prompt}`;
    }).join('\n\n---\n\n');
    const intro = `Please respond to each of the following ${selected.length} prompts in order. Treat each as its own task and clearly label your answers.`;
    const finalPrompt = `${intro}\n\n${combined}`;
    const name = `${selected.length} Selected Shortcut${selected.length > 1 ? 's' : ''}`;
    track('multi_shortcut_submit', { count: selected.length, route: window.location.hash || '#/' });
    window.dispatchEvent(new CustomEvent('open-prompt-modal', {
      detail: { prompt: finalPrompt, name, iconKey: '' },
    }));
  });

  // Scroll-fade indicators: toggle has-overflow-top / has-overflow-bottom
  // on the list-wrap based on the wrap's scroll position. rAF-throttled.
  const listWrap = container.querySelector('.shortcuts-list-wrap');
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
  const iconEmoji = getIconEmoji(shortcut.icon);
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

// Quick Link tile — 2x2 grid card with brand emoji + name. Anchor
// tag opens the search in a new tab. In multi-select mode the link
// gets `.is-disabled` and tapping it shows a toast.
function quickLinkItem(search, topicName) {
  const url = search.urlTemplate.replace(/\{query\}/g, encodeURIComponent(topicName));
  const icon = search.icon || '';
  return `
    <a class="quick-link-tile"
       href="${url}"
       target="_blank"
       rel="noopener noreferrer"
       data-name="${escapeAttr(search.name)}"
       title="${escapeAttr(search.name)}">
      <span class="quick-link-tile-icon">${escapeHTML(icon)}</span>
      <span class="quick-link-tile-name">${escapeHTML(search.name)}</span>
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
          <span class="sidebar-shortcut-dot" aria-hidden="true"></span>
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
          <span class="sidebar-shortcut-dot" aria-hidden="true"></span>
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
