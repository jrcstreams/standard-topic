import assert from 'node:assert/strict';
import { selectShortcutsForTopic } from '../js/utils/data.js';

const directory = [
  { id: 'ts-a', name: 'TS A', group: 'discover' },
  { id: 'ts-b', name: 'TS B', group: 'learn' },
  { id: 'ev-1', name: 'EV 1', group: 'discover', evergreen: true },
  { id: 'ev-2', name: 'EV 2', group: 'learn', evergreen: true },
  { id: 'ev-3', name: 'EV 3', group: 'analyze', evergreen: true },
];
const assignments = { topic1: ['ts-a', 'ts-b'], _custom: ['ts-a'], home: ['ts-a', 'ev-1'] };
const evergreenOrder = ['ev-2', 'ev-1', 'ev-3']; // deliberately not directory order
const evergreenExclusions = { topic1: ['ev-3'] };

// Topic: own shortcuts first (assignment order), then evergreens in evergreenOrder,
// minus the excluded one (ev-3).
const t = selectShortcutsForTopic({ directory, assignments, evergreenOrder, evergreenExclusions, topicSlug: 'topic1' });
assert.deepEqual(t.map(s => s.id), ['ts-a', 'ts-b', 'ev-2', 'ev-1']);

// Custom search: falls back to _custom assignment, gets all evergreens (no exclusions).
const c = selectShortcutsForTopic({ directory, assignments, evergreenOrder, evergreenExclusions, topicSlug: '_custom' });
assert.deepEqual(c.map(s => s.id), ['ts-a', 'ev-2', 'ev-1', 'ev-3']);

// Home: NO evergreen injection; only its explicit list.
const h = selectShortcutsForTopic({ directory, assignments, evergreenOrder, evergreenExclusions, topicSlug: 'home' });
assert.deepEqual(h.map(s => s.id), ['ts-a', 'ev-1']);

// Dedup: an evergreen also listed explicitly isn't duplicated.
const dd = selectShortcutsForTopic({ directory, assignments: { topicX: ['ev-1'] }, evergreenOrder, evergreenExclusions: {}, topicSlug: 'topicX' });
assert.deepEqual(dd.map(s => s.id), ['ev-1', 'ev-2', 'ev-3']);

console.log('OK: selectShortcutsForTopic');
