/**
 * upscale-2x.js — genera versiones de doble resolución (map@2x.png) de los
 * sprites usando Scale2x/EPX (algoritmo clásico de upscaling de pixel art,
 * determinístico, sin IA y sin dependencias externas).
 *
 * NO modifica los map.png originales: solo crea un archivo nuevo map@2x.png
 * al lado. El renderer lo usa automáticamente si existe; si lo borrás, vuelve
 * al original. Para mayor seguridad también copia el original a
 * map.orig-backup.png la primera vez.
 *
 * Uso:
 *   node scripts/upscale-2x.js                  → personajes conocidos (lista FAMOUS)
 *   node scripts/upscale-2x.js Clippy Genie     → personajes específicos
 *   node scripts/upscale-2x.js --all            → todos
 *   node scripts/upscale-2x.js --revert         → borra todos los map@2x.png
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const AGENTS_DIR = path.join(__dirname, '..', 'assets', 'agents');

// Personajes más conocidos (prueba inicial).
const FAMOUS = ['Clippy', 'Merlin', 'Genie', 'Rover', 'Links', 'Peedy', 'Bonzi', 'Dot'];

// ─── Lector de PNG (colorType 3 paleta + tRNS, o 6 RGBA) ──────────────────────
function parsePNGChunks(buf) {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error('No es un PNG válido');
  const chunks = [];
  let pos = 8;
  while (pos < buf.length - 4) {
    const len  = buf.readUInt32BE(pos); pos += 4;
    const type = buf.toString('ascii', pos, pos + 4); pos += 4;
    const data = buf.slice(pos, pos + len); pos += len + 4;
    chunks.push({ type, data });
    if (type === 'IEND') break;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function defilter(raw, width, channels) {
  const stride   = width * channels;
  const rowCount = raw.length / (stride + 1);
  const out      = Buffer.alloc(rowCount * stride);
  let rawOff = 0, outOff = 0;
  for (let y = 0; y < rowCount; y++) {
    const filter = raw[rawOff++];
    for (let x = 0; x < stride; x++) {
      const byte = raw[rawOff++];
      const xPx  = (x / channels) | 0;
      const a = (xPx > 0)            ? out[outOff + x - channels]         : 0;
      const b = (y   > 0)            ? out[outOff - stride + x]           : 0;
      const c = (xPx > 0 && y > 0)   ? out[outOff - stride + x - channels]: 0;
      switch (filter) {
        case 0: out[outOff + x] = byte; break;
        case 1: out[outOff + x] = (byte + a) & 0xFF; break;
        case 2: out[outOff + x] = (byte + b) & 0xFF; break;
        case 3: out[outOff + x] = (byte + ((a + b) >> 1)) & 0xFF; break;
        case 4: out[outOff + x] = (byte + paeth(a, b, c)) & 0xFF; break;
        default: throw new Error('Filtro PNG desconocido: ' + filter);
      }
    }
    outOff += stride;
  }
  return out;
}

function readPNG(buf) {
  const chunks  = parsePNGChunks(buf);
  const ihdr    = chunks.find(c => c.type === 'IHDR').data;
  const width   = ihdr.readUInt32BE(0);
  const height  = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8], colorType = ihdr[9], interlace = ihdr[12];
  if (bitDepth !== 8) throw new Error('Solo bit depth 8');
  if (interlace !== 0) throw new Error('Interlacing no soportado');
  const idats = Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data));
  const raw   = zlib.inflateSync(idats);

  if (colorType === 6) return { width, height, data: defilter(raw, width, 4) };
  if (colorType !== 3) throw new Error('colorType no soportado: ' + colorType);

  const plte = chunks.find(c => c.type === 'PLTE').data;
  const trns = chunks.find(c => c.type === 'tRNS');
  const trnsData = trns ? trns.data : Buffer.alloc(0);
  const indices  = defilter(raw, width, 1);
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const idx = indices[i];
    rgba[i * 4]     = plte[idx * 3];
    rgba[i * 4 + 1] = plte[idx * 3 + 1];
    rgba[i * 4 + 2] = plte[idx * 3 + 2];
    rgba[i * 4 + 3] = idx < trnsData.length ? trnsData[idx] : 255;
  }
  return { width, height, data: rgba };
}

// ─── Escritor PNG RGBA ────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf  = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf  = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}
function writePNG_RGBA(width, height, data) {
  const stride  = width * 4;
  const rawRows = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    rawRows[y * (stride + 1)] = 0;
    data.copy(rawRows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(rawRows, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Scale2x / EPX ────────────────────────────────────────────────────────────
// Para cada pixel P con vecinos B(arriba) D(izq) F(der) H(abajo) genera 4 px.
// Solo copia colores existentes (no inventa colores) → sin artefactos.
function scale2x({ width: w, height: h, data: src }) {
  const dw = w * 2, dh = h * 2;
  const dst = Buffer.alloc(dw * dh * 4);

  const key = (x, y) => {
    if (x < 0) x = 0; else if (x >= w) x = w - 1;
    if (y < 0) y = 0; else if (y >= h) y = h - 1;
    const i = (y * w + x) * 4;
    return ((src[i] << 24) | (src[i + 1] << 16) | (src[i + 2] << 8) | src[i + 3]);
  };
  const copy = (sx, sy, dx, dy) => {
    if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
    if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
    const si = (sy * w + sx) * 4, di = (dy * dw + dx) * 4;
    dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const B = key(x, y - 1), D = key(x - 1, y), F = key(x + 1, y), H = key(x, y + 1);
      // por defecto los 4 subpíxeles = P
      let s0x = x, s0y = y, s1x = x, s1y = y, s2x = x, s2y = y, s3x = x, s3y = y;
      if (B !== H && D !== F) {
        if (D === B) { s0x = x - 1; s0y = y; }
        if (B === F) { s1x = x + 1; s1y = y; }
        if (D === H) { s2x = x - 1; s2y = y; }
        if (H === F) { s3x = x + 1; s3y = y; }
      }
      const dx = x * 2, dy = y * 2;
      copy(s0x, s0y, dx,     dy);
      copy(s1x, s1y, dx + 1, dy);
      copy(s2x, s2y, dx,     dy + 1);
      copy(s3x, s3y, dx + 1, dy + 1);
    }
  }
  return { width: dw, height: dh, data: dst };
}

// ─── Main ────────────────────────────────────────────────────────────────────
function listAllAgents() {
  return fs.readdirSync(AGENTS_DIR).filter(d => fs.statSync(path.join(AGENTS_DIR, d)).isDirectory());
}

const args = process.argv.slice(2);

if (args.includes('--revert')) {
  let n = 0;
  for (const a of listAllAgents()) {
    const p = path.join(AGENTS_DIR, a, 'map@2x.png');
    if (fs.existsSync(p)) { fs.unlinkSync(p); n++; }
  }
  console.log(`Revert: ${n} archivos map@2x.png borrados. Los originales quedan intactos.`);
  process.exit(0);
}

let targets;
if (args.includes('--all'))      targets = listAllAgents();
else if (args.length > 0)        targets = args.filter(a => !a.startsWith('--'));
else                             targets = FAMOUS;

console.log(`Upscaling 2× (Scale2x) de ${targets.length} personajes...\n`);

let ok = 0, errors = 0;
for (const agent of targets) {
  const dir     = path.join(AGENTS_DIR, agent);
  const mapPath = path.join(dir, 'map.png');
  const outPath = path.join(dir, 'map@2x.png');
  const bakPath = path.join(dir, 'map.orig-backup.png');
  if (!fs.existsSync(mapPath)) { console.warn(`  ✗ ${agent}: sin map.png`); errors++; continue; }
  try {
    const t0  = Date.now();
    const buf = fs.readFileSync(mapPath);
    if (!fs.existsSync(bakPath)) fs.writeFileSync(bakPath, buf); // backup literal del original
    const png = readPNG(buf);
    const up  = scale2x(png);
    const out = writePNG_RGBA(up.width, up.height, up.data);
    fs.writeFileSync(outPath, out);
    const mb  = (out.length / 1048576).toFixed(1);
    console.log(`  ✓ ${agent.padEnd(10)} ${png.width}×${png.height} → ${up.width}×${up.height}  (${mb} MB, ${((Date.now()-t0)/1000).toFixed(1)}s)`);
    ok++;
  } catch (e) {
    console.error(`  ✗ ${agent}: ${e.message}`);
    errors++;
  }
}

console.log(`\nListo: ${ok} generados, ${errors} errores.`);
console.log('Originales intactos (+ copia en map.orig-backup.png). Para revertir: node scripts/upscale-2x.js --revert');
