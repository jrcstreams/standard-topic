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

function readInput(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  return Object.assign({}, req.query || {}, body || {});
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const out = await generateInsight(getSql(), readInput(req));
    if (out && out.error) return res.status(400).json({ error: out.error });
    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
