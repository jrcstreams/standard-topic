# Topic Family Podcasts — cost and architecture assessment

**Date:** 2026-09-11 · **Status:** assessment only, nothing built · **Supersedes** the per-brief read-aloud
scope in `docs/audio-briefs-assessment.md` (kept for the vendor survey it contains).

**Scope (John, 2026-09-11):** one podcast-style episode per **topic family** per day (the parent topic plus its
subtopics, synthesized from all of their Daily Intelligence briefings) — **14 family episodes** — plus **one
flagship daily episode** built from the homepage briefing and the highlights across the families. No audio for
news insights or trends.

Prices are from the vendors' official pages on 2026-09-11 (URLs in the first doc; Gemini text prices re-read
today). Volumes are from `data/topics.json` and Neon.

---

## 1. The short version

| Question | Answer |
|---|---|
| Episodes per day | **15**: 14 family episodes + 1 flagship |
| Inputs per family episode | parent brief + subtopic briefs: **2 to 15 briefs** (avg 7.1), 4.4k chars each → avg ≈ 31k chars (≈ 8k tokens) in, up to 66k chars (Technology) |
| Episode length (standard) | family ≈ **10 min** (≈ 1,500 words / 9,000 chars), flagship ≈ **20 min** (≈ 3,000 words / 18,000 chars) |
| Audio per day / month | 160 min / **80 hours**; **4.3M characters per month** (vs 13.7M for reading every brief aloud) |
| What's new vs reading briefs aloud | A **script-writing LLM step** per episode, ≈ $7–27/mo depending on model. Everything else gets 3× cheaper |
| Budget stack | Google WaveNet + Gemini 2.5 Flash scripts → **≈ $9/mo** all-in |
| **Recommended stack** | OpenAI gpt-4o-mini-tts (single anchor) or Gemini 2.5 Flash TTS (two hosts) + Gemini 3.8 Flash scripts → **≈ $78/mo** all-in |
| Quality stack | Google Chirp 3 HD or Azure Neural HD + Gemini 2.5 Pro scripts → **≈ $110–130/mo** |
| Premium | ElevenLabs v3 dialogue → **≈ $500–1,000/mo** |
| Storage + compute | Vercel Blob ≈ 1.6 GB/mo accumulating (**< $1/mo**, ≈ $0.50/mo at 20 GB after a year); cron compute **< $1/mo** |
| Ready by | families ≈ 7:30 am ET, flagship ≈ 8:00 am ET (the briefing wave finishes ≈ 6:50 am ET) |
| Build effort | Phase 1 (script generator, TTS, Blob, `ai_audio`, players on hub + parent pages) ≈ 3–4 days; Phase 2 (podcast RSS feeds, chapters, art) ≈ 1 day; two-host format ≈ +1 day |

The important shift: this format is **cheaper** than voicing every brief (a third of the characters) and
**more useful** (a listenable 10-minute synthesis instead of a hundred 4-minute read-outs). The cost that
matters is no longer the voice, it is getting the script right, which is prompt work not money.

---

## 2. The topic families (from `data/topics.json`)

| Family | Subtopics | Briefs in | Input chars |
|---|---|---|---|
| Technology | 14 | 15 | ≈ 66k |
| Business & Finance | 11 | 12 | ≈ 53k |
| World | 11 | 12 | ≈ 53k |
| Sports | 8 | 9 | ≈ 40k |
| Politics | 6 | 7 | ≈ 31k |
| Health & Wellness | 5 | 6 | ≈ 26k |
| Entertainment | 5 | 6 | ≈ 26k |
| Lifestyle | 5 | 6 | ≈ 26k |
| Science | 4 | 5 | ≈ 22k |
| Climate & Environment | 4 | 5 | ≈ 22k |
| Arts & Culture | 4 | 5 | ≈ 22k |
| Media | 3 | 4 | ≈ 18k |
| Ideas & Opinion | 3 | 4 | ≈ 18k |
| Education | 2 | 3 | ≈ 13k |
| **Flagship** | — | home brief + 14 family scripts | ≈ 130k |

All 14 parents are tier 1. The parent's own brief already samples headlines from the whole family
(`builderHeadlines` includes subtopics), so parent and subtopic briefs overlap — the script step's job is
exactly that synthesis and de-duplication.

