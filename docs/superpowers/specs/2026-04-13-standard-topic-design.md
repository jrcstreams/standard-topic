# Standard Topic — Design Spec

**URL:** standardtopic.com
**Tagline:** News, Resources and AI Knowledge. On any topic.
**Stack:** Vanilla HTML/CSS/JS static site (no framework)
**Hosting:** GitHub Pages with hash routing
**Max topics:** ~150 dedicated topics

---

## Overview

Standard Topic provides news, resources, and AI knowledge on any topic. It hosts a library of 100+ dedicated topics, each with an RSS news feed, curated AI knowledge shortcuts, and related topic navigation. Users can also search for custom topics to get AI shortcuts on demand. A Knowledge Prompt Generator lets users build detailed prompts from dropdown selections.

---

## Architecture

**Single Page Application** — One `index.html` entry point with a hash-based router. All pages render into a shared shell (header, optional tabs, content area, footer). Topic data lives in JSON files loaded at runtime.

### File Structure

```
standard-topic/
├── index.html                   # SPA entry point
├── css/
│   └── styles.css               # All styles
├── js/
│   ├── app.js                   # Router, init, shared state
│   ├── components/
│   │   ├── header.js            # Header + tagline + Prompt Generator button
│   │   ├── footer.js            # Footer (Home, Build a Prompt, About)
│   │   ├── tabs.js              # News Feed / AI Shortcuts / Related Topics pill tabs
│   │   ├── newsfeed.js          # RSS iframe renderer
│   │   ├── shortcuts.js         # AI Shortcuts grid (evergreen + topic-specific)
│   │   ├── related-topics.js    # Related Topics grid
│   │   ├── prompt-generator.js  # Knowledge Prompt Generator page
│   │   ├── search-modal.js      # Topic search/browse modal
│   │   └── prompt-modal.js      # Prompt preview + model selection modal
│   └── utils/
│       ├── router.js            # Hash-based router
│       ├── data.js              # Load & query topic/shortcut data
│       └── ai-models.js         # Model URL builders + encoding
├── data/
│   ├── topics.json              # All topics, hierarchy, RSS IDs
│   ├── shortcuts-evergreen.json # Evergreen shortcuts (all topics)
│   ├── shortcuts-specific.json  # Topic-specific shortcuts
│   ├── ai-models.json           # AI model definitions + URL templates
│   └── prompt-generator.json    # Prompt builder dropdown options + clause templates
├── admin/
│   └── index.html               # Local-only admin page (never deployed)
├── assets/
│   └── logo.svg                 # Site logo/icon
└── .gitignore
```

---

## Routing

All routes use hash-based URLs compatible with GitHub Pages.

| Route | View | Tabs |
|-------|------|------|
| `#/` | Homepage (general/home topic) | News Feed, AI Shortcuts, Featured Topics |
| `#/topic/{slug}` | Dedicated topic (defaults to News Feed) | News Feed, AI Shortcuts, Related Topics |
| `#/topic/{slug}/shortcuts` | Dedicated topic on AI Shortcuts tab | News Feed, AI Shortcuts, Related Topics |
| `#/topic/{slug}/related` | Dedicated topic on Related Topics tab | News Feed, AI Shortcuts, Related Topics |
| `#/custom/{term}` | Custom search topic | No tabs — AI Shortcuts only |
| `#/prompt-generator` | Knowledge Prompt Generator | No tabs |
| `#/about` | About / More Info | No tabs |

---

## Page Views

### Shared Layout Shell

Every page renders inside:
1. **Header** — Logo, tagline ("News, Resources and AI Knowledge. On any topic."), Prompt Generator button (top-right)
2. **Sub-header bar** — Search dropdown (left), tab pills (center/right). Tabs only shown on homepage and dedicated topic pages.
3. **Content area** — Swapped by router
4. **Footer** — Home, Build a Prompt, About

### Homepage (`#/`)

The homepage is the "general/home" topic with custom labels. This topic exists as a special entry in `topics.json` with `"slug": "home"` and `"parent": null`. The router treats `#/` as an alias for this topic but applies homepage-specific label overrides.

- Tab labels: "General News Feed" / "AI Shortcuts" / "Featured Topics" (instead of "Related Topics")
- News Feed: RSS iframe with the home topic's `rssFeedId`
- AI Shortcuts: All evergreen shortcuts with `{topic}` = the home topic's name
- Featured Topics: Curated list of all parent topics (not the related-topics derivation logic)
- Defaults to News Feed tab active

