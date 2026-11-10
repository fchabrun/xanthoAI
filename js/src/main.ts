import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../index.html'));
  
  //mainWindow.webContents.openDevTools(); // to get devtools (js console, css update on-the-fly)
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handler pour ouvrir et lire le fichier de données
ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      // Le premier élément de la liste s'affiche par défaut
      { name: 'Fichiers supportés', extensions: ['tst'] },
      { name: 'Tous les fichiers', extensions: ['*'] }
    ]
  });
  
  if (canceled || filePaths.length === 0) {
    return null;
  } else {
    // Attention : la lecture en 'latin1' fonctionne pour le texte (.tst, .csv)
    // mais corrompra les fichiers binaires (.xlsx).
    const rawData = fs.readFileSync(filePaths[0], 'latin1');
    return { fileName: path.basename(filePaths[0]), data: rawData };
  }
});

ipcMain.handle('dialog:exportPdf', async (event, defaultFilename: string) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { success: false, error: "Fenêtre introuvable" };

  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Enregistrer le rapport PDF',
    defaultPath: defaultFilename || 'Rapport_LCR.pdf',
    filters: [
      { name: 'Fichiers PDF', extensions: ['pdf'] }
    ]
  });

  if (canceled || !filePath) {
    return { success: false, canceled: true };
  }

  try {
    // Utilisation du moteur Chromium natif pour générer le PDF
    const pdfData = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'printableArea' }
    });
    
    fs.writeFileSync(filePath, pdfData);
    return { success: true, filePath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('dialog:showError', async (event, title: string, message: string) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  
  await dialog.showMessageBox(win, {
    type: 'error',
    title: title,
    message: message,
    buttons: ['OK']
  });
});
