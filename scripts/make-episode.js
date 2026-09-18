#!/usr/bin/env node
// Build the flagship daily episode, locally, end to end.
//
//   node scripts/make-episode.js                       # today's Standard edition, MP3 + notes
//   node scripts/make-episode.js --length=quick        # 5-minute cut
//   node scripts/make-episode.js --script-only         # desk + writer + QA, no voice (cents)
//   node scripts/make-episode.js --voice=Kore          # a different host
//   node scripts/make-episode.js --voice-test          # 20s of each candidate voice, same text
//   node scripts/make-episode.js --out=/tmp/ep         # where the files land
//
// Needs GEMINI_API_KEY (text + voice) and DATABASE_URL (the briefings). Both are
// read from .env / .env.local, or pass --env=/path/to/file for another one.
//
// This is the pipeline described in docs/audio-flagship-episode-assessment.md,
// run by hand. The cron version is the same three stages behind
// /api/cron/pregenerate?type=flagship.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// ── env ────────────────────────────────────────────────────────────────────
function loadEnv(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return; }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
const argv = process.argv.slice(2);
const arg = (name, def = null) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};
const ROOT = path.resolve(__dirname, '..');
if (arg('env')) loadEnv(path.resolve(String(arg('env'))));
loadEnv(path.join(ROOT, '.env.local'));
loadEnv(path.join(ROOT, '.env'));

const { getSql } = require('../lib/db');
const E = require('../lib/episode-core');
const A = require('../lib/episode-audio');

const LENGTH = String(arg('length', 'standard'));
const VOICE = String(arg('voice', process.env.EPISODE_VOICE || 'Gacrux'));
// revamp1433: resolve whatever the desk put in brief_refs back to briefings.
// It has returned slugs ("energy-commodities"), trend ids ("T27505") and raw
// headline sentences, and every caller that assumed slugs quietly got nothing:
// the writer was handed one briefing, and the per-chapter source links came out
// empty. A ref resolves as a slug, as a topic name, or by finding the briefing
// whose text contains that headline — which is where the desk read it.
function resolveRefs(refs, briefs) {
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const bySlug = new Map(briefs.map((b) => [norm(b.slug), b]));
  const byName = new Map(briefs.map((b) => [norm(b.name), b]));
  const home = briefs.find((b) => b.isHome) || null;
  const out = []; const seen = new Set();
  const take = (b) => { if (b && !seen.has(b.slug)) { seen.add(b.slug); out.push(b); } };
  for (const raw of (refs || [])) {
    const text = String(raw || '').trim();
    if (!text) continue;
    // The digest labels every briefing "### Name [slug]" and every item
    // "(n) headline", so the desk answers in that shape: "politics: (1) Indian
    // and Pakistani naval vessels collided…" or "HOME: …". The part before the
    // first colon is the briefing; the rest is which item of it.
    const cut = text.indexOf(':');
    if (cut > 0 && cut <= 48) {
      const head = norm(text.slice(0, cut));
      if (head === 'home' && home) { take(home); continue; }
      const keyed = bySlug.get(head) || byName.get(head);
      if (keyed) { take(keyed); continue; }
    }
    const ref = norm(text);
    const direct = bySlug.get(ref) || byName.get(ref);
    if (direct) { take(direct); continue; }
    // No usable label: find the briefing whose text carries that headline.
    const body = cut > 0 ? norm(text.slice(cut + 1)).replace(/^\(\d+\)\s*/, '') : ref;
    const needle = body.slice(0, 48);
    if (needle.length < 12) continue;
    take(briefs.find((b) => norm(b.content).includes(needle)));
  }
  return out;
}

const OUT = path.resolve(String(arg('out', path.join(os.tmpdir(), 'standard-topic-episode'))));
const SCRIPT_ONLY = !!arg('script-only');
const NO_QA = !!arg('no-qa');

const log = (...a) => console.log(...a);
const fmtUSD = (micros) => `$${(micros / 1e6).toFixed(4)}`;

