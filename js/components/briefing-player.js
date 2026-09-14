// The briefing's audio player (revamp1340).
//
// One component, mounted wherever the Global AI Morning / Evening Briefing is
// shown: under the three In Focus lines on the homepage card, again inside the
// opened briefing beneath its In Focus block, and on the AI Briefings hub. It
// is deliberately plain — a title, the transport, and the AI-audio label — with
// the chapter list folded away until asked for, because on a card it is one
// element among several, not the page.
//
// Text and audio are the same episode (the briefing text is rendered from the
// episode's own script), so chapter N is briefing item N. The open briefing
// uses seekTo() to offer "play from here" on each story; this file does not
// know about the briefing markup, it just exposes the seek.
//
// One <audio> per mount. Mounting a second player for the same episode (card +
// opened briefing) is fine: they share the fetched episode, and playing one
// pauses the other so two hosts never talk at once.

const EP_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>';
const PLAY_D = 'M8 5v14l11-7z';
const PAUSE_D = 'M6 5h4v14H6zM14 5h4v14h-4z';
const SPARK = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M10.5 3l1.55 4.4a2 2 0 0 0 1.25 1.25L17.7 10.2l-4.4 1.55a2 2 0 0 0-1.25 1.25L10.5 17.4l-1.55-4.4a2 2 0 0 0-1.25-1.25L3.3 10.2l4.4-1.55a2 2 0 0 0 1.25-1.25z"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mmss = (ms) => { const s = Math.max(0, Math.round((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const RATES = [1, 1.25, 1.5, 0.9];

// Shared across mounts: the fetch happens once per page life per query.
const episodeCache = new Map();
export function loadEpisode({ date = null, edition = null } = {}) {
  const key = `${date || 'latest'}|${edition || ''}`;
  if (!episodeCache.has(key)) {
    const qs = date ? `?date=${encodeURIComponent(date)}${edition ? `&edition=${edition}` : ''}` : '';
    episodeCache.set(key, fetch(`/api/episodes${qs}`).then((r) => (r.ok ? r.json() : null)).then((d) => (d && d.episode) || null).catch(() => null));
  }
  return episodeCache.get(key);
}
export function loadEpisodeList(n = 30) {
  return fetch(`/api/episodes?list=${n}`).then((r) => (r.ok ? r.json() : null)).then((d) => (d && d.episodes) || []).catch(() => []);
}

