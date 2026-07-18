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

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const input = readInput(req);
    const sql = getSql();
    const out = await generateInsight(sql, input);
    if (out && out.error) return res.status(400).json({ error: out.error });
    // A freshly generated trend brief carries a new one-liner — bust the
    // trending list cache so the homepage/modal surface it without waiting out
    // /api/trending's 1h edge cache.
    if (input.type === 'trend' && out && out.content && !out.cached && invalidateByTag) {
      try { await invalidateByTag('trending-all'); } catch (_) {}
    }
    // Background refresh-on-view: regenerate a cached brief without blocking this
    // read. Two triggers, at most one refresh fired:
    //   (a) AGE — an AI Intelligence overview past its (path-class × topic-tier)
    //       freshness window.
    //   (b) SOURCES-HEAL — any grounded brief (news/trend/overview) cached WITHOUT
    //       grounding citations (e.g. generated on a day the grounding budget was
    //       exhausted). Re-grounds it on view, but ONLY when there's grounding
    //       headroom today — otherwise it would just regenerate sourceless again
    //       and burn tokens. News matters most: it never refreshes by age, so
    //       without this a sourceless news brief stays that way forever.
    if (out && out.cached && waitUntil
        && (input.type === 'shortcut' || input.type === 'news' || input.type === 'trend')) {
      let doRefresh = false;
      if (input.type === 'shortcut' && out.generatedAt) {
        const ageH = (Date.now() - new Date(out.generatedAt).getTime()) / 36e5;
        const windowH = effectiveWindowHours(input.group, tierForTopic(input.topic));
        if (Number.isFinite(ageH) && ageH >= windowH) doRefresh = true;
      }
      // Sources-heal is for GROUNDED briefs (news/overviews) whose citations were
      // lost to a spent grounding budget. Trend briefs are RAG: their sources come
      // from retrieval, and a trend whose coverage fails the relevance gate will
      // KEEP coming back sourceless — healing it on every view just re-burns a
      // SerpAPI search each time, forever (this loop exhausted the SerpAPI plan,
      // #serpburn). Never sources-heal trends.
      if (!doRefresh && input.type !== 'trend' && sourcesEmpty(out.sources) && await groundingHeadroom(sql)) doRefresh = true;
      if (doRefresh) {
        waitUntil((async () => { try { await generateInsight(sql, { ...input, refresh: 1 }); } catch (_) {} })());
      }
    }
    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
