import {columns, hbars, lines, table, fmt, legend, series, muted, ROW_H} from '../kit.js';
import {sum, groupBy, countBy, monthRange, toLocal} from '../model.js';
import {tile, card, head, draw, b} from './common.js';

const BIG = 5000000;
const CATEGORIES = [
  [/medgun|medpen|crlf_|healing|medical|consumable_heal/i, 'Medical'],
  [/_mag(_|$)|ammo|battery/i, 'Ammo and magazines'],
  [/^[a-z]{3,5}_(rifle|smg|lmg|pistol|shotgun|sniper|glauncher|railgun|grenade)/i, 'Personal weapons'],
  [/^(MISL|MRCK|BMBRCK)_|^[A-Z]{3,5}_(Laser|Ballistic|Mass|Neutron|Distortion|Tachyon|Scatter|Gatling|Cannon|Repeater)/, 'Ship weapons and missiles'],
  [/^(POWR|COOL|SHLD|QDRV|JDRV|RADR|MNGN|MISC_Fuel)_/, 'Ship components'],
  [/multitool|tractor|grin_|hackingchip|salvage|mining|cutter/i, 'Tools'],
  [/armor|undersuit|helmet|backpack|_core|_legs|_arms|shirt|pants|jacket|boots|_hat|gloves|clothing|flightsuit/i, 'Armor and clothing'],
  [/drink|food|burrito|bottle|candy|noodle|_bar_|sandwich|pizza|coffee/i, 'Food and drink'],
  [/^[A-Z]{3,5}_[A-Z0-9]/, 'Ships and vehicles'],
];
const category = (item) => (CATEGORIES.find(([re]) => re.test(item)) || [null, 'Other'])[1];
const shopName = (s) => s.replace(/^SCShop_/, '').replace(/_/g, ' ');

