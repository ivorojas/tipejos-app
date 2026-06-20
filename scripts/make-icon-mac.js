/*
 * Genera assets/icon-mac.png a 1024×1024 (mismo diseño que make-icon.js, escalado ×4).
 * macOS / electron-builder exige un ícono de al menos 512×512 para generar el .icns.
 *
 * Uso:  node scripts/make-icon-mac.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 1024, H = 1024;
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

// Cuerpo amarillo, ojos blancos con pupilas y una sonrisa (coordenadas ×4 de make-icon.js).
disc(512, 512, 464, 253, 199, 0, 255);
disc(400, 448, 80, 255, 255, 255, 255);
disc(624, 448, 80, 255, 255, 255, 255);
disc(408, 456, 36, 35, 35, 45, 255);
disc(616, 456, 36, 35, 35, 45, 255);
for (let deg = 20; deg <= 160; deg += 1) {
  const r = (deg * Math.PI) / 180;
  disc(512 + Math.cos(r) * 220, 600 + Math.sin(r) * 180, 16, 35, 35, 45, 255);
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

const outPng = path.join(__dirname, '..', 'assets', 'icon-mac.png');
fs.mkdirSync(path.dirname(outPng), { recursive: true });
fs.writeFileSync(outPng, png);
console.log('PNG Mac creado:', outPng, '(' + W + 'x' + H + ')');
