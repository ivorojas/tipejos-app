const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');

// Auto-update: solo se activa en la app empaquetada (no en `npm start`).
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* dev */ }

const ASSETS_DIR  = path.join(__dirname, '..', 'assets');
const AGENTS_DIR  = path.join(ASSETS_DIR, 'agents');
const ICON_PATH   = path.join(ASSETS_DIR, 'icon.png');
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const BUBBLE_PAD  = 80; // mismo valor que en renderer.js
const WIN_W       = 220;
const WIN_H       = 220 + BUBBLE_PAD;

const DEFAULT_CONFIG = {
  soundOn:           true,
  volume:            0.5,
  scale:             1.0,
  opacity:           1.0,
  behaviorMode:      'normal',
  animFrequency:     1.0,
  wander:            false,
  timeReactions:     true,
  mouseReactions:    true,
  recentCharacters:  [],   // últimos personajes usados (máx 5)
  speechBubbles:  true,
  cargadaMode:    true,    // Modo Cargada: el muñeco te bardea (~90% de las frases)
  startWithWindows: false,
  hasSeenWelcome:  false,  // mostró el tutorial de bienvenida
  hasSeenSoundTip: false,  // mostró el aviso de sonidos activados
  pets:           [],
};

// Una entrada por mascota activa: webContents.id → { win, character }
const pets = new Map();
let tray       = null;
let settingsWin = null;
let cfg        = { ...DEFAULT_CONFIG };
let quitting   = false; // true desde before-quit: evita que win.closed pise la config guardada

// ─── Config ───────────────────────────────────────────────────────────────────

function readConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}

function saveConfig() {
  const petList = [...pets.values()].map(({ win, character, agentW, agentH }) => {
    const [x, y] = win.getPosition();
    // Revertir el desplazamiento de agent-size para que al abrir de nuevo
    // createPet + agent-size reproduzcan exactamente esta posición.
    const saveX = agentW != null ? x - (WIN_W - agentW) : x;
    const saveY = agentH != null ? y - (WIN_H - agentH) : y;
    return { character, x: saveX, y: saveY };
  });
  cfg.pets = petList;
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); }
  catch (e) { console.error('No se pudo guardar la config:', e); }
}

// Personajes famosos al principio; el resto al final en orden alfabético.
const FAMOUS_ORDER = [
  // Clásicos originales de Office (los más conocidos)
  'Clippy', 'Merlin', 'Rover', 'Bonzi', 'Peedy', 'Genie', 'F1', 'Rocky',
  'Links', 'Genius',
  // Retirados de Office 97 / exclusivos Mac
  'Scribble', 'Dot', 'MotherNature', 'PowerPup', 'Earl', 'OfficeLogo',
  // Personajes Microsoft Agent adicionales
  'Robby', 'Dolphin', 'MonkeyKing', 'Saeko',
  // Otros conocidos
  'BillG', 'Electra', 'Victor', 'Qmark', 'Santa',
  'Becky', 'Wartnose', 'Wabbit', 'E-man', 'E-woman',
];

function listAgents() {
  try {
    const all = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
    const famousSet = new Set(FAMOUS_ORDER);
    const famous  = FAMOUS_ORDER.filter((n) => all.includes(n));
    const rest    = all.filter((n) => !famousSet.has(n)).sort();
    return [...famous, ...rest];
  } catch { return []; }
}

// ─── Crear ventana de mascota ─────────────────────────────────────────────────

function clampToBounds(x, y, w, h) {
  // Encuentra el display con mayor área de solapamiento con la ventana.
  // Clampea la posición para que la ventana quede COMPLETAMENTE dentro del workArea.
  const displays = screen.getAllDisplays();
  let best = displays[0];
  let bestOverlap = -1;
  for (const d of displays) {
    const { bounds } = d;
    const ox = Math.max(0, Math.min(x + w, bounds.x + bounds.width)  - Math.max(x, bounds.x));
    const oy = Math.max(0, Math.min(y + h, bounds.y + bounds.height) - Math.max(y, bounds.y));
    const overlap = ox * oy;
    if (overlap > bestOverlap) { bestOverlap = overlap; best = d; }
  }
  const wa = best.workArea;
  return {
    x: Math.max(wa.x, Math.min(x, wa.x + wa.width  - w)),
    y: Math.max(wa.y, Math.min(y, wa.y + wa.height - h)),
  };
}

