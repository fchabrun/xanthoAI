import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  exportPdf: (defaultFilename: string) => ipcRenderer.invoke('dialog:exportPdf', defaultFilename),
  showError: (title: string, message: string) => ipcRenderer.invoke('dialog:showError', title, message)
});