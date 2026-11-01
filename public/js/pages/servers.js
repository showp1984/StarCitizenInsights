import {columns, hbars, table, fmt, esc, series, ROW_H} from '../kit.js';
import {median, groupBy, sum} from '../model.js';
import {readingHealth, healthLabel, healthClass, summarizeServers, shardStays, fillGaps} from '../servers-model.js';
import {toLocal} from '../model.js';
import {placeName} from './overview.js';
import {tile, card, head, draw, b} from './common.js';

const dot = (h) => `<span class="hdot ${healthClass(h)}"></span>`;
const when = (t) => (t ? fmt.dateTime(new Date(new Date(`${t}Z`).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19)) : '—');

export async function render(root, {sessions, state}) {
  let readings = [];
  try {
    readings = fillGaps((await (await fetch('/api/readings')).json()).readings);
  } catch (e) {
    // the page still shows what the logs know
  }
  if (state.page !== 'servers') return;
  const keys = new Set(sessions.map((s) => s.id || s.start));
  const envOk = (r) => (state.env === 'ALL' ? true : state.env === 'LIVE' ? r.env === 'LIVE' : r.env && r.env !== 'LIVE');
  const own = readings.filter((r) => keys.has(r.session) || (!r.session && envOk(r)));
  const stays = shardStays(sessions);
  const byShard = groupBy(stays, (s) => s.shard);
  const readingsByShard = groupBy(own, (r) => r.shard || r.overlayShard || '?');
  const shardRows = [...byShard].map(([shard, list]) => {
    const rs = readingsByShard.get(shard) || [];
    const sess = [...new Set(list.map((x) => x.session))];
    const healths = rs.map(readingHealth).filter((v) => v != null);
    return {
      shard, region: list[0].region, visits: list.length, sessions: sess.length, minutes: sum(list, (x) => x.minutes),
      last: toLocal(list[list.length - 1].session, list[list.length - 1].start), crashRate: sess.length ? (100 * sess.filter((s) => s.unclean).length) / sess.length : null,
      readings: rs.length, fps: median(rs.map((r) => r.serverFps).filter((v) => v != null)),
      low: rs.length ? Math.min(...rs.map((r) => r.serverFpsMin ?? r.serverFps).filter((v) => v != null)) : null,
      players: rs.length ? Math.max(...rs.map((r) => r.playersShard || 0)) : null,
      servers: new Set(rs.map((r) => r.server).filter(Boolean)).size,
      health: healths.length ? Math.round(median(healths)) : null,
    };
  }).sort((a, c) => (a.last < c.last ? 1 : -1));
  const servers = summarizeServers(own).sort((a, c) => (a.last < c.last ? 1 : -1));
  const regionCount = groupBy(stays, (s) => s.region);
  const firstReading = own.length ? own[0].t : null;

  root.innerHTML = `
    ${head('Shards & servers', `You've joined ${b(fmt.int(stays.length))} shards across ${b(fmt.int(byShard.size))} different ones${stays.length ? `, most often in ${b([...regionCount].sort((a, c) => c[1].length - a[1].length)[0][0])}` : ''}. ${own.length ? `The overlay has been read ${b(fmt.int(own.length))} times since ${b(when(firstReading))}, on ${b(fmt.int(servers.length))} game servers.` : 'Overlay readings (server fps, players, which game server) start once you play with the overlay on; the Live tab explains how.'}`)}
    <div class="tiles">
      ${tile('Shards joined', fmt.int(stays.length), `${fmt.int(byShard.size)} different shards`)}
      ${tile('Time on shards', fmt.int(sum(stays, (s) => s.minutes) / 60), 'hours, from Game.log')}
      ${tile('Game servers seen', fmt.int(servers.length), 'from overlay readings')}
      ${tile('Overlay readings', fmt.int(own.length), firstReading ? `since ${when(firstReading)}` : 'none yet')}
      ${tile('Median server fps', own.length ? fmt.dec(median(own.map((r) => r.serverFps).filter((v) => v != null))) : '—', 'all readings')}
      ${tile('Server restarts seen', fmt.int(sum(servers, (s) => s.restartsSeen)), 'while you were on them')}
    </div>
    <div class="grid">
      ${card('sv-shards', 'Shards you\'ve been on', 'Time on each shard comes from Game.log; server fps, players and health from overlay readings where you have them.', {wide: true, body: '<div id="sv-shards"></div>'})}
      ${card('sv-servers', 'Game servers you\'ve been on', 'With server meshing a shard runs on several game servers; this is every one the overlay showed you on.', {wide: true, body: '<div id="sv-servers"></div>'})}
      ${card('sv-hours', 'Server fps by hour of the day', 'Median server fps of your readings in each local hour.')}
      ${card('sv-regions', 'Server health by region', 'Median health of your readings per server region.')}
    </div>`;

  table(root.querySelector('#sv-shards'), {
    rows: shardRows, sortKey: 'last', search: 'Find a shard…',
    columns: [
      {key: 'health', label: 'Health', num: true, html: (r) => (r.health == null ? '—' : `${dot(r.health)} ${r.health}`), fmt: (v) => v ?? ''},
      {key: 'shard', label: 'Shard'},
      {key: 'region', label: 'Region'},
      {key: 'visits', label: 'Joins', num: true, fmt: fmt.int},
      {key: 'minutes', label: 'Time', num: true, fmt: (v) => fmt.hm(v)},
      {key: 'fps', label: 'Server fps', num: true, fmt: (v) => (v == null ? '—' : fmt.dec(v))},
      {key: 'low', label: 'Lowest', num: true, fmt: (v) => (v == null ? '—' : fmt.dec(v))},
      {key: 'players', label: 'Players', num: true, fmt: (v) => (v ? fmt.int(v) : '—')},
      {key: 'servers', label: 'Servers seen', num: true, fmt: (v) => (v ? fmt.int(v) : '—')},
      {key: 'crashRate', label: 'Crash or freeze', num: true, fmt: (v) => fmt.pct(v, 0)},
      {key: 'last', label: 'Last on', fmt: (v) => fmt.dateTime(v)},
    ],
  });

  table(root.querySelector('#sv-servers'), {
    rows: servers, sortKey: 'last', search: 'Find a server or place…',
    columns: [
      {key: 'health', label: 'Health', num: true, html: (s) => `${dot(s.health)} ${s.health ?? '—'}`, fmt: (v) => v ?? ''},
      {key: 'server', label: 'Server'},
      {key: 'shard', label: 'Shard'},
      {key: 'places', label: 'Where', fmt: (v) => v.map(placeName).join(', ')},
      {key: 'fps', label: 'Server fps', num: true, fmt: (v) => fmt.dec(v)},
      {key: 'low', label: 'Lowest', num: true, fmt: (v) => fmt.dec(v)},
      {key: 'maxPlayersServer', label: 'Most players', num: true, fmt: fmt.int},
      {key: 'readings', label: 'Readings', num: true, fmt: fmt.int},
      {key: 'restartsSeen', label: 'Restarts', num: true, fmt: fmt.int},
      {key: 'last', label: 'Last seen', fmt: (v) => when(v)},
    ],
  });

  draw(root, 'sv-hours', 220, (ctx) => {
    if (!own.length) return false;
    const by = groupBy(own.filter((r) => r.serverFps != null), (r) => new Date(`${r.t}Z`).getHours());
    columns(ctx, {cats: d3.range(24), keys: ['fps'], get: (h) => median((by.get(h) || []).map((r) => r.serverFps)), color: () => series(0), yFmt: (v) => `${v}`, xLabel: (h) => String(h).padStart(2, '0'), every: 3, yMax: 30,
      tip: (h) => [`${String(h).padStart(2, '0')}:00`, [[null, 'Median server fps', fmt.dec(median((by.get(h) || []).map((r) => r.serverFps)))], [null, 'Readings', fmt.int((by.get(h) || []).length)]]]});
  }, 'No overlay readings yet.');

  const regions = [...groupBy(own, (r) => r.serverRegion || (r.shard || '').split('_')[1] || '?')].map(([k, v]) => {
    const hs = v.map(readingHealth).filter((x) => x != null);
    return {k, v: hs.length ? Math.round(median(hs)) : 0, n: v.length};
  }).sort((a, c) => c.n - a.n);
  draw(root, 'sv-regions', () => Math.max(1, regions.length) * ROW_H, (ctx) => {
    if (!regions.length) return false;
    hbars(ctx, regions, {label: (r) => `${r.k} · ${fmt.int(r.n)} readings`, value: (r) => r.v, fmt: (v) => `${v} ${healthLabel(v)}`, color: () => series(1)});
  }, 'No overlay readings yet.');
}
