/*
 * Genera los íconos de la app a partir de la pose de descanso de un personaje
 * (por defecto Santa): assets/icon.png (256, tray/general), assets/icon-mac.png
 * (1024, macOS) y assets/icon.ico (Windows). Recorta la pose ajustada y la
 * centra con un pequeño margen.
 *
 * Uso:  node scripts/make-icon-santa.js [Nombre]
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const CHAR = process.argv[2] || 'Santa';
const AGENTS_DIR = path.join(__dirname, '..', 'assets', 'agents');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// ── PNG reader (RGBA) ────────────────────────────────────────────────────────
function readPNG(file) {
  const b = fs.readFileSync(file);
  let p = 8, w, h;
  const idatas = [];
  while (p < b.length) {
    const len  = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if      (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    else if (type === 'IDAT') idatas.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw    = zlib.inflateSync(Buffer.concat(idatas));
  const stride = 1 + w * 4;
  const out    = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(w * 4);
  for (let y = 0; y < h; y++) {
    const ft  = raw[y * stride];
    const row = raw.subarray(y * stride + 1, y * stride + 1 + w * 4);
    const cur = Buffer.alloc(w * 4);
    for (let x = 0; x < w * 4; x++) {
      const a  = x >= 4 ? cur[x - 4] : 0;
      const bb = prev[x];
      const c  = x >= 4 ? prev[x - 4] : 0;
      let v = row[x];
      if      (ft === 1) v = (v + a)  & 255;
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

// ── PNG writer (RGBA) ────────────────────────────────────────────────────────
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
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 4)] = 0; rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Elegir pose de descanso (misma prioridad que make-thumbs) ─────────────────
function pickRestFrame(data, sheet, fw, fh) {
  const anims = data.animations || {};
  const opacityAt = (sx, sy) => {
    let n = 0;
    for (let y = 0; y < fh; y += 2) for (let x = 0; x < fw; x += 2) {
      const px = sx + x, py = sy + y;
      if (px < sheet.w && py < sheet.h && sheet.data[(py * sheet.w + px) * 4 + 3] > 0) n++;
    }
    return n;
  };
  const PREF = ['RestPose', 'Idle1_1', 'Idle1_2', 'Idle', 'Greeting', 'Show', 'Hearing_1'];
  const MIN = 60;
  for (const nm of PREF) {
    const a = anims[nm];
    if (!a || !a.frames) continue;
    let bx = 0, by = 0, bn = -1;
    for (const f of a.frames) if (f.images && f.images[0]) {
      const [x, y] = f.images[0]; const n = opacityAt(x, y);
      if (n > bn) { bn = n; bx = x; by = y; }
    }
    if (bn >= MIN) return { x: bx, y: by, src: nm };
  }
  // Fallback: celda más llena de toda la hoja
  const cols = Math.floor(sheet.w / fw), rows = Math.floor(sheet.h / fh);
  let bx = 0, by = 0, bn = -1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const n = opacityAt(c * fw, r * fh); if (n > bn) { bn = n; bx = c * fw; by = r * fh; }
  }
  return { x: bx, y: by, src: 'global' };
}

// ── Recortar bbox opaco dentro de la región (fx,fy,fw,fh) ─────────────────────
function tightBBox(sheet, fx, fy, fw, fh) {
  let minX = fw, minY = fh, maxX = -1, maxY = -1;
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const a = sheet.data[((fy + y) * sheet.w + (fx + x)) * 4 + 3];
    if (a > 16) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return { x: fx, y: fy, w: fw, h: fh };
  return { x: fx + minX, y: fy + minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// ── Componer ícono cuadrado SZ×SZ con margen, nearest-neighbor ────────────────
function makeIcon(sheet, bbox, SZ, marginPct) {
  const out = Buffer.alloc(SZ * SZ * 4);
  const avail = SZ * (1 - 2 * marginPct);
  const scale = Math.min(avail / bbox.w, avail / bbox.h);
  const dstW = Math.round(bbox.w * scale), dstH = Math.round(bbox.h * scale);
  const offX = Math.floor((SZ - dstW) / 2), offY = Math.floor((SZ - dstH) / 2);
  for (let dy = 0; dy < dstH; dy++) for (let dx = 0; dx < dstW; dx++) {
    const sx = Math.min(bbox.w - 1, Math.floor(dx / scale));
    const sy = Math.min(bbox.h - 1, Math.floor(dy / scale));
    const si = ((bbox.y + sy) * sheet.w + (bbox.x + sx)) * 4;
    const di = ((offY + dy) * SZ + (offX + dx)) * 4;
    out[di] = sheet.data[si]; out[di+1] = sheet.data[si+1];
    out[di+2] = sheet.data[si+2]; out[di+3] = sheet.data[si+3];
  }
  return out;
}

// ── ICO con un PNG de 256 embebido ────────────────────────────────────────────
function buildICO(png256) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0); entry.writeUInt8(0, 1); // 0 = 256
  entry.writeUInt8(0, 2); entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png256.length, 8); entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([dir, entry, png256]);
}

// ── Main ─────────────────────────────────────────────────────────────────────
const dir = path.join(AGENTS_DIR, CHAR);
const agentSrc = fs.readFileSync(path.join(dir, 'agent.js'), 'utf8');
const data = JSON.parse(agentSrc.slice(agentSrc.indexOf('{'), agentSrc.lastIndexOf('}') + 1));
const [fw, fh] = data.framesize || [144, 144];
const sheet = readPNG(path.join(dir, 'map.png'));
const rest = pickRestFrame(data, sheet, fw, fh);
const bbox = tightBBox(sheet, rest.x, rest.y, fw, fh);
console.log(`${CHAR}: framesize ${fw}x${fh}, pose "${rest.src}" @(${rest.x},${rest.y}), bbox ${bbox.w}x${bbox.h}`);

// Tray + general (256), Mac (1024)
const icon256  = makeIcon(sheet, bbox, 256, 0.06);
const icon1024 = makeIcon(sheet, bbox, 1024, 0.06);
const png256 = encodePNG(256, 256, icon256);

fs.writeFileSync(path.join(ASSETS_DIR, 'icon.png'), png256);
fs.writeFileSync(path.join(ASSETS_DIR, 'icon-mac.png'), encodePNG(1024, 1024, icon1024));
fs.writeFileSync(path.join(ASSETS_DIR, 'icon.ico'), buildICO(png256));
console.log('Escritos: assets/icon.png (256), assets/icon-mac.png (1024), assets/icon.ico');
