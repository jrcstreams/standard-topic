#!/usr/bin/env node
/**
 * Production build (B3.2). Bundles + minifies the JS module graph and the CSS into
 * content-hashed files under dist/, then rewrites index.html + 404.html to point at
 * them. The hash IS the cache key, so dist/ can be served immutable forever and the
 * manual ?v= bump chore goes away.
 *
 * Deliberately NOT wired to a Vercel build command — Vercel keeps serving the repo
 * statically exactly as before (zero pipeline risk). The npm script is named `bundle`
 * (NOT `build`) on purpose: Vercel auto-runs a `build` script on deploy, which would
 * fail here since scripts/ is .vercelignore'd. Run `npm run bundle` locally and commit
 * the dist/ output + the rewritten HTML before every JS/CSS change that ships.
 * The unbundled js/ + css/ stay in the repo as a fallback (rollback = revert the HTML).
 */
const esbuild = require('esbuild');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// esbuild can't resolve import paths that carry a ?v= cache-busting query
// (e.g. './components/x.js?v=revamp667'). Strip the query and resolve the real file.
const stripQuery = {
  name: 'strip-query',
  setup(build) {
    build.onResolve({ filter: /\?v=/ }, (args) => {
      const clean = args.path.replace(/\?v=[^'"]*$/, '');
      return { path: path.resolve(args.resolveDir, clean) };
    });
  },
};

function hash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
}

async function run() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // ---- JS: bundle js/app.js with code-splitting. dynamic import()s (B3.4: the
  //      prompt-generator wizard) become separate chunks loaded on demand, keeping
  //      them out of the initial bundle. esbuild content-hashes the entry + chunks and
  //      wires the entry's import() references to the chunk names automatically. ----
  const js = await esbuild.build({
    entryPoints: { app: path.join(ROOT, 'js/app.js') },
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['es2020'],
    splitting: true,
    outdir: DIST,
    entryNames: '[name].[hash]',
    chunkNames: 'chunk.[hash]',
    legalComments: 'none',
    plugins: [stripQuery],
    write: false,
    logLevel: 'warning',
  });
  let jsName = null;
  for (const f of js.outputFiles) {
    const base = path.basename(f.path);
    fs.writeFileSync(path.join(DIST, base), Buffer.from(f.contents));
    if (/^app\.[^.]+\.js$/.test(base)) jsName = base; // the entry (chunks are chunk.*.js)
  }

  // ---- CSS: minify styles.css (no bundle → url('/assets/...') refs left untouched) ----
  const css = await esbuild.build({
    entryPoints: [path.join(ROOT, 'css/styles.css')],
    bundle: false,
    minify: true,
    loader: { '.css': 'css' },
    write: false,
    logLevel: 'warning',
  });
  const cssBuf = Buffer.from(css.outputFiles[0].contents);
  const cssName = `styles.${hash(cssBuf)}.css`;
  fs.writeFileSync(path.join(DIST, cssName), cssBuf);

  // ---- rewrite the HTML entry points to reference the hashed bundles ----
  for (const file of ['index.html', '404.html']) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    let html = fs.readFileSync(p, 'utf8');
    // <script type="module" src="/js/app.js?v=..."> OR a previously-built /dist/app.<hash>.js
    html = html.replace(/src="\/?(?:js\/app\.js\?v=[\w-]+|dist\/app\.[\w]+\.js)"/,
      `src="/dist/${jsName}"`);
    // <link ... href="/css/styles.css?v=..."> OR a previously-built /dist/styles.<hash>.css
    html = html.replace(/href="\/?(?:css\/styles\.css\?v=[\w-]+|dist\/styles\.[\w]+\.css)"/,
      `href="/dist/${cssName}"`);
    fs.writeFileSync(p, html);
  }

  // ---- SEO: real sitemap.xml from data/topics.json (all real /topic/<slug> URLs) ----
  const topics = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/topics.json'), 'utf8')).topics || [];
  const real = topics.filter((t) => t.slug && t.slug !== 'home');
  const today = new Date().toISOString().slice(0, 10);
  const url = (loc, prio, freq) =>
    `  <url>\n    <loc>https://www.standardtopic.com${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${prio}</priority>\n  </url>`;
  const urls = [url('/', '1.0', 'daily')];
  for (const t of real) {
    const prio = t.parent ? '0.6' : '0.8'; // parents rank above subtopics
    urls.push(url(`/topic/${t.slug}`, prio, 'daily'));
  }
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap);

  // ---- SEO: prerendered per-topic HTML (crawlers/social scrapers get real title/
  //      meta/OG/H1/content; the SPA boots on top and replaces #content) ----
  const { TOPIC_DESCRIPTIONS } = await import('../js/utils/topic-descriptions.js');
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const bySlug = new Map(real.map((t) => [t.slug, t]));
  const childrenOf = (slug) => real.filter((t) => t.parent === slug);
  const SUFFIX = 'Standard Topic';
  const shell = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const PRE = path.join(ROOT, 'prerender');
  fs.rmSync(PRE, { recursive: true, force: true });
  fs.mkdirSync(PRE, { recursive: true });

  const setMeta = (html, attr, value) => {
    const re = new RegExp(`(<meta\\s+${attr}\\s+content=")[\\s\\S]*?(">)`, 'i');
    return re.test(html) ? html.replace(re, `$1${esc(value)}$2`) : html;
  };
  let count = 0;
  for (const t of real) {
    const name = t.name;
    const desc = TOPIC_DESCRIPTIONS[t.slug]
      || `Latest news, resources, and AI insights on ${name} — curated and updated on Standard Topic.`;
    const title = `${name} — News, Resources & AI Insights | ${SUFFIX}`;
    const loc = `https://www.standardtopic.com/topic/${t.slug}`;
    const parent = t.parent ? bySlug.get(t.parent) : null;
    const kids = childrenOf(t.slug);

    let links = '';
    if (kids.length) {
      links = `<nav aria-label="Subtopics"><h2>Explore ${esc(name)}</h2><ul>` +
        kids.map((k) => `<li><a href="/topic/${k.slug}">${esc(k.name)}</a></li>`).join('') +
        `</ul></nav>`;
    } else if (parent) {
      const sibs = childrenOf(parent.slug).filter((s) => s.slug !== t.slug).slice(0, 12);
      links = `<nav aria-label="Related topics"><p>Part of <a href="/topic/${parent.slug}">${esc(parent.name)}</a>.</p>` +
        (sibs.length ? `<ul>` + sibs.map((s) => `<li><a href="/topic/${s.slug}">${esc(s.name)}</a></li>`).join('') + `</ul>` : '') +
        `</nav>`;
    }
    const content =
      `<article class="prerender-seo">` +
      `<h1>${esc(name)}</h1>` +
      `<p>${esc(desc)}</p>` +
      links +
      `<p><a href="/">Standard Topic</a> — curated news feeds, resources, and AI-powered insights on ${esc(name)} and every major topic.</p>` +
      `</article>`;

    let html = shell;
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
    html = setMeta(html, 'name="description"', desc);
    html = setMeta(html, 'property="og:title"', title);
    html = setMeta(html, 'property="og:description"', desc);
    html = setMeta(html, 'property="og:url"', loc);
    html = setMeta(html, 'name="twitter:title"', title);
    html = setMeta(html, 'name="twitter:description"', desc);
    html = setMeta(html, 'name="twitter:url"', loc);
    html = html.replace(/(<link rel="canonical" href=")[^"]*(">)/i, `$1${loc}$2`);
    html = html.replace(/<main id="content">\s*<\/main>/i, `<main id="content">${content}</main>`);
    fs.writeFileSync(path.join(PRE, `${t.slug}.html`), html);
    count++;
  }

  const kb = (n) => (n / 1024).toFixed(1) + 'KB';
  console.log(`build ok:`);
  console.log(`  prerender/       ${count} topic pages`);
  const chunkCount = fs.readdirSync(DIST).filter((f) => /^chunk\..*\.js$/.test(f)).length;
  console.log(`  dist/${jsName}   ${kb(fs.statSync(path.join(DIST, jsName)).size)}  (entry; + ${chunkCount} lazy chunk${chunkCount === 1 ? '' : 's'})`);
  console.log(`  dist/${cssName}  ${kb(cssBuf.length)}  (from ${kb(fs.statSync(path.join(ROOT, 'css/styles.css')).size)})`);
  console.log(`  sitemap.xml      ${urls.length} URLs (home + ${real.length} topics)`);
}

function sumDir(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    total += e.isDirectory() ? sumDir(fp) : fs.statSync(fp).size;
  }
  return total;
}

run().catch((e) => { console.error(e); process.exit(1); });
