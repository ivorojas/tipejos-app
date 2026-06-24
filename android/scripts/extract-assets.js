#!/usr/bin/env node
/**
 * Extrae los assets de los personajes al proyecto Android.
 *  - frames.json: { framesize:[w,h], animations:{ name:[ {x,y,d}, ... ] } }  (images[0] de cada frame)
 *  - phrases.json: { idle:[...frases cortas...], click:[...] }  (desde src/renderer/phrases.js)
 *  - sounds/<id>.mp3: audios decodificados desde sounds-mp3.js
 *  - copia map.png + thumb.png
 *
 * Uso:  node android/scripts/extract-assets.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const REPO = path.resolve(__dirname, '..', '..');
const SRC  = path.join(REPO, 'assets', 'agents');
const OUT  = path.join(REPO, 'android', 'app', 'src', 'main', 'assets', 'agents');

// Personajes para el MVP (famosos primero). Todos tienen frames + frases + sonidos.
const WANT = [
  'Clippy', 'Bonzi', 'Merlin', 'Peedy', 'Rocky', 'Rover', 'Dot', 'F1',
  'Links', 'Genie', 'Genius', 'Earl', 'MotherNature', 'PowerPup', 'Scribble',
  'OfficeLogo', 'Robby', 'Dolphin', 'Santa', 'Reaper', 'Wabbit', 'MonkeyKing',
  'Saeko', 'BillG',
];

const KEEP = [
  'RestPose', 'Show', 'Greeting',
  'IdleEyeBrowRaise', 'IdleSideToSide', 'IdleFingerTap', 'IdleHeadScratch',
  'IdleSnooze', 'IdleAtom', 'IdleRopePile', 'IdleEyesBlink', 'Idle1_1',
  'Wave', 'GestureUp', 'Pleased', 'Congratulate', 'GetAttention', 'Alert',
];

const MAX_LEN = 70;   // frases más cortas para celular

// ── Cargar PHRASES_DATA (es un window.PHRASES_DATA = {...}) ──────────────────
function loadPhrasesData() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'src', 'renderer', 'phrases.js'), 'utf8'), sandbox);
  return sandbox.window.PHRASES_DATA || {};
}

function gather(ph, cat) {
  const e = ph && ph[cat];
  if (!e) return [];
  const list = [].concat(e.roast || [], e.soft || []);
  return [...new Set(list)].filter(s => s.length <= MAX_LEN);
}

function parseAgent(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const i = raw.indexOf('{'), j = raw.lastIndexOf('}');
  return JSON.parse(raw.slice(i, j + 1));
}

function compactFrames(data) {
  const out = { framesize: data.framesize, animations: {} };
  const anims = data.animations || {};
  const names = new Set();
  for (const k of KEEP) if (anims[k]) names.add(k);
  for (const k of Object.keys(anims)) if (/^Idle/i.test(k)) names.add(k);
  // Fallback: si ninguna matcheó (nombres no estándar), incluir todas.
  if (names.size === 0) for (const k of Object.keys(anims)) names.add(k);
  for (const name of names) {
    const frames = (anims[name].frames || []).map(f => {
      const img = (f.images && f.images[0]) || [0, 0];
      return { x: img[0], y: img[1], d: f.duration || 100 };
    });
    if (frames.length) out.animations[name] = frames;
  }
  return out;
}

function extractSounds(file, outDir) {
  if (!fs.existsSync(file)) return 0;
  const raw = fs.readFileSync(file, 'utf8');
  const re = /'([^']+)'\s*:\s*'data:audio\/[^;]+;base64,([^']+)'/g;
  const sdir = path.join(outDir, 'sounds');
  fs.mkdirSync(sdir, { recursive: true });
  let n = 0, m;
  while ((m = re.exec(raw)) !== null) {
    const id = m[1].replace(/[^\w-]/g, '');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 100) { fs.writeFileSync(path.join(sdir, `${id}.mp3`), buf); n++; }
  }
  return n;
}

const PH = loadPhrasesData();
let done = 0;
const index = [];
for (const name of WANT) {
  const dir = path.join(SRC, name);
  if (!fs.existsSync(path.join(dir, 'agent.js'))) { console.warn('skip:', name); continue; }
  try {
    const data = parseAgent(path.join(dir, 'agent.js'));
    const outDir = path.join(OUT, name);
    fs.mkdirSync(outDir, { recursive: true });

    // frames
    const cf = compactFrames(data);
    fs.writeFileSync(path.join(outDir, 'frames.json'), JSON.stringify(cf));

    // phrases
    const ph = PH[name] || {};
    let idle = [...gather(ph, 'idle'), ...gather(ph, 'greeting')].slice(0, 40);
    let click = gather(ph, 'click').slice(0, 20);
    if (!idle.length) idle = ['👋', '🐾'];
    if (!click.length) click = idle;
    fs.writeFileSync(path.join(outDir, 'phrases.json'), JSON.stringify({ idle, click }));

    // sounds
    const nSounds = extractSounds(path.join(dir, 'sounds-mp3.js'), outDir);

    // bitmaps
    fs.copyFileSync(path.join(dir, 'map.png'),   path.join(outDir, 'map.png'));
    fs.copyFileSync(path.join(dir, 'thumb.png'), path.join(outDir, 'thumb.png'));

    index.push(name);
    done++;
    console.log(`✓ ${name}  ${Object.keys(cf.animations).length} anim · ${idle.length} frases · ${nSounds} sonidos · ${cf.framesize.join('x')}`);
  } catch (e) {
    console.error('error en', name, e.message);
  }
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
console.log(`\nListo: ${done} personajes -> ${path.relative(REPO, OUT)}`);
