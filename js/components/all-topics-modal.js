// All Topics modal — a centered takeover (styled like the Search modal) that
// lists every topic group as an Intelligence-style accordion. Tap a parent to
// reveal its subtopics, with a prominent "All {parent}" link at the top.

import { getTopicsGroupedByParent } from '../utils/data.js';
import { topicIconSVG } from '../utils/topic-icons.js';

let overlayEl = null;

const CHEV = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const X = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
// Warm, on-brand accent palette cycled across the topic accordions so the
// stack reads lively rather than uniform grey (mirrors the Intelligence
// section's per-group colours).
const PALETTE = ['#3261a0', '#2f8f63', '#c2772f', '#7d5bd0', '#c14d6b', '#2f8a9a', '#3a7bd0', '#b8743f'];

export function initAllTopicsModal() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'all-topics-modal-overlay';
  overlayEl.style.display = 'none';
  document.body.appendChild(overlayEl);

  window.addEventListener('open-all-topics-modal', () => open());
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlayEl.style.display !== 'none') close(); });
}

function open() {
  const groups = getTopicsGroupedByParent();
  const accordions = groups.map(({ parent, subtopics }, i) => {
    const accent = PALETTE[i % PALETTE.length];
    if (!subtopics.length) {
      return `<a href="#/topic/${parent.slug}" class="at-acc-flat" style="--ti-accent: ${accent};">
        <span class="at-acc-flat-icon">${topicIconSVG(parent.icon || 'globe', '')}</span>
        <span class="at-acc-flat-name">${escapeHTML(parent.name)}</span>
        <span class="at-acc-flat-chev">${CHEV}</span>
      </a>`;
    }
    const subs = `<a href="#/topic/${parent.slug}" class="at-sub at-sub-parent">All ${escapeHTML(parent.name)}</a>`
      + subtopics.map(s => `<a href="#/topic/${s.slug}" class="at-sub">${escapeHTML(s.name)}</a>`).join('');
    return `<details class="ti-accordion at-acc" style="--ti-accent: ${accent};">
      <summary class="ti-accordion-summary">
        <span class="ti-accordion-icon" aria-hidden="true">${topicIconSVG(parent.icon || 'globe', '')}</span>
        <span class="ti-accordion-title">${escapeHTML(parent.name)}</span>
        <span class="ti-accordion-chev" aria-hidden="true">${CHEV}</span>
      </summary>
      <div class="ti-accordion-body"><div class="at-subs">${subs}</div></div>
    </details>`;
  }).join('');

  overlayEl.innerHTML = `
    <div class="at-modal-panel" role="dialog" aria-modal="true" aria-label="All topics">
      <button type="button" class="at-modal-close" aria-label="Close">${X}</button>
      <div class="at-modal-head">
        <h2 class="at-modal-title">All Topics</h2>
        <p class="at-modal-subtext">Browse every topic and its subtopics.</p>
      </div>
      <div class="at-modal-body ti-accordions">${accordions}</div>
    </div>`;
  overlayEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  overlayEl.querySelector('.at-modal-close').addEventListener('click', close);
  // Links navigate + close; the <summary> toggles its accordion (not a link).
  overlayEl.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
}

function close() {
  overlayEl.style.display = 'none';
  overlayEl.innerHTML = '';
  document.body.style.overflow = '';
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
