// Flagship daily episode — the editorial pipeline.
//
// ONE podcast episode per day, built from the briefings the 5am ET wave already
// wrote. Three LLM stages, then a voice:
//
//   1. DESK    reads a compact digest of EVERY briefing (summary + "3 Things" +
//              item headlines) and returns a STORYBOARD: what leads, what the
//              developing stories are, which families get a one-liner, how many
//              seconds each beat gets. This is the editorial judgement and it is
//              the whole product — see deskPrompt's rules.
//   2. WRITER  reads the storyboard plus the FULL TEXT of only the briefings the
//              desk picked, and writes the script: one text block per segment,
//              each with a chapter label and the briefing refs it rests on.
//   3. QA      reads the script against the same briefings and removes anything
//              it cannot support, spells numbers/abbreviations for the ear, and
//              trims segments that overrun their budget.
//   4. VOICE   speaks each segment separately (so chapter offsets come free and
//              no request approaches a vendor cap), then the PCM is concatenated
//              with a beat of silence between segments and encoded once to MP3.
//
// Nothing here browses. The briefings are already grounded and carry their own
// citations; every stage is explicitly forbidden from adding a fact that is not
// in them. See docs/audio-flagship-episode-assessment.md for the cost model.
//
// Env:
//   GEMINI_API_KEY        required (text + voice both ride this one key)
//   EPISODE_MODEL         text model for desk/writer/QA (default gemini-2.5-pro)
//   EPISODE_TTS_MODEL     voice model (default auto-probes the Gemini TTS ids)
//   EPISODE_VOICE         prebuilt voice name (default Gacrux)

const { execFileSync } = require('child_process');
const { generate } = require('./gemini');
const A = require('./episode-audio');
const topicsData = require('../data/topics.json');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ---------------------------------------------------------------------------
// Formats. Each length is a different SHOW, not just a different duration: the
// beats, their order, and the second budgets are what make a 5-minute episode a
// quick hit rather than a truncated 12-minute one. `briefs` is how many
// briefings the desk may draw on, which is also what bounds the writer's input.
// ---------------------------------------------------------------------------
const FORMATS = {
  quick: {
    key: 'quick', label: 'Quick hit', minutes: 5, briefs: 6,
    beats: [
      { beat: 'cold_open', sec: 15, n: 1 },
      { beat: 'lead', sec: 75, n: 1 },
      { beat: 'hit', sec: 30, n: 4 },
      { beat: 'ahead', sec: 25, n: 1 },
      { beat: 'outro', sec: 15, n: 1 },
    ],
  },
  standard: {
    key: 'standard', label: 'Standard', minutes: 12, briefs: 12,
    beats: [
      { beat: 'cold_open', sec: 20, n: 1 },
      { beat: 'lead', sec: 135, n: 1 },
      { beat: 'developing', sec: 95, n: 3 },
      { beat: 'around', sec: 150, n: 1 },
      { beat: 'why', sec: 60, n: 1 },
      { beat: 'ahead', sec: 35, n: 1 },
      { beat: 'outro', sec: 20, n: 1 },
    ],
  },
  indepth: {
    key: 'indepth', label: 'In-depth', minutes: 25, briefs: 20,
    beats: [
      { beat: 'cold_open', sec: 40, n: 1 },
      { beat: 'lead', sec: 150, n: 1 },
      { beat: 'deep_dive', sec: 300, n: 1 },
      { beat: 'developing', sec: 90, n: 5 },
      { beat: 'around', sec: 280, n: 1 },
      { beat: 'watch', sec: 90, n: 1 },
      { beat: 'ahead', sec: 35, n: 1 },
      { beat: 'outro', sec: 20, n: 1 },
    ],
  },
};

const BEAT_LABELS = {
  cold_open: 'Cold open', intro: 'Introduction', lead: 'Lead', developing: 'Developing', hit: 'Quick hit',
  around: 'Around the topics', why: 'Why it matters', deep_dive: 'Deep dive',
  watch: 'What to watch', ahead: 'What to watch next', outro: 'Outro',
};

const WORDS_PER_MIN = 150;
const wordsFor = (sec) => Math.round((sec / 60) * WORDS_PER_MIN);

// ---------------------------------------------------------------------------
// The editorial day. The wave runs at 5am ET (DAILY_WAVE_HOURS_ET in
// api/cron/pregenerate.js); an episode belongs to the wave whose briefings it
// reads, so "today's edition" means "since 5am ET today".
// ---------------------------------------------------------------------------
const ET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
});
function etParts(d) {
  const p = Object.fromEntries(ET_FMT.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24 };
}
function etInstant(y, m, d, h) {
  const want = Date.UTC(y, m - 1, d, h);
  let ts = want;
  for (let i = 0; i < 2; i++) {
    const p = etParts(new Date(ts));
    ts += want - Date.UTC(p.y, p.m - 1, p.d, p.h);
  }
  return new Date(ts);
}
// Two editions a day. The morning wave lands at 5am ET; the evening wave at
// 5pm ET. An episode belongs to whichever wave most recently started, and
// "edition" names it, which drives the station ID, the sign-off, and the
// label everywhere the episode is shown.
const EDITION_CLOCK = require('./edition');
const EDITION_HOURS_ET = EDITION_CLOCK.RELEASE_HOURS_ET;
// revamp1433: the episode belongs to the edition being BUILT — the next
// release after now — so a 4:20 AM run makes today's morning edition rather
// than resolving backwards to yesterday's. EPISODE_EDITION still pins a manual
// run to one half of the day.
function currentEdition(now = new Date()) {
  return EDITION_CLOCK.forcedEdition(now) || EDITION_CLOCK.buildingEdition(now);
}
// revamp1433: the evening edition is back. 1403 pinned this to 'morning' while
// there was only one briefing a day; the edition is now whichever release this
// run is building toward.
function editionFor(now = new Date()) { return currentEdition(now).edition; }
function editionLabel(ed) { return ed === 'evening' ? 'Evening Briefing' : 'Morning Briefing'; }
function waveStart(now = new Date(), hourET = null) {
  if (hourET == null) hourET = EDITION_HOURS_ET[editionFor(now)];
  const p = etParts(now);
  if (p.h >= hourET) return etInstant(p.y, p.m, p.d, hourET);
  const q = etParts(new Date(now.getTime() - 24 * 36e5));
  return etInstant(q.y, q.m, q.d, hourET);
}
// revamp1433: the edition's own date, from the clock rather than from a
// backwards-resolved wave — a 4:20 AM run is today's morning edition.
function editionDate(now = new Date()) { return currentEdition(now).date; }
function editionDateLegacy(now = new Date()) {
  const p = etParts(waveStart(now));
  // An evening run just after midnight ET (00:00–04:59) still belongs to the
  // previous evening's wave, which waveStart already resolved to.
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
function todayLabel(now = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric',
  }).format(waveStart(now));
}

// ---------------------------------------------------------------------------
// Gather. One row per topic, keyed by the topic NAME generateInsight stores
// (lower-cased), joined back to the slug/parent so the desk can reason about
// families and the player can deep-link a chapter.
// ---------------------------------------------------------------------------
function topicIndex() {
  const byName = new Map();
  const bySlug = new Map();
  for (const t of (topicsData.topics || [])) {
    if (!t.slug || !t.name) continue;
    bySlug.set(t.slug, t);
    byName.set(String(t.name).toLowerCase(), t);
  }
  return { byName, bySlug };
}

// revamp1433: the episode is written from the edition it belongs to. The wave
// stages that edition in pending_*, unreleased, so a brief is read from there
// when it carries this edition's key and from the live columns otherwise. A
// staged row is `fresh` by definition: it IS this edition.
async function gatherBriefs(sql, { since = null, edition = null } = {}) {
  const { byName, bySlug } = topicIndex();
  const rows = await sql.query(
    `SELECT entity_key,
            CASE WHEN pending_edition IS NOT NULL AND pending_edition = $1 THEN coalesce(pending_content, content) ELSE content END AS content,
            CASE WHEN pending_edition IS NOT NULL AND pending_edition = $1 THEN coalesce(pending_summary, summary) ELSE summary END AS summary,
            CASE WHEN pending_edition IS NOT NULL AND pending_edition = $1 THEN coalesce(pending_sources, sources) ELSE sources END AS sources,
            CASE WHEN pending_edition IS NOT NULL AND pending_edition = $1 THEN coalesce(pending_at, created_at) ELSE created_at END AS created_at,
            (pending_edition IS NOT NULL AND pending_edition = $1) AS staged
       FROM ai_insights
      WHERE entity_type = 'shortcut' AND insight = 'daily:b'
      ORDER BY entity_key`, [edition]);
  const cutoff = since ? new Date(since).getTime() : null;
  const out = [];
  for (const r of rows) {
    const key = String(r.entity_key || '').toLowerCase();
    const t = byName.get(key) || (key === 'home' ? { slug: 'home', name: 'Home', parent: null } : null);
    if (!t) continue;                       // a brief for a topic we no longer carry
    const parent = t.parent ? bySlug.get(t.parent) : null;
    const created = r.created_at ? new Date(r.created_at) : null;
    let sources = r.sources;
    if (typeof sources === 'string') { try { sources = JSON.parse(sources); } catch (_) { sources = []; } }
    out.push({
      slug: t.slug, name: t.name,
      parentSlug: t.parent || (t.slug === 'home' ? null : t.slug),
      parentName: parent ? parent.name : (t.slug === 'home' ? null : t.name),
      isParent: !t.parent && t.slug !== 'home',
      isHome: t.slug === 'home',
      summary: String(r.summary || '').trim(),
      content: String(r.content || '').trim(),
      sources: Array.isArray(sources) ? sources : [],
      createdAt: created,
      staged: !!r.staged,
      fresh: !!r.staged || !!(created && cutoff && created.getTime() >= cutoff),
    });
  }
  return out;
}

