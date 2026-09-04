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
//   - Daily Intelligence: every topic × the combined 'daily' brief (stored
//     under 'daily:b') — ~100 topics on ONE fixed wave a day (?type=daily,
//     7pm ET), so exactly one generation per topic per day.
//   Refresh (stalest first, via generateInsight refresh flag):
//   - daily:b is refreshed ONLY by its waves — see dailyWaveStart. It is
//     deliberately excluded from the age-window refresh below and from the
//     on-view refresh in /api/insight, so nothing can knock a topic off its
//     wave. Legacy per-group builders still refresh on-view only.
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
const { withHealthcheck } = require('../../lib/healthcheck');
const { generateInsight, groundingHeadroom } = require('../../lib/insight-core');
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

// The daily-briefing wave, in AMERICA/NEW_YORK wall-clock hours: ONE run at
// 7pm ET, every day, year-round (revamp1013). Two waves across 100 topics was
// ~62% of the entire Gemini bill; halving the cadence halves that line.
//
// Vercel crons are UTC-only and have no DST awareness, so vercel.json registers
// BOTH candidate UTC hours (23:00 for EDT, 00:00 for EST). Exactly one is 7pm
// in New York on any given date; the other returns immediately as a no-op.
//
// dailyWaveStart() returns the instant the current wave began. Every daily run
// refreshes each topic whose brief predates it — that single comparison is the
// entire scheduling rule, so a topic is either in this wave or already done by
// it, with nothing in between to guess at.
// revamp1192: the wave's crons now run 00:00-00:50 UTC (20:00-20:50 ET). They
// used to ALSO run 23:00-23:50 UTC — the end of the UTC day the grounding budget
// keys on — and because a wave skips topics an earlier run already wrote, those
// six runs claimed all ~100 topics on an exhausted budget and every brief was
// generated UNGROUNDED, i.e. with no citations at all. Dropping them lets the
// 00:xx runs do the same work on a fresh 1,500-query budget. The wave START
// stays 19:00 ET, so 20:xx ET is still this wave and freshness is unchanged.
// The hour the wave's cron runs must land on in New York. Change this and the
// schedules in vercel.json together — revamp1192 moved the runs without moving
// this constant, every run hit the off-wave-hour guard below and returned
// `skipped`, and no briefing refreshed for a full day.
//
// revamp1201: 5am ET. A daily briefing has to be written late enough to hold
// the night behind it and early enough to be current when the day starts —
// 5am clears the overnight cycle and the start of the European morning, and
// lands before any reader is awake to see it stale. It is also the hour the
// category settled on for the same reason.
//
// The trade it accepts: 5am ET is nine hours into the UTC day the Google
// grounding budget keys on (that day begins at 8pm ET in summer), so this slot
// has less headroom than an evening one. If briefings start coming back without
// citations again, the budget — not the hour — is what to fix: reserve capacity
// for the wave, or key the accounting day to ET so it matches the editorial
// clock.
//
// vercel.json registers both DST candidates (09:xx and 10:xx UTC) so exactly one
// of them is 5am in New York year-round; the other falls through to the
// catch-up, which is harmless.
const DAILY_WAVE_HOURS_ET = [5];
const ET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
});
function etParts(d) {
  const p = Object.fromEntries(ET_FMT.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24 };
}
// The UTC instant of a given ET wall-clock date+hour. Two correction passes
// settle the zone offset (one is enough except across a DST transition).
function etInstant(y, m, d, h) {
  const want = Date.UTC(y, m - 1, d, h);
  let ts = want;
  for (let i = 0; i < 2; i++) {
    const p = etParts(new Date(ts));
    ts += want - Date.UTC(p.y, p.m - 1, p.d, p.h);
  }
  return new Date(ts);
}
function dailyWaveStart(now = new Date()) {
  const p = etParts(now);
  for (let i = DAILY_WAVE_HOURS_ET.length - 1; i >= 0; i--) {
    if (p.h >= DAILY_WAVE_HOURS_ET[i]) return etInstant(p.y, p.m, p.d, DAILY_WAVE_HOURS_ET[i]);
  }
  // Before the day's first wave → the previous ET day's last wave is current.
  const q = etParts(new Date(now.getTime() - 24 * 36e5));
  return etInstant(q.y, q.m, q.d, DAILY_WAVE_HOURS_ET[DAILY_WAVE_HOURS_ET.length - 1]);
}

let invalidateByTag;
try {
  // Lazy import so module load doesn't crash where @vercel/functions is absent.
  ({ invalidateByTag } = require('@vercel/functions'));
} catch (e) {
  invalidateByTag = null;
}

