'use strict';

// ── Estado local ──────────────────────────────────────────────────────────────
let config     = {};
let agents     = [];
let activePets = [];

// ── Helpers de UI ─────────────────────────────────────────────────────────────
function pct(v)  { return Math.round(v * 100) + '%'; }
function xVal(v) { return parseFloat(v).toFixed(1) + '×'; }
function freqLabel(v) {
  const n   = parseFloat(v);
  // Pausa promedio estimada en modo Normal: ~1.9s / frecuencia
  const s   = n >= 2 ? '<1s' : `~${(1.9 / n).toFixed(1)}s`;
  if (n <= 0.5)  return `Lenta (${s})`;
  if (n <= 1.25) return `Normal (${s})`;
  if (n <= 2.0)  return `Rápida (${s})`;
  return `Muy rápida (${s})`;
}

// ── Renderizar mascotas activas ────────────────────────────────────────────────
function renderActivePets(pets) {
  activePets = pets;
  const container = document.getElementById('active-pets');
  const noPets    = document.getElementById('no-pets');
  container.innerHTML = '';
  if (pets.length === 0) {
    container.appendChild(noPets);
    noPets.style.display = '';
    return;
  }
  for (const { wcId, character } of pets) {
    const chip = document.createElement('div');
    chip.className = 'active-chip';

    const thumb = document.createElement('div');
    thumb.className = 'chip-thumb';
    thumb.style.backgroundImage = `url("../../assets/agents/${character}/thumb.png")`;

    const label = document.createElement('span');
    label.textContent = character;

    const btn = document.createElement('button');
    btn.title = 'Quitar';
    btn.textContent = '×';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.settings.removePet(wcId);
    });

    chip.appendChild(thumb);
    chip.appendChild(label);
    chip.appendChild(btn);
    container.appendChild(chip);
  }
}

// ── Renderizar grilla de personajes ───────────────────────────────────────────
let allAgents  = [];
let agentSizes = {};   // { name: [w, h] } recibido de main.js
let activeSizeFilter = 'all';

const FAMOUS = ['Clippy','Bonzi','Merlin','Peedy','Rocky','Rover','Dot','F1',
  'Links','Genie','Genius','MotherNature','PowerPup','Scribble','Earl',
  'Robby','OfficeLogo','Wabbit','Reaper','Santa'];
const FAMOUS_SET  = new Set(FAMOUS);
const FAMOUS_RANK = Object.fromEntries(FAMOUS.map((n, i) => [n, i]));

let showAllChars = false;
let userFavorites = new Set(); // nombres de personajes marcados como favoritos

