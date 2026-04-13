import { initRouter, onRoute } from './utils/router.js';
import { loadAllData } from './utils/data.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  onRoute((route) => {
    console.log('Route:', route);
  });
  initRouter();
});
