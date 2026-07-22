// Minimal Gemini client (REST, no SDK) for serverless functions.
// Used for lazy AI summaries (api/insight.js) and, later, embeddings.
// Returns null when GEMINI_API_KEY is unset so callers degrade gracefully.
//
// Model + price are env-overridable so we can retune without a deploy:
//   GEMINI_MODEL        (default gemini-2.5-flash)
//   GEMINI_IN_MICROS    cost per input token, in millionths of USD  (default 0.30)
//   GEMINI_OUT_MICROS   cost per output token, in millionths of USD (default 2.50)
// Defaults now track gemini-2.5-flash list pricing ($0.30 / $2.50 per 1M tokens):
// the whole insight pipeline is consolidated onto 2.5-flash (revamp613) — the old
// flash-lite secondary tier is retired since the user-facing surfaces already ran
// flash. Grounding (Google Search) is billed separately, per search query past the
// daily free tier (1,500/day on 2.5, effectively free at our volume); insight-core
// adds that on top of these token micros. Do NOT move to Gemini 3 without handling
// its metered grounding (5k/mo free) — see project_gemini_cost memory.

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function model() { return process.env.GEMINI_MODEL || 'gemini-2.5-flash'; }
function inMicros() { return Number(process.env.GEMINI_IN_MICROS || 0.30); }
function outMicros() { return Number(process.env.GEMINI_OUT_MICROS || 2.50); }

// Generate text. With { grounded:true } the model uses Google Search at
// generation time (live-accurate + returns citations). opts.model overrides
// the model. Returns { text, citations:[{title,uri}], inTok, outTok, micros }
// or null if no key.
async function generate(prompt, { maxTokens = 320, temperature = 0.3, grounded = false, model: modelOverride, thinkingBudget = 0 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const m = modelOverride || model();
  const url = `${BASE}/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(key)}`;
  const reqBody = {
    contents: [{ parts: [{ text: prompt }] }],
    // 2.5 models decide to invoke the google_search tool DURING their thinking
    // phase, so grounded calls need thinkingBudget>0 or no live search fires and
    // the answer comes from stale training data. IMPORTANT: thinking tokens count
    // against maxOutputTokens, so callers must pass maxTokens = answerBudget +
    // thinkingBudget — otherwise thinking eats the budget and the answer truncates
    // mid-sentence (the trend briefs cutting off at "Mexico 3"). See insight-core.
    generationConfig: { maxOutputTokens: maxTokens, temperature, thinkingConfig: { thinkingBudget } },
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
  // Thinking/reasoning tokens are billed at the OUTPUT rate but reported
  // separately by the API. Fold them into the cost estimate so turning on a
  // thinking budget (for reliable grounding) doesn't silently under-report spend.
  const thoughtTok = u.thoughtsTokenCount || 0;
  const micros = Math.round(inTok * inMicros() + (outTok + thoughtTok) * outMicros());
  // Google bills grounding per SEARCH QUERY, and one grounded call can fire
  // several (webSearchQueries lists them). This is the true billable unit and
  // what counts against the daily free tier — callers meter on it, not on calls.
  const searches = (meta && Array.isArray(meta.webSearchQueries)) ? meta.webSearchQueries.length : 0;
  return { text, citations, inTok, outTok, thoughtTok, micros, searches, meta, parts: Array.isArray(parts) ? parts.length : 0, finish: cand.finishReason };
}

// Batch-embed texts (up to 100 per call) with Gemini gemini-embedding-001.
// Returns an array of `dim`-dim vectors (one per input), or null if no key.
// Default 256 dims (Matryoshka truncation) — 3× smaller than 768 with minor recall
// loss, to keep the pgvector column small on the free Neon tier (#storage-trim).
// MUST match the news_stories.embedding column type. Override with GEMINI_EMBED_DIM.
async function embed(texts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !texts || !texts.length) return null;
  const m = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
  const dim = parseInt(process.env.GEMINI_EMBED_DIM || '256', 10);
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
