// Core AI-insight generation, shared by /api/insight (HTTP) and
// /api/cron/pregenerate (direct). Produces ONE consolidated, grounded brief per
// entity and caches it. Shortcut briefs are GROUP OVERVIEWS: one generation per
// (topic|home, group) sectioned as "## <shortcut name>" per shortcut in that
// group (see lib/shortcut-sections.js + data/insight-templates.json).
// Returns a plain object:
//   { content, sources, cached, generatedAt } | { unavailable:true } | { capped:true } | { error }
//
// Grounding = self-grounding (our data) + Google Search (live + citations), with
// an anti-hallucination instruction. Never pauses: paid grounding only while
// daily calls < AI_GROUNDED_DAILY_LIMIT, then falls back to ungrounded; if a
// grounded call returns empty (free quota) it also falls back. ABS_CAP is an
// abuse backstop only.

const { generate } = require('./gemini');
const { resolveSections, resolveTopic, GROUP_LABELS } = require('./shortcut-sections');
const templates = require('../data/insight-templates.json');

// 800 keeps the ~400-overview corpus + daily refresh + news/trends grounded
// while staying inside Gemini's grounding free tier (1,500/day); the hourly
// cron run budget bounds real volume well below this anyway.
const ABS_CAP = parseInt(process.env.AI_DAILY_CAP_CALLS || '5000', 10);
// Token model. flash-lite ($0.10 in / $0.40 out per 1M) is ~6x cheaper on
// output than flash and is plenty for these grounded briefs. Flip
// GEMINI_INSIGHT_MODEL to gemini-2.5-flash if you ever want richer synthesis.
const INSIGHT_MODEL = process.env.GEMINI_INSIGHT_MODEL || 'gemini-2.5-flash-lite';
// Grounding is billed per SEARCH QUERY (one grounded call fires several) at
// GROUNDING_PER_SEARCH_MICROS ($35 / 1,000 = 35 millionths), free up to
// GROUNDING_FREE queries/day. CONFIRMED via the Cloud Console SKU report: on
// paid Tier 1 the "search query gemini 2.5 free" SKU bills $0.00 (1,500/day
// free allowance is real), so default FREE=1500 and grounding contributes $0 to
// the estimate at our volumes. Set FREE=0 to price every search if a future
// tier change starts billing them. SEARCH_BUDGET (the point we stop issuing
// grounded calls) is independent — changing FREE only moves the dollar
// estimate, never the actual API behaviour.
const GROUNDING_FREE = parseInt(process.env.GEMINI_GROUNDING_FREE || '1500', 10);
const SEARCH_BUDGET = parseInt(process.env.AI_GROUNDED_SEARCH_BUDGET || '1400', 10);
const GROUNDING_PER_SEARCH_MICROS = parseInt(process.env.GEMINI_SEARCH_MICROS || '35', 10);
const GROUNDING = process.env.AI_GROUNDING !== '0';

// All lens groups are grounded so every shortcut overview is anchored to live
// search results (current facts + citations). Learn is more evergreen, but
// grounding it still yields sources and keeps dates honest.
const LENS_GROUNDED = { discover: true, learn: true, analyze: true, 'topic-specific': true };

// Human-readable current date, injected into every prompt so the model anchors
// to "now" and treats Google Search results as current — without this, the base
// model defaults to its training-cutoff knowledge and writes stale (old-year)
// briefs as if they were current. UTC keeps it deterministic across regions.
function todayLabel() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
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
    headlines = h.map((x) => x.title).filter(Boolean);
  } catch (_) {}
  return { category, breakdown, headlines };
}

