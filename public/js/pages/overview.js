import {columns, hbars, calendar, fmt, legend, series, muted, ROW_H} from '../kit.js';
import {sum, median, countBy, sessionMonths, hardwareChanges, comparePatch, groupBy, quarterRange} from '../model.js';
import {tile, card, head, draw, b} from './common.js';

const PLACES = {
  GrimHEX: 'GrimHEX', Stanton1_Lorville: 'Lorville (Hurston)', Stanton3_Area18: 'Area18 (ArcCorp)', Stanton4_NewBabbage: 'New Babbage (microTech)',
  Stanton2_Orison: 'Orison (Crusader)', Nyx_Levski: 'Levski (Nyx)', AsteroidClusterBase_Nyx_Social_Keeger_001: 'Keeger social hub (Nyx)',
  RR_P2_L4: 'Checkmate (Pyro II L4)', RR_P3_L1: 'Starlight Service Station (Pyro III L1)',
  RR_P3_LEO: 'Station in Pyro III orbit', RR_P6_LEO: 'Station in Pyro VI orbit', RR_HUR_LEO: 'Station in Hurston orbit',
  RR_CRU_LEO: 'Station in Crusader orbit', RR_ARC_LEO: 'Station in ArcCorp orbit', RR_MIC_LEO: 'Station in microTech orbit',
  RR_JP_StantonPyro: 'Stanton–Pyro jump point station', RR_JP_PyroStanton: 'Pyro–Stanton jump point station',
  RR_JP_StantonMagnus: 'Stanton–Magnus jump point station', RR_JP_NyxCastra: 'Nyx–Castra jump point station',
};
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const STANTON = {
  1: 'Hurston', '1a': 'Arial', '1b': 'Aberdeen', '1c': 'Magda', '1d': 'Ita', 2: 'Crusader', '2a': 'Cellin', '2b': 'Daymar', '2c': 'Yela',
  3: 'ArcCorp', '3a': 'Lyria', '3b': 'Wala', 4: 'microTech', '4a': 'Calliope', '4b': 'Clio', '4c': 'Euterpe',
};
const body = (system, n, moon) => {
  const sys = system[0].toUpperCase() + system.slice(1).toLowerCase();
  return sys === 'Stanton' ? STANTON[n + moon] || STANTON[n] : `${sys} ${ROMAN[n]}${moon ? ` (moon ${moon})` : ''}`;
};
// Besides Game.log's names (some, like Stanton2b_ArcCorpMining_Area141, start with the planet or moon), the
// overlay reports Pyro3_L1 (in space near a Lagrange point), PyroSolarSystem, and the nearest body as Pyro5 or
// Stanton2c.
export const placeName = (k) => {
  let m;
  if (PLACES[k]) return PLACES[k];
  if ((m = /^(Stanton|Pyro|Nyx|Castra)(\d)([a-z]?)$/i.exec(k))) return `Near ${body(m[1], m[2], m[3])}`;
  if ((m = /^RR_P(\d)_L(\d)$/.exec(k))) return `Station at Pyro ${ROMAN[m[1]]} L${m[2]}`;
  if ((m = /^([A-Za-z]+)(\d)_L(\d)$/.exec(k))) return `Space near ${m[1]} ${ROMAN[m[2]]} L${m[3]}`;
  if ((m = /^(Stanton|Pyro|Nyx|Castra)(\d)([a-z]?)_(.+)$/.exec(k))) {
    const name = m[4].replace(/_/g, ' ').replace(/([a-z])(\d)/g, '$1 $2').replace(/([a-z])([A-Z])/g, '$1 $2').replace('Arc Corp', 'ArcCorp');
    return `${name} (${body(m[1], m[2], m[3])})`;
  }
  if ((m = /^([A-Za-z]+)SolarSystem$/.exec(k))) return `In space (${m[1]})`;
  return k.replace(/_/g, ' ');
};

