// Shortcut icon utility — renders SVG if available, emoji fallback otherwise.

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

// Global handler for SVG load errors — replaces broken <img> with emoji span.
// Attached once to window so inline onerror attributes stay simple.
window.__iconFallback = function(img) {
  const key = img.dataset.iconKey;
  const emoji = EMOJI_MAP[key] || '🔗';
  const span = document.createElement('span');
  span.className = img.className;
  span.textContent = emoji;
  img.replaceWith(span);
};

/**
 * Returns the emoji fallback for a given icon key.
 */
export function getIconEmoji(key) {
  return EMOJI_MAP[key] || '🔗';
}

/**
 * Returns HTML for an icon. Renders an <img> pointing to the SVG.
 * If the SVG doesn't load, the onerror handler swaps it for the emoji.
 */
export function renderIcon(key, cls = '') {
  const className = cls ? ` class="${cls}"` : '';
  return `<img src="${ICON_PATH}${key}.svg" alt="" data-icon-key="${key}"${className} width="20" height="20" onerror="__iconFallback(this)">`;
}

/**
 * No-op for backwards compatibility.
 */
export async function preloadIcons() {}
