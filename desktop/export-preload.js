'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('paibanExportDesktop', {
  draft: () => ipcRenderer.sendSync('paiban:export-draft'),
  exportWord: (filename, bytes) => ipcRenderer.invoke('paiban:export-word', filename, bytes),
  exportCsv: (filename, text) => ipcRenderer.invoke('paiban:export-csv', filename, text),
  close: () => ipcRenderer.send('paiban:export-close')
});
