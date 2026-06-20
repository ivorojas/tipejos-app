/*
 * Tipejos — motor de animación + comportamiento de las mascotas.
 *
 * Formato agent.js:  clippy.ready('Nombre', { overlayCount, framesize:[w,h], sounds, animations })
 * Animación: background-position CSS sobre map.png escalado.
 */

// ── Constantes ───────────────────────────────────────────────────────────────
const BUBBLE_PAD = 80; // px de espacio reservado arriba para el globo de diálogo

// ── Elementos del DOM ────────────────────────────────────────────────────────
const stage      = document.getElementById('stage');
const hit        = document.getElementById('hit');
const bubbleEl   = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');

// ── Estado del agente ────────────────────────────────────────────────────────
let agentData      = null;
let soundData      = {};
let overlays       = [];
let framesize      = [124, 93];
let currentBase    = '';
let injectedScripts = [];
let mapData        = null;
let mapW = 0, mapH = 0;
let curFrameImages = null;
let anim           = null;
let idleNames      = [];
let funNames       = [];
let loadToken      = 0;

// ── Ajustes (sincronizados desde main vía IPC) ───────────────────────────────
let petScale        = 1.0;
let soundOn         = false;
let volume          = 0.5;
let behaviorMode    = 'normal';   // 'calm' | 'normal' | 'playful'
let animFrequency   = 1.0;
let wanderEnabled   = false;
let timeReactions   = true;
let mouseReactions  = true;
let speechBubbles   = true;
let cargadaMode     = true;   // Modo Cargada: ~90% frases que te cargan, ~10% suaves
let currentCharName = '';

// ── Posición de la ventana (para wandering) ──────────────────────────────────
let petX = 0, petY = 0;
let screenBounds = { x: 0, y: 0, width: 1920, height: 1080 };

// ── JSONP capture ────────────────────────────────────────────────────────────
window.clippy = {
  ready:       (_n, data)   => { agentData  = data;          },
  soundsReady: (_n, sounds) => { soundData  = sounds || {};  },
};

// ── Carga de scripts ─────────────────────────────────────────────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar ' + src));
    document.body.appendChild(s);
    injectedScripts.push(s);
  });
}

function loadMapPixels(src, token) {
  const img = new Image();
  img.onload = () => {
    if (token !== loadToken) return;
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      if (token !== loadToken) return;
      mapW = img.naturalWidth; mapH = img.naturalHeight;
      mapData = ctx.getImageData(0, 0, mapW, mapH);
      applyScaleToOverlays(); // background-size ahora conocido
    } catch (e) { mapData = null; }
  };
  img.onerror = () => {};
  img.src = src;
}

// ── Carga de personaje ───────────────────────────────────────────────────────
async function loadAgent(name) {
  const myToken = ++loadToken;
  stopAnimation();
  agentData = null; soundData = {}; mapData = null; curFrameImages = null;
  mapW = 0; mapH = 0;
  injectedScripts.forEach((s) => s.remove());
  injectedScripts = [];

  const base = `../../assets/agents/${name}/`;
  currentBase = base;

  await loadScript(base + 'agent.js');
  if (myToken !== loadToken) return;
  if (!agentData) throw new Error('agent.js no registró datos para ' + name);

  buildAgent(name);

  loadScript(base + 'sounds-mp3.js').catch(() => { soundData = {}; });
  loadMapPixels(base + 'map.png', myToken);
}

