'use strict';
// Parses one Star Citizen Game.log into a session record.
// Other players' names are never stored: players are counted through a short hash only.

const fs = require('fs');
const readline = require('readline');
const crypto = require('crypto');

const PARSER_VERSION = 17;

const TS = /^<(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?Z>/;
const ID_SUFFIX = /_\d{9,}$/;
const NAME_IN_FILE = /(\d\d) (\w{3}) (\d\d) \((\d\d) (\d\d) (\d\d)\)/;
const MONTHS = {Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11};
const REGIONS = {use: 'US East', usw: 'US West', euw: 'EU West', ape: 'Asia', apse: 'Australia'};

const RX = {
  env: /\[Trace\] Environment:\s+(\S+)/,
  session: /\[Trace\] @session:\s+'([^']+)'/,
  branch: /> Branch: (\S+)/,
  changelist: /> Changelist: (\d+)/,
  fileVersion: /FileVersion: (\S+)/,
  cpu: /Host CPU: (.+)$/,
  ram: /(\d+)MB physical memory installed/,
  display: /Current display mode is (\d+x\d+)/,
  resolution: /Change resolution: (\d+x\d+) \((\w+) at ([\d.]+)Hz\)/,
  adapter: /^<[^>]+>\s+- (.+?) \(vendor = (0x[0-9a-f]+)/i,
  vram: /Dedicated video memory: (\d+) MB/,
  driver: /VulkanMetric -\s+Driver (\S+)/,
  nick: /nickname="([^"]+)"/,
  load: /Loading screen for (\w+) : \w+ closed after ([\d.]+) seconds/,
  join: /<Join PU> address\[([^\]]*)\] port\[(\d*)\] shard\[([^\]]+)\]/,
  kill: /CActor::Kill: '([^']+)' \[\d+\] in zone '([^']*)' killed by '([^']+)' \[\d+\] using '([^']*)' \[Class ([^\]]*)\] with damage type '([^']+)'/,
  vdest: /Vehicle '([^']+)' \[\d+\] in zone '([^']*)'.*?driven by '([^']+)' \[\d+\] advanced from destroy level (\d) to (\d) caused by '([^']+)' \[\d+\] with '([^']+)'/,
  control: /<Vehicle Control Flow>.*?(granted|releasing) control token for '([^']+)'/,
  notif: /Added notification "([^"]*)/,
  shopReq: /<CEntityComponent\w+::Send(\w*?)(Buy|Sell)Request>.*?shopId\[(\d+)\].*?shopName\[([^\]]*)\].*?price\[([\d.]+)\].*?itemName\[([^\]]*)\](?:.*?quantity\[(\d+)\])?/,
  shopResp: /RmShopFlowResponse>.*?shopId\[(\d+)\].*?result\[(\w+)\]/,
  location: /RequestLocationInventory> Player\[[^\]]+\] requested inventory for Location\[([^\]]+)\]/,
  disc: /<Channel Disconnected> cause=(\d+) reason="([^"]+)".*?remoteAddr=(\S+)/,
  invDone: /<Inventory Request Completed>.*Elapsed\[([\d.]+)\]/,
  error: /\[Error\] <([^>]{1,80})>/,
  procMem: /Process Memory Status: (\d+)MB working set size, (\d+)MB commit size/,
  // crash handler block (lines without timestamps)
  exception: /^Exception (\w+)\((0x[0-9A-Fa-f]+)\)/,
  gpuCrash: /^Is GPU crash: (Yes|No)/,
  timeout: /^Is Timeout: (Yes|No)/,
  timeoutMsg: /^- Timeout message: (.*)/,
  oomSys: /^Is out of system memory: (Yes|No)/,
  oomVid: /^Is out of video memory: (Yes|No)/,
  gpuMsg: /^GPU crash message: (.*)/,
  // level profile block
  frames: /Frames\s+: (\d+)/,
  entities: /Entities\s+: Min: (\d+) Max: (\d+) Avg: (\d+)/,
  memCommit: /Memory \(Committed\)\s+: Min: ([\d.]+) MB Max ([\d.]+)/,
  memWs: /Memory \(WorkingSet\)\s+: Min: ([\d.]+) MB Max ([\d.]+)/,
  fpsLine: /(CPU \(MainThread\)|CPU \(WholeFrame\)|GPU)\s+:\s+([\d.]+) FPS \(\s*([\d.]+) ms\)((?:\|\s*[\d.]+%)+)/,
};

