# Standard Topic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a vanilla HTML/CSS/JS single-page application that serves as a topic-based news, resources, and AI knowledge hub with 100+ dedicated topics, AI prompt shortcuts, and a knowledge prompt generator.

**Architecture:** Single `index.html` entry point with hash-based routing. All data lives in JSON files loaded at runtime. Modular JS components render into a shared layout shell. No build step, no framework — deployed to GitHub Pages.

**Tech Stack:** Vanilla HTML5, CSS3, JavaScript (ES modules), GitHub Pages

**Note:** This is a static site with no test framework. Verification steps use manual browser checks via a local dev server. Start the server with `npx serve .` (or `python3 -m http.server 8000`) from the project root.

---

### Task 1: Project Scaffolding & Data Files

**Files:**
- Create: `index.html`
- Create: `.gitignore`
- Create: `data/topics.json`
- Create: `data/shortcuts-evergreen.json`
- Create: `data/shortcuts-specific.json`
- Create: `data/ai-models.json`
- Create: `data/prompt-generator.json`
- Create: `css/styles.css`
- Create: `js/app.js`
- Create: `assets/logo.svg`

- [ ] **Step 1: Create `.gitignore`**

```
.DS_Store
node_modules/
.superpowers/
```

- [ ] **Step 2: Create `data/topics.json` with sample topics**

```json
{
  "topics": [
    {
      "slug": "home",
      "name": "General",
      "parent": null,
      "rssFeedId": "",
      "excludeEvergreen": [],
      "relatedParents": [],
      "icon": "home"
    },
    {
      "slug": "technology",
      "name": "Technology",
      "parent": null,
      "rssFeedId": "",
      "excludeEvergreen": [],
      "relatedParents": ["science"],
      "icon": "laptop"
    },
    {
      "slug": "artificial-intelligence",
      "name": "Artificial Intelligence",
      "parent": "technology",
      "rssFeedId": "",
      "excludeEvergreen": [],
      "relatedParents": [],
      "icon": null
    },
    {
      "slug": "cybersecurity",
      "name": "Cybersecurity",
      "parent": "technology",
      "rssFeedId": "",
      "excludeEvergreen": [],
      "relatedParents": [],
      "icon": null
    },
    {
      "slug": "science",
      "name": "Science",
      "parent": null,
      "rssFeedId": "",
      "excludeEvergreen": [],
      "relatedParents": ["technology"],
      "icon": "flask"
    },
    {
      "slug": "space-astronomy",
      "name": "Space & Astronomy",
      "parent": "science",
      "rssFeedId": "",
      "excludeEvergreen": [],
      "relatedParents": [],
      "icon": null
    },
    {
      "slug": "business",
      "name": "Business",
      "parent": null,
      "rssFeedId": "",
      "excludeEvergreen": [],
      "relatedParents": [],
      "icon": "briefcase"
    },
    {
      "slug": "economy-markets",
      "name": "Economy & Markets",
      "parent": "business",
      "rssFeedId": "",
      "excludeEvergreen": [],
      "relatedParents": [],
      "icon": null
    }
  ]
}
```

- [ ] **Step 3: Create `data/shortcuts-evergreen.json`**

```json
{
  "shortcuts": [
    {
      "id": "breaking-news",
      "name": "Breaking News",
      "icon": "zap",
      "prompt": "What are the latest breaking news stories about {topic}? Provide a summary of the top 5 most recent developments."
    },
    {
      "id": "global-news",
      "name": "Global News",
      "icon": "globe",
      "prompt": "Provide a global perspective on {topic}. What are the major international developments and how do they differ across regions?"
    },
    {
      "id": "ai-developments",
      "name": "AI Developments",
      "icon": "cpu",
      "prompt": "What are the latest AI and technology developments related to {topic}? Focus on recent breakthroughs, tools, and applications."
    },
    {
      "id": "economy-markets-investing",
      "name": "Economy, Markets, Investing",
      "icon": "trending-up",
      "prompt": "Provide an overview of how {topic} relates to the current economy, financial markets, and investment landscape."
    },
    {
      "id": "events-milestones",
      "name": "Events and Milestones",
      "icon": "calendar",
      "prompt": "What are the most notable recent events and milestones related to {topic}? Include dates, significance, and context."
    },
    {
      "id": "technological-advances",
      "name": "Technological Advances",
      "icon": "rocket",
      "prompt": "What are the most significant recent technological advances related to {topic}? Cover innovations, breakthroughs, and emerging trends."
    },
    {
      "id": "scientific-discoveries",
      "name": "Scientific Discoveries",
      "icon": "microscope",
      "prompt": "Summarize the latest scientific discoveries and research findings related to {topic}. Include sources and implications."
    },
    {
      "id": "politics-elections",
      "name": "Politics and Elections",
      "icon": "landmark",
      "prompt": "What are the latest political developments and election-related news concerning {topic}? Provide balanced coverage of key events."
    },
    {
      "id": "sports-updates",
      "name": "Sports Updates",
      "icon": "trophy",
      "prompt": "Provide the latest sports news, scores, and updates related to {topic}. Include key matchups, standings, and notable performances."
    },
    {
      "id": "environmental-updates",
      "name": "Environmental Updates",
      "icon": "leaf",
      "prompt": "What are the latest environmental news and climate-related developments concerning {topic}? Include policy changes, research findings, and impact assessments."
    },
    {
      "id": "health-medicine",
      "name": "Health and Medicine Updates",
      "icon": "heart",
      "prompt": "Provide the latest health and medical news related to {topic}. Cover research advances, public health updates, and expert recommendations."
    }
  ]
}
```

- [ ] **Step 4: Create `data/shortcuts-specific.json`**

```json
{
  "shortcuts": [
    {
      "id": "stock-analysis",
      "name": "Stock Analysis",
      "icon": "bar-chart",
      "topics": ["economy-markets", "business"],
      "prompt": "Provide a detailed stock market analysis related to {topic}, including key indicators, trends, and expert forecasts for the current period."
    },
    {
      "id": "ai-tools-roundup",
      "name": "AI Tools Roundup",
      "icon": "tool",
      "topics": ["artificial-intelligence", "technology"],
      "prompt": "What are the best current AI tools and platforms related to {topic}? Provide a roundup with descriptions, use cases, and comparisons."
    }
  ]
}
```

- [ ] **Step 5: Create `data/ai-models.json`**

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

- [ ] **Step 6: Create `data/prompt-generator.json`**

```json
{
  "fields": [
    {
      "key": "model",
      "label": "Choose Model / Platform",
      "type": "model-select",
      "row": 1
    },
    {
      "key": "primaryTopic",
      "label": "Primary Topic(s)",
      "type": "text",
      "placeholder": "Select here",
      "row": 1
    },
    {
      "key": "secondaryTopic",
      "label": "Secondary Topic(s)",
      "type": "text",
      "placeholder": "Select here",
      "row": 1
    },
    {
      "key": "contentType",
      "label": "Content Types / Knowledge",
      "row": 1,
      "options": [
        { "value": "overview", "label": "Overview", "clause": "Provide a comprehensive overview of {primary_topic}" },
        { "value": "research-summary", "label": "Research Summary", "clause": "Provide a detailed research summary about {primary_topic}" },
        { "value": "explainer", "label": "Explainer", "clause": "Explain {primary_topic} in a clear, accessible way" },
        { "value": "comparison", "label": "Comparison", "clause": "Compare and contrast key perspectives on {primary_topic}" },
        { "value": "timeline", "label": "Timeline / History", "clause": "Provide a chronological timeline of key developments in {primary_topic}" },
        { "value": "case-study", "label": "Case Study", "clause": "Present a detailed case study analysis of {primary_topic}" }
      ]
    },
    {
      "key": "contentGeneration",
      "label": "Content Generation",
      "row": 2,
      "options": [
        { "value": "summarize", "label": "Summarize", "clause": "Summarize the key points concisely" },
        { "value": "analyze", "label": "Analyze", "clause": "Provide in-depth analysis with supporting evidence" },
        { "value": "compare", "label": "Compare", "clause": "Compare different viewpoints and approaches" },
        { "value": "explain", "label": "Explain", "clause": "Explain the concepts clearly with examples" },
        { "value": "predict", "label": "Predict / Forecast", "clause": "Provide predictions and forecasts based on current trends" }
      ]
    },
    {
      "key": "sources",
      "label": "Sources to Use",
      "row": 2,
      "options": [
        { "value": "academic", "label": "Academic Papers", "clause": "Draw primarily from academic papers and peer-reviewed research as sources" },
        { "value": "news", "label": "News Sources", "clause": "Reference recent news articles and journalism as primary sources" },
        { "value": "government", "label": "Government / Official", "clause": "Prioritize government reports and official data sources" },
        { "value": "industry", "label": "Industry Reports", "clause": "Use industry reports and market analysis as primary sources" },
        { "value": "mixed", "label": "Mixed Sources", "clause": "Draw from a diverse mix of credible sources" }
      ]
    },
    {
      "key": "recency",
      "label": "Source Recency / Time Period",
      "row": 2,
      "options": [
        { "value": "last-week", "label": "Last Week", "clause": "Focus on information from the past week" },
        { "value": "last-month", "label": "Last Month", "clause": "Focus on information from the past month" },
        { "value": "last-quarter", "label": "Last Quarter", "clause": "Focus on information from the past three months" },
        { "value": "last-year", "label": "Last Year", "clause": "Focus on information from the past year" },
        { "value": "historical", "label": "Historical / All Time", "clause": "Include historical context and long-term trends" }
      ]
    },
    {
      "key": "citations",
      "label": "Citations",
      "row": 2,
      "options": [
        { "value": "inline", "label": "Inline Citations", "clause": "Include inline citations for all claims and data points" },
        { "value": "footnotes", "label": "Footnotes", "clause": "Provide footnotes with source references" },
        { "value": "bibliography", "label": "Bibliography", "clause": "Include a bibliography of all sources at the end" },
        { "value": "links", "label": "Links Only", "clause": "Provide direct links to sources where possible" },
        { "value": "none", "label": "No Citations", "clause": "" }
      ]
    },
    {
      "key": "format",
      "label": "Response Format",
      "row": 3,
      "options": [
        { "value": "paragraphs", "label": "Paragraphs", "clause": "Format the response in well-structured paragraphs" },
        { "value": "bullet-points", "label": "Bullet Points", "clause": "Format the response as organized bullet points" },
        { "value": "numbered-list", "label": "Numbered List", "clause": "Format the response as a numbered list" },
        { "value": "table", "label": "Table Format", "clause": "Present the information in a structured table format" },
        { "value": "q-and-a", "label": "Q&A Format", "clause": "Structure the response as a Q&A format" }
      ]
    },
    {
      "key": "length",
      "label": "Response Length / Depth",
      "row": 3,
      "options": [
        { "value": "brief", "label": "Brief (1-2 paragraphs)", "clause": "Keep the response brief — 1 to 2 paragraphs" },
        { "value": "moderate", "label": "Moderate", "clause": "Provide a moderately detailed response" },
        { "value": "detailed", "label": "Detailed", "clause": "Provide a detailed, thorough response" },
        { "value": "comprehensive", "label": "Comprehensive / In-Depth", "clause": "Provide a comprehensive, in-depth response covering all relevant aspects" }
      ]
    },
    {
      "key": "audience",
      "label": "Expertise / Audience Level",
      "row": 3,
      "options": [
        { "value": "beginner", "label": "Beginner", "clause": "Write for a beginner audience with no prior knowledge assumed" },
        { "value": "intermediate", "label": "Intermediate", "clause": "Write for an audience with intermediate knowledge of the subject" },
        { "value": "expert", "label": "Expert / Technical", "clause": "Write for an expert audience comfortable with technical details" },
        { "value": "general", "label": "General Public", "clause": "Write for a general audience in accessible language" }
      ]
    },
    {
      "key": "tone",
      "label": "Tone / Style of Response",
      "row": 3,
      "options": [
        { "value": "professional", "label": "Professional", "clause": "Use a professional tone throughout your response" },
        { "value": "conversational", "label": "Conversational", "clause": "Write in a conversational, approachable style" },
        { "value": "academic", "label": "Academic", "clause": "Use an academic, scholarly tone" },
        { "value": "journalistic", "label": "Journalistic", "clause": "Write in an objective, journalistic style" },
        { "value": "neutral", "label": "Neutral / Balanced", "clause": "Maintain a strictly neutral and balanced perspective" }
      ]
    },
    {
      "key": "geographic",
      "label": "Geographic Focus",
      "row": 4,
      "options": [
        { "value": "us", "label": "United States", "clause": "Focus on the United States context and perspective" },
        { "value": "europe", "label": "Europe", "clause": "Focus on the European context and perspective" },
        { "value": "asia", "label": "Asia", "clause": "Focus on the Asian context and perspective" },
        { "value": "global", "label": "Global", "clause": "Provide a global perspective covering multiple regions" },
        { "value": "local", "label": "Local / Regional", "clause": "Focus on local and regional developments" }
      ]
    }
  ],
  "baseTemplate": "Provide a comprehensive overview of {primary_topic}, covering key concepts, recent developments, and important context.",
  "secondaryTopicClause": "Also consider the intersection with {secondary_topic}.",
  "closingLine": "Focus on delivering substantive, well-organized knowledge."
}
```

- [ ] **Step 7: Create `assets/logo.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none">
  <circle cx="20" cy="20" r="18" fill="#3d4f6f" stroke="#2d3748" stroke-width="2"/>
  <path d="M14 20 L20 12 L26 20 M20 12 L20 28" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>
```

