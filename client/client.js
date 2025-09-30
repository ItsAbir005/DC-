// client.js
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
import { decryptAESKey, decryptFile } from "./controllers/decryptController.js";
import { initiatePeerDownload } from "./controllers/peerController.js";
import { handleDownload } from "./middlewares/downloadMiddleware.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const CHUNK_SIZE = 4 * 1024 * 1024;

// CLI prompts
rl.question("Enter your nickname: ", (nicknameRaw) => {
  const nickname = nicknameRaw.trim();
  if (!nickname) {
    console.error("No nickname entered. Please run again.");
    process.exit(1);
  }

  rl.question("Enter folder path to share (press Enter to skip): ", (folderPathRaw) => {
    const folderPath = folderPathRaw.trim();
    let index = [];
    if (folderPath) {
      try {
        index = generateSharedIndex(folderPath);
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    } else {
      console.log("ℹ No folder shared. Continuing without files...");
    }
    const { privateKey: localPrivateKeyPem, publicKey: localPublicKeyPem } = ensureKeyPair();
    const token = jwt.sign({ nickname }, "secret123", { expiresIn: "1h" });
    const ws = new WebSocket(`wss://localhost:3000/?token=${token}`, { rejectUnauthorized: false });

    ws.on("open", () => {
      console.log(" Connected to hub as", nickname);
      ws.send(JSON.stringify({ type: "registerKey", from: nickname, publicKey: localPublicKeyPem }));
      ws.send(JSON.stringify({ type: "fileIndex", from: nickname, files: index }));

      rl.setPrompt("> ");
      rl.prompt();
    });

    ws.on("message", async (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (err) {
        console.log(" Received non-JSON:", data.toString());
        rl.prompt();
        return;
      }

      switch (msg.type) {
        case "system":
        case "keyAck":
          console.log(`\n[Hub] ${msg.text}`);
          break;

        case "userList":
          console.log("\n Connected Users:");
          if (Array.isArray(msg.users)) {
            msg.users.forEach((u) => {
              console.log(`ID: ${u.id} | Nick: ${u.nickname}`);
              if (u.publicKey) registerUserKey(u.nickname, u.publicKey);
            });
          }
          break;

        case "userKey":
          registerUserKey(msg.nickname, msg.publicKey);
          console.log(` Received public key for ${msg.nickname}`);
          break;

        case "shareAck":
          console.log(` Share acknowledged for ${msg.fileHash}`);
          break;

        case "fileShared":
          console.log(`\n ${msg.from} shared: ${msg.fileName} | ${msg.size} bytes | hash: ${msg.fileHash}`);
          console.log("   To request key: !request_keys", msg.fileHash);
          break;

        case "fileKey":
          try {
            console.log(`\n Received encrypted key for ${msg.fileHash}`);
            const ivBuf = Buffer.from(msg.iv, "base64");
            const aesKey = decryptAESKey(msg.encryptedKey, "./keys/private.pem");

            const encryptedFilePath = path.join("./downloads", `${msg.fileHash}.enc`);
            const outputFilePath = path.join("./downloads", `${msg.fileHash}_decrypted`);

            await decryptFile(encryptedFilePath, outputFilePath, aesKey, ivBuf);
            console.log(` Decrypted file saved at: ${outputFilePath}`);
          } catch (err) {
            console.error(" Decryption failed:", err.message);
          }
          break;

        case "fileList":
          console.log(`\n Files by ${msg.owner}:`);
          if (!msg.files?.length) console.log(" (No files shared)");
          else msg.files.forEach((f, i) => console.log(`${i + 1}. ${f.fileName} | ${f.size} bytes | hash: ${f.hash}`));
          break;

        case "downloadToken":
          console.log(`\n Got download token for ${msg.fileHash}`);
          initiatePeerDownload(msg.fileHash, msg.token, msg.uploader, msg.chunkHashes, "./downloads");
          break;

        case "chat":
        case "message":
          console.log(`\n${msg.from || "Hub"}: ${msg.text}`);
          break;

        default:
          console.log("\n Unknown message:", msg);
      }

      rl.prompt();
    });

    ws.on("close", (code, reason) => {
      console.log(`\n Disconnected from hub ${code ? `(code ${code})` : ""} ${reason || ""}`);
      process.exit(0);
    });

    ws.on("error", (err) => {
      console.error("\nWebSocket error:", err.message);
      rl.prompt();
    });
    // CLI input handler
    rl.on("line", async (line) => {
      const msg = line.trim();
      if (!msg) return rl.prompt();

      if (msg === "!myfiles") {
        console.log("\n📂 Your Files:");
        if (!index.length) console.log(" (No files shared)");
        else index.forEach((f, i) => console.log(`${i + 1}. ${f.fileName} | hash: ${f.hash}`));
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
        const downloadsDir = path.join("./downloads");
        if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);
        const encryptedFilePath = path.join(downloadsDir, `${fileHash}.enc`);

        const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
        fs.createReadStream(file.filePath)
          .pipe(cipher)
          .pipe(fs.createWriteStream(encryptedFilePath))
          .on("finish", () => {
            const encryptedKeys = {};
            for (const r of recipients) {
              const pubKeyPem = getUserKey(r);
              if (!pubKeyPem) continue;
              encryptedKeys[r] = encryptAESKeyForRecipient(pubKeyPem, aesKey);
            }

            ws.send(JSON.stringify({
              type: "shareEncryptedFile",
              from: nickname,
              fileHash,
              fileName: file.fileName,
              size: file.size,
              recipients,
              encryptedKeys,
              iv: iv.toString("base64"),
            }));

            console.log(` File encrypted & shared: ${file.fileName}`);
            rl.prompt();
          });
        return;
      }

      if (msg.startsWith("!request_keys ")) {
        const [, fileHash] = msg.split(" ");
        ws.send(JSON.stringify({ type: "getFileKey", from: nickname, fileHash }));
        return rl.prompt();
      }

      if (msg.startsWith("!request_download_token ")) {
        const [, fileHash] = msg.split(" ");
        ws.send(JSON.stringify({ type: "requestDownloadToken", from: nickname, fileHash }));
        return rl.prompt();
      }

      if (msg.startsWith("!download ")) {
        const [, fileHash, uploader] = msg.split(" ");
        ws.send(JSON.stringify({ type: "requestDownloadToken", from: nickname, fileHash, uploader }));
        return rl.prompt();
      }

      if (msg.startsWith("!list ")) {
        const [, targetNick] = msg.split(" ");
        ws.send(JSON.stringify({ type: "listRequest", from: nickname, target: targetNick }));
        return rl.prompt();
      }
      ws.send(JSON.stringify({ type: "message", from: nickname, text: msg }));
      rl.prompt();
    });
  });
});
//peer connection handler
export function handlePeerConnection(peerSocket) {
  peerSocket.on("message", (raw) => {
    let req;
    try { req = JSON.parse(raw.toString()); } catch { return; }
    if (req.type === "downloadRequest") {
      handleDownload(peerSocket, req, "./downloads");
    }
  });

  peerSocket.on("close", () => console.log("Peer disconnected"));
  peerSocket.on("error", (err) => console.error("Peer error:", err.message));
}
