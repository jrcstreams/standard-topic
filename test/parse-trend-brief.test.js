const { test } = require('node:test');
const assert = require('node:assert');
const { parseTrendBrief } = require('../lib/parse-trend-brief');

test('splits labeled SUMMARY/DETAIL', () => {
  const raw = 'SUMMARY: Knicks legend back in headlines after a viral clip.\nDETAIL: Stacey King is a former NBA player. He is trending because a broadcast moment went viral. Context follows.';
  const r = parseTrendBrief(raw);
  assert.equal(r.summary, 'Knicks legend back in headlines after a viral clip.');
  assert.ok(r.content.startsWith('Stacey King is a former NBA player.'));
  assert.ok(!/SUMMARY:|DETAIL:/.test(r.content));
});

test('handles extra whitespace and case-insensitive labels', () => {
  const raw = '  summary:   One line here.  \n\n  detail:  Body line one.\nBody line two.';
  const r = parseTrendBrief(raw);
  assert.equal(r.summary, 'One line here.');
  assert.equal(r.content, 'Body line one.\nBody line two.');
});

test('fallback when labels missing: first sentence is summary, full text is content', () => {
  const raw = 'This is the first sentence. This is the second sentence about the trend.';
  const r = parseTrendBrief(raw);
  assert.equal(r.summary, 'This is the first sentence.');
  assert.equal(r.content, raw);
});

test('empty/nullish input yields empty fields', () => {
  assert.deepEqual(parseTrendBrief(''), { summary: '', content: '' });
  assert.deepEqual(parseTrendBrief(null), { summary: '', content: '' });
});
