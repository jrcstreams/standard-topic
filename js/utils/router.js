// Hash-based SPA router

let currentRoute = null;
let routeHandler = null;

export function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

export function onRoute(handler) {
  routeHandler = handler;
}

export function navigate(hash) {
  window.location.hash = hash;
}

function handleRoute() {
  const hash = window.location.hash || '#/';
  const parsed = parseRoute(hash);
  currentRoute = parsed;
  if (routeHandler) {
    routeHandler(parsed);
  }
}

function parseRoute(hash) {
  const path = hash.replace(/^#\/?/, '');
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 0) {
    return { type: 'home', slug: 'home', tab: 'newsfeed' };
  }

  // Homepage tabs: #/shortcuts, #/related
  if (segments.length === 1 && (segments[0] === 'shortcuts' || segments[0] === 'related')) {
    return { type: 'home', slug: 'home', tab: segments[0] };
  }

  if (segments[0] === 'topic' && segments[1]) {
    const tab = segments[2] === 'shortcuts' ? 'shortcuts'
              : segments[2] === 'related' ? 'related'
              : 'newsfeed';
    return { type: 'topic', slug: segments[1], tab };
  }

  if (segments[0] === 'custom' && segments[1]) {
    return { type: 'custom', term: decodeURIComponent(segments[1]) };
  }

  if (segments[0] === 'prompt-generator') {
    return { type: 'prompt-generator' };
  }

  if (segments[0] === 'about') {
    return { type: 'about' };
  }

  return { type: 'not-found', path };
}

export function getCurrentRoute() {
  return currentRoute;
}
