# AI Shortcuts Sidebar + Sticky Scrollable Cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the AI Shortcuts section into a sticky left sidebar on desktop (≥900px) alongside the News Feed, with internal scrolling, pinned headers, inline multi-select controls, and fade+chevron scroll affordances on both cards. Mobile stacks the cards but applies the same internal-scroll/single-column treatment inside each card.

**Architecture:** All structural changes are CSS-driven via the existing `.topic-layout` CSS Grid. JS changes are limited to `renderShortcutsSidebar` (rearranged markup + scroll listener) and `renderNewsFeed` (wrap iframe + header in a scroll container + scroll listener). No new components, no build step changes, no new dependencies. The codebase has no automated test framework; verification is manual browser testing at specific viewport sizes.

**Tech Stack:** Vanilla JS modules (ES2017+), vanilla CSS, no framework. Static site served from `/index.html`.

**Reference spec:** `docs/superpowers/specs/2026-05-15-shortcuts-sidebar-design.md`

---

## File Structure

Changes touch exactly three source files plus the spec:

- **`css/styles.css`** — Layout grid, card chrome, sticky/scroll rules, shortcut-button restyling, scroll-fade overlays, dead-code deletion. By far the largest set of changes.
- **`js/app.js`** — `renderShortcutsSidebar` (lines ~758-955): remove View More collapse system; move multi-select submit/clear wrap to render *above* the list; add scroll-fade listener on the list-wrap.
- **`js/components/newsfeed.js`** — `renderNewsFeed` (lines ~57-95): restructure markup so the header lives *inside* a new `.newsfeed-scroll-wrap` alongside the iframe; add fade overlay elements; add scroll listener.

No new files are created.

---

## Verification approach (no automated tests)

This project has no test framework. Each task ends with a **Manual Verification** step naming the exact URL(s) to open and the exact visual/behavioral check. The dev server is run via any static HTTP server from the project root (the user uses VS Code Live Server or `python3 -m http.server`).

The relevant test URLs:
- Home: `http://localhost:<port>/` (route `#/`)
- Topic page: `http://localhost:<port>/#/topic/science` (or any topic with many shortcuts; `/#/topic/world` works well)
- Custom search: `http://localhost:<port>/#/custom/artificial%20intelligence`

Viewport widths to verify:
- **Desktop:** ≥1200px (Chrome devtools: "Responsive" → set to 1280×800)
- **Tablet-narrow / cutoff:** 900-1000px (verify breakpoint engages cleanly)
- **Tablet:** 768px (one side of the 900px breakpoint)
- **Mobile:** 375px (iPhone SE width)

---

## Task 1: Add card chrome to AI Shortcuts and News Feed cards

The user said "I'd like this section to sort of have a bit of a container around it to make it sort of its own card". The existing `.sidebar-card` base rule is intentionally transparent. We layer card chrome onto the two specific cards we care about: `.shortcuts-sidebar` and `.newsfeed-card`.

**Files:**
- Modify: `css/styles.css` — insert new rule block after the existing `.sidebar-card` base rule (line 3539-3544)

- [ ] **Step 1: Open `css/styles.css` and locate line 3544**

The file currently has:
```css
.sidebar-card {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}
```

This base rule stays — it's structural. We add specific chrome for the two cards via a new block immediately after.

- [ ] **Step 2: Insert card chrome rules after line 3544**

Add this immediately after the `.sidebar-card { ... }` block (before the blank line at 3545):

```css

/* === Card chrome for AI Shortcuts and News Feed cards ===
   The base .sidebar-card is intentionally transparent; these two
   cards get visible container styling so they read as distinct
   panels on the page. */
.shortcuts-sidebar,
.newsfeed-card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 1.1rem 1.15rem;
}
@media (max-width: 640px) {
  .shortcuts-sidebar,
  .newsfeed-card {
    padding: 0.95rem 1rem;
    border-radius: 8px;
  }
}
```

- [ ] **Step 3: Neutralize the newsfeed-embed negative margins**

The iframe currently uses negative left/right margins to bleed edge-to-edge inside a padless card (line 1992-2001 and 2010-2016 of styles.css). With the card now having real padding, the iframe needs to bleed back through that padding to keep the news content full-width inside the card.

Find and update lines 1992-2001:

```css
.newsfeed-embed {
  background: var(--color-bg);
  border-radius: 3px;
  position: relative;
  overflow: hidden;
  margin-left: -1.35rem;
  margin-right: -1.35rem;
  width: calc(100% + 2.7rem);
  max-width: 100vw;
}
```

Replace with:

```css
.newsfeed-embed {
  background: var(--color-bg);
  border-radius: 3px;
  position: relative;
  overflow: hidden;
  /* Bleed through the card padding so the iframe sits edge-to-edge
     inside the card. Padding is 1.15rem on desktop, 1rem on mobile. */
  margin-left: -1.15rem;
  margin-right: -1.15rem;
  width: calc(100% + 2.3rem);
  max-width: none;
}
@media (max-width: 640px) {
  .newsfeed-embed {
    margin-left: -1rem;
    margin-right: -1rem;
    width: calc(100% + 2rem);
  }
}
```

Delete the existing `@media (max-width: 1023px)` block at lines 2010-2016 (the one defining `.newsfeed-embed` overrides), since the new 640px media query above replaces its purpose:

```css
@media (max-width: 1023px) {
  .newsfeed-embed {
    margin-left: -1.15rem;
    margin-right: -1.15rem;
    width: calc(100% + 2.3rem);
  }
}
```

Delete that block entirely.

- [ ] **Step 4: Manual verification**

1. Start the static server from the project root.
2. Open `http://localhost:<port>/`.
3. Verify the AI Shortcuts section now has a visible white card with a thin grey border, rounded corners, and inner padding.
4. Verify the News Feed section also has the same card treatment.
5. Verify the iframe inside the News Feed extends edge-to-edge (no white gap between card padding and iframe).
6. Resize browser to 375px width — verify both cards still look right with slightly tighter padding.
7. Open a topic page (`#/topic/world`) and a custom page (`#/custom/test`) — both should show the cards.

- [ ] **Step 5: Commit**

```bash
git add css/styles.css
git commit -m "AI Shortcuts and News Feed: add visible card chrome"
```

---

## Task 2: Switch `.topic-layout` to 2-column grid at ≥900px

Foundational layout change. Shortcuts becomes left column (320px fixed), News Feed becomes right column (flexible). Below 900px stays single column.

**Files:**
- Modify: `css/styles.css` — replace `.topic-layout` rules around lines 3316-3362

- [ ] **Step 1: Locate and read the existing `.topic-layout` block**

Lines 3315-3362 currently contain:

