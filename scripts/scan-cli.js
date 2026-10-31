'use strict';
// Runs a scan from the command line and prints a short summary (node scripts/scan-cli.js [installRoot]).
const path = require('path');
const {scan} = require('../src/scan');

const root = process.argv[2] || 'C:\\Program Files\\Roberts Space Industries\\StarCitizen';
const cacheFile = path.join(__dirname, '..', 'data', 'cache.json');
const t0 = Date.now();
let last = 0;
scan({
  root, cacheFile,
  onProgress: (done, total) => {
    if (Date.now() - last > 2000 || done === total) {
      last = Date.now();
      process.stdout.write(`parsed ${done}/${total}\n`);
    }
  },
}).then((r) => {
  const s = r.sessions;
  const sum = (f) => s.reduce((a, x) => a + f(x), 0);
  console.log(`files=${r.files} parsedNow=${r.parsedNow} errors=${r.errors.length} sessions=${s.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('env', JSON.stringify(s.reduce((a, x) => ({...a, [x.env]: (a[x.env] || 0) + 1}), {})));
  console.log('hours', Math.round(sum((x) => x.minutes) / 60));
  console.log('exit', JSON.stringify(s.reduce((a, x) => ({...a, [x.exit]: (a[x.exit] || 0) + 1}), {})));
  console.log('crash types', JSON.stringify(s.filter((x) => x.crash).reduce((a, x) => ({...a, [x.crash.type]: (a[x.crash.type] || 0) + 1}), {})));
  console.log('kills', sum((x) => x.kills.length), 'deaths', sum((x) => x.deaths.length), 'vdest', sum((x) => x.vdest.length));
  console.log('flights', sum((x) => x.flights.length), 'profiles', sum((x) => x.profiles.length), 'contracts', sum((x) => x.contracts.length), 'shop', sum((x) => x.shop.length));
  console.log('renderer', JSON.stringify(s.reduce((a, x) => ({...a, [x.renderer]: (a[x.renderer] || 0) + 1}), {})));
  console.log('channels', JSON.stringify(s.reduce((a, x) => ({...a, [x.channel]: (a[x.channel] || 0) + 1}), {})));
  if (r.errors.length) console.log(r.errors.slice(0, 5));
});
