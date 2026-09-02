// The sources-heal regenerates a cached brief that stored no grounding
// citations. Its trigger — "no citations" — survives its own fix whenever the
// model or the budget simply never produces one, so every gate on it has to
// actually hold. Regression cover for #revamp1160, where daily briefs
// re-generated on essentially every view.
const test = require('node:test');
const assert = require('node:assert');
const { _cachedBefore: cachedBefore } = require('../api/insight');
const { groundingHeadroom, sourcesEmpty } = require('../lib/insight-core');

const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString();

// A fake Neon client: `searches` is today's grounded-search count, `empties` is
// the empty-grounded-response circuit breaker's counter.
function fakeSql({ searches = 0, empties = 0 }) {
  return {
    async query(text) {
      if (/ai_usage_surface/.test(text)) return [{ n: empties }];
      if (/FROM ai_usage/.test(text)) return [{ searches }];
      return [];
    },
  };
}

test('a brief cached earlier today is not healed again', () => {
  assert.equal(cachedBefore(new Date().toISOString()), false);
});

test('a brief cached on an earlier day is healable', () => {
  assert.equal(cachedBefore(day(-1)), true);
});

test('an undated cache entry is never healed', () => {
  assert.equal(cachedBefore(undefined), false);
  assert.equal(cachedBefore('not a date'), false);
});

test('headroom is judged against the OVERVIEW ceiling for shortcut briefs', async () => {
  // 1,200 searches: past the overview ceiling (1,100), under the real-time one
  // (1,450). A news brief may still ground here; an overview may not, so healing
  // one would regenerate it ungrounded and cache it sourceless all over again.
  const sql = fakeSql({ searches: 1200 });
  assert.equal(await groundingHeadroom(sql, { overview: true }), false);
  assert.equal(await groundingHeadroom(sql), true);
});

test('no headroom once the empty-grounding breaker has tripped', async () => {
  // Plenty of budget on paper, but Google is returning empty grounded responses
  // for the rest of the day — every heal from here is a wasted generation.
  const sql = fakeSql({ searches: 0, empties: 6 });
  assert.equal(await groundingHeadroom(sql), false);
  assert.equal(await groundingHeadroom(sql, { overview: true }), false);
});

test('headroom below both ceilings with the breaker open', async () => {
  const sql = fakeSql({ searches: 10 });
  assert.equal(await groundingHeadroom(sql), true);
  assert.equal(await groundingHeadroom(sql, { overview: true }), true);
});

test('a database that cannot be read reports no headroom', async () => {
  const sql = { async query() { throw new Error('402 quota'); } };
  assert.equal(await groundingHeadroom(sql), false);
  assert.equal(await groundingHeadroom(null), false);
});

test('sourcesEmpty recognises both the flat and per-section shapes', () => {
  assert.equal(sourcesEmpty([]), true);
  assert.equal(sourcesEmpty({}), true);
  assert.equal(sourcesEmpty({ 'Big Picture': [] }), true);
  assert.equal(sourcesEmpty([{ uri: 'https://ex.com' }]), false);
  assert.equal(sourcesEmpty({ 'Big Picture': [{ uri: 'https://ex.com' }] }), false);
});
