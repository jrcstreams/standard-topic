# The Flagship Daily Episode — cost, formats, and editorial pipeline

**Date:** 2026-09-11 · **Status:** assessment only, nothing built · Third scope in the audio series
(`audio-briefs-assessment.md` = read every brief aloud; `audio-family-podcasts-assessment.md` = 14 family
episodes + flagship). **This doc:** *one* flagship episode per day, curated by an AI editorial pass across
the homepage briefing and all 100 topic briefings, in a choice of lengths.

Prices from the vendors' official pages on 2026-09-11 (full survey and URLs in the first doc; Gemini text
prices from the 2026-09-08 sheet). Volumes from Neon and `data/topics.json`.

---

## 1. The short version

| Question | Answer |
|---|---|
| Episodes | **1 per day**, ready ≈ 7:15 am ET (the briefing wave finishes ≈ 6:50) |
| Inputs | homepage briefing + all 100 topic briefings from that morning's wave (≈ 445k chars); the editorial pass reads all of them, the writer reads only the ones it picked |
| Lengths on offer | **Quick hit ≈ 5 min · Standard ≈ 12 min · In-depth ≈ 25 min · Extended ≈ 40 min** (weekend / week-in-review) |
| Voice cost | **$0** on Google WaveNet, Neural2, Chirp 3 HD, Studio "News" voices and Azure Neural at Quick/Standard/In-depth (all inside monthly free tiers); $2–16/mo on OpenAI or Gemini TTS; **$22–120/mo on ElevenLabs** (a Creator plan covers it) |
| Script cost (3-stage editorial pipeline) | **$1–14/mo** depending on model and length; Gemini 2.5 Pro on every stage is ≈ $5–10 |
| Storage + compute | ≈ $0 (4–9 MB per episode, 1.5–3 GB per year) |
| **Total, recommended stack** | **≈ $12–17/mo** for a Standard or In-depth episode with a current-gen steerable voice and Gemini 2.5 Pro writing it |
| Budget stack | **≈ $2/mo** — Google Studio broadcast voice (free tier) + Gemini 2.5 Flash |
| Premium stack | **≈ $50–130/mo** — ElevenLabs v3 (two-host dialogue) + Gemini 2.5 Pro |
| Where the money should go | Not the voice: the **editorial desk** (rank, de-dupe, storyboard), a **QA pass**, and optionally a **human approve** step in the admin panel before it publishes |
| Build effort | Phase 1 (desk + writer prompts, schemas, voice, Blob, `ai_audio`, player on hub + home) ≈ 3 days; podcast feed ≈ 0.5–1 day; admin preview/approve ≈ 1 day; two-host ≈ +1 day |

At one episode a day the voice is almost free at every vendor, so the decision flips: pick the voice you
like and spend the effort on making the rundown good.

---

## 2. Length options, as formats not just minutes

Each length is a different show, with a storyboard the editorial desk fills in. Times are targets the desk
budgets against (≈ 150 words per minute).

### Quick hit — ≈ 5 minutes, ≈ 750 words

```
0:00  Cold open        the one sentence that carries the day (homepage SUMMARY)                     15 s
0:15  Lead             the top story: what happened, the number or name that matters, why          75 s
1:30  Four quick hits  one story each from four different families, ~30 s each                    120 s
3:30  Three things     the day's three takeaways (homepage "3 Things to Know")                     30 s
4:00  Out              "Every item has its sources on standardtopic.com. Back tomorrow."           15 s
```
Draws on ≈ 6 briefings. The commute-or-coffee version.

### Standard — ≈ 12 minutes, ≈ 1,800 words  *(recommended default)*

```
0:00  Cold open                                                                                     20 s
0:20  Lead                       the top story with its context                                    120 s
2:20  Three developing stories   ~90 s each, from three different families                        270 s
6:50  Around the topics          6–8 one-liners, one per family that had a real story              150 s
9:20  Why it matters             one connective segment: the thread between today's stories        60 s
10:20 Three things                                                                                  40 s
11:00 Out                                                                                           20 s
```
Draws on ≈ 12 briefings. A morning-news podcast.

