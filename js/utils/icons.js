// Shortcut icon utility — renders SVG image if available, falls back to emoji.
//
// SVG files live in assets/shortcut-icons/{key}.svg (e.g. newspaper.svg).
// On first load, we probe which SVGs exist and cache the results so
// subsequent renders are synchronous.

const ICON_PATH = 'assets/shortcut-icons/';
const checkedIcons = {};   // key → true (exists) | false (missing)
const pendingChecks = {};  // key → Promise

const EMOJI_MAP = {
  'zap': '⚡', 'globe': '🌍', 'cpu': '🤖', 'trending-up': '📈',
  'calendar': '📅', 'rocket': '🚀', 'microscope': '🔬', 'landmark': '🏛️',
  'trophy': '🏆', 'leaf': '🌿', 'heart': '❤️', 'bar-chart': '📊',
  'tool': '🔧', 'laptop': '💻', 'flask': '🧪', 'briefcase': '💼',
  'home': '🏠', 'newspaper': '📰', 'fire': '🔥', 'world': '🌎',
  'sparkle': '✨', 'lightbulb': '💡', 'target': '🎯', 'compass': '🧭',
  'book': '📚', 'mag-glass': '🔍', 'shield': '🛡️', 'money': '💰',
  'handshake': '🤝', 'megaphone': '📣', 'star': '⭐', 'scales': '⚖️',
  'film': '🎬', 'medal': '🏅', 'graduation': '🎓', 'chess': '♟️',
};

/**
 * Returns the emoji fallback for a given icon key.
 */
export function getIconEmoji(key) {
  return EMOJI_MAP[key] || '🔗';
}

/**
 * Returns HTML for an icon — <img> if SVG exists, emoji <span> otherwise.
 * On first call for a given key, the SVG existence is unknown so we return
 * the emoji and kick off an async check. Once the check resolves, any
 * subsequent render of that key will use the SVG if it exists.
 *
 * Call `preloadIcons(keys)` at startup to warm the cache so the first
 * visible render already has the right answer.
 */
export function renderIcon(key, cls = '') {
  const className = cls ? ` class="${cls}"` : '';
  if (checkedIcons[key] === true) {
    return `<img src="${ICON_PATH}${key}.svg" alt=""${className} width="20" height="20">`;
  }
  // Either not checked yet or confirmed missing — use emoji
  if (!(key in checkedIcons)) {
    // Fire-and-forget check so next render is correct
    checkIcon(key);
  }
  return `<span${className}>${getIconEmoji(key)}</span>`;
}

/**
 * Preload a list of icon keys — resolves when all checks are done.
 * Call this once at app startup with the full set of icon keys used
 * across all shortcuts so the first render is accurate.
 */
export async function preloadIcons(keys) {
  const unique = [...new Set(keys)];
  await Promise.all(unique.map(checkIcon));
}

async function checkIcon(key) {
  if (key in checkedIcons) return checkedIcons[key];
  if (pendingChecks[key]) return pendingChecks[key];

  pendingChecks[key] = fetch(`${ICON_PATH}${key}.svg`, { method: 'HEAD' })
    .then(res => {
      checkedIcons[key] = res.ok;
      delete pendingChecks[key];
      return res.ok;
    })
    .catch(() => {
      checkedIcons[key] = false;
      delete pendingChecks[key];
      return false;
    });

  return pendingChecks[key];
}
