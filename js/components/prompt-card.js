// The prompts card (revamp1442 → reshaped 1451).
//
// One card that names itself — a sparkle tile, "AI Prompts", "Explore {Topic}
// with AI" and a line on what the prompts do — holding three SECTIONS, each
// its own small card: Snapshots, Tools & Trackers, Evergreen. A section has
// an icon tile, its label, a line on what it holds, and a chevron that folds
// it. Inside, every prompt is a row — name and subtext, a chevron — and
// tapping a row opens the prompt panel (Edit / Model / Copy / Settings / Run)
// right under it, in place; the list stays. On a phone the sections open
// folded and expand to their full list — never a peek.
//
// The buckets are data (`bucket` on each directory entry, labels in
// shortcuts-assignments.json); the card decides nothing about what a prompt is.
//
// Options:
//   head       the card's own head (default true)
//   flat       one unlabelled list (the Featured rail)
//   topicTag   show each prompt's `_topic` beside it (a cross-topic list)
//   openAll    sections open regardless of width (the Prompts page directory)
//   collapsed  sections folded at every width (the homepage)
//   peek       on the wide layout, show this many rows of Snapshots and Tools &
//              Trackers with a "View all N" under them (topic pages: 3);
//              Evergreen always shows all four
import { renderAIIntelligence } from './ai-intelligence.js?v=20260914-revamp1340c';

const SPARK = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.5 3l1.55 4.4a2 2 0 0 0 1.25 1.25L17.7 10.2l-4.4 1.55a2 2 0 0 0-1.25 1.25L10.5 17.4l-1.55-4.4a2 2 0 0 0-1.25-1.25L3.3 10.2l4.4-1.55a2 2 0 0 0 1.25-1.25z"/><path d="M17.8 14.6l.75 2.15 2.15.75-2.15.75-.75 2.15-.75-2.15-2.15-.75 2.15-.75z"/></svg>';
const CHEV_R = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';
const CHEV_D = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const ARROW_R = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';
// revamp1489: one glyph per KIND of prompt, each in its own colour (set in
// CSS, not from the page's topic tint). A camera for the day's snapshots, a
// dial for the things you track, a leaf for what keeps.
// revamp1490: filled glyphs, standing on their own — a camera for the day's
// snapshots, a tool for the things you track, a leaf for what keeps. No tile
// behind them; the colour is the mark.
const BUCKET_ICON = {
  snapshot: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.4 3.6a2 2 0 0 0-1.66.89L7.05 5.5H4.6A2.6 2.6 0 0 0 2 8.1v9.3a2.6 2.6 0 0 0 2.6 2.6h14.8a2.6 2.6 0 0 0 2.6-2.6V8.1a2.6 2.6 0 0 0-2.6-2.6h-2.45l-.69-1.01a2 2 0 0 0-1.66-.89zM12 16.9a4.2 4.2 0 1 1 0-8.4 4.2 4.2 0 0 1 0 8.4zm0-1.9a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z"/></svg>',
  tracker: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.9 4.6a.9.9 0 0 0-1.46-.28l-2.5 2.5-1.76-1.76 2.5-2.5A.9.9 0 0 0 17.4 1.1a5.6 5.6 0 0 0-6.6 7.2L3.2 15.9a2.9 2.9 0 0 0 4.1 4.1l7.6-7.6a5.6 5.6 0 0 0 6-7.8zM6.1 18.8a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z"/></svg>',
  evergreen: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.4 1.9c-2.1 2.4-3.7 2.8-9.1 3.9A7.9 7.9 0 0 0 9.5 20.4c.5-3.6 2.3-6.7 5.4-9.1a.8.8 0 0 1 1 1.26c-2.8 2.2-4.4 5-4.8 8.35A8 8 0 0 0 22 10.3c0-4-1.1-6.3-1.6-8.4z"/><path d="M2.8 21.8a.9.9 0 0 1-.9-.9c0-3.4 2.1-6.2 5.6-7.4a.9.9 0 0 1 .58 1.7c-2.8 1-4.38 3.06-4.38 5.7a.9.9 0 0 1-.9.9z"/></svg>',
};

