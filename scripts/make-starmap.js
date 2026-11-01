'use strict';
// Builds public/data/starmap.json, the Journey map's background, from the starnav crate's data files
// (https://crates.io/crates/starnav, MIT): `node scripts/make-starmap.js <objContainers.json> <pois.json>`.
// Positions are kept in km. Stanton's positions match the overlay to the metre; Pyro's Lagrange points in that data
// are placed by rule (90% / 110% of the planet's distance, round angles) and are known to be off for Pyro III L1,
// so the map marks them as approximate.

const fs = require('fs');
const path = require('path');

const [containersFile, poisFile] = process.argv.slice(2);
if (!containersFile || !poisFile) {
  console.error('usage: node scripts/make-starmap.js <objContainers.json> <pois.json>');
  process.exit(1);
}
const containers = JSON.parse(fs.readFileSync(containersFile, 'utf8'));
const pois = JSON.parse(fs.readFileSync(poisFile, 'utf8'));

const SYSTEMS = ['Stanton', 'Pyro', 'Nyx'];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
// Planets without a proper name go by number.
const NAMES = {Pyro1: 'Pyro I', Pyro4: 'Pyro IV', Pyro5: 'Pyro V', MicroTech: 'microTech'};
// Stanton's Lagrange points are named after their planet (HUR-L1); Pyro's by number (Pyro II L4).
const SHORT = {Stanton1: 'HUR', Stanton2: 'CRU', Stanton3: 'ARC', Stanton4: 'MIC'};
// Station names the overlay's location line uses for Pyro (RR_P2_L4) and that the data doesn't place.
const PYRO_STATIONS = {Pyro2_L4: 'Checkmate', Pyro3_L1: 'Starlight Service Station'};

const km = (v) => Math.round(v) / 1000;
const codeOf = (c) => c.internal_name.replace(/^./, (ch) => ch.toUpperCase());
const out = {
  about: 'Positions in km from the starnav crate (MIT, Kenan Sulayman), as used by Star Citizen Insights. See THIRD-PARTY-NOTICES.md.',
  systems: {},
  pois: {},
};

for (const sys of SYSTEMS) {
  const list = containers.filter((c) => c.system === sys);
  const star = list.find((c) => c.cont_type === 'Star');
  const s = {
    star: star ? {name: sys, x: km(star.pos_x), y: km(star.pos_y), z: km(star.pos_z), r: km(star.body_radius) || 700000} : {name: sys, x: 0, y: 0, z: 0, r: 700000},
    bodies: [],
    lagrange: [],
    jumps: [],
  };
  for (const c of list.filter((x) => ['Planet', 'Moon'].includes(x.cont_type) && x.body_radius > 0)) {
    const code = codeOf(c);
    const m = /^([A-Za-z]+)(\d)([a-z]?)$/.exec(code);
    if (!m) continue;
    s.bodies.push({
      code, name: NAMES[c.name] || c.name, type: m[3] ? 'moon' : 'planet', parent: m[3] ? `${m[1]}${m[2]}` : null,
      x: km(c.pos_x), y: km(c.pos_y), z: km(c.pos_z), r: km(c.body_radius), om: km(c.om_radius) || null,
    });
  }
  // The source's Nyx predates the system's current layout: its one body, Delamar, sits 21,000 km from the star,
  // while Levski and Nyx's stations are tens of millions of km out. Nyx gets its star only.
  if (sys === 'Nyx') s.bodies = [];
  // A moon far from its planet is a data error (Fuego sits next to Pyro IV in the source); leave it off the map.
  s.bodies = s.bodies.filter((b) => {
    const p = b.parent && s.bodies.find((x) => x.code === b.parent);
    const ok = !p || Math.hypot(b.x - p.x, b.y - p.y) < 2e6;
    if (!ok) console.warn(`skipped ${b.name}: ${Math.round(Math.hypot(b.x - p.x, b.y - p.y)).toLocaleString('en')} km from ${p.name}`);
    return ok;
  });
  for (const c of list.filter((x) => x.cont_type === 'Lagrange')) {
    // Stanton: name "HUR-L1", internal "Stanton1_L1". Pyro: name and internal "P2_L4".
    const m = /^(?:Stanton(\d)|P(\d))_L(\d)$/.exec(c.internal_name);
    if (!m) continue;
    const planet = `${sys}${m[1] || m[2]}`;
    const code = `${planet}_L${m[3]}`;
    const p = s.bodies.find((b) => b.code === planet);
    s.lagrange.push({
      code, name: sys === 'Stanton' ? `${SHORT[planet]}-L${m[3]}` : `${sys} ${ROMAN[m[1] || m[2]]} L${m[3]}`, planet: p ? p.name : null,
      x: km(c.pos_x), y: km(c.pos_y), z: km(c.pos_z), approx: sys !== 'Stanton',
      station: sys === 'Pyro' ? PYRO_STATIONS[code] || null : null,
    });
  }
  // Stanton's stations are listed as "HUR-L1-A Station" with their names; they sit at their Lagrange point.
  for (const c of list.filter((x) => /Station$/.test(x.cont_type) || x.cont_type === 'RestStop')) {
    const m = /^(HUR|CRU|ARC|MIC)-L(\d)-A Station$/.exec(c.internal_name);
    const planet = m && Object.keys(SHORT).find((k) => SHORT[k] === m[1]);
    const l = planet && s.lagrange.find((x) => x.code === `${planet}_L${m[2]}`);
    if (l) l.station = c.name;
  }
  for (const c of list.filter((x) => x.cont_type === 'JumpPoint')) {
    const to = c.internal_name.split('_')[1];
    s.jumps.push({to, name: `${to} jump point`, x: km(c.pos_x), y: km(c.pos_y), z: km(c.pos_z)});
  }
  out.systems[sys] = s;
}

