// Vercel serverless function — /api/insight  (GET or POST)
//
// ONE consolidated, accurate, GROUNDED AI briefing per entity (cached):
//   - type 'news'  → sectioned brief (Explanation/Background/Timeline/Key Points)
//                    for THIS dated story (publish date passed in to avoid stale-year errors).
//   - type 'trend' → "what it is + why now + background" brief.
//   - type 'shortcut' → a per-topic briefing through a group lens
//                    (discover / learn / analyze / topic-specific).
// Grounding = self-grounding (our data) + Google Search (live + citations), with
// an anti-hallucination instruction.
//
// Never pauses: paid Google grounding only while daily calls < AI_GROUNDED_DAILY_LIMIT
// (~free line), then auto-fallback to free self-grounding. ABS_CAP is an abuse backstop.
//
//   200 — { content, sources:[{title,uri}], cached }
//   200 — { capped:true } | { unavailable:true }
//   400 — { error }

const { getSql } = require('../lib/db');
const { generate } = require('../lib/gemini');

const GROUNDED_LIMIT = parseInt(process.env.AI_GROUNDED_DAILY_LIMIT || '400', 10);
const ABS_CAP = parseInt(process.env.AI_DAILY_CAP_CALLS || '5000', 10);
const INSIGHT_MODEL = process.env.GEMINI_INSIGHT_MODEL || 'gemini-2.5-flash';
const GROUNDING = process.env.AI_GROUNDING !== '0';

// Per-group lens for the Intelligence shortcut overviews.
const SHORTCUT_LENS = {
  discover: { grounded: true, prompt: (t) => `Give a current briefing on what's happening in ${t} right now — the latest developments, major stories, and what people are focused on today.` },
  learn: { grounded: false, prompt: (t) => `Explain ${t} for someone getting up to speed: the fundamentals, key concepts, important background, and why it matters.` },
  analyze: { grounded: true, prompt: (t) => `Give an analytical briefing on ${t}: the key tensions and tradeoffs, the main competing perspectives, and what to watch going forward.` },
  'topic-specific': { grounded: true, prompt: (t) => `Give the most important current insights specific to ${t} — the developments and angles that matter most right now.` },
};

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
      breakdown = Array.isArray(tb) ? tb : (typeof tb === 'string' ? JSON.parse(tb || '[]') : []);
    }
  } catch (_) {}
  let headlines = [];
  try {
    const h = await sql.query(
      `SELECT title FROM news_stories WHERE search_vector @@ websearch_to_tsquery('english', $1)
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
    `Write an AI briefing on the news story below. Use Google Search to find current reporting on THIS specific story, verify facts, and cite sources. Be accurate and specific — do not invent.`,
    e.date
      ? `CRITICAL: this article was published on ${e.date}. Treat it as a CURRENT story from that date — summarize this event and its present-day context. Do NOT confuse it with older events that share similar names or phrasing, and do NOT assume an earlier year.`
      : `Treat this as a current story; do not assume an older year based on the headline.`,
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

function shortcutPrompt(topic, lens) {
  return [
    lens.prompt(topic),
    `Write 3-5 sentences of plain prose, then 3-4 key takeaways as "- " bullet lines. Accurate and specific — do not invent.`,
    lens.grounded ? `Use Google Search for current facts and cite sources.` : '',
  ].filter(Boolean).join('\n');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const sql = getSql();
  if (!sql) return res.status(200).json({ unavailable: true, reason: 'no-db' });
  if (!process.env.GEMINI_API_KEY) return res.status(200).json({ unavailable: true, reason: 'no-key' });

  const input = readInput(req);
  const type = String(input.type || '').trim();
  if (type !== 'news' && type !== 'trend' && type !== 'shortcut') return res.status(400).json({ error: 'Unknown type' });

  // Resolve entity + cache identity per type.
  let insight, entity, key, lensGrounded = true;
  if (type === 'shortcut') {
    const group = String(input.group || '').trim().toLowerCase();
    const topic = String(input.topic || '').trim();
    const lens = SHORTCUT_LENS[group];
    if (!lens || !topic) return res.status(400).json({ error: 'Missing/invalid shortcut group or topic' });
    insight = group; entity = { topic, group }; key = topic.toLowerCase(); lensGrounded = lens.grounded;
  } else if (type === 'news') {
    insight = 'brief';
    entity = { url: String(input.url || '').trim(), title: String(input.title || '').trim(), description: String(input.description || '').trim(), date: String(input.date || '').trim() };
    key = entity.url;
    if (!key || !entity.title) return res.status(400).json({ error: 'Missing entity fields' });
  } else {
    insight = 'brief';
    entity = { query: String(input.query || '').trim() };
    key = entity.query.toLowerCase();
    if (!entity.query) return res.status(400).json({ error: 'Missing entity fields' });
  }

  try {
    // 1. Cache (resilient to a missing sources column pre-migration).
    const refresh = input.refresh === '1' || input.refresh === 1 || input.refresh === true;
    let hit = [];
    if (!refresh) {
      try { hit = await sql.query(`SELECT content, sources FROM ai_insights WHERE entity_type=$1 AND entity_key=$2 AND insight=$3 LIMIT 1`, [type, key, insight]); }
      catch (_) { hit = await sql.query(`SELECT content FROM ai_insights WHERE entity_type=$1 AND entity_key=$2 AND insight=$3 LIMIT 1`, [type, key, insight]); }
    }
    if (hit.length) return res.status(200).json({ content: hit[0].content, sources: hit[0].sources || [], cached: true });

    // 2. Daily budget → decide grounding (never pause; only an abuse backstop).
    const day = new Date().toISOString().slice(0, 10);
    const usage = await sql.query(`SELECT calls FROM ai_usage WHERE day=$1`, [day]);
    const calls = (usage[0] && Number(usage[0].calls)) || 0;
    if (calls >= ABS_CAP) return res.status(200).json({ capped: true });
    const useGrounding = GROUNDING && lensGrounded && calls < GROUNDED_LIMIT;

    // 3. Build prompt.
    let prompt; let maxTokens;
    if (type === 'news') { prompt = newsPrompt(entity); maxTokens = 900; }
    else if (type === 'trend') { prompt = trendPrompt(entity.query, await trendContext(sql, entity.query)); maxTokens = 500; }
    else { prompt = shortcutPrompt(entity.topic, SHORTCUT_LENS[entity.group]); maxTokens = 700; }

    // 4. Generate (grounded if within budget → fall back to ungrounded).
    let out = null;
    try { out = await generate(prompt, { grounded: useGrounding, model: INSIGHT_MODEL, maxTokens }); }
    catch (e) {
      if (useGrounding) { try { out = await generate(prompt, { grounded: false, model: INSIGHT_MODEL, maxTokens }); } catch (_) { out = null; } }
      else throw e;
    }
    if (!out || !out.text) return res.status(200).json({ unavailable: true, reason: 'no-text', calls, useGrounding });
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

    const body = { content: out.text, sources, cached: false };
    if (input.debug) body._debug = { parts: out.parts, finish: out.finish, useGrounding };
    return res.status(200).json(body);
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
