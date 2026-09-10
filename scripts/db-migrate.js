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

// Read .env.local before anything touches process.env, so the connection
// string can live in the gitignored file rather than being typed onto a
// command line (where it lands in shell history). Deliberately tiny — the
// serverless functions get their env from Vercel and must not read files.
(function loadEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim().replace(/^['"]|['"]$/g, '');
    if (val && !process.env[key]) process.env[key] = val;
  }
})();

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
