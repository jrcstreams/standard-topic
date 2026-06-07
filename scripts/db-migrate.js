// Apply db/schema.sql to the Neon database in DATABASE_URL.
// Run once after provisioning (and again any time the schema changes —
// it's idempotent). Usage:
//
//   DATABASE_URL='postgres://...' npm run db:migrate
//
// Or paste db/schema.sql straight into the Neon SQL editor; this script
// just automates that.

const fs = require('fs');
const path = require('path');
const { getSql } = require('../lib/db');

async function main() {
  const sql = getSql();
  if (!sql) {
    console.error('✗ DATABASE_URL (or DATABASE_URL_UNPOOLED) is not set.');
    process.exit(1);
  }
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const raw = fs.readFileSync(schemaPath, 'utf8');
  // Strip whole-line SQL comments, then split into individual statements.
  // None of our statements contain a literal ';', so a naive split is safe.
  const cleaned = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const statements = cleaned
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await sql.query(stmt);
  }
  console.log(`✓ Applied ${statements.length} statements from db/schema.sql`);
}

main().catch((err) => {
  console.error('✗ Migration failed:', err.message || err);
  process.exit(1);
});
