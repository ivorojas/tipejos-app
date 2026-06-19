/*
 * Genera un ícono PNG válido (assets/icon.png) para la bandeja del sistema y el
 * empaquetado, sin dependencias: dibuja a mano los pixeles y codifica el PNG con zlib.
 *
 * Uso:  node scripts/make-icon.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 256, H = 256;
const px = Buffer.alloc(W * H * 4); // RGBA, todo transparente al inicio

function set(x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

function disc(cx, cy, rad, r, g, b, a) {
  for (let y = cy - rad; y <= cy + rad; y++) {
    for (let x = cx - rad; x <= cx + rad; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= rad * rad) set(x, y, r, g, b, a);
    }
  }
}

// Cuerpo amarillo, ojos blancos con pupilas y una sonrisa.
disc(128, 128, 116, 253, 199, 0, 255);
disc(100, 112, 20, 255, 255, 255, 255);
disc(156, 112, 20, 255, 255, 255, 255);
disc(102, 114, 9, 35, 35, 45, 255);
disc(154, 114, 9, 35, 35, 45, 255);
for (let deg = 20; deg <= 160; deg += 2) {
  const r = (deg * Math.PI) / 180;
  disc(128 + Math.cos(r) * 55, 150 + Math.sin(r) * 45, 4, 35, 35, 45, 255);
}

// ---- Codificación PNG ----
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

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type RGBA
// resto en 0 (compresión, filtro, interlace)

const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0; // filtro 0 por fila
  px.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const outPng = path.join(__dirname, '..', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(outPng), { recursive: true });
fs.writeFileSync(outPng, png);
console.log('PNG creado:', outPng);

// ---- Generar icon.ico (contiene el PNG embebido en formato ICO) ----
// Un ICO moderno puede almacenar imágenes PNG directamente para 256×256.
// Estructura: ICONDIR(6) + ICONDIRENTRY(16) + datos-PNG
const pngData   = png;
const imgCount  = 1;

// ICONDIR
const iconDir = Buffer.alloc(6);
iconDir.writeUInt16LE(0,       0); // reservado
iconDir.writeUInt16LE(1,       2); // tipo: ICO
iconDir.writeUInt16LE(imgCount, 4);

// ICONDIRENTRY (16 bytes por imagen)
const entryOffset = 6 + 16 * imgCount; // offset a los datos de imagen
const entry = Buffer.alloc(16);
entry.writeUInt8(0,             0); // width  0 = 256
entry.writeUInt8(0,             1); // height 0 = 256
entry.writeUInt8(0,             2); // palette size
entry.writeUInt8(0,             3); // reservado
entry.writeUInt16LE(1,          4); // planes
entry.writeUInt16LE(32,         6); // bits por pixel
entry.writeUInt32LE(pngData.length, 8);  // tamaño datos
entry.writeUInt32LE(entryOffset,    12); // offset datos

const outIco = path.join(__dirname, '..', 'assets', 'icon.ico');
fs.writeFileSync(outIco, Buffer.concat([iconDir, entry, pngData]));
console.log('ICO creado:', outIco);