function trendPrompt(query, ctx) {
  const lines = [
    `Today is ${todayLabel()}. Write a single accurate briefing (3-5 sentences, plain prose, NO headers/markdown) explaining the trending term below: what it is, why it is trending right now (what just happened in the days leading up to today), and brief context.`,
    `Use Google Search for the latest information and rely on those results over your own prior knowledge — do not assume an older year or stale facts. Be specific and factual. If you genuinely cannot tell what it refers to, say so and name the likely category; do NOT invent.`,
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
    `Today is ${todayLabel()}. Write an AI briefing on the news story below. Use Google Search to find current reporting on THIS specific story, verify facts, and cite sources. Rely on the search results over your own prior knowledge — do not assume an older year or stale facts. Be accurate and specific — do not invent.`,
    e.date
      ? `CRITICAL: this article was published on ${e.date}. Treat it as a CURRENT story from that date — summarize this event and its present-day context. Do NOT confuse it with older events that share similar names or phrasing, and do NOT assume an earlier year.`
      : `Treat this as a current story; do not assume an older year based on the headline.`,
    `Format EXACTLY as these four sections, each starting with the label on its own line ("### Explanation", etc.), followed by 1-3 sentences (Key Points as "- " bullet lines):`,
    `### Explanation`, `### Background`, `### Timeline`, `### Key Points`,
    ``,
    `Story: "${e.title}"`,
    e.description ? `Summary: ${e.description}` : '',
    e.url ? `Source: ${e.url}` : '',
  ].filter(Boolean).join('\n');
}

// Group overview: ONE generation per (scope, group), with one "## <name>"
// section per shortcut in that group — the shortcut prompts are the section
// briefs. Template (incl. format rules) lives in data/insight-templates.json.
function overviewPrompt(scope, group, sections, grounded) {
  const topic = resolveTopic(scope);
  const scopeLabel = topic && topic.slug === 'home'
    ? `today's world — global news, markets, tech, and culture`
    : `the topic "${topic.name}"`;
  const sectionList = sections
    .map((s, i) => `${i + 1}. ## ${s.name} — section brief: ${s.prompt}`)
    .join('\n');
  const body = String(templates.overviewGeneration || '')
    .replace(/\{today\}/g, todayLabel())
    .replace('{groupLabel}', GROUP_LABELS[group] || group)
    .replace('{scopeLabel}', scopeLabel)
    .replace('{sections}', sectionList);
  return grounded
    ? `${body}\nUse Google Search for the most current facts as of today and rely on those results over your own prior knowledge — every date, name, and event must be current, not from an earlier year. Cite the sources you used.`
    : body;
}