// Named places on planets and moons, in the body's own turning frame (km), as the overlay reports positions there.
// Internal names (RL_col_m_..., RastarLocationEntity-012) and minor markers are left out.
const KEEP = /^(LandingZone|Spaceport|OrbitalStation|Outpost|ColonialOutpost|ColonialBunker|DerelictOutpost|DerelictSettlement|UndergroundFacility|DistributionCenter|Scrapyard|Prison|CommArray|ForwardOperatingBase|Druglab|StashHouse|Cave|Wreck|MissionArea|Unknown)$/;
const bodyCode = new Map();
for (const sys of SYSTEMS) for (const b of out.systems[sys].bodies) bodyCode.set(`${sys}|${b.name.toLowerCase()}`, b.code);
// The POI file names a few bodies differently from the body list.
for (const c of containers) if (['Planet', 'Moon'].includes(c.cont_type)) bodyCode.set(`${c.system}|${c.name.toLowerCase()}`, codeOf(c));
let kept = 0;
for (const p of pois) {
  if (!KEEP.test(p.poi_type) || !p.obj_container || !p.name) continue;
  if (/_|Entity|^\W|\?\?\?/.test(p.name)) continue;
  const code = bodyCode.get(`${p.system}|${p.obj_container.toLowerCase()}`);
  if (!code) continue;
  const v = [p.pos_x, p.pos_y, p.pos_z].map(Number);
  if (!v.every(Number.isFinite) || Math.hypot(...v) > 20000) continue;
  (out.pois[code] = out.pois[code] || []).push([p.name.trim(), p.poi_type, ...v.map((x) => Math.round(x * 1000) / 1000)]);
  kept += 1;
}
// The same place listed twice (Grim Hex as landing zone and as station) keeps its first entry.
for (const [code, list] of Object.entries(out.pois)) {
  const seen = new Set();
  out.pois[code] = list.filter((p) => !seen.has(p[0].toLowerCase()) && seen.add(p[0].toLowerCase()));
}

const file = path.join(__dirname, '..', 'public', 'data', 'starmap.json');
fs.mkdirSync(path.dirname(file), {recursive: true});
fs.writeFileSync(file, `${JSON.stringify(out)}\n`);
const count = (k) => SYSTEMS.map((s) => `${s} ${out.systems[s][k].length}`).join(', ');
console.log(`bodies: ${count('bodies')}; Lagrange points: ${count('lagrange')}; jump points: ${count('jumps')}`);
console.log(`places on bodies: ${Object.values(out.pois).reduce((a, l) => a + l.length, 0)} (of ${kept} kept); ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
