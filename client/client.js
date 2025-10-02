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
import { handleDownload } from "./middleware/downloadMiddleware.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const CHUNK_SIZE = 64 * 1024;
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
      console.log("No folder shared. Continuing without files...");
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
    rl.on("line", async (line) => {
      const msg = line.trim();
      if (!msg) return rl.prompt();

      if (msg === "!myfiles") {
        console.log("\n Your Files:");
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

export function initiatePeerDownload(fileHash, token, uploader, knownChunkHashes = [], baseDir = "./downloads") {
  console.log(`\n🔌 Connecting to ${uploader} for file ${fileHash}...`);
  const peerAddress = "ws://localhost:4000"; 

  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  const filePath = path.join(baseDir, `${fileHash}.enc`);
  let localSize = 0;
  if (fs.existsSync(filePath)) {
    localSize = fs.statSync(filePath).size;
  }
  let socket = null;
  let remoteMeta = null; 
  const receivedChunks = new Set();
  const missingChunks = new Set();
  let fd = null; 

  function sha256Hex(buf) {
    return crypto.createHash("sha256").update(buf).digest("hex");
  }

  function startConnection(startOffsetToSend = localSize) {
    if (socket) {
      socket.terminate();
      socket = null;
    }

    socket = new WebSocket(peerAddress);

    socket.on("open", () => {
      console.log(` Connected to uploader peer, sending download request (startOffset=${startOffsetToSend})...`);
      socket.send(JSON.stringify({ type: "downloadRequest", fileHash, token, startOffset: startOffsetToSend }));
    });

    socket.on("message", (raw) => {
      let data;
      try { data = JSON.parse(raw.toString()); } catch (e) {
        console.error("Invalid JSON from peer");
        return;
      }

      if (data.type === "error") {
        console.error("Peer error:", data.text);
        if (data.text && data.text.toLowerCase().includes("start offset") || data.text.toLowerCase().includes("start beyond")) {
          console.log(" Received error about start offset. Closing connection.");
          socket.close();
        }
        return;
      }

      if (data.type === "fileMetadata") {
        remoteMeta = {
          totalChunks: data.totalChunks,
          expectedChunkHashes: (data.expectedChunkHashes || knownChunkHashes || []).slice(),
          fileSize: data.fileSize,
          startChunkIndex: typeof data.startChunkIndex === "number" ? data.startChunkIndex : 0
        };
        if (localSize > remoteMeta.fileSize) {
          console.log(` Local partial file (${localSize}) is larger than remote file (${remoteMeta.fileSize}). Truncating local file.`);
          fs.truncateSync(filePath, remoteMeta.fileSize);
          localSize = remoteMeta.fileSize;
        }
        for (let i = 0; i < remoteMeta.totalChunks; i++) missingChunks.add(i);
        if (localSize > 0) {
          try {
            // open fd if not yet
            const readFd = fs.openSync(filePath, "r");
            for (let ci = 0; ci < Math.ceil(localSize / CHUNK_SIZE); ci++) {
              const start = ci * CHUNK_SIZE;
              const length = Math.min(CHUNK_SIZE, remoteMeta.fileSize - start);
              if (length <= 0) break;
              const buf = Buffer.alloc(length);
              fs.readSync(readFd, buf, 0, length, start);
              const h = sha256Hex(buf);
              if (remoteMeta.expectedChunkHashes[ci] && remoteMeta.expectedChunkHashes[ci] === h) {
                missingChunks.delete(ci);
                receivedChunks.add(ci);
              } else {
                missingChunks.add(ci);
              }
            }
            fs.closeSync(readFd);
          } catch (err) {
            console.warn("Could not pre-verify local partial file:", err.message);
          }
        }
        fd = fs.openSync(filePath, "a+"); 
        console.log(`Expecting ${remoteMeta.totalChunks} chunks (fileSize=${remoteMeta.fileSize}). ${missingChunks.size} chunks to download.`);
        return;
      }
      if (data.type === "fileChunk") {
        const current1based = data.current;
        const chunkIndex = (current1based - 1);

        const chunkBuffer = Buffer.from(data.chunk, "base64");
        const hash = sha256Hex(chunkBuffer);

        const expected = remoteMeta?.expectedChunkHashes?.[chunkIndex];
        if (expected && expected !== hash) {
          console.error(` Hash mismatch at chunk ${chunkIndex}. Discarding and adding back to missing.`);
          missingChunks.add(chunkIndex);
          // don't write
          return;
        }
        const position = chunkIndex * CHUNK_SIZE;
        try {
          fs.writeSync(fd, chunkBuffer, 0, chunkBuffer.length, position);
          receivedChunks.add(chunkIndex);
          missingChunks.delete(chunkIndex);
          console.log(` Received/Stored chunk ${chunkIndex + 1}/${remoteMeta.totalChunks}`);
        } catch (err) {
          console.error("Write failed:", err.message);
          missingChunks.add(chunkIndex);
        }
        if (receivedChunks.size === remoteMeta.totalChunks) {
          finishDownloadAndVerify();
        }
        return;
      }
      if (data.type === "chunkData") {
        const chunkIndex = data.chunkIndex;
        const chunkBuffer = Buffer.from(data.chunk, "base64");
        const hash = sha256Hex(chunkBuffer);
        const expected = remoteMeta?.expectedChunkHashes?.[chunkIndex];
        if (expected && expected !== hash) {
          console.error(` Hash mismatch at chunk ${chunkIndex}. Keeping it in missing list.`);
          missingChunks.add(chunkIndex);
          return;
        }
        const position = chunkIndex * CHUNK_SIZE;
        try {
          if (!fd) fd = fs.openSync(filePath, "a+");
          fs.writeSync(fd, chunkBuffer, 0, chunkBuffer.length, position);
          receivedChunks.add(chunkIndex);
          missingChunks.delete(chunkIndex);
          console.log(` Received/Stored chunk ${chunkIndex + 1}/${remoteMeta.totalChunks}`);
        } catch (err) {
          console.error("Write failed:", err.message);
          missingChunks.add(chunkIndex);
        }

        if (receivedChunks.size === remoteMeta.totalChunks) {
          finishDownloadAndVerify();
        }
        return;
      }

      if (data.type === "fileComplete") {
        if (remoteMeta && receivedChunks.size === remoteMeta.totalChunks) {
          finishDownloadAndVerify();
        } else {
          console.log("Peer signaled fileComplete but we haven't received all chunks yet.");
        }
      }
    });

    socket.on("close", () => {
      console.log("Peer connection closed");
    });

    socket.on("error", (err) => {
      console.error("Peer socket error:", err.message);
    });
  } 

  function finishDownloadAndVerify() {
    if (!remoteMeta) {
      console.log("No remote metadata to verify against.");
      if (fd) fs.closeSync(fd);
      return;
    }
    if (fd) { try { fs.closeSync(fd); } catch (_) {} fd = null; }
    const wholeBuffer = fs.readFileSync(filePath);
    let ok = true;
    for (let i = 0; i < remoteMeta.totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, wholeBuffer.length);
      const slice = wholeBuffer.slice(start, end);
      const h = sha256Hex(slice);
      if (remoteMeta.expectedChunkHashes[i] !== h) {
        console.error(` Final verification failed for chunk ${i}. expected=${remoteMeta.expectedChunkHashes[i]}, got=${h}`);
        ok = false;
        break;
      }
    }

    if (ok) {
      console.log(`Download complete & verified: ${filePath}`);
    } else {
      console.error(" Download finished but verification failed. You should re-request missing/corrupt chunks from peers.");
    }
  }
  startConnection(localSize);
}