const ORDER = ['snapshot', 'tracker', 'evergreen'];
const FALLBACK_LABEL = { snapshot: 'Snapshots', tracker: 'Tracking', evergreen: 'Evergreen' };
// revamp1480: only Snapshots carries a line of explanation. Three blurbs in a
// column of three headers is a paragraph nobody reads; one, on the section a
// newcomer meets first, is a hint.
// revamp1481: no section carries a blurb. One did, which made its header two
// lines tall beside two that were one — the uneven thing on the card was the
// explanation, not the list.
const SUB = { snapshot: '', tracker: '', evergreen: '' };
// "Stacked" is the page's call, not the viewport's: the topic page goes
// single-column (body.tt-on) on CONTENT width, so a docked sidebar stacks
// the page at viewports the media query still calls wide. Either signal
// means folded.
const NARROW = () => { try { return document.body.classList.contains('tt-on') || window.matchMedia('(max-width: 899.98px)').matches; } catch (_) { return false; } };

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function bucketLabels() {
  const out = { ...FALLBACK_LABEL };
  try { for (const b of ((window.__assignmentsData && window.__assignmentsData.buckets) || [])) if (b && b.id && b.label) out[b.id] = b.label; } catch (_) {}
  return out;
}
function bucketOf(s) { return s.evergreen ? 'evergreen' : (s.bucket || 'snapshot'); }

