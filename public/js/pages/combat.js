import {columns, hbars, table, fmt, legend, series, muted, critical, measure, showTip, hideTip, esc, ROW_H} from '../kit.js';
import {sum, countBy, groupBy, monthRange, combatEvents, KILL_GROUPS, npcGroup, zoneGroup, weaponName, deathCause, toLocal} from '../model.js';
import {tile, card, head, draw, b} from './common.js';

const groupColor = (key) => ({'ship-npc': series(1), 'ship-player': series(2), 'foot-npc': series(0), 'foot-player': series(4), other: muted()}[key]);
const groupOf = (domain, who) => (domain === 'other' || !['npc', 'player'].includes(who) ? 'other' : `${domain}-${who}`);
const kd = (k, d) => (d ? fmt.dec(k / d, 2) : k ? `${fmt.int(k)} : 0` : '—');

// PvP kills above the axis, PvP deaths below it, per month. Deaths are far fewer than kills, so each half has its own scale.
function diverging(ctx, months, up, down) {
  const {svg, w, h} = ctx;
  const top = 18;
  const bottom = h - 22;
  const zero = top + (bottom - top) * 0.62;
  const maxUp = Math.max(1, ...months.map((m) => sum(up, (s) => s.get(m))));
  const maxDown = Math.max(1, ...months.map((m) => sum(down, (s) => s.get(m))));
  const yUp = d3.scaleLinear([0, maxUp], [zero, top]).nice(3);
  const yDown = d3.scaleLinear([0, maxDown], [zero, bottom]).nice(2);
  const upTicks = yUp.ticks(3).filter((t) => t > 0);
  const downTicks = yDown.ticks(2).filter((t) => t > 0);
  const left = Math.ceil(d3.max([...upTicks, ...downTicks, 0], (t) => measure(svg, fmt.int(t)))) + 8;
  const x = d3.scaleBand(months, [left, w - 4]).paddingInner(0.2).paddingOuter(0.1);
  const bw = Math.min(x.bandwidth(), 30);
  const off = (x.bandwidth() - bw) / 2;
  for (const [ticks, y] of [[upTicks, yUp], [downTicks, yDown]]) {
    svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'gl').attr('x1', left).attr('x2', w - 4).attr('y1', y).attr('y2', y);
    svg.append('g').selectAll('text').data(ticks).join('text').attr('x', left - 6).attr('y', y).attr('dy', '0.32em').attr('text-anchor', 'end').text(fmt.int);
  }
  const lab = d3.max(months, (m) => measure(svg, fmt.month(m))) + 10;
  const every = Math.max(1, Math.ceil(lab / x.step()));
  svg.append('g').selectAll('text').data(months.filter((m, i) => i % every === 0)).join('text').attr('x', (m) => x(m) + x.bandwidth() / 2).attr('y', h - 6).attr('text-anchor', 'middle').text(fmt.month);
  for (const m of months) {
    let acc = 0;
    for (const s of up) {
      const v = s.get(m);
      if (v) svg.append('rect').attr('x', x(m) + off).attr('width', bw).attr('y', yUp(acc + v)).attr('height', Math.max(1, yUp(acc) - yUp(acc + v))).attr('rx', 2).style('fill', s.color);
      acc += v;
    }
    acc = 0;
    for (const s of down) {
      const v = s.get(m);
      if (v) svg.append('rect').attr('x', x(m) + off).attr('width', bw).attr('y', yDown(acc)).attr('height', Math.max(1, yDown(acc + v) - yDown(acc))).attr('rx', 2).style('fill', s.color).style('opacity', 0.75);
      acc += v;
    }
  }
  svg.append('line').attr('class', 'ax').attr('x1', left).attr('x2', w - 4).attr('y1', zero).attr('y2', zero);
  svg.append('text').attr('x', w - 4).attr('y', top - 6).attr('text-anchor', 'end').attr('class', 'strong').text('Kills of players ↑');
  svg.append('text').attr('x', w - 4).attr('y', bottom - 4).attr('text-anchor', 'end').attr('class', 'strong').text('Deaths to players ↓');
  svg.append('g').selectAll('rect').data(months).join('rect').attr('x', (m) => x(m) - (x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', 0).attr('height', h - 22)
    .style('fill', 'transparent')
    .on('mousemove', (event, m) => showTip(event, fmt.monthLong(m), [...up.map((s) => [s.color, s.name, fmt.int(s.get(m))]), ...down.map((s) => [s.color, s.name, fmt.int(s.get(m))])]))
    .on('mouseleave', hideTip);
}

export function render(root, {sessions, open}) {
  const {kills, deaths} = combatEvents(sessions);
  const realDeaths = deaths.filter((d) => d.damage !== 'Suicide');
  const n = (list, domain, who, field) => list.filter((e) => e.domain === domain && e[field] === who).length;
  const cells = KILL_GROUPS.map((g) => ({...g, k: n(kills, g.domain, g.who, 'victim'), d: n(realDeaths, g.domain, g.who, 'killer')}));
  const pvpK = kills.filter((k) => k.victim === 'player').length;
  const pvpD = realDeaths.filter((d) => d.killer === 'player').length;
  const shipK = kills.filter((k) => k.domain === 'ship').length;
  const footK = kills.filter((k) => k.domain === 'foot').length;
  const uniqueVictims = new Set(kills.filter((k) => k.pid).map((k) => k.pid)).size;
  const first = kills.length ? kills[0].local : null;
  const last = kills.length ? kills[kills.length - 1].local : null;
  const cell = (domain, who) => cells.find((c) => c.domain === domain && c.who === who);
  const vdest = sessions.flatMap((s) => s.vdest.map((v) => ({...v, s})));
  const shipsKilled = vdest.filter((v) => v.cause === 'me' && v.to === 2 && !v.mine && v.how !== 'SelfDestruct');
  const shipsLost = vdest.filter((v) => v.mine && v.to === 2);

  root.innerHTML = `
    ${head('Combat', kills.length || deaths.length ? `The game logged every kill and death from ${b(fmt.date(first))} to ${b(fmt.date(last))}; newer versions stopped writing them. In that time you killed ${b(fmt.int(kills.filter((k) => k.victim === 'npc').length))} NPCs and ${b(fmt.int(pvpK))} players (${b(fmt.int(uniqueVictims))} different people). Your PvP kill/death ratio is ${b(kd(cell('ship', 'player').k, cell('ship', 'player').d))} in ship combat and ${b(kd(cell('foot', 'player').k, cell('foot', 'player').d))} on foot.` : 'No kills or deaths were logged for this selection. The game only wrote them until November 2025.')}
    <div class="tiles">
      ${tile('Kills', fmt.int(kills.length), `${fmt.int(shipK)} from ships · ${fmt.int(footK)} on foot`)}
      ${tile('Player kills', fmt.int(pvpK), `${fmt.int(uniqueVictims)} different players`)}
      ${tile('PvP K/D', kd(pvpK, pvpD), `${fmt.int(pvpK)} kills · ${fmt.int(pvpD)} deaths to players`)}
      ${tile('Deaths', fmt.int(realDeaths.length), `plus ${fmt.int(deaths.length - realDeaths.length)} respawns you chose`)}
      ${tile('Ships destroyed', fmt.int(shipsKilled.length), `${fmt.int(shipsKilled.filter((v) => v.npcCrew).length)} crewed by NPCs`)}
      ${tile('Ships lost while flying', fmt.int(shipsLost.length), `${fmt.int(shipsLost.filter((v) => v.cause !== 'me').length)} to someone else`)}
    </div>
    <article class="card" id="card-matrix">
      <h2>Ship combat vs on foot, NPCs vs players</h2>
      <p class="note">Ship combat counts kills and deaths from ship weapons, destroyed ships and crashes; on foot counts personal weapons, melee and takedowns. The ratio is kills per death.</p>
      <div class="matrix">
        <span></span><span class="mh">Against NPCs</span><span class="mh">Against players</span>
        ${['ship', 'foot'].map((dm) => `<span class="mr">${dm === 'ship' ? 'Ship combat' : 'On foot'}</span>${['npc', 'player'].map((who) => {
          const c = cell(dm, who);
          return `<div class="cell" style="box-shadow: inset 3px 0 0 ${groupColor(`${dm}-${who}`)}"><span class="kd">${esc(kd(c.k, c.d))} <small>K/D</small></span><span class="kv"><b>${fmt.int(c.k)}</b> kills · <b>${fmt.int(c.d)}</b> deaths</span></div>`;
        }).join('')}`).join('')}
      </div>
      <p class="note">${fmt.int(kills.filter((k) => k.domain === 'other').length)} kills and ${fmt.int(realDeaths.filter((d) => d.domain === 'other').length)} deaths don't fit either side (hazards, gas canisters, unexplained explosions).</p>
    </article>
    <div class="grid">
      ${card('cb-monthly', 'Kills per month', '', {wide: true, legend: legend([...KILL_GROUPS.map((g) => [groupColor(g.key), g.label]), [muted(), 'Other']])})}
      ${card('cb-pvp', 'PvP: kills and deaths per month', 'Kills of players above the line, deaths to players below.', {wide: true, legend: legend([[groupColor('ship-player'), 'Ship combat'], [groupColor('foot-player'), 'On foot']])})}
      ${card('cb-foot-weapons', 'Top on-foot weapons', 'Your personal weapons by kills.')}
      ${card('cb-ship-weapons', 'Top ship weapons', 'Ship guns, missiles and bomb racks by kills; names as the game logs them.')}
      ${card('cb-npcs', 'Who you fight', 'NPC kills grouped by type, split by ship and on foot.', {legend: legend([[groupColor('ship-npc'), 'From a ship'], [groupColor('foot-npc'), 'On foot']])})}
      ${card('cb-zones', 'Where kills happen', 'Grouped from the zone each victim was in.', {legend: legend([[series(1), 'Ship combat'], [series(0), 'On foot'], [muted(), 'Other']])})}
      ${card('cb-deaths', 'How you died', 'Respawns you chose are counted separately.')}
      ${card('cb-ships', 'Ships you destroyed', 'Fully destroyed by you. NPC crews are marked by the game; the rest were player ships or empty.', {legend: legend([[series(1), 'NPC crew'], [series(2), 'Player or empty']])})}
      ${card('cb-rivals', 'Players you met most', 'Players are kept anonymous; the app never stores names. Ranked by kills plus deaths between you.')}
      ${card('cb-survival', 'Deaths, heals and knockdowns per month', 'Deaths come from kill lines until Nov 2025 and from corpse records after, so they continue past the cut-off.', {legend: legend([[critical(), 'Deaths', true], [series(4), 'Incapacitated', true], [series(3), 'Med-bed heals', true]])})}
      ${card('cb-best', 'Your biggest combat sessions', 'Sessions with the most kills. Click a row to open it.', {wide: true, body: '<div id="cb-best"></div>'})}
    </div>`;

  const months = kills.length ? monthRange(kills[0].local.slice(0, 7), kills[kills.length - 1].local.slice(0, 7)) : [];
  draw(root, 'cb-monthly', 260, (ctx) => {
    if (!months.length) return false;
    const by = countBy(kills, (k) => `${k.local.slice(0, 7)}|${groupOf(k.domain, k.victim)}`);
    const keys = [...KILL_GROUPS.map((g) => g.key), 'other'];
    columns(ctx, {cats: months, keys, get: (c, k) => by.get(`${c}|${k}`), color: (c, k) => groupColor(k), yFmt: fmt.int, xLabel: fmt.month,
      tip: (c) => [fmt.monthLong(c), keys.map((k) => [groupColor(k), k === 'other' ? 'Other' : KILL_GROUPS.find((g) => g.key === k).label, fmt.int(by.get(`${c}|${k}`) || 0)])]});
  });

  draw(root, 'cb-pvp', 260, (ctx) => {
    if (!months.length) return false;
    const kBy = countBy(kills.filter((k) => k.victim === 'player'), (k) => `${k.local.slice(0, 7)}|${k.domain}`);
    const dBy = countBy(realDeaths.filter((d) => d.killer === 'player'), (d) => `${d.local.slice(0, 7)}|${d.domain}`);
    diverging(ctx, months,
      [{name: 'Kills from ships', color: groupColor('ship-player'), get: (m) => kBy.get(`${m}|ship`) || 0}, {name: 'Kills on foot', color: groupColor('foot-player'), get: (m) => kBy.get(`${m}|foot`) || 0}],
      [{name: 'Deaths in ship combat', color: groupColor('ship-player'), get: (m) => dBy.get(`${m}|ship`) || 0}, {name: 'Deaths on foot', color: groupColor('foot-player'), get: (m) => dBy.get(`${m}|foot`) || 0}]);
  });

  const weaponRows = (domain) => [...groupBy(kills.filter((k) => k.domain === domain && !['unknown', 'self', 'none (player)'].includes(k.weapon)), (k) => k.weapon)]
    .map(([w, v]) => ({w, n: v.length, npc: v.filter((k) => k.victim === 'npc').length, player: v.filter((k) => k.victim === 'player').length}))
    .sort((a, c) => c.n - a.n).slice(0, 10);
  for (const [id, domain, colors] of [['cb-foot-weapons', 'foot', ['foot-npc', 'foot-player']], ['cb-ship-weapons', 'ship', ['ship-npc', 'ship-player']]]) {
    const rows = weaponRows(domain);
    draw(root, id, () => Math.max(1, rows.length) * ROW_H, (ctx) => {
      if (!rows.length) return false;
      hbars(ctx, rows, {label: (r) => weaponName(r.w), keys: ['npc', 'player'], get: (r, k) => r[k], fmt: fmt.int, color: (r, k) => groupColor(k === 'npc' ? colors[0] : colors[1]),
        tip: (r) => [[groupColor(colors[0]), 'NPC kills', fmt.int(r.npc)], [groupColor(colors[1]), 'Player kills', fmt.int(r.player)], [null, 'Game name', r.w]]});
    });
  }

  const npcRows = [...groupBy(kills.filter((k) => k.victim === 'npc'), (k) => npcGroup(k.npc))]
    .map(([g, v]) => ({g, ship: v.filter((k) => k.domain === 'ship').length, foot: v.filter((k) => k.domain !== 'ship').length, n: v.length})).sort((a, c) => c.n - a.n);
  draw(root, 'cb-npcs', () => Math.max(1, npcRows.length) * ROW_H, (ctx) => {
    if (!npcRows.length) return false;
    hbars(ctx, npcRows, {label: (r) => r.g, keys: ['ship', 'foot'], get: (r, k) => r[k], fmt: fmt.int, color: (r, k) => groupColor(k === 'ship' ? 'ship-npc' : 'foot-npc'),
      tip: (r) => [[groupColor('ship-npc'), 'From a ship', fmt.int(r.ship)], [groupColor('foot-npc'), 'On foot', fmt.int(r.foot)]]});
  });

  const zoneRows = [...groupBy(kills, (k) => zoneGroup(k.zone))]
    .map(([g, v]) => ({g, ship: v.filter((k) => k.domain === 'ship').length, foot: v.filter((k) => k.domain === 'foot').length, other: v.filter((k) => k.domain === 'other').length, n: v.length}))
    .sort((a, c) => c.n - a.n);
  draw(root, 'cb-zones', () => Math.max(1, zoneRows.length) * ROW_H, (ctx) => {
    if (!zoneRows.length) return false;
    hbars(ctx, zoneRows, {label: (r) => r.g, keys: ['ship', 'foot', 'other'], get: (r, k) => r[k], fmt: fmt.int, color: (r, k) => (k === 'ship' ? series(1) : k === 'foot' ? series(0) : muted()),
      tip: (r) => [[series(1), 'Ship combat', fmt.int(r.ship)], [series(0), 'On foot', fmt.int(r.foot)], [muted(), 'Other', fmt.int(r.other)]]});
  });

  const deathRows = [...countBy(realDeaths, deathCause)].sort((a, c) => c[1] - a[1]).map(([k, v]) => ({k, v}));
  draw(root, 'cb-deaths', () => Math.max(1, deathRows.length) * ROW_H, (ctx) => {
    if (!deathRows.length) return false;
    hbars(ctx, deathRows, {label: (r) => r.k, value: (r) => r.v, fmt: fmt.int, color: (r) => (/player/i.test(r.k) ? series(4) : /NPC/.test(r.k) ? series(0) : muted())});
  });

  const shipRows = [...groupBy(shipsKilled, (v) => v.ship)].map(([ship, v]) => ({ship, npcCrew: v.filter((x) => x.npcCrew).length, other: v.filter((x) => !x.npcCrew).length, n: v.length}))
    .sort((a, c) => c.n - a.n).slice(0, 12);
  draw(root, 'cb-ships', () => Math.max(1, shipRows.length) * ROW_H, (ctx) => {
    if (!shipRows.length) return false;
    hbars(ctx, shipRows, {label: (r) => fmt.name(r.ship), keys: ['npcCrew', 'other'], get: (r, k) => r[k], fmt: fmt.int, color: (r, k) => (k === 'npcCrew' ? series(1) : series(2)),
      tip: (r) => [[series(1), 'NPC crew', fmt.int(r.npcCrew)], [series(2), 'Player or empty', fmt.int(r.other)]]});
  });

  const rivals = new Map();
  for (const k of kills) if (k.pid) { const r = rivals.get(k.pid) || {k: 0, d: 0}; r.k += 1; rivals.set(k.pid, r); }
  for (const d of realDeaths) if (d.pid) { const r = rivals.get(d.pid) || {k: 0, d: 0}; r.d += 1; rivals.set(d.pid, r); }
  const rivalRows = [...rivals.values()].sort((a, c) => c.k + c.d - (a.k + a.d)).slice(0, 10).map((r, i) => ({...r, label: `Player ${String.fromCharCode(65 + i)}`}));
  draw(root, 'cb-rivals', () => Math.max(1, rivalRows.length) * ROW_H, (ctx) => {
    if (!rivalRows.length) return false;
    hbars(ctx, rivalRows, {label: (r) => `${r.label} · K/D ${kd(r.k, r.d)}`, keys: ['k', 'd'], get: (r, k) => r[k], fmt: fmt.int, color: (r, k) => (k === 'k' ? series(0) : critical()),
      tip: (r) => [[series(0), 'You killed them', fmt.int(r.k)], [critical(), 'They killed you', fmt.int(r.d)]]});
  });

  draw(root, 'cb-survival', 240, (ctx) => {
    const ms = sessions.length ? monthRange(sessions[0].month, sessions[sessions.length - 1].month) : [];
    if (!ms.length) return false;
    const by = groupBy(sessions, (s) => s.month);
    const deathsOf = (s) => (s.deaths.length ? s.deaths.filter((d) => d.damage !== 'Suicide').length : s.corpses.length);
    const val = (m, f) => sum(by.get(m) || [], f);
    columns(ctx, {cats: ms, keys: ['d', 'i', 'm'], get: (c, k) => (k === 'd' ? val(c, deathsOf) : k === 'i' ? val(c, (s) => s.counts.incapacitated) : val(c, (s) => s.counts.medBed)),
      color: (c, k) => (k === 'd' ? critical() : k === 'i' ? series(4) : series(3)), yFmt: fmt.int, xLabel: fmt.month,
      tip: (c) => [fmt.monthLong(c), [[critical(), 'Deaths', fmt.int(val(c, deathsOf))], [series(4), 'Incapacitated', fmt.int(val(c, (s) => s.counts.incapacitated))], [series(3), 'Med-bed heals', fmt.int(val(c, (s) => s.counts.medBed))]]]});
  });

  const best = sessions.filter((s) => s.kills.length).map((s) => ({
    key: s.key, local: s.local, patch: s.patch, minutes: s.minutes,
    npc: s.kills.filter((k) => k.victim === 'npc').length, player: s.kills.filter((k) => k.victim === 'player').length,
    ship: s.kills.filter((k) => k.domain === 'ship').length, foot: s.kills.filter((k) => k.domain === 'foot').length,
    deaths: s.deaths.filter((d) => d.damage !== 'Suicide').length, total: s.kills.length,
  }));
  table(root.querySelector('#cb-best'), {
    rows: best, rowKey: (r) => r.key, onRow: open, sortKey: 'total',
    columns: [
      {key: 'local', label: 'Started', fmt: (v) => fmt.dateTime(v)},
      {key: 'patch', label: 'Patch'},
      {key: 'minutes', label: 'Length', num: true, fmt: (v) => fmt.hm(v)},
      {key: 'total', label: 'Kills', num: true, fmt: fmt.int},
      {key: 'npc', label: 'NPCs', num: true, fmt: fmt.int},
      {key: 'player', label: 'Players', num: true, fmt: fmt.int},
      {key: 'ship', label: 'From ships', num: true, fmt: fmt.int},
      {key: 'foot', label: 'On foot', num: true, fmt: fmt.int},
      {key: 'deaths', label: 'Deaths', num: true, fmt: fmt.int},
      {key: 'perHour', label: 'Kills per hour', num: true, sortValue: (r) => r.total / Math.max(r.minutes / 60, 0.25), fmt: (v, r) => fmt.dec(r.total / Math.max(r.minutes / 60, 0.25))},
    ],
  });
}
