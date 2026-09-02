// Shared collapsible drawer used at the bottom of an AI brief — Sources and
// Explore Further on both the trend expansions and the news-story insight panel.
// Lives here rather than in either component because newsfeed and trend-expansion
// already import from each other, and a third edge would be circular.
const DRAWER_CHEV = '<svg class="te-drawer-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

// revamp1047: drawers/links carry an optional subline and render as squarer
// cards (icon chip + title over subtext), laid out two-up where space allows.
export function drawerHTML(label, bodyHTML, icon = '', sub = '') {
  return `<details class="te-drawer"><summary class="te-drawer-sum">${icon ? `<span class="te-drawer-ic" aria-hidden="true">${icon}</span>` : ''}<span class="te-drawer-tx"><span class="te-drawer-title">${esc(label)}</span>${sub ? `<span class="te-drawer-sub">${esc(sub)}</span>` : ''}</span>${DRAWER_CHEV}</summary><div class="te-drawer-body">${bodyHTML}</div></details>`;
}

// Sibling row to a drawer that ISN'T a drawer: a plain link (e.g. "Search this
// trend" → the search page), styled by the same .te-drawer-sum family.
export function drawerLinkHTML(label, href, icon = '', sub = '') {
  const ARROW = '<svg class="te-drawer-chev te-drawer-go" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';
  return `<a class="te-drawer te-drawer--link" href="${String(href).replace(/"/g, '&quot;')}"><span class="te-drawer-sum">${icon ? `<span class="te-drawer-ic" aria-hidden="true">${icon}</span>` : ''}<span class="te-drawer-tx"><span class="te-drawer-title">${esc(label)}</span>${sub ? `<span class="te-drawer-sub">${esc(sub)}</span>` : ''}</span>${ARROW}</span></a>`;
}

export const DRAWER_SEARCH_IC = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>';
export const DRAWER_SOURCES_IC = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

// <details> opens instantly, and the body grows BELOW the summary you clicked —
// so the row under your cursor never moves and there is nothing to chase. An
// earlier version anchored every open with scrollIntoView({block:'start'}),
// which threw the reader down to a seemingly random spot in the freshly opened
// list (revamp1157). Now we only nudge when the summary itself is clipped out
// of view, and only by the minimum amount: block:'nearest' is a no-op when the
// row is already fully visible, and it resolves against whatever the real
// scroll container turns out to be — window on the homepage, the panel on the
// Trending page.
export function wireDrawers(root) {
  if (!root || root.dataset.teDrawersWired === '1') return;
  root.dataset.teDrawersWired = '1';
  const EASE = 'cubic-bezier(.22,.61,.21,1)';
  // Target the summary row (small, no scroll-margin) rather than the <details>,
  // which becomes taller than the scrollport once open and would force a scroll.
  const keepInView = (el) => {
    try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
  };
  root.addEventListener('click', (e) => {
    const sum = e.target.closest('.te-drawer-sum');
    if (sum && root.contains(sum)) {
      const det = sum.closest('.te-drawer');
      const body = det && det.querySelector('.te-drawer-body');
      if (!det || !body) return;
      e.preventDefault();
      if (det.open) {
        const h = body.scrollHeight;
        body.style.overflow = 'hidden';
        body.style.height = h + 'px';
        requestAnimationFrame(() => {
          body.style.transition = `height .24s ${EASE}, opacity .16s ease`;
          body.style.height = '0px';
          body.style.opacity = '0';
        });
        setTimeout(() => { det.open = false; body.removeAttribute('style'); }, 250);
      } else {
        det.open = true;
        body.style.overflow = 'hidden';
        body.style.height = '0px';
        body.style.opacity = '0';
        const h = body.scrollHeight;
        requestAnimationFrame(() => {
          body.style.transition = `height .28s ${EASE}, opacity .22s ease`;
          body.style.height = h + 'px';
          body.style.opacity = '1';
        });
        setTimeout(() => { body.removeAttribute('style'); }, 300);
        // The body is inserted BELOW the summary, so the summary's own position
        // doesn't move. Nothing to do unless the container reflowed the row off
        // screen while growing — re-check once the animation settles.
        setTimeout(() => keepInView(sum), 320);
      }
      return;
    }
    // Nested source-category rows inside Explore Further animate natively; they
    // just need the same anchoring so the row you tapped stays put.
    const xs = e.target.closest('.xf-sum');
    if (xs && root.contains(xs)) {
      const acc = xs.closest('.xf-acc');
      if (!acc) return;
      setTimeout(() => keepInView(xs), 320);
    }
  });
}
