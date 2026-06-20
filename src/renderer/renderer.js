/*
 * Tipejos — motor de animación + comportamiento de las mascotas.
 *
 * Formato agent.js:  clippy.ready('Nombre', { overlayCount, framesize:[w,h], sounds, animations })
 * Animación: background-position CSS sobre map.png escalado.
 */

// ── Constantes ───────────────────────────────────────────────────────────────
const BUBBLE_PAD   = 150; // px reservados arriba del sprite para el globo (debe coincidir con main.js)
const BUBBLE_MIN_W = 250; // ancho mínimo de la ventana para que el globo tenga lugar para el texto
const BUBBLE_GAP   = 12;  // separación entre la base del globo y la cabeza del sprite

// ── Debug ────────────────────────────────────────────────────────────────────
// Abrí DevTools con Ctrl+Shift+D y mirá la consola mientras arrastrás.
const DBG = true;
function dbg(...args) { if (DBG) console.log('[Tipejos]', ...args); }

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
let displayMapURL  = '';     // imagen de fondo actual (map.png o map@2x.png)
let displaySmooth  = false;  // true = render suave (assets 2×); false = pixelado
let curFrameImages = null;
let anim           = null;
let idleNames      = [];
let funNames       = [];
let loadToken      = 0;
let spriteLeft     = 0;      // offset horizontal del sprite dentro de la ventana (centrado si la ventana es más ancha)

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
      const sameSize = (mapW === img.naturalWidth && mapH === img.naturalHeight);
      mapW = img.naturalWidth; mapH = img.naturalHeight;
      mapData = ctx.getImageData(0, 0, mapW, mapH);
      // Si las dimensiones ya estaban bien (gracias al probe previo), no llamar a
      // applyScaleToOverlays porque eso manda agent-size y puede interrumpir un drag.
      if (!sameSize) applyScaleToOverlays();
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

  // Imagen de display por defecto: original, nítido (pixelado).
  displayMapURL = base + 'map.png';
  displaySmooth = false;

  await loadScript(base + 'agent.js');
  if (myToken !== loadToken) return;
  if (!agentData) throw new Error('agent.js no registró datos para ' + name);

  // Obtener dimensiones del mapa ANTES de buildAgent para que backgroundSize
  // sea correcto desde el primer frame y no haya parpadeo a escalas > 1×.
  await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (myToken === loadToken) { mapW = img.naturalWidth; mapH = img.naturalHeight; }
      resolve();
    };
    img.onerror = resolve;
    img.src = base + 'map.png';
  });
  if (myToken !== loadToken) return;

  buildAgent(name);

  loadScript(base + 'sounds-mp3.js').catch(() => { soundData = {}; });
  loadMapPixels(base + 'map.png', myToken);

  // Primero: usar map@2x.png (Scale2x) de assets, si existe.
  // Scale2x es pixel art → mantener renderizado pixelado (no suavizar).
  probeImage(base + 'map@2x.png').then((ok) => {
    if (myToken !== loadToken || !ok) return;
    displayMapURL = base + 'map@2x.png';
    displaySmooth = false;
    applyDisplayMap();
  });

  // Segundo: consultar si ya hay versión AI en cache (userData).
  // Si existe, la usa; si no, pide que se genere en background.
  window.pet.checkAiSprite(name).then(({ exists, filePath }) => {
    if (myToken !== loadToken) return;
    if (exists) {
      displayMapURL = 'file:///' + filePath.replace(/\\/g, '/');
      displaySmooth = true;
      applyDisplayMap();
    } else {
      window.pet.requestAiSprite(name); // fire-and-forget
    }
  });
}

// Resuelve true/false según si una imagen carga (existe) o no.
function probeImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload  = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

// Aplica la imagen de fondo y el modo de render a todas las capas.
// Precarga la imagen en memoria antes de asignarla para evitar el flash
// que ocurre cuando el browser carga una nueva URL mid-animación.
function applyDisplayMap() {
  const url    = displayMapURL;
  const smooth = displaySmooth;
  const img    = new Image();
  const apply  = () => {
    if (displayMapURL !== url) return; // ya hubo otro cambio, descartar
    for (const d of overlays) {
      d.style.backgroundImage = `url("${url}")`;
      d.style.imageRendering  = smooth ? 'auto' : 'pixelated';
    }
  };
  img.onload  = apply;
  img.onerror = apply; // aplicar igual si hay error (mejor que no hacer nada)
  img.src = url;
}