// ── mp3 ────────────────────────────────────────────────────────────────────
function encodeMP3(pcm, rate, outFile, { title, chapters, durationMs }) {
  const tmpPcm = path.join(os.tmpdir(), `st-ep-${Date.now()}.pcm`);
  const tmpMeta = path.join(os.tmpdir(), `st-ep-${Date.now()}.txt`);
  fs.writeFileSync(tmpPcm, pcm);
  const meta = [';FFMETADATA1', `title=${title}`, 'artist=Standard Topic', 'album=Standard Topic Daily', 'genre=News', ''];
  chapters.forEach((c, i) => {
    const end = i + 1 < chapters.length ? chapters[i + 1].start_ms : durationMs;
    meta.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${c.start_ms}`, `END=${Math.max(end, c.start_ms + 1)}`, `title=${c.label}`, '');
  });
  fs.writeFileSync(tmpMeta, meta.join('\n'));
  try {
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', tmpPcm,
      '-i', tmpMeta, '-map_metadata', '1',
      '-c:a', 'libmp3lame', '-b:a', '48k', '-ac', '1',
      outFile,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
  } finally {
    fs.rmSync(tmpPcm, { force: true }); fs.rmSync(tmpMeta, { force: true });
  }
  return outFile;
}

// ── voice test ─────────────────────────────────────────────────────────────
const VOICE_CANDIDATES = ['Gacrux', 'Charon', 'Kore', 'Orus', 'Rasalgethi', 'Schedar'];
async function voiceTest() {
  const text = String(arg('text', ''))
    || 'Good morning. This is Standard Topic, your daily briefing for Thursday, September eleventh. '
     + 'Leaders of the BRICS nations opened their summit in India today, with Russian President Vladimir Putin arriving to a reception that drew both protest and praise. '
     + 'Taiwan tracked eleven Chinese military aircraft around the island, and Anthropic said it had disrupted a state-backed campaign using its models. Here is what mattered.';
  fs.mkdirSync(OUT, { recursive: true });
  const want = String(arg('voices', VOICE_CANDIDATES.join(','))).split(',').map((s) => s.trim()).filter(Boolean);
  for (const v of want) {
    process.stdout.write(`  ${v}… `);
    try {
      const { pcm, rate } = await E.speak(text, { voice: v });
      const file = path.join(OUT, `voice-${v}.mp3`);
      encodeMP3(pcm, rate, file, { title: `Voice test — ${v}`, chapters: [{ label: v, start_ms: 0 }], durationMs: Math.round(pcm.length / 2 / rate * 1000) });
      log(`${(pcm.length / 2 / rate).toFixed(1)}s → ${file}`);
    } catch (e) { log(`failed: ${e.message}`); }
  }
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set. Add it to .env.local, or pass --env=<file>.');
    process.exit(1);
  }
  if (arg('voice-test')) return voiceTest();
  // --publish-only: re-run just the upload/record step against files an
  // earlier run left in --out. For retrying a failed publish, or publishing a
  // cut that was reviewed first.
  if (arg('publish-only')) return publishOnly();

  const fmt = E.FORMATS[LENGTH];
  if (!fmt) { console.error(`Unknown --length=${LENGTH}. Options: ${Object.keys(E.FORMATS).join(', ')}`); process.exit(1); }

  const sql = getSql();
  if (!sql) { console.error('DATABASE_URL is not set — the briefings live in Neon.'); process.exit(1); }

  const now = new Date();
  if (arg('edition')) process.env.EPISODE_EDITION = String(arg('edition'));
  if (arg('date')) process.env.EPISODE_DATE = String(arg('date'));

  // revamp1434: choose the edition by what is MISSING, not by the clock hour.
  // GitHub's scheduler is best-effort: tonight's 4:20 PM slot fired at 6:51 PM,
  // and an hour-gated job stood down and reported success while the evening
  // edition sat there with no episode. A run asks two questions instead —
  // is the edition that has already released still without an episode, and is
  // the next one due soon — and builds whichever is true. Late is fine. Late is
  // the whole point of holding an edition.
  const CLOCK = require('../lib/edition');
  const CATCHUP_MAX_MS = 7 * 3600 * 1000;   // an edition is catchable for 7h
  const LEAD_MAX_MS = 110 * 60 * 1000;      // and buildable from 110 min out
  const hasEpisode = async (e) => {
    const r = await sql.query(
      `SELECT id FROM ai_audio WHERE kind='flagship' AND family_slug='home' AND edition_date=$1 AND edition=$2 LIMIT 1`,
      [e.date, e.edition]);
    return r.length ? r[0].id : null;
  };
  let target = CLOCK.forcedEdition(now);
  let why = target ? 'forced' : '';
  if (!target) {
    const live = CLOCK.liveEdition(now);
    const next = CLOCK.buildingEdition(now);
    const lateBy = now.getTime() - live.releaseAt.getTime();
    if (lateBy <= CATCHUP_MAX_MS && !(await hasEpisode(live))) {
      target = live; why = `catching up — ${live.key} released ${Math.round(lateBy / 60000)} min ago with no episode`;
    } else if (next.releaseAt.getTime() - now.getTime() <= LEAD_MAX_MS) {
      target = next; why = `building ahead — ${next.key} releases in ${Math.round((next.releaseAt - now) / 60000)} min`;
    }
  }
  if (!target) {
    log('\nNothing due: the released edition has its episode and the next one is not close enough yet.');
    return;
  }
  process.env.EPISODE_EDITION = target.edition;
  log(`\n${why}`);
  const ed = target.edition;
  const wave = E.waveStart(now);
  // revamp1433: the edition key the wave staged its briefings under, so this
  // episode is written from the same drafts that will be released beside it.
  const editionKey = target.key;
  const edition = `${target.date}-${ed}`;

  // A catch-up run must not make a second episode.
  if (!arg('force')) {
    const done = await hasEpisode(target);
    if (done) { log(`\n${edition} already has an episode (#${done}) — nothing to do.`); return; }
  }
  const dateLabel = E.todayLabel(now);
  fs.mkdirSync(OUT, { recursive: true });

  log(`\nStandard Topic — flagship episode`);
  log(`  edition   ${edition} — ${E.editionLabel(ed)} (${dateLabel})`);
  log(`  format    ${fmt.label}, ~${fmt.minutes} min, single host`);
  log(`  models    ${E.deskModel()} (desk/writer), ${E.textModel()} (QA), voice ${VOICE}`);
  log(`  wave      briefings since ${wave.toISOString()}\n`);

  // 1. Gather ---------------------------------------------------------------
  const briefs = await E.gatherBriefs(sql, { since: wave, edition: editionKey });
  const home = briefs.find((b) => b.isHome) || null;
  const staged = briefs.filter((b) => b.staged);
  // revamp1433: "fresh" means BELONGS TO THIS EDITION. The old since-the-wave
  // test passed every briefing when the wave it compared against resolved to
  // yesterday, which is how a run with nothing staged reported "16 from this
  // edition". Only when nothing is staged at all does it fall back to the time
  // window, so a hand-run against live briefings still works.
  const fresh = staged.length ? staged : briefs.filter((b) => b.fresh);
  log(`Briefings: ${briefs.length} found, ${fresh.length} from this edition (${staged.length} staged)${home ? '' : ', NO home briefing'}`);
  if (!home) console.warn('  ! the home briefing is missing — the desk will work from topics alone');
  // revamp1433: the floor is most of the sixteen topics, not the sixty that
  // made sense when there were a hundred of them.
  // revamp1433: refuse to build a thin episode. Off-cycle, or before the wave
  // has staged its briefings, the desk has almost nothing to work from — one
  // run made a whole edition out of a single briefing. Better to fail, hold the
  // edition and let a catch-up try once the wave has landed.
  const FLOOR = 8;
  if (fresh.length < FLOOR && !arg('force')) {
    console.error(`\nOnly ${fresh.length} briefings belong to ${editionKey} (need ${FLOOR}).`);
    console.error('The wave has not staged this edition yet. Holding — a catch-up run will pick it up.');
    process.exit(1);
  }
  if (fresh.length < 12) console.warn(`  ! only ${fresh.length} briefings belong to this edition; the episode will lean on older ones`);

  const digest = E.digestFor(briefs);
  log(`Desk digest: ${digest.length.toLocaleString()} chars (~${Math.round(digest.length / 4).toLocaleString()} tokens)\n`);

  let micros = 0;

  // 2. Desk -----------------------------------------------------------------
  // --storyboard=<file> reuses a rundown from an earlier run. The desk is the
  // slowest and most expensive stage, and when only the writing needs another
  // pass there is no reason to re-decide the show.
  let storyboard;
  const reuse = arg('storyboard');
  if (reuse) {
    storyboard = JSON.parse(fs.readFileSync(path.resolve(String(reuse)), 'utf8'));
    log(`Stage 1 · desk … reused ${reuse}`);
    log(`  lead: ${storyboard.lead.title}`);
  } else {
    process.stdout.write('Stage 1 · desk … ');
    const t1 = Date.now();
    // revamp1402: yesterday's lead, so the desk can only repeat it as a development.
    let yesterday = null;
    try {
      const prev = await sql.query(`SELECT storyboard->'lead'->>'title' AS lead, teaser FROM ai_audio WHERE kind='flagship' AND family_slug='home' AND edition_date < $1 ORDER BY edition_date DESC LIMIT 1`, [E.editionDate(now)]);
      if (prev[0] && prev[0].lead) { yesterday = `${prev[0].lead}${prev[0].teaser ? ` — ${String(prev[0].teaser).slice(0, 200)}` : ''}`; log(`  yesterday led with: ${prev[0].lead}`); }
    } catch (_) {}
    const r1 = await E.runDesk(fmt, { home, digest, dateLabel, yesterday });
    storyboard = r1.storyboard;
    micros += (r1.usage && r1.usage.micros) || 0;
    log(`${((Date.now() - t1) / 1000).toFixed(1)}s · ${storyboard.segments.length + 1} segments · ${fmtUSD((r1.usage && r1.usage.micros) || 0)}`);
    log(`  lead: ${storyboard.lead.title}`);
  }
  fs.writeFileSync(path.join(OUT, `storyboard-${edition}.json`), JSON.stringify(storyboard, null, 2));

  // The writer reads only what the desk picked.
  const wanted = new Set();
  const collect = (refs) => (refs || []).forEach((r) => wanted.add(String(r).toLowerCase()));
  collect(storyboard.lead.brief_refs);
  for (const s of storyboard.segments) {
    collect(s.brief_refs);
    for (const it of (s.items || [])) collect(it.brief_refs);
  }
  // revamp1433: brief_refs is whatever the desk felt like returning. It has
  // been slugs ("energy-commodities"), trend ids ("T27505") and, today, the
  // headline sentences themselves — and `wanted.has(b.slug)` matched none of
  // those last ones, so the writer got the home briefing and nothing else. A
  // ref is resolved three ways now: as a slug, as a topic name, or by finding
  // the briefing whose text actually contains that headline, which is where
  // the desk read it. Then a floor, because the writer must never be starved.
  const picked = new Set(resolveRefs([...wanted], briefs).map((b) => b.slug));
  let selected = briefs.filter((b) => b.isHome || picked.has(b.slug));
  const MATERIAL_FLOOR = 6;
  if (selected.length < MATERIAL_FLOOR) {
    const extra = briefs
      .filter((b) => !b.isHome && !picked.has(b.slug) && b.content)
      .sort((a, c) => (c.content.length - a.content.length))
      .slice(0, MATERIAL_FLOOR - selected.length);
    if (extra.length) log(`  ! only ${selected.length} briefings resolved from the desk's refs — adding ${extra.length} more so the writer has material`);
    selected = selected.concat(extra);
  }
  log(`  writer material: ${selected.length} briefings (${selected.reduce((n, b) => n + b.content.length, 0).toLocaleString()} chars)\n`);

  // 3. Writer ---------------------------------------------------------------
  // --script=<file> reuses finished copy, for when only the AUDIO is being
  // worked on (voice, pacing, music). Skips stages 2 and 3 entirely.
  const reuseScript = arg('script');
  if (reuseScript) {
    const script0 = JSON.parse(fs.readFileSync(path.resolve(String(reuseScript)), 'utf8'));
    const w0 = script0.segments.reduce((n, s) => n + String(s.text || '').split(/\s+/).filter(Boolean).length, 0);
    log(`Stage 2+3 · script … reused ${reuseScript} · ${script0.segments.length} segments · ${w0} words`);
    return finish(script0, storyboard, briefs, { edition, ed, dateLabel, micros, fmt });
  }
  process.stdout.write('Stage 2 · writer … ');
  const t2 = Date.now();
  let { script, usage: u2 } = await E.runWriter(fmt, { storyboard, selected, dateLabel, edition: ed });
  const writerScript = script;
  micros += (u2 && u2.micros) || 0;
  let words = script.segments.reduce((n, s) => n + String(s.text || '').split(/\s+/).filter(Boolean).length, 0);
  log(`${((Date.now() - t2) / 1000).toFixed(1)}s · ${script.segments.length} segments · ${words} words (~${(words / E.WORDS_PER_MIN).toFixed(1)} min) · ${fmtUSD((u2 && u2.micros) || 0)}`);

  // 3b. Budget enforcement ---------------------------------------------------
  {
    process.stdout.write('Stage 2b · budgets … ');
    const t = Date.now();
    const material = selected.map((b) => `### [${b.slug}] ${b.name}\n${b.content}`).join('\n\n');
    const { trimmed } = await E.enforceBudgets(script, fmt, { material });
    words = script.segments.reduce((n, s) => n + String(s.text || '').split(/\s+/).filter(Boolean).length, 0);
    if (trimmed.length) {
      log(`${((Date.now() - t) / 1000).toFixed(1)}s · ${words} words`);
      trimmed.forEach((x) => log(`  · ${x.beat}: ${x.from} → ${x.to} words (budget ${x.budget})`));
    } else log('all segments within budget');
  }

  // 4. QA -------------------------------------------------------------------
  if (!NO_QA) {
    process.stdout.write('Stage 3 · QA … ');
    const t3 = Date.now();
    try {
      const { script: checked, usage: u3 } = await E.runQA(fmt, { script, selected, dateLabel }, { model: E.textModel() });
      micros += (u3 && u3.micros) || 0;
      if (checked && Array.isArray(checked.segments) && checked.segments.length) {
        const before = words;
        const budgets = {};
        for (const b of fmt.beats) budgets[b.beat] = E.wordsFor(b.sec);
        const merged = E.mergeQA(writerScript, checked, budgets);
        script = merged.script;
        words = script.segments.reduce((n, s) => n + String(s.text || '').split(/\s+/).filter(Boolean).length, 0);
        log(`${((Date.now() - t3) / 1000).toFixed(1)}s · ${words} words (${words - before >= 0 ? '+' : ''}${words - before}) · ${merged.accepted} accepted, ${merged.restored} restored · ${fmtUSD((u3 && u3.micros) || 0)}`);
      } else log('skipped (no usable result)');
    } catch (e) { log(`skipped (${e.message})`); }
  }

  // 4b. Fact check — the one pass that reads the live web (revamp1402).
  if (!arg('no-factcheck')) {
    process.stdout.write('Stage 3b · fact check (grounded) … ');
    const t3b = Date.now();
    try {
      const { script: checked, usage: u3b, changes, card, dossier } = await E.runFactCheck(fmt, { script, dateLabel, card: { headline: storyboard.title || script.headline || '', teaser: storyboard.teaser || script.summary || '' } }, { model: E.textModel() });
      fs.writeFileSync(path.join(OUT, `factcheck-${edition}.md`), dossier || '');
      // revamp1436: a rejected reversal is the loudest thing the fact checker
      // can tell us — it means the checker tried to invert a story and could
      // not show its working.
      if (u3b && u3b.reversals && u3b.reversals.length) {
        console.warn(`  ! fact check tried to REVERSE ${u3b.reversals.length} claim(s) with nothing in the dossier to back it: ${u3b.reversals.join('; ')} — originals kept`);
      }
      if (card) { if (card.headline) { storyboard.title = card.headline; if (script.headline) script.headline = card.headline; } if (card.teaser) { storyboard.teaser = card.teaser; if (script.summary) script.summary = card.teaser; } }
      micros += (u3b && u3b.micros) || 0;
      if (checked && Array.isArray(checked.segments) && checked.segments.length) {
        const budgets = {}; for (const b of fmt.beats) budgets[b.beat] = E.wordsFor(b.sec);
        const merged = E.mergeQA(script, checked, budgets);
        // mergeQA carries text/chapter/written; the corrected paragraphs and In Focus ride along here
        merged.script.segments.forEach((seg, i) => { if (checked.segments[i] && checked.segments[i].paragraphs && seg.text === checked.segments[i].text) seg.paragraphs = checked.segments[i].paragraphs; });
        if (checked.in_focus) merged.script.in_focus = checked.in_focus;
        script = merged.script;
        log(`${((Date.now() - t3b) / 1000).toFixed(1)}s · ${changes.length ? `corrected: ${changes.join(', ')}` : 'no corrections'} · ${merged.restored} restored · ${(u3b && u3b.searches) || 0} searches · ${fmtUSD((u3b && u3b.micros) || 0)}`);
      } else log('skipped (no usable result)');
    } catch (e) { log(`skipped (${e.message})`); }
  }

  return finish(script, storyboard, briefs, { edition, ed, dateLabel, micros, fmt });
}

async function finish(script, storyboard, briefs, { edition, ed, dateLabel, micros, fmt }) {
  // revamp1386: time words the sources do not support come out before the voice.
  { const r = E.enforceTimeWords(script, briefs, storyboard); script = r.script; if (r.stripped.length) log(`Time words stripped (${r.stripped.length}): ${[...new Set(r.stripped)].join(', ')}`); }
  const title = storyboard.title || `Standard Topic — ${dateLabel}`;
  fs.writeFileSync(path.join(OUT, `script-${edition}.md`), E.scriptToText(script, { title, dateLabel }));
  fs.writeFileSync(path.join(OUT, `script-${edition}.json`), JSON.stringify(script, null, 2));
  fs.writeFileSync(path.join(OUT, `briefing-${edition}.md`), E.renderBriefingText(script, storyboard));
  log(`Briefing text: ${path.join(OUT, `briefing-${edition}.md`)} · in focus: ${(script.in_focus || []).length} lines`);

  log(`\nScript written: ${path.join(OUT, `script-${edition}.md`)}`);
  log(`Text stages cost: ${fmtUSD(micros)}`);

  if (SCRIPT_ONLY) { log('\n--script-only: stopping before the voice.\n'); return; }

  // 5. Voice ----------------------------------------------------------------
  const chars = script.segments.reduce((n, s) => n + String(s.text || '').length, 0);
  log(`\nStage 4 · voice (${VOICE}) — ${chars.toLocaleString()} chars`);
  const t4 = Date.now();
  const notes2 = [];
  const { pcm, rate, chapters, durationMs } = await E.voiceScript(script.segments, {
    voice: VOICE,
    music: !arg('no-music'),
    check: !arg('no-check'),
    onNote: (m) => notes2.push(m),
    onProgress: (done, total) => process.stdout.write(`\r  spoken ${done}/${total} chunks`),
  });
  if (notes2.length) { log(''); notes2.forEach((m) => log(`  ! ${m}`)); }
  log(`\r  spoken in ${((Date.now() - t4) / 1000).toFixed(1)}s · ${(durationMs / 60000).toFixed(1)} min of audio`);

  const mp3 = path.join(OUT, `standard-topic-${edition}.mp3`);
  encodeMP3(pcm, rate, mp3, { title, chapters, durationMs });
  const size = fs.statSync(mp3).size;
  // revamp1374: judge the pace from the finished file, per chapter, so an
  // episode is checked by numbers rather than by listening to it.
  try { const pr = A.paceReport(mp3, chapters, script.segments, durationMs); log('Pace, per chapter (from the finished file):\n' + pr.text); log(pr.flags.length ? `  ! pacing flags: ${pr.flags.join(' · ')}` : '  pacing: every chapter in band'); } catch (e) { log(`  (pace report skipped: ${e && e.message})`); }

  fs.writeFileSync(path.join(OUT, `notes-${edition}.md`), E.showNotes(script, briefs, { title, teaser: storyboard.teaser || '', chapters, dateLabel }));
  fs.writeFileSync(path.join(OUT, `chapters-${edition}.json`), JSON.stringify(chapters, null, 2));
  fs.writeFileSync(path.join(OUT, `briefing-${edition}.md`), E.renderBriefingText(script, storyboard, { chapters }));

  if (arg('publish')) {
    process.stdout.write('\nStage 5 · publish … ');
    try {
      const r = await publishEpisode({ mp3, script, storyboard, chapters, durationMs, briefs, edition, ed, dateLabel, title, chars, micros });
      log(`uploaded ${(r.bytes / 1024 / 1024).toFixed(1)} MB → ${r.url}`);
      log(`  ai_audio row #${r.id} · home briefing text ${r.homeUpdated ? 'UPDATED' : 'left alone'}`);
    } catch (e) { log(`FAILED: ${e.message}`); }
  }

  log(`\n${title}`);
  log(`  audio   ${mp3}`);
  log(`          ${(durationMs / 60000).toFixed(1)} min · ${(size / 1024 / 1024).toFixed(1)} MB · ${chapters.length} chapters`);
  log(`  notes   ${path.join(OUT, `notes-${edition}.md`)}`);
  log(`  cost    text ${fmtUSD(micros)} + voice ~$${(chars / 1e6 * 15).toFixed(3)} (at $15/M chars)`);
  log('');
  for (const c of chapters) {
    const s = Math.round(c.start_ms / 1000);
    log(`  ${String(Math.floor(s / 60)).padStart(2, ' ')}:${String(s % 60).padStart(2, '0')}  ${c.label}`);
  }
  log('');
}

async function publishOnly() {
  const sql = getSql();
  const now = new Date();
  if (arg('edition')) process.env.EPISODE_EDITION = String(arg('edition'));
  if (arg('date')) process.env.EPISODE_DATE = String(arg('date'));
  const ed = E.editionFor(now);
  const edition = `${E.editionDate(now)}-${ed}`;
  const dateLabel = E.todayLabel(now);
  const wave = E.waveStart(now);
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
  const script = rd(`script-${edition}.json`);
  const storyboard = rd(`storyboard-${edition}.json`);
  const chapters = rd(`chapters-${edition}.json`);
  const mp3 = path.join(OUT, `standard-topic-${edition}.mp3`);
  const durationMs = Math.round(parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]).toString()) * 1000);
  const briefs = await E.gatherBriefs(sql, { since: wave, edition: `${E.editionDate(now)}|${ed}` });
  const chars = script.segments.reduce((n, s) => n + String(s.text || '').length, 0);
  const title = storyboard.title || `Standard Topic — ${dateLabel}`;
  log(`Publish only · ${edition} · ${(durationMs / 60000).toFixed(1)} min`);
  const r = await publishEpisode({ mp3, script, storyboard, chapters, durationMs, briefs, edition, ed, dateLabel, title, chars, micros: 0 });
  log(`  uploaded ${(r.bytes / 1024 / 1024).toFixed(1)} MB → ${r.url}`);
  log(`  ai_audio row #${r.id} · home briefing text ${r.homeUpdated ? 'UPDATED' : 'left alone'}`);
}

