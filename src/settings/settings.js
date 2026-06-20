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
    chip.innerHTML = `<span>${character}</span><button title="Quitar" data-id="${wcId}">×</button>`;
    chip.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      window.settings.removePet(wcId);
    });
    container.appendChild(chip);
  }
}

// ── Renderizar grilla de personajes ───────────────────────────────────────────
let allAgents = [];

function renderCharGrid(agentList) {
  allAgents = agentList;
  filterCharGrid('');
}

function filterCharGrid(query) {
  const grid      = document.getElementById('char-grid');
  const noResults = document.getElementById('no-results');
  const q         = query.trim().toLowerCase();
  const filtered  = q ? allAgents.filter((n) => n.toLowerCase().includes(q)) : allAgents;

  grid.innerHTML = '';
  noResults.style.display = filtered.length === 0 ? '' : 'none';

  const countEl = document.getElementById('char-count');
  if (countEl) countEl.textContent = q
    ? `(${filtered.length} de ${allAgents.length})`
    : `(${allAgents.length} personajes)`;

  for (const name of filtered) {
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
    card.addEventListener('click', () => window.settings.addPet(name));
    grid.appendChild(card);
  }
}

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

  document.getElementById('char-search').addEventListener('input', (e) => {
    filterCharGrid(e.target.value);
  });

  document.getElementById('btn-close').addEventListener('click', () => {
    window.settings.close();
  });
}

// ── Historial de versiones ────────────────────────────────────────────────────
const CHANGELOG = [
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
  renderCharGrid(agents);
  wireListeners();
  wireAutoApply();
  wireUpdateButton(data.platform === 'win32');
  wireChangelogModal();

  window.settings.onPetsChanged((pets) => renderActivePets(pets));
})();
