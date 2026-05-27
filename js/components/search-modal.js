// Search Topics overlay — a redesigned dual-purpose panel:
//   1) A search section: type anything, fall through to a custom search.
//   2) A browse section: grid of topic cards (with icons) that accordion
//      open to reveal a "Browse all <topic>" link + the parent's
//      subtopic list.
// A "View all topics" link expands the visible parent set from just
// the featured ones to every parent topic in the catalog.

import { getTopicsGroupedByParent, getFeaturedTopics, searchTopics } from '../utils/data.js';
import { topicIconSVG } from '../utils/topic-icons.js';
import { navigate } from '../utils/router.js';

let overlayEl = null;
let inputEl = null;
let bodyEl = null;
let currentResults = [];
let highlightIndex = -1;
let expandedSlug = null;
let showAllTopics = false;

export function initSearchOverlay() {
  if (overlayEl) return;

  overlayEl = document.createElement('div');
  overlayEl.className = 'search-overlay';
  overlayEl.setAttribute('role', 'dialog');
  overlayEl.setAttribute('aria-label', 'Search topics');
  overlayEl.style.display = 'none';
  overlayEl.innerHTML = `
    <div class="search-overlay-card">
      <header class="search-modal-head">
        <button class="search-overlay-close" type="button" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18"/>
            <line x1="18" y1="6" x2="6" y2="18"/>
          </svg>
        </button>
        <h2 class="search-modal-head-title">Topics</h2>
      </header>
      <div class="search-overlay-body-wrap">
        <div class="search-overlay-body"></div>
        <div class="scroll-fade scroll-fade-top" aria-hidden="true">
          <svg class="scroll-fade-chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 7.5 6 4.5 9 7.5"/></svg>
        </div>
        <div class="scroll-fade scroll-fade-bottom" aria-hidden="true">
          <svg class="scroll-fade-chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 4.5 6 7.5 9 4.5"/></svg>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlayEl);

  bodyEl = overlayEl.querySelector('.search-overlay-body');
  const bodyWrapEl = overlayEl.querySelector('.search-overlay-body-wrap');

  // Toggle has-overflow-top / has-overflow-bottom on the wrap based on
  // the body's scroll position. Same pattern as the shortcuts list
  // scroll fades — rAF-throttled to keep scroll smooth.
  let rafId = null;
  const updateOverflow = () => {
    rafId = null;
    if (!bodyEl || !bodyWrapEl) return;
    const max = bodyEl.scrollHeight - bodyEl.clientHeight;
    const hasOverflow = max > 1;
    bodyWrapEl.classList.toggle('has-overflow-top', hasOverflow && bodyEl.scrollTop > 1);
    bodyWrapEl.classList.toggle('has-overflow-bottom', hasOverflow && bodyEl.scrollTop < max - 1);
  };
  const scheduleOverflow = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(updateOverflow);
  };
  bodyEl.addEventListener('scroll', scheduleOverflow, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(scheduleOverflow).observe(bodyEl);
  }
  // Expose for openOverlay() to call after a re-render so the
  // indicators reflect the new content height.
  overlayEl._refreshScrollFade = scheduleOverflow;
  const closeBtn = overlayEl.querySelector('.search-overlay-close');

  // Event delegation for all clicks in the body — no per-element listeners
  bodyEl.addEventListener('click', (e) => {
    const customBtn = e.target.closest('[data-action="custom"]');
    if (customBtn) {
      const q = inputEl?.value.trim();
      if (q) { navigate(`#/custom/${encodeURIComponent(q)}`); closeOverlay(); }
      return;
    }
    const viewAllBtn = e.target.closest('[data-action="view-all"]');
    if (viewAllBtn) {
      showAllTopics = !showAllTopics;
      renderBody(inputEl?.value || '');
      return;
    }
    const cardHeader = e.target.closest('.topic-card-head');
    if (cardHeader) {
      const slug = cardHeader.dataset.slug;
      if (slug) {
        // Class-toggle instead of re-rendering the whole modal body
        // (which means re-building 13 topic cards + their icon SVGs
        // — visibly laggy on every click).
        const card = cardHeader.closest('.topic-card');
        const previouslyOpen = bodyEl.querySelector('.topic-card.is-expanded');
        const willOpen = !card.classList.contains('is-expanded');
        if (previouslyOpen && previouslyOpen !== card) {
          previouslyOpen.classList.remove('is-expanded');
          const prevHead = previouslyOpen.querySelector('.topic-card-head');
          if (prevHead) prevHead.setAttribute('aria-expanded', 'false');
        }
        card.classList.toggle('is-expanded', willOpen);
        cardHeader.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        expandedSlug = willOpen ? slug : null;
      }
      return;
    }
    const slugEl = e.target.closest('[data-slug]');
    if (slugEl) {
      // Clicks on subtopic / parent links inside the expansion area.
      e.preventDefault();
      navigate(`#/topic/${slugEl.dataset.slug}`);
      closeOverlay();
    }
  });

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeOverlay();
  });

  closeBtn.addEventListener('click', closeOverlay);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) closeOverlay();
  });
}