```css
/* === Split topic layout: Shortcuts + Related on top, News below == */
.topic-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2rem;
}

@media (min-width: 900px) {
  /* Topic pages: shortcuts + related top row, news below */
  .topic-layout.is-split.is-home-split {
    grid-template-columns: minmax(0, 7fr) minmax(0, 3fr);
    grid-template-areas:
      "shortcuts related"
      "newsfeed newsfeed";
    gap: 2rem 1.25rem;
    align-items: stretch;
  }
  .topic-layout.is-home-split .panel-shortcuts,
  .topic-layout.is-home-split .panel-related { display: flex; }
  .topic-layout.is-home-split .panel-shortcuts > .sidebar-card,
  .topic-layout.is-home-split .panel-related > .sidebar-card {
    flex: 1; display: flex; flex-direction: column;
  }
  .topic-layout.is-home-split .topics-card-footer { margin-top: auto; }
  /* Custom pages: single-column (no Related). */
  .topic-layout.is-split.is-custom {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "shortcuts"
      "newsfeed";
  }

  /* Content Shortcuts on custom pages: 2-column grid like AI Shortcuts */
  .topic-layout.is-split.is-custom .panel-newsfeed .shortcuts-sidebar .sidebar-shortcut-list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 1rem;
  }

  .topic-layout.is-split .panel-shortcuts .sidebar-card {
    padding: 0.85rem 0.95rem;
  }

  /* Grid areas shared across all variants */
  .topic-layout.is-split .panel-shortcuts { grid-area: shortcuts; }
  .topic-layout.is-split .panel-related { grid-area: related; }
  .topic-layout.is-split .panel-newsfeed { grid-area: newsfeed; }
}
```

All the `.is-split` / `.is-home-split` / `.panel-*` rules reference classes that are **not** added by current JS (verified via grep against `js/app.js` and `js/components/newsfeed.js` — they produce zero matches). They're dead code from a prior layout iteration.

- [ ] **Step 2: Replace lines 3315-3362 with the new layout block**

Replace the entire block with:

```css
/* === Topic layout: AI Shortcuts left sidebar + News Feed right ====
   <900px: single column, shortcuts stacked above News Feed.
   ≥900px: 320px sidebar on the left, News Feed fills the rest. */
.topic-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}

@media (min-width: 900px) {
  .topic-layout {
    grid-template-columns: 320px minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
  }
  /* Custom-search pages have only Shortcuts (no News Feed). Force
     single column at all widths and cap shortcut card width so the
     single-column buttons don't stretch absurdly across a wide page. */
  .topic-layout.is-custom {
    grid-template-columns: minmax(0, 1fr);
  }
  .topic-layout.is-custom > #section-shortcuts {
    max-width: 480px;
    margin: 0 auto;
    width: 100%;
  }
}
```

`align-items: start` is critical — without it the grid stretches the shortcuts column to match the news-feed column's full height, which breaks the sticky behavior added in Task 6.

- [ ] **Step 3: Manual verification**

1. Open `http://localhost:<port>/`.
2. Desktop (≥1200px): AI Shortcuts card sits in a ~320px-wide left column; News Feed fills the rest of the row.
3. Resize to 900px viewport: layout still 2-column.
4. Resize to 899px: layout falls back to single column. Shortcuts above News Feed.
5. Open `#/custom/test`: single-column at all widths, shortcut card capped at 480px and centered.
6. No JS errors in console.

- [ ] **Step 4: Commit**

```bash
git add css/styles.css
git commit -m "Topic layout: 2-column sidebar grid at >=900px"
```

---

## Task 3: Remove dead `is-split` / `.panel-*` CSS leftover from prior layout

These were already gone in Task 2's replacement (we deleted them inside `@media (min-width: 900px)`). But the broader cleanup is independent — there are no other dead references to verify. This task is intentionally a no-op confirmation step; no commit.

- [ ] **Step 1: Grep to confirm nothing else references the dead classes**

Run:
```bash
grep -rn "is-split\|is-home-split\|panel-shortcuts\|panel-related\|panel-newsfeed" css/ js/ index.html
```

Expected output: zero matches. If anything turns up, examine and remove.

- [ ] **Step 2: No commit** — this is a verification-only step.

---

## Task 4: Switch shortcuts list to always single column + restyle buttons

Removes the 1/2/3/4-column responsive grid (lines ~3686-3724) and restyles the shortcut button rows for sidebar-width readability.

**Files:**
- Modify: `css/styles.css` — lines ~3651-3753 (the `.shortcuts-sidebar .sidebar-shortcut-list` and `.shortcuts-sidebar .sidebar-shortcut` rules + their breakpoint variants)

- [ ] **Step 1: Locate the block**

Currently, lines 3651-3753 of `css/styles.css` contain:
- The base `.shortcuts-sidebar .sidebar-shortcut-list` (single-column flex, mobile)
- The base `.shortcuts-sidebar .sidebar-shortcut` (mobile-row style)
- `@media (min-width: 641px)` block that switches list to 2-column grid and sidebars to bordered grid cells (lines 3686-3714)
- `@media (min-width: 880px)` upgrading to 3 columns
- `@media (min-width: 1140px)` upgrading to 4 columns
- `@media (hover: hover)` for hover states (lines 3725-3730)
- `@media (max-width: 640px)` mobile-shortcut-borders block (lines 3744-3753)

- [ ] **Step 2: Replace lines 3651-3753 with single-column rules**

Replace the entire block with:

```css
.shortcuts-sidebar .sidebar-shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-bottom: 0;
  margin-top: 0;
  border-top: 1px solid var(--color-border);
}
.shortcuts-sidebar .sidebar-shortcut {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.55rem 0.5rem;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--color-border);
  border-radius: 0;
  text-align: left;
  font-family: var(--font-family);
  font-size: 0.875rem;
  color: var(--color-text);
  text-decoration: none;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
@media (hover: hover) {
  .shortcuts-sidebar .sidebar-shortcut:hover {
    background: var(--color-bg-light, #f6f7f9);
    color: var(--color-primary);
  }
}
.shortcuts-sidebar .sidebar-shortcut:focus { outline: none; }
.shortcuts-sidebar .sidebar-shortcut:active {
  background: var(--color-bg-light, #f6f7f9);
  color: var(--color-primary);
}
.shortcuts-sidebar .sidebar-shortcut-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  opacity: 0.85;
}
.shortcuts-sidebar .sidebar-shortcut-icon img {
  width: 18px;
  height: 18px;
  object-fit: contain;
  vertical-align: middle;
}
.shortcuts-sidebar .sidebar-shortcut-name {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  line-height: 1.25;
  letter-spacing: -0.005em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.shortcuts-sidebar .sidebar-shortcut-chev {
  color: var(--color-text-light);
  font-size: 0.9rem;
  line-height: 1;
  opacity: 0.5;
  flex-shrink: 0;
  transition: transform 0.15s, opacity 0.15s, color 0.15s;
}
@media (hover: hover) {
  .shortcuts-sidebar .sidebar-shortcut:hover .sidebar-shortcut-chev {
    opacity: 1;
    transform: translateX(2px);
    color: var(--color-primary);
  }
}
```

