// Client fetch for /api/trending. Caches the in-flight/resolved promise
// for the page session so repeated renders share one request.
let cached = null;

export function fetchTrending() {
  if (cached) return cached;
  cached = (async () => {
    const res = await fetch('/api/trending', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`trending ${res.status}`);
    const payload = await res.json();
    return {
      topics: Array.isArray(payload && payload.topics) ? payload.topics : [],
      fetched: (payload && payload.fetched) || null,
    };
  })();
  // Don't cache a rejection — allow a later render to retry.
  cached.catch(() => { cached = null; });
  return cached;
}
