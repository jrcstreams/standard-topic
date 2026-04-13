import { initRouter, onRoute } from './utils/router.js';
import { loadAllData } from './utils/data.js';
import { renderHeader, updateHeaderActiveState } from './components/header.js';
import { renderFooter } from './components/footer.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();

  renderHeader(document.getElementById('site-header'));
  renderFooter(document.getElementById('site-footer'));

  onRoute((route) => {
    updateHeaderActiveState(route);
    renderPage(route);
  });

  initRouter();
});

function renderPage(route) {
  const content = document.getElementById('content');
  content.innerHTML = `<p>Route: ${route.type} / ${route.slug || route.term || ''}</p>`;
}
