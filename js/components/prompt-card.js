// The prompts card (revamp1442). One card, three levels, no accordions:
//
//   home    — the buckets a page's prompts sort into (Snapshots · Tools &
//             Trackers · Evergreen), each showing its first few prompts as
//             plain links and an "All N" way into the rest;
//   bucket  — every prompt in one bucket;
//   prompt  — the prompt itself, with the same Send-to / Direct Submit /
//             Review flow every other prompt surface uses, mounted in place.
//
// It replaces the topic rail's accordion list and the tab-mode "Prompts" tab:
// on a phone the card sits under the briefing and the reader walks INTO a
// prompt inside it rather than hopping to another view. The buckets are data
// (`bucket` on each directory entry, labels in shortcuts-assignments.json),
// so the card never decides what a prompt is.
import { renderIcon } from '../utils/icons.js';
import { renderAIIntelligence } from './ai-intelligence.js?v=20260914-revamp1340c';

const WAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>';
const CHEV_R = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const ARROW_R = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';

const ORDER = ['snapshot', 'tracker', 'evergreen'];
const FALLBACK_LABEL = { snapshot: 'Snapshots', tracker: 'Tools & Trackers', evergreen: 'Evergreen' };
const SUB = {
  snapshot: 'Where things stand right now',
  tracker: 'Follow a thread, compare, or find the best',
  evergreen: 'The same four on every topic',
};
const PEEK = 4;

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

function bucketLabels() {
  const out = { ...FALLBACK_LABEL };
  try {
    const list = (window.__assignmentsData && window.__assignmentsData.buckets) || [];
    for (const b of list) if (b && b.id && b.label) out[b.id] = b.label;
  } catch (_) {}
  return out;
}
function bucketOf(s) { return s.evergreen ? 'evergreen' : (s.bucket || 'snapshot'); }
function iconFor(s) {
  if (s.icon) {
    try { const svg = renderIcon(s.icon); if (svg && /^<svg/.test(svg)) return svg; } catch (_) {}
  }
  return WAND;
}