Episode length can be fixed (10 min) or scaled to family size (8 min for Education, 15 for Technology).
The tables below assume fixed; scaled lands within ± 10% of the same total.

---

## 3. Episode lengths and volumes

| Variant | Family / flagship | Chars per day | Chars per month | Audio per day | Storage per month (48 kbps MP3) |
|---|---|---|---|---|---|
| Short | 6 / 12 min | 86k | 2.6M | 96 min | 1.0 GB |
| **Standard** | **10 / 20 min** | **144k** | **4.3M** | **160 min** | **1.6 GB** |
| Long | 15 / 30 min | 216k | 6.5M | 240 min | 2.5 GB |

Assumes 150 words per minute and 6 characters per word. A two-host format uses the same characters; it
changes the voice engine, not the volume.

---

## 4. Cost 1: the script-writing step (new)

One LLM call per family (all its briefs in, a structured episode script out), then one for the flagship
(home brief + the 14 family scripts in). Inputs are the already-grounded briefs, so **no Google Search
grounding is needed** and none of the 1,500/day grounding budget is touched. Thinking tokens bill as output.

| Model (paid tier, 2026-09-08 price sheet) | In / out per 1M tokens | Per family ep. | Flagship | Per day | **Per month** |
|---|---|---|---|---|---|
| Gemini 2.5 Flash | $0.30 / $2.50 | $0.014 | $0.028 | $0.22 | **≈ $7** |
| Gemini 3.8 Flash (current-gen) | $0.75 / $3.75 until Dec 31 2026, then $1.50 / $7.50 | $0.024 | $0.051 | $0.39 | **≈ $12** (≈ $23 from Jan 2027) |
| Gemini 2.5 Pro | $1.25 / $10 | $0.057 | $0.111 | $0.91 | **≈ $27** |

Token assumptions: family = 9k in (7.1 briefs + prompt; Technology ≈ 17k) and 4.6k billed out
(2.6k script + 2k thinking); flagship = 33k in, 7k out. Long episodes ≈ 1.7× these. Batch mode is 50% off
but has up-to-24h latency, so it does not fit a morning deadline.

---

## 5. Cost 2: the voice, at standard length (4.3M chars/mo)

| Engine | $ / 1M chars | Free tier | Short | **Standard** | Long | Two hosts? | Notes |
|---|---|---|---|---|---|---|---|
| Kokoro-82M via DeepInfra | $0.62 | — | $2 | **$3** | $4 | alternate voices per line | Open model; fixed voices |
| **Google WaveNet** | $4 | 4M/mo | $0 | **$1** | $10 | alternate voices | Legacy tier; SSML; the budget pick |
| Google Neural2 / Polly Neural | $16 | 1M/mo | $25 | **$53** | $88 | alternate voices | Polly Neural has a `news` speaking style |
| **Azure Neural** | $15 | 0.5M/mo | $31 | **$57** | $90 | alternate voices | `newscast` style, full SSML, 10-min requests (no chunking) |
| **OpenAI gpt-4o-mini-tts** | ≈ $15 | — | $39 | **$65** | $97 | alternate voices (one request per turn) | `instructions` ("warm podcast host"); MP3 out; streaming |
| **Gemini 2.5 Flash TTS** | ≈ $15 | — | $39 | **$65** | $97 | **native 2-speaker** in one request | Same key as today; prompt-steered; outputs PCM (we encode MP3); preview on the Gemini API, GA on Cloud TTS |
| Azure Neural HD | $22 | 0.5M/mo | $46 | **$84** | $132 | alternate voices | "Optimized for podcast" HD voices (preview) |
| Google Chirp 3 HD | $30 | 1M/mo | $48 | **$100** | $164 | alternate voices | Current-gen Google; no SSML when streaming |
| Gemini 2.5 Pro TTS | ≈ $30 | — | $78 | **$130** | $194 | native 2-speaker | Best of the Gemini voices |
| ElevenLabs Flash v2.5 | $50 overage + plan | non-commercial free | $169–299 | **$255–335** | $363–443 | alternate voices | Pro plan + overage is the cheapest way in |
| ElevenLabs v3 (Text-to-Dialogue) | $100 overage + plan | non-commercial free | $298–378 | **$470–990** | $690–1,040 | **native dialogue with audio tags** | The premium two-host experience |

