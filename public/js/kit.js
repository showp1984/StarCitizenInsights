// Chart and formatting kit shared by every page. Uses the global d3 (v7).

export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const series = (i) => css(`--s${(i % 7) + 1}`);
export const muted = () => css('--muted-series');
export const critical = () => css('--critical');

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export const fmt = {
  int: (v) => (v == null || Number.isNaN(v) ? '—' : d3.format(',')(Math.round(v))),
  dec: (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : d3.format(`,.${d}f`)(v)),
  pct: (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : `${d3.format(`.${d}f`)(v)}%`),
  s: (v) => (v == null || Number.isNaN(v) ? '—' : `${d3.format(',.0f')(v)} s`),
  fps: (v) => (v == null || Number.isNaN(v) ? '—' : `${d3.format('.0f')(v)} fps`),
  compact: (v) => (v == null || Number.isNaN(v) ? '—' : Intl.NumberFormat('en', {notation: 'compact', maximumFractionDigits: 1}).format(v)),
  hours: (v) => (v == null || Number.isNaN(v) ? '—' : `${d3.format(',.1f')(v)} h`),
  hm: (min) => {
    if (min == null || Number.isNaN(min)) return '—';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
  },
  date: (iso) => (iso ? d3.utcFormat('%b %-d, %Y')(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—'),
  dateTime: (iso) => (iso ? d3.utcFormat('%b %-d, %Y %H:%M')(new Date(`${iso.slice(0, 19)}Z`)) : '—'),
  month: (m) => d3.utcFormat('%b %y')(new Date(`${m}-01T00:00:00Z`)),
  monthLong: (m) => d3.utcFormat('%B %Y')(new Date(`${m}-01T00:00:00Z`)),
  quarter: (q) => `${q.slice(5)} ${q.slice(0, 4)}`,
  name: (s) => String(s ?? '').replace(/_/g, ' '),
};

// ---------- tooltip (one shared element, fixed to the viewport)
const tipEl = () => document.getElementById('tip');
export function showTip(event, head, lines) {
  const t = tipEl();
  t.replaceChildren();
  const hd = document.createElement('div');
  hd.className = 'tip-head';
  hd.textContent = head;
  t.append(hd);
  for (const [color, label, value] of lines) {
    const row = document.createElement('div');
    row.className = 'tip-row';
    if (color) {
      const sw = document.createElement('span');
      sw.className = 'sw';
      sw.style.background = color;
      row.append(sw);
    }
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('b');
    v.textContent = value;
    row.append(l, v);
    t.append(row);
  }
  t.hidden = false;
  const pad = 14;
  const r = t.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY - r.height - pad;
  if (x + r.width > window.innerWidth - 8) x = event.clientX - r.width - pad;
  if (y < 8) y = event.clientY + pad;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${y}px`;
}
export const hideTip = () => { tipEl().hidden = true; };

export function legend(items) {
  return `<div class="legend">${items.map(([color, label, line]) => `<span><i class="sw${line ? ' line' : ''}" style="background:${color}"></i>${esc(label)}</span>`).join('')}</div>`;
}

// ---------- canvas
export function chart(el, height) {
  el.replaceChildren();
  const w = Math.max(260, Math.floor(el.clientWidth || 600));
  const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${w} ${height}`).attr('width', w).attr('height', height);
  return {el, svg, w, h: height};
}

export function emptyState(el, text) {
  el.innerHTML = `<div class="empty">${esc(text)}</div>`;
}

export function measure(svg, s, cls) {
  const t = svg.append('text').attr('class', cls || null).text(s);
  const w = t.node().getComputedTextLength();
  t.remove();
  return w;
}

export function fit(svg, s, maxW) {
  if (measure(svg, s) <= maxW) return s;
  let cut = s;
  while (cut.length > 1 && measure(svg, `${cut}…`) > maxW) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function thinLabels(svg, cats, label, step, minEvery = 1) {
  const w = d3.max(cats, (c) => measure(svg, label(c))) + 10;
  return Math.max(minEvery, Math.ceil(w / Math.max(step, 0.01)));
}

// Vertical bars; several keys stack. Options:
// cats, keys, get(cat,key), color(cat,key), yFmt, xLabel, tip(cat)->[head, lines], valueLabel(cat), limit {value,label}, refs [{cat,label}], yMax
export function columns(ctx, o) {
  const {svg, w, h} = ctx;
  const totals = new Map(o.cats.map((c) => [c, d3.sum(o.keys, (k) => o.get(c, k) || 0)]));
  const ymax = Math.max(o.yMax || 0, d3.max([...totals.values()]) || 1, o.limit ? o.limit.value * 1.1 : 0);
  const top = (o.refs && o.refs.length ? 32 : 8) + (o.valueLabel ? 14 : 0);
  const bottom = 22;
  const y = d3.scaleLinear([0, ymax], [h - bottom, top]).nice(4);
  const ticks = y.ticks(4);
  const left = Math.ceil(d3.max(ticks, (t) => measure(svg, o.yFmt(t)))) + 8;
  const right = w - 4;
  const x = d3.scaleBand(o.cats, [left, right]).paddingInner(0.22).paddingOuter(0.1);
  const bw = Math.min(x.bandwidth(), o.maxBar || 34);
  const off = (x.bandwidth() - bw) / 2;
  const hl = svg.append('rect').attr('class', 'hl').attr('y', top).attr('height', h - bottom - top).attr('width', x.step()).attr('opacity', 0);
  svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'gl').attr('x1', left).attr('x2', right).attr('y1', y).attr('y2', y);
  svg.append('g').selectAll('text').data(ticks).join('text').attr('x', left - 6).attr('y', y).attr('dy', '0.32em').attr('text-anchor', 'end').text(o.yFmt);
  const every = thinLabels(svg, o.cats, o.xLabel, x.step(), o.every || 1);
  svg.append('g').selectAll('text').data(o.cats.filter((c, i) => i % every === 0)).join('text')
    .attr('x', (c) => x(c) + x.bandwidth() / 2).attr('y', h - bottom + 16).attr('text-anchor', 'middle').text(o.xLabel);
  for (const c of o.cats) {
    let acc = 0;
    for (const k of o.keys) {
      const v = o.get(c, k) || 0;
      if (v > 0) {
        svg.append('rect').attr('x', x(c) + off).attr('width', bw).attr('y', y(acc + v)).attr('height', Math.max(0.5, y(acc) - y(acc + v)))
          .attr('rx', Math.min(3, bw / 4)).style('fill', o.color(c, k));
      }
      acc += v;
    }
    if (o.valueLabel) {
      const lab = o.valueLabel(c);
      if (lab && x.bandwidth() + 6 >= measure(svg, lab)) {
        svg.append('text').attr('class', 'strong').attr('x', x(c) + x.bandwidth() / 2).attr('y', y(acc) - 5).attr('text-anchor', 'middle').text(lab);
      }
    }
  }
  svg.append('line').attr('class', 'ax').attr('x1', left).attr('x2', right).attr('y1', y(0)).attr('y2', y(0));
  if (o.limit) {
    const ly = y(o.limit.value);
    svg.append('line').attr('class', 'ref').attr('x1', left).attr('x2', right).attr('y1', ly).attr('y2', ly);
    svg.append('text').attr('x', right).attr('y', ly - 4).attr('text-anchor', 'end').text(o.limit.label);
  }
  drawRefs(svg, (cat) => (x(cat) === undefined ? null : x(cat) + x.bandwidth() / 2), o.refs, right, y(0));
  svg.append('g').selectAll('rect').data(o.cats).join('rect')
    .attr('x', (c) => x(c) - (x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', top).attr('height', h - bottom - top)
    .style('fill', 'transparent').style('cursor', o.onClick ? 'pointer' : null)
    .on('mousemove', (event, c) => {
      hl.attr('x', x(c) - (x.step() - x.bandwidth()) / 2).attr('opacity', 0.7);
      const [head, lines] = o.tip(c);
      showTip(event, head, lines);
    })
    .on('mouseleave', () => { hl.attr('opacity', 0); hideTip(); })
    .on('click', (event, c) => o.onClick && o.onClick(c));
}

function drawRefs(svg, xOf, refs, right, baseY) {
  if (!refs || !refs.length) return;
  const placed = [];
  for (const r of refs) {
    const rx = xOf(r.cat);
    if (rx == null) continue;
    svg.append('line').attr('class', 'ref').attr('x1', rx).attr('x2', rx).attr('y1', 4).attr('y2', baseY);
    const lw = measure(svg, r.label);
    let anchor = 'start';
    let lx = rx + 4;
    if (lx + lw > right) { anchor = 'end'; lx = rx - 4; }
    const x0 = anchor === 'start' ? lx : lx - lw;
    let row = 0;
    while (placed.some((p) => p.row === row && x0 < p.x1 + 6 && x0 + lw > p.x0 - 6)) row += 1;
    placed.push({row, x0, x1: x0 + lw});
    svg.append('text').attr('class', 'strong').attr('x', lx).attr('y', 12 + row * 13).attr('text-anchor', anchor).text(r.label);
  }
}

// Horizontal bars with the label above each bar so long names fit at any width.
export const ROW_H = 36;
export function hbars(ctx, rows, o) {
  const {svg, w} = ctx;
  const value = o.value;
  const keys = o.keys;
  const total = (r) => (keys ? d3.sum(keys, (k) => o.get(r, k) || 0) : value(r));
  const vmax = d3.max(rows, total) || 1;
  const valW = d3.max(rows, (r) => measure(svg, o.fmt(total(r)))) + 10;
  const x = d3.scaleLinear([0, vmax], [0, Math.max(40, w - valW)]);
  rows.forEach((r, i) => {
    const y0 = i * ROW_H;
    svg.append('text').attr('class', 'strong').attr('x', 0).attr('y', y0 + 12).text(fit(svg, o.label(r), w));
    let acc = 0;
    const parts = keys ? keys.map((k) => [k, o.get(r, k) || 0]) : [[null, value(r)]];
    for (const [k, v] of parts) {
      if (v <= 0) continue;
      svg.append('rect').attr('x', x(acc)).attr('y', y0 + 18).attr('width', Math.max(1.5, x(acc + v) - x(acc))).attr('height', 10).attr('rx', 2)
        .style('fill', o.color ? o.color(r, k, i) : series(0));
      acc += v;
    }
    svg.append('text').attr('x', x(acc) + 6).attr('y', y0 + 27).text(o.fmt(total(r)));
    svg.append('rect').attr('x', 0).attr('y', y0).attr('width', w).attr('height', ROW_H).style('fill', 'transparent')
      .style('cursor', o.onClick ? 'pointer' : null)
      .on('mousemove', (event) => showTip(event, o.label(r), o.tip ? o.tip(r) : [[null, '', o.fmt(total(r))]]))
      .on('mouseleave', hideTip)
      .on('click', () => o.onClick && o.onClick(r));
  });
}

// Lines over categories. o.series: [{name, color, get(cat), dash}], cats, yFmt, xLabel, refs, tipExtra(cat), yMin
export function lines(ctx, o) {
  const {svg, w, h} = ctx;
  const top = o.refs && o.refs.length ? 32 : 10;
  const bottom = 22;
  const vals = o.series.flatMap((s) => o.cats.map((c) => s.get(c))).filter((v) => v != null && !Number.isNaN(v));
  const y = d3.scaleLinear([o.yMin ?? Math.min(0, d3.min(vals) ?? 0), Math.max(o.yMax || 0, d3.max(vals) || 1)], [h - bottom, top]).nice(4);
  const ticks = y.ticks(4);
  const left = Math.ceil(d3.max(ticks, (t) => measure(svg, o.yFmt(t)))) + 8;
  const lastCat = o.cats[o.cats.length - 1];
  const endW = o.endLabels === false ? 8 : (d3.max(o.series, (s) => measure(svg, s.get(lastCat) == null ? '' : o.yFmt(s.get(lastCat)))) || 0) + 12;
  const x = d3.scalePoint(o.cats, [left + 8, w - endW]).padding(o.cats.length === 1 ? 0.5 : 0);
  svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'gl').attr('x1', left).attr('x2', w - endW).attr('y1', y).attr('y2', y);
  svg.append('g').selectAll('text').data(ticks).join('text').attr('x', left - 6).attr('y', y).attr('dy', '0.32em').attr('text-anchor', 'end').text(o.yFmt);
  const every = thinLabels(svg, o.cats, o.xLabel, x.step() || 60);
  svg.append('g').selectAll('text').data(o.cats.filter((c, i) => i % every === 0)).join('text')
    .attr('x', (c) => x(c)).attr('y', h - bottom + 16).attr('text-anchor', 'middle').text(o.xLabel);
  svg.append('line').attr('class', 'ax').attr('x1', left).attr('x2', w - endW).attr('y1', y(y.domain()[0])).attr('y2', y(y.domain()[0]));
  drawRefs(svg, (cat) => (x(cat) === undefined ? null : x(cat)), o.refs, w - endW, h - bottom);
  const rule = svg.append('line').attr('class', 'ref').attr('y1', top).attr('y2', h - bottom).attr('opacity', 0);
  const ends = [];
  for (const s of o.series) {
    const pts = o.cats.filter((c) => s.get(c) != null && !Number.isNaN(s.get(c)));
    svg.append('path').datum(pts)
      .attr('d', d3.line().defined((c) => s.get(c) != null).x((c) => x(c)).y((c) => y(s.get(c))))
      .style('fill', 'none').style('stroke', s.color).attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
      .attr('stroke-dasharray', s.dash ? '5 4' : null);
    if (o.cats.length <= 40) {
      svg.append('g').selectAll('circle').data(pts).join('circle').attr('cx', (c) => x(c)).attr('cy', (c) => y(s.get(c))).attr('r', 2.6).style('fill', s.color);
    }
    const last = pts[pts.length - 1];
    if (last === lastCat && o.endLabels !== false) ends.push({y: y(s.get(last)), text: o.yFmt(s.get(last)), color: s.color});
  }
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i += 1) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  for (const e of ends) svg.append('text').attr('class', 'strong').attr('x', w - endW + 6).attr('y', e.y).attr('dy', '0.32em').style('fill', e.color).text(e.text);
  svg.append('rect').attr('x', left).attr('y', top).attr('width', Math.max(1, w - endW - left)).attr('height', h - bottom - top).style('fill', 'transparent')
    .on('mousemove', (event) => {
      const [px] = d3.pointer(event);
      const c = o.cats.reduce((a, b) => (Math.abs(x(b) - px) < Math.abs(x(a) - px) ? b : a));
      rule.attr('x1', x(c)).attr('x2', x(c)).attr('opacity', 1);
      showTip(event, o.tipHead ? o.tipHead(c) : o.xLabel(c), [
        ...o.series.map((s) => [s.color, s.name, s.get(c) == null ? '—' : o.yFmt(s.get(c))]),
        ...(o.tipExtra ? o.tipExtra(c) : []),
      ]);
    })
    .on('mouseleave', () => { rule.attr('opacity', 0); hideTip(); });
}

// GitHub-style calendar: one column per week, one row per weekday (Mon first).
export function calendar(ctx, days, o) {
  const {svg, w} = ctx;
  const start = d3.utcMonday.floor(o.from);
  const weeks = d3.utcMonday.count(start, o.to) + 1;
  const left = 30;
  const top = 16;
  const cell = Math.max(6, Math.min(16, Math.floor((w - left - 4) / weeks) - 2));
  const gap = 2;
  const vmax = d3.quantile([...days.values()].filter((v) => v > 0).sort(d3.ascending), 0.95) || 1;
  const color = d3.scaleSequential([0, vmax], d3.interpolateRgb(css('--panel-2'), css('--accent'))).clamp(true);
  ['Mon', 'Wed', 'Fri'].forEach((d, i) => svg.append('text').attr('x', 0).attr('y', top + (i * 2) * (cell + gap) + cell - 1).text(d));
  let lastMonth = -1;
  for (let d = new Date(start); d <= o.to; d = d3.utcDay.offset(d, 1)) {
    const wk = d3.utcMonday.count(start, d);
    const wd = (d.getUTCDay() + 6) % 7;
    const key = d.toISOString().slice(0, 10);
    const v = days.get(key) || 0;
    const x0 = left + wk * (cell + gap);
    if (wd === 0 && d.getUTCMonth() !== lastMonth && d.getUTCDate() <= 7) {
      lastMonth = d.getUTCMonth();
      svg.append('text').attr('x', x0).attr('y', 10).text(d3.utcFormat('%b')(d));
    }
    if (d < o.from) continue;
    svg.append('rect').attr('x', x0).attr('y', top + wd * (cell + gap)).attr('width', cell).attr('height', cell).attr('rx', 2)
      .style('fill', v > 0 ? color(v) : css('--panel-2'))
      .on('mousemove', (event) => showTip(event, fmt.date(key), [[null, 'Played', v ? fmt.hm(v * 60) : 'not at all']]))
      .on('mouseleave', hideTip);
  }
  return top + 7 * (cell + gap);
}

// Sortable table. columns: [{key, label, num, fmt(v,row), html(row)}]
export function table(el, {columns: cols, rows, sortKey, sortDir = 'desc', onRow, rowKey, search}) {
  let key = sortKey;
  let dir = sortDir;
  let query = '';
  el.innerHTML = `${search ? `<div class="toolbar"><input class="search" type="search" placeholder="${esc(search)}" aria-label="${esc(search)}"></div>` : ''}<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}" data-key="${c.key}"><button type="button">${esc(c.label)}</button></th>`).join('')}</tr></thead><tbody></tbody></table></div>`;
  const tbody = el.querySelector('tbody');
  const draw = () => {
    let list = rows;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((r) => cols.some((c) => String(c.fmt ? c.fmt(r[c.key], r) : r[c.key] ?? '').toLowerCase().includes(q)));
    }
    if (key) {
      const col = cols.find((c) => c.key === key);
      const val = (r) => (col && col.sortValue ? col.sortValue(r) : r[key]);
      list = [...list].sort((a, b) => {
        const va = val(a);
        const vb = val(b);
        if (va == null) return 1;
        if (vb == null) return -1;
        return (va < vb ? -1 : va > vb ? 1 : 0) * (dir === 'asc' ? 1 : -1);
      });
    }
    tbody.innerHTML = list.map((r) => `<tr${onRow ? ` class="clickable" tabindex="0" data-key="${esc(rowKey(r))}"` : ''}>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(r) : esc(c.fmt ? c.fmt(r[c.key], r) : r[c.key] ?? '')}</td>`).join('')}</tr>`).join('');
    el.querySelectorAll('th').forEach((th) => th.setAttribute('aria-sort', th.dataset.key === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'));
  };
  el.querySelectorAll('th button').forEach((b) => b.addEventListener('click', () => {
    const k = b.parentElement.dataset.key;
    if (key === k) dir = dir === 'asc' ? 'desc' : 'asc';
    else { key = k; dir = cols.find((c) => c.key === k).num ? 'desc' : 'asc'; }
    draw();
  }));
  if (search) el.querySelector('.search').addEventListener('input', (e) => { query = e.target.value; draw(); });
  if (onRow) {
    const pick = (e) => {
      const tr = e.target.closest('tr[data-key]');
      if (tr) onRow(tr.dataset.key);
    };
    tbody.addEventListener('click', pick);
    tbody.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(e); });
  }
  draw();
}
