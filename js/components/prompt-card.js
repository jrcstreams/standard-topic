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
import { renderAIIntelligence } from './ai-intelligence.js?v=20260914-revamp1340c';

const SPARK = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.5 3l1.55 4.4a2 2 0 0 0 1.25 1.25L17.7 10.2l-4.4 1.55a2 2 0 0 0-1.25 1.25L10.5 17.4l-1.55-4.4a2 2 0 0 0-1.25-1.25L3.3 10.2l4.4-1.55a2 2 0 0 0 1.25-1.25z"/><path d="M17.8 14.6l.75 2.15 2.15.75-2.15.75-.75 2.15-.75-2.15-2.15-.75 2.15-.75z"/></svg>';
const CHEV_R = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';
const CHEV_D = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const ARROW_R = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';
const BUCKET_ICON = {
  snapshot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.2"/></svg>',
  tracker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>',
  evergreen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z"/><path d="M2 21c0-3 1.9-5.5 5-6.5"/></svg>',
};

const ORDER = ['snapshot', 'tracker', 'evergreen'];
const FALLBACK_LABEL = { snapshot: 'Snapshots', tracker: 'Tools & Trackers', evergreen: 'Evergreen' };
const SUB = {
  snapshot: 'Quick overviews of what’s happening now.',
  tracker: 'Helpful tools, comparisons and lists.',
  evergreen: 'Timeless prompts for deeper exploration.',
};
const NARROW = () => { try { return window.matchMedia('(max-width: 899.98px)').matches; } catch (_) { return false; } };

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function bucketLabels() {
  const out = { ...FALLBACK_LABEL };
  try { for (const b of ((window.__assignmentsData && window.__assignmentsData.buckets) || [])) if (b && b.id && b.label) out[b.id] = b.label; } catch (_) {}
  return out;
}
function bucketOf(s) { return s.evergreen ? 'evergreen' : (s.bucket || 'snapshot'); }

export function renderPromptCard(host, { topic, slug, shortcuts, subtitle, head = true, flat = false, topicTag = false, openAll = false } = {}) {
  const labels = bucketLabels();
  const list = (shortcuts || []).filter((s) => s && s.name && s.prompt);
  const groups = flat
    ? [{ id: 'all', label: '', sub: '', items: list }]
    : ORDER.map((id) => ({ id, label: labels[id], sub: SUB[id], items: list.filter((s) => bucketOf(s) === id) })).filter((g) => g.items.length);
  const topicName = topic || '';
  let ctl = null; let openKey = null;
  const openSecs = new Set(openAll || flat || !NARROW() ? groups.map((g) => g.id) : []);

  const rowHTML = (s) => `<div class="pc-item" data-pc-item="${esc(s.id || s.name)}">
      <button type="button" class="pc-row" data-pc-prompt="${esc(s.id || s.name)}" aria-expanded="false">
        <span class="pc-row-tx"><span class="pc-row-name">${esc(s.name)}${topicTag && s._topic ? `<span class="pc-row-topic">${esc(s._topic)}</span>` : ''}</span>${s.description ? `<span class="pc-row-desc">${esc(s.description)}</span>` : ''}</span>
        <span class="pc-row-chev" aria-hidden="true">${CHEV_R}</span>
      </button>
      <div class="pc-item-host prompts-topic-host" data-pc-host hidden></div>
    </div>`;

  const headHTML = () => (head ? `<div class="pc-head">
      <div class="pc-head-row"><span class="pc-head-ic" aria-hidden="true">${SPARK}</span><span class="pc-head-title">AI Prompts</span></div>
      <p class="pc-head-lead">${esc(subtitle || (topicName ? `Explore ${topicName} with AI` : 'Explore today’s news with AI'))}</p>
      <p class="pc-head-sub">Use curated prompts to get deeper insights, find ideas, and explore new angles.</p>
    </div>` : '');

  const secHTML = (g) => {
    if (flat) return `<div class="pc-sec pc-sec--flat" data-pc-bucket="all"><div class="pc-links">${g.items.map(rowHTML).join('')}</div></div>`;
    const open = openSecs.has(g.id);
    return `<section class="pc-sec${open ? ' is-open' : ''}" data-pc-bucket="${g.id}">
      <button type="button" class="pc-sechead" data-pc-sec="${g.id}" aria-expanded="${open}">
        <span class="pc-sec-ic" aria-hidden="true">${BUCKET_ICON[g.id] || SPARK}</span>
        <span class="pc-sec-tx"><span class="pc-seclabel">${esc(g.label)}</span><span class="pc-secsub">${esc(g.sub)}</span></span>
        <span class="pc-seccount">${g.items.length}</span>
        <span class="pc-sec-chev" aria-hidden="true">${CHEV_D}</span>
      </button>
      <div class="pc-links"${open ? '' : ' hidden'}>${g.items.map(rowHTML).join('')}</div>
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
    host.querySelectorAll('[data-pc-sec]').forEach((b) => b.addEventListener('click', () => {
      const sec = b.closest('.pc-sec'); const links = sec.querySelector('.pc-links'); const open = links.hidden;
      links.hidden = !open; sec.classList.toggle('is-open', open); b.setAttribute('aria-expanded', String(open));
      if (open) openSecs.add(sec.dataset.pcBucket); else { openSecs.delete(sec.dataset.pcBucket); if (sec.querySelector('.pc-item.is-open')) closeOpen(); }
    }));
    host.querySelectorAll('[data-pc-prompt]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.pcPrompt; const s = list.find((x) => (x.id || x.name) === key); if (!s) return;
      const item = b.closest('.pc-item');
      if (item.classList.contains('is-open')) { closeOpen(); return; }
      openPrompt(item, s);
    }));
  }

  render();
  return { destroy() { unmount(); host.innerHTML = ''; }, reset() { render(); } };
}
