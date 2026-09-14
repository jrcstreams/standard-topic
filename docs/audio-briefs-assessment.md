# Audio Briefings — cost, vendors, and architecture assessment

**Date:** 2026-09-11 · **Status:** assessment only, nothing built · **Scope:** a "listen" version of the
Daily Intelligence briefings (the ~100 `daily:b` rows), a chained long-form "episode" on the AI Briefings
hub, and a later on-demand option for the news/trend insights.

All prices were read from the vendors' official pricing pages on 2026-09-11 (URLs at the bottom). All
volumes come from our own Neon data, queried today.

---

## 1. The short version

| Question | Answer |
|---|---|
| What are we voicing? | 101 daily briefings/day (100 topics + home), avg **4,181 chars body + 192-char summary ≈ 4.5k chars spoken**, ≈ 600 words, **≈ 4 minutes of audio each** |
| Monthly volume, all topics | **≈ 13.7M characters ≈ 200 hours of audio** |
| Monthly volume, featured 15 + home only | ≈ 2.2M characters ≈ 32 hours |
| Cheapest credible voice | Google Cloud **WaveNet** ($4/M, 4M chars/mo free) → **≈ $39/mo for all 101 topics, $0 for featured-only** |
| Best value "sounds like a news product" voice | **OpenAI gpt-4o-mini-tts** or **Azure Neural** (~$15/M) → **≈ $200/mo all topics, ≈ $25–33/mo featured-only** |
| Premium (ElevenLabs) | **$700–1,100/mo** for all topics — 5–7× the mid tier, and more than our entire Gemini bill × 20 |
| Storage + delivery | Vercel Blob, public store: **under $2/mo** at any of these volumes |
| Compute | The generation cron: **under $1/mo** on Pro |
| Extra LLM cost for a "podcast script" rewrite | Optional. Deterministic templating is $0; a Gemini Flash-Lite polish pass is ≈ $2.50/mo |
| Recommended first ship | Pre-generate audio for featured + home in the daily wave; generate the other 85 topics **on first play** (cached forever after) — cost is bounded by listening, not by the catalog |
| Build effort | Phase 1 (per-brief player, cron, Blob, DB) ≈ 2–3 days; Phase 2 (hub playlist + long-form episode) ≈ 1–2 days; Phase 3 (insights on demand) ≈ 1–2 days; Phase 4 (podcast RSS feed) ≈ 1 day |

Two surprises from the data:

1. **The insights catalog is not "thousands per day".** Over the last 30 days we generated ≈ 174 news briefs
   and ≈ 251 trend briefs per day (5,208 + 7,538 calls). News briefs average 2,403 chars, trend briefs 482.
   That is **≈ 16M chars/month, about the same as the daily briefings** — so full pre-generation would
   roughly double the audio bill, not 10× it. On-demand generation makes it cheaper still.
2. **Google cut WaveNet from $16 to $4 per million characters and gives 4M free per month.** WaveNet is
   labelled "legacy" and is a notch below the neural tiers, but at our volume it is the only option under $50
   that isn't a self-hosted open model.

---

## 2. What we would be voicing (measured)

Queried from `ai_insights` on 2026-09-11:

| Brief | Rows/day | Avg chars | Avg words | Audio each | Chars/day | Chars/month |
|---|---|---|---|---|---|---|
| Daily Intelligence (`daily:b`) | 101 | 4,181 (+192 summary) | 593 | ≈ 4.0 min | 457k | **13.7M** |
| News brief (`news/brief`) | ≈ 174 | 2,403 | ≈ 340 | ≈ 2.3 min | 418k | 12.5M |
| Trend brief (`trend/brief`) | ≈ 251 | 482 | ≈ 70 | ≈ 0.5 min | 121k | 3.6M |

Range for `daily:b`: 2,727 to 6,281 chars. Speech pacing assumed at 150 wpm (news-read cadence).

The briefing already has a fixed shape that maps directly onto a spoken structure:

```
SUMMARY: one sentence                → "Here's what's in focus today on {Topic}…"
## Overview   (1–2 paragraphs)       → "First, the overview."
## 3 Things to Know   (3 lines)      → "Three things to know. One… Two… Three…"
## Briefings  (6–10 bold-led items)  → "Now the briefings." + each item = a chapter
```

Because the structured-output work is landing for briefings, the audio script builder should consume the
structured JSON (`summary`, `overview`, `things[]`, `items[{headline, body}]`) rather than re-parsing
markdown. Each section becomes one TTS request **and** one chapter marker, which also sidesteps every
vendor's per-request character cap (OpenAI 4,096 chars, Google 5,000 bytes, Polly 3,000 chars — a whole
briefing is over all three).