- [ ] **Step 8: Create skeleton `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Standard Topic — News, Resources and AI Knowledge</title>
  <meta name="description" content="News, Resources and AI Knowledge. On any topic.">
  <link rel="stylesheet" href="css/styles.css">
  <link rel="icon" href="assets/logo.svg" type="image/svg+xml">
</head>
<body>
  <div id="app">
    <header id="site-header"></header>
    <div id="sub-header"></div>
    <main id="content"></main>
    <footer id="site-footer"></footer>
  </div>

  <script src="https://widget.rss.app/v1/wall.js" type="text/javascript" async></script>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 9: Create skeleton `css/styles.css`**

```css
/* === Reset & Base === */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --color-primary: #3d4f6f;
  --color-primary-dark: #2d3748;
  --color-primary-light: #5a6f8f;
  --color-bg: #ffffff;
  --color-bg-light: #f7f8fa;
  --color-bg-muted: #f0f4f8;
  --color-text: #2d3748;
  --color-text-muted: #718096;
  --color-text-light: #a0aec0;
  --color-border: #e2e8f0;
  --color-border-light: #f0f0f0;
  --color-accent: #eef2ff;
  --color-danger: #e53e3e;
  --color-success: #38a169;
  --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --max-width: 900px;
  --header-height: 60px;
}

body {
  font-family: var(--font-family);
  color: var(--color-text);
  background: var(--color-bg);
  line-height: 1.6;
}

a {
  color: var(--color-primary);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

#app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

#content {
  flex: 1;
  max-width: var(--max-width);
  width: 100%;
  margin: 0 auto;
  padding: 1.5rem 1rem;
}
```

- [ ] **Step 10: Create skeleton `js/app.js`**

```js
// Standard Topic — Main Application
import { initRouter } from './utils/router.js';

document.addEventListener('DOMContentLoaded', () => {
  initRouter();
});
```

- [ ] **Step 11: Commit scaffolding**

```bash
git add .gitignore index.html css/styles.css js/app.js assets/logo.svg data/
git commit -m "feat: scaffold project with data files, index.html, and base CSS"
```

---

### Task 2: Router & Data Utilities

**Files:**
- Create: `js/utils/router.js`
- Create: `js/utils/data.js`
- Create: `js/utils/ai-models.js`

- [ ] **Step 1: Create `js/utils/router.js`**

```js
// Hash-based SPA router

let currentRoute = null;
let routeHandler = null;

export function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

export function onRoute(handler) {
  routeHandler = handler;
}

export function navigate(hash) {
  window.location.hash = hash;
}

function handleRoute() {
  const hash = window.location.hash || '#/';
  const parsed = parseRoute(hash);
  currentRoute = parsed;
  if (routeHandler) {
    routeHandler(parsed);
  }
}

function parseRoute(hash) {
  const path = hash.replace(/^#\/?/, '');
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 0) {
    return { type: 'home', slug: 'home', tab: 'newsfeed' };
  }

  if (segments[0] === 'topic' && segments[1]) {
    const tab = segments[2] === 'shortcuts' ? 'shortcuts'
              : segments[2] === 'related' ? 'related'
              : 'newsfeed';
    return { type: 'topic', slug: segments[1], tab };
  }

  if (segments[0] === 'custom' && segments[1]) {
    return { type: 'custom', term: decodeURIComponent(segments[1]) };
  }

  if (segments[0] === 'prompt-generator') {
    return { type: 'prompt-generator' };
  }

  if (segments[0] === 'about') {
    return { type: 'about' };
  }

  return { type: 'not-found', path };
}

export function getCurrentRoute() {
  return currentRoute;
}
```

- [ ] **Step 2: Create `js/utils/data.js`**

```js
// Data loading and querying utilities

let topicsData = null;
let evergreenShortcuts = null;
let specificShortcuts = null;
let modelsData = null;
let promptGenData = null;

export async function loadAllData() {
  const [topics, evergreen, specific, models, promptGen] = await Promise.all([
    fetchJSON('data/topics.json'),
    fetchJSON('data/shortcuts-evergreen.json'),
    fetchJSON('data/shortcuts-specific.json'),
    fetchJSON('data/ai-models.json'),
    fetchJSON('data/prompt-generator.json'),
  ]);
  topicsData = topics;
  evergreenShortcuts = evergreen;
  specificShortcuts = specific;
  modelsData = models;
  promptGenData = promptGen;
}

async function fetchJSON(path) {
  const res = await fetch(path);
  return res.json();
}

export function getAllTopics() {
  return topicsData?.topics || [];
}

export function getTopicBySlug(slug) {
  return getAllTopics().find(t => t.slug === slug) || null;
}

export function getParentTopics() {
  return getAllTopics().filter(t => t.parent === null && t.slug !== 'home');
}

export function getSubtopics(parentSlug) {
  return getAllTopics().filter(t => t.parent === parentSlug);
}

export function getSiblings(topic) {
  if (!topic.parent) return [];
  return getAllTopics().filter(t => t.parent === topic.parent && t.slug !== topic.slug);
}

export function getRelatedTopics(topic) {
  const related = [];

  if (topic.slug === 'home') {
    // Homepage: show all parent topics as "Featured Topics"
    return getParentTopics();
  }

  if (topic.parent) {
    // Subtopic: show parent + siblings + parent's relatedParents
    const parent = getTopicBySlug(topic.parent);
    if (parent) {
      related.push({ ...parent, isParent: true });
      const parentRelated = (parent.relatedParents || [])
        .map(slug => getTopicBySlug(slug))
        .filter(Boolean);
      related.push(...parentRelated);
    }
    related.push(...getSiblings(topic));
  } else {
    // Parent topic: show subtopics + relatedParents
    related.push(...getSubtopics(topic.slug));
    const linkedParents = (topic.relatedParents || [])
      .map(slug => getTopicBySlug(slug))
      .filter(Boolean);
    related.push(...linkedParents);
  }

  return related;
}

export function getEvergreenShortcuts(topic) {
  const all = evergreenShortcuts?.shortcuts || [];
  const excludeIds = topic?.excludeEvergreen || [];
  return all.filter(s => !excludeIds.includes(s.id));
}

export function getSpecificShortcuts(topicSlug) {
  const all = specificShortcuts?.shortcuts || [];
  return all.filter(s => s.topics.includes(topicSlug));
}

export function getModels() {
  return modelsData?.models || [];
}

export function getDefaultModelId() {
  return modelsData?.defaultModel || 'chatgpt';
}

export function getModelById(id) {
  return getModels().find(m => m.id === id) || null;
}

export function getPromptGenData() {
  return promptGenData;
}

// Group topics by parent for the search modal browse view
export function getTopicsGroupedByParent() {
  const parents = getParentTopics();
  return parents.map(parent => ({
    parent,
    subtopics: getSubtopics(parent.slug),
  }));
}

// Search topics by name (for the search modal)
export function searchTopics(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return getAllTopics()
    .filter(t => t.slug !== 'home' && t.name.toLowerCase().includes(q))
    .map(t => ({
      ...t,
      parentName: t.parent ? getTopicBySlug(t.parent)?.name || null : null,
    }));
}
```

- [ ] **Step 3: Create `js/utils/ai-models.js`**

```js
// AI model URL building and prompt submission

const STORAGE_KEY = 'standardtopic_preferred_model';
const MAX_URL_LENGTH = 2000;

export function getPreferredModelId(defaultId) {
  return localStorage.getItem(STORAGE_KEY) || defaultId;
}

export function setPreferredModelId(modelId) {
  localStorage.setItem(STORAGE_KEY, modelId);
}

export function buildPromptUrl(model, prompt) {
  const encoded = encodeURIComponent(prompt);
  const url = model.urlTemplate.replace('{prompt}', encoded);
  return url;
}

export function isUrlTooLong(model, prompt) {
  if (model.method === 'clipboard') return false;
  const url = buildPromptUrl(model, prompt);
  return url.length > MAX_URL_LENGTH;
}

export async function submitPrompt(model, prompt) {
  if (model.method === 'clipboard') {
    await navigator.clipboard.writeText(prompt);
    window.open(model.urlTemplate, '_blank');
    return { method: 'clipboard', copied: true };
  }

  const url = buildPromptUrl(model, prompt);
  window.open(url, '_blank');
  return { method: 'url', url };
}

export function fillPromptTemplate(template, topicName) {
  return template.replace(/\{topic\}/g, topicName);
}
```

- [ ] **Step 4: Verify modules load**

Update `js/app.js`:

```js
import { initRouter, onRoute } from './utils/router.js';
import { loadAllData } from './utils/data.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  onRoute((route) => {
    console.log('Route:', route);
  });
  initRouter();
});
```

Run: `npx serve . -p 8000` and open `http://localhost:8000`. Open browser console.

Expected: `Route: {type: "home", slug: "home", tab: "newsfeed"}` in console. Navigate to `http://localhost:8000/#/topic/technology` and see `Route: {type: "topic", slug: "technology", tab: "newsfeed"}`.

- [ ] **Step 5: Commit**

```bash
git add js/utils/ js/app.js
git commit -m "feat: add hash router, data loader, and AI model utilities"
```

---

### Task 3: Header & Footer Components

**Files:**
- Create: `js/components/header.js`
- Create: `js/components/footer.js`
- Modify: `js/app.js`
- Modify: `css/styles.css`

- [ ] **Step 1: Create `js/components/header.js`**

```js
// Site header component

export function renderHeader(container) {
  container.innerHTML = `
    <div class="header-inner">
      <a href="#/" class="header-logo">
        <img src="assets/logo.svg" alt="Standard Topic" class="header-logo-img">
        <span class="header-title">Standard Topic</span>
      </a>
      <span class="header-tagline">News, Resources and AI Knowledge. On any topic.</span>
      <a href="#/prompt-generator" class="header-prompt-btn" id="header-prompt-btn">
        <span class="header-prompt-btn-full">Prompt Generator +</span>
        <span class="header-prompt-btn-short">Build Prompt +</span>
      </a>
    </div>
  `;
}

export function updateHeaderActiveState(route) {
  const btn = document.getElementById('header-prompt-btn');
  if (!btn) return;
  btn.classList.toggle('active', route.type === 'prompt-generator');
}
```

- [ ] **Step 2: Create `js/components/footer.js`**

```js
// Site footer component

export function renderFooter(container) {
  container.innerHTML = `
    <div class="footer-inner">
      <div class="footer-logo">
        <img src="assets/logo.svg" alt="Standard Topic" class="footer-logo-img">
        <span class="footer-title">Standard Topic</span>
      </div>
      <nav class="footer-nav">
        <a href="#/">Home</a>
        <a href="#/prompt-generator">Build a Prompt</a>
        <a href="#/about">About</a>
      </nav>
    </div>
  `;
}
```

- [ ] **Step 3: Add header and footer styles to `css/styles.css`**

Append to `css/styles.css`:

```css
/* === Header === */
#site-header {
  background: var(--color-primary);
  color: white;
}

.header-inner {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 1rem;
  height: var(--header-height);
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: white;
  text-decoration: none;
  flex-shrink: 0;
}

.header-logo:hover {
  text-decoration: none;
}

.header-logo-img {
  width: 32px;
  height: 32px;
}

.header-title {
  font-size: 1.2rem;
  font-weight: 700;
}

.header-tagline {
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.85rem;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-prompt-btn {
  background: transparent;
  color: white;
  border: 1.5px solid rgba(255, 255, 255, 0.6);
  padding: 0.4rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.2s, border-color 0.2s;
  flex-shrink: 0;
}

.header-prompt-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: white;
  text-decoration: none;
}

.header-prompt-btn.active {
  background: rgba(255, 255, 255, 0.2);
  border-color: white;
}

.header-prompt-btn-short {
  display: none;
}

/* === Footer === */
#site-footer {
  background: var(--color-primary-dark);
  color: var(--color-text-light);
  margin-top: auto;
}

.footer-inner {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 1.5rem 1rem;
}

.footer-logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.footer-logo-img {
  width: 24px;
  height: 24px;
}

.footer-title {
  font-weight: 600;
  color: white;
}

.footer-nav {
  display: flex;
  gap: 1.5rem;
}

.footer-nav a {
  color: var(--color-text-light);
  font-size: 0.85rem;
}

.footer-nav a:hover {
  color: white;
}

/* === Mobile === */
@media (max-width: 768px) {
  .header-tagline {
    display: none;
  }

  .header-prompt-btn-full {
    display: none;
  }

  .header-prompt-btn-short {
    display: inline;
  }
}
```

- [ ] **Step 4: Wire header and footer into `js/app.js`**

```js
import { initRouter, onRoute } from './utils/router.js';
import { loadAllData } from './utils/data.js';
import { renderHeader, updateHeaderActiveState } from './components/header.js';
import { renderFooter } from './components/footer.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();

  renderHeader(document.getElementById('site-header'));
  renderFooter(document.getElementById('site-footer'));

  onRoute((route) => {
    updateHeaderActiveState(route);
    renderPage(route);
  });

  initRouter();
});

function renderPage(route) {
  const content = document.getElementById('content');
  content.innerHTML = `<p>Route: ${route.type} / ${route.slug || route.term || ''}</p>`;
}
```

- [ ] **Step 5: Verify in browser**

Run: `npx serve . -p 8000` and open `http://localhost:8000`.

Expected: Dark blue header with logo, title, tagline, and "Prompt Generator +" button. Dark footer with logo, Home, Build a Prompt, About links. Content area shows route debug text. On mobile viewport, tagline hides and button shows "Build Prompt +".

