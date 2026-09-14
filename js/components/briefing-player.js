// The briefing's audio player (revamp1340, reshaped revamp1342).
//
// One component, mounted wherever the Global AI Morning Briefing is shown:
// under Today in Focus on the homepage card and the AI Briefings edition card,
// and again inside the opened briefing. It is a contained light panel: a
// headphones tile and title on the left, the play button and a waveform in the
// middle, speed / mute / Chapters on the right; on a phone those three stack
// as rows. The waveform is drawn from the episode's own peaks (stored with it),
// so the bars are the audio, not decoration.
//
// Text and audio are the same episode (the briefing text is rendered from the
// episode's own script), so chapter N is briefing item N. The open briefing
// offers "play from here" on each story; seekBriefingPlayers() finds the
// nearest live player and seeks it.
//
// One <audio> per mount. Two players for the same episode (card + opened
// briefing) are fine: playing one pauses the other.

const EP_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>';
const PLAY_D = 'M8 5v14l11-7z';
const PAUSE_D = 'M6 5h4v14H6zM14 5h4v14h-4z';
const CHEV = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const LIST = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>';
const VOL_ON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const VOL_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>';
// The ring is explicitly unfilled: the site's .how-aigen rules fill svg shapes
// with currentColor, which turned this into a solid dot.
const INFO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="7.6" x2="12.01" y2="7.6"/></svg>';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mmss = (ms) => { const s = Math.max(0, Math.round((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const RATES = [1, 1.25, 1.5, 0.9];
const BARS = 72;

// Shared across mounts: the fetch happens once per page life per query.
const episodeCache = new Map();
export function loadEpisode({ date = null, edition = null, full = false } = {}) {
  const key = `${date || 'latest'}|${edition || ''}|${full ? 1 : 0}`;
  if (!episodeCache.has(key)) {
    const qs = date ? `?date=${encodeURIComponent(date)}${edition ? `&edition=${edition}` : ''}${full ? '&full=1' : ''}` : (full ? '?full=1' : '');
    episodeCache.set(key, fetch(`/api/episodes${qs}`).then((r) => (r.ok ? r.json() : null)).then((d) => (d && d.episode) || null).catch(() => null));
  }
  return episodeCache.get(key);
}
export function loadEpisodeList(n = 30) {
  return fetch(`/api/episodes?list=${n}`).then((r) => (r.ok ? r.json() : null)).then((d) => (d && d.episodes) || []).catch(() => []);
}