This block intentionally has no per-breakpoint variants — single column applies at every viewport size.

- [ ] **Step 3: Add `title` attribute fallback for ellipsized titles**

The `.sidebar-shortcut-name` now uses `text-overflow: ellipsis`. To make truncated titles discoverable via hover tooltip, the button needs a `title` attribute. Modify `shortcutItem` in `js/app.js` (line ~957).

Locate:
```js
function shortcutItem(shortcut, topicName) {
  const iconHTML = renderIcon(shortcut.icon, 'sidebar-shortcut-icon');
  const iconEmoji = getIconEmoji(shortcut.icon);
  const prompt = shortcut.prompt.replace(/\{topic\}/gi, topicName);
  return `
    <button class="sidebar-shortcut"
            data-prompt="${escapeAttr(prompt)}"
            data-name="${escapeAttr(shortcut.name)}"
            data-icon-key="${escapeAttr(shortcut.icon)}">
      <span class="sidebar-shortcut-multi-check" aria-hidden="true">✓</span>
      ${iconHTML}
      <span class="sidebar-shortcut-name">${escapeHTML(shortcut.name)}</span>
      <span class="sidebar-shortcut-chev" aria-hidden="true">›</span>
    </button>
  `;
}
```

Replace with:
```js
function shortcutItem(shortcut, topicName) {
  const iconHTML = renderIcon(shortcut.icon, 'sidebar-shortcut-icon');
  const iconEmoji = getIconEmoji(shortcut.icon);
  const prompt = shortcut.prompt.replace(/\{topic\}/gi, topicName);
  return `
    <button class="sidebar-shortcut"
            data-prompt="${escapeAttr(prompt)}"
            data-name="${escapeAttr(shortcut.name)}"
            data-icon-key="${escapeAttr(shortcut.icon)}"
            title="${escapeAttr(shortcut.name)}">
      <span class="sidebar-shortcut-multi-check" aria-hidden="true">✓</span>
      ${iconHTML}
      <span class="sidebar-shortcut-name">${escapeHTML(shortcut.name)}</span>
      <span class="sidebar-shortcut-chev" aria-hidden="true">›</span>
    </button>
  `;
}
```

(One added line: `title="${escapeAttr(shortcut.name)}"`.)

- [ ] **Step 4: Manual verification**

1. Open `http://localhost:<port>/`.
2. Desktop ≥900px: AI Shortcuts column shows a single-column vertical list with hairline dividers between rows. Buttons fit comfortably in the 320px sidebar.
3. Open `#/topic/science` (a topic with many shortcuts). All shortcuts render as single-column rows, no 2/3/4 column grid anywhere.
4. Resize to 768px (mobile/tablet): same single-column rows inside the stacked card.
5. Find a shortcut with a long title (e.g., something like "Latest News and Developments") — the title should ellipsize on a single line, NOT wrap to two lines.
6. Hover the ellipsized button: native tooltip appears showing the full name.
7. No console errors.

- [ ] **Step 5: Commit**

```bash
git add css/styles.css js/app.js
git commit -m "AI Shortcuts: single-column buttons everywhere, restyled for sidebar width"
```

---

## Task 5: Remove "View More Shortcuts" collapse-with-peek system

Internal scroll in Task 6 replaces this. Strip the rendering, the state, and the CSS.

**Files:**
- Modify: `js/app.js` — `renderShortcutsSidebar` (lines ~758-955)
- Modify: `css/styles.css` — `.shortcuts-view-toggle` rules and peek nth-child blocks (lines ~1590-1750)

- [ ] **Step 1: Strip View More rendering from `renderShortcutsSidebar` in `js/app.js`**

Currently lines 765-772:
```js
  // Smallest per-breakpoint cutoff: collapse kicks in past 6 shortcuts.
  // CSS handles the actual peek + hide per column count (6/6/9/12 cutoffs
  // at 1/2/3/4 columns) and hides the toggle when it'd be useless.
  const canCollapse = all.length > 6;
  const cardClasses = ['sidebar-card', 'shortcuts-sidebar'];
  if (canCollapse) cardClasses.push('is-collapsible', 'is-collapsed');
```

Replace with:
```js
  const cardClasses = ['sidebar-card', 'shortcuts-sidebar'];
```

Then locate lines 788-803 (the list rendering with the view toggle):
```js
    html += `<div class="shortcuts-list-wrap">
      <div class="sidebar-shortcut-list">
        ${all.map(s => shortcutItem(s, topicName)).join('')}
      </div>
      ${canCollapse ? `
        <button type="button" class="shortcuts-view-toggle" id="shortcuts-view-toggle" aria-expanded="false">
          <span class="shortcuts-view-toggle-text">
            <span class="shortcuts-view-toggle-more">View More Shortcuts</span>
            <span class="shortcuts-view-toggle-less">View Less Shortcuts</span>
          </span>
          <span class="shortcuts-view-toggle-chev" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </button>
      ` : ''}
    </div>`;
```

Replace with:
```js
    html += `<div class="shortcuts-list-wrap">
      <div class="sidebar-shortcut-list">
        ${all.map(s => shortcutItem(s, topicName)).join('')}
      </div>
    </div>`;
```

- [ ] **Step 2: Remove the view toggle click handler**

Locate lines 836-845:
```js
  const viewToggle = container.querySelector('#shortcuts-view-toggle');

  viewToggle?.addEventListener('click', () => {
    const expanded = card.classList.toggle('is-collapsed') === false;
    viewToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (!expanded) {
      // Just collapsed — bring the toggle back into view so the user can see the change.
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
```

Delete this entire block (the `const viewToggle` line plus the event listener).

- [ ] **Step 3: Remove `multiExpandedCard` collapse coordination in the multi-toggle handler**

Locate lines 871-893 in the multi-toggle click handler:
```js
  // Track whether multi-select forced the card open. Only flip back on
  // multi-off if WE expanded it — preserves a user who already chose
  // to expand manually before enabling multi-select.
  let multiExpandedCard = false;
  toggle?.addEventListener('click', () => {
    const on = card.dataset.multi !== '1';
    card.dataset.multi = on ? '1' : '0';
    card.classList.toggle('is-multi-select', on);
    toggle.setAttribute('aria-checked', on ? 'true' : 'false');
    if (card.classList.contains('is-collapsible')) {
      if (on && card.classList.contains('is-collapsed')) {
        card.classList.remove('is-collapsed');
        multiExpandedCard = true;
      } else if (!on && multiExpandedCard) {
        card.classList.add('is-collapsed');
        multiExpandedCard = false;
      }
    }
    if (!on) {
      container.querySelectorAll('.sidebar-shortcut.is-multi-selected')
        .forEach(b => b.classList.remove('is-multi-selected'));
    }
    updateSubmit();
  });
```

