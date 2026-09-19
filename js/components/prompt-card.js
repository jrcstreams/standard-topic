// The prompts card (revamp1442, reshaped in 1443). One card, three levels, no
// accordions:
//
//   home    — the buckets a page's prompts sort into (Snapshots · Tools &
//             Trackers · Evergreen), each under a labelled, icon'd head with
//             its prompts as plain text links and an "All N" into the rest;
//   bucket  — every prompt in one bucket;
//   prompt  — the prompt itself, with the same Send-to / Direct Submit /
//             Review flow every other prompt surface uses, mounted in place.
//
// revamp1443: the rows are TEXT LINKS. No per-prompt icon, no one-line
// summary — the bucket head carries the icon and the name carries the
// meaning, so a bucket of twelve reads as a list, not a stack of cards. The
// description shows once you open a prompt, where it is context rather than
// clutter.
//
// Options:
//   peek      rows shown per bucket on the home level (default 4; Infinity
//             for a directory that should show everything)
//   head      render the card's own "AI Prompts" head (default true)
//   flat      one unlabelled list instead of buckets (the Featured rail)
//   topicTag  show each prompt's `_topic` name beside it (a cross-topic list)
import { renderAIIntelligence } from './ai-intelligence.js?v=20260914-revamp1340c';

const WAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const ARROW_R = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';
// The bucket marks: a snapshot is a frame, a tracker is a pulse, evergreen is
// a leaf. One per head; the rows under it carry none.
const BUCKET_ICON = {
  snapshot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.2"/></svg>',
  tracker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 12 7 12 10 5 14 19 17 12 21 12"/></svg>',
  evergreen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z"/><path d="M2 21c0-3 1.9-5.5 5-6.5"/></svg>',
};

const ORDER = ['snapshot', 'tracker', 'evergreen'];
const FALLBACK_LABEL = { snapshot: 'Snapshots', tracker: 'Tools & Trackers', evergreen: 'Evergreen' };
const SUB = {
  snapshot: 'Where things stand right now',
  tracker: 'Follow a thread, compare, or find the best',
  evergreen: 'The same four on every topic',
};

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

export function renderPromptCard(host, { topic, slug, shortcuts, subtitle, peek = 4, head = true, flat = false, topicTag = false } = {}) {
  const labels = bucketLabels();
  const list = (shortcuts || []).filter((s) => s && s.name && s.prompt);
  const groups = flat
    ? [{ id: 'all', label: '', sub: '', items: list }]
    : ORDER.map((id) => ({ id, label: labels[id], sub: SUB[id], items: list.filter((s) => bucketOf(s) === id) })).filter((g) => g.items.length);
  const topicName = topic || '';
  let state = { view: 'home', bucket: null, prompt: null, from: 'home' };
  let ctl = null;   // the mounted prompt flow, while a prompt is open

  const rowHTML = (s) => `<button type="button" class="pc-link" data-pc-prompt="${esc(s.id || s.name)}">
      <span class="pc-link-name">${esc(s.name)}</span>${topicTag && s._topic ? `<span class="pc-link-topic">${esc(s._topic)}</span>` : ''}
    </button>`;

  const headHTML = () => (head ? `<div class="pc-head">
      <span class="pc-head-ic" aria-hidden="true">${WAND}</span>
      <span class="pc-head-tx"><span class="pc-head-title">AI Prompts</span>${subtitle || topicName ? `<span class="pc-head-sub">${esc(subtitle || `Ready-made prompts on ${topicName}`)}</span>` : ''}</span>
    </div>` : '');

  function homeHTML() {
    if (!groups.length) return `${headHTML()}<p class="pc-empty">No prompts for this page yet.</p>`;
    return headHTML() + groups.map((g) => {
      const more = g.items.length - peek;
      const secHead = flat ? '' : `<div class="pc-sechead">
          <span class="pc-seclabel"><span class="pc-sec-ic" aria-hidden="true">${BUCKET_ICON[g.id] || WAND}</span>${esc(g.label)}<span class="pc-seccount">${g.items.length}</span></span>
          ${more > 0 ? `<button type="button" class="pc-secall" data-pc-open="${g.id}">All ${g.items.length}${ARROW_R}</button>` : ''}
        </div>`;
      return `<section class="pc-sec${flat ? ' pc-sec--flat' : ''}" data-pc-bucket="${g.id}">${secHead}
        <div class="pc-links">${g.items.slice(0, peek).map(rowHTML).join('')}</div>
      </section>`;
    }).join('');
  }
  function bucketHTML(g) {
    return `<div class="pc-nav"><button type="button" class="pc-back" data-pc-back="home">${BACK}<span>Prompts</span></button></div>
      <div class="pc-title"><span class="pc-title-tx"><span class="pc-sec-ic pc-sec-ic--title" aria-hidden="true">${BUCKET_ICON[g.id] || WAND}</span>${esc(g.label)}</span><span class="pc-title-sub">${esc(g.sub)} · ${g.items.length}</span></div>
      <div class="pc-links pc-links--all">${g.items.map(rowHTML).join('')}</div>`;
  }
  function promptHTML(s, g) {
    const backTo = state.from === 'bucket' && g && !flat ? { key: 'bucket', label: g.label } : { key: 'home', label: 'Prompts' };
    return `<div class="pc-nav"><button type="button" class="pc-back" data-pc-back="${backTo.key}">${BACK}<span>${esc(backTo.label)}</span></button></div>
      <div class="pc-ptitle">
        <span class="pc-ptitle-tx"><span class="pc-ptitle-name">${esc(s.name)}${topicTag && s._topic ? `<span class="pc-link-topic">${esc(s._topic)}</span>` : ''}</span>${s.description ? `<span class="pc-ptitle-desc">${esc(s.description)}</span>` : ''}</span>
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
    host.innerHTML = `<div class="pc pc--${state.view}${flat ? ' pc--flat' : ''}">${html}</div>`;
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
      state = { view: 'prompt', bucket: flat ? 'all' : bucketOf(s), prompt: s, from: state.view === 'bucket' ? 'bucket' : 'home' };
      render(); keepInView();
    }));
    const phost = host.querySelector('[data-pc-phost]');
    if (phost && state.prompt) {
      const s = state.prompt;
      try {
        ctl = renderAIIntelligence(phost, {
          inModal: true, initialBuilder: true, initialGroup: 'external', lockTopic: true,
          singlePrompt: true,
          topic: s._topic || topicName || 'home', label: s._topic || topicName, topicKey: slug || '',
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
