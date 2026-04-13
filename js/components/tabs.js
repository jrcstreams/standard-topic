// Tab pills component (News Feed / AI Shortcuts / Related Topics)

import { navigate } from '../utils/router.js';

const TAB_CONFIGS = {
  home: [
    { id: 'newsfeed', label: 'News Feed', hash: '#/' },
    { id: 'shortcuts', label: 'AI Shortcuts', hash: '#/shortcuts' },
    { id: 'related', label: 'Featured Topics', hash: '#/related' },
  ],
  topic: (slug) => [
    { id: 'newsfeed', label: 'News Feed', hash: `#/topic/${slug}` },
    { id: 'shortcuts', label: 'AI Shortcuts', hash: `#/topic/${slug}/shortcuts` },
    { id: 'related', label: 'Related Topics', hash: `#/topic/${slug}/related` },
  ],
};

export function renderTabs(container, route) {
  if (route.type === 'home') {
    container.innerHTML = buildTabsHTML(TAB_CONFIGS.home, route.tab);
    attachTabListeners(container);
    return;
  }

  if (route.type === 'topic') {
    const tabs = TAB_CONFIGS.topic(route.slug);
    container.innerHTML = buildTabsHTML(tabs, route.tab);
    attachTabListeners(container);
    return;
  }

  container.innerHTML = '';
}

function buildTabsHTML(tabs, activeTab) {
  const tabsHTML = tabs.map(t => `
    <a href="${t.hash}" class="tab-pill ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">
      ${t.label}
    </a>
  `).join('');

  return `<div class="tabs-row">${tabsHTML}</div>`;
}

function attachTabListeners(container) {
  container.querySelectorAll('.tab-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(pill.getAttribute('href'));
    });
  });
}