// Pull the scannable bones out of a briefing: the three takeaways and the bolded
// mini-headline that opens each briefing item. That is all the desk needs to
// rank 101 topics — the full text is only ever read for the handful it picks.
function briefBones(content) {
  const things = [];
  const items = [];
  let section = '';
  for (const raw of String(content || '').split('\n')) {
    const line = raw.trim();
    if (/^##\s/.test(line)) {
      section = /3\s*things/i.test(line) ? 'things' : (/^##\s*Briefings/i.test(line) ? 'items' : '');
      continue;
    }
    if (!line) continue;
    if (section === 'things' && line.startsWith('- ')) things.push(line.slice(2).trim());
    if (section === 'items') {
      const m = line.match(/^\*\*(.+?)\*\*/);
      if (m) items.push(m[1].trim());
    }
  }
  return { things, items };
}

function digestFor(briefs, { perTopicItems = 6 } = {}) {
  const lines = [];
  for (const b of briefs) {
    if (b.isHome) continue;                 // the home briefing is supplied in full, separately
    const { things, items } = briefBones(b.content);
    const head = `### ${b.name} [${b.slug}]${b.parentName && b.parentName !== b.name ? ` (family: ${b.parentName})` : ' (family head)'}`;
    const parts = [head];
    if (b.summary) parts.push(`SUMMARY: ${b.summary}`);
    if (things.length) parts.push(`TAKEAWAYS: ${things.join(' | ')}`);
    if (items.length) parts.push(`ITEMS: ${items.slice(0, perTopicItems).map((s, i) => `(${i + 1}) ${s}`).join(' ')}`);
    if (!b.fresh) parts.push('NOTE: this briefing is NOT from today\'s wave — treat as background only.');
    lines.push(parts.join('\n'));
  }
  return lines.join('\n\n');
}

// ---------------------------------------------------------------------------
// Stage 1 — the desk.
// ---------------------------------------------------------------------------
const DESK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    teaser: { type: 'STRING' },
    lead: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        angle: { type: 'STRING' },
        brief_refs: { type: 'ARRAY', items: { type: 'STRING' } },
        target_sec: { type: 'INTEGER' },
      },
      required: ['title', 'angle', 'brief_refs', 'target_sec'],
    },
    segments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          beat: { type: 'STRING', enum: ['developing', 'hit', 'around', 'why', 'deep_dive', 'watch'] },
          title: { type: 'STRING' },
          angle: { type: 'STRING' },
          brief_refs: { type: 'ARRAY', items: { type: 'STRING' } },
          target_sec: { type: 'INTEGER' },
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                family: { type: 'STRING' },
                line_hint: { type: 'STRING' },
                brief_refs: { type: 'ARRAY', items: { type: 'STRING' } },
              },
              required: ['family', 'line_hint', 'brief_refs'],
            },
          },
        },
        required: ['beat', 'title', 'angle', 'brief_refs', 'target_sec'],
      },
    },
    ahead: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['title', 'teaser', 'lead', 'segments', 'ahead'],
};

function deskPrompt(fmt, { home, digest, dateLabel, yesterday }) {
  const plan = fmt.beats
    .filter((b) => !['cold_open', 'intro', 'lead', 'ahead', 'outro'].includes(b.beat))
    .map((b) => `${b.n} × "${b.beat}" at ${b.sec}s each`)
    .join(', ');
  return [
`You are the EDITORIAL DESK for Standard Topic's daily news podcast. Today is ${dateLabel}. You are building the rundown for the ${fmt.label} edition: about ${fmt.minutes} minutes, single host.`,
`You are given every topic briefing published this morning, in digest form, plus the cross-topic HOME briefing in full. Your job is EDITORIAL JUDGEMENT: decide what today's show is about, in what order, and how long each piece gets. You do not write the script — you hand the writer a storyboard.`,
``,
`RULES, in priority order:`,
`1. DE-DUPLICATE ACROSS FAMILIES. The same story appears in several topics (an AI chip export rule shows up under Technology, Business & Finance and World). Merge those into ONE segment and list every briefing slug it draws on in brief_refs. Never let one story occupy two segments.`,
`2. RANK BY CONSEQUENCE, NOT BY NOVELTY OR VOLUME. How many topics cover something is not how much it matters, and neither is how recently it broke. Weigh SCALE — lives at stake, money moved, borders and markets affected, how many people feel it — against how much today changed. An ONGOING crisis of great magnitude (a closed shipping lane, a war, a currency in freefall) outranks a fresh development of modest consequence, and belongs at the top of the show, not buried late. The test for the lead is: what would a well-informed reader most regret not knowing today? A story whose consequences cross fields outranks a bigger story confined to one.`,
`3. SPREAD THE SHOW. No two consecutive segments may come from the same family. Across the whole rundown, draw from as many different families as the format allows.`,
`4. ONLY WHAT IS IN THE BRIEFINGS. Every segment must be supported by the briefings supplied. You may not introduce a story, a number, or a name that is not in them. If a briefing is marked as not from today's wave, it is background only and may not carry a segment on its own.`,
`5. BUDGET THE CLOCK. Use the beat plan exactly: ${plan}. target_sec MUST equal the plan for every beat — do not lengthen the lead because the story is big. A lead that runs much past two minutes stops being a story and turns into a list of facts about a subject, which is the most common way a news show becomes boring. If the top story has more material than its slot holds, that is what the other slots are for: give its second thread a developing segment of its own, or put a detail in the tour, or leave it out.`,
`6. FILL THE TOUR. The "around" segment is a rapid run of one-line items and it has to carry its full time budget, so it needs MANY items: one for EVERY family that had a real story today and is not already covered in an earlier segment. There are 14 families, so aim for 8 to 12 items — five is far too few. Each item names its family, and its line_hint names the concrete development in plain words: the person, the number, the place, the outcome.`,
`7. THE "why" SEGMENT IS NOT ANOTHER STORY. It is the connective tissue: draw the thread BETWEEN two or more stories already in this rundown, or explain the mechanism underneath the lead so the listener understands why it will keep mattering. If you find yourself introducing a new event there, that event belongs in the lead or a developing slot instead, and something else should go here.`,
`8. EVERY SEGMENT TITLE MUST BE DISTINCT, and no story may appear in two segments.`,
`6. WRITE ANGLES, NOT SUMMARIES. Each segment's "angle" is a one-sentence instruction to the writer: what this piece is actually about and what the listener should take from it. Be specific — name the development.`,
yesterday ? `9. CONTINUITY. Yesterday's rundown led with: "${yesterday}". The same story may lead again ONLY if the briefings carry a development since then that the lead names in its first sentence ("what changed"); if nothing changed, it does not lead — the biggest NEW development does, and the standing story moves down as a shorter update.` : ``,
`10. LIVE QUANTITIES ARE STATES, NOT EVENTS. A price, an index, a death toll, a vote count is whatever the NEWEST briefing says it is now. Never describe a level as "approaching", "toward", "nearing" or "expected to reach" a threshold that any briefing shows as already crossed; say where it stands ("holding above one hundred dollars since last week"). Where briefings disagree, the newest wins.`,
``,
`ahead: two or three FORWARD-LOOKING lines, max 14 words each — the decision, meeting, vote, deadline, result or release that the stories in this rundown are heading toward next. This is the close of the show and it must NOT be a recap: the listener has just heard these stories, and repeating them back is the fastest way to waste the last thirty seconds. Draw each line from something the briefings actually state is scheduled or expected. If the material genuinely supports only one, give one.`,
`title: a specific episode title naming the lead story, max 9 words. teaser: one sentence describing the episode.`,
``,
`=== HOME BRIEFING (cross-topic, in full) ===`,
home ? `${home.summary ? `SUMMARY: ${home.summary}\n` : ''}${home.content}` : '(none available)',
``,
`=== TOPIC BRIEFINGS (digest: summary, takeaways, item headlines) ===`,
digest,
  ].filter(Boolean).join('\n');
}

// The desk will inflate the lead if allowed to — one run gave the top story 210
// seconds in a 12-minute show, which is 29% of the running time on a single
// subject. At that length a lead stops being a story and becomes a catalogue,
// and it drags however briskly it is read. The plan is the contract, so the
// budgets are clamped back to it here rather than trusted to the prompt.
function clampStoryboard(fmt, sb) {
  const want = {};
  for (const b of fmt.beats) want[b.beat] = b.sec;
  if (sb.lead && want.lead) sb.lead.target_sec = want.lead;
  for (const seg of (sb.segments || [])) {
    if (want[seg.beat]) seg.target_sec = want[seg.beat];
  }
  return sb;
}

