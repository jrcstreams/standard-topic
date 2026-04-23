// Data loading and querying utilities

let topicsData = null;
let shortcutsDirectory = null;
let shortcutsAssignments = null;
let modelsData = null;
let promptGenData = null;
let externalSearchesData = null;

// Legacy references kept for compatibility
let evergreenShortcuts = null;
let specificShortcuts = null;

export async function loadAllData() {
  const [topics, directory, assignments, models, promptGen, externalSearches] = await Promise.all([
    fetchJSON('data/topics.json'),
    fetchJSON('data/shortcuts-directory.json'),
    fetchJSON('data/shortcuts-assignments.json'),
    fetchJSON('data/ai-models.json'),
    fetchJSON('data/prompt-generator.json'),
    fetchJSON('data/external-searches.json').catch(() => ({ searches: [] })),
  ]);
  topicsData = topics;
  shortcutsDirectory = directory;
  shortcutsAssignments = assignments;
  modelsData = models;
  promptGenData = promptGen;
  externalSearchesData = externalSearches;
}

export function getExternalSearches() {
  return externalSearchesData?.searches || [];
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
  return getAllTopics().filter(t => t.parent === null && t.slug !== 'home' && t.featured === true);
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

/**
 * Get shortcuts for a specific topic slug, in display order.
 * Looks up the assignment list for the topic, resolves each ID from the directory.
 */
export function getShortcutsForTopic(topicSlug) {
  const directory = shortcutsDirectory?.shortcuts || [];
  const assignments = shortcutsAssignments?.assignments || {};
  const ids = assignments[topicSlug] || assignments['_custom'] || [];
  const dirMap = {};
  directory.forEach(s => { dirMap[s.id] = s; });
  return ids.map(id => dirMap[id]).filter(Boolean);
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
