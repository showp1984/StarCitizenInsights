'use strict';
// Turns OCR'd lines of the r_displayinfo overlay into numbers. OCR of the small overlay font makes the same
// mistakes again and again (O for 0, l for 1, a closing bracket read as 1, ms read as % or ns, underscores lost),
// and the overlay always prints one decimal place, so the patterns below are deliberately forgiving. In a ship
// the vehicle name banner covers the left part of the server lines, so labels like "Server" or "pop. [shard"
// are often missing and rows are found by their order instead.

// Rows the OCR splits (colored segments, wide gaps) share a height; rejoin them left to right.
function rowList(lines) {
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  for (const l of sorted) {
    const row = out.length && Math.abs(out[out.length - 1].y - l.y) <= 4 ? out[out.length - 1] : null;
    if (row) row.parts.push(l);
    else out.push({y: l.y, parts: [l]});
  }
  return out.map((r) => ({y: r.y, text: r.parts.sort((a, b) => a.x - b.x).map((p) => p.text).join(' ')}));
}
const rows = (lines) => rowList(lines).map((r) => r.text);

// Fixes letters that stand in for digits inside numbers.
const digits = (s) => s
  .replace(/(?<=\d|\b)[Oo](?=[\d.,\s\]\)]|$)/g, '0')
  .replace(/(?<=\d[.,]\s?)[Oo](?=\s*m)/g, '0')
  .replace(/(?<=\d)[lI|](?=\d)/g, '1');
const num = (s) => (s == null ? null : Number(String(s).replace(/[Oo]/g, '0').replace(/[lI|]/g, '1')));
const dec = (s) => (s == null ? null : Number(s.replace(/\s/g, '').replace(',', '.')));
// The overlay prints one decimal; OCR may glue a bracket or % on as an extra digit.
const oneDecimal = (s) => {
  const m = /(\d+)[.,](\d)/.exec(s || '');
  return m ? Number(`${m[1]}.${m[2]}`) : null;
};
const perSecond = (frameMs) => (frameMs > 0 ? Math.round(10000 / frameMs) / 10 : null);
const near = (a, b) => Math.abs(a - b) <= Math.max(0.6, 0.08 * b);

