/*
 * Extrae el audio de los .acs y lo agrega a los personajes existentes SIN tocar
 * map.png ni los frames visuales:
 *   - Lee el bloque de audio del .acs (lista de WAV/RIFF crudos).
 *   - PCM (fmt 1) se embebe tal cual. MS ADPCM (fmt 2) se decodifica a PCM 16-bit
 *     (reproducción garantizada en Chromium). Otros formatos se dejan crudos.
 *   - Mapea soundIndex de cada frame del .acs al frame correspondiente del
 *     agent.js existente (por nombre de animación + índice; saltea si no coincide).
 *   - Escribe sounds-mp3.js: clippy.soundsReady('Nombre', { "<idx>": "data:audio/wav;base64,..." }).
 *
 * Uso:  node scripts/acs-audio.js            (todos los personajes sin sonido)
 *       node scripts/acs-audio.js <Nombre>   (uno solo)
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { parseACS } = require('./acs-to-web.js');

const AGENTS_DIR = path.join(__dirname, '..', 'assets', 'agents');
const ACS_DIR    = path.join(__dirname, '..', 'acs-source');

// ── Parser de chunks WAV (escanea fmt/data, no asume offsets fijos) ───────────
function parseWav(b) {
  if (b.length < 12 || b.slice(0, 4).toString('ascii') !== 'RIFF') return null;
  if (b.slice(8, 12).toString('ascii') !== 'WAVE') return null;
  let p = 12, fmt = null, dataOff = 0, dataLen = 0;
  while (p + 8 <= b.length) {
    const id = b.slice(p, p + 4).toString('ascii');
    const sz = b.readUInt32LE(p + 4);
    const body = p + 8;
    if (id === 'fmt ' && sz >= 16) {
      fmt = {
        code:       b.readUInt16LE(body),
        channels:   b.readUInt16LE(body + 2),
        rate:       b.readUInt32LE(body + 4),
        byteRate:   b.readUInt32LE(body + 8),
        blockAlign: b.readUInt16LE(body + 12),
        bits:       b.readUInt16LE(body + 14),
        extra:      sz > 16 ? b.slice(body + 18, body + sz) : Buffer.alloc(0),
      };
    } else if (id === 'data') {
      dataOff = body; dataLen = sz;
    }
    p = body + sz + (sz & 1); // chunks alineados a word
  }
  if (!fmt || !dataOff) return null;
  return { fmt, dataOff, dataLen, data: b.slice(dataOff, dataOff + dataLen) };
}

// ── Decodificador MS ADPCM (fmt 2) → PCM 16-bit ───────────────────────────────
const ADAPT_TABLE = [230, 230, 230, 230, 307, 409, 512, 614,
                     768, 614, 512, 409, 307, 230, 230, 230];
const DEF_COEF1 = [256, 512, 0, 192, 240, 460, 392];
const DEF_COEF2 = [0, -256, 0, 64, 0, -208, -232];

function clamp16(v) { return v < -32768 ? -32768 : v > 32767 ? 32767 : v; }

function decodeMsAdpcm(wav) {
  const { fmt, data } = wav;
  if (fmt.channels !== 1) return null; // solo mono (los de MS Agent lo son)

  // Coeficientes: del header si están, si no los predefinidos.
  let coef1 = DEF_COEF1.slice(), coef2 = DEF_COEF2.slice();
  if (fmt.extra && fmt.extra.length >= 4) {
    // extra = cbSize ya consumido; aquí: samplesPerBlock(2) numCoef(2) coefs...
    const numCoef = fmt.extra.readUInt16LE(2);
    if (fmt.extra.length >= 4 + numCoef * 4) {
      coef1 = []; coef2 = [];
      for (let i = 0; i < numCoef; i++) {
        coef1.push(fmt.extra.readInt16LE(4 + i * 4));
        coef2.push(fmt.extra.readInt16LE(4 + i * 4 + 2));
      }
    }
  }

  const blockAlign = fmt.blockAlign || 256;
  const out = [];

  for (let base = 0; base + 7 <= data.length; base += blockAlign) {
    const end = Math.min(base + blockAlign, data.length);
    let q = base;
    const predictor = data[q]; q += 1;
    if (predictor >= coef1.length) break;
    let delta    = data.readInt16LE(q); q += 2;
    let sample1  = data.readInt16LE(q); q += 2;
    let sample2  = data.readInt16LE(q); q += 2;
    const c1 = coef1[predictor], c2 = coef2[predictor];

    out.push(sample2, sample1); // los dos primeros samples del bloque

    let high = true, byte = 0;
    while (q < end) {
      let nib;
      if (high) { byte = data[q]; nib = byte >> 4; high = false; }
      else      { nib = byte & 0x0f; high = true; q += 1; }
      let signed = nib < 8 ? nib : nib - 16;
      let predict = (sample1 * c1 + sample2 * c2) >> 8;
      let newSample = clamp16(predict + signed * delta);
      out.push(newSample);
      sample2 = sample1; sample1 = newSample;
      delta = (ADAPT_TABLE[nib] * delta) >> 8;
      if (delta < 16) delta = 16;
    }
  }

  // Construir WAV PCM 16-bit mono
  return buildPcmWav(out, fmt.rate, 1, 16);
}

function buildPcmWav(samples, rate, channels, bits) {
  const bytesPerSample = bits / 8;
  const dataLen = samples.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);                       // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * channels * bytesPerSample, 28);
  buf.writeUInt16LE(channels * bytesPerSample, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(clamp16(samples[i]), 44 + i * 2);
  return buf;
}

// ── Convertir un WAV crudo del ACS al dataURI final ───────────────────────────
function wavToDataUri(raw) {
  const wav = parseWav(raw);
  let outBuf = raw, kind = 'raw';
  if (wav) {
    if (wav.fmt.code === 1) { outBuf = raw; kind = 'pcm'; }
    else if (wav.fmt.code === 2) {
      const dec = decodeMsAdpcm(wav);
      if (dec) { outBuf = dec; kind = 'adpcm→pcm'; }
      else { outBuf = raw; kind = 'adpcm-raw'; }
    } else { outBuf = raw; kind = 'fmt' + wav.fmt.code; }
  }
  return { uri: 'data:audio/wav;base64,' + outBuf.toString('base64'), kind, bytes: outBuf.length };
}

// ── Buscar el .acs de un personaje (case-insensitive) ─────────────────────────
function findAcs(name) {
  const files = fs.readdirSync(ACS_DIR).filter((f) => /\.acs$/i.test(f));
  const exact = files.find((f) => path.basename(f, path.extname(f)).toLowerCase() === name.toLowerCase());
  return exact ? path.join(ACS_DIR, exact) : null;
}

// ── Procesar un personaje ─────────────────────────────────────────────────────
function processChar(name) {
  const dir       = path.join(AGENTS_DIR, name);
  const agentFile = path.join(dir, 'agent.js');
  if (!fs.existsSync(agentFile)) return { name, status: 'sin agent.js' };

  const acsPath = findAcs(name);
  if (!acsPath) return { name, status: 'sin .acs fuente' };

  let acs;
  try { acs = parseACS(fs.readFileSync(acsPath)); }
  catch (e) { return { name, status: 'acs ilegible: ' + e.message }; }

  const audios = acs.audios || [];
  if (audios.length === 0) return { name, status: 'sin audio en el .acs' };

  // Mapa: nombre de animación → array de soundIndex por frame (del .acs)
  const acsAnims = {};
  for (const entry of acs.animations) {
    acsAnims[entry.name] = entry.animationData.frames.map((f) => f.soundIndex);
  }

  // Leer agent.js existente
  const src = fs.readFileSync(agentFile, 'utf8');
  let data;
  try { data = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1)); }
  catch (e) { return { name, status: 'agent.js ilegible' }; }

  const used = new Set();
  let mapped = 0, matched = 0, skipped = 0;
  for (const [animName, def] of Object.entries(data.animations || {})) {
    const sIdx = acsAnims[animName];
    if (!sIdx || sIdx.length !== def.frames.length) { skipped++; continue; }
    matched++;
    def.frames.forEach((fr, i) => {
      const si = sIdx[i];
      if (si != null && si >= 0 && si < audios.length) {
        fr.sound = String(si);
        used.add(si);
        mapped++;
      }
    });
  }

  if (used.size === 0) return { name, status: `sin mapeo (anims: ${matched} ok / ${skipped} dif)` };

  // Generar dataURIs solo de los sonidos usados
  const sounds = {};
  const kinds = {};
  let totalBytes = 0;
  for (const i of used) {
    const { uri, kind, bytes } = wavToDataUri(audios[i]);
    sounds[String(i)] = uri;
    kinds[kind] = (kinds[kind] || 0) + 1;
    totalBytes += bytes;
  }

  // Validar que cada salida sea un WAV parseable
  for (const i of used) {
    const raw = Buffer.from(sounds[String(i)].split(',')[1], 'base64');
    if (!parseWav(raw)) return { name, status: 'WAV de salida inválido (idx ' + i + ')' };
  }

  // Escribir sounds-mp3.js y agent.js parcheado
  fs.writeFileSync(
    path.join(dir, 'sounds-mp3.js'),
    `clippy.soundsReady('${name}', ${JSON.stringify(sounds)});\n`
  );
  fs.writeFileSync(agentFile, `clippy.ready('${name}', ${JSON.stringify(data)});\n`);

  return {
    name, status: 'OK',
    sounds: used.size, mapped, matched, skipped,
    kb: Math.round(totalBytes / 1024),
    kinds,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const arg = process.argv[2];
  let names;
  if (arg) names = [arg];
  else {
    // todos los que NO tienen sonido todavía
    names = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((n) => !fs.existsSync(path.join(AGENTS_DIR, n, 'sounds-mp3.js')));
  }

  let ok = 0, totalKb = 0;
  const kindTotals = {};
  for (const name of names.sort()) {
    const r = processChar(name);
    if (r.status === 'OK') {
      ok++; totalKb += r.kb;
      for (const [k, v] of Object.entries(r.kinds)) kindTotals[k] = (kindTotals[k] || 0) + v;
      console.log(`✓ ${name.padEnd(14)} ${r.sounds} sonidos (${r.kb} KB), ${r.mapped} frames, anims ${r.matched} ok/${r.skipped} dif  ${JSON.stringify(r.kinds)}`);
    } else {
      console.log(`· ${name.padEnd(14)} ${r.status}`);
    }
  }
  console.log(`\n${ok} personajes con sonido nuevo, ${Math.round(totalKb / 1024 * 10) / 10} MB total.`);
  console.log('Tipos de audio:', JSON.stringify(kindTotals));
}

main();
