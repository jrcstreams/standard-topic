# Prompt Submission Modal — Design

**Date:** 2026-06-02
**Status:** Approved (pending spec review)

## Problem

When the user selects AI shortcuts in the Topic Intelligence sidebar, the submission
controls appear as a cramped panel pinned inside the ~320px sidebar
(`shortcuts-multi-submit-wrap`): a tiny "N selected", inline "Select all · Clear",
"Send to" model picker, and "Preview" / "Direct Submit" buttons. It looks weak, has no
title, can't grow, and offers no way to shape the prompt (output type, secondary
topic, custom instructions, reasoning level) before sending.

## Goals

- Replace the cramped inline bar with a **centered, spacious modal** that looks
  genuinely native to the site (same overlay/header/section language + design tokens
  as the existing `prompt-modal.js`).
- A clear **title** ("Prompt Submission") and an obvious **"N shortcuts selected"**.
- Well-positioned **Select all / Clear**, model picker, and **Preview + Direct Submit**
  (Direct Submit stays inside the modal).
- An **Advanced settings** accordion (collapsed by default) to shape the prompt:
  Reasoning Level, Output Type, Secondary Topics, Custom Instructions — in that order.
- Make it **clear the user must open + interact with the modal** to review/submit:
  the sidebar bar becomes a single prominent **"Review & Submit →"** trigger with no
  competing direct-submit shortcut.

## Non-Goals

- No change to how `submitPrompt()` opens a model / copies to clipboard.
- No change to the existing `prompt-modal.js` (the prompt-text **Preview** step) beyond
  passing it the fully-assembled prompt.
- No server/backend; settings persist in `sessionStorage` like today.

## Decisions (from brainstorming)

1. **Centered modal**, not an enlarged sidebar panel.
2. **Direct Submit lives in the modal**; the sidebar bar is only a trigger.
3. **Split persistence:** Reasoning Level + Custom Instructions persist in site
   **Settings** (also editable in the Settings modal); Output Type + Secondary Topics
   are **per-submission**, with Output Type options pulled from the **Prompt Generator**.

## Components & Architecture

- **`js/components/prompt-submit-modal.js`** (new) — the centered modal. Exposes
  `initPromptSubmitModal()` (mounts an overlay + listens for an `open-submit-modal`
  CustomEvent) following the existing `prompt-modal.js` / `prompt-preview-modal.js`
  pattern. Opened with a detail object:
  `{ count, models, selectedModelId, topicName, baseBuilder, callbacks }` where
  `callbacks = { onSelectAll, onClear, onSetModel, onPreview, onDirectSubmit }` and
  `baseBuilder()` returns the un-advanced combined prompt + display name for the
  current selection. **Note:** today `buildSubmission()` prepends the reasoning hint
  itself; that prepend moves into `assemblePrompt` so reasoning isn't applied twice —
  `baseBuilder()` returns the bare combined prompt only.
- **`js/utils/prompt-assembly.js`** (new) — pure `assemblePrompt(base, opts)`
  (no DOM) that injects the advanced settings. Node-testable.
- **`js/app.js`** — the sidebar `shortcuts-multi-submit-wrap` collapses to the trigger
  bar; "Review & Submit" dispatches `open-submit-modal` with the callbacks wired to the
  existing selection helpers (`updateSubmit`, clear, select-all, `refreshModelChoice`,
  `buildSubmission`). Preview/Direct Submit run the assembled prompt.
- **`js/utils/settings.js`** — add persisted **Custom Instructions** (getter/setter,
  sessionStorage key `st_settings_custom_instructions`).
- **`js/components/settings-modal.js`** — add a Custom Instructions textarea.
- **`css/styles.css`** — modal styles reusing the `pm-`-style overlay/header tokens.

## Modal Layout

