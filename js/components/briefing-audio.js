// The briefing's audio engine and its dock (revamp1382).
//
// One <audio> for the whole site, attached to document.body once and never
// re-rendered, so the Morning AI Briefing keeps playing while the reader moves
// between pages — the routes only replace #content. Every player on the site
// (the home card, the hub card) is a VIEW of this engine: it reads the
// engine's state and sends it commands, and owns no audio of its own.
//
// The dock is a small fixed player that shows itself whenever audio has been
// started and no on-page view of the same episode is in the viewport — so it
// appears when you scroll the card away or leave the page, and steps aside
// when the card is back in view. Its ✕ stops the audio and dismisses it.
//
// Leaving the site (a link out, closing the tab) unloads the document and the
// audio dies with it; nothing here fights that. A reload is remembered in
// sessionStorage and comes back PAUSED at the same position (browsers will
// not resume audio after a reload without a tap), with the dock offering play.

const KEY = 'st:briefing-audio';
const subs = new Set();
const views = new Map();          // root → { ep, visible }
let au = null; let ep = null; let started = false; let lastPersist = 0;

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mmss = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const emit = (type) => { subs.forEach((fn) => { try { fn(type); } catch (_) {} }); };

function persist() {
  try {
    if (!ep || !started) { sessionStorage.removeItem(KEY); return; }
    sessionStorage.setItem(KEY, JSON.stringify({ ep: slimEp(ep), t: au.currentTime || 0, rate: au.playbackRate || 1 }));
  } catch (_) {}
}
function slimEp(e) { return { id: e.id, url: e.url, title: e.title, edition_date: e.edition_date, edition: e.edition, duration_ms: e.duration_ms, chapters: e.chapters || [], peaks: null }; }

function ensure() {
  if (au) return au;
  au = document.createElement('audio');
  au.preload = 'none';
  au.setAttribute('data-briefing-engine', '');
  au.style.display = 'none';
  document.body.appendChild(au);
  ['play', 'pause', 'timeupdate', 'ended', 'ratechange', 'loadedmetadata', 'durationchange', 'seeked', 'waiting', 'playing'].forEach((t) => au.addEventListener(t, () => emit(t)));
  au.addEventListener('timeupdate', () => { const n = Date.now(); if (n - lastPersist > 1000) { lastPersist = n; persist(); } });
  au.addEventListener('ended', () => { persist(); });
  window.addEventListener('pagehide', persist);
  au.addEventListener('play', () => {
    if (!('mediaSession' in navigator) || !ep) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: ep.title || 'Morning AI Briefing', artist: 'Standard Topic', album: `Morning AI Briefing · ${ep.edition_date || ''}` });
      navigator.mediaSession.setActionHandler('play', () => briefingAudio.play());
      navigator.mediaSession.setActionHandler('pause', () => briefingAudio.pause());
      navigator.mediaSession.setActionHandler('seekbackward', () => { au.currentTime = Math.max(0, au.currentTime - 15); });
      navigator.mediaSession.setActionHandler('seekforward', () => { au.currentTime = Math.min(briefingAudio.duration(), au.currentTime + 15); });
    } catch (_) {}
  });
  return au;
}

export const briefingAudio = {
  get el() { return ensure(); },
  get episode() { return ep; },
  get started() { return started; },
  isCurrent(e) { return !!(ep && e && ep.url === e.url); },
  isPlaying(e) { ensure(); return (!e || this.isCurrent(e)) && started && !au.paused && !au.ended; },
  duration() { ensure(); return (au.duration && isFinite(au.duration)) ? au.duration : (ep && ep.duration_ms ? ep.duration_ms / 1000 : 0); },
  time() { ensure(); return au.currentTime || 0; },
  load(e) {
    ensure();
    if (!e || !e.url) return;
    if (!this.isCurrent(e)) { au.src = e.url; au.load(); ep = e; started = false; emit('load'); }
    else if (ep !== e && e.chapters) ep = e;     // a fuller record of the same episode
  },
  play(e) {
    if (e) this.load(e);
    if (!ep) return;
    started = true;
    const p = au.play(); if (p && p.catch) p.catch(() => {});
    emit('start');
  },
  pause() { ensure(); au.pause(); },
  toggle(e) { if (e && !this.isCurrent(e)) return this.play(e); if (au.paused || au.ended) this.play(); else this.pause(); },
  seekTo(ms, e) {
    if (e) this.load(e);
    const t = Math.max(0, (Number(ms) || 0) / 1000);
    const apply = () => { try { au.currentTime = t; } catch (_) {} };
    if (au.readyState >= 1) apply(); else au.addEventListener('loadedmetadata', apply, { once: true });
    this.play();
  },
  skip(sec) { ensure(); au.currentTime = Math.max(0, Math.min(this.duration(), (au.currentTime || 0) + sec)); },
  setRate(r) { ensure(); au.playbackRate = r; },
  rate() { ensure(); return au.playbackRate || 1; },
  stop() { ensure(); au.pause(); started = false; try { sessionStorage.removeItem(KEY); } catch (_) {} emit('stop'); },
  chapterAt(t) {
    const ch = (ep && ep.chapters) || []; let cur = null;
    for (const c of ch) { if (c && c.beat !== 'intro' && Number(c.start_ms) / 1000 <= t + 0.05) cur = c; }
    return cur;
  },
  on(fn) { subs.add(fn); return () => subs.delete(fn); },
  // Views: on-page players. The dock shows only when none of the current
  // episode's views is in the viewport.
  registerView(root, e) {
    if (!root) return () => {};
    const rec = { ep: e, visible: false, io: null };
    views.set(root, rec);
    if ('IntersectionObserver' in window) {
      rec.io = new IntersectionObserver((entries) => { rec.visible = entries.some((x) => x.isIntersecting && x.intersectionRatio > 0.2); emit('visibility'); }, { threshold: [0, 0.2, 0.6] });
      rec.io.observe(root);
    }
    return () => { if (rec.io) rec.io.disconnect(); views.delete(root); emit('visibility'); };
  },
  anyViewVisible() { if (!ep) return false; for (const [root, v] of views) { if (root.isConnected && v.ep && v.ep.url === ep.url && v.visible) return true; } return false; },
  // After a reload: the same episode, paused at the same position.
  restore() {
    let d = null; try { d = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_) {}
    if (!d || !d.ep || !d.ep.url) return false;
    ensure();
    ep = d.ep; started = true;
    au.src = ep.url; au.preload = 'metadata'; au.load();
    const t = Number(d.t) || 0;
    if (t > 0) au.addEventListener('loadedmetadata', () => { try { au.currentTime = t; } catch (_) {} emit('restore'); }, { once: true });
    if (d.rate) au.playbackRate = d.rate;
    emit('restore');
    return true;
  },
};

