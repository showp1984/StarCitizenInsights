'use strict';
// Reads the r_displayinfo overlay on a schedule while Star Citizen runs, and keeps the readings.
// The reader process (Windows PowerShell + Windows OCR) only exists while the game is running.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {spawn, execFile} = require('child_process');
const {parseCapture} = require('./parse');

// Region read from the game window's top-right corner, in pixels. The overlay block is about 650 x 300.
const REGION = {width: 720, height: 320, scale: 3, threshold: 0};
const IDLE_STOP_MS = 3 * 60000;
const KEY_FIELDS = ['serverFps', 'server', 'playersShard', 'playersServer', 'pingMs'];

const toMs = (t) => Date.parse(t.endsWith('Z') ? t : `${t}Z`);
// Digit pairs the OCR confuses in the overlay's font.
const CONFUSED = ['68', '38', '56', '08', '17', '06'];

// Checks a reading against the ones just before it.
// - OCR sometimes drops, cuts off or swaps a digit of the server name (game-177 read as game-77, game-119 as
//   game-1, game-68 as game-66). A "new" server that close to the previous one, seconds later, is the previous
//   one, unless the two readings with a server name before this one already saw the same new name.
// - Player counts don't jump several-fold within minutes (2 for a server, 10 for the shard), and ping doesn't
//   drop to a third of what it was in the last 2 minutes (it can't beat the distance); such a number is a misread.
function fixWithPrevious(r, readings) {
  const named = [];
  for (let i = readings.length - 1; i >= 0 && named.length < 2 && toMs(r.t) - toMs(readings[i].t) <= 60000; i -= 1) if (readings[i].server) named.push(readings[i]);
  const prev = named[0];
  const seenTwice = named.length === 2 && named.every((x) => x.serverRead === r.server);
  if (prev && r.server && r.server !== prev.server && !seenTwice && !(prev.shard && r.shard && prev.shard !== r.shard)) {
    const a = prev.server.slice(5);
    const b = r.server.slice(5);
    const dropped = (b.length === a.length - 1 && [...a].some((_, i) => a.slice(0, i) + a.slice(i + 1) === b)) || (b.length < a.length && a.startsWith(b));
    // Only digits the OCR mixes up: servers are numbered in sequence, so game-68 handing you to game-69 is real.
    const diff = [...a].map((c, i) => [c, b[i]]).filter(([c, d]) => c !== d);
    const swapped = b.length === a.length && diff.length === 1 && CONFUSED.includes([...diff[0]].sort().join(''));
    if (dropped || swapped) {
      r.serverRead = r.server;
      r.server = prev.server;
    }
  }
  const recent = (k, same, windowMs) => {
    for (let i = readings.length - 1; i >= 0; i -= 1) {
      const x = readings[i];
      if (toMs(r.t) - toMs(x.t) > windowMs) return null;
      if (x[k] != null && same(x)) return x[k];
    }
    return null;
  };
  const jumped = (v, p, slack) => v != null && p != null && Math.abs(v - p) > slack && (v > p * 3 || p > v * 3);
  if (jumped(r.playersServer, recent('playersServer', (x) => x.server === r.server, 120000), 10)) delete r.playersServer;
  if (jumped(r.playersShard, recent('playersShard', (x) => x.shard === r.shard, 600000), 50)) delete r.playersShard;
  const pings = readings.filter((x) => x.pingMs != null && x.shard === r.shard && toMs(r.t) - toMs(x.t) <= 120000).map((x) => x.pingMs).sort((a, b) => a - b);
  if (r.pingMs != null && pings.length >= 3 && r.pingMs < pings[pings.length >> 1] / 3) delete r.pingMs;
}

// Where you are: the overlay's "Current player location" when it was readable, else whichever is newer of the
// last location the overlay showed (within 2 minutes) and the last place Game.log saw you open an inventory.
// Neither counts if it is from before you moved to another game server (`movedAt`): you have left that place.
function bestLocation(t, parsed, lastSeen, ctx, movedAt) {
  if (parsed.location) return parsed.location;
  const fromOverlay = lastSeen && toMs(t) - toMs(lastSeen.t) <= 120000 ? lastSeen : null;
  const fromLog = ctx.location ? {t: ctx.locationAt || '', name: ctx.location} : null;
  const best = [fromOverlay, fromLog].filter((x) => x && (!movedAt || x.t >= movedAt)).sort((a, b) => (a.t < b.t ? 1 : -1))[0];
  return best ? best.name : null;
}

function gameRunning() {
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/FI', 'IMAGENAME eq StarCitizen.exe', '/NH', '/FO', 'CSV'], {windowsHide: true, timeout: 10000},
      (err, stdout) => resolve(!err && /StarCitizen\.exe/i.test(stdout)));
  });
}

class OverlayMonitor {
  constructor({dataDir, readerScript, getContext, getSettings}) {
    this.dir = path.join(dataDir, 'overlay');
    fs.mkdirSync(this.dir, {recursive: true});
    this.readerScript = readerScript;
    this.getContext = getContext;
    this.getSettings = getSettings;
    this.status = {state: 'starting', message: 'Starting', at: null};
    this.readings = this.load();
    this.proc = null;
    this.pending = null;
    this.lastGameSeen = 0;
    this.timer = null;
    this.busy = false;
    this.lastOverlayLocation = null;
    this.lastServer = null;
    this.movedAt = null;
  }

  // Keeps the last 60 days in memory; older readings stay on disk.
  load() {
    const cutoff = new Date(Date.now() - 60 * 86400000).toISOString();
    const out = [];
    for (const f of fs.readdirSync(this.dir).filter((n) => /^readings-\d{4}-\d{2}\.jsonl$/.test(n)).sort()) {
      for (const line of fs.readFileSync(path.join(this.dir, f), 'utf8').split('\n')) {
        if (!line) continue;
        try {
          const r = JSON.parse(line);
          if (r.t >= cutoff) out.push(r);
        } catch (e) {
          // a half-written line from a crash; skip it
        }
      }
    }
    return out;
  }

