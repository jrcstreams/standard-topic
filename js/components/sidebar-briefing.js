// The sidebar's briefing card (revamp1550; The Front Page since revamp1555;
// Read / Listen and the mini player since revamp1556).
//
// The latest released edition of The Front Page: its edition and release
// time, its headline, a Read and a Listen button, and when the next edition
// lands.
//
//   Read (or the headline) opens the briefing where it lives: the Front Page
//   card on the homepage, opened in place — and in tab mode, on the AI
//   Briefings page, which is what the homepage's AI Briefings tab opens.
//   Listen swaps the buttons for a mini player inside the card: play/pause, a
//   progress line you can tap to seek, the time, and ✕ to stop and close it.
//   No chapters, no speed — the full player is one Read away.
//
// The audio is the site's one engine (briefing-audio.js), so the dock, the
// homepage card and this card are all views of the same playback. While the
// mini player is on screen it registers as a view, and the dock steps aside.
//
// The sidebar is rebuilt on every route change, so this mounts into a fresh
// host each time. The episode fetch is shared (loadEpisode caches it), the
// previous mount's subscriptions are dropped, and whether the mini player is
// open is kept here at module level so it survives the rebuild.

import { loadEpisode } from './briefing-player.js';
import { briefingAudio } from './briefing-audio.js';

const PLAY_D = 'M8 5v14l11-7z';
const PAUSE_D = 'M6 5h4v14H6zM14 5h4v14h-4z';
const SUN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const BOOK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/></svg>';
const HEAD = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>';
const X = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const CLOCK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const etFmt = (d, opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...opts }).format(d);
const mmss = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

let playerOpen = false;   // the mini player, across sidebar rebuilds

// "Sep 26 · 5 AM ET" — when this edition went out.
function releasedLabel(ep) {
  try {
    const d = new Date(ep.created_at);
    if (isNaN(d)) return '';
    return `${etFmt(d, { month: 'short', day: 'numeric' })} · ${etFmt(d, { hour: 'numeric' })} ET`;
  } catch (_) { return ''; }
}

// Editions release at 5 AM and 5 PM ET (lib/edition.js). The next one is the
// first of those still ahead on the New York clock.
function nextEdition(now = new Date()) {
  const h = Number(etFmt(now, { hour: 'numeric', hourCycle: 'h23' }));
  if (h < 5) return { evening: false, when: 'Today, 5 AM ET' };
  if (h < 17) return { evening: true, when: 'Tonight, 5 PM ET' };
  return { evening: false, when: 'Tomorrow, 5 AM ET' };
}

// Open the briefing where it is hosted. On the wide layout that is the
// homepage, where the Front Page card leads the AI Briefings row. In tab mode
// the homepage's tabs are links to pages (revamp1473), and its AI Briefings
// tab IS the AI Briefings page, so the card is opened there. Either way the
// sidebar's own link does the navigating, so the router does the work, and
// the card is opened once it has rendered.
function openFrontPage() {
  const overlay = document.getElementById('navmenu-overlay');
  if (overlay && overlay.classList.contains('is-open')) overlay.click();
  const tabbed = document.body.classList.contains('tt-on');
  const findCard = () => document.querySelector('#content .tdi-card--edition:not(.tdi-card--topicedition)');
  const onTarget = () => !!document.querySelector(tabbed ? '#content .dih' : '#content .home-v2');
  const act = () => {
    const card = findCard();
    if (!card) return false;
    if (!card.classList.contains('is-open')) { const btn = card.querySelector('.ec-read'); if (btn) btn.click(); }
    // Tabbed, the card leads its page: the top. Wide, clear of the sticky
    // band above the content rather than under it.
    setTimeout(() => {
      try {
        if (tabbed) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
        const band = document.getElementById('sub-header');
        const off = band ? Math.max(0, band.getBoundingClientRect().bottom) : 0;
        window.scrollTo({ top: Math.max(0, card.getBoundingClientRect().top + window.scrollY - off - 16), behavior: 'smooth' });
      } catch (_) {}
    }, 120);
    return true;
  };
  if (onTarget() && act()) return;
  const link = document.getElementById(tabbed ? 'navmenu-daily-link' : 'navmenu-home-link');
  if (link) link.click(); else location.hash = tabbed ? '#/intelligence' : '#/';
  const t0 = Date.now();
  const poll = () => {
    if (onTarget() && findCard() && act()) return;
    if (Date.now() - t0 < 8000) setTimeout(poll, 150);
  };
  setTimeout(poll, 150);
}

