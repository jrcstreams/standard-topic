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
// Real-time surfaces — the trend "why is this trending right now" reasoning and
// the per-story news insights — are the MOST freshness-sensitive and the ones
// most often wrong on flash-lite. Promote them to flash for stronger synthesis +
// more reliable grounding. Env-overridable; set to gemini-2.5-flash-lite to revert.
const INSIGHT_MODEL_REALTIME = process.env.GEMINI_INSIGHT_MODEL_REALTIME || 'gemini-2.5-flash';
function modelFor(type, group) {
  return (type === 'shortcut' && group === 'discover') ? INSIGHT_MODEL_DISCOVER : INSIGHT_MODEL;
}
// Thinking budget for GROUNDED calls. Gemini 2.5 decides to invoke the
// google_search tool DURING its thinking phase, so with thinkingBudget:0 the live
// search frequently never fires and the model answers from stale training data —
// the likely root cause of trend reasoning being wrong and briefs reading
// outdated despite a recent timestamp. A modest budget makes grounding fire
// reliably and lets the model reason over the results. Ungrounded calls keep
// budget 0 (nothing to search). A/B REVERT: set AI_THINKING_BUDGET=0.
const GROUNDED_THINKING = parseInt(process.env.AI_THINKING_BUDGET || '768', 10);
// Builders synthesize 3-5 in-depth sections — a little more room to think.
const BUILDER_THINKING = parseInt(process.env.AI_BUILDER_THINKING_BUDGET || '1024', 10);
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
// Two ceilings so the freshness-critical, most-VISIBLE surfaces never get starved
// by the bulk evergreen pre-generation. The real-time surfaces (a trend's "why is
// this trending", a per-story news brief) may ground right up to SEARCH_BUDGET
// (just under the 1,500/day free tier). The evergreen shortcut/builder OVERVIEWS
// stop grounding earlier (SEARCH_OVERVIEW_BUDGET), reserving the gap between the two
// for real-time — so a busy pregenerate cron can't blow the whole day's grounding on
// overviews and leave trends/news to hallucinate ungrounded (the root of the
// "Copa América / Argentina beat Spain in the final" fabrications). Env-overridable.
const SEARCH_BUDGET = parseInt(process.env.AI_GROUNDED_SEARCH_BUDGET || '1450', 10);
const SEARCH_OVERVIEW_BUDGET = parseInt(process.env.AI_GROUNDED_OVERVIEW_BUDGET || '1100', 10);
const GROUNDING_PER_SEARCH_MICROS = parseInt(process.env.GEMINI_SEARCH_MICROS || '35', 10);
const GROUNDING = process.env.AI_GROUNDING !== '0';

// Trend RAG (option 1): generate a trend's "why it's trending" from REAL current
// facts — our own news feed first (free), then a SerpAPI Google News lookup when
// the feed is thin — written by an ungrounded model call, instead of spending
// Gemini's metered Google-Search grounding. This keeps trend summaries accurate
// after the daily grounding free tier is exhausted (the root cause of the trend
// hallucinations) AND frees that whole budget for other surfaces. Default ON;
// set AI_TREND_RAG=0 to A/B back to the old grounded path. TREND_RAG_MIN_DB is
// how many strong matches our own feed must yield before we SKIP the SerpAPI
// call (keeps SerpAPI spend low — most trends are already covered by our feed).
const TREND_RAG = process.env.AI_TREND_RAG !== '0';
const TREND_RAG_MIN_DB = parseInt(process.env.AI_TREND_RAG_MIN_DB || '2', 10);
// Reach for the (fresher) SerpAPI News lookup not only when our feed is THIN, but
// also when its newest matching story is STALE — our news cron runs every 6h, so a
// fast-moving trend (a game result, a breaking development) would otherwise be
// summarized from hours-old coverage and miss the very thing driving it now (the
// "Argentina will play England next" staleness). Env-tunable to trade SerpAPI spend
// vs freshness: higher = fewer SerpAPI calls but staler; lower = fresher, more calls.
const TREND_RAG_FRESH_HOURS = parseInt(process.env.AI_TREND_RAG_FRESH_HOURS || '5', 10);
const SERP_BASE = 'https://serpapi.com/search.json';

// All lens groups are grounded so every shortcut overview is anchored to live
// search results (current facts + citations). Learn is more evergreen, but
// grounding it still yields sources and keeps dates honest.
const LENS_GROUNDED = { discover: true, learn: true, 'topic-specific': true };

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

