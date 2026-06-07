// Vercel Cron — POST/GET /api/cron/trending  (schedule in vercel.json)
//
// Captures one Google Trends "trending now" snapshot per geo and appends it
// to trending_items. This is the WRITE path for trending history; the live
// /api/trending endpoint (edge-cached) is unchanged and still serves the
// homepage. Runs every 2h (Vercel Pro) so we build a dense time series that
// powers "how long was X trending", per-day/-week views, and sorting by
// category / volume / duration.
//
// We deliberately capture MORE than the live endpoint normalizes: category,
// search volume, % increase, start + end timestamps (=> duration), the trend
// breakdown, and the full raw item — so future features never need a backfill.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically.
//
//   200 — { ok, snapshotAt, inserted }            (success, or skipped:true pre-provision)
//   401 — { error }                               (bad/missing CRON_SECRET)
//   500 — { error }                               (SerpAPI key missing / upstream error)

const { getSql, bulkInsert } = require('../../lib/db');

const GEOS = ['US'];
// Capture deeper than the homepage shows (it renders ~20) so history is rich.
const LIMIT = 100;
const SERP_BASE = 'https://serpapi.com/search.json';

const TRENDING_COLS = [
  'snapshot_at', 'geo', 'rank', 'query', 'category', 'categories',
  'search_volume', 'increase_percent', 'started_at', 'ended_at',
  'active', 'trend_breakdown', 'raw',
];

function tsToISO(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

function mapItem(t, geo, rank, snapshotAt) {
  const query = String((t && t.query) || '').trim();
  if (!query) return null;
  const categories = Array.isArray(t.categories)
    ? t.categories.map((c) => c && c.name).filter(Boolean)
    : [];
  const vol = Number(t.search_volume);
  const inc = Number(t.increase_percentage);
  return [
    snapshotAt,
    geo,
    rank,
    query,
    categories[0] || null,
    JSON.stringify(categories),
    Number.isFinite(vol) && vol > 0 ? vol : null,
    Number.isFinite(inc) && inc > 0 ? Math.round(inc) : null,
    tsToISO(t.start_timestamp),
    tsToISO(t.end_timestamp),
    typeof t.active === 'boolean' ? t.active : null,
    JSON.stringify(Array.isArray(t.trend_breakdown) ? t.trend_breakdown : []),
    JSON.stringify(t),
  ];
}

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = getSql();
  if (!sql) return res.status(200).json({ ok: true, skipped: 'no database configured yet' });

  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfiguration' });

  const snapshotAt = new Date().toISOString();
  let inserted = 0;
  try {
    for (const geo of GEOS) {
      const url = `${SERP_BASE}?engine=google_trends_trending_now&geo=${encodeURIComponent(geo)}&api_key=${encodeURIComponent(apiKey)}`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`SerpAPI ${r.status}`);
      const data = await r.json();
      const list = Array.isArray(data.trending_searches) ? data.trending_searches : [];
      const rows = list
        .slice(0, LIMIT)
        .map((t, i) => mapItem(t, geo, i + 1, snapshotAt))
        .filter(Boolean);
      inserted += await bulkInsert(sql, 'trending_items', TRENDING_COLS, rows, {
        jsonbCols: ['categories', 'trend_breakdown', 'raw'],
      });
    }
    return res.status(200).json({ ok: true, snapshotAt, inserted });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
