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
  // Quick Links (external platforms) — boilerplate emoji fallbacks
  // shown if the platform SVG fails to load.
  'google-news': '🔎', 'reddit': '💬', 'x-twitter': '𝕏', 'youtube': '▶️',
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
 * Returns HTML for an icon. Uses CSS mask-image so the SVG is
 * tinted by the parent's color (CSS `color:` → `currentColor` →
 * the mask's background-color). Lets section-accent colors
 * propagate into the icon shape without needing inline SVG or
 * a special build step.
 *
 * Sized to 20×20 by default via the shortcut-icon base class;
 * additional classes (.ti-action-card-icon-svg, etc.) can
 * override width/height.
 */
export function renderIcon(key, cls = '') {
  const className = cls ? `shortcut-icon ${cls}` : 'shortcut-icon';
  return `<span aria-hidden="true" data-icon-key="${key}" class="${className}" style="--icon-src:url('${ICON_PATH}${key}.svg')"></span>`;
}

/**
 * No-op for backwards compatibility.
 */
export async function preloadIcons() {}