// Anti-fabrication guard applied to UNGROUNDED calls (grounding budget spent, or
// grounding returned nothing). Without live search the model will otherwise obey
// SPECIFICITY_RULES by inventing a plausible-but-false specific — a made-up
// tournament, score, opponent, venue, or "just happened" event (the "Messi wife /
// Copa América 2-0 vs Canada at MetLife" hallucination). This overrides that: name
// specifics ONLY from the concrete context/headlines provided in the prompt;
// otherwise identify the term generically and say the latest specifics can't be
// confirmed. A short hedged-but-true brief beats a confident wrong one.
const NO_FABRICATION = `NO LIVE SEARCH available for this answer — you must NOT browse and must NOT pretend you did. Do NOT invent or guess ANY current specific you cannot support from the concrete context/headlines given above: no scores, results, opponents, venues, dates, statistics, rankings, or "just happened"/"today" events. Manufacturing a plausible-but-unverified specific (a match result, a tournament that may not currently exist, a named event) is the WORST possible failure here. If the provided context does not establish the current reason, state plainly and briefly what the term generally refers to and that the latest specifics cannot be confirmed right now — do not fill the gap with a guess.`;

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
  // Same relevance approach as newsRelated() (defined just below): an OR tsquery
  // of the trend's key words, then keep only stories sharing >=2 of them (or one
  // distinctive 6+ char term). websearch_to_tsquery's strict AND returned nothing
  // for most multi-word trends, so trends fell back to bare grounding domains.
  const terms = titleTerms(query);
  if (!terms.length) return [];
  const q = terms.join(' | ');
  try {
    const h = await sql.query(
      `SELECT title, url, source_name, published_at,
              ts_rank(search_vector, to_tsquery('english', $1)) AS rank
         FROM news_stories WHERE search_vector @@ to_tsquery('english', $1)
        ORDER BY rank DESC, published_at DESC NULLS LAST LIMIT 30`, [q]);
    const rows = h.filter((x) => x && x.title && x.url);
    const scored = rows.map((r) => {
      const lc = String(r.title).toLowerCase();
      const matched = terms.filter((t) => lc.includes(t));
      // A "strong" (distinctive) single-term match: a 6+ char term that ISN'T the
      // FIRST word of a multi-word trend. The first word of a person-trend is usually
      // a common first name ("Justin" in "Justin Verlander") — matching that alone
      // dragged in every unrelated "Justin ___" story; the surname is the distinctive
      // bit (#img464/465).
      const strong = matched.some((m) => m.length >= 6 && (terms.length === 1 || m !== terms[0]));
      return { r, n: matched.length, strong };
    });
    return scored.filter((s) => s.n >= 2 || (s.n >= 1 && s.strong)).slice(0, 8).map((s) => s.r);
  } catch (_) { return []; }
}

