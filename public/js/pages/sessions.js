import {table, fmt, esc} from '../kit.js';
import {sum, median, toLocal} from '../model.js';
import {tile, head} from './common.js';

const ENDING = {clean: ['Clean exit', 'clean'], crash: ['Crashed', 'crash'], 'no-shutdown': ['Froze or closed', 'freeze'], running: ['Still running', 'env']};
const badge = (s) => {
  const [label, cls] = ENDING[s.exit] || [s.exit, 'env'];
  return `<span class="badge ${cls}">${esc(s.exit === 'crash' && s.crash ? s.crash.type : label)}</span>`;
};

function avgFps(s) {
  const p = s.profiles.filter((x) => ['Stanton', 'Pyro', 'Nyx'].includes(x.dest) && x.wholeFps > 0);
  const secs = sum(p, (x) => x.frames / x.wholeFps);
  return secs ? sum(p, (x) => x.frames) / secs : null;
}

export function render(root, {sessions, all, state, open}) {
  if (state.session) return renderDetail(root, {all, key: state.session, open});
  const rows = sessions.map((s) => ({
    s, key: s.key, local: s.local, env: s.env, patch: s.patch, minutes: s.minutes, exit: s.exit,
    kills: s.kills.length, deaths: s.deaths.filter((d) => d.damage !== 'Suicide').length || s.corpses.length,
    fps: avgFps(s), region: s.joins.length ? s.joins[s.joins.length - 1].region : '', worlds: [...new Set(s.loads.map((l) => l.dest).filter((d) => d !== 'Main menu'))].join(', '),
  }));
  const latest = all[all.length - 1];
  root.innerHTML = `
    ${head('Sessions', `Every time you launched the game. ${latest ? `<a href="#sessions/${encodeURIComponent(latest.key)}">Open your latest session</a> from ${esc(fmt.dateTime(latest.local))}.` : ''}`)}
    <article class="card wide"><div id="ss-table"></div></article>`;
  table(root.querySelector('#ss-table'), {
    rows, rowKey: (r) => r.key, onRow: open, sortKey: 'local', search: 'Search sessions (patch, place, crash type…)',
    columns: [
      {key: 'local', label: 'Started', fmt: (v) => fmt.dateTime(v)},
      {key: 'env', label: 'Build'},
      {key: 'patch', label: 'Patch', sortValue: (r) => (r.patch ? r.patch.split('.').map((x) => x.padStart(3, '0')).join('.') : '')},
      {key: 'minutes', label: 'Length', num: true, fmt: (v) => fmt.hm(v)},
      {key: 'exit', label: 'Ending', html: (r) => badge(r.s), fmt: (v, r) => (r.s.crash ? r.s.crash.type : (ENDING[v] || [v])[0])},
      {key: 'worlds', label: 'Systems'},
      {key: 'kills', label: 'Kills', num: true, fmt: fmt.int},
      {key: 'deaths', label: 'Deaths', num: true, fmt: fmt.int},
      {key: 'fps', label: 'Avg fps', num: true, fmt: (v) => (v ? fmt.dec(v, 0) : '—')},
      {key: 'region', label: 'Server'},
    ],
  });
}