### Dedicated Topic Page (`#/topic/{slug}`)

- Search bar shows current topic name
- Defaults to News Feed tab active
- News Feed: RSS iframe with this topic's `rssFeedId`
- AI Shortcuts: Evergreen shortcuts (minus any in `excludeEvergreen`) + topic-specific shortcuts
- Related Topics: Derived from hierarchy (see Related Topics Logic below)
- Active tab is visually indicated via color/style on the pill button

### Custom Topic Page (`#/custom/{term}`)

- No tabs displayed — cleaner layout
- Section title: "AI Shortcuts for *{custom term}*"
- Shows only evergreen shortcuts with `{topic}` replaced by the custom term
- No News Feed, no Related Topics

### Prompt Generator (`#/prompt-generator`)

- Prompt Generator button in header shows as active
- No tabs
- Full prompt builder form (see Prompt Generator section)

### About Page (`#/about`)

- No tabs
- Static content: site description, how-to-use guide, disclaimer about third-party AI platforms
- Content hardcoded in the view or loaded from a simple HTML fragment

---

## Data Models

### topics.json

```json
{
  "topics": [
    {
      "slug": "technology",
      "name": "Technology",
      "parent": null,
      "rssFeedId": "abc123xyz",
      "excludeEvergreen": [],
      "relatedParents": ["science"],
      "icon": "laptop"
    },
    {
      "slug": "artificial-intelligence",
      "name": "Artificial Intelligence",
      "parent": "technology",
      "rssFeedId": "def456uvw",
      "excludeEvergreen": [],
      "relatedParents": [],
      "icon": null
    }
  ]
}
```

**Fields:**
- `slug` — URL identifier, used in `#/topic/{slug}`
- `name` — Display name
- `parent` — Slug of parent topic, or `null` if this is a parent topic
- `rssFeedId` — The ID used in the RSS.app embed: `<rssapp-wall id="{rssFeedId}"></rssapp-wall>`
- `excludeEvergreen` — Array of evergreen shortcut IDs to hide on this topic
- `relatedParents` — Array of other parent topic slugs related to this one (for cross-category relationships)
- `icon` — Optional icon identifier for display

**Hierarchy:** One level deep. If `parent` is `null`, the topic is a parent. If `parent` is a slug, it's a subtopic of that parent.

### shortcuts-evergreen.json

```json
{
  "shortcuts": [
    {
      "id": "breaking-news",
      "name": "Breaking News",
      "icon": "zap",
      "prompt": "What are the latest breaking news stories about {topic}? Provide a summary of the top 5 most recent developments."
    }
  ]
}
```

- `{topic}` placeholder is replaced with the current topic name at runtime
- Displayed on every topic unless excluded via `excludeEvergreen`
- Also displayed on custom search topics with `{topic}` = the custom term

### shortcuts-specific.json

```json
{
  "shortcuts": [
    {
      "id": "stock-analysis",
      "name": "Stock Analysis",
      "icon": "trending-up",
      "topics": ["economy", "investing", "markets"],
      "prompt": "Provide a detailed analysis of current trends in {topic}, including key indicators and expert forecasts."
    }
  ]
}
```

- `topics` array lists which topic slugs receive this shortcut
- One shortcut can apply to multiple topics
- Not shown on custom search topics

### ai-models.json

```json
{
  "models": [
    {
      "id": "chatgpt",
      "name": "ChatGPT",
      "icon": "chatgpt",
      "urlTemplate": "https://chatgpt.com/?q={prompt}",
      "method": "url"
    },
    {
      "id": "gemini",
      "name": "Gemini",
      "icon": "gemini",
      "urlTemplate": "https://gemini.google.com/app?q={prompt}",
      "method": "url"
    },
    {
      "id": "perplexity",
      "name": "Perplexity",
      "icon": "perplexity",
      "urlTemplate": "https://www.perplexity.ai/search?q={prompt}",
      "method": "url"
    },
    {
      "id": "copilot",
      "name": "Bing Copilot",
      "icon": "copilot",
      "urlTemplate": "https://www.bing.com/chat?q={prompt}",
      "method": "url"
    },
    {
      "id": "google-ai",
      "name": "Google AI Mode",
      "icon": "google",
      "urlTemplate": "https://www.google.com/search?udm=50&q={prompt}",
      "method": "url"
    },
    {
      "id": "claude",
      "name": "Claude",
      "icon": "claude",
      "urlTemplate": "https://claude.ai",
      "method": "clipboard"
    }
  ],
  "defaultModel": "chatgpt"
}
```