Note that at standard length, Google WaveNet's 4M free characters cover **almost the entire month**.

---

## 6. Full monthly bill, standard length (10 / 20 min)

| Stack | Voice | Script LLM | Storage + compute | **Total / mo** |
|---|---|---|---|---|
| Budget | WaveNet $1 | 2.5 Flash $7 | ≈ $1 | **≈ $9** |
| **Recommended, single anchor** | gpt-4o-mini-tts $65 | 3.8 Flash $12 | ≈ $1 | **≈ $78** |
| **Recommended, two hosts** | Gemini 2.5 Flash TTS $65 | 3.8 Flash $12 | ≈ $1 | **≈ $78** |
| Quality | Chirp 3 HD $100 or Azure HD $84 | 2.5 Pro $27 | ≈ $1 | **≈ $110–130** |
| Premium two hosts | ElevenLabs v3 $470–990 | 2.5 Pro $27 | ≈ $1 | **≈ $500–1,020** |

Short episodes are ≈ 60% of these; long episodes ≈ 150%. The whole Gemini text pipeline is ≈ $35/mo today,
so the recommended stack roughly triples the AI bill and the budget stack adds a quarter.

---

## 7. What an episode is

### Family episode (≈ 10 min)

```
Cold open      the single most consequential story across the family today (from the parent brief's SUMMARY)
Intro          "This is Standard Topic: Science, for Thursday, September 11."
Overview       the family in one connected picture (parent brief's Overview, rewritten for the ear)
Segments       one per subtopic that had news today — Astronomy & Space, Biosciences, Physics… — each a chapter,
               each ending with a one-line "why it matters"; subtopics with nothing new are skipped, not padded
Three things   the three takeaways a listener should leave with (from the family's "3 Things to Know" lines)
Outro          "Every item has its sources on standardtopic.com. Back tomorrow."
```

### Flagship episode (≈ 20 min)

```
Cold open + Intro    from the homepage briefing's SUMMARY and Overview
In focus             the homepage briefing's items, the day's cross-topic story
Around the topics    one highlight per family, ranked by consequence, not by feed volume — a chapter each,
                     with "hear the full Science episode" as the hand-off
Three things         the homepage briefing's 3 Things to Know
Outro
```

Both come out of the script LLM as **structured JSON**:

```json
{ "title": "…", "description": "… (show notes, plain text)",
  "segments": [ { "kind": "cold_open|intro|overview|topic|three_things|outro",
                  "topic": "Astronomy & Space", "chapter": "Astronomy & Space",
                  "lines": [ { "speaker": "A", "text": "…" } ],
                  "source_refs": ["<brief entity_key>#item3"] } ] }
```

`speaker` is always `A` in single-anchor mode; the two-host format is the same schema with `A`/`B` and a
different prompt. Sources: every segment carries `source_refs` back to the briefs it drew on, so show notes
list the real article links the briefs already stored, and the site's "✦ AI" provenance labeling applies
unchanged. The script prompt inherits `NO_FABRICATION`: it may only reorganize and voice what the briefs say.

---

## 8. How it hooks up

```
05:00 ET  daily wave writes 101 daily:b rows (done ≈ 06:50)
07:15 ET  cron pregenerate?type=episodes  (families whose members all have a brief from this wave)
            for each family: gather parent + subtopic daily:b rows
                             → Gemini script call (structured JSON)
                             → TTS per segment (chunks ≤ vendor cap, same format/bitrate)
                             → concat MP3 frames, chapter offsets from chunk durations
                             → Blob put  audio/episodes/{family}/{edition}.mp3
                             → ai_audio row (edition, chapters, script JSON, source refs)
07:45 ET  cron pregenerate?type=episodes&scope=flagship  (needs home brief + 14 family scripts)
08:30 ET  last call: build any family still missing with whatever briefs exist, flag partial=true
```

### 8.1 Database