Replace with:
```js
  toggle?.addEventListener('click', () => {
    const on = card.dataset.multi !== '1';
    card.dataset.multi = on ? '1' : '0';
    card.classList.toggle('is-multi-select', on);
    toggle.setAttribute('aria-checked', on ? 'true' : 'false');
    if (!on) {
      container.querySelectorAll('.sidebar-shortcut.is-multi-selected')
        .forEach(b => b.classList.remove('is-multi-selected'));
    }
    updateSubmit();
  });
```

(Comment removed, `multiExpandedCard` removed, `is-collapsible` / `is-collapsed` logic removed.)

- [ ] **Step 4: Strip View More CSS from `css/styles.css`**

Locate and delete lines 1590-1750. This block runs from the section comment "Collapse / View More" through the end of the per-breakpoint peek nth-child rules (the 4-column block at `@media (min-width: 1140px)`). Read the file to find precise start/end markers:

Start marker (around line 1590):
```css
/* === Collapse / View More — AI Shortcuts ============================
```

End marker (around line 1751, just before `.shortcuts-multi-submit-wrap` definition):
```css
}
```

Delete from the start marker through the closing `}` of the `@media (min-width: 1140px)` block. Verify the next non-deleted line is the multi-submit wrap section.

After deletion the gap should land cleanly between the `.shortcuts-sidebar.is-multi-select .sidebar-shortcut.is-multi-selected {` rule (line ~1586-1588) and the `.shortcuts-multi-submit-wrap` rule.

- [ ] **Step 5: Also delete the `.shortcuts-list-wrap { position: relative; }` rule that lives inside the deleted block at line 1597**

If you removed the whole block above, this is already gone. But add a fresh single line back at the same approximate location (immediately before the multi-submit wrap section), because `.shortcuts-list-wrap` is still rendered and needs to be the positioning context for the fade overlays we'll add in Task 8:

```css
.shortcuts-list-wrap { position: relative; }
```

- [ ] **Step 6: Manual verification**

1. Open `http://localhost:<port>/#/topic/science` (or any topic page where the previous behavior would have collapsed the list).
2. All shortcuts are visible at once — no "View More Shortcuts" pill, no faded peek row at the bottom.
3. The card now extends to its natural height to show every shortcut.
4. Enable multi-select toggle: shortcuts still all visible, multi-select selection styling appears as before.
5. Disable multi-select: returns to default state.
6. No JS errors in console.

(Note: at this point the page will look "wrong" — the shortcuts card is huge because the internal scroll from Task 6 isn't in yet. That's expected; the next task fixes it.)

- [ ] **Step 7: Commit**

```bash
git add css/styles.css js/app.js
git commit -m "AI Shortcuts: remove View More collapse system"
```

---

## Task 6: Make shortcuts card sticky on desktop + add max-height + flex column

The card becomes a viewport-bounded sticky container on desktop; on mobile it just gets max-height so it doesn't dominate the page. Inside the card, header + multi-controls + list-wrap form a flex column where the list-wrap is the scroll region.

**Files:**
- Modify: `css/styles.css` — add a new rule block alongside the card chrome block from Task 1.

- [ ] **Step 1: Add sticky/max-height/flex-column rules**

Add this CSS block immediately after the card chrome block from Task 1 (which ends with the `@media (max-width: 640px)` for card padding). The block should live in the same general area in the file (around line 3560+):

```css
/* === Shortcuts card layout: flex column with internal-scrolling list ===
   Three regions stacked vertically: header (auto), optional multi-
   controls (auto, only rendered when multi-select is on), and the
   list-wrap (flex: 1) which is the scroll region. Header and multi-
   controls stay visible at the top of the card while the list scrolls
   beneath them.

   Desktop (>=900px): card is position:sticky to keep it pinned in the
   viewport while the news feed scrolls past it.

   Mobile (<900px): card is in normal flow (sticky has no meaning at
   the top of a stacked page), but still capped at a max-height so the
   list scrolls internally instead of pushing news feed far below. */
.shortcuts-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.shortcuts-sidebar .sidebar-card-header { flex-shrink: 0; }
.shortcuts-sidebar .shortcuts-multi-submit-wrap { flex-shrink: 0; }
.shortcuts-sidebar .shortcuts-list-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* Scroll touch behavior on iOS / momentum scroll. */
  -webkit-overflow-scrolling: touch;
}

@media (min-width: 900px) {
  .shortcuts-sidebar {
    position: sticky;
    top: calc(var(--subnav-height, 110px) + 12px);
    max-height: calc(100vh - var(--subnav-height, 110px) - 32px);
  }
}
@media (max-width: 899.98px) {
  .shortcuts-sidebar {
    max-height: min(70vh, 600px);
  }
}
```

- [ ] **Step 2: Adjust the sidebar-card-header to lose its margin-bottom in this new flex context**

The existing rule at line 3552 sets `margin-bottom: 1.15rem;` and there's a mobile override at line 3562 dropping it to 0. With the new flex layout we want consistent spacing controlled by the flex gap, not by margin. Simplest fix: keep the header's existing margin/padding, then in the new layout block above, add a small adjustment so the header's bottom border still separates it from the list cleanly.

The existing border-bottom on `.sidebar-card-header` (line 3554: `border-bottom: 1px solid #e2e8f0`) already creates a visual divider. We can keep its margin-bottom and let it sit naturally above the scroll region.

No additional rule needed. Move on.

- [ ] **Step 3: Manual verification**

1. Open `http://localhost:<port>/#/topic/science` (topic with many shortcuts).
2. Desktop ≥1200px: shortcuts card is bounded — you should NOT see the full long list. Scroll within the card body (mouse wheel while cursor is over it) — list scrolls; header stays visible at the top.
3. Scroll the page itself (cursor over the news feed or page background, or just press Page Down): shortcuts card stays pinned in the viewport while news feed scrolls past it on the right.
4. Switch to mobile width (375px). Shortcuts card is now stacked above News Feed and is bounded to ~70vh — list scrolls internally; header still visible at top of card.
5. Open `#/topic/world` (likely a topic with FEW shortcuts). Card shrinks to fit content — no scroll, no internal scrollbar shown. The card height matches its content.
6. Enable multi-select toggle: the multi-submit-wrap is still bottom-sticky from the existing CSS (Task 7 fixes that). Don't worry about its position yet — just confirm it's clickable and works.
7. No console errors.

