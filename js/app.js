import { initRouter, onRoute } from './utils/router.js';
import { loadAllData, getTopicBySlug, getParentTopics } from './utils/data.js';
import { renderHeader, updateHeaderActiveState } from './components/header.js';
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
    updateHeaderActiveState(route);
    renderPage(route);
  });

  initRouter();
});

// Hybrid layout:
//  - Homepage: Google-style hero (no navbar), centered logo/title/tagline/search/chips/CTA
//  - Every other page: navy navbar + compact sub-header with just the search bar
function renderLayout(route) {
  const siteHeader = document.getElementById('site-header');
  const subHeader = document.getElementById('sub-header');
  const isHome = route.type === 'home';

  if (isHome) {
    siteHeader.innerHTML = '';
    siteHeader.classList.add('is-hidden');
    subHeader.classList.add('is-hero');
    subHeader.classList.remove('is-compact');
    renderHero(subHeader, route);
  } else {
    siteHeader.classList.remove('is-hidden');
    renderHeader(siteHeader);
    subHeader.classList.add('is-compact');
    subHeader.classList.remove('is-hero');
    renderCompactSubHeader(subHeader, route);
  }
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
        <img src="assets/logo.png" alt="Standard Topic" class="hero-brand-logo">
        <h1 class="hero-brand-title">Standard Topic</h1>
      </a>
      <p class="hero-tagline">News, Resources and AI Knowledge. On any topic.</p>
      <div class="hero-search-wrap" id="search-bar-container"></div>
      ${chipsHTML}
      <a href="#/prompt-generator" class="hero-build-btn">
        <span class="hero-build-icon" aria-hidden="true">⚙</span>
        <span>Build Your Own Knowledge Prompt</span>
        <span class="hero-build-plus" aria-hidden="true">+</span>
      </a>
    </div>
  `;
  renderSearchBar(document.getElementById('search-bar-container'), route);
}

function renderCompactSubHeader(container, route) {
  container.innerHTML = `
    <div class="sub-header-inner">
      <div class="sub-header-search" id="search-bar-container"></div>
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

function getIconEmoji(icon) {
  const map = {
    'laptop': '💻', 'flask': '🧪', 'briefcase': '💼', 'home': '🏠',
    'zap': '⚡', 'globe': '🌍', 'cpu': '🤖', 'trending-up': '📈',
    'calendar': '📅', 'rocket': '🚀', 'microscope': '🔬', 'landmark': '🏛️',
  };
  return map[icon] || '📚';
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
      iconEmoji: '🏠',
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

    const topicTabs = [
      { id: 'newsfeed', label: 'News Feed', hash: `#/topic/${route.slug}` },
      { id: 'shortcuts', label: 'AI Shortcuts', hash: `#/topic/${route.slug}/shortcuts` },
      { id: 'related', label: 'Related Topics', hash: `#/topic/${route.slug}/related` },
    ];
    renderTopicBanner(content, {
      title: topic.name,
      iconEmoji: getIconEmoji(topic.icon),
      showTabs: true,
      tabs: topicTabs,
      activeTab: route.tab,
    });

    const tabContent = document.createElement('div');
    tabContent.className = 'tab-content-area';
    content.appendChild(tabContent);

    if (route.tab === 'newsfeed') {
      renderNewsFeed(tabContent, topic, false);
    } else if (route.tab === 'shortcuts') {
      renderShortcuts(tabContent, route);
    } else if (route.tab === 'related') {
      renderRelatedTopics(tabContent, route);
    }
    return;
  }

  if (route.type === 'custom') {
    renderTopicBanner(content, {
      title: route.term,
      iconEmoji: '🔍',
      showTabs: false,
    });
    const tabContent = document.createElement('div');
    tabContent.className = 'tab-content-area';
    content.appendChild(tabContent);
    renderShortcuts(tabContent, route);
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
