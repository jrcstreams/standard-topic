import { initRouter, onRoute } from './utils/router.js';
import { loadAllData, getTopicBySlug, getParentTopics } from './utils/data.js';
import { renderFooter } from './components/footer.js';
import { renderSearchBar } from './components/search-modal.js';
import { renderNewsFeed } from './components/newsfeed.js';
import { renderShortcuts } from './components/shortcuts.js';
import { renderRelatedTopics } from './components/related-topics.js';
import { renderPromptGenerator } from './components/prompt-generator.js';
import { initPromptModal } from './components/prompt-modal.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  initPromptModal();

  renderFooter(document.getElementById('site-footer'));

  onRoute((route) => {
    renderLayout(route);
    renderPage(route);
  });

  initRouter();
});

// Unified layout:
//  - Homepage: Google-style hero; sticky bar fades in after ~180px scroll
//  - Every other page: same sticky bar visible from page load (no scroll trigger)
//    Content area gets top padding (via body.sticky-always) so it isn't hidden.
let heroScrollHandler = null;

function renderLayout(route) {
  const siteHeader = document.getElementById('site-header');
  const subHeader = document.getElementById('sub-header');
  const isHome = route.type === 'home';

  // Clean up any prior scroll listener before switching modes
  if (heroScrollHandler) {
    window.removeEventListener('scroll', heroScrollHandler);
    heroScrollHandler = null;
  }

  // Reset classes
  siteHeader.className = 'is-sticky-hero';
  subHeader.className = '';
  subHeader.innerHTML = '';
  document.body.classList.remove('sticky-always', 'has-subnav');

  // Always render the sticky hero bar
  renderStickyHeroBar(siteHeader, route);

  if (isHome) {
    // Home: sticky hides until scroll; hero fills sub-header
    subHeader.classList.add('is-hero');
    renderHero(subHeader, route);
    setupStickyReveal(siteHeader);
    return;
  }

  // Every other page: main sticky always visible
  document.body.classList.add('sticky-always');
  siteHeader.classList.add('is-revealed');

  // Topic / custom pages also get a sub-nav below the main nav
  if (route.type === 'topic' || route.type === 'custom') {
    document.body.classList.add('has-subnav');
    subHeader.classList.add('is-subnav');
    renderTopicSubNav(subHeader, route);
  }
}

function renderTopicSubNav(container, route) {
  let title;
  let tabs = null;
  let activeTab = route.tab;

  if (route.type === 'topic') {
    const topic = getTopicBySlug(route.slug);
    if (!topic) return;
    title = topic.name;
    tabs = [
      { id: 'newsfeed', label: 'News Feed', hash: `#/topic/${route.slug}` },
      { id: 'shortcuts', label: 'AI Shortcuts', hash: `#/topic/${route.slug}/shortcuts` },
      { id: 'related', label: 'Related Topics', hash: `#/topic/${route.slug}/related` },
    ];
  } else if (route.type === 'custom') {
    title = route.term;
    // Custom topics have no tabs — just show the title
  }

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

function setupStickyReveal(stickyEl) {
  const THRESHOLD = 180; // reveal after ~180px of scroll
  heroScrollHandler = () => {
    if (window.scrollY > THRESHOLD) {
      stickyEl.classList.add('is-revealed');
    } else {
      stickyEl.classList.remove('is-revealed');
    }
  };
  window.addEventListener('scroll', heroScrollHandler, { passive: true });
  heroScrollHandler(); // initial check
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
      <a href="#/prompt-generator" class="hero-build-link">
        Or build your own knowledge prompt
        <span class="hero-build-arrow" aria-hidden="true">→</span>
      </a>
    </div>
  `;
  renderSearchBar(document.getElementById('search-bar-container'), route);
}


function renderTopicBanner(container, config) {
  const { title, iconEmoji, showTabs, tabs, activeTab } = config;

  const tabsHTML = showTabs && tabs ? `
    <div class="topic-banner-tabs">
      ${tabs.map(t => `
        <a href="${t.hash}" class="tab-pill ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">
          ${t.label}
        </a>
      `).join('')}
    </div>
  ` : '';

  const banner = document.createElement('div');
  banner.className = 'topic-banner';
  banner.innerHTML = `
    <div class="topic-banner-row">
      <div class="topic-banner-titlegroup">
        <span class="topic-banner-accent" aria-hidden="true"></span>
        <h1 class="topic-banner-title">${escapeHTML(title)}</h1>
      </div>
      ${tabsHTML}
    </div>
  `;
  container.appendChild(banner);

  // Tab click handlers (no full page reload)
  banner.querySelectorAll('.tab-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = pill.getAttribute('href').replace(/^#/, '');
    });
  });
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
    const homeTabs = [
      { id: 'newsfeed', label: 'News Feed', hash: '#/' },
      { id: 'shortcuts', label: 'AI Shortcuts', hash: '#/shortcuts' },
      { id: 'related', label: 'Featured Topics', hash: '#/related' },
    ];
    renderTopicBanner(content, {
      title: 'Home',
      showTabs: true,
      tabs: homeTabs,
      activeTab: route.tab,
    });

    const tabContent = document.createElement('div');
    tabContent.className = 'tab-content-area';
    content.appendChild(tabContent);

    if (route.tab === 'newsfeed') {
      renderNewsFeed(tabContent, topic, true);
    } else if (route.tab === 'shortcuts') {
      renderShortcuts(tabContent, { type: 'home', slug: 'home' });
    } else if (route.tab === 'related') {
      renderRelatedTopics(tabContent, { type: 'home', slug: 'home' });
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
