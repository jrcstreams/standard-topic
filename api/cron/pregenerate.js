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
//   - Insight Builders: home + every topic × the 4 builder groups (stored under
//     `<group>:b`); home hides Deep Dive. ~400 total.
//   Refresh (stalest first, via generateInsight refresh flag):
//   - Builder windows from data/ai-paths.json (so cron + on-view agree):
//     discover 24h (daily), topic-specific 168h (weekly), analyze 336h
//     (biweekly), learn 720h (monthly). Windows are long on purpose: each
//     refresh is a fresh grounded generation, the main Google-Search-quota cost.
//   - any lens row whose content lacks "## " sections (one-time migration of
//     pre-overview prose briefs, learn included),
//   - trend briefs still in the current US snapshot, older than 24h.
//   Heal (every run, after fills, before refresh — see runHeal):
//   - Re-grounds cached briefs that stored NO citations (e.g. generated on a day
//     the grounding budget was spent). ONLY runs while there's grounding headroom
//     today, so it's a no-op on budget-spent days and catches up on a later one.
//     News benefits most (it never refreshes by age). ?type=heal runs it alone.
// Failed items simply get retried next run (still missing/stale).
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.
// Manual: ?n=<total> ?type=trends|shortcuts|news|heal|refresh|all
//   200 — { ok, trends, news, overviews, healed, refreshed, remaining }

const { getSql } = require('../../lib/db');
const { generateInsight, groundingHeadroom } = require('../../lib/insight-core');
const { AI_LENSES } = require('../../lib/shortcut-sections');
const { effectiveWindowHours } = require('../../lib/ai-freshness');
const topicsData = require('../../data/topics.json');

// The Insight Builders are stored under a `<group>:b` insight key (see
// lib/insight-core.js generateInsight builder branch).
const BUILDER_SUFFIX = ':b';

const NEWS_PER_RUN = 10;
// Per-run cap on healing sourceless briefs (re-grounding ones that cached with
// no citations). Bounded like news so a backlog can't starve the rest, and the
// heal only runs while there's grounding headroom — see runHeal below.
const HEAL_PER_RUN = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let invalidateByTag;
try {
  // Lazy import so module load doesn't crash where @vercel/functions is absent.
  ({ invalidateByTag } = require('@vercel/functions'));
} catch (e) {
  invalidateByTag = null;
}

