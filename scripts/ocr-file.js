'use strict';
// Runs the overlay reader and parser on screenshot files the way the app does, extra passes included:
//   node scripts/ocr-file.js [--raw] <width> <height> <scale> <threshold> <file...>
const path = require('path');
const readline = require('readline');
const {spawn} = require('child_process');
const {parseCapture} = require('../src/overlay/parse');

const args = process.argv.slice(2);
const raw = args[0] === '--raw' ? args.shift() : null;
const [w, h, scale, threshold, ...files] = args;
const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'src', 'overlay', 'reader.ps1')], {windowsHide: true});
const rl = readline.createInterface({input: ps.stdout});
ps.stderr.on('data', (d) => process.stderr.write(d));
const next = () => new Promise((resolve) => rl.once('line', (l) => resolve(JSON.parse(l))));

(async () => {
  await next();
  for (const f of files) {
    ps.stdin.write(`file ${w} ${h} ${scale} ${threshold} ${f}\n`);
    const r = await next();
    console.log(`=== ${path.basename(f)} (${r.ms} ms)`);
    if (r.error) {
      console.log(r.error);
      continue;
    }
    if (raw) {
      for (const l of r.lines) console.log(`${String(l.y).padStart(4)} ${l.text}`);
      continue;
    }
    const parsed = await parseCapture(r.lines, async (t) => {
      ps.stdin.write(`again ${scale} ${t}\n`);
      const again = await next();
      return again.error ? null : again.lines;
    });
    console.log(JSON.stringify(parsed));
  }
  ps.stdin.write('quit\n');
})();