```sql
CREATE TABLE IF NOT EXISTS ai_audio (
  id            SERIAL PRIMARY KEY,
  kind          TEXT NOT NULL,             -- 'family' | 'flagship'
  family_slug   TEXT NOT NULL,             -- parent slug, or 'home'
  edition       DATE NOT NULL,             -- ET editorial day
  content_hash  TEXT NOT NULL,             -- sha256 over the input briefs' content, in slug order
  title         TEXT, description TEXT,
  script        JSONB NOT NULL,            -- the structured episode
  chapters      JSONB,                     -- [{label, start_ms, topic_slug}]
  source_refs   JSONB,                     -- resolved links for show notes
  provider TEXT, voice TEXT, format TEXT NOT NULL DEFAULT 'mp3',
  url           TEXT NOT NULL, bytes INTEGER, duration_ms INTEGER,
  partial       BOOLEAN NOT NULL DEFAULT false,
  chars INTEGER, script_micros INTEGER, tts_micros INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_audio_edition_idx ON ai_audio (kind, family_slug, edition);
```

Spend goes into `ai_usage_surface` as `episode:script` and `episode:tts` so the admin usage panel shows it
alongside everything else. The `content_hash` means a re-run on the same inputs is a no-op; a family whose
briefs changed (a heal, a manual regenerate) gets a fresh episode.

### 8.2 Generation

- Family readiness = every member has a `daily:b` row with `created_at ≥ dailyWaveStart()`. Not ready →
  skip this run, retry next slot. The 08:30 ET run builds regardless and marks `partial`.
- Per episode ≈ 20–40 s for the script call, ≈ 20–60 s for TTS with chunks in parallel, a few seconds to
  concatenate. Five families in flight per invocation, three invocations per slot, inside the 300 s cap.
- Chunking by segment (never mid-sentence) keeps every request under the per-call caps and gives chapters
  for free. Same MP3 settings on every chunk so frames concatenate byte-wise (strip per-chunk ID3).
- Gemini TTS returns 24 kHz PCM; encoding to MP3 in the function (a pure-JS encoder) is a few seconds of
  CPU per episode, ≈ $0.02/mo.
- Failures: script JSON fails validation → one retry with the error fed back; a TTS chunk fails → retry
  that chunk; anything else → the row is missing and the next slot retries. Same contract as the fills.
- Vercel cron count: 24 today; this adds 3 slots × 2 DST candidates = 6 (Pro allows 40).

### 8.3 Surfaces

- **AI Briefings hub**: a "Listen" band at the top — the flagship player, then the 14 family episodes as a
  row of cards with play buttons and durations, plus "Play all families" as a client-side queue (≈ 2.3 h).
- **Parent topic page** (Science): its family episode on the Daily Intelligence card.
- **Subtopic page** (Astronomy & Space): the Science episode, opened **at its own chapter** — the chapter
  offsets make subtopic deep links free.
- **All Topics** family cards: a small play control on each family header.
- Player: play/pause, scrubber, chapter list, speed, `<audio preload="none">`, Media Session API for the lock
  screen. CSP needs `media-src` for the Blob domain.

### 8.4 Podcast distribution (Phase 2)

Fifteen shows fall out of this naturally: "Standard Topic Daily" (flagship) and "Standard Topic: Science"
etc. Each is an RSS feed (`/api/podcast/{family}.xml`) with one enclosure per edition (URL, byte length,
duration, GUID — all in `ai_audio`), ID3 chapter frames in the file, and cover art from the family's icon
and color (the topic-art scripts already exist). Submitting to Apple Podcasts / Spotify is a manual step per
show; start with the flagship and the four featured families.

---

## 9. Recommendation

1. **Standard length, single anchor, recommended stack: ≈ $78/mo.** Gemini 3.8 Flash writes the scripts,
   OpenAI gpt-4o-mini-tts voices them (or Gemini 2.5 Flash TTS if we want two hosts from day one at the same
   price). Blob for files, `ai_audio` for the archive, three cron slots after the wave.
2. **Prove the script first, for cents.** The whole risk is whether a 10-minute synthesized episode reads
   well. Generate scripts for all 14 families for three days with the existing Gemini key (≈ $1.20 total),
   read them, tune the prompt, then add the voice. Voicing one day of episodes on five engines for a
   side-by-side is ≈ $3.
3. **Budget fallback exists:** if the number has to be near zero, WaveNet + 2.5 Flash is ≈ $9/mo for the
   same feature at a noticeably older voice.
4. **Then** podcast feeds, chapters and art (Phase 2), and the two-host format if the single anchor feels
   flat.

Open decisions for John: single anchor vs two hosts, fixed vs size-scaled episode length, and whether the
archive keeps every edition (it is cheap and it is what a podcast back-catalog is).