function buildAgent(name) {
  currentCharName = name;
  framesize = agentData.framesize || [124, 93];
  const [fw, fh] = framesize;
  const w = Math.round(fw * petScale);
  const h = Math.round(fh * petScale);

  overlays.forEach((o) => o.remove());
  overlays = [];
  const count = agentData.overlayCount || 1;
  for (let i = 0; i < count; i++) {
    const d = document.createElement('div');
    d.className = 'pet-overlay';
    d.style.width  = w + 'px';
    d.style.height = h + 'px';
    d.style.top    = BUBBLE_PAD + 'px';
    d.style.backgroundImage = `url("${currentBase}map.png")`;
    d.style.backgroundSize  = mapW > 0 ? Math.round(mapW * petScale) + 'px auto' : 'auto';
    d.style.zIndex = String(i);
    stage.insertBefore(d, hit);
    overlays.push(d);
  }

  hit.style.width  = w + 'px';
  hit.style.height = h + 'px';
  hit.style.top    = BUBBLE_PAD + 'px';

  window.pet.reportSize(w, h + BUBBLE_PAD);
  window.pet.characterReady(name);

  prepareAnimationLists();

  const initImg = firstImagedFrame();
  if (initImg) drawFrame(initImg);

  startLife();
  if (timeReactions) checkTimeReactions();
  if (wanderEnabled) scheduleWander();
}

function firstImagedFrame() {
  const anims = agentData.animations || {};
  const withImg = (a) => a && a.frames && a.frames.find((f) => f.images && f.images.length);
  for (const nm of ['RestPose', 'Idle1_1', 'Greeting', 'Show']) {
    const f = withImg(anims[nm]); if (f) return f.images;
  }
  for (const nm of Object.keys(anims)) {
    const f = withImg(anims[nm]); if (f) return f.images;
  }
  return null;
}

// ── Escala ───────────────────────────────────────────────────────────────────
function applyScaleToOverlays() {
  if (!agentData) return;
  const [fw, fh] = framesize;
  const w = Math.round(fw * petScale);
  const h = Math.round(fh * petScale);
  for (const d of overlays) {
    d.style.width  = w + 'px';
    d.style.height = h + 'px';
    if (mapW > 0) d.style.backgroundSize = Math.round(mapW * petScale) + 'px auto';
  }
  hit.style.width  = w + 'px';
  hit.style.height = h + 'px';
  window.pet.reportSize(w, h + BUBBLE_PAD);
  if (curFrameImages) drawFrame(curFrameImages);
}

// ── Motor de animación ────────────────────────────────────────────────────────
function prepareAnimationLists() {
  const names = Object.keys(agentData.animations || {});
  idleNames = names.filter((n) => /^Idle/i.test(n));
  const CONTROL = new Set(['Show','Hide','Pause','Print','Save','EmptyTrash',
    'SendMail','GetTechy','CheckingSomething','Searching','Processing']);
  funNames = names.filter((n) => !/^Idle/i.test(n) && !CONTROL.has(n) && n !== 'RestPose');
  if (idleNames.length === 0)
    idleNames = names.includes('RestPose') ? ['RestPose'] : names.slice(0, 1);
}

function drawFrame(images) {
  if (!images || !images.length) return;
  curFrameImages = images;
  for (let i = 0; i < overlays.length; i++) {
    if (i < images.length) {
      overlays[i].style.display = 'block';
      overlays[i].style.backgroundPosition =
        `-${images[i][0] * petScale}px -${images[i][1] * petScale}px`;
    } else {
      overlays[i].style.display = 'none';
    }
  }
}

function pickBranch(branches) {
  let roll = Math.random() * 100;
  for (const b of branches) {
    if (roll <= b.weight) return b.frameIndex;
    roll -= b.weight;
  }
  return branches[branches.length - 1].frameIndex;
}

function stopAnimation() {
  if (anim) {
    clearTimeout(anim.timer); clearTimeout(anim.exitTimer); clearTimeout(anim.watchdog);
    anim.done = () => {}; anim.finished = true;
  }
  anim = null;
}

function playAnimation(name, onComplete) {
  const def = agentData && agentData.animations[name];
  if (!def) { if (onComplete) onComplete(); return; }
  stopAnimation();
  const a = { name, frames: def.frames, index: -1, exiting: false,
    timer: null, exitTimer: null, watchdog: null, finished: false, done: onComplete || (() => {}) };
  anim = a;
  if (def.frames.some((f) => f.branching))
    a.exitTimer = setTimeout(() => { a.exiting = true; }, 2500 + Math.random() * 3000);
  a.watchdog = setTimeout(() => finish(a), 12000);
  step(a);
}

