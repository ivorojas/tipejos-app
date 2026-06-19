/*
 * Corrección puntual de color: intercambia los canales R y B de map.png y
 * thumb.png de los personajes convertidos desde .acs (el converter viejo los
 * generó con R/B invertidos respecto al RGBQUAD de Windows).
 *
 * Solo toca personajes que tienen un .acs fuente correspondiente (los ACS-
 * convertidos); NO toca los 10 originales de ClippyJS (que ya tienen color
 * correcto porque vienen de PNGs).
 *
 * Es una operación de UNA sola vez. El converter ya quedó arreglado para futuras
 * conversiones, así que no volver a correr esto sobre map.png ya regenerados.
 *
 * Uso:  node scripts/fix-colors.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const AGENTS_DIR = path.join(__dirname, '..', 'assets', 'agents');
const ACS_DIR    = path.join(__dirname, '..', 'acs-source');

// ── PNG read/write (RGBA) ─────────────────────────────────────────────────────
function readPNG(file) {
  const b = fs.readFileSync(file);
  let p = 8, w, h;
  const idatas = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    else if (type === 'IDAT') idatas.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idatas));
  const stride = 1 + w * 4;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(w * 4);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * stride];
    const row = raw.subarray(y * stride + 1, y * stride + 1 + w * 4);
    const cur = Buffer.alloc(w * 4);
    for (let x = 0; x < w * 4; x++) {
      const a = x >= 4 ? cur[x - 4] : 0;
      const bb = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let v = row[x];
      if      (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + bb) & 255;
      else if (ft === 3) v = (v + ((a + bb) >> 1)) & 255;
      else if (ft === 4) {
        const pa = Math.abs(bb - c), pb = Math.abs(a - c), pc = Math.abs(a + bb - 2 * c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? bb : c;
        v = (v + pr) & 255;
      }
      cur[x] = v;
    }
    cur.copy(out, y * w * 4);
    prev = cur;
  }
  return { w, h, data: out };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) {
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const cc = Buffer.alloc(4); cc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([l, t, data, cc]);
}
function writePNG(file, w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 4)] = 0; rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function swapRB(file) {
  if (!fs.existsSync(file)) return false;
  const { w, h, data } = readPNG(file);
  for (let i = 0; i < data.length; i += 4) { const t = data[i]; data[i] = data[i + 2]; data[i + 2] = t; }
  writePNG(file, w, h, data);
  return true;
}

function hasAcs(name) {
  const files = fs.readdirSync(ACS_DIR).filter((f) => /\.acs$/i.test(f));
  return files.some((f) => path.basename(f, path.extname(f)).toLowerCase() === name.toLowerCase());
}

// ── Main ──────────────────────────────────────────────────────────────────────
const names = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name).sort();

let fixed = 0, skipped = 0;
for (const name of names) {
  if (!hasAcs(name)) { skipped++; continue; } // original ClippyJS → color ya correcto
  const m = swapRB(path.join(AGENTS_DIR, name, 'map.png'));
  swapRB(path.join(AGENTS_DIR, name, 'thumb.png'));
  if (m) { fixed++; process.stdout.write(`✓ ${name}\n`); }
}
console.log(`\n${fixed} personajes ACS corregidos (R↔B), ${skipped} originales sin tocar.`);
