'use strict';
// Writes public/app.ico: the amber chevron mark on a dark round badge, at 16, 32, 48 and 256 px.
const fs = require('fs');
const path = require('path');

const BG = [0x0b, 0x10, 0x16];
const RING = [0x22, 0x30, 0x3e];
const ACCENT = [0xf2, 0xa6, 0x3b];

// Mark from the app header, in a 32-unit box: M5 21 L16 6 L27 21 L16 16.5 Z
const MARK = [[5, 21], [16, 6], [27, 21], [16, 16.5]];

function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// 4x4 supersampling for smooth edges.
function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const s = size / 32;
  const mark = MARK.map(([x, y]) => [x * s, (y + 2.5) * s]);
  const r = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let a = 0;
      let m = 0;
      let ring = 0;
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          const fx = x + (sx + 0.5) / 4;
          const fy = y + (sy + 0.5) / 4;
          const d = Math.hypot(fx - r, fy - r);
          if (d <= r - 0.5) {
            a += 1;
            if (d > r - 0.5 - Math.max(1, size / 32)) ring += 1;
            if (inside(mark, fx, fy)) m += 1;
          }
        }
      }
      const i = ((size - 1 - y) * size + x) * 4; // BMP rows run bottom-up
      const cov = a / 16;
      const mk = a ? m / a : 0;
      const rg = a ? ring / a : 0;
      const col = [0, 1, 2].map((c) => BG[c] * (1 - mk - rg) + ACCENT[c] * mk + RING[c] * rg);
      px[i] = Math.round(col[2]);
      px[i + 1] = Math.round(col[1]);
      px[i + 2] = Math.round(col[0]);
      px[i + 3] = Math.round(cov * 255);
    }
  }
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND masks
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(px.length, 20);
  const andMask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
  return Buffer.concat([header, px, andMask]);
}

const sizes = [16, 32, 48, 256];
const images = sizes.map(render);
const dir = Buffer.alloc(6 + 16 * sizes.length);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(sizes.length, 4);
let offset = dir.length;
sizes.forEach((size, i) => {
  const e = 6 + i * 16;
  dir.writeUInt8(size >= 256 ? 0 : size, e);
  dir.writeUInt8(size >= 256 ? 0 : size, e + 1);
  dir.writeUInt16LE(1, e + 4);
  dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(images[i].length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
const out = path.join(__dirname, '..', 'public', 'app.ico');
fs.writeFileSync(out, Buffer.concat([dir, ...images]));
console.log(`wrote ${out}`);
