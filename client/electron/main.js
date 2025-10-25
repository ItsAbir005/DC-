// client/electron/main.js
import { app, BrowserWindow, ipcMain, shell } from 'electron';
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

// Connection Handlers
ipcMain.handle('client:connect', async (event, { nickname, folderPath }) => {
  try {
    return await clientCore.connect(nickname, folderPath);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('client:disconnect', async () => {
  try {
    clientCore.disconnect();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// File Handlers
ipcMain.handle('client:getFiles', async () => {
  return clientCore.getFiles();
});

ipcMain.handle('client:getSharedWithMe', async () => {
  return clientCore.getSharedWithMe();
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
  try {
    return await clientCore.revokeAccess(fileHash, targetUser);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Download Handlers
ipcMain.handle('client:requestDownloadToken', async (event, { fileHash, uploader }) => {
  try {
    return await clientCore.requestDownloadToken(fileHash, uploader);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('client:startDownload', async (event, downloadInfo) => {
  try {
    return await clientCore.startDownload(downloadInfo);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('client:pauseDownload', async (event, { fileHash }) => {
  try {
    return await clientCore.pauseDownload(fileHash);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('client:resumeDownload', async (event, { fileHash }) => {
  try {
    return await clientCore.resumeDownload(fileHash);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('client:cancelDownload', async (event, { fileHash }) => {
  try {
    return await clientCore.cancelDownload(fileHash);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 🆕 File System Handlers - Open downloaded files
ipcMain.handle('client:openFile', async (event, filePath) => {
  try {
    console.log('📂 Opening file:', filePath);
    const result = await shell.openPath(filePath);
    if (result) {
      // If result is not empty, it contains an error message
      console.error('❌ Failed to open file:', result);
      return { success: false, error: result };
    }
    console.log('✅ File opened successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Error opening file:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('client:showFileInFolder', async (event, filePath) => {
  try {
    console.log('📁 Showing file in folder:', filePath);
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (error) {
    console.error('❌ Error showing file:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('client:sendMessage', async (event, message) => {
  try {
    if (clientCore && clientCore.ws && clientCore.ws.readyState === 1) {
      clientCore.ws.send(JSON.stringify(message));
      return { success: true };
    }
    return { success: false, error: 'Not connected' };
  } catch (error) {
    return { success: false, error: error.message };
  }
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