// Every (topic, group) builder that should exist: each TOPIC × the Insight
// Builder groups (discover/topic-specific/learn). AI insights are a TOPIC-PAGE
// feature only — the home page has no AI-insight surface, so 'home' is NOT
// generated. `insight` is the `<group>:b` cache key; `topic` is the topic NAME
// the frontend passes; generateInsight keys by lower(topic).
function overviewCandidates() {
  const scopes = (topicsData.topics || [])
    .filter((t) => t.slug && t.slug !== 'home')
    .map((t) => t.slug);
  const out = [];
  for (const scope of scopes) {
    for (const group of AI_LENSES) {
      const t = (topicsData.topics || []).find((x) => x.slug === scope);
      const topic = t && t.name;
      if (!topic) continue;
      out.push({ topic, group, insight: `${group}${BUILDER_SUFFIX}` });
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
  // Per-run news cap. Defaults to NEWS_PER_RUN (keeps the shared-budget `type=all`
  // run from letting news starve the freshness-refresh pass). The dedicated
  // news-warming cron (`type=news`) overrides it via ?newsMax= to warm MORE recent
  // stories per run — it runs alone, so it has the whole time budget and never
  // competes with refresh. Still bounded by the daily grounding guard → stays $0.
  const newsMax = Math.min(Math.max(parseInt(req.query.newsMax, 10) || NEWS_PER_RUN, 1), 60);
  // force=1 makes the refresh pass ignore the staleness windows and re-ground
  // EVERY overview/trend (stalest first) — use after a prompt change to flush
  // old-dated briefs. type=purge deletes cached rows outright so each one
  // regenerates fresh (with the current prompt) on its next view or cron pass.
  const force = req.query.force === '1' || req.query.force === 'true';

  // type=purge — drop cached insights so they regenerate from scratch. scope
  // defaults to overviews; pass scope=all to also clear trend + news briefs.
  //   scope=legacy → drop ONLY the retired per-section overview rows (shortcut
  //   rows whose insight is a bare group, NOT a `<group>:b` builder), leaving the
  //   live builders intact. Use to clean up after the builder migration.
  if (which === 'purge') {
    const sql2 = sql;
    const scope = (req.query.scope || 'overviews').trim();
    let purged = 0;
    try {
      if (scope === 'legacy') {
        const r = await sql2.query(
          `WITH d AS (DELETE FROM ai_insights WHERE entity_type='shortcut' AND insight NOT LIKE '%:b' RETURNING 1)
           SELECT count(*)::int AS n FROM d`);
        purged = (r[0] && r[0].n) || 0;
        return res.status(200).json({ ok: true, purged, scope: 'legacy' });
      }
      // scope=ungrounded → drop SOURCELESS builder rows (generated ungrounded when
      // the search budget was spent, so they may state stale facts as current).
      // They regenerate grounded on next view / cron pass. Builders are now
      // ground-or-skip, so this is a one-time cleanup of pre-fix rows.
      if (scope === 'ungrounded') {
        const r = await sql2.query(
          `WITH d AS (DELETE FROM ai_insights
              WHERE entity_type='shortcut' AND insight LIKE '%:b'
                AND (sources IS NULL OR sources='[]'::jsonb OR sources='{}'::jsonb
                     OR (jsonb_typeof(sources)='array' AND jsonb_array_length(sources)=0))
              RETURNING 1)
           SELECT count(*)::int AS n FROM d`);
        purged = (r[0] && r[0].n) || 0;
        return res.status(200).json({ ok: true, purged, scope: 'ungrounded' });
      }
      const types = scope === 'all'
        ? ['shortcut', 'trend', 'news']
        : (scope === 'trends' ? ['trend'] : (scope === 'news' ? ['news'] : ['shortcut']));
      const r = await sql2.query(
        `WITH d AS (DELETE FROM ai_insights WHERE entity_type = ANY($1) RETURNING 1)
         SELECT count(*)::int AS n FROM d`, [types]);
      purged = (r[0] && r[0].n) || 0;
      return res.status(200).json({ ok: true, purged, types });
    } catch (e) {
      return res.status(500).json({ error: String((e && e.message) || e) });
    }
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
    let trends = 0; let news = 0; let overviews = 0; let refreshed = 0; let healed = 0;
    let budget = total;

    // Built once and reused by the overview-fill, heal, and refresh phases:
    // every (scope, group) overview that should exist, keyed for lookup.
    const candidates = overviewCandidates();
    const byKey = new Map(candidates.map((c) => [`${c.topic.toLowerCase()}|${c.insight}`, c]));

    // Heal sourceless briefs: re-ground cached briefs that stored NO grounding
    // citations (typically generated on a day the grounding budget was spent).
    // STRATEGIC: only runs while there's grounding headroom today — otherwise it
    // would regenerate them ungrounded and STILL get no sources, so it simply
    // waits for a day with budget. News is the main beneficiary (it never
    // refreshes by age). OLDEST first: a re-grounded brief gets created_at=now(),
    // so anything still sourceless (genuinely unsourceable) rotates to the BACK
    // instead of being retried first forever, starving the fixable ones. The
    // on-view heal in /api/insight covers freshly-viewed briefs. Returns count.
    async function runHeal(limit) {
      if (limit <= 0 || !timeLeft()) return 0;
      if (!(await groundingHeadroom(sql))) return 0;
      let rows;
      try {
        rows = await sql.query(
          `SELECT ai.entity_type, ai.entity_key, ai.insight,
                  ns.title, ns.description,
                  to_char(coalesce(ns.published_at, ns.fetched_at), 'YYYY-MM-DD') AS date
             FROM ai_insights ai
             LEFT JOIN news_stories ns ON ai.entity_type='news' AND ns.url = ai.entity_key
            WHERE (ai.sources IS NULL OR ai.sources='[]'::jsonb OR ai.sources='{}'::jsonb
                   OR (jsonb_typeof(ai.sources)='array' AND jsonb_array_length(ai.sources)=0))
              AND ai.entity_type IN ('news','trend','shortcut')
              AND (ai.entity_type <> 'news' OR ns.url IS NOT NULL)
              AND (ai.entity_type <> 'shortcut' OR ai.insight LIKE '%:b')
            ORDER BY ai.created_at ASC
            LIMIT $1`, [limit]);
      } catch (_) { return 0; }
      let n = 0;
      for (const r of rows) {
        if (!timeLeft()) break;
        let payload = null;
        if (r.entity_type === 'trend') payload = { type: 'trend', query: r.entity_key, refresh: 1 };
        else if (r.entity_type === 'news') payload = { type: 'news', url: r.entity_key, title: r.title || '', description: r.description || '', date: r.date || '', refresh: 1 };
        else { const c = byKey.get(`${r.entity_key}|${r.insight}`); if (c) payload = { type: 'shortcut', topic: c.topic, group: c.group, builder: 1, refresh: 1 }; }
        if (payload && await call(payload)) n++;
        await sleep(600);
      }
      return n;
    }

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
          LIMIT $1`, [Math.min(budget, newsMax)]);
      for (const r of rows) {
        if (budget <= 0 || !timeLeft()) break;
        if (await call({ type: 'news', url: r.url, title: r.title, description: r.description || '', date: r.date || '' })) news++;
        budget--;
        await sleep(600);
      }
    }

    // 3. Builder insights missing (home first in candidate order).
    if ((which === 'all' || which === 'shortcuts') && budget > 0) {
      const existing = await sql.query(`SELECT entity_key, insight FROM ai_insights WHERE entity_type='shortcut' AND insight LIKE '%:b'`);
      const have = new Set(existing.map((r) => `${r.entity_key}|${r.insight}`));
      for (const c of candidates) {
        if (budget <= 0 || !timeLeft()) break;
        if (have.has(`${c.topic.toLowerCase()}|${c.insight}`)) continue;
        if (await call({ type: 'shortcut', topic: c.topic, group: c.group, builder: 1 })) overviews++;
        budget--;
        await sleep(600);
      }
    }

    // 4. Heal sourceless briefs (re-ground ones cached without citations). In the
    //    regular pass it takes a bounded share (HEAL_PER_RUN); ?type=heal runs it
    //    alone with the full budget. runHeal is headroom-gated, so on a
    //    grounding-spent day this is a clean no-op that defers to a later run.
    if ((which === 'all' || which === 'heal') && budget > 0) {
      healed = await runHeal(which === 'heal' ? budget : Math.min(budget, HEAL_PER_RUN));
      budget -= healed;
    }

    // 5. Refresh the stalest time-sensitive briefs with leftover budget.
    //    Keeps Discover/trends current without ever blocking a user read.
    //    The "content lacks '## '" arm migrates pre-overview prose briefs once.
    if ((which === 'all' || which === 'refresh') && budget > 0) {
      // Per-builder freshness windows (hours), from data/ai-paths.json so the
      // cron and the on-view refresh agree: discover 24h, topic-specific 168h,
      // learn 720h. Non-live classes ignore tier.
      const winFor = (g) => effectiveWindowHours(g, 3);
      const wDiscover = winFor('discover');
      const wTopic = winFor('topic-specific');
      const wLearn = winFor('learn');
      // force=1 → re-ground every builder + current trend regardless of age
      // (flush after a prompt change). Otherwise only the stale ones, by window.
      const stale = force
        ? await sql.query(
            `SELECT entity_type, entity_key, insight FROM ai_insights ai
              WHERE (entity_type='shortcut' AND insight LIKE '%:b')
                 OR (entity_type='trend' AND insight='brief'
                     AND EXISTS (
                       SELECT 1 FROM trending_items ti
                        WHERE ti.geo='US' AND lower(ti.query) = ai.entity_key
                          AND ti.snapshot_at = (SELECT max(snapshot_at) FROM trending_items WHERE geo='US')))
              ORDER BY created_at ASC
              LIMIT $1`, [budget])
        : await sql.query(
        `SELECT entity_type, entity_key, insight FROM ai_insights ai
          WHERE (entity_type='shortcut' AND insight='discover:b'       AND created_at < now() - make_interval(hours => $2))
             OR (entity_type='shortcut' AND insight='topic-specific:b' AND created_at < now() - make_interval(hours => $3))
             OR (entity_type='shortcut' AND insight='learn:b'          AND created_at < now() - make_interval(hours => $4))
             OR (entity_type='trend' AND insight='brief'
                 AND created_at < now() - interval '24 hours'
                 AND EXISTS (
                   SELECT 1 FROM trending_items ti
                    WHERE ti.geo='US' AND lower(ti.query) = ai.entity_key
                      AND ti.snapshot_at = (SELECT max(snapshot_at) FROM trending_items WHERE geo='US')))
          ORDER BY created_at ASC
          LIMIT $1`, [budget, wDiscover, wTopic, wLearn]);
      for (const r of stale) {
        if (budget <= 0 || !timeLeft()) break;
        let payload = null;
        if (r.entity_type === 'trend') payload = { type: 'trend', query: r.entity_key, refresh: 1 };
        else {
          const c = byKey.get(`${r.entity_key}|${r.insight}`);
          if (c) payload = { type: 'shortcut', topic: c.topic, group: c.group, builder: 1, refresh: 1 };
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
        WHERE entity_type='shortcut' AND insight LIKE '%:b'`);

    return res.status(200).json({
      ok: true, trends, news, overviews, healed, refreshed,
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
