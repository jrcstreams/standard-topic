import { initRouter, onRoute, getCurrentRoute } from './utils/router.js';
import { loadAllData, getTopicBySlug, getParentTopics, getEvergreenShortcuts, getSpecificShortcuts, getRelatedTopics } from './utils/data.js';
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

  onRoute((route) => {
    renderLayout(route);
    renderPage(route);
    // Always reset scroll to top on route change. Home tab switching
    // now uses scroll-jump (no hash change), so navigating between
    // home tabs doesn't trigger this handler at all.
    window.scrollTo(0, 0);
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

// ---------- Two-column topic layout (L2 + L4 hybrid) ----------

let topicLayoutObservers = { sidebarScroll: null, sections: null };

function cleanupTopicLayoutObservers() {
  if (topicLayoutObservers.sidebarScroll) {
    window.removeEventListener('scroll', topicLayoutObservers.sidebarScroll);
    topicLayoutObservers.sidebarScroll = null;
  }
  if (topicLayoutObservers.sections) {
    topicLayoutObservers.sections.disconnect();
    topicLayoutObservers.sections = null;
  }
  document.body.classList.remove('past-sidebar');
}

function renderTopicLayout(container, { topic, route, isHome, isCustom = false, customTerm = '' }) {
  cleanupTopicLayoutObservers();

  // Custom pages don't have a Related Topics section. Build layout
  // shell accordingly.
  const showRelated = !isCustom;

  container.innerHTML = `
    <div class="topic-layout ${isCustom ? 'is-custom' : ''}" id="topic-layout">
      <main class="topic-main" id="topic-main">
        <section class="layout-section" data-section="newsfeed" id="section-newsfeed"></section>
      </main>
      <aside class="topic-sidebar" id="topic-sidebar">
        <section class="layout-section sidebar-section" data-section="shortcuts" id="section-shortcuts"></section>
        ${showRelated ? `<section class="layout-section sidebar-section" data-section="related" id="section-related"></section>` : ''}
      </aside>
    </div>
  `;

  const feedSection = container.querySelector('#section-newsfeed');
  const shortcutsSection = container.querySelector('#section-shortcuts');
  const relatedSection = container.querySelector('#section-related');
  const sidebar = container.querySelector('#topic-sidebar');

  renderNewsFeed(feedSection, topic, isHome, { isCustom, customTerm });
  renderShortcutsSidebar(shortcutsSection, route, isHome, isCustom, customTerm);
  if (showRelated && relatedSection) {
    renderRelatedTopicsSidebar(relatedSection, route, isHome);
  }

  // Deep-link scroll — if the route specifies a tab, scroll to that section
  if (route.tab && route.tab !== 'newsfeed') {
    const target = route.tab === 'shortcuts' ? shortcutsSection
      : (route.tab === 'related' && relatedSection ? relatedSection : null);
    if (target) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    }
  }

  // Observe sidebar — flip layout to full-width when scrolled past
  setupSidebarFullwidthObserver(sidebar);

  // Scroll-spy on sections — updates active tab in the subnav
  const spySections = [
    { el: feedSection, tab: 'newsfeed' },
    { el: shortcutsSection, tab: 'shortcuts' },
  ];
  if (showRelated && relatedSection) {
    spySections.push({ el: relatedSection, tab: 'related' });
  }
  setupScrollSpy(spySections);

  // Click handlers on subnav tabs: scroll-jump instead of route change
  attachSubnavScrollHandlers(spySections);
}

function setupSidebarFullwidthObserver(sidebarEl) {
  const layout = document.getElementById('topic-layout');
  if (!sidebarEl || !layout) return;
  if (!window.matchMedia('(min-width: 900px)').matches) return; // no-op on mobile

  // We track the sidebar's bottom edge in document coords. When the
  // user scrolls such that the viewport top (plus sticky header) has
  // passed that edge, flip the layout to fullwidth. IntersectionObserver
  // doesn't work once we hide the sidebar (display: none removes it
  // from layout) so we use a scroll listener and measure while the
  // sidebar is still visible.
  const STICKY_OFFSET = 140;
  let sidebarBottomY = 0;
  const measure = () => {
    if (!layout.classList.contains('is-fullwidth')) {
      const rect = sidebarEl.getBoundingClientRect();
      sidebarBottomY = rect.bottom + window.scrollY;
    }
  };
  measure();
  window.addEventListener('resize', measure, { passive: true });
  // Re-measure after layout settles (fonts, iframe widget inject content)
  setTimeout(measure, 150);
  setTimeout(measure, 600);
  setTimeout(measure, 1500);

  const onScroll = () => {
    const scrollPos = window.scrollY + STICKY_OFFSET;
    const pastSidebar = scrollPos > sidebarBottomY;
    layout.classList.toggle('is-fullwidth', pastSidebar);
    document.body.classList.toggle('past-sidebar', pastSidebar);
  };
  topicLayoutObservers.sidebarScroll = onScroll;
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function setupScrollSpy(sections) {
  const validSections = sections.filter(s => s.el);
  if (!validSections.length) return;

  topicLayoutObservers.sections = new IntersectionObserver(
    (entries) => {
      // Track the most-visible intersecting section
      let best = null;
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        if (!best || e.intersectionRatio > best.ratio) {
          const match = validSections.find(s => s.el === e.target);
          if (match) best = { tab: match.tab, ratio: e.intersectionRatio };
        }
      });
      if (best) setActiveSubnavTab(best.tab);
    },
    { rootMargin: '-140px 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
  );
  validSections.forEach(s => topicLayoutObservers.sections.observe(s.el));
}

function setActiveSubnavTab(tabId) {
  document.querySelectorAll('#sub-header .tab-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.tab === tabId);
  });
}

