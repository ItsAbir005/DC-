// client/clientCore.js
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

// PERSIST FOLDER PATH
let SETTINGS_FILE = null;

function getSettingsFile(nickname) {
  return `./client_settings_${nickname}.json`;
}

export class ClientCore {
  constructor(mainWindow) {
    this.ws = null;
    this.nickname = null;
    this.folderPath = null;
    this.index = [];
    this.users = [];
    this.mainWindow = mainWindow;
    this.activeDownloadTokens = new Map();
    this.sharedFiles = new Map();
    this.sharedWithMe = [];
    this.activeDownloads = new Map();
  }

  // Save settings to file
  saveSettings() {
    try {
      if (!this.nickname) return;

      const settingsFile = getSettingsFile(this.nickname);
      const settings = {
        folderPath: this.folderPath,
        nickname: this.nickname
      };
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
      console.log(`💾 Settings saved for ${this.nickname}:`, settings);
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }

  // Load settings from file
  loadSettings(nickname) {
    try {
      if (!nickname) return;

      const settingsFile = getSettingsFile(nickname);
      if (fs.existsSync(settingsFile)) {
        const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        this.folderPath = settings.folderPath;
        console.log(`📂 Loaded saved folder path for ${nickname}:`, this.folderPath);
      } else {
        console.log(`📂 No saved settings for ${nickname}`);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  async connect(nickname, folderPath) {
    try {
      this.nickname = nickname;
      this.loadSettings(nickname);
      if (folderPath) {
        this.folderPath = folderPath;
        this.saveSettings();
      } else if (this.folderPath) {
        console.log(`📂 Using saved folder path for ${nickname}:`, this.folderPath);
        folderPath = this.folderPath;
      }

      // Generate file index if folder available
      if (folderPath && fs.existsSync(folderPath)) {
        console.log('📁 Indexing files from:', folderPath);
        this.index = generateSharedIndex(folderPath);
        console.log(`✅ Indexed ${this.index.length} files`);

        // Initialize share tracking for each file
        this.index.forEach(file => {
          if (!this.sharedFiles.has(file.hash)) {
            this.sharedFiles.set(file.hash, {
              fileName: file.fileName,
              filePath: file.filePath,
              size: file.size,
              sharedWith: [],
              encryptedKeys: {},
              shareHistory: []
            });
          }
        });
      } else {
        console.log('⚠️ No folder path provided or folder does not exist');
        this.index = [];
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

          const welcomeHandler = (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'system' && msg.text.includes('Welcome')) {
              // Send registration
              this.ws.send(JSON.stringify({
                type: "registerKey",
                from: nickname,
                publicKey: localPublicKeyPem
              }));

              // Send file index (even if empty)
              console.log(`📤 Sending file index: ${this.index.length} files`);
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
              resolve({ success: true, nickname, filesCount: this.index.length });
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
          this.ws.send(JSON.stringify({ type: "getUsers", from: this.nickname }));
          break;

        case 'userLeft':
          this.sendToRenderer('user-left', { nickname: msg.nickname });
          this.sharedFiles.forEach((fileInfo, fileHash) => {
            const index = fileInfo.sharedWith.indexOf(msg.nickname);
            if (index > -1) {
              fileInfo.sharedWith.splice(index, 1);
              this.updateFileIndex();
            }
          });
          break;

        // In clientCore.js, replace the 'fileShared' case in handleMessage():

        case 'fileShared':
          console.log('📥 Received file share:', msg.fileName, 'from', msg.from);
          console.log('📦 Full message:', JSON.stringify(msg, null, 2));

          // Store file info for downloads
          const sharedFile = {
            fileHash: msg.fileHash,
            fileName: msg.fileName,
            size: msg.size,
            uploader: msg.from,
            encryptedKey: msg.encryptedKey,
            iv: msg.iv,
            sharedAt: Date.now(),
          };

          // Avoid duplicates - but UPDATE if exists (to get latest IV and key)
          const existingIndex = this.sharedWithMe.findIndex(f =>
            f.fileHash === msg.fileHash && f.uploader === msg.from
          );

          if (existingIndex >= 0) {
            // Update existing entry with new encryption data
            this.sharedWithMe[existingIndex] = sharedFile;
            console.log('🔄 Updated existing file share with new encryption data');
          } else {
            // Add new file share
            this.sharedWithMe.push(sharedFile);
            console.log('✅ File added to sharedWithMe:', sharedFile);
          }

          this.sendToRenderer('file-shared', msg);
          break;

        case 'accessRevoked':
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
          console.log('🎫 Received download token:', msg);
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
    console.log('📋 Getting sharedWithMe:', this.sharedWithMe.length, 'files');
    return this.sharedWithMe;
  }

  updateFileIndex() {
    this.sendToRenderer('file-list-update', this.getFiles());
  }

  async shareFile(fileHash, recipients) {
    try {
      const file = this.index.find(f => f.hash === fileHash);
      if (!file) {
        return { success: false, error: 'File not found' };
      }

      this.ws.send(JSON.stringify({ type: "getUsers", from: this.nickname }));
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

            const shareInfo = this.sharedFiles.get(fileHash);
            if (shareInfo) {
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

              shareInfo.encryptedKeys = { ...shareInfo.encryptedKeys, ...encryptedKeys };
            }

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

          delete shareInfo.encryptedKeys[targetUser];
        }
      }

      this.updateFileIndex();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async requestDownloadToken(fileHash, uploader) {
    try {
      console.log('🎫 Requesting download token for:', fileHash, 'from:', uploader);

      return new Promise((resolve, reject) => {
        const tokenHandler = (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'downloadToken' && msg.fileHash === fileHash) {
            this.ws.off('message', tokenHandler);
            console.log('✅ Token received:', msg);

            if (msg.token) {
              resolve({
                success: true,
                token: msg.token,
                uploaderAddress: msg.uploaderIP || 'localhost',
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

      console.log('🚀 Starting download:', {
        fileName,
        uploader,
        size,
        token: token?.substring(0, 20) + '...'
      });

      const fileInfo = this.sharedWithMe.find(f => f.fileHash === fileHash);
      if (!fileInfo) {
        console.error('❌ File info not found in sharedWithMe');
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
        lastProgressedBytes: 0,
        ws: null,
        writeStream: null,
        totalChunks: 0,
        chunksReceived: 0,
      };

      this.activeDownloads.set(fileHash, downloadState);

      // Send initial progress
      this.sendToRenderer('download-progress', {
        fileHash,
        fileName,
        uploader,
        downloaded: 0,
        total: size,
        progress: 0,
        speed: 0,
        status: 'downloading',
        chunksReceived: 0,
      });

      // Connect using WebSocket
      const ws = new WebSocket(`ws://${uploaderAddress || 'localhost'}:4000`);
      downloadState.ws = ws;

      ws.on('open', () => {
        console.log(`📡 Connected to uploader: ${uploaderAddress}:4000`);

        // Send download request
        ws.send(JSON.stringify({
          type: 'downloadRequest',
          token,
          fileHash,
          stream: true,
          autoStream: true
        }));
      });

      let fileStream = null;
      let lastProgressUpdate = Date.now();
      let metadataReceived = false;

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'fileMetadata') {
            console.log('✅ Metadata received:', msg);
            metadataReceived = true;
            downloadState.totalChunks = msg.totalChunks;
            fileStream = fs.createWriteStream(outputPath);
            downloadState.writeStream = fileStream;
          }
          else if (msg.type === 'fileChunk') {
            if (!fileStream) {
              console.error('❌ Received chunk before metadata');
              return;
            }

            // Decode base64 chunk
            const chunkBuffer = Buffer.from(msg.chunk, 'base64');
            fileStream.write(chunkBuffer);

            downloadState.downloaded += chunkBuffer.length;
            downloadState.chunksReceived = msg.current + 1;
            downloadState.progress = Math.min(99, (downloadState.downloaded / size) * 100);

            const now = Date.now();
            const timeDiff = (now - downloadState.lastUpdate) / 1000;
            const bytesDiff = downloadState.downloaded - downloadState.lastProgressedBytes;
            downloadState.speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
            downloadState.lastUpdate = now;
            downloadState.lastProgressedBytes = downloadState.downloaded;

            console.log(`📊 Progress: ${downloadState.progress.toFixed(1)}% | Chunk ${msg.current + 1}/${msg.total}`);

            // Send progress for EVERY chunk (no throttle)
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
              totalChunks: msg.total
            });
          }
          else if (msg.type === 'fileComplete') {
            console.log('📥 Download completed - starting decryption...');

            if (fileStream) {
              fileStream.end(async () => {
                try {
                  // DECRYPT THE FILE
                  const encryptedPath = outputPath;
                  const decryptedPath = outputPath.replace('.pdf', '_decrypted.pdf');

                  // Get decryption key - IMPORTANT: Get the LATEST entry
                  const fileInfo = this.sharedWithMe.find(f => f.fileHash === fileHash);
                  if (!fileInfo) {
                    throw new Error('File info not found in sharedWithMe');
                  }

                  if (!fileInfo.encryptedKey) {
                    throw new Error('No encryption key found');
                  }

                  if (!fileInfo.iv) {
                    throw new Error('No IV found');
                  }

                  console.log('🔍 File info:', {
                    hasKey: !!fileInfo.encryptedKey,
                    hasIV: !!fileInfo.iv,
                    uploader: fileInfo.uploader
                  });

                  // Decrypt the AES key using our private key
                  const { privateKey } = ensureKeyPair();

                  const decryptedAESKey = crypto.privateDecrypt(
                    {
                      key: privateKey,
                      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                      oaepHash: "sha256"
                    },
                    Buffer.from(fileInfo.encryptedKey, 'base64')
                  );

                  console.log('✅ AES key decrypted successfully');

                  const iv = Buffer.from(fileInfo.iv, 'base64');
                  console.log('✅ IV loaded successfully');

                  // Decrypt the file
                  const decipher = crypto.createDecipheriv('aes-256-cbc', decryptedAESKey, iv);
                  const encryptedData = fs.readFileSync(encryptedPath);
                  console.log(`📦 Read ${encryptedData.length} bytes of encrypted data`);

                  const decryptedData = Buffer.concat([
                    decipher.update(encryptedData),
                    decipher.final()
                  ]);
                  console.log(`✅ Decrypted ${decryptedData.length} bytes`);

                  // Write decrypted file
                  fs.writeFileSync(decryptedPath, decryptedData);
                  console.log(`💾 Wrote decrypted file: ${decryptedPath}`);

                  // Delete encrypted file and rename decrypted
                  fs.unlinkSync(encryptedPath);
                  fs.renameSync(decryptedPath, outputPath);

                  console.log('✅ File decrypted and saved successfully to:', outputPath);

                  downloadState.status = 'completed';
                  downloadState.progress = 100;

                  this.sendToRenderer('download-complete', {
                    fileHash,
                    fileName,
                    outputPath,
                  });

                  this.activeDownloads.delete(fileHash);
                  ws.close();
                } catch (error) {
                  console.error('❌ Decryption failed:', error);
                  this.sendDownloadError(fileHash, 'Decryption failed: ' + error.message);
                  ws.close();
                }
              });
            }
          }
          else if (msg.type === 'error') {
            console.error('❌ Server error:', msg.text);
            this.sendDownloadError(fileHash, msg.text);
            if (fileStream) fileStream.close();
            ws.close();
          }
        } catch (error) {
          console.error('❌ Error processing message:', error);
        }
      });

      ws.on('close', () => {
        console.log('🔌 WebSocket closed');
        if (downloadState.progress < 100) {
          this.sendDownloadError(fileHash, 'Connection closed');
          if (fileStream) fileStream.close();
        }
      });

      ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        this.sendDownloadError(fileHash, error.message);
        if (fileStream) fileStream.close();
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
    for (const [fileHash] of this.activeDownloads) {
      this.cancelDownload(fileHash);
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
} 