const strip = (s) => (s || '').replace(ID_SUFFIX, '');
const hash = (s) => crypto.createHash('sha1').update(`scinsights:${s}`).digest('hex').slice(0, 10);
const toMs = (ts) => Date.parse(`${ts}Z`);

function regionOf(shard) {
  const m = /^(?:pub|ptu)_([a-z]+)\d/.exec(shard);
  return m ? REGIONS[m[1]] || m[1] : 'Other';
}

function patchOf(branch) {
  const m = /sc-alpha-(\d+\.\d+)/.exec(branch || '');
  return m ? m[1] : null;
}

// NPCs and spawned entities carry a long numeric id; players don't.
function actorType(name, nick) {
  if (name === nick) return 'me';
  if (name === 'unknown' || !name) return 'environment';
  if (ID_SUFFIX.test(name) || name.startsWith('PU_') || /NPC|_AI_|AIModule/i.test(name)) return 'npc';
  return 'player';
}

// Item class names have underscores; a bare word in the weapon slot is a player's name.
function cleanWeapon(weapon, nick) {
  if (!weapon || weapon === 'unknown') return 'unknown';
  if (weapon === nick) return 'self';
  if (!weapon.includes('_') && !/^Hazard/i.test(weapon)) return 'none (player)';
  return strip(weapon);
}

function cleanZone(zone) {
  if (!zone || !zone.includes('_')) return 'unknown';
  return strip(zone);
}

const SHIP_DAMAGE = new Set(['VehicleDestruction', 'Crash', 'Collision', 'SelfDestruct', 'BoundaryViolation']);
const FOOT_DAMAGE = new Set(['Bullet', 'Melee', 'TakeDown', 'ElectricArc', 'BleedOut', 'Knockout', 'Stun']);

// "ship" = fought from or in a vehicle, "foot" = personal (FPS) combat, "other" = respawn, hazards, unknown explosions.
function domainOf(damage, weapon) {
  if (damage === 'Suicide') return 'other';
  if (SHIP_DAMAGE.has(damage)) return 'ship';
  if (/^(Hazard|canister|Mineable)/i.test(weapon)) return 'other';
  if (/^[A-Z][A-Za-z0-9]{2,5}_/.test(weapon)) return 'ship';
  if (/^[a-z]{3,5}_/.test(weapon)) return 'foot';
  if (FOOT_DAMAGE.has(damage)) return 'foot';
  return 'other';
}

function crashType(c) {
  if (!c) return null;
  const ex = c.exception || '';
  if (c.gpu || /GPU_CRASH/.test(ex)) return 'GPU crash';
  if (c.timeout || /WATCH_DOG/.test(ex)) return 'Freeze (deadlock)';
  if (c.oomSys || c.oomVid || /OUT_OF/.test(ex)) return 'Out of memory';
  if (/ACCESS_VIOLATION/.test(ex)) return 'Access violation';
  if (/FATAL_ERROR/.test(ex)) return 'Fatal error';
  if (ex) return 'Other exception';
  return 'Crash report';
}

