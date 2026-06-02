import assert from 'node:assert/strict';
import { assemblePrompt } from '../js/utils/prompt-assembly.js';

// Bare base, no options → unchanged.
assert.equal(assemblePrompt('BASE', {}), 'BASE');

// Reasoning hint prepends; output/secondary/custom append in order.
const full = assemblePrompt('BASE', {
  reasoningHint: 'Be brief.',
  outputClause: 'Provide a comprehensive overview of {primary_topic}',
  secondaryTopic: 'Trade policy',
  secondaryClauseTpl: 'Also consider the intersection with {secondary_topic}.',
  customInstructions: 'Use British English.',
  topicName: 'Inflation',
});
assert.equal(full,
  'Be brief.\n\nBASE\n\n' +
  'Provide a comprehensive overview of Inflation\n\n' +
  'Also consider the intersection with Trade policy.\n\n' +
  'Use British English.');

// Missing pieces drop their block entirely (no blank lines).
assert.equal(assemblePrompt('BASE', { customInstructions: 'X' }), 'BASE\n\nX');
assert.equal(assemblePrompt('BASE', { reasoningHint: 'R' }), 'R\n\nBASE');

// Secondary topic given but no template → skip (nothing to format).
assert.equal(assemblePrompt('BASE', { secondaryTopic: 'X' }), 'BASE');

// Output clause with no topicName leaves placeholder substituted with empty.
assert.equal(assemblePrompt('BASE', { outputClause: 'Cover {primary_topic} well' }),
  'BASE\n\nCover  well');

console.log('OK: assemblePrompt');