// Calcula el ancho de ventana y el offset horizontal del sprite, posiciona el
// globo, y reporta el tamaño al proceso principal. Centra el sprite cuando la
// ventana es más ancha que él (porque el globo necesita un ancho mínimo).
function layoutWindow(w, h) {
  const winW = Math.max(w, BUBBLE_MIN_W);
  spriteLeft = Math.round((winW - w) / 2);

  for (const d of overlays) d.style.left = spriteLeft + 'px';
  hit.style.left = spriteLeft + 'px';

  bubbleEl.style.bottom = (h + BUBBLE_GAP) + 'px';

  const inset = { left: spriteLeft, top: BUBBLE_PAD, right: spriteLeft, bottom: 0 };
  dbg(`layoutWindow w=${w} h=${h} winW=${winW} dragging=${dragging} — reportSize(${winW}, ${h + BUBBLE_PAD})`);
  window.pet.reportSize(winW, h + BUBBLE_PAD, inset);
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
    d.style.backgroundImage = `url("${displayMapURL || currentBase + 'map.png'}")`;
    d.style.imageRendering  = displaySmooth ? 'auto' : 'pixelated';
    d.style.backgroundSize  = mapW > 0 ? Math.round(mapW * petScale) + 'px auto' : 'auto';
    d.style.zIndex = String(i);
    stage.insertBefore(d, hit);
    overlays.push(d);
  }

  hit.style.width  = w + 'px';
  hit.style.height = h + 'px';
  hit.style.top    = BUBBLE_PAD + 'px';

  layoutWindow(w, h);
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
  layoutWindow(w, h);
  if (curFrameImages) drawFrame(curFrameImages);
}

// ── Motor de animación ────────────────────────────────────────────────────────
// Animaciones de publicidad (texto promocional / web del origen, no parte del
// personaje): E-man/E-woman tienen "4DEV_Advert", Wartnose "Advert_1". Se
// excluyen de toda rotación automática para que nunca aparezcan solas.
const AD_RE = /advert/i;

