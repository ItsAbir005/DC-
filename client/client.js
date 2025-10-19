//client/client.js
import readline from "readline";
import jwt from "jsonwebtoken";
import WebSocket from "ws";
import fs from "fs";
import path from "path";
import crypto from "crypto";

import { generateSharedIndex } from "./controllers/shareController.js";
import { ensureKeyPair } from "./controllers/keyController.js";
import { registerUserKey, getUserKey, listUsers } from "./controllers/userController.js";
import { generateAESKey, encryptAESKeyForRecipient } from "./utils/cryptoUtils.js";
import { initiatePeerDownload } from "./controllers/peerController.js";
import { startUploaderServer, isUploaderServerRunning } from "./uploaderServer.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const downloadsDir = "./downloads";
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);
const sharedFiles = new Map();
const activeDownloadTokens = new Map(); // Store tokens received from hub

async function rotateFileKey(fileHash, revokedUser, index, ws) {
  try {
    const fileEntry = index.find(f => f.hash === fileHash);
    if (!fileEntry) {
      console.log(` File not found locally for hash ${fileHash}`);
      return;
    }
    const { key: newAESKey, iv: newIV } = generateAESKey();
    const fileMeta = sharedFiles.get(fileHash);
    if (!fileMeta) {
      console.log(`No metadata found for file ${fileHash}`);
      return;
    }

    const remainingUsers = Array.from(fileMeta.allowedUserIDs || []).filter(
      u => u !== revokedUser
    );

    if (remainingUsers.length === 0) {
      console.log(" No remaining authorized users to share rotated key with.");
      return;
    }

    console.log(` Rotating AES key for ${fileHash}. Remaining users: ${remainingUsers.join(", ")}`);
    const newEncryptedKeys = {};
    for (const user of remainingUsers) {
      const pubKeyPem = getUserKey(user);
      if (pubKeyPem) {
        newEncryptedKeys[user] = encryptAESKeyForRecipient(pubKeyPem, newAESKey);
      } else {
        console.log(` No public key found for ${user}, skipping.`);
      }
    }
    ws.send(
      JSON.stringify({
        type: "updateFileKeys",
        fileHash,
        newIV: newIV.toString("base64"),
        newEncryptedKeys,
      })
    );
    fileMeta.allowedUserIDs = remainingUsers;
    sharedFiles.set(fileHash, fileMeta);

    console.log(" New AES key generated and distributed to remaining users.");
  } catch (err) {
    console.error(" Key rotation failed:", err.message);
  }
}

