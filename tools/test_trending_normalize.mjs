import assert from 'node:assert';
import { normalizeTrending } from '../js/utils/trending-normalize.js';

// Two geos, one duplicate query (case-insensitive) → deduped, capped, ISO timestamp.
const us = { trending_searches: [
  { query: 'Taylor Swift', start_timestamp: 1700000000, categories: [{ id: 3, name: 'Entertainment' }] },
  { query: 'NBA trade', start_timestamp: 1700003600, categories: [] },
] };
const uk = { trending_searches: [
  { query: 'taylor swift', start_timestamp: 1700000500 }, // dup of US (case-insensitive)
  { query: 'Premier League', start_timestamp: 1700001000 },
] };

const out = normalizeTrending([{ geo: 'US', data: us }, { geo: 'UK', data: uk }], 20);
assert.equal(out.length, 3, 'dedupes case-insensitively across geos');
assert.equal(out[0].query, 'Taylor Swift');
assert.equal(out[0].region, 'US');
assert.equal(out[0].startedAt, new Date(1700000000 * 1000).toISOString());
assert.deepEqual(out[0].categories, ['Entertainment']);
assert.equal(out[2].query, 'Premier League');
assert.equal(out[2].region, 'UK');

// Cap respected, missing/blank queries dropped.
const many = { trending_searches: Array.from({ length: 30 }, (_, i) => ({ query: `q${i}` })).concat([{ query: '' }, {}]) };
assert.equal(normalizeTrending([{ geo: 'US', data: many }], 20).length, 20, 'caps at limit, drops blanks');

console.log('OK: normalizeTrending');
