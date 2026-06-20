'use strict';

// ── Estado local ──────────────────────────────────────────────────────────────
let config     = {};
let agents     = [];
let activePets = [];

// ── Helpers de UI ─────────────────────────────────────────────────────────────
function pct(v)  { return Math.round(v * 100) + '%'; }
function xVal(v) { return parseFloat(v).toFixed(1) + '×'; }
function freqLabel(v) {
  const n = parseFloat(v);
  if (n <= 0.5) return 'Lenta';
  if (n <= 0.75) return 'Lenta+';
  if (n <= 1.25) return 'Normal';
  if (n <= 2.0)  return 'Rápida';
  return 'Muy rápida';
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

  document.getElementById('btn-apply').addEventListener('click', () => {
    window.settings.apply(readForm());
  });

  document.getElementById('btn-close').addEventListener('click', () => {
    window.settings.close();
  });
}

// ── Arranque ──────────────────────────────────────────────────────────────────
(async () => {
  const data = await window.settings.getAll();
  config     = data.config;
  agents     = data.agents;
  activePets = data.activePets;

  const verEl = document.getElementById('app-version');
  if (verEl && data.version) verEl.textContent = 'v' + data.version;

  populateForm(config);
  renderActivePets(activePets);
  renderCharGrid(agents);
  wireListeners();

  // Actualizaciones en tiempo real cuando cambian las mascotas activas
  window.settings.onPetsChanged((pets) => renderActivePets(pets));
})();
