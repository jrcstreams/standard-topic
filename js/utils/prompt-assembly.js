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
  // The output-type clauses in prompt-generator.json are written as STANDALONE
  // requests ("Provide a detailed research summary about {primary_topic}") —
  // correct for the generator, where the clause IS the prompt. Layered onto an
  // existing prompt they read as a second, competing request about the whole
  // topic, which is exactly what a reader sees when they set an output type on
  // a topic shortcut. With a base prompt present, express the choice as a
  // format directive for THAT request instead.
  if (base && opts.outputLabel) {
    parts.push(`Format the response to the request above as a ${String(opts.outputLabel).toLowerCase()}.`);
  } else if (opts.outputClause) {
    parts.push(opts.outputClause.replace(/\{primary_topic\}/g, opts.topicName || ''));
  }
  if (opts.secondaryTopic && opts.secondaryClauseTpl) {
    parts.push(opts.secondaryClauseTpl.replace(/\{secondary_topic\}/g, opts.secondaryTopic));
  }
  if (opts.customInstructions) parts.push(opts.customInstructions);
  return parts.join('\n\n');
}
