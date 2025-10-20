// client/electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Test function
  test: () => {
    console.log('✅ Electron API is working!');
    return 'API Connected';
  },
  
  // Connection
  connect: (nickname, folderPath) =>
    ipcRenderer.invoke('client:connect', { nickname, folderPath }),

  // File operations
  getFiles: () => ipcRenderer.invoke('client:getFiles'),
  
  shareFile: (fileHash, recipients) =>
    ipcRenderer.invoke('client:shareFile', { fileHash, recipients }),
  
  downloadFile: (fileHash, uploader) =>
    ipcRenderer.invoke('client:downloadFile', { fileHash, uploader }),
  
  getUsers: () => ipcRenderer.invoke('client:getUsers'),
  
  revokeAccess: (fileHash, targetUser) =>
    ipcRenderer.invoke('client:revokeAccess', { fileHash, targetUser }),

  // Event listeners
  onMessage: (callback) => {
    ipcRenderer.on('hub-message', (_, data) => callback(data));
  },

  onFileShared: (callback) => {
    ipcRenderer.on('file-shared', (_, data) => callback(data));
  },

  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (_, data) => callback(data));
  },

  onUserListUpdate: (callback) => {
    ipcRenderer.on('user-list-update', (_, data) => callback(data));
  },
});