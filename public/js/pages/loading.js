import {columns, hbars, lines, fmt, legend, series, muted, ROW_H} from '../kit.js';
import {sum, median, quantile, countBy, groupBy, quarterRange, monthRange, toLocal, quarterOf} from '../model.js';
import {tile, card, head, draw, b} from './common.js';

const WORLDS = ['Stanton', 'Pyro', 'Nyx'];
const REGIONS = ['US East', 'EU West', 'Asia', 'Australia', 'US West'];

export function render(root, {sessions}) {
  const loads = sessions.flatMap((s) => s.loads.map((l) => {
    const local = toLocal(s, l.t);
    return {...l, quarter: quarterOf(local), month: local.slice(0, 7)};
  }));
  const world = loads.filter((l) => WORLDS.includes(l.dest));
  const menu = loads.filter((l) => l.dest === 'Main menu');
  const lastQ = world.length ? world[world.length - 1].quarter : null;
  const firstQ = world.length ? world[0].quarter : null;
  const recent = world.filter((l) => l.quarter === lastQ).map((l) => l.s);
  const first = world.filter((l) => l.quarter === firstQ).map((l) => l.s);
  const inGame = sessions.filter((s) => s.joins.length);
  const relogged = inGame.filter((s) => s.joins.length >= 2);
  const joins = sessions.flatMap((s) => s.joins.map((j) => ({...j, quarter: quarterOf(toLocal(s, j.t))})));
  const lastJoinQ = joins.length ? joins[joins.length - 1].quarter : null;
  const topRegion = [...countBy(joins.filter((j) => j.quarter === lastJoinQ), (j) => j.region)].sort((a, c) => c[1] - a[1])[0];
  const inv = sessions.filter((s) => s.inventory && s.inventory.n >= 10);
  const invRecent = inv.slice(-20);

  root.innerHTML = `
    ${head('Loading & servers', world.length ? `A loading screen into the game world takes ${b(fmt.s(median(recent)))} at the median in ${b(fmt.quarter(lastQ))}${firstQ !== lastQ ? `, down from ${b(fmt.s(median(first)))} in ${b(fmt.quarter(firstQ))}` : ''}. ${inGame.length ? `${b(fmt.pct((100 * relogged.length) / inGame.length))} of sessions that reached a server joined one twice or more.` : ''}` : 'No loading screens for this selection.')}
    <div class="tiles">
      ${tile('Median world load', fmt.s(median(recent)), lastQ ? fmt.quarter(lastQ) : '')}
      ${tile('Slowest 10% of loads', fmt.s(quantile(recent, 0.9)), '90th percentile, same quarter')}
      ${tile('Main menu load', fmt.s(median(menu.map((l) => l.s))), 'Median, all sessions shown')}
      ${tile('Sessions with a relog', inGame.length ? fmt.pct((100 * relogged.length) / inGame.length) : '—', `${fmt.int(relogged.length)} of ${fmt.int(inGame.length)} that joined a server`)}
      ${tile('Most-used region', topRegion ? topRegion[0] : '—', lastJoinQ ? `${fmt.quarter(lastJoinQ)}, ${fmt.int(topRegion ? topRegion[1] : 0)} joins` : '')}
      ${tile('Inventory response', invRecent.length ? `${fmt.dec(median(invRecent.map((s) => s.inventory.median)), 2)} s` : '—', 'Server round trip, median of your last 20 sessions')}
    </div>
    <div class="grid">
      ${card('ld-quarter', 'Loading screen length', 'Loading into Stanton, Pyro or Nyx, per quarter.', {legend: legend([[series(0), 'Median', true], [series(1), 'Slowest 10%', true]])})}
      ${card('ld-dest', 'Median load by star system', 'Per quarter.', {legend: legend([[series(1), 'Stanton', true], [series(0), 'Pyro', true], [series(2), 'Nyx', true]])})}
      ${card('ld-regions', 'Server region', 'Share of server joins per quarter. Joins are logged from mid-2025 on.', {legend: legend([[series(1), 'US East'], [series(0), 'EU West'], [series(2), 'Asia'], [series(3), 'Australia'], [muted(), 'Other']])})}
      ${card('ld-inv', 'How fast the server answers', 'Median time for an inventory request to come back, per month. A rough gauge of server load.')}
      ${card('ld-disc', 'Why you left servers', 'Every disconnect from a game server, by the reason the log gives.')}
      ${card('ld-joins', 'Server joins per session', 'How many times each session connected to a game server.')}
    </div>`;

  draw(root, 'ld-quarter', 240, (ctx) => {
    if (!world.length) return false;
    const qs = quarterRange(firstQ, lastQ);
    const by = groupBy(world, (l) => l.quarter);
    lines(ctx, {cats: qs, yFmt: (v) => `${Math.round(v)} s`, xLabel: fmt.quarter,
      series: [{name: 'Median', color: series(0), get: (q) => median((by.get(q) || []).map((l) => l.s))}, {name: 'Slowest 10%', color: series(1), get: (q) => quantile((by.get(q) || []).map((l) => l.s), 0.9)}],
      tipExtra: (q) => [[null, 'Loading screens', fmt.int((by.get(q) || []).length)]]});
  });

  draw(root, 'ld-dest', 240, (ctx) => {
    if (!world.length) return false;
    const qs = quarterRange(firstQ, lastQ);
    const by = groupBy(world, (l) => `${l.quarter}|${l.dest}`);
    const colorOf = {Stanton: series(1), Pyro: series(0), Nyx: series(2)};
    lines(ctx, {cats: qs, yFmt: (v) => `${Math.round(v)} s`, xLabel: fmt.quarter,
      series: WORLDS.map((w) => ({name: w, color: colorOf[w], get: (q) => {
        const v = (by.get(`${q}|${w}`) || []).map((l) => l.s);
        return v.length >= 3 ? median(v) : null;
      }}))});
  });

  draw(root, 'ld-regions', 240, (ctx) => {
    if (!joins.length) return false;
    const qs = quarterRange(joins[0].quarter, lastJoinQ);
    const by = groupBy(joins, (j) => j.quarter);
    const keys = [...REGIONS, ...new Set(joins.map((j) => j.region).filter((r) => !REGIONS.includes(r)))];
    const colorOf = (k) => (k === 'US East' ? series(1) : k === 'EU West' ? series(0) : k === 'Asia' ? series(2) : k === 'Australia' ? series(3) : muted());
    const pct = (q, k) => {
      const v = by.get(q) || [];
      return v.length ? (100 * v.filter((j) => j.region === k).length) / v.length : 0;
    };
    columns(ctx, {cats: qs, keys, get: pct, color: (c, k) => colorOf(k), yFmt: (v) => `${v}%`, xLabel: fmt.quarter, yMax: 100,
      tip: (q) => [`${fmt.quarter(q)} · ${fmt.int((by.get(q) || []).length)} joins`, keys.filter((k) => pct(q, k) > 0).map((k) => [colorOf(k), k, fmt.pct(pct(q, k), 0)])]});
  });

  draw(root, 'ld-inv', 240, (ctx) => {
    if (inv.length < 2) return false;
    const months = monthRange(inv[0].month, inv[inv.length - 1].month);
    const by = groupBy(inv, (s) => s.month);
    lines(ctx, {cats: months, yFmt: (v) => `${v.toFixed(1)} s`, xLabel: fmt.month, tipHead: fmt.monthLong,
      series: [{name: 'Median response', color: series(1), get: (m) => median((by.get(m) || []).map((s) => s.inventory.median))}, {name: 'Slowest 10%', color: series(4), get: (m) => median((by.get(m) || []).map((s) => s.inventory.p90))}],
      tipExtra: (m) => [[null, 'Sessions', fmt.int((by.get(m) || []).length)]]});
  }, 'Inventory timings are only logged by recent game versions.');

  const disc = [...countBy(sessions.flatMap((s) => s.disconnects), (d) => d.reason.replace(/^Remote Disconnect - /, ''))].sort((a, c) => c[1] - a[1]).map(([k, v]) => ({k, v}));
  draw(root, 'ld-disc', () => Math.max(1, disc.length) * ROW_H, (ctx) => {
    if (!disc.length) return false;
    hbars(ctx, disc, {label: (r) => r.k.charAt(0).toUpperCase() + r.k.slice(1), value: (r) => r.v, fmt: fmt.int, color: (r) => (/requested/i.test(r.k) ? series(1) : series(4))});
  });

  draw(root, 'ld-joins', 220, (ctx) => {
    if (!inGame.length) return false;
    const n = countBy(inGame, (s) => Math.min(s.joins.length, 6));
    const cats = [1, 2, 3, 4, 5, 6];
    columns(ctx, {cats, keys: ['n'], get: (c) => n.get(c) || 0, color: (c) => (c === 1 ? series(1) : series(0)), yFmt: fmt.int, xLabel: (c) => (c === 6 ? '6+' : String(c)),
      valueLabel: (c) => fmt.int(n.get(c) || 0), tip: (c) => [`${c === 6 ? '6 or more' : c} join${c === 1 ? '' : 's'}`, [[null, 'Sessions', fmt.int(n.get(c) || 0)]]]});
  });
}
