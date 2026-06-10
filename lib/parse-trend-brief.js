// Splits a trend brief generation into a one-sentence summary + full body.
// The prompt asks the model for "SUMMARY: <one sentence>\nDETAIL: <body>".
// Falls back to first-sentence-as-summary when the labels are absent so the
// homepage one-liner is never blank for a generated brief.
function firstSentence(s) {
  const m = String(s).match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : String(s)).trim();
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// The modal renders the summary line and THEN the detail body. If the detail
// opens by repeating the summary (the model does this, and the no-label
// fallback below sets content = full text), the same sentence shows twice
// back-to-back. Drop a leading copy of the summary from the content.
function stripLeadingSummary(summary, content) {
  if (!summary || !content) return content;
  const s = norm(summary);
  if (!s) return content;
  // Strip EVERY consecutive leading sentence that exactly repeats the summary
  // (covers both the no-label fallback and a model that literally doubles it).
  // Exact-match only, so a sentence that merely starts with the same words +
  // adds new detail is left intact.
  let c = content;
  for (let i = 0; i < 4; i++) {
    const fs = firstSentence(c);
    if (!fs || norm(fs) !== s) break;
    const rest = c.slice(fs.length).replace(/^[\s).,:;–—-]+/, '').trim();
    if (!rest) break;
    c = rest;
  }
  return c;
}

function parseTrendBrief(raw) {
  // Normalize markdown emphasis around the labels so "**SUMMARY:**" / "__DETAIL__:"
  // parse the same as plain "SUMMARY:" / "DETAIL:".
  let text = String(raw || '').replace(/[*_]+\s*(summary|detail)\s*[*_]*\s*:/gi, '$1:').trim();
  if (!text) return { summary: '', content: '' };
  // DETAIL may follow on the same line (not just after a newline), so don't
  // require a line break between the two labels.
  const m = text.match(/summary\s*:\s*([\s\S]*?)\s*detail\s*:\s*([\s\S]*)$/i);
  let summary; let content;
  if (m) {
    summary = m[1].replace(/[*_]+/g, '').replace(/\s+/g, ' ').trim();
    content = m[2].replace(/^[\s*_]+/, '').trim();
  } else {
    // No labels — drop any stray leading label, first sentence is the summary.
    const stripped = text.replace(/^\s*(summary|detail)\s*:\s*/i, '');
    summary = firstSentence(stripped);
    content = stripped;
  }
  return { summary, content: stripLeadingSummary(summary, content) };
}

module.exports = { parseTrendBrief };