function createPet(character, x, y) {
  const { workArea } = screen.getPrimaryDisplay();
  const offset   = pets.size;
  const defaultX = workArea.x + workArea.width  - WIN_W - offset * 40;
  const defaultY = workArea.y + workArea.height - WIN_H - offset * 30;

  const rawX = x != null ? x : defaultX;
  const rawY = y != null ? y : defaultY;
  const { x: finalX, y: finalY } = clampToBounds(rawX, rawY, WIN_W, WIN_H);

  const win = new BrowserWindow({
    width:  WIN_W,
    height: WIN_H,
    x: Math.round(finalX),
    y: Math.round(finalY),
    frame:           false,
    transparent:     true,
    backgroundColor: '#00000000',
    resizable:       false,
    movable:         true,
    skipTaskbar:     true,
    alwaysOnTop:     true,
    hasShadow:       false,
    fullscreenable:  false,
    maximizable:     false,
    minimizable:     false,
    focusable:       true,
    webPreferences: {
      preload:              path.join(__dirname, 'preload.js'),
      contextIsolation:     true,
      nodeIntegration:      false,
      backgroundThrottling: false,
      webSecurity:          false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  if (cfg.opacity !== 1.0) win.setOpacity(cfg.opacity);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const wcId = win.webContents.id;
  pets.set(wcId, { win, character, agentW: null, agentH: null });

  win.webContents.on('console-message', (_e, _lv, msg) => console.log('[renderer]', msg));
  win.webContents.on('render-process-gone', (_e, d) => console.error('[renderer] caído:', d.reason));
  win.on('closed', () => {
    pets.delete(wcId);
    if (!quitting) {
      // Solo si el usuario cerró esta mascota manualmente (no es un cierre de app)
      saveConfig();
      refreshTrayMenu();
      notifySettingsPetsChanged();
    }
  });
  return win;
}

function addPet(character) {
  createPet(character);
  saveConfig();
  refreshTrayMenu();
  notifySettingsPetsChanged();
}

function removePet(wcId) {
  const pet = pets.get(wcId);
  if (pet) pet.win.destroy();
}

function updateRecentCharacters(name) {
  const recent = (cfg.recentCharacters || []).filter((n) => n !== name);
  cfg.recentCharacters = [name, ...recent].slice(0, 5);
}

function setCharacterForPet(wcId, name) {
  const pet = pets.get(wcId);
  if (!pet) return;
  pet.character = name;
  pet.win.webContents.send('set-character', name);
  updateRecentCharacters(name);
  saveConfig();
  refreshTrayMenu();
  notifySettingsPetsChanged();
}

function applyToPets(partial) {
  for (const { win } of pets.values()) {
    if (partial.scale        !== undefined) win.webContents.send('set-scale',         partial.scale);
    if (partial.opacity      !== undefined) win.setOpacity(partial.opacity);
    if (partial.soundOn      !== undefined) win.webContents.send('set-sound',         partial.soundOn);
    if (partial.volume       !== undefined) win.webContents.send('set-volume',        partial.volume);
    if (partial.behaviorMode !== undefined) win.webContents.send('set-behavior',      partial.behaviorMode);
    if (partial.animFrequency!== undefined) win.webContents.send('set-anim-frequency',partial.animFrequency);
    if (partial.wander       !== undefined) win.webContents.send('set-wander',        partial.wander);
    if (partial.timeReactions!== undefined) win.webContents.send('set-time-reactions',partial.timeReactions);
    if (partial.mouseReactions!==undefined) win.webContents.send('set-mouse-reactions',partial.mouseReactions);
    if (partial.speechBubbles!== undefined) win.webContents.send('set-speech-bubbles',partial.speechBubbles);
    if (partial.cargadaMode  !== undefined) win.webContents.send('set-cargada-mode',  partial.cargadaMode);
  }
  if (partial.startWithWindows !== undefined) {
    app.setLoginItemSettings({ openAtLogin: partial.startWithWindows });
  }
}

function snapAllToCorner() {
  const { workArea } = screen.getPrimaryDisplay();
  let i = 0;
  for (const { win } of pets.values()) {
    const [w, h] = win.getSize();
    win.setPosition(
      workArea.x + workArea.width  - w - 20 - i * 20,
      workArea.y + workArea.height - h - 20 - i * 20
    );
    i++;
  }
}

// ─── Ventana de ajustes ────────────────────────────────────────────────────────

function openSettings() {
  // Si ya está abierta: restaurar (si está minimizada), mostrar, traer al frente y enfocar
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.moveTop();
    settingsWin.focus();
    return;
  }

  // Posicionar en el monitor donde está el cursor (no siempre el primario)
  const cursor   = screen.getCursorScreenPoint();
  const display  = screen.getDisplayNearestPoint(cursor);
  const { workArea } = display;
  const W = 640, H = 780;
  const x = Math.round(workArea.x + (workArea.width  - W) / 2);
  const y = Math.round(workArea.y + (workArea.height - H) / 2);

  settingsWin = new BrowserWindow({
    width:     W,
    height:    H,
    x, y,
    minWidth:  500,
    minHeight: 600,
    title:     'Tipejos — Ajustes',
    icon:      ICON_PATH,
    show:      false,
    skipTaskbar: false,
    webPreferences: {
      preload:          path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      false,
    },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'settings', 'index.html'));
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    settingsWin.moveTop();
    settingsWin.focus();
  });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function notifySettingsPetsChanged() {
  if (!settingsWin || settingsWin.isDestroyed()) return;
  const activePets = [...pets.entries()].map(([wcId, { character }]) => ({ wcId, character }));
  settingsWin.webContents.send('settings:pets-updated', activePets);
}

// ─── Bandeja ────────────────────────────────────────────────────────────────────

function buildTray() {
  let icon = nativeImage.createFromPath(ICON_PATH);
  if (icon.isEmpty()) {
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVR4nGNgGAWjYBSMghHJ/v//PwOygAEDA8N/dMUMDAwM/9EVMzAwMPxHV8zAwMDwH10xAwMDAwMAVQAOZ1m4qQAAAAASUVORK5CYII='
    );
  }
  tray = new Tray(icon);
  tray.setToolTip('Tipejos — mascotas de escritorio');
  refreshTrayMenu();
  // En Windows el doble clic a veces se pierde con un context menu puesto;
  // atamos ambos para que abrir ajustes sea confiable.
  tray.on('double-click', openSettings);
  tray.on('click',        openSettings);
}

