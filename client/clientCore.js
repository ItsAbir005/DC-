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

export class ClientCore {
  constructor(mainWindow) {
    this.ws = null;
    this.nickname = null;
    this.index = [];
    this.users = [];
    this.mainWindow = mainWindow;
    this.activeDownloadTokens = new Map();
    this.sharedFiles = new Map();
  }

  async connect(nickname, folderPath) {
    try {
      this.nickname = nickname;
      
      // Generate file index if folder provided
      if (folderPath && fs.existsSync(folderPath)) {
        this.index = generateSharedIndex(folderPath);
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

        case 'fileShared':
          this.sendToRenderer('file-shared', msg);
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
    return this.index;
  }

  getUsers() {
    return this.users;
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

            this.sharedFiles.set(fileHash, {
              allowedUserIDs: Object.keys(encryptedKeys),
              filePath: file.filePath,
            });

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
        fileHash,
        targetUserID: targetUser,
      }));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
} 