const FRAMES = ['serverFps', 'serverFpsMin', 'serverFpsMax'];
// "Server: pub-euw1b-sc-alpha-4102-12974691-game-177, restarts 0, pop. [shard 118, srv 4]", or what's left of it.
const SERVER_ROW = /game-\s*[\dlI|]|game-\s*,|restarts|pop\.\s*[\[(]?\s*shard|[sg]rv\s*\d/i;

function fixShard(raw) {
  const t = raw.replace(/[^A-Za-z0-9_ -]/g, ' ').trim().split(/[\s_-]+/).filter(Boolean);
  const i = t.findIndex((x) => /^(pub|ptu|eptu|tech|hotfix)$/i.test(x));
  if (i < 0 || t.length < i + 4) return null;
  const env = t[i].toLowerCase();
  // Region codes look like use1b, euw1b, apse2a: letters, one digit, one letter.
  const region = t[i + 1].toLowerCase().replace(/[li|](?=[a-z]$)/, '1');
  const build = t[i + 2].replace(/[Oo]/g, '0').replace(/[lI]/g, '1');
  const n = t[i + 3].replace(/[Oo]/g, '0').replace(/[lI]/g, '1');
  if (!/^[a-z]{2,5}\d[a-z]$/.test(region) || !/^\d{6,}$/.test(build) || !/^\d{1,4}$/.test(n)) return null;
  return `${env}_${region}_${build}_${n}`;
}

// "Server FPS 11.1 [10.4..12.0] - 89.7ms [83.2..96.3], Hitches: 0": the frame times are the same numbers as
// 1000/fps (the low fps is the longest frame), so either half can stand in for the other. Only a half that backs
// itself up counts: both halves agreeing, a value inside its own range, or, failing those, a labelled fps.
function serverFrames(text) {
  const s = digits(text);
  const groups = [...s.matchAll(/(\d+[.,]\s?\d)\s*(m\S?|r?n\S|%)?\s*(?:[\[(]\s*(\d+[.,]\s?\d)?(?:\s*[.,]\s*[.,]?\s*(\d+[.,]\s?\d))?)?/g)]
    .map((m) => ({v: dec(m[1]), unit: !!m[2], lo: dec(m[3]), hi: dec(m[4]), at: m.index}));
  const fpsAt = s.search(/FPS/i);
  let ms = groups.find((g) => g.unit);
  const fps = groups.find((g) => g !== ms && !g.unit && (fpsAt < 0 || g.at > fpsAt) && (!ms || g.at < ms.at));
  if (!ms && fps && groups.length > groups.indexOf(fps) + 1) ms = groups[groups.indexOf(fps) + 1];
  const asFps = ms && {v: perSecond(ms.v), lo: ms.hi == null ? null : perSecond(ms.hi), hi: ms.lo == null ? null : perSecond(ms.lo)};
  const inRange = (g) => g && g.lo != null && g.hi != null && g.lo <= g.v + 0.05 && g.v <= g.hi + 0.05;
  const labelled = /FPS\s*[:;]?\s*\d+[.,]\s?\d/i.test(s);
  const out = {};
  if (fps && asFps && near(fps.v, asFps.v)) {
    // Both halves agree; each end of the range may still be misread on one side.
    const end = (a, b, ok) => (a != null && b != null && near(a, b) ? a : [a, b].find((x) => x != null && ok(x)) ?? null);
    out.serverFps = fps.v;
    out.serverFpsMin = end(fps.lo, asFps.lo, (x) => x <= fps.v + 0.05);
    out.serverFpsMax = end(fps.hi, asFps.hi, (x) => x >= fps.v - 0.05 && x <= fps.v * 1.5 + 1);
  } else {
    const use = inRange(fps) ? fps : inRange(asFps) ? asFps : fps && labelled ? fps : null;
    if (use) {
      out.serverFps = use.v;
      if (use.lo != null && use.lo <= use.v + 0.05) out.serverFpsMin = use.lo;
      if (use.hi != null && use.hi >= use.v - 0.05 && use.hi <= use.v * 1.5 + 1) out.serverFpsMax = use.hi;
    }
  }
  const h = /ches\s*[:;]\s*([0-9Oo]+)/i.exec(text);
  if (h) out.hitches = num(h[1]);
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return out;
}

// Second look at the same capture with only colored text kept (reader.ps1, threshold -1). The server fps line
// turns yellow or orange when the server struggles, which is when it's hardest to read over the ship banner.
// It comes back in fragments, so only the server fps row and your own fps are taken from it.
function fromColored(out, list, colored) {
  const rowsC = rowList(colored);
  const iServer = list.findIndex((r) => SERVER_ROW.test(r.text));
  const gaps = list.slice(1).map((r, i) => r.y - list[i].y).filter((g) => g > 6).sort((a, b) => a - b);
  const step = gaps.length ? gaps[gaps.length >> 1] : 13;
  let row = rowsC.find((r) => /ver\s*FPS|Hit\s*ches|[a-z]ches\s*[:;]/i.test(r.text));
  if (!row && iServer >= 0) row = rowsC.find((r) => Math.abs(r.y - (list[iServer].y - step)) <= 5);
  if (row && out.serverFps == null) Object.assign(out, serverFrames(row.text));
  if (out.clientFps == null) {
    const top = rowsC.find((r) => /^\W*FPS/i.test(r.text) && (!row || r.y < row.y - 5));
    const v = top ? clientFps(top.text) : null;
    if (v != null) out.clientFps = v;
  }
}

// "FPS 162.2 [30..179], - 6.3ms [6.1ms]" (your own frame rate)
function clientFps(text) {
  const s = digits(text);
  let m = /FPS\s*[:;]?\s*(\d+[.,]\d)\s*[\[(]/i.exec(s);
  if (m) return dec(m[1]);
  m = /(\d+[.,]\s?\d)\s*m\S?\s*[\[(]/i.exec(s);
  return m ? perSecond(dec(m[1])) : null;
}

// "RR P2 L4 (LZ : RR P2 L4)" at a station, "Pyro3 L1" or "PyroSolarSystem" in space.
function playerLocation(text) {
  const v = text.replace(/^.*?locat\S*\s*[:.]?\s*/i, '');
  let m;
  if ((m = /RR\W*P\W*(\d)\W*[L1I|]\W*(\d)/i.exec(v))) return `RR_P${m[1]}_L${m[2]}`;
  if ((m = /(Pyr[o0]|Stanton|Nyx|Castra)\s*([0-9])\s*L\s*([0-9lI|])/i.exec(v))) return `${m[1].replace(/0$/, 'o')}${m[2]}_L${num(m[3])}`;
  if ((m = /(Pyr[o0]|Stanton|Nyx|Castra)\s*Solar/i.exec(v))) return `${m[1].replace(/0$/, 'o')}SolarSystem`;
  return null;
}

// "Planet: pyro5 (Load Complete)", or in Stanton "Planet: OOC_Stanton_2c_Yela (working)": the nearest body as
// system, number and moon letter (Pyro5, Stanton2c). Anything else is a misread.
function planetCode(text) {
  const v = text.replace(/^\s*Planet\s*:\s*/i, '').replace(/\s*\(?\s*(working|Load\s*Compl|Unloaded)[\s\S]*$/i, '').replace(/\s*\(.*$/, '');
  const m = /([Ss]t?anton|[Pp]yr[o0d]|[Nn]yx|[Cc]astra)[\s_]*(\d)(?:([a-z])(?![a-z]))?/.exec(v);
  if (!m) return null;
  return `${{s: 'Stanton', p: 'Pyro', n: 'Nyx', c: 'Castra'}[m[1][0].toLowerCase()]}${m[2]}${m[3] || ''}`;
}

// `colored`: the OCR lines of the colored-text pass, when the monitor asked for one.
function parseOverlay(lines, colored) {
  const list = rowList(lines);
  const text = list.map((r) => r.text);
  const index = (re) => text.findIndex((r) => re.test(r));
  const find = (re) => text.find((r) => re.test(r)) || null;
  const out = {};

  const iShard = index(/Shard\s*[Il1|]?\s*d|Session\s*:/i);
  const shard = find(/Shard\s*[Il1|]?\s*d/i);
  if (shard) out.shard = fixShard(shard.replace(/^.*?Shard\s*[Il1|]?\s*d\s*[:;.]?/i, ''));

  // "Server: pub-euw1b-sc-alpha-4102-12974691-game-177, restarts 0, pop. [shard 118, srv 4]"
  const iServer = index(SERVER_ROW);
  if (iServer >= 0) {
    const s = digits(text[iServer]);
    let m;
    // The number may come back with letters for digits: "game-llgv" is game-119.
    if ((m = /game-\s*([0-9lI|Oog]{1,4})(?![a-z])/i.exec(s)) || (m = /game-\s*([0-9lI|Oog]{2,4})/i.exec(s))) {
      const n = m[1].replace(/[lI|]/g, '1').replace(/[Oo]/g, '0').replace(/g/g, '9');
      if (/^\d+$/.test(n)) out.server = `game-${n}`;
    }
    if ((m = /restarts\s*([0-9]+)/i.exec(s))) out.restarts = num(m[1]);
    if ((m = /shard\s*([0-9]+)/i.exec(s))) out.playersShard = num(m[1]);
    else if ((m = /(\d{2,})\s*,\s*[sg]rv/i.exec(s)) && !/restarts\s*$/i.test(s.slice(0, m.index))) out.playersShard = num(m[1]);
    // The count is followed by "]", which OCR often turns into a trailing 1: "srv 191" is 19.
    if ((m = /[sg]rv\s*[:;]?\s*([0-9OoIl|]+)(.?)/i.exec(s))) {
      let v = String(num(m[1]));
      if (v.length >= 2 && v.endsWith('1') && !/[\])}J]/.test(m[2])) v = v.slice(0, -1);
      out.playersServer = Number(v);
    }
    if ((m = /(?:pub|ptu)-([a-z]{2,5}[0-9li][a-z])-/i.exec(s))) out.serverRegion = m[1].toLowerCase().replace(/[li](?=[a-z]$)/, '1');
  }

  // The server fps row sits right above the server row; its "Server" label is often unreadable.
  let iFps = index(/ver\s*FPS|Hitch|[a-z]ches\s*[:;]/i);
  if (iFps < 0 && iServer > 0 && iServer - 1 > iShard && /FPS|\d[.,]\s?\d\s*\S{0,3}\s*[\[(]\s*\d+[.,]\d/i.test(text[iServer - 1]) &&
      !/Phys|Stall|Session|Shard/i.test(text[iServer - 1])) iFps = iServer - 1;
  // (If the OCR merged it with the server row, only the part before the server name counts.)
  if (iFps >= 0) Object.assign(out, serverFrames(text[iFps].split(/Server\s*:|pub[-,]/i)[0]));

  // Your own fps is the first FPS row, above the session and shard rows.
  const top = iShard >= 0 ? iShard : iFps >= 0 ? iFps : text.length;
  const iClient = text.slice(0, top).findIndex((r) => /FPS|\d[.,]\s?\d\s*m\S?\s*[\[(]\s*\d+[.,]\s?\d\s*[m%h]/i.test(digits(r)));
  if (iClient >= 0 && iClient !== iFps) {
    const v = clientFps(text[iClient]);
    if (v != null) out.clientFps = v;
  }

  if (colored && (out.serverFps == null || out.clientFps == null)) fromColored(out, list, colored);

  // "Net: ping 26.8ms, loss 0.0% BwIn 637.280kbps, BwOut 128.321kbps"
  const net = find(/Net\s*\W?\s*[:;"]|[pi]?ing\s*\d/i);
  if (net) {
    const s = digits(net);
    let m;
    if ((m = /(?:ping|ing)\s*[:;]?\s*(\d+(?:[.,]\d)?)/i.exec(s))) out.pingMs = oneDecimal(m[1]) ?? num(m[1]);
    if ((m = /loss\s*[:;]?\s*(\d+[.,]\d+)/i.exec(s))) out.lossPct = oneDecimal(m[1]);
    else if ((m = /ms,\s*\S+\s+(\d[.,]\d+)/i.exec(s))) out.lossPct = oneDecimal(m[1]);
    if ((m = /Bw\s*[Il1]n\s*[:;]?\s*(\d+[.,]\d+)/i.exec(s))) out.bwInKbps = Math.round(Number(m[1].replace(',', '.')));
    if ((m = /Bw\s*[O0]ut\s*[:;]?\s*(\d+[.,]\d+)/i.exec(s))) out.bwOutKbps = Math.round(Number(m[1].replace(',', '.')));
  }

  // "RL: entities: 34154, tick: 0.36ms, MTSync: 0.53ms" (replication layer)
  const rl = find(/RL\s*[:;]\s*entit/i);
  if (rl) {
    const s = digits(rl);
    let m;
    if ((m = /entities\s*[:;]?\s*(\d+)/i.exec(s))) out.rlEntities = num(m[1]);
    if ((m = /tick\s*[:;]?\s*(\d+[.,]\d+)/i.exec(s))) out.rlTickMs = Number(m[1].replace(',', '.'));
  }

  const loc = find(/Current\s*p\S*\s*a?\s*ye?\s*r\s*\S*\s*locat|player\s*locat/i);
  if (loc) {
    const v = playerLocation(loc);
    if (v) out.location = v;
  }
  const planet = find(/^\s*Planet\s*:/i);
  if (planet) {
    const p = planetCode(planet);
    if (p) out.planet = p;
  }

  // Throw away numbers that can't be right.
  // Game servers run at up to 30 fps; anything far above that is a frame time read as fps.
  if (out.serverFps != null && !(out.serverFps > 0 && out.serverFps <= 60)) for (const k of FRAMES) delete out[k];
  if (out.clientFps != null && !(out.clientFps > 0 && out.clientFps <= 1000)) delete out.clientFps;
  if (out.pingMs != null && !(out.pingMs >= 0 && out.pingMs < 1500)) delete out.pingMs;
  if (out.lossPct != null && !(out.lossPct >= 0 && out.lossPct <= 100)) delete out.lossPct;
  if (out.playersShard != null && !(out.playersShard > 0 && out.playersShard <= 5000)) delete out.playersShard;
  if (out.playersServer != null && (!(out.playersServer > 0 && out.playersServer <= 2000) || (out.playersShard != null && out.playersServer > out.playersShard))) delete out.playersServer;
  out.ok = ['serverFps', 'server', 'shard', 'playersServer', 'pingMs'].some((k) => out[k] != null);
  return out;
}

// Fields a reading should have; a capture missing any gets another look.
const WANTED = ['serverFps', 'server', 'playersServer', 'pingMs', 'clientFps'];
// Lines only the overlay has: when none of them is there, the overlay is off and another look won't help.
const OVERLAY_MARKS = /CamDir|Zone\s*:|Session\s*:|Shard\s*[Il1|]?\s*d|ServerTime|UniverseTime|Working\s*Set/i;

// Takes what `out` is missing from another look at the same capture. The fps range only comes along with the
// fps it belongs to.
function fillFrom(out, other) {
  for (const [k, v] of Object.entries(other)) {
    if (k === 'ok' || v == null || out[k] != null || FRAMES.includes(k)) continue;
    out[k] = v;
  }
  if (out.serverFps == null && other.serverFps != null) for (const k of FRAMES) if (other[k] != null) out[k] = other[k];
  out.ok = !!(out.ok || other.ok);
  return out;
}

// Reads one capture. When fields are missing, takes a second look with only colored text kept, then a third
// with the HUD behind the text painted out (see reader.ps1). `again(threshold)` OCRs the capture once more and
// resolves to its lines, or null.
async function parseCapture(lines, again) {
  const missing = (p) => WANTED.filter((k) => p[k] == null);
  let out = parseOverlay(lines);
  out.passes = 1;
  if (!missing(out).length || !OVERLAY_MARKS.test(rows(lines).join('\n'))) return out;
  const colored = await again(-1);
  if (colored) out = {...parseOverlay(lines, colored), passes: 2};
  if (missing(out).some((k) => k !== 'clientFps')) {
    const shadowed = await again(-2);
    if (shadowed) fillFrom(out, parseOverlay(shadowed, colored || undefined));
    out.passes = 3;
  }
  return out;
}

module.exports = {parseOverlay, parseCapture, fillFrom, rows, fixShard, planetCode};