// On-demand SerpAPI Google News lookup for a trending TERM — the RAG fallback
// when our own news_stories feed has no strong match (e.g. a brand-new person
// trend like "Messi Wife" that no headline in our feed mentions). Returns real,
// current articles we feed to the model as ground truth. This runs on a DIFFERENT
// budget than Gemini grounding, which is exactly what keeps trend summaries
// accurate after the Gemini free tier is spent. No key / non-2xx / error => [].
async function serpTrendNews(query, limit = 6) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey || !String(query || '').trim()) return [];
  try {
    const url = `${SERP_BASE}?engine=google_news&q=${encodeURIComponent(query)}&gl=us&hl=en&api_key=${encodeURIComponent(apiKey)}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    const data = await r.json();
    const list = Array.isArray(data.news_results) ? data.news_results : [];
    // google_news groups some items under a "stories" array (a topic cluster);
    // flatten one level so we surface the individual articles.
    const flat = [];
    for (const it of list) {
      if (it && it.title && it.link) flat.push(it);
      if (Array.isArray(it && it.stories)) for (const s of it.stories) if (s && s.title && s.link) flat.push(s);
    }
    const seen = new Set();
    return flat
      .map((s) => ({
        title: String(s.title || ''),
        url: String(s.link || ''),
        source: (s.source && (s.source.name || s.source)) || '',
        date: s.date || '',
        snippet: String(s.snippet || ''),
      }))
      .filter((s) => s.url && s.title && !seen.has(s.url) && seen.add(s.url))
      .slice(0, limit);
  } catch (_) { return []; }
}

// Relevance gate for gathered trend facts (#img601): an article may only serve as
// evidence when it is actually ABOUT the trending term — the full query phrase
// (stopwords stripped) appears in its title/snippet, or it shares 2+ of the
// query's key words, or it matches one of the trend's own related searches
// (breakdown). This is what stops a lone "…Williams…" headline about a different
// Williams, or any article that merely contains one shared word, from becoming
// the "reason" a term is trending. SerpAPI results get the SAME gate — they were
// previously passed through unfiltered.
function scoreTrendFact(f, phrase, terms, breakdownPhrases) {
  const hay = `${f.title || ''} ${f.snippet || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const phraseHit = phrase.length > 2 && hay.includes(phrase);
  const termHits = terms.filter((t) => hay.includes(t)).length;
  const breakdownHit = breakdownPhrases.some((b) => b && hay.includes(b));
  const keep = phraseHit || termHits >= 2 || (termHits >= 1 && breakdownHit) || (terms.length === 1 && termHits >= 1);
  return { keep, weight: (phraseHit ? 4 : 0) + (breakdownHit ? 2 : 0) + termHits };
}
// Gather real, current facts for a trending term to ground its summary WITHOUT
// spending Gemini's grounding budget: our own news feed first (free), then a
// SerpAPI Google News lookup ONLY when the feed yields fewer than TREND_RAG_MIN_DB
// strong matches. Returns { facts:[{title,url,source,date,snippet}], fromSerp }.
// HARD daily budget for SerpAPI trend lookups (#serpburn): whatever else goes
// wrong upstream (heal loops, cron sweeps, traffic spikes), we never spend more
// than this many searches per UTC day. Checked against our own usage log, so it
// needs no SerpAPI round-trip. Env-tunable.
const SERP_TREND_DAILY_BUDGET = Number(process.env.SERP_TREND_DAILY_BUDGET || 40);
async function serpBudgetLeft(sql) {
  if (!sql) return false;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const r = await sql.query(
      `SELECT searches FROM ai_usage_surface WHERE day = $1 AND surface = 'serp:trend-news'`, [day]);
    const used = r && r[0] ? Number(r[0].searches) || 0 : 0;
    return used < SERP_TREND_DAILY_BUDGET;
  } catch (_) { return false; }  // can't verify → don't spend
}
async function gatherTrendFacts(sql, query, breakdown) {
  let stories = [];
  try { stories = await trendStories(sql, query); } catch (_) { stories = []; }
  const dbFacts = stories
    .map((s) => ({ title: s.title || '', url: s.url || '', source: s.source_name || '', date: s.published_at || '', snippet: '' }))
    .filter((f) => f.url && f.title);
  // Newest DB fact age → decide whether our own feed is fresh enough or we need a
  // live SerpAPI lookup (thin coverage OR stale coverage both trigger it).
  const newestMs = dbFacts.reduce((mx, f) => {
    const t = f.date ? Date.parse(f.date) : NaN;
    return Number.isFinite(t) ? Math.max(mx, t) : mx;
  }, 0);
  const stale = !newestMs || (Date.now() - newestMs > TREND_RAG_FRESH_HOURS * 3600 * 1000);
  let serp = [];
  if ((dbFacts.length < TREND_RAG_MIN_DB || stale) && await serpBudgetLeft(sql)) {
    serp = await serpTrendNews(query, 6);
  }
  const fromSerp = serp.length > 0;
  // Relevance-gate EVERYTHING (SerpAPI included), then let clearly-on-topic
  // (phrase/breakdown) articles outrank one-word matches. SerpAPI still leads
  // within the same weight band (freshest live coverage first).
  const phrase = titleTerms(query).join(' ');
  const terms = titleTerms(query);
  const breakdownPhrases = (Array.isArray(breakdown) ? breakdown : [])
    .slice(0, 10).map((b) => String(b || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).filter((b) => b.length > 2);
  const seen = new Set();
  const scored = [];
  for (const f of [...serp, ...dbFacts]) {
    if (!f.url || seen.has(f.url)) continue;
    seen.add(f.url);
    const s = scoreTrendFact(f, phrase, terms, breakdownPhrases);
    if (s.keep) scored.push({ f, w: s.weight, i: scored.length });
  }
  scored.sort((a, b) => (b.w - a.w) || (a.i - b.i));
  return { facts: scored.slice(0, 8).map((x) => x.f), fromSerp };
}

// Related coverage for a news story: other articles in our feed matching the
// story's title keywords, newest/most-relevant first (excludes the exact story).
// Returns rich rows (title + publisher + date) for the "Sources & Coverage" list.
const NEWS_STOP = new Set(['the','and','for','with','from','that','this','have','has','had','will','its','are','was','were','new','how','why','who','what','when','where','over','into','out','about','after','amid','says','said','more','than','then','your','their','they','them','but','not','you','our']);
function titleTerms(title) {
  const words = String(title || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  return [...new Set(words.filter((w) => !NEWS_STOP.has(w)))].slice(0, 8);
}
async function newsRelated(sql, title, excludeUrl) {
  const terms = titleTerms(title);
  if (!terms.length) return [];
  const q = terms.join(' | ');
  try {
    const h = await sql.query(
      `SELECT title, url, source_name, published_at,
              ts_rank(search_vector, to_tsquery('english', $1)) AS rank
         FROM news_stories
        WHERE search_vector @@ to_tsquery('english', $1) AND url <> $2
        ORDER BY rank DESC, coalesce(published_at, fetched_at) DESC NULLS LAST
        LIMIT 30`, [q, excludeUrl || '']);
    const rows = h.filter((x) => x && x.title && x.url);
    // The tsquery is an OR of the title's key words, so a story sharing ONE common
    // word ("war", "drone") still matches even when it's about something else. Keep
    // only stories that share at least TWO of the original title's terms, or one
    // sufficiently distinctive (6+ char) term — drops the long tail of one-word
    // matches that aren't really about this story (#83/#96).
    const scored = rows.map((r) => {
      const lc = String(r.title).toLowerCase();
      const matched = terms.filter((t) => lc.includes(t));
      // A "strong" (distinctive) single-term match: a 6+ char term that ISN'T the
      // FIRST word of a multi-word trend. The first word of a person-trend is usually
      // a common first name ("Justin" in "Justin Verlander") — matching that alone
      // dragged in every unrelated "Justin ___" story; the surname is the distinctive
      // bit (#img464/465).
      const strong = matched.some((m) => m.length >= 6 && (terms.length === 1 || m !== terms[0]));
      return { r, n: matched.length, strong };
    });
    return scored.filter((s) => s.n >= 2 || (s.n >= 1 && s.strong)).slice(0, 8).map((s) => s.r);
  } catch (_) { return []; }
}

function trendPrompt(query, ctx, grounded = true) {
  const lines = [
    `Today is ${todayLabel()}. You are explaining why a search term is trending RIGHT NOW. Return EXACTLY two labeled parts and nothing else:`,
    `SUMMARY: one sentence (max ~25 words) plainly stating why "${query}" is trending right now. Anchor it to the SINGLE most recent development — today, or the last day or two — NOT an earlier or original reason. If this term has been in the news for a while, the summary MUST reflect the LATEST reason it is spiking now, not the first thing that put it in the news. State the OUTCOME, not just the event: if the triggering event has already concluded (a game finished, a vote decided, a result announced), name the decisive result — who won or lost, the score, the ruling, the consequence — never "just played", "faced off", or "is set to" when the result is already known. The SUMMARY must convey the same key fact as the DETAIL — never let the one-liner lag behind or omit the outcome the detail states.`,
    `DETAIL: 3-5 sentences (plain prose, NO headers/markdown): what it is, why it is trending right now (what just happened in the days leading up to today), and brief context.`,
    grounded
      ? `Use Google Search for the latest information and rely on those results over your own prior knowledge — do not assume an older year or stale facts. The current state may differ from what you remember (scores, outcomes, standings, releases change) — report what the search results show as of right now. If you genuinely cannot tell what it refers to, say so and name the likely category; do NOT invent.`
      : NO_FABRICATION,
    SPECIFICITY_RULES,
    ``,
    `Trending term: "${query}"`,
  ];
  if (ctx.category) lines.push(`Category: ${ctx.category}`);
  if (ctx.breakdown && ctx.breakdown.length) lines.push(`Related searches (strong signal of meaning): ${ctx.breakdown.slice(0, 10).join(', ')}`);
  if (ctx.headlines && ctx.headlines.length) lines.push(`Recent related headlines from our archive:\n- ${ctx.headlines.join('\n- ')}`);
  return lines.join('\n');
}

// Trend RAG prompt (option 1): explain why a term is trending using ONLY the
// supplied real, current news items as fact — an UNGROUNDED write over retrieved
// evidence (our feed + SerpAPI News), not Gemini's metered live search. Same
// SUMMARY/DETAIL contract as trendPrompt so parseTrendBrief + the card render
// unchanged. NO_FABRICATION is the guard for the empty/thin-facts case.
function trendRagPrompt(query, ctx, facts) {
  const factBlock = (facts || []).map((f, i) => {
    const meta = [f.source, f.date].filter(Boolean).join(', ');
    return `${i + 1}. ${f.title}${meta ? ` (${meta})` : ''}${f.snippet ? ` — ${f.snippet}` : ''}${f.url ? `\n   ${f.url}` : ''}`;
  }).join('\n');
  const lines = [
    `Today is ${todayLabel()}. Explain why the search term "${query}" is trending RIGHT NOW, using ONLY the current news items listed below as your source of fact — do NOT add specifics from your own memory. Return EXACTLY two labeled parts and nothing else:`,
    `SUMMARY: one sentence (max ~25 words) stating why "${query}" is trending right now, anchored to the most recent development that CREDIBLY explains a surge in searches for this exact term. The driver must be a real news development that multiple items point to when possible — an opinion piece, a review, or a passing mention of the term in an article about something else is NOT the reason a term trends unless several items center on it. When several items describe the same event, THAT event is the driver — prefer it over a lone newer-but-tangential item. State the OUTCOME (score, result, decision, consequence) when the event has concluded — never "just played", "faced off", or "is set to" if the items show the result. The SUMMARY must convey the same key fact as the DETAIL.`,
    `DETAIL: 3-5 sentences (plain prose, NO markdown): what it is, the specific recent development driving the trend, and brief context — all drawn from the items below.`,
    `If the items do NOT clearly show why the term is spiking, say plainly what the term refers to and that the specific driver isn't clear from current coverage — do NOT force a causal "because" onto a single tangential item.`,
    facts && facts.length
      ? `CURRENT NEWS ITEMS (your ONLY source of specific fact; if they disagree, prefer the most recent):\n${factBlock}`
      : `No current news items were found for this term.`,
    NO_FABRICATION,
    SPECIFICITY_RULES,
    ``,
    `Trending term: "${query}"`,
  ];
  if (ctx.category) lines.push(`Category: ${ctx.category}`);
  if (ctx.breakdown && ctx.breakdown.length) lines.push(`Related searches (signal of meaning): ${ctx.breakdown.slice(0, 10).join(', ')}`);
  return lines.join('\n');
}

function newsPrompt(e, grounded = true) {
  return [
    `Today is ${todayLabel()}. Write an AI briefing on the news story below.`,
    grounded
      ? `Use Google Search to find current reporting on THIS specific story, verify facts, and cite sources. Rely on the search results over your own prior knowledge — do not assume an older year or stale facts. Be accurate and specific — do not invent.`
      : NO_FABRICATION,
    `CRITICAL — RECONCILE TO TODAY: news feeds sometimes recirculate OLD articles as if new. Any event the story frames as "upcoming", "projected", or "expected" that is dated to a year BEFORE the current year above has ALREADY HAPPENED — search for what actually occurred and report it in the PAST tense with the real outcome. Never describe a past draft, election, game, release, or award (e.g. a "2024 draft" when today is a later year) as still upcoming. If the story itself is years old, say so and give the current status.`,
    e.date ? `The feed lists this article as published "${e.date}", but trust the actual event dates you find over that timestamp.` : '',
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

// Top RECENT headlines for a builder (topic-level, not per-section): our own
// news feed as a current-fact anchor fed into EVERY builder group. Live Google
// Search grounding fires only intermittently, so without this the model answers
// time-sensitive facts (e.g. who currently holds an office) from stale training
// memory. Home → newest across all topics; a topic → its newest. Flat list.
async function builderHeadlines(sql, scope, limit = 14) {
  const topic = resolveTopic(scope);
  if (!topic) return [];
  try {
    const rows = topic.slug === 'home'
      ? await sql.query(
          `SELECT title, url, source_name, published_at FROM news_stories
            WHERE coalesce(published_at, fetched_at) > now() - interval '96 hours'
            ORDER BY coalesce(published_at, fetched_at) DESC NULLS LAST
            LIMIT $1`, [limit])
      : await sql.query(
          `SELECT ns.title, ns.url, ns.source_name, ns.published_at FROM news_stories ns
             JOIN topics tp ON tp.id = ns.topic_id
            WHERE tp.slug = $1
              AND coalesce(ns.published_at, ns.fetched_at) > now() - interval '168 hours'
            ORDER BY coalesce(ns.published_at, ns.fetched_at) DESC NULLS LAST
            LIMIT $2`, [topic.slug, limit]);
    return rows.filter((r) => r.url).map((r) => ({ title: r.title || '', url: r.url, source: r.source_name || '', date: r.published_at || '' }));
  } catch (_) { return []; }
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
    : `${body}\n${NO_FABRICATION}`) + headlineBlock;
}

// "Insight Builder" master prompt (#rebuild): ONE in-depth grounded call per
// (topic, group) instead of N per-section calls. The model picks its own section
// headings; the old shortcuts survive separately as on-demand "Further insights".
// Analysis ('analyze') was merged into Deep Dive ('topic-specific') and removed
// from the site — it is never generated (AI_LENSES excludes it, no builder tab).
const BUILDER_LABELS = { discover: 'Get Caught Up', 'topic-specific': 'Deep Dive', learn: '101 Resources' };
function builderPrompt(scope, group, grounded, headlines) {
  const topic = resolveTopic(scope);
  // Custom / free-text term: resolveTopic misses (not in the library), so fall
  // back to the raw scope string as the topic name.
  const isHome = !!(topic && topic.slug === 'home');
  const topicName = topic ? topic.name : String(scope || '').trim();
  const scopeLabel = isHome
    ? `today's world — global news, markets, tech, and culture`
    : `the topic "${topicName}"`;
  const guidance = String((templates.builderGuidance && templates.builderGuidance[group]) || '')
    .replace(/\{topic\}/g, isHome ? scopeLabel : topicName);
  const body = String(templates.builderGeneration || '')
    .replace(/\{today\}/g, todayLabel())
    .replace('{groupLabel}', BUILDER_LABELS[group] || group)
    .replace('{scopeLabel}', scopeLabel)
    .replace('{builderGuidance}', guidance);
  // Feed our own current headlines GROUP-AWARELY. Live Google Search grounding
  // fires only intermittently, so these real, recent stories are the dependable
  // current-fact anchor. Get Caught Up uses them as primary material; Deep Dive as
  // context; 101 Resources gets them strictly for FACTUAL CURRENCY (so it never
  // states a stale office-holder) WITHOUT letting them dictate subject — that keeps
  // 101 evergreen while still being current.
  const headList = (headlines || []).map((h, i) => `${i + 1}. ${h.title}${h.url ? ` — ${h.url}` : ''}`).join('\n');
  let headlineBlock = '';
  if (headList) {
    if (group === 'discover') headlineBlock = `\n\nCURRENT HEADLINES from our news feed (newest first), as primary source material — reference concrete stories by name where relevant:\n${headList}`;
    else if (group === 'topic-specific') headlineBlock = `\n\nRecent headlines for CONTEXT ONLY (what's in the news now) — use them to ground the dynamics you describe, but do not simply summarise them or let them dictate the structure:\n${headList}`;
    else headlineBlock = `\n\nThe recent headlines below are a REFERENCE ONLY, to verify durable present-day facts (e.g. who currently holds a major office or position). Do NOT mention, summarise, cite, or build on any of these news items, recent events, results, transfers, or announcements — the primer must read as timeless background, not current news:\n${headList}`;
  }
  return (grounded
    ? `${body}\nUse Google Search for the most current facts as of today and rely on those results over your own prior knowledge — every date, name, and event must be current, not from an earlier year. Cite the sources you used.`
    : `${body}\n${NO_FABRICATION}`) + headlineBlock;
}

// Per-INSIGHT focused brief: ONE shortcut, its OWN grounded query. Generating each
// insight separately (vs one pooled call for the whole group) gives every insight
// dedicated live searches — far more on-topic and current. Lead with the single most
// important, most recent development so "Latest News" surfaces the actual top story.
function sectionPrompt(scope, section, grounded, headlines) {
  const topic = resolveTopic(scope);
  const scopeLabel = topic && topic.slug === 'home'
    ? `today's world (global news, markets, tech, and culture)`
    : `the topic "${topic.name}"`;
  // Headlines from our feed are SUPPLEMENTARY context only — never the agenda. Our
  // feed can skew toward a few publishers, so anchoring to it made "Latest News"
  // miss the actual top story (e.g. the World Cup). Grounding decides the lede.
  const headBlock = (headlines && headlines.length)
    ? `\n\nSome recent headlines from our feed, for extra context only (NOT a complete or ranked list — do not let them dictate what's most important):\n${headlines.map((h, i) => `${i + 1}. ${h.title}${h.url ? ` — ${h.url}` : ''}`).join('\n')}`
    : '';
  return [
    `Today is ${todayLabel()}. Write ONE focused intelligence insight about ${scopeLabel}, current as of today.`,
    `INSIGHT — "${section.name}": ${section.prompt}`,
    `FIRST decide what the single biggest, most newsworthy, most RECENT development for ${scopeLabel} is right now — search for it; do NOT assume the supplied headlines below are the most important. Open with a 2-3 sentence summary that LEADS with that top development, then add 2-3 concise takeaway bullet points, each on its own line starting with "- ". No section headers or other markdown.`,
    SPECIFICITY_RULES,
    grounded
      ? `Use Google Search NOW for the most current facts as of today, and rely on those results over both your prior knowledge and the headlines below — every date, name, and event must be current, not from an earlier year. Cite the sources you used.`
      : NO_FABRICATION,
  ].filter(Boolean).join('\n') + headBlock;
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
    // Only KNOWN library topics get AI generation. Custom / free-text search terms
    // intentionally never trigger on-demand AI calls (cost control) — the custom
    // search UI surfaces external-model shortcuts + News/Trending/Web Search only.
    if (!sections) return { error: 'Unknown topic' };
    // Builders don't need shortcuts (those only power "Further Insights", which may
    // be empty); only the legacy per-section path requires them.
    if (!sections.length && !input.builder) return { error: 'No shortcuts in group' };
    // Builder mode (#rebuild): a separate cache key (`<group>:b`) so the prototype
    // never clobbers the live per-section overviews.
    insight = input.builder ? `${group}:b` : group;
    entity = { topic, group, sections }; key = topic.toLowerCase(); lensGrounded = LENS_GROUNDED[group];
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
  const isBuilder = type === 'shortcut' && !!input.builder;
  // Builders use a topic-level top-headlines anchor (current facts for every
  // group, including analyze + learn); legacy per-section overviews use the
  // section-keyed map. Learn returns none from overviewHeadlines by design.
  const overviewHeadsMap = (type === 'shortcut' && !isBuilder) ? await overviewHeadlines(sql, entity.topic, entity.group, entity.sections) : {};
  const builderHeads = isBuilder ? await builderHeadlines(sql, entity.topic) : [];
  const overviewHeadsFlat = isBuilder ? builderHeads : flattenHeadlineMap(overviewHeadsMap);
  const trendRelated = type === 'trend' ? await trendStories(sql, entity.query) : [];
  const newsRel = type === 'news' ? await newsRelated(sql, entity.title, entity.url) : [];
  // Display payload: builders → a flat rich list (their own top headlines, so the
  // Sources list shows real current stories even when grounding returns no
  // citations); legacy overviews → a per-section { name: [...] } MAP; trends +
  // news → a flat rich list ("Sources & Coverage" → title + publisher · date).
  const headlinesOut = (type === 'trend' || type === 'news')
    ? (type === 'trend' ? trendRelated : newsRel).map((h) => ({ title: h.title || '', url: h.url || '', source: h.source_name || '', date: h.published_at || '' })).filter((h) => h.url)
    : (isBuilder ? builderHeads : overviewHeadsMap);

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
  // risk crossing the free tier, generate ungrounded (free) instead. Real-time
  // surfaces (trend/news) get the full ceiling; evergreen overviews stop earlier
  // so they can't starve real-time grounding late in the day.
  const isRealtime = type === 'news' || type === 'trend';
  const groundCeil = isRealtime ? SEARCH_BUDGET : SEARCH_OVERVIEW_BUDGET;
  const useGrounding = GROUNDING && lensGrounded && searchesSoFar < groundCeil;

  // Builders + the real-time surfaces (news/trend) get the stronger model (flash)
  // for richer synthesis + more reliable grounding; per-section shortcuts keep the
  // cheaper flash-lite (except discover, via modelFor).
  const genModel = (type === 'shortcut' && input.builder)
    ? INSIGHT_MODEL_DISCOVER
    : (type === 'news' || type === 'trend')
      ? INSIGHT_MODEL_REALTIME
      : modelFor(type, type === 'shortcut' ? entity.group : null);

  // 3+4. Generate. shortcut overviews = ONE focused grounded call PER insight (so
  // each gets its own live searches); news/trend = a single focused call.
  let out = null;          // single-call result (news/trend) OR aggregate (shortcut)
  let wasGrounded = false;
  let callsDelta = 1;      // generate() calls made — keeps ai_usage.calls honest
  let groundedDelta = 0;   // of those, how many actually grounded
  let serpUsed = false;    // trend RAG hit SerpAPI News (measurement only)
  let content; let sources;

  if (type === 'shortcut' && input.builder) {
    // ONE in-depth master-prompt call per (topic, group) — the Insight Builder.
    // Ground when the day's search budget allows; otherwise generate UNGROUNDED.
    // That's safe now because every builder is anchored to our own current
    // headlines + a guardrail that forbids naming current office-holders from
    // memory (refer generically unless a headline confirms) — so an ungrounded
    // builder stays accurate, it just won't carry live Google citations. (This is
    // why we no longer skip ungrounded builders: it left them unavailable on
    // budget-spent days for no accuracy gain.)
    const p = builderPrompt(entity.topic, entity.group, useGrounding, overviewHeadsFlat);
    // 2048 gives the model room to finish 3-4 sections without truncating mid-way
    // (truncation at 1700 was leaving an empty trailing heading).
    try { out = await generate(p, { grounded: useGrounding, model: genModel, maxTokens: 2048 + (useGrounding ? BUILDER_THINKING : 0), thinkingBudget: useGrounding ? BUILDER_THINKING : 0 }); } catch (_) { out = null; }
    if (!out || !out.text) return { unavailable: true };
    wasGrounded = useGrounding;
    content = out.text; sources = out.citations || [];
    groundedDelta = wasGrounded ? 1 : 0;
    callsDelta = 1;
  } else if (type === 'shortcut') {
    // Ground as many insights as the day's remaining search budget allows (≈3
    // searches/grounded call); the rest generate ungrounded (free). Run in
    // parallel so a 5-section group isn't 5× the wall time.
    const EST_SEARCHES = 3;
    const groundable = useGrounding ? Math.max(0, Math.floor((groundCeil - searchesSoFar) / EST_SEARCHES)) : 0;
    const secResults = await Promise.all(entity.sections.map(async (s, i) => {
      const ground = i < groundable;
      const p = sectionPrompt(entity.topic, s, ground, overviewHeadsMap[s.name] || []);
      let o = null;
      try { o = await generate(p, { grounded: ground, model: genModel, maxTokens: 600 + (ground ? GROUNDED_THINKING : 0), thinkingBudget: ground ? GROUNDED_THINKING : 0 }); } catch (_) {}
      let didGround = ground && !!(o && o.text);
      if (ground && (!o || !o.text)) { didGround = false; try { o = await generate(p, { grounded: false, model: genModel, maxTokens: 600 }); } catch (_) {} }
      return { name: s.name, out: o, grounded: didGround };
    }));
    const parts = []; const srcMap = {};
    let micros = 0; let inTok = 0; let outTok = 0; let searches = 0;
    secResults.forEach((r) => {
      const body = (r.out && r.out.text) ? String(r.out.text).trim() : 'This insight is being generated — check back shortly.';
      parts.push(`## ${r.name}\n${body}`);
      let cites = (r.out && r.out.citations) || [];
      if (!cites.length) { const h = overviewHeadsMap[r.name] || []; cites = h.slice(0, 6).map((x) => ({ title: x.title || '', uri: x.url || '' })).filter((c) => c.uri); }
      if (cites.length) srcMap[r.name] = cites;
      if (r.out) { micros += r.out.micros || 0; inTok += r.out.inTok || 0; outTok += r.out.outTok || 0; searches += r.out.searches || 0; }
      if (r.grounded) { wasGrounded = true; groundedDelta += 1; }
    });
    content = parts.join('\n\n');
    if (!content.trim()) return { unavailable: true };
    sources = srcMap;
    out = { micros, inTok, outTok, searches };
    callsDelta = secResults.length;
  } else if (type === 'trend' && TREND_RAG) {
    // Trend RAG (option 1): retrieve real facts (our feed first, SerpAPI News
    // fallback) and write the "why it's trending" UNGROUNDED over that evidence —
    // no Gemini grounding. Accurate after the free tier is spent; frees that whole
    // budget for other surfaces. sources = the actual articles used as evidence.
    const tctx = await trendContext(sql, entity.query);
    const gathered = await gatherTrendFacts(sql, entity.query, tctx.breakdown);
    serpUsed = gathered.fromSerp;
    const p = trendRagPrompt(entity.query, tctx, gathered.facts);
    wasGrounded = false;
    try { out = await generate(p, { grounded: false, model: genModel, maxTokens: 500 }); } catch (_) { out = null; }
    if (!out || !out.text) return { unavailable: true };
    content = out.text;
    sources = gathered.facts.map((f) => ({ title: f.title, uri: f.url })).filter((c) => c.uri).slice(0, 6);
    groundedDelta = 0;
  } else {
    let buildPrompt; let maxTokens;
    if (type === 'news') { maxTokens = 900; buildPrompt = (g) => newsPrompt(entity, g); }
    else {
      const tctx = await trendContext(sql, entity.query);
      tctx.headlines = trendRelated.map((s) => s.title).slice(0, 5);
      maxTokens = 500; buildPrompt = (g) => trendPrompt(entity.query, tctx, g);
    }
    wasGrounded = useGrounding;
    // Prompt is built to MATCH the grounded state: an ungrounded call gets the
    // no-fabrication guard instead of a "use Google Search" instruction it can't
    // honor (which is what made it invent specifics).
    try { out = await generate(buildPrompt(useGrounding), { grounded: useGrounding, model: genModel, maxTokens: maxTokens + (useGrounding ? GROUNDED_THINKING : 0), thinkingBudget: useGrounding ? GROUNDED_THINKING : 0 }); } catch (_) { out = null; }
    if (useGrounding && (!out || !out.text)) {
      wasGrounded = false;
      try { out = await generate(buildPrompt(false), { grounded: false, model: genModel, maxTokens }); } catch (_) { out = null; }
    }
    if (!out || !out.text) return { unavailable: true };
    content = out.text; sources = out.citations || [];
    groundedDelta = wasGrounded ? 1 : 0;
  }

  // Trends now generate "SUMMARY: …\nDETAIL: …" — split into the one-liner shown
  // on the homepage list and the full body. Other types store the text as-is.
  // The model sometimes bold-wraps section headers (**## Name**) or uses ###,
  // which breaks the "## " section parser downstream. Normalize to "## Name".
  if (type === 'shortcut') {
    content = content
      .replace(/^[ \t]*\*\*\s*(#{2,3})\s+(.+?)\s*\*\*[ \t]*$/gm, '## $2')
      .replace(/^[ \t]*###\s+(.+)$/gm, '## $1')
      // Strip any "— section brief: <prompt>" the model echoed from the
      // scaffold into a "## Name …" header line.
      .replace(/^([ \t]*##\s+.+?)\s*[—–-]\s*section brief\s*:.*$/gim, '$1');
    // Drop REPEATED "## " sections — the model occasionally restarts and re-writes
    // earlier sections (seen on builders), producing duplicate headings. Keep the
    // first occurrence of each (normalized) heading.
    if (isBuilder && /^##\s+/m.test(content)) {
      const segs = content.split(/(?=^##\s+)/m);
      const seen = new Set(); const kept = [];
      for (const seg of segs) {
        const hm = seg.match(/^##\s+(.+?)\s*$/m);
        if (!hm) { kept.push(seg); continue; }   // any preamble before the 1st heading
        const nn = hm[1].toLowerCase().replace(/\s+/g, ' ').trim();
        if (seen.has(nn)) continue;              // duplicate heading (model repeated)
        const body = seg.replace(/^##\s+.+\r?\n?/, '').trim();
        if (!body) continue;                     // empty section (truncated at the token cap)
        seen.add(nn); kept.push(seg);
      }
      content = kept.join('').trim();
    }
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
  } catch (err) {
    // Degraded store — reached when the primary write throws (a transient DB
    // hiccup, or genuinely-missing columns pre-migration). CRITICAL: still write
    // `summary` IN LOCKSTEP with `content`. Updating content while leaving an old
    // summary frozen is what stranded trend cards on a stale "why it's trending"
    // (a fresh, correct detail paired with a months-old one-liner) — and because
    // this path also bumps created_at, the reset staleness clock meant the
    // self-heal never re-derived the summary, so it was stuck on the FIRST reason
    // forever. summary/content must move together. Only `sources` (jsonb, the
    // column actually absent pre-migration) is dropped in this degraded path.
    console.error('[insight] primary store failed, using degraded path:', (err && err.message) || err);
    await sql.query(
      `INSERT INTO ai_insights (entity_type, entity_key, insight, content, summary, model)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (entity_type, entity_key, insight)
       DO UPDATE SET content=EXCLUDED.content, summary=EXCLUDED.summary, model=EXCLUDED.model, created_at=now()`,
      [type, key, insight, content, summary, genModel]);
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
  const cd = Math.max(1, callsDelta | 0); const gd = groundedDelta | 0;
  try {
    await sql.query(
      `INSERT INTO ai_usage (day, calls, grounded, searches, in_tok, out_tok, est_cost_micros)
       VALUES ($1, ${cd}, $2, $3, $4, $5, $6)
       ON CONFLICT (day) DO UPDATE SET
         calls           = ai_usage.calls + ${cd},
         grounded        = ai_usage.grounded + $2,
         searches        = ai_usage.searches + $3,
         in_tok          = ai_usage.in_tok + $4,
         out_tok         = ai_usage.out_tok + $5,
         est_cost_micros = ai_usage.est_cost_micros + $6`,
      [day, gd, thisSearches, out.inTok || 0, out.outTok || 0, totalMicros]);
  } catch (_) {
    // Pre-migration fallback: new columns may not exist yet.
    await sql.query(
      `INSERT INTO ai_usage (day, calls, est_cost_micros) VALUES ($1, ${cd}, $2)
       ON CONFLICT (day) DO UPDATE SET calls=ai_usage.calls+${cd}, est_cost_micros=ai_usage.est_cost_micros+$2`,
      [day, totalMicros]);
  }

  // Per-surface accounting (measurement) — the same numbers, split by surface so
  // we can see where grounded searches actually go and tune the reservation +
  // evergreen throttle to real data. Best-effort: no-ops until ai_usage_surface
  // is migrated in, and never blocks the response.
  try {
    const surface = type === 'shortcut'
      ? `${input.builder ? 'builder' : 'overview'}:${entity.group}`
      : type;
    await sql.query(
      `INSERT INTO ai_usage_surface (day, surface, calls, grounded, searches, in_tok, out_tok)
       VALUES ($1, $2, ${cd}, $3, $4, $5, $6)
       ON CONFLICT (day, surface) DO UPDATE SET
         calls    = ai_usage_surface.calls    + ${cd},
         grounded = ai_usage_surface.grounded + $3,
         searches = ai_usage_surface.searches + $4,
         in_tok   = ai_usage_surface.in_tok   + $5,
         out_tok  = ai_usage_surface.out_tok  + $6`,
      [day, surface, gd, thisSearches, out.inTok || 0, out.outTok || 0]);
    // Trend RAG's SerpAPI News lookups are a SEPARATE budget from Gemini grounding
    // — track them under their own surface so we can see how often the feed-first
    // path had to reach out to SerpAPI (and size the SerpAPI plan accordingly).
    if (serpUsed) {
      await sql.query(
        `INSERT INTO ai_usage_surface (day, surface, calls, searches) VALUES ($1, 'serp:trend-news', 0, 1)
         ON CONFLICT (day, surface) DO UPDATE SET searches = ai_usage_surface.searches + 1`, [day]);
    }
  } catch (_) { /* table not migrated yet — measurement is optional */ }

  return { content, summary, sources, headlines: headlinesOut, cached: false, generatedAt: new Date().toISOString() };
}

module.exports = { generateInsight, sourcesEmpty, groundingHeadroom };
