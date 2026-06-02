import { initRouter, onRoute, getCurrentRoute } from './utils/router.js';
import { loadAllData, getTopicBySlug, getParentTopics, getFeaturedTopics, getShortcutsForTopic, getRelatedTopics, getTopicsGroupedByParent, getAllShortcutIconKeys, getExternalSearches, getExternalSearchCategories, getModels, getDefaultModelId, getModelById, searchTopics } from './utils/data.js';
import { getPreferredModelId, setPreferredModelId, submitPrompt } from './utils/ai-models.js';
import { renderIcon, preloadIcons, getIconEmoji } from './utils/icons.js';
import { topicIconSVG } from './utils/topic-icons.js';
import { renderSearchBar, initSearchOverlay, openSearchOverlay } from './components/search-modal.js';
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
  // Apply per-group accent colors from data.assignments.groups so
  // admin-managed colors take effect at render time.
  applyGroupAccentColors();
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
  document.body.classList.remove('sticky-always', 'has-subnav', 'home-mode', 'show-subnav-tabs', 'app-mode', 'custom-mode');

  // Always render the main sticky bar
  renderStickyHeroBar(siteHeader, route);

  // All pages: main nav always fixed + visible.
  document.body.classList.add('sticky-always');
  siteHeader.classList.add('is-revealed');

  // App-mode: home / topic routes lock the page to viewport
  // height so the two cards behave like an application panel rather
  // than long-scroll content. Custom-search pages opt out — they
  // scroll naturally so the in-page sticky search bar can pin to
  // the top as the user scrolls past it.
  if (route.type === 'home' || route.type === 'topic') {
    document.body.classList.add('app-mode');
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

    subHeader.innerHTML = `
      <div class="topic-banner">
        <div class="topic-banner-row">
          ${titleGroup(topic.icon || 'globe', topic.name)}
          ${related.length > 0 ? `
            <div class="subnav-topics-inline">
              ${relatedLinksHTML}
            </div>
          ` : ''}
        </div>
      </div>
    `;

    observeSubnavHeight();
    trimOverflowLinks();
    setupResponsiveNav();
    wireChipStripScrollEnd();
    wireSubnavCompactMeasure();
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
function bodyTabsRow(opts = {}) {
  const { showRelated = false } = opts;
  const tabs = [
    `<button type="button" class="tab-pill tab-pill-newsfeed active" data-tab="newsfeed">
       <span class="tab-pill-label-long">News Feed</span>
       <span class="tab-pill-label-short">News Feed</span>
     </button>`,
    `<button type="button" class="tab-pill tab-pill-shortcuts" data-tab="shortcuts">
       <span class="tab-pill-label-long">Topic Intelligence</span>
       <span class="tab-pill-label-short">Topic Intelligence</span>
     </button>`,
  ];
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
  ['newsfeed', 'shortcuts', 'related'].forEach(t =>
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
    ['newsfeed', 'shortcuts', 'related'].forEach(t =>
      document.body.classList.remove(`active-tab-${t}`)
    );
    document.body.classList.add(`active-tab-${tab}`);
    document.querySelectorAll('.body-tabs .tab-pill, #sub-header .tab-pill').forEach(p =>
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
    const relatedBtnReset = document.getElementById('subnav-related-btn');
    if (relatedBtnReset) relatedBtnReset.style.display = 'none';

    // Every chip stays visible at every viewport — the chip strip
    // is a horizontal scroller (overflow-x: auto) with arrow
    // affordances on hover-capable pointers, on both mobile AND
    // desktop. Previously home-desktop went through a separate
    // "show as many as fit + hide the rest" trim path that left
    // "All Topics +" sitting at the right edge with the
    // overflowing chips display:none'd, which was confusing —
    // user expectation is a scrollable row containing every
    // featured topic, with "All Topics +" pinned as the last
    // item of that scroll.
    container.classList.remove('is-empty');
    return;

    const containerRight = container.getBoundingClientRect().right;
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
        <div class="sticky-search sticky-search-pill" id="sticky-search-pill-container">
          <div class="search-bar-wrapper">
            <button class="search-bar is-compact search-bar-search-variant" type="button" id="nav-search" aria-label="Search topics">
              <svg class="search-bar-icon" aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="7"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <span class="search-bar-label">
                <span class="search-bar-label-full">Search</span>
              </span>
            </button>
          </div>
        </div>
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

  // Magnify icon — opens the Topics modal with the search input
  // focused so the user lands ready to type. Same modal as the
  // "Choose Topics" pill earlier in the nav, but the icon signals
  // "search" specifically rather than "browse".
  document.getElementById('nav-search')?.addEventListener('click', () => {
    openSearchOverlay({ focusInput: true });
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
    // Homepage: Shortcuts + News Feed. Body tabs at the top let
    // mobile users switch between them; CSS hides the tabs at
    // desktop widths where both panels show side-by-side.
    container.innerHTML = `
      <div class="topic-layout" id="topic-layout">
        ${bodyTabsRow({ showRelated: false })}
        <section class="layout-section" id="section-shortcuts"></section>
        <section class="layout-section" id="section-newsfeed"></section>
      </div>
    `;
  } else {
    // Topic pages: Shortcuts + News Feed + Related Topics.
    container.innerHTML = `
      <div class="topic-layout" id="topic-layout">
        ${bodyTabsRow({ showRelated: false })}
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
  // additionally carries a subtitle showing the search term, so the
  // section reads as scoped to what the user typed.
  const panelTitle = 'Topic Intelligence';
  const panelSubtitleHTML = (isCustom && topicName)
    ? `<p class="sidebar-card-subtitle">Covering &ldquo;${escapeHTML(topicName)}&rdquo;</p>`
    : '';

  let html = `
    <div class="${cardClasses.join(' ')} is-multi-select" data-multi="1">
      <div class="sidebar-card-header">
        <div class="sidebar-card-heading">
          <h3 class="sidebar-card-title">${panelTitle}${titlePillHTML}</h3>
          ${panelSubtitleHTML}
        </div>
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

  // Accordion sections — Web Sources, then the AI action groups
  // (Discover / Learn / Analyze / More). Each section is a
  // <details> element so it's natively keyboard accessible and
  // doesn't need JS toggle wiring. First section starts open;
  // others closed so the panel reads as a tidy stack of choices.
  html += `<div class="ti-accordions">`;

  if (contentSearches.length > 0) {
    // Group the web sources into labelled subtopics (Search,
    // Social, Audio & video, Writing). Order/labels come from the
    // data file's `categories`; any source whose category isn't
    // listed falls into a trailing "Other" group so nothing is
    // silently dropped.
    const categories = getExternalSearchCategories();
    const order = categories.length
      ? categories.slice()
      : [{ key: '__all', label: '' }];
    const known = new Set(order.map(c => c.key));
    const leftovers = contentSearches.filter(s => !known.has(s.category));
    if (leftovers.length) order.push({ key: '__other', label: 'Other' });

    const groupsHTML = order.map(cat => {
      const items = cat.key === '__other'
        ? leftovers
        : cat.key === '__all'
          ? contentSearches
          : contentSearches.filter(s => s.category === cat.key);
      if (!items.length) return '';
      const heading = cat.label
        ? `<li class="ti-subhead" aria-hidden="true">${escapeHTML(cat.label)}</li>`
        : '';
      return `
        <ul class="ti-item-list ti-item-list-grouped">
          ${heading}
          ${items.map(s => webSourceItem(s, topicName)).join('')}
        </ul>
      `;
    }).join('');

    html += renderTIAccordion({
      key: 'websources',
      label: 'Web Sources',
      open: false,
      bodyHTML: `<div class="ti-source-groups">${groupsHTML}</div>`,
    });
  }

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
      { key: 'analyze', label: 'Analyze' },
      { key: 'more', label: 'More' },
    ];
    groupOrder.forEach(g => {
      const items = groups[g.key];
      if (!items || items.length === 0) return;
      html += renderTIAccordion({
        key: g.key,
        label: g.label,
        open: false,
        bodyHTML: `
          <ul class="ti-item-list ti-item-list-shortcuts" data-group="${escapeAttr(g.key)}">
            ${items.map(s => tiShortcutItem(s, topicName, g.key)).join('')}
          </ul>
        `,
      });
    });
  }
  html += `</div>`; /* close .ti-accordions */
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
// Section metadata: icon path (inline SVG) + accent color per
// section. The section header pulls from this. New sections (e.g.
// added in admin) fall back to a neutral globe + gray accent.
const TI_SECTION_META = {
  websources: {
    accent: '#5d6b7e',
    blurb: 'Search platforms and primary sources.',
    icon: `<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 4 9 14 14 0 0 1-4 9 14 14 0 0 1-4-9 14 14 0 0 1 4-9z"/>`,
  },
  'topic-specific': {
    accent: '#b35a4e',
    blurb: 'Insights tailored to this topic.',
    icon: `<path d="M12 2.5l2.3 6.4 6.7.3-5.3 4.1 1.9 6.5L12 16.2 6.4 19.8l1.9-6.5L3 9.2l6.7-.3z"/>`,
  },
  discover: {
    accent: '#3261a0',
    blurb: 'What\'s happening right now.',
    icon: `<circle cx="12" cy="12" r="9"/><polygon points="16 8 13.5 13.5 8 16 10.5 10.5 16 8"/>`,
  },
  learn: {
    accent: '#2e8a73',
    blurb: 'Background, fundamentals, and context.',
    icon: `<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>`,
  },
  analyze: {
    accent: '#b48528',
    blurb: 'Deeper analytical lenses and tradeoffs.',
    icon: `<line x1="6" y1="20" x2="6" y2="14"/><line x1="12" y1="20" x2="12" y2="9"/><line x1="18" y1="20" x2="18" y2="4"/>`,
  },
  more: {
    accent: '#8a4f7a',
    blurb: 'Other useful prompts.',
    icon: `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>`,
  },
};

function renderTIAccordion({ key, label, open, bodyHTML }) {
  const meta = TI_SECTION_META[key] || TI_SECTION_META.more;
  const openAttr = open ? ' open' : '';
  const blurbHTML = meta.blurb
    ? `<span class="ti-accordion-blurb">${escapeHTML(meta.blurb)}</span>`
    : '';
  return `
    <details class="ti-accordion" data-section="${escapeAttr(key)}" style="--ti-accent: ${meta.accent};"${openAttr}>
      <summary class="ti-accordion-summary">
        <span class="ti-accordion-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            ${meta.icon}
          </svg>
        </span>
        <span class="ti-accordion-title">${escapeHTML(label)}</span>
        <span class="ti-accordion-chev" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </span>
        ${blurbHTML}
      </summary>
      <div class="ti-accordion-body">
        ${bodyHTML}
      </div>
    </details>
  `;
}

// Web source row — title + description, anchor link to the
// external search URL. Mirrors the shortcut row format so both
// section bodies read as the same tabular list of "things you
// can open" with a one-line evergreen description below.
function webSourceItem(search, topicName) {
  const url = search.urlTemplate.replace(/\{query\}/g, encodeURIComponent(topicName));
  const description = search.description
    ? `<span class="ti-item-desc">${escapeHTML(search.description)}</span>`
    : '';
  return `
    <li class="ti-item-row">
      <a class="ti-item ti-item-link"
         href="${url}"
         target="_blank"
         rel="noopener noreferrer"
         data-name="${escapeAttr(search.name)}"
         title="Open ${escapeAttr(search.name)} search">
        <span class="ti-item-name">${escapeHTML(search.name)}</span>
        ${description}
      </a>
    </li>
  `;
}

// AI shortcut row — title + description in a button. Keeps the
// existing multi-select wiring (data-prompt / data-name / etc)
// so the bottom controls (Preview / Direct Submit) still work.
// Individual shortcut icons are NOT rendered in the row — the
// section header carries the visual identity, and dropping the
// per-row icon leaves more room for the title + description.
function tiShortcutItem(shortcut, topicName, groupKey) {
  const prompt = shortcut.prompt.replace(/\{topic\}/gi, topicName);
  const description = shortcut.description && shortcut.description.trim()
    ? `<span class="ti-item-desc">${escapeHTML(shortcut.description)}</span>`
    : '';
  return `
    <li class="ti-item-row">
      <button class="ti-item ti-item-shortcut ai-shortcut-select-btn"
              data-prompt="${escapeAttr(prompt)}"
              data-name="${escapeAttr(shortcut.name)}"
              data-icon-key="${escapeAttr(shortcut.icon)}"
              data-group="${escapeAttr(groupKey || '')}"
              aria-pressed="false"
              title="${escapeAttr(shortcut.name)}">
        <span class="ti-item-marker" aria-hidden="true">
          <svg class="ti-item-marker-check" viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="2 7 6 11 12 3"/>
          </svg>
        </span>
        <span class="ti-item-text">
          <span class="ti-item-name">${escapeHTML(shortcut.name)}</span>
          ${description}
        </span>
      </button>
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
// Default groups when assignments.json doesn't declare any. Mirrors
// the admin panel's DEFAULT_GROUPS so a fresh install renders the
// same Discover / Learn / Analyze / More layout as before. The "other"
// internal key maps to the "more" group id so legacy regex-classified
// shortcuts still land in the More bucket.
const DEFAULT_GROUP_DEFS = [
  { id: 'topic-specific', label: 'Topic-Specific Insights', order: 0, color: '#b35a4e' },
  { id: 'discover', label: 'Discover', order: 1, color: '#3261a0' },
  { id: 'learn',    label: 'Learn',    order: 2, color: '#2e8a73' },
  { id: 'analyze',  label: 'Analyze',  order: 3, color: '#b48528' },
  { id: 'more',     label: 'More',     order: 4, color: '#8a4f7a' },
];

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
// `overrideMap` (optional) is a per-topic { shortcutId: groupId } map that
// re-buckets specific shortcuts into a different section than their global
// `group` field — used so the homepage can sort otherwise topic-specific
// shortcuts into Discover / Learn / Analyze independently. A shortcut not in
// the map falls back to its global group (then the legacy regex classifier).
function groupShortcuts(shortcuts, overrideMap = {}) {
  // 1) Resolve the group set: use data.assignments.groups if present
  //    (admin-managed), else the defaults. Sort by `order` ascending.
  const groupDefs = (window.__assignmentsData && Array.isArray(window.__assignmentsData.groups) && window.__assignmentsData.groups.length)
    ? window.__assignmentsData.groups.slice()
    : DEFAULT_GROUP_DEFS.slice();
  groupDefs.sort((a, b) => (a.order || 0) - (b.order || 0));

  // 2) Initialize buckets.
  const groups = {};
  groupDefs.forEach(g => { groups[g.id] = []; });

  // 3) For each shortcut, prefer a per-topic override, then its explicit
  //    `group` field. Fall back to the legacy regex-based classifier so old
  //    data still renders until it gets a group assigned in the admin.
  const learnRE = /(guide|glossary|beginner|primer|fundamentals|basics|deep ?dive|history|background|key players|key terms|how |where to|why )/i;
  const analyzeRE = /(analy|impact|affect|hype|reality|compare| vs | versus |implications|outcome|signal|forecast|prediction|risk|controversy|debate)/i;
  const discoverRE = /(news|snapshot|update|headline|trend|watch|latest|now|today|roundup|hot|spotlight|brief|digest)/i;
  shortcuts.forEach(s => {
    const override = overrideMap && overrideMap[s.id];
    if (override && groups[override]) {
      groups[override].push(s);
      return;
    }
    if (s.group && groups[s.group]) {
      groups[s.group].push(s);
      return;
    }
    const name = s.name || '';
    if (learnRE.test(name) && groups.learn) groups.learn.push(s);
    else if (analyzeRE.test(name) && groups.analyze) groups.analyze.push(s);
    else if (discoverRE.test(name) && groups.discover) groups.discover.push(s);
    else if (groups['topic-specific']) groups['topic-specific'].push(s);
    else if (groups.more) groups.more.push(s);
    else if (groups.other) groups.other.push(s);
    else {
      // No matching default bucket — drop into the first defined group.
      const first = groupDefs[0];
      if (first) groups[first.id].push(s);
    }
  });
  // Expose the resolved group order so the caller can render in
  // the data-defined order rather than a hardcoded list.
  groups.__order = groupDefs.map(g => ({ key: g.id, label: g.label }));
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
          <h4 class="about-sub-heading">Your settings, your defaults</h4>
          <p>Open Settings (gear icon, top right) to pick your default AI model and how deep you want responses to go — Brief, Standard, Detailed, or Deep. Choices stay on your device for the session.</p>
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
