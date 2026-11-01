import {columns, hbars, lines, fmt, legend, series, muted, critical, ROW_H} from '../kit.js';
import {sum, median, groupBy, comparePatch, monthRange, quarterRange, hardwareChanges, toLocal, quarterOf} from '../model.js';
import {tile, card, head, draw, b} from './common.js';
import {steadyPeak} from '../servers-model.js';

const WORLDS = ['Stanton', 'Pyro', 'Nyx'];

// The GPU timer sometimes reports nonsense (tens of thousands of fps); no GPU draws this game above 1,000 fps.
const validGpu = (p) => p.gpuFps >= 5 && p.gpuFps <= 1000;
// Memory peaks above what the PC could commit are measurement glitches.
const validMem = (p) => p.commitMaxMB && (!p.ramMB || p.commitMaxMB <= p.ramMB * 1.5);

// Frames over seconds, so long stretches count for more than short ones.
function avgFps(ps) {
  const v = ps.filter((p) => p.wholeFps > 0 && p.frames > 0);
  const secs = sum(v, (p) => p.frames / p.wholeFps);
  return secs ? sum(v, (p) => p.frames) / secs : null;
}
// GPU-only numbers are noisy, so use the median weighted by play time instead of an average.
function gpuFps(ps) {
  const v = ps.filter((p) => validGpu(p) && p.wholeFps > 0).map((p) => [p.gpuFps, p.frames / p.wholeFps]).sort((a, c) => a[0] - c[0]);
  const total = sum(v, (x) => x[1]);
  let acc = 0;
  for (const [fps, secs] of v) {
    acc += secs;
    if (acc >= total / 2) return fps;
  }
  return null;
}
function share(ps, from, to) {
  const v = ps.filter((p) => p.wholeBuckets && p.frames > 0);
  const f = sum(v, (p) => p.frames);
  return f ? sum(v, (p) => p.frames * sum(p.wholeBuckets.slice(from, to)) / 100) / f * 100 : null;
}