// Every builder that should exist. Since revamp763 the topic pages surface ONE
// combined Daily Intelligence brief per topic (group 'daily', stored 'daily:b')
// instead of the three per-group builders — a third of the generation cost. The
// legacy discover/topic-specific/learn builders still generate + refresh
// on-view (other surfaces may read them) but the cron no longer fills them.
// AI insights are a TOPIC-PAGE feature only — 'home' is NOT generated.
// `insight` is the `<group>:b` cache key; `topic` is the topic NAME the
// frontend passes; generateInsight keys by lower(topic).
const CRON_BUILDER_GROUPS = ['daily'];
function overviewCandidates() {
  const out = [];
  // revamp814: the HOMEPAGE briefing rides the same twice-daily wave as the
  // topics — one cross-topic brief per edition, sampled across every parent
  // (see builderHeadlines' home branch). ~60 extra calls a month.
  for (const group of CRON_BUILDER_GROUPS) {
    out.push({ topic: 'home', group, insight: `${group}${BUILDER_SUFFIX}` });
  }
  for (const t of (topicsData.topics || [])) {
    if (!t.slug || t.slug === 'home' || !t.name) continue;
    for (const group of CRON_BUILDER_GROUPS) {
      out.push({ topic: t.name, group, insight: `${group}${BUILDER_SUFFIX}` });
    }
  }
  return out;
}