function sortAgents(list) {
  return [...list].sort((a, b) => {
    const fa = userFavorites.has(a) ? 0 : 1;
    const fb = userFavorites.has(b) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const ra = FAMOUS_RANK[a] ?? 999;
    const rb = FAMOUS_RANK[b] ?? 999;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

function sizeCategory(name) {
  const sz = agentSizes[name];
  if (!sz) return 'unknown';
  const h = sz[1];
  if (h <= 100)  return 'small';
  if (h <= 179)  return 'medium';
  return 'large';
}

function renderCharGrid(agentList, sizes) {
  allAgents  = agentList;
  if (sizes) agentSizes = sizes;
  applyGridFilters();
}

function applyGridFilters() {
  const q    = (document.getElementById('char-search')?.value || '').trim().toLowerCase();
  const size = activeSizeFilter;

  let filtered = allAgents.filter((n) => {
    if (q && !n.toLowerCase().includes(q)) return false;
    if (size === 'famous' && !FAMOUS_SET.has(n)) return false;
    if (size !== 'all' && size !== 'famous' && sizeCategory(n) !== size) return false;
    return true;
  });

  filtered = sortAgents(filtered);

  const hasFilter = q || size !== 'all';
  const visible   = (showAllChars || hasFilter) ? filtered : filtered.slice(0, 15);
  const hiddenCnt = filtered.length - visible.length;

  const grid      = document.getElementById('char-grid');
  const noResults = document.getElementById('no-results');
  grid.innerHTML = '';
  noResults.style.display = filtered.length === 0 ? '' : 'none';

  const countEl = document.getElementById('char-count');
  if (countEl) countEl.textContent = filtered.length === allAgents.length
    ? `(${allAgents.length} personajes)`
    : `(${filtered.length} de ${allAgents.length})`;

  for (const name of visible) {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.title     = 'Agregar ' + name;

    const thumbURL = `../../assets/agents/${name}/thumb.png`;
    const preview  = document.createElement('div');
    preview.className = 'char-preview';
    preview.style.backgroundImage    = `url("${thumbURL}")`;
    preview.style.backgroundSize     = 'contain';
    preview.style.backgroundRepeat   = 'no-repeat';
    preview.style.backgroundPosition = 'center';

    const label = document.createElement('div');
    label.className   = 'char-name';
    label.textContent = name;

    card.appendChild(preview);
    card.appendChild(label);

    const sz = agentSizes[name];
    if (sz) {
      const badge = document.createElement('div');
      badge.className   = 'char-size-badge';
      badge.textContent = `${sz[0]}×${sz[1]}`;
      card.appendChild(badge);
    }

    // Botón de favorito — el usuario lo marca manualmente.
    // ♡ vacío = no favorito · ❤ rojo lleno = favorito.
    const favBtn = document.createElement('button');
    const paintHeart = (on) => {
      favBtn.textContent = on ? '❤' : '♡';
      favBtn.classList.toggle('active', on);
      favBtn.title = on ? 'Quitar de favoritos' : 'Marcar como favorito';
    };
    favBtn.className = 'char-fav-btn';
    paintHeart(userFavorites.has(name));
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // no abrir el personaje
      const nowFav = !userFavorites.has(name);
      if (nowFav) userFavorites.add(name); else userFavorites.delete(name);
      paintHeart(nowFav);                       // feedback inmediato
      window.settings.apply({ favorites: [...userFavorites] });
      applyGridFilters();                       // re-ordena (favoritos arriba)
    });
    card.appendChild(favBtn);

    card.addEventListener('click', () => window.settings.addPet(name));
    grid.appendChild(card);
  }

  // Botón Ver todos / Ver menos
  const toggleBtn = document.getElementById('btn-show-all');
  if (toggleBtn) {
    if (hasFilter || filtered.length <= 15) {
      toggleBtn.style.display = 'none';
    } else {
      toggleBtn.style.display = 'block';   // '' dejaría el display:none del CSS → botón invisible
      toggleBtn.textContent = showAllChars
        ? '↑ Ver menos'
        : `↓ Ver todos (${hiddenCnt} más)`;
    }
  }
}

// Botones de filtro (tamaño + famosos)
document.querySelectorAll('.size-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.size-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeSizeFilter = btn.dataset.size;
    showAllChars = false;
    applyGridFilters();
  });
});

// Botón Ver todos / Ver menos
document.getElementById('btn-show-all')?.addEventListener('click', () => {
  showAllChars = !showAllChars;
  applyGridFilters();
});

// ── Leer valores del formulario ────────────────────────────────────────────────
function readForm() {
  const mode = document.querySelector('.mode-btn.active')?.dataset.mode || 'normal';
  return {
    scale:           parseFloat(document.getElementById('scale').value),
    opacity:         parseFloat(document.getElementById('opacity').value),
    soundOn:         document.getElementById('sound-on').checked,
    volume:          parseFloat(document.getElementById('volume').value),
    behaviorMode:    mode,
    animFrequency:   parseFloat(document.getElementById('anim-freq').value),
    wander:          document.getElementById('wander').checked,
    timeReactions:   document.getElementById('time-react').checked,
    mouseReactions:  document.getElementById('mouse-react').checked,
    speechBubbles:   document.getElementById('speech-bubbles').checked,
    cargadaMode:     document.getElementById('cargada-mode').checked,
    bubbleFontSize:  parseInt(document.getElementById('bubble-fs').value, 10),
    startWithWindows:document.getElementById('startup').checked,
    petShadow: document.getElementById('pet-shadow')?.checked || false,
  };
}

