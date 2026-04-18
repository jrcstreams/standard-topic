import { initRouter, onRoute, getCurrentRoute } from './utils/router.js';
import { loadAllData, getTopicBySlug, getParentTopics, getFeaturedTopics, getEvergreenShortcuts, getSpecificShortcuts, getRelatedTopics, getTopicsGroupedByParent } from './utils/data.js';
import { renderFooter } from './components/footer.js';
import { renderSearchBar, initSearchOverlay } from './components/search-modal.js';
import { renderNewsFeed } from './components/newsfeed.js';
import { renderShortcuts } from './components/shortcuts.js';
import { renderRelatedTopics } from './components/related-topics.js';
import { renderPromptGenerator } from './components/prompt-generator.js';
import { initPromptModal } from './components/prompt-modal.js';
import { initDiscoverModal } from './components/discover-modal.js';
import { initAllTopicsModal } from './components/all-topics-modal.js';
import { initRelatedTopicsModal } from './components/related-topics-modal.js';
import { initPromptPreviewModal } from './components/prompt-preview-modal.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  initPromptModal();
  initDiscoverModal();
  initAllTopicsModal();
  initRelatedTopicsModal();
  initPromptPreviewModal();
  initSearchOverlay();

  renderFooter(document.getElementById('site-footer'));

  onRoute((route) => {
    renderLayout(route);
    renderPage(route);
    // Scroll to top after render — use rAF to ensure DOM is settled
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      setSubnavHeightVar();
    });
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
function setSubnavHeightVar() {
  const sub = document.getElementById('sub-header');
  if (!sub) return;
  const h = sub.offsetHeight;
  if (h > 0) document.documentElement.style.setProperty('--subnav-height', `${h}px`);
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
  document.body.classList.remove('sticky-always', 'has-subnav', 'home-mode', 'show-subnav-tabs');

  // Always render the main sticky bar
  renderStickyHeroBar(siteHeader, route);

  // All pages: main nav always fixed + visible.
  document.body.classList.add('sticky-always');
  siteHeader.classList.add('is-revealed');

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
          <div class="topic-banner-titlegroup">
            <h1 class="topic-banner-title">Home</h1>
          </div>
          <div class="subnav-topics-inline home-subnav-topics">
            <a href="#" class="subnav-action-link" id="subnav-all-topics">All Topics +</a>
            <span class="subnav-topics-label">Featured:</span>
            ${topicsHTML}
          </div>
        </div>
      </div>
    `;

    subHeader.querySelector('#subnav-all-topics')?.addEventListener('click', (e) => {
      e.preventDefault();
      // Open the full search modal so users can browse + search all topics
      const searchBar = document.querySelector('.search-bar');
      if (searchBar) searchBar.click();
    });

    // Clear hero on desktop — no longer needed
    if (heroEl) heroEl.innerHTML = '';

    trimOverflowLinks();
    return;
  }

  // Prompt generator: clean subnav with title only.
  if (route.type === 'prompt-generator') {
    document.body.classList.add('has-subnav');
    subHeader.classList.add('is-subnav');
    subHeader.innerHTML = `
      <div class="topic-banner">
        <div class="topic-banner-row">
          <div class="topic-banner-titlegroup">
            <h1 class="topic-banner-title">Build a Knowledge Prompt</h1>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Topic / custom pages also get a sub-nav below the main nav
  if (route.type === 'topic' || route.type === 'custom') {
    document.body.classList.add('has-subnav');
    subHeader.classList.add('is-subnav');

    if (route.type === 'topic') {
      const topic = getTopicBySlug(route.slug);
      if (!topic) return;
      const related = getRelatedTopics(topic);
      const INLINE_CAP = 6;
      const visibleRelated = related.slice(0, INLINE_CAP);
      const relatedLinksHTML = visibleRelated.map(t =>
        `<a href="#/topic/${t.slug}" class="subnav-topic-link">${escapeHTML(t.name)}</a>`
      ).join('') + `<a href="#" class="subnav-more-link" id="subnav-more-related">More +</a>`;

      subHeader.innerHTML = `
        <div class="topic-banner">
          <div class="topic-banner-row">
            <div class="topic-banner-titlegroup">
              <h1 class="topic-banner-title">${escapeHTML(topic.name)}</h1>
            </div>
            ${related.length > 0 ? `<a href="#" class="subnav-related-btn" id="subnav-related-btn">Related Topics +</a>` : ''}
            ${related.length > 0 ? `
              <div class="subnav-topics-inline">
                <span class="subnav-topics-label">Related:</span>
                ${relatedLinksHTML}
              </div>
            ` : ''}
          </div>
        </div>
      `;

      const openRelatedModal = (e) => {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('open-related-topics-modal', {
          detail: { topics: related, title: 'Related Topics', topicName: topic.name },
        }));
      };
      subHeader.querySelector('#subnav-more-related')?.addEventListener('click', openRelatedModal);
      subHeader.querySelector('#subnav-related-btn')?.addEventListener('click', openRelatedModal);

      trimOverflowLinks();
    } else {
      // Custom search: title-only subnav.
      renderSubNav(subHeader, { title: route.term });
    }
  }
}

