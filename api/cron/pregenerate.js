// Vercel Cron — /api/cron/pregenerate  (schedule in vercel.json)
//
// Eagerly generates AI briefs ahead of user clicks so they're instant, and so
// the daily generation count is predictable. Each run fills a bounded batch of
// what's MISSING first (cached briefs are skipped), then spends leftover
// budget REFRESHING the stalest time-sensitive briefs, paced for rate limits:
//   Fills (priority order):
//   - Trends: the current snapshot's top terms without a 'brief'.
//   - News: recent stories (48h, newest first) without a 'brief' — sub-budget
//     NEWS_PER_RUN so news volume can't starve the rest.
//   - Group overviews: home + every topic × non-empty AI lens group
//     (discover/learn/analyze/topic-specific) without an overview.
//   Refresh (stalest first, via generateInsight refresh flag):
//   - discover/topic-specific overviews older than 72h, analyze older than
//     168h/1wk, learn older than 336h/2wk (evergreen — slow cadence). Windows are long on
//     purpose: each refresh is a fresh grounded generation, and re-grounding
//     slow-changing briefs is the main thing that burns Google-Search quota.
//   - any lens row whose content lacks "## " sections (one-time migration of
//     pre-overview prose briefs, learn included),
//   - trend briefs still in the current US snapshot, older than 24h.
// Failed items simply get retried next run (still missing/stale).
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.
// Manual: ?n=<total> ?type=trends|shortcuts|news|refresh|all
//   200 — { ok, trends, news, overviews, refreshed, remaining }

const { getSql } = require('../../lib/db');
const { generateInsight } = require('../../lib/insight-core');
const { resolveSections, AI_LENSES } = require('../../lib/shortcut-sections');
const topicsData = require('../../data/topics.json');

const NEWS_PER_RUN = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let invalidateByTag;
try {
  // Lazy import so module load doesn't crash where @vercel/functions is absent.
  ({ invalidateByTag } = require('@vercel/functions'));
} catch (e) {
  invalidateByTag = null;
}

