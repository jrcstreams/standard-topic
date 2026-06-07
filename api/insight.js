// Vercel serverless function — /api/insight  (GET or POST)
//
// Lazy, cached AI insights. First request for a given (entity, insight)
// generates via Gemini and stores it; every later request serves the cached
// copy instantly at $0. A per-UTC-day spend guard (ai_usage vs
// AI_DAILY_CAP_MICROS) refuses NEW generations once the day's cap is hit —
// cached insights still serve, so the feature degrades to "no new summaries
// today" rather than ever overspending.
//
// Input (query for GET, JSON body for POST):
//   type     'news' | 'trend'        (required)
//   insight  see INSIGHTS below      (required)
//   news:  url (required), title, description
//   trend: query (required), category
//
//   200 — { content, cached }              (served)
//   200 — { capped: true }                 (daily cap reached, nothing cached)
//   200 — { unavailable: true }            (no GEMINI_API_KEY / no DB yet)
//   400 — { error }                        (bad input)

const { getSql } = require('../lib/db');
const { generate, model } = require('../lib/gemini');

const CAP_MICROS = parseInt(process.env.AI_DAILY_CAP_MICROS || '250000', 10); // $0.25/day

const INSIGHTS = {
  news: {
    summary: { max: 160, prompt: (e) => `Summarize this news story in 2 plain-English sentences — what happened and why it matters. No preamble, no markdown.\n\nHeadline: ${e.title}\n${e.description || ''}` },
    keypoints: { max: 200, prompt: (e) => `List the 3 most important points from this news story as terse bullet lines starting with "• " (each ≤ 12 words). No preamble.\n\nHeadline: ${e.title}\n${e.description || ''}` },
    background: { max: 200, prompt: (e) => `In 2-3 sentences, give the background and context behind this news story — the key players and what led up to it. No preamble, no markdown.\n\nHeadline: ${e.title}\n${e.description || ''}` },
  },
  trend: {
    why: { max: 160, prompt: (e) => `In 2 plain-English sentences, explain what "${e.query}" refers to and why it is trending in the news right now. No preamble, no markdown.` },
    background: { max: 200, prompt: (e) => `In 2-3 sentences, give background and context on "${e.query}". No preamble, no markdown.` },
  },
};

function readInput(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  return Object.assign({}, req.query || {}, body || {});
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const sql = getSql();
  if (!sql || !process.env.GEMINI_API_KEY) {
    return res.status(200).json({ unavailable: true });
  }

  const input = readInput(req);
  const type = String(input.type || '').trim();
  const insight = String(input.insight || '').trim();
  const spec = INSIGHTS[type] && INSIGHTS[type][insight];
  if (!spec) return res.status(400).json({ error: 'Unknown type/insight' });

  const entity = type === 'news'
    ? { url: String(input.url || '').trim(), title: String(input.title || '').trim(), description: String(input.description || '').trim() }
    : { query: String(input.query || '').trim(), category: String(input.category || '').trim() };

  const key = type === 'news' ? entity.url : entity.query.toLowerCase();
  if (!key || (type === 'news' && !entity.title) || (type === 'trend' && !entity.query)) {
    return res.status(400).json({ error: 'Missing entity fields' });
  }

  try {
    // 1. Cache hit → instant, free.
    const hit = await sql`SELECT content FROM ai_insights WHERE entity_type = ${type} AND entity_key = ${key} AND insight = ${insight} LIMIT 1`;
    if (hit.length) return res.status(200).json({ content: hit[0].content, cached: true });

    // 2. Spend guard.
    const day = new Date().toISOString().slice(0, 10);
    const usage = await sql`SELECT est_cost_micros FROM ai_usage WHERE day = ${day}`;
    const spent = (usage[0] && Number(usage[0].est_cost_micros)) || 0;
    if (spent >= CAP_MICROS) return res.status(200).json({ capped: true });

    // 3. Generate.
    const out = await generate(spec.prompt(entity), { maxTokens: spec.max });
    if (!out || !out.text) return res.status(200).json({ unavailable: true });

    // 4. Store insight + account for spend (best-effort; never block the response).
    await sql`INSERT INTO ai_insights (entity_type, entity_key, insight, content, model)
              VALUES (${type}, ${key}, ${insight}, ${out.text}, ${model()})
              ON CONFLICT (entity_type, entity_key, insight)
              DO UPDATE SET content = EXCLUDED.content, model = EXCLUDED.model, created_at = now()`;
    await sql`INSERT INTO ai_usage (day, calls, est_cost_micros)
              VALUES (${day}, 1, ${out.micros})
              ON CONFLICT (day) DO UPDATE SET calls = ai_usage.calls + 1, est_cost_micros = ai_usage.est_cost_micros + ${out.micros}`;

    return res.status(200).json({ content: out.text, cached: false });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