async function generateInsight(sql, input) {
  if (!sql) return { unavailable: true };
  if (!process.env.GEMINI_API_KEY) return { unavailable: true };

  const type = String((input && input.type) || '').trim();
  if (type !== 'news' && type !== 'trend' && type !== 'shortcut') return { error: 'Unknown type' };

  let insight; let entity; let key; let lensGrounded = true;
  if (type === 'shortcut') {
    const group = String(input.group || '').trim().toLowerCase();
    const topic = String(input.topic || '').trim();
    if (!(group in LENS_GROUNDED) || !topic) return { error: 'Missing/invalid shortcut group or topic' };
    const sections = resolveSections(topic, group);
    if (!sections) return { error: 'Unknown topic' };
    if (!sections.length) return { error: 'No shortcuts in group' };
    insight = group; entity = { topic, group, sections }; key = topic.toLowerCase(); lensGrounded = LENS_GROUNDED[group];
  } else if (type === 'news') {
    insight = 'brief';
    entity = { url: String(input.url || '').trim(), title: String(input.title || '').trim(), description: String(input.description || '').trim(), date: String(input.date || '').trim() };
    key = entity.url;
    if (!key || !entity.title) return { error: 'Missing entity fields' };
  } else {
    insight = 'brief';
    entity = { query: String(input.query || '').trim() };
    key = entity.query.toLowerCase();
    if (!entity.query) return { error: 'Missing entity fields' };
  }

  // 1. Cache.
  const refresh = input.refresh === '1' || input.refresh === 1 || input.refresh === true;
  let hit = [];
  if (!refresh) {
    try { hit = await sql.query(`SELECT content, sources, created_at FROM ai_insights WHERE entity_type=$1 AND entity_key=$2 AND insight=$3 LIMIT 1`, [type, key, insight]); }
    catch (_) { hit = await sql.query(`SELECT content FROM ai_insights WHERE entity_type=$1 AND entity_key=$2 AND insight=$3 LIMIT 1`, [type, key, insight]); }
  }
  if (hit.length) return { content: hit[0].content, sources: hit[0].sources || [], cached: true, generatedAt: hit[0].created_at || null };

  // 2. Budget → grounding decision (never pause; abuse backstop only).
  const day = new Date().toISOString().slice(0, 10);
  let usage = [];
  try { usage = await sql.query(`SELECT calls, searches FROM ai_usage WHERE day=$1`, [day]); }
  catch (_) { usage = await sql.query(`SELECT calls FROM ai_usage WHERE day=$1`, [day]); }
  const calls = (usage[0] && Number(usage[0].calls)) || 0;
  const searchesSoFar = (usage[0] && Number(usage[0].searches)) || 0;
  if (calls >= ABS_CAP) return { capped: true };
  // Ground only while the day's search-query count is under budget; once we'd
  // risk crossing the free tier, generate ungrounded (free) instead.
  const useGrounding = GROUNDING && lensGrounded && searchesSoFar < SEARCH_BUDGET;

  // 3. Prompt.
  let prompt; let maxTokens;
  if (type === 'news') { prompt = newsPrompt(entity); maxTokens = 900; }
  else if (type === 'trend') { prompt = trendPrompt(entity.query, await trendContext(sql, entity.query)); maxTokens = 500; }
  else {
    prompt = overviewPrompt(entity.topic, entity.group, entity.sections, useGrounding);
    maxTokens = Math.min(300 + 170 * entity.sections.length, 3600);
  }

  // 4. Generate; grounded → empty/error falls back to ungrounded.
  let out = null;
  let wasGrounded = useGrounding;
  try { out = await generate(prompt, { grounded: useGrounding, model: INSIGHT_MODEL, maxTokens }); }
  catch (_) { out = null; }
  if (useGrounding && (!out || !out.text)) {
    wasGrounded = false; // fell back to a plain (unbilled-for-grounding) call
    try { out = await generate(prompt, { grounded: false, model: INSIGHT_MODEL, maxTokens }); }
    catch (_) { out = null; }
  }
  if (!out || !out.text) return { unavailable: true };
  const sources = out.citations || [];

  // 5. Store (resilient) + account spend.
  try {
    await sql.query(
      `INSERT INTO ai_insights (entity_type, entity_key, insight, content, model, sources)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (entity_type, entity_key, insight)
       DO UPDATE SET content=EXCLUDED.content, model=EXCLUDED.model, sources=EXCLUDED.sources, created_at=now()`,
      [type, key, insight, out.text, INSIGHT_MODEL, JSON.stringify(sources)]);
  } catch (_) {
    await sql.query(
      `INSERT INTO ai_insights (entity_type, entity_key, insight, content, model)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (entity_type, entity_key, insight)
       DO UPDATE SET content=EXCLUDED.content, model=EXCLUDED.model, created_at=now()`,
      [type, key, insight, out.text, INSIGHT_MODEL]);
  }
  // Account spend. Grounding is billed per search query past the day's free
  // tier; searchesSoFar is read pre-increment, so only queries beyond
  // GROUNDING_FREE are charged. With SEARCH_BUDGET < GROUNDING_FREE this is
  // normally 0 — it keeps the log honest if the budget is ever raised. Token
  // micros come from generate().
  const thisSearches = wasGrounded ? (out.searches || 0) : 0;
  const billable = Math.max(0, Math.min(thisSearches, searchesSoFar + thisSearches - GROUNDING_FREE));
  const groundFee = billable * GROUNDING_PER_SEARCH_MICROS;
  const totalMicros = (out.micros || 0) + groundFee;
  try {
    await sql.query(
      `INSERT INTO ai_usage (day, calls, grounded, searches, in_tok, out_tok, est_cost_micros)
       VALUES ($1, 1, $2, $3, $4, $5, $6)
       ON CONFLICT (day) DO UPDATE SET
         calls           = ai_usage.calls + 1,
         grounded        = ai_usage.grounded + $2,
         searches        = ai_usage.searches + $3,
         in_tok          = ai_usage.in_tok + $4,
         out_tok         = ai_usage.out_tok + $5,
         est_cost_micros = ai_usage.est_cost_micros + $6`,
      [day, wasGrounded ? 1 : 0, thisSearches, out.inTok || 0, out.outTok || 0, totalMicros]);
  } catch (_) {
    // Pre-migration fallback: new columns may not exist yet.
    await sql.query(
      `INSERT INTO ai_usage (day, calls, est_cost_micros) VALUES ($1, 1, $2)
       ON CONFLICT (day) DO UPDATE SET calls=ai_usage.calls+1, est_cost_micros=ai_usage.est_cost_micros+$2`,
      [day, totalMicros]);
  }

  return { content: out.text, sources, cached: false, generatedAt: new Date().toISOString() };
}

module.exports = { generateInsight };