// ---------------------------------------------------------------------------
// Stage 2 — the writer.
// ---------------------------------------------------------------------------
const SCRIPT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    segments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          beat: { type: 'STRING' },
          chapter: { type: 'STRING' },
          // Paragraphs, not one blob. Asking in prose for blank lines was
          // ignored every time; making it an array the model has to fill is
          // what actually produces breathing points in a long segment.
          paragraphs: { type: 'ARRAY', items: { type: 'STRING' } },
          // The same segment as a WRITTEN item, 2–4 sentences, for the text
          // briefing on the site. Spoken copy reads oddly on a page ("Before we
          // go…"); this is the version a reader gets, and because it comes out
          // of the same call as the spoken one it cannot cover different facts.
          written: { type: 'STRING' },
          brief_refs: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['beat', 'chapter', 'paragraphs', 'written'],
      },
    },
    // Three card entries ("Today in Focus"): a headline and a one-line
    // subline each, one per story segment in order of consequence.
    in_focus: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, line: { type: 'STRING' } }, required: ['title', 'line'] } },
    // The card's headline for the day and its one-to-two-sentence summary:
    // the day across its top stories, not the lead alone.
    headline: { type: 'STRING' },
    summary: { type: 'STRING' },
  },
  required: ['segments', 'in_focus', 'headline', 'summary'],
};

