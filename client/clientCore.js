// client/clientCore.js - Enhanced Share Tracking
import WebSocket from "ws";
import jwt from "jsonwebtoken";
import { generateSharedIndex } from "./controllers/shareController.js";
import { ensureKeyPair } from "./controllers/keyController.js";
import { registerUserKey, getUserKey } from "./controllers/userController.js";
import { generateAESKey, encryptAESKeyForRecipient } from "./utils/cryptoUtils.js";
import { startUploaderServer, isUploaderServerRunning } from "./uploaderServer.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import net from "net";

export class ClientCore {
  constructor(mainWindow) {
    this.ws = null;
    this.nickname = null;
    this.index = [];
    this.users = [];
    this.mainWindow = mainWindow;
    this.activeDownloadTokens = new Map();
    this.sharedFiles = new Map(); // Track files we've shared
    this.sharedWithMe = [];
    this.activeDownloads = new Map();
  }

  async connect(nickname, folderPath) {
    try {
      this.nickname = nickname;
      
      // Generate file index if folder provided
      if (folderPath && fs.existsSync(folderPath)) {
        this.index = generateSharedIndex(folderPath);
        
        // Initialize share tracking for each file
        this.index.forEach(file => {
          if (!this.sharedFiles.has(file.hash)) {
            this.sharedFiles.set(file.hash, {
              fileName: file.fileName,
              filePath: file.filePath,
              size: file.size,
              sharedWith: [], // Track who has access
              encryptedKeys: {},
              shareHistory: []
            });
          }
        });
      }

      // Get or generate key pair
      const { publicKey: localPublicKeyPem } = ensureKeyPair();
      
      // Generate JWT token
      const token = jwt.sign({ nickname }, "secret123", { expiresIn: "1h" });
      
      // Connect to hub
      this.ws = new WebSocket(`ws://localhost:8080/?token=${token}`);

      return new Promise((resolve, reject) => {
        this.ws.on('open', () => {
          console.log('✅ Connected to hub');
          
          // Wait for welcome message before sending registration
          const welcomeHandler = (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'system' && msg.text.includes('Welcome')) {
              // Send registration
              this.ws.send(JSON.stringify({ 
                type: "registerKey", 
                from: nickname, 
                publicKey: localPublicKeyPem 
              }));
              
              // Send file index
              this.ws.send(JSON.stringify({ 
                type: "fileIndex", 
                from: nickname, 
                files: this.index 
              }));
              
              // Request user list
              this.ws.send(JSON.stringify({ 
                type: "getUsers", 
                from: nickname 
              }));
              
              this.ws.off('message', welcomeHandler);
              resolve({ success: true, nickname });
            }
          };
          
          this.ws.on('message', welcomeHandler);
        });

        this.ws.on('message', (data) => this.handleMessage(data));
        
        this.ws.on('error', (error) => {
          console.error('❌ WebSocket error:', error);
          reject(error);
        });

        this.ws.on('close', () => {
          console.log('🔌 Disconnected from hub');
          this.sendToRenderer('hub-disconnected', {});
        });

        setTimeout(() => reject(new Error('Connection timeout')), 10000);
      });
    } catch (error) {
      console.error('Connection error:', error);
      return { success: false, error: error.message };
    }
  }

  handleMessage(data) {
    try {
      const msg = JSON.parse(data.toString());
      
      // Send to renderer
      this.sendToRenderer('hub-message', msg);
      
      switch (msg.type) {
        case 'userList':
          this.users = msg.users || [];
          // Store public keys
          msg.users?.forEach(u => {
            if (u.publicKey) {
              registerUserKey(u.nickname, u.publicKey);
            }
          });
          this.sendToRenderer('user-list-update', this.users);
          break;

        case 'userKey':
          registerUserKey(msg.nickname, msg.publicKey);
          this.sendToRenderer('user-joined', { nickname: msg.nickname });
          // Request updated user list
          this.ws.send(JSON.stringify({ type: "getUsers", from: this.nickname }));
          break;

        case 'userLeft':
          this.sendToRenderer('user-left', { nickname: msg.nickname });
          // Remove from shared tracking
          this.sharedFiles.forEach((fileInfo, fileHash) => {
            const index = fileInfo.sharedWith.indexOf(msg.nickname);
            if (index > -1) {
              fileInfo.sharedWith.splice(index, 1);
              this.updateFileIndex();
            }
          });
          break;

        case 'fileShared':
          // Store file info for downloads
          this.sharedWithMe.push({
            fileHash: msg.fileHash,
            fileName: msg.fileName,
            size: msg.size,
            uploader: msg.from,
            encryptedKey: msg.encryptedKey,
            iv: msg.iv,
            sharedAt: Date.now(),
          });
          this.sendToRenderer('file-shared', msg);
          break;

        case 'accessRevoked':
          // Remove from sharedWithMe if we lost access
          this.sharedWithMe = this.sharedWithMe.filter(
            f => !(f.fileHash === msg.fileHash && f.uploader === msg.from)
          );
          this.sendToRenderer('access-revoked', msg);
          break;

        case 'downloadTokenIssued':
          this.activeDownloadTokens.set(msg.token, {
            user: msg.downloader,
            fileHash: msg.fileHash,
            expires: msg.expires,
          });
          
          if (!isUploaderServerRunning()) {
            startUploaderServer(4000, this.activeDownloadTokens);
          }
          break;

        case 'downloadToken':
          this.sendToRenderer('download-token', msg);
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  sendToRenderer(channel, data) {
    if (this.mainWindow && this.mainWindow.webContents) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  getFiles() {
    // Return files with share tracking info
    return this.index.map(file => {
      const shareInfo = this.sharedFiles.get(file.hash);
      return {
        ...file,
        sharedWith: shareInfo?.sharedWith || [],
        encryptedKeys: shareInfo?.encryptedKeys || {},
        shareHistory: shareInfo?.shareHistory || []
      };
    });
  }

  getUsers() {
    return this.users;
  }

  getSharedWithMe() {
    return this.sharedWithMe;
  }

  updateFileIndex() {
    // Send updated file list to renderer
    this.sendToRenderer('file-list-update', this.getFiles());
  }

  async shareFile(fileHash, recipients) {
    try {
      const file = this.index.find(f => f.hash === fileHash);
      if (!file) {
        return { success: false, error: 'File not found' };
      }

      // Request user list first
      this.ws.send(JSON.stringify({ type: "getUsers", from: this.nickname }));
      
      // Wait a bit for user list
      await new Promise(resolve => setTimeout(resolve, 500));

      const { key: aesKey, iv } = generateAESKey();
      const downloadsDir = "./downloads";
      if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);
      
      const encryptedFilePath = path.join(downloadsDir, `${fileHash}.enc`);
      const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
      
      return new Promise((resolve, reject) => {
        fs.createReadStream(file.filePath)
          .pipe(cipher)
          .pipe(fs.createWriteStream(encryptedFilePath))
          .on("finish", () => {
            const encryptedKeys = {};
            
            for (const r of recipients) {
              const pubKeyPem = getUserKey(r);
              if (pubKeyPem) {
                encryptedKeys[r] = encryptAESKeyForRecipient(pubKeyPem, aesKey);
              }
            }

            this.ws.send(JSON.stringify({
              type: "shareFile",
              from: this.nickname,
              fileHash,
              fileName: file.fileName,
              size: file.size,
              allowedUsers: Object.keys(encryptedKeys),
              encryptedKeys,
              iv: iv.toString("base64"),
            }));

            // Update share tracking
            const shareInfo = this.sharedFiles.get(fileHash);
            if (shareInfo) {
              // Add new recipients
              recipients.forEach(recipient => {
                if (!shareInfo.sharedWith.includes(recipient)) {
                  shareInfo.sharedWith.push(recipient);
                  shareInfo.shareHistory.push({
                    user: recipient,
                    action: 'shared',
                    timestamp: Date.now()
                  });
                }
              });
              
              // Update encrypted keys
              shareInfo.encryptedKeys = { ...shareInfo.encryptedKeys, ...encryptedKeys };
            }

            // Update file list in UI
            this.updateFileIndex();

            if (!isUploaderServerRunning()) {
              startUploaderServer(4000, this.activeDownloadTokens);
            }

            resolve({ success: true });
          })
          .on("error", (err) => {
            reject({ success: false, error: err.message });
          });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async revokeAccess(fileHash, targetUser) {
    try {
      this.ws.send(JSON.stringify({
        type: "revokeAccess",
        from: this.nickname,
        fileHash,
        targetUserID: targetUser,
      }));

      // Update local tracking
      const shareInfo = this.sharedFiles.get(fileHash);
      if (shareInfo) {
        const index = shareInfo.sharedWith.indexOf(targetUser);
        if (index > -1) {
          shareInfo.sharedWith.splice(index, 1);
          shareInfo.shareHistory.push({
            user: targetUser,
            action: 'revoked',
            timestamp: Date.now()
          });
          
          // Remove encrypted key
          delete shareInfo.encryptedKeys[targetUser];
        }
      }

      // Update UI
      this.updateFileIndex();

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async requestDownloadToken(fileHash, uploader) {
    try {
      return new Promise((resolve, reject) => {
        const tokenHandler = (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'downloadToken' && msg.fileHash === fileHash) {
            this.ws.off('message', tokenHandler);
            
            if (msg.token) {
              resolve({
                success: true,
                token: msg.token,
                uploaderAddress: msg.uploaderIP,
                uploaderPort: msg.uploaderPort || 4000,
              });
            } else {
              reject({ success: false, error: msg.error || 'Token request failed' });
            }
          }
        };

        this.ws.on('message', tokenHandler);

        this.ws.send(JSON.stringify({
          type: "requestDownloadToken",
          fileHash,
          uploader,
          from: this.nickname,
        }));

        setTimeout(() => {
          this.ws.off('message', tokenHandler);
          reject({ success: false, error: 'Token request timeout' });
        }, 10000);
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async startDownload(downloadInfo) {
    try {
      const { fileHash, fileName, uploader, size, token, uploaderAddress } = downloadInfo;
      
      const fileInfo = this.sharedWithMe.find(f => f.fileHash === fileHash);
      if (!fileInfo) {
        return { success: false, error: 'File info not found' };
      }

      const downloadDir = "./downloaded_files";
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }

      const outputPath = path.join(downloadDir, fileName);
      
      const downloadState = {
        fileHash,
        fileName,
        uploader,
        size,
        downloaded: 0,
        progress: 0,
        status: 'downloading',
        speed: 0,
        startTime: Date.now(),
        lastUpdate: Date.now(),
        socket: null,
        writeStream: null,
        totalChunks: 0,
        chunksReceived: 0,
      };

      this.activeDownloads.set(fileHash, downloadState);

      const socket = new net.Socket();
      downloadState.socket = socket;

      socket.connect(4000, uploaderAddress || 'localhost', () => {
        console.log(`📡 Connected to uploader: ${uploaderAddress}:4000`);
        
        const request = JSON.stringify({
          type: 'downloadRequest',
          token,
          fileHash,
        }) + '\n';
        
        socket.write(request);
      });

      let receivedData = Buffer.alloc(0);
      let fileStream = null;
      let lastProgressUpdate = Date.now();

      socket.on('data', (chunk) => {
        receivedData = Buffer.concat([receivedData, chunk]);

        const newlineIndex = receivedData.indexOf('\n');
        if (newlineIndex !== -1 && !fileStream) {
          const headerJson = receivedData.slice(0, newlineIndex).toString();
          const response = JSON.parse(headerJson);

          if (response.status === 'approved') {
            console.log('✅ Download approved, receiving file...');
            
            fileStream = fs.createWriteStream(outputPath);
            downloadState.writeStream = fileStream;
            
            const fileData = receivedData.slice(newlineIndex + 1);
            if (fileData.length > 0) {
              fileStream.write(fileData);
              downloadState.downloaded += fileData.length;
            }
            
            receivedData = Buffer.alloc(0);
          } else {
            socket.destroy();
            this.sendDownloadError(fileHash, response.error || 'Download denied');
            return;
          }
        } else if (fileStream) {
          fileStream.write(receivedData);
          downloadState.downloaded += receivedData.length;
          receivedData = Buffer.alloc(0);
          
          downloadState.progress = (downloadState.downloaded / size) * 100;
          downloadState.chunksReceived++;
          
          const now = Date.now();
          if (now - lastProgressUpdate >= 500) {
            const timeDiff = (now - downloadState.lastUpdate) / 1000;
            const bytesDiff = downloadState.downloaded - 
              (downloadState.lastProgressedBytes || 0);
            downloadState.speed = bytesDiff / timeDiff;
            downloadState.lastUpdate = now;
            downloadState.lastProgressedBytes = downloadState.downloaded;
            lastProgressUpdate = now;
            
            this.sendToRenderer('download-progress', {
              fileHash,
              fileName,
              uploader,
              downloaded: downloadState.downloaded,
              total: size,
              progress: downloadState.progress,
              speed: downloadState.speed,
              status: 'downloading',
              chunksReceived: downloadState.chunksReceived,
            });
          }
        }
      });

      socket.on('end', () => {
        console.log('📥 Download completed');
        
        if (fileStream) {
          fileStream.end(() => {
            downloadState.status = 'completed';
            downloadState.progress = 100;
            
            this.sendToRenderer('download-complete', {
              fileHash,
              fileName,
              outputPath,
            });
            
            this.activeDownloads.delete(fileHash);
          });
        }
      });

      socket.on('error', (error) => {
        console.error('❌ Download error:', error);
        this.sendDownloadError(fileHash, error.message);
        
        if (fileStream) {
          fileStream.close();
        }
      });

      return { success: true, fileHash };
    } catch (error) {
      console.error('Start download error:', error);
      return { success: false, error: error.message };
    }
  }

  sendDownloadError(fileHash, errorMessage) {
    this.sendToRenderer('download-error', {
      fileHash,
      error: errorMessage,
    });
    
    const downloadState = this.activeDownloads.get(fileHash);
    if (downloadState) {
      if (downloadState.socket) {
        downloadState.socket.destroy();
      }
      if (downloadState.writeStream) {
        downloadState.writeStream.close();
      }
      this.activeDownloads.delete(fileHash);
    }
  }

  async pauseDownload(fileHash) {
    const download = this.activeDownloads.get(fileHash);
    if (download && download.socket) {
      download.socket.pause();
      download.status = 'paused';
      return { success: true };
    }
    return { success: false, error: 'Download not found' };
  }

  async resumeDownload(fileHash) {
    const download = this.activeDownloads.get(fileHash);
    if (download && download.socket) {
      download.socket.resume();
      download.status = 'downloading';
      return { success: true };
    }
    return { success: false, error: 'Download not found' };
  }

  async cancelDownload(fileHash) {
    const download = this.activeDownloads.get(fileHash);
    if (download) {
      if (download.socket) {
        download.socket.destroy();
      }
      if (download.writeStream) {
        download.writeStream.close();
      }
      this.activeDownloads.delete(fileHash);
      return { success: true };
    }
    return { success: false, error: 'Download not found' };
  }

  disconnect() {
    // Cancel all active downloads
    for (const [fileHash] of this.activeDownloads) {
      this.cancelDownload(fileHash);
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
} 