- [ ] **Step 6: Commit**

```bash
git add js/components/header.js js/components/footer.js js/app.js css/styles.css
git commit -m "feat: add header and footer components with responsive styles"
```

---

### Task 4: Tabs Component & Sub-Header

**Files:**
- Create: `js/components/tabs.js`
- Modify: `js/app.js`
- Modify: `css/styles.css`

- [ ] **Step 1: Create `js/components/tabs.js`**

```js
// Tab pills component (News Feed / AI Shortcuts / Related Topics)

import { navigate } from '../utils/router.js';

const TAB_CONFIGS = {
  home: [
    { id: 'newsfeed', label: 'News Feed', hash: '#/' },
    { id: 'shortcuts', label: 'AI Shortcuts', hash: '#/shortcuts' },
    { id: 'related', label: 'Featured Topics', hash: '#/related' },
  ],
  topic: (slug) => [
    { id: 'newsfeed', label: 'News Feed', hash: `#/topic/${slug}` },
    { id: 'shortcuts', label: 'AI Shortcuts', hash: `#/topic/${slug}/shortcuts` },
    { id: 'related', label: 'Related Topics', hash: `#/topic/${slug}/related` },
  ],
};

export function renderTabs(container, route) {
  if (route.type === 'home') {
    container.innerHTML = buildTabsHTML(TAB_CONFIGS.home, route.tab);
    attachTabListeners(container);
    return;
  }

  if (route.type === 'topic') {
    const tabs = TAB_CONFIGS.topic(route.slug);
    container.innerHTML = buildTabsHTML(tabs, route.tab);
    attachTabListeners(container);
    return;
  }

  // No tabs for custom, prompt-generator, about, not-found
  container.innerHTML = '';
}

function buildTabsHTML(tabs, activeTab) {
  const tabsHTML = tabs.map(t => `
    <a href="${t.hash}" class="tab-pill ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">
      ${t.label}
    </a>
  `).join('');

  return `<div class="tabs-row">${tabsHTML}</div>`;
}

function attachTabListeners(container) {
  container.querySelectorAll('.tab-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(pill.getAttribute('href'));
    });
  });
}
```

- [ ] **Step 2: Add sub-header and tabs styles to `css/styles.css`**

Append to `css/styles.css`:

```css
/* === Sub-Header === */
#sub-header {
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
  position: sticky;
  top: 0;
  z-index: 90;
}

.sub-header-inner {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

/* === Tabs === */
.tabs-row {
  display: flex;
  gap: 0.5rem;
}

.tab-pill {
  padding: 0.4rem 1rem;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text);
  background: var(--color-bg-light);
  border: 1px solid var(--color-border);
  text-decoration: none;
  transition: background 0.2s, color 0.2s;
  white-space: nowrap;
}

.tab-pill:hover {
  background: var(--color-bg-muted);
  text-decoration: none;
}

.tab-pill.active {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

@media (max-width: 768px) {
  .sub-header-inner {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }

  .tabs-row {
    justify-content: stretch;
  }

  .tab-pill {
    flex: 1;
    text-align: center;
  }
}
```

- [ ] **Step 3: Update `js/app.js` to render sub-header with tabs**

```js
import { initRouter, onRoute } from './utils/router.js';
import { loadAllData } from './utils/data.js';
import { renderHeader, updateHeaderActiveState } from './components/header.js';
import { renderFooter } from './components/footer.js';
import { renderTabs } from './components/tabs.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();

  renderHeader(document.getElementById('site-header'));
  renderFooter(document.getElementById('site-footer'));

  onRoute((route) => {
    updateHeaderActiveState(route);
    renderSubHeader(route);
    renderPage(route);
  });

  initRouter();
});

function renderSubHeader(route) {
  const subHeader = document.getElementById('sub-header');
  // Build sub-header with search bar placeholder + tabs
  subHeader.innerHTML = '<div class="sub-header-inner" id="sub-header-inner"></div>';
  const inner = document.getElementById('sub-header-inner');

  // Search bar placeholder (will be built in Task 7)
  const searchPlaceholder = document.createElement('div');
  searchPlaceholder.id = 'search-bar-container';
  inner.appendChild(searchPlaceholder);

  // Tabs
  const tabsContainer = document.createElement('div');
  tabsContainer.id = 'tabs-container';
  inner.appendChild(tabsContainer);
  renderTabs(tabsContainer, route);
}

function renderPage(route) {
  const content = document.getElementById('content');
  content.innerHTML = `<p>Page: ${route.type} | ${route.slug || route.term || ''} | tab: ${route.tab || 'none'}</p>`;
}
```

- [ ] **Step 4: Verify in browser**

Open `http://localhost:8000`. Expected: Three pill tabs (News Feed active, AI Shortcuts, Featured Topics) below header. Click "AI Shortcuts" — URL changes to `#/shortcuts`, pill becomes active. Navigate to `#/topic/technology` — tabs show with "Related Topics" instead of "Featured Topics". Navigate to `#/prompt-generator` — tabs disappear.

- [ ] **Step 5: Commit**

```bash
git add js/components/tabs.js js/app.js css/styles.css
git commit -m "feat: add tab pills component with active state and responsive layout"
```

---

### Task 5: News Feed Component

**Files:**
- Create: `js/components/newsfeed.js`
- Modify: `js/app.js`
- Modify: `css/styles.css`

- [ ] **Step 1: Create `js/components/newsfeed.js`**

```js
// News Feed component — renders RSS.app iframe embed

export function renderNewsFeed(container, topic, isHome) {
  const title = isHome ? 'General News Feed' : 'News Feed';
  const feedId = topic?.rssFeedId;

  if (!feedId) {
    container.innerHTML = `
      <div class="section-header">
        <span class="section-icon">📡</span>
        <h2>${title}</h2>
      </div>
      <div class="newsfeed-placeholder">
        <p>News feed coming soon for this topic.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="section-header">
      <span class="section-icon">📡</span>
      <h2>${title}</h2>
    </div>
    <div class="newsfeed-embed">
      <rssapp-wall id="${feedId}"></rssapp-wall>
    </div>
  `;
}
```

- [ ] **Step 2: Add news feed styles to `css/styles.css`**

Append to `css/styles.css`:

```css
/* === Section Headers === */
.section-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.section-header h2 {
  font-size: 1.25rem;
  font-weight: 700;
}

.section-icon {
  font-size: 1.25rem;
}

/* === News Feed === */
.newsfeed-embed {
  background: var(--color-primary-dark);
  border-radius: 8px;
  min-height: 400px;
  overflow: hidden;
}

.newsfeed-placeholder {
  background: var(--color-bg-light);
  border-radius: 8px;
  padding: 3rem;
  text-align: center;
  color: var(--color-text-muted);
  min-height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

- [ ] **Step 3: Wire news feed into `renderPage` in `js/app.js`**

Replace the `renderPage` function in `js/app.js`:

```js
import { renderNewsFeed } from './components/newsfeed.js';
import { getTopicBySlug } from './utils/data.js';

// ... (keep existing imports and DOMContentLoaded)

function renderPage(route) {
  const content = document.getElementById('content');
  content.innerHTML = '';

  if (route.type === 'home') {
    const topic = getTopicBySlug('home');
    if (route.tab === 'newsfeed') {
      renderNewsFeed(content, topic, true);
    } else {
      content.innerHTML = `<p>Tab: ${route.tab} (coming next)</p>`;
    }
    return;
  }

  if (route.type === 'topic') {
    const topic = getTopicBySlug(route.slug);
    if (!topic) {
      content.innerHTML = `
        <div class="not-found">
          <h2>Topic not found</h2>
          <p>The topic "${route.slug}" doesn't exist. <a href="#/">Go home</a></p>
        </div>
      `;
      return;
    }
    if (route.tab === 'newsfeed') {
      renderNewsFeed(content, topic, false);
    } else {
      content.innerHTML = `<p>Tab: ${route.tab} (coming next)</p>`;
    }
    return;
  }

  if (route.type === 'custom') {
    content.innerHTML = `<p>Custom topic: ${route.term} (coming next)</p>`;
    return;
  }

  if (route.type === 'prompt-generator') {
    content.innerHTML = `<p>Prompt Generator (coming next)</p>`;
    return;
  }

  if (route.type === 'about') {
    content.innerHTML = `<p>About page (coming next)</p>`;
    return;
  }

  content.innerHTML = `
    <div class="not-found">
      <h2>Page not found</h2>
      <p><a href="#/">Go home</a></p>
    </div>
  `;
}
```

- [ ] **Step 4: Verify in browser**

Open `http://localhost:8000`. Expected: "General News Feed" header with placeholder message (since rssFeedId is empty). Navigate to `#/topic/technology` — shows "News Feed" with same placeholder. The RSS embed will render once real feed IDs are added.

- [ ] **Step 5: Commit**

```bash
git add js/components/newsfeed.js js/app.js css/styles.css
git commit -m "feat: add news feed component with RSS embed and placeholder states"
```

---

### Task 6: AI Shortcuts Component

**Files:**
- Create: `js/components/shortcuts.js`
- Modify: `js/app.js`
- Modify: `css/styles.css`

- [ ] **Step 1: Create `js/components/shortcuts.js`**

```js
// AI Shortcuts grid component

import { getEvergreenShortcuts, getSpecificShortcuts, getTopicBySlug } from '../utils/data.js';
import { fillPromptTemplate } from '../utils/ai-models.js';

export function renderShortcuts(container, route) {
  const isCustom = route.type === 'custom';
  const topicName = isCustom ? route.term : (getTopicBySlug(route.slug)?.name || route.slug);
  const topic = isCustom ? null : getTopicBySlug(route.slug);

  const title = isCustom
    ? `AI Shortcuts for <em>${escapeHTML(route.term)}</em>`
    : 'AI Shortcuts';

  let html = `
    <div class="section-header">
      <span class="section-icon">⚡</span>
      <h2>${title}</h2>
    </div>
  `;

  // Evergreen shortcuts
  const evergreen = isCustom
    ? getEvergreenShortcuts(null)
    : getEvergreenShortcuts(topic);

  if (evergreen.length > 0) {
    html += `<div class="shortcuts-grid">`;
    evergreen.forEach(shortcut => {
      const prompt = fillPromptTemplate(shortcut.prompt, topicName);
      html += buildShortcutCard(shortcut, prompt);
    });
    html += `</div>`;
  }

  // Topic-specific shortcuts (only for dedicated topics)
  if (!isCustom && route.slug !== 'home') {
    const specific = getSpecificShortcuts(route.slug);
    if (specific.length > 0) {
      html += `
        <h3 class="shortcuts-section-label">Topic-Specific Shortcuts</h3>
        <div class="shortcuts-grid">
      `;
      specific.forEach(shortcut => {
        const prompt = fillPromptTemplate(shortcut.prompt, topicName);
        html += buildShortcutCard(shortcut, prompt);
      });
      html += `</div>`;
    }
  }

  container.innerHTML = html;

  // Attach click listeners
  container.querySelectorAll('.shortcut-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt;
      const name = card.dataset.name;
      // Opens prompt modal (will be wired in Task 8)
      window.dispatchEvent(new CustomEvent('open-prompt-modal', {
        detail: { prompt, name },
      }));
    });
  });
}

function buildShortcutCard(shortcut, prompt) {
  return `
    <button class="shortcut-card" data-prompt="${escapeAttr(prompt)}" data-name="${escapeAttr(shortcut.name)}">
      <span class="shortcut-icon">${getIconEmoji(shortcut.icon)}</span>
      <span class="shortcut-name">${escapeHTML(shortcut.name)}</span>
    </button>
  `;
}

function getIconEmoji(icon) {
  const map = {
    'zap': '⚡', 'globe': '🌍', 'cpu': '🤖', 'trending-up': '📈',
    'calendar': '📅', 'rocket': '🚀', 'microscope': '🔬', 'landmark': '🏛️',
    'trophy': '🏆', 'leaf': '🌿', 'heart': '❤️', 'bar-chart': '📊',
    'tool': '🔧', 'laptop': '💻', 'flask': '🧪', 'briefcase': '💼',
    'home': '🏠',
  };
  return map[icon] || '🔗';
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 2: Add shortcuts grid styles to `css/styles.css`**

Append to `css/styles.css`:

```css
/* === AI Shortcuts === */
.shortcuts-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.shortcut-card {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  text-align: left;
  font-size: 0.85rem;
  font-family: var(--font-family);
  color: var(--color-text);
}

.shortcut-card:hover {
  background: var(--color-bg-light);
  border-color: var(--color-primary-light);
}

.shortcut-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.shortcut-name {
  font-weight: 500;
}

.shortcuts-section-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-muted);
  margin: 1rem 0 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

