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
    return { type: 'home', slug: 'home', tab: 'searchtrends' };
  }

  // Homepage tabs: #/searchtrends, #/newsfeed, #/shortcuts, #/related
  if (segments.length === 1 && ['searchtrends', 'newsfeed', 'shortcuts', 'related'].includes(segments[0])) {
    return { type: 'home', slug: 'home', tab: segments[0] };
  }

  // Search modal (empty state). #/custom/{term} below opens it prefilled.
  if (segments.length === 1 && segments[0] === 'search') {
    return { type: 'search' };
  }

  // Nav-dropdown deep-links: Topics tree, Trending, and Prompts (landing, or a
  // specific view: #/prompts/build · #/prompts/library). Each opens its dropdown
  // over the home layout, exactly like #/search. (#/trending used to be a legacy
  // homepage tab; the Trending dropdown replaced that page.)
  if (segments[0] === 'topics') {
    return { type: 'topics' };
  }
  if (segments[0] === 'trending') {
    return { type: 'trending' };
  }
  if (segments[0] === 'prompts') {
    const view = ['build', 'library'].includes(segments[1]) ? segments[1] : null;
    return { type: 'prompts', view };
  }

  if (segments[0] === 'topic' && segments[1]) {
    // L1 tab deep-links (#/topic/{slug}/{tab}): ai-insights / prompts / explore open
    // that tab directly; legacy segments (shortcuts/websources/related) still parse.
    const TAB_SEGS = ['ai-insights', 'prompts', 'explore', 'shortcuts', 'websources', 'related'];
    const tab = TAB_SEGS.includes(segments[2]) ? segments[2] : 'newsfeed';
    return { type: 'topic', slug: segments[1], tab };
  }

  if (segments[0] === 'custom' && segments[1]) {
    const tab = segments[2] === 'shortcuts' ? 'shortcuts' : 'newsfeed';
    return { type: 'custom', term: decodeURIComponent(segments[1]), tab };
  }

  if (segments[0] === 'prompt-generator') {
    return { type: 'prompt-generator' };
  }

  if (segments[0] === 'about') {
    return { type: 'about' };
  }

  if (segments[0] === 'terms') {
    return { type: 'terms' };
  }

  return { type: 'not-found', path };
}

export function getCurrentRoute() {
  return currentRoute;
}