export function render(root, {sessions, all, state}) {
  const hours = sum(sessions, (s) => s.hours);
  const live = sessions.filter((s) => s.isLive);
  const latestPatch = [...new Set(live.map((s) => s.patch).filter(Boolean))].sort(comparePatch).pop();
  const onPatch = live.filter((s) => s.patch === latestPatch && s.exit !== 'running');
  const crashRate = onPatch.length ? (100 * onPatch.filter((s) => s.unclean).length) / onPatch.length : null;
  const kills = sum(sessions, (s) => s.kills.length);
  const pvpK = sum(sessions, (s) => s.kills.filter((k) => k.victim === 'player').length);
  const pvpD = sum(sessions, (s) => s.deaths.filter((d) => d.killer === 'player').length);
  const flights = sum(sessions, (s) => s.flights.length);
  const shipsFlown = new Set(sessions.flatMap((s) => s.flights.map((f) => f.ship))).size;
  const loads = sessions.flatMap((s) => s.loads.filter((l) => ['Stanton', 'Pyro', 'Nyx'].includes(l.dest)).map((l) => ({...l, q: s.quarter})));
  const lastQ = loads.length ? loads[loads.length - 1].q : null;
  const loadNow = median(loads.filter((l) => l.q === lastQ).map((l) => l.s));
  const busiest = [...countBy(sessions, (s) => s.local.slice(11, 13))].sort((a, b2) => b2[1] - a[1])[0];

  root.innerHTML = `
    ${head('Overview', sessions.length ? `You've played ${b(fmt.int(hours))} hours over ${b(fmt.int(sessions.length))} sessions since ${b(fmt.date(sessions[0].day))}. ${latestPatch ? `On patch ${b(latestPatch)}, ${b(fmt.pct(crashRate))} of LIVE sessions ended in a crash or freeze. ` : ''}${loadNow ? `Loading into the game takes ${b(fmt.s(loadNow))} at the median this quarter.` : ''}` : 'No sessions match these filters.')}
    <div class="tiles">
      ${tile('Hours played', fmt.int(hours), `${fmt.int(sum(live, (s) => s.hours))} h LIVE · ${fmt.int(hours - sum(live, (s) => s.hours))} h test builds`)}
      ${tile('Sessions', fmt.int(sessions.length), `Typical length ${fmt.hm(median(sessions.map((s) => s.minutes)))}`)}
      ${tile('Crash or freeze rate', fmt.pct(crashRate), latestPatch ? `Patch ${latestPatch}, ${fmt.int(onPatch.length)} LIVE sessions` : '', crashRate > 20 ? 'is-bad' : crashRate != null && crashRate < 8 ? 'is-good' : '')}
      ${tile('Median world load', fmt.s(loadNow), lastQ ? fmt.quarter(lastQ) : '')}
      ${tile('Kills logged', fmt.int(kills), `PvP K/D ${pvpD ? fmt.dec(pvpK / pvpD) : '—'} (until Nov 2025)`)}
      ${tile('Flights', fmt.int(flights), `in ${fmt.int(shipsFlown)} ships and vehicles (since May 2025)`)}
    </div>
    <div class="grid">
      ${card('ov-monthly', 'Hours played per month', 'Dashed lines mark when a new CPU or GPU first showed up in your logs.', {wide: true, legend: legend([[series(0), 'LIVE'], [muted(), 'PTU and test builds']])})}
      ${card('ov-calendar', 'Every day you played', 'Darker squares are longer days. Hover a day for its total.', {wide: true})}
      ${card('ov-hours', 'When you start playing', busiest ? `Most sessions start around ${b(`${busiest[0]}:00`)}.` : '')}
      ${card('ov-weekdays', 'Sessions by weekday', 'Counted by the day you launched the game.')}
      ${card('ov-systems', 'Which star systems you load into', 'Share of loading screens into each system per quarter.', {legend: legend([[series(1), 'Stanton'], [series(0), 'Pyro'], [series(2), 'Nyx']])})}
      ${card('ov-places', 'Where you spend time', 'Locations ranked by how often you opened your local inventory there. The log has no position data, so this stands in for time spent.')}
    </div>`;

  const months = sessionMonths(sessions);
  const hw = hardwareChanges(all);
  draw(root, 'ov-monthly', 270, (ctx) => {
    if (!months.length) return false;
    const by = new Map();
    for (const s of sessions) {
      const k = `${s.month}|${s.isLive ? 'LIVE' : 'PTU'}`;
      by.set(k, (by.get(k) || 0) + s.hours);
    }
    columns(ctx, {
      cats: months, keys: ['LIVE', 'PTU'], get: (c, k) => by.get(`${c}|${k}`), color: (c, k) => (k === 'LIVE' ? series(0) : muted()),
      yFmt: (v) => `${v} h`, xLabel: fmt.month,
      refs: hw.map((r) => ({cat: r.month, label: r.label})),
      tip: (c) => [fmt.monthLong(c), [[series(0), 'LIVE', fmt.hours(by.get(`${c}|LIVE`) || 0)], [muted(), 'PTU and test', fmt.hours(by.get(`${c}|PTU`) || 0)], [null, 'Sessions', fmt.int(sessions.filter((s) => s.month === c).length)]]],
    });
  });

  draw(root, 'ov-calendar', 140, (ctx) => {
    if (!sessions.length) return false;
    const days = new Map();
    for (const s of sessions) days.set(s.day, (days.get(s.day) || 0) + s.hours);
    const to = new Date(`${sessions[sessions.length - 1].day}T00:00:00Z`);
    const from = new Date(Math.max(Date.parse(`${sessions[0].day}T00:00:00Z`), to.getTime() - 370 * 86400000));
    const hgt = calendar(ctx, days, {from, to});
    ctx.svg.attr('viewBox', `0 0 ${ctx.w} ${hgt + 4}`).attr('height', hgt + 4);
  });

  draw(root, 'ov-hours', 210, (ctx) => {
    if (!sessions.length) return false;
    const n = countBy(sessions, (s) => Number(s.local.slice(11, 13)));
    const hh = (h) => `${String(h).padStart(2, '0')}:00`;
    columns(ctx, {cats: d3.range(24), keys: ['n'], get: (c) => n.get(c) || 0, color: () => series(0), yFmt: fmt.int, xLabel: (c) => String(c).padStart(2, '0'), every: 3,
      tip: (c) => [`${hh(c)}–${hh((c + 1) % 24)}`, [[null, 'Sessions started', fmt.int(n.get(c) || 0)]]]});
  });

  draw(root, 'ov-weekdays', 210, (ctx) => {
    if (!sessions.length) return false;
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const n = countBy(sessions, (s) => names[(new Date(`${s.local}Z`).getUTCDay() + 6) % 7]);
    const h = groupBy(sessions, (s) => names[(new Date(`${s.local}Z`).getUTCDay() + 6) % 7]);
    columns(ctx, {cats: names, keys: ['n'], get: (c) => n.get(c) || 0, color: () => series(0), yFmt: fmt.int, xLabel: (c) => c, valueLabel: (c) => fmt.int(n.get(c) || 0),
      tip: (c) => [c, [[null, 'Sessions', fmt.int(n.get(c) || 0)], [null, 'Hours', fmt.hours(sum(h.get(c) || [], (s) => s.hours))]]]});
  });

  draw(root, 'ov-systems', 230, (ctx) => {
    if (!loads.length) return false;
    const qs = quarterRange(loads[0].q, loads[loads.length - 1].q);
    const by = groupBy(loads, (l) => l.q);
    const sys = ['Stanton', 'Pyro', 'Nyx'];
    const colorOf = {Stanton: series(1), Pyro: series(0), Nyx: series(2)};
    const share = (q, k) => {
      const v = by.get(q) || [];
      return v.length ? (100 * v.filter((l) => l.dest === k).length) / v.length : 0;
    };
    columns(ctx, {cats: qs, keys: sys, get: share, color: (c, k) => colorOf[k], yFmt: (v) => `${v}%`, xLabel: fmt.quarter, yMax: 100,
      tip: (c) => [`${fmt.quarter(c)} · ${fmt.int((by.get(c) || []).length)} loads`, sys.map((k) => [colorOf[k], k, fmt.pct(share(c, k), 0)])]});
  });

  const locCounts = new Map();
  for (const s of sessions) for (const [k, v] of Object.entries(s.locations)) locCounts.set(k, (locCounts.get(k) || 0) + v);
  const topLocs = [...locCounts].sort((a, b2) => b2[1] - a[1]).slice(0, 12).map(([k, v]) => ({k, v}));
  draw(root, 'ov-places', () => Math.max(1, topLocs.length) * ROW_H, (ctx) => {
    if (!topLocs.length) return false;
    hbars(ctx, topLocs, {label: (r) => placeName(r.k), value: (r) => r.v, fmt: fmt.int, tip: (r) => [[null, 'Inventory opens', fmt.int(r.v)], [null, 'Game name', r.k]]});
  });
}
