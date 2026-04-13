// Topic search/browse modal

import { getTopicsGroupedByParent, searchTopics, getTopicBySlug } from '../utils/data.js';
import { navigate } from '../utils/router.js';

let isOpen = false;
let highlightIndex = -1;
let currentResults = [];

export function renderSearchBar(container, route) {
  let label = 'Search any topic or choose from list';
  if (route.type === 'topic') {
    const topic = getTopicBySlug(route.slug);
    if (topic) label = topic.name;
  } else if (route.type === 'custom') {
    label = route.term;
  }

  container.innerHTML = `
    <div class="search-bar-wrapper">
      <button class="search-bar" id="search-bar-trigger">
        <span class="search-bar-label" id="search-bar-label">${escapeHTML(label)}</span>
        <span class="search-bar-chevron">▾</span>
      </button>
      <div class="search-modal" id="search-modal" style="display:none;">
        <div class="search-modal-input-row">
          <span class="search-modal-icon">🔍</span>
          <input type="text" class="search-modal-input" id="search-modal-input"
                 placeholder="Search any topic or choose from list" autocomplete="off">
        </div>
        <div class="search-modal-results" id="search-modal-results"></div>
      </div>
    </div>
  `;

  const trigger = document.getElementById('search-bar-trigger');
  const modal = document.getElementById('search-modal');
  const input = document.getElementById('search-modal-input');
  const results = document.getElementById('search-modal-results');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    openModal(modal, input, results);
  });

  input.addEventListener('input', () => {
    highlightIndex = -1;
    renderResults(results, input.value);
  });

  input.addEventListener('keydown', (e) => {
    handleKeyboard(e, results, input);
  });

  document.addEventListener('click', (e) => {
    if (isOpen && !modal.contains(e.target) && e.target !== trigger) {
      closeModal(modal);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      closeModal(modal);
    }
  });
}

function openModal(modal, input, results) {
  isOpen = true;
  highlightIndex = -1;
  modal.style.display = 'block';
  input.value = '';
  input.focus();
  renderResults(results, '');
}

function closeModal(modal) {
  isOpen = false;
  modal.style.display = 'none';
}

function renderResults(container, query) {
  const q = query.trim();

  if (q.length === 0) {
    renderBrowseList(container);
    return;
  }

  renderSearchResults(container, q);
}

function renderBrowseList(container) {
  const groups = getTopicsGroupedByParent();
  let html = '';

  groups.forEach(group => {
    html += `
      <div class="search-result-header" data-slug="${group.parent.slug}" role="button" tabindex="0">
        ${escapeHTML(group.parent.name)}
      </div>
    `;
    group.subtopics.forEach(sub => {
      html += `
        <div class="search-result-item" data-slug="${sub.slug}" role="button" tabindex="0">
          ${escapeHTML(sub.name)}
        </div>
      `;
    });
  });

  container.innerHTML = html;
  currentResults = [];

  // Attach click listeners
  container.querySelectorAll('[data-slug]').forEach(el => {
    el.addEventListener('click', () => {
      navigate(`#/topic/${el.dataset.slug}`);
      closeModal(document.getElementById('search-modal'));
    });
  });
}

function renderSearchResults(container, query) {
  let html = '';

  // "Add as Custom Topic" always first
  html += `
    <div class="search-result-custom" id="search-custom-option" role="button" tabindex="0">
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
    html += `<div class="search-result-section-label">Matching Topics</div>`;
    matches.forEach(match => {
      const parentLabel = match.parentName
        ? `<span class="search-result-parent">in ${escapeHTML(match.parentName)}</span>`
        : '';
      html += `
        <div class="search-result-item" data-slug="${match.slug}" role="button" tabindex="0">
          ${highlightMatch(match.name, query)} ${parentLabel}
        </div>
      `;
    });
  }

  container.innerHTML = html;

  // Attach click on custom option
  document.getElementById('search-custom-option')?.addEventListener('click', () => {
    navigate(`#/custom/${encodeURIComponent(query)}`);
    closeModal(document.getElementById('search-modal'));
  });

  // Attach click on topic results
  container.querySelectorAll('.search-result-item[data-slug]').forEach(el => {
    el.addEventListener('click', () => {
      navigate(`#/topic/${el.dataset.slug}`);
      closeModal(document.getElementById('search-modal'));
    });
  });

  updateHighlight(container);
}

function handleKeyboard(e, results, input) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlightIndex = Math.min(highlightIndex + 1, currentResults.length - 1);
    updateHighlight(results);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlightIndex = Math.max(highlightIndex - 1, 0);
    updateHighlight(results);
  } else if (e.key === 'Enter' && highlightIndex >= 0 && currentResults[highlightIndex]) {
    e.preventDefault();
    const selected = currentResults[highlightIndex];
    if (selected.type === 'custom') {
      navigate(`#/custom/${encodeURIComponent(selected.term)}`);
    } else {
      navigate(`#/topic/${selected.slug}`);
    }
    closeModal(document.getElementById('search-modal'));
  }
}

function updateHighlight(container) {
  const items = container.querySelectorAll('.search-result-custom, .search-result-item[data-slug]');
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
