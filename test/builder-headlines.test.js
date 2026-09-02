// The daily briefing is only as current as the headline sample it is built from.
// Regression cover for #revamp1157, where Soccer's 1 Sep brief was generated from
// a sample dated entirely 30 Aug because news_stories had not been ingested for
// that topic in three days.
const test = require('node:test');
const assert = require('node:assert');
const { _mergeHeadlines: merge, _BUILDER_FRESH_HOURS: FRESH, _BUILDER_MIN_FRESH: MIN } = require('../lib/insight-core');

const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
const head = (id, h) => ({ title: `story ${id}`, url: `https://ex.com/${id}`, source: 's', date: ago(h) });

// The stored rows the ingest cron left behind: a full weekend out of date.
const stale = Array.from({ length: 20 }, (_, i) => head(`old${i}`, FRESH + 24 + i));
// What the live rss.app bundle is serving right now.
const live = Array.from({ length: 10 }, (_, i) => head(`new${i}`, i));

test('fresh live headlines displace stale stored rows', () => {
  const out = merge(live, stale, 8);
  assert.equal(out.length, 8);
  for (const r of out) {
    assert.ok(Date.now() - Date.parse(r.date) < FRESH * 36e5, `${r.url} is older than the freshness floor`);
  }
});

test('newest first', () => {
  const out = merge(live, stale, 5);
  const times = out.map((r) => Date.parse(r.date));
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test('the same story from both sources appears once', () => {
  const dupe = { ...head('new0', 0), source: 'stored copy' };
  const out = merge(live, [dupe, ...stale], 10);
  assert.equal(out.filter((r) => r.url === 'https://ex.com/new0').length, 1);
});

test('trailing slash and query string do not defeat dedup', () => {
  const out = merge(live, [{ ...head('new1', 2), url: 'https://ex.com/new1/?utm_source=rss' }], 10);
  assert.equal(out.filter((r) => r.url.includes('/new1')).length, 1);
});

test('a quiet topic still gets a brief rather than an empty sample', () => {
  const thin = [head('a', 1), head('b', 2)];           // fewer than MIN fresh
  const out = merge(thin, stale, 10);
  assert.ok(thin.length < MIN, 'fixture must be under the fresh minimum');
  assert.equal(out.length, 10);
  assert.equal(out[0].url, 'https://ex.com/a');        // fresh still leads
  assert.ok(out.some((r) => r.url.startsWith('https://ex.com/old')), 'older rows backfill');
});

test('no live feed falls back to stored rows unchanged in spirit', () => {
  const out = merge([], stale, 6);
  assert.equal(out.length, 6);
});

// A story we cannot date cannot be shown to be from today, so it must not pad
// out the fresh sample — but it is still real coverage, so it backfills a thin
// one rather than being thrown away.
test('an undated story never passes as fresh', () => {
  const undated = { title: 'no date', url: 'https://ex.com/undated', source: 's', date: '' };
  const out = merge([undated, ...live], [], 11);
  assert.ok(!out.some((r) => r.url === 'https://ex.com/undated'));
});

test('an undated story backfills a thin sample, sorted last', () => {
  const undated = { title: 'no date', url: 'https://ex.com/undated', source: 's', date: '' };
  const out = merge([undated, head('a', 1)], [], 5);
  assert.equal(out.length, 2);
  assert.equal(out[out.length - 1].url, 'https://ex.com/undated');
});