function refreshTrayMenu() {
  if (!tray) return;
  const agents = listAgents();

  const addSubmenu = agents.length > 0
    ? agents.map((name) => ({ label: name, click: () => addPet(name) }))
    : [{ label: '(sin personajes — corre "npm run setup")', enabled: false }];

  const activePetItems = [...pets.entries()].map(([wcId, { character }]) => ({
    label: character,
    submenu: [
      { label: 'Cambiar a...', submenu: agents.map((name) => ({
          label: name, type: 'radio', checked: name === character,
          click: () => setCharacterForPet(wcId, name),
      })) },
      { type: 'separator' },
      { label: 'Quitar', click: () => removePet(wcId) },
    ],
  }));

  const allVisible = pets.size > 0 && [...pets.values()].every((p) => p.win.isVisible());

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Agregar mascota', submenu: addSubmenu },
    ...(activePetItems.length > 0 ? [{ type: 'separator' }, ...activePetItems] : []),
    { type: 'separator' },
    { label: 'Ajustes...', click: openSettings },
    { type: 'separator' },
    { label: 'Sonidos', type: 'checkbox', checked: cfg.soundOn,
      click: (item) => { cfg.soundOn = item.checked; applyToPets({ soundOn: item.checked }); saveConfig(); } },
    { label: allVisible ? 'Ocultar todo' : 'Mostrar todo',
      click: () => { for (const { win } of pets.values()) allVisible ? win.hide() : win.show(); refreshTrayMenu(); } },
    { label: 'Reposicionar todo', click: snapAllToCorner },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ]));
}

// ─── IPC de mascotas ──────────────────────────────────────────────────────────

ipcMain.handle('get-initial', (event) => {
  const pet = pets.get(event.sender.id);
  const [winX, winY] = pet ? pet.win.getPosition() : [0, 0];
  // Usar el workArea del display donde está la ventana, no siempre el primario
  const display = pet
    ? screen.getDisplayNearestPoint({ x: winX, y: winY })
    : screen.getPrimaryDisplay();
  const { workArea } = display;
  // Tutorial de bienvenida: solo la primera mascota del primer arranque lo recibe.
  const firstRun    = !cfg.hasSeenWelcome;
  const showSoundTip = cfg.soundOn && !cfg.hasSeenSoundTip;
  if (firstRun || showSoundTip) {
    if (firstRun)    cfg.hasSeenWelcome  = true;
    if (showSoundTip) cfg.hasSeenSoundTip = true;
    saveConfig();
  }
  return {
    agent:          pet ? pet.character : null,
    soundOn:        cfg.soundOn,
    volume:         cfg.volume,
    scale:          cfg.scale,
    opacity:        cfg.opacity,
    behaviorMode:   cfg.behaviorMode,
    animFrequency:  cfg.animFrequency,
    wander:         cfg.wander,
    timeReactions:  cfg.timeReactions,
    mouseReactions: cfg.mouseReactions,
    speechBubbles:  cfg.speechBubbles,
    cargadaMode:    cfg.cargadaMode,
    firstRun,
    showSoundTip,
    screenBounds:   { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height },
    petX:           winX,
    petY:           winY,
  };
});

