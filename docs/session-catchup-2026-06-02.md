# Session Catch-Up — 2026-06-02

Status doc for resuming later. `docs/` is in `.vercelignore`, so this never ships.
Everything below is **merged to `main` and deployed live** unless flagged otherwise.

---

## ⭐ Prompt Submission modal (the headline item — please review live)

**What it is:** the AI-shortcut submission UX was redesigned from the cramped in-sidebar
bar into a centered, site-native modal.

**Flow now:**
- Select shortcuts → sidebar shows a compact trigger bar: **"N shortcuts selected"** +
  **Clear** + **Review & Submit →** (navy). No direct-submit in the sidebar anymore —
  you must open the modal (by design, for clarity).
- **Review & Submit** opens the centered **"Prompt Submission"** modal: eyebrow
  "AI Shortcuts", title, "N shortcuts selected", **Select all · Clear**, a **Send to**
  model `<select>`, an **Advanced settings** accordion (collapsed by default), and
  **Preview** + **Direct Submit**.
- **Advanced settings** (in this order): **Reasoning level**, **Output type**,
  **Secondary topics**, **Custom instructions**.
  - Reasoning level + Custom instructions **persist in site Settings** (also editable in
    the Settings modal; they round-trip both ways).
  - Output type (options pulled from the Prompt Generator) + Secondary topics are
    **per-submission** (reset when the modal re-opens).
- **Preview** opens the existing prompt-modal with the fully-assembled prompt;
  **Direct Submit** sends it to the chosen model.

**Files:**
- `js/components/prompt-submit-modal.js` — the modal (centered overlay).
- `js/utils/prompt-assembly.js` — pure `assemblePrompt(base, opts)` (Node-tested:
  `tools/test_prompt_assembly.mjs`). Order: reasoning hint (prepended) → base →
  output-type clause → secondary-topic clause → custom instructions.
- `js/utils/settings.js` — added `getCustomInstructions()` / `setCustomInstructions()`.
- `js/components/settings-modal.js` — Custom Instructions textarea.
- `js/app.js` — sidebar bar → trigger; opens modal via `open-submit-modal` event with
  callbacks; `buildSubmission()` now returns the BARE prompt (reasoning is added by
  `assemblePrompt`, not here).
- `css/styles.css` — `.psm-*` modal styles + `.shortcuts-multi-review` trigger.

**Spec/plan:** `docs/superpowers/specs/2026-06-02-prompt-submission-modal-design.md`,
`docs/superpowers/plans/2026-06-02-prompt-submission-modal.md`.

**⚠️ Open / to review:** This shipped without a final live click-through by you (it was
bundled into a deploy while moving on to the Web Sources request). It's fully verified
by automated tests + Playwright (desktop + mobile, settings round-trip, no console
errors), but **give it a real human review.** Likely tweak candidates: modal width,
button wording, whether Direct-Submit should also exist as a sidebar quick-action again,
spacing/polish of the advanced fields.

---

## Also shipped this session (all live)

1. **Unified evergreen shortcut model** — 34 evergreen shortcuts (one family, no
   legacy/new split), auto-injected on every topic + custom search (not home), one
   global order, per-topic exclusions. Removed ~1,500 duplicated assignment rows.
   Data: `shortcuts-directory.json` (`evergreen: true`), `shortcuts-assignments.json`
   (`evergreenOrder` + `evergreenExclusions`). Runtime: `selectShortcutsForTopic()` in
   `js/utils/data.js`. See [[project_admin_evergreen_redesign]] memory.

2. **Admin panel v2** (`admin.html`) — **local-only now** (in `.vercelignore`; 404 on
   the public site). Run it with **`npm run admin`** → http://localhost:8000/admin.html
   (must be http, not file://). Auto-loads live `/data/`; **Export changed files** to
   save → commit + push. Five tabs: Topics, Shortcuts (Topic-Specific | Evergreen |
   Groups, sortable + assigned-topics column), Web Sources (categories + reorder),
   AI Models, Prompt Generator (dynamic editor). Data Files = `⚙` raw-JSON escape hatch.
   Webhook Copy URL buttons fixed (execCommand fallback + green flash + always-clickable).

3. **Web Sources tweaks** — tighter spacing; **DuckDuckGo → DuckDuckGo News**
   (`?iar=news`); new **"No AI Web Sources"** section: **NoAI DuckDuckGo Search**
   (`noai.duckduckgo.com/?q=…&noai=1&ia=web`) + **NoAI DuckDuckGo News**
   (`…&noai=1&ia=news&iar=news`).

4. **Duck.ai** added as an AI model/platform (Settings + send-to picker).

5. Misc: web-sources subgroup eyebrows (label + hairline), header sublabels under
   News Feed / Topic Intelligence (desktop), mobile page-title spacing, Discover order
   (Latest Research now #2), custom-search header breathing room.

---

## How things deploy
- Site is on **Vercel**, custom domain **standardtopic.com**. Push to `main` → auto-deploy
  (~1 min). Verify live with `curl https://www.standardtopic.com/...`.
- **Admin does NOT deploy** (local-only). Edit data via `npm run admin`, export, commit.

## Suggested next steps when you're back
1. Human review of the Prompt Submission modal (see ⚠️ above) — tweak as desired.
2. Anything else you want on Web Sources / the No AI section.
3. Working tree is clean; `main` is fully pushed/deployed.