// ── Cargar valores en el formulario ───────────────────────────────────────────
function populateForm(c) {
  const sc   = document.getElementById('scale');
  const op   = document.getElementById('opacity');
  const vol  = document.getElementById('volume');
  const freq = document.getElementById('anim-freq');

  sc.value   = c.scale          ?? 1.0;
  op.value   = c.opacity        ?? 1.0;
  vol.value  = c.volume         ?? 0.5;
  freq.value = c.animFrequency  ?? 1.0;

  document.getElementById('scale-val').textContent   = xVal(sc.value);
  document.getElementById('opacity-val').textContent = pct(op.value);
  document.getElementById('volume-val').textContent  = pct(vol.value);
  document.getElementById('freq-val').textContent    = freqLabel(freq.value);

  document.getElementById('sound-on').checked       = !!c.soundOn;
  document.getElementById('wander').checked         = !!c.wander;
  document.getElementById('time-react').checked     = c.timeReactions  !== false;
  document.getElementById('mouse-react').checked    = c.mouseReactions !== false;
  document.getElementById('speech-bubbles').checked = c.speechBubbles  !== false;
  document.getElementById('cargada-mode').checked   = c.cargadaMode    !== false;

  const fsEl = document.getElementById('bubble-fs');
  fsEl.value = c.bubbleFontSize ?? 14;
  document.getElementById('bubble-fs-val').textContent = fsEl.value + 'px';
  document.getElementById('startup').checked        = !!c.startWithWindows;

  // Modo de comportamiento
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === (c.behaviorMode || 'normal'));
  });
  const shadowEl = document.getElementById('pet-shadow');
  if (shadowEl) shadowEl.checked = !!c.petShadow;
}

// ── Eventos de controles live ─────────────────────────────────────────────────
function wireSlider(id, valId, format) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    document.getElementById(valId).textContent = format(el.value);
  });
}

function wireListeners() {
  wireSlider('scale',     'scale-val',   xVal);
  wireSlider('opacity',   'opacity-val', pct);
  wireSlider('volume',    'volume-val',  pct);
  wireSlider('anim-freq', 'freq-val',    freqLabel);
  wireSlider('bubble-fs', 'bubble-fs-val', (v) => v + 'px');

  // Botones de modo
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('char-search').addEventListener('input', () => {
    applyGridFilters();
  });

  document.getElementById('btn-close').addEventListener('click', () => {
    window.settings.close();
  });
  document.getElementById('pet-shadow')?.addEventListener('change', () => {
    window.settings.apply({ petShadow: document.getElementById('pet-shadow').checked });
  });
}

