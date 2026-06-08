// Global "Trending Now" modal — opened from the main-nav Trending pill so
// users can reach trending content from any page. Reuses renderTrending()
// (the same card the homepage sidebar/tab use): title, "via Google Trends ·
// Updated" meta, and the fade-scrolled list whose rows open the trending
// detail modal. Sits BELOW the detail modal (z 150) so a clicked term
// stacks its detail view on top.
import { renderTrending } from './trending.js?v=20260608-revamp23';

let overlayEl = null;
let panelEl = null;

export function initTrendingListModal() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'tlm-overlay';
  overlayEl.style.display = 'none';
  document.body.appendChild(overlayEl);

  panelEl = document.createElement('div');
  panelEl.className = 'tlm-panel';
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-modal', 'true');
  panelEl.setAttribute('aria-label', 'Trending now');
  panelEl.style.display = 'none';
  document.body.appendChild(panelEl);

  window.addEventListener('open-trending-list', open);
  // The detail modal fires this when its ✕/Esc fully closes after being
  // opened from here, so the whole stack dismisses together.
  window.addEventListener('close-trending-list', close);
  overlayEl.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') close();
  });
}

function open() {
  panelEl.innerHTML = `
    <button type="button" class="tlm-close" id="tlm-close" aria-label="Close">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>
    </button>
    <div class="tlm-head">
      <h2 class="tlm-title">Trending</h2>
      <p class="tlm-subtext">Trending search terms from Google Trends.</p>
    </div>
    <div class="tlm-body" id="tlm-body"></div>`;
  panelEl.querySelector('#tlm-close').addEventListener('click', close);
  // renderTrending fetches + renders the card and wires row → open-trending-detail.
  renderTrending(panelEl.querySelector('#tlm-body'));

  overlayEl.style.display = 'block';
  panelEl.style.display = 'flex';
  panelEl.classList.remove('is-in'); void panelEl.offsetWidth; panelEl.classList.add('is-in');
  document.body.style.overflow = 'hidden';
}

function close() {
  overlayEl.style.display = 'none';
  panelEl.style.display = 'none';
  panelEl.classList.remove('is-in');
  panelEl.innerHTML = '';
  document.body.style.overflow = '';
}