function step(a) {
  if (a !== anim || a.finished) return;
  let next;
  if (a.index < 0) {
    next = 0;
  } else {
    const f = a.frames[a.index];
    if (a.exiting && typeof f.exitBranch === 'number') next = f.exitBranch;
    else if (f.branching && f.branching.branches) next = pickBranch(f.branching.branches);
    else next = a.index + 1;
  }
  if (next == null || next >= a.frames.length) { finish(a); return; }
  a.index = next;
  const f = a.frames[next];
  const dur = f.duration != null ? f.duration : 100;
  if (dur > 0) drawFrame(f.images); // frames con duration:0 son transiciones invisibles
  if (soundOn && f.sound != null && soundData[f.sound]) playSound(soundData[f.sound]);
  a.timer = setTimeout(() => step(a), dur);
}

function finish(a) {
  if (a.finished) return;
  a.finished = true;
  clearTimeout(a.timer); clearTimeout(a.exitTimer); clearTimeout(a.watchdog);
  const cb = a.done;
  if (a === anim) anim = null;
  cb();
}

let audioEl = null;
function playSound(dataUri) {
  try {
    if (!audioEl) audioEl = new Audio();
    audioEl.src = dataUri; audioEl.volume = volume;
    audioEl.play().catch(() => {});
  } catch (_) {}
}

// ── Vida del muñequito ────────────────────────────────────────────────────────
function startLife() {
  const intro = agentData.animations['Show'] ? 'Show'
    : agentData.animations['Greeting'] ? 'Greeting' : null;
  if (intro) playAnimation(intro, loopIdle);
  else loopIdle();
  // Saludo al aparecer
  if (speechBubbles) setTimeout(() => showCategoryBubble('greeting'), 700);
}

function loopIdle() {
  cancelWanderAnimation(); // no interrumpir animación con movimiento pendiente

  // Probabilidad de animación divertida según modo
  const funChance = behaviorMode === 'calm' ? 0.05 : behaviorMode === 'playful' ? 0.5 : 0.25;
  const pauseMult = behaviorMode === 'calm' ? 2.0  : behaviorMode === 'playful' ? 0.5  : 1.0;

  // Globo de diálogo ocasional
  if (speechBubbles && Math.random() < (behaviorMode === 'playful' ? 0.2 : 0.08)) {
    setTimeout(showRandomBubble, 300);
  }

  const playFun = funNames.length > 0 && Math.random() < funChance;
  const list    = playFun ? funNames : idleNames;
  const name    = list[Math.floor(Math.random() * list.length)];

  playAnimation(name, () => {
    if (wanderEnabled && Math.random() < 0.25) {
      doWander();
    } else {
      const pause = (600 + Math.random() * 2600) * pauseMult / animFrequency;
      setTimeout(loopIdle, pause);
    }
  });
}

// ── Globo de diálogo ─────────────────────────────────────────────────────────
// Frases por personaje y categoría (window.PHRASES_DATA viene de phrases.js).
const ALL_PHRASES = (typeof window !== 'undefined' && window.PHRASES_DATA) || {};
const GENERIC = {
  idle:     ['¿Todo bien por ahí?', '¿Cuándo es la próxima pausa? ☕', '¡Buen trabajo!',
             '¿Seguís ahí?', '*bosteza*', '¡Ya casi es viernes! 🎉', 'Hmm...'],
  greeting: ['¡Hola, che!', 'Buenas, ¿cómo andás?', '¡Acá estoy!'],
  click:    ['¡Ey! ¿Qué hacés?', '¿Me tocaste, posta?', 'Dale, tranqui.'],
  morning:  ['¡Buenos días! ☀️', '¡Arriba, che!'],
  night:    ['Es tarde, andá a dormir. 🌙', 'A la cama, dale.'],
};