// ── Historial de versiones ────────────────────────────────────────────────────
const CHANGELOG = [
  {
    version: '0.2.40',
    date: '24 jun 2026',
    changes: [
      'Ahora nos llamamos Office Buddies 🐾 (mismo programa, nombre nuevo)',
    ],
  },
  {
    version: '0.2.39',
    date: '20 jun 2026',
    changes: [
      'Filtrar mensajes: selector de personaje ahora muestra grilla visual con foto (famosos primero)',
      'Fix: personajes no desaparecen — ventana no se destruye accidentalmente al cerrarse',
      'Fix: z-order se re-afirma cada 4 s para que el muñeco nunca quede debajo de otra ventana',
    ],
  },
  {
    version: '0.2.38',
    date: '20 jun 2026',
    changes: [
      'Fix: ajustes maximizados ya no se estiran — contenido centrado con ancho máximo de 760px en cualquier resolución',
    ],
  },
  {
    version: '0.2.37',
    date: '20 jun 2026',
    changes: [
      'Rediseño completo de Ajustes: estética "soft modern" con acento violeta, switches, sliders refinados y mejor jerarquía',
      'Mascotas activas como chips, filtros tipo segmented control y tarjetas de personaje más prolijas',
      'Tinder de mensajes y todos los controles repensados para que se vea hermoso y ordenado',
    ],
  },
  {
    version: '0.2.36',
    date: '20 jun 2026',
    changes: [
      'Fix favoritos: el corazón ahora se VE (♡ gris en círculo) y al marcarlo cambia a ❤ rojo lleno',
      'Fix "Ver todos": el botón estaba siempre invisible (display:none del CSS) — ahora aparece de verdad',
      'Actualización: se baja siempre el instalador completo para que no quede el código a medias',
    ],
  },
  {
    version: '0.2.35',
    date: '20 jun 2026',
    changes: [
      'Menú contextual: "Eliminar" movido al final (más cercano al clic)',
      'Favoritos: botón ❤ en cada personaje para marcar los tuyos (sin auto-estrellas)',
      'Sombra del personaje: opción en Ajustes > Apariencia (desactivada por defecto)',
      'Tinder: animación al aceptar/rechazar, botón Anterior para deshacer, preview animado del personaje',
      'Tinder: botón para filtrar otro personaje al terminar una lista',
    ],
  },
  {
    version: '0.2.34',
    date: '20 jun 2026',
    changes: [
      'Famosos primero: la grilla muestra los personajes más conocidos al inicio (★), con botón "Ver todos"',
      'Filtro de mensajes: revisá y descartá frases por personaje estilo swipe — en Ajustes > Filtrar mensajes',
      'Las frases descartadas no se muestran más al personaje activo',
    ],
  },
  {
    version: '0.2.33',
    date: '20 jun 2026',
    changes: [
      'Fix definitivo drag en DPI 125%: reemplazado win.setPosition() por win.setBounds() con tamaño explícito — evita la expansión de ventana del DWM de Windows que desalineaba el globo y el sprite',
    ],
  },
  {
    version: '0.2.32',
    date: '20 jun 2026',
    changes: [
      'Debug: Ctrl+Shift+D abre DevTools de la mascota activa para diagnóstico en vivo',
      'Logs en consola: DPR, resolución, coordenadas de drag, y cuándo layoutWindow dispara reportSize',
    ],
  },
  {
    version: '0.2.31',
    date: '20 jun 2026',
    changes: [
      'Fix arrastre: main.js ahora bloquea win.setBounds durante el drag (drag:start/end IPC), eliminando la causa real del desalineamiento entre sprite y globo',
      'Burbuja forzada a capa GPU propia (translateZ) para evitar desfase visual de compositing',
    ],
  },
  {
    version: '0.2.30',
    date: '20 jun 2026',
    changes: [
      'Fix drag en DPI ≠ 100%: coordenadas derivadas solo de CSS (e.screenX - e.clientX) y movementX/Y para deltas puros sin mezcla de unidades',
    ],
  },
  {
    version: '0.2.29',
    date: '20 jun 2026',
    changes: [
      'Fix crítico: al arrastrar en notebooks con escala de pantalla distinta, el personaje y el globo se iban en sentidos opuestos',
      'Al agregar un personaje ya no se disparan 5 mensajes seguidos — hay un período de gracia de 8 segundos',
      'Menú clic derecho simplificado: "Eliminar" es la primera opción, menos opciones en total',
      'Mascotas activas ahora muestran la foto del personaje',
      'Grilla de personajes: filtros por tamaño (Chicos / Medianos / Grandes) y badge con dimensiones en cada card',
    ],
  },
  {
    version: '0.2.28',
    date: '20 jun 2026',
    changes: [
      'Arreglado el parpadeo de los personajes con múltiples capas (Bonzi, F1, Genie, Genius, Merlin, Peedy, Rocky)',
      'Las animaciones ahora se sincronizan con el refresco de pantalla (requestAnimationFrame) para mayor suavidad',
      'Precarga de sprites antes de cambiar la imagen de fondo → sin flash al cargar personajes',
      'El tamaño del sprite es correcto desde el primer frame aunque el personaje esté escalado',
    ],
  },
  {
    version: '0.2.27',
    date: '20 jun 2026',
    changes: [
      'Globos más cuadrados (se ajustan al texto en vez de ser una barra ancha)',
      'Borde del globo más fino y volvió la colita que apunta al personaje',
      'Arreglada la "pared invisible" al arrastrar: el muñeco ahora llega a los bordes de la pantalla',
    ],
  },
  {
    version: '0.2.26',
    date: '20 jun 2026',
    changes: [
      'Los muñecos ya no tapan la flechita de "mostrar iconos ocultos" abajo a la derecha (quedan por debajo de la barra de tareas)',
      'Se quitaron de la rotación los frames de publicidad de E-man, E-woman y Wartnose',
    ],
  },
  {
    version: '0.2.25',
    date: '20 jun 2026',
    changes: [
      'Globos de diálogo más grandes: ahora se ve TODO el texto, sin letras cortadas',
      'La caja crece a lo alto según la frase y tiene ancho mínimo para frases largas',
      'El muñeco queda centrado debajo del globo',
    ],
  },
  {
    version: '0.2.24',
    date: '20 jun 2026',
    changes: [
      'Fix importante: el upscaling con IA nunca corría en la app instalada (el sprite quedaba atrapado dentro del paquete y waifu2x no podía leerlo)',
      'Ahora sí: la primera vez que abrís un personaje se genera la versión IA y a partir de ahí se ve nítido y suave',
    ],
  },
  {
    version: '0.2.23',
    date: '20 jun 2026',
    changes: [
      'Fix: sprites Scale2x volvían a verse borrosos en v0.2.22 por un error de renderizado',
    ],
  },
  {
    version: '0.2.22',
    date: '20 jun 2026',
    changes: [
      'Sprites con IA (waifu2x) para todos los personajes: se generan en background la primera vez',
      'Primera apertura procesa el sprite en tu PC y lo guarda; las siguientes son instantáneas',
      'La mejora de resolución ahora aplica a los 50 personajes, no solo a 8',
    ],
  },
  {
    version: '0.2.21',
    date: '20 jun 2026',
    changes: [
      'Frases nuevas compartidas por todos: se burlan de usar IA (ChatGPT, Claude) para todo',
      'Aparecen ~15% del tiempo durante las frases idle, solo en Modo Cargada',
    ],
  },
  {
    version: '0.2.20',
    date: '20 jun 2026',
    changes: [
      'Sprites en alta resolución (2×) para 8 personajes conocidos: Clippy, Merlin, Genie, Rover, Links, Peedy, Bonzi y Dot',
      'Se ven más nítidos al agrandarlos y con bordes más suaves a tamaño normal',
      'Si funciona bien, se aplicará al resto de los personajes',
    ],
  },
  {
    version: '0.2.19',
    date: '20 jun 2026',
    changes: [
      'Ajustes con auto-apply: cualquier cambio se aplica al instante, sin botón',
      'Frecuencia de animación muestra tiempo estimado entre animaciones (~2s, etc.)',
      'Modos de comportamiento con descripción de qué hace cada uno',
    ],
  },
  {
    version: '0.2.18',
    date: '20 jun 2026',
    changes: [
      'Tamaño de texto de los globos configurable (11px – 20px)',
      'Default subido a 14px para mayor legibilidad',
    ],
  },
  {
    version: '0.2.17',
    date: '20 jun 2026',
    changes: [
      'Historial de versiones con novedades de cada actualización',
      'Botón "Novedades" en el header de Ajustes',
    ],
  },
  {
    version: '0.2.16',
    date: '20 jun 2026',
    changes: [
      'Doble clic con umbral propio de 300ms — independiente del OS',
      'Clicks seguidos pero no intencionales ya no disparan el doble clic',
    ],
  },
  {
    version: '0.2.15',
    date: '20 jun 2026',
    changes: [
      'Cola de globos: saludo, reacción horaria y frase del día ya no se pisan',
      'Arrastrar al muñeco ya no dispara un texto falso',
    ],
  },
  {
    version: '0.2.14',
    date: '19 jun 2026',
    changes: [
      'Instancia única: si la app ya está abierta, abrirla de nuevo no hace nada',
    ],
  },
  {
    version: '0.2.12',
    date: '19 jun 2026',
    changes: [
      'Botón "Buscar actualización" en el header de Ajustes',
      'El estado de la actualización se muestra en tiempo real',
    ],
  },
  {
    version: '0.2.11',
    date: '19 jun 2026',
    changes: [
      'Frases del día y la hora en Modo Cargada — humor ácido sin filtro',
      'Doble clic exclusivo para mostrar frases de click',
      'Click simple ya no muestra frases accidentalmente',
    ],
  },
  {
    version: '0.2.10',
    date: '19 jun 2026',
    changes: [
      'Fix crítico: los muñecos se restauran correctamente al reabrir la app',
      'Posición, cantidad y personaje guardados en cada cierre',
    ],
  },
  {
    version: '0.2.9',
    date: '19 jun 2026',
    changes: [
      'Frases por hora con redondeo (9:50 → "Las 10")',
      'Sonidos activados por defecto, tip al primer arranque',
      'Frases del día de la semana compartidas entre personajes',
      'Fix de posición: muñecos ya no aparecen fuera de la pantalla',
      'Botón "Aplicar" con feedback visual',
    ],
  },
  {
    version: '0.2.5',
    date: '19 jun 2026',
    changes: [
      'Ícono de la app: Santa en pose de descanso (bandeja + instalador)',
    ],
  },
  {
    version: '0.2.4',
    date: '19 jun 2026',
    changes: [
      'Modo Cargada: ~90% frases de bardeo + toggle en Ajustes',
    ],
  },
  {
    version: '0.2.3',
    date: '19 jun 2026',
    changes: [
      'Soporte Mac — descarga universal .dmg vía GitHub Actions',
      'Fix de parpadeo en animaciones al cambiar frame',
    ],
  },
  {
    version: '0.2.1',
    date: '19 jun 2026',
    changes: [
      'Fix crítico de color: rojos y azules invertidos en 41 personajes ACS',
      '50 personajes disponibles',
    ],
  },
  {
    version: '0.2.0',
    date: '19 jun 2026',
    changes: [
      'Tutorial de bienvenida en el primer arranque',
      '1555 frases rioplatenses por personaje y categoría',
      'Sonidos extraídos de los archivos .acs originales',
    ],
  },
  {
    version: '0.1.0',
    date: '19 jun 2026',
    changes: [
      'Primer lanzamiento público',
      'Auto-update, instalador NSIS, ícono en bandeja del sistema',
      'Soporte para múltiples monitores',
    ],
  },
];

