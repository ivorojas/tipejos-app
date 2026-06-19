/*
 * Genera assets/agents/<Name>/thumb.png (80×80) para cada personaje.
 * Para los personajes ACS usa el cell 0 del map.png (ya reordenado por opacidad).
 * Para los personajes clippy.js originales usa la primera imagen del primer frame
 * de la animación "Idle" (o cualquier animación disponible).
 *
 * Uso: node scripts/make-thumbs.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const AGENTS_DIR = path.join(__dirname, '..', 'assets', 'agents');
const THUMB_SIZE = 80;

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
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const cc = Buffer.alloc(4); cc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([l, t, data, cc]);
}
function writePNG(file, w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

// ── Escalar + recortar region (srcX,srcY,srcW,srcH) → thumb de outSz×outSz ──
function makeThumb(sheet, sheetW, srcX, srcY, srcW, srcH) {
  const SZ  = THUMB_SIZE;
  const out = Buffer.alloc(SZ * SZ * 4);

  // Conteo de opacos en la celda para saber si es válida
  let opaques = 0;
  for (let y = 0; y < srcH; y++)
    for (let x = 0; x < srcW; x++)
      if (sheet[((srcY + y) * sheetW + (srcX + x)) * 4 + 3] > 0) opaques++;

  // Centrar manteniendo aspect ratio dentro del cuadrado SZ×SZ
  const scale  = Math.min(SZ / srcW, SZ / srcH);
  const dstW   = Math.round(srcW * scale);
  const dstH   = Math.round(srcH * scale);
  const offX   = Math.floor((SZ - dstW) / 2);
  const offY   = Math.floor((SZ - dstH) / 2);

  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.floor(dx / scale);
      const sy = Math.floor(dy / scale);
      const si = ((srcY + sy) * sheetW + (srcX + sx)) * 4;
      const di = ((offY + dy) * SZ    + (offX + dx))  * 4;
      out[di]   = sheet[si];
      out[di+1] = sheet[si+1];
      out[di+2] = sheet[si+2];
      out[di+3] = sheet[si+3];
    }
  }
  return { thumb: out, opaques };
}

// ── Procesar un personaje ────────────────────────────────────────────────────
function processAgent(name) {
  const dir      = path.join(AGENTS_DIR, name);
  const mapFile  = path.join(dir, 'map.png');
  const agentFile = path.join(dir, 'agent.js');
  const thumbFile = path.join(dir, 'thumb.png');

  if (!fs.existsSync(mapFile) || !fs.existsSync(agentFile)) return 'skip (sin archivos)';

  // Parsear agent.js para obtener framesize y primer frame
  const src = fs.readFileSync(agentFile, 'utf8');
  let data;
  try {
    const json = src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1);
    data = JSON.parse(json);
  } catch { return 'error (JSON inválido)'; }

  const [fw, fh] = data.framesize || [124, 93];
  const sheet    = readPNG(mapFile);

  // Buscar el primer frame no-vacío: recorre las primeras N celdas
  const cols  = Math.floor(sheet.w / fw);
  const rows  = Math.floor(sheet.h / fh);
  let bestX = 0, bestY = 0, bestN = 0;
  for (let row = 0; row < Math.min(rows, 10); row++) {
    for (let col = 0; col < cols; col++) {
      let n = 0;
      const sx = col * fw, sy = row * fh;
      for (let y = 0; y < fh; y += 2)
        for (let x = 0; x < fw; x += 2)
          if (sheet.data[((sy + y) * sheet.w + (sx + x)) * 4 + 3] > 0) n++;
      if (n > bestN) { bestN = n; bestX = sx; bestY = sy; }
    }
  }

  const { thumb } = makeThumb(sheet.data, sheet.w, bestX, bestY, fw, fh);
  writePNG(thumbFile, THUMB_SIZE, THUMB_SIZE, thumb);
  return `OK (${fw}×${fh}, ${bestN} opacos)`;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const agents = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name).sort();

let ok = 0, err = 0;
for (const name of agents) {
  const result = processAgent(name);
  if (result.startsWith('OK')) { ok++; process.stdout.write(`✓ ${name.padEnd(16)} ${result}\n`); }
  else { err++; process.stdout.write(`✗ ${name.padEnd(16)} ${result}\n`); }
}
console.log(`\n${ok} OK, ${err} errores`);
