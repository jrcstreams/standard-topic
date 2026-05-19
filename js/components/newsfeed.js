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
         <iframe src="rss-embed.html?id=${feedId}"
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
  if (rssIframe && feedId) {
    window.addEventListener('message', (e) => {
      if (!e.data || !e.data.rssHeight) return;
      if (e.source !== rssIframe.contentWindow) return;
      rssIframe.style.height = e.data.rssHeight + 'px';
    });
  }
}
