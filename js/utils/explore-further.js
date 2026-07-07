// Shared "Explore Further" body — a clean list of dropdown accordions used by the
// trending expansion, the news-story AI Insights, and the topic AI Insights so all
// three look and behave identically. "Explore with External AI Models" comes first
// and offers the Send-to / Direct Submit / Review-Prompt flow (NOT a direct open);
// then each web-search category.
import { getModels, getExternalSearches, getExternalSearchCategories, getModelById, getPromptGenData } from './data.js';
import { openModel, copyPrompt, getPreferredModelId, setPreferredModelId } from './ai-models.js';
import { assemblePrompt } from './prompt-assembly.js';
import { REASONING_LEVELS } from './settings.js';

const ICON_COPY_MINI = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="8" height="9" rx="1.2"/><path d="M9.5 3.5V2.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1"/></svg>';

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function escAttr(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const CHEV = '<svg class="xf-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const SPARK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.6 4.6a2 2 0 0 0 1.3 1.3L19.5 10l-4.6 1.6a2 2 0 0 0-1.3 1.3L12 17l-1.6-4.6a2 2 0 0 0-1.3-1.3L4.5 10l4.6-1.6a2 2 0 0 0 1.3-1.3z"/></svg>';
const GLOBE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>';
const ARROW = '<svg class="xf-arrow" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';
const EXT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const ICON_SEND = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
const ICON_EYE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';

function preferredModel() {
  const models = getModels() || [];
  const id = getPreferredModelId();
  return models.find((m) => m.id === id) || models[0] || null;
}
function modelOptionsHTML() {
  const cur = preferredModel();
  return (getModels() || []).map((m) => `<option value="${escAttr(m.id)}"${cur && m.id === cur.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
}
function emenuHomeHTML() {
  const m = preferredModel();
  return `<div class="xf-emenu" data-step="home">
    <label class="xf-emenu-model"><span class="xf-emenu-lead">Send to</span>
      <span class="xf-select-wrap"><select class="xf-select" aria-label="Choose AI model">${modelOptionsHTML()}</select>${CHEV}</span></label>
    <button type="button" class="xf-opt" data-opt="direct">
      <span class="xf-opt-ic">${ICON_SEND}</span>
      <span class="xf-opt-tx"><span class="xf-opt-name">Direct Submit</span><span class="xf-opt-sub">Open <span class="xf-mn">${esc(m ? m.name : 'the model')}</span> with this prompt</span></span><span class="xf-opt-chev">${CHEV}</span></button>
    <button type="button" class="xf-opt" data-opt="review">
      <span class="xf-opt-ic">${ICON_EYE}</span>
      <span class="xf-opt-tx"><span class="xf-opt-name">Review Prompt</span><span class="xf-opt-sub">Preview &amp; tweak it before you send</span></span><span class="xf-opt-chev">${CHEV}</span></button>
  </div>`;
}
function emenuLeaveInlineHTML() {
  const m = preferredModel();
  const name = m ? m.name : 'the AI model';
  return `<div class="aii-leave-inline">
    <p class="aii-leave-body">Continue opens <strong>${esc(name)}</strong> in a new tab. If the prompt doesn't auto-fill, it's copied to your clipboard — just paste it in.</p>
    <button type="button" class="xf-leave-go">Continue ${ARROW}</button>
  </div>`;
}
function emenuLeaveHTML() {
  const m = preferredModel();
  const name = m ? m.name : 'the AI model';
  return `<div class="xf-emenu" data-step="leave">
    <div class="xf-leave">
      <button type="button" class="xf-leave-back">${BACK}<span>Back</span></button>
      <p class="xf-leave-title">You're leaving Standard Topic</p>
      <p class="xf-leave-body">Continue opens <strong>${esc(name)}</strong> in a new tab. If the prompt doesn't auto-fill, it's copied to your clipboard — just paste it in.</p>
      <button type="button" class="xf-leave-go">Continue ${ARROW}</button>
    </div>
  </div>`;
}

// ── Inline "Review Prompt" — same as the topic Prompts flow, replacing the modal
//    on every surface that uses this component (news / trending / Explore Further).
function xfSimpleOutputOptions() {
  const pg = getPromptGenData() || {};
  const f = (pg.fields || []).find((x) => x.key === 'outputType') || { options: [] };
  return (f.options || []).filter((o) => !o.requiresInput);
}
function xfSecondaryClauseTpl() { const pg = getPromptGenData() || {}; return pg.secondaryTopicClause || ''; }
function xfReviewDisc(m) { return `Opens ${m ? m.name : 'the AI model'} in a new tab — the prompt auto-fills or is copied to your clipboard. Standard Topic isn’t responsible for actions taken once you leave the site.`; }
function xfReviewHTML(prompt) {
  const m = preferredModel();
  const reasoningOpts = REASONING_LEVELS.map((l) => `<option value="${escAttr(l.id)}"${l.id === 'standard' ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
  const otOpts = '<option value="">None</option>' + xfSimpleOutputOptions().map((o) => `<option value="${escAttr(o.value)}">${esc(o.label)}</option>`).join('');
  return `<div class="aii-review" data-step="review">
    <div class="aii-review-field">
      <div class="aii-review-lblrow"><span class="aii-review-lbl">Prompt Preview</span><button type="button" class="aii-review-reset" data-xfr-reset hidden>Reset</button></div>
      <div class="aii-review-tawrap"><textarea class="aii-review-ta" data-xfr-ta aria-label="Prompt — editable">${esc(prompt)}</textarea><button type="button" class="aii-review-copy" data-xfr-copy aria-label="Copy prompt" title="Copy">${ICON_COPY_MINI}</button></div>
    </div>
    <details class="aii-review-acc" data-xfr-adv>
      <summary class="aii-review-accsum"><span class="aii-review-acc-title">Advanced settings</span><span class="aii-review-acc-hint">Reasoning, format, custom instructions</span>${CHEV}</summary>
      <div class="aii-review-accbody">
        <div class="aii-review-grid">
          <label class="aii-review-fld"><span class="aii-review-flbl">Reasoning level</span><span class="xf-select-wrap"><select class="aii-review-reasoning" data-xfr-reasoning>${reasoningOpts}</select>${CHEV}</span></label>
          <label class="aii-review-fld"><span class="aii-review-flbl">Output type</span><span class="xf-select-wrap"><select class="aii-review-output" data-xfr-output>${otOpts}</select>${CHEV}</span></label>
        </div>
        <label class="aii-review-fld"><span class="aii-review-flbl">Secondary topics</span><input type="text" class="aii-review-secondary" data-xfr-secondary placeholder="e.g. trade policy"></label>
        <label class="aii-review-fld"><span class="aii-review-flbl">Custom instructions <span class="aii-review-flbl-note">— this submission only</span></span><textarea class="aii-review-custom" data-xfr-custom rows="2" placeholder="A one-off instruction for this prompt"></textarea></label>
      </div>
    </details>
    <button type="button" class="aii-review-submit" data-xfr-submit${m ? '' : ' disabled'}>${ICON_SEND}<span data-xfr-submitlabel>${esc(m ? `Submit to ${m.name}` : 'Submit prompt')}</span></button>
    <p class="aii-review-disc" data-xfr-disc>${esc(xfReviewDisc(m))}</p>
  </div>`;
}
function wireXfReview(host, base) {
  base = base || '';
  const ps = { reasoning: 'standard', outputType: '', secondaryTopic: '', customInstructions: '' };
  let edited = null;
  const ta = host.querySelector('[data-xfr-ta]');
  const resetBtn = host.querySelector('[data-xfr-reset]');
  const advOpts = () => {
    const r = REASONING_LEVELS.find((l) => l.id === ps.reasoning);
    const ot = xfSimpleOutputOptions().find((o) => o.value === ps.outputType);
    return { reasoningHint: r && r.hint ? r.hint : '', outputClause: ot ? ot.clause : '', secondaryTopic: ps.secondaryTopic.trim(), secondaryClauseTpl: xfSecondaryClauseTpl(), customInstructions: ps.customInstructions.trim(), topicName: '' };
  };
  const assembled = () => assemblePrompt(base, advOpts());
  const regen = () => { edited = null; if (ta) ta.value = assembled(); if (resetBtn) resetBtn.hidden = true; };
  ta && ta.addEventListener('input', () => { edited = (ta.value === assembled()) ? null : ta.value; if (resetBtn) resetBtn.hidden = (edited == null); });
  resetBtn && resetBtn.addEventListener('click', regen);
  host.querySelector('[data-xfr-copy]')?.addEventListener('click', async (e) => { e.stopPropagation(); try { await navigator.clipboard.writeText(ta ? ta.value : base); } catch (_) {} });
  const submitBtn = host.querySelector('[data-xfr-submit]');
  host.querySelector('[data-xfr-reasoning]')?.addEventListener('change', (e) => { ps.reasoning = e.target.value; regen(); });
  host.querySelector('[data-xfr-output]')?.addEventListener('change', (e) => { ps.outputType = e.target.value; regen(); });
  host.querySelector('[data-xfr-secondary]')?.addEventListener('input', (e) => { ps.secondaryTopic = e.target.value; regen(); });
  host.querySelector('[data-xfr-custom]')?.addEventListener('input', (e) => { ps.customInstructions = e.target.value; regen(); });
  submitBtn && submitBtn.addEventListener('click', () => {
    const m = preferredModel();
    if (!m) return;
    const prompt = ta ? ta.value : assembled();
    openModel(m, prompt); copyPrompt(prompt);
    const note = document.createElement('p');
    note.className = 'aii-review-done';
    note.textContent = `Opened ${m.name} · prompt copied to your clipboard — paste it in if it didn’t auto-fill.`;
    submitBtn.replaceWith(note);
  });
}

// Short subtitles so each category reads as a clean, self-explaining listing (the
// Prompts-style flat list), keyed by category key with a sensible fallback.
const CAT_DESC = {
  search: 'Google, Wikipedia & reference sites',
  noai: 'Search engines without AI answers',
  social: 'Reddit, X, forums & blogs',
  media: 'YouTube, podcasts & video',
  __other: 'More places to search',
};

// opts: { prompt, webTerm, name, openFirst }
export function exploreFurtherHTML(opts = {}) {
  const { prompt = '', webTerm = '', openFirst = false } = opts;
  const models = getModels() || [];
  const aiAcc = models.length
    ? `<details class="xf-acc"${openFirst ? ' open' : ''}><summary class="xf-sum"><span class="xf-sum-tx"><span class="xf-sum-name">Explore with External AI Models</span><span class="xf-sum-desc">Send this prompt to ChatGPT, Claude, Gemini &amp; more</span></span>${CHEV}</summary><div class="xf-panel" data-xf-emenu data-xf-prompt="${escAttr(prompt)}" data-xf-name="${escAttr(opts.name || '')}">${emenuHomeHTML()}</div></details>`
    : '';
  const cats = getExternalSearchCategories() || [];
  const searches = getExternalSearches() || [];
  const known = new Set(cats.map((c) => c.key));
  const order = cats.slice();
  if (searches.some((s) => !known.has(s.category))) order.push({ key: '__other', label: 'Other' });
  const webAccs = order.map((cat) => {
    const items = cat.key === '__other' ? searches.filter((s) => !known.has(s.category)) : searches.filter((s) => s.category === cat.key);
    if (!items.length) return '';
    const rows = items.map((s) => {
      const url = String(s.urlTemplate || '').replace(/\{query\}/g, encodeURIComponent(webTerm || ''));
      return `<a class="xf-web-row" href="${escAttr(url)}" target="_blank" rel="noopener noreferrer"><span class="xf-web-tx"><span class="xf-web-name">${esc(s.name)}</span>${s.description ? `<span class="xf-web-desc">${esc(s.description)}</span>` : ''}</span>${EXT}</a>`;
    }).join('');
    const desc = CAT_DESC[cat.key] || '';
    return `<details class="xf-acc"><summary class="xf-sum"><span class="xf-sum-tx"><span class="xf-sum-name">${esc(cat.label)}</span>${desc ? `<span class="xf-sum-desc">${esc(desc)}</span>` : ''}</span>${CHEV}</summary><div class="xf-panel xf-web-panel">${rows}</div></details>`;
  }).join('');
  return `<div class="xf-list">${aiAcc}${webAccs}</div>`;
}

// Delegated wiring for the emenu flow. Safe to call once per rendered root.
export function wireExploreFurther(root) {
  if (!root || root.dataset.xfWired === '1') return;
  root.dataset.xfWired = '1';
  root.addEventListener('change', (e) => {
    const sel = e.target.closest('.xf-select');
    if (!sel) return;
    setPreferredModelId(sel.value);
    const host = sel.closest('[data-xf-emenu]');
    const m = preferredModel();
    const mn = host && host.querySelector('.xf-mn');
    if (mn && m) mn.textContent = m.name;
    // Keep an open inline review's Submit label in sync with the shared Send-to.
    const rl = host && host.querySelector('[data-xfr-submitlabel]'); if (rl && m) rl.textContent = `Submit to ${m.name}`;
    const rd = host && host.querySelector('[data-xfr-disc]'); if (rd) rd.textContent = xfReviewDisc(m);
  });
  root.addEventListener('click', (e) => {
    const opt = e.target.closest('.xf-opt, .xf-leave-go');
    if (!opt) return;
    e.stopPropagation();
    const host = opt.closest('[data-xf-emenu]');
    if (!host) return;
    const prompt = host.getAttribute('data-xf-prompt') || '';
    if (opt.classList.contains('xf-opt')) {
      // Accordion: the panel drops DIRECTLY beneath the clicked option row and its
      // chevron rotates; mutually exclusive; re-click closes (#img309/#img310).
      const wasActive = opt.classList.contains('is-active');
      host.querySelectorAll('.aii-review-panel, .aii-leave-panel').forEach((p) => p.remove());
      host.querySelectorAll('.xf-opt.is-active').forEach((o) => o.classList.remove('is-active'));
      if (wasActive) return;
      if (opt.dataset.opt === 'review') {
        const panel = document.createElement('div');
        panel.className = 'aii-review-panel';
        panel.innerHTML = xfReviewHTML(prompt);
        opt.insertAdjacentElement('afterend', panel);
        wireXfReview(panel, prompt);
        opt.classList.add('is-active');
        try { panel.querySelector('[data-xfr-ta]').focus(); } catch (_) {}
      } else {
        copyPrompt(prompt);              // copy now so Continue opens synchronously
        const panel = document.createElement('div');
        panel.className = 'aii-leave-panel';
        panel.innerHTML = emenuLeaveInlineHTML();
        opt.insertAdjacentElement('afterend', panel);
        opt.classList.add('is-active');
      }
    } else {                             // xf-leave-go
      const m = preferredModel();
      if (m) openModel(m, prompt);
    }
  });
}