// Devuelve { roast, soft } de una categoría para el personaje actual.
// Acepta el formato nuevo ({roast,soft}) y el viejo (array plano = todo roast).
function catSets(category) {
  const set = ALL_PHRASES[currentCharName];
  const entry = set && set[category];
  if (!entry) return { roast: [], soft: GENERIC[category] || GENERIC.idle || [] };
  if (Array.isArray(entry)) return { roast: entry, soft: [] };
  return { roast: entry.roast || [], soft: entry.soft || [] };
}

// Elige una frase respetando el Modo Cargada: ON => ~90% roast / ~10% soft;
// OFF => sólo suaves (y si no hay, cae a roast). Siempre con fallback a genéricas.
function pickPhrase(category) {
  const { roast, soft } = catSets(category);
  let pool;
  if (cargadaMode) {
    pool = (roast.length && (Math.random() < 0.9 || !soft.length)) ? roast
         : (soft.length ? soft : roast);
  } else {
    pool = soft.length ? soft : roast;
  }
  if (!pool || !pool.length) pool = GENERIC[category] || GENERIC.idle;
  return pick(pool);
}
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

let bubbleTimer = null;
function showBubble(text, duration = 4500) {
  if (!speechBubbles) return;
  clearTimeout(bubbleTimer);
  bubbleText.textContent = text;
  bubbleEl.classList.add('visible');
  bubbleTimer = setTimeout(() => bubbleEl.classList.remove('visible'), duration);
}

function showRandomBubble() { showBubble(pickPhrase('idle')); }
function showCategoryBubble(category, duration) { showBubble(pickPhrase(category), duration); }

// ── Reacciones por horario ────────────────────────────────────────────────────
function checkTimeReactions() {
  if (!timeReactions) return;
  const h = new Date().getHours();
  if (h >= 6 && h < 9) {
    setTimeout(() => showCategoryBubble('morning'), 2500);
    if (agentData?.animations['Greeting'])
      setTimeout(() => playAnimation('Greeting', loopIdle), 1000);
  } else if (h >= 22 || h < 5) {
    setTimeout(() => showCategoryBubble('night'), 3000);
  } else if (h === 12 || h === 13) {
    setTimeout(() => showBubble('¡Es hora de almorzar! 🍽️'), 2000);
  }
}

// ── Seguimiento del cursor ────────────────────────────────────────────────────
const LOOK_ANIMS = ['LookRight','LookLeft','LookUp','LookDown',
  'GlanceRight','GlanceLeft','GlanceUp','GlanceDown'];
let lastLookTime = 0;

function checkProximity(mx, my) {
  if (!mouseReactions || dragging || !agentData) return;
  const [fw, fh] = framesize;
  const cx   = Math.round(fw * petScale / 2);
  const cy   = BUBBLE_PAD + Math.round(fh * petScale / 2);
  const dist = Math.hypot(mx - cx, my - cy);
  const now  = Date.now();
  if (dist < 140 && dist > 20 && now - lastLookTime > 7000 && !anim) {
    lastLookTime = now;
    const candidates = LOOK_ANIMS.filter((n) => agentData.animations[n]);
    if (candidates.length > 0) {
      playAnimation(candidates[Math.floor(Math.random() * candidates.length)], loopIdle);
    }
  }
}

// ── Movimiento autónomo (wandering) ───────────────────────────────────────────
let wanderAnimFrame  = null;
let wanderTimeout    = null;

function scheduleWander() {
  clearTimeout(wanderTimeout);
  if (!wanderEnabled) return;
  wanderTimeout = setTimeout(doWander, 20000 + Math.random() * 30000);
}

