// Minimal Gemini client (REST, no SDK) for serverless functions.
// Used for lazy AI summaries (api/insight.js) and, later, embeddings.
// Returns null when GEMINI_API_KEY is unset so callers degrade gracefully.
//
// Model + price are env-overridable so we can retune without a deploy:
//   GEMINI_MODEL        (default gemini-2.5-flash-lite)
//   GEMINI_IN_MICROS    cost per input token, in millionths of USD  (default 0.10)
//   GEMINI_OUT_MICROS   cost per output token, in millionths of USD (default 0.40)
// Defaults track gemini-2.5-flash-lite list pricing ($0.10 / $0.40 per 1M
// tokens) — the model insight-core uses. Grounding (Google Search) is billed
// separately, per search query past the daily free tier; insight-core adds
// that on top of these token micros. Override the pair if you switch models
// (flash is $0.30 / $2.50).

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function model() { return process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'; }
function inMicros() { return Number(process.env.GEMINI_IN_MICROS || 0.10); }
function outMicros() { return Number(process.env.GEMINI_OUT_MICROS || 0.40); }

// Generate text. With { grounded:true } the model uses Google Search at
// generation time (live-accurate + returns citations). opts.model overrides
// the model. Returns { text, citations:[{title,uri}], inTok, outTok, micros }
// or null if no key.
async function generate(prompt, { maxTokens = 320, temperature = 0.3, grounded = false, model: modelOverride } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const m = modelOverride || model();
  const url = `${BASE}/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(key)}`;
  const reqBody = {
    contents: [{ parts: [{ text: prompt }] }],
    // thinkingBudget:0 disables 2.5-flash's hidden reasoning tokens, which
    // otherwise eat the output budget and truncate the answer.
    generationConfig: { maxOutputTokens: maxTokens, temperature, thinkingConfig: { thinkingBudget: 0 } },
  };
  if (grounded) reqBody.tools = [{ google_search: {} }];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status} ${detail.slice(0, 240)}`);
  }
  const data = await res.json();
  const cand = (data && data.candidates && data.candidates[0]) || {};
  const parts = cand.content && cand.content.parts;
  let text = Array.isArray(parts) ? parts.map(p => p.text || '').join('') : '';
  // Strip inline grounding citation markers some models emit (e.g. [cite_start]).
  text = text.replace(/\[cite[^\]]*\]/gi, '').replace(/[ \t]+\n/g, '\n').trim();
  const meta = cand.groundingMetadata || null;
  const chunks = (cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
  const seen = new Set();
  const citations = chunks
    .map(c => c && c.web)
    .filter(Boolean)
    .map(w => ({ title: w.title || '', uri: w.uri || '' }))
    .filter(c => c.uri && !seen.has(c.uri) && seen.add(c.uri))
    // Multi-section group overviews cite many distinct sources; 8 keeps the
    // Sources list substantial without dumping every chunk.
    .slice(0, 8);
  const u = (data && data.usageMetadata) || {};
  const inTok = u.promptTokenCount || 0;
  const outTok = u.candidatesTokenCount || 0;
  const micros = Math.round(inTok * inMicros() + outTok * outMicros());
  // Google bills grounding per SEARCH QUERY, and one grounded call can fire
  // several (webSearchQueries lists them). This is the true billable unit and
  // what counts against the daily free tier — callers meter on it, not on calls.
  const searches = (meta && Array.isArray(meta.webSearchQueries)) ? meta.webSearchQueries.length : 0;
  return { text, citations, inTok, outTok, micros, searches, meta, parts: Array.isArray(parts) ? parts.length : 0, finish: cand.finishReason };
}

// Batch-embed texts (up to 100 per call) with Gemini text-embedding-004.
// Returns an array of 768-dim vectors (one per input), or null if no key.
async function embed(texts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !texts || !texts.length) return null;
  const m = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
  const dim = parseInt(process.env.GEMINI_EMBED_DIM || '768', 10);
  const url = `${BASE}/models/${m}:batchEmbedContents?key=${encodeURIComponent(key)}`;
  const body = {
    requests: texts.map(t => ({
      model: `models/${m}`,
      content: { parts: [{ text: String(t || '').slice(0, 8000) }] },
      outputDimensionality: dim,
    })),
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
