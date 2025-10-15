//client/client.js
import readline from "readline";
import jwt from "jsonwebtoken";
import WebSocket from "ws";
import fs from "fs";
import path from "path";
import crypto from "crypto";

import { generateSharedIndex } from "./controllers/shareController.js";
import { ensureKeyPair } from "./controllers/keyController.js";
import { registerUserKey, getUserKey } from "./controllers/userController.js";
import { generateAESKey, encryptAESKeyForRecipient } from "./utils/cryptoUtils.js";
import { initiatePeerDownload } from "./controllers/peerController.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const downloadsDir = "./downloads";
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);
const sharedFiles = new Map();
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
        type: "rotateKey",
        fileHash,
        newEncryptedKeys,
        newIV: newIV.toString("base64"),
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

    ws.on("open", () => {
      console.log(` Connected to hub as ${nickname}`);
      ws.send(JSON.stringify({ type: "registerKey", from: nickname, publicKey: localPublicKeyPem }));
      ws.send(JSON.stringify({ type: "fileIndex", from: nickname, files: index }));
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

      switch (msg.type) {
        case "system":
        case "keyAck":
          console.log(`[Hub] ${msg.text}`);
          break;

        case "userList":
          console.log("\n Connected Users:");
          msg.users?.forEach((u) => {
            console.log(` ID: ${u.id} | Nick: ${u.nickname}`);
            if (u.publicKey) registerUserKey(u.nickname, u.publicKey);
          });
          break;

        case "userKey":
          registerUserKey(msg.nickname, msg.publicKey);
          console.log(` Received public key for ${msg.nickname}`);
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

        case "auditLog":
          console.log(`\nAudit Log for ${msg.fileHash}:`);
          if (!msg.logs.length) console.log("No events logged yet.");
          else msg.logs.forEach(log => {
            console.log(`[${log.timestamp}] ${log.acting_user_id} → ${log.action_type} (${log.status}) ${log.details}`);
          });
          break;

        case "chat":
        case "message":
          console.log(`${msg.from || "Hub"}: ${msg.text}`);
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

      if (msg.startsWith("!share ")) {
        const [, fileHash, recips] = msg.split(" ");
        if (!fileHash || !recips) {
          console.log("Usage: !share <fileHash> <recipient1,recipient2,...>");
          return rl.prompt();
        }

        const recipients = recips.split(",");
        const file = index.find((f) => f.hash === fileHash);
        if (!file) {
          console.log(" File not found in your index.");
          return rl.prompt();
        }

        const { key: aesKey, iv } = generateAESKey();
        const encryptedFilePath = path.join(downloadsDir, `${fileHash}.enc`);

        const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
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

            ws.send(
              JSON.stringify({
                type: "shareEncryptedFile",
                from: nickname,
                fileHash,
                fileName: file.fileName,
                size: file.size,
                recipients,
                encryptedKeys,
                iv: iv.toString("base64"),
              })
            );

            // Save metadata for rotation tracking
            sharedFiles.set(fileHash, {
              allowedUserIDs: recipients,
              filePath: file.filePath,
            });

            console.log(` File encrypted & shared: ${file.fileName}`);
            rl.prompt();
          });
        return;
      }

      if (msg.startsWith("!view_log ")) {
        const [, fileHash] = msg.split(" ");
        ws.send(JSON.stringify({ type: "!get_audit_log", fileHash }));
        return rl.prompt();
      }

      if (msg.startsWith("!request_keys ")) {
        const [, fileHash] = msg.split(" ");
        ws.send(JSON.stringify({ type: "getFileKey", from: nickname, fileHash }));
        return rl.prompt();
      }

      if (msg.startsWith("!download ")) {
        const [, fileHash, uploader] = msg.split(" ");
        ws.send(
          JSON.stringify({ type: "requestDownloadToken", from: nickname, fileHash, uploader })
        );
        return rl.prompt();
      }

      if (msg.startsWith("!list ")) {
        const [, targetNick] = msg.split(" ");
        ws.send(JSON.stringify({ type: "listRequest", from: nickname, target: targetNick }));
        return rl.prompt();
      }

      if (msg.startsWith("!revoke")) {
        const [, fileHash, targetUser] = msg.trim().split(" ");
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
        return;
      }

      // Normal chat
      ws.send(JSON.stringify({ type: "message", from: nickname, text: msg }));
      rl.prompt();
    });
  });
});
