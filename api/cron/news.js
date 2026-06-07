// Vercel Cron — GET /api/cron/news  (schedule in vercel.json)
//
// Captures RSS articles into news_stories so we accumulate a long, deduped,
// searchable history per topic (the live /api/feeds endpoint only ever shows
// the newest ~50 and forgets the rest). This is the WRITE path.
//
// Topics are processed in rotating batches so one run never fans out to all
// 100 rss.app feeds at once: with BATCH_SIZE=25 and a 6h schedule, all topics
// are covered every 24h. Dedup is ON CONFLICT (topic_id, external_id) DO
// NOTHING, so only genuinely new articles are stored. After each topic we
// prune to KEEP_PER_TOPIC newest rows to bound growth.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically.
//
//   200 — { ok, batch, topics, fetched, inserted }   (or skipped:true pre-provision)
//   401 — { error }
//   500 — { error }

const crypto = require('crypto');
const { getSql, bulkInsert } = require('../../lib/db');

const RSSAPP_BASE = 'https://api.rss.app/v1/feeds';
const BATCH_SIZE = 25;          // feeds fetched per run
const FETCH_LIMIT = 100;        // articles pulled per feed (rss.app ceiling)
const KEEP_PER_TOPIC = 1000;    // retained history per topic
const ROTATE_MS = 6 * 60 * 60 * 1000; // matches the 6h cron cadence

const NEWS_COLS = [
  'topic_id', 'external_id', 'url', 'title', 'description',
  'source_name', 'source_url', 'image_url', 'published_at', 'raw',
];

function firstString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

function mapStory(topicId, item) {
  const url = firstString(item.url, item.link);
  const title = firstString(item.title);
  if (!url || !title) return null;
  const externalId = firstString(item.id, item.guid) || crypto.createHash('sha1').update(url).digest('hex');
  const description = firstString(item.description_text, item.content_text, item.description, item.summary);
  const source = firstString(item.source_name, item.authors && item.authors[0] && item.authors[0].name) || hostOf(url);
  return [
    topicId,
    externalId,
    url,
    title,
    description,
    source,
    firstString(item.source_url) || (url ? `https://${hostOf(url)}` : null),
    firstString(item.image, item.image_url, item.thumbnail),
    parseDate(item.date_published || item.pub_date || item.published_at || item.date),
    JSON.stringify(item),
  ];
}

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = getSql();
  if (!sql) return res.status(200).json({ ok: true, skipped: 'no database configured yet' });

  const apiKey = process.env.RSSAPP_API_KEY;
  const apiSecret = process.env.RSSAPP_API_SECRET;
  if (!apiKey || !apiSecret) return res.status(500).json({ error: 'Server misconfiguration' });

  const fetched = new Date().toISOString();
  try {
    // Topics with a feed, deterministically ordered, sliced into the batch
    // for this run so coverage rotates across the day.
    const topics = await sql.query(
      `SELECT id, slug, rss_app_feed_id FROM topics
       WHERE rss_app_feed_id IS NOT NULL AND rss_app_feed_id <> ''
       ORDER BY id`
    );
    if (!topics.length) return res.status(200).json({ ok: true, batch: 0, topics: 0, inserted: 0, fetched });

    const totalBatches = Math.ceil(topics.length / BATCH_SIZE);
    // Manual overrides for backfilling coverage: ?all=1 ingests every topic in
    // one run; ?batch=N forces a specific rotation batch. Default rotates by time.
    const all = req.query.all === '1' || req.query.all === 'true';
    const override = parseInt(req.query.batch, 10);
    const batch = Number.isInteger(override)
      ? ((override % totalBatches) + totalBatches) % totalBatches
      : Math.floor(Date.now() / ROTATE_MS) % totalBatches;
    const slice = all ? topics : topics.slice(batch * BATCH_SIZE, batch * BATCH_SIZE + BATCH_SIZE);

    let inserted = 0;
    const auth = `Bearer ${apiKey}:${apiSecret}`;
    for (const topic of slice) {
      const feedId = encodeURIComponent(topic.rss_app_feed_id);
      const r = await fetch(`${RSSAPP_BASE}/${feedId}?limit=${FETCH_LIMIT}`, {
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      if (!r.ok) continue; // skip a flaky feed; next run retries it
      const payload = await r.json();
      const items = Array.isArray(payload && payload.items) ? payload.items : [];
      const rows = items.map((it) => mapStory(topic.id, it)).filter(Boolean);

      inserted += await bulkInsert(sql, 'news_stories', NEWS_COLS, rows, {
        jsonbCols: ['raw'],
        conflict: 'ON CONFLICT (topic_id, external_id) DO NOTHING',
      });

      // Prune to the newest KEEP_PER_TOPIC for this topic.
      await sql.query(
        `DELETE FROM news_stories WHERE id IN (
           SELECT id FROM (
             SELECT id, row_number() OVER (
               PARTITION BY topic_id
               ORDER BY coalesce(published_at, fetched_at) DESC
             ) AS rn
             FROM news_stories WHERE topic_id = $1
           ) ranked WHERE rn > $2
         )`,
        [topic.id, KEEP_PER_TOPIC]
      );
    }

    return res.status(200).json({ ok: true, batch, topics: slice.length, inserted, fetched });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
