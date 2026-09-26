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
      navigator.mediaSession.metadata = new MediaMetadata({ title: ep.title || editionName(ep), artist: 'Standard Topic', album: `${editionName(ep)} · ${editionTag(ep)} · ${ep.edition_date || ''}` });
      navigator.mediaSession.setActionHandler('play', () => briefingAudio.play());
      navigator.mediaSession.setActionHandler('pause', () => briefingAudio.pause());
      navigator.mediaSession.setActionHandler('seekbackward', () => { au.currentTime = Math.max(0, au.currentTime - 15); });
      navigator.mediaSession.setActionHandler('seekforward', () => { au.currentTime = Math.min(briefingAudio.duration(), au.currentTime + 15); });
    } catch (_) {}
  });
  return au;
}

// revamp1433: an episode names itself by its edition — the evening one is not
// the morning briefing, and the dock is the one place a reader sees it while
// the page behind it has moved on.
// revamp1555: the show is The Front Page; the edition rides beside it.
function editionName() { return 'The Front Page'; }
function editionTag(ep) { return (ep && ep.edition === 'evening') ? 'Evening' : 'Morning'; }

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
// revamp1445: the dock in two states. COLLAPSED is one line — the edition and
// the current chapter on the left, play on the right, a chevron — with a thin
// progress line along its bottom edge and nothing else. EXPANDED (the chevron
// or the title) opens the chapter list AND the full player under it: back and
// forward 15, the draggable scrubber with times, speed, and stop. The line is
// the Spotify split: a glance shows where you are; the controls live one tap
// away. Same markup on a phone, where the collapsed strip is the thing that
// has to stay small.
export function mountBriefingDock() {
  if (dock || !document.body) return dock;
  dock = document.createElement('div');
  dock.className = 'bpd bpd--v2';
  dock.setAttribute('role', 'region'); dock.setAttribute('aria-label', 'Now playing');
  dock.hidden = true;
  const CHEV = '<svg class="bpd-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 15 12 9 18 15"/></svg>';
  const FWD = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/><text x="8.2" y="15.5" font-size="7.5" font-weight="700" fill="currentColor" stroke="none" font-family="inherit">15</text></svg>';
  dock.innerHTML = `
    <div class="bpd-panel" data-bpd-panel hidden>
      <div class="bpd-chapters" data-bpd-chapters><div class="bpd-chapters-h">Chapters</div><ol class="bpd-chlist" data-bpd-chlist></ol></div>
      <div class="bpd-full">
        <div class="bpd-scrub">
          <span class="bpd-t" data-bpd-cur>0:00</span>
          <div class="bpd-track" data-bpd-track role="slider" aria-label="Position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><div class="bpd-fill" data-bpd-fill></div><div class="bpd-knob" data-bpd-knob></div></div>
          <span class="bpd-t" data-bpd-dur>0:00</span>
        </div>
        <div class="bpd-ctrls">
          <button type="button" class="bpd-ctl" data-bpd-back aria-label="Back 15 seconds">${BACK}</button>
          <button type="button" class="bpd-ctl" data-bpd-fwd aria-label="Forward 15 seconds">${FWD}</button>
          <button type="button" class="bpd-ctl bpd-rate" data-bpd-rate aria-label="Playback speed"><span data-bpd-rate-lbl>1×</span></button>
          <button type="button" class="bpd-ctl bpd-stop" data-bpd-x aria-label="Stop and close player">${X}<span>Stop</span></button>
        </div>
      </div>
    </div>
    <div class="bpd-row">
      <button type="button" class="bpd-txt" data-bpd-title-btn aria-expanded="false" aria-label="Chapters and player">
        <span class="bpd-kicker">${HEAD}<span>${editionName(briefingAudio.episode)}</span></span>
        <span class="bpd-title"><span class="bpd-title-tx" data-bpd-title></span></span>
      </button>
      <button type="button" class="bpd-play" data-bpd-play aria-label="Pause"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path data-bpd-icon d="${PAUSE_D}"/></svg></button>
      <button type="button" class="bpd-expand" data-bpd-expand aria-expanded="false" aria-label="Chapters and player">${CHEV}</button>
    </div>
    <div class="bpd-mini" data-bpd-mini aria-hidden="true"><div class="bpd-mini-fill" data-bpd-mini-fill></div></div>`;
  document.body.appendChild(dock);
  const play = dock.querySelector('[data-bpd-play]'), icon = dock.querySelector('[data-bpd-icon]'), back = dock.querySelector('[data-bpd-back]'), fwd = dock.querySelector('[data-bpd-fwd]');
  const track = dock.querySelector('[data-bpd-track]'), fill = dock.querySelector('[data-bpd-fill]'), knob = dock.querySelector('[data-bpd-knob]'), miniFill = dock.querySelector('[data-bpd-mini-fill]');
  const cur = dock.querySelector('[data-bpd-cur]'), dur = dock.querySelector('[data-bpd-dur]'), title = dock.querySelector('[data-bpd-title]'), titleBtn = dock.querySelector('[data-bpd-title-btn]'), expandBtn = dock.querySelector('[data-bpd-expand]'), x = dock.querySelector('[data-bpd-x]');
  const panel = dock.querySelector('[data-bpd-panel]'), chList = dock.querySelector('[data-bpd-chlist]');
  const rateBtn = dock.querySelector('[data-bpd-rate]'), rateLbl = dock.querySelector('[data-bpd-rate-lbl]');
  const RATES = [1, 1.25, 1.5, 2, 0.75];
  const A = briefingAudio;
  let raf = 0; let dragging = false; let dragT = 0; let builtFor = null;
  const setHeightVar = () => { try { document.body.style.setProperty('--bpd-h', `${dock.offsetHeight + 12}px`); } catch (_) {} };
  const buildChapters = () => {
    const e = A.episode; if (!e || builtFor === e.url) return; builtFor = e.url;
    const ch = (e.chapters || []).filter((c) => c && c.beat !== 'intro');
    chList.innerHTML = ch.map((c) => `<li><button type="button" class="bpd-ch" data-bpd-seek="${Number(c.start_ms) || 0}"><span class="bpd-ch-tc">${mmss((Number(c.start_ms) || 0) / 1000)}</span><span class="bpd-ch-nm">${esc(c.label)}</span></button></li>`).join('');
    chList.querySelectorAll('[data-bpd-seek]').forEach((b) => b.addEventListener('click', () => { A.seekTo(Number(b.dataset.bpdSeek), e); }));
    dock.querySelector('[data-bpd-chapters]').hidden = !ch.length;
  };
  const paintPos = (t, d) => {
    const p = d ? Math.min(1, Math.max(0, t / d)) : 0;
    const pct = `${(p * 100).toFixed(3)}%`;
    fill.style.width = pct; knob.style.left = pct; miniFill.style.width = pct;
    track.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    cur.textContent = mmss(t); dur.textContent = mmss(d);
  };
  const paint = () => {
    const d = A.duration(), t = dragging ? dragT : A.time();
    paintPos(t, d);
    const ch = A.chapterAt(t); const e = A.episode;
    title.textContent = ch && ch.label && ch.beat !== 'cold_open' ? ch.label : ((e && e.title) || '');
    const kick = dock.querySelector('.bpd-kicker > span'); if (kick && kick.textContent !== editionName(e)) kick.textContent = editionName(e);
    const playing = A.isPlaying();
    icon.setAttribute('d', playing ? PAUSE_D : PLAY_D); play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    dock.classList.toggle('is-playing', playing);
    rateLbl.textContent = `${String(A.rate()).replace(/\.0$/, '')}×`;
    if (!panel.hidden) { const ms = t * 1000; let active = null; chList.querySelectorAll('[data-bpd-seek]').forEach((b) => { if (ms >= Number(b.dataset.bpdSeek)) active = b; }); chList.querySelectorAll('[data-bpd-seek]').forEach((b) => b.classList.toggle('is-active', b === active)); }
  };
  const tick = () => { if (!A.isPlaying()) { raf = 0; return; } paint(); raf = requestAnimationFrame(tick); };
  const setOpen = (open) => {
    if (open) buildChapters();
    panel.hidden = !open;
    titleBtn.setAttribute('aria-expanded', String(open)); expandBtn.setAttribute('aria-expanded', String(open));
    dock.classList.toggle('is-expanded', open);
    paint(); setHeightVar();
  };
  const decide = () => {
    const show = A.started && !!A.episode && !A.anyViewVisible() && !A.el.ended;
    if (show !== !dock.hidden) { dock.hidden = !show; document.body.classList.toggle('has-bpd', show); if (show) { buildChapters(); setHeightVar(); } }
    if (show) { paint(); if (A.isPlaying() && !raf) raf = requestAnimationFrame(tick); }
  };
  A.on((type) => { if (type === 'load') builtFor = null; if (type === 'ended') { paint(); setTimeout(decide, 1200); return; } decide(); });
  play.addEventListener('click', () => A.toggle());
  back.addEventListener('click', () => { A.skip(-15); paint(); });
  fwd.addEventListener('click', () => { A.skip(15); paint(); });
  rateBtn.addEventListener('click', () => { const i = RATES.indexOf(A.rate()); A.setRate(RATES[(i + 1) % RATES.length]); paint(); });
  x.addEventListener('click', () => { A.stop(); setOpen(false); decide(); });
  titleBtn.addEventListener('click', () => setOpen(panel.hidden));
  expandBtn.addEventListener('click', () => setOpen(panel.hidden));
  // The scrubber: drag anywhere on the track; the position is applied on
  // release (and live while dragging for the readout), with the knob following.
  const tFrom = (e) => { const r = track.getBoundingClientRect(); const px = (e.clientX != null ? e.clientX : (e.touches && e.touches[0].clientX)) - r.left; const d = A.duration(); return d ? Math.max(0, Math.min(d, (px / r.width) * d)) : 0; };
  track.addEventListener('pointerdown', (e) => { dragging = true; dragT = tFrom(e); try { track.setPointerCapture(e.pointerId); } catch (_) {} dock.classList.add('is-scrubbing'); paint(); e.preventDefault(); });
  track.addEventListener('pointermove', (e) => { if (!dragging) return; dragT = tFrom(e); paint(); });
  const endDrag = (e) => { if (!dragging) return; dragging = false; dock.classList.remove('is-scrubbing'); try { track.releasePointerCapture(e.pointerId); } catch (_) {} try { A.el.currentTime = dragT; } catch (_) {} paint(); };
  track.addEventListener('pointerup', endDrag); track.addEventListener('pointercancel', endDrag);
  track.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { A.skip(10); e.preventDefault(); } if (e.key === 'ArrowLeft') { A.skip(-10); e.preventDefault(); } if (e.key === ' ' || e.key === 'Enter') { A.toggle(); e.preventDefault(); } paint(); });
  window.addEventListener('resize', () => { if (!dock.hidden) setHeightVar(); });
  // A reload: come back paused where it was, dock showing.
  if (A.restore()) decide();
  return dock;
}
