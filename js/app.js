import { initRouter, onRoute } from './utils/router.js';
import { loadAllData } from './utils/data.js';
import { renderHeader, updateHeaderActiveState } from './components/header.js';
import { renderFooter } from './components/footer.js';
import { renderTabs } from './components/tabs.js';

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
  content.innerHTML = `<p>Page: ${route.type} | ${route.slug || route.term || ''} | tab: ${route.tab || 'none'}</p>`;
}
