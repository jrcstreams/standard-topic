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
const { getSql } = require('../../lib/db');

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
    let items = Array.isArray(payload?.items) ? payload.items : [];

    // Rolling live-blog pages ("Middle East crisis live: …", "… Live Updates:",
    // "as it happened") read as noise in a headline feed — deterministic title
    // filter, mirrored at ingest in api/cron/news.js.
    const LIVE_BLOG_RE = /(\blive updates?\b|\blive blog\b|\blive\s*:|\bas it happened\b)/i;
    items = items.filter((it) => !LIVE_BLOG_RE.test(String((it && it.title) || '')));

    // Phase 6: drop stories the pipeline has flagged (semantic dupes / AI junk).
    // One indexed lookup against news_stories by url; stories not yet ingested/
    // graded pass through (grading catches up within hours and the 15-min edge
    // cache re-filters on refresh). Any error → serve unfiltered (fail open).
    try {
      const sql = getSql();
      const urls = items.map((it) => it && (it.url || it.link)).filter(Boolean);
      if (sql && urls.length) {
        const flagged = await sql.query(
          `SELECT url FROM news_stories
            WHERE url = ANY($1::text[]) AND (dup_of IS NOT NULL OR quality = 'junk')`,
          [urls]
        );
        if (flagged.length) {
          const bad = new Set(flagged.map((r) => r.url));
          items = items.filter((it) => !bad.has(it && (it.url || it.link)));
        }
      }
    } catch (_) { /* pre-migration / transient — unfiltered is fine */ }

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
