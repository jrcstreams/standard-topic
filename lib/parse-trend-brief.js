// Splits a trend brief generation into a one-sentence summary + full body.
// The prompt asks the model for "SUMMARY: <one sentence>\nDETAIL: <body>".
// Falls back to first-sentence-as-summary when the labels are absent so the
// homepage one-liner is never blank for a generated brief.
function firstSentence(s) {
  const m = String(s).match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : String(s)).trim();
}

function parseTrendBrief(raw) {
  // Normalize markdown emphasis around the labels so "**SUMMARY:**" / "__DETAIL__:"
  // parse the same as plain "SUMMARY:" / "DETAIL:".
  let text = String(raw || '').replace(/[*_]+\s*(summary|detail)\s*[*_]*\s*:/gi, '$1:').trim();
  if (!text) return { summary: '', content: '' };
  // DETAIL may follow on the same line (not just after a newline), so don't
  // require a line break between the two labels.
  const m = text.match(/summary\s*:\s*([\s\S]*?)\s*detail\s*:\s*([\s\S]*)$/i);
  if (m) {
    return {
      summary: m[1].replace(/[*_]+/g, '').replace(/\s+/g, ' ').trim(),
      content: m[2].replace(/^[\s*_]+/, '').trim(),
    };
  }
  // No labels — drop any stray leading label, first sentence is the summary.
  const stripped = text.replace(/^\s*(summary|detail)\s*:\s*/i, '');
  return { summary: firstSentence(stripped), content: stripped };
}

module.exports = { parseTrendBrief };
