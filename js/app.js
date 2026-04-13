import { initRouter, onRoute } from './utils/router.js';
import { loadAllData, getTopicBySlug } from './utils/data.js';
import { renderHeader, updateHeaderActiveState } from './components/header.js';
import { renderFooter } from './components/footer.js';
import { renderTabs } from './components/tabs.js';
import { renderSearchBar } from './components/search-modal.js';
import { renderNewsFeed } from './components/newsfeed.js';
import { renderShortcuts } from './components/shortcuts.js';
import { renderRelatedTopics } from './components/related-topics.js';
import { renderPromptGenerator } from './components/prompt-generator.js';
import { initPromptModal } from './components/prompt-modal.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  initPromptModal();

  renderHeader(document.getElementById('site-header'));
  renderFooter(document.getElementById('site-footer'));

  onRoute((route) => {
    updateHeaderActiveState(route);
    renderSubHeader(route);
    renderPage(route);
  });

  initRouter();
});

function renderSubHeader(route) {
  const subHeader = document.getElementById('sub-header');
  subHeader.innerHTML = '<div class="sub-header-inner" id="sub-header-inner"></div>';
  const inner = document.getElementById('sub-header-inner');

  const searchContainer = document.createElement('div');
  searchContainer.id = 'search-bar-container';
  inner.appendChild(searchContainer);
  renderSearchBar(searchContainer, route);

  const tabsContainer = document.createElement('div');
  tabsContainer.id = 'tabs-container';
  inner.appendChild(tabsContainer);
  renderTabs(tabsContainer, route);
}

function renderTopicHero(container, title, subtitle, iconEmoji) {
  const hero = document.createElement('div');
  hero.className = 'topic-hero';
  hero.innerHTML = `
    <div class="topic-hero-icon">${iconEmoji || '📚'}</div>
    <div class="topic-hero-content">
      <div class="topic-hero-label">Topic</div>
      <h1 class="topic-hero-title">${escapeHTML(title)}</h1>
      ${subtitle ? `<div class="topic-hero-subtitle">${escapeHTML(subtitle)}</div>` : ''}
    </div>
  `;
  container.appendChild(hero);
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

    const parentTopic = topic.parent ? getTopicBySlug(topic.parent) : null;
    const subtitle = parentTopic ? `Subtopic of ${parentTopic.name}` : 'Topic';
    renderTopicHero(content, topic.name, subtitle, getIconEmoji(topic.icon));

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
    renderTopicHero(content, route.term, 'Custom Topic Search', '🔍');
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
