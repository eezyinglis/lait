// Renders the LAIT icon (same shapes as public/icon.svg) to PNGs without any image library.
// iOS needs a PNG apple-touch-icon; the manifest wants 192/512.
import fs from 'node:fs';
import zlib from 'node:zlib';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function render(size, rounded) {
  const s = size / 512, SS = 4; // 4x4 supersampling for smooth edges
  const blue = [59, 139, 255], white = [242, 242, 247];
  const distSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  const inRounded = (x, y) => {
    const r = 112;
    const cx = Math.min(Math.max(x, r), 512 - r), cy = Math.min(Math.max(y, r), 512 - r);
    return Math.hypot(x - cx, y - cy) <= r;
  };
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = (x + (sx + 0.5) / SS) / s, py = (y + (sy + 0.5) / SS) / s;
        if (rounded && !inRounded(px, py)) continue;
        let col = [0, 0, 0];
        if (Math.min(distSeg(px, py, 176, 128, 176, 384), distSeg(px, py, 176, 384, 344, 384)) <= 28) col = blue;
        if (Math.hypot(px - 344, py - 168) <= 36) col = white;
        r += col[0]; g += col[1]; b += col[2]; a += 255;
      }
      const n = SS * SS, o = y * (size * 4 + 1) + 1 + x * 4;
      const cov = a / 255;
      raw[o] = cov ? Math.round(r / cov) : 0; raw[o + 1] = cov ? Math.round(g / cov) : 0; raw[o + 2] = cov ? Math.round(b / cov) : 0;
      raw[o + 3] = Math.round(a / n);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// iOS applies its own rounded mask, so the touch icon and maskable icon are full-bleed squares.
fs.writeFileSync('public/apple-touch-icon.png', render(180, false));
fs.writeFileSync('public/icon-192.png', render(192, true));
fs.writeFileSync('public/icon-512.png', render(512, false));
console.log('icons written');
