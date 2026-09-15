// Original sounder, dividers and mixing for the daily episode.
//
// Everything here is synthesized from scratch in PCM — no samples, no library,
// nothing licensed. That matters: a news show needs a bed it can use every day
// forever, and generating it means the asset is ours and costs nothing.
//
// The bed is built the way a news-radio sounder actually is: a teletype rattle
// underneath (the sound of wire copy arriving), a low pulsing bass that gives it
// urgency, and a rising three-pip figure over the top. It runs alone for a few
// seconds, then ducks hard and sits under the cold open before fading out.

const RATE = 24000;
const TAU = Math.PI * 2;

const db = (x) => Math.pow(10, x / 20);
function buf(seconds, rate = RATE) { return new Float32Array(Math.round(seconds * rate)); }
function add(dst, src, atSample, gain = 1) {
  for (let i = 0; i < src.length; i++) {
    const j = atSample + i;
    if (j >= 0 && j < dst.length) dst[j] += src[i] * gain;
  }
}
// Attack/decay envelope in seconds.
function env(n, a, d, rate = RATE) {
  const out = new Float32Array(n);
  const ai = Math.max(1, Math.round(a * rate));
  const di = Math.max(1, Math.round(d * rate));
  for (let i = 0; i < n; i++) {
    const up = i < ai ? i / ai : 1;
    const down = i > n - di ? Math.max(0, (n - i) / di) : 1;
    out[i] = up * down;
  }
  return out;
}
function sine(freq, seconds, { rate = RATE, phase = 0, glide = 0 } = {}) {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  let p = phase;
  for (let i = 0; i < n; i++) {
    const f = freq + glide * (i / n);
    p += TAU * f / rate;
    out[i] = Math.sin(p);
  }
  return out;
}

// A teletype key strike: a burst of noise pushed through a cheap one-pole
// band-pass, so it reads as a mechanical click rather than a hiss.
function click(seconds = 0.035, tone = 2100, rate = RATE) {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const e = env(n, 0.0008, seconds * 0.9, rate);
  let lp = 0; let hp = 0;
  const a = Math.exp(-TAU * (tone * 1.7) / rate);
  const b = Math.exp(-TAU * (tone * 0.45) / rate);
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    lp = white * (1 - a) + lp * a;
    hp = lp - (hp * b + lp * (1 - b));
    out[i] = hp * e[i];
  }
  return out;
}

// The teletype bed: irregular strikes, occasional double-strike, a carriage
// return thunk every second or so. Irregularity is the whole trick — evenly
// spaced clicks sound like a metronome, not a newsroom.
function teletype(seconds, { rate = RATE, density = 13 } = {}) {
  const out = buf(seconds, rate);
  let t = 0;
  while (t < seconds) {
    const gap = (1 / density) * (0.45 + Math.random() * 1.5);
    t += gap;
    if (t >= seconds) break;
    const tone = 1750 + Math.random() * 900;
    add(out, click(0.028 + Math.random() * 0.02, tone, rate), Math.round(t * rate), 0.5 + Math.random() * 0.5);
    if (Math.random() < 0.22) {
      add(out, click(0.024, tone * 1.1, rate), Math.round((t + 0.035) * rate), 0.4);
    }
  }
  // Carriage returns.
  for (let c = 0.6; c < seconds; c += 0.9 + Math.random() * 0.7) {
    const th = sine(150, 0.09, { rate, glide: -60 });
    const e = env(th.length, 0.002, 0.085, rate);
    for (let i = 0; i < th.length; i++) th[i] *= e[i] * 0.5;
    add(out, th, Math.round(c * rate), 1);
  }
  return out;
}