- [ ] **Step 4: Commit**

```bash
git add css/styles.css
git commit -m "AI Shortcuts: sticky card on desktop, max-height + internal scroll on mobile"
```

---

## Task 7: Move multi-select submit controls above the list (not bottom-floating)

Spec: "maybe these controls go beneath the page title/control? so above the shortcuts which allows you to cleanly scroll these and not have another sticky/hovering control."

**Files:**
- Modify: `js/app.js` — `renderShortcutsSidebar`: move `.shortcuts-multi-submit-wrap` markup before the list-wrap, drop the sentinel + IntersectionObserver
- Modify: `css/styles.css` — remove the sticky-to-bottom rules for `.shortcuts-multi-submit-wrap`

- [ ] **Step 1: Move the markup above the list in `js/app.js`**

Currently lines 788-823 of `js/app.js` render this sequence:
1. `<div class="shortcuts-list-wrap"> ... </div>` (the list)
2. `<div class="shortcuts-multi-submit-wrap" hidden> ... </div>` (the submit controls)
3. `<div class="shortcuts-multi-submit-sentinel" aria-hidden="true"></div>` (sticky-state sentinel)

We want:
1. `<div class="shortcuts-multi-submit-wrap" hidden> ... </div>` (the submit controls)
2. `<div class="shortcuts-list-wrap"> ... </div>` (the list)

Locate the existing block (lines 788-823):

```js
    html += `<div class="shortcuts-list-wrap">
      <div class="sidebar-shortcut-list">
        ${all.map(s => shortcutItem(s, topicName)).join('')}
      </div>
    </div>`;
    html += `
      <div class="shortcuts-multi-submit-wrap" hidden>
        <button type="button" class="shortcuts-multi-submit" id="shortcuts-multi-submit">
          <span class="shortcuts-multi-submit-label">
            <span class="multi-btn-label-full">Submit Selected Prompts</span>
            <span class="multi-btn-label-short">Submit Prompts</span>
          </span>
          <span class="shortcuts-multi-submit-count" id="shortcuts-multi-submit-count">0</span>
        </button>
        <button type="button" class="shortcuts-multi-select-all" id="shortcuts-multi-select-all">
          <span class="multi-btn-label-full">Select All</span>
          <span class="multi-btn-label-short">Select All</span>
        </button>
        <button type="button" class="shortcuts-multi-clear" id="shortcuts-multi-clear">
          <span class="multi-btn-label-full">Clear Selected Prompts</span>
          <span class="multi-btn-label-short">Clear Prompts</span>
        </button>
      </div>
      <div class="shortcuts-multi-submit-sentinel" aria-hidden="true"></div>
    `;
```

