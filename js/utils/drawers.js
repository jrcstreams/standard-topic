// Shared collapsible drawer used at the bottom of an AI brief — Sources and
// Explore Further on both the trend expansions and the news-story insight panel.
// Lives here rather than in either component because newsfeed and trend-expansion
// already import from each other, and a third edge would be circular.
const DRAWER_CHEV = '<svg class="te-drawer-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

export function drawerHTML(label, bodyHTML) {
  return `<details class="te-drawer"><summary class="te-drawer-sum"><span class="te-drawer-title">${esc(label)}</span>${DRAWER_CHEV}</summary><div class="te-drawer-body">${bodyHTML}</div></details>`;
}

// <details> opens instantly and the browser makes no attempt to keep the header
// you clicked on screen, so opening a drawer near the bottom of a long brief
// dropped the reader into the middle of the list with no context.
//
// Anchoring is done with scrollIntoView + a CSS `scroll-margin-top` on the
// drawer (see .te-drawer / .xf-acc). That resolves correctly against whatever
// the real scroll container turns out to be — window on the homepage, the panel
// on the Trending page — which hand-rolled scrollTop math kept getting wrong.
export function wireDrawers(root) {
  if (!root || root.dataset.teDrawersWired === '1') return;
  root.dataset.teDrawersWired = '1';
  const EASE = 'cubic-bezier(.22,.61,.21,1)';
  const anchor = (el) => {
    try { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) {}
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
        // doesn't move — anchor immediately, then re-assert once it settles in
        // case the container compensated for the growth.
        anchor(det);
        setTimeout(() => anchor(det), 320);
      }
      return;
    }
    // Nested source-category rows inside Explore Further animate natively; they
    // just need the same anchoring so the row you tapped stays put.
    const xs = e.target.closest('.xf-sum');
    if (xs && root.contains(xs)) {
      const acc = xs.closest('.xf-acc');
      if (!acc) return;
      if (!acc.open) anchor(acc);
      setTimeout(() => anchor(acc), 320);
    }
  });
}
