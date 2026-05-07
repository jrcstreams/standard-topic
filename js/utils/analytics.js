// Lightweight GA4 wrapper.
// gtag is loaded synchronously in index.html with anonymize_ip + no
// signals. This module just exposes typed-feeling helpers and falls
// back to no-ops when gtag isn't available (offline dev, blockers).

const MEASUREMENT_ID = 'G-Y2M7NL8RFE';

function gtagSafe(...args) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  try { window.gtag(...args); } catch (_) { /* swallow */ }
}

// Fire a page_view for the given route. Called from the SPA router on
// every route change (not just initial load).
export function trackPageView(path, title) {
  if (!path) return;
  gtagSafe('event', 'page_view', {
    page_path: path,
    page_location: window.location.origin + window.location.pathname + path,
    page_title: title || document.title,
    send_to: MEASUREMENT_ID,
  });
}

// Fire an arbitrary custom event. Keep params small and PII-free.
export function track(eventName, params = {}) {
  if (!eventName) return;
  gtagSafe('event', eventName, { ...params, send_to: MEASUREMENT_ID });
}
