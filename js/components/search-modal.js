// Search: full-screen overlay (SR2). A single global overlay lives in
// document.body. `renderSearchBar` creates trigger buttons that all open
// the same overlay. No second click needed — the overlay appears with
// the input focused and results visible.

import { getTopicsGroupedByParent, searchTopics } from '../utils/data.js';
import { navigate } from '../utils/router.js';

let overlayEl = null;
let inputEl = null;
let bodyEl = null;
let currentResults = [];
let highlightIndex = -1;

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
        <span class="search-overlay-icon" aria-hidden="true">🔍</span>
        <input type="text" class="search-overlay-input"
               placeholder="Search topics, or add a custom one"
               autocomplete="off" spellcheck="false">
        <span class="search-overlay-esc" aria-hidden="true">ESC</span>
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

  // Click outside the card closes
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeOverlay();
  });

  closeBtn.addEventListener('click', closeOverlay);

  // Escape closes (only when overlay is open)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      closeOverlay();
    }
  });
}

export function renderSearchBar(container) {
  container.innerHTML = `
    <div class="search-bar-wrapper">
      <button class="search-bar" type="button">
        <span class="search-bar-icon" aria-hidden="true">🔍</span>
        <span class="search-bar-label">Search any topic or choose from list</span>
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
  // Focus after a tick so the browser finishes layout/animation
  setTimeout(() => inputEl.focus(), 30);
}

function closeOverlay() {
  if (!overlayEl) return;
  overlayEl.style.display = 'none';
  document.body.style.overflow = '';
}

function renderBody(query) {
  const q = query.trim();
  if (!q) {
    renderBrowseGrid();
    return;
  }
  renderSearchResults(q);
}

function renderBrowseGrid() {
  const groups = getTopicsGroupedByParent();
  let html = '';

  groups.forEach(group => {
    html += `
      <div class="search-overlay-group">
        <a href="#/topic/${group.parent.slug}" class="search-overlay-group-label" data-slug="${group.parent.slug}">
          ${escapeHTML(group.parent.name)}
        </a>
        <div class="search-overlay-chips">
    `;
    if (group.subtopics.length === 0) {
      html += `<span class="search-overlay-group-empty">No subtopics — click the name above to browse ${escapeHTML(group.parent.name)}.</span>`;
    }
    group.subtopics.forEach(sub => {
      html += `<a href="#/topic/${sub.slug}" class="search-overlay-topic-chip" data-slug="${sub.slug}">${escapeHTML(sub.name)}</a>`;
    });
    html += `</div></div>`;
  });

  bodyEl.innerHTML = html;
  currentResults = [];

  bodyEl.querySelectorAll('[data-slug]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(`#/topic/${el.dataset.slug}`);
      closeOverlay();
    });
  });
}

function renderSearchResults(query) {
  let html = `
    <div class="search-overlay-custom" data-action="custom" role="button" tabindex="0">
      <span class="search-custom-badge">+</span>
      Add "<strong>${escapeHTML(query)}</strong>" as Custom Topic
    </div>
  `;

  const matches = searchTopics(query);
  currentResults = [
    { type: 'custom', term: query },
    ...matches.map(m => ({ type: 'topic', slug: m.slug })),
  ];

  if (matches.length > 0) {
    html += `<div class="search-overlay-section-label">Matching Topics</div>`;
    matches.forEach(match => {
      const parentLabel = match.parentName
        ? `<span class="search-overlay-result-parent">in ${escapeHTML(match.parentName)}</span>`
        : '';
      html += `
        <div class="search-overlay-result" data-slug="${match.slug}" role="button" tabindex="0">
          ${highlightMatch(match.name, query)} ${parentLabel}
        </div>
      `;
    });
  } else {
    html += `<div class="search-overlay-empty">Press Enter to search for "<strong>${escapeHTML(query)}</strong>" as a custom topic.</div>`;
  }

  bodyEl.innerHTML = html;

  bodyEl.querySelector('[data-action="custom"]')?.addEventListener('click', () => {
    navigate(`#/custom/${encodeURIComponent(query)}`);
    closeOverlay();
  });

  bodyEl.querySelectorAll('[data-slug]').forEach(el => {
    el.addEventListener('click', () => {
      navigate(`#/topic/${el.dataset.slug}`);
      closeOverlay();
    });
  });

  updateHighlight();
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
