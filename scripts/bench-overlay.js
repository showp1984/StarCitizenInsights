'use strict';
// Times the overlay reader: start-up, then repeated reads of a screen region (node scripts/bench-overlay.js).
const path = require('path');
const readline = require('readline');
const {spawn} = require('child_process');

const regions = [
  ['right 40% x top 45%, 2x', '0.6 0 0.4 0.45 2'],
  ['right 30% x top 30%, 2x', '0.7 0 0.3 0.3 2'],
  ['right 30% x top 30%, 1.5x', '0.7 0 0.3 0.3 1.5'],
];
const RUNS = 8;

const t0 = Date.now();
const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'src', 'overlay', 'reader.ps1')], {windowsHide: true});
const rl = readline.createInterface({input: ps.stdout});
ps.stderr.on('data', (d) => process.stderr.write(d));
const next = () => new Promise((resolve) => rl.once('line', (l) => resolve(JSON.parse(l))));

(async () => {
  const ready = await next();
  console.log(`start-up: ${Date.now() - t0} ms (ocr engine: ${ready.ocr})`);
  for (const [label, args] of regions) {
    const res = [];
    for (let i = 0; i < RUNS; i += 1) {
      ps.stdin.write(`bench ${args}\n`);
      res.push(await next());
    }
    if (res[0].error) { console.log(label, res[0].error); continue; }
    const warm = res.slice(1);
    const avg = (k) => Math.round(warm.reduce((a, r) => a + r[k], 0) / warm.length);
    console.log(`${label} (${res[0].window} screen): ${avg('ms')} ms per read, ${avg('cpuMs')} ms CPU, ${res[res.length - 1].memMB} MB memory, first read ${res[0].ms} ms, ${res[0].lines.length} text lines`);
  }
  ps.stdin.write('quit\n');
})();