---

## 3. Voice vendors — verified pricing (2026-09-11)

Effective price per 1M characters, and what that means for us. "Featured" = 15 featured topics + home.
Free tiers are applied where they exist and recur monthly.

| Vendor / model | $ per 1M chars | Free tier | Featured (2.2M/mo) | All 101 (13.7M/mo) | + all insights (29.8M/mo) | Max per request | Notes |
|---|---|---|---|---|---|---|---|
| **Kokoro-82M** (open source, hosted on DeepInfra) | $0.62 | — | $1 | **$8** | $18 | — | 54 fixed voices, no cloning; ~90% of ElevenLabs quality in reviews; occasionally flat prosody |
| **Google Cloud WaveNet** (legacy) | $4 | 4M/mo | **$0** | **$39** | $103 | 5,000 bytes | Full SSML; cut from $16 in early 2026; older-generation voices |
| Amazon Polly Standard | $4 | 5M/mo (first 12 mo) | $0 | $35 | $99 | 3,000 chars | Concatenative — noticeably robotic; skip |
| **Azure Neural** | $15 | 0.5M/mo | $25 | **$198** | $440 | 10 min audio | Full SSML, `newscast` speaking style, **no chunking needed**; 300 ms latency |
| **OpenAI gpt-4o-mini-tts** | ≈ $15 | — | $33 | **$206** | $447 | 4,096 chars | `instructions` prompt ("calm news anchor"); MP3/Opus/AAC out directly; streaming; 13 voices |
| **Gemini 2.5 Flash TTS** | ≈ $15 | Gemini API free tier (preview) | $33 | $206 | $447 | 4,000 bytes (32k tokens on Gemini API) | Same key we already have; prompt-steered style; **two-speaker dialogue**; outputs 24 kHz PCM (we must encode MP3); still preview on the Gemini API, GA on Cloud TTS |
| Google Neural2 | $16 | 1M/mo | $19 | $203 | $461 | 5,000 bytes | SSML; solid but dated next to Chirp |
| **Amazon Polly Neural** | $16 | 1M/mo (first 12 mo) | $19 | $203 | $461 | 3,000 chars | **Newscaster style** (`<amazon:domain name="news">`) on Matthew / Joanna / Amy / Lupe |
| Azure Neural HD (Dragon HD) | $22 | 0.5M/mo | $37 | $290 | $645 | real-time only | "Optimized for podcast" voices (Andrew3/Ava3, preview); cut from $30 in March 2026 |
| Google Chirp 3 HD | $30 | 1M/mo | $35 | $381 | $864 | 5,000 bytes | Current-gen Google; no SSML when streaming |
| OpenAI tts-1-hd | $30 | — | $65 | $411 | $894 | 4,096 chars | Older than gpt-4o-mini-tts, not steerable; skip |
| Deepgram Aura-2 | $30 | $200 credit | $65 | $411 | $894 | 2,000 chars | Agent-oriented; flat for narration |
| Amazon Polly Generative | $30 | 100k/mo (12 mo) | $63 | $408 | $894 | 3,000 chars | No newscaster style on this engine |
| Cartesia Sonic (Startup plan) | $39 | — | $85 (plan min $49) | $534 | $1,162 | — | Latency-first; concurrency caps |
| Hume Octave | $50–100 | non-commercial free | $100+ | $700+ | $1,500+ | 5,000 chars | Acting instructions; long-form consistency mixed |
| **ElevenLabs Flash v2.5** | $83 plan / $50 overage | non-commercial free | $299 (Scale plan) | **$800–1,100** | $2,000+ | 40,000 chars | Best-regarded voices; 0.5 credit/char on Flash |
| ElevenLabs v3 / Multilingual v2 | $165 plan / $100 overage | " | $358 | $2,260 | $4,900 | 5k / 10k chars | Audio tags, dialogue mode |
| Google Studio "News" voices | $160 | 1M/mo | $187 | $2,032 | — | 5,000 bytes | The only explicit broadcast tier; priced like ElevenLabs |

Not options: **PlayHT / Play.ai** shut down (Meta acquisition, offline since mid-2025). **Fish Audio** bills
per UTF-8 byte and its pricing page 404'd during the survey.

**Aggregators:** Vercel AI Gateway routes TTS but only OpenAI's speech models (beta, no streaming,
base64 JSON). OpenRouter carries ~20 TTS models at list price with an OpenAI-compatible `/audio/speech`
endpoint — useful for A/B-ing voices behind one key. ElevenLabs on the Vercel Marketplace is a
"connect account" integration that injects an API key; billing stays with ElevenLabs.