@media (max-width: 768px) {
  .shortcuts-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 3: Wire shortcuts into `renderPage` in `js/app.js`**

Add the import at the top of `js/app.js`:

```js
import { renderShortcuts } from './components/shortcuts.js';
```

Update the tab rendering in `renderPage` — replace the `content.innerHTML = `<p>Tab: ${route.tab} (coming next)</p>`;` lines for both `home` and `topic` types:

For `home`:
```js
if (route.tab === 'shortcuts') {
  renderShortcuts(content, { type: 'home', slug: 'home' });
} else if (route.tab === 'related') {
  content.innerHTML = `<p>Featured Topics (coming next)</p>`;
}
```

For `topic`:
```js
if (route.tab === 'shortcuts') {
  renderShortcuts(content, route);
} else if (route.tab === 'related') {
  content.innerHTML = `<p>Related Topics (coming next)</p>`;
}
```

For `custom`:
```js
if (route.type === 'custom') {
  renderShortcuts(content, route);
  return;
}
```

- [ ] **Step 4: Verify in browser**

Open `http://localhost:8000` and click "AI Shortcuts" tab. Expected: Grid of 11 shortcut cards (evergreen) in 3 columns with icons and names. Navigate to `#/topic/artificial-intelligence` and click AI Shortcuts — should also show "AI Tools Roundup" under "Topic-Specific Shortcuts". Navigate to `#/custom/quantum+computing` — shows "AI Shortcuts for *quantum computing*" with evergreen shortcuts only. On mobile, cards stack to single column.

- [ ] **Step 5: Commit**

```bash
git add js/components/shortcuts.js js/app.js css/styles.css
git commit -m "feat: add AI shortcuts grid with evergreen and topic-specific sections"
```

---

### Task 7: Search Modal Component

**Files:**
- Create: `js/components/search-modal.js`
- Modify: `js/app.js`
- Modify: `css/styles.css`

- [ ] **Step 1: Create `js/components/search-modal.js`**

```js
// Topic search/browse modal

import { getTopicsGroupedByParent, searchTopics, getTopicBySlug } from '../utils/data.js';
import { navigate } from '../utils/router.js';

let isOpen = false;
let highlightIndex = -1;
let currentResults = [];

export function renderSearchBar(container, route) {
  let label = 'Search any topic or choose from list';
  if (route.type === 'topic') {
    const topic = getTopicBySlug(route.slug);
    if (topic) label = topic.name;
  } else if (route.type === 'custom') {
    label = route.term;
  }

  container.innerHTML = `
    <div class="search-bar-wrapper">
      <button class="search-bar" id="search-bar-trigger">
        <span class="search-bar-label" id="search-bar-label">${escapeHTML(label)}</span>
        <span class="search-bar-chevron">▾</span>
      </button>
      <div class="search-modal" id="search-modal" style="display:none;">
        <div class="search-modal-input-row">
          <span class="search-modal-icon">🔍</span>
          <input type="text" class="search-modal-input" id="search-modal-input"
                 placeholder="Search any topic or choose from list" autocomplete="off">
        </div>
        <div class="search-modal-results" id="search-modal-results"></div>
      </div>
    </div>
  `;

  const trigger = document.getElementById('search-bar-trigger');
  const modal = document.getElementById('search-modal');
  const input = document.getElementById('search-modal-input');
  const results = document.getElementById('search-modal-results');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    openModal(modal, input, results);
  });

  input.addEventListener('input', () => {
    highlightIndex = -1;
    renderResults(results, input.value);
  });

  input.addEventListener('keydown', (e) => {
    handleKeyboard(e, results, input);
  });

  document.addEventListener('click', (e) => {
    if (isOpen && !modal.contains(e.target) && e.target !== trigger) {
      closeModal(modal);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      closeModal(modal);
    }
  });
}

function openModal(modal, input, results) {
  isOpen = true;
  highlightIndex = -1;
  modal.style.display = 'block';
  input.value = '';
  input.focus();
  renderResults(results, '');
}

function closeModal(modal) {
  isOpen = false;
  modal.style.display = 'none';
}

function renderResults(container, query) {
  const q = query.trim();

  if (q.length === 0) {
    renderBrowseList(container);
    return;
  }

  renderSearchResults(container, q);
}

function renderBrowseList(container) {
  const groups = getTopicsGroupedByParent();
  let html = '';

  groups.forEach(group => {
    html += `
      <div class="search-result-header" data-slug="${group.parent.slug}" role="button" tabindex="0">
        ${escapeHTML(group.parent.name)}
      </div>
    `;
    group.subtopics.forEach(sub => {
      html += `
        <div class="search-result-item" data-slug="${sub.slug}" role="button" tabindex="0">
          ${escapeHTML(sub.name)}
        </div>
      `;
    });
  });

  container.innerHTML = html;
  currentResults = [];

  // Attach click listeners
  container.querySelectorAll('[data-slug]').forEach(el => {
    el.addEventListener('click', () => {
      navigate(`#/topic/${el.dataset.slug}`);
      closeModal(document.getElementById('search-modal'));
    });
  });
}

function renderSearchResults(container, query) {
  let html = '';

  // "Add as Custom Topic" always first
  html += `
    <div class="search-result-custom" id="search-custom-option" role="button" tabindex="0">
      <span class="search-custom-badge">+</span>
      Add "<strong>${escapeHTML(query)}</strong>" as Custom Topic
    </div>
  `;

  const matches = searchTopics(query);
  currentResults = [
    { type: 'custom', term: query },
    ...matches.map(m => ({ type: 'topic', slug: m.slug })),
  ];

  if (matches.length > 0) {
    html += `<div class="search-result-section-label">Matching Topics</div>`;
    matches.forEach(match => {
      const parentLabel = match.parentName
        ? `<span class="search-result-parent">in ${escapeHTML(match.parentName)}</span>`
        : '';
      html += `
        <div class="search-result-item" data-slug="${match.slug}" role="button" tabindex="0">
          ${highlightMatch(match.name, query)} ${parentLabel}
        </div>
      `;
    });
  }

  container.innerHTML = html;

  // Attach click on custom option
  document.getElementById('search-custom-option')?.addEventListener('click', () => {
    navigate(`#/custom/${encodeURIComponent(query)}`);
    closeModal(document.getElementById('search-modal'));
  });

  // Attach click on topic results
  container.querySelectorAll('.search-result-item[data-slug]').forEach(el => {
    el.addEventListener('click', () => {
      navigate(`#/topic/${el.dataset.slug}`);
      closeModal(document.getElementById('search-modal'));
    });
  });

  updateHighlight(container);
}

function handleKeyboard(e, results, input) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlightIndex = Math.min(highlightIndex + 1, currentResults.length - 1);
    updateHighlight(results);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlightIndex = Math.max(highlightIndex - 1, 0);
    updateHighlight(results);
  } else if (e.key === 'Enter' && highlightIndex >= 0 && currentResults[highlightIndex]) {
    e.preventDefault();
    const selected = currentResults[highlightIndex];
    if (selected.type === 'custom') {
      navigate(`#/custom/${encodeURIComponent(selected.term)}`);
    } else {
      navigate(`#/topic/${selected.slug}`);
    }
    closeModal(document.getElementById('search-modal'));
  }
}

function updateHighlight(container) {
  const items = container.querySelectorAll('.search-result-custom, .search-result-item[data-slug]');
  items.forEach((el, i) => {
    el.classList.toggle('highlighted', i === highlightIndex);
  });
}

function highlightMatch(name, query) {
  const idx = name.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHTML(name);
  const before = name.slice(0, idx);
  const match = name.slice(idx, idx + query.length);
  const after = name.slice(idx + query.length);
  return `${escapeHTML(before)}<strong>${escapeHTML(match)}</strong>${escapeHTML(after)}`;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```

- [ ] **Step 2: Add search modal styles to `css/styles.css`**

Append to `css/styles.css`:

```css
/* === Search Bar === */
.search-bar-wrapper {
  position: relative;
  flex: 0 0 280px;
}

.search-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  cursor: pointer;
  font-family: var(--font-family);
  font-size: 0.85rem;
  color: var(--color-text-muted);
  transition: border-color 0.2s;
}

.search-bar:hover {
  border-color: var(--color-primary-light);
}

.search-bar-chevron {
  font-size: 0.75rem;
  color: var(--color-text-light);
}

/* === Search Modal === */
.search-modal {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-top: none;
  border-radius: 0 0 8px 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 100;
  max-height: 400px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.search-modal-input-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border-bottom: 1px solid var(--color-border-light);
}

.search-modal-icon {
  font-size: 0.9rem;
  color: var(--color-text-light);
}

.search-modal-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 0.9rem;
  font-family: var(--font-family);
  color: var(--color-text);
}

.search-modal-input::placeholder {
  color: var(--color-text-light);
}

.search-modal-results {
  overflow-y: auto;
  max-height: 340px;
}

.search-result-header {
  padding: 0.5rem 0.75rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  color: var(--color-text-muted);
  font-weight: 700;
  background: var(--color-bg-light);
  letter-spacing: 0.04em;
  cursor: pointer;
}

.search-result-header:hover {
  background: var(--color-bg-muted);
}

.search-result-item {
  padding: 0.5rem 0.75rem 0.5rem 1.5rem;
  font-size: 0.85rem;
  cursor: pointer;
  border-bottom: 1px solid var(--color-border-light);
}

.search-result-item:hover,
.search-result-item.highlighted {
  background: var(--color-accent);
}

.search-result-parent {
  color: var(--color-text-light);
  font-size: 0.75rem;
  margin-left: 0.5rem;
}

