// Site footer component

export function renderFooter(container) {
  container.innerHTML = `
    <div class="footer-inner">
      <div class="footer-logo">
        <img src="assets/logo.png" alt="Standard Topic" class="footer-logo-img">
        <span class="footer-title">Standard Topic</span>
      </div>
      <nav class="footer-nav">
        <a href="#/">Home</a>
        <a href="#/prompt-generator">Build a Prompt</a>
        <a href="#/about">About</a>
      </nav>
    </div>
  `;
}