// Every live player registers here so playing one pauses the rest.
const live = new Set();
// "Play from here" on a briefing item: seek the player nearest that item in
// the document (the opened briefing's own, if it has one), else any live one.
export function seekBriefingPlayers(ms) {
  const arr = [...live].filter((c) => c.el && c.el.isConnected);
  if (!arr.length) return false;
  const inOpen = arr.find((c) => c.el.closest('.di-focus')) || arr[0];
  inOpen.seekTo(ms);
  try { inOpen.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
  return true;
}

export function playerHTML(ep, { compact = false } = {}) {
  const dur = ep && ep.duration_ms ? Math.round(ep.duration_ms / 60000) : 0;
  const chapters = (ep && Array.isArray(ep.chapters) ? ep.chapters : []).filter((c) => c && c.beat !== 'intro');
  return `
    <div class="bp${compact ? ' bp--compact' : ''}" data-bp>
      <div class="bp-head">
        <span class="bp-ic" aria-hidden="true">${EP_ICON}</span>
        <span class="bp-title">Listen to the Briefing</span>
        ${dur ? `<span class="bp-dur">· ${dur} min</span>` : ''}
      </div>
      <div class="bp-transport">
        <button type="button" class="bp-btn bp-play" data-bp-play aria-label="Play">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path data-bp-icon d="${PLAY_D}"/></svg>
        </button>
        <button type="button" class="bp-skip" data-bp-skip="-10" aria-label="Back 10 seconds"><span>10</span></button>
        <div class="bp-track" data-bp-track role="slider" aria-label="Position" aria-valuemin="0" aria-valuemax="${ep && ep.duration_ms || 0}" aria-valuenow="0" tabindex="0">
          <div class="bp-track-fill" data-bp-fill></div>
          <div class="bp-track-knob" data-bp-knob></div>
        </div>
        <button type="button" class="bp-skip bp-skip--fwd" data-bp-skip="10" aria-label="Forward 10 seconds"><span>10</span></button>
        <span class="bp-time"><span data-bp-cur>0:00</span><span class="bp-time-sep">/</span><span>${mmss(ep && ep.duration_ms)}</span></span>
        <button type="button" class="bp-rate" data-bp-rate aria-label="Playback speed">1×</button>
      </div>
      <div class="bp-foot">
        <span class="bp-aigen">${SPARK}<b>AI-generated audio</b><span class="bp-aigen-sub"> · Based on today's sourced briefing</span></span>
        <span class="bp-foot-links">
          ${chapters.length ? `<button type="button" class="bp-link" data-bp-chapters aria-expanded="false">Chapters ${CHEV}</button>` : ''}
          <a class="bp-link" href="#/intelligence">More episodes ${ARROW}</a>
        </span>
      </div>
      ${chapters.length ? `<ol class="bp-chapters" data-bp-chapterlist hidden>
        ${chapters.map((c) => `<li><button type="button" class="bp-chapter" data-bp-seek="${Number(c.start_ms) || 0}"><span class="bp-chapter-tc">${mmss(c.start_ms)}</span><span class="bp-chapter-nm">${esc(c.label)}</span></button></li>`).join('')}
      </ol>` : ''}
      <audio preload="none" src="${esc(ep && ep.url)}"></audio>
    </div>`;
}

// Mount into `host` (innerHTML replaced). Returns the controller, or null.
export function mountBriefingPlayer(host, ep, opts = {}) {
  if (!host || !ep || !ep.url) return null;
  host.innerHTML = playerHTML(ep, opts);
  host.hidden = false;
  const root = host.querySelector('[data-bp]');
  const au = root.querySelector('audio');
  const play = root.querySelector('[data-bp-play]');
  const icon = root.querySelector('[data-bp-icon]');
  const fill = root.querySelector('[data-bp-fill]');
  const knob = root.querySelector('[data-bp-knob]');
  const track = root.querySelector('[data-bp-track]');
  const cur = root.querySelector('[data-bp-cur]');
  const rateBtn = root.querySelector('[data-bp-rate]');
  const chBtn = root.querySelector('[data-bp-chapters]');
  const chList = root.querySelector('[data-bp-chapterlist]');
  const DUR = (Number(ep.duration_ms) || 0) / 1000;
  let ri = 0; let dragging = false;

  const setIcon = () => { icon.setAttribute('d', au.paused ? PLAY_D : PAUSE_D); play.setAttribute('aria-label', au.paused ? 'Play' : 'Pause'); root.classList.toggle('is-playing', !au.paused); };
  const paint = () => {
    const d = au.duration && isFinite(au.duration) ? au.duration : DUR;
    const p = d ? Math.min(1, au.currentTime / d) : 0;
    fill.style.width = `${p * 100}%`; knob.style.left = `${p * 100}%`;
    cur.textContent = mmss(au.currentTime * 1000);
    track.setAttribute('aria-valuenow', String(Math.round(au.currentTime * 1000)));
    if (chList) {
      const ms = au.currentTime * 1000; let active = null;
      chList.querySelectorAll('[data-bp-seek]').forEach((b) => { if (ms >= Number(b.dataset.bpSeek)) active = b; });
      chList.querySelectorAll('[data-bp-seek]').forEach((b) => b.classList.toggle('is-active', b === active));
    }
  };
  const ctl = {
    el: root,
    seekTo(ms) { au.currentTime = Math.max(0, (Number(ms) || 0) / 1000); ctl.play(); },
    play() { live.forEach((o) => { if (o !== ctl) o.pause(); }); au.play().catch(() => {}); },
    pause() { au.pause(); },
    toggle() { if (au.paused) ctl.play(); else ctl.pause(); },
    destroy() { live.delete(ctl); au.pause(); au.removeAttribute('src'); au.load(); },
  };
  live.add(ctl);

  play.addEventListener('click', ctl.toggle);
  root.querySelectorAll('[data-bp-skip]').forEach((b) => b.addEventListener('click', () => { au.currentTime = Math.max(0, au.currentTime + Number(b.dataset.bpSkip)); paint(); }));
  rateBtn.addEventListener('click', () => { ri = (ri + 1) % RATES.length; au.playbackRate = RATES[ri]; rateBtn.textContent = `${RATES[ri]}×`; });
  const seekFromEvent = (e) => {
    const r = track.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const d = au.duration && isFinite(au.duration) ? au.duration : DUR;
    au.currentTime = Math.max(0, Math.min(d, (x / r.width) * d)); paint();
  };
  track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); seekFromEvent(e); });
  track.addEventListener('pointermove', (e) => { if (dragging) seekFromEvent(e); });
  track.addEventListener('pointerup', (e) => { dragging = false; try { track.releasePointerCapture(e.pointerId); } catch (_) {} });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { au.currentTime += 5; paint(); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { au.currentTime = Math.max(0, au.currentTime - 5); paint(); e.preventDefault(); }
    if (e.key === ' ' || e.key === 'Enter') { ctl.toggle(); e.preventDefault(); }
  });
  if (chBtn && chList) {
    chBtn.addEventListener('click', () => { const open = chBtn.getAttribute('aria-expanded') === 'true'; chBtn.setAttribute('aria-expanded', String(!open)); chList.hidden = open; });
    chList.querySelectorAll('[data-bp-seek]').forEach((b) => b.addEventListener('click', () => ctl.seekTo(Number(b.dataset.bpSeek))));
  }
  au.addEventListener('play', setIcon); au.addEventListener('pause', setIcon);
  au.addEventListener('timeupdate', () => { if (!dragging) paint(); });
  au.addEventListener('ended', () => { setIcon(); paint(); });
  if ('mediaSession' in navigator) {
    au.addEventListener('play', () => {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: ep.title || 'Global AI Briefing', artist: 'Standard Topic', album: `${ep.edition === 'evening' ? 'Evening' : 'Morning'} · ${ep.edition_date || ''}` });
        navigator.mediaSession.setActionHandler('seekbackward', () => { au.currentTime = Math.max(0, au.currentTime - 10); });
        navigator.mediaSession.setActionHandler('seekforward', () => { au.currentTime += 10; });
      } catch (_) {}
    });
  }
  setIcon(); paint();
  return ctl;
}

// Fetch the edition that matches what the briefing card is showing and mount
// it. `host` may be missing (a topic page has no flagship player) — no-op.
export async function mountLatestBriefingPlayer(host, opts = {}) {
  if (!host) return null;
  const ep = await loadEpisode(opts.query || {});
  if (!ep || !host.isConnected) { if (host) host.hidden = true; return null; }
  return mountBriefingPlayer(host, ep, opts);
}
