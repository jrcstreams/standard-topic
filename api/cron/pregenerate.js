// Vercel Cron — /api/cron/pregenerate  (schedule in vercel.json)
//
// Eagerly generates AI briefs ahead of user clicks so they're instant, and so
// the daily generation count is predictable. Each run fills a bounded batch of
// what's MISSING first (cached briefs are skipped), then spends leftover
// budget REFRESHING the stalest time-sensitive briefs, paced for rate limits:
//   Fills (priority order):
//   - Trends: the current snapshot's top terms without a 'brief'.
//   - Home shortcut items: per-shortcut briefs for home's directory shortcuts.
//   - News: recent stories (48h, newest first) without a 'brief' — sub-budget
//     NEWS_PER_RUN so news volume can't starve the rest.
//   - Shortcuts: every topic × lens (discover/learn/analyze/topic-specific).
//   Refresh (stalest first, via generateInsight refresh flag):
//   - shortcut items + discover/topic-specific lenses older than 24h,
//   - analyze lens older than 72h (learn is evergreen — never refreshed),
//   - trend briefs still in the current US snapshot, older than 24h.
// Failed items simply get retried next run (still missing/stale).
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.
// Manual: ?n=<total> ?type=trends|shortcuts|news|refresh|all
//   200 — { ok, trends, homeItems, news, shortcuts, refreshed, remaining }

const { getSql } = require('../../lib/db');
const { generateInsight } = require('../../lib/insight-core');
const topicsData = require('../../data/topics.json');
const assignmentsData = require('../../data/shortcuts-assignments.json');

const LENSES = ['discover', 'learn', 'analyze', 'topic-specific'];
const NEWS_PER_RUN = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const sql = getSql();
  if (!sql || !process.env.GEMINI_API_KEY) return res.status(200).json({ ok: true, skipped: true });

  const total = Math.min(Math.max(parseInt(req.query.n, 10) || 30, 1), 120);
  const which = (req.query.type || 'all').trim();
  const call = async (payload) => {
    try { const r = await generateInsight(sql, payload); return !!(r && r.content); }
    catch (_) { return false; }
  };

  try {
    let trends = 0; let homeItems = 0; let news = 0; let shortcuts = 0; let refreshed = 0;
    let budget = total;

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

    // 2. Home per-shortcut item briefs missing.
    const homeIds = (assignmentsData.assignments && assignmentsData.assignments.home) || [];
    if ((which === 'all' || which === 'shortcuts') && budget > 0 && homeIds.length) {
      const existing = await sql.query(
        `SELECT entity_key FROM ai_insights WHERE entity_type='shortcut' AND insight='item'`);
      const have = new Set(existing.map((r) => r.entity_key));
      for (const id of homeIds) {
        if (budget <= 0) break;
        if (have.has(id)) continue;
        if (await call({ type: 'shortcut', id })) homeItems++;
        budget--;
        await sleep(600);
      }
    }

    // 3. Recent news stories missing a brief (newest first, sub-budget).
    if ((which === 'all' || which === 'news') && budget > 0) {
      const rows = await sql.query(
        `SELECT url, title, description,
                to_char(coalesce(published_at, fetched_at), 'YYYY-MM-DD') AS date
           FROM news_stories ns
          WHERE coalesce(published_at, fetched_at) > now() - interval '48 hours'
            AND NOT EXISTS (
              SELECT 1 FROM ai_insights ai
               WHERE ai.entity_type='news' AND ai.entity_key = ns.url AND ai.insight='brief')
          ORDER BY coalesce(published_at, fetched_at) DESC
          LIMIT $1`, [Math.min(budget, NEWS_PER_RUN)]);
      for (const r of rows) {
        if (budget <= 0) break;
        if (await call({ type: 'news', url: r.url, title: r.title, description: r.description || '', date: r.date || '' })) news++;
        budget--;
        await sleep(600);
      }
    }

    // 4. Shortcut topic × lens missing.
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

    // 5. Refresh the stalest time-sensitive briefs with leftover budget.
    //    Keeps Discover/trends current without ever blocking a user read.
    if ((which === 'all' || which === 'refresh') && budget > 0) {
      const topicByLower = new Map(
        (topicsData.topics || []).map((t) => [String(t.name || '').toLowerCase(), t.name]));
      const stale = await sql.query(
        `SELECT entity_type, entity_key, insight FROM ai_insights ai
          WHERE (entity_type='shortcut' AND insight IN ('item','discover','topic-specific')
                 AND created_at < now() - interval '24 hours')
             OR (entity_type='shortcut' AND insight='analyze'
                 AND created_at < now() - interval '72 hours')
             OR (entity_type='trend' AND insight='brief'
                 AND created_at < now() - interval '24 hours'
                 AND EXISTS (
                   SELECT 1 FROM trending_items ti
                    WHERE ti.geo='US' AND lower(ti.query) = ai.entity_key
                      AND ti.snapshot_at = (SELECT max(snapshot_at) FROM trending_items WHERE geo='US')))
          ORDER BY created_at ASC
          LIMIT $1`, [budget]);
      for (const r of stale) {
        if (budget <= 0) break;
        let payload = null;
        if (r.entity_type === 'trend') payload = { type: 'trend', query: r.entity_key, refresh: 1 };
        else if (r.insight === 'item') payload = { type: 'shortcut', id: r.entity_key, refresh: 1 };
        else {
          const topic = topicByLower.get(r.entity_key);
          if (topic) payload = { type: 'shortcut', topic, group: r.insight, refresh: 1 };
        }
        if (payload && await call(payload)) refreshed++;
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
    const shortcutHave = await sql.query(
      `SELECT count(*)::int AS n FROM ai_insights WHERE entity_type='shortcut' AND insight <> 'item'`);
    const itemHave = await sql.query(
      `SELECT count(*)::int AS n FROM ai_insights WHERE entity_type='shortcut' AND insight='item'`);
    const remNews = await sql.query(
      `SELECT count(*)::int AS n FROM news_stories ns
        WHERE coalesce(published_at, fetched_at) > now() - interval '48 hours'
          AND NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.entity_type='news' AND ai.entity_key=ns.url AND ai.insight='brief')`);
    const topicCount = (topicsData.topics || []).filter((t) => t.slug && t.slug !== 'home').length;

    return res.status(200).json({
      ok: true, trends, homeItems, news, shortcuts, refreshed,
      remaining: {
        trends: remTrends[0].n,
        news: remNews[0].n,
        homeItems: homeIds.length - itemHave[0].n,
        shortcuts: (topicCount * LENSES.length) - shortcutHave[0].n,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