**Self-hosting** (Modal / Baseten T4 at ~$0.60/hr): Kokoro runs ~36× realtime, so ≈ $0.30 per 1M chars
before cold starts. Not worth the ops surface at our scale when DeepInfra resells it for $0.62.

### Voice tiers, plainly

| Tier | Pick | All topics | Why |
|---|---|---|---|
| Budget | Google WaveNet | ≈ $39/mo | Real vendor, SSML, 4M free, cheapest non-hobby voice by 4× |
| Ultra-budget | Kokoro on DeepInfra | ≈ $8/mo | Surprisingly good; fixed voices; a third-party host of an open model |
| **Standard (recommended)** | OpenAI gpt-4o-mini-tts, or Azure Neural | ≈ $200/mo | Steerable news-anchor delivery, MP3 out of the box, streaming for on-demand |
| Standard, same vendor as today | Gemini 2.5 Flash TTS | ≈ $206/mo | One key, two-host dialogue possible; costs us an MP3 encode step and preview status |
| Premium | ElevenLabs Flash | ≈ $800–1,100/mo | Only if the voice *is* the product |

---

## 4. Storage, delivery, compute

| Item | Choice | Cost at all-101 volume |
|---|---|---|
| Object store | **Vercel Blob, public store, iad1** — $0.023/GB-mo, `put` $5/M ops, transfer inside the Pro Flat Rate CDN (1 TB) | 4.1 GB/month accumulates at 48 kbps MP3 → $0.10/mo in month 1, ≈ $1.15/mo by month 12 if we keep everything; 3k puts/mo ≈ $0.02 |
| Alternative | Cloudflare R2 ($0.015/GB, zero egress, 10 GB free) | ≈ $0 — pick this only if listens ever exceed the CDN allowance |
| Not this | Neon `bytea` | $0.35/GB-mo (15× Blob), no CDN, no Range requests, every play is a compute-billed query. Store URLs in Neon, bytes in Blob |
| Format | **MP3 mono 48 kbps** (1.4 MB per 4-min brief). Opus is 30% smaller but iOS < 18.4 only plays it in CAF | — |
| Generation compute | Vercel Pro Fluid: $0.128/CPU-hr + $0.0106/GB-hr. 101 briefs × 5–20 s waiting on the API | **$0.10–$0.50/mo** |
| Retention | Keep 30 days of `daily:b` audio (≈ 4 GB) unless we want an archive; a weekly purge like `type=purge&scope=orphans` | — |

The site's CSP is `default-src 'self'` with no `media-src`, so audio from `*.public.blob.vercel-storage.com`
will be blocked until `media-src` is added (one line in `vercel.json`).

---

## 5. Full monthly bill, by scenario

| Scenario | Voice | Storage + compute | Script LLM | **Total / mo** |
|---|---|---|---|---|
| A. Featured 16 pre-generated, rest on first play (assume 20% of the catalog gets played) | gpt-4o-mini-tts: $33 + ≈ $34 | ≈ $1 | $0 (templated) | **≈ $70** |
| B. All 101 topics pre-generated, WaveNet | $39 | ≈ $1 | $0 | **≈ $40** |
| C. All 101 topics pre-generated, standard voice | $200–206 | ≈ $1.50 | $0–13 | **≈ $205–220** |
| D. C + on-demand insights audio (assume 300 plays/day at 2.4k chars) | +$11 | +$0.50 | — | **≈ $220–235** |
| E. C + pre-generate every insight (no one will listen to most) | +$240 | +$3 | — | ≈ $450 — **not recommended** |
| F. Premium, all topics | ElevenLabs $800–1,100 | ≈ $1.50 | — | **≈ $800–1,100** |

For context the whole Gemini pipeline measured ≈ $35/mo on 9/8 and today's `ai_usage` shows
≈ $0.59–1.04/day. Scenario A keeps audio in the same order of magnitude as the text it reads.

---

## 6. How it hooks up

```
daily wave (05:00 ET)                 audio cron (+15 min, ?type=audio&n=25 × 4 runs)
generateInsight('daily') ──► ai_insights.daily:b ──► script builder ──► TTS (per section)
                                                          │                 │
                                                          │                 ▼
                                                          │        concat MP3 frames + chapters
                                                          │                 │
                                                          ▼                 ▼
                                                   ai_audio row  ◄──  Blob put (audio/daily/{slug}/{edition}.mp3)
                                                          │
client ◄── GET /api/audio?type=shortcut&topic=X&insight=daily:b ── {url, duration_ms, chapters[]}
```

