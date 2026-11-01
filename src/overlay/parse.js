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

// "RR P2 L4 (LZ : RR P2 L4)" at a station, "GrimHEX (LZ : GrimHEX)", "Pyro3 L1" or "PyroSolarSystem" in space.
function playerLocation(text) {
  const v = text.replace(/^.*?locat\S*\s*[:.]?\s*/i, '');
  let m;
  if ((m = /RR\W*P\W*(\d)\W*[L1I|]\W*(\d)/i.exec(v))) return `RR_P${m[1]}_L${m[2]}`;
  if (/Gr[il1|]?[mn]\s*HEX/i.test(v)) return 'GrimHEX';
  if ((m = /(Stanton|Pyro|Nyx)\s*(\d[a-z]?)\s*_?\s*(Lorville|Area\s*18|New\s*Babbage|Orison|Levski)/i.exec(v))) return `${m[1]}${m[2]}_${m[3].replace(/\s/g, '')}`;
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

// ---------- where you are
// The overlay's top rows are a stack of zones, innermost first, each with your position in it:
//   Zone: RSI_Constellation_Mk5_Centaurus_911428487496 Pos: -1.30m 41.74m -0.01m     inside your ship
//   Zone: OOC_Stanton_2c_Yela Pos: -568.7154km 383.5623km -2033.96m                    from Yela's centre, turning with it
//   Zone: SolarSystem_863673139739 Pos: -19023288.3077km -2614573.4443km -2293.63m     in the star system
//   Zone: Root Pos: -19023288.3077km -2614573.4443km -2293.63m                         the same numbers again
// Distances print in km with four decimals, or in m with two under 10 km. OCR turns minus signs into dashes, "=",
// "<" or a bullet and garbles a digit now and then, so a number only counts with the right decimals and with
// nothing unreadable between it and the one before; the system position is checked against its second copy.
const ZONE_ROW = /Zone\s*[:;]|P[o0]s\s*[:.;,i"„]|\d[.,]\d{4}\s?km/i;
const SYSTEMS = {s: 'Stanton', p: 'Pyro', n: 'Nyx', c: 'Castra'};
const BODIES = {
  hurston: 'Stanton1', arial: 'Stanton1a', aberdeen: 'Stanton1b', magda: 'Stanton1c', ita: 'Stanton1d',
  crusader: 'Stanton2', cellin: 'Stanton2a', daymar: 'Stanton2b', yela: 'Stanton2c',
  arccorp: 'Stanton3', lyria: 'Stanton3a', wala: 'Stanton3b', microtech: 'Stanton4', calliope: 'Stanton4a', clio: 'Stanton4b', euterpe: 'Stanton4c',
  monox: 'Pyro2', bloom: 'Pyro3', terminus: 'Pyro6', ignis: 'Pyro5a', vatra: 'Pyro5b', adir: 'Pyro5c', fairo: 'Pyro5d', fuego: 'Pyro5e', vuur: 'Pyro5f',
  delamar: 'Nyx1',
};
const MAKERS = /^\W*(RSI|AEGS|ANVL|ARGO|BANU|CNOU|CRUS|DRAK|ESPR|GAMA|GRIN|KRIG|MISC|MRAI|ORIG|TMBL|VNCL|XIAN|XNAA|Aegis|Anvil|Origin|Drake|Mirai)\b/i;
const SYS_ZONE = /System|stem_|Root|^\W*oot\b/i;
// ("oot" is Root with its R lost, but "oot Stanton 2c Yela" is OOC_Stanton_2c_Yela.)
const isSystemZone = (name) => SYS_ZONE.test(name) && !bodyOf(name) && !lagrangeOf(name);

// Up to three distances in km from the text after a zone's name; null where one couldn't be read.
function distances(text) {
  const s = text.replace(/[–—=~<]/g, '-').replace(/[•·]/g, ' ').replace(/(?<=\d)[lI|](?=\d)/g, '1').replace(/(?<=\d)[Oo](?=\d)/g, '0');
  const re = /(-?)\s*(\d+)[.,](\d+)\s?(km|m)(?![a-z])/gi;
  const out = [null, null, null];
  let end = -1;
  let m;
  for (let i = 0; i < 3 && (m = re.exec(s)); i += 1) {
    const before = s.slice(end < 0 ? 0 : end, m.index);
    // Between two numbers there's only space; before the first, the label's punctuation, not part of a number
    // we couldn't read ("Post -26j3662.5260km" is -2613662.5260 with the 1 misread).
    if (end >= 0 ? /[^\s-]/.test(before) : /[\dÀ-ɏ]|[A-Za-z]-?$/.test(before)) break;
    const km = m[4].toLowerCase() === 'km';
    if (m[3].length === (km ? 4 : 2)) out[i] = Number(`${m[1]}${m[2]}.${m[3]}`) / (km ? 1 : 1000);
    end = m.index + m[0].length;
  }
  return out;
}

function bodyOf(name) {
  const word = (name.toLowerCase().match(/[a-z]+/g) || []).find((w) => BODIES[w]);
  if (word) return BODIES[word];
  // (A digit followed by more digits is an id, as in "Hangar_LargeTop_RestStop_Pyro 862143775348".)
  const m = /(St\w{2,4}on|Pyr[o0d]|Nyx|Castra)[\s_¯-]*(\d)(?!\d)(?:[\s_¯-]*([a-f])(?![a-z]))?/i.exec(name);
  return m ? `${SYSTEMS[m[1][0].toLowerCase()]}${m[2]}${(m[3] || '').toLowerCase()}` : null;
}

// Pyro's Lagrange zones read "P2 L4"; Stanton's "HUR-L1" or "Stanton1_L1".
function lagrangeOf(name) {
  const n = (c) => ({I: '1', l: '1', '|': '1', A: '4'}[c] || c);
  let m;
  if ((m = /\bP\s*([1-6])[\s_-]*L\s*([1-5IlA|])\b/.exec(name))) return `Pyro${m[1]}_L${n(m[2])}`;
  if ((m = /\b(HUR|CRU|ARC|MIC)[\s_-]*L\s*([1-5Il|])\b/i.exec(name))) return `Stanton${{HUR: 1, CRU: 2, ARC: 3, MIC: 4}[m[1].toUpperCase()]}_L${n(m[2])}`;
  if ((m = /Stanton\s*([1-4])[\s_-]*L\s*([1-5Il|])\b/i.exec(name))) return `Stanton${m[1]}_L${n(m[2])}`;
  return null;
}

// "jumppoint_pyro_stanton" in Pyro, "OOC_JumpPoint_stanton_pyro" on the Stanton side: here first, then there.
function jumpOf(name) {
  const sys = (w) => (/^\w?tanton$/i.test(w) ? 'Stanton' : /^p\w?ro$/i.test(w) ? 'Pyro' : /^nyx$/i.test(w) ? 'Nyx' : /^castra$/i.test(w) ? 'Castra' : null);
  const m = /jump\s*poi\w*?[^a-z]*(p\w?ro|\w?tanton|nyx|castra)[^a-z]*(p\w?ro|\w?tanton|nyx|castra)/i.exec(name);
  return m && sys(m[1]) && sys(m[2]) ? {from: sys(m[1]), to: sys(m[2])} : null;
}

// A place or zone name that says which star system it's in: Nyx_TSG_QVExtractionStation_016,
// AsteroidClusterBase_Nyx_Social_Keeger_001, Stanton1_Lorville, PyroSolarSystem, RR_P2_L4 (Pyro's stations),
// GrimHEX.
function systemOfPlace(name) {
  const s = String(name || '');
  const m = /(?:^|[\s_¯-])(Stanton|Pyro|Nyx|Castra)(?=$|[\s_¯\d-]|SolarSystem)/i.exec(s);
  if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  if (/^RR_P\d_/i.test(s)) return 'Pyro';
  if (/^RR_(HUR|CRU|ARC|MIC)_/i.test(s) || /Gr[il1|]?[mn]\s*HEX/i.test(s)) return 'Stanton';
  return null;
}

const close = (a, b) => a != null && b != null && Math.abs(a - b) < 0.0005;

function whereabouts(list) {
  const stack = [];
  for (const r of list) {
    if (!ZONE_ROW.test(r.text)) {
      if (stack.length) break;
      continue;
    }
    const label = /Zone\s*[:;]?\s*/i.exec(r.text);
    const rest = label ? r.text.slice(label.index + label[0].length) : r.text;
    const cut = rest.search(/P[o0]s\s*\S?|-?\s*\d+[.,]\d+\s?k?m/i);
    stack.push({name: (cut < 0 ? rest : rest.slice(0, cut)).trim(), d: distances(cut < 0 ? '' : rest.slice(cut).replace(/^P[o0]s/i, ''))});
  }
  if (!stack.length) return {};
  const out = {};
  const copies = stack.filter((z) => isSystemZone(z.name) && z.d[0] != null && z.d[1] != null).map((z) => z.d);
  const agree = copies.find((c, i) => copies.some((o, j) => j !== i && close(c[0], o[0]) && close(c[1], o[1])));
  if (agree) {
    out.pos = [agree[0], agree[1], copies.map((c) => c[2]).find((z, i) => z != null && copies.some((o, j) => j !== i && close(z, o[2]))) ?? agree[2]];
    out.posCheck = 2;
  } else if (copies.length) {
    out.pos = copies[0];
    out.posCheck = copies.length === 1 ? 1 : 0;
    if (copies.length > 1) out.pos2 = copies[1];
  }
  // The zone just inside the star system says where you are: a planet or moon, a Lagrange point, a jump point.
  for (const z of stack.filter((x) => !isSystemZone(x.name))) {
    const body = bodyOf(z.name) || lagrangeOf(z.name);
    const jump = !body && jumpOf(z.name);
    if (/Jump\s*Tunn/i.test(z.name)) out.tunnel = true;
    if (jump) {
      out.body = `JP_${jump.from}_${jump.to}`;
      out.system = jump.from;
      if (out.tunnel) out.jumpTo = jump.to;
    }
    if (body) {
      out.body = body;
      out.system = /^[A-Z][a-z]+/.exec(body)[0];
    }
    if ((body || jump) && z.d[0] != null && z.d[1] != null) out.local = z.d;
    else if (body || jump) delete out.local;
  }
  // Planets, moons and Lagrange points sit at height 0, so your height above the system plane is the same in both
  // frames: when the copies disagree on it, the one matching the body's frame is right.
  if (out.pos && out.local && out.local[2] != null && !close(out.pos[2], out.local[2])) {
    const z = copies.map((c) => c[2]).find((v) => close(v, out.local[2]));
    if (z != null) out.pos[2] = z;
  }
  // The main menu has a star system of its own, with you at its centre.
  if (out.pos && Math.hypot(out.pos[0], out.pos[1]) < 100) {
    for (const k of ['pos', 'pos2', 'posCheck']) delete out[k];
  }
  // Away from planets and Lagrange points (Nyx's asteroid bases, say) a station's or hangar's zone may still
  // name the system.
  if (!out.system) out.system = stack.map((z) => systemOfPlace(z.name)).find(Boolean) || undefined;
  if (!out.system) delete out.system;
  const inner = stack[0].name;
  if (MAKERS.test(inner) && !bodyOf(inner)) {
    const ship = inner.replace(/[_¯]/g, ' ').replace(/\s*\d{6,}\S*.*$/, '').replace(/\s+/g, ' ').trim();
    if (/^[A-Za-z]{3,5} [A-Za-z0-9 -]{3,40}$/.test(ship)) out.ship = ship;
  }
  const round = (v) => (v == null ? null : Math.round(v * 10000) / 10000);
  for (const k of ['pos', 'pos2', 'local']) if (out[k]) out[k] = out[k].map(round);
  return out;
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

  // "VRAM(MB): 12071 / 31419": video memory in use and on the card. Game.log has no figure for this.
  const vram = find(/VRAM\s*\(?\s*MB/i);
  if (vram) {
    const m = /MB\s*\)?\s*[:;]?\s*(\d{3,6})\s*[/|]\s*(\d{4,6})/i.exec(digits(vram));
    if (m && Number(m[1]) <= Number(m[2])) {
      out.vramMB = Number(m[1]);
      out.vramTotalMB = Number(m[2]);
    }
  }
  // "Working Set (OS): 27.06 GiB Committed (OS): 42.57 GiB": the game's memory actually in RAM, and reserved.
  const mem = find(/Working\s*Set|Committed\s*\(/i);
  if (mem) {
    const s = digits(mem);
    const gib = (re) => {
      const m = re.exec(s);
      return m ? Math.round(Number(m[1].replace(',', '.')) * 1024) : null;
    };
    // (GiB sometimes comes back as "%iB".)
    const ws = gib(/Set\s*\(\s*[O0][S5]\s*\)\s*[:;]?\s*(\d+[.,]\d{2})\s*[G%]/i);
    const commit = gib(/Committed\s*\(\s*[O0][S5]\s*\)\s*[:;]?\s*(\d+[.,]\d{2})\s*[G%]/i);
    if (ws != null) out.wsMB = ws;
    if (commit != null && (ws == null || commit >= ws)) out.commitMB = commit;
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
  Object.assign(out, whereabouts(list));
  if (!out.system && out.planet) out.system = /^[A-Z][a-z]+/.exec(out.planet)[0];
  if (!out.system && loc) out.system = systemOfPlace(out.location) || systemOfPlace(loc.replace(/^.*?locat\S*\s*[:.]?\s*/i, '')) || undefined;
  if (!out.system) delete out.system;

  // Throw away numbers that can't be right.
  // Game servers run at up to 30 fps; anything far above that is a frame time read as fps.
  if (out.serverFps != null && !(out.serverFps > 0 && out.serverFps <= 60)) for (const k of FRAMES) delete out[k];
  if (out.clientFps != null && !(out.clientFps > 0 && out.clientFps <= 1000)) delete out.clientFps;
  if (out.vramTotalMB != null && !(out.vramTotalMB >= 1024 && out.vramTotalMB <= 262144)) for (const k of ['vramMB', 'vramTotalMB']) delete out[k];
  for (const k of ['wsMB', 'commitMB']) if (out[k] != null && !(out[k] >= 256 && out[k] <= 1048576)) delete out[k];
  if (out.pingMs != null && !(out.pingMs >= 0 && out.pingMs < 1500)) delete out.pingMs;
  if (out.lossPct != null && !(out.lossPct >= 0 && out.lossPct <= 100)) delete out.lossPct;
  if (out.playersShard != null && !(out.playersShard > 0 && out.playersShard <= 5000)) delete out.playersShard;
  if (out.playersServer != null && (!(out.playersServer > 0 && out.playersServer <= 2000) || (out.playersShard != null && out.playersServer > out.playersShard))) delete out.playersServer;
  out.ok = ['serverFps', 'server', 'shard', 'playersServer', 'pingMs', 'pos'].some((k) => out[k] != null);
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

module.exports = {parseOverlay, parseCapture, fillFrom, rows, fixShard, planetCode, systemOfPlace};