function attachSubnavScrollHandlers(map) {
  document.querySelectorAll('#sub-header .tab-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      const tabId = pill.dataset.tab;
      const target = map.find(m => m.tab === tabId);
      if (!target?.el) return;
      e.preventDefault();
      const y = target.el.getBoundingClientRect().top + window.scrollY - 140;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    });
  });
}

// ---------- Sidebar renderers (compact vertical lists) ----------

function renderShortcutsSidebar(container, route, isHome, isCustom = false, customTerm = '') {
  const topic = (isHome || isCustom) ? null : getTopicBySlug(route.slug);
  const topicName = isCustom ? customTerm : (isHome ? 'General' : topic?.name || '');

  const evergreen = getEvergreenShortcutsFor(topic);
  // No topic-specific shortcuts for home or custom searches
  const specific = (isHome || isCustom) ? [] : getSpecificShortcutsFor(route.slug);

  let html = `
    <div class="sidebar-card shortcuts-sidebar">
      <div class="sidebar-card-header">
        <span class="sidebar-card-icon">⚡</span>
        <h3 class="sidebar-card-title">AI Shortcuts</h3>
      </div>
  `;

  if (evergreen.length === 0 && specific.length === 0) {
    html += `<p class="sidebar-empty">No shortcuts yet.</p>`;
  } else {
    const needsGroupLabels = evergreen.length > 0 && specific.length > 0;
    if (evergreen.length > 0) {
      if (needsGroupLabels) {
        html += `<div class="sidebar-group-label">Evergreen</div>`;
      }
      html += `<div class="sidebar-shortcut-list">`;
      evergreen.forEach(s => {
        html += shortcutItem(s, topicName);
      });
      html += `</div>`;
    }
    if (specific.length > 0) {
      html += `<div class="sidebar-group-label">Topic-specific</div>`;
      html += `<div class="sidebar-shortcut-list">`;
      specific.forEach(s => {
        html += shortcutItem(s, topicName);
      });
      html += `</div>`;
    }
  }

  html += `</div>`;
  container.innerHTML = html;

  // Click handlers — dispatch open-prompt-modal event with the prompt
  container.querySelectorAll('.sidebar-shortcut').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt;
      const name = btn.dataset.name;
      const icon = btn.dataset.icon;
      window.dispatchEvent(new CustomEvent('open-prompt-modal', {
        detail: { prompt, name, icon },
      }));
    });
  });
}

function shortcutItem(shortcut, topicName) {
  const icon = getShortcutIconEmoji(shortcut.icon);
  const prompt = shortcut.prompt.replace(/\{topic\}/g, topicName);
  return `
    <button class="sidebar-shortcut"
            data-prompt="${escapeAttr(prompt)}"
            data-name="${escapeAttr(shortcut.name)}"
            data-icon="${escapeAttr(icon)}">
      <span class="sidebar-shortcut-icon">${icon}</span>
      <span class="sidebar-shortcut-name">${escapeHTML(shortcut.name)}</span>
    </button>
  `;
}

function getShortcutIconEmoji(icon) {
  const map = {
    'zap': '⚡', 'globe': '🌍', 'cpu': '🤖', 'trending-up': '📈',
    'calendar': '📅', 'rocket': '🚀', 'microscope': '🔬', 'landmark': '🏛️',
    'trophy': '🏆', 'leaf': '🌿', 'heart': '❤️', 'bar-chart': '📊',
    'tool': '🔧', 'laptop': '💻', 'flask': '🧪', 'briefcase': '💼',
    'home': '🏠',
  };
  return map[icon] || '🔗';
}

function renderRelatedTopicsSidebar(container, route, isHome) {
  const title = isHome ? 'Featured Topics' : 'Related Topics';
  const icon = isHome ? '🌐' : '🔗';
  const items = getRelatedTopicsFor(route, isHome);

  let html = `
    <div class="sidebar-card related-sidebar">
      <div class="sidebar-card-header">
        <span class="sidebar-card-icon">${icon}</span>
        <h3 class="sidebar-card-title">${escapeHTML(title)}</h3>
      </div>
  `;

  if (items.length === 0) {
    html += `<p class="sidebar-empty">No related topics yet.</p>`;
  } else {
    html += `<div class="sidebar-topic-list">`;
    items.slice(0, 8).forEach(t => {
      html += `
        <a href="#/topic/${t.slug}" class="sidebar-topic">
          <span class="sidebar-topic-dot"></span>
          <span class="sidebar-topic-name">${escapeHTML(t.name)}</span>
          <span class="sidebar-topic-arrow" aria-hidden="true">↗</span>
        </a>
      `;
    });
    if (items.length > 8) {
      html += `<div class="sidebar-more-note">+${items.length - 8} more — see all</div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  container.innerHTML = html;
}

// ---------- Data helpers (thin wrappers around data.js) ----------

function getEvergreenShortcutsFor(topic) {
  return getEvergreenShortcuts(topic);
}
function getSpecificShortcutsFor(slug) {
  return getSpecificShortcuts(slug);
}
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
