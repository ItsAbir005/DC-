// client/electron/main.js
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { ClientCore } from '../clientCore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow;
let clientCore;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    frame: true,
    titleBarStyle: 'default',
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorDescription);
    if (isDev) {
      setTimeout(() => mainWindow.loadURL('http://localhost:5173'), 1000);
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  clientCore = new ClientCore(mainWindow);
});

// IPC Handlers
ipcMain.handle('client:connect', async (event, { nickname, folderPath }) => {
  try {
    return await clientCore.connect(nickname, folderPath);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('client:getFiles', async () => {
  return clientCore.getFiles();
});

ipcMain.handle('client:getUsers', async () => {
  return clientCore.getUsers();
});

ipcMain.handle('client:shareFile', async (event, { fileHash, recipients }) => {
  try {
    return await clientCore.shareFile(fileHash, recipients);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('client:revokeAccess', async (event, { fileHash, targetUser }) => {
  return await clientCore.revokeAccess(fileHash, targetUser);
});

ipcMain.handle('client:disconnect', async () => {
  clientCore.disconnect();
  return { success: true };
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});