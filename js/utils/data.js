// Data loading and querying utilities

let topicsData = null;
let shortcutsDirectory = null;
let shortcutsAssignments = null;
let modelsData = null;
let promptGenData = null;
let externalSearchesData = null;
let trending101Data = null;

// Legacy references kept for compatibility
let evergreenShortcuts = null;
let specificShortcuts = null;

export async function loadAllData() {
  const [topics, directory, assignments, models, promptGen, externalSearches, trending101] = await Promise.all([
    fetchJSON('data/topics.json'),
    fetchJSON('data/shortcuts-directory.json'),
    fetchJSON('data/shortcuts-assignments.json'),
    fetchJSON('data/ai-models.json'),
    fetchJSON('data/prompt-generator.json'),
    fetchJSON('data/external-searches.json').catch(() => ({ searches: [] })),
    fetchJSON('data/shortcuts-trending101.json').catch(() => ({ shortcuts: [] })),
  ]);
  topicsData = topics;
  shortcutsDirectory = directory;
  shortcutsAssignments = assignments;
  modelsData = models;
  promptGenData = promptGen;
  externalSearchesData = externalSearches;
  trending101Data = trending101;
  // Expose the assignments blob (with its `groups` definitions) on
  // window so groupShortcuts() in app.js can resolve the admin-
  // managed group set without an extra import wiring.
  if (typeof window !== 'undefined') {
    window.__assignmentsData = assignments;
  }
}

export function getExternalSearches() {
  return externalSearchesData?.searches || [];
}

// Admin-managed "Trending 101" shortcuts shown only in the trending modal.
export function getTrending101() {
  return trending101Data?.shortcuts || [];
}

// Evergreen shortcuts as a generic-term list (for the modal's Trending
// Intelligence), ordered by evergreenOrder — the same evergreen selection
// the custom-search page uses, with no topic context or exclusions.
export function getTrendingIntelligenceShortcuts() {
  const dir = shortcutsDirectory?.shortcuts || [];
  const orderIdx = new Map((shortcutsAssignments?.evergreenOrder || []).map((id, i) => [id, i]));
  return dir.filter(s => s.evergreen)
    .sort((a, b) => (orderIdx.has(a.id) ? orderIdx.get(a.id) : 1e9) - (orderIdx.has(b.id) ? orderIdx.get(b.id) : 1e9));
}

export function getExternalSearchCategories() {
  return externalSearchesData?.categories || [];
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

export function getFeaturedTopics() {
  const featured = getAllTopics().filter(t => t.parent === null && t.slug !== 'home' && t.featured === true);
  const order = topicsData?.featuredOrder;
  if (!Array.isArray(order) || order.length === 0) return featured;
  const bySlug = new Map(featured.map(t => [t.slug, t]));
  const ordered = order.map(slug => bySlug.get(slug)).filter(Boolean);
  const seen = new Set(ordered.map(t => t.slug));
  featured.forEach(t => { if (!seen.has(t.slug)) ordered.push(t); });
  return ordered;
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
    return getParentTopics();
  }

  if (topic.parent) {
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
    related.push(...getSubtopics(topic.slug));
    const linkedParents = (topic.relatedParents || [])
      .map(slug => getTopicBySlug(slug))
      .filter(Boolean);
    related.push(...linkedParents);
  }

  return related;
}

// Pure selector — all inputs explicit so it runs under Node with no DOM/fetch.
// Topic-specific shortcuts first (assignment order), then evergreen shortcuts in
// the global evergreenOrder, minus this topic's exclusions. Home gets no evergreen
// injection (it has no single topic for the {topic} placeholder). Deduped by id.
export function selectShortcutsForTopic({ directory, assignments, evergreenOrder, evergreenExclusions, topicSlug }) {
  const dirMap = {};
  (directory || []).forEach(s => { dirMap[s.id] = s; });
  const ids = (assignments && (assignments[topicSlug] || assignments['_custom'])) || [];
  const list = ids.map(id => dirMap[id]).filter(Boolean);

  if (topicSlug !== 'home') {
    const have = new Set(list.map(s => s.id));
    const excluded = new Set((evergreenExclusions && evergreenExclusions[topicSlug]) || []);
    const orderIdx = new Map((evergreenOrder || []).map((id, i) => [id, i]));
    const evergreens = (directory || [])
      .filter(s => s.evergreen && !have.has(s.id) && !excluded.has(s.id))
      .sort((a, b) => (orderIdx.has(a.id) ? orderIdx.get(a.id) : 1e9) - (orderIdx.has(b.id) ? orderIdx.get(b.id) : 1e9));
    evergreens.forEach(s => { list.push(s); have.add(s.id); });
  }
  return list;
}

export function getShortcutsForTopic(topicSlug) {
  return selectShortcutsForTopic({
    directory: shortcutsDirectory?.shortcuts || [],
    assignments: shortcutsAssignments?.assignments || {},
    evergreenOrder: shortcutsAssignments?.evergreenOrder || [],
    evergreenExclusions: shortcutsAssignments?.evergreenExclusions || {},
    topicSlug,
  });
}

// Preview/teaser shortcuts for a track CARD (Choose-a-track surfaces). Returns up
// to `limit` shortcut objects for (topic, group): admin-curated picks first
// (per-topic key `${slug}_${group}`, else the evergreen-group default `${group}`),
// then filled from the topic's own shortcuts in that group so a card is never empty.
export function getTrackPreviewShortcuts(topicSlug, group, limit = 3) {
  const dir = shortcutsDirectory?.shortcuts || [];
  const dirMap = {};
  dir.forEach((s) => { dirMap[s.id] = s; });
  const featured = (shortcutsAssignments && shortcutsAssignments.featuredShortcuts) || {};
  const ids = featured[`${topicSlug}_${group}`] || featured[group] || [];
  const list = ids.map((id) => dirMap[id]).filter(Boolean);
  if (list.length < limit) {
    const have = new Set(list.map((s) => s.id));
    const inGroup = getShortcutsForTopic(topicSlug).filter((s) => s.group === group && !have.has(s.id));
    for (const s of inGroup) { if (list.length >= limit) break; list.push(s); have.add(s.id); }
  }
  return list.slice(0, limit);
}

export function getEvergreenOrder() {
  return shortcutsAssignments?.evergreenOrder || [];
}

export function getEvergreenExclusions() {
  return shortcutsAssignments?.evergreenExclusions || {};
}

/**
 * Get the full shortcuts directory (for admin panel).
 */
export function getShortcutsDirectory() {
  return shortcutsDirectory?.shortcuts || [];
}

/**
 * Get the full assignments object (for admin panel).
 */
export function getShortcutsAssignments() {
  return shortcutsAssignments?.assignments || {};
}

// Legacy compatibility wrappers
export function getEvergreenShortcuts() { return []; }
export function getSpecificShortcuts() { return []; }

export function getAllShortcutIconKeys() {
  const all = shortcutsDirectory?.shortcuts || [];
  const keys = new Set();
  all.forEach(s => { if (s.icon) keys.add(s.icon); });
  return [...keys];
}

export function getModels() {
  return modelsData?.models || [];
}

export function getSubmissionMethods() {
  return modelsData?.submissionMethods || {};
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

export function getTopicsGroupedByParent() {
  const parents = getParentTopics();
  return parents.map(parent => ({
    parent,
    subtopics: getSubtopics(parent.slug),
  }));
}

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
