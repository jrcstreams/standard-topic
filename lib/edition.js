// The edition clock (revamp1433).
//
// An edition is the set of things a reader sees together: the sixteen topic
// briefings and the podcast built from them. Editions RELEASE at 5:00 and 17:00
// America/New_York, and everything in one is generated in the hour before, held
// unreleased, and published at the same instant by /api/cron/release.
//
// Two questions, and they have different answers at the same moment:
//   buildingEdition() — the next release. What the wave and the episode job are
//                       working on right now. At 4:20 AM that is today/morning.
//   liveEdition()     — the most recent release at or before now. What a reader
//                       is looking at. At 4:20 AM that is still yesterday/evening.
//
// Everything keys off America/New_York, so the clock is right across daylight
// saving without anyone maintaining UTC offsets.

const RELEASE_HOURS_ET = { morning: 5, evening: 17 };

const ET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
});

function etParts(d = new Date()) {
  const p = Object.fromEntries(ET_FMT.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24 };
}

// The instant that a given ET wall-clock hour occurs, resolved through the
// offset that actually applies on that date.
function etInstant(y, m, d, h) {
  const guess = Date.UTC(y, m - 1, d, h + 5, 0, 0);
  for (const off of [5, 4]) {
    const t = new Date(Date.UTC(y, m - 1, d, h + off, 0, 0));
    const p = etParts(t);
    if (p.y === y && p.m === m && p.d === d && p.h === h) return t;
  }
  return new Date(guess);
}

const pad = (n) => String(n).padStart(2, '0');
const dateStr = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;

function makeEdition(y, m, d, edition) {
  const date = dateStr({ y, m, d });
  return {
    date,
    edition,
    key: `${date}|${edition}`,
    releaseAt: etInstant(y, m, d, RELEASE_HOURS_ET[edition]),
  };
}

// The edition currently being built: the next release after `now`.
function buildingEdition(now = new Date()) {
  const p = etParts(now);
  if (p.h < RELEASE_HOURS_ET.morning) return makeEdition(p.y, p.m, p.d, 'morning');
  if (p.h < RELEASE_HOURS_ET.evening) return makeEdition(p.y, p.m, p.d, 'evening');
  const t = etParts(new Date(now.getTime() + 24 * 36e5));
  return makeEdition(t.y, t.m, t.d, 'morning');
}

// The edition a reader is seeing: the most recent release at or before `now`.
function liveEdition(now = new Date()) {
  const p = etParts(now);
  if (p.h >= RELEASE_HOURS_ET.evening) return makeEdition(p.y, p.m, p.d, 'evening');
  if (p.h >= RELEASE_HOURS_ET.morning) return makeEdition(p.y, p.m, p.d, 'morning');
  const y = etParts(new Date(now.getTime() - 24 * 36e5));
  return makeEdition(y.y, y.m, y.d, 'evening');
}

// The edition before a given one: yesterday/evening before today/morning,
// today/morning before today/evening. When an edition is due but HELD (no
// episode yet), this is the one a reader is still looking at.
function previousEdition(ed) {
  if (ed.edition === 'evening') {
    const [y, m, d] = ed.date.split('-').map(Number);
    return makeEdition(y, m, d, 'morning');
  }
  const p = etParts(new Date(ed.releaseAt.getTime() - 24 * 36e5));
  return makeEdition(p.y, p.m, p.d, 'evening');
}

// A forced edition for manual runs. EPISODE_EDITION pins which half of the day;
// EPISODE_DATE (YYYY-MM-DD) pins which day, which a rebuild after midnight
// needs — forcing "evening" at 00:09 ET otherwise builds TOMORROW's evening
// edition out of tonight's news, seventeen hours early.
function forcedEdition(now = new Date()) {
  const forced = process.env.EPISODE_EDITION;
  const dateStr = String(process.env.EPISODE_DATE || '').trim();
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr.split('-').map(Number) : null;
  if (forced !== 'morning' && forced !== 'evening') {
    if (!dated) return null;
    // A date with no edition takes the edition the clock is on.
    const p0 = etParts(now);
    const ed0 = (p0.h >= RELEASE_HOURS_ET.morning && p0.h < RELEASE_HOURS_ET.evening) ? 'morning' : 'evening';
    return makeEdition(dated[0], dated[1], dated[2], ed0);
  }
  if (dated) return makeEdition(dated[0], dated[1], dated[2], forced);
  const p = etParts(now);
  return makeEdition(p.y, p.m, p.d, forced);
}

module.exports = {
  RELEASE_HOURS_ET, etParts, etInstant,
  buildingEdition, liveEdition, forcedEdition, makeEdition, previousEdition,
};
