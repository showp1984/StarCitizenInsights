// Where you were and when, from the positions the overlay shows (see src/overlay/parse.js): a cleaned track per
// star system, the stops you made and the trips between them. Distances are in km.

import {ms, median} from './model.js';

// A height the OCR couldn't read is left out rather than taken as 0.
const dz = (a, b) => (a[2] == null || b[2] == null ? 0 : a[2] - b[2]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], dz(a, b));
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], dz(a, b)];
const len2 = (v) => Math.hypot(v[0], v[1]);

// Two readings agree when the distance between them could have been covered in the time between them by anything
// but quantum travel (ships top out around 1.5 km/s), plus some slack for the last digits.
const near = (a, b, dtSec) => dist(a, b) <= 30 + 2.5 * dtSec;
// During quantum travel you move in a straight line: a reading between two good ones lies on the line between them.
function onLine(c, a, b) {
  const ab = sub(b, a);
  const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  if (!l2) return false;
  const ac = sub(c, a);
  const u = (ac[0] * ab[0] + ac[1] * ab[1] + ac[2] * ab[2]) / l2;
  if (u < -0.05 || u > 1.05) return false;
  const off = dist(c, [a[0] + u * ab[0], a[1] + u * ab[1], a[2] == null ? null : a[2] + u * ab[2]]);
  return off <= 50 + 0.03 * Math.sqrt(l2);
}

// OCR misreads a digit now and then. A reading counts when it is confirmed: both copies of the system position
// agreed (`sure`), or another reading within 3 minutes agrees with it. Then a reading that agrees with a confirmed
// one nearby, or lies on the line between two of them, counts too. Points are {t, at (ms), cands: [vector...]};
// each gets `v`, the candidate that counted, or null.
function confirm(points, sure) {
  const W = 180000;
  const strong = points.map((p, i) => {
    if (sure(p)) return p.cands[0];
    for (const c of p.cands) {
      for (let j = i - 1; j >= 0 && p.at - points[j].at <= W; j -= 1) if (points[j].cands.some((o) => near(c, o, (p.at - points[j].at) / 1000))) return c;
      for (let j = i + 1; j < points.length && points[j].at - p.at <= W; j += 1) if (points[j].cands.some((o) => near(c, o, (points[j].at - p.at) / 1000))) return c;
    }
    return null;
  });
  points.forEach((p, i) => {
    p.v = strong[i];
    if (p.v) return;
    let a = null;
    let b = null;
    for (let j = i - 1; j >= 0 && p.at - points[j].at <= W; j -= 1) if (strong[j]) { a = j; break; }
    for (let j = i + 1; j < points.length && points[j].at - p.at <= W; j += 1) if (strong[j]) { b = j; break; }
    for (const c of p.cands) {
      if ((a != null && near(c, strong[a], (p.at - points[a].at) / 1000)) || (b != null && near(c, strong[b], (points[b].at - p.at) / 1000)) ||
          (a != null && b != null && onLine(c, strong[a], strong[b]))) {
        p.v = c;
        break;
      }
    }
  });
}

// Where a body's centre is, from your positions in both frames: planets and moons turn about their z axis, so
// your distance from the centre in the system plane is the same in both, and your height differs by the centre's.
// The map data's centre is used when it fits; otherwise, with readings spread around the body, it's worked out.
function fitCenter(pairs, known) {
  if (known) {
    const res = median(pairs.map(([p, l]) => Math.abs(dist2(p, [known.x, known.y]) - len2(l))));
    if (res != null && res < 2) return {...known, checked: true};
  }
  if (pairs.length < 3) return known ? {...known, off: true} : null;
  const [p0, l0] = pairs[0];
  const r0 = len2(l0);
  // |q - c|² = r² for each reading, with q relative to the first one, becomes linear once the first is subtracted.
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let bx = 0;
  let by = 0;
  for (const [p, l] of pairs.slice(1)) {
    const q = [p[0] - p0[0], p[1] - p0[1]];
    const rhs = (q[0] ** 2 + q[1] ** 2 - len2(l) ** 2 + r0 ** 2) / 2;
    sxx += q[0] * q[0]; sxy += q[0] * q[1]; syy += q[1] * q[1];
    bx += q[0] * rhs; by += q[1] * rhs;
  }
  const det = sxx * syy - sxy * sxy;
  // Readings all in one spot, or on one line, don't pin the centre down.
  if (Math.abs(det) < 1e-6 * (sxx + syy) ** 2 || sxx + syy < 25) return known ? {...known, off: true} : null;
  const c = [p0[0] + (syy * bx - sxy * by) / det, p0[1] + (sxx * by - sxy * bx) / det];
  const res = median(pairs.map(([p, l]) => Math.abs(dist2(p, c) - len2(l))));
  if (res == null || res > 5) return known ? {...known, off: true} : null;
  return {...(known || {}), x: c[0], y: c[1], z: median(pairs.map(([p, l]) => (p[2] ?? 0) - (l[2] ?? 0))) ?? 0, fitted: true};
}

