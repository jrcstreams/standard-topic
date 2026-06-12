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
const { parseTrendBrief } = require('./parse-trend-brief');
const templates = require('../data/insight-templates.json');

// 800 keeps the ~400-overview corpus + daily refresh + news/trends grounded
// while staying inside Gemini's grounding free tier (1,500/day); the hourly
// cron run budget bounds real volume well below this anyway.
const ABS_CAP = parseInt(process.env.AI_DAILY_CAP_CALLS || '5000', 10);
// Token model. flash-lite ($0.10 in / $0.40 out per 1M) is ~6x cheaper on
// output than flash and is plenty for these grounded briefs. Flip
// GEMINI_INSIGHT_MODEL to gemini-2.5-flash if you ever want richer synthesis.
const INSIGHT_MODEL = process.env.GEMINI_INSIGHT_MODEL || 'gemini-2.5-flash-lite';
// The broad "discover" overviews (Global Headlines / What's Happening) are the
// most news-synthesis-heavy and benefit most from a stronger model. Gemini 2.5
// Flash is ~1.5x flash-lite (not the old 6x) and keeps free Google grounding, so
// we use it for discover only. Env-overridable; set to flash-lite to revert.
const INSIGHT_MODEL_DISCOVER = process.env.GEMINI_INSIGHT_MODEL_DISCOVER || 'gemini-2.5-flash';
function modelFor(type, group) {
  return (type === 'shortcut' && group === 'discover') ? INSIGHT_MODEL_DISCOVER : INSIGHT_MODEL;
}
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

// Human-readable current date+time, injected into every prompt so the model
// anchors to "now" and treats Google Search results as current — without this,
// the base model defaults to its training-cutoff knowledge and writes stale
// (old-year) briefs as if they were current. Time + timezone (ET) are included
// so the model can reason about same-day recency (e.g. whether a game/event has
// already happened) rather than just the calendar date.
function todayLabel() {
  return new Date().toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short',
  });
}

// Specificity-or-omit + no-hedge + tense rules. Shared across every brief so
// the model stops emitting plausible-sounding filler ("tensions remain high",
// "a natural disaster") when it has no concrete fact, and stops describing
// already-happened events as upcoming. Shorter-but-concrete beats long-but-vague.
const SPECIFICITY_RULES = [
  `SPECIFICITY: every sentence must name a specific event, person, organization, place, number, or date. If you cannot make a claim specific, OMIT it — never write filler like "tensions remain high", "various factors", "a natural disaster", "major developments", "some experts", or "significant changes". A shorter brief containing only concrete facts is the correct outcome; vague padding is a failure.`,
  `TENSE: describe events as they actually stand as of the current datetime above. If something has already happened, state it in the past tense — never describe a past event as upcoming or still in progress. The live search results reflect the present; trust them over any older assumption.`,
].join('\n');

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
  return { category, breakdown };
}

