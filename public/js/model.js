// Data preparation and shared aggregations over session records from /api/data.

export const ms = (t) => Date.parse(`${t.slice(0, 19)}Z`);
export const toLocal = (s, t) => new Date(ms(t) + (s.offsetHours || 0) * 3600000).toISOString().slice(0, 19);
export const quarterOf = (d) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

export function median(v) {
  if (!v.length) return null;
  const a = [...v].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
export function quantile(v, p) {
  if (!v.length) return null;
  const a = [...v].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))];
}
export const sum = (v, f = (x) => x) => v.reduce((a, x) => a + (f(x) || 0), 0);
export function countBy(v, f) {
  const m = new Map();
  for (const x of v) {
    const k = f(x);
    if (k == null) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
export function groupBy(v, f) {
  const m = new Map();
  for (const x of v) {
    const k = f(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function monthRange(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ly, lm] = to.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
export function quarterRange(from, to) {
  const out = [];
  let [y, q] = [Number(from.slice(0, 4)), Number(from.slice(6))];
  const [ly, lq] = [Number(to.slice(0, 4)), Number(to.slice(6))];
  while (y < ly || (y === ly && q <= lq)) {
    out.push(`${y}-Q${q}`);
    q += 1;
    if (q > 4) { q = 1; y += 1; }
  }
  return out;
}

export const patchKey = (p) => (p || '').split('.').map(Number);
export const comparePatch = (a, b) => patchKey(a)[0] - patchKey(b)[0] || patchKey(a)[1] - patchKey(b)[1];

export function prepare(raw) {
  for (const s of raw.sessions) {
    s.key = s.id || s.start;
    s.local = s.localStart || s.start;
    s.day = s.local.slice(0, 10);
    s.month = s.local.slice(0, 7);
    s.quarter = quarterOf(s.local);
    s.hours = s.minutes / 60;
    if (s.current && s.exit === 'no-shutdown') s.exit = 'running';
    s.unclean = s.exit === 'crash' || s.exit === 'no-shutdown';
    s.isLive = s.env === 'LIVE';
    s.driverShort = s.driver && /^\d/.test(s.driver) ? s.driver.split('.').slice(0, 2).join('.') : null;
    s.crashType = s.exit === 'crash' ? s.crash.type : s.exit === 'no-shutdown' ? 'No crash report (froze or was closed)' : null;
  }
  raw.sessions.sort((a, b) => (a.start < b.start ? -1 : 1));
  return raw;
}

export function filterSessions(all, {env, period}) {
  let out = all;
  if (env === 'LIVE') out = out.filter((s) => s.isLive);
  else if (env === 'PTU') out = out.filter((s) => !s.isLive);
  if (period !== 'all') {
    const cutoff = new Date(Date.now() - Number(period) * 86400000).toISOString().slice(0, 19);
    out = out.filter((s) => s.local >= cutoff);
  }
  return out;
}

// First session showing a new CPU or GPU, across all logs (not just the filtered ones).
export function hardwareChanges(all) {
  const out = [];
  let cpu = null;
  let gpu = null;
  for (const s of all) {
    if (s.cpu && cpu && s.cpu !== cpu) out.push({day: s.day, month: s.month, quarter: s.quarter, label: s.cpu, part: 'CPU'});
    if (s.gpu && gpu && s.gpu !== gpu) out.push({day: s.day, month: s.month, quarter: s.quarter, label: s.gpu, part: 'GPU'});
    cpu = s.cpu || cpu;
    gpu = s.gpu || gpu;
  }
  return out;
}

export function sessionMonths(sessions) {
  if (!sessions.length) return [];
  return monthRange(sessions[0].month, sessions[sessions.length - 1].month);
}

// ---- combat helpers
export const KILL_GROUPS = [
  {key: 'ship-npc', domain: 'ship', who: 'npc', label: 'Ship vs NPC'},
  {key: 'ship-player', domain: 'ship', who: 'player', label: 'Ship vs player'},
  {key: 'foot-npc', domain: 'foot', who: 'npc', label: 'On foot vs NPC'},
  {key: 'foot-player', domain: 'foot', who: 'player', label: 'On foot vs player'},
];

export function combatEvents(sessions) {
  const kills = [];
  const deaths = [];
  for (const s of sessions) {
    for (const k of s.kills) kills.push({...k, s, local: toLocal(s, k.t)});
    for (const d of s.deaths) deaths.push({...d, s, local: toLocal(s, d.t)});
  }
  return {kills, deaths};
}

const NPC_GROUPS = [
  [/Criminal-(Pilot|Gunner)|_Pilot|Pilots-/i, 'Pirate and criminal ship crews'],
  [/ASD/i, 'ASD facility security'],
  [/Contestedzone/i, 'Contested zone defenders'],
  [/Vanduul/i, 'Vanduul'],
  [/Kopion|Marok|Quasigrazer|Valakkar|Yormandi|Creature|Animal|Fauna/i, 'Wildlife'],
  [/Security|UEE|Advocacy|Navy|Guard/i, 'Security and UEE forces'],
  [/Outlaw|Pirate|Criminal|Bandit|Xenothreat|NineTails|Headhunter/i, 'Outlaws and pirates on foot'],
  [/Civilian|Shopkeeper|Bartender|Patron|Worker/i, 'Civilians'],
];
export function npcGroup(name) {
  for (const [re, label] of NPC_GROUPS) if (re.test(name || '')) return label;
  return 'Other NPCs';
}

const ZONE_GROUPS = [
  [/contestedzone/i, 'Contested zones'],
  [/asd/i, 'ASD research facilities'],
  [/opendungeon|dungeon/i, 'Underground facilities'],
  [/bunker|ugf/i, 'Bunkers'],
  [/Hangar/i, 'Hangars'],
  [/^OOC_|^SolarSystem|Asteroid|Lagrange|_L\d/i, 'Open space'],
  [/^[A-Z]{3,5}_[A-Z]/, 'Aboard a ship'],
  [/pyro|stanton\d|nyx|_planet|moon|surface/i, 'Planet surfaces'],
  [/station|rr_|restStop|LEO/i, 'Stations'],
];
export function zoneGroup(zone) {
  if (!zone || zone === 'unknown') return 'Unknown';
  for (const [re, label] of ZONE_GROUPS) if (re.test(zone)) return label;
  return 'Other locations';
}

export function weaponName(w) {
  const names = {
    behr_rifle_ballistic_01: 'Behring P4-AR rifle',
    behr_rifle_ballistic_01_contestedzonereward: 'Behring P4-AR (contested zone reward)',
    behr_rifle_ballistic_01_black02: 'Behring P4-AR (black)',
    ksar_rifle_energy_01: 'Kastak Arms Karna rifle',
    klwe_rifle_energy_01: 'Klaus & Werner Gallant rifle',
    klwe_lmg_energy_01: 'Klaus & Werner Demeco LMG',
    gmni_smg_ballistic_01: 'Gemini C54 SMG',
    volt_lmg_energy_01_store01: 'VOLT Fresnel LMG',
    volt_rifle_energy_01: 'VOLT Parallax rifle',
    behr_lmg_ballistic_01: 'Behring FS-9 LMG',
    APAR_BallisticGatling_S4: 'Apocalypse Arms Revenant gatling (S4)',
  };
  return names[w] || (w || '').replace(/_/g, ' ');
}

export function deathCause(d) {
  if (d.damage === 'Suicide') return 'Respawned on purpose';
  if (d.killer === 'self') return 'Your own crash or self-destruct';
  if (d.killer === 'environment') return 'Environment (crash, hazard, bleed-out)';
  const who = d.killer === 'player' ? 'player' : 'NPC';
  if (d.domain === 'ship') return d.damage === 'VehicleDestruction' ? `Ship destroyed by ${who === 'player' ? 'a player' : 'an NPC'}` : `${who === 'player' ? 'Player' : 'NPC'} ship combat (${d.damage.toLowerCase()})`;
  if (d.domain === 'foot') return who === 'player' ? 'Shot or melee by a player' : 'Shot by an NPC';
  return `${who === 'player' ? 'Player' : 'NPC'}, other (${d.damage.toLowerCase()})`;
}