// The low engine: a pulsing root note with a fifth above it, pulsing at roughly
// two beats a second. This is what makes the bed feel like it is going
// somewhere rather than just sitting there.
function pulse(seconds, { rate = RATE, root = 73.42 } = {}) {
  const out = buf(seconds, rate);
  const beat = 0.5;
  for (let t = 0; t < seconds - 0.2; t += beat) {
    const dur = 0.42;
    const a = sine(root, dur, { rate });
    const b = sine(root * 1.5, dur, { rate });
    const c = sine(root * 2, dur, { rate });
    const e = env(a.length, 0.012, 0.34, rate);
    const one = new Float32Array(a.length);
    const accent = (Math.round(t / beat) % 4 === 0) ? 1 : 0.62;
    for (let i = 0; i < a.length; i++) one[i] = (a[i] * 0.55 + b[i] * 0.26 + c[i] * 0.12) * e[i] * accent;
    add(out, one, Math.round(t * rate), 1);
  }
  return out;
}

// Three pips and a resolve — the figure that says "the news starts now".
function pips(seconds, { rate = RATE } = {}) {
  const out = buf(seconds, rate);
  const notes = [
    { at: 0.10, f: 880, d: 0.14 },
    { at: 0.58, f: 1046.5, d: 0.14 },
    { at: 1.06, f: 1318.5, d: 0.14 },
    { at: 1.54, f: 1760, d: 0.52 },
  ];
  for (const n of notes) {
    if (n.at + n.d > seconds) continue;
    const s = sine(n.f, n.d, { rate });
    const h = sine(n.f * 2, n.d, { rate });
    const e = env(s.length, 0.004, n.d * 0.8, rate);
    const one = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) one[i] = (s[i] * 0.8 + h[i] * 0.12) * e[i];
    add(out, one, Math.round(n.at * rate), 0.5);
  }
  return out;
}

// A rising sweep into the first word.
function riser(seconds, { rate = RATE } = {}) {
  const s = sine(160, seconds, { rate, glide: 620 });
  const e = env(s.length, seconds * 0.85, seconds * 0.14, rate);
  const out = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s[i] * e[i] * 0.22;
  return out;
}

// The full open. `lead` seconds play alone, then the bed continues for `under`
// seconds at a much lower level so the host talks over the tail of it.
function newsBed({ lead = 4.4, under = 9.0, rate = RATE } = {}) {
  const total = lead + under;
  const mix = buf(total, rate);
  const tt = teletype(total, { rate, density: 13 });
  const pl = pulse(lead + 2.2, { rate });
  const pp = pips(lead, { rate });
  const rs = riser(0.75, { rate });

  add(mix, tt, 0, db(-16));
  add(mix, pl, 0, db(-11));
  add(mix, pp, Math.round(0.9 * rate), db(-13));
  add(mix, rs, Math.round((lead - 0.75) * rate), db(-9));

  // Duck: full level for `lead`, a fast 0.5s fall, then a long fade to nothing.
  const leadN = Math.round(lead * rate);
  const fallN = Math.round(0.5 * rate);
  for (let i = 0; i < mix.length; i++) {
    let g = 1;
    if (i > leadN) {
      const k = Math.min(1, (i - leadN) / fallN);
      const ducked = 1 - k * (1 - db(-17));
      const rest = (i - leadN) / (mix.length - leadN);
      g = ducked * Math.max(0, 1 - Math.pow(rest, 1.6));
    }
    mix[i] *= g;
  }
  return { pcm: mix, leadSeconds: lead, rate };
}

// A quiet mark between major segments: one carriage-return thunk and a whisper
// of teletype. It is deliberately almost subliminal — at -26 dB it reads as a
// page turn, not a jingle.
function divider({ rate = RATE } = {}) {
  const out = buf(0.62, rate);
  const th = sine(120, 0.16, { rate, glide: -45 });
  const e = env(th.length, 0.003, 0.15, rate);
  for (let i = 0; i < th.length; i++) th[i] *= e[i];
  add(out, th, Math.round(0.05 * rate), db(-16));
  add(out, teletype(0.5, { rate, density: 9 }), Math.round(0.08 * rate), db(-26));
  return out;
}

