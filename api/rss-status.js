// GET /api/rss-status — admin-only overview of the whole rss.app estate, joined
// against the site's topic mapping. Powers the admin "RSS Feeds" tab.
//
// Auth: Bearer ${CRON_SECRET}. rss.app creds stay server-side (Vercel env) — the
// admin panel never sees them.
//
// → { topics:[{slug,name,parent,rssFeedId,kind:'bundle'|'feed'|'missing',
//              bundleName?, members:[{id,title,type}]}],
//     orphans:[{id,title,type}], totals:{feeds,bundles} }
//
// "type" is derived from each feed's source_url: keyword | topicId | publisher.
// Edge-cached 5 min (s-maxage) to keep repeated admin loads off rss.app.

const topicsData = require('../data/topics.json');

const RSSAPP = 'https://api.rss.app/v1';

function typeOf(u) {
  u = u || '';
  if (/[?&]keyword=/.test(u)) return 'keyword';
  if (/[?&]topicId=/.test(u)) return 'topicId';
  if (/^https?:\/\//.test(u) && !/rss\.app/.test(u)) return 'publisher';
  return 'other';
}

async function listAll(path, auth) {
  const out = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await fetch(`${RSSAPP}/${path}?limit=100&offset=${offset}`, {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`rss.app ${path} ${r.status}`);
    const j = await r.json();
    const arr = j.data || [];
    out.push(...arr);
    if (arr.length < 100) break;
  }
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const apiKey = process.env.RSSAPP_API_KEY;
  const apiSecret = process.env.RSSAPP_API_SECRET;
  if (!apiKey || !apiSecret) return res.status(500).json({ error: 'rss.app credentials not configured' });
  const auth = `Bearer ${apiKey}:${apiSecret}`;

  try {
    const [feeds, bundles] = await Promise.all([listAll('feeds', auth), listAll('bundles', auth)]);
    const feedById = new Map(feeds.map((f) => [f.id, f]));
    const bundleById = new Map(bundles.map((b) => [b.id, b]));
    const inBundle = new Set();
    bundles.forEach((b) => (b.feeds || []).forEach((f) => inBundle.add(f.id || f)));

    const mapped = new Set();
    const topics = (topicsData.topics || []).map((t) => {
      const id = (t.rssFeedId || '').trim();
      if (bundleById.has(id)) {
        mapped.add(id);
        const b = bundleById.get(id);
        const members = (b.feeds || []).map((f) => {
          const fid = f.id || f;
          mapped.add(fid);
          const fd = feedById.get(fid);
          return { id: fid, title: fd ? fd.title : '(missing feed)', type: fd ? typeOf(fd.source_url) : '?' };
        });
        return { slug: t.slug, name: t.name, parent: t.parent || null, rssFeedId: id, kind: 'bundle', bundleName: b.name, members };
      }
      if (feedById.has(id)) {
        mapped.add(id);
        const f = feedById.get(id);
        return { slug: t.slug, name: t.name, parent: t.parent || null, rssFeedId: id, kind: 'feed', members: [{ id, title: f.title, type: typeOf(f.source_url) }] };
      }
      return { slug: t.slug, name: t.name, parent: t.parent || null, rssFeedId: id, kind: 'missing', members: [] };
    });

    const orphans = feeds
      .filter((f) => !mapped.has(f.id) && !inBundle.has(f.id))
      .map((f) => ({ id: f.id, title: f.title, type: typeOf(f.source_url) }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ topics, orphans, totals: { feeds: feeds.length, bundles: bundles.length } });
  } catch (err) {
    return res.status(502).json({ error: String((err && err.message) || err).slice(0, 200) });
  }
};