function prepareAnimationLists() {
  const names = Object.keys(agentData.animations || {}).filter((n) => !AD_RE.test(n));
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
  // Sincronizar el redibujado con el ciclo de render del browser (evita tearing
  // y parpadeo en ventanas transparentes, especialmente con overlayCount > 1).
  if (dur > 0) requestAnimationFrame(() => { if (a === anim && !a.finished) drawFrame(f.images); });
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
// Tiempo de arranque: durante los primeros 8 segundos solo se muestra el saludo
// inicial y se suprimen los mensajes de horario y los globos idle aleatorios,
// para que no se disparen 5 mensajes seguidos al agregar un personaje.
let startupGraceUntil = 0;

function startLife() {
  startupGraceUntil = Date.now() + 8000;
  const intro = agentData.animations['Show'] ? 'Show'
    : agentData.animations['Greeting'] ? 'Greeting' : null;
  if (intro) playAnimation(intro, loopIdle);
  else loopIdle();
  // Saludo al aparecer (único mensaje garantizado al inicio)
  if (speechBubbles) setTimeout(() => showCategoryBubble('greeting'), 700);
}

function loopIdle() {
  cancelWanderAnimation(); // no interrumpir animación con movimiento pendiente

  // Probabilidad de animación divertida según modo
  const funChance = behaviorMode === 'calm' ? 0.05 : behaviorMode === 'playful' ? 0.5 : 0.25;
  const pauseMult = behaviorMode === 'calm' ? 2.0  : behaviorMode === 'playful' ? 0.5  : 1.0;

  // Globo de diálogo ocasional (suprimido durante el grace period de arranque)
  const inGrace = Date.now() < startupGraceUntil;
  if (!inGrace && speechBubbles && Math.random() < (behaviorMode === 'playful' ? 0.2 : 0.08)) {
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
  // Frases compartidas que se burlan del uso de IA. Aparecen ~15% del tiempo en modo cargada.
  aiRoast: [
    '¿Le preguntaste al ChatGPT cómo respirar bien?',
    'Che, le preguntás a la IA hasta qué comer. ¿En serio?',
    '¿Qué hacías antes del ChatGPT? Ah, pensabas vos. Qué época.',
    '¿Y yo? ¿Me reemplazó la IA o qué onda?',
    'La IA ya sabe más de tu vida que tu mejor amigo.',
    'Tenés más conversaciones con ChatGPT que con personas reales.',
    'Claude te va a empezar a cobrar por el trauma que le das.',
    '¿Le pedís a la IA hasta que te diga si llueve, che?',
    'Tanto ChatGPT y el laburo sigue igual de vacío. Mirá vos.',
    '¿Tu próxima búsqueda es "cómo usar mejor la IA"? Ya sé que sí.',
    'Le preguntaste a la IA si soy mejor que ella, ¿no? Spoiler: sí.',
    'Escribiste más prompts que palabras propias hoy, posta.',
    '¿ChatGPT, Claude, Gemini? Tenés más IAs que amigos, che.',
    'Usás la IA hasta para saber qué serie ver esta noche.',
    'La IA te escribe todo y vos te llevás el crédito. Respeto.',
    'Con IA pa todo y seguís acá sin terminar nada. Mirá vos.',
    'Próximamente: le pedís a la IA que piense por vos. Ah, ya pasó.',
    'Le preguntaste a Claude cómo se siente el lunes. Hay terapeutas, che.',
    '¿Le dijiste al ChatGPT que me tenés a mí y que lo hago mejor?',
    'La IA tiene paciencia infinita. Por eso me preferís a mí, obvio.',
    'Tanto copiar respuestas de la IA y ni las entendés, boludo.',
    '¿Le mandás hasta los mails al ChatGPT? Ya no pensás vos nada.',
    'Ojo que la IA también se equivoca. Como vos, pero más rápido.',
    'Che, vas a terminar hablándole a la IA de tus sentimientos.',
    'Horas con la IA y el trabajo igual sin terminar. Clásico.',
  ],
};

let phraseLikes = {}; // { charName: { phrase: false } } — frases descartadas por el usuario

// Devuelve { roast, soft } de una categoría para el personaje actual,
// filtrando las frases que el usuario descartó.
function catSets(category) {
  const set   = ALL_PHRASES[currentCharName];
  const entry = set && set[category];
  let roast, soft;
  if (!entry) {
    roast = []; soft = GENERIC[category] || GENERIC.idle || [];
  } else if (Array.isArray(entry)) {
    roast = entry; soft = [];
  } else {
    roast = entry.roast || []; soft = entry.soft || [];
  }
  const disliked = phraseLikes[currentCharName] || {};
  return {
    roast: roast.filter(p => disliked[p] !== false),
    soft:  soft.filter(p => disliked[p] !== false),
  };
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

// ── Cola de globos ────────────────────────────────────────────────────────────
// showBubble()  → inmediato (usuario): descarta cola, muestra ya.
// queueBubble() → encolado (automático): espera a que termine el actual.
let bubbleTimer   = null;
let bubbleQ       = [];
let bubbleRunning = false;

function showBubble(text, duration = 5200) {
  if (!speechBubbles) return;
  bubbleQ       = [];
  bubbleRunning = false;
  clearTimeout(bubbleTimer);
  _playBubble(text, duration);
}

function queueBubble(text, duration = 5200) {
  if (!speechBubbles) return;
  bubbleQ.push({ text, duration });
  if (!bubbleRunning) _drainQ();
}

function _playBubble(text, duration) {
  bubbleRunning          = true;
  bubbleText.textContent = text;
  bubbleEl.classList.add('visible');
  bubbleTimer = setTimeout(() => {
    bubbleEl.classList.remove('visible');
    bubbleRunning = false;
    if (bubbleQ.length) setTimeout(_drainQ, 700);
  }, duration);
}

function _drainQ() {
  if (bubbleRunning || !bubbleQ.length) return;
  const { text, duration } = bubbleQ.shift();
  _playBubble(text, duration);
}

// Automáticos usan queueBubble; usuario usa showBubble directamente.
function showRandomBubble() {
  // 15% de chance de tirar una frase de IA cuando el modo cargada está activo.
  if (cargadaMode && Math.random() < 0.15)
    return queueBubble(pick(GENERIC.aiRoast));
  queueBubble(pickPhrase('idle'));
}
function showCategoryBubble(cat, dur) { queueBubble(pickPhrase(cat), dur); }

// ── Reacciones por horario ────────────────────────────────────────────────────
function checkTimeReactions() {
  if (!timeReactions || Date.now() < startupGraceUntil) return;
  const h = new Date().getHours();
  if (h >= 6 && h < 9) {
    setTimeout(() => showCategoryBubble('morning'), 2500);
    if (agentData?.animations['Greeting'])
      setTimeout(() => playAnimation('Greeting', loopIdle), 1000);
  } else if (h >= 22 || h < 5) {
    setTimeout(() => showCategoryBubble('night'), 3000);
  } else if (h === 12 || h === 13) {
    setTimeout(() => queueBubble('¡Es hora de almorzar! 🍽️'), 2000);
  }
}

// ── Seguimiento del cursor ────────────────────────────────────────────────────
const LOOK_ANIMS = ['LookRight','LookLeft','LookUp','LookDown',
  'GlanceRight','GlanceLeft','GlanceUp','GlanceDown'];
let lastLookTime = 0;

function checkProximity(mx, my) {
  if (!mouseReactions || dragging || !agentData) return;
  const [fw, fh] = framesize;
  const cx   = spriteLeft + Math.round(fw * petScale / 2);
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
  if (!wanderEnabled || !agentData || dragging) { loopIdle(); return; }
  const [winX, winY] = await window.pet.getPosition();
  // El usuario puede haber empezado a arrastrar mientras esperábamos el IPC.
  if (!wanderEnabled || !agentData || dragging) { return; }
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
    // Si el usuario empezó a arrastrar, abortar el movimiento autónomo.
    if (dragging) { wanderAnimFrame = null; return; }
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
  const spriteX = x - spriteLeft;
  const spriteY = y - BUBBLE_PAD;
  if (spriteX < 0 || spriteY < 0 || !agentData || !curFrameImages) return false;
  if (!mapData) {
    return spriteX < framesize[0] * petScale && spriteY < framesize[1] * petScale;
  }
  const fx = Math.floor(spriteX / petScale);
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
let dragging  = false;
let dragMoved = false; // true si el mouse se movió durante el arrastre actual
let ignoring  = true;

function setIgnore(v) {
  if (v === ignoring) return;
  ignoring = v;
  window.pet.setIgnore(v);
}

hit.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  cancelWanderAnimation();
  dragging  = true;
  dragMoved = false;
  petX = e.screenX - e.clientX;
  petY = e.screenY - e.clientY;
  dbg(`mousedown screenX=${e.screenX} clientX=${e.clientX} → petX=${petX} | DPR=${window.devicePixelRatio} screenW=${screen.width} winW=${window.outerWidth}`);
  window.pet.dragStart();
  hit.classList.add('dragging');
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (dragging) {
    if (e.movementX || e.movementY) dragMoved = true;
    petX += e.movementX;
    petY += e.movementY;
    window.pet.setPosition(Math.round(petX), Math.round(petY));
    return;
  }
  setIgnore(!isOpaqueAt(e.clientX, e.clientY));
  checkProximity(e.clientX, e.clientY);
});

window.addEventListener('mouseup', () => {
  if (dragging) {
    dragging = false;
    window.pet.dragEnd();
    hit.classList.remove('dragging');
  }
});

// ── Interacción: clics y clic derecho ────────────────────────────────────────
hit.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.pet.showContextMenu();
});