function writerPrompt(fmt, { storyboard, selected, dateLabel, edition = 'morning' }) {
  const isEve = edition === 'evening';
  const idLine = isEve ? `This is Standard Topic. Your evening briefing for ${dateLabel}.` : `This is Standard Topic. Your morning briefing for ${dateLabel}.`;
  // revamp1374: one edition a day, so the sign-off always points at the morning.
  const nextTime = 'tomorrow morning';
  const beats = [];
  beats.push(`- cold_open (${wordsFor(fmt.beats.find((b) => b.beat === 'cold_open').sec)} words): a HOOK, not a summary. One or two sentences that make a listener want to hear the lead — the sharpest image, number or stake in today's top story. It must NOT restate the lead's opening sentence, and must use different words and a different angle from it; the lead then explains what the hook raised. Start cold: no greeting, no "welcome", no date.`);
  beats.push(`- intro (10 words): the station identification, and NOTHING else: "${idLine}" Do not append the lead story, do not tease what is coming, do not add a clause — tacking the top story onto this line makes it sound like the story is the name of the show. It is one clean sentence, then the first story follows.`);
  beats.push(`- lead (${wordsFor(storyboard.lead.target_sec)} words): the top story, told as ONE STORY WITH AN ARC in three or four short paragraphs, separated by blank lines. Paragraph one: what happened and what it costs, in the plainest terms. Paragraph two: why it escalated to this. Paragraph three: who is trying to do something about it, and what happens next. NOT AN INVENTORY: the failure mode here is a run of loosely-related facts about the same subject, each with its own new country, company, official and number, which drags however briskly it is read. Hard limits — no more than about TWELVE named people, places or organizations in the whole segment, and no more than TWO consecutive sentences carrying statistics. Every figure must earn its place by changing what the listener thinks; if a number is merely true, cut it.`);
  for (const s of storyboard.segments) {
    const w = wordsFor(s.target_sec);
    if (s.beat === 'around') beats.push(`- around (${w} words total, and use them — this is a fast, dense sweep): ONE SHORT SENTENCE per item from the rundown, each under about 22 words. Short is the point: this segment is rapid fire, and a long winding sentence kills its pace. VARY THE OPENINGS — subject first ("Astronomers mapped…"), place first ("In Melbourne, the 49ers…"), number first ("Two thousand drones…"), person first ("Philippine President Marcos launched…"). Two bans, both absolute: never write "In X news", and never open more than ONE item in the whole segment with an -ing participle ("Dominating…", "Seeking to…", "Using…") — that construction sounds like a press release and stacking it is worse than the monotony it was meant to fix.`);
    else beats.push(`- ${s.beat} (${w} words): ${s.title}`);
  }
  beats.push(`- ahead (${wordsFor((fmt.beats.find((b) => b.beat === 'ahead') || { sec: 35 }).sec)} words): what to watch next. Open with a short line such as "Before we go, what to watch." then the specific things coming — a meeting, a vote, a deadline, a decision, a result — naming when. THIS IS NOT A RECAP: do not restate the stories, do not number them off, do not say "three things". The listener has just heard all of it; the only thing worth the last half minute is what happens next.`);
  beats.push(`- outro (25 words MAXIMUM): a sign-off that sounds like a person leaving a room, not a footer being read aloud. Exactly three short sentences: (1) close the edition — "That's the briefing for this ${isEve ? 'evening' : 'morning'}." (2) one plain sentence that the full written briefing with every source is at standard topic dot com — say the site once, casually, and NEVER say "show notes", "text version", "source links", or "written up", which is what made the old outro drag. (3) "Back ${nextTime}." or a natural variant of it. Nothing else: no thanks-for-listening, no have-a-great-day, no second mention of the site. NEVER claim this is our own reporting, an investigation, or an exclusive, and never call the outlets our partners, affiliates or contributors — we have no relationship with them. They are simply news organizations whose published articles the briefings were built from, and any other characterization is a false claim.`);

  const material = selected.map((b) => `### [${b.slug}] ${b.name}\n${b.summary ? `SUMMARY: ${b.summary}\n` : ''}${b.content}`).join('\n\n');

  return [
`You are the WRITER for Standard Topic's daily news podcast. Today is ${dateLabel}. Write the ${fmt.label} edition — about ${fmt.minutes} minutes, ONE host reading aloud.`,
`The desk has given you the rundown below. Write every segment it calls for, in order, following its angles and word budgets. Return one object per segment with its beat, a short chapter label, and the text to be spoken.`,
``,
`SEGMENTS TO WRITE, in this exact order:`,
beats.join('\n'),
``,
`WRITING FOR THE EAR — this is read aloud, never seen:`,
`- RHYTHM IS THE WHOLE CRAFT HERE. Vary sentence length on purpose: a short one to land a fact, then a longer one that carries a clause of context, then a short one again. NEVER write more than two consecutive sentences of similar length or the same subject-verb-object shape. If a paragraph reads back like a list of equal-length statements, it has failed — rewrite it.`,
`- One idea per sentence, but let a sentence breathe when the idea needs it. No parentheses, no semicolons, no em-dashes, no bullet syntax, no markdown, no headings, no stage directions, no speaker labels.`,
`- Write numbers and symbols the way they are said: "four point two billion dollars", "about thirty percent", "twenty twenty-six". Spell out an abbreviation the first time unless it is universally said as letters (US, AI, NATO, CEO).`,
`- Attribute naturally in the sentence: "according to the Financial Times", not a citation.`,
`- TRANSITIONS ARE PART OF THE WRITING, and they are what make the show flow. End each story segment with ONE sentence that carries the listener into the NEXT segment by connecting their actual substance — a shared consequence, a shared actor, a contrast, a change of scale. "Energy is not the only market under strain this morning" going into a technology story earns its place; "We move next to technology" does not.`,
`- BANNED as transitions, because they are announcements rather than writing: "We move next to", "We turn now to", "Now we return to", "Coming up next", "In other news", "Moving on", "Let's turn to". If your bridge would still work with the two stories swapped for any other two, it is not a bridge.`,
`- Say a person's role before their name the first time: "Treasury Secretary Scott Bessent", not "an official named Bessent". If the material does not give a role, use the name alone — never write "an official named X" or "a person called X", which sounds like you do not know who they are.`,
`- Never use a pronoun before the person is named.`,
`- LIVE QUANTITIES: a price, an index, a toll or a count is the figure the newest briefing gives, stated as a state ("above one hundred dollars"), never as a threshold still ahead if any briefing shows it crossed.`,
`- TIME WORDS ARE FACTS, NOT COLOUR. Write "today", "this morning", "overnight", "just", "now", "hours ago" ONLY where the briefing item itself places the event in that time; if the briefing gives no timing, give none — say what happened, not when. A story the briefing carries as context or as an older development must never be voiced as if it broke today.`,
``,
`ACCURACY — the hard rule:`,
`- Every fact, number, name and date must come from the briefings below. You may compress, reorder and connect, but you may NOT add. If a detail you want is not in the material, write around it.`,
`- Do not state or imply anything about events after what the briefings describe. Never predict, never speculate, never characterize the mood of a market or a public unless the material says so.`,
`- Do not invent quotes. If a quote is not in the material, paraphrase without quotation marks.`,
`- If the material genuinely does not support a segment the desk asked for, write it shorter and stick to what is supported. A short honest segment is correct.`,
``,
`LENGTH — hit the budget WITH FACTS:`,
`- The word budgets above are TARGETS AND CEILINGS BOTH. Come within ten percent, and never exceed a budget by more than ten percent — going long is not generosity, it is the single thing that makes a segment drag. Count as you write. The material below is deep: every segment has far more specifics available than you need, so the job is choosing, not including.`,
`- Fill a short segment by adding a CONCRETE detail from the material — a name, a figure, a date, a place, what someone actually said, what happens next. Never fill it with a generality.`,
`- BANNED as padding, because they carry no fact: "this raises questions", "this highlights concerns", "companies are struggling to respond", "this marks a major step", "it remains to be seen", "the situation continues to develop", and any sentence that only restates the sentence before it in other words. A sentence that would survive being deleted should be deleted.`,
`- Never say the same thing twice anywhere in the episode. The cold open, the lead and the three things all cover the top story, so each must add something the others did not.`,
``,
`brief_refs: for each segment, the slugs of the briefings you actually used, so the written briefing can link the underlying articles.`,
``,
`TWO OUTPUTS PER SEGMENT. "paragraphs" is the spoken script. "written" is the SAME segment as a written briefing item for the website: two to four plain sentences, third person, no "we", no "before we go", no hand-off sentence, no spoken transitions — a reader skimming a page, not a listener. Open it with the key development in the first sentence. Same facts as the spoken version, nothing added. For cold_open, "written" is a two-sentence OVERVIEW of the whole edition for a reader — what dominated and why today mattered — not the hook. For intro and outro, "written" is an empty string. For "around", "written" is one short sentence per item, each on its own line.`,
`headline: ONE line, max 12 words, that names the day across its top two or three stories together, never the lead story alone, and no colon-led label. TITLE CASE, Associated Press style: capitalize the first word, the last word, and every principal word — nouns, pronouns, verbs, adjectives, adverbs, and prepositions of four letters or more (Amid, With, From, Into, Over). Lower case only articles (a, an, the), coordinating conjunctions (and, but, or, nor, for, yet, so) and prepositions of three letters or fewer (at, by, in, of, on, to, up, as), unless one of those begins or ends the headline. Example: "Oil Surges Amid Middle East Tensions as Tech Stocks Wobble". summary: one or two sentences, max 40 words, saying what happened in the top three stories with their key figures, written for a reader.`,
`in_focus: exactly THREE entries, one per story segment in order of consequence (the lead first). Each has a "title" — the headline, max 8 words, naming a concrete development, not a theme — and a "line": a plain one-sentence subline of max 9 words that ADDS something (the consequence, the number, what happens next), never a restatement of the title.`,
``,
`=== THE RUNDOWN ===`,
JSON.stringify(storyboard, null, 1),
``,
`=== SOURCE MATERIAL: the briefings the desk selected, in full ===`,
material,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Budget enforcement. Asking for a word count in the prompt does not work: told
// three different ways that 338 words was a ceiling, the writer returned 422,
// then 460. A budget that is only a request is not a budget, so it is enforced
// here — each over-long segment is sent back on its own with one instruction,
// and the result is COUNTED before it is accepted.
//
// This matters more than it sounds. An over-long lead is the single thing that
// makes an episode feel like a drag: it is not read any slower, it simply keeps
// going, and it turns a story into an inventory of facts about a subject.
const OVER_TOLERANCE = 1.08;

function trimPrompt(seg, budget, material) {
  const have = String(seg.text || '').split(/\s+/).filter(Boolean).length;
  return [
`Below is one segment of a news podcast script. It runs ${have} words. It must run ${budget} words or fewer. Cut it.`,
``,
`HOW TO CUT — in this order:`,
`1. Remove whole facts, not words from every sentence. Cutting adjectives everywhere leaves the same sprawl, shorter; removing the third-most-important development leaves a story.`,
`2. Keep the arc: what happened and what it costs, why it escalated, who is acting and what happens next. If a sentence serves none of those, it goes first.`,
`3. Keep at most TWELVE named people, places and organizations in total. Every name a listener must hold costs them something, and this segment currently spends that budget on minor actors.`,
`4. Keep only figures that change what the listener thinks. A number that is merely true is the easiest cut in the script.`,
`5. Do not add anything. Do not restate. Do not write a summary of the segment — it must still read as the segment, just tighter.`,
``,
`Return it as two to four paragraphs. The last sentence must still hand off to whatever came after it, so keep that bridge intact.`,
``,
`=== SEGMENT (${seg.beat}) ===`,
seg.text,
material ? `\n=== SOURCE MATERIAL, for reference — do not add from it ===\n${material}` : '',
  ].filter(Boolean).join('\n');
}

const TRIM_SCHEMA = { type: 'OBJECT', properties: { paragraphs: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['paragraphs'] };

// Returns { script, trimmed: [{beat, from, to, budget}] }.
async function enforceBudgets(script, fmt, { model = textModel(), material = '', tries = 3 } = {}) {
  const budgets = {};
  for (const b of fmt.beats) budgets[b.beat] = wordsFor(b.sec);
  const trimmed = [];
  for (const seg of (script.segments || [])) {
    const budget = budgets[seg.beat];
    if (!budget) continue;
    const count = () => String(seg.text || '').split(/\s+/).filter(Boolean).length;
    const before = count();
    if (before <= budget * OVER_TOLERANCE) continue;
    let best = seg.text; let bestN = before;
    for (let i = 0; i < tries; i++) {
      let out;
      try {
        out = await generate(trimPrompt({ ...seg, text: best }, budget, material), {
          model, maxTokens: Math.max(3000, budget * 4) + 2048, thinkingBudget: 2048,
          temperature: 0.3, responseSchema: TRIM_SCHEMA,
        });
      } catch (_) { break; }
      let got;
      try { got = parseJSON(out, 'trim'); } catch (_) { break; }
      const text = (got.paragraphs || []).map((x) => String(x).trim()).filter(Boolean).join('\n\n');
      const n = text.split(/\s+/).filter(Boolean).length;
      if (!n) break;
      if (n < bestN) { best = text; bestN = n; }
      if (n <= budget * OVER_TOLERANCE) break;
    }
    if (bestN < before) { seg.text = best; trimmed.push({ beat: seg.beat, from: before, to: bestN, budget }); }
  }
  return { script, trimmed };
}

// ---------------------------------------------------------------------------
// Stage 3 — QA. Reads the script back against the same material.
// ---------------------------------------------------------------------------
function qaPrompt(fmt, { script, selected, dateLabel }) {
  const material = selected.map((b) => `### [${b.slug}] ${b.name}\n${b.content}`).join('\n\n');
  return [
`You are the QA EDITOR for Standard Topic's daily news podcast, ${dateLabel}. Below is a finished script and the source briefings it was written from. Return the SAME segments, corrected. Change only what these checks require, and keep every segment's beat and chapter unchanged.`,
``,
`1. CLAIM CHECK. Delete or soften any sentence whose facts you cannot find in the source material. A removed sentence must not leave a dangling reference. This is the most important check: an unsupported specific is the worst failure this show can have.`,
`1c. TIME CLAIMS. Every "today", "this morning", "overnight", "just", "now", "announced today", "launched today" must be supported by timing stated in the source material for that same event. Where it is not, delete the time word (keep the sentence) — and if the source material shows the event is older than today, cut the sentence.`,
`1b. CUT EMPTY SENTENCES. Delete any sentence that carries no fact — "this raises questions", "this highlights concerns", "a major step", "struggling to respond", "it remains to be seen" — and any sentence that only restates the one before it. Replace it with a concrete detail from the source material if the segment then falls short, otherwise let the segment be shorter.`,
`2. READ-ALOUD PASS. Rewrite anything that would trip a listener or a speech engine: digits, symbols, currency, percentages, dates, abbreviations, acronyms said as words, URLs. No markdown, no parentheses, no em-dashes, no semicolons, no ellipses. Sentences under about 25 words.`,
`3. TIMING. Each segment has a word budget. Trim any segment more than fifteen percent over it by cutting its least consequential sentence. Do NOT shorten a segment that is already at or under its budget — this pass should not reduce the episode's length.`,
`4. RHYTHM AND VARIETY. Sentences must not all run the same length or shape: where three or more in a row are similar, recast them so short and longer sentences alternate. In the tour segment every item must open differently and stay under about 22 words — rewrite any that share a construction, delete the phrase "In X news" wherever it appears, and if more than one item opens with an -ing participle ("Dominating", "Seeking", "Using"), recast all but one of them. No fact and no sentence may repeat anywhere in the episode; the cold open and the lead in particular must not say the same thing.`,
`5. LEAVE THE REST ALONE. Do not restructure, do not re-order, do not add new material.`,
``,
`Word budgets by beat: ${fmt.beats.map((b) => `${b.beat} ${wordsFor(b.sec)}`).join(', ')}.`,
`The closing "ahead" segment must stay FORWARD-LOOKING. If it has become a recap of the episode, cut it back to only the lines that name something still to happen.`,
``,
`=== SCRIPT ===`,
JSON.stringify(script, null, 1),
``,
`=== SOURCE MATERIAL ===`,
material,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Stage runners.
// ---------------------------------------------------------------------------
// gemini-2.5-pro is closed to keys created after mid-2026, so the defaults are
// the current generation: a Pro-class model for the editorial judgement (the
// desk and the writing), Flash for the mechanical QA pass. Override either with
// EPISODE_DESK_MODEL / EPISODE_MODEL.
function textModel() { return process.env.EPISODE_MODEL || 'gemini-3.8-flash'; }
function deskModel() { return process.env.EPISODE_DESK_MODEL || 'gemini-3.1-pro-preview'; }

// Segments arrive as paragraphs; everything downstream wants one string, with
// the blank lines kept because the voice holds a longer beat on them.
function normalizeScript(script) {
  for (const seg of (script.segments || [])) {
    if (Array.isArray(seg.paragraphs) && seg.paragraphs.length) {
      seg.text = seg.paragraphs.map((p) => String(p).trim()).filter(Boolean).join('\n\n');
    }
    seg.text = String(seg.text || '').trim();
  }
  return script;
}

function parseJSON(out, what) {
  const raw = String((out && out.text) || '').trim();
  if (!raw) throw new Error(`${what}: empty response`);
  const body = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(body); } catch (e) {
    const s = body.indexOf('{'); const t = body.lastIndexOf('}');
    if (s >= 0 && t > s) { try { return JSON.parse(body.slice(s, t + 1)); } catch (_) {} }
    throw new Error(`${what}: response was not JSON (${String(e.message).slice(0, 120)})`);
  }
}

async function runDesk(fmt, ctx, { model = deskModel(), thinking = 6144 } = {}) {
  const out = await generate(deskPrompt(fmt, ctx), {
    model, maxTokens: 9000 + thinking, thinkingBudget: thinking,
    temperature: 0.35, responseSchema: DESK_SCHEMA,
  });
  return { storyboard: clampStoryboard(fmt, parseJSON(out, 'desk')), usage: out };
}

async function runWriter(fmt, ctx, { model = deskModel(), thinking = 3072 } = {}) {
  // Thinking tokens are drawn from the SAME maxOutputTokens pool as the answer,
  // and a reasoning model will happily spend most of it before writing a word —
  // which truncates the JSON mid-string and loses the whole call. So the budget
  // is deliberately generous: it is a ceiling, not a spend, and an unused
  // ceiling costs nothing. ~3 tokens per word covers the prose plus its JSON.
  const budget = Math.max(9000, Math.round(fmt.minutes * WORDS_PER_MIN * 3));
  const out = await generate(writerPrompt(fmt, ctx), {
    model, maxTokens: budget + thinking, thinkingBudget: thinking,
    temperature: 0.6, responseSchema: SCRIPT_SCHEMA,
  });
  return { script: normalizeScript(parseJSON(out, 'writer')), usage: out };
}

async function runQA(fmt, ctx, { model = textModel(), thinking = 2048 } = {}) {
  const budget = Math.max(9000, Math.round(fmt.minutes * WORDS_PER_MIN * 3));
  const out = await generate(qaPrompt(fmt, ctx), {
    model, maxTokens: budget + thinking, thinkingBudget: thinking,
    temperature: 0.2, responseSchema: SCRIPT_SCHEMA,
  });
  return { script: normalizeScript(parseJSON(out, 'qa')), usage: out };
}

// revamp1402 — the FACT CHECK. Everything upstream writes from the briefings,
// and the briefings can carry a stale state ("toward $100" five days after it
// crossed). This is the one pass that reads the live web: a grounded call on
// the story segments only, told to verify every figure, threshold, status and
// time claim against the last 24 hours and to correct — not rewrite. It
// returns the same segments; mergeQA's floor keeps it from shrinking anything.
async function runFactCheck(fmt, { script, dateLabel, card: ctxCard }, { model = textModel(), thinking = 2048 } = {}) {
  const segs = (script && script.segments) || [];
  const STORY = new Set(['lead', 'developing', 'why', 'around', 'ahead', 'cold_open']);
  const card = ctxCard || {};
  const focus = Array.isArray(script && script.in_focus) ? script.in_focus : [];
  // ── 1. RESEARCH (grounded). Its only output is what it found, per story,
  //       so the model has no way to answer without searching. ──
  const stories = segs.map((s, i) => ({ i, s })).filter(({ s }) => STORY.has(s.beat) && String(s.text || '').trim());
  const brief = stories.map(({ i, s }) => `${i}. [${s.beat}${s.chapter ? ` — ${s.chapter}` : ''}] ${String(s.text || '').replace(/\s+/g, ' ').slice(0, 420)}`).join('\n');
  const researchPrompt = [
    `Today is ${dateLabel}. You are researching a news script before broadcast. For EACH numbered story below, run a Google Search for its CURRENT state (use the story's own subject plus today's date) and report what the newest reporting says. Do not rely on memory: every line you write must come from a search result you ran now.`,
    ``,
    `Report, per story, as plain lines:`,
    `- the current figure for every price, index, count or amount the story mentions, with the date of the reporting and the source name; if a level has already crossed a threshold the story treats as ahead, say when it crossed;`,
    `- whether anything the story presents as expected, planned or pending has already happened, been reversed or been cancelled;`,
    `- whether any event the story places "today" happened on a different date, and which;`,
    `- any name, role or place the newest reporting contradicts.`,
    `Write "confirmed" for a story where the newest reporting agrees with it. Be terse and specific; this is a dossier, not prose.`,
    ``,
    brief,
  ].join('\n');
  const research = await generate(researchPrompt, { model, grounded: true, maxTokens: 3600 + thinking, thinkingBudget: thinking, temperature: 0.1 });
  const dossier = String(research.text || '').trim();
  // ── 2. CORRECTION (ungrounded): the dossier is the source of truth; the
  //       fewest words change, in every field the site and the voice use. ──
  const body = segs.map((s, i) => `### segment ${i} (${s.beat}${s.chapter ? ` — ${s.chapter}` : ''})\nSPOKEN: ${String(s.text || '')}\nWRITTEN: ${String(s.written || '')}`).join('\n\n');
  const cardText = [card.headline ? `HEADLINE: ${card.headline}` : '', card.teaser ? `TEASER: ${card.teaser}` : '', focus.length ? `IN FOCUS: ${focus.map((f) => `${f.title || ''}${f.line ? ` — ${f.line}` : ''}`).join(' || ')}` : ''].filter(Boolean).join('\n');
  const fixPrompt = [
    `You are the FACT CHECKER for Standard Topic's daily news podcast, ${dateLabel}. Below is a research dossier gathered from live search moments ago, then the script. Correct the script against the dossier and return it.`,
    ``,
    `RULES: the dossier is the source of truth where it speaks; where it says "confirmed" or is silent, the text stays verbatim. Change the fewest words that make a sentence true. A level the dossier shows as already crossed is stated as its current state ("above one hundred dollars a barrel since last week"), never as a threshold ahead. Do not add stories, do not reorder, do not drop a sentence unless it is false and unfixable, keep each segment within ten percent of its length. SPOKEN keeps the spoken style (numbers said aloud); WRITTEN and the card use numerals.`,
    ``,
    `OUTPUT: JSON only: {"segments":[{"index":0,"spoken":"…","written":"…"}, …], "card":{"headline":"…","teaser":"…","in_focus":["title — line", …]}} — every segment in order with both fields (unchanged ones verbatim); "card" only if a card block was given, each line corrected the same way.`,
    ``,
    `=== DOSSIER ===`, dossier, ``, `=== SCRIPT ===`, body, cardText ? `\n### card\n${cardText}` : '',
  ].join('\n');
  const budget = Math.max(9000, Math.round(fmt.minutes * WORDS_PER_MIN * 3.6));
  const out = await generate(fixPrompt, { model, maxTokens: budget + thinking, thinkingBudget: thinking, temperature: 0.2 });
  const parsed = parseJSON(out, 'factcheck');
  const byIndex = new Map((parsed.segments || []).map((x) => [Number(x.index), x]));
  const changes = [];
  const segments = segs.map((s, i) => {
    const fx = byIndex.get(i); if (!fx) return { ...s };
    const spoken = String(fx.spoken || '').trim(); const written = String(fx.written || '').trim();
    const n = { ...s };
    if (spoken && spoken !== String(s.text || '').trim()) { n.text = spoken; n.paragraphs = spoken.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean); changes.push(`${s.beat}${s.chapter ? ` (${s.chapter})` : ''}`); }
    if (written && written !== String(s.written || '').trim()) { n.written = written; if (!changes.includes(`${s.beat}${s.chapter ? ` (${s.chapter})` : ''}`)) changes.push(`${s.beat} written`); }
    return n;
  });
  const checked = { ...script, segments };
  let cardOut = null;
  if (parsed.card && typeof parsed.card === 'object') {
    cardOut = { headline: parsed.card.headline ? String(parsed.card.headline).trim() : null, teaser: parsed.card.teaser ? String(parsed.card.teaser).trim() : null };
    if (Array.isArray(parsed.card.in_focus) && parsed.card.in_focus.length === focus.length) {
      checked.in_focus = parsed.card.in_focus.map((l, k) => { const m = String(l).match(/^(.*?)\s+—\s+([\s\S]*)$/); return m ? { title: m[1].trim(), line: m[2].trim() } : { ...focus[k], title: String(l).trim() }; });
      if (JSON.stringify(checked.in_focus) !== JSON.stringify(focus)) changes.push('in focus');
    }
    if (cardOut.headline && cardOut.headline !== card.headline) changes.push('headline');
    if (cardOut.teaser && cardOut.teaser !== card.teaser) changes.push('teaser');
  }
  const usage = { micros: (research.micros || 0) + (out.micros || 0), searches: research.searches || 0 };
  return { script: checked, usage, changes, card: cardOut, dossier };
}

// QA is a LIGHT touch by contract: it removes unsupported claims and empty
// sentences and fixes rhythm. It is not allowed to rewrite the episode shorter.
// Left unguarded it will — one pass cut a 1,902-word script to 1,160 and took
// four minutes off the running time, which is a different show, not a corrected
// one. So the merge is per segment: a QA segment is accepted only if it kept
// most of the writer's substance, and any segment it gutted (or dropped) falls
// back to what the writer wrote. Genuine cuts are small; wholesale ones are a
// failure of the pass, and this is where that is caught.
const QA_FLOOR = 0.82;
function words(t) { return String(t || '').split(/\s+/).filter(Boolean).length; }
// `budgets` maps beat -> words it is allowed. Without it the flat floor also
// blocked the one cut that should always be allowed: trimming a segment the
// writer overwrote back down to its budget. A 422-word lead against a 338-word
// budget is 80% — just under the floor — so the guard was protecting the
// overrun it was supposed to catch.
function mergeQA(writerScript, qaScript, budgets = null) {
  const w = (writerScript && writerScript.segments) || [];
  const q = (qaScript && qaScript.segments) || [];
  const byBeat = new Map();
  q.forEach((seg, i) => { byBeat.set(`${seg.beat}#${i}`, seg); });
  const segments = []; let restored = 0; let accepted = 0;
  w.forEach((ws, i) => {
    const qs = q[i] && q[i].beat === ws.beat ? q[i] : q.find((x, j) => x.beat === ws.beat && !segments.includes(x) && j >= i);
    if (!qs || !String(qs.text || '').trim()) { segments.push(ws); restored++; return; }
    const budget = budgets && budgets[ws.beat];
    const floor = budget ? Math.min(QA_FLOOR * words(ws.text), budget * 0.9) : QA_FLOOR * words(ws.text);
    if (words(qs.text) < floor) { segments.push(ws); restored++; return; }
    // QA corrects the spoken text; the written item and the refs come from the
    // writer unless QA supplied its own.
    segments.push({ ...ws, text: qs.text, chapter: qs.chapter || ws.chapter, written: qs.written || ws.written || '' });
    accepted++;
  });
  // Top-level fields (in_focus) ride along from the writer — the merge is about
  // segments, and dropping them here is how the briefing card lost its three
  // lines on the first aligned run.
  const { segments: _w, ...rest } = writerScript || {};
  return { script: { ...rest, ...(qaScript && qaScript.in_focus ? { in_focus: qaScript.in_focus } : {}), segments }, accepted, restored };
}

// ---------------------------------------------------------------------------
// Voice. Gemini TTS returns raw 16-bit PCM, which is the best possible thing to
// receive: PCM concatenates perfectly (no frame boundaries to align, unlike
// MP3), so segments join seamlessly and one encode at the end produces the file.
//
// The TTS model id has moved around during preview, so the first call probes a
// short list and the winner is reused for the rest of the episode.
// ---------------------------------------------------------------------------
const TTS_CANDIDATES = [
  process.env.EPISODE_TTS_MODEL,
  'gemini-2.5-flash-preview-tts',
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-pro-preview-tts',
].filter(Boolean);
let _ttsModel = null;

// The same direction, word for word, on every call. Each request is an
// independent performance, so anything left to the model's discretion drifts
// between segments and the show sounds like a relay of different presenters.
// Naming the tempo in words a minute, the register, and the energy pins down
// what would otherwise wander.
const VOICE_STYLE = 'You are the single regular host of a daily news podcast, reading the script below aloud. '
  + 'Keep this exact delivery for the whole passage and never drift: steady broadcast pace of about one hundred '
  + 'and fifty words a minute, neither hurried nor laboured; even, level tone in a lower register; calm, '
  + 'authoritative and warm, never breathless, never dramatic, never chirpy. Give names, places and numbers a '
  + 'little weight. Take a short beat at each full stop and a slightly longer one at a paragraph. Do not '
  + 'announce yourself, do not greet the listener, do not add or omit a single word, and do not read any of '
  + 'these instructions aloud. Speak only the script that follows.';

async function ttsOnce(model, text, { voice, key, style = VOICE_STYLE }) {
  const url = `${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${style}\n\n${text}` }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`TTS ${res.status} ${detail.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const inline = parts.map((p) => p.inlineData).find((d) => d && d.data);
  if (!inline) throw new Error('TTS: response carried no audio');
  const rate = Number((String(inline.mimeType || '').match(/rate=(\d+)/) || [])[1]) || 24000;
  return { pcm: Buffer.from(inline.data, 'base64'), rate };
}

async function speak(text, { voice = process.env.EPISODE_VOICE || 'Gacrux', key = process.env.GEMINI_API_KEY, attempts = 3 } = {}) {
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const models = _ttsModel ? [_ttsModel] : TTS_CANDIDATES;
  let lastErr = null;
  for (const model of models) {
    for (let a = 0; a < attempts; a++) {
      try {
        const r = await ttsOnce(model, text, { voice, key });
        _ttsModel = model;
        return r;
      } catch (err) {
        lastErr = err;
        // 404 = wrong model id, move on to the next candidate immediately.
        if (err.status === 404 || err.status === 400) break;
        if (a === attempts - 1) break;
        await new Promise((r) => setTimeout(r, 700 * Math.pow(2, a) * (0.6 + Math.random())));
      }
    }
  }
  throw lastErr || new Error('TTS failed');
}

// ── Stutter QC ─────────────────────────────────────────────────────────────
// Gemini TTS occasionally repeats a phrase it has already spoken — a real run
// said "five thousand barrels per day in August in August" from a script that
// said it once. Nothing in the text predicts it, so the only way to catch it is
// to LISTEN: transcribe what came back and look for a phrase repeated
// immediately. A stutter is always an instant repeat, which is exactly what a
// legitimately repeated phrase is not, so the test is precise enough to act on.
const MP3_FOR_ASR = ['-b:a', '32k', '-ac', '1', '-f', 'mp3'];
function pcmToMp3(pcm, rate) {
  return execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0', ...MP3_FOR_ASR, 'pipe:1'],
    { input: pcm, maxBuffer: 256 * 1024 * 1024 });
}
async function transcribe(pcm, rate, { key = process.env.GEMINI_API_KEY, model = process.env.EPISODE_ASR_MODEL || 'gemini-3.8-flash' } = {}) {
  const mp3 = pcmToMp3(pcm, rate).toString('base64');
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: 'Transcribe this audio VERBATIM, exactly as spoken, preserving any stutters or repeated words or repeated phrases. Do not clean it up, do not summarize. Output only the transcript.' },
        { inlineData: { mimeType: 'audio/mp3', data: mp3 } }] }],
      generationConfig: { maxOutputTokens: 8000, temperature: 0 },
    }),
  });
  if (!res.ok) throw new Error(`ASR ${res.status}`);
  const d = await res.json();
  const parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
  return parts.map((x) => x.text || '').join('');
}
function normWords(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}
// An immediately-repeated run of 2+ words. Returns the offending phrase or null.
function findStutter(text) {
  const w = normWords(text);
  for (let n = 6; n >= 2; n--) {
    for (let i = 0; i + 2 * n <= w.length; i++) {
      const a = w.slice(i, i + n).join(' ');
      const b = w.slice(i + n, i + 2 * n).join(' ');
      if (a === b && a.length > 3) return a;
    }
  }
  return null;
}
// Speak, listen back, and re-speak anything that stuttered. Retries are cheap
// next to shipping a glitch, and each retry is a fresh sample from the model.
async function speakChecked(text, { voice, check = true, tries = 3, onNote = null } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const r = await speak(text, { voice });
    if (!check) return r;
    let heard = '';
    try { heard = await transcribe(r.pcm, r.rate); } catch (_) { return r; }  // ASR down → ship it
    const bad = findStutter(heard);
    if (!bad) return r;
    last = r;
    if (onNote) onNote(`stutter "${bad}" — respeaking (${i + 1}/${tries - 1})`);
  }
  return last;
}

// Split a long segment for the voice without splitting a sentence. Chapters are
// per SEGMENT, so these chunks are purely a request-size concern and rejoin
// invisibly in the PCM.
function speechChunks(text, max = 3800) {
  // Paragraph breaks survive into the request: they are the one piece of
  // punctuation the voice reliably holds a longer beat on, and they are how a
  // long segment gets its breathing points without being cut into separate
  // calls (which would make it separate performances).
  const sentences = String(text).replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n\n').trim().match(/[^.!?]+[.!?]+(?:["')\]]+)?\s*|[^.!?]+$/g) || [];
  const out = []; let cur = '';
  for (const s of sentences) {
    if (cur && (cur + s).length > max) { out.push(cur.trim()); cur = ''; }
    // A single "sentence" longer than the cap (no terminal punctuation in a long
    // run) would otherwise sail past it; break that one on spaces.
    if (s.length > max) {
      let rest = s;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(' ', max);
        if (cut < max * 0.5) cut = max;
        out.push((cur + rest.slice(0, cut)).trim()); cur = '';
        rest = rest.slice(cut);
      }
      cur = rest;
      continue;
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [String(text).trim()];
}

function silence(rate, ms) { return Buffer.alloc(Math.round(rate * (ms / 1000)) * 2); }

// Chapter labels a podcast app will show. The structural beats get fixed names
// so the list reads like a rundown; only the story segments carry the writer's
// own label. Duplicates are what produced two chapters both called "Anthropic
// Halts Campaigns" — the cold open and the lead are the SAME story by design, so
// the fix is to name them by their role, not by their subject.
const FIXED_CHAPTER = {
  cold_open: 'Cold open', intro: 'Introduction', around: 'Around the topics',
  why: 'Why it matters', ahead: 'What to watch next', outro: 'Outro',
};
function chapterLabels(segments) {
  const seen = new Map();
  return segments.map((seg, i) => {
    let label = FIXED_CHAPTER[seg.beat] || String(seg.chapter || '').trim() || BEAT_LABELS[seg.beat] || `Segment ${i + 1}`;
    const k = label.toLowerCase();
    if (seen.has(k)) label = `${label} (cont.)`;
    seen.set(k, true);
    return label;
  });
}

// How long to hold between segments. A uniform gap everywhere is what makes a
// generated show feel mechanical: real radio breathes differently after a cold
// open than between two items in a rapid-fire tour. The value is the pause
// AFTER a segment of that beat.
const GAP_AFTER = {
  // The open is ONE movement: hook, station identification, first story. The
  // beats between them are short on purpose — a long silence after the hook
  // makes the show sound like it started twice.
  cold_open: 260, intro: 300, lead: 640, developing: 560, hit: 380,
  deep_dive: 640, why: 600, around: 620, ahead: 620, outro: 0,
};
// Which stinger introduces which beat. The tour gets the rising figure, the
// takeaways the falling one, "why it matters" the held note, and every ordinary
// story-to-story turn gets the workhorse — so the music tells you where you are
// in the show without anyone saying so.
const STINGER_FOR = {
  around: 'tour', ahead: 'takeaway', why: 'why',
  lead: 'turn', developing: 'turn', deep_dive: 'turn', hit: 'turn', intro: null, outro: null,
};
// A pause between the one-line items inside the tour, so nine facts in a row
// land as nine items and not one paragraph.
const TOUR_ITEM_GAP = 260;
function splitSentences(text) {
  return (String(text).replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+(?:["')\]]+)?\s*|[^.!?]+$/g) || []).map((s) => s.trim()).filter(Boolean);
}

// Voice every segment, in order, with a small amount of concurrency. Returns the
// PCM pieces plus the chapter table, whose offsets fall out of the byte lengths.
async function voiceScript(segments, { voice, concurrency = 3, onProgress = null, music = true, check = true, tempo = true, onNote = null } = {}) {
  const jobs = [];
  segments.forEach((seg, i) => {
    // ONE call per segment wherever the text fits in one. Every separate call is
    // a separate performance — the model re-decides its pace and delivery each
    // time — so splitting the tour into nine calls produced nine readers. The
    // only splits left are the ones a request-size cap forces.
    speechChunks(seg.text, 4600).forEach((chunk, j) => jobs.push({ seg: i, chunk: j, text: chunk }));
  });
  const results = new Array(jobs.length);
  let next = 0; let done = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      results[i] = await speakChecked(jobs[i].text, { voice, check, onNote });
      done++;
      if (onProgress) onProgress(done, jobs.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

  const rate = (results.find(Boolean) || {}).rate || 24000;
  const pieces = []; const chapters = [];
  const labels = chapterLabels(segments);
  let bytes = 0;
  const at = () => Math.round((bytes / 2 / rate) * 1000);
  const push = (b) => { pieces.push(b); bytes += b.length; };

  // The sounder runs before a word is spoken, then keeps playing underneath the
  // cold open. So the open is voiced first, the bed is laid over its front, and
  // the combined thing becomes the episode's first piece.
  let bedLead = 0;
  segments.forEach((seg, i) => {
    chapters.push({ label: labels[i], beat: seg.beat, start_ms: at() });
    const mine = jobs.map((j, k) => ({ j, k })).filter(({ j }) => j.seg === i);
    // Every segment goes through the same two corrections, ALWAYS, including the
    // cold open and the sign-off. Applying them to some segments and not others
    // is precisely what made the show sound like a handover between presenters.
    {
      const wc = String(seg.text || '').split(/\s+/).filter(Boolean).length;
      let joined = Buffer.concat(mine.map(({ k }) => results[k].pcm));
      if (tempo) {
        // revamp1374: the long gaps go first, then the rate is set.
        const c = A.compressPauses(joined, rate);
        joined = c.pcm;
        if (onNote && c.cut) onNote(`${seg.beat}: ${c.cut} pauses trimmed, −${(c.removedMs / 1000).toFixed(1)}s`);
        const r = A.normalizeTempo(joined, rate, wc);
        joined = r.pcm;
        if (onNote && r.from) onNote(`${seg.beat}: ${r.from} → ${r.to} wpm`);
      }
      const l = A.normalizeLoudness(joined);
      joined = l.pcm;
      if (onNote && Math.abs(l.gainDb) > 1.5) onNote(`${seg.beat}: level ${l.gainDb > 0 ? '+' : ''}${l.gainDb} dB`);
      results[mine[0].k] = { ...results[mine[0].k], pcm: joined };
      for (let z = 1; z < mine.length; z++) results[mine[z].k] = { ...results[mine[z].k], pcm: Buffer.alloc(0) };
    }
    mine.forEach(({ j, k }, n) => {
      let chunk = results[k].pcm;
      if (!chunk.length) return;
      if (music && i === 0 && n === 0) {
        const bed = A.newsBed({ rate });
        bedLead = Math.round(bed.leadSeconds * rate) * 2;
        chunk = A.mixUnder(chunk, bed.pcm, 0);
        // Hold the front of the bed before the first word.
        push(A.floatToInt16(bed.pcm.slice(0, Math.round(bed.leadSeconds * rate))));
        chapters[0].start_ms = 0;
      }
      // A stinger belongs to the segment it introduces, and its tail plays
      // UNDER that segment's first words. So the music is laid over the front of
      // this chunk and only its head is pushed as standalone audio — which is
      // what makes the join a crossfade instead of a cut.
      if (music && i > 0 && n === 0) {
        const kind = STINGER_FOR[seg.beat];
        if (kind === null || kind === undefined) { push(chunk); return; }
        const st = A.stinger(kind, { rate });
        const headN = Math.round(st.head * rate);
        push(A.floatToInt16(st.pcm.slice(0, headN)));
        chunk = A.mixUnder(chunk, st.pcm.slice(headN), 0);
      }
      push(chunk);
    });
    if (i < segments.length - 1) {
      // The pause before the NEXT segment's stinger. Short, because the stinger
      // itself now carries the transition; a long silence in front of it reads
      // as a mistake.
      const gap = GAP_AFTER[seg.beat] != null ? GAP_AFTER[seg.beat] : 520;
      push(silence(rate, music ? Math.round(gap * 0.55) : gap));
    }
  });
  let pcm = Buffer.concat(pieces);
  if (music) {
    // The bed swells back under the sign-off.
    const out = A.outroBed({ rate });
    const start = Math.max(0, pcm.length / 2 - out.length - Math.round(0.4 * rate));
    pcm = A.mixUnder(pcm, out, Math.round(start));
  }
  return { pcm, rate, chapters, durationMs: Math.round((pcm.length / 2 / rate) * 1000), bedLead };
}

// ---------------------------------------------------------------------------
// Show notes. Every segment carries the briefing slugs it used; those briefings
// carry the real article links the model was given, so the notes cite articles,
// never the AI.
// ---------------------------------------------------------------------------
function showNotes(script, briefs, { title, teaser, chapters, dateLabel }) {
  const bySlug = new Map(briefs.map((b) => [b.slug, b]));
  const fmtTime = (ms) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const lines = [`# ${title}`, '', `*Standard Topic — ${dateLabel}*`, '', teaser, '', '## Chapters', ''];
  chapters.forEach((c) => lines.push(`- ${fmtTime(c.start_ms)} — ${c.label}`));
  lines.push('', '## Sources', '');
  const seen = new Set();
  for (const seg of script.segments) {
    const refs = (seg.brief_refs || []).map((s) => bySlug.get(s)).filter(Boolean);
    const links = [];
    for (const b of refs) {
      for (const s of (b.sources || []).slice(0, 6)) {
        const uri = s && (s.uri || s.url);
        if (!uri || seen.has(uri)) continue;
        seen.add(uri);
        links.push(`  - [${(s.title || uri).replace(/[[\]]/g, '')}](${uri})${s.source ? ` — ${s.source}` : ''}`);
      }
    }
    if (!links.length) continue;
    lines.push(`- **${seg.chapter}** (${refs.map((b) => b.name).join(', ')})`);
    lines.push(...links);
  }
  lines.push('', '---', '', 'Written and voiced by AI from briefings built on the articles linked above. Standard Topic.');
  return lines.join('\n');
}

// The written briefing, in exactly the shape the site already stores and
// renders for a daily:b row (SUMMARY line, ## Overview, ## 3 Things to Know,
// ## Briefings with bold-led items). Rendering it FROM the episode is what
// aligns text and audio: same stories, same order, and item N is chapter N,
// so "play from here" on the page is a lookup, not a guess.
function renderBriefingText(script, storyboard, { chapters = [] } = {}) {
  const segs = script.segments || [];
  const story = (s) => ['lead', 'developing', 'deep_dive', 'hit', 'why', 'ahead'].includes(s.beat);
  const lines = [];
  lines.push(`SUMMARY: ${String(script.summary || storyboard.teaser || '').trim()}`);
  lines.push('', '## Overview');
  const open = segs.find((s) => s.beat === 'cold_open');
  const why = segs.find((s) => s.beat === 'why');
  const overview = [open && open.written, why && why.written].filter(Boolean).join(' ').trim()
    || String(open && open.text || '').replace(/\s+/g, ' ').trim();
  lines.push(overview);
  lines.push('', '## 3 Things to Know');
  // The writer's three lines when it gave them; otherwise the chapter titles of
  // the first three story segments — the desk's own ranking, already concrete
  // and short. The card must never show an empty In Focus.
  // Each line is "**Title.** subline" — the same bold-lead shape as a briefing
  // item, so the site's one parser reads both; a plain "- text" line (the
  // topic briefings) still works, it just has no subline.
  let focus = normalizeFocus(script.in_focus).slice(0, 3);
  if (focus.length < 3) {
    const fromTitles = segs.filter((x) => ['lead', 'developing', 'deep_dive', 'hit'].includes(x.beat)).map((x) => String(x.chapter || '').trim()).filter(Boolean);
    for (const t of fromTitles) { if (focus.length >= 3) break; if (!focus.some((f) => f.title === t)) focus.push({ title: t, line: '' }); }
  }
  for (const f of focus) lines.push(f.line ? `- **${f.title.replace(/[.\s]+$/, '')}.** ${f.line}` : `- ${f.title}`);
  lines.push('', '## Briefings');
  const chapterAt = (i) => (chapters[i] && Number.isFinite(chapters[i].start_ms)) ? chapters[i].start_ms : null;
  segs.forEach((s, i) => {
    const stamp = chapterAt(i) != null ? ` [T${chapterAt(i)}]` : '';
    if (s.beat === 'around') {
      const items = String(s.written || s.text || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
      if (items.length) lines.push(`**Around the topics.** ${items.join(' ')}${stamp}`, '');
      return;
    }
    if (!story(s) || s.beat === 'why') return;
    const body = String(s.written || '').trim() || String(s.text || '').replace(/\s+/g, ' ').trim();
    if (!body) return;
    const head = String(s.chapter || BEAT_LABELS[s.beat] || '').trim();
    lines.push(`**${head}.** ${body}${stamp}`, '');
  });
  return lines.join('\n').trim();
}

// in_focus arrives as objects from the current writer, or as plain strings
// from earlier runs; both become {title, line}.
function normalizeFocus(arr) {
  return (Array.isArray(arr) ? arr : []).map((x) => {
    if (x && typeof x === 'object') return { title: String(x.title || '').trim(), line: String(x.line || '').trim() };
    return { title: String(x || '').trim(), line: '' };
  }).filter((f) => f.title);
}

// The card's three entries, written from a finished script. Used when the
// writer's own in_focus is missing or has no sublines (a script from before
// the sublines existed), so the card is never title-only for want of a
// five-cent call.
const FOCUS_SCHEMA = { type: 'OBJECT', properties: { in_focus: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, line: { type: 'STRING' } }, required: ['title', 'line'] } } }, required: ['in_focus'] };
async function runFocusLines(script, { model = textModel() } = {}) {
  const stories = (script.segments || []).filter((s) => ['lead', 'developing', 'deep_dive', 'hit'].includes(s.beat)).slice(0, 3);
  if (!stories.length) return [];
  const prompt = [
    'Below are the top stories of a daily news briefing, in order of consequence. Write the card that previews them: exactly one entry per story, in the same order.',
    'Each entry has a "title" — the headline, max 8 words, naming the concrete development — and a "line": one plain sentence of max 9 words that ADDS something the title does not say (the consequence, the number, what happens next). Never restate the title. No markdown.',
    '',
    ...stories.map((s, i) => `=== STORY ${i + 1}: ${s.chapter || ''} ===\n${String(s.written || s.text || '').trim()}`),
  ].join('\n');
  const out = await generate(prompt, { model, maxTokens: 1200 + 1024, thinkingBudget: 1024, temperature: 0.3, responseSchema: FOCUS_SCHEMA });
  const got = parseJSON(out, 'focus');
  return normalizeFocus(got.in_focus).slice(0, 3);
}

