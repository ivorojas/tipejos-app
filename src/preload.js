const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  getInitial:        ()        => ipcRenderer.invoke('get-initial'),
  getPosition:       ()        => ipcRenderer.invoke('get-position'),
  onSetCharacter:    (cb)      => ipcRenderer.on('set-character',      (_e, name) => cb(name)),
  reportSize:        (w, h)    => ipcRenderer.send('agent-size',       Math.round(w), Math.round(h)),
  characterReady:    (name)    => ipcRenderer.send('character-ready',  name),
  setIgnore:         (ignore)  => ipcRenderer.send('set-ignore-mouse', ignore),
  setPosition:       (x, y)   => ipcRenderer.send('set-position',     x, y),
  showContextMenu:   ()        => ipcRenderer.send('pet:context-menu'),
  openSettings:      ()        => ipcRenderer.send('pet:open-settings'),
  // Ajustes que vienen del proceso principal
  onSetSound:          (cb) => ipcRenderer.on('set-sound',          (_e, v) => cb(v)),
  onSetVolume:         (cb) => ipcRenderer.on('set-volume',         (_e, v) => cb(v)),
  onSetScale:          (cb) => ipcRenderer.on('set-scale',          (_e, v) => cb(v)),
  onSetBehavior:       (cb) => ipcRenderer.on('set-behavior',       (_e, v) => cb(v)),
  onSetAnimFrequency:  (cb) => ipcRenderer.on('set-anim-frequency', (_e, v) => cb(v)),
  onSetWander:         (cb) => ipcRenderer.on('set-wander',         (_e, v) => cb(v)),
  onSetTimeReactions:  (cb) => ipcRenderer.on('set-time-reactions', (_e, v) => cb(v)),
  onSetMouseReactions: (cb) => ipcRenderer.on('set-mouse-reactions',(_e, v) => cb(v)),
  onSetSpeechBubbles:  (cb) => ipcRenderer.on('set-speech-bubbles', (_e, v) => cb(v)),
  onDoTrick:           (cb) => ipcRenderer.on('do-trick',           ()       => cb()),
  onShowBubbleRandom:  (cb) => ipcRenderer.on('show-bubble-random', ()       => cb()),
});