// Detección propia de doble clic (no delegar al OS para tener umbral consistente).
// DBLCLICK_MS: dos clicks consecutivos dentro de este margen = doble clic.
// Triple clic (easter egg): tres clicks simples —ningún par dentro de DBLCLICK_MS—
// dentro de 2s. Ej: click… 500ms… click… 500ms… click.
const DBLCLICK_MS = 300;
let lastClickMs  = 0;
let clickHistory = [];

hit.addEventListener('click', () => {
  if (dragMoved) { lastClickMs = 0; clickHistory = []; return; }

  const now = Date.now();
  const gap = now - lastClickMs;
  lastClickMs = now;

  // ── Doble clic ──────────────────────────────────────────────────────────────
  if (gap > 0 && gap < DBLCLICK_MS) {
    lastClickMs  = 0; // evitar que el siguiente click sea falso dblclick
    clickHistory = [];
    if (speechBubbles) showBubble(pickPhrase('click'), 3700);
    return;
  }

  // ── Triple clic (easter egg) ─────────────────────────────────────────────────
  clickHistory = clickHistory.filter((t) => now - t < 2000);
  clickHistory.push(now);
  if (clickHistory.length >= 3) {
    clickHistory = [];
    lastClickMs  = 0;
    const specials = ['Magic','Confused','Congratulate','Wave','Thinking','Surprised']
      .filter((n) => agentData?.animations[n]);
    if (specials.length > 0)
      playAnimation(specials[Math.floor(Math.random() * specials.length)], loopIdle);
    if (speechBubbles) showBubble(pickPhrase('click'), 3700);
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
window.pet.onSetBubbleFontSize( (v) => { document.documentElement.style.setProperty('--bubble-fs', v + 'px'); });
window.pet.onSetPhraseLikes((likes) => { phraseLikes = likes; });
window.pet.onDoTrick(           ()  => { if (funNames.length) playAnimation(funNames[Math.floor(Math.random()*funNames.length)], loopIdle); });
window.pet.onShowBubbleRandom(  ()  => showRandomBubble());
window.pet.onAiSpriteReady((name, filePath) => {
  if (name !== currentCharName) return;
  displayMapURL = 'file:///' + filePath.replace(/\\/g, '/');
  displaySmooth = true;
  applyDisplayMap();
});

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
  phraseLikes    = initial.phraseLikes || {};
  if (initial.screenBounds) screenBounds = initial.screenBounds;
  petX = initial.petX ?? 0;
  petY = initial.petY ?? 0;

  if (initial.bubbleFontSize) document.documentElement.style.setProperty('--bubble-fs', initial.bubbleFontSize + 'px');

  if (initial.agent) {
    try { await loadAgent(initial.agent); }
    catch (e) { console.error('No se pudo cargar el personaje inicial:', e); }
  } else {
    console.warn('No hay personajes descargados. Corre "npm run setup".');
  }

  if (initial.firstRun) {
    showWelcomeSequence();
    lastShownHour = getRoundedHour(); // no mostrar hora durante la bienvenida
  } else {
    if (initial.showSoundTip) {
      setTimeout(() => queueBubble('🔊 Sonidos activados — podés desactivarlos en Ajustes.', 6500), 3000);
      setTimeout(showDayBubble,  12000);
      setTimeout(showHourBubble, 19000);
    } else {
      setTimeout(showDayBubble,  5000);
      setTimeout(showHourBubble, 12000);
    }
  }
  scheduleHourCheck();
})();

// ── Frase según el día de la semana ──────────────────────────────────────────
const DAY_PHRASES = [
  // 0 Domingo
  ['La ansiedad del lunes ya te comió el domingo. Bien merecido, che.',
   '¿Aprovechaste el finde? Los dos sabemos la respuesta.'],
  // 1 Lunes
  ['Lunes. Otra semana para confirmar lo que todos ya sospechamos de vos.',
   '¡Lunes! Mirá que arrancás con energía... de durar hasta las 9 y media.'],
  // 2 Martes
  ['Martes. Ya no podés culpar al lunes. Te quedaste sin excusas, genio.',
   'Martes: la semana arrancó y vos todavía en modo "me estoy adaptando".'],
  // 3 Miércoles
  ['Mitad de semana. ¿Qué hiciste hasta acá? Sí, exactamente eso: nada.',
   'Miércoles. Llegaste al Ecuador sin producir nada. Muy coherente.'],
  // 4 Jueves
  ['Jueves. Tan cerca del viernes, tan lejos de haber cumplido algo.',
   '¿Jueves? Ya guardaste todo mentalmente para el finde, ¿no? Obvio.'],
  // 5 Viernes
  ['Viernes. Sobreviviste otra semana de puro chamuyo. Qué talento.',
   '¡Viernes! No cumpliste nada del lunes pero celebrá igual, dale. 🎉'],
  // 6 Sábado
  ['Sábado. Tenías mil planes. Ya sabemos cómo termina esto, vamos.',
   'Sábado en modo vegetal. La semana fue un desastre y el finde igual.'],
];

function showDayBubble() {
  if (!speechBubbles) return;
  const phrases = DAY_PHRASES[new Date().getDay()] || [];
  if (phrases.length) queueBubble(phrases[Math.floor(Math.random() * phrases.length)]);
}

// ── Frase según la hora del día ───────────────────────────────────────────────
const HOUR_PHRASES = [
  'Medianoche. Sin sueño y sin logros. La combinación más tuya.',        // 0
  'La 1 AM. ¿Mañana empezás en serio? Te escucho decir eso hace meses.',// 1
  'Las 2 AM. Lo único productivo a esta hora es tu insomnio. Genial.',  // 2
  'Las 3 AM. El sueño no te quiere y la productividad tampoco. Justo.', // 3
  'Las 4 AM. Ni los más dedicados llegan hasta acá. Vos sí. Rarísimo.', // 4
  'Las 5 AM. O no dormiste nada o sos un caso raro. Ninguna es buena.', // 5
  'Las 6 AM. El mundo arranca. Vos también, pero a otra velocidad.',    // 6
  'Las 7. Levantarse. Si sos vos, en 10 minutitos más nomás, claro.',   // 7
  'Las 8. El día arrancó hace rato. Vos todavía calentando motores.',   // 8
  'Las 9. Hora pico del chamuyo matutino. Ya sé cómo termina tu día.', // 9
  "Las 10. Ya no hay excusa de 'recién me levanté'. Inventate otra.",   // 10
  'Las 11. Casi mediodía y recién engranando. Rendimiento de élite.',   // 11
  'Mediodía. Media jornada ida. La otra media viene a completar el cuadro.', // 12
  'La 1. El post-almuerzo te va a matar antes que cualquier deadline.', // 13
  'Las 2. El bajón de la tarde llegó antes que cualquier resultado.',   // 14
  'Las 3. ¿Cuánto hiciste hoy realmente? Exactamente lo que imaginé.',  // 15
  'Las 4. Dos horas hábiles. Perfectas para no hacer absolutamente nada.', // 16
  'Las 5. Fin del horario laboral. Tu jornada terminó antes de empezar.',// 17
  'Las 6. Un día más sumado a la estadística de logros nulos. Grande.',  // 18
  'Las 7. Mirás el día y contás logros. Spoiler: el contador marcó cero.', // 19
  'Las 8. ¿Cenaste o seguís procrastinando? Las dos cosas a la vez, asumo.', // 20
  'Las 9 de la noche. El día se fue sin rastro de tu productividad.',   // 21
  "Las 10. Otro día más que 'mañana empezás en serio'. Clásico tuyo.", // 22
  'Las 11 PM. El potencial se fue a dormir antes que vos. Típico.',     // 23
];

let lastShownHour = -1;

function getRoundedHour() {
  const d = new Date();
  return d.getMinutes() >= 30 ? (d.getHours() + 1) % 24 : d.getHours();
}

function showHourBubble() {
  if (!speechBubbles) return;
  const h = getRoundedHour();
  if (HOUR_PHRASES[h]) queueBubble(HOUR_PHRASES[h]);
  lastShownHour = h;
}

function scheduleHourCheck() {
  setInterval(() => {
    const h = getRoundedHour();
    if (h !== lastShownHour) showHourBubble();
  }, 60 * 1000);
}

// ── Tutorial de bienvenida (primer arranque) ──────────────────────────────────
function showWelcomeSequence() {
  const steps = [
    '¡Hola! Soy tu nueva mascota de escritorio. 👋',
    soundOn ? '🔊 Sonidos activados — podés desactivarlos en Ajustes.' : null,
    'Hacé clic derecho para cambiar personaje o sumar más.',
    'Doble clic en ▲ (bandeja) abre los Ajustes.',
    '¡A disfrutar! 🎉',
  ].filter(Boolean);
  let i = 0;
  const DUR = 5700;
  (function next() {
    if (i >= steps.length) return;
    showBubble(steps[i++], DUR);
    setTimeout(next, DUR + 600);
  })();
}