async function doWander() {
  if (!wanderEnabled || !agentData) { loopIdle(); return; }
  const [winX, winY] = await window.pet.getPosition();
  petX = winX; petY = winY;

  const [fw, fh] = framesize;
  const w = Math.round(fw * petScale);
  const h = Math.round(fh * petScale);
  const margin = 40;
  const maxX = screenBounds.x + screenBounds.width  - w - margin;
  const maxY = screenBounds.y + screenBounds.height - h - margin;
  const minX = screenBounds.x + margin;
  const minY = screenBounds.y + margin;

  const targetX = minX + Math.random() * Math.max(0, maxX - minX);
  const targetY = minY + Math.random() * Math.max(0, maxY - minY) - BUBBLE_PAD;

  animateToPosition(targetX, targetY, 1800 + Math.random() * 1600, () => {
    const pause = 800 + Math.random() * 1200;
    setTimeout(loopIdle, pause);
  });
}

function cancelWanderAnimation() {
  if (wanderAnimFrame) { cancelAnimationFrame(wanderAnimFrame); wanderAnimFrame = null; }
}

function animateToPosition(targetX, targetY, duration, onDone) {
  const startX = petX, startY = petY, startTime = performance.now();
  function step(now) {
    const t    = Math.min(1, (now - startTime) / duration);
    const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    petX = startX + (targetX - startX) * ease;
    petY = startY + (targetY - startY) * ease;
    window.pet.setPosition(Math.round(petX), Math.round(petY));
    if (t < 1) wanderAnimFrame = requestAnimationFrame(step);
    else { petX = targetX; petY = targetY; if (onDone) onDone(); }
  }
  cancelWanderAnimation();
  wanderAnimFrame = requestAnimationFrame(step);
}

// ── Hit-test por pixel ────────────────────────────────────────────────────────
function isOpaqueAt(x, y) {
  const spriteY = y - BUBBLE_PAD;
  if (spriteY < 0 || !agentData || !curFrameImages) return false;
  if (!mapData) {
    return x >= 0 && spriteY >= 0
      && x < framesize[0] * petScale && spriteY < framesize[1] * petScale;
  }
  const fx = Math.floor(x / petScale);
  const fy = Math.floor(spriteY / petScale);
  const R  = Math.ceil(7 / petScale); // tolerancia en píxeles del mapa
  for (let li = 0; li < curFrameImages.length; li++) {
    const baseX = curFrameImages[li][0], baseY = curFrameImages[li][1];
    for (let dy = -R; dy <= R; dy += 1) {
      for (let dx = -R; dx <= R; dx += 1) {
        const ox = baseX + fx + dx, oy = baseY + fy + dy;
        if (ox < 0 || oy < 0 || ox >= mapW || oy >= mapH) continue;
        if (mapData.data[(oy * mapW + ox) * 4 + 3] > 12) return true;
      }
    }
  }
  return false;
}

// ── Arrastrar ────────────────────────────────────────────────────────────────
let dragging   = false;
let dragOffset = { x: 0, y: 0 };
let ignoring   = true;

function setIgnore(v) {
  if (v === ignoring) return;
  ignoring = v;
  window.pet.setIgnore(v);
}

hit.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  cancelWanderAnimation();
  dragging   = true;
  dragOffset = { x: e.clientX, y: e.clientY };
  hit.classList.add('dragging');
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (dragging) {
    petX = e.screenX - dragOffset.x;
    petY = e.screenY - dragOffset.y;
    window.pet.setPosition(petX, petY);
    return;
  }
  setIgnore(!isOpaqueAt(e.clientX, e.clientY));
  checkProximity(e.clientX, e.clientY);
});

window.addEventListener('mouseup', () => {
  if (dragging) { dragging = false; hit.classList.remove('dragging'); }
});

// ── Interacción: doble clic y clic derecho ───────────────────────────────────
hit.addEventListener('dblclick', () => {
  window.pet.openSettings();
});

hit.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.pet.showContextMenu();
});

