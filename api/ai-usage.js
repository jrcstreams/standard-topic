// Vercel serverless function — GET /api/ai-usage
//
// Read-only view of the ai_usage spend log (written by lib/insight-core on every
// generated insight). Powers the admin panel's "AI Usage" tab so run-rate is
// visible without squinting at the Gemini billing page.
//
//   GET /api/ai-usage[?days=30]
//     -> { days: [{ day, calls, grounded, inTok, outTok, costMicros, costUsd }...],  // newest first
//          totals: { calls, grounded, inTok, outTok, costMicros, costUsd },
//          groundingFreeDaily, generatedAt }
//
//   503 — { error }   (database not configured)
//
// CORS-open (aggregate counts only, no secrets) so admin.html can read it
// cross-origin when opened locally / from Pages.

const { getSql } = require('../lib/db');

const GROUNDING_FREE = parseInt(process.env.GEMINI_GROUNDING_FREE || '0', 10);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);

  try {
    let rows;
    try {
      rows = await sql.query(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, calls, grounded, searches, in_tok, out_tok, est_cost_micros
           FROM ai_usage ORDER BY day DESC LIMIT $1`, [days]);
    } catch (_) {
      // Pre-migration: grounded/searches/in_tok/out_tok columns may not exist yet.
      rows = await sql.query(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, calls, est_cost_micros
           FROM ai_usage ORDER BY day DESC LIMIT $1`, [days]);
    }

    const out = rows.map((r) => {
      const micros = Number(r.est_cost_micros) || 0;
      return {
        day: r.day,
        calls: Number(r.calls) || 0,
        grounded: Number(r.grounded) || 0,
        searches: Number(r.searches) || 0,
        inTok: Number(r.in_tok) || 0,
        outTok: Number(r.out_tok) || 0,
        costMicros: micros,
        costUsd: Math.round(micros) / 1e6,
      };
    });

    const totals = out.reduce((a, d) => ({
      calls: a.calls + d.calls,
      grounded: a.grounded + d.grounded,
      searches: a.searches + d.searches,
      inTok: a.inTok + d.inTok,
      outTok: a.outTok + d.outTok,
      costMicros: a.costMicros + d.costMicros,
    }), { calls: 0, grounded: 0, searches: 0, inTok: 0, outTok: 0, costMicros: 0 });
    totals.costUsd = Math.round(totals.costMicros) / 1e6;

    return res.status(200).json({
      days: out,
      totals,
      groundingFreeDaily: GROUNDING_FREE,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
