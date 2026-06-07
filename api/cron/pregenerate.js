// Vercel Cron — /api/cron/pregenerate  (schedule in vercel.json)
//
// Eagerly generates AI briefs ahead of user clicks so they're instant, and so
// the daily generation count is predictable. Each run fills a bounded batch of
// what's MISSING (cached briefs are skipped), paced to respect rate limits:
//   - Trends: the current snapshot's top terms without a 'brief'.
//   - Shortcuts: every topic × lens (discover/learn/analyze/topic-specific)
//     without a brief.
// It reuses /api/insight (so caching, grounding, spend budget all apply) via an
// internal call. Failed items simply get retried next run (still uncached).
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.
// Manual: ?n=<total> ?type=trends|shortcuts|all  (e.g. ?n=60 to accelerate fill)
//   200 — { ok, trends, shortcuts, remaining }

const { getSql } = require('../../lib/db');
const topicsData = require('../../data/topics.json');

const LENSES = ['discover', 'learn', 'analyze', 'topic-specific'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const sql = getSql();
  if (!sql || !process.env.GEMINI_API_KEY) return res.status(200).json({ ok: true, skipped: true });

  const base = `https://${process.env.VERCEL_URL || req.headers.host}`;
  const total = Math.min(Math.max(parseInt(req.query.n, 10) || 30, 1), 120);
  const which = (req.query.type || 'all').trim();
  const call = async (payload) => {
    try {
      const r = await fetch(`${base}/api/insight`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const j = r.ok ? await r.json() : null;
      return !!(j && j.content);
    } catch (_) { return false; }
  };

  try {
    let trends = 0; let shortcuts = 0; let budget = total;

    // 1. Top current trends missing a brief.
    if (which === 'all' || which === 'trends') {
      const rows = await sql.query(
        `SELECT query FROM trending_items ti
          WHERE ti.snapshot_at = (SELECT max(snapshot_at) FROM trending_items WHERE geo = 'US')
            AND ti.geo = 'US'
            AND NOT EXISTS (
              SELECT 1 FROM ai_insights ai
               WHERE ai.entity_type='trend' AND ai.entity_key = lower(ti.query) AND ai.insight='brief')
          ORDER BY ti.rank
          LIMIT $1`, [Math.min(budget, 40)]);
      for (const r of rows) {
        if (budget <= 0) break;
        if (await call({ type: 'trend', query: r.query })) trends++;
        budget--;
        await sleep(600);
      }
    }

    // 2. Shortcut topic × lens missing.
    if ((which === 'all' || which === 'shortcuts') && budget > 0) {
      const existing = await sql.query(`SELECT entity_key, insight FROM ai_insights WHERE entity_type='shortcut'`);
      const have = new Set(existing.map((r) => `${r.entity_key}|${r.insight}`));
      const topics = (topicsData.topics || []).filter((t) => t.slug && t.slug !== 'home');
      const candidates = [];
      for (const t of topics) {
        for (const g of LENSES) {
          if (!have.has(`${t.name.toLowerCase()}|${g}`)) candidates.push({ topic: t.name, group: g });
        }
      }
      for (const c of candidates) {
        if (budget <= 0) break;
        if (await call({ type: 'shortcut', topic: c.topic, group: c.group })) shortcuts++;
        budget--;
        await sleep(600);
      }
    }

    // Remaining counts (for visibility).
    const remTrends = await sql.query(
      `SELECT count(*)::int AS n FROM (
         SELECT DISTINCT lower(query) q FROM trending_items
          WHERE snapshot_at = (SELECT max(snapshot_at) FROM trending_items WHERE geo='US') AND geo='US') t
        WHERE NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.entity_type='trend' AND ai.entity_key=t.q AND ai.insight='brief')`);
    const shortcutHave = await sql.query(`SELECT count(*)::int AS n FROM ai_insights WHERE entity_type='shortcut'`);
    const topicCount = (topicsData.topics || []).filter((t) => t.slug && t.slug !== 'home').length;

    return res.status(200).json({
      ok: true, trends, shortcuts,
      remaining: { trends: remTrends[0].n, shortcuts: (topicCount * LENSES.length) - shortcutHave[0].n },
    });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
