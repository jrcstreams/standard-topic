const test = require('node:test');
const assert = require('node:assert');
const E = require('../lib/edition');

test('previousEdition steps back one release', () => {
  const m = E.makeEdition(2026, 9, 18, 'morning');
  const p = E.previousEdition(m);
  assert.strictEqual(p.key, '2026-09-17|evening');
  assert.ok(p.releaseAt < m.releaseAt);
  const e = E.makeEdition(2026, 9, 18, 'evening');
  assert.strictEqual(E.previousEdition(e).key, '2026-09-18|morning');
  // across a month boundary
  assert.strictEqual(E.previousEdition(E.makeEdition(2026, 10, 1, 'morning')).key, '2026-09-30|evening');
});

test('at 5:00 AM ET the live edition is the morning one, and its predecessor is last evening', () => {
  const five = E.etInstant(2026, 9, 18, 5);
  const live = E.liveEdition(five);
  assert.strictEqual(live.key, '2026-09-18|morning');
  assert.strictEqual(E.previousEdition(live).key, '2026-09-17|evening');
});
