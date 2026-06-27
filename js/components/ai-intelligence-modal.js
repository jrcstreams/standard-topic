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
import { renderAIIntelligence } from './ai-intelligence.js?v=20260622-revamp366';
import { getFeaturedTopics, getAllTopics, getTopicBySlug, getShortcutsForTopic } from '../utils/data.js';

let overlayEl = null;
let panelEl = null;
let activeCtl = null;       // the live renderAIIntelligence controller (for destroy)
let current = null;         // { topic, label } currently shown
let mq = null;
const LOGO = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg>';
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

  // NB: the modal stays open across viewport resizes (#218) — it's responsive, so
  // there's no need to close + hand off on a breakpoint cross (that was closing the
  // modal whenever the window was nudged across 900px, which users hit constantly).
}

function isOpen() { return overlayEl && overlayEl.style.display !== 'none'; }

// Whether THIS modal session began "anew" (bottom nav / homepage CTA) — i.e. it
// includes the Step 1 topic picker. Drives back-to-picker availability.
let pickerMode = false;

// Topics for the in-body switcher dropdown: Today's World + every featured topic.
function topicList() {
  return [{ key: 'home', name: "Today's World" }]
    .concat((getFeaturedTopics() || []).map((t) => ({ key: t.slug, name: t.name })));
}
// The full searchable list for the Step 1 picker — Today's World + all 100 topics.
function allTopicsList() {
  return [{ key: 'home', name: "Today's World", parentName: '' }]
    .concat((getAllTopics() || [])
      .filter((t) => t.slug !== 'home')
      .map((t) => ({ key: t.slug, name: t.name, parentName: t.parent ? (getTopicBySlug(t.parent)?.name || '') : '' })));
}
// Re-render the modal body for a newly-picked topic key ('home' or a slug). This
// is the Step 1 → Step 2 transition (lands on the path picker for that topic).
function changeTopic(key) {
  current = { topic: key === 'home' ? 'home' : (getTopicBySlug(key)?.name || key) };
  renderBody(scopeFor(key, null, null));
}

// Build the scope object renderAIIntelligence expects for a given selection.
function scopeFor(topic, label, group, opts) {
  const shared = {
    inModal: true, initialGroup: group, initialInsight: (opts && opts.insight) || null,
    initialBuilder: !!(opts && opts.builder),
    topics: topicList(), allTopics: allTopicsList(),
    onChangeTopic: changeTopic, topicPicker: pickerMode, pickTopic: !!(opts && opts.pickTopic),
    onView: setChrome,
  };
  if (topic === 'home') {
    const desc = {}; const icons = {}; let shortcuts = [];
    try { shortcuts = getShortcutsForTopic('home') || []; shortcuts.forEach((s) => { if (s && s.name) { desc[s.name] = s.description || ''; icons[s.name] = s.icon || ''; } }); } catch (_) {}
    return { ...shared, topic: 'home', label: "today's world", descriptions: desc, icons, shortcuts, hideGroups: ['topic-specific'], topicKey: 'home' };
  }
  // Resolve by slug, then by name across ALL topics (not just featured) so
  // subtopics (e.g. "Blockchain & Web3") resolve and get their shortcut
  // descriptions — otherwise the section cards render with no summary.
  const t = getTopicBySlug(topic)
    || (getAllTopics() || []).find((x) => x.name === (label || topic) || x.slug === topic)
    || null;
  const name = t ? t.name : label || topic;
  const slug = t ? t.slug : null;
  const desc = {}; const icons = {}; let shortcuts = [];
  try { if (slug) { shortcuts = getShortcutsForTopic(slug) || []; shortcuts.forEach((s) => { if (s && s.name) { desc[s.name] = s.description || ''; icons[s.name] = s.icon || ''; } }); } } catch (_) {}
  return { ...shared, topic: name, label: name, descriptions: desc, icons, shortcuts, topicKey: slug || (topic || '') };
}

// Header chrome follows the flip-nav step: the INTRO (topic picker, view ==='topic')
// shows a centered title + subtitle card — like the Search / Trending modals — and
// once the user drills into a path/insight the identity collapses to the compact
// logo + "AI Insights" in the top-left corner. Called by the component via onView.
function setChrome(view) {
  if (!panelEl) return;
  panelEl.classList.toggle('is-intro', view === 'topic');
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

  // Two entry modes:
  //  • "anew" (bottom nav / homepage CTA: detail.pickTopic, no topic) → Step 1
  //    is the topic picker, then path, then insights.
  //  • filtered (a topic page) → jump straight to that topic's path picker.
  pickerMode = !detail.topic || !!detail.pickTopic;
  const baseTopic = detail.topic || 'home';
  current = { topic: baseTopic, label: detail.label };
  // The head carries BOTH chromes (CSS shows one at a time via `.is-intro`):
  //  • compact  — logo + "AI Insights" top-left (drilled into a path/insight)
  //  • intro    — centered logo badge + title + subtitle (Step 1 topic picker),
  //               matching the Search / Trending modal title cards.
  panelEl.innerHTML = `
    <div class="aii-modal-head">
      <button type="button" class="aii-modal-close" aria-label="Close">${X}</button>
      <div class="aii-modal-head-id"><span class="aii-modal-logo">${LOGO}</span><h2 class="aii-modal-title">AI Insights</h2></div>
      <div class="aii-modal-introhead">
        <div class="aii-modal-introtitlerow"><span class="aii-modal-intrologo">${LOGO}</span><h2 class="aii-modal-introtitle">AI Insights</h2></div>
        <p class="aii-modal-introsub">Search any term or browse by topic.</p>
      </div>
    </div>
    <div class="aii-modal-body"></div>`;

  panelEl.querySelector('.aii-modal-close').addEventListener('click', close);
  // Pre-set the chrome so there's no flash before the component's first onView.
  setChrome(pickerMode && !detail.topic ? 'topic' : 'paths');

  renderBody(scopeFor(baseTopic, detail.label, detail.group, { pickTopic: pickerMode && !detail.topic, insight: detail.insight, builder: detail.builder }));

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