  save(r) {
    this.readings.push(r);
    fs.appendFileSync(path.join(this.dir, `readings-${r.t.slice(0, 7)}.jsonl`), `${JSON.stringify(r)}\n`);
  }

  start() {
    const loop = async () => {
      await this.tick().catch((err) => this.setStatus('error', `Overlay reading failed: ${err.message}`));
      const {intervalSec} = this.getSettings();
      this.timer = setTimeout(loop, Math.max(5, intervalSec) * 1000);
    };
    loop();
  }

  setStatus(state, message) {
    this.status = {state, message, at: new Date().toISOString()};
  }

  startReader() {
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.readerScript], {windowsHide: true});
    const rl = readline.createInterface({input: proc.stdout});
    rl.on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        return;
      }
      if (msg.ready) return;
      const p = this.pending;
      this.pending = null;
      if (p) p.resolve(msg);
    });
    proc.stderr.on('data', (d) => console.error(`overlay reader: ${String(d).trim()}`));
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null;
      if (this.pending) this.pending.resolve({error: 'reader stopped'});
      this.pending = null;
    });
    this.proc = proc;
  }

  stopReader() {
    if (!this.proc) return;
    try {
      this.proc.stdin.write('quit\n');
    } catch (e) {
      // already gone
    }
    const p = this.proc;
    setTimeout(() => p.kill(), 2000);
    this.proc = null;
  }

  ask(cmd, timeoutMs = 15000) {
    return new Promise((resolve) => {
      this.pending = {resolve};
      setTimeout(() => {
        if (this.pending && this.pending.resolve === resolve) {
          this.pending = null;
          resolve({error: 'timed out'});
        }
      }, timeoutMs);
      this.proc.stdin.write(`${cmd}\n`);
    });
  }

  // Diagnosis mode: keep the recognized text and the captured corner of reads that missed fields (at most 200 a day).
  async keepForDiagnosis(reading, lines, missing) {
    const dir = path.join(this.dir, 'diagnosis');
    fs.mkdirSync(dir, {recursive: true});
    const day = reading.t.slice(0, 10);
    const index = path.join(dir, `${day}.jsonl`);
    let count = 0;
    try {
      count = fs.readFileSync(index, 'utf8').split('\n').filter(Boolean).length;
    } catch (e) {
      // first one today
    }
    if (count >= 200) return;
    const image = `${reading.t.replace(/[:]/g, '-')}.png`;
    await this.ask(`save ${path.join(dir, image)}`);
    fs.appendFileSync(index, `${JSON.stringify({t: reading.t, missing, image, lines})}\n`);
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const {enabled} = this.getSettings();
      if (!enabled) {
        this.stopReader();
        return this.setStatus('off', 'Overlay reading is switched off');
      }
      if (!(await gameRunning())) {
        if (this.proc && Date.now() - this.lastGameSeen > IDLE_STOP_MS) this.stopReader();
        return this.setStatus('no-game', 'Star Citizen is not running');
      }
      this.lastGameSeen = Date.now();
      if (!this.proc) this.startReader();
      const res = await this.ask(`read ${REGION.width} ${REGION.height} ${REGION.scale} ${REGION.threshold}`);
      if (res.error) return this.setStatus('error', `Overlay reading failed: ${res.error}`);
      if (!res.game) return this.setStatus('no-game', 'Star Citizen is not running');
      if (res.minimized) return this.setStatus('paused', 'Star Citizen is minimized');
      // Behind another window the corner shows that window instead of the game.
      if (!res.foreground) return this.setStatus('paused', 'Paused while Star Citizen is in the background');
      let extraCpu = 0;
      const again = async (threshold) => {
        const more = await this.ask(`again ${REGION.scale} ${threshold}`);
        extraCpu += more.cpuMs || 0;
        return more.error ? null : more.lines || [];
      };
      const parsed = await parseCapture(res.lines || [], again);
      const t = new Date().toISOString().slice(0, 19);
      if (!parsed.ok) {
        if (this.getSettings().debug && (res.lines || []).length) await this.keepForDiagnosis({t}, res.lines, KEY_FIELDS);
        return this.setStatus('no-overlay', 'The overlay is not on screen. In the game console (~) type r_displayinfo 3');
      }
      const ctx = this.getContext() || {};
      const reading = {
        t,
        ...parsed,
        shard: ctx.shard || parsed.shard || null,
        overlayShard: parsed.shard || null,
        session: ctx.session || null,
        env: ctx.env || null,
        cpuMs: res.cpuMs + extraCpu,
      };
      delete reading.ok;
      fixWithPrevious(reading, this.readings);
      const before = this.lastServer;
      if (reading.server) {
        if (before && before.server !== reading.server && toMs(t) - toMs(before.t) <= 5 * 60000) this.movedAt = t;
        this.lastServer = {t, server: reading.server};
      }
      reading.location = bestLocation(t, parsed, this.lastOverlayLocation, ctx, this.movedAt);
      if (parsed.location) this.lastOverlayLocation = {t, name: parsed.location};
      this.save(reading);
      const missing = KEY_FIELDS.filter((k) => reading[k] == null);
      if (missing.length && this.getSettings().debug) await this.keepForDiagnosis(reading, res.lines, missing);
      return this.setStatus('reading', 'Reading the overlay');
    } finally {
      this.busy = false;
    }
  }
}

module.exports = {OverlayMonitor, REGION, fixWithPrevious, bestLocation};