module.exports = withHealthcheck('HC_PING_PREGENERATE', async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const sql = getSql();
  if (!sql || !process.env.GEMINI_API_KEY) return res.status(200).json({ ok: true, skipped: true });

  // revamp1013: publicBudgetLeft() reads ai_usage_surface and FAILS OPEN when
  // the table is absent — i.e. every visitor-triggered generation ran with no
  // cap at all. The table was only ever created lazily by a hit on the admin
  // usage endpoint, which may never have happened. Provision it here: this cron
  // is authed, runs constantly, and IF NOT EXISTS makes it a no-op thereafter.
  try {
    await sql.query(`CREATE TABLE IF NOT EXISTS ai_usage_surface (
      day DATE NOT NULL, surface TEXT NOT NULL,
      calls INTEGER NOT NULL DEFAULT 0, grounded INTEGER NOT NULL DEFAULT 0,
      searches INTEGER NOT NULL DEFAULT 0, in_tok BIGINT NOT NULL DEFAULT 0,
      out_tok BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (day, surface))`);
  } catch (_) { /* insufficient privilege / already exists — non-fatal */ }

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

  // type=daily — the DAILY WAVES. Every topic's Daily Intelligence regenerates
  // once a day at 7pm ET, spread over six
  // staggered cron runs per wave so all briefings "post" around the same two
  // times.
  //
  // Wave membership is decided by the CLOCK, not by how stale a row is: a run
  // refreshes every topic whose brief predates the current wave's start. That
  // is the whole rule.
  //
  //   · already done by an earlier run in THIS wave → created_at >= waveStart
  //     → skipped, so the wave converges across its ten runs.
  //   · regenerated off-wave (an on-view refresh) → created_at < waveStart
  //     → still refreshed, so it cannot fall out of the wave.
  //
  // The previous gate was `created_at < now() - interval '10 hours'`, which
  // conflated those two cases: any topic regenerated in the ten hours BEFORE a
  // wave read as "fresh enough" and was skipped by every run in it. Politics
  // was regenerated on-view at 03:00 UTC and missed the 12:00 wave by seven
  // minutes, then served a 20-hour-old brief — stamped with the wrong edition
  // — for the rest of the day (#revamp990).
  if (which === 'daily') {
    // vercel.json registers both DST candidates for each wave; only the run
    // that is actually 6am/6pm in New York does any work.
    const etHour = etParts(new Date()).h;
    const onWave = DAILY_WAVE_HOURS_ET.includes(etHour);
    // revamp1199 — off-wave runs are no longer a bare no-op. A wave that never
    // fires (a schedule moved out from under this guard, a deploy window, an
    // outage) used to leave every brief stale until the same hour came round
    // again a day later, and nothing in the system noticed. Off-wave runs now
    // refresh anything that has gone past a full day plus slack, capped hard.
    // Under normal operation the wave keeps every brief inside that window, so
    // this finds nothing and costs nothing.
    const CATCHUP_HOURS = 26;
    if (!onWave) {
      // The catch-up is a WAVE, not a trickle: every briefing on the site is
      // meant to post inside one tight window, so recovery uses the same shape
      // as the real thing — a cluster of staggered runs, each taking as many
      // topics as its time budget allows, converging in under an hour. Spread
      // across the day it would leave the site showing briefings stamped hours
      // apart, which is the thing the wave exists to prevent.
      let healed = 0; let budgetC = total;
      const startedAtC = Date.now();
      const timeLeftC = () => Date.now() - startedAtC < 230 * 1000;
      try {
        const cands = overviewCandidates();
        const byKeyC = new Map(cands.map((c) => [`${c.topic.toLowerCase()}|${c.insight}`, c]));
        const stale = await sql.query(
          `SELECT entity_key FROM ai_insights
            WHERE entity_type='shortcut' AND insight='daily:b'
              AND created_at < now() - ($1 || ' hours')::interval
            ORDER BY created_at ASC LIMIT $2`, [String(CATCHUP_HOURS), budgetC]);
        for (const r of stale) {
          if (budgetC <= 0 || !timeLeftC()) break;
          const c = byKeyC.get(`${r.entity_key}|daily:b`);
          if (!c) continue;
          if (await call({ type: 'shortcut', topic: c.topic, group: 'daily', builder: 1, refresh: 1 })) healed++;
          budgetC--;
          await sleep(600);
        }
      } catch (e) {
        return res.status(200).json({ ok: true, type: 'daily', skipped: 'off-wave-hour', etHour, catchupError: String((e && e.message) || e).slice(0, 200) });
      }
      return res.status(200).json({ ok: true, type: 'daily', mode: 'catchup', etHour, healed });
    }
    const waveStartISO = dailyWaveStart().toISOString();
    const sleepMs = 600;
    const startedAtD = Date.now();
    const timeLeftD = () => Date.now() - startedAtD < 230 * 1000;
    try {
      let filled = 0; let refreshed = 0; let orphans = 0; let budget = total;
      const candidates = overviewCandidates();
      const byKey = new Map(candidates.map((c) => [`${c.topic.toLowerCase()}|${c.insight}`, c]));
      const existing = await sql.query(`SELECT entity_key, created_at FROM ai_insights WHERE entity_type='shortcut' AND insight='daily:b'`);
      const haveAt = new Map(existing.map((r) => [r.entity_key, r.created_at]));
      // 1. Fill topics with no daily brief at all.
      for (const c of candidates) {
        if (budget <= 0 || !timeLeftD()) break;
        if (haveAt.has(c.topic.toLowerCase())) continue;
        if (await call({ type: 'shortcut', topic: c.topic, group: 'daily', builder: 1 })) filled++;
        budget--;
        await sleep(sleepMs);
      }
      // 2. Refresh every brief that predates this wave, stalest first.
      if (budget > 0 && timeLeftD()) {
        const stale = await sql.query(
          `SELECT entity_key FROM ai_insights
            WHERE entity_type='shortcut' AND insight='daily:b'
              AND created_at < $1
            ORDER BY created_at ASC LIMIT $2`, [waveStartISO, budget]);
        for (const r of stale) {
          if (budget <= 0 || !timeLeftD()) break;
          const c = byKey.get(`${r.entity_key}|daily:b`);
          // An entity_key with no matching topic name is an orphan — a topic
          // that was renamed or removed. It can never be refreshed, so its
          // created_at keeps receding and it sorts to the FRONT of this
          // stalest-first queue on every single run, head-blocking the topics
          // behind it. Skip it without spending a slot or a sleep (revamp827).
          if (!c) { orphans++; continue; }
          if (await call({ type: 'shortcut', topic: c.topic, group: 'daily', builder: 1, refresh: 1 })) refreshed++;
          budget--;
          await sleep(sleepMs);
        }
      }
      const rem = await sql.query(
        `SELECT count(*)::int AS n FROM ai_insights
          WHERE entity_type='shortcut' AND insight='daily:b'
            AND created_at < $1`, [waveStartISO]);
      return res.status(200).json({
        ok: true, type: 'daily', wave: waveStartISO,
        filled, refreshed, orphans, staleRemaining: rem[0].n,
      });
    } catch (e) {
      return res.status(500).json({ error: String((e && e.message) || e) });
    }
  }

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
              /* NO 'trend' here: trend briefs are RAG — sourceless means the
                 relevance gate found no on-topic coverage, and re-healing just
                 burns a SerpAPI search per sweep forever (#serpburn). */
              AND ai.entity_type IN ('news','shortcut')
              AND (ai.entity_type <> 'news' OR ns.url IS NOT NULL)
              AND (ai.entity_type <> 'shortcut' OR ai.insight = 'daily:b')
            ORDER BY ai.created_at ASC
            LIMIT $1`, [limit]);
      } catch (_) { return 0; }
      let n = 0;
      for (const r of rows) {
        if (!timeLeft()) break;
        let payload = null;
        if (r.entity_type === 'trend') payload = { type: 'trend', query: r.entity_key, refresh: 1, internal: 1 };
        else if (r.entity_type === 'news') payload = { type: 'news', url: r.entity_key, title: r.title || '', description: r.description || '', date: r.date || '', refresh: 1, internal: 1 };
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
        if (await call({ type: 'trend', query: r.query, internal: 1 })) trends++;
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
        if (await call({ type: 'news', url: r.url, title: r.title, description: r.description || '', date: r.date || '', internal: 1 })) news++;
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
      // cron and the on-view refresh agree: daily 24h. Non-live classes ignore
      // tier. Legacy builder groups refresh on-view only (not here).

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
          WHERE (entity_type='trend' AND insight='brief'
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
        if (r.entity_type === 'trend') payload = { type: 'trend', query: r.entity_key, refresh: 1, internal: 1 };
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
        WHERE entity_type='shortcut' AND insight='daily:b'`);

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
});
