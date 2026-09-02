// Vercel serverless function — /api/insight  (GET or POST)
//
// Thin HTTP wrapper around lib/insight-core.generateInsight(). Returns ONE
// consolidated, grounded, cached AI brief per entity (news / trend / shortcut).
// See lib/insight-core.js for the logic, prompts, grounding + spend budget.
//
//   200 — { content, sources, cached } | { unavailable:true } | { capped:true }
//   400 — { error }

const { getSql } = require('../lib/db');
const { generateInsight, sourcesEmpty, groundingHeadroom } = require('../lib/insight-core');
const { effectiveWindowHours } = require('../lib/ai-freshness');
const topicsData = require('../data/topics.json');

let invalidateByTag; let waitUntil;
try {
  // Lazy import so module load doesn't crash where @vercel/functions is absent.
  ({ invalidateByTag, waitUntil } = require('@vercel/functions'));
} catch (e) {
  invalidateByTag = null; waitUntil = null;
}

// Tier for a topic by display name ('home' is tier 1 — always-on). Defaults to
// 3 (the niche/long-tail window) when unknown.
function tierForTopic(name) {
  const n = String(name || '').toLowerCase();
  if (n === 'home') return 1;
  const t = (topicsData.topics || []).find((x) => String(x.name || '').toLowerCase() === n);
  return (t && t.tier) || 3;
}

function readInput(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  return Object.assign({}, req.query || {}, body || {});
}

// Work that happens AFTER the response is settled, shared by the JSON and SSE
// paths so streaming can't silently drop it.
//
//  (a) trend cache bust — a freshly generated trend brief carries a new
//      one-liner; bust the trending list cache so the homepage surfaces it
//      without waiting out /api/trending's edge cache.
//  (b) refresh-on-view — regenerate a cached brief in the background. Two
//      triggers, at most one refresh fired:
//        AGE — an AI Intelligence overview past its (path-class x topic-tier)
//          freshness window.
//        SOURCES-HEAL — a grounded brief cached WITHOUT citations (generated on
//          a day the grounding budget was spent). Re-grounds on view, but ONLY
//          with headroom today, else it just regenerates sourceless and burns
//          tokens. News matters most: it never refreshes by age, so without this
//          a sourceless news brief stays that way forever. Bounded to briefs
//          cached on an EARLIER day: the trigger (no citations) survives its own
//          fix whenever the model simply returns none, so an unbounded heal
//          regenerates the same brief on every view for a citation that is never
//          coming. A day is the right bound because the thing being waited on —
//          the grounding free tier — is what resets daily. The cron's runHeal
//          solves the same problem with OLDEST-first ordering (#revamp1160).
//      Trend briefs are RAG: their sources come from retrieval, and a trend
//      whose coverage fails the relevance gate KEEPS coming back sourceless —
//      healing it every view re-burns a SerpAPI search forever (#serpburn).
//      Never sources-heal trends.
// True when a cached brief was generated on an earlier UTC day than now — the
// heal's once-a-day bound. Unknown/unparseable timestamps read as "not yet",
// which keeps an undated cache entry out of the loop entirely.
function cachedBefore(generatedAt) {
  const t = Date.parse(generatedAt || '');
  if (!Number.isFinite(t)) return false;
  return new Date(t).toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10);
}