// Headline + summary for a finished script that lacks them (one from before
// they existed). Same shape as runFocusLines: one small call, counted.
const HEADLINE_SCHEMA = { type: 'OBJECT', properties: { headline: { type: 'STRING' }, summary: { type: 'STRING' } }, required: ['headline', 'summary'] };
async function runHeadline(script, { model = textModel() } = {}) {
  const stories = (script.segments || []).filter((s) => ['lead', 'developing', 'deep_dive', 'hit'].includes(s.beat)).slice(0, 3);
  if (!stories.length) return null;
  const prompt = [
    'Below are the top stories of a daily news briefing, in order of consequence. Write the card that previews the whole day.',
    '"headline": ONE line, max 12 words, naming the day across its top two or three stories together — never the lead alone, no colon-led label, no markdown.',
    'TITLE CASE, Associated Press style: capitalize the first word, the last word, and every principal word — nouns, pronouns, verbs, adjectives, adverbs, and prepositions of four letters or more (Amid, With, From, Into, Over). Lower case only articles (a, an, the), coordinating conjunctions (and, but, or, nor, for, yet, so) and prepositions of three letters or fewer (at, by, in, of, on, to, up, as), unless one of those begins or ends the headline. Example: "Oil Surges Amid Middle East Tensions as Tech Stocks Wobble".',
    '"summary": one or two sentences, max 40 words, saying what happened in the top three stories with their key figures, for a reader.',
    '',
    ...stories.map((s, i) => `=== STORY ${i + 1}: ${s.chapter || ''} ===\n${String(s.written || s.text || '').trim()}`),
  ].join('\n');
  const out = await generate(prompt, { model, maxTokens: 800 + 1024, thinkingBudget: 1024, temperature: 0.4, responseSchema: HEADLINE_SCHEMA });
  const got = parseJSON(out, 'headline');
  return { headline: String(got.headline || '').trim(), summary: String(got.summary || '').trim() };
}

