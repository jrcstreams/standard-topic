// Vercel serverless function — GET /api/trending
//
// Calls SerpAPI's google_trends_trending_now for each configured geo,
// merges + dedupes into a single ranked list, and edge-caches the result
// for an hour (stale-while-revalidate). With on-demand caching + SWR,
// SerpAPI is hit at most ~once/hour under load and never with no traffic.
//
// Self-heal: any trend in the list that doesn't yet have a stored "why it's
// trending" one-liner gets a brief generated in the BACKGROUND (after the
// response is sent), then the list cache is busted so the next load shows the
// filled-in summaries. This keys off the EXACT list we display — including
// brand-new trends not yet in any DB snapshot, which the pregenerate cron
// (which works off the 2h snapshot) can't reach — so the displayed list and
// its summaries converge within a refresh instead of lagging the cron.
//
// 200 — { topics, fetched, geos }
// 500 — { error: "Server misconfiguration" }    (SERPAPI_API_KEY missing)
// 502 — { error: "Upstream trends unavailable" } (SerpAPI non-2xx / network)

const { normalizeTrending } = require('../js/utils/trending-normalize.js');
const { getSql } = require('../lib/db');
const { generateInsight } = require('../lib/insight-core');

// Background scheduling + cache busting. Lazy/guarded so module load never
// crashes where @vercel/functions is absent (local/tests) — heal just no-ops.
let waitUntil; let invalidateByTag;
try { ({ waitUntil, invalidateByTag } = require('@vercel/functions')); }
catch (e) { waitUntil = null; invalidateByTag = null; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Cap briefs generated per heal pass so the background work stays well inside
// the function's maxDuration. Only ever a handful are missing/stale at once.
const HEAL_MAX = 8;
// A trend's cached summary older than this (and still trending) is regenerated —
// the term persists across days but the reason it's trending changes. 3h keeps
// the "why" current for fast-moving trends (a stale reason was a common
// complaint) while still aligning to the ~2h SerpAPI snapshot cron and not
// churning every hour. Env-overridable; raise to slow refresh.
const STALE_MS = Number(process.env.TREND_SUMMARY_STALE_MS || 3 * 3600 * 1000);

// Geo config — single source of truth. Add 'GB','DE',… here (and only
// here) to widen coverage; each geo is one upstream call per refresh.
const GEOS = ['US'];
const LIMIT = 20;
const SERP_BASE = 'https://serpapi.com/search.json';
// Past-hours window for the live list. This maps to Google's own "Past N
// hours" Trending-now filter (4/24/48/168). Google's trends.google.com/trending
// page defaults to "Past 24 hours" and ranks by its trending score — so 24
// gives us the SAME set and order Google shows (a 17h-old trend that's still
// Active can legitimately sit at #1). A narrower window would drop trends
// Google still features, so we mirror Google's default.
const TREND_HOURS = 24;
// Keep the homepage list close to Google's periodically-updated page: 30 min
// fresh, then serve stale for at most 2h while a background refresh runs (so
// the list never drifts to a day-old snapshot). SerpAPI is still hit ~≤2×/hr.
const CACHE_HEADER = 'public, s-maxage=1800, stale-while-revalidate=7200';

module.exports = async function handler(req, res) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfiguration' });

  const fetched = new Date().toISOString();
  try {
    const results = await Promise.all(GEOS.map(async (geo) => {
      const url = `${SERP_BASE}?engine=google_trends_trending_now&geo=${encodeURIComponent(geo)}&hours=${TREND_HOURS}&api_key=${encodeURIComponent(apiKey)}`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`SerpAPI ${r.status}`);
      return { geo, data: await r.json() };
    }));

    const topics = normalizeTrending(results, LIMIT);

    const sql = getSql();

    // Attach the stored one-liner ("why it's trending") for any trend we've
    // already briefed. One lookup keyed by lower(query); absent => no summary.
    try {
      if (sql && topics.length) {
        const keys = topics.map((t) => String(t.query || '').toLowerCase());
        const rows = await sql.query(
          `SELECT entity_key, summary, sources, created_at FROM ai_insights
            WHERE entity_type='trend' AND insight='brief' AND summary IS NOT NULL
              AND entity_key = ANY($1)`, [keys]);
        const byKey = new Map(rows.map((r) => [r.entity_key, r]));
        topics.forEach((t) => {
          const row = byKey.get(String(t.query || '').toLowerCase());
          t.summary = (row && row.summary) || null;
          t.sources = (row && row.sources) || null; // for the AI provenance ("N sources") on the card
          t._briefAt = (row && row.created_at) || null; // drives staleness refresh below
        });
      }
    } catch (_) { /* DB optional — render without summaries */ }

    // Self-heal in the background (after the response is sent): generate MISSING
    // one-liners AND re-generate STALE ones — a term like "Messi" stays trending for
    // days but the REASON changes, and a summary keyed only by query would otherwise
    // be stuck on day-one's reason forever. A brief older than STALE_MS for a term
    // that's STILL trending gets fully regenerated (summary + full brief + sources,
    // one call). Rank-ordered (top trends first) and capped at HEAL_MAX so it rides
    // the ~30-min cache-miss cadence and self-throttles — never an on-demand stampede;
    // the grounding-budget gate still falls back to ungrounded before any cap.
    try {
      const now = Date.now();
      const isStale = (t) => t._briefAt && (now - new Date(t._briefAt).getTime() > STALE_MS);
      const healList = sql && waitUntil
        ? topics
          .filter((t) => String(t.query || '').trim() && (!t.summary || isStale(t)))
          .slice(0, HEAL_MAX)
          .map((t) => ({ query: t.query, refresh: t.summary ? 1 : 0 }))
        : [];
      if (healList.length) {
        waitUntil((async () => {
          let made = 0;
          for (const item of healList) {
            try {
              const r = await generateInsight(sql, { type: 'trend', query: item.query, refresh: item.refresh });
              if (r && r.cached === false && r.summary) made += 1;
            } catch (_) { /* retried on a later refresh */ }
            await sleep(600);
          }
          // Bust the list cache ONLY if we changed something — otherwise an
          // un-briefable term would loop invalidate → recompute → invalidate.
          if (made > 0 && invalidateByTag) {
            try { await invalidateByTag('trending-all'); } catch (_) {}
          }
        })());
      }
    } catch (_) { /* best-effort — never block the list response */ }

    res.setHeader('Cache-Control', CACHE_HEADER);
    res.setHeader('Vercel-Cache-Tag', 'trending-all');
    return res.status(200).json({ topics, fetched, geos: GEOS });
  } catch (err) {
    return res.status(502).json({ error: 'Upstream trends unavailable' });
  }
};