async function afterResponse(sql, input, out) {
  if (input.type === 'trend' && out && out.content && !out.cached && invalidateByTag) {
    try { await invalidateByTag('trending-all'); } catch (_) {}
  }
  const cacheOnly = input.cacheOnly === 1 || input.cacheOnly === '1' || input.cacheOnly === true;
  if (!(out && out.cached && waitUntil && !cacheOnly
      && (input.type === 'shortcut' || input.type === 'news' || input.type === 'trend'))) return;
  let doRefresh = false;
  // The combined Daily Intelligence brief ('daily' group) is owned outright by
  // the twice-daily cron waves — exactly two generations per topic per day, at
  // fixed times. An age-based refresh here would fire at some arbitrary hour,
  // reset that topic's clock, and desynchronise it from the wave, which is how
  // topics ended up a full edition behind (#revamp990). Other builder groups
  // aren't on a wave and still refresh on view.
  if (input.type === 'shortcut' && input.group !== 'daily' && out.generatedAt) {
    const ageH = (Date.now() - new Date(out.generatedAt).getTime()) / 36e5;
    const windowH = effectiveWindowHours(input.group, tierForTopic(input.topic));
    if (Number.isFinite(ageH) && ageH >= windowH) doRefresh = true;
  }
  // The daily brief is excluded from the sources-heal for the same reason it is
  // excluded from the age-refresh above: the wave owns it outright. Healing it
  // on view re-stamps its "today, 9:37 PM ET" dateline at whatever hour someone
  // happened to open the page — which is how a brief came to be datelined an
  // hour later than the edition a reader had just been looking at. It is also
  // the surface where the loop was worst: builders never carry per-section
  // citations, so EVERY cached daily brief matched the sourceless trigger and
  // re-generated on essentially every view.
  const dailyBrief = input.type === 'shortcut' && input.group === 'daily';
  const healable = !dailyBrief && input.type !== 'trend' && cachedBefore(out.generatedAt);
  if (!doRefresh && healable && sourcesEmpty(out.sources)
      && await groundingHeadroom(sql, { overview: input.type === 'shortcut' })) doRefresh = true;
  if (doRefresh) {
    waitUntil((async () => { try { await generateInsight(sql, { ...input, refresh: 1 }); } catch (_) {} })());
  }
}

// SSE frame writer. Events:
//   token — { t }        incremental answer text (generation only)
//   phase — { phase }    'thinking' (searching sources) | 'writing'
//   reset — {}           discard what's been painted; a retry is restarting
//   done  — <payload>    the canonical result, identical to the JSON response
//   error — { error }
function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const input = readInput(req);
    const sql = getSql();

    // ── Streaming mode ────────────────────────────────────────────────────
    // A cache hit resolves in ~160ms and needs no streaming, but the client
    // asked for one response protocol, so hits simply emit `done` immediately.
    // Misses stream the generation as it's produced — the whole point: ~10s of
    // blank spinner becomes text on screen in a second or two.
    if (input.stream === 1 || input.stream === '1' || input.stream === true) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Belt and braces against any intermediary that would buffer the body
        // and defeat the entire exercise.
        'X-Accel-Buffering': 'no',
      });
      let out;
      try {
        out = await generateInsight(sql, input, {
          onToken: (t) => sse(res, 'token', { t }),
          onReset: () => sse(res, 'reset', {}),
          onPhase: (phase) => sse(res, 'phase', { phase }),
        });
      } catch (err) {
        sse(res, 'error', { error: 'Generation failed' });
        return res.end();
      }
      if (out && out.error) { sse(res, 'error', { error: out.error }); return res.end(); }
      if (out && out.unavailable) { sse(res, 'error', { error: 'unavailable', diag: out._diag || null }); return res.end(); }
      sse(res, 'done', out);
      res.end();
      // Runs AFTER end() so it can never delay first paint — but it DOES run,
      // so streaming keeps the same cache-bust and refresh-on-view behaviour as
      // the JSON path. Registered through waitUntil because work started after
      // the response is settled is not otherwise guaranteed to finish.
      const post = (async () => { try { await afterResponse(sql, input, out); } catch (_) {} })();
      if (waitUntil) { try { waitUntil(post); } catch (_) { await post; } } else { await post; }
      return;
    }

    const out = await generateInsight(sql, input);
    if (out && out.error) return res.status(400).json({ error: out.error });
    await afterResponse(sql, input, out);
    return res.status(200).json(out);
  } catch (err) {
    console.error('[insight]', (err && err.message) || err);
    return res.status(500).json({ error: 'Insight unavailable' });
  }
};

// Exported for test/sources-heal.test.js — the once-a-day bound is the whole
// point of the rule, so it gets asserted rather than eyeballed. Attached after
// the handler assignment above, which would otherwise clobber it.
module.exports._cachedBefore = cachedBefore;
