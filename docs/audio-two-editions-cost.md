# Two editions a day — cost analysis

**Date:** 2026-09-14 · **Question:** what does it cost to run the Global AI Morning Briefing and Global AI
Evening Briefing (text) and a podcast episode for each, seven days a week — and is the second podcast
worth it?

**Measured baseline (Neon `ai_usage`, last 10 days):** $0.76/day ≈ **$23/month** for the entire Gemini
pipeline today (one 5am ET wave of 101 topic briefings, plus news and trend briefs, heals, junk-gate,
embeddings). The 101-briefing wave is roughly half of that, ≈ $0.35/day.

**Measured episode cost (four production runs):** text stages $0.06 (desk $0.017, writer $0.030, trim
≈ $0.025 when it fires, QA $0.010) + voice $0.15 (≈ 10k chars at $15/M) = **$0.21 per episode**.
Stutter-check transcription is inside that. Wall clock ≈ 6 minutes.

---

## The options

| # | What runs | Extra $/month | Total $/month |
|---|---|---|---|
| 0 | Today: one wave, one home briefing, no podcast | — | 23 |
| 1 | + evening **home** briefing only (one extra grounded call/day) | +0.30 | 23 |
| 2 | + one podcast/day (morning), 7 days | +6.40 | 30 |
| 3 | + two podcasts/day (morning + evening), 7 days | +12.80 | 36 |
| 4 | + a full **evening wave** of all 101 topic briefings, 7 days | +10–13 | 47–49 |
| 5 | Everything: two waves, two text briefings, two podcasts, 7 days | +24–26 | **47–49** |

Storage for two episodes a day (3.6 MB each) accumulates 216 MB/month ≈ 2.6 GB in year one, under $0.10/month
on Vercel Blob. Function compute for two runs a day is under $1/month.

## The real question is not the second podcast

The second podcast is **$6.40/month**. That is not a decision-driving number. What actually decides the
evening edition's quality is **what it reads from**:

- An evening episode built from the **morning's** topic briefings will retell the morning's stories with
  a fresh coat of paint. The home briefing alone refreshes cheaply (it samples live headlines directly),
  but the desk chooses stories from the 100 topic digests, and those would be twelve hours old.
- An evening episode built from a **second wave** of topic briefings has genuinely new material to choose
  from. That wave is the $10–13/month line — and the Evening Briefing *text* needs the same wave anyway,
  so the podcast is not what incurs it.

There is a cheaper middle: run the evening wave on the ~30 highest-volume topics only (Technology,
Business, World, Politics, Sports families), ≈ +$3–4/month, and let the long tail keep its morning
briefing until the next morning. The evening desk would still see fresh digests where the news actually
moves. This is the option to start with; it can be widened by adding slugs to a list.

## Recommendation

Run **both podcasts** and **both text briefings**, seven days, with the evening wave limited to the
high-volume families to start: ≈ **$38–40/month all-in**, versus $23 today. Widening to a full evening
wave later is +$8. Dropping the evening podcast would save $6.40 and remove the thing that makes the
evening edition worth opening.

## What changes structurally (and why it is cheaper than it sounds)

The alignment work (see the companion design) makes the **text briefing a rendering of the episode**,
not a separate generation: one desk pass, one writer pass, and out come the script, the audio, and the
written briefing with the same stories in the same order, each item mapped to a chapter. That *removes*
the separate home-briefing generation (≈ $0.01/edition) and replaces it with the episode's text stages
(≈ $0.06/edition). Net effect on the table above: the per-episode cost already includes the text briefing,
so options 2/3 cover both the podcast *and* the Morning/Evening Briefing text for the homepage.
