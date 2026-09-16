// POST /api/rss-merge — admin-only (Bearer ${CRON_SECRET}). Merges rss.app
// bundles for the topic cut (revamp1405): the member feeds of each child
// bundle are added to the parent bundle. Children are NOT deleted here; that
// is a separate, deliberate call once the parent is verified.
//
// rss.app has no "replace the feeds array" call — PATCH /bundles/{id} only
// edits name/description/icon and silently ignores a `feeds` key. Membership
// is one call per feed (PUT /bundles/{id}/feeds/{feedId}), and the API rate
// limit is about one write a second, so the loop paces itself and backs off
// on a 429.
//   body: { parent: "<bundle id>", children: ["<bundle id>", …], dryRun?: true }
//   → { parent, before, added: [ids], failed: [...], after, verified }
//   body: { delete: ["<bundle id>", …] }  → { deleted: [ids], failed: [...] }
const RSSAPP = 'https://api.rss.app/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const apiKey = process.env.RSSAPP_API_KEY, apiSecret = process.env.RSSAPP_API_SECRET;
  if (!apiKey || !apiSecret) return res.status(500).json({ error: 'rss.app credentials not configured' });
  const H = { Authorization: `Bearer ${apiKey}:${apiSecret}`, Accept: 'application/json', 'Content-Type': 'application/json' };
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const pace = Math.max(200, Math.min(5000, Number(body.paceMs) || 1200));
  const getBundle = async (id) => {
    const r = await fetch(`${RSSAPP}/bundles/${encodeURIComponent(id)}`, { headers: H });
    if (!r.ok) throw new Error(`GET bundle ${id} → ${r.status}`);
    return r.json();
  };
  const feedIds = (b) => (b.feeds || []).map((f) => (f && f.id) || f).filter(Boolean);
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (Array.isArray(body.delete)) {
      const deleted = [], failed = [];
      for (const id of body.delete) {
        const r = await fetch(`${RSSAPP}/bundles/${encodeURIComponent(id)}`, { method: 'DELETE', headers: H });
        (r.ok ? deleted : failed).push(r.ok ? id : `${id}:${r.status}`);
        await sleep(pace);
      }
      return res.status(200).json({ deleted, failed });
    }
    const parent = await getBundle(body.parent);
    const before = feedIds(parent);
    const have = new Set(before);
    const want = [];
    for (const cid of (body.children || [])) {
      const c = await getBundle(cid);
      for (const fid of feedIds(c)) if (!have.has(fid) && !want.includes(fid)) want.push(fid);
    }
    if (body.dryRun) return res.status(200).json({ parent: body.parent, before: before.length, added: want, after: before.length + want.length, dryRun: true });
    const added = [], failed = [];
    for (const fid of want) {
      let ok = false, last = '';
      for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        if (attempt) await sleep(pace * (attempt + 1) * 2);
        const r = await fetch(`${RSSAPP}/bundles/${encodeURIComponent(body.parent)}/feeds/${encodeURIComponent(fid)}`, { method: 'PUT', headers: H });
        ok = r.ok; last = String(r.status);
        if (!ok && r.status !== 429 && r.status !== 503) break;
      }
      (ok ? added : failed).push(ok ? fid : `${fid}:${last}`);
      await sleep(pace);
    }
    const after = await getBundle(body.parent);
    const afterIds = feedIds(after);
    return res.status(200).json({ parent: body.parent, before: before.length, added, failed, after: afterIds.length, verified: added.every((id) => afterIds.includes(id)) && !failed.length });
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || e).slice(0, 300) });
  }
};