export function renderPromptCard(host, { topic, slug, shortcuts, subtitle, head = true, flat = false, topicTag = false, openAll = false, collapsed = false, peek = 0 } = {}) {
  const labels = bucketLabels();
  const list = (shortcuts || []).filter((s) => s && s.name && s.prompt);
  const groups = flat
    ? [{ id: 'all', label: '', sub: '', items: list }]
    : ORDER.map((id) => ({ id, label: labels[id], sub: SUB[id], items: list.filter((s) => bucketOf(s) === id) })).filter((g) => g.items.length);
  const topicName = topic || '';
  let ctl = null; let openKey = null;
  const defaultOpen = () => new Set((flat || openAll || (!collapsed && !NARROW())) ? groups.map((g) => g.id) : []);
  let openSecs = defaultOpen();
  const expanded = new Set();   // sections whose "View all" was pressed

  const rowHTML = (s) => `<div class="pc-item" data-pc-item="${esc(s.id || s.name)}">
      <button type="button" class="pc-row" data-pc-prompt="${esc(s.id || s.name)}" aria-expanded="false">
        <span class="pc-row-tx"><span class="pc-row-name">${esc(s.name)}${topicTag && s._topic ? `<span class="pc-row-topic">${esc(s._topic)}</span>` : ''}</span></span>
        <span class="pc-row-chev" aria-hidden="true">${CHEV_R}</span>
      </button>
      <div class="pc-item-host prompts-topic-host" data-pc-host hidden></div>
    </div>`;

  // revamp1480: the head is the name. "Explore {Topic} with AI" restated the
  // page you were already on, and the sentence under it explained a list that
  // explains itself.
  const headHTML = () => (head ? `<div class="pc-head">
      <div class="pc-head-row"><span class="pc-head-ic" aria-hidden="true">${SPARK}</span><span class="pc-head-title">AI Prompts</span></div>
    </div>` : '');
  void subtitle;

  // revamp1486: the sections are not accordions any more. Three folds in a
  // column of three is a menu of menus — every one had to be opened before
  // the card said anything. They stand open; the HEADER does the work of
  // telling you which list you are reading, which matters most when two
  // sections are both showing a partial list under a "View all".
  const secHTML = (g) => {
    if (flat) return `<div class="pc-sec pc-sec--flat" data-pc-bucket="all"><div class="pc-links">${g.items.map(rowHTML).join('')}</div></div>`;
    const cap = peek > 0 ? peek : (collapsed ? 4 : 0);
    const peeking = cap > 0 && g.id !== 'evergreen' && g.items.length > cap && !expanded.has(g.id);
    const rows = peeking ? g.items.slice(0, cap) : g.items;
    const more = peeking ? `<button type="button" class="pc-more" data-pc-more="${g.id}"><span class="pc-more-ic" aria-hidden="true">+</span><span>View more</span></button>` : '';
    return `<section class="pc-sec is-open is-static" data-pc-bucket="${g.id}">
      <div class="pc-sechead pc-sechead--static">
        <span class="pc-sec-ic" aria-hidden="true">${BUCKET_ICON[g.id] || SPARK}</span>
        <span class="pc-sec-tx"><span class="pc-seclabel">${esc(g.label)}</span>${g.sub ? `<span class="pc-secsub">${esc(g.sub)}</span>` : ''}</span>
      </div>
      <div class="pc-links">${rows.map(rowHTML).join('')}${more}</div>
    </section>`;
  };

  function unmount() { if (ctl && ctl.destroy) { try { ctl.destroy(); } catch (_) {} } ctl = null; openKey = null; }
  function closeOpen() {
    const cur = host.querySelector('.pc-item.is-open');
    if (cur) { cur.classList.remove('is-open'); const h = cur.querySelector('[data-pc-host]'); h.hidden = true; h.innerHTML = ''; cur.querySelector('.pc-row').setAttribute('aria-expanded', 'false'); }
    unmount();
  }
  function openPrompt(item, s) {
    closeOpen();
    item.classList.add('is-open'); item.querySelector('.pc-row').setAttribute('aria-expanded', 'true');
    const h = item.querySelector('[data-pc-host]'); h.hidden = false; openKey = s.id || s.name;
    try {
      ctl = renderAIIntelligence(h, {
        inModal: true, initialBuilder: true, initialGroup: 'external', lockTopic: true, singlePrompt: true,
        topic: s._topic || topicName || 'home', label: s._topic || topicName, topicKey: slug || '',
        shortcuts: [s], descriptions: { [s.name]: s.description || '' }, icons: { [s.name]: s.icon || '' },
      });
    } catch (err) { console.error('prompt card mount failed', s.id, err); h.innerHTML = '<p class="pc-empty">Couldn’t load this prompt.</p>'; }
    try { const r = item.getBoundingClientRect(); const navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 64; const sub = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--subnav-height')) || 0; const top = navH + sub + 12; if (r.top < top) window.scrollTo({ top: window.scrollY + r.top - top }); } catch (_) {}
  }

  function render() {
    unmount();
    host.innerHTML = `<div class="pc pc--v2${flat ? ' pc--flat' : ''}${head ? '' : ' pc--nohead'}">${headHTML()}${groups.length ? groups.map(secHTML).join('') : '<p class="pc-empty">No prompts for this page yet.</p>'}</div>`;
    host.querySelectorAll('[data-pc-more]').forEach((b) => b.addEventListener('click', () => { expanded.add(b.dataset.pcMore); render(); }));
    host.querySelectorAll('[data-pc-prompt]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.pcPrompt; const s = list.find((x) => (x.id || x.name) === key); if (!s) return;
      const item = b.closest('.pc-item');
      if (item.classList.contains('is-open')) { closeOpen(); return; }
      openPrompt(item, s);
    }));
  }

  render();
  // The layout crossing 900px changes what "open by default" means; the card
  // re-renders to the new default (a rendered-wide card carried its open
  // sections into the stacked layout otherwise).
  let mq = null; let mo = null; let wasNarrow = NARROW();
  function onCross() {
    if (!host.isConnected) { try { mq && mq.removeEventListener('change', onCross); mo && mo.disconnect(); } catch (_) {} return; }
    const now = NARROW(); if (now === wasNarrow) return; wasNarrow = now;
    openSecs = defaultOpen(); expanded.clear(); render();
  }
  try { mq = window.matchMedia('(max-width: 899.98px)'); mq.addEventListener('change', onCross); } catch (_) {}
  try { mo = new MutationObserver(onCross); mo.observe(document.body, { attributes: true, attributeFilter: ['class'] }); } catch (_) {}
  return { destroy() { unmount(); try { mq && mq.removeEventListener('change', onCross); mo && mo.disconnect(); } catch (_) {} host.innerHTML = ''; }, reset() { openSecs = defaultOpen(); expanded.clear(); render(); } };
}
