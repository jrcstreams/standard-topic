// Neon Postgres client (HTTP driver) shared by the Vercel serverless
// functions and the local migrate/seed scripts. Plain CommonJS so it
// matches the rest of /api — no TypeScript, no ORM, raw parameterized SQL.
//
//   const { getSql } = require('../lib/db');
//   const sql = getSql();
//   const rows = await sql`SELECT * FROM topics WHERE slug = ${slug}`;
//   const rows = await sql.query('SELECT ... WHERE id = $1', [id]);
//
// getSql() returns null when DATABASE_URL is unset so callers can degrade
// gracefully (the crons no-op, the read endpoints return 503) instead of
// throwing — important during the window before Neon is provisioned.

const { neon } = require('@neondatabase/serverless');

let _sql = null;

function getSql() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!url) return null;
  if (!_sql) _sql = neon(url);
  return _sql;
}

// Multi-row parameterized INSERT. Far fewer round-trips than one INSERT per
// row over the HTTP driver. Pass `jsonbCols` (column names) to cast those
// placeholders ::jsonb, `conflict` for an ON CONFLICT clause, and the call
// always appends `RETURNING id` so the resolved length = rows actually
// inserted (honouring ON CONFLICT DO NOTHING).
//
//   rows: Array<Array<value>>  — each inner array is one row, in `columns` order
async function bulkInsert(sql, table, columns, rows, opts = {}) {
  if (!rows.length) return 0;
  const jsonb = new Set(opts.jsonbCols || []);
  const tuples = [];
  const params = [];
  let p = 1;
  for (const row of rows) {
    const placeholders = row.map((_, ci) => {
      const ph = `$${p++}`;
      return jsonb.has(columns[ci]) ? `${ph}::jsonb` : ph;
    });
    tuples.push(`(${placeholders.join(', ')})`);
    params.push(...row);
  }
  const cols = columns.map((c) => `"${c}"`).join(', ');
  const conflict = opts.conflict ? ` ${opts.conflict}` : '';
  const text = `INSERT INTO ${table} (${cols}) VALUES ${tuples.join(', ')}${conflict} RETURNING id`;
  const result = await sql.query(text, params);
  const out = Array.isArray(result) ? result : (result && result.rows) || [];
  return out.length;
}

module.exports = { getSql, bulkInsert };
