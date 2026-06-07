// Vercel serverless function — /api/insight  (GET or POST)
//
// ONE consolidated, accurate AI briefing per entity (cached). Trends → a single
// "what it is + why now + background" brief. News → a sectioned brief
// (Explanation / Background / Timeline / Key Points). Both are GROUNDED:
//   - self-grounded with our own data (trend category + related searches +
//     matching archive headlines), and
//   - grounded with Google Search (live-accurate + citation links),
// with an explicit anti-hallucination instruction. Falls back to self-grounding
// only if Google grounding isn't enabled on the key.
//
// Spend guard is COUNT-based: ai_usage.calls vs AI_DAILY_CAP_CALLS (default 500,
// ~the free grounded-request line). Cached briefs always serve, even when capped.
//
// Input (query for GET, JSON body for POST):
//   type   'news' | 'trend'   (required)
//   news:  url (required, cache key), title, description
//   trend: query (required)
//
//   200 — { content, sources:[{title,uri}], cached }
//   200 — { capped:true } | { unavailable:true }
//   400 — { error }

const { getSql } = require('../lib/db');
const { generate } = require('../lib/gemini');

const CAP_CALLS = parseInt(process.env.AI_DAILY_CAP_CALLS || '500', 10);
const INSIGHT_MODEL = process.env.GEMINI_INSIGHT_MODEL || 'gemini-2.5-flash';
const GROUNDED = process.env.AI_GROUNDING !== '0';

function readInput(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  return Object.assign({}, req.query || {}, body || {});
}

async function trendContext(sql, query) {
  let category = '';
  let breakdown = [];
  try {
    const r = await sql.query(
      `SELECT category, trend_breakdown FROM trending_items
        WHERE lower(query) = lower($1) ORDER BY snapshot_at DESC LIMIT 1`, [query]);
    if (r[0]) {
      category = r[0].category || '';
      const tb = r[0].trend_breakdown;
      breakdown = Array.isArray(tb) ? tb : (typeof tb === 'string' ? (JSON.parse(tb || '[]')) : []);
    }
  } catch (_) { /* table/col may differ */ }
  let headlines = [];
  try {
    const h = await sql.query(
      `SELECT title FROM news_stories
        WHERE search_vector @@ websearch_to_tsquery('english', $1)
        ORDER BY published_at DESC NULLS LAST LIMIT 5`, [query]);
    headlines = h.map(x => x.title).filter(Boolean);
  } catch (_) {}
  return { category, breakdown, headlines };
}

function trendPrompt(query, ctx) {
  const lines = [
    `Write a single accurate briefing (3-5 sentences, plain prose, NO headers/markdown) explaining the trending term below: what it is, why it is trending right now (what just happened), and brief context.`,
    `Use Google Search to verify — be specific and factual. If you genuinely cannot tell what it refers to, say so and name the likely category; do NOT invent.`,
    ``,
    `Trending term: "${query}"`,
  ];
  if (ctx.category) lines.push(`Category: ${ctx.category}`);
  if (ctx.breakdown && ctx.breakdown.length) lines.push(`Related searches (strong signal of meaning): ${ctx.breakdown.slice(0, 10).join(', ')}`);
  if (ctx.headlines && ctx.headlines.length) lines.push(`Recent related headlines from our archive:\n- ${ctx.headlines.join('\n- ')}`);
  return lines.join('\n');
}

function newsPrompt(e) {
  return [
    `Write an AI briefing on the news story below. Use Google Search to verify facts and add current context. Be accurate and specific — do not invent.`,
    `Format EXACTLY as these four sections, each starting with the label on its own line ("### Explanation", etc.), followed by 1-3 sentences (Key Points as "- " bullet lines):`,
    `### Explanation`,
    `### Background`,
    `### Timeline`,
    `### Key Points`,
    ``,
    `Story: "${e.title}"`,
    e.description ? `Summary: ${e.description}` : '',
    e.url ? `Source: ${e.url}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const sql = getSql();
  if (!sql || !process.env.GEMINI_API_KEY) return res.status(200).json({ unavailable: true });

  const input = readInput(req);
  const type = String(input.type || '').trim();
  if (type !== 'news' && type !== 'trend') return res.status(400).json({ error: 'Unknown type' });
  const insight = 'brief';

  const entity = type === 'news'
    ? { url: String(input.url || '').trim(), title: String(input.title || '').trim(), description: String(input.description || '').trim() }
    : { query: String(input.query || '').trim() };
  const key = type === 'news' ? entity.url : entity.query.toLowerCase();
  if (!key || (type === 'news' && !entity.title) || (type === 'trend' && !entity.query)) {
    return res.status(400).json({ error: 'Missing entity fields' });
  }

  try {
    // 1. Cache (resilient to a missing sources column pre-migration).
    let hit;
    try { hit = await sql.query(`SELECT content, sources FROM ai_insights WHERE entity_type=$1 AND entity_key=$2 AND insight=$3 LIMIT 1`, [type, key, insight]); }
    catch (_) { hit = await sql.query(`SELECT content FROM ai_insights WHERE entity_type=$1 AND entity_key=$2 AND insight=$3 LIMIT 1`, [type, key, insight]); }
    if (hit.length) return res.status(200).json({ content: hit[0].content, sources: hit[0].sources || [], cached: true });

    // 2. Count-based daily cap.
    const day = new Date().toISOString().slice(0, 10);
    const usage = await sql.query(`SELECT calls FROM ai_usage WHERE day=$1`, [day]);
    const calls = (usage[0] && Number(usage[0].calls)) || 0;
    if (calls >= CAP_CALLS) return res.status(200).json({ capped: true });

    // 3. Build grounded prompt.
    let prompt; let maxTokens;
    if (type === 'news') { prompt = newsPrompt(entity); maxTokens = 480; }
    else { prompt = trendPrompt(entity.query, await trendContext(sql, entity.query)); maxTokens = 300; }

    // 4. Generate (grounded → fall back to ungrounded self-grounding).
    let out = null;
    try { out = await generate(prompt, { grounded: GROUNDED, model: INSIGHT_MODEL, maxTokens }); }
    catch (e) {
      if (GROUNDED) { try { out = await generate(prompt, { grounded: false, model: INSIGHT_MODEL, maxTokens }); } catch (_) { out = null; } }
      else throw e;
    }
    if (!out || !out.text) return res.status(200).json({ unavailable: true });
    const sources = out.citations || [];

    // 5. Store (resilient) + account spend.
    try {
      await sql.query(
        `INSERT INTO ai_insights (entity_type, entity_key, insight, content, model, sources)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (entity_type, entity_key, insight)
         DO UPDATE SET content=EXCLUDED.content, model=EXCLUDED.model, sources=EXCLUDED.sources, created_at=now()`,
        [type, key, insight, out.text, INSIGHT_MODEL, JSON.stringify(sources)]
      );
    } catch (_) {
      await sql.query(
        `INSERT INTO ai_insights (entity_type, entity_key, insight, content, model)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (entity_type, entity_key, insight)
         DO UPDATE SET content=EXCLUDED.content, model=EXCLUDED.model, created_at=now()`,
        [type, key, insight, out.text, INSIGHT_MODEL]
      );
    }
    await sql.query(
      `INSERT INTO ai_usage (day, calls, est_cost_micros) VALUES ($1, 1, $2)
       ON CONFLICT (day) DO UPDATE SET calls=ai_usage.calls+1, est_cost_micros=ai_usage.est_cost_micros+$2`,
      [day, out.micros]
    );

    return res.status(200).json({ content: out.text, sources, cached: false });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
