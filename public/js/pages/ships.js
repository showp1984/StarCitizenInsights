import {columns, hbars, table, fmt, legend, series, muted, critical, ROW_H} from '../kit.js';
import {sum, groupBy, monthRange, toLocal, ms} from '../model.js';
import {tile, card, head, draw, b} from './common.js';

const MAKERS = {
  AEGS: 'Aegis', ANVL: 'Anvil', RSI: 'Roberts Space Industries', DRAK: 'Drake', MISC: 'MISC', ORIG: 'Origin', CRUS: 'Crusader', ARGO: 'Argo',
  CNOU: 'Consolidated Outland', ESPR: 'Esperia', KRIG: 'Kruger', TMBL: 'Tumbril', GRIN: 'Greycat', XIAN: 'Aopoa', XNAA: 'Aopoa', BANU: 'Banu',
  MRAI: 'Mirai', GAMA: 'Gatac', VNCL: 'Vanduul', GLSN: 'Gallenson', AOPO: 'Aopoa', ARMR: 'Argo',
};
const maker = (ship) => MAKERS[ship.split('_')[0]] || ship.split('_')[0];
const shipName = (ship) => ship.replace(/^[A-Z]{3,4}_/, '').replace(/_/g, ' ');

export function render(root, {sessions}) {
  // A flight is one stint at the controls. Builds from late 2025 on only log leaving the seat, so those have no length.
  const flights = [];
  for (const s of sessions) {
    for (const f of s.flights) {
      const min = f.start ? (ms(f.end) - ms(f.start)) / 60000 : 0;
      flights.push({...f, s, min: Math.max(0, min), timed: !!f.start && min > 0, month: toLocal(s, f.end).slice(0, 7)});
    }
  }
  const timed = flights.filter((f) => f.timed);
  const timedFrom = timed.length ? timed[0].month : null;
  const timedTo = timed.length ? timed[timed.length - 1].month : null;
  const byShip = groupBy(flights, (f) => f.ship);
  const lost = sessions.flatMap((s) => s.vdest.filter((v) => v.mine && v.to === 2).map((v) => ({...v, s})));
  // Ship-combat kills credited to whatever you were flying at the time.
  const shipKills = new Map();
  for (const s of sessions) {
    const spans = s.flights.filter((f) => f.start);
    if (!spans.length) continue;
    for (const k of s.kills) {
      if (k.domain !== 'ship') continue;
      const t = ms(k.t);
      const f = spans.find((x) => ms(x.start) <= t && t <= ms(x.end));
      if (f) shipKills.set(f.ship, (shipKills.get(f.ship) || 0) + 1);
    }
  }
  const rows = [...byShip].map(([ship, v]) => ({
    ship, name: shipName(ship), maker: maker(ship), hours: sum(v, (f) => f.min) / 60, flights: v.length,
    first: v[0].s.day, last: v[v.length - 1].s.day, kills: shipKills.get(ship) || 0, lost: lost.filter((x) => x.ship === ship).length,
  })).sort((a, c) => c.flights - a.flights || c.hours - a.hours);
  const hours = sum(timed, (f) => f.min) / 60;
  const qt = sum(sessions, (s) => s.counts.qtArrivals);
  const top = rows[0];
  const byHours = [...rows].filter((r) => r.hours > 0).sort((a, c) => c.hours - a.hours);
  const span = timedFrom ? `${fmt.monthLong(timedFrom)} – ${fmt.monthLong(timedTo)}` : '';

  root.innerHTML = `
    ${head('Ships', rows.length ? `You took the controls ${b(fmt.int(flights.length))} times in ${b(fmt.int(rows.length))} different ships and vehicles. Your most-flown is the ${b(top.name)} (${b(fmt.int(top.flights))} times).${timedFrom ? ` The game logged how long you flew from ${b(span)}: ${b(fmt.int(hours))} hours in that window.` : ''} Newer builds only log when you leave the seat, so they count flights but not hours.` : 'No piloting was logged for this selection. The game writes it from May 2025 on.')}
    <div class="tiles">
      ${tile('Flights', fmt.int(flights.length), 'Times you left a pilot seat')}
      ${tile('Ships and vehicles flown', fmt.int(rows.length), rows.length ? `from ${fmt.int(new Set(rows.map((r) => r.maker)).size)} manufacturers` : '')}
      ${tile('Most flown', top ? top.name : '—', top ? `${fmt.int(top.flights)} flights` : '')}
      ${tile('Hours piloting', fmt.int(hours), span ? `Timed ${span} only` : 'Not timed in this selection')}
      ${tile('Quantum jumps', fmt.int(qt), 'Arrivals at a quantum destination')}
      ${tile('Ships lost while flying', fmt.int(lost.length), 'Destruction lines end Nov 2025')}
    </div>
    <div class="grid">
      ${card('sh-ships', 'Your most-flown ships', 'By number of flights. Hover for hours where the game timed them.')}
      ${card('sh-makers', 'By manufacturer', 'Number of flights.')}
      ${card('sh-monthly', 'Flights per month', 'Your six most-flown ships; everything else is grouped.', {wide: true, body: '<div id="sh-monthly-legend"></div><div class="chart" id="sh-monthly"></div>'})}
      ${card('sh-hours', 'Hours at the controls', span ? `Only ${span}, the window in which the game logged both taking and leaving the controls.` : 'The game did not time flights in this selection.')}
      ${card('sh-qt', 'Quantum jumps per month', 'Completed quantum travel arrivals.')}
      ${card('sh-lost', 'How you lost ships', 'Ships fully destroyed while they were yours to fly that session.', {legend: legend([[critical(), 'Someone else'], [series(5), 'Collision or crash'], [muted(), 'Self-destruct and other']])})}
      ${card('sh-table', 'Ship log', 'Every ship and vehicle you piloted. Ship kills are ship-combat kills scored while you held its controls.', {wide: true, body: '<div id="sh-table"></div>'})}
    </div>`;

  const topRows = rows.slice(0, 15);
  draw(root, 'sh-ships', () => Math.max(1, topRows.length) * ROW_H, (ctx) => {
    if (!topRows.length) return false;
    hbars(ctx, topRows, {label: (r) => `${r.name} · ${r.maker}`, value: (r) => r.flights, fmt: fmt.int, color: (r, k, i) => (i === 0 ? series(0) : series(1)),
      tip: (r) => [[null, 'Flights', fmt.int(r.flights)], [null, 'Timed hours', r.hours ? fmt.hours(r.hours) : 'not timed'], [null, 'Ship kills while flying', fmt.int(r.kills)], [null, 'Last flown', fmt.date(r.last)]]});
  });

  const makers = [...groupBy(rows, (r) => r.maker)].map(([m, v]) => ({m, flights: sum(v, (r) => r.flights), ships: v.length})).sort((a, c) => c.flights - a.flights).slice(0, 12);
  draw(root, 'sh-makers', () => Math.max(1, makers.length) * ROW_H, (ctx) => {
    if (!makers.length) return false;
    hbars(ctx, makers, {label: (r) => r.m, value: (r) => r.flights, fmt: fmt.int, color: () => series(1), tip: (r) => [[null, 'Flights', fmt.int(r.flights)], [null, 'Ships flown', fmt.int(r.ships)]]});
  });

  const topShips = rows.slice(0, 6).map((r) => r.ship);
  const colorOf = (k) => (k === 'other' ? muted() : series(topShips.indexOf(k)));
  root.querySelector('#sh-monthly-legend').innerHTML = legend([...topShips.map((k) => [colorOf(k), shipName(k)]), [muted(), 'Other']]);
  draw(root, 'sh-monthly', 260, (ctx) => {
    if (!flights.length) return false;
    const sorted = [...flights].sort((a, c) => (a.month < c.month ? -1 : 1));
    const months = monthRange(sorted[0].month, sorted[sorted.length - 1].month);
    const by = new Map();
    for (const f of flights) {
      const k = `${f.month}|${topShips.includes(f.ship) ? f.ship : 'other'}`;
      by.set(k, (by.get(k) || 0) + 1);
    }
    const keys = [...topShips, 'other'];
    columns(ctx, {cats: months, keys, get: (c, k) => by.get(`${c}|${k}`), color: (c, k) => colorOf(k), yFmt: fmt.int, xLabel: fmt.month,
      tip: (c) => [fmt.monthLong(c), keys.filter((k) => by.get(`${c}|${k}`)).map((k) => [colorOf(k), k === 'other' ? 'Other' : shipName(k), fmt.int(by.get(`${c}|${k}`))])]});
  });

  const hourRows = byHours.slice(0, 12);
  draw(root, 'sh-hours', () => Math.max(1, hourRows.length) * ROW_H, (ctx) => {
    if (!hourRows.length) return false;
    hbars(ctx, hourRows, {label: (r) => r.name, value: (r) => r.hours, fmt: fmt.hours, color: () => series(2), tip: (r) => [[null, 'Hours', fmt.hours(r.hours)], [null, 'Flights', fmt.int(r.flights)]]});
  });

  draw(root, 'sh-qt', 230, (ctx) => {
    const ms2 = sessions.length ? monthRange(sessions[0].month, sessions[sessions.length - 1].month) : [];
    const by = groupBy(sessions, (s) => s.month);
    const val = (m) => sum(by.get(m) || [], (s) => s.counts.qtArrivals);
    if (!ms2.length || !sum(ms2, val)) return false;
    columns(ctx, {cats: ms2, keys: ['n'], get: (c) => val(c), color: () => series(2), yFmt: fmt.int, xLabel: fmt.month, tip: (c) => [fmt.monthLong(c), [[null, 'Quantum jumps', fmt.int(val(c))]]]});
  });

  const lostRows = [...groupBy(lost, (v) => v.ship)].map(([ship, v]) => ({
    ship, other: v.filter((x) => x.cause !== 'me' && x.cause !== 'environment').length,
    crash: v.filter((x) => (x.cause === 'me' || x.cause === 'environment') && /Collision|Crash/i.test(x.how)).length,
    self: v.filter((x) => (x.cause === 'me' || x.cause === 'environment') && !/Collision|Crash/i.test(x.how)).length, n: v.length,
  })).sort((a, c) => c.n - a.n).slice(0, 12);
  draw(root, 'sh-lost', () => Math.max(1, lostRows.length) * ROW_H, (ctx) => {
    if (!lostRows.length) return false;
    hbars(ctx, lostRows, {label: (r) => shipName(r.ship), keys: ['other', 'crash', 'self'], get: (r, k) => r[k], fmt: fmt.int,
      color: (r, k) => (k === 'other' ? critical() : k === 'crash' ? series(5) : muted()),
      tip: (r) => [[critical(), 'Someone else', fmt.int(r.other)], [series(5), 'Collision or crash', fmt.int(r.crash)], [muted(), 'Self-destruct and other', fmt.int(r.self)]]});
  });

  table(root.querySelector('#sh-table'), {
    rows, sortKey: 'flights', search: 'Find a ship…',
    columns: [
      {key: 'name', label: 'Ship'},
      {key: 'maker', label: 'Maker'},
      {key: 'flights', label: 'Flights', num: true, fmt: fmt.int},
      {key: 'hours', label: 'Timed hours', num: true, fmt: (v) => (v ? fmt.dec(v) : '—')},
      {key: 'kills', label: 'Ship kills', num: true, fmt: fmt.int},
      {key: 'lost', label: 'Lost', num: true, fmt: fmt.int},
      {key: 'first', label: 'First flown', fmt: fmt.date},
      {key: 'last', label: 'Last flown', fmt: fmt.date},
    ],
  });
}
