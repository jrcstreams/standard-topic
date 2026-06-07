// Seed / refresh the topics table from data/topics.json (the single source
// of truth maintained by the admin panel). Upserts on slug, so re-running
// after editing topics.json picks up new topics, renames, and changed
// rss_app_feed_id values without duplicating rows. Usage:
//
//   DATABASE_URL='postgres://...' npm run db:seed

const { getSql } = require('../lib/db');
const topicsData = require('../data/topics.json');

async function main() {
  const sql = getSql();
  if (!sql) {
    console.error('✗ DATABASE_URL (or DATABASE_URL_UNPOOLED) is not set.');
    process.exit(1);
  }
  const topics = (topicsData && topicsData.topics) || [];
  let n = 0;
  for (const t of topics) {
    if (!t || !t.slug) continue;
    const feedId = (t.rssFeedId || '').trim() || null;
    await sql.query(
      `INSERT INTO topics (slug, name, parent, rss_app_feed_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         parent = EXCLUDED.parent,
         rss_app_feed_id = EXCLUDED.rss_app_feed_id`,
      [t.slug, t.name, t.parent || null, feedId]
    );
    n++;
  }
  console.log(`✓ Seeded/updated ${n} topics`);
}

main().catch((err) => {
  console.error('✗ Seed failed:', err.message || err);
  process.exit(1);
});
