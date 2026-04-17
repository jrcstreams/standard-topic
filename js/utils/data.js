// Data loading and querying utilities

let topicsData = null;
let evergreenShortcuts = null;
let specificShortcuts = null;
let modelsData = null;
let promptGenData = null;
let externalSearchesData = null;

export async function loadAllData() {
  const [topics, evergreen, specific, models, promptGen, externalSearches] = await Promise.all([
    fetchJSON('data/topics.json'),
    fetchJSON('data/shortcuts-evergreen.json'),
    fetchJSON('data/shortcuts-specific.json'),
    fetchJSON('data/ai-models.json'),
    fetchJSON('data/prompt-generator.json'),
    fetchJSON('data/external-searches.json').catch(() => ({ searches: [] })),
  ]);
  topicsData = topics;
  evergreenShortcuts = evergreen;
  specificShortcuts = specific;
  modelsData = models;
  promptGenData = promptGen;
  externalSearchesData = externalSearches;
}

export function getExternalSearches() {
  return externalSearchesData?.searches || [];
}

async function fetchJSON(path) {
  const res = await fetch(path + '?v=' + Date.now());
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
