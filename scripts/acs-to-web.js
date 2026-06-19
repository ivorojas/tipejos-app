/*
 * Conversor .acs (Microsoft Agent) → formato web ClippyJS (agent.js + map.png).
 *
 * Sin dependencias nativas: parser binario en JS puro + descompresor LZ portado
 * de computernewb/MSAgent-Chat (decompress.cpp) + escritor PNG con zlib.
 *
 * Uso:  node scripts/acs-to-web.js <archivo.acs> <NombreSalida>
 *       node scripts/acs-to-web.js --all          (procesa acs-source/*.acs)
 *
 * Produce:  assets/agents/<Nombre>/agent.js  y  map.png
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const EDGE_ALPHA = 140; // mismo feathering que scripts/defringe.js

// ─────────────────────────────────────────────────────────────────────────────
// Lector de buffer little-endian (port de buffer.ts)
// ─────────────────────────────────────────────────────────────────────────────
class Stream {
  constructor(buf) { this.b = buf; this.p = 0; }
  seek(n)   { this.p = n; }
  tell()    { return this.p; }
  u8()      { return this.b[this.p++]; }
  s8()      { const v = this.b.readInt8(this.p); this.p += 1; return v; }
  u16()     { const v = this.b.readUInt16LE(this.p); this.p += 2; return v; }
  s16()     { const v = this.b.readInt16LE(this.p);  this.p += 2; return v; }
  u32()     { const v = this.b.readUInt32LE(this.p); this.p += 4; return v; }
  s32()     { const v = this.b.readInt32LE(this.p);  this.p += 4; return v; }
  bool()    { return this.u8() !== 0; }
  sub(len)  { const s = new Stream(this.b.subarray(this.p, this.p + len)); this.p += len; return s; }
  raw(len)  { const r = this.b.subarray(this.p, this.p + len); this.p += len; return r; }

  // Cadena Pascal: u32 longitud (chars) + UTF-16LE + terminador NUL descartado.
  pstr(lenReader) {
    const len = (lenReader ? lenReader.call(this) : this.u32());
    if (len === 0) return '';
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.u16());
    this.u16(); // NUL
    return s;
  }

  // Lista contada: longitud + N elementos.
  list(reader, lenReader) {
    const len = (lenReader ? lenReader.call(this) : this.u32());
    const arr = [];
    for (let i = 0; i < len; i++) arr.push(reader(this));
    return arr;
  }

  withOffset(off, cb) {
    const last = this.p;
    this.p = off;
    const r = cb();
    this.p = last;
    return r;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Descompresor LZ de Microsoft Agent (port fiel de decompress.cpp)
// ─────────────────────────────────────────────────────────────────────────────
function agentDecompress(src, dst) {
  const srcSize = src.length;
  const dstSize = dst.length;
  // u32 LE en índice absoluto, 0 fuera de rango.
  const rd = (i) =>
    (((i     >= 0 && i     < srcSize ? src[i]     : 0)) |
     ((i + 1 >= 0 && i + 1 < srcSize ? src[i + 1] : 0) << 8) |
     ((i + 2 >= 0 && i + 2 < srcSize ? src[i + 2] : 0) << 16) |
     ((i + 3 >= 0 && i + 3 < srcSize ? src[i + 3] : 0) << 24)) >>> 0;

  if (srcSize <= 7 || src[0] !== 0) return 0;

  // Los últimos 6 bytes deben ser 0xFF (marcador de fin).
  let n = 1;
  for (; src[srcSize - n] === 0xff; n++) if (n > 6) break;
  if (n < 6) return 0;

  let bit = 0;
  let sp  = 5;          // índice en src
  let tp  = 0;          // índice en dst

  while (sp < srcSize && tp < dstSize) {
    let quad = rd(sp - 4);

    if (quad & (1 << ((bit) & 0xffff))) {
      // ── Referencia hacia atrás ──
      let srcOffset = 1;
      if (quad & (1 << ((bit + 1) & 0xffff))) {
        if (quad & (1 << ((bit + 2) & 0xffff))) {
          if (quad & (1 << ((bit + 3) & 0xffff))) {
            quad = (quad >>> ((bit + 4) & 0xffff)) & 0x000fffff;
            if (quad === 0x000fffff) break;
            quad += 4673; bit += 24; srcOffset = 2;
          } else {
            quad = (quad >>> ((bit + 4) & 0xffff)) & 0x00000fff;
            quad += 577;  bit += 16;
          }
        } else {
          quad = (quad >>> ((bit + 3) & 0xffff)) & 0x000001ff;
          quad += 65;   bit += 12;
        }
      } else {
        quad = (quad >>> ((bit + 2) & 0xffff)) & 0x0000003f;
        quad += 1;    bit += 8;
      }

      sp += (bit >>> 3);
      bit &= 7;

      // Longitud del run: prefijo unario (máx 11) + bits de valor.
      let runLen = rd(sp - 4);
      let runCount = 0;
      while (runLen & (1 << ((bit + runCount) & 0xffff))) {
        runCount++;
        if (runCount > 11) break;
      }
      runLen = (runLen >>> ((bit + runCount + 1) & 0xffff));
      runLen &= (1 << runCount) - 1;
      runLen += (1 << runCount);
      runLen += srcOffset;
      bit += runCount * 2 + 1;

      if (tp + runLen > dstSize) break;
      if (tp - quad < 0) break;
      while (runLen > 0) { dst[tp] = dst[tp - quad]; tp++; runLen--; }
    } else {
      // ── Literal ──
      quad = quad >>> ((bit + 1) & 0xffff);
      bit += 9;
      dst[tp++] = quad & 0xff;
    }

    sp += (bit >>> 3);
    bit &= 7;
  }
  return tp;
}

// COMPRESSED_DATABLOCK: u32 comprimido, u32 descomprimido.
function readCompressedBlock(st) {
  const cSize = st.u32();
  const uSize = st.u32();
  if (cSize === 0) return st.raw(uSize);
  const data = st.raw(cSize);
  const out  = Buffer.alloc(uSize);
  agentDecompress(data, out);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parseo de estructuras ACS
// ─────────────────────────────────────────────────────────────────────────────
function readLocation(st) { return { offset: st.u32(), size: st.u32() }; }

function readRGBQuad(st) {
  const val = st.u32();
  return { r: val & 0xff, g: (val >> 8) & 0xff, b: (val >> 16) & 0xff, a: 255 };
}

function readCharacterInfo(st) {
  const info = {};
  info.minorVersion = st.u16();
  info.majorVersion = st.u16();
  info.locInfoLoc   = readLocation(st);
  info.guid         = st.raw(16);
  info.charWidth    = st.u16();
  info.charHeight   = st.u16();
  info.transIdx     = st.u8();
  info.flags        = st.u32();
  info.animSetMajor = st.u16();
  info.animSetMinor = st.u16();

  const VOICE = 1 << 5, WB_DIS = 1 << 8, WB_EN = 1 << 9;

  if (info.flags & VOICE) skipVoiceInfo(st);
  if ((info.flags & WB_EN) && !(info.flags & WB_DIS)) skipBalloonInfo(st);

  info.palette = st.list(readRGBQuad);                 // u32 count + RGBQUAD[]
  info.palette[info.transIdx].a = 0;                   // color clave transparente

  if (st.bool()) {                                     // ícono de bandeja
    st.raw(st.u32()); // mono bitmap (DATACHUNK u32)
    st.raw(st.u32()); // color bitmap
  }
  // stateInfo (u16 count) — lo leemos para avanzar bien aunque no lo usamos
  st.list((s) => {
    s.pstr();                                          // nombre de estado
    s.list((ss) => ss.pstr(), Stream.prototype.u16);   // animaciones (u16 count)
  }, Stream.prototype.u16);

  return info;
}

function skipVoiceInfo(st) {
  st.raw(16); st.raw(16);  // ttsEngineId, ttsModeId (GUID)
  st.u32(); st.u16();      // speed, pitch
  if (st.bool()) {         // extraData
    st.u16(); st.pstr();   // langId, langDialect
    st.u16(); st.u16();    // gender, age
    st.pstr();             // style
  }
}

function skipBalloonInfo(st) {
  st.u8(); st.u8();                 // nrTextLines, charsPerLine
  st.u32(); st.u32(); st.u32();     // foreColor, backColor, borderColor (RGBQUAD)
  st.pstr();                        // fontName
  st.s32(); st.s32();               // fontHeight, fontWeight
  st.bool(); st.bool();             // italic, unkFlag
}

function readImage(st) {
  st.u8();                          // desconocido
  const width  = st.u16();
  const height = st.u16();
  const compressed = st.bool();
  const chunk = st.raw(st.u32());   // DATACHUNK

  const stride = (width + 3) & 0xfc;
  let data;
  if (compressed) {
    data = Buffer.alloc(stride * height);
    agentDecompress(chunk, data);
  } else {
    data = chunk;
  }
  // Saltar regionData (COMPRESSED_DATABLOCK) — no lo necesitamos.
  readCompressedBlock(st);
  return { width, height, stride, data };
}

function readImageEntry(st) {
  const loc = readLocation(st);
  st.u32();                          // checksum
  return st.withOffset(loc.offset, () => readImage(st));
}

// Entrada de audio: LOCATION + checksum. Los datos son un WAV/RIFF CRUDO de
// `loc.size` bytes en `loc.offset` (no comprimido, no COMPRESSED_DATABLOCK).
function readAudioEntry(st) {
  const loc = readLocation(st);
  st.u32();                          // checksum
  return st.withOffset(loc.offset, () => Buffer.from(st.raw(loc.size)));
}

function readFrameImage(st) {
  return { imageIndex: st.u32(), xOffset: st.u16(), yOffset: st.u16() };
}

function readBranch(st) {
  return { frameIndex: st.u16(), weight: st.u16() };
}

function readOverlay(st) {
  st.u8(); st.bool(); st.u16();      // type, replacesTop, overlayImageIndex
  st.u8(); const hasRegion = st.bool();
  st.s16(); st.s16(); st.u16(); st.u16(); // x, y, w, h
  if (hasRegion) st.raw(st.u32());   // DATACHUNK regionData
}

function readFrame(st) {
  const images = st.list(readFrameImage, Stream.prototype.u16);
  const soundIndex   = st.s16();
  const frameDuration = st.u16();
  const nextFrame    = st.s16();
  const branchInfo   = st.list(readBranch,  Stream.prototype.u8);
  st.list(readOverlay, Stream.prototype.u8); // overlays (lip-sync) — descartados
  return { images, soundIndex, frameDuration, nextFrame, branchInfo };
}

function readAnimation(st) {
  const name = st.pstr();
  const transitionType = st.u8();
  const returnName = st.pstr();
  const frames = st.list(readFrame, Stream.prototype.u16);
  return { name, transitionType, returnName, frames };
}

function readAnimationEntry(st) {
  const name = st.pstr();
  const loc  = readLocation(st);
  const animationData = st.withOffset(loc.offset, () => readAnimation(st));
  return { name, animationData };
}

function parseACS(buf) {
  const st = new Stream(buf);
  if (st.u32() !== 0xabcdabc3) throw new Error('No es un archivo ACS válido (magic).');

  const charLoc  = readLocation(st);
  const animLoc  = readLocation(st);
  const imageLoc = readLocation(st);
  const audioLoc = readLocation(st);

  const characterInfo = st.withOffset(charLoc.offset,  () => readCharacterInfo(st));
  const animations    = st.withOffset(animLoc.offset,  () => st.list(readAnimationEntry));
  const images        = st.withOffset(imageLoc.offset, () => st.list(readImageEntry));
  const audios        = audioLoc.offset
    ? st.withOffset(audioLoc.offset, () => st.list(readAudioEntry))
    : [];

  return { characterInfo, animations, images, audios };
}

// ─────────────────────────────────────────────────────────────────────────────
// Imagen indexada → RGBA (DIB bottom-up, filas alineadas a DWORD)
// ─────────────────────────────────────────────────────────────────────────────
function imageToRGBA(img, palette) {
  const { width, height, stride, data } = img;
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * stride; // bottom-up
    for (let x = 0; x < width; x++) {
      const idx = data[srcRow + x];
      const c = palette[idx] || { r: 0, g: 0, b: 0, a: 0 };
      const o = (y * width + x) * 4;
      out[o] = c.r; out[o + 1] = c.g; out[o + 2] = c.b; out[o + 3] = c.a;
    }
  }
  return out;
}

// Compone los AcsFrameImage de un frame sobre un lienzo charW×charH RGBA.
function compositeFrame(frame, rgbaImages, charW, charH) {
  const canvas = Buffer.alloc(charW * charH * 4); // todo transparente
  for (const fi of frame.images) {
    const src = rgbaImages[fi.imageIndex];
    if (!src) continue;
    const { width, height, rgba } = src;
    for (let y = 0; y < height; y++) {
      const cy = fi.yOffset + y;
      if (cy < 0 || cy >= charH) continue;
      for (let x = 0; x < width; x++) {
        const cx = fi.xOffset + x;
        if (cx < 0 || cx >= charW) continue;
        const so = (y * width + x) * 4;
        if (rgba[so + 3] === 0) continue;            // píxel transparente: no pintar
        const co = (cy * charW + cx) * 4;
        canvas[co] = rgba[so]; canvas[co + 1] = rgba[so + 1];
        canvas[co + 2] = rgba[so + 2]; canvas[co + 3] = rgba[so + 3];
      }
    }
  }
  return canvas;
}

// Feathering de borde (alpha=EDGE_ALPHA en píxeles opacos adyacentes a transparente).
function defringe(canvas, w, h) {
  const isTrans = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (canvas[i * 4 + 3] === 0) isTrans[i] = 1;
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (isTrans[idx] || canvas[idx * 4 + 3] < 255) continue;
      const adj = DIRS.some(([dy, dx]) => {
        const ny = y + dy, nx = x + dx;
        return ny >= 0 && ny < h && nx >= 0 && nx < w && isTrans[ny * w + nx];
      });
      if (adj) canvas[idx * 4 + 3] = EDGE_ALPHA;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Escritor PNG RGBA (colorType 6)
// ─────────────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function writePNG(file, w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // depth 8, colorType RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  fs.writeFileSync(file, Buffer.concat([
    sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversión completa de un .acs
// ─────────────────────────────────────────────────────────────────────────────
function convert(acsPath, outName) {
  const buf = fs.readFileSync(acsPath);
  const acs = parseACS(buf);
  const { charWidth: charW, charHeight: charH, palette } = acs.characterInfo;

  // Pre-render de todas las imágenes a RGBA.
  const rgbaImages = acs.images.map((img) => ({
    width: img.width, height: img.height, rgba: imageToRGBA(img, palette),
  }));

  // Componer cada frame de cada animación; deduplicar por contenido.
  const frameMap = new Map();   // hash → índice de celda
  const cells = [];             // canvases únicos
  const animations = {};

  function cellFor(canvas) {
    const hash = require('crypto').createHash('md5').update(canvas).digest('hex');
    if (frameMap.has(hash)) return frameMap.get(hash);
    const idx = cells.length;
    cells.push(canvas);
    frameMap.set(hash, idx);
    return idx;
  }

  let totalFrames = 0;
  for (const entry of acs.animations) {
    const a = entry.animationData;
    const useExit = a.transitionType === 1; // UseExitBranches
    const frames = a.frames.map((f) => {
      const canvas = compositeFrame(f, rgbaImages, charW, charH);
      const cellIdx = cellFor(canvas);
      const fr = { duration: f.frameDuration * 10, cellIdx };
      // exitBranch / branching
      if (f.nextFrame >= 0 && f.nextFrame !== undefined) fr.nextFrame = f.nextFrame;
      if (f.branchInfo && f.branchInfo.length) {
        fr.branching = { branches: f.branchInfo.map((b) => ({ frameIndex: b.frameIndex, weight: b.weight })) };
      }
      return fr;
    });
    totalFrames += frames.length;
    animations[entry.name] = { frames, useExitBranching: useExit };
  }

  // Reordenar para que la celda 0 sea el frame con más píxeles opacos
  // (buena miniatura en el selector). Construye una permutación old→new.
  const opacityOf = (canvas) => {
    let n = 0;
    for (let i = 3; i < canvas.length; i += 4) if (canvas[i] > 0) n++;
    return n;
  };
  const order = cells.map((_, i) => i).sort((a, b) => opacityOf(cells[b]) - opacityOf(cells[a]));
  const remap = new Array(cells.length);
  order.forEach((oldIdx, newIdx) => { remap[oldIdx] = newIdx; });
  const orderedCells = order.map((oldIdx) => cells[oldIdx]);
  cells.length = 0;
  cells.push(...orderedCells);
  for (const def of Object.values(animations)) {
    for (const fr of def.frames) fr.cellIdx = remap[fr.cellIdx];
  }

  // Disposición del sprite sheet (grilla; ancho objetivo ~2400px).
  const cols = Math.max(1, Math.min(cells.length, Math.floor(2400 / charW) || 1));
  const rows = Math.ceil(cells.length / cols);
  const sheetW = cols * charW;
  const sheetH = rows * charH;
  const sheet = Buffer.alloc(sheetW * sheetH * 4);
  const cellPos = []; // [x,y] en píxeles por celda

  for (let i = 0; i < cells.length; i++) {
    const cx = (i % cols) * charW;
    const cy = Math.floor(i / cols) * charH;
    cellPos.push([cx, cy]);
    const canvas = cells[i];
    defringe(canvas, charW, charH);
    for (let y = 0; y < charH; y++) {
      const dstOff = ((cy + y) * sheetW + cx) * 4;
      canvas.copy(sheet, dstOff, y * charW * 4, (y + 1) * charW * 4);
    }
  }

  // Convertir cellIdx → coordenadas [x,y] en el agent.js final.
  const animOut = {};
  for (const [name, def] of Object.entries(animations)) {
    const frames = def.frames.map((fr) => {
      const [x, y] = cellPos[fr.cellIdx];
      const out = { duration: fr.duration, images: [[x, y]] };
      if (fr.branching) out.branching = fr.branching;
      return out;
    });
    // exitBranch: si la animación usa ramas de salida, apuntar el último frame a sí mismo no sirve;
    // marcamos exitBranch en frames que tengan branching para permitir cortar el bucle.
    if (def.useExitBranching) {
      frames.forEach((fr, i) => {
        const src = animations[name].frames[i];
        if (src.branching) fr.exitBranch = src.nextFrame != null ? src.nextFrame : i + 1;
      });
    }
    animOut[name] = { frames };
  }

  const agentObj = {
    overlayCount: 1,
    sounds: [],
    framesize: [charW, charH],
    animations: animOut,
  };

  const outDir = path.join(__dirname, '..', 'assets', 'agents', outName);
  fs.mkdirSync(outDir, { recursive: true });
  writePNG(path.join(outDir, 'map.png'), sheetW, sheetH, sheet);
  fs.writeFileSync(
    path.join(outDir, 'agent.js'),
    `clippy.ready('${outName}', ${JSON.stringify(agentObj)});\n`
  );

  return {
    name: outName, charW, charH,
    animations: Object.keys(animOut).length,
    frames: totalFrames, cells: cells.length,
    sheet: `${sheetW}x${sheetH}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--all') {
    const dir = path.join(__dirname, '..', 'acs-source');
    const files = fs.readdirSync(dir).filter((f) => /\.acs$/i.test(f));
    for (const f of files) {
      const name = path.basename(f, path.extname(f));
      try {
        const r = convert(path.join(dir, f), name);
        console.log(`✓ ${r.name.padEnd(14)} ${r.animations} anim, ${r.frames} frames, ${r.cells} celdas, hoja ${r.sheet} (${r.charW}x${r.charH})`);
      } catch (e) {
        console.error(`✗ ${name}: ${e.message}`);
      }
    }
    return;
  }
  if (args.length < 2) {
    console.error('Uso: node scripts/acs-to-web.js <archivo.acs> <NombreSalida>');
    console.error('     node scripts/acs-to-web.js --all');
    process.exit(1);
  }
  const r = convert(args[0], args[1]);
  console.log(`✓ ${r.name}: ${r.animations} animaciones, ${r.frames} frames, ${r.cells} celdas, hoja ${r.sheet} (${r.charW}x${r.charH})`);
}

// Exportar para reuso (p. ej. scripts/acs-audio.js); solo correr CLI si es invocado directo.
module.exports = { Stream, parseACS, agentDecompress, readCompressedBlock, readLocation, convert };

if (require.main === module) main();