// ── Clic: frase ocasional + easter egg de triple clic ────────────────────────
let clickHistory = [];
hit.addEventListener('click', () => {
  const now = Date.now();
  clickHistory = clickHistory.filter((t) => now - t < 2000);
  clickHistory.push(now);
  if (clickHistory.length >= 3) {
    clickHistory = [];
    const specials = ['Magic','Confused','Congratulate','Wave','Thinking','Surprised']
      .filter((n) => agentData?.animations[n]);
    if (specials.length > 0)
      playAnimation(specials[Math.floor(Math.random() * specials.length)], loopIdle);
    if (speechBubbles) showCategoryBubble('click', 3000);
  } else if (speechBubbles && Math.random() < 0.4) {
    // clic simple: a veces el personaje reacciona con una frase
    showCategoryBubble('click', 3000);
  }
});

// ── Inicio ────────────────────────────────────────────────────────────────────
window.pet.onSetCharacter((name) => loadAgent(name).catch((e) => console.error(e)));

window.pet.onSetSound(          (v) => { soundOn       = v; });
window.pet.onSetVolume(         (v) => { volume        = v; if (audioEl) audioEl.volume = v; });
window.pet.onSetScale(          (v) => { petScale      = v; applyScaleToOverlays(); });
window.pet.onSetBehavior(       (v) => { behaviorMode  = v; });
window.pet.onSetAnimFrequency(  (v) => { animFrequency = v; });
window.pet.onSetWander(         (v) => { wanderEnabled = v; if (v) scheduleWander(); else clearTimeout(wanderTimeout); });
window.pet.onSetTimeReactions(  (v) => { timeReactions = v; });
window.pet.onSetMouseReactions( (v) => { mouseReactions= v; });
window.pet.onSetSpeechBubbles(  (v) => { speechBubbles = v; if (!v) bubbleEl.classList.remove('visible'); });
window.pet.onSetCargadaMode(    (v) => { cargadaMode = v; });
window.pet.onDoTrick(           ()  => { if (funNames.length) playAnimation(funNames[Math.floor(Math.random()*funNames.length)], loopIdle); });
window.pet.onShowBubbleRandom(  ()  => showRandomBubble());

(async function init() {
  const initial = await window.pet.getInitial();
  soundOn        = !!initial.soundOn;
  volume         = initial.volume        ?? 0.5;
  petScale       = initial.scale         ?? 1.0;
  behaviorMode   = initial.behaviorMode  ?? 'normal';
  animFrequency  = initial.animFrequency ?? 1.0;
  wanderEnabled  = !!initial.wander;
  timeReactions  = initial.timeReactions  !== false;
  mouseReactions = initial.mouseReactions !== false;
  speechBubbles  = initial.speechBubbles  !== false;
  cargadaMode    = initial.cargadaMode    !== false;
  if (initial.screenBounds) screenBounds = initial.screenBounds;
  petX = initial.petX ?? 0;
  petY = initial.petY ?? 0;

  if (initial.agent) {
    try { await loadAgent(initial.agent); }
    catch (e) { console.error('No se pudo cargar el personaje inicial:', e); }
  } else {
    console.warn('No hay personajes descargados. Corre "npm run setup".');
  }

  if (initial.firstRun) showWelcomeSequence();
})();

// ── Tutorial de bienvenida (primer arranque) ──────────────────────────────────
function showWelcomeSequence() {
  const steps = [
    '¡Hola! Soy tu nueva mascota de escritorio. 👋',
    'Hacé clic derecho en mí para cambiar de personaje o sumar más.',
    'Doble clic en el ícono ▲ (abajo a la derecha) abre los Ajustes.',
    '¡A disfrutar! 🎉',
  ];
  let i = 0;
  const DUR = 5000;
  (function next() {
    if (i >= steps.length) return;
    showBubble(steps[i++], DUR);
    setTimeout(next, DUR + 600);
  })();
}
