// Shortcut icon utility — inlines SVG content from the build-generated
// registry so the icon stroke uses currentColor and inherits the
// parent's CSS color (used by section-accent tinting on shortcut
// cards). Emoji fallback if a key isn't in the registry.

import { SHORTCUT_ICONS } from './shortcut-icons-registry.js';

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
 * Returns HTML for an icon. Emits an inline <svg> from the
 * build-generated registry so stroke="currentColor" resolves to
 * the parent's CSS color. Section-accent tinting (color: var(--
 * ti-accent) on the wrapper) propagates into the icon stroke
 * automatically.
 *
 * Falls back to an emoji span if the key isn't in the registry
 * (e.g., a brand-new SVG dropped in /assets/shortcut-icons/
 * before the registry has been regenerated).
 */
export function renderIcon(key, cls = '') {
  const className = cls ? `shortcut-icon ${cls}` : 'shortcut-icon';
  const inner = SHORTCUT_ICONS[key];
  if (!inner) {
    const emoji = EMOJI_MAP[key] || '🔗';
    return `<span aria-hidden="true" data-icon-key="${key}" class="${className}">${emoji}</span>`;
  }
  return `<svg aria-hidden="true" data-icon-key="${key}" class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/**
 * No-op for backwards compatibility.
 */
export async function preloadIcons() {}
