// History-API SPA router.
//
// The address bar shows real paths (/topic/technology, /search, /prompts/build)
// so refresh, sharing, and crawlers see a real 200 URL. Internally the rest of the
// app still speaks in "#/x" route strings — this module is the single translation
// point between the two, so route comparisons and navigate('#/x') calls elsewhere
// keep working unchanged. Legacy "#/x" hash links are redirected to their path form
// on load, so old shared links and bookmarks still resolve.

let currentRoute = null;
let routeHandler = null;

// "#/topic/x" | "/topic/x" | "topic/x"  ->  "/topic/x"   (leading slash, no hash)
function toPath(t) {
  let s = String(t == null ? '' : t);
  if (s.charAt(0) === '#') s = s.slice(1);      // "#/x" -> "/x"
  if (s.charAt(0) !== '/') s = '/' + s;         // "x"   -> "/x"
  s = s.replace(/\/{2,}/g, '/');
  return s || '/';
}

// current URL path, normalized (no trailing slash except root)
function currentPath() {
  const p = (window.location.pathname || '/').replace(/\/+$/, '');
  return p || '/';
}

// Current route as a "#/x" string, so existing app code that compares against
// "#/topic/", "#/custom/", etc. keeps working after the swap from location.hash.
export function routeHash() {
  const p = currentPath();
  return p === '/' ? '#/' : '#' + p;
}

export function initRouter() {
  window.addEventListener('popstate', handleRoute);
  // Redirect any legacy "#/x" hash link to its real path, once, before first parse.
  const h = window.location.hash || '';
  if (h.indexOf('#/') === 0) {
    try { history.replaceState(null, '', toPath(h) + window.location.search); } catch (_) {}
  }
  // Intercept internal route links so "#/x" and "/x" anchors pushState instead of
  // triggering a hash change or a full page load. Anything that isn't an in-app
  // route (external, asset, api, new-tab, download) falls through untouched.
  document.addEventListener('click', onLinkClick);
  handleRoute();
}

function onLinkClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!a) return;
  if (a.target === '_blank' || a.hasAttribute('download')) return;
  const rel = (a.getAttribute('rel') || '').toLowerCase();
  if (rel.indexOf('external') !== -1) return;
  const href = a.getAttribute('href');
  if (!href) return;
  const isHashRoute = href.charAt(0) === '#' && href.charAt(1) === '/';
  const isRootPath = href.charAt(0) === '/' && href.charAt(1) !== '/';
  if (!isHashRoute && !isRootPath) return;               // external / mailto / "#" / "#top"
  const path = toPath(href);
  // don't hijack links to real files or the api (assets, admin, sitemap, *.ext …)
  if (/^\/(api|assets|data|js|css|db|lib|admin|robots|sitemap|favicon|404)\b/.test(path) ||
      /\.[a-z0-9]{2,5}(\?|$)/i.test(path)) return;
  e.preventDefault();
  navigate(href);
}

export function onRoute(handler) {
  routeHandler = handler;
}

// Navigate to a route (pushState + re-render). Accepts "#/x" or "/x".
// No-op when already on that path — matches the old hash router, where assigning
// the current hash fired no hashchange and did not re-render.
export function navigate(target) {
  const path = toPath(target);
  const cur = currentPath();
  if (path.replace(/\/+$/, '') === (cur === '/' ? '' : cur)) return;
  try { history.pushState(null, '', path + window.location.search); } catch (_) {}
  handleRoute();
}

// Replace the current URL WITHOUT re-rendering. Mirrors the old
// history.replaceState(null,'',hash) calls that silently synced the URL to a view
// change (tab/dropdown-view switches) without triggering the route handler.
export function replaceRoute(target) {
  try { history.replaceState(null, '', toPath(target) + window.location.search); } catch (_) {}
}

function handleRoute() {
  const parsed = parseRoute(currentPath());
  currentRoute = parsed;
  if (routeHandler) {
    routeHandler(parsed);
  }
}

function parseRoute(pathname) {
  const segments = String(pathname || '/').split('/').filter(Boolean);

  if (segments.length === 0) {
    return { type: 'home', slug: 'home', tab: 'searchtrends' };
  }

  // Homepage tabs: /searchtrends, /newsfeed, /shortcuts, /related
  if (segments.length === 1 && ['searchtrends', 'newsfeed', 'shortcuts', 'related'].includes(segments[0])) {
    return { type: 'home', slug: 'home', tab: segments[0] };
  }

  // Search modal (empty state). /custom/{term} below opens it prefilled.
  if (segments.length === 1 && segments[0] === 'search') {
    return { type: 'search' };
  }

  // Nav-dropdown deep-links: Topics tree, Trending, and Prompts (landing, or a
  // specific view: /prompts/build · /prompts/library). Each opens its dropdown
  // over the home layout, exactly like /search.
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
    // Sub-page deep-links (/topic/{slug}/{page}): intelligence / prompts /
    // websources are the current flip pages; legacy segments (ai-insights /
    // explore / shortcuts / related) still parse and are aliased in app.js.
    const TAB_SEGS = ['intelligence', 'ai-insights', 'prompts', 'explore', 'shortcuts', 'websources', 'related'];
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

  return { type: 'not-found', path: segments.join('/') };
}

export function getCurrentRoute() {
  return currentRoute;
}