// Every live player registers here so playing one pauses the rest.
const live = new Set();
export function seekBriefingPlayers(ms) {
  const arr = [...live].filter((c) => c.el && c.el.isConnected);
  if (!arr.length) return false;
  const inOpen = arr.find((c) => c.el.closest('.di-focus')) || arr[0];
  inOpen.seekTo(ms);
  try { inOpen.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
  return true;
}

// Resample the stored peaks to the bar count; a missing set draws a quiet,
// even track so the control still reads as a scrubber.
function barsFor(peaks) {
  const src = Array.isArray(peaks) && peaks.length ? peaks : null;
  const out = [];
  for (let i = 0; i < BARS; i++) {
    if (!src) { out.push(28); continue; }
    const a = Math.floor((i / BARS) * src.length); const b = Math.max(a + 1, Math.floor(((i + 1) / BARS) * src.length));
    let m = 0; for (let k = a; k < b && k < src.length; k++) m = Math.max(m, Number(src[k]) || 0);
    out.push(Math.max(12, Math.round(Math.pow(m / 100, 0.75) * 100)));
  }
  return out;
}

export function playerHTML(ep) {
  const durMin = ep && ep.duration_ms ? Math.round(ep.duration_ms / 60000) : 0;
  const chapters = (ep && Array.isArray(ep.chapters) ? ep.chapters : []).filter((c) => c && c.beat !== 'intro');
  const bars = barsFor(ep && ep.peaks);
  return `
    <div class="bp" data-bp>
      <div class="bp-row">
        <div class="bp-lead">
          <span class="bp-tile" aria-hidden="true">${EP_ICON}</span>
          <div class="bp-txt">
            <div class="bp-title">Listen to the Briefing</div>
            <div class="bp-meta">${durMin ? `${durMin} min <span class="bp-dot" aria-hidden="true">·</span> ` : ''}AI-narrated from today’s sourced <span class="bp-nb">briefing<button type="button" class="bp-info how-aigen" data-how-it-works aria-label="How the audio is made">${INFO}</button></span></div>
          </div>
        </div>
        <div class="bp-transport">
          <button type="button" class="bp-play" data-bp-play aria-label="Play">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path data-bp-icon d="${PLAY_D}"/></svg>
          </button>
          <div class="bp-wavewrap">
            <div class="bp-wave" data-bp-track role="slider" aria-label="Position" aria-valuemin="0" aria-valuemax="${ep && ep.duration_ms || 0}" aria-valuenow="0" tabindex="0">
              ${bars.map((h) => `<i style="height:${h}%"></i>`).join('')}
            </div>
            <div class="bp-times"><span data-bp-cur>0:00</span><span>${mmss(ep && ep.duration_ms)}</span></div>
          </div>
        </div>
        <div class="bp-ctrls">
          <button type="button" class="bp-ctl bp-rate" data-bp-rate aria-label="Playback speed"><span data-bp-rate-lbl>1×</span>${CHEV}</button>
          <button type="button" class="bp-ctl bp-mute" data-bp-mute aria-label="Mute"><span data-bp-mute-ic>${VOL_ON}</span></button>
          ${chapters.length ? `<span class="bp-vsep" aria-hidden="true"></span><button type="button" class="bp-ctl bp-ctl--chapters" data-bp-chapters aria-expanded="false">${LIST}<span>Chapters</span></button>` : ''}
        </div>
      </div>
      ${chapters.length ? `<ol class="bp-chapters" data-bp-chapterlist hidden>
        ${chapters.map((c) => `<li><button type="button" class="bp-chapter" data-bp-seek="${Number(c.start_ms) || 0}"><span class="bp-chapter-tc">${mmss(c.start_ms)}</span><span class="bp-chapter-nm">${esc(c.label)}</span></button></li>`).join('')}
      </ol>` : ''}
      <audio preload="none" src="${esc(ep && ep.url)}"></audio>
    </div>`;
}

// Mount into `host` (innerHTML replaced). Returns the controller, or null.
export function mountBriefingPlayer(host, ep) {
  if (!host || !ep || !ep.url) return null;
  host.innerHTML = playerHTML(ep);
  host.hidden = false;
  const root = host.querySelector('[data-bp]');
  const au = root.querySelector('audio');
  const play = root.querySelector('[data-bp-play]');
  const icon = root.querySelector('[data-bp-icon]');
  const track = root.querySelector('[data-bp-track]');
  const bars = [...track.querySelectorAll('i')];
  const cur = root.querySelector('[data-bp-cur]');
  const rateBtn = root.querySelector('[data-bp-rate]');
  const rateLbl = root.querySelector('[data-bp-rate-lbl]');
  const muteBtn = root.querySelector('[data-bp-mute]');
  const muteIc = root.querySelector('[data-bp-mute-ic]');
  const chBtn = root.querySelector('[data-bp-chapters]');
  const chList = root.querySelector('[data-bp-chapterlist]');
  const DUR = (Number(ep.duration_ms) || 0) / 1000;
  let ri = 0; let dragging = false; let lastOn = -1;

  const dur = () => (au.duration && isFinite(au.duration) ? au.duration : DUR);
  const setIcon = () => { icon.setAttribute('d', au.paused ? PLAY_D : PAUSE_D); play.setAttribute('aria-label', au.paused ? 'Play' : 'Pause'); root.classList.toggle('is-playing', !au.paused); };
  const paint = () => {
    const d = dur(); const p = d ? Math.min(1, au.currentTime / d) : 0;
    const on = Math.floor(p * bars.length);
    if (on !== lastOn) { bars.forEach((b, i) => b.classList.toggle('on', i < on)); lastOn = on; }
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
  rateBtn.addEventListener('click', () => { ri = (ri + 1) % RATES.length; au.playbackRate = RATES[ri]; rateLbl.textContent = `${RATES[ri]}×`; });
  muteBtn.addEventListener('click', () => { au.muted = !au.muted; muteIc.innerHTML = au.muted ? VOL_OFF : VOL_ON; muteBtn.setAttribute('aria-label', au.muted ? 'Unmute' : 'Mute'); muteBtn.classList.toggle('is-muted', au.muted); });
  const seekFromEvent = (e) => {
    const r = track.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    au.currentTime = Math.max(0, Math.min(dur(), (x / r.width) * dur())); paint();
  };
  track.addEventListener('pointerdown', (e) => { dragging = true; try { track.setPointerCapture(e.pointerId); } catch (_) {} seekFromEvent(e); });
  track.addEventListener('pointermove', (e) => { if (dragging) seekFromEvent(e); });
  track.addEventListener('pointerup', (e) => { dragging = false; try { track.releasePointerCapture(e.pointerId); } catch (_) {} });
  track.addEventListener('pointercancel', () => { dragging = false; });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { au.currentTime = Math.min(dur(), au.currentTime + 10); paint(); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { au.currentTime = Math.max(0, au.currentTime - 10); paint(); e.preventDefault(); }
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
        navigator.mediaSession.metadata = new MediaMetadata({ title: ep.title || 'Global AI Morning Briefing', artist: 'Standard Topic', album: `Morning · ${ep.edition_date || ''}` });
        navigator.mediaSession.setActionHandler('seekbackward', () => { au.currentTime = Math.max(0, au.currentTime - 10); });
        navigator.mediaSession.setActionHandler('seekforward', () => { au.currentTime = Math.min(dur(), au.currentTime + 10); });
      } catch (_) {}
    });
  }
  setIcon(); paint();
  return ctl;
}

// Fetch the edition the card is showing and mount it. `host` may be missing
// (a topic page has no flagship player) — no-op.
export async function mountLatestBriefingPlayer(host, opts = {}) {
  if (!host) return null;
  const ep = await loadEpisode(opts.query || {});
  if (!ep || !host.isConnected) { if (host) host.hidden = true; return null; }
  return mountBriefingPlayer(host, ep);
}