function scriptToText(script, { title, dateLabel }) {
  const out = [`${title}`, `Standard Topic — ${dateLabel}`, ''];
  for (const seg of script.segments) {
    const words = String(seg.text || '').split(/\s+/).filter(Boolean).length;
    out.push(`## ${seg.chapter}  [${seg.beat} · ${words} words · ~${Math.round(words / WORDS_PER_MIN * 60)}s]`);
    out.push(seg.text.trim(), '');
  }
  return out.join('\n');
}

// revamp1386 — time words, enforced in code. The tour is a run of one-line
// items about the day's briefings, so "today" adds nothing and was being
// added to everything; it is stripped there outright. In every other beat a
// time word survives only if a briefing the segment draws on uses the same
// word — the writer may echo a source's timing, never supply its own.
const TIME_WORDS = ['this morning', 'this afternoon', 'this evening', 'earlier today', 'later today', 'today', 'tonight', 'overnight', 'last night', 'yesterday', 'hours ago', 'moments ago', 'just now'];
function enforceTimeWords(script, briefs, storyboard) {
  const segs = (script && script.segments) || [];
  const byRef = new Map((briefs || []).map((b) => [String(b.slug || '').toLowerCase(), String(b.content || '') + ' ' + String(b.summary || '')]));
  const allText = [...byRef.values()].join(' ').toLowerCase();
  const notes = [];
  const scrub = (text, allow) => {
    let out = String(text || '');
    for (const w of TIME_WORDS) {
      if (allow.has(w)) continue;
      const re = new RegExp(`(?:,\\s*)?\\b${w.replace(/ /g, '\\s+')}\\b(?:,)?`, 'gi');
      out = out.replace(re, (m) => { notes.push(w); return (m.startsWith(',') && m.endsWith(',')) ? ',' : ''; });
    }
    if (!allow.has('just')) out = out.replace(/\bjust\s+(?=[a-z]+ed\b)/gi, () => { notes.push('just'); return ''; });
    return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').replace(/^\s+|\s+$/g, '');
  };
  for (const seg of segs) {
    const refs = new Set([...(seg.brief_refs || [])].map((r) => String(r).toLowerCase()));
    let src = ''; refs.forEach((r) => { if (byRef.has(r)) src += ' ' + byRef.get(r); });
    if (!src.trim()) src = allText;
    src = src.toLowerCase();
    const allow = new Set();
    if (seg.beat !== 'around') { for (const w of TIME_WORDS) if (src.includes(w)) allow.add(w); if (/\bjust\s+[a-z]+ed\b/.test(src)) allow.add('just'); }
    if (seg.beat === 'outro' || seg.beat === 'cold_open' || seg.beat === 'intro') { allow.add('this morning'); allow.add('today'); }
    if (Array.isArray(seg.paragraphs)) seg.paragraphs = seg.paragraphs.map((p) => scrub(p, allow));
    if (seg.text) seg.text = scrub(seg.text, allow);
    if (seg.written) seg.written = scrub(seg.written, allow);
  }
  return { script, stripped: notes };
}

module.exports = {
  enforceTimeWords, runFactCheck,
  FORMATS, BEAT_LABELS, WORDS_PER_MIN, wordsFor,
  waveStart, editionDate, todayLabel, editionFor, editionLabel, EDITION_HOURS_ET,
  gatherBriefs, briefBones, digestFor, topicIndex,
  DESK_SCHEMA, SCRIPT_SCHEMA, deskPrompt, writerPrompt, qaPrompt,
  runDesk, runWriter, runQA, mergeQA, clampStoryboard, enforceBudgets, textModel, deskModel,
  speak, speakChecked, speechChunks, voiceScript, showNotes, scriptToText, renderBriefingText, chapterLabels, normalizeFocus, runFocusLines, runHeadline,
  transcribe, findStutter, splitSentences, GAP_AFTER,
};
