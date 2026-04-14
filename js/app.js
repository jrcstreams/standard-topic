import { initRouter, onRoute, getCurrentRoute } from './utils/router.js';
import { loadAllData, getTopicBySlug, getParentTopics } from './utils/data.js';
import { renderFooter } from './components/footer.js';
import { renderSearchBar, initSearchOverlay } from './components/search-modal.js';
import { renderNewsFeed } from './components/newsfeed.js';
import { renderShortcuts } from './components/shortcuts.js';
import { renderRelatedTopics } from './components/related-topics.js';
import { renderPromptGenerator } from './components/prompt-generator.js';
import { initPromptModal } from './components/prompt-modal.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  initPromptModal();
  initSearchOverlay();

  renderFooter(document.getElementById('site-footer'));

  let previousRoute = null;
  onRoute((route) => {
    // Capture scroll position BEFORE the layout re-render, so we can
    // restore it (or push past the hero threshold) afterward.
    const previousScrollY = window.scrollY;
    const stayingInHome = previousRoute?.type === 'home' && route.type === 'home';

    renderLayout(route);
    renderPage(route);

    if (!stayingInHome) {
      window.scrollTo(0, 0);
    } else {
      // Re-rendering may have shrunk the document (new tab content might
      // be shorter than what was there), causing the browser to clamp
      // scrollY below the sticky-reveal threshold and dropping the user
      // out of the sticky-revealed state. Force scroll back past the
      // hero so the sticky stays revealed.
      requestAnimationFrame(() => {
        const heroEl = document.getElementById('hero');
        const heroHeight = heroEl?.offsetHeight || 0;
        const threshold = Math.max(0, heroHeight - 56);
        const wasAboveThreshold = previousScrollY > threshold;
        if (wasAboveThreshold && window.scrollY <= threshold) {
          window.scrollTo(0, threshold + 20);
        }
      });
    }
    previousRoute = route;
  });

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
  document.body.classList.remove('sticky-always', 'has-subnav', 'home-mode');

  // Always render the main sticky bar
  renderStickyHeroBar(siteHeader, route);

  if (isHome) {
    document.body.classList.add('home-mode');
    const homeTabs = [
      { id: 'newsfeed', label: 'News Feed', hash: '#/' },
      { id: 'shortcuts', label: 'AI Shortcuts', hash: '#/shortcuts' },
      { id: 'related', label: 'All Topics', hash: '#/related' },
    ];
    const homeConfig = { title: 'Home', tabs: homeTabs, activeTab: route.tab };

    if (isMobile) {
      // Mobile home: no hero, sticky main nav + home subnav always visible
      document.body.classList.add('sticky-always', 'has-subnav');
      siteHeader.classList.add('is-revealed');
      subHeader.classList.add('is-subnav');
      renderSubNav(subHeader, homeConfig);
    } else {
      // Desktop home: hero in flow (only render if it's empty — switching
      // home tabs leaves the hero alone so scroll position is preserved).
      // Subnav sticks to top as user scrolls; main nav reveals at the same
      // time and the subnav slides to sit just below it (top: 0 → top: 56px).
      if (heroEl && !heroEl.children.length) renderHero(heroEl, route);
      subHeader.classList.add('is-home-subnav');
      renderSubNav(subHeader, homeConfig);
      setupHomeStickyReveal(siteHeader, subHeader);
    }
    return;
  }

  // Every other page: main sticky always visible
  document.body.classList.add('sticky-always');
  siteHeader.classList.add('is-revealed');

  // Topic / custom pages also get a sub-nav below the main nav
  if (route.type === 'topic' || route.type === 'custom') {
    document.body.classList.add('has-subnav');
    subHeader.classList.add('is-subnav');

    if (route.type === 'topic') {
      const topic = getTopicBySlug(route.slug);
      if (!topic) return;
      renderSubNav(subHeader, {
        title: topic.name,
        tabs: [
          { id: 'newsfeed', label: 'News Feed', hash: `#/topic/${route.slug}` },
          { id: 'shortcuts', label: 'AI Shortcuts', hash: `#/topic/${route.slug}/shortcuts` },
          { id: 'related', label: 'Related Topics', hash: `#/topic/${route.slug}/related` },
        ],
        activeTab: route.tab,
      });
    } else {
      renderSubNav(subHeader, { title: route.term, tabs: null });
    }
  }
}

