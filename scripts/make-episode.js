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
  const ed = E.editionFor(now);
  const wave = E.waveStart(now);
  const edition = `${E.editionDate(now)}-${ed}`;
  const dateLabel = E.todayLabel(now);
  fs.mkdirSync(OUT, { recursive: true });

  log(`\nStandard Topic — flagship episode`);
  log(`  edition   ${edition} — ${E.editionLabel(ed)} (${dateLabel})`);
  log(`  format    ${fmt.label}, ~${fmt.minutes} min, single host`);
  log(`  models    ${E.deskModel()} (desk/writer), ${E.textModel()} (QA), voice ${VOICE}`);
  log(`  wave      briefings since ${wave.toISOString()}\n`);

  // 1. Gather ---------------------------------------------------------------
  const briefs = await E.gatherBriefs(sql, { since: wave });
  const home = briefs.find((b) => b.isHome) || null;
  const fresh = briefs.filter((b) => b.fresh);
  log(`Briefings: ${briefs.length} found, ${fresh.length} from this wave${home ? '' : ', NO home briefing'}`);
  if (!home) console.warn('  ! the home briefing is missing — the desk will work from topics alone');
  if (fresh.length < 60) console.warn(`  ! only ${fresh.length} briefings are from today's wave; the episode will lean on older ones`);

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
  const selected = briefs.filter((b) => wanted.has(b.slug) || b.isHome);
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
  const briefs = await E.gatherBriefs(sql, { since: wave });
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
  const bySlug = new Map(briefs.map((b) => [b.slug, b]));
  const sources = []; const seen = new Set();
  script.segments.forEach((seg, i) => {
    for (const slug of (seg.brief_refs || [])) {
      const b = bySlug.get(slug); if (!b) continue;
      for (const src of (b.sources || []).slice(0, 6)) {
        const uri = src && (src.uri || src.url); if (!uri || seen.has(uri)) continue;
        seen.add(uri);
        sources.push({ title: src.title || '', uri, source: src.source || '', chapter: i, topic: b.name });
      }
    }
  });

  // The stamp the site shows is this row's created_at. It is the wave the
  // edition was built from (5am ET), not the moment of a (re)publish — the
  // card was reading "8:56 PM ET" on a morning briefing after a re-run.
  const stamp = E.waveStart(new Date()).toISOString();
  const rows = await sql.query(
    `INSERT INTO ai_audio (kind, family_slug, edition_date, edition, title, teaser, url, bytes, duration_ms,
       chapters, storyboard, script, sources, voice, provider, chars, cost_micros, peaks, created_at)
     VALUES ('flagship','home',$1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16::jsonb,$17)
     ON CONFLICT (kind, family_slug, edition_date, edition) DO UPDATE SET
       title=EXCLUDED.title, teaser=EXCLUDED.teaser, url=EXCLUDED.url, bytes=EXCLUDED.bytes,
       duration_ms=EXCLUDED.duration_ms, chapters=EXCLUDED.chapters, storyboard=EXCLUDED.storyboard,
       script=EXCLUDED.script, sources=EXCLUDED.sources, voice=EXCLUDED.voice, provider=EXCLUDED.provider,
       chars=EXCLUDED.chars, cost_micros=EXCLUDED.cost_micros, peaks=EXCLUDED.peaks, created_at=EXCLUDED.created_at
     RETURNING id`,
    [editionDate, ed, cardTitle, cardTeaser, blob.url, bytes, durationMs,
     JSON.stringify(chapters), JSON.stringify(storyboard), JSON.stringify(script), JSON.stringify(sources),
     VOICE, 'gemini-tts', chars, Math.round(micros + chars * 15), JSON.stringify(peaks), stamp]);

  // The home briefing text = this episode, rendered. Only the MORNING edition
  // overwrites the home daily:b row for now: the site has one home briefing
  // slot until the evening edition gets its own (revamp1340 follow-up).
  let homeUpdated = false;
  if (!arg('no-home') && ed === 'morning') {
    const text = E.renderBriefingText(script, storyboard, { chapters });
    const summary = cardTeaser || null;
    await sql.query(
      `INSERT INTO ai_insights (entity_type, entity_key, insight, content, summary, model, sources, created_at)
       VALUES ('shortcut','home','daily:b',$1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (entity_type, entity_key, insight)
       DO UPDATE SET content=EXCLUDED.content, summary=EXCLUDED.summary, model=EXCLUDED.model, sources=EXCLUDED.sources, created_at=EXCLUDED.created_at`,
      [text.replace(/^SUMMARY:.*\n+/, ''), summary, `episode:${E.deskModel()}`,
       JSON.stringify(sources.map((s) => ({ title: s.title, uri: s.uri, source: s.source, via: 'episode', item: s.chapter }))), stamp]);
    homeUpdated = true;
  }
  return { url: blob.url, bytes, id: rows[0] && rows[0].id, homeUpdated };
}

main().catch((e) => { console.error(`\n${e && e.stack || e}`); process.exit(1); });
