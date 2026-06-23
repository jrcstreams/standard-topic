// Pure helper: the effective refresh window (in hours) for a given AI path
// (the shortcut `group`) and topic `tier`. Shared by the insight endpoint
// (refresh-on-view) and the pregenerate cron so both agree on staleness.
//
// Builder cadence (the 4 Insight Builders):
//   daily     → 24h  (Get Caught Up — time-sensitive news)
//   weekly    → 168h (Deep Dive — current developments, slower cadence)
//   biweekly  → 336h (Analysis — sector reasoning changes slowly)
//   evergreen → 720h (101 Resources — fundamentals don't change)
// Legacy classes kept for back-compat:
//   live → tier-based (hot topics hourly), slow → ~weekly.

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
  // Numeric per-class window (daily/weekly/biweekly/evergreen/slow).
  const w = cfg.windows[cls];
  if (typeof w === 'number') return w;
  return cfg.windows.slow || 168;
}

module.exports = { effectiveWindowHours, refreshClass, PATHS: cfg.paths };