// Every (scope, group) that should have an overview: home + each topic, AI
// lens groups only, skipping groups with no shortcuts on that page.
function overviewCandidates() {
  const scopes = ['home'].concat(
    (topicsData.topics || []).filter((t) => t.slug && t.slug !== 'home').map((t) => t.slug));
  const out = [];
  for (const scope of scopes) {
    for (const group of AI_LENSES) {
      const sections = resolveSections(scope, group);
      if (sections && sections.length) {
        // generateInsight keys by lower(topic input) — pass what the frontend
        // passes: 'home' for home, the topic NAME for topics.
        const t = (topicsData.topics || []).find((x) => x.slug === scope);
        out.push({ topic: scope === 'home' ? 'home' : t.name, group });
      }
    }
  }
  return out;
}

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const sql = getSql();
  if (!sql || !process.env.GEMINI_API_KEY) return res.status(200).json({ ok: true, skipped: true });

  const total = Math.min(Math.max(parseInt(req.query.n, 10) || 30, 1), 120);
  const which = (req.query.type || 'all').trim();
  // force=1 makes the refresh pass ignore the staleness windows and re-ground
  // EVERY overview/trend (stalest first) — use after a prompt change to flush
  // old-dated briefs. type=purge deletes cached rows outright so each one
  // regenerates fresh (with the current prompt) on its next view or cron pass.
  const force = req.query.force === '1' || req.query.force === 'true';

  // type=purge — drop cached insights so they regenerate from scratch. scope
  // defaults to overviews; pass scope=all to also clear trend + news briefs.
  if (which === 'purge') {
    const sql2 = sql;
    const scope = (req.query.scope || 'overviews').trim();
    const types = scope === 'all'
      ? ['shortcut', 'trend', 'news']
      : (scope === 'trends' ? ['trend'] : (scope === 'news' ? ['news'] : ['shortcut']));
    let purged = 0;
    try {
      const r = await sql2.query(
        `WITH d AS (DELETE FROM ai_insights WHERE entity_type = ANY($1) RETURNING 1)
         SELECT count(*)::int AS n FROM d`, [types]);
      purged = (r[0] && r[0].n) || 0;
    } catch (e) {
      return res.status(500).json({ error: String((e && e.message) || e) });
    }
    return res.status(200).json({ ok: true, purged, types });
  }

  // type=status — read-only rollout tracker. Reports how many briefs have been
  // (re)generated SINCE a cutoff (?since=ISO, default last 24h) vs the totals,
  // plus a list of the most recently regenerated keys — so a prompt change can
  // be watched as it rolls out via the gradual refresh. No generation, no cost.
  if (which === 'status') {
    const since = (req.query.since || '').trim() || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    try {
      const freshByGroup = await sql.query(
        `SELECT entity_type, insight, count(*)::int AS n FROM ai_insights
          WHERE created_at >= $1 GROUP BY 1,2 ORDER BY 1,2`, [since]);
      const totalByGroup = await sql.query(
        `SELECT entity_type, insight, count(*)::int AS n FROM ai_insights GROUP BY 1,2 ORDER BY 1,2`);
      const recentlyRegenerated = await sql.query(
        `SELECT entity_type, entity_key, insight, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS at
           FROM ai_insights WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 80`, [since]);
      return res.status(200).json({ ok: true, since, freshByGroup, totalByGroup, recentlyRegenerated });
    } catch (e) {
      return res.status(500).json({ error: String((e && e.message) || e) });
    }
  }

  const call = async (payload) => {
    try { const r = await generateInsight(sql, payload); return !!(r && r.content); }
    catch (_) { return false; }
  };

  // Wall-clock guard: grounded generations run ~10s each, so a large batch
  // would blow Vercel's 300s maxDuration and die with FUNCTION_INVOCATION_
  // TIMEOUT (losing the tail + the remaining-counts response). Stop issuing
  // new generations past TIME_BUDGET_MS and return cleanly; the next run (or
  // the hourly cron) picks up where this left off.
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 230 * 1000;
  const timeLeft = () => Date.now() - startedAt < TIME_BUDGET_MS;

  try {
    let trends = 0; let news = 0; let overviews = 0; let refreshed = 0;
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
        if (budget <= 0 || !timeLeft()) break;
        if (await call({ type: 'trend', query: r.query })) trends++;
        budget--;
        await sleep(600);
      }
    }

    // 2. Recent news stories missing a brief (newest first, sub-budget).
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
        if (budget <= 0 || !timeLeft()) break;
        if (await call({ type: 'news', url: r.url, title: r.title, description: r.description || '', date: r.date || '' })) news++;
        budget--;
        await sleep(600);
      }
    }

    // 3. Group overviews missing (home first in candidate order).
    const candidates = overviewCandidates();
    if ((which === 'all' || which === 'shortcuts') && budget > 0) {
      const existing = await sql.query(`SELECT entity_key, insight FROM ai_insights WHERE entity_type='shortcut'`);
      const have = new Set(existing.map((r) => `${r.entity_key}|${r.insight}`));
      for (const c of candidates) {
        if (budget <= 0 || !timeLeft()) break;
        if (have.has(`${c.topic.toLowerCase()}|${c.group}`)) continue;
        if (await call({ type: 'shortcut', topic: c.topic, group: c.group })) overviews++;
        budget--;
        await sleep(600);
      }
    }

    // 4. Refresh the stalest time-sensitive briefs with leftover budget.
    //    Keeps Discover/trends current without ever blocking a user read.
    //    The "content lacks '## '" arm migrates pre-overview prose briefs once.
    if ((which === 'all' || which === 'refresh') && budget > 0) {
      const byKey = new Map(candidates.map((c) => [`${c.topic.toLowerCase()}|${c.group}`, c]));
      // force=1 → re-ground every overview + current trend regardless of age
      // (flush after a prompt change). Otherwise only the stale ones.
      const stale = force
        ? await sql.query(
            `SELECT entity_type, entity_key, insight FROM ai_insights ai
              WHERE entity_type='shortcut'
                 OR (entity_type='trend' AND insight='brief'
                     AND EXISTS (
                       SELECT 1 FROM trending_items ti
                        WHERE ti.geo='US' AND lower(ti.query) = ai.entity_key
                          AND ti.snapshot_at = (SELECT max(snapshot_at) FROM trending_items WHERE geo='US')))
              ORDER BY created_at ASC
              LIMIT $1`, [budget])
        : await sql.query(
        `SELECT entity_type, entity_key, insight FROM ai_insights ai
          WHERE (entity_type='shortcut' AND insight IN ('discover','topic-specific')
                 AND created_at < now() - interval '72 hours')
             OR (entity_type='shortcut' AND insight='analyze'
                 AND created_at < now() - interval '168 hours')
             OR (entity_type='shortcut' AND insight='learn'
                 AND created_at < now() - interval '336 hours')
             OR (entity_type='shortcut' AND insight IN ('discover','learn','analyze','topic-specific')
                 AND content NOT LIKE '%## %')
             OR (entity_type='trend' AND insight='brief'
                 AND created_at < now() - interval '24 hours'
                 AND EXISTS (
                   SELECT 1 FROM trending_items ti
                    WHERE ti.geo='US' AND lower(ti.query) = ai.entity_key
                      AND ti.snapshot_at = (SELECT max(snapshot_at) FROM trending_items WHERE geo='US')))
          ORDER BY created_at ASC
          LIMIT $1`, [budget]);
      for (const r of stale) {
        if (budget <= 0 || !timeLeft()) break;
        let payload = null;
        if (r.entity_type === 'trend') payload = { type: 'trend', query: r.entity_key, refresh: 1 };
        else {
          const c = byKey.get(`${r.entity_key}|${r.insight}`);
          if (c) payload = { type: 'shortcut', topic: c.topic, group: c.group, refresh: 1 };
        }
        if (payload && await call(payload)) refreshed++;
        budget--;
        await sleep(600);
      }
    }

    // New/refreshed trend briefs mean new one-liners — bust the trending list
    // cache so the homepage/modal pick them up without waiting out the 1h edge
    // cache. (refreshed also covers overview refreshes; a stray bust is cheap.)
    if ((trends > 0 || refreshed > 0) && invalidateByTag) {
      try { await invalidateByTag('trending-all'); } catch (_) {}
    }

    // Remaining counts (for visibility).
    const remTrends = await sql.query(
      `SELECT count(*)::int AS n FROM (
         SELECT DISTINCT lower(query) q FROM trending_items
          WHERE snapshot_at = (SELECT max(snapshot_at) FROM trending_items WHERE geo='US') AND geo='US') t
        WHERE NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.entity_type='trend' AND ai.entity_key=t.q AND ai.insight='brief')`);
    const remNews = await sql.query(
      `SELECT count(*)::int AS n FROM news_stories ns
        WHERE coalesce(published_at, fetched_at) > now() - interval '48 hours'
          AND NOT EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.entity_type='news' AND ai.entity_key=ns.url AND ai.insight='brief')`);
    const overviewHave = await sql.query(
      `SELECT count(*)::int AS n FROM ai_insights
        WHERE entity_type='shortcut' AND insight IN ('discover','learn','analyze','topic-specific')`);

    return res.status(200).json({
      ok: true, trends, news, overviews, refreshed,
      remaining: {
        trends: remTrends[0].n,
        news: remNews[0].n,
        overviews: candidates.length - overviewHave[0].n,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
