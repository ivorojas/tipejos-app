/*
 * Descarga los sprites de los asistentes clásicos (estilo Office / Microsoft Agent)
 * desde el mirror vivo de smore-inc/clippy.js en jsDelivr.
 *
 * Por cada personaje baja 3 archivos a assets/agents/<Nombre>/:
 *   - agent.js       (datos de animación: framesize, overlayCount, animations)
 *   - map.png        (hoja de sprites)
 *   - sounds-mp3.js  (audio en base64; Chromium/Electron reproduce mp3 nativo)
 *
 * Uso:  node scripts/download-agents.js
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://cdn.jsdelivr.net/gh/smore-inc/clippy.js@master/agents/';

// Los 10 personajes (nombres con mayúscula, tal cual el repo).
const AGENTS = [
  'Clippy', 'Merlin', 'Rover', 'Rocky', 'Links',
  'Genius', 'Genie', 'Peedy', 'F1', 'Bonzi',
];

const FILES = ['agent.js', 'map.png', 'sounds-mp3.js'];
const OUT = path.join(__dirname, '..', 'assets', 'agents');

async function fetchTo(url, dest, binary) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (binary) {
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  } else {
    fs.writeFileSync(dest, await res.text(), 'utf8');
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let ok = 0, fail = 0;

  for (const agent of AGENTS) {
    const dir = path.join(OUT, agent);
    fs.mkdirSync(dir, { recursive: true });
    process.stdout.write(`\n${agent}\n`);

    for (const file of FILES) {
      const dest = path.join(dir, file);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
        console.log(`  = ${file} (ya existe)`);
        ok++;
        continue;
      }
      try {
        await fetchTo(`${BASE}${agent}/${file}`, dest, file.endsWith('.png'));
        console.log(`  ↓ ${file}`);
        ok++;
      } catch (e) {
        console.error(`  ✗ ${file}: ${e.message}`);
        fail++;
      }
    }
  }

  console.log(`\nListo. ${ok} archivos OK, ${fail} fallidos.`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('Error general:', e);
  process.exit(1);
});
