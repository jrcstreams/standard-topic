// renderNewsFeed: RSS embed for topics that have a feed. Used on
// topic pages and the homepage. Custom routes don't have a feed.

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

export function renderNewsFeed(container, topic, isHome) {
  const feedId = topic?.rssFeedId;

  const body = feedId
    ? `<div class="newsfeed-embed">
         <iframe src="rss-embed.html?id=${feedId}&v=20260520i"
                 class="newsfeed-iframe"
                 id="rss-iframe-${feedId}"
                 frameborder="0"
                 scrolling="no"></iframe>
       </div>`
    : `<div class="newsfeed-placeholder"><p>News feed coming soon for this topic.</p></div>`;

  const topicName = (!isHome && topic?.name) ? topic.name : '';
  const pillHTML = topicName
    ? `<span class="section-topic-pill">${escapeHTML(topicName)}</span>`
    : '';

  container.innerHTML = `
    <div class="newsfeed-card">
      <h3 class="newsfeed-title">News Feed${pillHTML}</h3>
      <div class="newsfeed-scroll-wrap">
        ${body}
      </div>
    </div>
  `;

  const rssIframe = container.querySelector('.newsfeed-iframe');
  const scrollWrap = container.querySelector('.newsfeed-scroll-wrap');
  if (rssIframe && feedId) {
    window.addEventListener('message', (e) => {
      if (!e.data || e.source !== rssIframe.contentWindow) return;
      if (e.data.rssHeight) {
        rssIframe.style.height = e.data.rssHeight + 'px';
        return;
      }
      // Wheel forwarding: the iframe captures wheel events even when
      // its body is overflow:hidden, so without this the iframe's
      // body-padding / grid-inset region (left/right of the cards)
      // becomes a dead zone for scrolling the feed.
      if (e.data.rssWheel && scrollWrap) {
        const { deltaY, deltaMode } = e.data.rssWheel;
        // deltaMode 1 = lines, 2 = pages, 0 = pixels. Approximate.
        // Only forward vertical deltas; horizontal scroll is locked.
        const pxY = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * scrollWrap.clientHeight : deltaY;
        scrollWrap.scrollBy({ top: pxY, behavior: 'auto' });
      }
    });
  }
}
