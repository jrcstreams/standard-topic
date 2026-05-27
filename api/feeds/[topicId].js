// Vercel serverless function — GET /api/feeds/{topicSlug}
//
// Replaces the rss.app iframe widgets that previously rendered news
// directly from widget.rss.app on the client. Now the client fetches
// this endpoint, which:
//   1. Resolves the topic by slug from data/topics.json (single source
//      of truth maintained by the admin panel).
//   2. Calls the rss.app v1 API server-side using credentials in env.
//   3. Caches at the Vercel edge for 15 minutes (stale-while-
//      revalidate for an additional hour) so a busy topic only hits
//      rss.app a few times per hour regardless of traffic.
//
// Response shapes
//   200 — { slug, title, items, fetched }
//   200 — { slug, title, items: [], noFeed: true, fetched }
//         (topic exists but has no rssFeedId set)
//   404 — { error: "Topic not found" }
//   502 — { error: "Upstream feed unavailable" }
//         (rss.app returned non-2xx; details intentionally omitted)
//   500 — { error: "Server misconfiguration" }
//         (auth credentials missing in env)

const topicsData = require('../../data/topics.json');

const RSSAPP_BASE = 'https://api.rss.app/v1/feeds';
// Edge cache window: 15 minutes fresh, 1 hour stale-while-revalidate.
// Articles can update within ~15min of publishing — fresh enough for
// a news site without hammering the upstream API on every request.
// When a topic has webhookEnabled: true the rss.app webhook fires on
// publish and /api/webhooks/rss-app invalidates this response by tag,
// so the 15-min ceiling becomes a fallback rather than the primary
// latency.
const CACHE_HEADER = 's-maxage=900, stale-while-revalidate=3600';

// Vercel CDN cache tag — lets /api/webhooks/rss-app invalidate this
// specific topic's cached response (and only this one) when rss.app
// notifies us of a new article. Format: topic-{slug}. The catch-all
// "feeds-all" tag is added so a maintenance script can drop every
// feed cache at once if ever needed.
function cacheTags(slug) {
  return `topic-${slug},feeds-all`;
}

function findTopic(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const topics = topicsData?.topics || [];
  return topics.find((t) => t.slug === slug) || null;
}

module.exports = async function handler(req, res) {
  // Vercel populates dynamic route params under req.query using the
  // bracket-name from the file path — here, "topicId".
  const slug = req.query?.topicId;
  const topic = findTopic(slug);

  if (!topic) {
    return res.status(404).json({ error: 'Topic not found' });
  }

  const feedId = (topic.rssFeedId || '').trim();
  const fetched = new Date().toISOString();

  // Topic exists in the taxonomy but has no feed assigned yet. The
  // frontend renders its "News feed coming soon" placeholder when
  // it sees noFeed:true. 200 (not 404) because the topic itself is
  // a real, navigable page.
  if (!feedId) {
    res.setHeader('Cache-Control', CACHE_HEADER);
    res.setHeader('Vercel-Cache-Tag', cacheTags(topic.slug));
    return res.status(200).json({
      slug: topic.slug,
      title: topic.name,
      items: [],
      noFeed: true,
      fetched,
    });
  }

  const apiKey = process.env.RSSAPP_API_KEY;
  const apiSecret = process.env.RSSAPP_API_SECRET;
  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  try {
    // rss.app's v1 API defaults to ~20 items per feed; pass limit=50
    // explicitly so the news feed has more headlines per page. 50 is
    // well below rss.app's per-request ceiling (typically 100) and
    // keeps the payload small enough for the 15-minute edge cache.
    const upstream = await fetch(`${RSSAPP_BASE}/${encodeURIComponent(feedId)}?limit=50`, {
      headers: {
        Authorization: `Bearer ${apiKey}:${apiSecret}`,
        Accept: 'application/json',
      },
    });

    if (!upstream.ok) {
      // Don't surface the upstream body — could leak feed-id or
      // account context. Caller just needs to know it failed.
      return res.status(502).json({ error: 'Upstream feed unavailable' });
    }

    const payload = await upstream.json();
    // rss.app's response shape places articles under `items`. Pass
    // through as-is so the client can render whatever fields
    // (title, url, description, pub_date, image_url, etc.) it
    // chooses. Defensive default to [] in case the shape changes.
    const items = Array.isArray(payload?.items) ? payload.items : [];

    res.setHeader('Cache-Control', CACHE_HEADER);
    res.setHeader('Vercel-Cache-Tag', cacheTags(topic.slug));
    return res.status(200).json({
      slug: topic.slug,
      title: topic.name,
      items,
      fetched,
    });
  } catch (err) {
    return res.status(502).json({ error: 'Upstream feed unavailable' });
  }
};
