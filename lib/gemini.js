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

// Batch-embed texts (up to 100 per call) with Gemini text-embedding-004.
// Returns an array of 768-dim vectors (one per input), or null if no key.
async function embed(texts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !texts || !texts.length) return null;
  const m = process.env.GEMINI_EMBED_MODEL || 'text-embedding-004';
  const url = `${BASE}/models/${m}:batchEmbedContents?key=${encodeURIComponent(key)}`;
  const body = {
    requests: texts.map(t => ({ model: `models/${m}`, content: { parts: [{ text: String(t || '').slice(0, 8000) }] } })),
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini embed ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.embeddings || []).map(e => e.values);
}

// Embed a single query string → vector, or null.
async function embedQuery(text) {
  const v = await embed([text]);
  return v && v[0] ? v[0] : null;
}

// Render a JS number[] as a pgvector literal: [0.1,0.2,…]
function toVector(values) { return '[' + values.join(',') + ']'; }

module.exports = { generate, model, embed, embedQuery, toVector };