// The sign-off: the bed swells back under the last few seconds.
function outroBed({ seconds = 7.5, rate = RATE } = {}) {
  const mix = buf(seconds, rate);
  add(mix, teletype(seconds, { rate, density: 10 }), 0, db(-23));
  add(mix, pulse(seconds, { rate }), 0, db(-20));
  const tail = sine(146.8, 1.9, { rate });
  const h = sine(220, 1.9, { rate });
  const e = env(tail.length, 0.25, 1.6, rate);
  const one = new Float32Array(tail.length);
  for (let i = 0; i < tail.length; i++) one[i] = (tail[i] * 0.6 + h[i] * 0.3) * e[i];
  add(one.length ? mix : mix, one, Math.round((seconds - 2.1) * rate), db(-15));
  // Swell in, so it does not simply appear.
  const inN = Math.round(1.2 * rate);
  for (let i = 0; i < Math.min(inN, mix.length); i++) mix[i] *= i / inN;
  return mix;
}

// ── PCM plumbing ───────────────────────────────────────────────────────────
function toFloat(int16Buf) {
  const n = int16Buf.length / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = int16Buf.readInt16LE(i * 2) / 32768;
  return out;
}
function toInt16(float32) {
  const out = Buffer.alloc(float32.length * 2);
  for (let i = 0; i < float32.length; i++) {
    let v = float32[i];
    // Soft-clip rather than hard-clip: the bed plus a loud consonant can poke
    // over 1.0, and a hard clip on speech is instantly audible as a crackle.
    if (v > 0.95 || v < -0.95) v = Math.tanh(v);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  return out;
}
// Lay `bed` under `speech`, starting at `offsetSamples` into the speech.
function mixUnder(speechInt16, bedFloat, offsetSamples = 0) {
  const s = toFloat(speechInt16);
  const need = Math.max(s.length, offsetSamples + bedFloat.length);
  const out = new Float32Array(need);
  out.set(s, 0);
  for (let i = 0; i < bedFloat.length; i++) {
    const j = offsetSamples + i;
    if (j >= 0 && j < out.length) out[j] += bedFloat[i];
  }
  return toInt16(out);
}
function floatToInt16(f) { return toInt16(f); }

// ── Loudness ───────────────────────────────────────────────────────────────
// Separate text-to-speech calls come back at different levels, and a level
// change between segments is heard as a change of PERSON long before it is
// heard as a change of volume. Matching every segment to the same average level
// is the single biggest thing that makes one voice sound like one voice.
function rmsOf(f32) {
  let sum = 0;
  for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
  return Math.sqrt(sum / Math.max(1, f32.length));
}
function normalizeLoudness(pcm, targetDbFS = -20) {
  const f = toFloat(pcm);
  const r = rmsOf(f);
  if (!(r > 0)) return { pcm, gainDb: 0 };
  let gain = Math.pow(10, targetDbFS / 20) / r;
  gain = Math.max(0.35, Math.min(3.2, gain));
  let peak = 0;
  for (let i = 0; i < f.length; i++) { const v = Math.abs(f[i] * gain); if (v > peak) peak = v; }
  if (peak > 0.97) gain *= 0.97 / peak;            // keep headroom for the bed
  for (let i = 0; i < f.length; i++) f[i] *= gain;
  return { pcm: toInt16(f), gainDb: +(20 * Math.log10(gain)).toFixed(2) };
}

// ── Stingers ───────────────────────────────────────────────────────────────
// A family, not a jingle. Every one is built from the same three materials as
// the opening sounder — teletype, a pulsing low D, and pips from the D minor
// scale — so they belong to each other; what changes is the figure and the
// direction, so a listener learns that a rising run means the rapid-fire tour
// and a falling one means the takeaways. That is what makes it branding rather
// than decoration.
//
// Each returns { pcm, head }: `head` seconds play in the clear, the remainder is
// a tail meant to be mixed UNDER the first words of the next segment. That
// overlap is what removes the "half a second of music, then straight in" edge —
// the music is still going when the voice arrives, and fades out beneath it.
const D2 = 73.42;
const NOTE = { D4: 293.66, F4: 349.23, A4: 440, D5: 587.33, F5: 698.46, A5: 880 };

function stingerFrom({ figure, head, tail, density = 11, bassBeats = 2, rate = RATE, level = 1 }) {
  const total = head + tail;
  const mix = buf(total, rate);
  add(mix, teletype(total * 0.8, { rate, density }), 0, db(-21));
  for (let b = 0; b < bassBeats; b++) {
    const d = 0.5;
    const a = sine(D2, d, { rate }); const h = sine(D2 * 1.5, d, { rate });
    const e = env(a.length, 0.01, 0.42, rate);
    const one = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) one[i] = (a[i] * 0.6 + h[i] * 0.25) * e[i] * (b === 0 ? 1 : 0.6);
    add(mix, one, Math.round(b * 0.42 * rate), db(-13));
  }
  for (const n of figure) {
    const s = sine(n.f, n.d, { rate }); const h = sine(n.f * 2, n.d, { rate });
    const e = env(s.length, 0.005, n.d * 0.82, rate);
    const one = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) one[i] = (s[i] * 0.78 + h[i] * 0.14) * e[i];
    add(mix, one, Math.round(n.at * rate), db(-15) * (n.g || 1));
  }
  // Tail fade: gone by the end, so it never fights the voice it sits under.
  const headN = Math.round(head * rate);
  for (let i = headN; i < mix.length; i++) {
    const k = (i - headN) / Math.max(1, mix.length - headN);
    mix[i] *= Math.max(0, 1 - Math.pow(k, 1.25)) * db(-8);
  }
  for (let i = 0; i < mix.length; i++) mix[i] *= level;
  return { pcm: mix, head };
}

