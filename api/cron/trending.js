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

// NOTE: `raw` (the verbatim SerpAPI item) is deliberately NOT stored — no read
// path ever used it and it was the biggest per-row blob on this append-only table
// (#storage-trim 2026-07-22). `trend_breakdown` (which IS read) is kept.
const TRENDING_COLS = [
  'snapshot_at', 'geo', 'rank', 'query', 'category', 'categories',
  'search_volume', 'increase_percent', 'started_at', 'ended_at',
  'active', 'trend_breakdown',
];

// Retention: this table is append-only and has no dedup, so without a window it
// grows ~2k rows/day forever. The live endpoint only ever reads the newest
// snapshot; history views look back at most a few weeks. Keep 30 days.
const RETENTION_DAYS = 30;

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
  ];
}

// FREE fallback source: Google Trends' own RSS feed (no key). Items map onto the
// same shape mapItem() consumes; fields the RSS lacks stay null/empty.
async function rssTrendingFallback(geo) {
  try {
    const r = await fetch(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`, { headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = [];
    for (const block of xml.split('<item>').slice(1)) {
      const pick = (tag) => { const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')); return m ? m[1].trim() : ''; };
      const query = pick('title').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
      if (!query) continue;
      const traffic = pick('ht:approx_traffic').replace(/[^0-9]/g, '');
      const pub = Date.parse(pick('pubDate'));
      items.push({
        query,
        categories: [],
        search_volume: traffic ? Number(traffic) : null,
        increase_percentage: null,
        start_timestamp: Number.isFinite(pub) ? Math.floor(pub / 1000) : null,
        end_timestamp: null,
        active: true,
        trend_breakdown: [],
        _src: 'google-trends-rss',
      });
    }
    return items;
  } catch (_) { return []; }
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
      // SerpAPI FIRST, always — the free Google Trends RSS below is STRICTLY a
      // fallback for when SerpAPI fails (exhausted monthly quota, outage). The
      // moment the billing cycle resets and SerpAPI answers again, it is
      // automatically primary — no flag to flip (#serpburn). RSS tradeoffs:
      // no categories / no increase% / no related-searches breakdown, and
      // approx_traffic is coarser than search_volume.
      let list = [];
      let viaRss = false;
      try {
        const url = `${SERP_BASE}?engine=google_trends_trending_now&geo=${encodeURIComponent(geo)}&api_key=${encodeURIComponent(apiKey)}`;
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error(`SerpAPI ${r.status}`);
        const data = await r.json();
        list = Array.isArray(data.trending_searches) ? data.trending_searches : [];
      } catch (serpErr) {
        list = await rssTrendingFallback(geo);
        viaRss = true;
        if (!list.length) throw serpErr;
      }
      const rows = list
        .slice(0, LIMIT)
        .map((t, i) => mapItem(t, geo, i + 1, snapshotAt))
        .filter(Boolean);
      if (viaRss && rows.length) console.log(`trending cron: SerpAPI failed, snapshot for ${geo} captured via Trends RSS fallback (${rows.length} rows)`);
      inserted += await bulkInsert(sql, 'trending_items', TRENDING_COLS, rows, {
        jsonbCols: ['categories', 'trend_breakdown'],
      });
    }
    // Self-prune each run so the append-only table stays bounded (#storage-trim).
    let pruned = 0;
    try {
      const del = await sql.query(
        `DELETE FROM trending_items WHERE snapshot_at < now() - make_interval(days => $1) RETURNING 1`,
        [RETENTION_DAYS]
      );
      pruned = (Array.isArray(del) ? del : (del && del.rows) || []).length;
    } catch (_) { /* pruning is best-effort; never fail the snapshot on it */ }
    return res.status(200).json({ ok: true, snapshotAt, inserted, pruned });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
