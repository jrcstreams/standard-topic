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

  // ---- JS: bundle the whole graph from js/app.js into one minified ESM file ----
  const js = await esbuild.build({
    entryPoints: [path.join(ROOT, 'js/app.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['es2020'],
    legalComments: 'none',
    plugins: [stripQuery],
    write: false,
    logLevel: 'warning',
  });
  const jsBuf = Buffer.from(js.outputFiles[0].contents);
  const jsName = `app.${hash(jsBuf)}.js`;
  fs.writeFileSync(path.join(DIST, jsName), jsBuf);

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

  const kb = (n) => (n / 1024).toFixed(1) + 'KB';
  console.log(`build ok:`);
  console.log(`  dist/${jsName}   ${kb(jsBuf.length)}  (from ${kb(sumDir(path.join(ROOT, 'js')))} of source)`);
  console.log(`  dist/${cssName}  ${kb(cssBuf.length)}  (from ${kb(fs.statSync(path.join(ROOT, 'css/styles.css')).size)})`);
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