### 6.1 Database

One new table; the existing `ai_usage_surface` gets an `audio:*` surface for spend accounting.

```sql
CREATE TABLE IF NOT EXISTS ai_audio (
  id            SERIAL PRIMARY KEY,
  entity_type   TEXT NOT NULL,            -- 'shortcut' | 'news' | 'trend'
  entity_key    TEXT NOT NULL,            -- same key as ai_insights
  insight       TEXT NOT NULL,            -- 'daily:b' | 'brief'
  content_hash  TEXT NOT NULL,            -- sha256 of the text the audio was built from
  edition       DATE,                     -- ET editorial day for daily:b (archive + podcast key)
  provider      TEXT, voice TEXT, format TEXT NOT NULL DEFAULT 'mp3',
  url           TEXT NOT NULL,            -- public Blob URL
  bytes         INTEGER, duration_ms INTEGER,
  chapters      JSONB,                    -- [{label, start_ms}]
  chars         INTEGER, est_cost_micros INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_audio_key_idx
  ON ai_audio (entity_type, entity_key, insight, content_hash);
CREATE INDEX IF NOT EXISTS ai_audio_edition_idx ON ai_audio (edition DESC) WHERE insight = 'daily:b';
```

`content_hash` is the join: a brief that regenerates gets new audio; an unchanged brief never re-bills.
`ai_insights` is upserted in place (one row per topic), so `ai_audio` is also what gives us the day-by-day
archive that a podcast feed needs.

### 6.2 Script builder (`lib/audio-script.js`)

Deterministic, no LLM, built from the structured brief:

```
"This is the Standard Topic daily briefing on {Topic}, for {Thursday, September 11}."
"{summary}"                                             ← chapter: In focus
"First, the overview. {overview}"                       ← chapter: Overview
"Three things to know today. One. {…} Two. {…} Three. {…}"   ← chapter: 3 things
"Now, the briefings. {headline}. {body}" × N            ← one chapter per item
"That's the briefing on {Topic}. Sources for every item are on standard topic dot com."
```

Number/date/abbreviation normalisation (e.g. "$4.2B" → "four point two billion dollars", "EU", "Q3") is
the one place a small Gemini Flash-Lite pass earns its ≈ $2.50/mo; most vendors' neural voices already
handle the common cases, so start without it.

### 6.3 Generation (`api/cron/pregenerate?type=audio`)

- Runs ≈ 15 min after each daily-wave slot; selects `daily:b` rows whose `content_hash` has no `ai_audio`
  row; **featured + home first**, then the rest if the run is in pre-generate-all mode.
- Five briefs in flight at once; each brief = 10–13 TTS requests (one per section) at the same
  format/bitrate, concatenated frame-wise (MP3 frames concatenate cleanly when encoder settings match;
  strip per-chunk ID3 headers). Chapter offsets come from each chunk's decoded duration.
- ≈ 6 s per brief → all 101 in ≈ 2 min of a 300 s function.
- Failure = row still missing = retried next run, same as the existing fills.
- Spend guard: `AUDIO_DAILY_CAP_MICROS` mirrors `AI_DAILY_CAP_MICROS`.

### 6.4 Read path (`api/audio.js`)

- `GET` with the same `{type, topic|key, insight}` shape as `/api/insight`. Cache hit → `{url, duration_ms,
  chapters}` with a long `Cache-Control`.
- Miss on a `daily:b` for a non-featured topic, or on any news/trend brief → **generate on demand**: stream
  the TTS bytes to the client (`Content-Type: audio/mpeg`, chunked) while `tee`-ing into a Blob `put`, then
  write the `ai_audio` row in `waitUntil`. Playback starts in ≈ 1 s; the second listener gets the CDN file.
- Rate limit + daily cap so a crawler can't voice the whole 28k-row catalog.

### 6.5 Player (front end)

- A `renderAudioPlayer()` shared by the Daily Intelligence card, the `/intelligence` sub-page and the hub.
  Play/pause, scrubber, chapter list from `chapters[]`, 1×/1.25×/1.5× speed, "Listen (4 min)" label.
- `<audio preload="none">` so nothing loads until tapped; **Media Session API** so the lock screen shows
  topic + chapter and hardware keys work.
- Hub "Listen to today's briefings": a client-side **queue** over the per-topic files (featured ≈ 1 hour,
  all ≈ 6.7 hours). Zero extra generation cost because each segment is the file we already made; a short
  spoken transition ("Next, Technology.") per topic is ≈ 30 chars.