let currentVersion = '';

function buildChangelogHTML() {
  const body = document.getElementById('cl-body');
  body.innerHTML = '';
  for (const entry of CHANGELOG) {
    const isCurrent = entry.version === currentVersion;
    const li = entry.changes.map((c) => `<li>${c}</li>`).join('');
    const div = document.createElement('div');
    div.className = 'cl-entry';
    div.innerHTML = `
      <div class="cl-meta">
        <span class="cl-badge${isCurrent ? ' current' : ''}">v${entry.version}${isCurrent ? ' · actual' : ''}</span>
        <span class="cl-date">${entry.date}</span>
      </div>
      <ul class="cl-changes">${li}</ul>`;
    body.appendChild(div);
  }
}

function wireChangelogModal() {
  const modal   = document.getElementById('cl-modal');
  const btnOpen = document.getElementById('btn-changelog');
  const btnClose= document.getElementById('btn-cl-close');

  btnOpen.addEventListener('click', () => {
    buildChangelogHTML();
    modal.classList.add('open');
  });
  btnClose.addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
}

// ── Auto-apply ────────────────────────────────────────────────────────────────
let _autoApplyTimer = null;
function autoApply() {
  clearTimeout(_autoApplyTimer);
  _autoApplyTimer = setTimeout(() => window.settings.apply(readForm()), 120);
}

