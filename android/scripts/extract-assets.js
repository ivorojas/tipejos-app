#!/usr/bin/env node
/**
 * Extrae los assets de los personajes al proyecto Android.
 *  - Lee assets/agents/<Name>/agent.js (formato clippy.js: clippy.ready('Name', {...}))
 *  - Genera frames.json compacto: { framesize:[w,h], animations:{ name:[ {x,y,d}, ... ] } }
 *    (toma images[0] de cada frame — la capa base; suficiente para el MVP)
 *  - Copia map.png + thumb.png a android/app/src/main/assets/agents/<Name>/
 *
 * Uso:  node android/scripts/extract-assets.js
 */
const fs   = require('fs');
const path = require('path');

const REPO    = path.resolve(__dirname, '..', '..');
const SRC     = path.join(REPO, 'assets', 'agents');
const OUT     = path.join(REPO, 'android', 'app', 'src', 'main', 'assets', 'agents');

// Personajes famosos para el MVP (los que existan en assets/agents)
const WANT = [
  'Clippy', 'Bonzi', 'Merlin', 'Peedy', 'Rocky', 'Rover',
  'Dot', 'F1', 'Links', 'Genie', 'Genius', 'Earl',
];

// Animaciones que nos interesa portar (idle + algún truco). Si no existen, se ignoran.
const KEEP = [
  'RestPose', 'Show', 'Greeting',
  'IdleEyeBrowRaise', 'IdleSideToSide', 'IdleFingerTap', 'IdleHeadScratch',
  'IdleSnooze', 'IdleAtom', 'IdleRopePile', 'IdleEyesBlink', 'Idle1_1',
  'Wave', 'GestureUp', 'Pleased', 'Congratulate', 'GetAttention', 'Alert',
];

function parseAgent(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const i = raw.indexOf('{');
  const j = raw.lastIndexOf('}');
  if (i < 0 || j < 0) throw new Error('no JSON en ' + file);
  return JSON.parse(raw.slice(i, j + 1));
}

function compact(data) {
  const out = { framesize: data.framesize, animations: {} };
  const anims = data.animations || {};
  // Lista final: las KEEP que existan + cualquier "Idle*" presente
  const names = new Set();
  for (const k of KEEP) if (anims[k]) names.add(k);
  for (const k of Object.keys(anims)) if (/^Idle/i.test(k)) names.add(k);
  for (const name of names) {
    const frames = (anims[name].frames || []).map(f => {
      const img = (f.images && f.images[0]) || [0, 0];
      return { x: img[0], y: img[1], d: f.duration || 100 };
    });
    if (frames.length) out.animations[name] = frames;
  }
  return out;
}

let done = 0;
const index = [];
for (const name of WANT) {
  const dir = path.join(SRC, name);
  const agentFile = path.join(dir, 'agent.js');
  if (!fs.existsSync(agentFile)) { console.warn('skip (no existe):', name); continue; }
  try {
    const data    = parseAgent(agentFile);
    const compactD = compact(data);
    const outDir  = path.join(OUT, name);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'frames.json'), JSON.stringify(compactD));
    fs.copyFileSync(path.join(dir, 'map.png'),   path.join(outDir, 'map.png'));
    fs.copyFileSync(path.join(dir, 'thumb.png'), path.join(outDir, 'thumb.png'));
    index.push(name);
    done++;
    console.log(`✓ ${name}  (${Object.keys(compactD.animations).length} animaciones, ${compactD.framesize.join('x')})`);
  } catch (e) {
    console.error('error en', name, e.message);
  }
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
console.log(`\nListo: ${done} personajes -> ${path.relative(REPO, OUT)}`);
