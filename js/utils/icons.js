// Shortcut icon utility — always renders <img> for SVG, falls back to
// emoji via onerror if the file doesn't exist. No async checks needed.

const ICON_PATH = 'assets/shortcut-icons/';

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
 * Returns HTML for an icon. Always renders an <img> pointing to the SVG.
 * If the SVG doesn't exist, the onerror handler replaces it with the emoji.
 */
export function renderIcon(key, cls = '') {
  const emoji = getIconEmoji(key);
  const className = cls ? ` class="${cls}"` : '';
  const escapedEmoji = emoji.replace(/'/g, "\\'");
  return `<img src="${ICON_PATH}${key}.svg" alt=""${className} width="20" height="20" onerror="this.outerHTML='<span${className}>${escapedEmoji}</span>'">`;
}

/**
 * No-op for backwards compatibility — preloading is no longer needed.
 */
export async function preloadIcons() {}