function wireAutoApply() {
  ['scale','opacity','volume','anim-freq','bubble-fs'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', autoApply);
  });
  ['sound-on','wander','time-react','mouse-react','speech-bubbles','cargada-mode','startup'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', autoApply);
  });
  document.querySelectorAll('.mode-btn').forEach((btn) => btn.addEventListener('click', autoApply));
}

// ── Botón de actualización ────────────────────────────────────────────────────
function wireUpdateButton(isWindows) {
  const btn = document.getElementById('btn-update');
  if (!btn) return;

  if (!isWindows) { btn.style.display = 'none'; return; }

  let resetTimer = null;
  function setStatus(text, disabled, resetAfter) {
    btn.textContent = text;
    btn.disabled    = disabled;
    clearTimeout(resetTimer);
    if (resetAfter) resetTimer = setTimeout(() => setStatus('🔄 Buscar actualización', false, 0), resetAfter);
  }

  btn.addEventListener('click', () => {
    setStatus('⏳ Buscando...', true, 0);
    window.settings.checkUpdates();
  });

  window.settings.onUpdateStatus(({ status, version }) => {
    if      (status === 'up-to-date') setStatus('✅ Estás al día', false, 4000);
    else if (status === 'available')  setStatus(`⬇️ Descargando v${version}...`, true, 0);
    else if (status === 'error')      setStatus('❌ Error al buscar', false, 4000);
    else if (status === 'unavailable') btn.style.display = 'none';
  });
}

// ── Arranque ──────────────────────────────────────────────────────────────────
(async () => {
  const data = await window.settings.getAll();
  config     = data.config;
  agents     = data.agents;
  activePets = data.activePets;

  currentVersion = data.version || '';
  const verEl = document.getElementById('app-version');
  if (verEl && data.version) verEl.textContent = 'v' + data.version;

  populateForm(config);
  renderActivePets(activePets);
  userFavorites = new Set(data.config.favorites || []);
  renderCharGrid(agents, data.agentSizes);
  initPhraseFilter(data.config);
  wireListeners();
  wireAutoApply();
  wireUpdateButton(data.platform === 'win32');
  wireChangelogModal();

  window.settings.onPetsChanged((pets) => renderActivePets(pets));
})();

// ── Filtro de mensajes (Tinder) ────────────────────────────────────────────────
let pfPhraseLikes = {};  // { charName: { "phrase": false } } — solo se guardan los descartados
let pfPhrases     = [];  // frases del personaje activo
let pfIndex       = 0;
let pfCharName    = '';

