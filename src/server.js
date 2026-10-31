'use strict';
// Local web server for Star Citizen Insights. Binds to 127.0.0.1 only.
// From source:  node src/server.js [--open] [--exit-when-idle] [--port 4317] [--root "D:\...\StarCitizen"]
// As the .exe:  opens its own window and quits after the last window closes.

const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const {spawn, execFile} = require('child_process');
const {Worker} = require('worker_threads');
const sea = require('node:sea');
const {scan} = require('./scan');
const {findInstallRoot, normalizeRoot} = require('./locate');
const {LiveSession, displayInfoSetting} = require('./live');
const {OverlayMonitor, REGION} = require('./overlay/monitor');

const {version: VERSION} = require('../package.json');
const IS_EXE = sea.isSea();
const SOURCE_DIR = path.join(__dirname, '..');
const DATA_DIR = process.env.SCI_DATA_DIR
  || (IS_EXE ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'StarCitizenInsights') : path.join(SOURCE_DIR, 'data'));
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
fs.mkdirSync(DATA_DIR, {recursive: true});

// The .exe has no console, so keep a small log file next to the data.
if (IS_EXE) {
  const logFile = path.join(DATA_DIR, 'app.log');
  try {
    if (fs.statSync(logFile).size > 1e6) fs.unlinkSync(logFile);
  } catch (e) {
    // no log yet
  }
  const write = (level) => (...a) => fs.appendFileSync(logFile, `${new Date().toISOString()} ${level} ${a.map(String).join(' ')}\n`);
  console.log = write('info');
  console.error = write('error');
  process.on('uncaughtException', (err) => console.error(err && err.stack || err));
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}
function saveConfig(patch) {
  const next = {...loadConfig(), ...patch};
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

const config = loadConfig();
const port = Number(opt('--port', config.port || 4317));
const url = `http://127.0.0.1:${port}/`;
const openOnStart = IS_EXE ? !flag('--no-open') : flag('--open');
const exitWhenIdle = IS_EXE || flag('--exit-when-idle');
// SCI_NO_DETECT=1 skips auto-detection, to try the first-run folder picker.
let root = normalizeRoot(opt('--root', '')) || (process.env.SCI_NO_DETECT ? null : findInstallRoot(config.installRoot));

// ---------- live session and overlay reading
const OVERLAY_DEFAULTS = {enabled: true, intervalSec: 15, debug: false};
const overlaySettings = () => ({...OVERLAY_DEFAULTS, ...(loadConfig().overlay || {})});

// PowerShell needs the reader as a file; inside the .exe it is unpacked next to the data.
function readerScriptPath() {
  if (!IS_EXE) return path.join(__dirname, 'overlay', 'reader.ps1');
  const target = path.join(DATA_DIR, 'reader.ps1');
  const body = Buffer.from(sea.getAsset('overlay/reader.ps1'));
  let current = null;
  try {
    current = fs.readFileSync(target);
  } catch (e) {
    // first run
  }
  if (!current || !current.equals(body)) fs.writeFileSync(target, body);
  return target;
}

const live = new LiveSession(() => root);
const monitor = new OverlayMonitor({
  dataDir: DATA_DIR,
  readerScript: readerScriptPath(),
  getContext: () => live.context(),
  getSettings: overlaySettings,
});

function livePayload() {
  const session = live.summary();
  const ctx = live.context();
  const sinceSession = session ? session.start : null;
  const threeHours = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 19);
  const key = session ? session.id || session.start : null;
  return {
    now: new Date().toISOString().slice(0, 19),
    overlay: {...monitor.status, settings: overlaySettings(), region: REGION},
    session,
    context: ctx,
    displayInfo: displayInfoSetting(root, session && session.channel),
    // This session's readings, plus anything from the same shard in the last 3 hours (a relog lands there again).
    readings: monitor.readings.filter((r) => (key && r.session === key) || (r.t >= threeHours && (!ctx || !ctx.shard || r.shard === ctx.shard))),
    sinceSession,
  };
}

