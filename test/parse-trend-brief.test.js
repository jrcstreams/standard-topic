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

// The UI renders the summary line and THEN the body, so a body that opens by
// repeating the summary shows the same sentence twice. b378a6989 made the parser
// strip that leading copy; this test still asserted the pre-b378a6989 contract
// (content === the full text) and had been failing ever since.
test('fallback when labels missing: first sentence is the summary, and the body does not repeat it', () => {
  const r = parseTrendBrief('This is the first sentence. This is the second sentence about the trend.');
  assert.equal(r.summary, 'This is the first sentence.');
  assert.equal(r.content, 'This is the second sentence about the trend.');
});

test('a labelled detail that opens by repeating the summary is de-duped too', () => {
  const r = parseTrendBrief('SUMMARY: A viral clip resurfaced.\nDETAIL: A viral clip resurfaced. Here is the context that follows.');
  assert.equal(r.summary, 'A viral clip resurfaced.');
  assert.equal(r.content, 'Here is the context that follows.');
});

// The strip must never empty the body: with nothing after the repeated
// sentence, the one sentence we have is both the summary and the whole brief.
test('a one-sentence brief keeps its body', () => {
  const r = parseTrendBrief('Only one sentence here.');
  assert.equal(r.summary, 'Only one sentence here.');
  assert.equal(r.content, 'Only one sentence here.');
});

test('a body that merely starts with the same words is left intact', () => {
  const r = parseTrendBrief('SUMMARY: The bill passed.\nDETAIL: The bill passed the Senate 62-38 after a long night.');
  assert.equal(r.content, 'The bill passed the Senate 62-38 after a long night.');
});

test('empty/nullish input yields empty fields', () => {
  assert.deepEqual(parseTrendBrief(''), { summary: '', content: '' });
  assert.deepEqual(parseTrendBrief(null), { summary: '', content: '' });
});
