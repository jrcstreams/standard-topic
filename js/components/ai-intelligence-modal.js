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
import { renderAIIntelligence } from './ai-intelligence.js?v=20260614-revamp191';
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
  panelEl.setAttribute('aria-label', 'AI Insights');
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

// Topics for the in-body switcher: Today's World + every featured topic.
function topicList() {
  return [{ key: 'home', name: "Today's World" }]
    .concat((getFeaturedTopics() || []).map((t) => ({ key: t.slug, name: t.name })));
}
// Re-render the modal body for a newly-picked topic key ('home' or a slug).
function changeTopic(key) {
  current = { topic: key === 'home' ? 'home' : (getTopicBySlug(key)?.name || key) };
  renderBody(scopeFor(key, null, null));
}

// Build the scope object renderAIIntelligence expects for a given selection. The
// in-body title-switcher (#130-133) drives topic changes via onChangeTopic.
function scopeFor(topic, label, group) {
  const shared = { inModal: true, initialGroup: group, topics: topicList(), onChangeTopic: changeTopic };
  if (topic === 'home') {
    const desc = {}; const icons = {};
    try { (getShortcutsForTopic('home') || []).forEach((s) => { if (s && s.name) { desc[s.name] = s.description || ''; icons[s.name] = s.icon || ''; } }); } catch (_) {}
    return { ...shared, topic: 'home', label: "today's world", descriptions: desc, icons, hideGroups: ['topic-specific'], topicKey: 'home' };
  }
  const t = getTopicBySlug(topic) || (getFeaturedTopics() || []).find((x) => x.name === (label || topic)) || null;
  const name = t ? t.name : label || topic;
  const slug = t ? t.slug : null;
  const desc = {}; const icons = {};
  try { if (slug) (getShortcutsForTopic(slug) || []).forEach((s) => { if (s && s.name) { desc[s.name] = s.description || ''; icons[s.name] = s.icon || ''; } }); } catch (_) {}
  return { ...shared, topic: name, label: name, descriptions: desc, icons, topicKey: slug || (topic || '') };
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

  // A "pick a topic" entry (bottom nav / homepage CTA) arrives with no topic —
  // Step 1 will be the topic picker; until that's wired, fall back to home.
  if (!detail.topic) detail = { ...detail, topic: 'home', label: "today's world" };
  current = { topic: detail.topic, label: detail.label };
  // Header is just the brand + close now; topic context + switching live in the
  // body (the title-switcher), so there's one obvious control (#130-133).
  panelEl.innerHTML = `
    <div class="aii-modal-head">
      <div class="aii-modal-head-id"><span class="aii-modal-logo">${LOGO}</span><h2 class="aii-modal-title">AI Insights</h2></div>
      <button type="button" class="aii-modal-close" aria-label="Close">${X}</button>
    </div>
    <div class="aii-modal-body"></div>`;

  panelEl.querySelector('.aii-modal-close').addEventListener('click', close);

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