export function renderSearchBar(container, route, opts = {}) {
  const { compact = false, variant = 'default' } = opts;
  const cls = `search-bar${compact ? ' is-compact' : ''}`;
  // 'search' variant — used in the expanded menu — reads as a true
  // search field with a magnifying glass icon, and opens the topic
  // modal with the search input focused so the user can type
  // immediately. 'default' variant uses the grid icon + "Choose
  // Topics" label and is the main nav button (clicks open the
  // Topics modal in browse mode).
  const isSearch = variant === 'search';
  const fullLabel = isSearch ? 'Search any topic' : 'Choose Topics';
  const shortLabel = isSearch ? 'Search' : 'Topics';
  const iconSVG = isSearch
    ? `<svg class="search-bar-icon" aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`
    : `<svg class="search-bar-icon" aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`;
  container.innerHTML = `
    <div class="search-bar-wrapper">
      <button class="${cls}" type="button" aria-label="${fullLabel}">
        ${iconSVG}
        <span class="search-bar-label">
          <span class="search-bar-label-full">${fullLabel}</span>
          <span class="search-bar-label-short">${shortLabel}</span>
        </span>
      </button>
    </div>
  `;

  const trigger = container.querySelector('.search-bar');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    openOverlay({ focusInput: isSearch });
  });
}

function isOpen() {
  return overlayEl && overlayEl.style.display === 'flex';
}

function openOverlay(opts = {}) {
  if (!overlayEl) initSearchOverlay();
  overlayEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  expandedSlug = null;
  showAllTopics = false;
  highlightIndex = -1;
  renderBody('');
  bodyEl.scrollTop = 0;
  // Default: focus the input on desktop, not on touch (touch focus
  // forces the soft keyboard which is jarring when the user just
  // wanted to browse). The menu's "Search any topic" trigger
  // overrides this with focusInput: true so the user lands ready
  // to type on every device.
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (opts.focusInput || !isTouch) inputEl?.focus();
}

function closeOverlay() {
  if (!overlayEl) return;
  overlayEl.style.display = 'none';
  document.body.style.overflow = '';
}

function renderBody(query) {
  const q = (query || '').trim();
  currentResults = [];

  const sections = [];

  // === Search section =====================================================
  sections.push(`
    <section class="search-modal-section search-modal-search-section">
      <span class="search-modal-eyebrow">Search for content on any topic</span>
      <div class="search-overlay-input-row">
        <svg class="search-overlay-icon-svg" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" class="search-overlay-input"
               value="${escapeAttr(q)}"
               placeholder="Search a topic or type your own..."
               autocomplete="off" autocapitalize="off" autocorrect="off"
               spellcheck="false" enterkeyhint="go">
      </div>
      ${q ? renderSearchResults(q) : ''}
    </section>
  `);

  // === Browse section =====================================================
  // Hide the browse grid when the user is actively typing — the results
  // above + the "search as custom" CTA become the focus.
  if (!q) {
    sections.push(renderBrowseSection());
  }

  bodyEl.innerHTML = sections.join('');

  // Re-grab the input element (the body was just replaced) and rebind
  // the input listener so keystrokes don't re-trigger a full render
  // for every character (we only re-render when transitioning between
  // browse and search modes).
  inputEl = bodyEl.querySelector('.search-overlay-input');
  if (inputEl) {
    inputEl.addEventListener('input', () => {
      highlightIndex = -1;
      renderBody(inputEl.value);
      // After re-render the body lost focus; restore it.
      const newInput = bodyEl.querySelector('.search-overlay-input');
      if (newInput) {
        newInput.focus();
        const len = newInput.value.length;
        newInput.setSelectionRange(len, len);
      }
    });
    inputEl.addEventListener('keydown', handleKeyboard);
  }
  updateHighlight();
  // Re-evaluate scroll-fade overlay visibility now that body content
  // height has changed. ResizeObserver also fires here, but calling
  // explicitly avoids a one-frame flash where the overlays lag.
  overlayEl?._refreshScrollFade?.();
}

function renderSearchResults(q) {
  const matches = searchTopics(q);
  currentResults = [
    ...matches.map(m => ({ type: 'topic', slug: m.slug })),
    { type: 'custom', term: q },
  ];

  let html = `<div class="search-overlay-results-block">`;

  if (matches.length > 0) {
    matches.forEach(match => {
      const parentLabel = match.parentName
        ? `<span class="search-overlay-result-parent">${escapeHTML(match.parentName)}</span>`
        : '';
      html += `
        <div class="search-overlay-result" data-slug="${match.slug}" role="button" tabindex="0">
          <span class="search-overlay-result-name">${highlightMatch(match.name, q)}</span>
          ${parentLabel}
          <span class="search-overlay-result-arrow">›</span>
        </div>
      `;
    });
  } else {
    html += `<div class="search-overlay-empty">No matching topics found.</div>`;
  }

  html += `
      <div class="search-overlay-custom" data-action="custom" role="button" tabindex="0">
        <span class="search-custom-badge">+</span>
        Search "<strong>${escapeHTML(q)}</strong>" as Custom Topic
      </div>
  `;
  html += `</div>`;
  return html;
}

