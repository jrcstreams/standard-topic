// Pure helper: the effective refresh window (in hours) for a given AI path
// (the shortcut `group`) and topic `tier`. Shared by the insight endpoint
// (refresh-on-view) and the pregenerate cron so both agree on staleness.
//
//   live      → tier-based (hot topics refresh hourly, niche ones slower)
//   slow      → ~weekly (Analyze)
//   evergreen → ~monthly (Learn — fundamentals don't change)

const cfg = require('../data/ai-paths.json');
const BY_GROUP = Object.fromEntries((cfg.paths || []).map((p) => [p.group, p]));

function refreshClass(group) {
  return (BY_GROUP[group] && BY_GROUP[group].refreshClass) || 'slow';
}

function effectiveWindowHours(group, tier) {
  const cls = refreshClass(group);
  if (cls === 'live') {
    const live = cfg.windows.live || {};
    return live[String(tier || 3)] ?? live['3'] ?? 18;
  }
  if (cls === 'evergreen') return cfg.windows.evergreen || 720;
  return cfg.windows.slow || 168;
}

module.exports = { effectiveWindowHours, refreshClass, PATHS: cfg.paths };