ipcMain.handle('get-position', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? win.getPosition() : [0, 0];
});

ipcMain.on('set-ignore-mouse', (event, ignore) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
  else         win.setIgnoreMouseEvents(false);
});

ipcMain.on('set-position', (event, x, y) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const [w, h] = win.getSize();
  const { x: cx, y: cy } = clampToBounds(x, y, w, h);
  win.setPosition(Math.round(cx), Math.round(cy));
});

ipcMain.on('agent-size', (event, w, h) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const pet = pets.get(event.sender.id);
  const [curW, curH] = win.getSize();
  const [x, y]       = win.getPosition();
  const newX = x + (curW - w);
  const newY = y + (curH - h);
  const { x: cx, y: cy } = clampToBounds(newX, newY, w, h);
  win.setBounds({ x: cx, y: cy, width: w, height: h });
  if (pet) { pet.agentW = w; pet.agentH = h; }
});

ipcMain.on('character-ready', (event, name) => {
  const pet = pets.get(event.sender.id);
  if (pet) pet.character = name;
  updateRecentCharacters(name);
  saveConfig();
  refreshTrayMenu();
  notifySettingsPetsChanged();
});

ipcMain.on('pet:open-settings', () => openSettings());

ipcMain.on('pet:context-menu', (event) => {
  const win    = BrowserWindow.fromWebContents(event.sender);
  const wcId   = event.sender.id;
  const pet    = pets.get(wcId);
  const agents = listAgents();

  // Recientes: últimos 4 usados distintos al personaje actual
  const recent = (cfg.recentCharacters || [])
    .filter((n) => agents.includes(n) && n !== pet?.character)
    .slice(0, 4);

  const recentItems = recent.length > 0
    ? [
        { label: 'Recientes:', enabled: false },
        ...recent.map((name) => ({ label: name, click: () => setCharacterForPet(wcId, name) })),
        { type: 'separator' },
      ]
    : [];

  Menu.buildFromTemplate([
    { label: '🎭 Hacer un truco',     click: () => win.webContents.send('do-trick')          },
    { label: '💬 Mostrar globo',      click: () => win.webContents.send('show-bubble-random') },
    { type: 'separator' },
    ...recentItems,
    { label: 'Todos los personajes...', click: openSettings },
    { type: 'separator' },
    { label: 'Quitar esta mascota', click: () => removePet(wcId) },
    { label: 'Ajustes...',          click: openSettings          },
    { type: 'separator' },
    { label: 'Salir de Tipejos',    click: () => app.quit()      },
  ]).popup({ window: win });
});

// ─── IPC de ajustes ───────────────────────────────────────────────────────────

ipcMain.handle('settings:get', () => {
  const agents     = listAgents();
  const activePets = [...pets.entries()].map(([wcId, { character }]) => ({ wcId, character }));
  return { config: { ...cfg }, agents, activePets, version: app.getVersion(), platform: process.platform };
});

ipcMain.on('settings:check-updates', () => {
  const send = (payload) => {
    if (settingsWin && !settingsWin.isDestroyed())
      settingsWin.webContents.send('settings:update-status', payload);
  };
  if (!autoUpdater || !app.isPackaged || process.platform !== 'win32') {
    return send({ status: 'unavailable' });
  }
  autoUpdater.checkForUpdates().catch((err) => send({ status: 'error', message: err?.message }));
});

ipcMain.on('settings:apply', (_e, partial) => {
  Object.assign(cfg, partial);
  applyToPets(partial);
  saveConfig();
  refreshTrayMenu();
});

ipcMain.on('settings:add-pet',    (_e, character) => addPet(character));
ipcMain.on('settings:remove-pet', (_e, wcId)      => removePet(wcId));
ipcMain.on('settings:close',      ()               => { if (settingsWin) settingsWin.close(); });

