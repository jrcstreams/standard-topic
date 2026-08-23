// Smooth progressive renderer for streamed AI text (revamp968).
//
// The first cut of streaming just did `host.innerHTML = render(fullText)` on
// every token frame. Gemini delivers in ~250-character bursts, so that meant
// the whole panel was destroyed and rebuilt a dozen times, with big blocks
// slamming into place — settled paragraphs flickering, nothing easing in.
//
// Two changes fix that:
//
//  1. PACED REVEAL. Incoming text lands in a buffer; a rAF loop walks a cursor
//     toward the end of it. The step is proportional to what's left, so it
//     drains fast when a burst arrives and idles when it's caught up — quick,
//     but continuous rather than steppy.
//
//  2. BLOCK RECONCILIATION. The caller parses revealed text into keyed blocks.
//     Only blocks whose content actually changed are touched — which, while
//     streaming, is just the last one. Settled paragraphs are never re-created,
//     so they can't flicker or lose their entry animation, and new blocks fade
//     up as they arrive.
//
// parse(text) -> [{ key, html }]   key identifies a block across frames.

const REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createStreamRenderer(host, parse) {
  let target = '';        // everything received so far
  let shown = 0;          // how much of it is on screen
  let raf = null;
  let done = false;
  let rendered = [];      // [{ key, html, el }] mirroring the DOM

  host.classList.add('sr-host');

  const paint = () => {
    const blocks = parse(target.slice(0, shown)) || [];
    // Reconcile in order. Anything already correct is left completely alone.
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const cur = rendered[i];
      if (!cur) {
        const el = document.createElement('div');
        el.className = 'sr-block';
        el.innerHTML = b.html;
        if (!REDUCED) el.classList.add('sr-enter');
        host.appendChild(el);
        rendered[i] = { key: b.key, html: b.html, el };
      } else if (cur.key !== b.key) {
        // A block changed identity (rare — a heading resolved late). Replace it
        // without animation so it doesn't read as new content arriving.
        cur.el.innerHTML = b.html;
        cur.key = b.key; cur.html = b.html;
      } else if (cur.html !== b.html) {
        // The growing tail. Update in place; no entry animation.
        cur.el.innerHTML = b.html;
        cur.html = b.html;
      }
    }
    // Trim any surplus (the parser can merge blocks as more text arrives).
    for (let i = blocks.length; i < rendered.length; i++) rendered[i].el.remove();
    if (rendered.length > blocks.length) rendered.length = blocks.length;

    // Caret rides the last block while text is still coming.
    host.querySelectorAll('.sr-tail').forEach((el) => el.classList.remove('sr-tail'));
    if (!done && rendered.length) rendered[rendered.length - 1].el.classList.add('sr-tail');
  };

  // Never stop the reveal part-way through a markdown heading. A half-revealed
  // "##" doesn't parse as a heading yet, so the text below it belongs to the
  // PREVIOUS section — and the moment the "### " completes, a new section forms
  // and every block index after it shifts. That showed up on production as the
  // block count oscillating 9 -> 8 -> 9 with a node being recreated. Holding the
  // cursor at the line start until the whole heading has arrived keeps section
  // boundaries stable, and headings appear as a unit, which also looks better.
  const safeCut = (n) => {
    if (n >= target.length) return n;
    const lineStart = target.lastIndexOf('\n', n - 1) + 1;
    const partial = target.slice(lineStart, n);
    if (!/^#{1,4}[^\n]*$/.test(partial)) return n;      // not inside a heading
    const nlEnd = target.indexOf('\n', lineStart);
    // The whole heading has arrived — reveal it atomically rather than a
    // character at a time, which both keeps sections stable and looks better.
    if (nlEnd !== -1) return nlEnd + 1;
    return lineStart;                                   // still incoming — wait
  };

  const tick = () => {
    raf = null;
    if (shown < target.length) {
      const remaining = target.length - shown;
      // Proportional drain, but capped. Uncapped, the first burst after the long
      // grounding phase arrives with ~700 characters buffered and dumps ~116 in
      // a single frame — the slab effect this exists to remove. 40/frame is
      // ~2,400 chars/sec, far above the ~330/sec the model actually produces, so
      // it stays ahead of the stream while still reading as writing.
      const step = REDUCED ? remaining : Math.min(40, Math.max(3, Math.ceil(remaining / 6)));
      shown = Math.max(shown, safeCut(Math.min(target.length, shown + step)));
      paint();
    }
    if (shown < target.length) raf = requestAnimationFrame(tick);
    else if (done) paint();          // final pass drops the caret
  };
  const kick = () => { if (raf == null) raf = requestAnimationFrame(tick); };

  return {
    // Full accumulated text so far (not a delta).
    push(text) {
      const t = String(text || '');
      if (t.length < target.length) { target = t; shown = 0; rendered.forEach(r => r.el.remove()); rendered = []; }
      else target = t;
      kick();
    },
    // Reset for a retry (the ungrounded fallback discards the first draft).
    reset() {
      target = ''; shown = 0; done = false;
      rendered.forEach(r => r.el.remove()); rendered = [];
    },
    // Reveal whatever is left immediately and drop the caret.
    finish() {
      done = true; shown = target.length;
      if (raf != null) { cancelAnimationFrame(raf); raf = null; }
      paint();
    },
    destroy() { if (raf != null) cancelAnimationFrame(raf); raf = null; },
    get settled() { return shown >= target.length; },
  };
}

// Split a body into renderable groups: a run of bullets stays one group (so the
// <ul> isn't broken apart), everything else is its own paragraph. Grouping is
// what lets settled text stay untouched while only the tail grows.
export function groupBlockLines(body) {
  const out = [];
  let cur = []; let curIsList = null;
  for (const raw of String(body || '').split('\n')) {
    const line = raw.trim();
    if (!line) { if (cur.length) { out.push(cur.join('\n')); cur = []; curIsList = null; } continue; }
    const isList = /^[*\-•]\s+/.test(line);
    if (curIsList !== null && isList !== curIsList) { out.push(cur.join('\n')); cur = []; }
    curIsList = isList;
    cur.push(raw);
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}
