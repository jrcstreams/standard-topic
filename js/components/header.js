// Site header component

export function renderHeader(container) {
  container.innerHTML = `
    <div class="header-inner">
      <a href="#/" class="header-logo">
        <img src="assets/logo.svg" alt="Standard Topic" class="header-logo-img">
        <span class="header-title">Standard Topic</span>
      </a>
      <span class="header-tagline">News, Resources and AI Knowledge. On any topic.</span>
      <a href="#/prompt-generator" class="header-prompt-btn" id="header-prompt-btn">
        <span class="header-prompt-btn-full">Prompt Generator +</span>
        <span class="header-prompt-btn-short">Build Prompt +</span>
      </a>
    </div>
  `;
}

export function updateHeaderActiveState(route) {
  const btn = document.getElementById('header-prompt-btn');
  if (!btn) return;
  btn.classList.toggle('active', route.type === 'prompt-generator');
}
