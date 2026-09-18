// The daily briefing's fact check (revamp1437).
//
// The podcast script has been checked against live search since revamp1404; the
// sixteen topic briefings a reader actually reads never were. This closes that
// asymmetry, in the shape the episode's checker settled into after it went
// wrong: research first, correct second, and never let the correction reverse a
// claim it cannot evidence.
//
//   1. RESEARCH (grounded). The only output is what search returned, per item,
//      so the model cannot answer from memory.
//   2. CORRECT (ungrounded). The dossier is the source of truth where it
//      speaks; silence means the sentence stands verbatim.
//   3. GUARD (code). A correction that inverts a direction — a raise into a
//      cut, an approval into a rejection — is kept only when the dossier states
//      the new direction in its own words. This is not advice to the model; it
//      is enforced after the fact, because the episode's checker proved a
//      prompt rule is not a guarantee.
//
// Cost measured at roughly $0.009 a briefing, about $0.29 a day across two
// editions of sixteen topics.

const { generate } = require('./gemini');

// The same five pairs the episode checker uses.
const DIRECTION_PAIRS = [
  [/\b(rais\w*|hik\w*|increas\w*|lift\w*|tighten\w*|higher)\b/i, /\b(lower\w*|cut|cuts|cutting|reduc\w*|slash\w*|trimm\w*|eas\w*|loosen\w*)\b/i],
  [/\b(rose|rise|rises|rising|climb\w*|gain\w*|jump\w*|surg\w*|soar\w*|advanc\w*)\b/i, /\b(fell|fall\w*|drop\w*|declin\w*|slid|sank|sink\w*|plung\w*|tumbl\w*)\b/i],
  [/\b(approv\w*|pass\w*|uphold|upheld|back\w*|clear\w*|grant\w*)\b/i, /\b(reject\w*|block\w*|struck down|strikes down|veto\w*|den\w*|overturn\w*)\b/i],
  [/\b(won|wins|winning)\b/i, /\b(lost|loses|losing)\b/i],
  [/\b(expand\w*|grew|grow\w*|widen\w*)\b/i, /\b(shrank|shrink\w*|contract\w*|narrow\w*)\b/i],
];

function directionFlip(before, after, dossier) {
  for (const [a, b] of DIRECTION_PAIRS) {
    if (a.test(before) && !b.test(before) && b.test(after) && !a.test(after) && !b.test(dossier)) return 'raise→fall';
    if (b.test(before) && !a.test(before) && a.test(after) && !b.test(after) && !a.test(dossier)) return 'fall→raise';
  }
  return null;
}

// A briefing is a HEADLINE line, an ## Overview and ## Briefings items, each
// item its own paragraph opening with a bolded mini-headline. Split it so the
// checker can work item by item and the guard can compare like with like.
function splitBrief(content) {
  const text = String(content || '');
  const headline = (text.match(/^\s*(?:\*\*)?HEADLINE:?(?:\*\*)?\s*(.+?)\s*$/im) || [, ''])[1].trim();
  const lines = text.split('\n');
  const items = []; let cur = null;
  let inBriefings = false;
  for (const line of lines) {
    if (/^##\s/.test(line)) { if (cur) { items.push(cur); cur = null; } inBriefings = /^##\s*Briefings/i.test(line); continue; }
    if (!inBriefings) continue;
    if (/^\s*\*\*/.test(line)) { if (cur) items.push(cur); cur = { text: line }; }
    else if (cur && line.trim()) cur.text += `\n${line}`;
  }
  if (cur) items.push(cur);
  return { headline, items: items.map((x) => x.text.trim()).filter(Boolean) };
}

async function checkBrief({ topic, content, dateLabel, model, thinking = 1024 }) {
  const { headline, items } = splitBrief(content);
  if (!items.length) return { content, changed: 0, reversals: [], usage: { micros: 0, searches: 0 } };

  const numbered = items.map((t, i) => `${i}. ${t.replace(/\s+/g, ' ').slice(0, 420)}`).join('\n');
  const researchPrompt = [
    `Today is ${dateLabel}. You are checking a news briefing on ${topic} before it publishes. For EACH numbered item below, run a Google Search for its current state and report what the newest reporting says. Do not rely on memory: every line must come from a search you ran now.`,
    ``,
    `Report, per item, as plain lines:`,
    `- the current figure for any price, index, count or amount it states, with the date and source;`,
    `- whether the DIRECTION it states is right: did the thing rise or fall, pass or fail, get approved or rejected;`,
    `- whether anything it presents as expected or pending has already happened or been reversed;`,
    `- whether an event it places today happened on another date, and which;`,
    `- any name, role or place the newest reporting contradicts.`,
    `Write "confirmed" where the newest reporting agrees. Be terse; this is a dossier, not prose.`,
    ``, numbered,
  ].join('\n');
  const research = await generate(researchPrompt, { model, grounded: true, maxTokens: 2200 + thinking, thinkingBudget: thinking, temperature: 0.1 });
  const dossier = String(research.text || '').trim();

  const fixPrompt = [
    `You are the FACT CHECKER for a daily briefing on ${topic}, ${dateLabel}. Below is a dossier gathered from live search moments ago, then the briefing's headline and items. Correct them against the dossier.`,
    ``,
    `RULES: the dossier is the source of truth where it speaks; where it says "confirmed" or is silent, the text stays VERBATIM. Change the fewest words that make a sentence true. DIRECTION IS NOT A DETAIL: never turn a rise into a fall, a raise into a cut, an approval into a rejection or a win into a loss unless the dossier says so in those words — a dossier line giving only a LEVEL says nothing about direction, and then the briefing's direction stands. Keep each item's bolded opening sentence bolded, keep any trailing [H3] or [HS] tag exactly as it is, and keep each item within ten percent of its length. Do not add items, do not reorder, do not drop one unless it is false and unfixable.`,
    ``,
    `OUTPUT: JSON only: {"headline":"…","items":[{"index":0,"text":"…"}, …]} — every item in order, unchanged ones verbatim.`,
    ``, `=== DOSSIER ===`, dossier, ``, `=== HEADLINE ===`, headline, ``, `=== ITEMS ===`, numbered,
  ].join('\n');
  const out = await generate(fixPrompt, { model, maxTokens: 4200 + thinking, thinkingBudget: thinking, temperature: 0.2 });

  let parsed = null;
  try { parsed = JSON.parse(String(out.text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim()); } catch (_) { parsed = null; }
  const usage = { micros: (research.micros || 0) + (out.micros || 0), searches: research.searches || 0 };
  if (!parsed || !Array.isArray(parsed.items)) return { content, changed: 0, reversals: [], usage, dossier };

  const byIndex = new Map(parsed.items.map((x) => [Number(x.index), String(x.text || '').trim()]));
  const reversals = []; let changed = 0;
  let next = content;
  items.forEach((orig, i) => {
    const fixed = byIndex.get(i);
    if (!fixed || fixed === orig.trim()) return;
    const flip = directionFlip(orig, fixed, dossier);
    if (flip) { reversals.push(`item ${i}: ${flip}`); return; }
    next = next.replace(orig, fixed);
    changed++;
  });
  const newHead = parsed.headline ? String(parsed.headline).trim() : '';
  if (newHead && headline && newHead !== headline) {
    const flip = directionFlip(headline, newHead, dossier);
    if (flip) reversals.push(`headline: ${flip}`);
    else { next = next.replace(headline, newHead); changed++; }
  }
  return { content: next, changed, reversals, usage, dossier };
}

module.exports = { checkBrief, splitBrief, directionFlip };
