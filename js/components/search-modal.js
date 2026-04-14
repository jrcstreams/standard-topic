// Topic search/browse modal
// Supports multiple instances on the same page (hero + sticky header)

import { getTopicsGroupedByParent, searchTopics } from '../utils/data.js';
import { navigate } from '../utils/router.js';

let globalListenersAttached = false;

export function renderSearchBar(container, route) {
  container.innerHTML = `
    <div class="search-bar-wrapper">
      <button class="search-bar" type="button">
        <span class="search-bar-icon">🔍</span>
        <span class="search-bar-label">Search any topic or choose from list</span>
      </button>
      <div class="search-modal" style="display:none;">
        <div class="search-modal-input-row">
          <span class="search-modal-icon">🔍</span>
          <input type="text" class="search-modal-input"
                 placeholder="Search any topic or choose from list" autocomplete="off">
        </div>
        <div class="search-modal-results"></div>
      </div>
    </div>
  `;

  const wrapper = container.querySelector('.search-bar-wrapper');
  const trigger = wrapper.querySelector('.search-bar');
  const modal = wrapper.querySelector('.search-modal');
  const input = wrapper.querySelector('.search-modal-input');
  const results = wrapper.querySelector('.search-modal-results');

  // Per-instance state via closure
  const state = { isOpen: false, highlightIndex: -1, currentResults: [] };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    openModal(modal, input, results, state);
  });

  input.addEventListener('input', () => {
    state.highlightIndex = -1;
    renderResults(results, input.value, state);
  });

  input.addEventListener('keydown', (e) => {
    handleKeyboard(e, results, input, state, modal);
  });

  attachGlobalListeners();
}

function openModal(modal, input, results, state) {
  // Close any other open modals first
  document.querySelectorAll('.search-modal').forEach(m => {
    if (m !== modal && m.style.display === 'block') {
      m.style.display = 'none';
    }
  });

  state.isOpen = true;
  state.highlightIndex = -1;
  modal.style.display = 'block';
  input.value = '';
  input.focus();
  renderResults(results, '', state);
}

function closeModal(modal, state) {
  if (state) state.isOpen = false;
  if (modal) modal.style.display = 'none';
}

function renderResults(container, query, state) {
  const q = query.trim();
  if (q.length === 0) {
    renderBrowseList(container, state);
    return;
  }
  renderSearchResults(container, q, state);
}

function renderBrowseList(container, state) {
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
  state.currentResults = [];

  container.querySelectorAll('[data-slug]').forEach(el => {
    el.addEventListener('click', () => {
      const modal = container.closest('.search-modal');
      navigate(`#/topic/${el.dataset.slug}`);
      closeModal(modal, state);
    });
  });
}

function renderSearchResults(container, query, state) {
  let html = '';

  html += `
    <div class="search-result-custom" data-action="custom" role="button" tabindex="0">
      <span class="search-custom-badge">+</span>
      Add "<strong>${escapeHTML(query)}</strong>" as Custom Topic
    </div>
  `;

  const matches = searchTopics(query);
  state.currentResults = [
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
  const modal = container.closest('.search-modal');

  container.querySelector('[data-action="custom"]')?.addEventListener('click', () => {
    navigate(`#/custom/${encodeURIComponent(query)}`);
    closeModal(modal, state);
  });

  container.querySelectorAll('.search-result-item[data-slug]').forEach(el => {
    el.addEventListener('click', () => {
      navigate(`#/topic/${el.dataset.slug}`);
      closeModal(modal, state);
    });
  });

  updateHighlight(container, state);
}

function handleKeyboard(e, results, input, state, modal) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    state.highlightIndex = Math.min(state.highlightIndex + 1, state.currentResults.length - 1);
    updateHighlight(results, state);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.highlightIndex = Math.max(state.highlightIndex - 1, 0);
    updateHighlight(results, state);
  } else if (e.key === 'Enter') {
    const query = input.value.trim();
    if (!query && state.highlightIndex < 0) return;
    e.preventDefault();

    let target;
    if (state.highlightIndex >= 0 && state.currentResults[state.highlightIndex]) {
      target = state.currentResults[state.highlightIndex];
    } else {
      const firstTopicMatch = state.currentResults.find(r => r.type === 'topic');
      target = firstTopicMatch || { type: 'custom', term: query };
    }

    if (target.type === 'custom') {
      navigate(`#/custom/${encodeURIComponent(target.term)}`);
    } else {
      navigate(`#/topic/${target.slug}`);
    }
    closeModal(modal, state);
  }
}

function updateHighlight(container, state) {
  const items = container.querySelectorAll('.search-result-custom, .search-result-item[data-slug]');
  items.forEach((el, i) => {
    el.classList.toggle('highlighted', i === state.highlightIndex);
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

function attachGlobalListeners() {
  if (globalListenersAttached) return;
  globalListenersAttached = true;

  // Click outside any open modal closes it
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.search-bar-wrapper').forEach(wrapper => {
      const modal = wrapper.querySelector('.search-modal');
      if (!modal || modal.style.display !== 'block') return;
      const trigger = wrapper.querySelector('.search-bar');
      if (!modal.contains(e.target) && !trigger?.contains(e.target)) {
        modal.style.display = 'none';
      }
    });
  });

  // Escape closes all open modals
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.search-modal').forEach(modal => {
      if (modal.style.display === 'block') modal.style.display = 'none';
    });
  });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
