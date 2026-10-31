'use strict';
// Finds every Game.log under the Star Citizen install, parses new or changed ones in parallel, and caches the results.

const fs = require('fs');
const os = require('os');
const path = require('path');
const {Worker} = require('worker_threads');
const {PARSER_VERSION} = require('./parse-log');

function listLogs(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const ch of fs.readdirSync(root, {withFileTypes: true})) {
    if (!ch.isDirectory()) continue;
    const dir = path.join(root, ch.name);
    const current = path.join(dir, 'Game.log');
    if (fs.existsSync(current)) out.push({file: current, channel: ch.name, current: true});
    const backups = path.join(dir, 'logbackups');
    if (fs.existsSync(backups)) {
      for (const f of fs.readdirSync(backups)) {
        if (f.toLowerCase().endsWith('.log')) out.push({file: path.join(backups, f), channel: ch.name, current: false});
      }
    }
  }
  return out;
}

function loadCache(cacheFile) {
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.parser === PARSER_VERSION) return c;
  } catch (e) {
    // no cache yet, or an old format: start over
  }
  return {parser: PARSER_VERSION, files: {}};
}

function saveCache(cacheFile, cache) {
  fs.mkdirSync(path.dirname(cacheFile), {recursive: true});
  const tmp = `${cacheFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, cacheFile);
}

const defaultWorker = () => new Worker(path.join(__dirname, 'worker.js'));

function parseAll(files, onProgress, makeWorker = defaultWorker) {
  return new Promise((resolve) => {
    const results = new Map();
    if (!files.length) return resolve(results);
    const size = Math.max(2, Math.min(8, os.cpus().length - 2, files.length));
    // Biggest files first so one large log doesn't finish last on its own.
    const queue = [...files].sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
    let done = 0;
    let live = size;
    for (let i = 0; i < size; i += 1) {
      const w = makeWorker();
      const next = () => {
        const f = queue.shift();
        if (!f) {
          w.terminate();
          live -= 1;
          if (!live) resolve(results);
          return;
        }
        w.postMessage({file: f});
      };
      w.on('message', (msg) => {
        results.set(msg.file, msg);
        done += 1;
        onProgress(done, files.length);
        next();
      });
      w.on('error', (err) => {
        live -= 1;
        if (!live) resolve(results);
        console.error('worker failed', err);
      });
      next();
    }
  });
}

async function scan({root, cacheFile, onProgress = () => {}, makeWorker}) {
  const cache = loadCache(cacheFile);
  const found = listLogs(root);
  const todo = [];
  for (const f of found) {
    let st;
    try {
      st = fs.statSync(f.file);
    } catch (e) {
      continue;
    }
    const hit = cache.files[f.file];
    if (!hit || hit.size !== st.size || hit.mtimeMs !== st.mtimeMs) todo.push(f.file);
  }
  onProgress(0, todo.length);
  const parsed = await parseAll(todo, onProgress, makeWorker);
  const errors = [];
  for (const [file, msg] of parsed) {
    if (msg.error) errors.push({file, error: msg.error});
    else cache.files[file] = msg.rec;
  }
  const present = new Set(found.map((f) => f.file));
  for (const file of Object.keys(cache.files)) if (!present.has(file)) delete cache.files[file];
  if (parsed.size) saveCache(cacheFile, cache);

  // One record per game session: a log can exist twice (Game.log and its backup copy).
  const byId = new Map();
  const meta = new Map(found.map((f) => [f.file, f]));
  for (const rec of Object.values(cache.files)) {
    if (!rec.start) continue;
    const info = meta.get(rec.file) || {};
    const key = rec.id || `${rec.start}|${rec.file}`;
    const prev = byId.get(key);
    if (!prev || rec.size > prev.size) byId.set(key, {...rec, channel: info.channel, current: !!info.current});
  }
  const sessions = [...byId.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
  return {sessions, parsedNow: parsed.size, errors, files: found.length};
}

module.exports = {scan, listLogs};
