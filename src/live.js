'use strict';
// Follows the Game.log of the session being played right now.

const fs = require('fs');
const path = require('path');
const {parseLogFile} = require('./parse-log');

const REFRESH_MS = 30000;

class LiveSession {
  constructor(getRoot) {
    this.getRoot = getRoot;
    this.session = null;
    this.file = null;
    this.stamp = null;
    this.timer = null;
  }

  // The channel whose Game.log was written most recently is the one being played.
  currentLog() {
    const root = this.getRoot();
    if (!root) return null;
    let best = null;
    for (const d of fs.readdirSync(root, {withFileTypes: true})) {
      if (!d.isDirectory()) continue;
      const f = path.join(root, d.name, 'Game.log');
      try {
        const st = fs.statSync(f);
        if (!best || st.mtimeMs > best.mtimeMs) best = {file: f, channel: d.name, mtimeMs: st.mtimeMs, size: st.size};
      } catch (e) {
        // no log in this channel
      }
    }
    return best;
  }

  async refresh() {
    const cur = this.currentLog();
    if (!cur) {
      this.session = null;
      return;
    }
    const stamp = `${cur.file}|${cur.size}|${cur.mtimeMs}`;
    if (stamp === this.stamp) return;
    try {
      const rec = await parseLogFile(cur.file);
      this.session = {...rec, channel: cur.channel, logModified: new Date(cur.mtimeMs).toISOString()};
      this.file = cur.file;
      this.stamp = stamp;
    } catch (err) {
      console.error('live session read failed', err.message);
    }
  }

  start() {
    const loop = async () => {
      await this.refresh();
      this.timer = setTimeout(loop, REFRESH_MS);
    };
    loop();
  }

  // What an overlay reading taken now belongs to.
  context() {
    const s = this.session;
    if (!s || s.exit === 'clean' || s.exit === 'crash') return null;
    const join = s.joins[s.joins.length - 1];
    const left = s.disconnects.length && join && s.disconnects[s.disconnects.length - 1].t > join.t;
    const load = [...s.loads].reverse().find((l) => /^(Stanton|Pyro|Nyx|Castra)$/.test(l.dest));
    return {
      session: s.id || s.start,
      env: s.env,
      shard: join && !left ? join.shard : null,
      location: s.lastLocation ? s.lastLocation.name : null,
      locationAt: s.lastLocation ? s.lastLocation.t : null,
      // The star system you loaded into; a jump to another one isn't logged.
      system: load ? load.dest : null,
    };
  }

  // A slimmer copy for the page.
  summary() {
    const s = this.session;
    if (!s) return null;
    const {file, timeline, kills, deaths, vdest, profiles, ...rest} = s;
    return {
      ...rest,
      fileName: path.basename(file),
      timeline: timeline.slice(-60),
      killCount: kills.length,
      deathCount: deaths.filter((d) => d.damage !== 'Suicide').length || s.corpses.length,
      profiles,
    };
  }
}

// r_displayinfo in USER.cfg is applied at every start; 0 means the overlay starts hidden.
function displayInfoSetting(root, channel) {
  const found = [];
  for (const f of [path.join(root || '', channel || 'LIVE', 'USER.cfg'), path.join(root || '', 'USER.cfg')]) {
    try {
      const text = fs.readFileSync(f, 'utf8');
      const m = [...text.matchAll(/^\s*r_displayinfo\s*=\s*(\d+)/gim)].pop();
      if (m) found.push({file: f, value: Number(m[1])});
    } catch (e) {
      // no USER.cfg there
    }
  }
  return found[0] || null;
}

module.exports = {LiveSession, displayInfoSetting};
