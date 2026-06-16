// Shared "AI provenance" element — the consistent way the site marks AI-generated
// text and points at the official sources it was grounded in. Rendered on every
// AI surface (trending cards + detail, news briefs, AI Intelligence sections) and
// ONLY those, so the mark keeps its meaning (raw RSS news, trend rankings, and
// search results stay unlabelled).
//
// Two shapes:
//   compact (trending cards, no other AI label) → "✦ AI · 5 sources"
//   full    (brief surfaces that already say "AI Brief") → "Sources: Reuters, AP +3"
import { resolveSource } from '../components/newsfeed.js?v=20260616-revamp215';

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

const SPARK = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/></svg>';

// Friendly publisher names for the most common grounding sources; everything
// else falls back to the title-cased domain root (so it's never blank/ugly).
const PRETTY = {
  'apnews.com': 'AP', 'reuters.com': 'Reuters', 'bbc.com': 'BBC', 'bbc.co.uk': 'BBC',
  'nytimes.com': 'NYT', 'washingtonpost.com': 'Washington Post', 'theguardian.com': 'The Guardian',
  'cnn.com': 'CNN', 'wsj.com': 'WSJ', 'bloomberg.com': 'Bloomberg', 'aljazeera.com': 'Al Jazeera',
  'npr.org': 'NPR', 'cnbc.com': 'CNBC', 'forbes.com': 'Forbes', 'politico.com': 'Politico',
  'axios.com': 'Axios', 'espn.com': 'ESPN', 'theverge.com': 'The Verge', 'techcrunch.com': 'TechCrunch',
  'foxnews.com': 'Fox News', 'nbcnews.com': 'NBC News', 'abcnews.go.com': 'ABC News', 'cbsnews.com': 'CBS News',
  'usatoday.com': 'USA Today', 'time.com': 'TIME', 'newsweek.com': 'Newsweek', 'businessinsider.com': 'Insider',
  'thehill.com': 'The Hill', 'apple.com': 'Apple', 'engadget.com': 'Engadget', 'arstechnica.com': 'Ars Technica',
};
function prettyName(label) {
  const l = String(label || '').toLowerCase().replace(/^www\./, '');
  if (PRETTY[l]) return PRETTY[l];
  const root = l.replace(/\.[a-z.]{2,}$/, '').split(/[.-]/).filter(Boolean).pop() || l;
  return root.replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
}

// Flatten a flat citation array OR a per-section { name: [...] } map into a
// deduped list of distinct publishers (by friendly name).
export function distinctSources(sources) {
  let list = [];
  if (Array.isArray(sources)) list = sources;
  else if (sources && typeof sources === 'object') list = Object.values(sources).flat();
  const seen = new Set(); const out = [];
  for (const s of list) {
    if (!s || !(s.uri || s.url)) continue;
    const r = resolveSource({ title: s.title, uri: s.uri || s.url });
    const name = prettyName(r.label);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, uri: r.uri });
  }
  return out;
}

// `sources` is the grounding citations (flat array or per-section map). opts:
//   compact  → card form: badge + "· N sources" (count only, no names)
//   badge    → include the "✦ AI summary" chip (default true; false on surfaces
//              that already carry an "AI Brief" header — avoids a double sparkle)
// Discreet inline AI marker — a small blue sparkle that prefixes AI-generated
// text (e.g. a trending one-liner). Pair with aiLegendHTML() — a single
// "✦ AI-generated" key shown once at the top of the list — so each item carries
// just the sparkle, no repeated label.
const SPARK_FILL = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2l2.1 5.95a3 3 0 0 0 1.85 1.85L21.8 12l-5.95 2.1a3 3 0 0 0-1.85 1.85L12 21.8l-2.1-5.95a3 3 0 0 0-1.85-1.85L2.2 12l5.95-2.1a3 3 0 0 0 1.85-1.85z"/></svg>';
export function aiSparkInline() {
  return `<span class="ai-spark-mark" title="AI-generated" aria-label="AI-generated">${SPARK_FILL}</span>`;
}
export function aiLegendHTML() {
  return `<span class="ai-legend"><span class="ai-spark-mark">${SPARK_FILL}</span>AI-generated</span>`;
}

export function aiProvenanceHTML(sources, opts = {}) {
  const { compact = false, badge = true, label = 'AI summary' } = opts;
  const list = distinctSources(sources);
  const n = list.length;
  const badgeHTML = badge
    ? `<span class="ai-prov-badge">${SPARK}<span>${esc(compact ? 'AI' : label)}</span></span>` : '';
  let attr = '';
  if (compact) {
    attr = n ? `<span class="ai-prov-sep" aria-hidden="true">·</span><span class="ai-prov-count">${n} source${n === 1 ? '' : 's'}</span>` : '';
  } else if (n) {
    const names = list.slice(0, 3).map((s) => esc(s.name)).join(', ');
    const extra = n > 3 ? ` +${n - 3}` : '';
    attr = `<span class="ai-prov-srcs"><span class="ai-prov-srcs-lead">Sources:</span> ${names}${extra}</span>`;
  }
  // No cited sources → show nothing (the old "Based on our news feed" line was
  // noise, #111).
  if (!badgeHTML && !attr) return '';
  return `<div class="ai-prov${compact ? ' ai-prov--compact' : ''}">${badgeHTML}${attr}</div>`;
}
