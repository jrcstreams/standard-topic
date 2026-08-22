// Pure SerpAPI google_trends_trending_now → normalized topic list.
// No DOM, no network — unit-testable. CommonJS so it's shared by the
// Vercel serverless function (require) and the Node test (ESM import of
// a CJS named export). Not loaded in the browser.
//
// Lives in lib/ (revamp964) because it is BACKEND code. It sat in js/utils/
// for a long time, where it looked like dead frontend code to every audit —
// deleting it on that basis took /api/trending down in production once
// already, and it was the last thing blocking js/ from being excluded from
// the deploy. Backend-only shared code belongs here.
//
// Input: array of { geo, data } where data is a SerpAPI response.
// Output: [{ query, categories: string[], startedAt: ISO|null, region }]
// deduped case-insensitively by query (first occurrence wins), capped.
function normalizeTrending(results, limit = 20) {
  const seen = new Set();
  const out = [];
  for (const { geo, data } of results || []) {
    const list = Array.isArray(data && data.trending_searches) ? data.trending_searches : [];
    for (const t of list) {
      const query = ((t && t.query) || '').trim();
      if (!query) continue;
      const key = query.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const ts = Number(t && t.start_timestamp);
      const vol = Number(t && t.search_volume);
      const inc = Number(t && t.increase_percentage);
      out.push({
        query,
        categories: Array.isArray(t && t.categories) ? t.categories.map(c => c && c.name).filter(Boolean) : [],
        startedAt: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null,
        // Approx. search count + the % rise SerpAPI reports for the trend.
        searchVolume: Number.isFinite(vol) && vol > 0 ? vol : null,
        increasePercent: Number.isFinite(inc) && inc > 0 ? inc : null,
        active: !!(t && t.active),
        region: geo,
        trendBreakdown: Array.isArray(t && t.trend_breakdown) ? t.trend_breakdown.filter(Boolean).map(s => String(s)) : [],
        googleTrendsUrl: `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}&geo=${encodeURIComponent(geo || 'US')}`,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

module.exports = { normalizeTrending };
