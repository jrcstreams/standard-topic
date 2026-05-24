// ============================================================
// Iframe-era news feed JS branch (archived 2026-05-24)
//
// Removed from js/components/newsfeed.js after the API-based
// migration. These two helpers were what the renderer used
// when the URL carried `?legacy=1` (or, before that flag was
// added, always). They embed rss.app's widget directly via
// rss-embed.html and listen for height/wheel postMessages
// coming back from the iframe.
//
// If you ever need to re-enable iframe rendering:
//   1. Restore rss-embed.html at the repo root.
//   2. Paste these functions back into js/components/newsfeed.js.
//   3. Restore the `useApiRenderer` gate (or any equivalent
//      switch) and call `renderIframeMode(scrollWrap, feedId)`
//      from `renderNewsFeed`.
//   4. Paste iframe-mode-styles.css contents back into
//      css/styles.css.
// ============================================================

// "?legacy=1" anywhere on the URL force-uses the iframe renderer.
// The iframe path is broken on standard-topic.vercel.app (rss.app's
// domain whitelist rejects it), so the default was API mode.
function useApiRenderer() {
  try {
    return !new URLSearchParams(window.location.search).has('legacy');
  } catch {
    return true;
  }
}

function renderIframeMode(scrollWrap, feedId) {
  const body = feedId
    ? `<div class="newsfeed-embed">
         <iframe src="rss-embed.html?id=${feedId}&v=20260523b"
                 class="newsfeed-iframe"
                 id="rss-iframe-${feedId}"
                 frameborder="0"
                 scrolling="no"></iframe>
       </div>`
    : `<div class="newsfeed-placeholder"><p>News feed coming soon for this topic.</p></div>`;
  scrollWrap.innerHTML = body;

  const rssIframe = scrollWrap.querySelector('.newsfeed-iframe');
  if (rssIframe && feedId) {
    window.addEventListener('message', (e) => {
      if (!e.data || e.source !== rssIframe.contentWindow) return;
      if (e.data.rssHeight) {
        rssIframe.style.height = e.data.rssHeight + 'px';
        return;
      }
      // Wheel forwarding: the iframe captures wheel events even
      // when its body is overflow:hidden, so without this the
      // iframe's body-padding / grid-inset region (left/right of
      // the cards) becomes a dead zone for scrolling the feed.
      if (e.data.rssWheel && scrollWrap) {
        const { deltaY, deltaMode } = e.data.rssWheel;
        const pxY = deltaMode === 1
          ? deltaY * 16
          : deltaMode === 2
            ? deltaY * scrollWrap.clientHeight
            : deltaY;
        scrollWrap.scrollBy({ top: pxY, behavior: 'auto' });
      }
    });
  }
}