// ─── Instancia única ──────────────────────────────────────────────────────────
// Si ya hay una instancia corriendo, la nueva se mata sola y la existente
// sube al frente (abre ajustes) en lugar de abrir un proceso duplicado.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettings());
}

// ─── Ciclo de vida ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  cfg = readConfig();
  const agents = listAgents();

  // Migrar config antigua (single-pet)
  let petConfigs;
  if (Array.isArray(cfg.pets) && cfg.pets.length > 0) {
    petConfigs = cfg.pets.filter((p) => agents.includes(p.character));
  } else if (cfg.agent && agents.includes(cfg.agent)) {
    petConfigs = [{ character: cfg.agent, x: null, y: null }];
  } else {
    petConfigs = agents.length > 0 ? [{ character: agents[0] }] : [];
  }

  for (const { character, x, y } of petConfigs) {
    createPet(character, x ?? null, y ?? null);
  }

  buildTray();

  // Atajos de teclado globales
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    const allVisible = pets.size > 0 && [...pets.values()].every((p) => p.win.isVisible());
    for (const { win } of pets.values()) allVisible ? win.hide() : win.show();
    refreshTrayMenu();
  });
  globalShortcut.register('CommandOrControl+Shift+N', () => {
    if (agents.length > 0) addPet(agents[Math.floor(Math.random() * agents.length)]);
  });
  globalShortcut.register('CommandOrControl+Shift+S', openSettings);

  // Aplicar startup with Windows desde la config guardada
  app.setLoginItemSettings({ openAtLogin: !!cfg.startWithWindows });

  // Auto-guardar posiciones cada 30 segundos
  setInterval(saveConfig, 30000);

  app.on('activate', () => {
    if (pets.size === 0 && agents.length > 0) addPet(agents[0]);
  });

  // Buscar actualizaciones (solo en la app instalada)
  setupAutoUpdate();

  // Captura de verificación (solo si TIPEJOS_SHOT está seteado)
  maybeCaptureScreenshots();
});

// ─── Captura de pantalla para verificación (solo con env TIPEJOS_SHOT) ─────────
function maybeCaptureScreenshots() {
  const dir = process.env.TIPEJOS_SHOT;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  setTimeout(async () => {
    try {
      let i = 0;
      for (const { win, character } of pets.values()) {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, `pet-${i}-${character}.png`), img.toPNG());
        i++;
      }
      openSettings();
      setTimeout(async () => {
        try {
          if (settingsWin && !settingsWin.isDestroyed()) {
            const img = await settingsWin.webContents.capturePage();
            fs.writeFileSync(path.join(dir, 'settings.png'), img.toPNG());
          }
        } catch (e) { console.error('shot settings:', e); }
        app.exit(0);
      }, 2500);
    } catch (e) { console.error('shot:', e); app.exit(1); }
  }, 3500);
}

// ─── Auto-actualización ─────────────────────────────────────────────────────────

function setupAutoUpdate() {
  if (!autoUpdater || !app.isPackaged) return;
  // El auto-update solo funciona en Windows: en Mac requiere firma de código
  // (Apple Developer, de pago) y sin ella electron-updater no puede aplicar nada.
  if (process.platform !== 'win32') return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    const r = dialog.showMessageBoxSync({
      type:    'info',
      title:   'Tipejos — Actualización disponible',
      message: `Hay una versión nueva (${info.version}). ¿Reiniciar ahora para actualizar?`,
      buttons: ['Reiniciar ahora', 'Después'],
      defaultId: 0,
      cancelId:  1,
    });
    if (r === 0) autoUpdater.quitAndInstall();
  });

  const notifySettings = (payload) => {
    if (settingsWin && !settingsWin.isDestroyed())
      settingsWin.webContents.send('settings:update-status', payload);
  };

  autoUpdater.on('update-available',     (info) => notifySettings({ status: 'available',  version: info.version }));
  autoUpdater.on('update-not-available', ()     => notifySettings({ status: 'up-to-date' }));
  autoUpdater.on('error', (err) => {
    console.error('[auto-update]', err?.message || err);
    notifySettings({ status: 'error', message: err?.message });
  });

  // Chequear al arrancar y cada 2 horas
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 2 * 60 * 60 * 1000);
}

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit',  () => { quitting = true; saveConfig(); });
app.on('will-quit',    () => globalShortcut.unregisterAll());