### In-depth — ≈ 25 minutes, ≈ 3,750 words

```
0:00  Cold open + rundown        "Coming up…" (three beats)                                        40 s
0:40  Lead                                                                                         150 s
3:10  Deep dive                  the lead, or the day's most consequential thread, with            300 s
                                 background drawn from the family's briefings
8:10  Five developing stories    ~90 s each                                                         450 s
15:40 Around the topics          the full tour: all 14 families, ~20 s each                        280 s
20:20 What to watch              tomorrow's known events pulled from the briefings                  90 s
21:50 Three things                                                                                  40 s
22:30 Out                                                                                           20 s
```
Draws on ≈ 20 briefings. This is the length where a **two-host** format earns its keep.

### Extended — ≈ 40 minutes, ≈ 6,000 words

The In-depth structure with longer segments, or a **week-in-review** on Saturday built from the week's
seven storyboards plus the day's briefings. Draws on ≈ 30 briefings (or seven editions).

### Combinations

Because the desk produces a storyboard once, a second length is only another writer pass plus voice:
**Quick hit + In-depth from the same rundown** costs ≈ $3–8/mo more than either alone. A morning and an
evening edition doubles everything, which is still under $35/mo on the recommended stack.

---

## 3. Volumes

| Length | Minutes | Chars / episode | Chars / month | MP3 (48 kbps) | Per year |
|---|---|---|---|---|---|
| Quick hit | 5 | 4,500 | 0.14M | 1.8 MB | 0.6 GB |
| Standard | 12 | 10,800 | 0.32M | 4.2 MB | 1.5 GB |
| In-depth | 25 | 22,500 | 0.68M | 8.8 MB | 3.1 GB |
| Extended | 40 | 36,000 | 1.08M | 14 MB | 5.0 GB |

Every length is under 1.1M characters a month — inside or near every vendor's free tier.

---

## 4. Cost 1: the editorial pipeline (the part that matters)

Three LLM stages, one call each, once a day. Inputs are the already-grounded briefings, so **no Google
Search grounding** and none of the 1,500/day grounding budget. Thinking bills as output.

| Stage | Reads | Writes | Tokens in / out (Standard) |
|---|---|---|---|
| **1. Desk** — rank, de-dupe, storyboard | every briefing's SUMMARY + "3 Things" + item headlines (101 × ≈ 500 chars) + the homepage briefing | storyboard JSON: lead, segments with beat / topics / briefing refs / target seconds / angle, three things | ≈ 16k / 5k |
| **2. Writer** — the script | the storyboard + the **full text of only the selected briefings** (6–30) | script JSON: segments → lines (speaker, text), chapter labels, transitions, per-segment source refs | ≈ 17k / 6.5k |
| **3. QA** (optional) — claim check, read-aloud pass, timing | the script + the same briefings | the script with unsupported sentences removed, numbers/abbreviations spelled for the ear, over-length segments trimmed | ≈ 24k / 4.5k |

| Model | In / out per 1M tokens | Quick hit | Standard | In-depth | Extended |
|---|---|---|---|---|---|
| Gemini 2.5 Flash | $0.30 / $2.50 | $1.0 (+QA $1.3) | $1.2 (+QA $1.7) | $1.5 (+QA $2.5) | $2.0 (+QA $3.4) |
| Gemini 3.8 Flash | $0.75 / $3.75 (doubles Jan 2027) | $1.7 (+QA $2.3) | $2.0 (+QA $3.1) | $2.7 (+QA $4.4) | $3.4 (+QA $6.0) |
| **Gemini 2.5 Pro** | $1.25 / $10 | $3.8 (+QA $5.1) | **$4.7 (+QA $6.9)** | **$6.2 (+QA $10.0)** | $7.9 (+QA $13.7) |

Per month. At one call a day, use the best model on every stage: the whole pipeline on 2.5 Pro with QA is
≈ $7–10/mo. Mixed (Pro for the desk, Flash for QA) is fine too.

**Optional human step.** The desk runs at 7:00 ET; the storyboard and script can sit in the admin panel
until 7:45 with *approve / regenerate segment / edit a line / drop a story*, then auto-publish if untouched.
Costs nothing extra; ≈ 1 day to build; the only way to get an editor's judgement into a daily show without
paying an editor.

