// Shared "How our AI works" overlay (revamp1038).
//
// One modal, reachable from every AI surface on the site — the news AI insight,
// the trending summaries, and the topic/daily briefings. A single delegated
// listener on <body> opens it, so any element carrying [data-how-it-works]
// anywhere in the app triggers it with no per-surface wiring.
//
// The content is GENERALISED: a shared pipeline up top, then one section per
// surface explaining how THAT kind of text is generated, then the same
// standing caveat. Whoever opens it — beside a headline insight, a trend
// summary, or a briefing — sees the same card.

const SPARK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg>';

// revamp1043: the text "Learn how this works" link is replaced everywhere by a
// small circled-i info icon. The AI-generated label it sits beside is itself the
// trigger now (whole label clickable, hover-highlighted), so the icon is just
// the visible affordance.
export const INFO_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.3"/><line x1="12" y1="11.4" x2="12" y2="16.4"/><line x1="12" y1="7.6" x2="12.01" y2="7.6"/></svg>';

// The info-icon affordance on its own (for labels that carry data-how-it-works
// on their container).
export function howInfoIconHTML() {
  return `<span class="how-info-ic" aria-hidden="true">${INFO_ICON}</span>`;
}

// A standalone clickable info icon (used where there is no wrapping label).
export function howItWorksIconHTML() {
  return `<button type="button" class="how-info-btn" data-how-it-works aria-label="How our AI works" title="How our AI works">${INFO_ICON}</button>`;
}

// Back-compat: some call sites still ask for the old text link. Return the icon
// button so nothing renders the old wording.
export function howItWorksLinkHTML() {
  return howItWorksIconHTML();
}

const HOW_IT_WORKS_HTML = `
  <div class="di-how-panel" role="dialog" aria-modal="true" aria-label="How our AI works">
    <button type="button" class="di-how-x" data-how-close aria-label="Close">&times;</button>
    <h2 class="di-how-title">${SPARK}<span>How our AI works</span></h2>
    <p class="di-how-lede">Three kinds of AI writing appear on this site. Each one is generated automatically, and each is written from real news articles rather than from whatever the model already knew.</p>

    <div class="di-how-surfaces">
      <section class="di-how-surface">
        <h3 class="di-how-surfacetitle">Daily briefings</h3>
        <p>One per topic, written every morning at 5am ET. It reads the last day of coverage on that topic and gives you the three things in focus plus the main stories.</p>
      </section>
      <section class="di-how-surface">
        <h3 class="di-how-surfacetitle">Story insights</h3>
        <p>Background on one specific headline: what led to it, what it means, what happens next. Written from that article plus other reporting on the same event.</p>
      </section>
      <section class="di-how-surface">
        <h3 class="di-how-surfacetitle">Trend summaries</h3>
        <p>What a spiking search is actually about and why it is moving today. Written from current articles on the subject.</p>
      </section>
    </div>

    <p class="di-how-note">In all three, the sources sit underneath so you can check them. If a section lists none, none were found. We show that rather than filling the gap.</p>

    <p class="di-how-foot"><b>It can get things wrong.</b> Check dates and figures against the linked reporting before relying on them.</p>
  </div>`;

let installed = false;
let overlay = null;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'di-how-ov';
  overlay.className = 'di-how-ov';
  overlay.innerHTML = HOW_IT_WORKS_HTML;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay || ev.target.closest('[data-how-close], [data-di-how-close]')) closeHowItWorks();
  });
  return overlay;
}

export function openHowItWorks() {
  ensureOverlay().classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

export function closeHowItWorks() {
  if (overlay) overlay.classList.remove('is-open');
  document.body.style.overflow = '';
}

// Install once. Delegated on <body> so any [data-how-it-works] (or the legacy
// [data-di-how]) opens the shared modal, whatever surface rendered it.
export function installHowItWorks() {
  if (installed) return;
  installed = true;
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-how-it-works], [data-di-how]')) {
      e.preventDefault();
      openHowItWorks();
    }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeHowItWorks(); });
}
