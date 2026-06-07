// Minimal Gemini client (REST, no SDK) for serverless functions.
// Used for lazy AI summaries (api/insight.js) and, later, embeddings.
// Returns null when GEMINI_API_KEY is unset so callers degrade gracefully.
//
// Model + price are env-overridable so we can retune without a deploy:
//   GEMINI_MODEL        (default gemini-2.5-flash-lite)
//   GEMINI_IN_MICROS    cost per input token, in millionths of USD  (default 0.10)
//   GEMINI_OUT_MICROS   cost per output token, in millionths of USD (default 0.40)

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function model() { return process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'; }
function inMicros() { return Number(process.env.GEMINI_IN_MICROS || 0.10); }
function outMicros() { return Number(process.env.GEMINI_OUT_MICROS || 0.40); }

// Generate text. Returns { text, inTok, outTok, micros } or null if no key.
async function generate(prompt, { maxTokens = 200, temperature = 0.3 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const url = `${BASE}/models/${encodeURIComponent(model())}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const text = Array.isArray(parts) ? parts.map(p => p.text || '').join('').trim() : '';
  const u = (data && data.usageMetadata) || {};
  const inTok = u.promptTokenCount || 0;
  const outTok = u.candidatesTokenCount || 0;
  const micros = Math.round(inTok * inMicros() + outTok * outMicros());
  return { text, inTok, outTok, micros };
}

module.exports = { generate, model };
