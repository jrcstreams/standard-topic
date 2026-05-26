// Vercel serverless function — POST /api/webhooks/rss-app
//
// Receives publish-event webhooks from rss.app and invalidates the
// matching topic's edge cache so the next user request serves a
// fresh fetch from rss.app.
//
// Why this exists
//   The default freshness for any topic's news feed is whatever the
//   /api/feeds/{slug} CDN cache window allows (currently 15min via
//   s-maxage=900). For topics where we want closer-to-real-time
//   updates, we opt into webhooks at rss.app's dashboard; that
//   service then POSTs here whenever the feed publishes new items
//   and we drop the relevant CDN entry so the next request rehydrates
//   immediately. Topics with webhookEnabled: false in data/topics.json
//   keep the slow path (good enough for low-volume / evergreen content).
//
// Why URL-token auth (instead of HMAC)
//   rss.app's API doesn't document a payload-signing mechanism, so
//   we put a long random shared secret in the webhook URL itself
//   ("?token=…") and require it. Anyone who doesn't know the token
//   gets a 401 and the rest of the function never runs. Trade-off:
//   the token appears in rss.app's outbound request logs and in
//   our request logs — fine for a low-value endpoint like this,
//   but rotate the token (RSSAPP_WEBHOOK_TOKEN) if it ever leaks.
//
// rss.app webhook payload shape (per their docs)
//   {
//     "id": "evt_…",
//     "type": "feed_update",
//     "feed": { "id": "tQkP…", "title": "…", … },
//     "data": { "items_new": [...], "items_changed": [...] }
//   }
//
// Response codes
//   200 — handled (cache invalidated, or quietly ignored — see below)
//   401 — missing/wrong ?token=
//   405 — non-POST request
//   500 — server misconfiguration (env var missing)
//
// We respond 200 for ALL of the following so rss.app doesn't retry:
//   - feed_id not in our topics.json (orphan webhook)
//   - matched topic has webhookEnabled: false (intentionally off)
//   - invalidateByTag throws (we still want to ack receipt;
//     the 15-min CDN window will recover us)
// The only thing that returns non-200 is rejected auth or malformed
// requests we'd genuinely want rss.app to surface as failures.

const topicsData = require('../../data/topics.json');

let invalidateByTag;
try {
  // Imported lazily so module load doesn't crash in environments
  // where @vercel/functions isn't available (e.g., a local dev run
  // before npm install).
  ({ invalidateByTag } = require('@vercel/functions'));
} catch (e) {
  invalidateByTag = null;
}

function findTopicByFeedId(feedId) {
  if (!feedId || typeof feedId !== 'string') return null;
  const topics = topicsData?.topics || [];
  return topics.find((t) => t.rssFeedId === feedId) || null;
}

async function readJSONBody(req) {
  // Vercel's Node runtime parses JSON bodies for POSTs with the
  // right Content-Type — but we re-read defensively in case the
  // request hits us with an unexpected content-type and req.body
  // is undefined.
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  // Fall back to streaming the raw body.
  return await new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

module.exports = async function handler(req, res) {
  // POST only — rss.app's webhook is documented as POST. Reject
  // anything else so a stray GET doesn't accidentally invalidate.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // URL-token auth. The token is provided in the webhook URL when
  // configured at rss.app (e.g.
  // https://standardtopic.com/api/webhooks/rss-app?token=…).
  const expected = process.env.RSSAPP_WEBHOOK_TOKEN;
  if (!expected) {
    return res.status(500).json({ error: 'Server misconfiguration' });
  }
  const provided = req.query?.token;
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = await readJSONBody(req);
  const feedId = body?.feed?.id;
  if (!feedId) {
    // Malformed payload from rss.app's perspective — 200 + ignore so
    // they don't retry. Worth logging server-side to spot drift.
    console.warn('[rss-app webhook] payload missing feed.id');
    return res.status(200).json({ ok: true, ignored: 'no-feed-id' });
  }

  const topic = findTopicByFeedId(feedId);
  if (!topic) {
    // Orphan webhook: rss.app has a webhook configured for a feed
    // that's no longer in our taxonomy (or was never mapped). Ack
    // silently so they don't retry; surface in logs for awareness.
    console.warn(`[rss-app webhook] no topic for feed_id=${feedId}`);
    return res.status(200).json({ ok: true, ignored: 'unknown-feed' });
  }

  // Intentional opt-out: topic exists but admin has webhookEnabled
  // turned off. Still 200 so rss.app moves on without retrying.
  if (!topic.webhookEnabled) {
    return res.status(200).json({ ok: true, ignored: 'disabled', slug: topic.slug });
  }

  // Invalidate the cached /api/feeds/{slug} response. The next
  // request to that path will refetch from rss.app and repopulate
  // the CDN cache.
  if (!invalidateByTag) {
    console.error('[rss-app webhook] @vercel/functions not available');
    return res.status(200).json({ ok: true, ignored: 'no-invalidator', slug: topic.slug });
  }

  try {
    await invalidateByTag(`topic-${topic.slug}`);
    return res.status(200).json({ ok: true, slug: topic.slug, invalidated: `topic-${topic.slug}` });
  } catch (err) {
    // Cache purge failed — log + ack. Worst case is users wait up
    // to 15min (the s-maxage window) for the new article to surface.
    console.error(`[rss-app webhook] invalidate failed for ${topic.slug}:`, err?.message);
    return res.status(200).json({ ok: true, slug: topic.slug, invalidate_error: true });
  }
};