function renderBrowseSection() {
  const featured = getFeaturedTopics();
  const groups = getTopicsGroupedByParent();
  const featuredSlugs = new Set(featured.map(t => t.slug));

  // Featured first (in featured order); then non-featured parents
  // appended only when "View all topics" has been activated.
  const orderedGroups = [
    ...featured
      .map(f => groups.find(g => g.parent.slug === f.slug))
      .filter(Boolean),
    ...(showAllTopics
      ? groups.filter(g => !featuredSlugs.has(g.parent.slug))
      : []),
  ];

  const cardsHTML = orderedGroups.map(g => renderTopicCard(g)).join('');

  const hiddenCount = groups.length - featured.length;
  const viewAllHTML = (hiddenCount > 0)
    ? `<button type="button" class="search-modal-view-all" data-action="view-all">
         ${showAllTopics
           ? `<span>Show fewer topics</span>
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 7.5 6 4.5 3 7.5"/></svg>`
           : `<span>View all ${groups.length} topics</span>
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 4.5 6 7.5 9 4.5"/></svg>`}
       </button>`
    : '';

  return `
    <section class="search-modal-section search-modal-browse-section">
      <span class="search-modal-eyebrow">Pick a Topic</span>
      <div class="search-modal-topic-grid">
        ${cardsHTML}
      </div>
      ${viewAllHTML}
    </section>
  `;
}

function renderTopicCard(group) {
  const { parent, subtopics } = group;
  const isExpanded = expandedSlug === parent.slug;
  const iconKey = parent.icon || 'globe';
  // Render the expansion DOM up front for every card. CSS hides it
  // until .topic-card.is-expanded toggles. This way the click
  // handler only flips a class — no re-render of the whole modal
  // body (which was rebuilding 13 topic cards + their icon SVGs
  // on every interaction and visibly lagging the UI).
  return `
    <div class="topic-card ${isExpanded ? 'is-expanded' : ''}">
      <button type="button"
              class="topic-card-head"
              data-slug="${parent.slug}"
              aria-expanded="${isExpanded ? 'true' : 'false'}">
        <span class="topic-card-icon">${topicIconSVG(iconKey, '')}</span>
        <span class="topic-card-name">${escapeHTML(parent.name)}</span>
        <svg class="topic-card-caret" width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="3 4.5 6 7.5 9 4.5"/>
        </svg>
      </button>
      <div class="topic-card-expansion">
        <a href="#/topic/${parent.slug}" class="topic-card-all" data-slug="${parent.slug}">
          <span>Browse all ${escapeHTML(parent.name)}</span>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="3" y1="7" x2="11" y2="7"/>
            <polyline points="7.5 3.5 11 7 7.5 10.5"/>
          </svg>
        </a>
        ${subtopics.length > 0
          ? `<ul class="topic-card-sublist">
               ${subtopics.map(sub => `
                 <li>
                   <a href="#/topic/${sub.slug}" class="topic-card-sublink" data-slug="${sub.slug}">
                     <span class="topic-card-subdot" aria-hidden="true"></span>
                     <span>${escapeHTML(sub.name)}</span>
                   </a>
                 </li>
               `).join('')}
             </ul>`
          : `<p class="topic-card-empty">No subtopics yet.</p>`}
      </div>
    </div>
  `;
}

function handleKeyboard(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlightIndex = Math.min(highlightIndex + 1, currentResults.length - 1);
    updateHighlight();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlightIndex = Math.max(highlightIndex - 1, 0);
    updateHighlight();
  } else if (e.key === 'Enter') {
    const query = inputEl.value.trim();
    if (!query && highlightIndex < 0) return;
    e.preventDefault();

    let target;
    if (highlightIndex >= 0 && currentResults[highlightIndex]) {
      target = currentResults[highlightIndex];
    } else {
      const firstTopicMatch = currentResults.find(r => r.type === 'topic');
      target = firstTopicMatch || { type: 'custom', term: query };
    }

    if (target.type === 'custom') {
      navigate(`#/custom/${encodeURIComponent(target.term)}`);
    } else {
      navigate(`#/topic/${target.slug}`);
    }
    closeOverlay();
  }
}

function updateHighlight() {
  const items = bodyEl.querySelectorAll('.search-overlay-custom, .search-overlay-result');
  items.forEach((el, i) => {
    el.classList.toggle('highlighted', i === highlightIndex);
  });
}

function highlightMatch(name, query) {
  const idx = name.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHTML(name);
  const before = name.slice(0, idx);
  const match = name.slice(idx, idx + query.length);
  const after = name.slice(idx + query.length);
  return `${escapeHTML(before)}<strong>${escapeHTML(match)}</strong>${escapeHTML(after)}`;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;').replace(/&/g, '&amp;');
}
