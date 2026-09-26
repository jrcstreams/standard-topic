// The sidebar's briefing promo (revamp1550).
//
// A small card in the expanded sidebar for the latest released edition of the
// AI Briefing podcast: which edition and when it went out, its headline, a
// play button, and a line saying when the next edition lands. Play drives the
// site's one audio engine, so the dock takes over with the full controls as
// soon as it starts; the headline opens the AI Briefings page.
//
// The sidebar is rebuilt on every route change, so this mounts into a fresh
// host each time. The episode fetch is shared (loadEpisode caches it), and the
// previous mount's engine subscription is dropped before a new one is made.

import { loadEpisode } from './briefing-player.js';
import { briefingAudio } from './briefing-audio.js';

const PLAY_D = 'M8 5v14l11-7z';
const PAUSE_D = 'M6 5h4v14H6zM14 5h4v14h-4z';
const SUN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const etFmt = (d, opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...opts }).format(d);

// "Sep 25 · 5 PM ET" — when this edition went out.
function releasedLabel(ep) {
  try {
    const d = new Date(ep.created_at);
    if (isNaN(d)) return '';
    return `${etFmt(d, { month: 'short', day: 'numeric' })} · ${etFmt(d, { hour: 'numeric' })} ET`;
  } catch (_) { return ''; }
}

// Editions release at 5 AM and 5 PM ET (lib/edition.js). The next one is the
// first of those still ahead on the New York clock.
function nextEditionLine(now = new Date()) {
  const h = Number(etFmt(now, { hour: 'numeric', hourCycle: 'h23' }));
  if (h < 5) return 'Next: the Morning Briefing, today at 5 AM ET';
  if (h < 17) return 'Next: the Evening Briefing, today at 5 PM ET';
  return 'Next: the Morning Briefing, tomorrow at 5 AM ET';
}

export async function mountSidebarBriefing(host) {
  if (window.__sbBriefOff) { try { window.__sbBriefOff(); } catch (_) {} window.__sbBriefOff = null; }
  if (!host) return;
  const ep = await loadEpisode();
  if (!ep || !ep.url || !host.isConnected) return;
  const evening = ep.edition === 'evening';
  const mins = ep.duration_ms ? Math.max(1, Math.round(ep.duration_ms / 60000)) : 0;
  const when = releasedLabel(ep);
  host.innerHTML = `
    <div class="sbb-top">
      <span class="sbb-ed">${evening ? MOON : SUN}<span>${evening ? 'Evening' : 'Morning'} AI Briefing</span></span>
      ${when ? `<span class="sbb-when">${esc(when)}</span>` : ''}
    </div>
    <a href="#/intelligence" class="sbb-title">${esc(ep.title || 'Listen to the latest briefing')}</a>
    <div class="sbb-row">
      <button type="button" class="sbb-play" data-sbb-play aria-label="Play the briefing">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path data-sbb-icon d="${PLAY_D}"/></svg>
      </button>
      <span class="sbb-listen"><span data-sbb-state>Listen</span>${mins ? `<span class="sbb-dur">${mins} min</span>` : ''}</span>
    </div>
    <p class="sbb-next">${esc(nextEditionLine())}</p>`;
  host.hidden = false;

  const btn = host.querySelector('[data-sbb-play]');
  const icon = host.querySelector('[data-sbb-icon]');
  const state = host.querySelector('[data-sbb-state]');
  const paint = () => {
    const on = briefingAudio.isPlaying(ep);
    icon.setAttribute('d', on ? PAUSE_D : PLAY_D);
    btn.setAttribute('aria-label', on ? 'Pause the briefing' : 'Play the briefing');
    state.textContent = on ? 'Playing' : (briefingAudio.isCurrent(ep) && briefingAudio.started ? 'Resume' : 'Listen');
    host.classList.toggle('is-playing', on);
  };
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); briefingAudio.toggle(ep); });
  window.__sbBriefOff = briefingAudio.on(paint);
  paint();
}
