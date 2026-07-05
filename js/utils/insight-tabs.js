// Shared 3-tab "insight" shell — Summary / Explore Further / Sources — used by the
// trending expansion, the news-story AI Insights dropdown, and the topic-page AI
// Insights (Catch Up / Deep Dive / 101 Info). Loads into the first tab; the others
// swap in on click (content is already rendered, just shown/hidden).

function escHTML(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

// tabs: [{ key, label, html, count? }] — hidden/empty tabs should be filtered by
// the caller. The first tab is active by default.
export function insightTabsHTML(tabs, extraClass = '') {
  const list = (tabs || []).filter(Boolean);
  const nav = list.map((t, i) =>
    `<button type="button" class="ins-tab${i === 0 ? ' is-active' : ''}" role="tab" aria-selected="${i === 0 ? 'true' : 'false'}" data-ins-tab="${escHTML(t.key)}">${escHTML(t.label)}${t.count != null ? `<span class="ins-tab-count">${escHTML(String(t.count))}</span>` : ''}</button>`
  ).join('');
  const panels = list.map((t, i) =>
    `<div class="ins-tabpanel" role="tabpanel" data-ins-panel="${escHTML(t.key)}"${i === 0 ? '' : ' hidden'}>${t.html || ''}</div>`
  ).join('');
  return `<div class="ins-tabs ${extraClass}"><div class="ins-tabnav" role="tablist">${nav}</div>${panels}</div>`;
}

// Wire tab switching for one .ins-tabs block. Idempotent-ish: attaches a single
// delegated listener to the nav. `onShow(key, panelEl)` fires after each switch.
export function wireInsightTabs(root, onShow) {
  const wrap = root.matches?.('.ins-tabs') ? root : root.querySelector('.ins-tabs');
  if (!wrap) return;
  const nav = wrap.querySelector('.ins-tabnav');
  if (!nav || nav.dataset.wired === '1') return;
  nav.dataset.wired = '1';
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ins-tab]');
    if (!btn) return;
    e.stopPropagation();
    const key = btn.dataset.insTab;
    nav.querySelectorAll('.ins-tab').forEach((b) => {
      const on = b.dataset.insTab === key;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    let shown = null;
    wrap.querySelectorAll(':scope > .ins-tabpanel').forEach((p) => {
      const on = p.dataset.insPanel === key;
      p.hidden = !on;
      if (on) shown = p;
    });
    if (typeof onShow === 'function') onShow(key, shown);
  });
}
