// Dead-CSS purge tool (B4.5). Removes CSS whose class-prefix never appears in the
// built bundle + index.html (= never applied to any element → dead). Keeps :not/:has/:is/:where
// rules (dead-absence can flip their logic) and only-literal class names (validated: no computed
// prefixes). Run: npm run bundle first (needs dist/), then: node scripts/purge-dead-css.js → writes
// css/styles.css.purged; review + mv over css/styles.css, rebuild, visual-regress. Requires postcss (devDep).
const fs = require('fs');
const postcss = require('postcss');
const CSS = 'css/styles.css';
const BUNDLE = fs.readdirSync('dist').find(f => /^app\..*\.js$/.test(f));
const hay = fs.readFileSync('dist/'+BUNDLE,'utf8') + fs.readFileSync('index.html','utf8');
const css = fs.readFileSync(CSS,'utf8');

// --- compute dead 2-token prefixes: hyphenated class whose 2-token prefix never appears in bundle+html ---
const SKIP = new Set(['is','has','active','open','show','hide','no','sr']);
const classes = new Set([...css.matchAll(/\.([a-z][a-z0-9]+(?:-[a-z0-9]+)+)\b/g)].map(m=>m[1]));
const prefixes = new Set();
for (const c of classes) prefixes.add(c.split('-').slice(0,2).join('-'));
const dead = new Set();
for (const p of prefixes) {
  if (SKIP.has(p.split('-')[0])) continue;
  if (!hay.includes(p)) dead.add(p);
}
const pfxOf = (c) => c.split('-').slice(0,2).join('-');
const selectorIsDead = (sel) => {
  if (/:(not|is|where|has)\(/.test(sel)) return false; // functional pseudo-classes: dead-absence can flip logic, keep
  const cls = [...sel.matchAll(/\.([a-z][a-z0-9]+(?:-[a-z0-9]+)+)/g)].map(m=>m[1]);
  return cls.length > 0 && cls.some(c => dead.has(pfxOf(c)));
};

let rulesRemoved=0, selsRemoved=0, rulesKept=0;
const root = postcss.parse(css);
root.walkRules(rule => {
  // skip keyframe-step rules (selectors like "0%","from") — no class tokens anyway
  const sels = rule.selectors;
  const keep = sels.filter(s => !selectorIsDead(s));
  const removed = sels.length - keep.length;
  if (keep.length === 0 && removed > 0) { rule.remove(); rulesRemoved++; selsRemoved+=removed; }
  else if (removed > 0) { rule.selectors = keep; selsRemoved+=removed; rulesKept++; }
});
// drop now-empty @media / atrules
root.walkAtRules(at => { if (['media','supports'].includes(at.name) && at.nodes && at.nodes.length===0) at.remove(); });

const out = root.toString();
fs.writeFileSync(CSS+'.purged', out);
console.log('dead prefixes:', dead.size);
console.log('rules fully removed:', rulesRemoved, '| multi-sel rules trimmed:', rulesKept, '| selectors removed:', selsRemoved);
console.log('size:', (css.length/1024).toFixed(1)+'KB ->', (out.length/1024).toFixed(1)+'KB  (saved '+((css.length-out.length)/1024).toFixed(1)+'KB)');
// show a sample of removed prefixes
console.log('sample dead prefixes:', [...dead].slice(0,20).join(', '));
