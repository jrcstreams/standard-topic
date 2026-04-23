// Search: full-screen overlay. A single global overlay lives in
// document.body. `renderSearchBar` creates trigger buttons that all open
// the same overlay.

import { getTopicsGroupedByParent, searchTopics } from '../utils/data.js';
import { navigate } from '../utils/router.js';

let overlayEl = null;
let inputEl = null;
let bodyEl = null;
let currentResults = [];
let highlightIndex = -1;
let cachedBrowseHTML = null;

export function initSearchOverlay() {
  if (overlayEl) return;

  overlayEl = document.createElement('div');
  overlayEl.className = 'search-overlay';
  overlayEl.setAttribute('role', 'dialog');
  overlayEl.setAttribute('aria-label', 'Search topics');
  overlayEl.style.display = 'none';
  overlayEl.innerHTML = `
    <div class="search-overlay-card">
      <div class="search-overlay-input-row">
        <svg class="search-overlay-icon-svg" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="search-overlay-input"
               placeholder="Search topics..."
               autocomplete="off" spellcheck="false">
        <button class="search-overlay-close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="search-overlay-body"></div>
    </div>
  `;
  document.body.appendChild(overlayEl);

  inputEl = overlayEl.querySelector('.search-overlay-input');
  bodyEl = overlayEl.querySelector('.search-overlay-body');
  const closeBtn = overlayEl.querySelector('.search-overlay-close');

  inputEl.addEventListener('input', () => {
    highlightIndex = -1;
    renderBody(inputEl.value);
  });

  inputEl.addEventListener('keydown', handleKeyboard);

  // Event delegation for all clicks in the body — no per-element listeners
  bodyEl.addEventListener('click', (e) => {
    const customBtn = e.target.closest('[data-action="custom"]');
    if (customBtn) {
      const q = inputEl.value.trim();
      if (q) { navigate(`#/custom/${encodeURIComponent(q)}`); closeOverlay(); }
      return;
    }
    const slugEl = e.target.closest('[data-slug]');
    if (slugEl) {
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
  const { compact = false } = opts;
  const cls = `search-bar${compact ? ' is-compact' : ''}`;
  const fullLabel = 'Topics';
  const shortLabel = 'Topics';
  container.innerHTML = `
    <div class="search-bar-wrapper">
      <button class="${cls}" type="button" aria-label="${fullLabel}">
        <svg class="search-bar-icon" aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="7.5"/><line x1="21" y1="21" x2="15.5" y2="15.5"/></svg>
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
    openOverlay();
  });
}

function isOpen() {
  return overlayEl && overlayEl.style.display === 'flex';
}

function openOverlay() {
  if (!overlayEl) initSearchOverlay();
  overlayEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  inputEl.value = '';
  highlightIndex = -1;
  renderBody('');
  bodyEl.scrollTop = 0;
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouch) inputEl.focus();
}

function closeOverlay() {
  if (!overlayEl) return;
  overlayEl.style.display = 'none';
  document.body.style.overflow = '';
}

function renderBody(query) {
  const q = query.trim();
  let html = '';
  currentResults = [];

  if (q) {
    const matches = searchTopics(q);
    currentResults = [
      ...matches.map(m => ({ type: 'topic', slug: m.slug })),
      { type: 'custom', term: q },
    ];

    html += `<div class="search-overlay-results-block">`;

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
  }

  // Browse catalog — cached after first build
  if (!cachedBrowseHTML) cachedBrowseHTML = renderBrowseHTML();
  html += q ? `<div class="search-overlay-section-label">Browse all topics</div>` : '';
  html += cachedBrowseHTML;

  bodyEl.innerHTML = html;
  updateHighlight();
}

function renderBrowseHTML() {
  const groups = getTopicsGroupedByParent();
  let html = `<div class="search-overlay-browse shortcuts-sidebar">`;
  groups.forEach(group => {
    html += `
      <div class="search-overlay-group">
        <a href="#/topic/${group.parent.slug}" class="sidebar-shortcut search-parent-row" data-slug="${group.parent.slug}">
          <span class="sidebar-shortcut-name">${escapeHTML(group.parent.name)}</span>
          <span class="sidebar-shortcut-chev" aria-hidden="true">›</span>
        </a>
        <div class="sidebar-shortcut-list search-subtopic-list">
    `;
    if (group.subtopics.length === 0) {
      html += `<span class="search-overlay-group-empty">No subtopics.</span>`;
    }
    group.subtopics.forEach(sub => {
      html += `
        <a href="#/topic/${sub.slug}" class="sidebar-shortcut search-subtopic-row" data-slug="${sub.slug}">
          <span class="sidebar-shortcut-dot" aria-hidden="true"></span>
          <span class="sidebar-shortcut-name">${escapeHTML(sub.name)}</span>
          <span class="sidebar-shortcut-chev" aria-hidden="true">›</span>
        </a>
      `;
    });
    html += `</div></div>`;
  });
  html += `</div>`;
  return html;
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