// One per kind of turn the show makes. Keyed by the beat being ENTERED.
function stinger(kind, { rate = RATE } = {}) {
  switch (kind) {
    case 'tour':      // rising run: the pace is about to pick up
      return stingerFrom({ rate, head: 1.25, tail: 1.5, density: 15, figure: [
        { at: 0.10, f: NOTE.D5, d: 0.13 }, { at: 0.32, f: NOTE.F5, d: 0.13 },
        { at: 0.54, f: NOTE.A5, d: 0.34, g: 1.1 }] });
    case 'takeaway':  // falling resolve: we are landing
      return stingerFrom({ rate, head: 1.3, tail: 1.7, density: 8, bassBeats: 2, figure: [
        { at: 0.10, f: NOTE.A4, d: 0.16 }, { at: 0.40, f: NOTE.F4, d: 0.16 },
        { at: 0.70, f: NOTE.D4, d: 0.62, g: 1.05 }] });
    case 'why':       // a held note: stop and think
      return stingerFrom({ rate, head: 1.2, tail: 1.8, density: 7, bassBeats: 1, figure: [
        { at: 0.12, f: NOTE.A4, d: 0.75, g: 0.9 }] });
    case 'turn':      // the workhorse between stories: two steps, no drama
    default:
      return stingerFrom({ rate, head: 1.05, tail: 1.45, density: 11, figure: [
        { at: 0.10, f: NOTE.A4, d: 0.14 }, { at: 0.34, f: NOTE.D5, d: 0.40, g: 1.05 }] });
  }
}