```
┌─ Prompt Submission ─────────────────────────── ✕ ┐
│  AI SHORTCUTS                                       │  ← eyebrow (matches pm-header)
│  3 shortcuts selected            Select all · Clear │
│                                                     │
│  Send to    [ ChatGPT ▾ ]                           │
│                                                     │
│  ▸ Advanced settings                                │  ← collapsed accordion
│                                                     │
│              [ Preview ]     [ Direct Submit → ]    │
└─────────────────────────────────────────────────────┘
```

- Overlay dim + centered panel (~520px, responsive to full-width on mobile), same
  border-radius / shadow / navy header eyebrow as `prompt-modal`.
- Header: eyebrow "AI Shortcuts", title "Prompt Submission", close ✕.
- Selection row: bold **"N shortcuts selected"** left; **Select all · Clear** right.
  Select all disabled when all are selected; Clear closes the modal when it empties the
  selection (nothing left to submit).
- "Send to" reuses the model-picker control.
- Footer actions: **Preview** (secondary) opens the existing `prompt-modal` with the
  assembled prompt; **Direct Submit →** (primary, navy) sends to the chosen model.

## Advanced Settings Accordion (collapsed by default, this order)

1. **Reasoning level** — `<select>` of `REASONING_LEVELS`. Defaults to the site setting
   (`getReasoningLevel()`); changing it calls `setReasoningLevel()` (single source of
   truth, syncs with the Settings modal).
2. **Output type** — `<select>`; options from the Prompt Generator field with
   `key === 'outputType'` (value/label/clause). Default "— none —". Per-submission.
3. **Secondary topics** — text `<input>`. Per-submission. Uses the Prompt Generator's
   `secondaryTopicClause`.
4. **Custom instructions** — `<textarea>`. Persists in Settings
   (`getCustomInstructions()` / `setCustomInstructions()`), pre-filled and editable
   here; edits write through to the setting.

## Prompt Assembly (`assemblePrompt`)

`assemblePrompt(base, { reasoningHint, outputClause, secondaryTopic, secondaryClauseTpl,
customInstructions, topicName })` returns, joining present pieces with `\n\n`:

```
[reasoningHint]                                  (prepend; '' for Standard)
[base]                                           (the combined shortcut prompt(s))
[outputClause with {primary_topic}→topicName]    (if an output type is chosen)
[secondaryClauseTpl with {secondary_topic}→secondaryTopic]  (if secondary topic given)
[customInstructions]                             (if set)
```

- Placeholders `{primary_topic}` / `{secondary_topic}` substituted; missing inputs drop
  their block entirely.
- The Preview modal and Direct Submit both submit this assembled string.

## Visual Quality Requirements

- Use existing design tokens (`--color-primary` navy, `--font-display`, `--color-bg`,
  borders, radii) and mirror `prompt-modal`'s overlay/header/section styling so the
  modal reads as part of the same family — not a generic dialog.
- The trigger bar reads clearly as the only way forward: **"3 shortcuts selected"** +
  a prominent **"Review & Submit →"** primary button (navy), with a quieter **Clear**.
- Accordion uses the site's existing disclosure affordance (chevron + label), not a
  raw `<details>` default look.
- Mobile: modal goes full-width with comfortable touch targets.

## Acceptance Criteria

- Selecting shortcuts shows the trigger bar; "Review & Submit →" opens the modal.
- Modal shows title, "N shortcuts selected", working Select all / Clear, model picker.
- Advanced settings collapsed by default; the 4 fields appear in the specified order
  and inject correctly into the assembled prompt (verified by `assemblePrompt` tests).
- Reasoning Level + Custom Instructions round-trip with the Settings modal; Output Type
  + Secondary Topics reset when the modal re-opens.
- Preview opens the prompt-modal with the assembled prompt; Direct Submit sends it.
- No console errors; modal is keyboard-accessible (focus trap, Esc closes) and styled
  natively on desktop + mobile.

## Files

- New: `js/components/prompt-submit-modal.js`, `js/utils/prompt-assembly.js`,
  `tools/test_prompt_assembly.mjs`
- Modify: `js/app.js`, `js/utils/settings.js`, `js/components/settings-modal.js`,
  `css/styles.css`