export function renderPromptCard(host, { topic, slug, shortcuts, subtitle } = {}) {
  const labels = bucketLabels();
  const list = (shortcuts || []).filter((s) => s && s.name && s.prompt);
  const groups = ORDER.map((id) => ({ id, label: labels[id], sub: SUB[id], items: list.filter((s) => bucketOf(s) === id) }))
    .filter((g) => g.items.length);
  const topicName = topic || '';
  let state = { view: 'home', bucket: null, prompt: null, from: 'home' };
  let ctl = null;   // the mounted prompt flow, while a prompt is open

  const rowHTML = (s, i) => `<button type="button" class="pc-row" data-pc-prompt="${esc(s.id || s.name)}">
      <span class="pc-row-ic" aria-hidden="true">${iconFor(s)}</span>
      <span class="pc-row-tx"><span class="pc-row-name">${esc(s.name)}</span>${s.description ? `<span class="pc-row-desc">${esc(s.description)}</span>` : ''}</span>
      <span class="pc-row-chev" aria-hidden="true">${CHEV_R}</span>
    </button>`;

  const headHTML = () => `<div class="pc-head">
      <span class="pc-head-ic" aria-hidden="true">${WAND}</span>
      <span class="pc-head-tx"><span class="pc-head-title">AI Prompts</span>${subtitle || topicName ? `<span class="pc-head-sub">${esc(subtitle || `Ready-made prompts on ${topicName}`)}</span>` : ''}</span>
    </div>`;

  function homeHTML() {
    if (!groups.length) return `${headHTML()}<p class="pc-empty">No prompts for this page yet.</p>`;
    return headHTML() + groups.map((g) => {
      const more = g.items.length - PEEK;
      return `<section class="pc-sec" data-pc-bucket="${g.id}">
        <div class="pc-sechead">
          <span class="pc-seclabel">${esc(g.label)}<span class="pc-seccount">${g.items.length}</span></span>
          ${more > 0 ? `<button type="button" class="pc-secall" data-pc-open="${g.id}">All ${g.items.length}${ARROW_R}</button>` : ''}
        </div>
        <div class="pc-rows">${g.items.slice(0, PEEK).map(rowHTML).join('')}</div>
      </section>`;
    }).join('');
  }
  function bucketHTML(g) {
    return `<div class="pc-nav"><button type="button" class="pc-back" data-pc-back="home">${BACK}<span>Prompts</span></button></div>
      <div class="pc-title"><span class="pc-title-tx">${esc(g.label)}</span><span class="pc-title-sub">${esc(g.sub)} · ${g.items.length}</span></div>
      <div class="pc-rows pc-rows--all">${g.items.map(rowHTML).join('')}</div>`;
  }
  function promptHTML(s, g) {
    const backTo = state.from === 'bucket' && g ? { key: 'bucket', label: g.label } : { key: 'home', label: 'Prompts' };
    return `<div class="pc-nav"><button type="button" class="pc-back" data-pc-back="${backTo.key}">${BACK}<span>${esc(backTo.label)}</span></button></div>
      <div class="pc-ptitle">
        <span class="pc-row-ic pc-ptitle-ic" aria-hidden="true">${iconFor(s)}</span>
        <span class="pc-ptitle-tx"><span class="pc-ptitle-name">${esc(s.name)}</span>${s.description ? `<span class="pc-ptitle-desc">${esc(s.description)}</span>` : ''}</span>
      </div>
      <div class="pc-phost prompts-topic-host" data-pc-phost></div>`;
  }

  function unmount() {
    if (ctl && ctl.destroy) { try { ctl.destroy(); } catch (_) {} }
    ctl = null;
  }
  function keepInView() {
    // A row far down the list swaps the card for a shorter view; make sure the
    // top of the card is on screen so the reader lands on what they opened.
    try {
      const r = host.getBoundingClientRect();
      const navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 64;
      const sub = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--subnav-height')) || 0;
      const top = navH + sub + 12;
      if (r.top < top) window.scrollTo({ top: window.scrollY + r.top - top, behavior: 'auto' });
    } catch (_) {}
  }

  function render() {
    unmount();
    const g = state.bucket ? groups.find((x) => x.id === state.bucket) : null;
    let html;
    if (state.view === 'bucket' && g) html = bucketHTML(g);
    else if (state.view === 'prompt' && state.prompt) html = promptHTML(state.prompt, g);
    else { state.view = 'home'; html = homeHTML(); }
    host.innerHTML = `<div class="pc pc--${state.view}">${html}</div>`;
    host.querySelectorAll('[data-pc-open]').forEach((b) => b.addEventListener('click', () => {
      state = { view: 'bucket', bucket: b.dataset.pcOpen, prompt: null, from: 'home' };
      render(); keepInView();
    }));
    host.querySelectorAll('[data-pc-back]').forEach((b) => b.addEventListener('click', () => {
      const to = b.dataset.pcBack;
      state = to === 'bucket' && state.bucket
        ? { view: 'bucket', bucket: state.bucket, prompt: null, from: 'home' }
        : { view: 'home', bucket: null, prompt: null, from: 'home' };
      render(); keepInView();
    }));
    host.querySelectorAll('[data-pc-prompt]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.pcPrompt;
      const s = list.find((x) => (x.id || x.name) === key);
      if (!s) return;
      state = { view: 'prompt', bucket: bucketOf(s), prompt: s, from: state.view === 'bucket' ? 'bucket' : 'home' };
      render(); keepInView();
    }));
    const phost = host.querySelector('[data-pc-phost]');
    if (phost && state.prompt) {
      const s = state.prompt;
      try {
        ctl = renderAIIntelligence(phost, {
          inModal: true, initialBuilder: true, initialGroup: 'external', lockTopic: true,
          singlePrompt: true,
          topic: topicName || 'home', label: topicName, topicKey: slug || '',
          shortcuts: [s],
          descriptions: { [s.name]: s.description || '' },
          icons: { [s.name]: s.icon || '' },
        });
      } catch (err) {
        console.error('prompt card mount failed', s.id, err);
        phost.innerHTML = '<p class="pc-empty">Couldn’t load this prompt.</p>';
      }
    }
  }

  render();
  return {
    destroy() { unmount(); host.innerHTML = ''; },
    reset() { state = { view: 'home', bucket: null, prompt: null, from: 'home' }; render(); },
  };
}
