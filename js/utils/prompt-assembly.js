// Pure prompt assembly — no DOM. Builds the final submission prompt from a
// base prompt plus the modal's advanced settings. Order: reasoning hint
// (prepended), base, output-type clause, secondary-topic clause, custom
// instructions. Each optional block is included only when present, joined by
// a blank line. Placeholders {primary_topic}/{secondary_topic} are substituted.
export function assemblePrompt(base, opts) {
  opts = opts || {};
  const parts = [];
  if (opts.reasoningHint) parts.push(opts.reasoningHint);
  parts.push(base);
  if (opts.outputClause) {
    parts.push(opts.outputClause.replace(/\{primary_topic\}/g, opts.topicName || ''));
  }
  if (opts.secondaryTopic && opts.secondaryClauseTpl) {
    parts.push(opts.secondaryClauseTpl.replace(/\{secondary_topic\}/g, opts.secondaryTopic));
  }
  if (opts.customInstructions) parts.push(opts.customInstructions);
  return parts.join('\n\n');
}