const STOP_RADIUS = 5;
const MIN_STOP_MS = 120000;
const GAP_MS = 10 * 60000;

// map: public/data/starmap.json. Options:
// - nameOf: turns a location key (RR_P2_L4, GrimHEX) into a place name;
// - events: Game.log timeline entries ({t, kind, text}), filed under the stop or trip they happened in;
// - places: where the overlay named a place in any session ({place, body, local}), so a stop there is named even
//   when this time the location line couldn't be read;
// - logPlaces: where Game.log saw you open your inventory ({t, last, name}).
export function buildJourney(readings, map, {nameOf = (k) => k, events = [], places: knownPlaces = [], logPlaces = []} = {}) {
  const all = readings.filter((r) => r.pos || r.local).map((r) => ({...r, at: ms(r.t)})).sort((a, b) => a.at - b.at);
  // System positions, per star system.
  const bySystem = new Map();
  for (const r of all) if (r.pos && r.system) (bySystem.get(r.system) || bySystem.set(r.system, []).get(r.system)).push(r);
  for (const list of bySystem.values()) {
    const pts = list.map((r) => ({at: r.at, r, cands: [r.pos, r.pos2].filter((v) => v && v[0] != null && v[1] != null)}));
    confirm(pts, (p) => p.r.posCheck === 2);
    for (const p of pts) p.r.p = p.v;
  }
  // Positions relative to a planet, moon, Lagrange or jump point, per body.
  const byBody = new Map();
  for (const r of all) if (r.local && r.body) (byBody.get(r.body) || byBody.set(r.body, []).get(r.body)).push(r);
  for (const list of byBody.values()) {
    const pts = list.map((r) => ({at: r.at, r, cands: [r.local]}));
    confirm(pts, () => false);
    for (const p of pts) p.r.l = p.v;
  }

  // Body centres: from the map data where your readings fit it, worked out from your readings where they don't.
  const bodies = {};
  for (const [code, list] of byBody) {
    const sys = list[0].system;
    const s = map.systems[sys];
    const known = s && (s.bodies.find((b) => b.code === code) || s.lagrange.find((l) => l.code === code));
    const pairs = list.filter((r) => r.p && r.l).map((r) => [r.p, r.l]);
    const c = pairs.length ? fitCenter(pairs, known || null) : known ? {...known} : null;
    if (c) bodies[code] = {...c, code, system: sys};
  }

  const pts = all.filter((r) => r.p || r.l);
  const gap = (a, b) => b.at - a.at > GAP_MS;

  // Where to draw you on the system map (`d`). Planets and moons turn, so parked at Grim HEX your system position
  // sweeps an arc of hundreds of km. For each visit to a planet or moon the map holds the body still at the angle
  // it had when you arrived, so time spent in one spot stays one spot and the track over the ground keeps its shape.
  let visit = null;
  for (const r of pts) {
    const b = r.body && /^[A-Z][a-z]+\d[a-z]?$/.test(r.body) ? bodies[r.body] : null;
    if (!b || !r.l || !(b.checked || b.fitted)) {
      r.d = r.p;
      if (!r.l || r.body !== (visit && visit.body)) visit = null;
      continue;
    }
    if (!visit || visit.body !== r.body || r.at - visit.last > GAP_MS) visit = {body: r.body, angle: null, last: r.at};
    if (visit.angle == null && r.p) visit.angle = Math.atan2(r.p[1] - b.y, r.p[0] - b.x) - Math.atan2(r.l[1], r.l[0]);
    visit.last = r.at;
    if (visit.angle == null) {
      r.d = r.p;
      continue;
    }
    const [cos, sin] = [Math.cos(visit.angle), Math.sin(visit.angle)];
    r.d = [b.x + cos * r.l[0] - sin * r.l[1], b.y + sin * r.l[0] + cos * r.l[1], r.p ? r.p[2] : (b.z || 0) + (r.l[2] ?? 0)];
  }

  // Stops: you stayed within 5 km for at least 2 minutes, measured in the frame of the body you were at, so a
  // turning moon carrying you along doesn't count as moving. Without a position in that frame, the system
  // position is compared with the last one, allowing for that turning (up to ~0.7 km/s). A stop carries on over
  // a gap in the readings when you were still in the same spot after it.
  const sameSpot = (r, c) => {
    const a = c.anchor;
    if (r.l && a.l && r.body === a.body) return dist(r.l, a.l) <= STOP_RADIUS;
    const prev = [...c.list].reverse().find((x) => x.p);
    return !!(r.p && prev) && dist(r.p, prev.p) <= STOP_RADIUS + (prev.body ? (0.7 * (r.at - prev.at)) / 1000 : 0);
  };
  const stops = [];
  let cur = null;
  const close = () => {
    if (cur && cur.list.length >= 2 && cur.list[cur.list.length - 1].at - cur.list[0].at >= MIN_STOP_MS) stops.push(cur.list);
    cur = null;
  };
  for (const r of pts) {
    if (cur && sameSpot(r, cur)) {
      cur.list.push(r);
      continue;
    }
    close();
    cur = {anchor: r, list: [r]};
  }
  close();

  const stopOut = stops.map((list) => describeStop(list, bodies, map, nameOf, knownPlaces, logPlaces));
  // Trips: everything between two stops, and before the first and after the last.
  const moves = [];
  const edge = (r) => ({start: r.t, end: r.t, startAt: r.at, endAt: r.at, edge: true});
  const bounds = pts.length ? [edge(pts[0]), ...stopOut, edge(pts[pts.length - 1])] : [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const a = bounds[i];
    const b = bounds[i + 1];
    const list = pts.filter((r) => r.at >= a.endAt && r.at <= b.startAt);
    if (list.length < 2) continue;
    if (list.length === 2 && b.startAt - a.endAt > GAP_MS && !a.edge && !b.edge && list[0].body === list[1].body) {
      moves.push({kind: 'gap', start: a.end, end: b.start, startAt: a.endAt, endAt: b.startAt, minutes: (b.startAt - a.endAt) / 60000, list});
      continue;
    }
    const legs = splitLegs(list);
    legs.forEach((leg, k) => moves.push(describeMove(leg.list, k === 0 && !a.edge ? a : null, k === legs.length - 1 && !b.edge ? b : null, gap, leg.kind)));
  }

  const items = [...stopOut.map((s) => ({...s, type: 'stop'})), ...moves.map((m) => ({...m, type: 'move'}))].sort((x, y) => x.startAt - y.startAt || (x.type === 'move' ? -1 : 1));
  for (const e of events) {
    const at = ms(e.t);
    const it = items.find((x) => at >= x.startAt && at <= x.endAt) || null;
    if (it) (it.events = it.events || []).push(e);
  }
  // A trip with a loading screen in it was a respawn or a relog, not travel (you can come back somewhere else).
  for (const m of items) if (m.type === 'move' && m.kind !== 'jump' && (m.events || []).some((e) => e.kind === 'load')) m.kind = 'relog';
  // Places you've been that the overlay named: where they really are, which the map data may not know.
  const places = [];
  for (const s of stopOut) {
    if (!s.location || !s.pos) continue;
    if (!places.some((p) => p.location === s.location)) places.push({location: s.location, name: s.name, system: s.system, pos: s.pos});
  }
  const systems = [...new Set(pts.map((r) => r.system).filter(Boolean))];
  const trips = items.filter((x) => x.type === 'move');
  const km = trips.filter((m) => m.kind !== 'relog').reduce((a, m) => a + (m.km || 0), 0);
  return {
    points: pts,
    systems,
    tracks: Object.fromEntries(systems.map((s) => [s, pts.filter((r) => r.system === s && r.d)])),
    bodies,
    stops: stopOut,
    moves: trips,
    items,
    places,
    start: pts.length ? pts[0].t : null,
    end: pts.length ? pts[pts.length - 1].t : null,
    km,
    quantum: trips.filter((m) => m.kind === 'quantum').length,
    jumps: trips.filter((m) => m.kind === 'jump').length,
  };
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
function bodyName(code, map) {
  for (const s of Object.values(map.systems)) {
    const b = s.bodies.find((x) => x.code === code);
    if (b) return b.name;
    const l = s.lagrange.find((x) => x.code === code);
    if (l) return l.name;
  }
  let m;
  if ((m = /^JP_(\w+)_(\w+)$/.exec(code))) return `${m[1]}–${m[2]} jump point`;
  if ((m = /^([A-Z][a-z]+)(\d)_L(\d)$/.exec(code))) return `${m[1]} ${ROMAN[m[2]]} L${m[3]}`;
  if ((m = /^([A-Z][a-z]+)(\d)([a-z]?)$/.exec(code))) return `${m[1]} ${ROMAN[m[2]]}${m[3] ? ` ${m[3]}` : ''}`;
  return code;
}
export {bodyName};

const most = (values) => {
  const n = new Map();
  for (const v of values) if (v) n.set(v, (n.get(v) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
const mean = (vs) => {
  if (!vs.length) return null;
  return [0, 1, 2].map((k) => {
    const xs = vs.map((v) => v[k]).filter((x) => x != null);
    return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null;
  });
};

// Game.log's inventory location counts for a stop only when it belongs to the body you were at.
function fitsBody(location, body) {
  let m;
  if (!location || !body) return false;
  if ((m = /^RR_P(\d)_L(\d)$/.exec(location))) return body === `Pyro${m[1]}_L${m[2]}`;
  if ((m = /^RR_P(\d)_LEO$/.exec(location))) return body === `Pyro${m[1]}`;
  if ((m = /^RR_(HUR|CRU|ARC|MIC)_LEO$/.exec(location))) return body === `Stanton${{HUR: 1, CRU: 2, ARC: 3, MIC: 4}[m[1]]}`;
  if (location === 'GrimHEX') return body === 'Stanton2c';
  if ((m = /^(Stanton|Pyro|Nyx)(\d[a-z]?)_/.exec(location))) return body === `${m[1]}${m[2]}`;
  return false;
}

function describeStop(list, bodies, map, nameOf, knownPlaces, logPlaces) {
  const first = list[0];
  const last = list[list.length - 1];
  const body = most(list.map((r) => r.body));
  const local = mean(list.filter((r) => r.l && r.body === body).map((r) => r.l));
  const pos = mean(list.filter((r) => r.d).map((r) => r.d));
  // A place name from the overlay's location line, from an earlier visit, or from Game.log seeing you open your
  // inventory during the stop. (A reading's `location` may be Game.log's last one, long out of date.)
  const here = (l) => l && !/SolarSystem$|^[A-Z][a-z]+\d[a-z]?$|^[A-Z][a-z]+\d_L\d$/.test(l);
  const known = local && knownPlaces.find((p) => p.body === body && dist(p.local, local) <= 10);
  // Game.log may note the place a little before you get there (entering its zone), so a note up to a minute
  // outside the stop counts, but only when none falls inside it, and never when the map has that place and it's
  // more than 20 km away.
  const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const farFromMapped = (name) => {
    const poi = local && (map.pois[body] || []).find((p) => squash(name).includes(squash(p[0])) && squash(p[0]).length >= 6);
    return !!poi && dist(local, [poi[2], poi[3], poi[4]]) > 20;
  };
  const during = (slack) => logPlaces.filter((p) => ms(p.last || p.t) >= first.at - slack && ms(p.t) <= last.at + slack && here(p.name) && (!body || fitsBody(p.name, body)) && !farFromMapped(p.name));
  const logged = during(0).length ? during(0) : during(60000);
  const location = most(list.map((r) => r.place).filter(here)) || (known ? known.place : null) || most(logged.map((p) => p.name));
  const system = most(list.map((r) => r.system));
  const b = body && bodies[body];
  const planet = body && /^[A-Z][a-z]+\d[a-z]?$/.test(body);
  let name;
  let detail = body ? bodyName(body, map) : system ? `${system} system` : '';
  let near = null;
  let altitude = null;
  if (planet && local) {
    const r = b && b.r ? b.r : null;
    altitude = r && local[2] != null ? Math.hypot(...local) - r : null;
    const pois = (map.pois[body] || []).map((p) => ({name: p[0], type: p[1], d: dist(local, [p[2], p[3], p[4]])})).sort((x, y) => x.d - y.d);
    if (pois.length && pois[0].d <= 10) near = pois[0];
  }
  const bn = body ? bodyName(body, map) : '';
  if (location) name = nameOf(location);
  else if (near && near.d <= 2) name = near.name;
  else if (near) name = `Near ${near.name}`;
  else if (planet && altitude != null) {
    name = altitude < 5 ? `On ${bn}` : altitude < 100 ? `Above ${bn}` : altitude < 1.5 * (b.r || 0) ? `In orbit of ${bn}` : `In space near ${bn}`;
  } else if (body) name = /^JP_/.test(body) ? `At the ${bn}` : `In space near ${bn}`;
  else name = `In space${system ? ` (${system})` : ''}`;
  if (location && body) detail = bodyName(body, map);
  return {
    start: first.t, end: last.t, startAt: first.at, endAt: last.at, minutes: (last.at - first.at) / 60000,
    name, detail, location, body, system, local, pos, altitude, near: near ? near.name : null,
    servers: [...new Set(list.map((r) => r.server).filter(Boolean))],
    ship: most(list.map((r) => r.ship)),
    list,
  };
}

// A trip in legs: quantum travel (faster than 50 km/s between two readings; ships fly at up to ~1.5 km/s), the
// jump tunnel to another system, and flying (or walking) in between. Neighbouring legs share the reading where one
// ends and the next begins.
function splitLegs(list) {
  const kinds = [];
  for (let i = 1; i < list.length; i += 1) {
    const a = list[i - 1];
    const b = list[i];
    let k = 'flight';
    if (a.tunnel || b.tunnel || (a.system && b.system && a.system !== b.system)) k = 'jump';
    else if (a.p && b.p && a.system === b.system && dist(a.p, b.p) / Math.max(1, (b.at - a.at) / 1000) > 50) k = 'quantum';
    kinds.push(k);
  }
  // One slow step inside quantum travel (spooling, a reading taken as the drive slowed) belongs to it.
  for (let i = 1; i + 1 < kinds.length; i += 1) if (kinds[i] === 'flight' && kinds[i - 1] === 'quantum' && kinds[i + 1] === 'quantum') kinds[i] = 'quantum';
  const legs = [];
  kinds.forEach((k, i) => {
    const last = legs[legs.length - 1];
    if (last && last.kind === k) last.list.push(list[i + 1]);
    else legs.push({kind: k, list: [list[i], list[i + 1]]});
  });
  return legs.length ? legs : [{kind: 'flight', list}];
}

function describeMove(list, from, to, gap, hint) {
  let km = 0;
  let fastest = 0;
  let gapMs = 0;
  for (let i = 1; i < list.length; i += 1) {
    const a = list[i - 1];
    const b = list[i];
    if (gap(a, b)) {
      gapMs += b.at - a.at;
      continue;
    }
    const d = a.body && a.body === b.body && a.l && b.l ? dist(a.l, b.l) : a.p && b.p && a.system === b.system ? dist(a.p, b.p) : null;
    if (d == null) continue;
    km += d;
    fastest = Math.max(fastest, d / Math.max(1, (b.at - a.at) / 1000));
  }
  const systems = [...new Set(list.map((r) => r.system).filter(Boolean))];
  const first = list[0];
  const last = list[list.length - 1];
  const minutes = ((to ? to.startAt : last.at) - (from ? from.endAt : first.at)) / 60000;
  // No two readings in one frame (say, leaving one moon and arriving at another): the straight line between the stops.
  let estimated = false;
  if (!km && from && to && from.pos && to.pos && from.system === to.system) {
    km = dist(from.pos, to.pos);
    estimated = true;
  }
  const kind = hint === 'jump' ? 'jump' : hint === 'quantum' || km / Math.max(1, minutes * 60) > 50 ? 'quantum' : km > 3 ? 'flight' : 'local';
  return {
    kind, km, estimated, fastest, gapMinutes: gapMs / 60000, systems,
    to: kind === 'jump' ? (list.find((r) => r.jumpTo) || {}).jumpTo || systems[systems.length - 1] || null : null,
    start: from ? from.end : first.t, end: to ? to.start : last.t,
    startAt: from ? from.endAt : first.at, endAt: to ? to.startAt : last.at,
    minutes,
    ship: most(list.map((r) => r.ship)),
    list,
  };
}

// The position at time `at`, between the two readings around it.
export function positionAt(points, at) {
  let a = null;
  let b = null;
  for (const r of points) {
    if (r.at <= at) a = r;
    else { b = r; break; }
  }
  if (!a) return b;
  if (!b || b.system !== a.system || b.at - a.at > GAP_MS) return a;
  if (!a.d || !b.d) return at - a.at < b.at - at ? a : b;
  const u = (at - a.at) / (b.at - a.at);
  return {...a, at, t: null, d: [0, 1, 2].map((k) => (a.d[k] ?? 0) + u * ((b.d[k] ?? 0) - (a.d[k] ?? 0))),
    l: a.l && b.l && a.body === b.body ? [0, 1, 2].map((k) => (a.l[k] ?? 0) + u * ((b.l[k] ?? 0) - (a.l[k] ?? 0))) : a.l};
}
