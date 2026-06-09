// Server-side resolution of "which shortcuts make up a group on a page" —
// a Node port of js/utils/data.js selectShortcutsForTopic + ti-shortcuts.js
// groupShortcuts (incl. per-topic groupOverrides and the regex fallback
// buckets). Group overviews are generated with one section per shortcut, so
// the server must bucket EXACTLY like the client renders.

const directoryData = require('../data/shortcuts-directory.json');
const assignmentsData = require('../data/shortcuts-assignments.json');
const topicsData = require('../data/topics.json');

const AI_LENSES = ['discover', 'learn', 'analyze', 'topic-specific'];
const GROUP_LABELS = {
  'topic-specific': 'Topic-Specific Insights',
  discover: 'Discover',
  learn: 'Learn',
  analyze: 'Analysis',
  more: 'More',
};

// Mirrors groupShortcuts() fallback regexes exactly.
const LEARN_RE = /(guide|glossary|beginner|primer|fundamentals|basics|deep ?dive|history|background|key players|key terms|how |where to|why )/i;
const ANALYZE_RE = /(analy|impact|affect|hype|reality|compare| vs | versus |implications|outcome|signal|forecast|prediction|risk|controversy|debate)/i;
const DISCOVER_RE = /(news|snapshot|update|headline|trend|watch|latest|now|today|roundup|hot|spotlight|brief|digest)/i;

const topicByLowerName = new Map(
  (topicsData.topics || []).map((t) => [String(t.name || '').toLowerCase(), t]));
const topicBySlug = new Map(
  (topicsData.topics || []).map((t) => [t.slug, t]));

// Accepts a topic name (as the API receives) or slug, or 'home'.
function resolveTopic(scope) {
  const s = String(scope || '').trim();
  if (!s) return null;
  if (s.toLowerCase() === 'home') return { slug: 'home', name: '' };
  const t = topicBySlug.get(s) || topicByLowerName.get(s.toLowerCase());
  return t ? { slug: t.slug, name: t.name } : null;
}

// Port of selectShortcutsForTopic: assigned ids first, then (non-home)
// evergreens in global order minus exclusions, deduped.
function shortcutsForSlug(slug) {
  const directory = directoryData.shortcuts || [];
  const dirMap = new Map(directory.map((s) => [s.id, s]));
  const assignments = assignmentsData.assignments || {};
  const ids = assignments[slug] || assignments['_custom'] || [];
  const list = ids.map((id) => dirMap.get(id)).filter(Boolean);
  if (slug !== 'home') {
    const have = new Set(list.map((s) => s.id));
    const excluded = new Set((assignmentsData.evergreenExclusions || {})[slug] || []);
    const orderIdx = new Map((assignmentsData.evergreenOrder || []).map((id, i) => [id, i]));
    directory
      .filter((s) => s.evergreen && !have.has(s.id) && !excluded.has(s.id))
      .sort((a, b) =>
        (orderIdx.has(a.id) ? orderIdx.get(a.id) : 1e9) - (orderIdx.has(b.id) ? orderIdx.get(b.id) : 1e9))
      .forEach((s) => { list.push(s); have.add(s.id); });
  }
  return list;
}

// Port of groupShortcuts bucketing for ONE shortcut.
function bucketOf(s, overrideMap, groupIds) {
  const override = overrideMap[s.id];
  if (override && groupIds.has(override)) return override;
  if (s.group && groupIds.has(s.group)) return s.group;
  const name = s.name || '';
  if (LEARN_RE.test(name) && groupIds.has('learn')) return 'learn';
  if (ANALYZE_RE.test(name) && groupIds.has('analyze')) return 'analyze';
  if (DISCOVER_RE.test(name) && groupIds.has('discover')) return 'discover';
  if (groupIds.has('topic-specific')) return 'topic-specific';
  if (groupIds.has('more')) return 'more';
  return null;
}

// → ordered [{id, name, prompt}] for (scope, group); prompt has {topic}
// resolved. Empty array if the group has no shortcuts on that page.
// Returns null for an unknown scope.
function resolveSections(scope, group) {
  const topic = resolveTopic(scope);
  if (!topic) return null;
  const groupDefs = (Array.isArray(assignmentsData.groups) && assignmentsData.groups.length)
    ? assignmentsData.groups
    : Object.keys(GROUP_LABELS).map((id) => ({ id }));
  const groupIds = new Set(groupDefs.map((g) => g.id));
  const overrideMap = (assignmentsData.groupOverrides || {})[topic.slug] || {};
  return shortcutsForSlug(topic.slug)
    .filter((s) => bucketOf(s, overrideMap, groupIds) === group)
    .map((s) => ({
      id: s.id,
      name: s.name,
      prompt: String(s.prompt || '').replace(/\{topic\}/gi, topic.name),
    }));
}

module.exports = { resolveSections, resolveTopic, AI_LENSES, GROUP_LABELS };
