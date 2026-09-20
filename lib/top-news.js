// The homepage's news, ranked (revamp1450).
//
// The home bundle carries ~27 top-story feeds from the major publishers.
// Read in arrival order that is a firehose; read by COVERAGE it is the front
// page: the story on the most front pages is the top story. This clusters the
// last day and a half of home stories by headline terms, scores each cluster
// by how many distinct publishers ran it and how fresh it is, and returns one
// story per cluster — the best-sourced headline — with the cluster's size.
//
// No AI. Headline-term matching is the same idea trendStories() uses, and at
// ~400 stories a run it is a few milliseconds.

const STOP = new Set(['the','and','for','with','from','that','this','have','has','had','will','its','are','was','were','new','how','why','who','what','when','where','over','into','out','about','after','amid','says','said','more','than','then','your','their','they','them','but','not','you','our','his','her','she','him','been','being','could','would','should','can','may','might','just','like','also','one','two','first','last','year','years','week','day','days','today','live','news','latest','update','updates','report','reports','video','watch','photos','opinion','analysis','explained','things','know','need','here','there','get','gets','got','make','makes','made','take','takes','back','off','all','any','some','most','many','much','very','still','even','ever','never','now','yet','only','own','same','other','another','each','every','both','few','less','least','again','against','before','between','during','through','under','until','while','because','since','though','although','whether','across','around','down','up','per','via','vs','versus','say','see','set','top','big','best','worst','key','major','huge','massive']);
// Words that recur across unrelated stories; sharing only these is not a match.
const GENERIC = new Set(['trump','biden','president','white','house','senate','congress','court','police','government','officials','official','state','states','city','county','national','federal','american','americans','united','world','people','man','woman','women','men','children','family','home','health','money','market','markets','stocks','shares','economy','war','attack','deal','plan','bill','law','case','death','dead','killed','dies','shot','crash','fire','storm','weather','election','vote','campaign','party','republican','republicans','democrat','democrats','china','russia','ukraine','israel','gaza','europe','company','companies','business','tech','million','billion','percent','record','high','low','rise','rises','fall','falls','cut','cuts','hit','hits','win','wins','loss','game','season','team','star','show','film','movie','music','book']);

// Publishers whose headline wins the cluster when they ran it, in order.
const HOST_PRIORITY = ['apnews.com','reuters.com','bbc.com','bbc.co.uk','nytimes.com','washingtonpost.com','wsj.com','npr.org','theguardian.com','cbsnews.com','nbcnews.com','abcnews.go.com','cnn.com','politico.com','ft.com','bloomberg.com','aljazeera.com','pbs.org','economist.com','latimes.com','axios.com','thehill.com','time.com','news.sky.com','foxnews.com','nypost.com'];

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
}
function terms(title) {
  const words = String(title || '').toLowerCase().replace(/[’'`]/g, '').match(/[a-z0-9]{3,}/g) || [];
  return [...new Set(words.filter((w) => !STOP.has(w)))];
}
// Two headlines are the same story when they share three terms, or two of
// which at least one narrows the subject (six+ letters, not a generic word).
function sameStory(a, b) {
  let n = 0; let specific = false;
  for (const t of a) if (b.has(t)) { n++; if (t.length >= 6 && !GENERIC.has(t)) specific = true; }
  return n >= 3 || (n >= 2 && specific);
}
function hostRank(h) { const i = HOST_PRIORITY.findIndex((p) => h === p || h.endsWith('.' + p)); return i < 0 ? HOST_PRIORITY.length : i; }

// rows: [{url,title,description,source_name,source_url,image_url,published_at}]
// → ranked items in the shape the feed client renders, plus _rank/_coverage/_sources.
function rankHomeStories(rows, { now = Date.now(), limit = 60 } = {}) {
  const items = rows
    .filter((r) => r && r.url && r.title)
    .map((r) => ({ r, host: hostOf(r.url), t: new Set(terms(r.title)), ms: r.published_at ? Date.parse(r.published_at) : 0 }))
    .filter((x) => x.host && x.t.size >= 2)
    .sort((a, b) => b.ms - a.ms);
  const clusters = [];
  for (const it of items) {
    let home = null;
    for (const c of clusters) { if (c.hosts.size > 12 || !sameStory(it.t, c.terms)) continue; home = c; break; }
    if (home) {
      home.members.push(it); home.hosts.add(it.host);
      for (const t of it.t) home.terms.add(t);
    } else clusters.push({ members: [it], hosts: new Set([it.host]), terms: new Set(it.t), newest: it.ms });
  }
  const scored = clusters.map((c) => {
    const ageH = Math.max(0, (now - c.newest) / 36e5);
    const recency = ageH < 3 ? 1.6 : ageH < 8 ? 1.0 : ageH < 18 ? 0.4 : 0;
    const score = c.hosts.size + recency - ageH / 48;
    const rep = c.members.slice().sort((a, b) => (hostRank(a.host) - hostRank(b.host)) || (b.ms - a.ms))[0];
    return { c, rep, score };
  }).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ c, rep }, i) => ({
    url: rep.r.url, title: rep.r.title, description: rep.r.description || '',
    source_name: rep.r.source_name || rep.host, source_url: rep.r.source_url || `https://${rep.host}`,
    image_url: rep.r.image_url || null,
    date_published: rep.r.published_at ? new Date(rep.r.published_at).toISOString() : null,
    _rank: i + 1, _coverage: c.hosts.size, _sources: [...c.hosts].slice(0, 12),
  }));
}

module.exports = { rankHomeStories, terms, sameStory, hostOf };
