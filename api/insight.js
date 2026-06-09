// Vercel serverless function — /api/insight  (GET or POST)
//
// Thin HTTP wrapper around lib/insight-core.generateInsight(). Returns ONE
// consolidated, grounded, cached AI brief per entity (news / trend / shortcut).
// See lib/insight-core.js for the logic, prompts, grounding + spend budget.
//
//   200 — { content, sources, cached } | { unavailable:true } | { capped:true }
//   400 — { error }

const { getSql } = require('../lib/db');
const { generateInsight } = require('../lib/insight-core');
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
    // Refresh-on-view: if an AI Intelligence path was served from cache but is
    // older than its (path-class × topic-tier) window, regenerate it in the
    // background and serve the current copy now. Next view shows the fresh one.
    if (input.type === 'shortcut' && out && out.cached && out.generatedAt && waitUntil) {
      const ageH = (Date.now() - new Date(out.generatedAt).getTime()) / 36e5;
      const windowH = effectiveWindowHours(input.group, tierForTopic(input.topic));
      if (Number.isFinite(ageH) && ageH >= windowH) {
        waitUntil((async () => { try { await generateInsight(sql, { ...input, refresh: 1 }); } catch (_) {} })());
      }
    }
    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