.search-result-custom {
  padding: 0.6rem 0.75rem;
  font-size: 0.85rem;
  cursor: pointer;
  border-bottom: 1px solid var(--color-border-light);
  background: var(--color-accent);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.search-result-custom:hover,
.search-result-custom.highlighted {
  background: #dde4f8;
}

.search-custom-badge {
  background: var(--color-primary);
  color: white;
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 700;
}

.search-result-section-label {
  padding: 0.4rem 0.75rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  color: var(--color-text-muted);
  font-weight: 700;
  background: var(--color-bg-light);
  letter-spacing: 0.04em;
}

@media (max-width: 768px) {
  .search-bar-wrapper {
    flex: 1 1 100%;
  }

  .search-modal {
    position: fixed;
    top: auto;
    left: 0;
    right: 0;
    border-radius: 0;
    max-height: 60vh;
  }
}
```

- [ ] **Step 3: Wire search bar into sub-header in `js/app.js`**

Add import to `js/app.js`:

```js
import { renderSearchBar } from './components/search-modal.js';
```

In the `renderSubHeader` function, replace the search placeholder block:

```js
// Search bar
const searchContainer = document.createElement('div');
searchContainer.id = 'search-bar-container';
inner.appendChild(searchContainer);
renderSearchBar(searchContainer, route);
```

- [ ] **Step 4: Verify in browser**

Open `http://localhost:8000`. Click the search bar — modal opens with browse list showing parent topics as headers and subtopics indented below. Type "art" — shows "Add as Custom Topic" at top, and "Artificial Intelligence" matched below with "in Technology" label. Click a topic — navigates to it. Press Escape — modal closes. Use arrow keys + Enter for keyboard nav. Navigate to `#/topic/technology` — search bar shows "Technology".

- [ ] **Step 5: Commit**

```bash
git add js/components/search-modal.js js/app.js css/styles.css
git commit -m "feat: add search modal with browse list, filtering, and keyboard navigation"
```

---

### Task 8: Prompt Preview Modal

**Files:**
- Create: `js/components/prompt-modal.js`
- Modify: `js/app.js`
- Modify: `css/styles.css`

- [ ] **Step 1: Create `js/components/prompt-modal.js`**

```js
// Prompt preview + AI model selection modal

import { getModels, getDefaultModelId, getModelById } from '../utils/data.js';
import { getPreferredModelId, setPreferredModelId, submitPrompt, isUrlTooLong, buildPromptUrl } from '../utils/ai-models.js';

let modalEl = null;

export function initPromptModal() {
  // Create modal container once
  modalEl = document.createElement('div');
  modalEl.className = 'prompt-modal-overlay';
  modalEl.id = 'prompt-modal-overlay';
  modalEl.style.display = 'none';
  document.body.appendChild(modalEl);

  // Listen for open events
  window.addEventListener('open-prompt-modal', (e) => {
    openModal(e.detail.prompt, e.detail.name);
  });

  // Close on overlay click
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalEl.style.display !== 'none') {
      closeModal();
    }
  });
}

function openModal(prompt, shortcutName) {
  const models = getModels();
  const defaultId = getDefaultModelId();
  const preferredId = getPreferredModelId(defaultId);
  let selectedModelId = preferredId;

  renderModalContent(prompt, shortcutName, models, selectedModelId);
  modalEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalEl.style.display = 'none';
  document.body.style.overflow = '';
}

function renderModalContent(prompt, shortcutName, models, selectedModelId) {
  const selectedModel = getModelById(selectedModelId) || models[0];
  const tooLong = isUrlTooLong(selectedModel, prompt);

  const submitLabel = selectedModel.method === 'clipboard'
    ? `Copy & Open ${selectedModel.name} →`
    : `Open in ${selectedModel.name} →`;

  modalEl.innerHTML = `
    <div class="prompt-modal">
      <div class="prompt-modal-header">
        <h3>Submit Prompt</h3>
        <button class="prompt-modal-close" id="prompt-modal-close">✕</button>
      </div>

      <div class="prompt-modal-section">
        <label class="prompt-modal-label">Prompt Preview</label>
        <div class="prompt-modal-preview" id="prompt-modal-preview">${escapeHTML(prompt)}</div>
      </div>

      <div class="prompt-modal-copy-row">
        <button class="prompt-modal-copy-btn" id="prompt-modal-copy">📋 Copy Prompt Text</button>
      </div>

      <div class="prompt-modal-section">
        <label class="prompt-modal-label">Choose AI Model</label>
        <div class="prompt-modal-models" id="prompt-modal-models">
          ${models.map(m => `
            <button class="prompt-modal-model-btn ${m.id === selectedModelId ? 'selected' : ''}"
                    data-model-id="${m.id}">
              ${escapeHTML(m.name)}${m.method === 'clipboard' ? ' <span class="model-copy-tag">(copy)</span>' : ''}
            </button>
          `).join('')}
        </div>
      </div>

      ${tooLong ? `
        <div class="prompt-modal-warning">
          This prompt may be too long to submit via URL. Use "Copy Prompt Text" and then "Open Model" to manually paste it.
        </div>
      ` : ''}

      <button class="prompt-modal-submit" id="prompt-modal-submit">
        ${submitLabel}
      </button>

      <p class="prompt-modal-disclaimer">
        Standard Topic is not responsible for actions taken once you leave this site. You will be redirected to a third-party AI platform.
      </p>
    </div>
  `;

  // Close button
  document.getElementById('prompt-modal-close').addEventListener('click', closeModal);

  // Copy button
  document.getElementById('prompt-modal-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(prompt);
    const btn = document.getElementById('prompt-modal-copy');
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy Prompt Text'; }, 2000);
  });

  // Model selection
  document.getElementById('prompt-modal-models').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-model-id]');
    if (!btn) return;
    selectedModelId = btn.dataset.modelId;
    setPreferredModelId(selectedModelId);
    renderModalContent(prompt, shortcutName, models, selectedModelId);
  });

  // Submit
  document.getElementById('prompt-modal-submit').addEventListener('click', async () => {
    const model = getModelById(selectedModelId);
    await submitPrompt(model, prompt);
    closeModal();
  });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```

- [ ] **Step 2: Add prompt modal styles to `css/styles.css`**

Append to `css/styles.css`:

```css
/* === Prompt Preview Modal === */
.prompt-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.prompt-modal {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  width: 100%;
  max-width: 520px;
  max-height: 90vh;
  overflow-y: auto;
}

.prompt-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.25rem;
}

.prompt-modal-header h3 {
  font-size: 1.15rem;
  font-weight: 700;
}

.prompt-modal-close {
  background: none;
  border: none;
  font-size: 1.25rem;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 0.25rem;
}

.prompt-modal-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  color: var(--color-text-muted);
  font-weight: 700;
  display: block;
  margin-bottom: 0.4rem;
  letter-spacing: 0.04em;
}

.prompt-modal-section {
  margin-bottom: 1.25rem;
}

.prompt-modal-preview {
  background: var(--color-bg-light);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 1rem;
  font-size: 0.9rem;
  line-height: 1.6;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
}

.prompt-modal-copy-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 1.25rem;
}

.prompt-modal-copy-btn {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 0.35rem 0.75rem;
  font-size: 0.8rem;
  color: var(--color-text-muted);
  cursor: pointer;
  font-family: var(--font-family);
  transition: border-color 0.2s;
}

.prompt-modal-copy-btn:hover {
  border-color: var(--color-primary-light);
}

.prompt-modal-models {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.prompt-modal-model-btn {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0.5rem;
  text-align: center;
  font-size: 0.8rem;
  cursor: pointer;
  font-family: var(--font-family);
  color: var(--color-text-muted);
  background: white;
  transition: border-color 0.15s, background 0.15s;
}

.prompt-modal-model-btn:hover {
  border-color: var(--color-primary-light);
}

.prompt-modal-model-btn.selected {
  border: 2px solid var(--color-primary);
  background: var(--color-accent);
  color: var(--color-primary);
  font-weight: 600;
}

.model-copy-tag {
  font-size: 0.65rem;
  color: var(--color-text-light);
}

.prompt-modal-warning {
  background: #fffbeb;
  border: 1px solid #f6e05e;
  border-radius: 6px;
  padding: 0.6rem 0.75rem;
  font-size: 0.8rem;
  color: #744210;
  margin-bottom: 1rem;
  line-height: 1.5;
}

.prompt-modal-submit {
  width: 100%;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 0.75rem;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  font-family: var(--font-family);
  margin-bottom: 0.75rem;
  transition: background 0.2s;
}

.prompt-modal-submit:hover {
  background: var(--color-primary-dark);
}

.prompt-modal-disclaimer {
  font-size: 0.7rem;
  color: var(--color-text-light);
  text-align: center;
  line-height: 1.5;
}

@media (max-width: 768px) {
  .prompt-modal {
    max-width: 100%;
    border-radius: 12px 12px 0 0;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
  }

  .prompt-modal-models {
    grid-template-columns: repeat(2, 1fr);
  }
}
```

- [ ] **Step 3: Initialize prompt modal in `js/app.js`**

Add import:
```js
import { initPromptModal } from './components/prompt-modal.js';
```

In `DOMContentLoaded`, after `loadAllData()`:
```js
initPromptModal();
```

- [ ] **Step 4: Verify in browser**

Navigate to `#/` and click AI Shortcuts tab. Click any shortcut card. Expected: Modal opens with prompt preview showing the prompt text, Copy button, 6 AI model buttons in a grid (ChatGPT selected by default), "Open in ChatGPT →" submit button, and disclaimer. Click "Claude" — button label changes to "Copy & Open Claude →", Claude shows "(copy)" tag. Click "Copy Prompt Text" — changes to "Copied!" briefly. Press Escape or click overlay — modal closes.

- [ ] **Step 5: Commit**

```bash
git add js/components/prompt-modal.js js/app.js css/styles.css
git commit -m "feat: add prompt preview modal with model selection and submission"
```

---

### Task 9: Related Topics Component

**Files:**
- Create: `js/components/related-topics.js`
- Modify: `js/app.js`
- Modify: `css/styles.css`

- [ ] **Step 1: Create `js/components/related-topics.js`**

```js
// Related Topics grid component

import { getRelatedTopics, getTopicBySlug } from '../utils/data.js';

export function renderRelatedTopics(container, route) {
  const isHome = route.type === 'home';
  const topic = getTopicBySlug(route.slug);
  const title = isHome ? 'Featured Topics' : 'Related Topics';

  if (!topic) {
    container.innerHTML = `
      <div class="section-header">
        <span class="section-icon">🔗</span>
        <h2>${title}</h2>
      </div>
      <p class="related-empty">No related topics yet.</p>
    `;
    return;
  }

  const related = getRelatedTopics(topic);

  let html = `
    <div class="section-header">
      <span class="section-icon">🔗</span>
      <h2>${title}</h2>
    </div>
  `;

  if (related.length === 0) {
    html += `<p class="related-empty">No related topics yet.</p>`;
    container.innerHTML = html;
    return;
  }

  html += `<div class="related-grid">`;

  // If on a parent topic page (not home), show self as "Active Page"
  if (!isHome && !topic.parent) {
    html += `
      <div class="related-card active-page">
        <span class="related-dot"></span>
        <span class="related-name">${escapeHTML(topic.name)}</span>
        <span class="related-active-label">Active Page</span>
      </div>
    `;
  }

  related.forEach(r => {
    html += `
      <a href="#/topic/${r.slug}" class="related-card">
        <span class="related-dot"></span>
        <span class="related-name">${escapeHTML(r.name)}</span>
        <span class="related-arrow">↗</span>
      </a>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```

- [ ] **Step 2: Add related topics styles to `css/styles.css`**

Append to `css/styles.css`:

```css
/* === Related Topics === */
.related-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.related-card {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  text-decoration: none;
  color: var(--color-text);
  transition: background 0.15s, border-color 0.15s;
}

.related-card:hover {
  background: var(--color-bg-light);
  border-color: var(--color-primary-light);
  text-decoration: none;
}

.related-card.active-page {
  background: var(--color-bg-light);
  cursor: default;
}

.related-card.active-page:hover {
  border-color: var(--color-border);
}

.related-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-primary);
  flex-shrink: 0;
}

.related-name {
  flex: 1;
  font-size: 0.85rem;
  font-weight: 500;
}

.related-arrow {
  color: var(--color-text-light);
  font-size: 0.9rem;
}

.related-active-label {
  font-size: 0.7rem;
  color: var(--color-text-light);
  font-style: italic;
}

.related-empty {
  color: var(--color-text-muted);
  text-align: center;
  padding: 2rem;
}

