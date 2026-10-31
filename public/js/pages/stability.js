import {columns, hbars, lines, table, fmt, legend, series, muted, critical, css, esc, ROW_H} from '../kit.js';
import {sum, countBy, groupBy, comparePatch, sessionMonths, hardwareChanges} from '../model.js';
import {tile, card, head, draw, b} from './common.js';

const LIMIT = 20;
const TYPES = ['GPU crash', 'Access violation', 'Freeze (deadlock)', 'Out of memory', 'Fatal error', 'Other exception', 'Crash report', 'No crash report (froze or was closed)'];
const typeColor = (t) => ({
  'GPU crash': series(4), 'Access violation': series(0), 'Freeze (deadlock)': series(5), 'Out of memory': series(2),
  'Fatal error': series(3), 'Other exception': series(6), 'Crash report': series(6), 'No crash report (froze or was closed)': muted(),
}[t]);

function rateRows(sessions, keyOf, minN = 5) {
  return [...groupBy(sessions, keyOf)].filter(([k, v]) => k && v.length >= minN).map(([k, v]) => ({
    k, n: v.length, bad: v.filter((s) => s.unclean).length, rate: (100 * v.filter((s) => s.unclean).length) / v.length,
    first: v[0].day, last: v[v.length - 1].day, hours: sum(v, (s) => s.hours),
  }));
}

function rateChart(ctx, rows, label, extraTip) {
  const byK = new Map(rows.map((r) => [r.k, r]));
  columns(ctx, {
    cats: rows.map((r) => r.k), keys: ['rate'], get: (c) => byK.get(c).rate,
    color: (c) => (byK.get(c).rate > LIMIT ? critical() : series(1)), yFmt: (v) => `${v}%`, xLabel: (c) => c,
    valueLabel: (c) => fmt.pct(byK.get(c).rate, 0), limit: {value: LIMIT, label: `${LIMIT}%`},
    tip: (c) => {
      const r = byK.get(c);
      return [`${label} ${c}`, [[null, 'Crashed or froze', fmt.pct(r.rate)], [null, 'Sessions', `${fmt.int(r.bad)} of ${fmt.int(r.n)}`], [null, 'Hours played', fmt.hours(r.hours)], ...(extraTip ? extraTip(r) : [])]];
    },
  });
}