// ---------- files the page needs, from disk or from inside the .exe
function readAsset(rel) {
  if (IS_EXE) {
    try {
      return Buffer.from(sea.getAsset(rel));
    } catch (e) {
      return null;
    }
  }
  const publicDir = path.join(SOURCE_DIR, 'public');
  const file = rel === 'vendor/d3.min.js'
    ? path.join(SOURCE_DIR, 'node_modules', 'd3', 'dist', 'd3.min.js')
    : path.normalize(path.join(publicDir, rel));
  if (rel !== 'vendor/d3.min.js' && !file.startsWith(publicDir)) return null;
  try {
    return fs.readFileSync(file);
  } catch (e) {
    return null;
  }
}

const makeWorker = IS_EXE
  ? () => new Worker(sea.getAsset('worker.js', 'utf8'), {eval: true})
  : () => new Worker(path.join(__dirname, 'worker.js'));

// ---------- scanning
const state = {scanning: false, done: 0, total: 0, startedAt: null, finishedAt: null, error: null, files: 0, parsedNow: 0};
let sessions = [];
let payloadCache = null;

async function runScan() {
  if (state.scanning) return;
  Object.assign(state, {scanning: true, done: 0, total: 0, startedAt: new Date().toISOString(), error: null});
  try {
    if (!root) {
      sessions = [];
      state.files = 0;
      return;
    }
    const r = await scan({
      root,
      cacheFile: path.join(DATA_DIR, 'cache.json'),
      makeWorker,
      onProgress: (done, total) => Object.assign(state, {done, total}),
    });
    sessions = r.sessions;
    Object.assign(state, {files: r.files, parsedNow: r.parsedNow, error: r.errors.length ? `${r.errors.length} logs could not be read` : null});
  } catch (err) {
    state.error = String(err && err.message || err);
    console.error('scan failed', err && err.stack || err);
  } finally {
    payloadCache = null;
    state.scanning = false;
    state.finishedAt = new Date().toISOString();
  }
}

function setRoot(dir) {
  const next = normalizeRoot(dir);
  if (!next) return null;
  root = next;
  saveConfig({installRoot: next});
  runScan();
  return next;
}

// Native Windows folder picker, shown on top of the app window.
function pickFolder() {
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$owner = New-Object System.Windows.Forms.Form -Property @{TopMost = $true}',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = 'Select your StarCitizen folder (the one that holds LIVE and PTU)'",
    '$d.ShowNewFolderButton = $false',
    "if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }",
  ].join('; ');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], {windowsHide: true, timeout: 600000}, (err, stdout) => resolve(err ? null : stdout.trim() || null));
  });
}

// Everything the UI needs for charts; per-session timelines are fetched on demand.
function payload() {
  if (payloadCache) return payloadCache;
  const nicks = {};
  for (const s of sessions) if (s.nick) nicks[s.nick] = (nicks[s.nick] || 0) + 1;
  const body = JSON.stringify({
    generatedAt: state.finishedAt,
    root,
    nick: Object.entries(nicks).sort((a, b) => b[1] - a[1]).map(([n]) => n)[0] || null,
    sessions: sessions.map(({timeline, file, ...rest}) => ({...rest, fileName: path.basename(file), timelineLength: timeline.length})),
  });
  payloadCache = {json: body, gz: zlib.gzipSync(body)};
  return payloadCache;
}

// ---------- http
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png'};

function send(res, status, body, type) {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store'});
  res.end(body);
}
function sendJson(res, req, obj, status = 200) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  if (body.length > 50000 && /gzip/.test(req.headers['accept-encoding'] || '')) {
    res.writeHead(status, {'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store'});
    return res.end(zlib.gzipSync(body));
  }
  return send(res, status, body, 'application/json');
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (e) {
        resolve({});
      }
    });
  });
}

let lastPing = Date.now();
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