@media (max-width: 768px) {
  .related-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 3: Wire related topics into `renderPage` in `js/app.js`**

Add import:
```js
import { renderRelatedTopics } from './components/related-topics.js';
```

Replace the `related` tab handling for both `home` and `topic` in `renderPage`:

For `home`:
```js
} else if (route.tab === 'related') {
  renderRelatedTopics(content, { type: 'home', slug: 'home' });
}
```

For `topic`:
```js
} else if (route.tab === 'related') {
  renderRelatedTopics(content, route);
}
```

- [ ] **Step 4: Verify in browser**

Navigate to `#/` and click "Featured Topics". Expected: Grid of parent topics (Technology, Science, Business) as clickable cards with dots and arrows. Navigate to `#/topic/technology` → Related Topics tab — shows Technology as "Active Page" (not clickable), plus subtopics (AI, Cybersecurity) and related parent (Science). Navigate to `#/topic/artificial-intelligence` → Related Topics — shows Technology (parent, clickable), Cybersecurity (sibling), and Science (parent's related). On mobile, cards stack to single column.

- [ ] **Step 5: Commit**

```bash
git add js/components/related-topics.js js/app.js css/styles.css
git commit -m "feat: add related topics grid with hierarchy-based derivation"
```

---

### Task 10: Knowledge Prompt Generator Page

**Files:**
- Create: `js/components/prompt-generator.js`
- Modify: `js/app.js`
- Modify: `css/styles.css`

- [ ] **Step 1: Create `js/components/prompt-generator.js`**

```js
// Knowledge Prompt Generator page

import { getPromptGenData, getModels, getDefaultModelId, getModelById } from '../utils/data.js';
import { getPreferredModelId, setPreferredModelId } from '../utils/ai-models.js';

export function renderPromptGenerator(container) {
  const pgData = getPromptGenData();
  const fields = pgData.fields;
  const models = getModels();

  // Group fields by row
  const rows = {};
  fields.forEach(f => {
    if (!rows[f.row]) rows[f.row] = [];
    rows[f.row].push(f);
  });

  let html = `
    <div class="section-header">
      <span class="section-icon">⚙️</span>
      <h2>AI Knowledge Prompt Generator</h2>
    </div>

    <div class="pg-summary-section">
      <label class="pg-label">Knowledge Prompt Summary</label>
      <div class="pg-summary" id="pg-summary">Select options below to build your prompt...</div>
    </div>

    <div class="pg-form" id="pg-form">
  `;

  // Render rows
  Object.keys(rows).sort().forEach(rowNum => {
    html += `<div class="pg-row">`;
    rows[rowNum].forEach(field => {
      html += renderField(field, models);
    });
    html += `</div>`;
  });

  html += `
    </div>

    <div class="pg-customizations">
      <label class="pg-label">Customizations</label>
      <textarea class="pg-textarea" id="pg-customizations" placeholder="Add additional instructions here"></textarea>
    </div>

    <div class="pg-actions">
      <button class="pg-btn pg-btn-primary" id="pg-submit">Submit Prompt</button>
      <button class="pg-btn pg-btn-secondary" id="pg-copy">Copy Prompt Text</button>
      <button class="pg-btn pg-btn-danger" id="pg-clear">Clear Prompt</button>
      <button class="pg-btn pg-btn-outline" id="pg-open-model">Open Model</button>
    </div>

    <ul class="pg-notes">
      <li>Prompt submission will open a new tab and directly submit or queue a prompt through the chosen AI model/platform.</li>
      <li>Some pre-generated prompts may be too long to submit through this site. You may use the "Copy Prompt" button and then the "Open Model" to manually submit the full prompt.</li>
    </ul>
  `;

  container.innerHTML = html;

  // Live preview updates
  const form = document.getElementById('pg-form');
  const summary = document.getElementById('pg-summary');
  const customizations = document.getElementById('pg-customizations');

  const updatePreview = () => {
    summary.textContent = assemblePrompt(pgData, form, customizations.value);
  };

  form.addEventListener('change', updatePreview);
  customizations.addEventListener('input', updatePreview);

  // Actions
  document.getElementById('pg-submit').addEventListener('click', () => {
    const prompt = assemblePrompt(pgData, form, customizations.value);
    if (!prompt || prompt === pgData.baseTemplate.replace('{primary_topic}', '').trim()) {
      summary.textContent = 'Please fill in at least a Primary Topic to generate a prompt.';
      return;
    }
    window.dispatchEvent(new CustomEvent('open-prompt-modal', {
      detail: { prompt, name: 'Knowledge Prompt' },
    }));
  });

  document.getElementById('pg-copy').addEventListener('click', async () => {
    const prompt = assemblePrompt(pgData, form, customizations.value);
    await navigator.clipboard.writeText(prompt);
    const btn = document.getElementById('pg-copy');
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = 'Copy Prompt Text'; }, 2000);
  });

  document.getElementById('pg-clear').addEventListener('click', () => {
    form.querySelectorAll('select').forEach(s => { s.selectedIndex = 0; });
    form.querySelectorAll('input[type="text"]').forEach(i => { i.value = ''; });
    customizations.value = '';
    summary.textContent = 'Select options below to build your prompt...';
  });

  document.getElementById('pg-open-model').addEventListener('click', () => {
    const modelSelect = form.querySelector('[data-field="model"]');
    const modelId = modelSelect?.value || getPreferredModelId(getDefaultModelId());
    const model = getModelById(modelId);
    if (model) {
      window.open(model.urlTemplate.replace('{prompt}', ''), '_blank');
    }
  });
}

function renderField(field, models) {
  if (field.type === 'model-select') {
    const defaultId = getPreferredModelId(getDefaultModelId());
    const options = models.map(m =>
      `<option value="${m.id}" ${m.id === defaultId ? 'selected' : ''}>${escapeHTML(m.name)}</option>`
    ).join('');
    return `
      <div class="pg-field">
        <label class="pg-field-label">${escapeHTML(field.label)}</label>
        <select class="pg-select" data-field="${field.key}">
          <option value="">Select or type</option>
          ${options}
        </select>
      </div>
    `;
  }

  if (field.type === 'text') {
    return `
      <div class="pg-field">
        <label class="pg-field-label">${escapeHTML(field.label)}</label>
        <input type="text" class="pg-input" data-field="${field.key}" placeholder="${field.placeholder || 'Type here'}">
      </div>
    `;
  }

  // Default: select with options
  const options = (field.options || []).map(o =>
    `<option value="${o.value}">${escapeHTML(o.label)}</option>`
  ).join('');

  return `
    <div class="pg-field">
      <label class="pg-field-label">${escapeHTML(field.label)}</label>
      <select class="pg-select" data-field="${field.key}">
        <option value="">Select here</option>
        ${options}
      </select>
    </div>
  `;
}

function assemblePrompt(pgData, form, customizations) {
  const fields = pgData.fields;
  const primaryInput = form.querySelector('[data-field="primaryTopic"]');
  const secondaryInput = form.querySelector('[data-field="secondaryTopic"]');
  const primaryTopic = primaryInput?.value?.trim() || '';
  const secondaryTopic = secondaryInput?.value?.trim() || '';

  if (!primaryTopic) {
    return pgData.baseTemplate.replace(/\{primary_topic\}/g, '[topic]');
  }

  // Check if any content-type field was selected to use its clause as the opener
  let parts = [];
  let hasContentClause = false;

  fields.forEach(field => {
    if (field.type === 'model-select' || field.type === 'text') return;
    const select = form.querySelector(`[data-field="${field.key}"]`);
    if (!select || !select.value) return;

    const option = (field.options || []).find(o => o.value === select.value);
    if (!option || !option.clause) return;

    const clause = option.clause
      .replace(/\{primary_topic\}/g, primaryTopic)
      .replace(/\{secondary_topic\}/g, secondaryTopic || '[secondary topic]');

    if (field.key === 'contentType') {
      hasContentClause = true;
    }

    parts.push(clause);
  });

  // If no content type clause, use base template
  if (!hasContentClause) {
    parts.unshift(pgData.baseTemplate.replace(/\{primary_topic\}/g, primaryTopic));
  }

  // Add secondary topic clause if provided
  if (secondaryTopic && pgData.secondaryTopicClause) {
    parts.push(pgData.secondaryTopicClause.replace(/\{secondary_topic\}/g, secondaryTopic));
  }

  // Add customizations
  if (customizations.trim()) {
    parts.push('Additional instructions: ' + customizations.trim());
  }

  // Add closing line
  parts.push(pgData.closingLine);

  return parts.join('\n\n');
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```

- [ ] **Step 2: Add prompt generator styles to `css/styles.css`**

Append to `css/styles.css`:

```css
/* === Prompt Generator === */
.pg-summary-section {
  margin-bottom: 1.25rem;
}

.pg-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  color: var(--color-text-muted);
  font-weight: 700;
  display: block;
  margin-bottom: 0.4rem;
  letter-spacing: 0.04em;
}

.pg-summary {
  background: var(--color-bg-light);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0.75rem;
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--color-text-muted);
  min-height: 60px;
  white-space: pre-wrap;
}

.pg-form {
  margin-bottom: 1.25rem;
}

.pg-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.pg-field {
  display: flex;
  flex-direction: column;
}

.pg-field-label {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  font-weight: 600;
  margin-bottom: 0.3rem;
}

.pg-select,
.pg-input {
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 0.5rem;
  font-size: 0.85rem;
  font-family: var(--font-family);
  color: var(--color-text);
  background: white;
  width: 100%;
}

.pg-select:focus,
.pg-input:focus {
  outline: none;
  border-color: var(--color-primary-light);
}

.pg-customizations {
  margin-bottom: 1.25rem;
}

.pg-textarea {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0.75rem;
  font-size: 0.85rem;
  font-family: var(--font-family);
  min-height: 80px;
  resize: vertical;
  color: var(--color-text);
}

.pg-textarea:focus {
  outline: none;
  border-color: var(--color-primary-light);
}

.pg-actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.pg-btn {
  padding: 0.6rem 1rem;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  font-family: var(--font-family);
  border: none;
  transition: background 0.2s;
}

.pg-btn-primary {
  background: var(--color-primary);
  color: white;
}

.pg-btn-primary:hover {
  background: var(--color-primary-dark);
}

.pg-btn-secondary {
  background: var(--color-primary-light);
  color: white;
}

.pg-btn-secondary:hover {
  background: var(--color-primary);
}

.pg-btn-danger {
  background: var(--color-danger);
  color: white;
}

.pg-btn-danger:hover {
  background: #c53030;
}

.pg-btn-outline {
  background: white;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
}

.pg-btn-outline:hover {
  border-color: var(--color-primary-light);
}

.pg-notes {
  font-size: 0.75rem;
  color: var(--color-text-light);
  line-height: 1.6;
  padding-left: 1.25rem;
}

.pg-notes li {
  margin-bottom: 0.25rem;
}

@media (max-width: 992px) {
  .pg-row {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 576px) {
  .pg-row {
    grid-template-columns: 1fr;
  }

  .pg-actions {
    flex-direction: column;
  }

  .pg-btn {
    width: 100%;
    text-align: center;
  }
}
```

- [ ] **Step 3: Wire prompt generator into `renderPage` in `js/app.js`**

Add import:
```js
import { renderPromptGenerator } from './components/prompt-generator.js';
```

Replace the prompt-generator case in `renderPage`:
```js
if (route.type === 'prompt-generator') {
  renderPromptGenerator(content);
  return;
}
```

- [ ] **Step 4: Verify in browser**

Navigate to `#/prompt-generator`. Expected: Form with "Knowledge Prompt Summary" preview at top, 4-column grid of dropdowns, customizations textarea, and 4 action buttons. Type "Climate Change" in Primary Topic — summary updates live. Select a Content Type and Tone — prompt builds up with natural clauses. Click "Submit Prompt" — prompt modal opens with the assembled prompt. Click "Clear Prompt" — resets all fields. On tablet, dropdowns become 2 columns. On mobile, single column.

- [ ] **Step 5: Commit**

```bash
git add js/components/prompt-generator.js js/app.js css/styles.css
git commit -m "feat: add knowledge prompt generator with hybrid assembly and live preview"
```

---

### Task 11: About Page

**Files:**
- Modify: `js/app.js`
- Modify: `css/styles.css`

- [ ] **Step 1: Add about page rendering to `renderPage` in `js/app.js`**

Replace the about case in `renderPage`:

```js
if (route.type === 'about') {
  content.innerHTML = `
    <div class="about-page">
      <div class="section-header">
        <span class="section-icon">ℹ️</span>
        <h2>About Standard Topic</h2>
      </div>

      <div class="about-section">
        <h3>What is Standard Topic?</h3>
        <p>Standard Topic is your hub for news, resources, and AI knowledge on any topic. We maintain a curated library of 100+ topics, each with a dedicated news feed, AI-powered knowledge shortcuts, and connections to related topics.</p>
      </div>

      <div class="about-section">
        <h3>How to Use</h3>
        <ul>
          <li><strong>Browse Topics</strong> — Use the search bar to find a topic from our library, or type in any custom topic.</li>
          <li><strong>News Feed</strong> — Each topic has a curated RSS news feed with the latest articles and coverage.</li>
          <li><strong>AI Shortcuts</strong> — Click any shortcut to send a pre-built prompt to your preferred AI model. Choose from ChatGPT, Gemini, Perplexity, Claude, and more.</li>
          <li><strong>Related Topics</strong> — Discover connected topics through our parent-subtopic hierarchy.</li>
          <li><strong>Prompt Generator</strong> — Build custom knowledge prompts by selecting options for content type, tone, format, and more.</li>
        </ul>
      </div>

      <div class="about-section">
        <h3>Disclaimer</h3>
        <p>Standard Topic provides shortcuts to third-party AI platforms. We are not responsible for the content generated by these platforms or actions taken after leaving this site. AI-generated content should be verified independently.</p>
      </div>
    </div>
  `;
  return;
}
```

- [ ] **Step 2: Add about page styles to `css/styles.css`**

Append to `css/styles.css`:

```css
/* === About Page === */
.about-page {
  max-width: 700px;
}

.about-section {
  margin-bottom: 1.5rem;
}

.about-section h3 {
  font-size: 1rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.about-section p {
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--color-text);
}

.about-section ul {
  padding-left: 1.25rem;
  font-size: 0.9rem;
  line-height: 1.8;
}

.about-section li {
  margin-bottom: 0.25rem;
}

/* === Not Found === */
.not-found {
  text-align: center;
  padding: 3rem 1rem;
}

.not-found h2 {
  margin-bottom: 0.5rem;
}
```

- [ ] **Step 3: Verify in browser**

Navigate to `#/about`. Expected: Clean about page with "What is Standard Topic?", "How to Use", and "Disclaimer" sections. No tabs shown. Footer link "About" also navigates here.

- [ ] **Step 4: Commit**

```bash
git add js/app.js css/styles.css
git commit -m "feat: add about page and not-found styles"
```

---

### Task 12: Full App Wiring & Homepage Tab Routing Fix

**Files:**
- Modify: `js/app.js`
- Modify: `js/utils/router.js`

- [ ] **Step 1: Fix homepage tab routing**

The homepage tabs route to `#/shortcuts` and `#/related` but the router doesn't handle these as home tabs. Update `parseRoute` in `js/utils/router.js`:

```js
function parseRoute(hash) {
  const path = hash.replace(/^#\/?/, '');
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 0) {
    return { type: 'home', slug: 'home', tab: 'newsfeed' };
  }

  // Homepage tabs: #/shortcuts, #/related
  if (segments.length === 1 && (segments[0] === 'shortcuts' || segments[0] === 'related')) {
    return { type: 'home', slug: 'home', tab: segments[0] };
  }

  if (segments[0] === 'topic' && segments[1]) {
    const tab = segments[2] === 'shortcuts' ? 'shortcuts'
              : segments[2] === 'related' ? 'related'
              : 'newsfeed';
    return { type: 'topic', slug: segments[1], tab };
  }

  if (segments[0] === 'custom' && segments[1]) {
    return { type: 'custom', term: decodeURIComponent(segments[1]) };
  }

  if (segments[0] === 'prompt-generator') {
    return { type: 'prompt-generator' };
  }

  if (segments[0] === 'about') {
    return { type: 'about' };
  }

  return { type: 'not-found', path };
}
```

- [ ] **Step 2: Write final `js/app.js` with all imports and complete `renderPage`**

```js
import { initRouter, onRoute } from './utils/router.js';
import { loadAllData, getTopicBySlug } from './utils/data.js';
import { renderHeader, updateHeaderActiveState } from './components/header.js';
import { renderFooter } from './components/footer.js';
import { renderTabs } from './components/tabs.js';
import { renderSearchBar } from './components/search-modal.js';
import { renderNewsFeed } from './components/newsfeed.js';
import { renderShortcuts } from './components/shortcuts.js';
import { renderRelatedTopics } from './components/related-topics.js';
import { renderPromptGenerator } from './components/prompt-generator.js';
import { initPromptModal } from './components/prompt-modal.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  initPromptModal();

  renderHeader(document.getElementById('site-header'));
  renderFooter(document.getElementById('site-footer'));

  onRoute((route) => {
    updateHeaderActiveState(route);
    renderSubHeader(route);
    renderPage(route);
  });

  initRouter();
});

function renderSubHeader(route) {
  const subHeader = document.getElementById('sub-header');
  subHeader.innerHTML = '<div class="sub-header-inner" id="sub-header-inner"></div>';
  const inner = document.getElementById('sub-header-inner');

  const searchContainer = document.createElement('div');
  searchContainer.id = 'search-bar-container';
  inner.appendChild(searchContainer);
  renderSearchBar(searchContainer, route);

  const tabsContainer = document.createElement('div');
  tabsContainer.id = 'tabs-container';
  inner.appendChild(tabsContainer);
  renderTabs(tabsContainer, route);
}

function renderPage(route) {
  const content = document.getElementById('content');
  content.innerHTML = '';

  if (route.type === 'home') {
    const topic = getTopicBySlug('home');
    if (route.tab === 'newsfeed') {
      renderNewsFeed(content, topic, true);
    } else if (route.tab === 'shortcuts') {
      renderShortcuts(content, { type: 'home', slug: 'home' });
    } else if (route.tab === 'related') {
      renderRelatedTopics(content, { type: 'home', slug: 'home' });
    }
    return;
  }

  if (route.type === 'topic') {
    const topic = getTopicBySlug(route.slug);
    if (!topic) {
      content.innerHTML = `
        <div class="not-found">
          <h2>Topic not found</h2>
          <p>The topic "${route.slug}" doesn't exist. <a href="#/">Go home</a></p>
        </div>
      `;
      return;
    }
    if (route.tab === 'newsfeed') {
      renderNewsFeed(content, topic, false);
    } else if (route.tab === 'shortcuts') {
      renderShortcuts(content, route);
    } else if (route.tab === 'related') {
      renderRelatedTopics(content, route);
    }
    return;
  }

  if (route.type === 'custom') {
    renderShortcuts(content, route);
    return;
  }

  if (route.type === 'prompt-generator') {
    renderPromptGenerator(content);
    return;
  }

  if (route.type === 'about') {
    content.innerHTML = `
      <div class="about-page">
        <div class="section-header">
          <span class="section-icon">ℹ️</span>
          <h2>About Standard Topic</h2>
        </div>
        <div class="about-section">
          <h3>What is Standard Topic?</h3>
          <p>Standard Topic is your hub for news, resources, and AI knowledge on any topic. We maintain a curated library of 100+ topics, each with a dedicated news feed, AI-powered knowledge shortcuts, and connections to related topics.</p>
        </div>
        <div class="about-section">
          <h3>How to Use</h3>
          <ul>
            <li><strong>Browse Topics</strong> — Use the search bar to find a topic from our library, or type in any custom topic.</li>
            <li><strong>News Feed</strong> — Each topic has a curated RSS news feed with the latest articles and coverage.</li>
            <li><strong>AI Shortcuts</strong> — Click any shortcut to send a pre-built prompt to your preferred AI model.</li>
            <li><strong>Related Topics</strong> — Discover connected topics through our parent-subtopic hierarchy.</li>
            <li><strong>Prompt Generator</strong> — Build custom knowledge prompts with detailed options.</li>
          </ul>
        </div>
        <div class="about-section">
          <h3>Disclaimer</h3>
          <p>Standard Topic provides shortcuts to third-party AI platforms. We are not responsible for the content generated by these platforms or actions taken after leaving this site. AI-generated content should be verified independently.</p>
        </div>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="not-found">
      <h2>Page not found</h2>
      <p><a href="#/">Go home</a></p>
    </div>
  `;
}
```

- [ ] **Step 3: Verify full app flow in browser**

Open `http://localhost:8000`. Test the complete flow:

1. Homepage loads with "General News Feed" placeholder, tabs show
2. Click "AI Shortcuts" — shows evergreen shortcuts grid
3. Click a shortcut card — prompt modal opens with preview, model selection, submit button
4. Click "Featured Topics" — shows parent topics grid
5. Click "Technology" — navigates to topic page, "News Feed" tab active
6. Click "AI Shortcuts" — shows evergreen + topic-specific
7. Click "Related Topics" — shows Technology (active), subtopics, Science (related)
8. Click "Cybersecurity" — navigates to subtopic page
9. Use search bar — browse list shows, type "art" — matches AI, custom option appears
10. Click "Add as Custom Topic" — navigates to custom page with only shortcuts
11. Click "Prompt Generator +" — prompt generator page loads, fill fields, live preview updates
12. Submit prompt — modal opens
13. Click "About" in footer — about page renders
14. Test on mobile viewport — header condenses, grids stack, search works

- [ ] **Step 4: Commit**

```bash
git add js/app.js js/utils/router.js
git commit -m "feat: complete app wiring with all views and homepage tab routing"
```

---

### Task 13: Admin Page

**Files:**
- Create: `admin/index.html`

- [ ] **Step 1: Create `admin/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Standard Topic — Admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --primary: #3d4f6f;
      --border: #e2e8f0;
      --bg-light: #f7f8fa;
      --text: #2d3748;
      --text-muted: #718096;
      --danger: #e53e3e;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--text); padding: 1rem; max-width: 1000px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    .tabs { display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: 1.5rem; }
    .tab { padding: 0.6rem 1.25rem; font-size: 0.9rem; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; color: var(--text-muted); background: none; border-top: none; border-left: none; border-right: none; font-family: inherit; }
    .tab.active { color: var(--primary); border-bottom-color: var(--primary); font-weight: 600; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .btn { padding: 0.4rem 0.75rem; border-radius: 4px; font-size: 0.85rem; cursor: pointer; border: 1px solid var(--border); font-family: inherit; }
    .btn-primary { background: var(--primary); color: white; border-color: var(--primary); }
    .btn-danger { color: var(--danger); }
    .btn-success { background: #38a169; color: white; border-color: #38a169; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { background: var(--bg-light); text-align: left; padding: 0.5rem 0.75rem; color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--border); }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f0f0f0; }
    .subtopic-row td:first-child { padding-left: 1.5rem; }
    .form-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
    .form-modal { background: white; border-radius: 8px; padding: 1.5rem; width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.3rem; }
    .form-group input, .form-group select, .form-group textarea { width: 100%; border: 1px solid var(--border); border-radius: 4px; padding: 0.5rem; font-size: 0.85rem; font-family: inherit; }
    .form-group textarea { min-height: 80px; resize: vertical; }
    .form-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
    .info-box { background: #fffbeb; border: 1px solid #f6e05e; border-radius: 6px; padding: 0.75rem; font-size: 0.8rem; color: #744210; margin-bottom: 1rem; line-height: 1.5; }
    .import-export { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <h1>Standard Topic — Admin</h1>
  <div class="info-box">
    <strong>Local admin tool.</strong> Import your JSON data files, edit via forms, then export updated JSON. Replace the files in your project and push to GitHub.
  </div>

  <div class="import-export">
    <label class="btn btn-primary" style="cursor:pointer;">
      Import All JSON <input type="file" id="import-files" multiple accept=".json" style="display:none;">
    </label>
    <button class="btn btn-success" id="export-all">Export All JSON</button>
  </div>

  <div class="tabs" id="admin-tabs">
    <button class="tab active" data-tab="topics">Topics</button>
    <button class="tab" data-tab="evergreen">Evergreen Shortcuts</button>
    <button class="tab" data-tab="specific">Topic Shortcuts</button>
    <button class="tab" data-tab="models">AI Models</button>
    <button class="tab" data-tab="promptgen">Prompt Generator</button>
  </div>

  <div class="tab-content active" id="tab-topics">
    <div class="toolbar">
      <h2 style="font-size:1.1rem;">Manage Topics</h2>
      <button class="btn btn-primary" id="add-topic">+ Add Topic</button>
    </div>
    <table id="topics-table">
      <thead><tr><th>Name</th><th>Slug</th><th>Parent</th><th>RSS Feed ID</th><th>Actions</th></tr></thead>
      <tbody id="topics-tbody"></tbody>
    </table>
  </div>

  <div class="tab-content" id="tab-evergreen">
    <div class="toolbar">
      <h2 style="font-size:1.1rem;">Evergreen Shortcuts</h2>
      <button class="btn btn-primary" id="add-evergreen">+ Add Shortcut</button>
    </div>
    <table id="evergreen-table">
      <thead><tr><th>Name</th><th>ID</th><th>Icon</th><th>Actions</th></tr></thead>
      <tbody id="evergreen-tbody"></tbody>
    </table>
  </div>

  <div class="tab-content" id="tab-specific">
    <div class="toolbar">
      <h2 style="font-size:1.1rem;">Topic-Specific Shortcuts</h2>
      <button class="btn btn-primary" id="add-specific">+ Add Shortcut</button>
    </div>
    <table id="specific-table">
      <thead><tr><th>Name</th><th>ID</th><th>Topics</th><th>Actions</th></tr></thead>
      <tbody id="specific-tbody"></tbody>
    </table>
  </div>

  <div class="tab-content" id="tab-models">
    <div class="toolbar">
      <h2 style="font-size:1.1rem;">AI Models</h2>
      <button class="btn btn-primary" id="add-model">+ Add Model</button>
    </div>
    <table id="models-table">
      <thead><tr><th>Name</th><th>ID</th><th>Method</th><th>URL Template</th><th>Actions</th></tr></thead>
      <tbody id="models-tbody"></tbody>
    </table>
  </div>

  <div class="tab-content" id="tab-promptgen">
    <div class="toolbar">
      <h2 style="font-size:1.1rem;">Prompt Generator Options</h2>
    </div>
    <p style="color:var(--text-muted); font-size:0.9rem;">Edit <code>data/prompt-generator.json</code> directly for field options and clause templates. This tab provides a JSON preview.</p>
    <pre id="promptgen-preview" style="background:var(--bg-light); padding:1rem; border-radius:6px; font-size:0.8rem; overflow-x:auto; margin-top:1rem;"></pre>
  </div>

  <div id="form-container"></div>

  <script>
    // Admin page — self-contained client-side tool
    let data = {
      topics: { topics: [] },
      evergreen: { shortcuts: [] },
      specific: { shortcuts: [] },
      models: { models: [], defaultModel: 'chatgpt' },
      promptgen: {},
    };

    const fileMap = {
      'topics.json': 'topics',
      'shortcuts-evergreen.json': 'evergreen',
      'shortcuts-specific.json': 'specific',
      'ai-models.json': 'models',
      'prompt-generator.json': 'promptgen',
    };

    // Tab switching
    document.getElementById('admin-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });

    // Import
    document.getElementById('import-files').addEventListener('change', async (e) => {
      for (const file of e.target.files) {
        const key = fileMap[file.name];
        if (key) {
          data[key] = JSON.parse(await file.text());
        }
      }
      renderAll();
    });

    // Export
    document.getElementById('export-all').addEventListener('click', () => {
      downloadJSON('topics.json', data.topics);
      downloadJSON('shortcuts-evergreen.json', data.evergreen);
      downloadJSON('shortcuts-specific.json', data.specific);
      downloadJSON('ai-models.json', data.models);
      downloadJSON('prompt-generator.json', data.promptgen);
    });

    function downloadJSON(filename, obj) {
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
    }

    function renderAll() {
      renderTopics();
      renderEvergreen();
      renderSpecific();
      renderModels();
      renderPromptGen();
    }

    // --- Topics ---
    function renderTopics() {
      const tbody = document.getElementById('topics-tbody');
      const topics = data.topics.topics || [];
      const parents = topics.filter(t => !t.parent && t.slug !== 'home');
      let html = '';
      // Home topic first
      const home = topics.find(t => t.slug === 'home');
      if (home) {
        html += topicRow(home, false);
      }
      parents.forEach(p => {
        html += topicRow(p, false);
        topics.filter(t => t.parent === p.slug).forEach(sub => {
          html += topicRow(sub, true);
        });
      });
      tbody.innerHTML = html;
      tbody.querySelectorAll('.edit-topic').forEach(btn => {
        btn.addEventListener('click', () => editTopic(btn.dataset.slug));
      });
      tbody.querySelectorAll('.del-topic').forEach(btn => {
        btn.addEventListener('click', () => deleteTopic(btn.dataset.slug));
      });
    }

    function topicRow(t, isSub) {
      return `<tr class="${isSub ? 'subtopic-row' : ''}">
        <td>${isSub ? '↳ ' : ''}${t.name}</td>
        <td style="color:var(--text-muted)">${t.slug}</td>
        <td style="color:var(--text-muted)">${t.parent || '—'}</td>
        <td style="color:var(--text-muted); font-family:monospace; font-size:0.8rem;">${t.rssFeedId || '—'}</td>
        <td>
          <button class="btn edit-topic" data-slug="${t.slug}" style="margin-right:0.25rem;">Edit</button>
          ${t.slug !== 'home' ? `<button class="btn btn-danger del-topic" data-slug="${t.slug}">Del</button>` : ''}
        </td>
      </tr>`;
    }

    document.getElementById('add-topic').addEventListener('click', () => showTopicForm(null));

    function editTopic(slug) {
      const topic = data.topics.topics.find(t => t.slug === slug);
      if (topic) showTopicForm(topic);
    }

    function deleteTopic(slug) {
      if (!confirm('Delete topic "' + slug + '"?')) return;
      data.topics.topics = data.topics.topics.filter(t => t.slug !== slug);
      renderTopics();
    }

    function showTopicForm(topic) {
      const isNew = !topic;
      const parents = data.topics.topics.filter(t => !t.parent && t.slug !== 'home');
      const parentOptions = parents.map(p => `<option value="${p.slug}" ${topic?.parent === p.slug ? 'selected' : ''}>${p.name}</option>`).join('');
      const container = document.getElementById('form-container');
      container.innerHTML = `
        <div class="form-overlay" id="form-overlay">
          <div class="form-modal">
            <h3 style="margin-bottom:1rem;">${isNew ? 'Add' : 'Edit'} Topic</h3>
            <div class="form-group"><label>Name</label><input id="f-name" value="${topic?.name || ''}"></div>
            <div class="form-group"><label>Slug</label><input id="f-slug" value="${topic?.slug || ''}" ${!isNew ? 'readonly style="background:var(--bg-light)"' : ''}></div>
            <div class="form-group"><label>Parent</label><select id="f-parent"><option value="">None (parent topic)</option>${parentOptions}</select></div>
            <div class="form-group"><label>RSS Feed ID</label><input id="f-rss" value="${topic?.rssFeedId || ''}"></div>
            <div class="form-group"><label>Related Parents (comma-separated slugs)</label><input id="f-related" value="${(topic?.relatedParents || []).join(', ')}"></div>
            <div class="form-group"><label>Exclude Evergreen (comma-separated IDs)</label><input id="f-exclude" value="${(topic?.excludeEvergreen || []).join(', ')}"></div>
            <div class="form-group"><label>Icon</label><input id="f-icon" value="${topic?.icon || ''}"></div>
            <div class="form-actions">
              <button class="btn" id="f-cancel">Cancel</button>
              <button class="btn btn-primary" id="f-save">Save</button>
            </div>
          </div>
        </div>
      `;
      document.getElementById('f-cancel').addEventListener('click', () => { container.innerHTML = ''; });
      document.getElementById('form-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) container.innerHTML = ''; });
      document.getElementById('f-save').addEventListener('click', () => {
        const entry = {
          slug: document.getElementById('f-slug').value.trim(),
          name: document.getElementById('f-name').value.trim(),
          parent: document.getElementById('f-parent').value || null,
          rssFeedId: document.getElementById('f-rss').value.trim(),
          excludeEvergreen: document.getElementById('f-exclude').value.split(',').map(s => s.trim()).filter(Boolean),
          relatedParents: document.getElementById('f-related').value.split(',').map(s => s.trim()).filter(Boolean),
          icon: document.getElementById('f-icon').value.trim() || null,
        };
        if (!entry.slug || !entry.name) { alert('Name and slug are required.'); return; }
        if (isNew) {
          if (data.topics.topics.find(t => t.slug === entry.slug)) { alert('Slug already exists.'); return; }
          data.topics.topics.push(entry);
        } else {
          const idx = data.topics.topics.findIndex(t => t.slug === entry.slug);
          if (idx >= 0) data.topics.topics[idx] = entry;
        }
        container.innerHTML = '';
        renderTopics();
      });
    }

    // --- Evergreen Shortcuts ---
    function renderEvergreen() {
      const tbody = document.getElementById('evergreen-tbody');
      const shortcuts = data.evergreen.shortcuts || [];
      tbody.innerHTML = shortcuts.map(s => `<tr>
        <td>${s.name}</td><td style="color:var(--text-muted)">${s.id}</td><td>${s.icon || '—'}</td>
        <td>
          <button class="btn edit-eg" data-id="${s.id}" style="margin-right:0.25rem;">Edit</button>
          <button class="btn btn-danger del-eg" data-id="${s.id}">Del</button>
        </td>
      </tr>`).join('');
      tbody.querySelectorAll('.edit-eg').forEach(btn => btn.addEventListener('click', () => editEvergreen(btn.dataset.id)));
      tbody.querySelectorAll('.del-eg').forEach(btn => btn.addEventListener('click', () => { data.evergreen.shortcuts = data.evergreen.shortcuts.filter(s => s.id !== btn.dataset.id); renderEvergreen(); }));
    }

    document.getElementById('add-evergreen').addEventListener('click', () => showEvergreenForm(null));

    function editEvergreen(id) {
      const s = data.evergreen.shortcuts.find(s => s.id === id);
      if (s) showEvergreenForm(s);
    }

    function showEvergreenForm(shortcut) {
      const isNew = !shortcut;
      const container = document.getElementById('form-container');
      container.innerHTML = `
        <div class="form-overlay" id="form-overlay">
          <div class="form-modal">
            <h3 style="margin-bottom:1rem;">${isNew ? 'Add' : 'Edit'} Evergreen Shortcut</h3>
            <div class="form-group"><label>Name</label><input id="f-name" value="${shortcut?.name || ''}"></div>
            <div class="form-group"><label>ID</label><input id="f-id" value="${shortcut?.id || ''}" ${!isNew ? 'readonly style="background:var(--bg-light)"' : ''}></div>
            <div class="form-group"><label>Icon</label><input id="f-icon" value="${shortcut?.icon || ''}"></div>
            <div class="form-group"><label>Prompt Template</label><textarea id="f-prompt">${shortcut?.prompt || ''}</textarea></div>
            <div class="form-actions">
              <button class="btn" id="f-cancel">Cancel</button>
              <button class="btn btn-primary" id="f-save">Save</button>
            </div>
          </div>
        </div>
      `;
      document.getElementById('f-cancel').addEventListener('click', () => { container.innerHTML = ''; });
      document.getElementById('form-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) container.innerHTML = ''; });
      document.getElementById('f-save').addEventListener('click', () => {
        const entry = { id: document.getElementById('f-id').value.trim(), name: document.getElementById('f-name').value.trim(), icon: document.getElementById('f-icon').value.trim(), prompt: document.getElementById('f-prompt').value };
        if (!entry.id || !entry.name) { alert('Name and ID are required.'); return; }
        if (isNew) { data.evergreen.shortcuts.push(entry); } else { const idx = data.evergreen.shortcuts.findIndex(s => s.id === entry.id); if (idx >= 0) data.evergreen.shortcuts[idx] = entry; }
        container.innerHTML = ''; renderEvergreen();
      });
    }

    // --- Specific Shortcuts ---
    function renderSpecific() {
      const tbody = document.getElementById('specific-tbody');
      const shortcuts = data.specific.shortcuts || [];
      tbody.innerHTML = shortcuts.map(s => `<tr>
        <td>${s.name}</td><td style="color:var(--text-muted)">${s.id}</td><td style="color:var(--text-muted);font-size:0.8rem">${(s.topics||[]).join(', ')}</td>
        <td>
          <button class="btn edit-sp" data-id="${s.id}" style="margin-right:0.25rem;">Edit</button>
          <button class="btn btn-danger del-sp" data-id="${s.id}">Del</button>
        </td>
      </tr>`).join('');
      tbody.querySelectorAll('.edit-sp').forEach(btn => btn.addEventListener('click', () => editSpecific(btn.dataset.id)));
      tbody.querySelectorAll('.del-sp').forEach(btn => btn.addEventListener('click', () => { data.specific.shortcuts = data.specific.shortcuts.filter(s => s.id !== btn.dataset.id); renderSpecific(); }));
    }

    document.getElementById('add-specific').addEventListener('click', () => showSpecificForm(null));

    function editSpecific(id) {
      const s = data.specific.shortcuts.find(s => s.id === id);
      if (s) showSpecificForm(s);
    }

    function showSpecificForm(shortcut) {
      const isNew = !shortcut;
      const container = document.getElementById('form-container');
      container.innerHTML = `
        <div class="form-overlay" id="form-overlay">
          <div class="form-modal">
            <h3 style="margin-bottom:1rem;">${isNew ? 'Add' : 'Edit'} Topic-Specific Shortcut</h3>
            <div class="form-group"><label>Name</label><input id="f-name" value="${shortcut?.name || ''}"></div>
            <div class="form-group"><label>ID</label><input id="f-id" value="${shortcut?.id || ''}" ${!isNew ? 'readonly style="background:var(--bg-light)"' : ''}></div>
            <div class="form-group"><label>Icon</label><input id="f-icon" value="${shortcut?.icon || ''}"></div>
            <div class="form-group"><label>Topics (comma-separated slugs)</label><input id="f-topics" value="${(shortcut?.topics||[]).join(', ')}"></div>
            <div class="form-group"><label>Prompt Template</label><textarea id="f-prompt">${shortcut?.prompt || ''}</textarea></div>
            <div class="form-actions">
              <button class="btn" id="f-cancel">Cancel</button>
              <button class="btn btn-primary" id="f-save">Save</button>
            </div>
          </div>
        </div>
      `;
      document.getElementById('f-cancel').addEventListener('click', () => { container.innerHTML = ''; });
      document.getElementById('form-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) container.innerHTML = ''; });
      document.getElementById('f-save').addEventListener('click', () => {
        const entry = { id: document.getElementById('f-id').value.trim(), name: document.getElementById('f-name').value.trim(), icon: document.getElementById('f-icon').value.trim(), topics: document.getElementById('f-topics').value.split(',').map(s=>s.trim()).filter(Boolean), prompt: document.getElementById('f-prompt').value };
        if (!entry.id || !entry.name) { alert('Name and ID are required.'); return; }
        if (isNew) { data.specific.shortcuts.push(entry); } else { const idx = data.specific.shortcuts.findIndex(s => s.id === entry.id); if (idx >= 0) data.specific.shortcuts[idx] = entry; }
        container.innerHTML = ''; renderSpecific();
      });
    }

    // --- Models ---
    function renderModels() {
      const tbody = document.getElementById('models-tbody');
      const models = data.models.models || [];
      tbody.innerHTML = models.map(m => `<tr>
        <td>${m.name}</td><td style="color:var(--text-muted)">${m.id}</td><td>${m.method}</td><td style="color:var(--text-muted);font-size:0.8rem;max-width:200px;overflow:hidden;text-overflow:ellipsis">${m.urlTemplate}</td>
        <td>
          <button class="btn edit-model" data-id="${m.id}" style="margin-right:0.25rem;">Edit</button>
          <button class="btn btn-danger del-model" data-id="${m.id}">Del</button>
        </td>
      </tr>`).join('');
      tbody.querySelectorAll('.edit-model').forEach(btn => btn.addEventListener('click', () => editModel(btn.dataset.id)));
      tbody.querySelectorAll('.del-model').forEach(btn => btn.addEventListener('click', () => { data.models.models = data.models.models.filter(m => m.id !== btn.dataset.id); renderModels(); }));
    }

    document.getElementById('add-model').addEventListener('click', () => showModelForm(null));

    function editModel(id) {
      const m = data.models.models.find(m => m.id === id);
      if (m) showModelForm(m);
    }

    function showModelForm(model) {
      const isNew = !model;
      const container = document.getElementById('form-container');
      container.innerHTML = `
        <div class="form-overlay" id="form-overlay">
          <div class="form-modal">
            <h3 style="margin-bottom:1rem;">${isNew ? 'Add' : 'Edit'} AI Model</h3>
            <div class="form-group"><label>Name</label><input id="f-name" value="${model?.name || ''}"></div>
            <div class="form-group"><label>ID</label><input id="f-id" value="${model?.id || ''}" ${!isNew ? 'readonly style="background:var(--bg-light)"' : ''}></div>
            <div class="form-group"><label>Icon</label><input id="f-icon" value="${model?.icon || ''}"></div>
            <div class="form-group"><label>URL Template</label><input id="f-url" value="${model?.urlTemplate || ''}"></div>
            <div class="form-group"><label>Method</label><select id="f-method"><option value="url" ${model?.method==='url'?'selected':''}>url</option><option value="clipboard" ${model?.method==='clipboard'?'selected':''}>clipboard</option></select></div>
            <div class="form-actions">
              <button class="btn" id="f-cancel">Cancel</button>
              <button class="btn btn-primary" id="f-save">Save</button>
            </div>
          </div>
        </div>
      `;
      document.getElementById('f-cancel').addEventListener('click', () => { container.innerHTML = ''; });
      document.getElementById('form-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) container.innerHTML = ''; });
      document.getElementById('f-save').addEventListener('click', () => {
        const entry = { id: document.getElementById('f-id').value.trim(), name: document.getElementById('f-name').value.trim(), icon: document.getElementById('f-icon').value.trim(), urlTemplate: document.getElementById('f-url').value, method: document.getElementById('f-method').value };
        if (!entry.id || !entry.name) { alert('Name and ID are required.'); return; }
        if (isNew) { data.models.models.push(entry); } else { const idx = data.models.models.findIndex(m => m.id === entry.id); if (idx >= 0) data.models.models[idx] = entry; }
        container.innerHTML = ''; renderModels();
      });
    }

    // --- Prompt Generator ---
    function renderPromptGen() {
      document.getElementById('promptgen-preview').textContent = JSON.stringify(data.promptgen, null, 2);
    }

    // Initial render
    renderAll();
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify admin page**

Open `admin/index.html` directly in browser (via file:// or local server). Expected: Admin page with tabs for Topics, Evergreen Shortcuts, Topic Shortcuts, AI Models, Prompt Generator. Import the JSON files from `data/` — tables populate. Add a test topic, edit it, delete it. Export JSON and verify the files download correctly.

- [ ] **Step 3: Commit**

```bash
git add admin/
git commit -m "feat: add local-only admin page for managing data via forms"
```

---

### Task 14: GitHub Actions Deployment

**Files:**
- Create: `.github/workflows/deploy.yml`
- Create: `.nojekyll`

- [ ] **Step 1: Create `.nojekyll`**

Empty file in repo root — tells GitHub Pages not to process with Jekyll.

```
```

(Empty file)

- [ ] **Step 2: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [master]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4

      - name: Prepare deployment
        run: |
          mkdir _site
          # Copy everything except admin/, docs/, and dot-files
          rsync -av --exclude='admin/' --exclude='docs/' --exclude='.git/' --exclude='.github/' --exclude='.superpowers/' --exclude='_site/' . _site/

      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Commit**

```bash
git add .nojekyll .github/
git commit -m "feat: add GitHub Actions deployment workflow excluding admin and docs"
```

---

### Task 15: Final Polish & Verification

**Files:**
- Modify: `css/styles.css` (if needed)

- [ ] **Step 1: Full end-to-end verification**

Start local server: `npx serve . -p 8000`

Test every route and interaction:

1. `http://localhost:8000` — Homepage loads, "General News Feed" shows
2. Click each tab — all three work (News Feed, AI Shortcuts, Featured Topics)
3. Click a shortcut → prompt modal opens → select model → submit (opens new tab)
4. Click a featured topic → topic page loads with correct tabs
5. On topic page, test all three tabs
6. Use search bar — browse list works, type to filter, keyboard nav works
7. Click "Add as Custom Topic" → custom page with shortcuts only, no tabs
8. Click "Prompt Generator +" → form renders, live preview works, submit opens modal
9. Click "About" in footer → about page renders
10. Test invalid route (e.g., `#/nonexistent`) → not found page
11. Test missing topic (e.g., `#/topic/fake`) → topic not found page
12. Resize to mobile → header condenses, grids stack, search works
13. Verify localStorage model preference persists across page reloads
14. Open `admin/index.html` → import JSON files, edit, export

- [ ] **Step 2: Commit any final fixes**

```bash
git add -A
git commit -m "fix: final polish and adjustments"
```

(Only if changes were needed)