export function render(root, {sessions, all, open}) {
  const done = sessions.filter((s) => s.exit !== 'running');
  const bad = done.filter((s) => s.unclean);
  const crashes = done.filter((s) => s.exit === 'crash');
  const frozen = done.filter((s) => s.exit === 'no-shutdown');
  const gpu = crashes.filter((s) => s.crash.type === 'GPU crash');
  const overlayHints = crashes.filter((s) => /overlay|recording/i.test(s.crash.message || '')).length;
  const hours = sum(done, (s) => s.hours);
  const latestGpu = done.length ? done[done.length - 1].gpu : null;
  const gpuSessions = done.filter((s) => s.gpu === latestGpu && s.driverShort);
  const drivers = rateRows(gpuSessions, (s) => s.driverShort).sort((a, c) => (a.first < c.first ? -1 : 1));
  const latestDriver = gpuSessions.length ? gpuSessions[gpuSessions.length - 1].driverShort : null;
  const latestDriverRow = drivers.find((d) => d.k === latestDriver);
  const patches = rateRows(done, (s) => s.patch).sort((a, c) => comparePatch(a.k, c.k));
  const worst = patches.reduce((a, r) => (!a || r.rate > a.rate ? r : a), null);

  root.innerHTML = `
    ${head('Stability', done.length ? `${b(fmt.int(bad.length))} of your ${b(fmt.int(done.length))} sessions (${b(fmt.pct((100 * bad.length) / done.length))}) ended badly: ${b(fmt.int(crashes.length))} with a crash report and ${b(fmt.int(frozen.length))} with no shutdown at all (a freeze or a forced close). ${worst ? `Your worst patch was ${b(worst.k)} at ${b(fmt.pct(worst.rate))}.` : ''} ${latestDriverRow ? `On your current driver ${b(latestDriver)}, ${b(fmt.int(latestDriverRow.bad))} of ${b(fmt.int(latestDriverRow.n))} sessions went wrong.` : ''}` : 'No finished sessions match these filters.')}
    <div class="tiles">
      ${tile('Crash or freeze rate', fmt.pct(done.length ? (100 * bad.length) / done.length : null), `${fmt.int(bad.length)} of ${fmt.int(done.length)} sessions`, done.length && (100 * bad.length) / done.length > LIMIT ? 'is-bad' : '')}
      ${tile('Crash reports', fmt.int(crashes.length), `${fmt.int(gpu.length)} were GPU crashes`)}
      ${tile('Froze or force-closed', fmt.int(frozen.length), 'Log stops with no crash report')}
      ${tile('Hours between problems', bad.length ? fmt.dec(hours / bad.length) : '—', 'Hours played per bad ending')}
      ${tile('Current driver', latestDriver || '—', latestDriverRow ? `${fmt.pct(latestDriverRow.rate)} of ${fmt.int(latestDriverRow.n)} sessions` : 'Fewer than 5 sessions so far', latestDriverRow && latestDriverRow.rate < 8 ? 'is-good' : '')}
      ${tile('Overlay warnings', fmt.int(overlayHints), 'GPU crashes that told you to update or disable overlays')}
    </div>
    <p class="note">A normal quit writes a shutdown line at the end of Game.log. When the game crashes, its crash handler adds a report with the exception type. When the log just stops, the game froze and was closed, or the PC lost power. The game you're playing right now isn't counted.</p>
    <div class="grid">
      ${card('st-patch', 'Crash or freeze rate by patch', 'Patches with at least 5 sessions. Bars above the dashed line are highlighted.')}
      ${card('st-driver', `Crash or freeze rate by graphics driver${latestGpu ? ` (${esc(latestGpu)})` : ''}`, 'In the order you installed them. Patches changed over the same months, so the two overlap.')}
      ${card('st-types-patch', 'What kind of crash, by patch', 'Number of bad endings on each patch, split by the crash report type.', {wide: true, legend: legend(TYPES.filter((t) => t !== 'Crash report').map((t) => [typeColor(t), t]))})}
      ${card('st-types', 'Crash types overall', 'GPU crashes are the driver or GPU giving up; access violations are bugs in the game; deadlocks are the game\'s watchdog killing a frozen main thread.')}
      ${card('st-when', 'How far into a session it happens', 'Minutes from launch to the crash or freeze.')}
      ${card('st-monthly', 'Crash or freeze rate per month', 'With hardware changes marked.', {wide: true})}
      ${card('st-setup', 'Rate by setup', 'Renderer, graphics card and processor, for setups with at least 5 sessions.')}
      ${card('st-where', 'Where you were when it crashed', 'The last place you loaded into before the crash report.')}
      ${card('st-list', 'Every crash and freeze', 'Newest first. Click a row to open that session.', {wide: true, body: '<div id="st-list"></div>'})}
    </div>`;

  draw(root, 'st-patch', 250, (ctx) => (patches.length ? rateChart(ctx, patches, 'Patch') : false));
  draw(root, 'st-driver', 250, (ctx) => (drivers.length ? rateChart(ctx, drivers, 'Driver', (r) => [[null, 'Used', `${fmt.date(r.first)} – ${fmt.date(r.last)}`]]) : false), 'No driver information for this selection.');

  draw(root, 'st-types-patch', 260, (ctx) => {
    if (!patches.length) return false;
    const by = new Map();
    for (const s of bad) by.set(`${s.patch}|${s.crashType}`, (by.get(`${s.patch}|${s.crashType}`) || 0) + 1);
    const cats = patches.map((p) => p.k);
    columns(ctx, {cats, keys: TYPES, get: (c, k) => by.get(`${c}|${k}`), color: (c, k) => typeColor(k), yFmt: fmt.int, xLabel: (c) => c,
      tip: (c) => [`Patch ${c}`, TYPES.filter((k) => by.get(`${c}|${k}`)).map((k) => [typeColor(k), k, fmt.int(by.get(`${c}|${k}`))])]});
  });

  const typeCounts = [...countBy(bad, (s) => s.crashType)].sort((a, c) => c[1] - a[1]).map(([k, v]) => ({k, v}));
  draw(root, 'st-types', () => Math.max(1, typeCounts.length) * ROW_H, (ctx) => {
    if (!typeCounts.length) return false;
    hbars(ctx, typeCounts, {label: (r) => r.k, value: (r) => r.v, fmt: fmt.int, color: (r) => typeColor(r.k),
      tip: (r) => [[null, 'Sessions', fmt.int(r.v)], [null, 'Share of bad endings', fmt.pct((100 * r.v) / bad.length)]]});
  });

  draw(root, 'st-when', 230, (ctx) => {
    if (!bad.length) return false;
    const buckets = [[0, 15, '< 15 min'], [15, 30, '15–30'], [30, 60, '30–60'], [60, 120, '1–2 h'], [120, 240, '2–4 h'], [240, 1e9, '4 h +']];
    const n = (bk) => bad.filter((s) => s.minutes >= bk[0] && s.minutes < bk[1]).length;
    const all2 = (bk) => done.filter((s) => s.minutes >= bk[0] && s.minutes < bk[1]).length;
    columns(ctx, {cats: buckets.map((x) => x[2]), keys: ['n'], get: (c) => n(buckets.find((x) => x[2] === c)), color: () => series(4), yFmt: fmt.int, xLabel: (c) => c,
      valueLabel: (c) => fmt.int(n(buckets.find((x) => x[2] === c))),
      tip: (c) => {
        const bk = buckets.find((x) => x[2] === c);
        return [`${c} into a session`, [[null, 'Crashes and freezes', fmt.int(n(bk))], [null, 'Sessions of that length', fmt.int(all2(bk))]]];
      }});
  });

  draw(root, 'st-monthly', 240, (ctx) => {
    const months = sessionMonths(done);
    if (!months.length) return false;
    const by = groupBy(done, (s) => s.month);
    const rate = (m) => {
      const v = by.get(m) || [];
      return v.length >= 3 ? (100 * v.filter((s) => s.unclean).length) / v.length : null;
    };
    lines(ctx, {cats: months, series: [{name: 'Crash or freeze rate', color: critical(), get: rate}], yFmt: (v) => `${Math.round(v)}%`, xLabel: fmt.month, tipHead: fmt.monthLong,
      refs: hardwareChanges(all).map((r) => ({cat: r.month, label: r.label})),
      tipExtra: (m) => [[null, 'Sessions', fmt.int((by.get(m) || []).length)]]});
  });

  const setup = [
    ...rateRows(done, (s) => s.renderer && `Renderer: ${s.renderer}`),
    ...rateRows(done, (s) => s.gpu && `GPU: ${s.gpu}`),
    ...rateRows(done, (s) => s.cpu && `CPU: ${s.cpu}`),
  ];
  draw(root, 'st-setup', () => Math.max(1, setup.length) * ROW_H, (ctx) => {
    if (!setup.length) return false;
    hbars(ctx, setup, {label: (r) => `${r.k} · ${fmt.int(r.n)} sessions`, value: (r) => r.rate, fmt: (v) => fmt.pct(v), color: (r) => (r.rate > LIMIT ? critical() : series(1)),
      tip: (r) => [[null, 'Crashed or froze', `${fmt.int(r.bad)} of ${fmt.int(r.n)}`], [null, 'Used', `${fmt.date(r.first)} – ${fmt.date(r.last)}`]]});
  });

  const where = [...countBy(crashes, (s) => (s.crash.duringLoad ? 'During a loading screen' : s.crash.lastDest || 'Before loading anywhere'))].sort((a, c) => c[1] - a[1]).map(([k, v]) => ({k, v}));
  draw(root, 'st-where', () => Math.max(1, where.length) * ROW_H, (ctx) => {
    if (!where.length) return false;
    hbars(ctx, where, {label: (r) => r.k, value: (r) => r.v, fmt: fmt.int, color: () => series(4)});
  });

  table(root.querySelector('#st-list'), {
    rows: [...bad].reverse(),
    rowKey: (s) => s.key,
    onRow: open,
    sortKey: 'local',
    search: 'Filter by patch, driver, type…',
    columns: [
      {key: 'local', label: 'Started', fmt: (v) => fmt.dateTime(v)},
      {key: 'env', label: 'Build'},
      {key: 'patch', label: 'Patch', sortValue: (s) => (s.patch ? s.patch.split('.').map((x) => x.padStart(3, '0')).join('.') : '')},
      {key: 'driverShort', label: 'Driver'},
      {key: 'crashType', label: 'What happened'},
      {key: 'minutes', label: 'After', num: true, fmt: (v) => fmt.hm(v)},
      {key: 'where', label: 'Last place', fmt: (v, s) => (s.crash ? s.crash.lastDest || '' : '')},
      {key: 'msg', label: 'Details', fmt: (v, s) => (s.crash ? s.crash.exception || s.crash.message || '' : '')},
    ],
  });
}
