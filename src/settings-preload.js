const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settings', {
  getAll:           ()         => ipcRenderer.invoke('settings:get'),
  apply:            (config)   => ipcRenderer.send('settings:apply',      config),
  addPet:           (character)=> ipcRenderer.send('settings:add-pet',    character),
  removePet:        (wcId)     => ipcRenderer.send('settings:remove-pet', wcId),
  close:            ()         => ipcRenderer.send('settings:close'),
  onPetsChanged:    (cb)       => ipcRenderer.on('settings:pets-updated', (_e, pets) => cb(pets)),
});
