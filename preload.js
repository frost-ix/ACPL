const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config API
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),

  // File Save Export API
  saveExportFile: (payload) => ipcRenderer.invoke('save:exportFile', payload),

  // Dialog API
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),

  // Multi PTY API
  spawnPty: (options) => ipcRenderer.invoke('pty:spawn', options),
  killPty: (options) => ipcRenderer.invoke('pty:kill', options),
  writePty: (payload) => ipcRenderer.send('pty:write', payload),
  resizePty: (payload) => ipcRenderer.send('pty:resize', payload),

  onPtyData: (callback) => {
    const subscription = (event, payload) => callback(payload);
    ipcRenderer.on('pty:data', subscription);
    return () => ipcRenderer.removeListener('pty:data', subscription);
  },

  onPtyExit: (callback) => {
    const subscription = (event, payload) => callback(payload);
    ipcRenderer.on('pty:exit', subscription);
    return () => ipcRenderer.removeListener('pty:exit', subscription);
  },

  // Save on Quit IPC
  onSaveBeforeQuit: (callback) => {
    const subscription = (event) => callback();
    ipcRenderer.on('save-before-quit', subscription);
    return () => ipcRenderer.removeListener('save-before-quit', subscription);
  },
  confirmQuit: () => ipcRenderer.send('confirm-quit'),
});