---

## 5. Cost 2: the voice

Monthly, with free tiers applied. Bold = inside the free tier.

| Engine | $ / 1M chars | Free tier | Quick | Standard | In-depth | Extended | Two hosts? | Notes |
|---|---|---|---|---|---|---|---|---|
| Google WaveNet | $4 | 4M/mo | **$0** | **$0** | **$0** | **$0** | alternate voices | Legacy tier |
| **Google Studio "News" voices** (en-US-News-K/L/N) | $160 | 1M/mo | **$0** | **$0** | **$0** | $13 | alternate voices | Google's broadcast tier, normally the priciest voice on the market — free at this scale |
| Google Neural2 / Polly Neural | $16 | 1M/mo | **$0** | **$0** | **$0** | $1 | alternate voices | Polly Neural `news` style |
| Google Chirp 3 HD | $30 | 1M/mo | **$0** | **$0** | **$0** | $2 | alternate voices | Current-gen Google |
| Azure Neural | $15 | 0.5M/mo | **$0** | **$0** | $3 | $9 | alternate voices | `newscast` style, SSML, 10-min requests |
| Azure Neural HD | $22 | 0.5M/mo | **$0** | **$0** | $4 | $13 | alternate voices | Podcast-optimized HD voices (preview) |
| OpenAI gpt-4o-mini-tts | ≈ $15 | — | $2 | $5 | $10 | $16 | alternate voices, one request per turn | `instructions` for delivery; MP3 out; streaming |
| Gemini 2.5 Flash TTS | ≈ $15 | — | $2 | $5 | $10 | $16 | **native two-speaker** | Same key; prompt-steered; outputs PCM (we encode) |
| Gemini 2.5 Pro TTS | ≈ $30 | — | $4 | $10 | $20 | $32 | native two-speaker | Best Gemini voice |
| ElevenLabs Flash v2.5 | 0.5 credit/char | Creator $22 / 121k credits | $22 | $26 | $44 | $64 | alternate voices | Creator plan + overage |
| **ElevenLabs v3** (Text-to-Dialogue) | 1 credit/char | Creator $22 / 121k | $23 | $42 | $77 | $118 | **native dialogue, audio tags** | The premium two-host show; Pro plan ($99, 600k) is simpler than overage past In-depth |

---

## 6. Full monthly bill

| Stack | Voice | Scripts | Storage + compute | Quick | **Standard** | In-depth | Extended |
|---|---|---|---|---|---|---|---|
| Budget | Google Studio News (free tier) | 2.5 Flash | ≈ $0 | ≈ $1 | **≈ $2** | ≈ $3 | ≈ $16 |
| **Recommended** | gpt-4o-mini-tts or Gemini 2.5 Flash TTS | 2.5 Pro + QA | ≈ $0 | ≈ $7 | **≈ $12** | ≈ $20 | ≈ $30 |
| Quality, Google-only | Chirp 3 HD | 2.5 Pro + QA | ≈ $0 | ≈ $5 | **≈ $7** | ≈ $10 | ≈ $16 |
| Premium two hosts | ElevenLabs v3 | 2.5 Pro + QA | ≈ $0 | ≈ $28 | **≈ $49** | ≈ $87 | ≈ $132 |

For scale: the Gemini text pipeline is ≈ $35/mo today. A Standard flagship on the recommended stack adds a
third of that; the premium two-host In-depth show adds about 2.5×.

---

## 7. The editorial desk, in detail

This is where the product lives. The desk prompt is given every briefing's summary, three things, and item
headlines (≈ 50k chars), plus the homepage briefing in full, and returns a storyboard. Its rules:

1. **De-duplicate across families.** The same story surfaces in Technology and Business & Finance and
   World; merge them and credit the fullest briefing.
2. **Rank by consequence, not by feed volume.** The homepage briefing already applies this rule to its
   headlines (per-parent sampling); the desk applies it across briefings.
3. **Spread the show.** No two consecutive segments from the same family; every family that had a real
   story gets at least a one-liner in "Around the topics" (In-depth: all 14).
