// Site header component

export function renderHeader(container) {
  container.innerHTML = `
    <div class="header-inner">
      <a href="#/" class="header-logo">
        <img src="assets/logo.png" alt="Standard Topic" class="header-logo-img">
        <span class="header-title">Standard Topic</span>
      </a>
      <a href="#/prompt-generator" class="header-prompt-btn" id="header-prompt-btn">
        Build Knowledge Prompt +
      </a>
    </div>
  `;
}

export function updateHeaderActiveState(route) {
  const btn = document.getElementById('header-prompt-btn');
  if (!btn) return;
  btn.classList.toggle('active', route.type === 'prompt-generator');
}