rl.question("Enter your nickname: ", (nicknameRaw) => {
  const nickname = nicknameRaw.trim();
  if (!nickname) {
    console.error(" No nickname entered. Please run again.");
    process.exit(1);
  }

  rl.question("Enter folder path to share (press Enter to skip): ", (folderPathRaw) => {
    const folderPath = folderPathRaw.trim();
    let index = [];
    if (folderPath) {
      try {
        index = generateSharedIndex(folderPath);
      } catch (err) {
        console.error(" Error:", err.message);
        process.exit(1);
      }
    } else {
      console.log(" No folder shared. Continuing without files...");
    }

    const { publicKey: localPublicKeyPem } = ensureKeyPair();
    const token = jwt.sign({ nickname }, "secret123", { expiresIn: "1h" });
    const ws = new WebSocket(`ws://localhost:8080/?token=${token}`);

    let registrationSent = false;

    ws.on("open", () => {
      console.log(` Connected to hub as ${nickname}`);
      rl.setPrompt("> ");
      rl.prompt();
    });

    ws.on("message", async (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        console.log("Received non-JSON:", data.toString());
        rl.prompt();
        return;
      }

      // Debug: Log all incoming messages
      if (msg.type !== "system" && msg.type !== "chat") {
        console.log(`📨 Received: ${msg.type}`);
      }

      // Send registration after receiving welcome message
      if (msg.type === "system" && msg.text.includes("Welcome") && !registrationSent) {
        registrationSent = true;
        console.log(` Registering public key...`);
        
        // Verify the key is in proper format before sending
        if (!localPublicKeyPem || !localPublicKeyPem.includes('-----BEGIN PUBLIC KEY-----')) {
          console.error("✗ ERROR: Generated public key is invalid!");
          console.error("  Key preview:", localPublicKeyPem?.substring(0, 50));
          process.exit(1);
        }
        
        const registerKeyMsg = { 
          type: "registerKey", 
          from: nickname, 
          publicKey: localPublicKeyPem 
        };
        
        console.log(`📤 Sending registerKey message (${JSON.stringify(registerKeyMsg).length} bytes)`);
        ws.send(JSON.stringify(registerKeyMsg));
        
        const fileIndexMsg = { 
          type: "fileIndex", 
          from: nickname, 
          files: index 
        };
        
        console.log(`📤 Sending fileIndex message (${index.length} files)`);
        ws.send(JSON.stringify(fileIndexMsg));
      }

      switch (msg.type) {
        case "system":
          console.log(`[Hub] ${msg.text}`);
          break;

        case "keyAck":
          console.log(`[Hub] ${msg.text}`);
          console.log(`✓ Your public key has been registered with the hub`);
          break;

        case "info":
          console.log(`[Hub] ${msg.text}`);
          break;

        case "error":
          console.log(`[Error] ${msg.text}`);
          break;

        case "userList":
          console.log("\n Connected Users:");
          msg.users?.forEach((u) => {
            console.log(` ID: ${u.id} | Nick: ${u.nickname}`);
            if (u.publicKey) {
              if (registerUserKey(u.nickname, u.publicKey)) {
                console.log(`   ✓ Stored public key for ${u.nickname}`);
              } else {
                console.log(`   ✗ Failed to store key for ${u.nickname}`);
              }
            } else {
              console.log(`   ⚠ No public key available for ${u.nickname}`);
            }
          });
          break;

        case "userKey":
          if (registerUserKey(msg.nickname, msg.publicKey)) {
            console.log(` ✓ Received and stored public key for ${msg.nickname}`);
          } else {
            console.log(` ✗ Failed to store public key for ${msg.nickname}`);
          }
          break;

        case "fileShared":
          console.log(
            ` ${msg.from} shared: ${msg.fileName} (${msg.size} bytes) | hash: ${msg.fileHash}`
          );
          console.log("   To request key: !request_keys", msg.fileHash);
          break;

        case "fileList":
          console.log(`\n Files by ${msg.owner}:`);
          if (!msg.files?.length) console.log("   (No files shared)");
          else
            msg.files.forEach((f, i) =>
              console.log(`${i + 1}. ${f.fileName} | ${f.size} bytes | hash: ${f.hash}`)
            );
          break;

        case "downloadToken":
          console.log(`\n Got download token for ${msg.fileHash}`);
          
          initiatePeerDownload(
            msg.fileHash,
            msg.token,
            msg.uploader,
            msg.chunkHashes,
            downloadsDir
          );
          break;

        case "downloadTokenIssued":
          console.log(`\n📥 Download token issued: ${msg.downloader} is downloading ${msg.fileHash.substring(0, 16)}...`);
          
          // Store the token so our uploader server can validate it
          activeDownloadTokens.set(msg.token, {
            user: msg.downloader,
            fileHash: msg.fileHash,
            expires: msg.expires,
          });
          
          // Ensure uploader server is running
          if (!isUploaderServerRunning()) {
            console.log(` Starting uploader server...`);
            startUploaderServer(4000, activeDownloadTokens);
          }
          break;

        case "auditLog":
          console.log(`\nAudit Log for ${msg.fileHash}:`);
          msg.logs.forEach(log => {
            console.log(`[${log.timestamp}] ${log.acting_user_id} -> ${log.action_type} (${log.status})`);
          });
          break;

        case "chat":
        case "message":
          if (msg.text) console.log(`${msg.from || "Hub"}: ${msg.text}`);
          break;

        case "revocationConfirmed":
          console.log(` Revocation confirmed: ${msg.revokedUser} removed for ${msg.fileHash}`);
          rotateFileKey(msg.fileHash, msg.revokedUser, index, ws);
          break;

        default:
          console.log(" Unknown message:", msg);
      }

      rl.prompt();
    });

    ws.on("close", () => {
      console.log("\n Disconnected from hub");
      process.exit(0);
    });

    ws.on("error", (err) => {
      console.error("\n WebSocket error:", err.message);
      rl.prompt();
    });

    rl.on("line", async (line) => {
      const msg = line.trim();
      if (!msg) return rl.prompt();

      if (msg === "!myfiles") {
        console.log("\n Your Files:");
        if (index.length)
          index.forEach((f, i) => console.log(`${i + 1}. ${f.fileName} | hash: ${f.hash}`));
        else console.log("   (No files shared)");
        return rl.prompt();
      }

      if (msg === "!users") {
        ws.send(JSON.stringify({ type: "getUsers", from: nickname }));
        return rl.prompt();
      }

      if (msg === "!debug_keys") {
        console.log("\n Local Key Storage:");
        const users = listUsers();
        if (users.length === 0) {
          console.log("  (No keys stored locally)");
        } else {
          users.forEach(user => {
            const key = getUserKey(user);
            if (key) {
              console.log(`  ✓ ${user}: ${key.substring(0, 50)}...`);
            } else {
              console.log(`  ✗ ${user}: Key retrieval failed`);
            }
          });
        }
        return rl.prompt();
      }

      if (msg.startsWith("!share ")) {
        const parts = msg.split(" ");
        if (parts.length < 3) {
          console.log("Usage: !share <fileHash> <recipient1,recipient2,...> OR <recipient1> <recipient2> ...");
          return rl.prompt();
        }

        const fileHash = parts[1];
        // Support both comma-separated and space-separated recipients
        const recipientsStr = parts.slice(2).join(" ");
        const recipients = recipientsStr.includes(",") 
          ? recipientsStr.split(",").map(r => r.trim())
          : parts.slice(2).map(r => r.trim());
        
        const file = index.find((f) => f.hash === fileHash);
        if (!file) {
          console.log(" File not found in your index.");
          return rl.prompt();
        }

        console.log(`📤 Preparing to share with: ${recipients.join(", ")}`);

        // First request user list to ensure we have all public keys
        ws.send(JSON.stringify({ type: "getUsers", from: nickname }));

        // Wait a bit for the user list response
        setTimeout(() => {
          const { key: aesKey, iv } = generateAESKey();
          const encryptedFilePath = path.join(downloadsDir, `${fileHash}.enc`);

          const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
          fs.createReadStream(file.filePath)
            .pipe(cipher)
            .pipe(fs.createWriteStream(encryptedFilePath))
            .on("finish", () => {
              const encryptedKeys = {};
              let missingKeys = [];

              for (const r of recipients) {
                const pubKeyPem = getUserKey(r);
                if (pubKeyPem) {
                  try {
                    encryptedKeys[r] = encryptAESKeyForRecipient(pubKeyPem, aesKey);
                    console.log(`✓ Encrypted key for ${r}`);
                  } catch (err) {
                    console.error(`✗ Failed to encrypt for ${r}:`, err.message);
                    missingKeys.push(r);
                  }
                } else {
                  console.error(`✗ No public key found for ${r}`);
                  missingKeys.push(r);
                }
              }

              if (missingKeys.length > 0) {
                console.log(`⚠ Warning: Could not encrypt for: ${missingKeys.join(", ")}`);
                console.log("   These users may need to reconnect or share their public key.");
              }

              if (Object.keys(encryptedKeys).length === 0) {
                console.log("✗ No valid recipients. File not shared.");
                return rl.prompt();
              }

              // Fixed: Changed type to "shareFile" to match hub handler
              ws.send(
                JSON.stringify({
                  type: "shareFile",
                  from: nickname,
                  fileHash,
                  fileName: file.fileName,
                  size: file.size,
                  allowedUsers: Object.keys(encryptedKeys),
                  encryptedKeys,
                  iv: iv.toString("base64"),
                })
              );

              // Save metadata for rotation tracking
              sharedFiles.set(fileHash, {
                allowedUserIDs: Object.keys(encryptedKeys),
                filePath: file.filePath,
              });

              console.log(` File encrypted & shared: ${file.fileName}`);
              
              // Start uploader server if not already running
              if (!isUploaderServerRunning()) {
                console.log(` Starting uploader server...`);
                startUploaderServer(4000, activeDownloadTokens);
              }
              
              rl.prompt();
            })
            .on("error", (err) => {
              console.error("✗ Encryption failed:", err.message);
              rl.prompt();
            });
        }, 500); // Wait 500ms for user list response

        return;
      }

      if (msg.startsWith("!view_log ")) {
        const parts = msg.split(" ");
        const fileHash = parts[1];
        ws.send(JSON.stringify({ type: "get_audit_log", fileHash }));
        return rl.prompt();
      }

      if (msg.startsWith("!request_keys ")) {
        const parts = msg.split(" ");
        const fileHash = parts[1];
        ws.send(JSON.stringify({ type: "getFileKey", from: nickname, fileHash }));
        return rl.prompt();
      }

      if (msg.startsWith("!download ")) {
        const parts = msg.split(" ");
        const fileHash = parts[1];
        const uploader = parts[2];
        ws.send(
          JSON.stringify({ type: "requestDownloadToken", from: nickname, fileHash, uploader })
        );
        return rl.prompt();
      }

      if (msg.startsWith("!list ")) {
        const parts = msg.split(" ");
        const targetNick = parts[1];
        ws.send(JSON.stringify({ type: "listRequest", from: nickname, target: targetNick }));
        return rl.prompt();
      }

      if (msg.startsWith("!revoke")) {
        const parts = msg.trim().split(" ");
        const fileHash = parts[1];
        const targetUser = parts[2];
        
        if (!fileHash || !targetUser) {
          console.log("Usage: !revoke <fileHash> <targetUser>");
        } else {
          ws.send(
            JSON.stringify({
              type: "revokeAccess",
              fileHash,
              targetUserID: targetUser,
            })
          );
        }
        return rl.prompt();
      }

      // Normal chat
      ws.send(JSON.stringify({ type: "message", from: nickname, text: msg }));
      rl.prompt();
    });
  });
});