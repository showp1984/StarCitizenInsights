'use strict';
// Builds dist/StarCitizenInsights.exe: Node itself with the app packed inside (Node's single executable
// application feature), the app icon, version info, no console window. Run: npm run build

const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const esbuild = require('esbuild');
const {inject} = require('postject');
const rcedit = require('rcedit');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const DIST = path.join(ROOT, 'dist');
const EXE = path.join(DIST, 'StarCitizenInsights.exe');
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function step(msg) {
  console.log(`- ${msg}`);
}

// node.exe is signed by the Node.js project; changing it breaks that signature, so remove it instead of shipping a broken one.
function stripSignature(buf) {
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('not a PE file');
  const opt = pe + 24;
  if (buf.readUInt16LE(opt) !== 0x20b) throw new Error('expected a 64-bit executable');
  const dirEntry = opt + 112 + 4 * 8; // data directory 4: certificate table
  const offset = buf.readUInt32LE(dirEntry);
  const size = buf.readUInt32LE(dirEntry + 4);
  buf.writeUInt32LE(0, dirEntry);
  buf.writeUInt32LE(0, dirEntry + 4);
  return offset && offset + size === buf.length ? buf.subarray(0, offset) : buf;
}

// Windows GUI subsystem: double-clicking the .exe opens no console window.
function setGuiSubsystem(file) {
  const buf = fs.readFileSync(file);
  const pe = buf.readUInt32LE(0x3c);
  buf.writeUInt16LE(2, pe + 24 + 68);
  fs.writeFileSync(file, buf);
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

(async () => {
  fs.rmSync(BUILD, {recursive: true, force: true});
  fs.mkdirSync(BUILD, {recursive: true});
  fs.mkdirSync(DIST, {recursive: true});

  step('bundling the server and the log parser');
  const common = {bundle: true, platform: 'node', target: 'node22', format: 'cjs', legalComments: 'none', logLevel: 'warning'};
  await esbuild.build({...common, entryPoints: [path.join(ROOT, 'src', 'server.js')], outfile: path.join(BUILD, 'server.js')});
  await esbuild.build({...common, entryPoints: [path.join(ROOT, 'src', 'worker.js')], outfile: path.join(BUILD, 'worker.js')});

  step('packing the app files');
  const assets = {'worker.js': path.join(BUILD, 'worker.js'), 'vendor/d3.min.js': path.join(ROOT, 'node_modules', 'd3', 'dist', 'd3.min.js'), 'overlay/reader.ps1': path.join(ROOT, 'src', 'overlay', 'reader.ps1')};
  for (const rel of listFiles(path.join(ROOT, 'public'))) assets[rel] = path.join(ROOT, 'public', rel);
  const seaConfig = {main: path.join(BUILD, 'server.js'), output: path.join(BUILD, 'sea-prep.blob'), disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false, assets};
  fs.writeFileSync(path.join(BUILD, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', path.join(BUILD, 'sea-config.json')], {stdio: 'inherit'});

  step(`copying Node ${process.version} and removing its signature`);
  fs.rmSync(EXE, {force: true});
  fs.writeFileSync(EXE, stripSignature(fs.readFileSync(process.execPath)));

  step('setting the icon and version info');
  const version = `${pkg.version}.0`;
  await rcedit(EXE, {
    icon: path.join(ROOT, 'public', 'app.ico'),
    'file-version': version,
    'product-version': version,
    'version-string': {
      ProductName: 'Star Citizen Insights',
      FileDescription: 'Star Citizen Insights (unofficial fan tool)',
      CompanyName: 'Star Citizen Insights',
      LegalCopyright: 'Unofficial fan project, not affiliated with the Cloud Imperium group of companies',
      OriginalFilename: 'StarCitizenInsights.exe',
      InternalName: 'StarCitizenInsights',
    },
  });

  step('injecting the app');
  await inject(EXE, 'NODE_SEA_BLOB', fs.readFileSync(seaConfig.output), {sentinelFuse: FUSE});

  step('hiding the console window');
  setGuiSubsystem(EXE);

  const mb = (fs.statSync(EXE).size / 1048576).toFixed(1);
  console.log(`\nBuilt ${path.relative(ROOT, EXE)} (${mb} MB, version ${pkg.version})`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