export async function render(root, {sessions, all, state}) {
  // Video memory isn't in Game.log; it comes from the overlay readings (r_displayinfo), one peak per session.
  let readings = [];
  try {
    readings = (await (await fetch('/api/readings')).json()).readings;
  } catch (e) {
    // the page still shows what the logs know
  }
  if (state.page !== 'performance') return;
  const bySession = groupBy(readings.filter((r) => r.vramMB != null), (r) => r.session);
  const vram = sessions.filter((s) => bySession.has(s.key)).map((s) => {
    const list = bySession.get(s.key);
    const totals = list.map((r) => r.vramTotalMB).filter(Boolean).sort((a, c) => a - c);
    const local = toLocal(s, s.start);
    return {s, peakMB: steadyPeak(list, 'vramMB'), totalMB: totals[totals.length >> 1] || s.vramMB, month: local.slice(0, 7), quarter: quarterOf(local)};
  }).filter((v) => v.peakMB != null);
  const profiles = [];
  for (const s of sessions) {
    for (const p of s.profiles) {
      if (!WORLDS.includes(p.dest) || !p.wholeFps) continue;
      const local = toLocal(s, p.t || s.start);
      profiles.push({...p, s, ramMB: s.ramMB, month: local.slice(0, 7), quarter: quarterOf(local), hw: `${s.cpu || '?'} + ${s.gpu || '?'}`});
    }
  }
  const hours = sum(profiles, (p) => p.frames / p.wholeFps) / 3600;
  const lastQ = profiles.length ? profiles[profiles.length - 1].quarter : null;
  const recent = profiles.filter((p) => p.quarter === lastQ);
  const firstQ = profiles.length ? profiles[0].quarter : null;
  const early = profiles.filter((p) => p.quarter === firstQ);
  const recentGpu = gpuFps(recent);
  const recentCpu = avgFps(recent);
  const recentMem = recent.filter(validMem);
  const typicalCommit = median(recentMem.map((p) => p.commitMaxMB));
  const typicalWs = median(recentMem.map((p) => p.wsMaxMB).filter(Boolean));
  const vramQ = vram.length ? vram[vram.length - 1].quarter : null;
  const recentVram = vram.filter((v) => v.quarter === vramQ);
  const typicalVram = median(recentVram.map((v) => v.peakMB));
  const cardMB = median(recentVram.map((v) => v.totalMB).filter(Boolean));

  root.innerHTML = `
    ${head('Performance', profiles.length ? `The game writes a frame-rate summary each time it unloads a world. Across ${b(fmt.int(hours))} hours of measured play, ${lastQ ? `you averaged ${b(fmt.fps(recentCpu))} in ${b(fmt.quarter(lastQ))}` : ''}${firstQ && firstQ !== lastQ ? `, against ${b(fmt.fps(avgFps(early)))} in ${b(fmt.quarter(firstQ))}` : ''}. ${recentGpu && recentCpu && recentGpu > recentCpu * 1.25 ? `Your GPU could have drawn ${b(fmt.fps(recentGpu))}, so the game is held back by the CPU side, not the graphics card.` : ''}` : 'No frame-rate summaries for this selection. They are written when you leave a world, so a crash or a session that never loaded in has none.')}
    <div class="tiles">
      ${tile('Average frame rate', fmt.fps(recentCpu), lastQ ? `Whole frame, ${fmt.quarter(lastQ)}` : '')}
      ${tile('GPU could deliver', fmt.fps(recentGpu), 'GPU-only frame rate (median), same period')}
      ${tile('Frames under 16 ms', fmt.pct(share(recent, 0, 1)), '60 fps or better, same period')}
      ${tile('Frames over 35 ms', fmt.pct(share(recent, 5, 9), 2), 'Visible hitches, same period')}
      ${tile('Typical memory peak', typicalCommit ? `${fmt.dec(typicalCommit / 1024)} GB` : '—', typicalWs ? `Reserved; ${fmt.dec(typicalWs / 1024)} GB actually in RAM, same period` : 'Reserved by the game, same period')}
      ${tile('Typical VRAM peak', typicalVram ? `${fmt.dec(typicalVram / 1024)} GB` : '—', typicalVram ? `${cardMB ? `of ${fmt.dec(cardMB / 1024, 0)} GB on your graphics card, ` : ''}${fmt.quarter(vramQ)}` : 'Read from the info overlay while you play (r_displayinfo 3)')}
      ${tile('Measured play', fmt.int(hours), 'hours with a frame-rate summary')}
    </div>
    <p class="note">"Whole frame" is the frame rate you actually saw. "GPU" is how fast the graphics card finished its share of each frame; when it is far above the whole-frame number, the CPU and game simulation are the limit. The game's GPU timer sometimes reports impossible values (over 1,000 fps), and some memory readings exceed what your PC can hold; both are left out.</p>
    <div class="grid">
      ${card('pf-monthly', 'Frame rate per month', 'Average frame rate you saw over all measured play in Stanton, Pyro and Nyx. Hover a month for the GPU-only number.', {wide: true})}
      ${card('pf-system', 'Frame rate by star system', 'Per quarter. Pyro and Nyx are newer and heavier than Stanton.', {legend: legend([[series(1), 'Stanton', true], [series(0), 'Pyro', true], [series(2), 'Nyx', true]])})}
      ${card('pf-hardware', 'Frame rate by hardware', 'Whole-frame average for each CPU and GPU pair; hover for the GPU-only number.')}
      ${card('pf-mix', 'Frame-time mix by patch', 'Share of frames in each frame-time band. More amber means smoother.', {wide: true, legend: legend([[series(0), 'Under 16 ms (60+ fps)'], [series(5), '16–25 ms'], [series(6), '25–35 ms'], [critical(), 'Over 35 ms (hitches)']])})}
      ${card('pf-patch', 'Average frame rate by patch', 'Whole frame, all measured play on each patch.')}
      ${card('pf-memory', 'Memory use per month', 'Typical (median) peak per world visit: memory the game reserved (commit) and actually held in RAM (working set), from Game.log. Video memory (VRAM) in use is the typical peak per session from the info overlay, so it starts with version 0.3.0 and only covers sessions with the overlay on.', {legend: legend([[series(2), 'Reserved', true], [series(3), 'In RAM', true], [series(0), 'VRAM', true]])})}
    </div>`;

  const hw = hardwareChanges(all);
  draw(root, 'pf-monthly', 260, (ctx) => {
    if (!profiles.length) return false;
    const months = monthRange(profiles[0].month, profiles[profiles.length - 1].month);
    const by = groupBy(profiles, (p) => p.month);
    lines(ctx, {cats: months, yFmt: (v) => `${Math.round(v)}`, xLabel: fmt.month, tipHead: fmt.monthLong, refs: hw.map((r) => ({cat: r.month, label: r.label})),
      series: [{name: 'Frame rate', color: series(0), get: (m) => avgFps(by.get(m) || [])}],
      tipExtra: (m) => [[null, 'GPU only (median)', fmt.fps(gpuFps(by.get(m) || []))], [null, 'Measured hours', fmt.dec(sum(by.get(m) || [], (p) => p.frames / p.wholeFps) / 3600)]]});
  });

  draw(root, 'pf-system', 240, (ctx) => {
    if (!profiles.length) return false;
    const qs = quarterRange(profiles[0].quarter, profiles[profiles.length - 1].quarter);
    const by = groupBy(profiles, (p) => `${p.quarter}|${p.dest}`);
    const colorOf = {Stanton: series(1), Pyro: series(0), Nyx: series(2)};
    lines(ctx, {cats: qs, yFmt: (v) => `${Math.round(v)}`, xLabel: fmt.quarter,
      series: WORLDS.map((w) => ({name: w, color: colorOf[w], get: (q) => avgFps(by.get(`${q}|${w}`) || [])}))});
  });

  const hwRows = [...groupBy(profiles, (p) => p.hw)].map(([k, v]) => ({k, fps: avgFps(v), gpu: gpuFps(v), hours: sum(v, (p) => p.frames / p.wholeFps) / 3600, first: v[0].s.day}))
    .filter((r) => r.hours >= 2).sort((a, c) => (a.first < c.first ? -1 : 1));
  draw(root, 'pf-hardware', () => Math.max(1, hwRows.length) * ROW_H, (ctx) => {
    if (!hwRows.length) return false;
    hbars(ctx, hwRows, {label: (r) => r.k, value: (r) => r.fps, fmt: fmt.fps, color: (r, k, i) => series(i),
      tip: (r) => [[null, 'Whole frame', fmt.fps(r.fps)], [null, 'GPU only', fmt.fps(r.gpu)], [null, 'Measured hours', fmt.dec(r.hours)], [null, 'First used', fmt.date(r.first)]]});
  });

  const patches = [...groupBy(profiles, (p) => p.s.patch)].filter(([k, v]) => k && sum(v, (p) => p.frames / p.wholeFps) > 3600).map(([k, v]) => ({k, v})).sort((a, c) => comparePatch(a.k, c.k));
  draw(root, 'pf-mix', 260, (ctx) => {
    if (!patches.length) return false;
    const bands = [['Under 16 ms', 0, 1, series(0)], ['16–25 ms', 1, 3, series(5)], ['25–35 ms', 3, 5, series(6)], ['Over 35 ms', 5, 9, critical()]];
    const val = new Map(patches.flatMap((p) => bands.map((bd) => [`${p.k}|${bd[0]}`, share(p.v, bd[1], bd[2])])));
    columns(ctx, {cats: patches.map((p) => p.k), keys: bands.map((x) => x[0]), get: (c, k) => val.get(`${c}|${k}`), color: (c, k) => bands.find((x) => x[0] === k)[3],
      yFmt: (v) => `${v}%`, xLabel: (c) => c, yMax: 100,
      tip: (c) => [`Patch ${c}`, bands.map((bd) => [bd[3], bd[0], fmt.pct(val.get(`${c}|${bd[0]}`), 1)])]});
  });

  draw(root, 'pf-patch', 240, (ctx) => {
    if (!patches.length) return false;
    const val = new Map(patches.map((p) => [p.k, avgFps(p.v)]));
    columns(ctx, {cats: patches.map((p) => p.k), keys: ['fps'], get: (c) => val.get(c), color: () => series(0), yFmt: (v) => `${v}`, xLabel: (c) => c,
      valueLabel: (c) => fmt.dec(val.get(c), 0),
      tip: (c) => {
        const p = patches.find((x) => x.k === c);
        return [`Patch ${c}`, [[null, 'Whole frame', fmt.fps(val.get(c))], [null, 'GPU only', fmt.fps(gpuFps(p.v))], [null, 'Measured hours', fmt.dec(sum(p.v, (x) => x.frames / x.wholeFps) / 3600)]]];
      }});
  });

  draw(root, 'pf-memory', 240, (ctx) => {
    const mem = profiles.filter(validMem);
    if (!mem.length && !vram.length) return false;
    const ends = [...mem.map((p) => p.month), ...vram.map((v) => v.month)].sort();
    const months = monthRange(ends[0], ends[ends.length - 1]);
    const by = groupBy(mem, (p) => p.month);
    const vramBy = groupBy(vram, (v) => v.month);
    const vramOf = (m) => (vramBy.has(m) ? median(vramBy.get(m).map((v) => v.peakMB)) / 1024 : null);
    const peak = (m, k) => {
      const v = (by.get(m) || []).map((p) => p[k]).filter(Boolean);
      return v.length ? median(v) / 1024 : null;
    };
    lines(ctx, {cats: months, yFmt: (v) => `${Math.round(v)} GB`, xLabel: fmt.month, tipHead: fmt.monthLong,
      series: [{name: 'Reserved', color: series(2), get: (m) => peak(m, 'commitMaxMB')}, {name: 'In RAM', color: series(3), get: (m) => peak(m, 'wsMaxMB')}, {name: 'VRAM', color: series(0), get: vramOf}],
      tipExtra: (m) => [[null, 'World visits', fmt.int((by.get(m) || []).length)], ...(vramBy.has(m) ? [[null, 'Sessions with VRAM', fmt.int(vramBy.get(m).length)]] : [])]});
  });
}