// ── The dock ────────────────────────────────────────────────────────────────
const PLAY_D = 'M8 5v14l11-7z';
const PAUSE_D = 'M6 5h4v14H6zM14 5h4v14h-4z';
const HEAD = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><text x="8.2" y="15.5" font-size="7.5" font-weight="700" fill="currentColor" stroke="none" font-family="inherit">15</text></svg>';
const X = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

let dock = null;
export function mountBriefingDock() {
  if (dock || !document.body) return dock;
  dock = document.createElement('div');
  dock.className = 'bpd';
  dock.setAttribute('role', 'region'); dock.setAttribute('aria-label', 'Now playing');
  dock.hidden = true;
  dock.innerHTML = `
    <div class="bpd-bar" data-bpd-track role="slider" aria-label="Position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><div class="bpd-fill" data-bpd-fill></div></div>
    <div class="bpd-row">
      <button type="button" class="bpd-play" data-bpd-play aria-label="Pause"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path data-bpd-icon d="${PAUSE_D}"/></svg></button>
      <button type="button" class="bpd-back" data-bpd-back aria-label="Back 15 seconds">${BACK}</button>
      <div class="bpd-txt">
        <div class="bpd-kicker">${HEAD}<span>Morning AI Briefing</span><span class="bpd-time"><span data-bpd-cur>0:00</span> / <span data-bpd-dur>0:00</span></span></div>
        <div class="bpd-title" data-bpd-title></div>
      </div>
      <button type="button" class="bpd-x" data-bpd-x aria-label="Stop and close player">${X}</button>
    </div>`;
  document.body.appendChild(dock);
  const play = dock.querySelector('[data-bpd-play]'), icon = dock.querySelector('[data-bpd-icon]'), back = dock.querySelector('[data-bpd-back]');
  const track = dock.querySelector('[data-bpd-track]'), fill = dock.querySelector('[data-bpd-fill]'), cur = dock.querySelector('[data-bpd-cur]'), dur = dock.querySelector('[data-bpd-dur]'), title = dock.querySelector('[data-bpd-title]'), x = dock.querySelector('[data-bpd-x]');
  const A = briefingAudio;
  let raf = 0;
  const paint = () => {
    const d = A.duration(), t = A.time(); const p = d ? Math.min(1, t / d) : 0;
    fill.style.width = `${(p * 100).toFixed(3)}%`;
    track.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    cur.textContent = mmss(t); dur.textContent = mmss(d);
    const ch = A.chapterAt(t); const e = A.episode;
    title.textContent = ch && ch.label && ch.beat !== 'cold_open' ? ch.label : ((e && e.title) || '');
    const playing = A.isPlaying();
    icon.setAttribute('d', playing ? PAUSE_D : PLAY_D); play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    dock.classList.toggle('is-playing', playing);
  };
  const tick = () => { if (!A.isPlaying()) { raf = 0; return; } paint(); raf = requestAnimationFrame(tick); };
  const decide = () => {
    const show = A.started && !!A.episode && !A.anyViewVisible() && !A.el.ended;
    if (show !== !dock.hidden) { dock.hidden = !show; document.body.classList.toggle('has-bpd', show); }
    if (show) { paint(); if (A.isPlaying() && !raf) raf = requestAnimationFrame(tick); }
  };
  A.on((type) => { if (type === 'ended') { paint(); setTimeout(decide, 1200); return; } decide(); });
  play.addEventListener('click', () => A.toggle());
  back.addEventListener('click', () => A.skip(-15));
  x.addEventListener('click', () => { A.stop(); decide(); });
  const seekFrom = (e) => { const r = track.getBoundingClientRect(); const px = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; const d = A.duration(); if (d) A.el.currentTime = Math.max(0, Math.min(d, (px / r.width) * d)); paint(); };
  track.addEventListener('pointerdown', seekFrom);
  track.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { A.skip(10); e.preventDefault(); } if (e.key === 'ArrowLeft') { A.skip(-10); e.preventDefault(); } if (e.key === ' ' || e.key === 'Enter') { A.toggle(); e.preventDefault(); } });
  window.addEventListener('scroll', () => { /* IntersectionObserver drives visibility; nothing to do here */ }, { passive: true });
  // A reload: come back paused where it was, dock showing.
  if (A.restore()) decide();
  return dock;
}
