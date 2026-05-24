# Iframe-era news feed rendering (archived)

This folder contains the code and styles that powered the **rss.app iframe widget** rendering on Standard Topic before the API-based migration on **2026-05-24**.

It's kept here purely for reference — nothing in this folder is loaded by the live site, and the folder is excluded from Vercel deploys via `.vercelignore`. Delete it any time without affecting the production site.

---

## Why it was removed

The old rendering path embedded rss.app's hosted widget (`https://widget.rss.app/v1/wall.js`) inside an iframe on every topic page. Each visitor's browser loaded the widget script and pulled the article data directly from rss.app's CDN.

That worked, but had two limitations:

1. **Domain-locked.** rss.app's widget enforces a domain whitelist — when the site was added to Vercel at `standard-topic.vercel.app`, the iframe showed *"Please verify your security settings at rss.app"* instead of the feed. Adding a new domain required an rss.app account change for every preview/staging URL.
2. **No control over presentation.** Card styling, layout, and dimensions lived inside the widget — we could only nudge them from the outside via the parent CSS (the `.newsfeed-embed` pull-out tricks, postMessage height plumbing, etc.).

The migration replaced this with:

- A Vercel serverless function at `/api/feeds/[topicId].js` that fetches the same feeds via rss.app's **v1 API** server-side (credentialed with `RSSAPP_API_KEY` + `RSSAPP_API_SECRET`).
- A client renderer in `js/components/newsfeed.js` that calls that endpoint and renders cards from JSON using our own markup + CSS (`.news-card` / `.news-list` rules in `css/styles.css`).

Result: same article content, no third-party scripts in the browser, full control over layout, and edge-cached on Vercel (15 min `s-maxage`, 1 hour `stale-while-revalidate`).

---

## What's in this folder

| File | Original location | Purpose |
|---|---|---|
| `rss-embed.html` | repo root | The HTML document loaded inside each iframe. Imported `widget.rss.app/v1/wall.js`, created a `<rssapp-wall id=…>` element, and `postMessage`d height + wheel-delta back to the parent page so the outer scroll container could host scrolling. |
| `iframe-mode-snippet.js` | `js/components/newsfeed.js` (extracted) | Two functions: `useApiRenderer()` (the `?legacy=1` URL gate) and `renderIframeMode(scrollWrap, feedId)` (the iframe DOM injection + postMessage handlers). |
| `iframe-mode-styles.css` | `css/styles.css` (extracted) | All `.newsfeed-embed` / `.newsfeed-iframe` rules including the mobile sticky-gap tweak and the desktop pull-out compensation for rss.app's internal card padding. |

The `.newsfeed-card`, `.newsfeed-title`, `.newsfeed-scroll-wrap`, and `.newsfeed-placeholder` rules in `css/styles.css` stayed on the live site — they're shared infrastructure that the new card renderer still uses.

---

## How to reintegrate (if ever needed)

1. **Restore the iframe document** — copy `rss-embed.html` back to the repo root.
2. **Restore the renderer branch** — paste the contents of `iframe-mode-snippet.js` into `js/components/newsfeed.js` (above `renderNewsFeed`), then change `renderNewsFeed` to call `useApiRenderer()` and dispatch to either `renderApiMode` or `renderIframeMode(scrollWrap, feedId)` based on the result. The pre-removal commit (find by `git log --all --grep="archive iframe"`) shows the exact dispatch wiring.
3. **Restore the CSS** — paste the contents of `iframe-mode-styles.css` into `css/styles.css` near the `.newsfeed-placeholder` block.
4. **Bump the iframe cache key** in `js/components/newsfeed.js` (the `?v=…` query in the iframe `src`) so browsers refetch the iframe document.
5. **Re-add the Vercel deploy URL** to the rss.app widget domain whitelist (or whatever new origin the iframes will be served from), otherwise the *"verify security settings"* message returns.

---

## Related commits

The original migration was shipped across these commits on `main`:

- `dcc058b` — Phase 1: `/api/feeds/[topicId].js` serverless function + soccer feed-id data fix
- `d1c44c7` — Phase 2: API-driven card renderer behind `?api=1` flag
- `d8187ac` — Phase 3: flipped default to API mode + 2-col grid on desktop + correct rss.app v1 field names (`description_text`, `date_published`)
- `8837a6b` — Phase 6: About/Terms copy updated to reflect the new architecture
- *(this commit)* — Phase 6.1: archived iframe-era code here and removed it from the live tree

`git log --all -- _archive/iframe-rendering-legacy/` will surface this history if you ever return to the folder.
