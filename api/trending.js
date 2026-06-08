// Vercel serverless function — GET /api/trending
//
// Calls SerpAPI's google_trends_trending_now for each configured geo,
// merges + dedupes into a single ranked list, and edge-caches the result
// for an hour (stale-while-revalidate). With on-demand caching + SWR,
// SerpAPI is hit at most ~once/hour under load and never with no traffic.
//
// 200 — { topics, fetched, geos }
// 500 — { error: "Server misconfiguration" }    (SERPAPI_API_KEY missing)
// 502 — { error: "Upstream trends unavailable" } (SerpAPI non-2xx / network)

const { normalizeTrending } = require('../js/utils/trending-normalize.js');
const { getSql } = require('../lib/db');

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

    // Attach the stored one-liner ("why it's trending") for any trend we've
    // already briefed. One lookup keyed by lower(query); absent => no summary.
    try {
      const sql = getSql();
      if (sql && topics.length) {
        const keys = topics.map((t) => String(t.query || '').toLowerCase());
        const rows = await sql.query(
          `SELECT entity_key, summary FROM ai_insights
            WHERE entity_type='trend' AND insight='brief' AND summary IS NOT NULL
              AND entity_key = ANY($1)`, [keys]);
        const byKey = new Map(rows.map((r) => [r.entity_key, r.summary]));
        topics.forEach((t) => { t.summary = byKey.get(String(t.query || '').toLowerCase()) || null; });
      }
    } catch (_) { /* DB optional — render without summaries */ }

    res.setHeader('Cache-Control', CACHE_HEADER);
    res.setHeader('Vercel-Cache-Tag', 'trending-all');
    return res.status(200).json({ topics, fetched, geos: GEOS });
  } catch (err) {
    return res.status(502).json({ error: 'Upstream trends unavailable' });
  }
};