- `method: "url"` — Encodes prompt into URL template, opens in new tab
- `method: "clipboard"` — Copies prompt to clipboard, shows confirmation, opens site in new tab
- `{prompt}` is replaced with the URL-encoded prompt at runtime
- `defaultModel` is used for first-time visitors; returning visitors use their localStorage preference

### prompt-generator.json

```json
{
  "fields": {
    "contentType": {
      "label": "Content Types / Knowledge",
      "options": [
        {
          "value": "research-summary",
          "label": "Research Summary",
          "clause": "Provide a detailed research summary about {primary_topic}"
        }
      ]
    },
    "tone": {
      "label": "Tone / Style of Response",
      "options": [
        {
          "value": "professional",
          "label": "Professional",
          "clause": "Use a professional tone throughout your response"
        }
      ]
    }
  },
  "baseTemplate": "Provide a comprehensive overview of {primary_topic}, covering key concepts, recent developments, and important context.",
  "closingLine": "Focus on delivering substantive, well-organized knowledge."
}
```

- Each field has a label and an array of options
- Each option has a `clause` — a natural sentence fragment included when that option is selected
- `baseTemplate` is the fallback when only a topic is provided
- `closingLine` is appended to all generated prompts
- Fields not selected are simply omitted — the prompt reads naturally with any combination

---

## Key Features

### Search Modal (Topic Selection)

Triggered by clicking the "Search any topic or choose from list" bar.

**Initial state (no text):**
- Full browseable list of all topics
- Parent topics displayed as section headers (bold, uppercase)
- Subtopics indented below their parent
- Clicking any topic navigates to `#/topic/{slug}`

**Typing state:**
- "Add as Custom Topic" option always appears at top once typing begins
- Below it, matching dedicated topics filtered in real-time
- Each match shows its parent category (e.g., "in Technology")
- Both parent and subtopic names are searched

**Behavior:**
- Selecting a dedicated topic → navigates to `#/topic/{slug}`
- Selecting "Add as Custom Topic" → navigates to `#/custom/{encoded-term}`
- Keyboard navigation: arrow keys move, Enter selects, Escape closes
- Clicking outside or pressing Escape closes the modal

**Mobile:** Search bar full-width below header, modal expands full-width.

### News Feed (RSS Embed)

Each topic's news feed is an RSS.app widget embed:
```html
<rssapp-wall id="{rssFeedId}"></rssapp-wall>
<script src="https://widget.rss.app/v1/wall.js" type="text/javascript" async></script>
```

The script is loaded once globally. When switching topics, only the `id` attribute changes.

### AI Shortcuts

Displayed as a grid of clickable cards (matching the screenshot layout — 3 columns on desktop).

**On dedicated topics:** Evergreen shortcuts (minus exclusions) shown first, then topic-specific shortcuts below. Both sections use the same visual style. Evergreen shortcuts section labeled "Evergreen Shortcuts", topic-specific labeled "Topic-Specific Shortcuts".

**On custom topics:** Only evergreen shortcuts, with `{topic}` = the custom search term.

**On click:** Opens the Prompt Preview Modal.

### Prompt Preview Modal

Appears when a user clicks any AI Shortcut or hits "Submit Prompt" on the Prompt Generator.

**Layout (top to bottom):**
1. **Header** — "Submit Prompt" title, close button
2. **Prompt Preview** — Full assembled prompt displayed in a scrollable box
3. **Copy Prompt Text** — Button to copy raw prompt to clipboard
4. **Model Selector** — Grid of AI models (3 columns). Last-used model pre-selected from localStorage. Claude shows "(copy)" indicator.
5. **Submit Button** — Dynamic label: "Open in ChatGPT →", "Copy & Open Claude →", etc.
6. **Disclaimer** — "Standard Topic is not responsible for actions taken once you leave this site."

**Submit behavior:**
- URL-method models: `encodeURIComponent(prompt)` replaces `{prompt}` in URL template, opens new tab
- Clipboard-method models: copies prompt, shows "Copied!" toast, opens model site in new tab
- Selected model saved to localStorage