// Unified subnav renderer for both home and topic/custom pages
function renderSubNav(container, { title, tabs, activeTab }) {
  const tabsHTML = tabs ? `
    <div class="topic-banner-tabs">
      ${tabs.map(t => `
        <a href="${t.hash}" class="tab-pill ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">
          ${t.label}
        </a>
      `).join('')}
    </div>
  ` : '';

  container.innerHTML = `
    <div class="topic-banner">
      <div class="topic-banner-row">
        <div class="topic-banner-titlegroup">
          <span class="topic-banner-accent" aria-hidden="true"></span>
          <h1 class="topic-banner-title">${escapeHTML(title)}</h1>
        </div>
        ${tabsHTML}
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
    const passed = window.scrollY > threshold;
    mainEl.classList.toggle('is-revealed', passed);
    if (subEl) subEl.classList.toggle('with-mainnav', passed);
  };
  window.addEventListener('scroll', heroScrollHandler, { passive: true });
  // Recompute threshold if hero size changes (resize, font load)
  window.addEventListener('resize', () => {
    threshold = computeThreshold();
  }, { passive: true });
  heroScrollHandler();
}

function renderStickyHeroBar(container, route) {
  const isPromptGen = route.type === 'prompt-generator';
  container.innerHTML = `
    <div class="sticky-hero-inner">
      <a href="#/" class="sticky-brand">
        <img src="assets/logo-dark.png" alt="Standard Topic" class="sticky-logo-img">
        <span class="sticky-title">Standard Topic</span>
      </a>
      <div class="sticky-search" id="sticky-search-container"></div>
      <a href="#/prompt-generator" class="sticky-cta ${isPromptGen ? 'active' : ''}">Build Prompt +</a>
    </div>
  `;
  renderSearchBar(document.getElementById('sticky-search-container'), route);
}

function renderHero(container, route) {
  const popularTopics = getParentTopics().slice(0, 5);
  const chipsHTML = popularTopics.length > 0 ? `
    <div class="hero-chips">
      <span class="hero-chip-label">Popular</span>
      ${popularTopics.map(t => `
        <a href="#/topic/${t.slug}" class="hero-chip">${escapeHTML(t.name)}</a>
      `).join('')}
    </div>
  ` : '';

  container.innerHTML = `
    <div class="hero-inner">
      <a href="#/" class="hero-brand">
        <img src="assets/logo-light.png" alt="Standard Topic" class="hero-brand-logo">
        <h1 class="hero-brand-title">Standard Topic</h1>
      </a>
      <p class="hero-tagline">News, Resources and AI Knowledge. On any topic.</p>
      <div class="hero-search-wrap" id="search-bar-container"></div>
      ${chipsHTML}
      <p class="hero-build-callout">
        Need something custom?
        <a href="#/prompt-generator" class="hero-build-link">
          Build your own prompt
          <span class="hero-build-arrow" aria-hidden="true">→</span>
        </a>
      </p>
    </div>
  `;
  renderSearchBar(document.getElementById('search-bar-container'), route);
}


function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderPage(route) {
  const content = document.getElementById('content');
  content.innerHTML = '';

  if (route.type === 'home') {
    const topic = getTopicBySlug('home');
    // The "Home" banner + tabs live in the subnav (rendered by renderLayout)
    if (route.tab === 'newsfeed') {
      renderNewsFeed(content, topic, true);
    } else if (route.tab === 'shortcuts') {
      renderShortcuts(content, { type: 'home', slug: 'home' });
    } else if (route.tab === 'related') {
      renderRelatedTopics(content, { type: 'home', slug: 'home' });
    }
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

    if (route.tab === 'newsfeed') {
      renderNewsFeed(content, topic, false);
    } else if (route.tab === 'shortcuts') {
      renderShortcuts(content, route);
    } else if (route.tab === 'related') {
      renderRelatedTopics(content, route);
    }
    return;
  }

  if (route.type === 'custom') {
    renderShortcuts(content, route);
    return;
  }

  if (route.type === 'prompt-generator') {
    renderPromptGenerator(content);
    return;
  }

  if (route.type === 'about') {
    content.innerHTML = `
      <div class="about-page">
        <div class="section-header">
          <span class="section-icon">ℹ️</span>
          <h2>About Standard Topic</h2>
        </div>
        <div class="about-section">
          <h3>What is Standard Topic?</h3>
          <p>Standard Topic is your hub for news, resources, and AI knowledge on any topic. We maintain a curated library of 100+ topics, each with a dedicated news feed, AI-powered knowledge shortcuts, and connections to related topics.</p>
        </div>
        <div class="about-section">
          <h3>How to Use</h3>
          <ul>
            <li><strong>Browse Topics</strong> — Use the search bar to find a topic from our library, or type in any custom topic.</li>
            <li><strong>News Feed</strong> — Each topic has a curated RSS news feed with the latest articles and coverage.</li>
            <li><strong>AI Shortcuts</strong> — Click any shortcut to send a pre-built prompt to your preferred AI model.</li>
            <li><strong>Related Topics</strong> — Discover connected topics through our parent-subtopic hierarchy.</li>
            <li><strong>Prompt Generator</strong> — Build custom knowledge prompts with detailed options.</li>
          </ul>
        </div>
        <div class="about-section">
          <h3>Disclaimer</h3>
          <p>Standard Topic provides shortcuts to third-party AI platforms. We are not responsible for the content generated by these platforms or actions taken after leaving this site. AI-generated content should be verified independently.</p>
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