// ── publish ────────────────────────────────────────────────────────────────
// Upload the MP3 to Vercel Blob, record the edition in ai_audio, and — the
// alignment step — write the rendered briefing text over the HOME daily:b row,
// so the text the site shows for the Global AI Morning/Evening Briefing IS the
// episode: same stories, same order, item N = chapter N.
async function publishEpisode({ mp3, script, storyboard, chapters, durationMs, briefs, edition, ed, dateLabel, title, chars, micros }) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN is not set (vercel env pull after linking the store)');
  const { put } = require('@vercel/blob');
  const sql = getSql();
  const editionDate = edition.slice(0, 10);
  const bytes = fs.statSync(mp3).size;
  const pathname = `audio/flagship/${editionDate}-${ed}.mp3`;

  // The card's three entries need sublines. A script from before they existed
  // (or a writer that skipped them) gets them from one small call.
  const recard = !!arg('recard');
  const focus = E.normalizeFocus(script.in_focus);
  if (recard || focus.length < 3 || focus.some((f) => !f.line)) {
    try { const got = await E.runFocusLines(script); if (got.length) script.in_focus = got; } catch (e) { log(`  (focus lines: ${e.message})`); }
  }
  // The card's headline and summary; backfilled for a script without them.
  if (recard || !String(script.headline || '').trim() || !String(script.summary || '').trim()) {
    try { const got = await E.runHeadline(script); if (got && got.headline) { script.headline = got.headline; script.summary = got.summary || script.summary; } } catch (e) { log(`  (headline: ${e.message})`); }
  }
  const cardTitle = String(script.headline || '').trim() || title;
  const cardTeaser = String(script.summary || storyboard.teaser || '').trim();
  // Waveform peaks for the player: 96 buckets of the decoded audio, 0–100.
  let peaks = null;
  try {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', mp3, '-f', 's16le', '-ac', '1', '-ar', '8000', 'pipe:1'], { maxBuffer: 256 * 1024 * 1024 });
    const n = raw.length / 2; const B = 96; const per = Math.max(1, Math.floor(n / B)); const out = [];
    for (let i = 0; i < B; i++) { let m = 0; for (let j = 0; j < per; j++) { const k = i * per + j; if (k >= n) break; const v = Math.abs(raw.readInt16LE(k * 2)); if (v > m) m = v; } out.push(m); }
    const mx = Math.max(...out) || 1; peaks = out.map((v) => Math.round((v / mx) * 100));
  } catch (e) { log(`  (peaks: ${e.message})`); }
  const blob = await put(pathname, fs.createReadStream(mp3), {
    access: 'public', contentType: 'audio/mpeg', addRandomSuffix: false, allowOverwrite: true,
    cacheControlMaxAge: 60 * 60 * 24 * 365,
  });

  // Source links per chapter, resolved from the briefings each segment used.
  // revamp1433: through the same resolver as the writer's material — matching
  // on slug alone left every story on the main briefing with no sources at all.
  const sources = []; const seen = new Set();
  // revamp1433: only the STORY beats collect sources. A URI is claimed by the
  // first segment that asks for it, and the cold open — which is not rendered
  // as a story and shows no chips — was claiming six of them before the lead
  // could, leaving that story bare.
  const STORY_BEATS = new Set(['lead', 'developing', 'why', 'around', 'ahead']);
  script.segments.forEach((seg, i) => {
    if (!STORY_BEATS.has(seg.beat)) return;
    for (const b of resolveRefs(seg.brief_refs || [], briefs)) {
      for (const src of (b.sources || []).slice(0, 6)) {
        const uri = src && (src.uri || src.url); if (!uri || seen.has(uri)) continue;
        seen.add(uri);
        sources.push({ title: src.title || '', uri, source: src.source || '', chapter: i, topic: b.name });
      }
    }
  });

  // The stamp the site shows is this row's created_at: the edition's RELEASE
  // time (5am / 5pm ET), not the moment of a (re)publish — the card was reading
  // "8:56 PM ET" on a morning briefing after a re-run. revamp1433 takes it from
  // the edition clock, so a 4:20 AM build still stamps 5:00 AM.
  const CLOCK = require('../lib/edition');
  const built = CLOCK.forcedEdition() || CLOCK.buildingEdition();
  const stamp = built.releaseAt.toISOString();
  const releaseAt = built.releaseAt.toISOString();
  const rows = await sql.query(
    `INSERT INTO ai_audio (kind, family_slug, edition_date, edition, title, teaser, url, bytes, duration_ms,
       chapters, storyboard, script, sources, voice, provider, chars, cost_micros, peaks, created_at, release_at)
     VALUES ('flagship','home',$1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16::jsonb,$17,$18)
     ON CONFLICT (kind, family_slug, edition_date, edition) DO UPDATE SET
       title=EXCLUDED.title, teaser=EXCLUDED.teaser, url=EXCLUDED.url, bytes=EXCLUDED.bytes,
       duration_ms=EXCLUDED.duration_ms, chapters=EXCLUDED.chapters, storyboard=EXCLUDED.storyboard,
       script=EXCLUDED.script, sources=EXCLUDED.sources, voice=EXCLUDED.voice, provider=EXCLUDED.provider,
       chars=EXCLUDED.chars, cost_micros=EXCLUDED.cost_micros, peaks=EXCLUDED.peaks, created_at=EXCLUDED.created_at,
       release_at=EXCLUDED.release_at
     RETURNING id`,
    [editionDate, ed, cardTitle, cardTeaser, blob.url, bytes, durationMs,
     JSON.stringify(chapters), JSON.stringify(storyboard), JSON.stringify(script), JSON.stringify(sources),
     VOICE, 'gemini-tts', chars, Math.round(micros + chars * 15), JSON.stringify(peaks), stamp, releaseAt]);

  // The home briefing text = this episode, rendered. revamp1433: it is STAGED
  // under this edition's key like every other briefing, so it appears the
  // moment the release runs and not before; and both editions get one now that
  // the evening edition is back.
  let homeUpdated = false;
  if (!arg('no-home')) {
    const text = E.renderBriefingText(script, storyboard, { chapters });
    const summary = cardTeaser || null;
    const srcJson = JSON.stringify(sources.map((s) => ({ title: s.title, uri: s.uri, source: s.source, via: 'episode', item: s.chapter })));
    const body = text.replace(/^SUMMARY:.*\n+/, '');
    const model = `episode:${E.deskModel()}`;
    await sql.query(
      `INSERT INTO ai_insights (entity_type, entity_key, insight, content, summary, model, sources, created_at,
         pending_content, pending_summary, pending_model, pending_sources, pending_edition, pending_at)
       VALUES ('shortcut','home','daily:b',$1,$2,$3,$4::jsonb,$5,$1,$2,$3,$4::jsonb,$6,now())
       ON CONFLICT (entity_type, entity_key, insight)
       DO UPDATE SET pending_content=EXCLUDED.pending_content, pending_summary=EXCLUDED.pending_summary,
         pending_model=EXCLUDED.pending_model, pending_sources=EXCLUDED.pending_sources,
         pending_edition=EXCLUDED.pending_edition, pending_at=now()`,
      [body, summary, model, srcJson, stamp, built.key]);
    homeUpdated = true;
  }
  return { url: blob.url, bytes, id: rows[0] && rows[0].id, homeUpdated };
}

main().catch((e) => { console.error(`\n${e && e.stack || e}`); process.exit(1); });