export function render(root, {sessions}) {
  const contracts = sessions.flatMap((s) => s.contracts.map((c) => ({...c, month: toLocal(s, c.t).slice(0, 7)})));
  const n = countBy(contracts, (c) => c.status);
  const accepted = n.get('Accepted') || 0;
  const buys = sessions.flatMap((s) => s.shop.filter((x) => x.kind === 'Buy').map((x) => ({...x, s, month: toLocal(s, x.t).slice(0, 7), local: toLocal(s, x.t)})));
  const ok = buys.filter((x) => x.result !== 'Failure' && x.result !== 'Failed');
  const confirmed = buys.filter((x) => x.result === 'Success').length;
  const answered = buys.filter((x) => x.result).length;
  const spend = sum(ok, (x) => x.price);
  const big = ok.filter((x) => x.price >= BIG);

  root.innerHTML = `
    ${head('Missions & money', contracts.length || buys.length ? `You accepted ${b(fmt.int(accepted))} contracts and completed ${b(fmt.int(n.get('Complete') || 0))} (${b(fmt.pct(accepted ? (100 * (n.get('Complete') || 0)) / accepted : null))}). At shop kiosks you spent ${b(fmt.compact(spend))} aUEC${big.length ? `, ${b(fmt.compact(sum(big, (x) => x.price)))} of it on ${b(fmt.int(big.length))} purchases of ${fmt.compact(BIG)} or more` : ''}.` : 'No contracts or purchases for this selection.')}
    <div class="tiles">
      ${tile('Contracts accepted', fmt.int(accepted), `${fmt.int(n.get('Complete') || 0)} completed · ${fmt.int(n.get('Failed') || 0)} failed`)}
      ${tile('Completion rate', fmt.pct(accepted ? (100 * (n.get('Complete') || 0)) / accepted : null), 'The rest were abandoned or shared away')}
      ${tile('Objectives completed', fmt.int(sum(sessions, (s) => s.counts.objectives)), `${fmt.int(sum(sessions, (s) => s.counts.blueprints))} blueprints received`)}
      ${tile('aUEC spent', fmt.compact(spend), `${fmt.int(ok.length)} purchases`)}
      ${tile('Purchases confirmed', answered ? fmt.pct((100 * confirmed) / answered) : '—', 'Shop answered "success"')}
      ${tile('CrimeStat increases', fmt.int(sum(sessions, (s) => s.counts.crimestat)), `${fmt.int(sum(sessions, (s) => s.counts.crimes))} crimes committed`)}
    </div>
    <div class="grid">
      ${card('mi-monthly', 'Contracts per month', contracts.length ? `Contract notifications appear in your logs from ${b(fmt.monthLong(contracts[0].month))} on; earlier game versions didn't write them.` : '', {legend: legend([[series(1), 'Accepted', true], [series(0), 'Completed', true], [series(4), 'Failed', true]])})}
      ${card('mi-spend', 'Shop spending per month', `Single purchases of ${fmt.compact(BIG)} aUEC or more count as big buys; most are ships.`, {legend: legend([[series(0), 'Everyday'], [series(1), 'Big buys']])})}
      ${card('mi-top', 'Most-taken contracts', 'Party members sharing a contract count each time. Click a header to sort.', {body: '<div id="mi-top"></div>'})}
      ${card('mi-cats', 'What you spend on', 'aUEC by item type, big buys included.')}
      ${card('mi-shops', 'Where you shop', 'Number of purchases per shop.')}
      ${card('mi-big', 'Biggest purchases', 'Your largest buy requests and whether the shop confirmed them.', {body: '<div id="mi-big"></div>'})}
    </div>`;

  draw(root, 'mi-monthly', 240, (ctx) => {
    if (!contracts.length) return false;
    const months = monthRange(contracts[0].month, contracts[contracts.length - 1].month);
    const by = countBy(contracts, (c) => `${c.month}|${c.status}`);
    lines(ctx, {cats: months, yFmt: fmt.int, xLabel: fmt.month, tipHead: fmt.monthLong,
      series: [['Accepted', series(1)], ['Complete', series(0)], ['Failed', series(4)]].map(([k, color]) => ({name: k === 'Complete' ? 'Completed' : k, color, get: (m) => by.get(`${m}|${k}`) || 0}))});
  });

  draw(root, 'mi-spend', 240, (ctx) => {
    if (!ok.length) return false;
    const months = monthRange(ok[0].month, ok[ok.length - 1].month);
    const by = new Map();
    for (const x of ok) {
      const k = `${x.month}|${x.price >= BIG ? 'big' : 'every'}`;
      by.set(k, (by.get(k) || 0) + x.price);
    }
    columns(ctx, {cats: months, keys: ['every', 'big'], get: (c, k) => by.get(`${c}|${k}`), color: (c, k) => (k === 'every' ? series(0) : series(1)), yFmt: fmt.compact, xLabel: fmt.month,
      tip: (c) => [fmt.monthLong(c), [[series(0), 'Everyday', `${fmt.int(by.get(`${c}|every`) || 0)} aUEC`], [series(1), 'Big buys', `${fmt.int(by.get(`${c}|big`) || 0)} aUEC`]]]});
  });

  const top = [...groupBy(contracts, (c) => c.name)].map(([name, v]) => {
    const c = countBy(v, (x) => x.status);
    return {name, accepted: c.get('Accepted') || 0, completed: c.get('Complete') || 0, failed: c.get('Failed') || 0};
  }).filter((r) => r.accepted).map((r) => ({...r, rate: (100 * r.completed) / r.accepted}));
  table(root.querySelector('#mi-top'), {
    rows: top, sortKey: 'accepted', search: 'Find a contract…',
    columns: [
      {key: 'name', label: 'Contract'},
      {key: 'accepted', label: 'Accepted', num: true, fmt: fmt.int},
      {key: 'completed', label: 'Completed', num: true, fmt: fmt.int},
      {key: 'failed', label: 'Failed', num: true, fmt: fmt.int},
      {key: 'rate', label: 'Completion', num: true, fmt: (v) => fmt.pct(v, 0)},
    ],
  });

  const cats = [...groupBy(ok, (x) => category(x.item))].map(([k, v]) => ({k, v: sum(v, (x) => x.price), n: v.length})).sort((a, c) => c.v - a.v);
  draw(root, 'mi-cats', () => Math.max(1, cats.length) * ROW_H, (ctx) => {
    if (!cats.length) return false;
    hbars(ctx, cats, {label: (r) => r.k, value: (r) => r.v, fmt: (v) => `${fmt.compact(v)} aUEC`, color: (r) => (r.k === 'Ships and vehicles' ? series(1) : series(0)),
      tip: (r) => [[null, 'Spent', `${fmt.int(r.v)} aUEC`], [null, 'Purchases', fmt.int(r.n)]]});
  });

  const shops = [...countBy(ok, (x) => x.shop)].sort((a, c) => c[1] - a[1]).slice(0, 12).map(([k, v]) => ({k, v}));
  draw(root, 'mi-shops', () => Math.max(1, shops.length) * ROW_H, (ctx) => {
    if (!shops.length) return false;
    hbars(ctx, shops, {label: (r) => shopName(r.k), value: (r) => r.v, fmt: fmt.int, color: () => series(3)});
  });

  table(root.querySelector('#mi-big'), {
    rows: [...buys].sort((a, c) => c.price - a.price).slice(0, 40), sortKey: 'price',
    columns: [
      {key: 'local', label: 'Date', fmt: (v) => fmt.date(v)},
      {key: 'item', label: 'Item', fmt: (v) => fmt.name(v)},
      {key: 'shop', label: 'Shop', fmt: (v) => shopName(v)},
      {key: 'price', label: 'aUEC', num: true, fmt: fmt.int},
      {key: 'result', label: 'Shop said', fmt: (v) => v || 'no answer logged'},
    ],
  });
}