const server = http.createServer(async (req, res) => {
  // Only answer requests addressed to this app, so other web pages can't reach it through a rebound host name.
  if (!allowedHosts.has(req.headers.host || '')) return send(res, 403, 'Forbidden', 'text/plain');
  if (req.method !== 'GET' && req.headers.origin && !allowedHosts.has(req.headers.origin.replace(/^https?:\/\//, ''))) return send(res, 403, 'Forbidden', 'text/plain');
  const u = new URL(req.url, url);
  const p = u.pathname;
  lastPing = Date.now();

  if (p === '/api/status') return sendJson(res, req, {...state, root, notFound: !root, sessions: sessions.length, version: VERSION, dataDir: DATA_DIR});
  if (p === '/api/ping') return sendJson(res, req, {ok: true});
  if (p === '/api/data') {
    const pl = payload();
    if (/gzip/.test(req.headers['accept-encoding'] || '')) {
      res.writeHead(200, {'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store'});
      return res.end(pl.gz);
    }
    return send(res, 200, pl.json, 'application/json');
  }
  if (p === '/api/session') {
    const id = u.searchParams.get('id');
    const s = sessions.find((x) => (x.id || x.start) === id);
    if (!s) return sendJson(res, req, {error: 'No such session'}, 404);
    const {file, ...rest} = s;
    return sendJson(res, req, {...rest, fileName: path.basename(file)});
  }
  if (p === '/api/live') return sendJson(res, req, livePayload());
  if (p === '/api/readings') return sendJson(res, req, {readings: monitor.readings});
  if (p === '/api/overlay' && req.method === 'POST') {
    const body = await readBody(req);
    const next = {...overlaySettings()};
    if (typeof body.enabled === 'boolean') next.enabled = body.enabled;
    if (Number.isFinite(body.intervalSec)) next.intervalSec = Math.min(120, Math.max(10, Math.round(body.intervalSec)));
    saveConfig({overlay: next});
    return sendJson(res, req, {settings: next});
  }
  if (p === '/api/rescan' && req.method === 'POST') {
    runScan();
    return sendJson(res, req, {...state, scanning: true});
  }
  if (p === '/api/folder' && req.method === 'POST') {
    const body = await readBody(req);
    const chosen = body.pick ? await pickFolder() : body.installRoot;
    if (!chosen) return sendJson(res, req, {cancelled: true});
    const set = setRoot(chosen);
    if (!set) return sendJson(res, req, {error: `No Star Citizen logs in ${chosen}. Pick the StarCitizen folder that holds LIVE and PTU.`}, 400);
    return sendJson(res, req, {root: set});
  }

  const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
  if (rel.includes('..')) return send(res, 403, 'Forbidden', 'text/plain');
  const buf = readAsset(rel);
  if (!buf) return send(res, 404, 'Not found', 'text/plain');
  return send(res, 200, buf, TYPES[path.extname(rel)] || 'application/octet-stream');
});

function edgePath() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return candidates.find((c) => fs.existsSync(c));
}

// Opens the app in its own Edge window (separate profile, no tabs or address bar); falls back to the default browser.
function openWindow() {
  const edge = edgePath();
  if (edge) {
    const profile = path.join(DATA_DIR, 'window-profile');
    spawn(edge, [`--app=${url}`, `--user-data-dir=${profile}`, '--window-size=1500,960', '--no-first-run', '--no-default-browser-check'], {detached: true, stdio: 'ignore'}).unref();
  } else {
    spawn('cmd', ['/c', 'start', '', url], {detached: true, stdio: 'ignore', windowsHide: true}).unref();
  }
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Already running: just bring up a window.
    if (openOnStart) openWindow();
    console.log(`Star Citizen Insights is already running at ${url}`);
    setTimeout(() => process.exit(0), 500);
  } else {
    console.error(err);
    process.exit(1);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Star Citizen Insights ${VERSION} running at ${url}`);
  console.log(root ? `Reading logs from ${root}` : 'Star Citizen folder not found yet; the app will ask for it.');
  console.log(`Data folder: ${DATA_DIR}`);
  runScan();
  live.start();
  monitor.start();
  if (openOnStart) openWindow();
  if (exitWhenIdle) {
    // The page pings every 20 s; quit a while after the last window closes, but keep reading while the game runs.
    setInterval(() => {
      const playing = !['no-game', 'off', 'starting'].includes(monitor.status.state);
      if (!state.scanning && !playing && Date.now() - lastPing > 120000) process.exit(0);
    }, 15000);
  }
});
