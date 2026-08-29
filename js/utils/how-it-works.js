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
    <p class="di-how-lede">Short version: we don't type a topic into a chatbot and paste back whatever it says. Every AI line here is built from real, current reporting, runs through a structured process, and keeps its sources attached.</p>

    <ol class="di-how-steps">
      <li><b>It starts with real reporting.</b> We pull live articles from ~100 publishers, refreshed all day. The model only ever works from real, dated headlines — never a blank page or its own memory.</li>
      <li><b>The questions are engineered, not vague.</b> We never say "summarize this topic." Each surface runs a specific, structured prompt — the big picture, what changed, why it matters — so you get consistent, useful answers instead of rambling.</li>
      <li><b>It checks itself against live search.</b> Generation runs <i>grounded</i>: the model can query Google Search mid-write to verify a claim or catch something breaking before it commits it to the page.</li>
      <li><b>Every claim keeps its receipts.</b> Whatever the model actually consulted is stored and shown as sources under each section. If a section cites nothing, it found nothing — we don't hide sources.</li>
    </ol>

    <div class="di-how-surfaces">
      <section class="di-how-surface">
        <h3 class="di-how-surfacetitle">Topic &amp; daily briefings</h3>
        <p>Written once a day on a fixed schedule (7pm ET) so everyone sees the same edition. Each pulls that topic's recent headlines plus live search, then writes the big picture, the things to know, and what matters today.</p>
      </section>
      <section class="di-how-surface">
        <h3 class="di-how-surfacetitle">News AI insights</h3>
        <p>Generated the first time you open a story, then cached. It reads the article and related coverage and adds context — background, why it matters, what to watch — instead of just restating the headline.</p>
      </section>
      <section class="di-how-surface">
        <h3 class="di-how-surfacetitle">Trend summaries</h3>
        <p>Generated on demand and cached. Explains what a spiking search actually is and why it's moving right now — grounded in live search, so even a brand-new trend gets a real, sourced explanation.</p>
      </section>
    </div>

    <p class="di-how-foot">It's still AI, and it can be wrong or out of date. Treat it as a fast, sourced orientation — and click through to the reporting for anything that matters.</p>
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