async function parseLogFile(file) {
  const stat = fs.statSync(file);
  const rec = {
    file, size: stat.size, mtimeMs: stat.mtimeMs, parser: PARSER_VERSION,
    id: null, start: null, end: null, localStart: null, offsetHours: null,
    env: null, branch: null, patch: null, changelist: null, fileVersion: null,
    cpu: null, gpu: null, vramMB: null, ramMB: null, display: null, refreshHz: null, windowMode: null,
    driver: null, renderer: null, nick: null,
    clean: false, crash: null,
    joins: [], loads: [], profiles: [],
    kills: [], deaths: [], corpses: [], vdest: [], flights: [],
    contracts: [], shop: [], locations: {}, placesAt: [], disconnects: [], jurisdictions: {},
    counts: {qtArrivals: 0, qtCalibrations: 0, medBed: 0, incapacitated: 0, crimestat: 0, crimes: 0, partyJoins: 0,
      partyCreated: 0, hangarRequests: 0, blueprints: 0, objectives: 0, animationJams: 0, errors: 0, particleLimit: 0},
    inventory: null, errorsTop: [], timeline: [],
  };

  let headerLocal = null;
  let lastTs = null;
  let lastLoad = null;
  let adapters = [];
  let pendingAdapter = null;
  let profile = null;
  let crash = null;
  let crashSeen = false;
  const openFlights = new Map();
  const myShips = new Set();
  const pendingShop = new Map();
  const invTimes = [];
  const errors = new Map();
  let lastBed = 0;
  let lastCorpse = 0;
  let jam = null;
  let killBurst = null;

  const tl = (t, kind, text) => {
    if (rec.timeline.length < 600) rec.timeline.push({t, kind, text});
  };
  const flushKills = () => {
    if (!killBurst) return;
    const b = killBurst;
    const parts = [];
    if (b.npc) parts.push(`${b.npc} NPC`);
    if (b.player) parts.push(`${b.player} player`);
    const where = [b.ship ? `${b.ship} from a ship` : '', b.foot ? `${b.foot} on foot` : ''].filter(Boolean).join(', ');
    tl(b.t, 'kill', `${b.n === 1 ? 'Kill' : `${b.n} kills`}: ${parts.join(', ')}${where ? ` (${where})` : ''}`);
    killBurst = null;
  };

  const closeProfile = () => {
    if (profile && profile.frames) rec.profiles.push(profile);
    profile = null;
  };
  // The log often never says the controls were released, so a flight also ends at the next thing that
  // means you can't still be flying: another ship, a death, a loading screen, a disconnect, leaving the world.
  const closeFlights = (t, except) => {
    for (const [ship, start] of openFlights) {
      if (ship === except) continue;
      if (t > start) rec.flights.push({ship, start, end: t});
      openFlights.delete(ship);
    }
  };
  // Corrupted logs can repeat an old event line hundreds of times (one kill showed up 670 times, stamped
  // the day before the session began). Count each distinct event once, and only if it falls inside this session.
  const seenEvents = new Set();
  const freshEvent = (line, marker) => {
    const at = line.lastIndexOf('<20', line.indexOf(marker));
    const key = at >= 0 ? line.slice(at) : line;
    if (seenEvents.has(key)) return false;
    seenEvents.add(key);
    const ts = TS.exec(key);
    return !ts || !rec.start || ts[1] >= rec.start;
  };

  const stream = fs.createReadStream(file, {encoding: 'utf8', highWaterMark: 1 << 20});
  const rl = readline.createInterface({input: stream, crlfDelay: Infinity});

  let lineNo = 0;
  for await (const line of rl) {
    lineNo += 1;
    const tm = TS.exec(line);
    // A stale line from an earlier session must not move the clock backwards.
    if (tm && (!lastTs || tm[1] >= lastTs)) {
      lastTs = tm[1];
      if (!rec.start) rec.start = lastTs;
    }
    if (!headerLocal && lineNo < 50 && line.includes('BackupNameAttachment')) headerLocal = NAME_IN_FILE.exec(line);

    // ---- level profile block (consumes its own lines)
    if (line.includes('Level Profile Statistics')) {
      closeProfile();
      closeFlights(lastTs);
      profile = {t: lastTs, dest: lastLoad, frames: 0};
      continue;
    }
    if (profile) {
      let m;
      if ((m = RX.frames.exec(line))) { profile.frames = Number(m[1]); continue; }
      if ((m = RX.entities.exec(line))) { profile.entitiesAvg = Number(m[3]); profile.entitiesMax = Number(m[2]); continue; }
      if ((m = RX.memCommit.exec(line))) { profile.commitMaxMB = Math.round(Number(m[2])); continue; }
      if ((m = RX.memWs.exec(line))) { profile.wsMaxMB = Math.round(Number(m[2])); continue; }
      if (line.includes('Buckets') || line.includes('Component Updates') || line.includes('Component Events')) continue;
      if ((m = RX.fpsLine.exec(line))) {
        const buckets = m[4].split('|').filter(Boolean).map((x) => Number(x.replace('%', '').trim()));
        const key = m[1] === 'GPU' ? 'gpu' : m[1].includes('Main') ? 'main' : 'whole';
        profile[`${key}Fps`] = Number(m[2]);
        if (key === 'whole') profile.wholeBuckets = buckets;
        continue;
      }
      closeProfile();
    }

    // ---- crash handler block
    if (!tm) {
      let m;
      if (line.startsWith('Cloud Imperium Games public crash handler')) { crash = crash || {}; crashSeen = true; continue; }
      if ((m = RX.exception.exec(line))) { crash = crash || {}; crash.exception = m[1]; crashSeen = true; continue; }
      if (crash) {
        if ((m = RX.gpuCrash.exec(line))) crash.gpu = m[1] === 'Yes';
        else if ((m = RX.timeout.exec(line))) crash.timeout = m[1] === 'Yes';
        else if ((m = RX.timeoutMsg.exec(line))) { crash.message = m[1].slice(0, 200); crash.duringLoad = /IsLoadingUnloading = True/.test(m[1]); }
        else if ((m = RX.oomSys.exec(line))) crash.oomSys = m[1] === 'Yes';
        else if ((m = RX.oomVid.exec(line))) crash.oomVid = m[1] === 'Yes';
      }
      if ((m = RX.gpuMsg.exec(line))) { crash = crash || {}; crash.gpu = true; crash.message = m[1].slice(0, 200); crashSeen = true; continue; }
      if ((m = RX.procMem.exec(line))) { rec.memAtEndMB = {ws: Number(m[1]), commit: Number(m[2])}; }
      continue;
    }

    let m;
    // ---- header facts (all written in the first few thousand lines)
    if (lineNo < 4000) {
      if (!rec.env && (m = RX.env.exec(line))) { rec.env = m[1] === 'PUB' ? 'LIVE' : m[1]; continue; }
      if (!rec.id && (m = RX.session.exec(line))) { rec.id = m[1]; continue; }
      if (!rec.branch && (m = RX.branch.exec(line))) { rec.branch = m[1]; rec.patch = patchOf(m[1]); continue; }
      if (!rec.changelist && (m = RX.changelist.exec(line))) { rec.changelist = m[1]; continue; }
      if (!rec.fileVersion && (m = RX.fileVersion.exec(line))) { rec.fileVersion = m[1]; continue; }
      if (!rec.cpu && (m = RX.cpu.exec(line))) { rec.cpu = m[1].replace(/^AMD |^Intel\(R\) Core\(TM\) |\s+\d+-Core Processor$/g, '').trim(); continue; }
      if (!rec.ramMB && (m = RX.ram.exec(line))) { rec.ramMB = Number(m[1]); continue; }
      if (!rec.display && (m = RX.display.exec(line))) { rec.display = m[1]; continue; }
      if ((m = RX.adapter.exec(line))) { pendingAdapter = m[1].trim(); continue; }
      if (pendingAdapter && (m = RX.vram.exec(line))) { adapters.push({name: pendingAdapter, mem: Number(m[1])}); pendingAdapter = null; continue; }
      if (!rec.driver && (m = RX.driver.exec(line))) { rec.driver = m[1]; continue; }
      // DX11 feature levels are listed for every adapter, so only a chosen Vulkan device decides the renderer.
      if (line.includes('Chosen Vulkan GPU Device')) rec.renderer = 'Vulkan';
      else if (!rec.renderer && line.includes('Feature level: DX11')) rec.renderer = 'DX11';
    }
    if (line.includes('Change resolution:') && (m = RX.resolution.exec(line))) {
      rec.display = m[1]; rec.windowMode = m[2]; rec.refreshHz = Math.round(Number(m[3]));
      continue;
    }
    if (!rec.nick && line.includes('nickname="') && (m = RX.nick.exec(line))) rec.nick = m[1];

    if (line.includes('Fast Shutdown') || line.includes('FastShutdown') || line.includes('CSystem::Quit invoked')) {
      if (!rec.clean) tl(lastTs, 'quit', 'Quit the game');
      rec.clean = true;
      continue;
    }

    // ---- loading, servers
    if (line.includes('Loading screen for')) {
      if ((m = RX.load.exec(line))) {
        const dest = m[1] === 'Frontend_Main' ? 'Main menu' : m[1] === 'pu' ? 'Stanton' : m[1];
        rec.loads.push({t: lastTs, dest, s: Number(m[2])});
        lastLoad = dest;
        closeFlights(lastTs);
        tl(lastTs, 'load', dest === 'Main menu' ? `Main menu loaded (${Number(m[2]).toFixed(1)} s)` : `Loaded into ${dest} (${Number(m[2]).toFixed(1)} s)`);
      }
      continue;
    }
    if (line.includes('<Join PU>')) {
      if ((m = RX.join.exec(line))) {
        rec.joins.push({t: lastTs, region: regionOf(m[3]), shard: m[3], address: m[1], port: Number(m[2])});
        tl(lastTs, 'server', `Joined shard ${m[3]} (${regionOf(m[3])})`);
      }
      continue;
    }
    if (line.includes('<Channel Disconnected>')) {
      if ((m = RX.disc.exec(line)) && !m[3].includes('<local>')) {
        rec.disconnects.push({t: lastTs, cause: Number(m[1]), reason: m[2]});
        closeFlights(lastTs);
        tl(lastTs, 'server', /Player requested/.test(m[2]) ? 'Left the server' : `Disconnected: ${m[2]}`);
      }
      continue;
    }

    // ---- combat
    if (line.includes('CActor::Kill')) {
      if ((m = RX.kill.exec(line)) && freshEvent(line, 'CActor::Kill')) {
        const [, victim, zone, killer, weaponRaw, , damage] = m;
        const nick = rec.nick;
        const weapon = cleanWeapon(weaponRaw, nick);
        const domain = domainOf(damage, weapon);
        if (killer === nick && victim !== nick) {
          const vt = actorType(victim, nick);
          const k = {t: lastTs, victim: vt, domain, damage, weapon, zone: cleanZone(zone)};
          if (vt === 'npc') k.npc = strip(victim);
          if (vt === 'player') k.pid = hash(victim);
          rec.kills.push(k);
          if (!killBurst || toMs(lastTs) - toMs(killBurst.last) > 120000) {
            flushKills();
            killBurst = {t: lastTs, last: lastTs, n: 0, npc: 0, player: 0, ship: 0, foot: 0};
          }
          killBurst.last = lastTs;
          killBurst.n += 1;
          if (vt === 'player') killBurst.player += 1; else killBurst.npc += 1;
          if (domain === 'ship') killBurst.ship += 1;
          if (domain === 'foot') killBurst.foot += 1;
        } else if (victim === nick) {
          const kt = killer === nick ? 'self' : actorType(killer, nick);
          const d = {t: lastTs, killer: kt, domain, damage, weapon, zone: cleanZone(zone)};
          if (kt === 'npc') d.npc = strip(killer);
          if (kt === 'player') d.pid = hash(killer);
          rec.deaths.push(d);
          flushKills();
          closeFlights(lastTs);
          const who = {self: 'yourself', player: 'a player', npc: 'an NPC', environment: 'the environment'}[kt] || kt;
          tl(lastTs, 'death', damage === 'Suicide' ? 'Respawned' : `Killed by ${who} (${damage}${domain === 'ship' ? ', ship combat' : domain === 'foot' ? ', on foot' : ''})`);
        }
      }
      continue;
    }
    if (line.includes('<Vehicle Destruction>')) {
      if ((m = RX.vdest.exec(line)) && freshEvent(line, '<Vehicle Destruction>')) {
        const [, veh, , driver, from, to, cause, how] = m;
        const nick = rec.nick;
        const v = {
          t: lastTs, ship: strip(veh).replace(/_PU_AI_\w+$|_AI_\w+$/, ''), npcCrew: /_AI_|_PU_AI/.test(veh),
          driver: driver === 'unknown' ? 'none' : actorType(driver, nick), cause: actorType(cause, nick),
          from: Number(from), to: Number(to), how,
          // The pilot is always logged as 'unknown', so "yours" means a ship whose controls you held this session.
          mine: myShips.has(veh),
        };
        rec.vdest.push(v);
        if (v.to === 2 && v.cause === 'me' && !v.mine && how !== 'SelfDestruct') tl(lastTs, 'ship', `Destroyed a ${v.ship.replace(/_/g, ' ')} (${how})`);
        if (v.to === 2 && v.mine) {
          tl(lastTs, 'ship', `Your ${v.ship.replace(/_/g, ' ')} was destroyed (${how})`);
          closeFlights(lastTs);
        }
      }
      continue;
    }
    if (line.includes('<Vehicle Control Flow>')) {
      // 'Default_12345' entities are seats and turrets, not ships.
      if ((m = RX.control.exec(line)) && !m[2].startsWith('Default')) {
        const ship = m[2].replace(/_\d{5,}$/, '');
        myShips.add(m[2]);
        if (m[1] === 'granted') {
          closeFlights(lastTs, ship);
          if (!openFlights.has(ship)) {
            openFlights.set(ship, lastTs);
            tl(lastTs, 'ship', `Took the controls of ${ship.replace(/_/g, ' ')}`);
          }
        } else if (openFlights.has(ship)) {
          rec.flights.push({ship, start: openFlights.get(ship), end: lastTs});
          openFlights.delete(ship);
          tl(lastTs, 'ship', `Left the controls of ${ship.replace(/_/g, ' ')}`);
        } else {
          // Builds from late 2025 on only log leaving the seat, so the flight has no known start.
          rec.flights.push({ship, start: null, end: lastTs});
          tl(lastTs, 'ship', `Left the controls of ${ship.replace(/_/g, ' ')}`);
        }
      }
      continue;
    }
    if (line.includes('CSCActorCorpseUtils')) {
      const ms = toMs(lastTs);
      if (ms - lastCorpse > 120000) {
        rec.corpses.push(lastTs);
        closeFlights(lastTs);
        if (!rec.deaths.length || toMs(rec.deaths[rec.deaths.length - 1].t) < ms - 120000) tl(lastTs, 'death', 'Died (corpse created for item recovery)');
      }
      lastCorpse = ms;
      continue;
    }
    if (line.includes('<Too many actions>')) {
      rec.counts.errors += 1;
      if (!jam || toMs(lastTs) - toMs(jam.last) > 60000) {
        jam = {t: lastTs, last: lastTs, n: 0};
        rec.counts.animationJams += 1;
        tl(lastTs, 'warn', 'Character animation queue jammed ("Too many actions" errors)');
      }
      jam.last = lastTs;
      jam.n += 1;
      continue;
    }

    // ---- notifications
    if (line.includes('Added notification "')) {
      if ((m = RX.notif.exec(line))) {
        const text = m[1];
        const title = text.split(':')[0].trim();
        const c = rec.counts;
        if (/^Contract (Accepted|Complete|Failed|Abandoned)/.test(title)) {
          const parts = text.split(':').map((p) => p.trim());
          const name = (parts[1] || '(unnamed)').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || '(unnamed)';
          const status = title.replace('Contract ', '');
          rec.contracts.push({t: lastTs, status, name});
          tl(lastTs, 'mission', `Contract ${status.toLowerCase()}: ${name}`);
        } else if (title === 'Medical Bed') {
          const ms = toMs(lastTs);
          if (ms - lastBed > 150000) { c.medBed += 1; tl(lastTs, 'med', 'Healed in a med bed'); }
          lastBed = ms;
        } else if (title.startsWith('Quantum Travel Calibration Started By') && rec.nick && title.endsWith(rec.nick)) c.qtCalibrations += 1;
        else if (title === 'Incapacitated') { c.incapacitated += 1; tl(lastTs, 'death', 'Incapacitated'); }
        else if (title === 'CrimeStat Rating Increased') { c.crimestat += 1; tl(lastTs, 'warn', 'CrimeStat rating increased'); }
        else if (title === 'Crime Committed') c.crimes += 1;
        else if (title === 'New Member Joined') c.partyJoins += 1;
        else if (title.startsWith('You have created')) { c.partyCreated += 1; tl(lastTs, 'social', 'Created a party'); }
        else if (title === 'Hangar Request Completed') c.hangarRequests += 1;
        else if (title === 'Received Blueprint') c.blueprints += 1;
        else if (title === 'Objective Complete') c.objectives += 1;
        else if (/^Entered .+ Jurisdiction$/.test(title)) {
          const j = title.replace(/^Entered | Jurisdiction$/g, '');
          rec.jurisdictions[j] = (rec.jurisdictions[j] || 0) + 1;
        }
      }
      continue;
    }
    if (line.includes('<Quantum Drive Arrived - Arrived at Final Destination>')) { rec.counts.qtArrivals += 1; continue; }

    // ---- shops
    if (line.includes('Request>') && line.includes('price[')) {
      if ((m = RX.shopReq.exec(line))) {
        const s = {t: lastTs, kind: m[2], shop: strip(m[4]), price: Math.round(Number(m[5])), item: m[6], qty: Number(m[7] || 1), result: null};
        rec.shop.push(s);
        pendingShop.set(m[3], s);
      }
      continue;
    }
    if (line.includes('RmShopFlowResponse')) {
      if ((m = RX.shopResp.exec(line)) && pendingShop.has(m[1])) {
        const s = pendingShop.get(m[1]);
        s.result = m[2];
        pendingShop.delete(m[1]);
        tl(s.t, 'shop', `${s.kind === 'Buy' ? 'Bought' : 'Sold'} ${s.qty} × ${s.item} for ${s.price.toLocaleString('en')} aUEC${s.result === 'Success' ? '' : ` (${s.result})`}`);
      }
      continue;
    }
    if (line.includes('RequestLocationInventory')) {
      if ((m = RX.location.exec(line))) {
        rec.locations[m[1]] = (rec.locations[m[1]] || 0) + 1;
        // When you were where (the Journey tab names its stops with these); the same place again within
        // 5 minutes only moves the last entry's time on.
        const prev = rec.placesAt[rec.placesAt.length - 1];
        if (prev && prev.name === m[1] && toMs(lastTs) - toMs(prev.last) < 300000) prev.last = lastTs;
        else if (rec.placesAt.length < 500) rec.placesAt.push({t: lastTs, last: lastTs, name: m[1]});
        rec.lastLocation = {t: lastTs, name: m[1]};
      }
      continue;
    }
    if (line.includes('<Inventory Request Completed>')) {
      if ((m = RX.invDone.exec(line))) invTimes.push(Number(m[1]));
      continue;
    }
    if (line.includes('[Error]')) {
      rec.counts.errors += 1;
      if ((m = RX.error.exec(line))) {
        errors.set(m[1], (errors.get(m[1]) || 0) + 1);
        if (m[1] === 'CPU Particle Limit reached') rec.counts.particleLimit += 1;
      }
    }
  }

  closeProfile();
  flushKills();
  rec.end = lastTs;
  for (const [ship, start] of openFlights) rec.flights.push({ship, start, end: lastTs, open: true});

  if (adapters.length) {
    const best = adapters.filter((a) => !/Basic Render/i.test(a.name)).sort((a, b) => b.mem - a.mem)[0] || adapters[0];
    rec.gpu = best.name.replace(/^NVIDIA (GeForce )?|^AMD (Radeon )?/, '').trim();
    rec.vramMB = best.mem;
  }
  if (!rec.nick) rec.nick = null;

  // local start time from the backup name (game writes local time there)
  const nm = headerLocal || NAME_IN_FILE.exec(file);
  if (nm && rec.start) {
    const [, dd, mon, yy, hh, mi, ss] = nm;
    const localAsUtc = Date.UTC(2000 + Number(yy), MONTHS[mon], Number(dd), Number(hh), Number(mi), Number(ss));
    rec.offsetHours = Math.round((localAsUtc - toMs(rec.start)) / 3600000);
    if (Math.abs(rec.offsetHours) > 14) rec.offsetHours = 0;
  } else {
    rec.offsetHours = 0;
  }
  if (rec.start) rec.localStart = new Date(toMs(rec.start) + rec.offsetHours * 3600000).toISOString().slice(0, 19);
  rec.minutes = rec.start && rec.end ? Math.round((toMs(rec.end) - toMs(rec.start)) / 600) / 100 : 0;

  if (crashSeen) {
    rec.crash = {...crash, type: crashType(crash), atMinute: rec.minutes, lastDest: lastLoad};
    tl(lastTs, 'crash', `Crashed: ${rec.crash.type}${rec.crash.exception ? ` (${rec.crash.exception})` : ''}`);
  }
  rec.exit = rec.clean ? 'clean' : crashSeen ? 'crash' : 'no-shutdown';

  if (invTimes.length) {
    invTimes.sort((a, b) => a - b);
    const q = (p) => invTimes[Math.min(invTimes.length - 1, Math.ceil(p * invTimes.length) - 1)];
    rec.inventory = {n: invTimes.length, median: q(0.5), p90: q(0.9)};
  }
  rec.errorsTop = [...errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  rec.timeline.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return rec;
}

module.exports = {parseLogFile, PARSER_VERSION, domainOf, actorType};
