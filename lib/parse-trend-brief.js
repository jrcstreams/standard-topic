// Splits a trend brief generation into a one-sentence summary + full body.
// The prompt asks the model for "SUMMARY: <one sentence>\nDETAIL: <body>".
// Falls back to first-sentence-as-summary when the labels are absent so the
// homepage one-liner is never blank for a generated brief.
function firstSentence(s) {
  const m = String(s).match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : String(s)).trim();
}

function parseTrendBrief(raw) {
  const text = String(raw || '').trim();
  if (!text) return { summary: '', content: '' };
  const m = text.match(/summary\s*:\s*([\s\S]*?)\n\s*detail\s*:\s*([\s\S]*)$/i);
  if (m) {
    return { summary: m[1].trim().replace(/\s+/g, ' '), content: m[2].trim() };
  }
  return { summary: firstSentence(text), content: text };
}

module.exports = { parseTrendBrief };