// Recent stories from our own news feed that match a trending term. Returned to
// the client as related "In the news" links (so trends get the same grounded,
// real-headline treatment as News + AI Intelligence) AND their titles are fed
// into the prompt as source material. Fetched fresh at read time so the related
// list stays current even when the brief itself is cached.
async function trendStories(sql, query) {
  if (!query) return [];
  try {
    const h = await sql.query(
      `SELECT title, url, source_name, published_at FROM news_stories WHERE search_vector @@ websearch_to_tsquery('english', $1)
        ORDER BY published_at DESC NULLS LAST LIMIT 8`, [query]);
    return h.filter((x) => x && x.title && x.url);
  } catch (_) { return []; }
}
// Related coverage for a news story: other articles in our feed matching the
// story's title keywords, newest/most-relevant first (excludes the exact story).
// Returns rich rows (title + publisher + date) for the "Sources & Coverage" list.
const NEWS_STOP = new Set(['the','and','for','with','from','that','this','have','has','had','will','its','are','was','were','new','how','why','who','what','when','where','over','into','out','about','after','amid','says','said','more','than','then','your','their','they','them','but','not','you','our']);
function titleTsQuery(title) {
  const words = String(title || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  const terms = [...new Set(words.filter((w) => !NEWS_STOP.has(w)))].slice(0, 8);
  return terms.length ? terms.join(' | ') : '';
}
async function newsRelated(sql, title, excludeUrl) {
  const q = titleTsQuery(title);
  if (!q) return [];
  try {
    const h = await sql.query(
      `SELECT title, url, source_name, published_at,
              ts_rank(search_vector, to_tsquery('english', $1)) AS rank
         FROM news_stories
        WHERE search_vector @@ to_tsquery('english', $1) AND url <> $2
        ORDER BY rank DESC, coalesce(published_at, fetched_at) DESC NULLS LAST
        LIMIT 24`, [q, excludeUrl || '']);
    const rows = h.filter((x) => x && x.title && x.url);
    if (!rows.length) return [];
    // The tsquery is an OR of the title's key words, so a story sharing a single
    // common word still matches — but ranks far below stories about the SAME
    // event. Keep only rows close to the best match (relative floor) and clearing
    // an absolute floor, so the long tail of one-word matches is dropped entirely
    // rather than padding the list with irrelevant stories (#83).
    const top = Number(rows[0].rank) || 0;
    const floor = Math.max(top * 0.5, 0.03);
    return rows.filter((r) => (Number(r.rank) || 0) >= floor).slice(0, 8);
  } catch (_) { return []; }
}

function trendPrompt(query, ctx) {
  const lines = [
    `Today is ${todayLabel()}. You are explaining why a search term is trending RIGHT NOW. Return EXACTLY two labeled parts and nothing else:`,
    `SUMMARY: one sentence (max ~20 words) plainly stating why "${query}" is trending right now.`,
    `DETAIL: 3-5 sentences (plain prose, NO headers/markdown): what it is, why it is trending right now (what just happened in the days leading up to today), and brief context.`,
    `Use Google Search for the latest information and rely on those results over your own prior knowledge — do not assume an older year or stale facts. The current state may differ from what you remember (scores, outcomes, standings, releases change) — report what the search results show as of right now. If you genuinely cannot tell what it refers to, say so and name the likely category; do NOT invent.`,
    SPECIFICITY_RULES,
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
    SPECIFICITY_RULES,
    `Format EXACTLY as these four sections, IN THIS ORDER, each starting with the label on its own line ("### What Happened", etc.), followed by 1-3 sentences (Key Takeaways as "- " bullet lines):`,
    `### What Happened`, `### Key Takeaways`, `### Why It Matters`, `### Timeline`,
    ``,
    `Story: "${e.title}"`,
    e.description ? `Summary: ${e.description}` : '',
    e.url ? `Source: ${e.url}` : '',
  ].filter(Boolean).join('\n');
}

// Filler words in shortcut/section names that aren't useful search terms.
const SECTION_FILLER = new Set(['watch', 'tracker', 'roundup', 'update', 'updates', 'snapshot', 'pulse', 'spotlight', 'report', 'reports', 'briefing', 'overview', 'news', 'the', 'and', 'for', 'this', 'that', 'with', 'from', 'your', 'today', 'daily', 'weekly', 'latest', 'check', 'deep', 'dive', 'guide', 'explained', 'digest', 'recap', 'insights', 'insight', 'analysis', 'global', 'current', 'live', 'now', 'active', 'key', 'top', 'big', 'best', 'major', 'numbers', 'roundtable', 'tracker', 'watchlist', 'review', 'rundown', 'briefs', 'brief']);

// Turn a section name into an OR tsquery of its meaningful words, e.g.
// "Severe Weather Watch" -> "severe | weather". '' when nothing useful remains
// (vague names like "Numbers in the News" — those sections lean on citations).
function sectionTsQuery(name) {
  const words = (String(name || '').toLowerCase().match(/[a-z0-9]{2,}/g) || [])
    .filter((w) => !SECTION_FILLER.has(w));
  return [...new Set(words)].slice(0, 6).join(' | ');
}

// Flatten a per-section headline map into a deduped flat list (for the prompt
// source-material block + the no-grounding sources fallback).
function flattenHeadlineMap(map) {
  if (Array.isArray(map)) return map;
  const out = []; const seen = new Set();
  for (const k of Object.keys(map || {})) {
    for (const h of (map[k] || [])) {
      const u = (h.url || '').toLowerCase();
      if (u && !seen.has(u)) { seen.add(u); out.push(h); }
    }
  }
  return out;
}

// Real headlines from our own news feed, matched PER SECTION (so each insight's
// "In the news" shows stories about IT, not a shared pool) and fed into the
// overview prompt as source material. One LATERAL round-trip: for each section,
// the top stories whose full-text matches the section's keyworded name, ranked by
// relevance + recency. Returns { sectionName: [{title,url}] }. Skipped for the
// evergreen Learn lens. Zero Google cost — pure Postgres on our own feed.
async function overviewHeadlines(sql, scope, group, sections) {
  const out = {};
  if (group === 'learn') return out;
  const topic = resolveTopic(scope);
  if (!topic || !Array.isArray(sections) || !sections.length) return out;
  const entries = [];
  for (const s of sections) {
    const q = sectionTsQuery(s && s.name);
    if (q) entries.push({ name: s.name, q });
  }
  if (!entries.length) return out;
  const names = entries.map((e) => e.name);
  const queries = entries.map((e) => e.q);
  try {
    const rows = topic.slug === 'home'
      ? await sql.query(
        `SELECT s.name AS section, ns.title, ns.url, ns.source_name, ns.published_at
           FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS s(name, q, ord)
           CROSS JOIN LATERAL (
             SELECT title, url, source_name, published_at FROM news_stories
              WHERE search_vector @@ to_tsquery('english', s.q)
                AND coalesce(published_at, fetched_at) > now() - interval '96 hours'
              ORDER BY ts_rank(search_vector, to_tsquery('english', s.q)) DESC,
                       coalesce(published_at, fetched_at) DESC NULLS LAST
              LIMIT 6) ns`, [names, queries])
      : await sql.query(
        `SELECT s.name AS section, ns.title, ns.url, ns.source_name, ns.published_at
           FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS s(name, q, ord)
           CROSS JOIN LATERAL (
             SELECT ns.title, ns.url, ns.source_name, ns.published_at FROM news_stories ns
               JOIN topics tp ON tp.id = ns.topic_id
              WHERE tp.slug = $1
                AND ns.search_vector @@ to_tsquery('english', s.q)
                AND coalesce(ns.published_at, ns.fetched_at) > now() - interval '168 hours'
              ORDER BY ts_rank(ns.search_vector, to_tsquery('english', s.q)) DESC,
                       coalesce(ns.published_at, ns.fetched_at) DESC NULLS LAST
              LIMIT 6) ns`, [topic.slug, names, queries]);
    for (const r of rows) {
      if (!r.url) continue;
      (out[r.section] || (out[r.section] = [])).push({ title: r.title || '', url: r.url, source: r.source_name || '', date: r.published_at || '' });
    }
  } catch (_) { return {}; }
  return out;
}

// Clean a raw "## …"/"### …"/"**## …**" header line into the bare section name
// (same rules the client splitSections uses, so the map keys match what the UI
// parses from the stored content).
function cleanSectionName(raw) {
  return String(raw || '')
    .replace(/\*\*/g, '')
    .replace(/\s*[—–-]\s*section brief\s*:.*/i, '')
    .replace(/[:#\s]+$/, '')
    .trim();
}

// Attribute grounding chunks to the section whose text they support, returning
// { sectionName: [{title,uri}] }. Gemini's groundingSupports give a byte span
// (segment.startIndex/endIndex into the response) + the chunk indices backing
// it; we bucket each support into the section header it falls under. Works on
// the RAW model text (pre-normalization) since the support offsets index that.
// Returns null when there are no supports/chunks (caller keeps the flat list).
function attributeSourcesBySection(text, meta) {
  const chunks = (meta && meta.groundingChunks) || [];
  const supports = (meta && meta.groundingSupports) || [];
  if (!chunks.length || !supports.length) return null;
  // Header byte offsets (grounding offsets are UTF-8 byte positions).
  const re = /^[ \t]*(?:\*\*)?#{2,3}\s+(.+?)\s*$/gm;
  const heads = []; let m;
  while ((m = re.exec(text))) {
    heads.push({ name: cleanSectionName(m[1]), byte: Buffer.byteLength(text.slice(0, m.index)) });
  }
  if (!heads.length) return null;
  const sectionAt = (byteIdx) => {
    let name = heads[0].name;
    for (const h of heads) { if (byteIdx >= h.byte) name = h.name; else break; }
    return name;
  };
  const bySection = {};
  for (const sup of supports) {
    const seg = sup.segment || {};
    const idx = typeof seg.startIndex === 'number' ? seg.startIndex
      : (typeof seg.endIndex === 'number' ? seg.endIndex : null);
    if (idx == null) continue;
    const name = sectionAt(idx);
    const arr = bySection[name] || (bySection[name] = []);
    for (const ci of (sup.groundingChunkIndices || [])) {
      const w = chunks[ci] && chunks[ci].web;
      if (w && w.uri) arr.push({ title: w.title || '', uri: w.uri });
    }
  }
  // Dedup per section (cap 8).
  for (const k of Object.keys(bySection)) {
    const seen = new Set();
    bySection[k] = bySection[k].filter((s) => s.uri && !seen.has(s.uri) && seen.add(s.uri)).slice(0, 8);
  }
  // Drop empty buckets; null if nothing attributed.
  for (const k of Object.keys(bySection)) if (!bySection[k].length) delete bySection[k];
  return Object.keys(bySection).length ? bySection : null;
}

// Group overview: ONE generation per (scope, group), with one "## <name>"
// section per shortcut in that group — the shortcut prompts are the section
// briefs. Template (incl. format rules) lives in data/insight-templates.json.
function overviewPrompt(scope, group, sections, grounded, headlines) {
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
  // Real, current headlines from our feed = primary source material. Anchors the
  // synthesis to concrete stories (kills the "a natural disaster in South America"
  // hedge) and gives the model real titles/URLs to reference.
  const headlineBlock = (headlines && headlines.length)
    ? `\n\nCURRENT HEADLINES from our news feed (newest first). Treat these as your primary, current source material — build the time-sensitive sections from these concrete stories and reference them by name; prefer them over memory:\n${headlines.map((h, i) => `${i + 1}. ${h.title}${h.url ? ` — ${h.url}` : ''}`).join('\n')}`
    : '';
  return (grounded
    ? `${body}\nUse Google Search for the most current facts as of today and rely on those results over your own prior knowledge — every date, name, and event must be current, not from an earlier year. Cite the sources you used.`
    : body) + headlineBlock;
}

// True when a brief carries no grounding citations. `sources` is a flat array
// (news/trend) or a per-section map (overviews); both forms can be empty.
function sourcesEmpty(s) {
  if (!s) return true;
  if (Array.isArray(s)) return s.length === 0;
  if (typeof s === 'object') { const v = Object.values(s); return !v.length || v.every((x) => !Array.isArray(x) || !x.length); }
  return true;
}

// True when there's still room under today's grounded-search budget — i.e. a
// regeneration right now would actually be grounded (and produce citations)
// rather than falling back to an ungrounded, sourceless call. Used to gate the
// "re-ground a sourceless brief" healing so we never burn tokens re-generating
// something that would STILL come back without sources. Conservative: any doubt
// (grounding off, can't read usage) → false, so healing simply waits for a day
// with headroom. This is what makes the heal STRATEGIC: it only spends grounding
// when grounding is available, and otherwise leaves the work for later.
async function groundingHeadroom(sql) {
  if (!sql || !GROUNDING) return false;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const r = await sql.query(`SELECT searches FROM ai_usage WHERE day=$1`, [day]);
    const s = (r[0] && Number(r[0].searches)) || 0;
    return s < SEARCH_BUDGET;
  } catch (_) { return false; }
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

  // Real headlines for shortcut overviews. Fed into the prompt at generation AND
  // returned to the client so the AI Intelligence section can render a clean
  // "In the news" link list under the synthesized intro. Fetched fresh at read
  // time (not stored with the brief) so the list stays current even when the
  // brief itself is served from cache. Empty for non-shortcut types and Learn.
  const overviewHeadsMap = type === 'shortcut' ? await overviewHeadlines(sql, entity.topic, entity.group, entity.sections) : {};
  const overviewHeadsFlat = flattenHeadlineMap(overviewHeadsMap);
  const trendRelated = type === 'trend' ? await trendStories(sql, entity.query) : [];
  const newsRel = type === 'news' ? await newsRelated(sql, entity.title, entity.url) : [];
  // Display payload: a per-section { name: [{title,url,source,date}] } MAP for
  // overviews (so each insight shows its own stories), a flat rich list for
  // trends + news ("Sources & Coverage" → title + publisher · date).
  const headlinesOut = (type === 'trend' || type === 'news')
    ? (type === 'trend' ? trendRelated : newsRel).map((h) => ({ title: h.title || '', url: h.url || '', source: h.source_name || '', date: h.published_at || '' })).filter((h) => h.url)
    : overviewHeadsMap;

  // 1. Cache.
  const refresh = input.refresh === '1' || input.refresh === 1 || input.refresh === true;
  let hit = [];
  if (!refresh) {
    try { hit = await sql.query(`SELECT content, summary, sources, created_at FROM ai_insights WHERE entity_type=$1 AND entity_key=$2 AND insight=$3 LIMIT 1`, [type, key, insight]); }
    catch (_) { hit = await sql.query(`SELECT content FROM ai_insights WHERE entity_type=$1 AND entity_key=$2 AND insight=$3 LIMIT 1`, [type, key, insight]); }
  }
  if (hit.length) return { content: hit[0].content, summary: hit[0].summary || null, sources: hit[0].sources || [], headlines: headlinesOut, cached: true, generatedAt: hit[0].created_at || null };

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
  else if (type === 'trend') {
    const tctx = await trendContext(sql, entity.query);
    tctx.headlines = trendRelated.map((s) => s.title).slice(0, 5);
    prompt = trendPrompt(entity.query, tctx);
    maxTokens = 500;
  }
  else {
    prompt = overviewPrompt(entity.topic, entity.group, entity.sections, useGrounding, overviewHeadsFlat);
    // ~280 tokens/section so each section in a multi-section group brief gets a
    // substantive answer instead of a starved one-liner (groups can have 6-16
    // sections). flash-lite supports up to 8k output.
    maxTokens = Math.min(350 + 280 * entity.sections.length, 6000);
  }

  const genModel = modelFor(type, type === 'shortcut' ? entity.group : null);

  // 4. Generate; grounded → empty/error falls back to ungrounded.
  let out = null;
  let wasGrounded = useGrounding;
  try { out = await generate(prompt, { grounded: useGrounding, model: genModel, maxTokens }); }
  catch (_) { out = null; }
  if (useGrounding && (!out || !out.text)) {
    wasGrounded = false; // fell back to a plain (unbilled-for-grounding) call
    try { out = await generate(prompt, { grounded: false, model: genModel, maxTokens }); }
    catch (_) { out = null; }
  }
  if (!out || !out.text) return { unavailable: true };
  let sources = out.citations || [];
  // Per-section source attribution for overviews: one group generation pools
  // citations across ALL its "## sections", so showing that flat list under a
  // single drilled-in section mixes in other sections' sources. Gemini's
  // groundingSupports map each text span → the chunks that support it, so we
  // attribute every chunk to the section its span falls in and store a
  // { sectionName: [sources] } MAP instead of one flat list.
  if (type === 'shortcut') {
    const bySection = attributeSourcesBySection(out.text, out.meta);
    if (bySection) sources = bySection;
    else if (!sources.length && overviewHeadsFlat.length) {
      // No grounding chunks → fall back to the real headlines we fed (flat;
      // can't attribute input headlines to a section). Better than empty.
      sources = overviewHeadsFlat.slice(0, 8).map((h) => ({ title: h.title || '', uri: h.url || '' })).filter((s) => s.uri);
    }
  }

  // Trends now generate "SUMMARY: …\nDETAIL: …" — split into the one-liner shown
  // on the homepage list and the full body. Other types store the text as-is.
  let content = out.text;
  // The model sometimes bold-wraps section headers (**## Name**) or uses ###,
  // which breaks the "## " section parser downstream. Normalize to "## Name".
  if (type === 'shortcut') {
    content = content
      .replace(/^[ \t]*\*\*\s*(#{2,3})\s+(.+?)\s*\*\*[ \t]*$/gm, '## $2')
      .replace(/^[ \t]*###\s+(.+)$/gm, '## $1')
      // Strip any "— section brief: <prompt>" the model echoed from the
      // scaffold into a "## Name …" header line.
      .replace(/^([ \t]*##\s+.+?)\s*[—–-]\s*section brief\s*:.*$/gim, '$1');
  }
  let summary = null;
  if (type === 'trend') {
    const parsed = parseTrendBrief(out.text);
    content = parsed.content || out.text;
    summary = parsed.summary || null;
  }

  // 5. Store (resilient) + account spend.
  try {
    await sql.query(
      `INSERT INTO ai_insights (entity_type, entity_key, insight, content, summary, model, sources)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (entity_type, entity_key, insight)
       DO UPDATE SET content=EXCLUDED.content, summary=EXCLUDED.summary, model=EXCLUDED.model, sources=EXCLUDED.sources, created_at=now()`,
      [type, key, insight, content, summary, genModel, JSON.stringify(sources)]);
  } catch (_) {
    await sql.query(
      `INSERT INTO ai_insights (entity_type, entity_key, insight, content, model)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (entity_type, entity_key, insight)
       DO UPDATE SET content=EXCLUDED.content, model=EXCLUDED.model, created_at=now()`,
      [type, key, insight, content, genModel]);
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

  return { content, summary, sources, headlines: headlinesOut, cached: false, generatedAt: new Date().toISOString() };
}

module.exports = { generateInsight, sourcesEmpty, groundingHeadroom };