// Unified subnav renderer for custom search pages
function renderSubNav(container, { title }) {
  container.innerHTML = `
    <div class="topic-banner">
      <div class="topic-banner-row">
        <div class="topic-banner-titlegroup">
          <svg class="subnav-search-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <h1 class="topic-banner-title">${escapeHTML(title)}</h1>
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

// Hide subnav topic links that overflow the container. Runs on
// render and on resize so topics drop cleanly instead of clipping.
let trimResizeHandler = null;
function trimOverflowLinks() {
  const container = document.querySelector('.subnav-topics-inline');
  if (!container) return;

  const doTrim = () => {
    const links = container.querySelectorAll('.subnav-topic-link');
    const moreLink = container.querySelector('.subnav-more-link');

    // Always show container for measurement, then decide visibility after
    container.style.display = '';
    links.forEach(l => l.style.display = '');

    const containerRight = container.getBoundingClientRect().right;
    // Reserve space for "More +" link
    const moreWidth = moreLink ? moreLink.offsetWidth + 20 : 0;
    const cutoff = containerRight - moreWidth;

    // Hide any link whose right edge exceeds the available space
    let visibleCount = 0;
    links.forEach(l => {
      if (l.getBoundingClientRect().right > cutoff) {
        l.style.display = 'none';
      } else {
        visibleCount++;
      }
    });

    // Show/hide the "Related Topics +" condensed button based on visible count.
    // When fewer than 3 inline links fit, hide the inline row and show the button.
    const relatedBtn = document.getElementById('subnav-related-btn');
    if (relatedBtn) {
      if (visibleCount < 3) {
        container.style.display = 'none';
        relatedBtn.style.display = 'inline-block';
      } else {
        container.style.display = '';
        relatedBtn.style.display = 'none';
      }
    }
  };

  // Run after layout settles
  requestAnimationFrame(doTrim);

  // Re-run on resize
  if (trimResizeHandler) window.removeEventListener('resize', trimResizeHandler);
  trimResizeHandler = () => requestAnimationFrame(doTrim);
  window.addEventListener('resize', trimResizeHandler, { passive: true });
}

function renderStickyHeroBar(container, route) {
  const isPromptGen = route.type === 'prompt-generator';
  container.innerHTML = `
    <div class="sticky-hero-inner">
      <a href="#/" class="sticky-brand" id="sticky-brand-link">
        <img src="assets/logo-dark.png" alt="Standard Topic" class="sticky-logo-img">
        <span class="sticky-title">Standard Topic</span>
      </a>
      <span class="sticky-tagline">News, Resources and AI Knowledge. On any topic.</span>
      <div class="sticky-actions">
        <div class="sticky-search" id="sticky-search-container"></div>
        <a href="#/prompt-generator" class="sticky-cta">
          <span class="sticky-cta-full">Build a prompt +</span>
          <span class="sticky-cta-short">Build a prompt +</span>
        </a>
      </div>
    </div>
  `;
  renderSearchBar(document.getElementById('sticky-search-container'), route, { compact: true });

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
    // Custom: AI Shortcuts on top, Content Shortcuts below — no tabs.
    container.innerHTML = `
      <div class="topic-layout is-custom" id="topic-layout">
        <section class="layout-section" id="section-shortcuts"></section>
        <section class="layout-section" id="section-newsfeed"></section>
      </div>
    `;
  } else if (isHome) {
    // Homepage: AI Shortcuts full-width, News Feed below. Topics in subnav.
    container.innerHTML = `
      <div class="topic-layout" id="topic-layout">
        <section class="layout-section" id="section-shortcuts"></section>
        <section class="layout-section" id="section-newsfeed"></section>
      </div>
    `;
  } else {
    // Topic pages: AI Shortcuts full-width, News Feed below.
    // Related topics only in subnav (not in body).
    container.innerHTML = `
      <div class="topic-layout" id="topic-layout">
        <section class="layout-section" id="section-shortcuts"></section>
        <section class="layout-section" id="section-newsfeed"></section>
      </div>
    `;
  }

  const feedSection = container.querySelector('#section-newsfeed');
  const shortcutsSection = container.querySelector('#section-shortcuts');

  renderNewsFeed(feedSection, topic, isHome, { isCustom, customTerm });
  renderShortcutsSidebar(shortcutsSection, route, isHome, isCustom, customTerm);


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

  const evergreen = getEvergreenShortcutsFor(topic);
  const specific = isCustom ? [] : getSpecificShortcutsFor(isHome ? 'home' : route.slug);
  const all = [...evergreen, ...specific];

  let html = `
    <div class="sidebar-card shortcuts-sidebar">
      <div class="sidebar-card-header">
        <h3 class="sidebar-card-title">AI Shortcuts</h3>
        <span class="sidebar-card-desc">Quick access to AI knowledge covering ${topicName ? escapeHTML(topicName) : 'any topic'}, with the ability to choose between different AI models.</span>
      </div>
  `;

  if (all.length === 0) {
    html += `<p class="sidebar-empty">No shortcuts yet.</p>`;
  } else {
    html += `<div class="sidebar-shortcut-list">
      ${all.map(s => shortcutItem(s, topicName)).join('')}
    </div>`;
  }

  html += `</div>`;
  container.innerHTML = html;

  container.querySelectorAll('.sidebar-shortcut').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.blur();
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
      <span class="sidebar-shortcut-chev" aria-hidden="true">›</span>
    </button>
  `;
}

function getShortcutIconEmoji(icon) {
  const map = {
    'zap': '⚡', 'globe': '🌍', 'cpu': '🤖', 'trending-up': '📈',
    'calendar': '📅', 'rocket': '🚀', 'microscope': '🔬', 'landmark': '🏛️',
    'trophy': '🏆', 'leaf': '🌿', 'heart': '❤️', 'bar-chart': '📊',
    'tool': '🔧', 'laptop': '💻', 'flask': '🧪', 'briefcase': '💼',
    'home': '🏠', 'newspaper': '📰', 'fire': '🔥', 'world': '🌎',
    'sparkle': '✨', 'lightbulb': '💡', 'target': '🎯', 'compass': '🧭',
    'book': '📚', 'mag-glass': '🔍', 'shield': '🛡️', 'money': '💰',
    'handshake': '🤝', 'megaphone': '📣', 'star': '⭐', 'scales': '⚖️',
    'film': '🎬', 'medal': '🏅', 'graduation': '🎓', 'chess': '♟️',
  };
  return map[icon] || '🔗';
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
          <span class="sidebar-shortcut-dot" aria-hidden="true"></span>
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
          <span class="sidebar-shortcut-dot" aria-hidden="true"></span>
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
