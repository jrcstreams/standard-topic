// All Topics modal — opens from the Featured Topics card on the
// homepage. Shows every topic grouped by parent.

import { getTopicsGroupedByParent } from '../utils/data.js';

let overlayEl = null;

export function initAllTopicsModal() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'all-topics-modal-overlay';
  overlayEl.style.display = 'none';
  document.body.appendChild(overlayEl);

  window.addEventListener('open-all-topics-modal', () => open());

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') close();
  });
}

function open() {
  const groups = getTopicsGroupedByParent();
  const groupsHTML = groups.map(({ parent, subtopics }) => `
    <div class="all-topics-modal-group">
      <a href="#/topic/${parent.slug}" class="all-topics-modal-parent sidebar-shortcut">
        <span class="all-topics-modal-parent-icon">📂</span>
        <span class="sidebar-shortcut-name">${escapeHTML(parent.name)}</span>
        <span class="sidebar-shortcut-chev" aria-hidden="true">›</span>
      </a>
      ${subtopics.length ? `
        <div class="all-topics-modal-subs">
          ${subtopics.map(s => `
            <a href="#/topic/${s.slug}" class="sidebar-shortcut all-topics-modal-sub">
              <span class="sidebar-shortcut-dot" aria-hidden="true"></span>
              <span class="sidebar-shortcut-name">${escapeHTML(s.name)}</span>
              <span class="sidebar-shortcut-chev" aria-hidden="true">›</span>
            </a>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `).join('');

  overlayEl.innerHTML = `
    <div class="all-topics-modal-card shortcuts-sidebar" role="dialog" aria-label="All topics">
      <button type="button" class="all-topics-modal-close" aria-label="Close">✕</button>
      <div class="sidebar-card-header">
        <span class="sidebar-card-icon">🌐</span>
        <h3 class="sidebar-card-title">All Topics</h3>
      </div>
      <div class="all-topics-modal-body">${groupsHTML}</div>
    </div>
  `;
  overlayEl.style.display = 'flex';
  overlayEl.querySelector('.all-topics-modal-close').addEventListener('click', close);
  overlayEl.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
}

function close() {
  overlayEl.style.display = 'none';
  overlayEl.innerHTML = '';
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
