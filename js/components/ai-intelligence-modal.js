// AI Intelligence modal (#13) — a branded takeover that hosts the full
// AI Intelligence flip-nav (paths → sections → brief). Opened anytime a path
// launcher is clicked on the homepage or a topic-page DESKTOP; topic-page
// MOBILE keeps AI Intelligence as an inline tab (no modal) instead.
//
//   • Home    → header carries a topic switcher (Today's World + every topic),
//               so the whole section set can be swapped without leaving.
//   • Topic   → topic is locked (shown as a chip); the flip-nav's own "Back to
//               AI Intelligence" handles switching PATHS.
//
// Participates in the global single-modal coordinator (`close-all-modals`).
import { renderAIIntelligence } from './ai-intelligence.js?v=20260612-revamp175';
import { getFeaturedTopics, getTopicBySlug, getShortcutsForTopic } from '../utils/data.js';

let overlayEl = null;
let panelEl = null;
let activeCtl = null;       // the live renderAIIntelligence controller (for destroy)
let current = null;         // { topic, label } currently shown
let mq = null;
const LOGO = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 5.5L19.5 9l-5.6 1.5L12 16l-1.9-5.5L4.5 9l5.6-1.5z"/></svg>';
const X = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function escAttr(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

export function initAIIntelligenceModal() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'takeover-overlay aii-modal-overlay';
  overlayEl.style.display = 'none';
  document.body.appendChild(overlayEl);

  panelEl = document.createElement('div');
  panelEl.className = 'takeover-panel aii-modal-panel';
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-modal', 'true');
  panelEl.setAttribute('aria-label', 'AI Intelligence');
  overlayEl.appendChild(panelEl);

  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });

  window.addEventListener('open-ai-intelligence', (e) => open(e.detail || {}));
  window.addEventListener('close-all-modals', close);

  // Desktop ⇄ mobile hand-off (#13): if the viewport drops to tab-width while
  // the modal is open for a TOPIC, close the modal and hand the current section
  // to the topic page's inline tab so the transition is seamless.
  if (window.matchMedia) {
    mq = window.matchMedia('(max-width: 899.98px)');
    mq.addEventListener('change', (ev) => {
      if (!isOpen()) return;
      if (ev.matches && current && current.topic !== 'home') {
        const group = (panelEl.querySelector('.aii-modal-body')?.firstElementChild?.dataset.aiiGroup) || '';
        close();
        // The topic page re-renders to tab-mode on the same resize; tell its AI
        // Intelligence tab which section to open once it's ready.
        if (group) requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('aii-open-section', { detail: { group } })));
      } else {
        // Home, or going back to desktop — just close so we don't strand a modal.
        close();
      }
    });
  }
}

function isOpen() { return overlayEl && overlayEl.style.display !== 'none'; }

function topicPickerHTML(activeTopic) {
  const topics = getFeaturedTopics() || [];
  const opts = [`<option value="home"${activeTopic === 'home' ? ' selected' : ''}>Today's World</option>`]
    .concat(topics.map((t) => `<option value="${escAttr(t.slug)}"${activeTopic === t.name ? ' selected' : ''}>${esc(t.name)}</option>`));
  return `<label class="aii-modal-topic">
      <span class="aii-modal-topic-lead">Topic</span>
      <span class="aii-modal-topic-wrap"><select class="aii-modal-topic-select" aria-label="Choose topic">${opts.join('')}</select>${CHEV}</span>
    </label>`;
}

// Build the scope object renderAIIntelligence expects for a given selection.
function scopeFor(topic, label, group) {
  if (topic === 'home') {
    const desc = {};
    try { (getShortcutsForTopic('home') || []).forEach((s) => { if (s && s.name) desc[s.name] = s.description || ''; }); } catch (_) {}
    return { topic: 'home', label: "today's world", descriptions: desc, hideGroups: ['topic-specific'], inModal: true, initialGroup: group };
  }
  const t = getTopicBySlug(topic) || null;       // `topic` may be a slug (picker) or a name (launcher)
  const name = t ? t.name : label || topic;
  const slug = t ? t.slug : null;
  const desc = {};
  try { if (slug) (getShortcutsForTopic(slug) || []).forEach((s) => { if (s && s.name) desc[s.name] = s.description || ''; }); } catch (_) {}
  return { topic: name, label: name, descriptions: desc, inModal: true, initialGroup: group };
}

function renderBody(scope) {
  const body = panelEl.querySelector('.aii-modal-body');
  if (!body) return;
  if (activeCtl && activeCtl.destroy) { try { activeCtl.destroy(); } catch (_) {} }
  body.innerHTML = '';
  activeCtl = renderAIIntelligence(body, scope);
}

function open(detail) {
  if (!panelEl) initAIIntelligenceModal();
  // Single-modal invariant: close anything else first (search isn't this one).
  window.dispatchEvent(new CustomEvent('close-all-modals'));

  const isHome = detail.topic === 'home';
  current = { topic: detail.topic, label: detail.label };
  const headerRight = isHome
    ? topicPickerHTML('home')
    : `<span class="aii-modal-chip">${esc(detail.label || detail.topic || '')}</span>`;

  panelEl.innerHTML = `
    <div class="aii-modal-head">
      <div class="aii-modal-head-id"><span class="aii-modal-logo">${LOGO}</span><h2 class="aii-modal-title">AI Intelligence</h2></div>
      <div class="aii-modal-head-right">${headerRight}</div>
      <button type="button" class="aii-modal-close" aria-label="Close">${X}</button>
    </div>
    <div class="aii-modal-body"></div>`;

  panelEl.querySelector('.aii-modal-close').addEventListener('click', close);

  // Home: the topic picker swaps the whole section set in place.
  const sel = panelEl.querySelector('.aii-modal-topic-select');
  if (sel) sel.addEventListener('change', () => {
    const v = sel.value;
    current = { topic: v === 'home' ? 'home' : (getTopicBySlug(v)?.name || v) };
    renderBody(scopeFor(v, null, null));
  });

  renderBody(scopeFor(detail.topic, detail.label, detail.group));

  overlayEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  panelEl.classList.remove('is-in'); void panelEl.offsetWidth; panelEl.classList.add('is-in');
}

function close() {
  if (!isOpen()) return;
  if (activeCtl && activeCtl.destroy) { try { activeCtl.destroy(); } catch (_) {} activeCtl = null; }
  overlayEl.style.display = 'none';
  panelEl.classList.remove('is-in');
  panelEl.innerHTML = '';
  current = null;
  document.body.style.overflow = '';
}
