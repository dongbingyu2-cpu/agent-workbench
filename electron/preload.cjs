const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workbenchDesktop', {
  openOptions: (kind, details) => ipcRenderer.invoke('agent-open-options', kind, details),
  openSession: (kind, id, project, mode, details) => ipcRenderer.invoke('open-agent-session', { kind, id, project, mode, details }),
  pickDirectory: (defaultPath) => ipcRenderer.invoke('pick-directory', defaultPath),
});
