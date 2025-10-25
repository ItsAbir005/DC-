"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("electronAPI", {
  // Test function
  test: () => {
    console.log("✅ Electron API is working!");
    return "API Connected";
  },
  // Connection
  connect: (nickname, folderPath) => ipcRenderer.invoke("client:connect", { nickname, folderPath }),
  disconnect: () => ipcRenderer.invoke("client:disconnect"),
  // File operations
  getFiles: () => ipcRenderer.invoke("client:getFiles"),
  getSharedWithMe: () => ipcRenderer.invoke("client:getSharedWithMe"),
  shareFile: (fileHash, recipients) => ipcRenderer.invoke("client:shareFile", { fileHash, recipients }),
  getUsers: () => ipcRenderer.invoke("client:getUsers"),
  revokeAccess: (fileHash, targetUser) => ipcRenderer.invoke("client:revokeAccess", { fileHash, targetUser }),
  // Download operations
  requestDownloadToken: (fileHash, uploader) => ipcRenderer.invoke("client:requestDownloadToken", { fileHash, uploader }),
  startDownload: (downloadInfo) => ipcRenderer.invoke("client:startDownload", downloadInfo),
  pauseDownload: (fileHash) => ipcRenderer.invoke("client:pauseDownload", { fileHash }),
  resumeDownload: (fileHash) => ipcRenderer.invoke("client:resumeDownload", { fileHash }),
  cancelDownload: (fileHash) => ipcRenderer.invoke("client:cancelDownload", { fileHash }),
  // 🆕 File system operations - Open downloaded files
  openFile: (filePath) => ipcRenderer.invoke("client:openFile", filePath),
  showFileInFolder: (filePath) => ipcRenderer.invoke("client:showFileInFolder", filePath),
  // Event listeners
  onMessage: (callback) => {
    ipcRenderer.on("hub-message", (_, data) => callback(data));
  },
  onFileShared: (callback) => {
    ipcRenderer.on("file-shared", (_, data) => callback(data));
  },
  onDownloadProgress: (callback) => {
    ipcRenderer.on("download-progress", (_, data) => callback(data));
  },
  onDownloadComplete: (callback) => {
    ipcRenderer.on("download-complete", (_, data) => callback(data));
  },
  onDownloadError: (callback) => {
    ipcRenderer.on("download-error", (_, data) => callback(data));
  },
  onUserListUpdate: (callback) => {
    ipcRenderer.on("user-list-update", (_, data) => callback(data));
  },
  onUserJoined: (callback) => {
    ipcRenderer.on("user-joined", (_, data) => callback(data));
  },
  onUserLeft: (callback) => {
    ipcRenderer.on("user-left", (_, data) => callback(data));
  },
  onHubDisconnected: (callback) => {
    ipcRenderer.on("hub-disconnected", (_, data) => callback(data));
  },
  onDownloadToken: (callback) => {
    ipcRenderer.on("download-token", (_, data) => callback(data));
  },
  onFileListUpdate: (callback) => {
    ipcRenderer.on("file-list-update", (_, data) => callback(data));
  },
  sendMessage: (message) => ipcRenderer.invoke("client:sendMessage", message),
  onAccessRevoked: (callback) => {
    ipcRenderer.on("access-revoked", (_, data) => callback(data));
  },
  // Cleanup functions
  removeListener: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
  removeAllListeners: () => {
    const channels = [
      "hub-message",
      "file-shared",
      "download-progress",
      "download-complete",
      "download-error",
      "user-list-update",
      "user-joined",
      "user-left",
      "hub-disconnected",
      "download-token",
      "file-list-update",
      "access-revoked"
    ];
    channels.forEach((channel) => ipcRenderer.removeAllListeners(channel));
  }
});
