let overlayEl = null;

export function initRelatedTopicsModal() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'related-topics-modal-overlay';
  overlayEl.style.display = 'none';
  document.body.appendChild(overlayEl);

  window.addEventListener('open-related-topics-modal', (e) => {
    open(e.detail.topics, e.detail.title);
  });

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') close();
  });
}

function open(topics, title) {
  const rows = topics.map(t => `
    <a href="#/topic/${t.slug}" class="related-modal-row">
      <span class="related-modal-dot" aria-hidden="true"></span>
      <span class="related-modal-name">${escapeHTML(t.name)}</span>
      <span class="related-modal-chev" aria-hidden="true">›</span>
    </a>
  `).join('');

  overlayEl.innerHTML = `
    <div class="related-modal-card" role="dialog" aria-label="${escapeHTML(title)}">
      <button type="button" class="related-modal-close" aria-label="Close">✕</button>
      <div class="related-modal-header">
        <span class="related-modal-icon">🔗</span>
        <h3 class="related-modal-title">${escapeHTML(title)}</h3>
      </div>
      <div class="related-modal-body">${rows}</div>
      <div class="related-modal-footer">
        <a href="#" class="related-modal-all" id="related-modal-all-topics">View All Topics +</a>
      </div>
    </div>
  `;

  overlayEl.style.display = 'flex';

  overlayEl.querySelector('.related-modal-close').addEventListener('click', close);

  overlayEl.querySelectorAll('.related-modal-row').forEach(row => {
    row.addEventListener('click', () => close());
  });

  overlayEl.querySelector('#related-modal-all-topics').addEventListener('click', (e) => {
    e.preventDefault();
    close();
    const searchBar = document.querySelector('.search-bar');
    if (searchBar) searchBar.click();
  });
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
