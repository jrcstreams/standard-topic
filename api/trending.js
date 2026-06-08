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
// 1h fresh, serve stale up to a day while revalidating in the background.
const CACHE_HEADER = 'public, s-maxage=3600, stale-while-revalidate=86400';

module.exports = async function handler(req, res) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfiguration' });

  const fetched = new Date().toISOString();
  try {
    const results = await Promise.all(GEOS.map(async (geo) => {
      const url = `${SERP_BASE}?engine=google_trends_trending_now&geo=${encodeURIComponent(geo)}&api_key=${encodeURIComponent(apiKey)}`;
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
