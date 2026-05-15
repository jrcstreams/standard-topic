// renderNewsFeed: RSS embed for topics that have a feed. Used on
// topic pages and the homepage. Custom routes don't have a feed.

export function renderNewsFeed(container, topic, isHome) {
  const feedId = topic?.rssFeedId;

  const header = `<h3 class="newsfeed-title">News Feed</h3>`;

  let body;
  if (feedId) {
    body = `
      <div class="newsfeed-embed">
        <iframe src="rss-embed.html?id=${feedId}"
                class="newsfeed-iframe"
                id="rss-iframe-${feedId}"
                frameborder="0"
                scrolling="no"></iframe>
      </div>
    `;
  } else {
    body = `
      <div class="newsfeed-placeholder">
        <p>News feed coming soon for this topic.</p>
      </div>
    `;
  }

  container.innerHTML = `<div class="newsfeed-card">${header}${body}</div>`;

  const rssIframe = container.querySelector('.newsfeed-iframe');
  if (rssIframe && feedId) {
    window.addEventListener('message', (e) => {
      if (!e.data || !e.data.rssHeight) return;
      if (e.source !== rssIframe.contentWindow) return;
      rssIframe.style.height = e.data.rssHeight + 'px';
    });
  }
}