// ── Tempo normalization ────────────────────────────────────────────────────
// The voice does not read at a constant rate: measured across one episode the
// lead came back at 183 words a minute while the tour crawled at 99, which is
// the difference between rushing the most important story of the day and
// dragging the lightest. Nothing in the text asks for that; it is just how the
// model paced those chunks.
//
// So pace is corrected after the fact. Each segment's real rate is measured
// against its word count and nudged toward the target with ffmpeg's atempo,
// which changes duration without touching pitch. The correction is clamped
// hard: beyond about 12% the artifacts become audible, and a segment that far
// out is better left alone than made to sound processed.
const { execFileSync } = require('child_process');
// Not a sloth, not an auctioneer. Broadcast news sits around 150 words a
// minute; below about 130 it drags and above about 175 it stops being
// listenable. The clamp is wide enough to actually pull an outlier into the
// band. 12% left a 185-wpm lead at 165; 22% left a short closing beat at 163
// against 148 everywhere else. atempo holds up well past either, and a segment
// that lands on the same rate as its neighbours matters more than the last
// fraction of a percent of fidelity.
// revamp1374: measured on two published episodes, every story segment sat
// at 148 wpm overall with 13% of its time in pauses — the voice itself ran
// ~168 wpm and then stopped for 0.7–1.0s between sentences, 37 times in one
// episode. That is what "slow" was: not the reading, the waiting. Pauses are
// capped first (compressPauses), and the target moves to 158 so the tighter
// pauses are not handed back to the voice as a slower read.
const TEMPO_TARGET_WPM = 158;
const TEMPO_CLAMP = 0.32;
// Any silence longer than PAUSE_MAX_MS is cut down to PAUSE_KEEP_MS by removing
// its middle, so sentence boundaries keep a natural beat and nothing else.
const PAUSE_MAX_MS = 480;
const PAUSE_KEEP_MS = 400;
const PAUSE_FLOOR_DB = -40;

// Trim the long gaps. RMS over 10ms windows; a run of windows under the floor
// that outlasts PAUSE_MAX_MS is shortened to PAUSE_KEEP_MS (the edges are
// kept, the middle dropped, with a 5ms crossfade). Returns { pcm, cut, removedMs }.
function compressPauses(pcm, rate, { maxMs = PAUSE_MAX_MS, keepMs = PAUSE_KEEP_MS, floorDb = PAUSE_FLOOR_DB } = {}) {
  const n = pcm.length / 2;
  const win = Math.round(rate * 0.01);
  const floor = Math.pow(10, floorDb / 20) * 32768;
  const quiet = [];
  for (let i = 0; i + win <= n; i += win) {
    let acc = 0; for (let k = i; k < i + win; k++) { const v = pcm.readInt16LE(k * 2); acc += v * v; }
    quiet.push(Math.sqrt(acc / win) < floor);
  }
  const maxW = Math.round(maxMs / 10), keepW = Math.round(keepMs / 10);
  const out = []; let cut = 0, removed = 0; let i = 0; let cursor = 0;
  const xf = Math.round(rate * 0.005);
  while (i < quiet.length) {
    if (!quiet[i]) { i++; continue; }
    let j = i; while (j < quiet.length && quiet[j]) j++;
    const run = j - i;
    if (run > maxW) {
      const half = Math.floor(keepW / 2);
      const a = (i + half) * win, b = (j - half) * win;      // drop samples a..b
      out.push(pcm.subarray(cursor * 2, a * 2));
      // 5ms crossfade across the cut so there is no click
      const tail = pcm.subarray(Math.max(cursor, a - xf) * 2, a * 2), head = pcm.subarray(b * 2, Math.min(n, b + xf) * 2);
      const m = Math.min(tail.length, head.length) / 2;
      if (m > 0) { const mix = Buffer.alloc(m * 2); for (let k = 0; k < m; k++) { const t = k / m; mix.writeInt16LE(Math.round(tail.readInt16LE(k * 2) * (1 - t) + head.readInt16LE(k * 2) * t), k * 2); } out[out.length - 1] = out[out.length - 1].subarray(0, out[out.length - 1].length - m * 2); out.push(mix); cursor = b + m; }
      else cursor = b;
      cut++; removed += (b - a) / rate * 1000;
    }
    i = j;
  }
  out.push(pcm.subarray(cursor * 2));
  return { pcm: Buffer.concat(out), cut, removedMs: Math.round(removed) };
}

