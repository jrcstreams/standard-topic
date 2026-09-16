// POST /api/rss-merge — admin-only (Bearer ${CRON_SECRET}). Merges rss.app
// bundles for the topic cut (revamp1405): the member feeds of each child
// bundle are added to the parent bundle. Children are NOT deleted here; that
// is a separate, deliberate call once the parent is verified.
//   body: { parent: "<bundle id>", children: ["<bundle id>", …], dryRun?: true }
//   → { parent, before: n, added: [ids], after: n, verified: bool }
//   body: { delete: ["<bundle id>", …] }  → { deleted: [ids], failed: [...] }
const RSSAPP = 'https://api.rss.app/v1';
module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const apiKey = process.env.RSSAPP_API_KEY, apiSecret = process.env.RSSAPP_API_SECRET;
  if (!apiKey || !apiSecret) return res.status(500).json({ error: 'rss.app credentials not configured' });
  const H = { Authorization: `Bearer ${apiKey}:${apiSecret}`, Accept: 'application/json', 'Content-Type': 'application/json' };
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const getBundle = async (id) => { const r = await fetch(`${RSSAPP}/bundles/${encodeURIComponent(id)}`, { headers: H }); if (!r.ok) throw new Error(`GET bundle ${id} → ${r.status}`); return r.json(); };
  const feedIds = (b) => (b.feeds || []).map((f) => (f && f.id) || f).filter(Boolean);
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (Array.isArray(body.delete)) {
      const deleted = [], failed = [];
      for (const id of body.delete) { const r = await fetch(`${RSSAPP}/bundles/${encodeURIComponent(id)}`, { method: 'DELETE', headers: H }); (r.ok ? deleted : failed).push(r.ok ? id : `${id}:${r.status}`); }
      return res.status(200).json({ deleted, failed });
    }
    const parent = await getBundle(body.parent);
    const before = feedIds(parent);
    const union = new Set(before); const added = [];
    for (const cid of (body.children || [])) { const c = await getBundle(cid); for (const fid of feedIds(c)) if (!union.has(fid)) { union.add(fid); added.push(fid); } }
    if (body.dryRun) return res.status(200).json({ parent: body.parent, before: before.length, added, after: union.size, dryRun: true });
    if (!added.length) return res.status(200).json({ parent: body.parent, before: before.length, added: [], after: before.length, verified: true });
    const put = await fetch(`${RSSAPP}/bundles/${encodeURIComponent(body.parent)}`, { method: 'PATCH', headers: H, body: JSON.stringify({ feeds: [...union] }) });
    const putText = await put.text();
    if (!put.ok) return res.status(502).json({ error: `PATCH bundle → ${put.status}`, detail: putText.slice(0, 300) });
    const after = await getBundle(body.parent); const afterIds = feedIds(after);
    return res.status(200).json({ parent: body.parent, before: before.length, added, after: afterIds.length, verified: added.every((id) => afterIds.includes(id)) });
  } catch (e) { return res.status(502).json({ error: String((e && e.message) || e).slice(0, 300) }); }
};
