// Health scores and summaries from overlay readings (one reading = one look at the r_displayinfo overlay).

import {median, ms} from './model.js';

// 4.10 game servers run at up to 30 fps (the overlay shows 33.3 ms frames at full speed).
export const SERVER_FPS_TARGET = 30;

// 60% current server fps, 40% the lowest fps in the overlay's window, both against 30; minus 2 per hitch (up to 20).
export function readingHealth(r) {
  if (r == null || r.serverFps == null) return null;
  const fps = Math.min(1, r.serverFps / SERVER_FPS_TARGET);
  const low = Math.min(1, (r.serverFpsMin ?? r.serverFps) / SERVER_FPS_TARGET);
  const h = Math.round(100 * (0.6 * fps + 0.4 * low) - Math.min(20, 2 * (r.hitches || 0)));
  return Math.max(0, Math.min(100, h));
}

export function healthLabel(h) {
  if (h == null) return 'No data';
  if (h >= 80) return 'Good';
  if (h >= 60) return 'Fair';
  if (h >= 40) return 'Poor';
  return 'Bad';
}

export const healthClass = (h) => (h == null ? 'none' : h >= 80 ? 'good' : h >= 60 ? 'ok' : h >= 40 ? 'warn' : 'bad');

export function connectionLabel(r) {
  if (!r || r.pingMs == null) return null;
  if ((r.lossPct || 0) >= 2) return 'Losing packets';
  if (r.pingMs >= 180) return 'High ping';
  if (r.pingMs >= 90) return 'Fair';
  return 'Good';
}

// The overlay text doesn't always read cleanly, and in a ship its name banner covers part of the server lines.
// A field a reading missed is taken from the last reading that had it: the shard's player count within 5 minutes,
// the server's within 2 (same server), ping and your fps within 45 seconds. A missing server name is taken from
// the reading before when the reading after agrees. `filled` lists the fields filled this way.
const FILL_WINDOW_MS = {playersShard: 5 * 60000, playersServer: 2 * 60000, pingMs: 45000, lossPct: 45000, clientFps: 45000};
export function fillGaps(readings) {
  const sorted = [...readings].sort((a, b) => (a.t < b.t ? -1 : 1));
  const out = [];
  const seen = new Map();
  sorted.forEach((r, i) => {
    const copy = {...r};
    const filled = [];
    const before = out[out.length - 1];
    const after = sorted[i + 1];
    if (!copy.server && before && before.server && ms(r.t) - ms(before.t) <= 45000 && (!after || !after.server || after.server === before.server)) {
      copy.server = before.server;
      filled.push('server');
    }
    for (const [k, windowMs] of Object.entries(FILL_WINDOW_MS)) {
      const key = k === 'playersShard' ? `${k}|${copy.shard}` : `${k}|${copy.shard}|${copy.server}`;
      const last = seen.get(key);
      if (r[k] != null) seen.set(key, {t: r.t, v: r[k]});
      else if (last && ms(r.t) - ms(last.t) <= windowMs) {
        copy[k] = last.v;
        filled.push(k);
      }
    }
    if (filled.length) copy.filled = filled;
    out.push(copy);
  });
  return out;
}

// Places in the order you were there; the overlay's planet line only when no location was known at all.
function placesOf(list) {
  const locations = [...new Set(list.map((r) => r.location).filter(Boolean))];
  return locations.length ? locations : [...new Set(list.map((r) => r.planet).filter(Boolean))];
}

// One row per game server you were on (shard + server name).
export function summarizeServers(readings) {
  const by = new Map();
  for (const r of readings) {
    if (!r.server) continue;
    const key = `${r.shard || r.overlayShard || '?'}|${r.server}`;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r);
  }
  return [...by.values()].map((list) => {
    list.sort((a, b) => (a.t < b.t ? -1 : 1));
    const last = list[list.length - 1];
    const fps = list.map((r) => r.serverFps).filter((v) => v != null);
    const lows = list.map((r) => r.serverFpsMin ?? r.serverFps).filter((v) => v != null);
    const healths = list.map(readingHealth).filter((v) => v != null);
    let restartsSeen = 0;
    for (let i = 1; i < list.length; i += 1) if (list[i].restarts != null && list[i - 1].restarts != null && list[i].restarts > list[i - 1].restarts) restartsSeen += 1;
    return {
      key: `${last.shard || last.overlayShard || '?'}|${last.server}`,
      shard: last.shard || last.overlayShard || null,
      server: last.server,
      readings: list.length,
      first: list[0].t,
      last: last.t,
      fps: median(fps),
      low: lows.length ? Math.min(...lows) : null,
      playersServer: last.playersServer ?? null,
      playersShard: last.playersShard ?? null,
      maxPlayersServer: Math.max(0, ...list.map((r) => r.playersServer || 0)) || null,
      health: healths.length ? Math.round(median(healths)) : null,
      restartsSeen,
      places: placesOf(list),
      list,
    };
  });
}

// Shard health from the servers you've seen on it: their health weighted by how many players each one has.
export function shardHealth(servers) {
  const rated = servers.filter((s) => s.health != null);
  if (!rated.length) return null;
  const w = (s) => Math.max(1, s.playersServer || 1);
  const total = rated.reduce((a, s) => a + w(s), 0);
  const worst = rated.reduce((a, s) => (s.health < a.health ? s : a));
  return {health: Math.round(rated.reduce((a, s) => a + s.health * w(s), 0) / total), servers: rated.length, worst};
}

// Stretches of time on one game server, in order: where you were and when you moved.
export function serverSegments(readings) {
  const out = [];
  for (const r of [...readings].sort((a, b) => (a.t < b.t ? -1 : 1))) {
    const prev = out[out.length - 1];
    if (prev && prev.server === r.server && prev.shard === r.shard && ms(r.t) - ms(prev.end) < 10 * 60000) {
      prev.end = r.t;
      prev.list.push(r);
    } else {
      out.push({server: r.server, shard: r.shard, start: r.t, end: r.t, list: [r]});
    }
  }
  return out.map((s) => ({
    ...s,
    minutes: (ms(s.end) - ms(s.start)) / 60000,
    fps: median(s.list.map((r) => r.serverFps).filter((v) => v != null)),
    low: Math.min(...s.list.map((r) => r.serverFpsMin ?? r.serverFps).filter((v) => v != null)),
    players: s.list[s.list.length - 1].playersServer ?? null,
    places: placesOf(s.list),
  }));
}

// Time on each shard from Game.log joins: until the next join, a disconnect, or the end of the session.
export function shardStays(sessions) {
  const out = [];
  for (const s of sessions) {
    const joins = (s.joins || []).filter((j) => j.shard);
    joins.forEach((j, i) => {
      const next = joins[i + 1] ? joins[i + 1].t : null;
      const disc = (s.disconnects || []).find((d) => d.t > j.t && (!next || d.t <= next));
      const end = disc ? disc.t : next || s.end;
      out.push({shard: j.shard, region: j.region, session: s, start: j.t, end, minutes: Math.max(0, (ms(end) - ms(j.t)) / 60000)});
    });
  }
  return out;
}
