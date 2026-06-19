/**
 * defringe.js — suaviza el borde de los sprites de los agentes.
 *
 * Los sprites usan un "color key" (magenta 255,0,255 = transparente), sin canal
 * alpha. Eso deja bordes duros donde el color del personaje (a veces claro) se ve
 * como un "halo blanco" sobre fondos oscuros.
 *
 * Este script:
 *   1. Lee cada map.png (PNG con paleta, colorType 3 + tRNS).
 *   2. Convierte a RGBA completo (colorType 6).
 *   3. Todos los píxeles del borde del personaje (adyacentes a zona transparente)
 *      pasan a alpha=EDGE_ALPHA (por defecto 140/255 ≈ 55% opaco).
 *      → Solo 1 pixel de borde; los píxeles interiores quedan al 100%.
 *      → Afecta a cualquier color de borde por igual: pelo blanco, piel oscura, etc.
 *      → No discrimina por color, solo por posición respecto a la transparencia.
 *   4. Guarda el resultado como RGBA PNG (el navegador lo maneja igual que antes).
 *
 * Para restaurar los originales: borrar assets/agents/ y correr "npm run setup".
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const EDGE_ALPHA = 140; // 0-255; baja = borde más suave; sube = borde más duro

// ─── Lector de PNG puro ───────────────────────────────────────────────────────

function parsePNGChunks(buf) {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIG[i]) throw new Error('No es un PNG válido');
  }
  const chunks = [];
  let pos = 8;
  while (pos < buf.length - 4) {
    const len  = buf.readUInt32BE(pos); pos += 4;
    const type = buf.toString('ascii', pos, pos + 4); pos += 4;
    const data = buf.slice(pos, pos + len); pos += len;
    pos += 4; // CRC
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
  // `channels` bytes per pixel (1 para indexed, 4 para RGBA)
  const stride  = width * channels;
  const out     = Buffer.alloc((raw.length / (stride + 1)) * stride);
  let   rawOff  = 0;
  let   outOff  = 0;
  const rowCount = raw.length / (stride + 1);

  for (let y = 0; y < rowCount; y++) {
    const filter = raw[rawOff++];
    for (let x = 0; x < stride; x++) {
      const byte = raw[rawOff++];
      const ch   = x % channels;
      const xPx  = Math.floor(x / channels);
      const a    = (xPx > 0) ? out[outOff + x - channels] : 0;
      const b    = (y   > 0) ? out[outOff - stride + x]   : 0;
      const c    = (xPx > 0 && y > 0) ? out[outOff - stride + x - channels] : 0;

      switch (filter) {
        case 0: out[outOff + x] = byte; break;
        case 1: out[outOff + x] = (byte + a) & 0xFF; break;
        case 2: out[outOff + x] = (byte + b) & 0xFF; break;
        case 3: out[outOff + x] = (byte + Math.floor((a + b) / 2)) & 0xFF; break;
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
  const bitDepth  = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];

  if (bitDepth  !== 8) throw new Error('Solo soporta bit depth 8 (tiene ' + bitDepth + ')');
  if (interlace !== 0) throw new Error('Interlacing no soportado');
  if (colorType !== 3 && colorType !== 6) {
    throw new Error('Solo soporta colorType 3 (paleta) o 6 (RGBA), tiene ' + colorType);
  }

  // Descomprimir IDAT
  const idats = Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data));
  const raw   = zlib.inflateSync(idats);

  if (colorType === 6) {
    // RGBA directo
    const pixels = defilter(raw, width, 4);
    return { width, height, data: pixels };
  }

  // colorType 3 — indexed/paleta
  const plte = chunks.find(c => c.type === 'PLTE').data;
  const trns = chunks.find(c => c.type === 'tRNS');
  const trnsData = trns ? trns.data : Buffer.alloc(0);

  const indices = defilter(raw, width, 1); // 1 byte por pixel = índice

  // Convertir índices → RGBA
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

// ─── Escritor de PNG RGBA (colorType 6) ──────────────────────────────────────

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
  const lenBuf  = Buffer.alloc(4);
  const crcBuf  = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function writePNG_RGBA(width, height, data) {
  // Filas con filtro 0 (None): 1 byte de filtro + width*4 bytes de pixels
  const stride  = width * 4;
  const rawRows = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    rawRows[y * (stride + 1)] = 0; // filtro None
    data.copy(rawRows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(rawRows, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 6;  // RGBA
  ihdr[10] = 0;  // compression method
  ihdr[11] = 0;  // filter method
  ihdr[12] = 0;  // no interlace

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Defringe: suavizar borde del personaje ───────────────────────────────────

function applyDefringe({ width, height, data }, edgeAlpha) {
  // Primero: marcar qué posiciones son transparentes (alpha === 0)
  const isTrans = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3] === 0) isTrans[i] = 1;
  }

  let edged = 0;
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (isTrans[idx]) continue;            // ya es transparente
      if (data[idx * 4 + 3] < 255) continue; // ya era semitransparente (colorType 6)

      // ¿Algún vecino es transparente?
      const adj = DIRS.some(([dy, dx]) => {
        const ny = y + dy, nx = x + dx;
        return ny >= 0 && ny < height && nx >= 0 && nx < width && isTrans[ny * width + nx];
      });

      if (adj) {
        data[idx * 4 + 3] = edgeAlpha;
        edged++;
      }
    }
  }
  return edged;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const AGENTS_DIR = path.join(__dirname, '..', 'assets', 'agents');

if (!fs.existsSync(AGENTS_DIR)) {
  console.error('No se encontró assets/agents/. Corre primero "npm run setup".');
  process.exit(1);
}

const agents = fs.readdirSync(AGENTS_DIR).filter(d =>
  fs.statSync(path.join(AGENTS_DIR, d)).isDirectory()
);

if (agents.length === 0) {
  console.error('No hay personajes en assets/agents/. Corre "npm run setup" primero.');
  process.exit(1);
}

console.log(`Aplicando defringe (EDGE_ALPHA=${EDGE_ALPHA}) a ${agents.length} personajes...`);

let totalEdged = 0;
let errors     = 0;

for (const agent of agents) {
  const mapPath = path.join(AGENTS_DIR, agent, 'map.png');
  if (!fs.existsSync(mapPath)) {
    console.warn(`  ${agent}: sin map.png, saltando`);
    continue;
  }
  try {
    const raw    = fs.readFileSync(mapPath);
    const png    = readPNG(raw);
    const edged  = applyDefringe(png, EDGE_ALPHA);
    const outBuf = writePNG_RGBA(png.width, png.height, png.data);
    fs.writeFileSync(mapPath, outBuf);
    console.log(`  ✓ ${agent.padEnd(10)}  ${png.width}×${png.height.toString().padStart(4)}  →  ${edged.toLocaleString()} píxeles de borde suavizados`);
    totalEdged += edged;
  } catch (e) {
    console.error(`  ✗ ${agent}: ${e.message}`);
    errors++;
  }
}

console.log(`\nListo: ${agents.length - errors} personajes, ${totalEdged.toLocaleString()} píxeles de borde totales.`);
if (errors) console.log(`Errores: ${errors}`);
console.log('\nPara restaurar los originales: borrar assets/agents/ y correr "npm run setup".');
