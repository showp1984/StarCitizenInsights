'use strict';
// Finds the Star Citizen install folder (the one holding LIVE, PTU, …) on any PC.

const fs = require('fs');
const os = require('os');
const path = require('path');

const CHANNELS = ['LIVE', 'PTU', 'EPTU', 'HOTFIX', 'TECH-PREVIEW'];

// A root is a folder with at least one channel folder that has a Game.log or logbackups.
function isInstallRoot(dir) {
  try {
    return fs.readdirSync(dir, {withFileTypes: true}).some((d) => d.isDirectory()
      && (fs.existsSync(path.join(dir, d.name, 'Game.log')) || fs.existsSync(path.join(dir, d.name, 'logbackups'))));
  } catch (e) {
    return false;
  }
}

// Accepts the StarCitizen folder itself, a channel folder inside it, or the Roberts Space Industries folder above it.
function normalizeRoot(dir) {
  if (!dir) return null;
  const clean = path.resolve(dir.trim().replace(/^"|"$/g, ''));
  const options = [clean, path.join(clean, 'StarCitizen'), path.dirname(clean)];
  if (CHANNELS.includes(path.basename(clean).toUpperCase())) options.unshift(path.dirname(clean));
  return options.find(isInstallRoot) || null;
}

// The RSI Launcher logs "Launching Star Citizen LIVE from (D:\…\StarCitizen\LIVE)".
function fromLauncherLogs() {
  const dir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'rsilauncher', 'logs');
  const found = [];
  for (const name of ['log.log', 'log.old.log']) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch (e) {
      continue;
    }
    const re = /Launching Star Citizen \S+ from \((.+?)\)|Installing Star Citizen \S+ \S+ at (.+?) \(/g;
    let m;
    while ((m = re.exec(text))) found.push((m[1] || m[2]).replace(/\\\\/g, '\\'));
  }
  return found.reverse();
}

function commonPlaces() {
  const out = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const drive = `${letter}:\\`;
    if (!fs.existsSync(drive)) continue;
    for (const sub of ['Program Files\\Roberts Space Industries\\StarCitizen', 'Roberts Space Industries\\StarCitizen', 'Games\\Roberts Space Industries\\StarCitizen',
      'Program Files (x86)\\Roberts Space Industries\\StarCitizen', 'StarCitizen', 'Games\\StarCitizen']) {
      out.push(path.join(drive, sub));
    }
  }
  return out;
}

function findInstallRoot(configured) {
  const tried = new Set();
  for (const dir of [configured, ...fromLauncherLogs(), ...commonPlaces()]) {
    if (!dir || tried.has(dir.toLowerCase())) continue;
    tried.add(dir.toLowerCase());
    const root = normalizeRoot(dir);
    if (root) return root;
  }
  return null;
}

module.exports = {findInstallRoot, normalizeRoot, isInstallRoot};
