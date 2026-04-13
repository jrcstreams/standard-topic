// News Feed component — renders RSS.app iframe embed

export function renderNewsFeed(container, topic, isHome) {
  const title = isHome ? 'General News Feed' : 'News Feed';
  const feedId = topic?.rssFeedId;

  if (!feedId) {
    container.innerHTML = `
      <div class="section-header">
        <span class="section-icon">📡</span>
        <h2>${title}</h2>
      </div>
      <div class="newsfeed-placeholder">
        <p>News feed coming soon for this topic.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="section-header">
      <span class="section-icon">📡</span>
      <h2>${title}</h2>
    </div>
    <div class="newsfeed-embed">
      <rssapp-wall id="${feedId}"></rssapp-wall>
    </div>
  `;
}