- CSP: add `media-src 'self' https://*.public.blob.vercel-storage.com`.

### 6.6 Long-form episode and podcast feed (later)

- Server-side concat of the per-topic MP3s into `audio/episodes/{edition}.mp3` (+ ID3 `CHAP` frames for
  chapters) — a byte-level concatenation, no ffmpeg — so one file per day exists for people who want a
  download and for a **podcast RSS feed** (`/api/podcast.xml`, one `<enclosure>` per edition). That gets the
  briefing into Apple Podcasts / Spotify / Pocket Casts for free.
- Per-parent-category episodes (≈ 8–12 categories, 30–40 min each) are the more listenable unit than a
  6.7-hour "everything" file.

---

## 7. Recommendation

1. **Ship Scenario A first**: OpenAI `gpt-4o-mini-tts` (or Azure Neural if we prefer SSML and no chunking),
   MP3 48 kbps into Vercel Blob, `ai_audio` table, cron pre-generates featured + home, on-demand for the
   rest. ≈ $70/mo, 2–3 days of work, and it puts a play button on every briefing on day one.
2. **Measure plays for a month** via the `audio:*` surface rows. If more than ~40% of topics get played,
   flip the cron to pre-generate all 101 (≈ $200/mo standard, or ≈ $40/mo if WaveNet's voice is acceptable
   — worth a blind listen before deciding).
3. **Then** the hub queue + Media Session (Phase 2), insights on demand under a daily cap (Phase 3), and the
   podcast feed (Phase 4) once there is an archive worth subscribing to.
4. **Skip** ElevenLabs unless voice quality becomes the differentiator; skip pre-generating the insights
   catalog; skip Neon as a blob store.

Open decisions for John: which voice (a 30-second side-by-side of gpt-4o-mini-tts, Azure Neural
`newscast`, Polly Neural newscaster, WaveNet and Kokoro on one real briefing costs about $0.30 total), and
whether the archive is 30 days or forever.

---

## Sources (read 2026-09-11)

- OpenAI pricing https://developers.openai.com/api/docs/pricing · speech API https://developers.openai.com/api/docs/api-reference/audio/createSpeech
- Google Cloud TTS pricing https://cloud.google.com/text-to-speech/pricing · quotas https://docs.cloud.google.com/text-to-speech/quotas · Gemini-TTS https://docs.cloud.google.com/text-to-speech/docs/gemini-tts
- Gemini API pricing https://ai.google.dev/gemini-api/docs/pricing · speech generation https://ai.google.dev/gemini-api/docs/speech-generation
- Amazon Polly pricing https://aws.amazon.com/polly/pricing/ · quotas https://docs.aws.amazon.com/polly/latest/dg/limits.html · newscaster https://docs.aws.amazon.com/polly/latest/dg/ntts-speakingstyles.html
- Azure Speech pricing https://azure.microsoft.com/en-us/pricing/details/speech/ · HD voices https://learn.microsoft.com/en-us/azure/ai-services/speech-service/high-definition-voices
- ElevenLabs https://elevenlabs.io/pricing · https://elevenlabs.io/pricing/api · models https://elevenlabs.io/docs/overview/models · Vercel Marketplace https://vercel.com/marketplace/elevenlabs
- Cartesia https://cartesia.ai/pricing · Deepgram https://deepgram.com/pricing · Inworld https://inworld.ai/pricing · Hume https://www.hume.ai/pricing
- DeepInfra TTS https://deepinfra.com/models/text-to-speech · OpenRouter TTS https://openrouter.ai/collections/text-to-speech-models · fal.ai Kokoro https://fal.ai/models/fal-ai/kokoro/american-english · Modal https://modal.com/pricing
- Vercel AI Gateway TTS https://vercel.com/docs/ai-gateway/modalities/text-to-speech
- Vercel Blob pricing https://vercel.com/docs/vercel-blob/usage-and-pricing · iad1 https://vercel.com/docs/pricing/regional-pricing/iad1 · Flat Rate CDN GA https://vercel.com/changelog/flat-rate-cdn-is-now-ga-for-pro-teams · Functions pricing https://vercel.com/docs/functions/usage-and-pricing
- Cloudflare R2 https://developers.cloudflare.com/r2/pricing/ · Neon https://neon.com/pricing · Neon bytea guidance https://neon.com/postgresql/tutorial/bytea-data-type
- Safari Opus support https://webkit.org/blog/16574/webkit-features-in-safari-18-4/ · Opus bitrates https://wiki.xiph.org/Opus_Recommended_Settings
