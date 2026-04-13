import { initRouter, onRoute } from './utils/router.js';
import { loadAllData, getTopicBySlug } from './utils/data.js';
import { renderHeader, updateHeaderActiveState } from './components/header.js';
import { renderFooter } from './components/footer.js';
import { renderTabs } from './components/tabs.js';
import { renderNewsFeed } from './components/newsfeed.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();

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

  const searchPlaceholder = document.createElement('div');
  searchPlaceholder.id = 'search-bar-container';
  inner.appendChild(searchPlaceholder);

  const tabsContainer = document.createElement('div');
  tabsContainer.id = 'tabs-container';
  inner.appendChild(tabsContainer);
  renderTabs(tabsContainer, route);
}

function renderPage(route) {
  const content = document.getElementById('content');
  content.innerHTML = '';

  if (route.type === 'home') {
    const topic = getTopicBySlug('home');
    if (route.tab === 'newsfeed') {
      renderNewsFeed(content, topic, true);
    } else {
      content.innerHTML = `<p>Tab: ${route.tab} (coming next)</p>`;
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
    } else {
      content.innerHTML = `<p>Tab: ${route.tab} (coming next)</p>`;
    }
    return;
  }

  if (route.type === 'custom') {
    content.innerHTML = `<p>Custom topic: ${route.term} (coming next)</p>`;
    return;
  }

  if (route.type === 'prompt-generator') {
    content.innerHTML = `<p>Prompt Generator (coming next)</p>`;
    return;
  }

  if (route.type === 'about') {
    content.innerHTML = `<p>About page (coming next)</p>`;
    return;
  }

  content.innerHTML = `
    <div class="not-found">
      <h2>Page not found</h2>
      <p><a href="#/">Go home</a></p>
    </div>
  `;
}
