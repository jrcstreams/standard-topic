# AI Brief / AI Insights Grounding Fixes

## Context

Two recurring quality issues with AI-generated content on Standard Topic:

1. **Global Headlines AI Brief** — produces vague, hedged summaries with no sources and no specifics. Example output mentions "severe drought in parts of South America" without naming the country, event, or timeframe.
2. **Trending Topics AI Insights** — model lacks awareness of current date when the trend is being rendered. Example: a "Knicks vs Spurs Game 4" trend produced a summary describing the series as 2-0 (only Games 1 and 2 played) when Game 4 was about to tip off, meaning Game 3 had already occurred.

Both failures share the same root cause: the model is generating from prior knowledge with **no grounding** and **no anchor on what "now" means**.

This document outlines three fixes plus a prompt skeleton to test.

---

## Fix 1: Inject current datetime into every enrichment call

Every AI Brief / AI Insights system prompt should start with a line like:

```
Current datetime: Monday, June 9, 2025, 17:23 ET
```

Without this, Claude has no temporal anchor and falls back to whatever its training data suggests is "recent." That's why the Knicks/Spurs brief described a 2-0 series — there's no signal in the prompt that Game 3 has happened.

**Implementation:** generate the datetime string at request time inside the cron job or serverless function that makes the Anthropic API call. Pass it on every call, no exceptions.

---

## Fix 2: Stop asking the model to "summarize world news" — feed it actual headlines

The Global Headlines brief reads like a model with no input trying to sound plausible. That is almost certainly what it is.

Pin it to data:

- Pull the top N RSS items (title, URL, lede sentence) for the relevant shortcut/topic at generation time
- Pass them in the **user turn** as structured context
- Instruct the model to synthesize **only from those items** with inline citations back to source title/URL

This is the same grounding pattern already used at the shortcut × topic intersection level. Claude is good at synthesis and bad at recall of yesterday's news — the architecture should reflect that.

### For trending topics specifically

- The SerpAPI Trending Now response includes related queries and related articles for each trend. Pass those into the enrichment prompt as context.
- Consider adding the Anthropic `web_search` tool to the API call so the model can pull the live state of the story (current series score, what the natural disaster actually is, etc.) before writing. This is in addition to the SerpAPI payload, not a replacement for it.

---

## Fix 3: Add a specificity-or-omit rule

The "severe drought in parts of South America" line is the model hedging because it has no actual fact to anchor on. Bake the following into the system prompt:

> If you cannot identify a specific event, country, person, or date for a claim, omit it. Do not write "tensions remain high," "a natural disaster," "major powers," or similar placeholder language. Every sentence must name something specific or be cut.

This single rule collapses the nothing-burger output. Briefs will be shorter when there's less specific signal available — that is the correct behavior, not a regression.

---

## Prompt skeleton to test

```
System:
Current datetime: {weekday, date, time, tz}
You generate briefs for {shortcut} × {topic} on Standard Topic.

Rules:
- Every claim must trace to a provided source or web search result
- Omit any claim you cannot make specific (no "tensions remain," "various factors," "some experts")
- No hedge language
- Cite inline: [Source Name]

User:
Topic: {topic}
Trending since: {duration}
Source articles:
{numbered list of articles with title, publication, URL, lede}

Write a 3-4 sentence brief.
```

---

## UX consideration (separate from the technical fix)

For Global Headlines specifically, worth asking whether an AI-synthesized paragraph is even the right unit of output.

The intersection pages work because they are focused on one shortcut applied to one topic. "Global headlines" is too broad to synthesize without going generic — the model has to hedge to cover unrelated events (Eastern Europe + South China Sea + South America drought) in a single paragraph.

Alternative pattern to consider: five real headlines with one sentence of AI-written context each. This may serve readers better than a paragraph trying to cover everything at once, and it sidesteps the hedge-language problem entirely because each unit of output is tied to a single concrete story.

---

## Suggested review scope for Claude Code

1. Identify every code path that calls the Anthropic API for AI Brief or AI Insights generation
2. Confirm whether each call currently injects a datetime string — if not, add one
3. Confirm whether each call currently passes grounded source content (RSS items, SerpAPI related articles) — if not, refactor to pass them
4. Update system prompts to include the specificity-or-omit rule
5. Evaluate whether `web_search` tool should be added to the trending topics generation call
6. Surface the Global Headlines UX question for product decision before implementing further