function retime(pcm, rate, factor) {
  if (!(factor > 0) || Math.abs(factor - 1) < 0.02) return pcm;
  return execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1',
    '-i', 'pipe:0', '-filter:a', `atempo=${factor.toFixed(4)}`, '-f', 's16le', 'pipe:1'],
    { input: pcm, maxBuffer: 512 * 1024 * 1024 });
}

// Returns { pcm, from, to, factor } — `from`/`to` are words per minute.
function normalizeTempo(pcm, rate, wordCount, { target = TEMPO_TARGET_WPM, clamp = TEMPO_CLAMP } = {}) {
  const seconds = pcm.length / 2 / rate;
  if (!wordCount || seconds < 1.5) return { pcm, from: 0, to: 0, factor: 1 };
  const wpm = wordCount / (seconds / 60);
  let factor = wpm / target;                       // >1 means it was read too fast → slow it down
  factor = Math.max(1 - clamp, Math.min(1 + clamp, factor));
  // atempo>1 speeds up. We want the opposite of the ratio: a fast read needs a
  // factor below 1 to stretch it out.
  const applied = 1 / factor;
  const out = retime(pcm, rate, applied);
  const newWpm = wordCount / ((out.length / 2 / rate) / 60);
  return { pcm: out, from: Math.round(wpm), to: Math.round(newWpm), factor: applied };
}

// The pace report: what a listener would notice, per chapter, from the
// finished MP3 — so an episode is judged by numbers, not by listening to it.
// Flags: speech rate outside 150–185 wpm, pauses over 12% of the chapter,
// any single pause over 0.7s.
function paceReport(mp3Path, chapters, segments, durationMs) {
  const log = execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-i', mp3Path, '-af', 'silencedetect=noise=-32dB:d=0.22', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  const sil = []; let cur = null;
  for (const m of log.matchAll(/silence_(start|end): ([0-9.]+)/g)) { if (m[1] === 'start') cur = { s: +m[2] }; else if (cur) { cur.e = +m[2]; sil.push(cur); cur = null; } }
  const wc = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
  const rows = []; const flags = [];
  for (let i = 0; i < chapters.length; i++) {
    const a = chapters[i].start_ms / 1000, b = (chapters[i + 1] ? chapters[i + 1].start_ms : durationMs) / 1000;
    const inside = sil.filter((x) => x.s >= a && x.e <= b);
    const ps = inside.reduce((t, x) => t + (x.e - x.s), 0);
    const longest = inside.reduce((m, x) => Math.max(m, x.e - x.s), 0);
    const words = segments[i] ? wc(segments[i].text) : 0;
    const speech = words && (b - a - ps) > 0 ? words / ((b - a - ps) / 60) : 0;
    const pausePct = 100 * ps / Math.max(0.1, b - a);
    const f = [];
    if (['cold_open', 'intro', 'outro'].indexOf(chapters[i].beat) < 0) {
      if (speech && speech < 150) f.push('slow'); if (speech > 185) f.push('fast');
      if (pausePct > 12) f.push('pausey'); if (longest > 0.7) f.push(`gap ${longest.toFixed(2)}s`);
    }
    rows.push(`  ${String(i).padStart(2)} ${String(chapters[i].beat || '').padEnd(10)} ${(b - a).toFixed(0).padStart(4)}s  speech ${String(Math.round(speech)).padStart(3)} wpm  pauses ${pausePct.toFixed(0).padStart(2)}%  longest ${longest.toFixed(2)}s${f.length ? '   ! ' + f.join(', ') : ''}`);
    if (f.length) flags.push(`${chapters[i].label || chapters[i].beat}: ${f.join(', ')}`);
  }
  return { text: rows.join('\n'), flags };
}
module.exports = { RATE, normalizeLoudness, stinger, normalizeTempo, compressPauses, paceReport, TEMPO_TARGET_WPM, newsBed, divider, outroBed, mixUnder, floatToInt16, toFloat, toInt16 };