**URL length safety:** If the encoded URL exceeds 2,000 characters, show a note suggesting "Copy Prompt Text" + "Open Model" instead.

### Related Topics Logic

**On a parent topic page:**
- All subtopics of this parent
- Other parent topics linked via `relatedParents`
- Current parent topic shown with "Active Page" label (not clickable)

**On a subtopic page:**
- Parent topic (clickable)
- All sibling subtopics (same parent, excluding current)
- Other parent topics linked via parent's `relatedParents`

**On homepage ("Featured Topics"):**
- All parent topics displayed as a curated list

### Knowledge Prompt Generator (`#/prompt-generator`)

**Form layout:** 4-column grid of dropdown fields across multiple rows, matching the screenshot.

**Fields (all optional):**

| Row | Field 1 | Field 2 | Field 3 | Field 4 |
|-----|---------|---------|---------|---------|
| 1 | Choose Model / Platform | Primary Topic(s) | Secondary Topic(s) | Content Types / Knowledge |
| 2 | Content Generation | Sources to Use | Source Recency / Time Period | Citations |
| 3 | Response Format | Response Length / Depth | Expertise / Audience Level | Tone / Style of Response |
| 4 | Geographic Focus | (reserved) | (reserved) | (reserved) |

**Additional:** Customizations free-text area below the grid.

**Hybrid prompt assembly:**
- Base template used when only topic is filled
- Each filled field contributes a natural clause from its option's `clause` template
- Unfilled fields are simply omitted
- Customizations text appended as additional instructions
- Live preview updates in real-time in the summary box

**Action buttons:**
- **Submit Prompt** — Opens Prompt Preview Modal with assembled prompt
- **Copy Prompt Text** — Copies assembled prompt directly to clipboard
- **Clear Prompt** — Resets all fields
- **Open Model** — Opens selected model's site in new tab without a prompt

---

## Mobile Responsiveness

- Header: Logo + "Build Prompt +" button (shortened from "Prompt Generator +")
- Tagline hidden on mobile
- Search bar: Full-width below header
- Tab pills: Horizontal row, scrollable if needed
- Shortcuts grid: Single column on mobile
- Related Topics grid: Single column on mobile
- Prompt Generator: Fields stack to 2 columns then 1 column on smaller screens
- All modals: Full-width on mobile

---

## Admin Page

**Location:** `admin/index.html` — local-only, never deployed to GitHub Pages.

**Access:** Opened directly from the local filesystem (`file://`) or local dev server. Not linked from the public site. The deployment process excludes the `admin/` folder.

**Tabs:**
- **Topics** — Add/edit/delete topics. Set parent, RSS feed ID, relatedParents, evergreen exclusions. Table view with hierarchy (subtopics indented with ↳).
- **Evergreen Shortcuts** — Add/edit/delete shortcuts with name, icon, prompt template.
- **Topic Shortcuts** — Add/edit/delete shortcuts, assign to topic slugs.
- **AI Models** — Add/edit/remove models, edit URL templates and methods.
- **Prompt Generator** — Edit dropdown options and clause templates.

**Workflow:**
1. Import existing JSON files (or auto-load from `data/` if same origin)
2. Edit via forms
3. Validation: warns on duplicate slugs, orphaned subtopics, missing required fields
4. Export JSON — downloads updated files
5. Replace files in project, push to GitHub

---

## Persistence

- **Model preference:** Stored in `localStorage` under a site-specific key. First-time visitors default to ChatGPT.
- **No user accounts or authentication** — fully static, anonymous site.

---

## Deployment

- GitHub Pages serving from the repo root
- A simple GitHub Actions workflow deploys all files except `admin/` and `docs/` (specs/internal docs) to GitHub Pages
- No build step required for the main site — plain static files
- Update content by editing JSON files in `data/` and pushing to GitHub

---

## Error Handling

- **Missing topic slug:** If a `#/topic/{slug}` route doesn't match any topic in `topics.json`, show a "Topic not found" message with a link back to home.
- **Missing RSS feed ID:** If a topic has no `rssFeedId`, show a placeholder message in the News Feed tab: "News feed coming soon for this topic."
- **Orphaned subtopics:** If a subtopic references a parent slug that doesn't exist, treat it as a parent topic (graceful degradation). Admin validation catches this before export.
- **Empty related topics:** If a topic has no siblings, no parent, and no `relatedParents`, show "No related topics yet" in the Related Topics tab.