async function renderDetail(root, {all, key}) {
  const brief = all.find((s) => s.key === key);
  root.innerHTML = `<button type="button" class="back" id="ss-back">← All sessions</button><div class="empty">Loading session…</div>`;
  root.querySelector('#ss-back').addEventListener('click', () => { location.hash = '#sessions'; });
  if (!brief) {
    root.querySelector('.empty').textContent = 'That session isn\'t in your logs any more.';
    return;
  }
  let s;
  try {
    s = await (await fetch(`/api/session?id=${encodeURIComponent(key)}`)).json();
  } catch (e) {
    root.querySelector('.empty').textContent = 'Could not load this session from the app server.';
    return;
  }
  const local = (t) => toLocal(brief, t).slice(11, 19);
  const fps = avgFps(brief);
  const worldLoads = brief.loads.filter((l) => l.dest !== 'Main menu');
  const kills = brief.kills.length;
  const deaths = brief.deaths.filter((d) => d.damage !== 'Suicide').length || brief.corpses.length;
  const spend = sum(brief.shop.filter((x) => x.kind === 'Buy' && x.result !== 'Failure'), (x) => x.price);
  const ending = brief.exit === 'crash' ? `Crashed: ${brief.crash.type}` : (ENDING[brief.exit] || [brief.exit])[0];

  root.innerHTML = `
    <button type="button" class="back" id="ss-back">← All sessions</button>
    ${head(`Session of ${fmt.dateTime(brief.local)}`, `${esc(brief.env)} build, patch ${esc(brief.patch || '?')} (changelist ${esc(brief.changelist || '?')}). ${esc(brief.cpu || '')}${brief.gpu ? ` with ${esc(brief.gpu)}` : ''}${brief.driverShort ? `, driver ${esc(brief.driverShort)}` : ''}${brief.renderer ? `, ${esc(brief.renderer)}` : ''}${brief.display ? `, ${esc(brief.display)}${brief.refreshHz ? ` at ${brief.refreshHz} Hz` : ''}` : ''}.`)}
    <div class="tiles">
      ${tile('Length', fmt.hm(brief.minutes), ending, brief.unclean ? 'is-bad' : '')}
      ${tile('Average frame rate', fps ? fmt.fps(fps) : '—', `${fmt.int(brief.profiles.length)} frame-rate summaries`)}
      ${tile('World loading', worldLoads.length ? fmt.s(worldLoads[0].s) : '—', worldLoads.length > 1 ? `${fmt.int(worldLoads.length)} loads, median ${fmt.s(median(worldLoads.map((l) => l.s)))}` : worldLoads.length ? worldLoads[0].dest : 'Never loaded into a world')}
      ${tile('Kills and deaths', `${fmt.int(kills)} / ${fmt.int(deaths)}`, `${fmt.int(brief.counts.medBed)} med-bed heals`)}
      ${tile('Contracts', fmt.int(brief.contracts.filter((c) => c.status === 'Accepted').length), `${fmt.int(brief.contracts.filter((c) => c.status === 'Complete').length)} completed`)}
      ${tile('Spent', `${fmt.compact(spend)} aUEC`, `${fmt.int(brief.counts.qtArrivals)} quantum jumps`)}
      ${tile('Server response', brief.inventory ? `${fmt.dec(brief.inventory.median, 2)} s` : '—', brief.inventory ? `Median of ${fmt.int(brief.inventory.n)} inventory requests` : 'Not logged by this version')}
    </div>
    ${brief.crash ? `<article class="card"><h2>Crash report</h2><p class="note">${esc([brief.crash.exception, brief.crash.message].filter(Boolean).join(' — ') || 'The crash handler ran but logged no details.')}</p></article>` : ''}
    <div class="grid">
      <article class="card"><h2>Timeline</h2><p class="note">Times are your local time. Kills within two minutes of each other are grouped.</p>
        <ol class="timeline">${s.timeline.map((e) => `<li><time>${esc(local(e.t))}</time><span class="dot ${esc(e.kind)}"></span><span>${esc(e.text)}</span></li>`).join('') || '<li><span></span><span></span><span>Nothing notable was logged.</span></li>'}</ol>
      </article>
      <article class="card"><h2>Frame-rate summaries</h2><p class="note">Written each time the game left a world.</p><div id="ss-prof"></div></article>
    </div>`;
  root.querySelector('#ss-back').addEventListener('click', () => { location.hash = '#sessions'; });
  table(root.querySelector('#ss-prof'), {
    rows: brief.profiles.map((p, i) => ({...p, i, time: p.t ? local(p.t) : ''})),
    sortKey: 'i', sortDir: 'asc',
    columns: [
      {key: 'time', label: 'Left at'},
      {key: 'dest', label: 'World'},
      {key: 'wholeFps', label: 'Fps', num: true, fmt: (v) => (v ? fmt.dec(v, 0) : '—')},
      {key: 'gpuFps', label: 'GPU fps', num: true, fmt: (v) => (v ? fmt.dec(v, 0) : '—')},
      {key: 'under', label: '< 16 ms', num: true, sortValue: (p) => (p.wholeBuckets ? p.wholeBuckets[0] : null), fmt: (v, p) => (p.wholeBuckets ? fmt.pct(p.wholeBuckets[0], 0) : '—')},
      {key: 'commitMaxMB', label: 'Memory peak', num: true, fmt: (v) => (v ? `${fmt.dec(v / 1024)} GB` : '—')},
      {key: 'frames', label: 'Frames', num: true, fmt: fmt.int},
    ],
  });
}
