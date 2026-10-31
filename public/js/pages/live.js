import {lines, table, fmt, esc, series, critical, muted} from '../kit.js';
import {median, ms} from '../model.js';
import {readingHealth, healthLabel, healthClass, connectionLabel, summarizeServers, shardHealth, serverSegments, fillGaps} from '../servers-model.js';
import {tile, card, head, draw, b} from './common.js';
import {placeName} from './overview.js';

const clock = (t) => new Date(`${t}Z`).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
const ago = (t, now) => {
  const s = Math.round((ms(now) - ms(t)) / 1000);
  return s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
};
const dot = (h) => `<span class="hdot ${healthClass(h)}"></span>`;

async function setOverlay(patch) {
  await fetch('/api/overlay', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(patch)});
}

export async function render(root, {state}) {
  let data;
  try {
    data = await (await fetch('/api/live')).json();
  } catch (e) {
    root.innerHTML = `${head('Live')}<p class="note">Can't reach the app server.</p>`;
    return;
  }
  if (state.page !== 'live') return;
  const {overlay, session, context, displayInfo, now} = data;
  const readings = fillGaps(data.readings);
  const playing = context && session;
  const join = session && session.joins.length ? session.joins[session.joins.length - 1] : null;
  // After the game closes, keep showing the shard the session ended on.
  const shard = context && context.shard ? context.shard : join ? join.shard : null;
  const onShardNow = !!(context && context.shard);
  const sessionKey = session ? session.id || session.start : null;
  const mine = readings.filter((r) => r.session === sessionKey);
  const latest = readings.length ? readings[readings.length - 1] : null;
  const fresh = latest && ms(now) - ms(latest.t) < Math.max(90, overlay.settings.intervalSec * 4) * 1000;
  const cur = fresh ? latest : null;
  const recent = readings.filter((r) => ms(now) - ms(r.t) < 5 * 60000);
  const health = cur ? Math.round(median(recent.map(readingHealth).filter((v) => v != null)) ?? readingHealth(cur)) : null;
  const onShard = readings.filter((r) => shard && r.shard === shard && ms(now) - ms(r.t) < 120 * 60000);
  const servers = summarizeServers(onShard).sort((a, c) => (a.last < c.last ? 1 : -1));
  const sh = shardHealth(servers);
  const segments = serverSegments(mine.filter((r) => r.server));
  const restarts = segments.reduce((a, s) => a + summarizeServers(s.list)[0].restartsSeen, 0);
  const hitches = recent.reduce((a, r) => a + (r.hitches || 0), 0);
  const conn = connectionLabel(cur);
  const accepted = session ? session.contracts.filter((c) => c.status === 'Accepted') : [];
  const closed = session ? new Set(session.contracts.filter((c) => c.status !== 'Accepted').map((c) => c.name)) : new Set();
  const active = accepted.filter((c) => !closed.has(c.name));
  const worldLoad = session ? session.loads.find((l) => l.dest !== 'Main menu') : null;

  let statusText = overlay.message;
  if (overlay.state === 'reading' && latest) statusText = `Reading the overlay every ${overlay.settings.intervalSec} s · last reading ${ago(latest.t, now)}`;
  const cfgHint = displayInfo && displayInfo.value === 0
    ? `<p class="note warn-note">Your USER.cfg turns the overlay off every time the game starts (<code>r_displayinfo = 0</code> in ${esc(displayInfo.file)}). Type <code>r_displayinfo 3</code> in the game console (~) each session, or change that line to <code>r_displayinfo = 3</code>.</p>`
    : '';

  // Server fps changes too fast to fill in like player counts; when the newest reading missed it, show the last
  // one read on the same server within a minute, and say how old it is.
  const fpsRead = cur && [...readings].reverse().find((r) => r.serverFps != null && r.server === cur.server && ms(cur.t) - ms(r.t) <= 60000);
  const fpsAge = fpsRead && fpsRead !== cur ? ` (read ${ago(fpsRead.t, now)})` : '';
  // Leave out whatever this reading couldn't read rather than printing a dash mid-sentence.
  const players = cur ? [cur.playersServer != null ? `${b(fmt.int(cur.playersServer))} players on it` : '', cur.playersShard != null ? `${b(fmt.int(cur.playersShard))} on the shard` : ''].filter(Boolean).join(' and ') : '';
  const running = fpsRead ? ` is running at ${b(fmt.dec(fpsRead.serverFps))} fps${fpsRead.serverFpsMin != null ? ` (low ${b(fmt.dec(fpsRead.serverFpsMin))})` : ''}${fpsAge}` : '';
  const summary = cur
    ? `Server ${b(cur.server || '?')}${running}${players ? `${running ? ' with' : ' has'} ${players}` : ''}. ${cur.pingMs != null ? `Ping ${b(`${fmt.dec(cur.pingMs)} ms`)}${cur.lossPct != null ? `, packet loss ${b(fmt.pct(cur.lossPct))}` : ''}.` : ''}`
    : playing ? 'No overlay reading yet for this session.' : 'Star Citizen is not running. Start the game and this page fills in while you play.';

  root.innerHTML = `
    ${head('Live')}
    <div class="live-status ${overlay.state}">
      <span class="pulse"></span><span>${esc(statusText)}</span>
      <span class="live-controls">
        <label><input type="checkbox" id="ov-enabled"${overlay.settings.enabled ? ' checked' : ''}> Read the overlay</label>
        <label>every <select id="ov-interval">${[10, 15, 30, 60].map((s) => `<option value="${s}"${s === overlay.settings.intervalSec ? ' selected' : ''}>${s} s</option>`).join('')}</select></label>
      </span>
    </div>
    ${cfgHint}
    <section class="health-block ${healthClass(health)}">
      <div class="health-score"><span class="health-num">${health ?? '—'}</span><span class="health-of">health / 100</span></div>
      <div class="health-text">
        <div class="health-label">${esc(healthLabel(health))}${cur ? ` · ${esc(cur.server || '')}` : ''}</div>
        <p class="lede">${summary}</p>
        <p class="note">${shard ? `${onShardNow ? 'Shard' : 'Last shard'} <b>${esc(shard)}</b>` : 'Not on a shard'}${join ? ` (${esc(join.region)})` : ''}${session && session.lastLocation ? ` · last at ${esc(placeName(session.lastLocation.name))}` : ''}${cur && cur.planet ? ` · ${esc(placeName(cur.planet))}` : ''}. Health is 60% server fps and 40% its lowest fps, out of 30, minus 2 per hitch; median of the last 5 minutes.</p>
      </div>
    </section>
    <div class="tiles">
      ${tile('Server fps', fpsRead ? fmt.dec(fpsRead.serverFps) : '—', fpsRead && fpsRead.serverFpsMin != null ? `low ${fmt.dec(fpsRead.serverFpsMin)}${fpsRead.serverFpsMax != null ? ` · high ${fmt.dec(fpsRead.serverFpsMax)}` : ''}${fpsAge}` : 'from the overlay')}
      ${tile('Players on shard', cur ? fmt.int(cur.playersShard) : '—', shard || '')}
      ${tile('On your server', cur ? fmt.int(cur.playersServer) : '—', cur ? cur.server || '' : '')}
      ${tile('Ping', cur && cur.pingMs != null ? `${fmt.dec(cur.pingMs)} ms` : '—', conn || '')}
      ${tile('Packet loss', cur && cur.lossPct != null ? fmt.pct(cur.lossPct) : '—', '')}
      ${tile('Hitches', recent.length ? fmt.int(hitches) : '—', 'last 5 minutes')}
      ${tile('Server restarts', fmt.int(restarts), 'while you were on it')}
      ${tile('Your fps', cur && cur.clientFps != null ? fmt.dec(cur.clientFps, 0) : '—', '')}
    </div>
    <div class="grid">
      ${card('lv-fps', 'Server fps', 'This session. The dashed line is the lowest fps in each reading.', {wide: true})}
      ${card('lv-players', 'Players', 'On your server and on the whole shard.', {})}
      ${card('lv-net', 'Ping', 'Your connection to the server.', {})}
      ${card('lv-servers', `Game servers on this shard${sh ? ` · shard health ${sh.health} (${healthLabel(sh.health)})` : ''}`, sh ? `From the ${sh.servers} server${sh.servers === 1 ? '' : 's'} you've been on in the last 2 hours, weighted by players on each. Servers you haven't visited can't be seen from your PC.` : 'Servers appear here as you move between them.', {wide: true, body: '<div id="lv-servers"></div>'})}
      ${card('lv-hops', 'Where each server was used', 'Every stretch on one game server this session, with where you were.', {body: '<div id="lv-hops"></div>'})}
      <article class="card" id="card-lv-session"><h2>This session</h2>
        <div class="kv-list">
          <div><span>Patch</span><b>${session ? esc(session.patch || '?') : '—'}</b><small>${session ? `build ${esc(session.changelist || '?')}` : ''}</small></div>
          <div><span>Started</span><b>${session ? clock(session.start) : '—'}</b><small>${session ? fmt.hm(session.minutes) : ''}</small></div>
          <div><span>Load into world</span><b>${worldLoad ? fmt.s(worldLoad.s) : '—'}</b><small>${worldLoad ? esc(worldLoad.dest) : ''}</small></div>
          <div><span>Server joins</span><b>${session ? fmt.int(session.joins.length) : '—'}</b><small>${session ? `${fmt.int(session.disconnects.length)} disconnects` : ''}</small></div>
          <div><span>Server response</span><b>${session && session.inventory ? `${fmt.dec(session.inventory.median, 2)} s` : '—'}</b><small>inventory round trip</small></div>
          <div><span>Deaths</span><b>${session ? fmt.int(session.deathCount) : '—'}</b><small>${session ? `${fmt.int(session.counts.medBed)} med-bed heals` : ''}</small></div>
        </div>
        <h3 class="sub">Active contracts</h3>
        <p class="note">${active.length ? active.map((c) => esc(c.name)).join(' · ') : 'None accepted this session.'}</p>
        <h3 class="sub">Latest events</h3>
        <ol class="timeline">${session ? session.timeline.slice(-12).reverse().map((e) => `<li><time>${esc(clock(e.t))}</time><span class="dot ${esc(e.kind)}"></span><span>${esc(e.text)}</span></li>`).join('') : ''}</ol>
      </article>
    </div>`;

  root.querySelector('#ov-enabled').addEventListener('change', async (e) => { await setOverlay({enabled: e.target.checked}); });
  root.querySelector('#ov-interval').addEventListener('change', async (e) => { await setOverlay({intervalSec: Number(e.target.value)}); });

  const timeline = mine.length ? mine : readings;
  const cats = timeline.map((r) => r.t);
  const byT = new Map(timeline.map((r) => [r.t, r]));
  draw(root, 'lv-fps', 230, (ctx) => {
    if (cats.length < 2) return false;
    lines(ctx, {cats, xLabel: clock, yFmt: (v) => `${Math.round(v)}`, yMin: 0, yMax: 30, tipHead: clock,
      series: [{name: 'Server fps', color: series(0), get: (t) => byT.get(t).serverFps}, {name: 'Lowest', color: critical(), dash: true, get: (t) => byT.get(t).serverFpsMin}],
      tipExtra: (t) => [[null, 'Server', byT.get(t).server || '?'], [null, 'Health', String(readingHealth(byT.get(t)) ?? '—')]]});
  }, 'Server fps shows up after two overlay readings.');
  draw(root, 'lv-players', 210, (ctx) => {
    if (cats.length < 2) return false;
    lines(ctx, {cats, xLabel: clock, yFmt: fmt.int, yMin: 0, tipHead: clock,
      series: [{name: 'Shard', color: series(1), get: (t) => byT.get(t).playersShard}, {name: 'Your server', color: series(0), get: (t) => byT.get(t).playersServer}]});
  }, 'Player counts show up after two overlay readings.');
  draw(root, 'lv-net', 210, (ctx) => {
    if (cats.length < 2) return false;
    lines(ctx, {cats, xLabel: clock, yFmt: (v) => `${Math.round(v)} ms`, yMin: 0, tipHead: clock,
      series: [{name: 'Ping', color: series(2), get: (t) => byT.get(t).pingMs}],
      tipExtra: (t) => [[null, 'Packet loss', byT.get(t).lossPct != null ? fmt.pct(byT.get(t).lossPct) : '—']]});
  }, 'Ping shows up after two overlay readings.');

  table(root.querySelector('#lv-servers'), {
    rows: servers, sortKey: 'last',
    columns: [
      {key: 'health', label: 'Health', num: true, html: (s) => `${dot(s.health)} ${s.health ?? '—'}`, fmt: (v) => v},
      {key: 'server', label: 'Server', html: (s) => `${esc(s.server)}${cur && s.server === cur.server ? ' <span class="badge env">you</span>' : ''}`},
      {key: 'places', label: 'Where', fmt: (v) => v.map(placeName).join(', ')},
      {key: 'playersServer', label: 'Players', num: true, fmt: fmt.int},
      {key: 'fps', label: 'Server fps', num: true, fmt: (v) => fmt.dec(v)},
      {key: 'low', label: 'Lowest', num: true, fmt: (v) => fmt.dec(v)},
      {key: 'readings', label: 'Readings', num: true, fmt: fmt.int},
      {key: 'last', label: 'Last seen', fmt: (v) => clock(v)},
    ],
  });
  table(root.querySelector('#lv-hops'), {
    rows: segments.map((s, i) => ({...s, i})).reverse(), sortKey: 'start',
    columns: [
      {key: 'start', label: 'From', fmt: (v) => clock(v)},
      {key: 'server', label: 'Server'},
      {key: 'minutes', label: 'Time', num: true, fmt: (v) => fmt.hm(v)},
      {key: 'places', label: 'Where', fmt: (v) => v.map(placeName).join(', ')},
      {key: 'fps', label: 'Server fps', num: true, fmt: (v) => fmt.dec(v)},
      {key: 'players', label: 'Players', num: true, fmt: fmt.int},
    ],
  });
}
