// Shared Topic-Intelligence builders — the accordion shell, web-source
// rows, section metadata, group definitions, and the grouping classifier.
// Used by the sidebar (app.js) and the Trending detail modal so both render
// the same accordion structure from one source of truth.

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Per-section accent color, blurb, and inline SVG icon for the accordion
// header. New sections fall back to "more".
export const TI_SECTION_META = {
  websources: {
    accent: '#5d6b7e',
    blurb: 'Search platforms and primary sources.',
    icon: `<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 4 9 14 14 0 0 1-4 9 14 14 0 0 1-4-9 14 14 0 0 1 4-9z"/>`,
  },
  'topic-specific': {
    accent: '#b35a4e',
    blurb: 'Insights tailored to this topic.',
    icon: `<path d="M12 2.5l2.3 6.4 6.7.3-5.3 4.1 1.9 6.5L12 16.2 6.4 19.8l1.9-6.5L3 9.2l6.7-.3z"/>`,
  },
  discover: {
    accent: '#3261a0',
    blurb: 'What\'s happening right now.',
    icon: `<circle cx="12" cy="12" r="9"/><polygon points="16 8 13.5 13.5 8 16 10.5 10.5 16 8"/>`,
  },
  learn: {
    accent: '#2e8a73',
    blurb: 'Background, fundamentals, and context.',
    icon: `<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>`,
  },
  analyze: {
    accent: '#b48528',
    blurb: 'Deeper analytical lenses and tradeoffs.',
    icon: `<line x1="6" y1="20" x2="6" y2="14"/><line x1="12" y1="20" x2="12" y2="9"/><line x1="18" y1="20" x2="18" y2="4"/>`,
  },
  more: {
    accent: '#8a4f7a',
    blurb: 'Other useful prompts.',
    icon: `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>`,
  },
};

export function renderTIAccordion({ key, label, open, bodyHTML, blurb, icon }) {
  const meta = TI_SECTION_META[key] || TI_SECTION_META.more;
  const openAttr = open ? ' open' : '';
  // `blurb`/`icon` override the section defaults; pass blurb='' to hide it.
  const blurbText = blurb !== undefined ? blurb : meta.blurb;
  const iconPaths = icon !== undefined ? icon : meta.icon;
  const blurbHTML = blurbText
    ? `<span class="ti-accordion-blurb">${escapeHTML(blurbText)}</span>`
    : '';
  return `
    <details class="ti-accordion" data-section="${escapeAttr(key)}" style="--ti-accent: ${meta.accent};"${openAttr}>
      <summary class="ti-accordion-summary">
        <span class="ti-accordion-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            ${iconPaths}
          </svg>
        </span>
        <span class="ti-accordion-title">${escapeHTML(label)}</span>
        <span class="ti-accordion-chev" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </span>
        ${blurbHTML}
      </summary>
      <div class="ti-accordion-body">
        ${bodyHTML}
      </div>
    </details>
  `;
}

// Web source row — title + description, anchor link to the external search
// URL with {query} substituted by the (encoded) term.
export function webSourceItem(search, topicName) {
  const url = search.urlTemplate.replace(/\{query\}/g, encodeURIComponent(topicName));
  const description = search.description
    ? `<span class="ti-item-desc">${escapeHTML(search.description)}</span>`
    : '';
  return `
    <li class="ti-item-row">
      <a class="ti-item ti-item-link"
         href="${url}"
         target="_blank"
         rel="noopener noreferrer"
         data-name="${escapeAttr(search.name)}"
         title="Open ${escapeAttr(search.name)} search">
        <span class="ti-item-name">${escapeHTML(search.name)}</span>
        ${description}
      </a>
    </li>
  `;
}

// Default group set when admin-managed groups aren't present. The "more"
// internal key maps to the "More" group id.
export const DEFAULT_GROUP_DEFS = [
  { id: 'topic-specific', label: 'Topic-Specific Insights', order: 0, color: '#b35a4e' },
  { id: 'discover', label: 'Discover', order: 1, color: '#3261a0' },
  { id: 'learn',    label: 'Learn',    order: 2, color: '#2e8a73' },
  { id: 'analyze',  label: 'Analysis',  order: 3, color: '#b48528' },
  { id: 'more',     label: 'More',     order: 4, color: '#8a4f7a' },
];

// `overrideMap` (optional) is a per-topic { shortcutId: groupId } map that
// re-buckets shortcuts into a different section than their global `group`.
export function groupShortcuts(shortcuts, overrideMap = {}) {
  const groupDefs = (window.__assignmentsData && Array.isArray(window.__assignmentsData.groups) && window.__assignmentsData.groups.length)
    ? window.__assignmentsData.groups.slice()
    : DEFAULT_GROUP_DEFS.slice();
  groupDefs.sort((a, b) => (a.order || 0) - (b.order || 0));

  const groups = {};
  groupDefs.forEach(g => { groups[g.id] = []; });

  const learnRE = /(guide|glossary|beginner|primer|fundamentals|basics|deep ?dive|history|background|key players|key terms|how |where to|why )/i;
  const analyzeRE = /(analy|impact|affect|hype|reality|compare| vs | versus |implications|outcome|signal|forecast|prediction|risk|controversy|debate)/i;
  const discoverRE = /(news|snapshot|update|headline|trend|watch|latest|now|today|roundup|hot|spotlight|brief|digest)/i;
  shortcuts.forEach(s => {
    const override = overrideMap && overrideMap[s.id];
    if (override && groups[override]) {
      groups[override].push(s);
      return;
    }
    if (s.group && groups[s.group]) {
      groups[s.group].push(s);
      return;
    }
    const name = s.name || '';
    if (learnRE.test(name) && groups.learn) groups.learn.push(s);
    else if (analyzeRE.test(name) && groups.analyze) groups.analyze.push(s);
    else if (discoverRE.test(name) && groups.discover) groups.discover.push(s);
    else if (groups['topic-specific']) groups['topic-specific'].push(s);
    else if (groups.more) groups.more.push(s);
    else if (groups.other) groups.other.push(s);
    else {
      const first = groupDefs[0];
      if (first) groups[first.id].push(s);
    }
  });
  groups.__order = groupDefs.map(g => ({ key: g.id, label: g.label }));
  return groups;
}