export async function mountSidebarBriefing(host) {
  if (window.__sbBriefOff) { try { window.__sbBriefOff(); } catch (_) {} window.__sbBriefOff = null; }
  if (!host) return;
  const ep = await loadEpisode();
  if (!ep || !ep.url || !host.isConnected) return;
  const A = briefingAudio;
  const evening = ep.edition === 'evening';
  const mins = ep.duration_ms ? Math.max(1, Math.round(ep.duration_ms / 60000)) : 0;
  const when = releasedLabel(ep);
  const next = nextEdition();
  // Playing this episode from anywhere else opens the mini player here too.
  if (A.isCurrent(ep) && A.started) playerOpen = true;

  host.innerHTML = `
    <div class="sbb-top">
      <span class="sbb-ed">${evening ? MOON : SUN}<span>The Front Page</span></span>
      ${when ? `<span class="sbb-when">${esc(when)}</span>` : ''}
    </div>
    <a href="#/" class="sbb-title" data-sbb-read>${esc(ep.title || 'Read the latest briefing')}</a>
    <div class="sbb-btns" data-sbb-btns>
      <button type="button" class="sbb-btn sbb-btn--read" data-sbb-read>${BOOK}<span>Read</span></button>
      <button type="button" class="sbb-btn sbb-btn--listen" data-sbb-listen>${HEAD}<span>Listen</span>${mins ? `<span class="sbb-btn-dur">${mins} min</span>` : ''}</button>
    </div>
    <div class="sbb-mini" data-sbb-mini hidden>
      <button type="button" class="sbb-mini-play" data-sbb-play aria-label="Play">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path data-sbb-icon d="${PLAY_D}"/></svg>
      </button>
      <div class="sbb-mini-mid">
        <div class="sbb-mini-track" data-sbb-track role="slider" aria-label="Position" tabindex="0"><i data-sbb-fill></i></div>
        <div class="sbb-mini-times"><span data-sbb-cur>0:00</span><span data-sbb-dur>${mmss((ep.duration_ms || 0) / 1000)}</span></div>
      </div>
      <button type="button" class="sbb-mini-x" data-sbb-close aria-label="Stop and close the player">${X}</button>
    </div>
    <div class="sbb-next">
      <span class="sbb-next-lbl">${CLOCK}<span>Next edition</span></span>
      <span class="sbb-next-val">${next.evening ? MOON : SUN}<span>${esc(next.when)}</span></span>
    </div>`;
  host.hidden = false;

  const btns = host.querySelector('[data-sbb-btns]');
  const mini = host.querySelector('[data-sbb-mini]');
  const play = host.querySelector('[data-sbb-play]');
  const icon = host.querySelector('[data-sbb-icon]');
  const track = host.querySelector('[data-sbb-track]');
  const fill = host.querySelector('[data-sbb-fill]');
  const cur = host.querySelector('[data-sbb-cur]');
  const durEl = host.querySelector('[data-sbb-dur]');

  let unreg = null; let raf = 0;
  const mine = () => A.isCurrent(ep);
  const paint = () => {
    const on = A.isPlaying(ep);
    icon.setAttribute('d', on ? PAUSE_D : PLAY_D);
    play.setAttribute('aria-label', on ? 'Pause' : 'Play');
    host.classList.toggle('is-playing', on);
    const d = mine() ? A.duration() : (ep.duration_ms || 0) / 1000;
    const t = mine() ? A.time() : 0;
    fill.style.width = `${d ? Math.min(100, (t / d) * 100) : 0}%`;
    cur.textContent = mmss(t);
    durEl.textContent = mmss(d);
    track.setAttribute('aria-valuenow', String(Math.round(t)));
  };
  const setOpen = (open) => {
    playerOpen = open;
    btns.hidden = open; mini.hidden = !open;
    host.classList.toggle('is-listening', open);
    if (open && !unreg) unreg = A.registerView(mini, ep);
    if (!open && unreg) { unreg(); unreg = null; }
    paint();
  };
  const tick = () => { if (!A.isPlaying(ep)) { raf = 0; return; } paint(); raf = requestAnimationFrame(tick); };

  host.querySelectorAll('[data-sbb-read]').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); openFrontPage(); }));
  host.querySelector('[data-sbb-listen]').addEventListener('click', () => { setOpen(true); A.play(ep); });
  play.addEventListener('click', () => A.toggle(ep));
  host.querySelector('[data-sbb-close]').addEventListener('click', () => { if (mine()) A.stop(); setOpen(false); });
  const seek = (clientX) => {
    const r = track.getBoundingClientRect(); const d = mine() ? A.duration() : (ep.duration_ms || 0) / 1000;
    if (!d || !r.width) return;
    const ms = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * d * 1000;
    A.seekTo(ms, ep);
  };
  track.addEventListener('click', (e) => seek(e.clientX));
  track.addEventListener('keydown', (e) => {
    if (!mine()) return;
    if (e.key === 'ArrowRight') { A.skip(15); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { A.skip(-15); e.preventDefault(); }
  });

  const off = A.on((type) => {
    // Stopped from the dock or elsewhere: the card goes back to its buttons.
    if (type === 'stop' && playerOpen) { setOpen(false); return; }
    if (type === 'start' && mine() && !playerOpen) setOpen(true);
    paint();
    if (A.isPlaying(ep) && !raf) raf = requestAnimationFrame(tick);
  });
  window.__sbBriefOff = () => { off(); if (unreg) unreg(); if (raf) cancelAnimationFrame(raf); };
  setOpen(playerOpen);
  if (A.isPlaying(ep) && !raf) raf = requestAnimationFrame(tick);
}
