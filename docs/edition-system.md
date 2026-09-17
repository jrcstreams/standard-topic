# The edition system (revamp1433)

An **edition** is everything a reader sees together: the sixteen topic briefings
and the podcast written from them. Editions release at **5:00** and **17:00
America/New_York**. Nothing in an edition is visible until all of it is.

## The clock

`lib/edition.js` answers two questions that have different answers at the same
moment:

- `buildingEdition(now)` — the next release. What the wave and the episode job
  are working on. At 4:20 AM that is today/morning.
- `liveEdition(now)` — the last release. What a reader is looking at. At 4:20 AM
  that is still yesterday/evening.

Everything resolves through `America/New_York`, so daylight saving needs no
maintenance. The key is `YYYY-MM-DD|morning|evening`.

## The day

| ET | What runs | Where |
|---|---|---|
| 3:30 / 15:30 | News ingest, so briefings are written from minutes-old stories | Vercel cron |
| 4:00 / 16:00 | The wave stages 16 briefings into `pending_*` | Vercel cron |
| 4:12 / 16:12 | Wave catch-up for anything that failed | Vercel cron |
| 4:20 / 16:20 | The episode is built from those staged drafts | GitHub Actions |
| 4:40, 4:55 | Episode catch-ups, seconds long if one already exists | GitHub Actions |
| 5:00 / 17:00 | `/api/cron/release` publishes the edition, every 5 min for 2h | Vercel cron |

## Holding

The wave writes `pending_content`, `pending_summary`, `pending_sources`,
`pending_edition` and `pending_at`, leaving the live columns alone. The episode
row is written with a `release_at` in the future. Every read path ignores both.

`/api/cron/release` publishes only when the edition is **whole**: its release
time has passed, its episode exists, and at least 12 briefings are staged. It
promotes the briefings first, then opens the episode, so a reader can never land
on an episode whose briefings have not moved.

If the episode is late, nothing is published and the reader keeps the previous
edition, entire. Late is survivable. A headline that does not match the audio
under it is not.

## Retries

1. The workflow step retries three times with backoff.
2. A retry reuses `out/script-*.json` when one exists, so a failure in the voice
   stage redoes the voice alone: the copy that ships is the copy that was
   fact-checked, and the text calls are not paid for twice.
3. The :40 and :55 runs are catch-ups. `make-episode` exits immediately when the
   edition already has an episode, so a catch-up costs seconds.
4. If everything fails, the edition holds and later runs keep trying. GitHub
   emails on a failed run.

## Cost, measured

| Item | Unit | Per day | Per month |
|---|---|---|---|
| One briefing (~3,940 in / 835 out tokens) | $0.0032 | | |
| 16 briefings x 2 editions | | $0.10 | $3.10 |
| Episode text (desk, writer, QA, fact check) | $0.085 | | |
| Episode voice (~10,000 chars at $15/M) | $0.151 | | |
| 2 episodes | | $0.47 | $14.40 |
| Trending, junk gate, news ingest | | $0.10 | $3.00 |
| **Total** | | **$0.67** | **$20.50** |

Grounded searches run about 11 per episode fact check plus a few for the
briefings, against 1,500 free per day.

## Running one by hand

    node scripts/make-episode.js --publish                  # the edition being built
    node scripts/make-episode.js --publish --edition=evening
    node scripts/make-episode.js --publish --force          # rebuild one that exists
    gh workflow run episode.yml --repo jrcstreams/standard-topic

## Secrets

`GEMINI_API_KEY`, `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` live in the repo's
Actions secrets. Adding `CRON_SECRET` lets the workflow call the release
endpoint itself the moment an episode lands; without it the Vercel cron picks it
up within five minutes.
