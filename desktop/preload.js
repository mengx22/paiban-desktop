'use strict';
const { contextBridge, ipcRenderer } = require('electron');
function sync(action, ...args) {
  const result = ipcRenderer.sendSync('paiban:storage', action, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
contextBridge.exposeInMainWorld('paibanDesktop', {
  getItem: key => sync('get', key),
  setItem: (key, value) => sync('set', key, value),
  info: () => sync('info'),
  restore: data => sync('restore', data),
  exportBackup: () => ipcRenderer.invoke('paiban:export-backup'),
  exportCsv: (filename, text) => ipcRenderer.invoke('paiban:export-csv', filename, text),
  exportWord: (filename, bytes) => ipcRenderer.invoke('paiban:export-word', filename, bytes),
  openExport: draft => ipcRenderer.invoke('paiban:export-open', draft),
  openDataFolder: () => ipcRenderer.invoke('paiban:open-data'),
  print: () => ipcRenderer.invoke('paiban:print'),
  editPositionRules: draft => ipcRenderer.invoke('paiban:position-rules-open', draft),
  positionRulesDraft: () => ipcRenderer.sendSync('paiban:position-rules-draft'),
  finishPositionRules: result => ipcRenderer.send('paiban:position-rules-finish', result)
});
