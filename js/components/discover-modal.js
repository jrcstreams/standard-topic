// Additional Content Feeds modal — opens from the News and Resources
// card on dedicated topic / home pages. Shows the external search
// sources as full-width clickable rows.

let overlayEl = null;

export function initDiscoverModal() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'discover-modal-overlay';
  overlayEl.style.display = 'none';
  document.body.appendChild(overlayEl);

  window.addEventListener('open-discover-modal', (e) => {
    open(e.detail.query, e.detail.searches);
  });

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) { close(); return; }
    if (e.target.closest('.discover-modal-close')) { close(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') close();
  });
}

function open(query, searches) {
  const rows = searches.map(s => {
    const url = s.urlTemplate.replace(/\{query\}/g, encodeURIComponent(query));
    return `
      <a href="${url}" target="_blank" rel="noopener noreferrer" class="sidebar-shortcut discover-modal-item">
        <span class="sidebar-shortcut-icon" aria-hidden="true">${s.icon}</span>
        <span class="sidebar-shortcut-name">${escapeHTML(s.name)}</span>
        <span class="sidebar-shortcut-chev" aria-hidden="true">›</span>
      </a>
    `;
  }).join('');

  overlayEl.innerHTML = `
    <div class="discover-modal-card shortcuts-sidebar" role="dialog" aria-label="More Content Shortcuts">
      <button type="button" class="discover-modal-close" aria-label="Close">✕</button>
      <div class="sidebar-card-header">
        <h3 class="sidebar-card-title">More Content Shortcuts</h3>
      </div>
      <p class="discover-modal-sub">
        Explore <strong>${escapeHTML(query)}</strong> across the open web.
        Each link opens a pre-populated search in a new tab.
      </p>
      <div class="sidebar-shortcut-list">${rows}</div>
    </div>
  `;
  overlayEl.style.display = 'flex';
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