4. **Budget the clock.** Each segment gets `target_sec`; the writer gets a word budget from it; QA trims.
5. **Point at evidence.** Every segment lists the briefings (and, via them, the article links) it rests on.
   The writer may not add facts (`NO_FABRICATION` inherited); QA removes any sentence it cannot find support for.
6. **Optional signals, never voiced:** today's trending snapshot as a rank boost; yesterday's storyboard so
   a story that ran as the lead yesterday is framed as "developing", not re-broken.

```json
{ "edition": "2026-09-11", "length": "standard", "title": "…",
  "lead": { "title": "…", "topics": ["world", "politics"], "brief_refs": ["world", "geopolitics"], "target_sec": 120, "angle": "…" },
  "segments": [
    { "beat": "developing", "title": "…", "topics": ["technology"], "brief_refs": ["artificial-intelligence"], "target_sec": 90, "angle": "…" },
    { "beat": "around", "items": [ { "family": "science", "line_hint": "…", "brief_refs": ["astronomy-space"] } ], "target_sec": 150 },
    { "beat": "why", "title": "…", "target_sec": 60 }
  ],
  "three_things": ["…", "…", "…"] }
```

The writer turns that into `{ segments: [ { chapter, lines: [ { speaker, text } ], source_refs } ] }`; the
two-host format is the same schema with speakers A and B and a different writer prompt.

---

## 8. Pipeline and plumbing

```
05:00 ET  daily wave → 101 daily:b rows (done ≈ 06:50)
07:00 ET  cron pregenerate?type=flagship          readiness: ≥ 90 of 101 briefs are from this wave, else retry at 07:15 / 07:30
          gather → desk (storyboard) → writer (script) → QA → [admin hold until 07:45 if enabled]
          → TTS per segment (same format; chunks ≤ vendor cap) → concat MP3 + chapters
          → Blob  audio/flagship/{edition}.mp3  → ai_audio row → hub + home player → RSS
≈ 07:15   published (≈ 2–4 min of function time; one invocation, maxDuration 300)
```

- **Table:** the `ai_audio` table from the family doc, with `kind='flagship'`, plus a `storyboard JSONB`
  column and `approved_by / approved_at` if the admin hold ships.
- **Surfaces:** a player at the top of the AI Briefings hub and on the homepage briefing card; chapters
  from the segments (a "Science" chapter deep-links to that family's stories); Media Session for the lock
  screen; `<audio preload="none">`. CSP needs `media-src` for the Blob domain.
- **Podcast feed:** one show, "Standard Topic Daily" — `/api/podcast.xml`, one enclosure per edition, ID3
  chapters, existing hero art. Submit once to Apple Podcasts / Spotify / Pocket Casts.
- **Vercel crons:** 3 slots × 2 DST candidates = 6 more (24 today, Pro allows 40).
- **Failure:** any stage fails → the row is missing → next slot retries; 08:30 last call publishes with
  `partial=true` if fewer than 90 briefs exist.

---

## 9. Recommendation

1. **Standard (12 min), single anchor, weekdays; In-depth as a per-day flag** (e.g. Monday and Friday),
   Extended as the Saturday week-in-review once there are storyboards to build it from.
2. **Recommended stack ≈ $12/mo:** Gemini 2.5 Pro on desk + writer + QA, OpenAI gpt-4o-mini-tts (or Gemini
   2.5 Flash TTS if two hosts) for the voice, Blob for files.
3. **Prove the desk first, for cents.** Run desk + writer for a week against the live briefings (≈ $0.35),
   read the seven scripts, tune the rules in §7. The voice is a five-minute decision after that; a
   side-by-side of five engines on one script is ≈ $0.10 total at this length.
4. **Build the admin hold** in Phase 2 if John wants to read the rundown before it goes out; it is the
   cheapest quality lever in the whole design.
5. Skip: multiple episodes a day until plays justify it; any voicing of news/trend insights.

Decisions for John: default length, single anchor vs two hosts, whether to gate publishing on an approval,
and which days (if any) get the In-depth or Extended edition.
