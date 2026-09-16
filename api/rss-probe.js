// GET /api/rss-probe?id=<feed-or-bundle id> — admin-only: how many items rss.app
// returns for an id via the feeds endpoint and the bundles endpoint. Diagnostic
// for the feed cut-over (revamp1405). Auth: Bearer ${CRON_SECRET}.
module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  const apiKey = process.env.RSSAPP_API_KEY, apiSecret = process.env.RSSAPP_API_SECRET;
  if (!apiKey || !apiSecret) return res.status(500).json({ error: 'rss.app credentials not configured' });
  const auth = `Bearer ${apiKey}:${apiSecret}`;
  const id = encodeURIComponent(String(req.query.id || ''));
  if (!id) return res.status(400).json({ error: 'id required' });
  const probe = async (path) => {
    try {
      const r = await fetch(`https://api.rss.app/v1/${path}`, { headers: { Authorization: auth, Accept: 'application/json' } });
      const j = await r.json().catch(() => null);
      const items = j && Array.isArray(j.items) ? j.items : [];
      return { status: r.status, keys: j ? Object.keys(j).slice(0, 12) : [], items: items.length, newest: items[0] ? { title: String(items[0].title || '').slice(0, 80), date: items[0].date_published || items[0].pubDate || null } : null, feeds: j && Array.isArray(j.feeds) ? j.feeds.length : undefined };
    } catch (e) { return { error: String(e && e.message) }; }
  };
  const [feed, bundle] = await Promise.all([probe(`feeds/${id}?limit=20`), probe(`bundles/${id}`)]);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ id: req.query.id, feed, bundle });
};