(Note: lines 788-792 are the list-wrap as written after Task 5's edits.)

Replace with — swap order, drop the sentinel:

```js
    html += `
      <div class="shortcuts-multi-submit-wrap" hidden>
        <button type="button" class="shortcuts-multi-submit" id="shortcuts-multi-submit">
          <span class="shortcuts-multi-submit-label">
            <span class="multi-btn-label-full">Submit Selected Prompts</span>
            <span class="multi-btn-label-short">Submit Prompts</span>
          </span>
          <span class="shortcuts-multi-submit-count" id="shortcuts-multi-submit-count">0</span>
        </button>
        <button type="button" class="shortcuts-multi-select-all" id="shortcuts-multi-select-all">
          <span class="multi-btn-label-full">Select All</span>
          <span class="multi-btn-label-short">Select All</span>
        </button>
        <button type="button" class="shortcuts-multi-clear" id="shortcuts-multi-clear">
          <span class="multi-btn-label-full">Clear Selected Prompts</span>
          <span class="multi-btn-label-short">Clear Prompts</span>
        </button>
      </div>
    `;
    html += `<div class="shortcuts-list-wrap">
      <div class="sidebar-shortcut-list">
        ${all.map(s => shortcutItem(s, topicName)).join('')}
      </div>
    </div>`;
```

- [ ] **Step 2: Remove the sentinel-based IntersectionObserver**

Locate lines 898-906 in `js/app.js`:

```js
  // Sticky overlay for the multi-select submit bar. A 1px sentinel is
  // rendered right after the bar — when it scrolls out of view, the
  // bar is "stuck" at viewport bottom and gets chrome (shadow + top
  // border). When the sentinel is in view, the bar is at its natural
  // position and renders flat.
  const sentinel = container.querySelector('.shortcuts-multi-submit-sentinel');
  if (sentinel && submitWrap && 'IntersectionObserver' in window) {
    const stickyObs = new IntersectionObserver(([entry]) => {
      submitWrap.classList.toggle('is-stuck', !entry.isIntersecting);
    }, { threshold: 0 });
    stickyObs.observe(sentinel);
  }
```

Delete this entire block.

- [ ] **Step 3: Remove the sticky CSS for the multi-submit wrap in `css/styles.css`**

Locate lines 1765-1789 (after Task 5's deletions, line numbers will have shifted; search for these rules):

```css
/* When multi-select is on, the submit/select-all/clear bar pins to the
   bottom of the viewport via sticky positioning until the user has
   scrolled far enough that the bar's natural position is in view. The
   .is-stuck chrome (shadow + top border + tighter padding + full bg)
   only kicks in while the bar is pinned, and is removed when it lands
   in its natural spot. */
.shortcuts-sidebar.is-multi-select .shortcuts-multi-submit-wrap {
  position: sticky;
  bottom: 0;
  z-index: 30;
  background: #fff;
  transition: padding 0.15s, box-shadow 0.18s, border-color 0.15s, margin 0.15s;
}
.shortcuts-sidebar.is-multi-select .shortcuts-multi-submit-wrap.is-stuck {
  margin-top: 0;
  padding: 0.85rem 0.75rem;
  border-top: 1px solid var(--color-border);
  box-shadow: 0 -6px 22px rgba(15, 26, 46, 0.08);
}
/* 1px sentinel immediately after the wrap. When out of view (i.e., bar
   is sticky'd to the viewport bottom), the bar gets the chrome above. */
.shortcuts-multi-submit-sentinel {
  height: 1px;
  margin-top: -1px;
}
```

Delete this entire block.

- [ ] **Step 4: Adjust the remaining `.shortcuts-multi-submit-wrap` margin**

Look at the base rule (was around line 1756, may have shifted):

```css
.shortcuts-multi-submit-wrap {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1.25rem;
  padding: 0;
}
```

Replace with:

```css
.shortcuts-multi-submit-wrap {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0;
  margin-bottom: 0.85rem;
  padding: 0;
}
```

(Margin-top removed so the wrap sits flush below the header's border; margin-bottom added so there's space between the controls and the list below them.)

- [ ] **Step 5: Manual verification**

1. Open `http://localhost:<port>/#/topic/science`.
2. Multi-select toggle is OFF: only the title and list visible. Multi-submit wrap hidden.
3. Enable multi-select toggle. Submit / Select All / Clear buttons appear immediately below the title row, above the shortcuts list. NOT at the bottom of the card, NOT floating, NOT pinned to the viewport bottom.
4. Scroll the shortcuts list (mouse-wheel over the card body): the submit controls stay visible at the top of the card (they're above the scroll region in flex order). Shortcuts scroll under them.
5. Click a few shortcuts to select them: Submit shows count, Clear becomes enabled, Select All disables once everything is selected. Functionality unchanged from before.
6. Click Submit: prompt modal opens with the combined prompt as before.
7. Click Clear: selections cleared.
8. Disable multi-select: submit wrap disappears, all selections cleared.
9. Repeat on mobile width (375px): identical behavior in the stacked card.
10. No JS errors in console.

- [ ] **Step 6: Commit**

```bash
git add css/styles.css js/app.js
git commit -m "AI Shortcuts multi-select: controls render inline above list"
```

---

## Task 8: Add scroll-fade overlays + scroll listener for the shortcuts list

Top and bottom fade gradients with a bobbing chevron icon, conditional on scroll position.

**Files:**
- Modify: `js/app.js` — add fade overlay markup inside `.shortcuts-list-wrap`; add scroll listener
- Modify: `css/styles.css` — add fade overlay rules + chevron + keyframes

- [ ] **Step 1: Add fade overlay markup inside the list-wrap in `js/app.js`**

Locate the current rendering of `.shortcuts-list-wrap` (after Task 7's reorder, the wrap renders second after the multi-submit wrap):

```js
    html += `<div class="shortcuts-list-wrap">
      <div class="sidebar-shortcut-list">
        ${all.map(s => shortcutItem(s, topicName)).join('')}
      </div>
    </div>`;
```

Replace with:

```js
    html += `<div class="shortcuts-list-wrap">
      <div class="scroll-fade scroll-fade-top" aria-hidden="true">
        <span class="scroll-fade-chev">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
        </span>
      </div>
      <div class="sidebar-shortcut-list">
        ${all.map(s => shortcutItem(s, topicName)).join('')}
      </div>
      <div class="scroll-fade scroll-fade-bottom" aria-hidden="true">
        <span class="scroll-fade-chev">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </span>
      </div>
    </div>`;
```

- [ ] **Step 2: Add a scroll listener that toggles overflow classes**

In `renderShortcutsSidebar` in `js/app.js`, after the `submitBtn?.addEventListener('click', ...)` block at the bottom of the function (around line 954), add this new block before the closing of `renderShortcutsSidebar`:

```js
  // Scroll-fade indicators: toggle has-overflow-top / has-overflow-bottom
  // on the list-wrap based on the wrap's scroll position. rAF-throttled.
  const listWrap = container.querySelector('.shortcuts-list-wrap');
  if (listWrap) {
    let rafId = null;
    const updateOverflow = () => {
      rafId = null;
      const max = listWrap.scrollHeight - listWrap.clientHeight;
      const hasOverflow = max > 1;
      listWrap.classList.toggle('has-overflow-top', hasOverflow && listWrap.scrollTop > 1);
      listWrap.classList.toggle('has-overflow-bottom', hasOverflow && listWrap.scrollTop < max - 1);
    };
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(updateOverflow);
    };
    listWrap.addEventListener('scroll', schedule, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(schedule).observe(listWrap);
    }
    requestAnimationFrame(updateOverflow);
  }
```

The `ResizeObserver` covers the case where the multi-submit wrap appearing/disappearing changes the wrap's clientHeight without firing a scroll event.

- [ ] **Step 3: Add CSS for the scroll-fade overlays and chevron**

Add this block to `css/styles.css`. The cleanest spot is right after the `.shortcuts-list-wrap { position: relative; }` rule added back in Task 5 (which sits just before the multi-submit-wrap section):

```css
/* === Scroll-fade indicators (shared by shortcuts list + news feed) ===
   Sits absolute over the scroll region, hidden by default. Visible
   only when there's hidden content in that direction. The chevron
   bobs gently to signal "more here, scroll." Reduced-motion users
   get the fade without the animation. */
.scroll-fade {
  position: absolute;
  left: 0;
  right: 0;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.18s ease;
  z-index: 2;
}
.scroll-fade-top {
  top: 0;
  background: linear-gradient(to bottom, var(--color-bg) 30%, rgba(255, 255, 255, 0));
}
.scroll-fade-bottom {
  bottom: 0;
  background: linear-gradient(to top, var(--color-bg) 30%, rgba(255, 255, 255, 0));
}
.scroll-fade-chev {
  display: inline-flex;
  width: 14px;
  height: 14px;
  color: var(--color-text-muted);
  animation: scroll-fade-bob 2s ease-in-out infinite;
}
.scroll-fade-top .scroll-fade-chev { animation-delay: 0s; }
.scroll-fade-bottom .scroll-fade-chev { animation-delay: 0.1s; }

@keyframes scroll-fade-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(2px); }
}
.scroll-fade-top .scroll-fade-chev { animation-name: scroll-fade-bob-up; }
@keyframes scroll-fade-bob-up {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}

@media (prefers-reduced-motion: reduce) {
  .scroll-fade-chev { animation: none; }
}

/* Show overlays only when there's hidden content in that direction. */
.shortcuts-list-wrap.has-overflow-top .scroll-fade-top { opacity: 1; }
.shortcuts-list-wrap.has-overflow-bottom .scroll-fade-bottom { opacity: 1; }
```

- [ ] **Step 4: Manual verification**

1. Open `http://localhost:<port>/#/topic/science` (many shortcuts).
2. At desktop width: the shortcuts list scrolls inside the card. With list scrolled to the top, you see a downward-pointing chevron with fade at the BOTTOM of the list area (indicating more below), and NO indicator at the top.
3. Scroll the list down a few rows. The TOP fade + up-chevron appears (indicating content above). Bottom fade still visible if more below.
4. Scroll all the way to the end of the list. Bottom fade disappears (you've reached the end). Top fade still visible.
5. Scroll back to the top. Top fade disappears.
6. Chevron has a subtle 2-second bobbing motion.
7. Open Chrome devtools → Rendering → set "Emulate CSS prefers-reduced-motion: reduce". Chevron animation stops; fade still works.
8. Open a topic with FEW shortcuts (e.g., `#/topic/world` if it has just a handful). No fade indicators appear at all — list fits inside the card.
9. Test multi-select on: same behaviors apply; list region is just shorter because the submit wrap occupies space at the top of the card.
10. Repeat on mobile width (375px): same behaviors.
11. No JS errors in console.

- [ ] **Step 5: Commit**

```bash
git add css/styles.css js/app.js
git commit -m "AI Shortcuts: scroll-fade + bobbing chevron indicators"
```

---

## Task 9: Restructure News Feed markup + add sticky card + internal scroll

Move the title inside a new scroll wrap so the news content visibly scrolls behind it. Make the news feed card behave like the shortcuts card (sticky on desktop, max-height on mobile).

**Files:**
- Modify: `js/components/newsfeed.js` — restructure `renderNewsFeed`
- Modify: `css/styles.css` — add scroll-wrap rules, sticky card + max-height rules, sticky inner header rule

- [ ] **Step 1: Restructure `renderNewsFeed` in `js/components/newsfeed.js`**

The current function (lines 57-95) builds:
```html
<div class="newsfeed-card">
  <div class="newsfeed-card-header"><h3>News Feed</h3></div>
  <div class="newsfeed-embed">
    <iframe ... ></iframe>
  </div>
</div>
```

(Or `<div class="newsfeed-placeholder">...</div>` when there's no feed.)

We want:
```html
<div class="newsfeed-card">
  <div class="newsfeed-scroll-wrap">
    <div class="newsfeed-card-header"><h3>News Feed</h3></div>
    <div class="scroll-fade scroll-fade-top">...</div>
    <div class="newsfeed-embed">
      <iframe ... ></iframe>
    </div>
    <div class="scroll-fade scroll-fade-bottom">...</div>
  </div>
</div>
```

(Placeholder case: same but without scroll-fades — placeholder is short text, no need to indicate scroll.)

Locate lines 57-95 of `js/components/newsfeed.js`:

```js
export function renderNewsFeed(container, topic, isHome) {
  const query = topic?.name || '';
  const feedId = topic?.rssFeedId;

  let inner = `
    <div class="newsfeed-card-header">
      <h3 class="newsfeed-card-title">News Feed</h3>
    </div>
  `;

  if (feedId) {
    inner += `
      <div class="newsfeed-embed">
        <iframe src="rss-embed.html?id=${feedId}"
                class="newsfeed-iframe"
                id="rss-iframe-${feedId}"
                frameborder="0"
                scrolling="no"></iframe>
      </div>
    `;
  } else {
    inner += `
      <div class="newsfeed-placeholder">
        <p>News feed coming soon for this topic.</p>
      </div>
    `;
  }

  container.innerHTML = `<div class="newsfeed-card">${inner}</div>`;

  const rssIframe = container.querySelector('.newsfeed-iframe');
  if (rssIframe && feedId) {
    window.addEventListener('message', (e) => {
      if (!e.data || !e.data.rssHeight) return;
      if (e.source !== rssIframe.contentWindow) return;
      rssIframe.style.height = e.data.rssHeight + 'px';
    });
  }
}
```

Replace with:

```js
export function renderNewsFeed(container, topic, isHome) {
  const query = topic?.name || '';
  const feedId = topic?.rssFeedId;

  const header = `
    <div class="newsfeed-card-header">
      <h3 class="newsfeed-card-title">News Feed</h3>
    </div>
  `;

  const fadeTop = `
    <div class="scroll-fade scroll-fade-top" aria-hidden="true">
      <span class="scroll-fade-chev">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
      </span>
    </div>
  `;
  const fadeBottom = `
    <div class="scroll-fade scroll-fade-bottom" aria-hidden="true">
      <span class="scroll-fade-chev">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </span>
    </div>
  `;

  let body;
  if (feedId) {
    body = `
      ${header}
      ${fadeTop}
      <div class="newsfeed-embed">
        <iframe src="rss-embed.html?id=${feedId}"
                class="newsfeed-iframe"
                id="rss-iframe-${feedId}"
                frameborder="0"
                scrolling="no"></iframe>
      </div>
      ${fadeBottom}
    `;
  } else {
    body = `
      ${header}
      <div class="newsfeed-placeholder">
        <p>News feed coming soon for this topic.</p>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="newsfeed-card">
      <div class="newsfeed-scroll-wrap">${body}</div>
    </div>
  `;

  const rssIframe = container.querySelector('.newsfeed-iframe');
  if (rssIframe && feedId) {
    window.addEventListener('message', (e) => {
      if (!e.data || !e.data.rssHeight) return;
      if (e.source !== rssIframe.contentWindow) return;
      rssIframe.style.height = e.data.rssHeight + 'px';
    });
  }

  // Measure the sticky header's height and expose as a CSS custom
  // property on the wrap. The top scroll-fade uses this to sit just
  // below the sticky header instead of behind it.
  const wrap = container.querySelector('.newsfeed-scroll-wrap');
  const headerEl = container.querySelector('.newsfeed-card-header');
  if (wrap && headerEl) {
    const setHeaderH = () => {
      const h = headerEl.offsetHeight;
      if (h > 0) wrap.style.setProperty('--newsfeed-header-h', h + 'px');
    };
    requestAnimationFrame(setHeaderH);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(setHeaderH).observe(headerEl);
    }
  }

  // Scroll-fade overlay state for the news feed wrap, mirrors the
  // shortcuts list-wrap pattern.
  if (wrap && feedId) {
    let rafId = null;
    const updateOverflow = () => {
      rafId = null;
      const max = wrap.scrollHeight - wrap.clientHeight;
      const hasOverflow = max > 1;
      wrap.classList.toggle('has-overflow-top', hasOverflow && wrap.scrollTop > 1);
      wrap.classList.toggle('has-overflow-bottom', hasOverflow && wrap.scrollTop < max - 1);
    };
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(updateOverflow);
    };
    wrap.addEventListener('scroll', schedule, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(schedule).observe(wrap);
    }
    requestAnimationFrame(updateOverflow);
  }
}
```

- [ ] **Step 2: Add the news feed card layout + scroll-wrap CSS to `css/styles.css`**

Add this block. The natural location is right after the shortcuts card sticky/max-height block added in Task 6 (so similar behavior rules live together):

```css
/* === News Feed card layout: sticky on desktop, internal scroll wrap ===
   The card uses overflow:hidden + flex column. The scroll-wrap fills
   the card and is the actual scroller. The card's sticky title sits
   inside the wrap with position:sticky so iframe content visibly
   scrolls behind it. */
.newsfeed-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.newsfeed-scroll-wrap {
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  position: relative;
}
.newsfeed-card .newsfeed-card-header {
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--color-bg);
  /* Override the existing margin-bottom; the sticky header sits inside
     the scroll context and we want it to abut the content cleanly. */
  margin-bottom: 0;
  padding-bottom: 0.85rem;
}

@media (min-width: 900px) {
  .newsfeed-card {
    position: sticky;
    top: calc(var(--subnav-height, 110px) + 12px);
    max-height: calc(100vh - var(--subnav-height, 110px) - 32px);
  }
}
@media (max-width: 899.98px) {
  .newsfeed-card {
    max-height: min(70vh, 700px);
  }
}

/* News-feed scroll-fade overlay overrides — top fade sits below the
   sticky header instead of behind it. Bottom fade unchanged from the
   shared rule. */
.newsfeed-scroll-wrap .scroll-fade-top {
  top: var(--newsfeed-header-h, 48px);
}
.newsfeed-scroll-wrap.has-overflow-top .scroll-fade-top { opacity: 1; }
.newsfeed-scroll-wrap.has-overflow-bottom .scroll-fade-bottom { opacity: 1; }
```

- [ ] **Step 3: Manual verification**

1. Open `http://localhost:<port>/#/topic/science`.
2. Desktop ≥1200px: News Feed card is in the right column, bounded by viewport height. The "News Feed" title is at the top of the card. Iframe content visible below.
3. Scroll within the news feed card (mouse-wheel over the news feed area): iframe content scrolls *behind* the sticky "News Feed" title. Title stays visible at the top.
4. Scroll the page itself (Page Down with cursor over neutral area): both the shortcuts sidebar and the news feed card stay pinned in the viewport. They don't scroll away.
5. Bottom fade + down-chevron visible at the bottom of the news feed scroll area while there's more iframe content below.
6. Scroll down inside the news feed: top fade appears (below the sticky header), bottom fade still visible while content remains.
7. Reach the bottom of the iframe content: bottom fade disappears. Top fade still visible.
8. Scroll back to top: top fade disappears.
9. Resize to mobile (375px): news feed is below shortcuts card, capped at ~70vh, same internal scroll behavior. Title still pins.
10. Open a topic that has no rssFeedId (look for one in `data/` JSON or use `#/topic/` with a slug like `arts` — check the `data/topics-*.json` files for which topics lack an rssFeedId, or just open one where the "News feed coming soon" placeholder shows). Verify placeholder renders correctly inside the new wrap, no console errors.
11. No JS errors in console.

- [ ] **Step 4: Commit**

```bash
git add css/styles.css js/components/newsfeed.js
git commit -m "News Feed: sticky card + internal scroll + scroll-fade indicators"
```

---

## Task 10: Cross-page verification + cleanup

A sweep across all entry points. No code changes expected, but if any break, file a fix here.

- [ ] **Step 1: Walk every page type at every viewport**

For each viewport (1280px desktop, 1000px tablet, 768px tablet-narrow, 375px mobile), open and visually verify:

1. **`http://localhost:<port>/`** (home) — desktop: shortcuts sidebar left, news feed right, both behave per spec. Mobile: stacked, each card internal scroll.

2. **`http://localhost:<port>/#/topic/world`** — same as home but topic-specific. Try a topic with few shortcuts (no scroll affordances) AND one with many shortcuts (scroll affordances + fade overlays).

3. **`http://localhost:<port>/#/custom/quantum%20computing`** — single column, shortcuts card capped at 480px wide, centered. No news feed below it. Same internal scroll + fade behavior in the shortcuts card.

4. **`http://localhost:<port>/#/prompt-generator`** — unchanged page, sanity-check it still renders and works.

5. **`http://localhost:<port>/#/about`** — unchanged page.

6. **`http://localhost:<port>/#/terms`** — unchanged page.

- [ ] **Step 2: Multi-select interaction sweep**

At desktop and mobile, on a topic with many shortcuts:
1. Enable multi-select.
2. Select a handful of shortcuts (some visible, some requiring scroll within the card).
3. Verify Select All works.
4. Verify Clear works.
5. Verify Submit opens the prompt modal with the correct combined prompt.
6. Disable multi-select. Confirm selections are cleared.

- [ ] **Step 3: Subnav interaction with sticky cards**

On a topic page (e.g., `#/topic/world`):
1. Scroll down. Verify the subnav's "Content Shortcuts" row collapses as before (existing behavior).
2. While that row is collapsed, the sticky cards' `top:` value uses `var(--subnav-height)` which updates dynamically — the cards should slide UP slightly to fill the freed space. Verify no jumpy/glitchy motion.
3. Scroll back to top. Subnav re-expands. Cards re-anchor lower. Smooth.

- [ ] **Step 4: prefers-reduced-motion**

1. Chrome devtools → Rendering → "Emulate CSS prefers-reduced-motion: reduce".
2. Reload page. Verify chevron animations stop on both cards. Scroll behavior still works.

- [ ] **Step 5: Console check**

No JS errors or warnings related to the changes in any of the page loads above. Existing warnings (e.g., Google Analytics related, third-party rss.app warnings) are fine.

- [ ] **Step 6: If any verification step failed, fix and commit**

Otherwise, no commit needed for this task — it's verification-only.

---

## Self-Review (post-plan)

After writing all tasks, I cross-checked the plan against the spec's "Acceptance checks" section. Coverage:

| Spec acceptance check | Plan task(s) |
|-----------------------|--------------|
| 1. ≥900px sidebar layout, sticky | Task 2 (grid), Task 6 (sidebar sticky), Task 10 (verify) |
| 2. Internal scroll with pinned header + multi-controls | Task 6 (flex column), Task 7 (multi-controls placement) |
| 3. Multi-select controls above list, never offscreen | Task 7 |
| 4. Top/bottom fade overlays on both cards | Task 8 (shortcuts), Task 9 (news feed) |
| 5. Mobile stacked, single-column shortcut buttons | Task 1 (chrome), Task 2 (grid mobile), Task 4 (single-col), Task 6 (mobile max-height) |
| 6. Custom-search page consistency | Task 2 (is-custom rule), Task 10 (verify) |
| 7. No regression to other page types | Task 10 verification |
| 8. prefers-reduced-motion disables bob | Task 8 (CSS guard), Task 10 verification |

Visible "container around it" (the user's request to make AI Shortcuts feel like its own card): **Task 1**. This wasn't explicit in the spec but is a direct user request; covered.

Placeholder scan: no "TBD", "TODO", "implement later", "handle edge cases", or "similar to Task N" references in the plan. All steps have concrete code blocks or shell commands.

Type/symbol consistency check:
- `var(--subnav-height, 110px)` used consistently (Tasks 6 and 9) with the same fallback.
- `.scroll-fade-top` / `.scroll-fade-bottom` selectors consistent across shortcuts (Task 8) and news feed (Task 9).
- `.has-overflow-top` / `.has-overflow-bottom` class names consistent in JS and CSS across both Task 8 and Task 9.
- `--newsfeed-header-h` set on `.newsfeed-scroll-wrap` in Task 9 step 1, read in Task 9 step 2.

No mismatches found.