function initPhraseFilter(cfg) {
  pfPhraseLikes = (cfg && cfg.phraseLikes) || {};

  const grid = document.getElementById('pf-char-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const chars = sortAgents(Object.keys(window.PHRASES_DATA || {}));
  for (const name of chars) {
    const disliked = Object.values(pfPhraseLikes[name] || {}).filter(v => v === false).length;

    const card = document.createElement('div');
    card.className = 'char-card';
    card.title = 'Filtrar frases de ' + name;

    const preview = document.createElement('div');
    preview.className = 'char-preview';
    preview.style.backgroundImage    = `url("../../assets/agents/${name}/thumb.png")`;
    preview.style.backgroundSize     = 'contain';
    preview.style.backgroundRepeat   = 'no-repeat';
    preview.style.backgroundPosition = 'center';

    const label = document.createElement('div');
    label.className   = 'char-name';
    label.textContent = name;

    card.appendChild(preview);
    card.appendChild(label);

    if (disliked > 0) {
      const badge = document.createElement('div');
      badge.className   = 'char-size-badge';
      badge.textContent = `${disliked} ✕`;
      badge.style.cssText = 'background:var(--red-soft);color:var(--red);border-color:var(--red-line)';
      card.appendChild(badge);
    }

    card.addEventListener('click', () => pfOpen(name));
    grid.appendChild(card);
  }
}

let pfAnimTimer    = null;
let pfSpriteFrames = [];
let pfSpriteIdx    = 0;

function pfStartCharAnimation(charName) {
  if (pfAnimTimer) { clearTimeout(pfAnimTimer); pfAnimTimer = null; }
  pfSpriteFrames = []; pfSpriteIdx = 0;

  const previewEl = document.getElementById('pf-char-preview');
  if (!previewEl) return;

  const base = `../../assets/agents/${charName}/`;
  previewEl.style.backgroundImage = `url("${base}thumb.png")`;
  previewEl.style.backgroundSize  = 'contain';
  previewEl.style.backgroundPosition = 'center';

  // Guardar clippy anterior para no romper el renderer si está cargado
  const prevClipy = window.clippy;
  window.clippy = {
    ready: (_n, data) => {
      window.clippy = prevClipy || window.clippy;
      const [fw, fh] = data.framesize || [124, 93];
      const anims = data.animations || {};
      const idleKey = ['RestPose','Idle1_1','Idle1_2','Idle2_1','Idle3_1','Greeting']
        .find(k => anims[k]) || Object.keys(anims)[0];
      const animDef = anims[idleKey];
      if (!animDef) return;
      pfSpriteFrames = animDef.frames
        .filter(f => f.images && f.images.length)
        .map(f => ({ pos: f.images[0], dur: Math.max(f.duration || 100, 80) }));
      if (!pfSpriteFrames.length) return;

      const img = new Image();
      img.onload = () => {
        previewEl.style.backgroundImage    = `url("${base}map.png")`;
        previewEl.style.backgroundSize     = `${img.naturalWidth}px auto`;
        previewEl.style.backgroundPosition = '0 0';
        previewEl.style.width  = fw + 'px';
        previewEl.style.height = fh + 'px';
        pfCycleSprite(previewEl);
      };
      img.onerror = () => {};
      img.src = base + 'map.png';
    },
    soundsReady: () => {},
  };

  const script = document.createElement('script');
  script.src = base + 'agent.js';
  script.onerror = () => { window.clippy = prevClipy || window.clippy; };
  document.head.appendChild(script);
}

function pfCycleSprite(el) {
  if (!pfSpriteFrames.length) return;
  const frame = pfSpriteFrames[pfSpriteIdx % pfSpriteFrames.length];
  el.style.backgroundPosition = `-${frame.pos[0]}px -${frame.pos[1]}px`;
  pfSpriteIdx++;
  pfAnimTimer = setTimeout(() => pfCycleSprite(el), frame.dur);
}

function pfOpen(charName) {
  pfCharName = charName;
  const charData = (window.PHRASES_DATA || {})[charName] || {};
  pfPhrases = [];
  for (const [, val] of Object.entries(charData)) {
    for (const type of ['roast', 'soft']) {
      for (const text of (val[type] || [])) {
        pfPhrases.push(text);
      }
    }
  }
  pfIndex = 0;

  document.getElementById('pf-char-label').textContent = charName;
  pfStartCharAnimation(charName);

  document.getElementById('pf-picker').style.display    = 'none';
  document.getElementById('pf-swiper').style.display    = '';
  document.getElementById('pf-done-msg').style.display  = 'none';
  document.getElementById('pf-actions').style.display   = '';
  pfHistory = [];
  pfShowPhrase();
}

function pfClose() {
  if (pfAnimTimer) { clearTimeout(pfAnimTimer); pfAnimTimer = null; }
  document.getElementById('pf-picker').style.display   = '';
  document.getElementById('pf-swiper').style.display   = 'none';
  document.getElementById('pf-done-msg').style.display = 'none';
  initPhraseFilter({ phraseLikes: pfPhraseLikes });
}

function pfShowPhrase() {
  if (pfIndex >= pfPhrases.length) { pfShowDone(); return; }
  const text     = pfPhrases[pfIndex];
  const decision = (pfPhraseLikes[pfCharName] || {})[text];
  document.getElementById('pf-phrase').textContent = text;
  document.getElementById('pf-btn-yes').classList.toggle('pf-active', decision === true);
  document.getElementById('pf-btn-no').classList.toggle('pf-active', decision === false);

  const total    = pfPhrases.length;
  const disliked = pfPhrases.filter(p => (pfPhraseLikes[pfCharName] || {})[p] === false).length;
  document.getElementById('pf-progress-text').textContent =
    `Frase ${pfIndex + 1} de ${total}` + (disliked > 0 ? ` · ${disliked} descartadas` : '');
  document.getElementById('pf-progress-fill').style.width =
    ((pfIndex + 1) / total * 100) + '%';
}

let pfHistory = []; // { text, was: false | undefined }

function pfDecide(liked) {
  if (pfIndex >= pfPhrases.length) return;
  const text = pfPhrases[pfIndex];

  // Guardar estado previo para el botón Anterior
  const wasDecision = (pfPhraseLikes[pfCharName] || {})[text];
  pfHistory.push({ index: pfIndex, text, was: wasDecision });

  if (!pfPhraseLikes[pfCharName]) pfPhraseLikes[pfCharName] = {};
  if (liked) {
    delete pfPhraseLikes[pfCharName][text];
    if (Object.keys(pfPhraseLikes[pfCharName]).length === 0)
      delete pfPhraseLikes[pfCharName];
  } else {
    pfPhraseLikes[pfCharName][text] = false;
  }
  window.settings.apply({ phraseLikes: pfPhraseLikes });

  // Animación de slide
  const card = document.getElementById('pf-card');
  card.classList.add(liked ? 'pf-anim-accept' : 'pf-anim-reject');
  setTimeout(() => {
    card.classList.remove('pf-anim-accept', 'pf-anim-reject');
    pfIndex++;
    pfShowPhrase();
  }, 220);
}

function pfPrev() {
  if (!pfHistory.length) return;
  const last = pfHistory.pop();
  pfIndex = last.index;

  // Restaurar estado previo
  if (!pfPhraseLikes[pfCharName]) pfPhraseLikes[pfCharName] = {};
  if (last.was === false) {
    pfPhraseLikes[pfCharName][last.text] = false;
  } else {
    delete pfPhraseLikes[pfCharName][last.text];
    if (Object.keys(pfPhraseLikes[pfCharName]).length === 0)
      delete pfPhraseLikes[pfCharName];
  }
  window.settings.apply({ phraseLikes: pfPhraseLikes });

  // Mostrar swiper si estaba en done
  document.getElementById('pf-done-msg').style.display = 'none';
  document.getElementById('pf-swiper').style.display   = '';
  document.getElementById('pf-actions').style.display  = '';
  pfShowPhrase();
}

function pfShowDone() {
  const total    = pfPhrases.length;
  const disliked = pfPhrases.filter(p => (pfPhraseLikes[pfCharName] || {})[p] === false).length;
  document.getElementById('pf-swiper').style.display   = 'none';
  document.getElementById('pf-done-msg').style.display = '';
  document.getElementById('pf-done-msg').innerHTML     =
    `✓ Revisaste ${total} frases de ${pfCharName}.` +
    (disliked > 0 ? ` ${disliked} descartadas.` : ' Ninguna descartada.') +
    `<br><button id="pf-btn-another" style="margin-top:8px;padding:5px 12px;background:#1a1a30;border:1px solid #3a3a70;border-radius:6px;color:#7070cc;font-size:11px;cursor:pointer">Filtrar otro personaje</button>`;
  initPhraseFilter({ phraseLikes: pfPhraseLikes });
  document.getElementById('pf-btn-another')?.addEventListener('click', () => {
    document.getElementById('pf-done-msg').style.display = 'none';
    document.getElementById('pf-picker').style.display   = '';
  });
}

document.getElementById('pf-back')?.addEventListener('click', pfClose);
document.getElementById('pf-btn-yes')?.addEventListener('click', () => pfDecide(true));
document.getElementById('pf-btn-no')?.addEventListener('click',  () => pfDecide(false));
document.getElementById('pf-btn-prev')?.addEventListener('click', pfPrev);
