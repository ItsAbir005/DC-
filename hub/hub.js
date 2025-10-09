// hub.js
const fs = require("fs");
const https = require("https");
const express = require("express");
const { WebSocketServer } = require("ws");
const url = require("url");
const { verifyToken } = require("./middleware/auth");
const { broadcast } = require("./middleware/broadcast");
const { handlePrivateMessage } = require("./middleware/privateMessage");
const { handleModeration } = require("./middleware/moderation");
const selfsigned = require("selfsigned");
const jwt = require("jsonwebtoken");

const AUTH_SECRET = process.env.AUTH_SECRET || "auth_secret_dev";
const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || "download_secret_dev";

const app = express();
const userFileIndexes = new Map();
const userPublicKeys = new Map();
const RevocationList = new Map();

// Generate SSL certs if missing
if (!fs.existsSync("key.pem") || !fs.existsSync("cert.pem")) {
  console.log("No SSL certs found. Generating self-signed certificate...");
  const attrs = [{ name: "commonName", value: "localhost" }];
  const pems = selfsigned.generate(attrs, { days: 365 });

  fs.writeFileSync("key.pem", pems.private);
  fs.writeFileSync("cert.pem", pems.cert);
  console.log("key.pem and cert.pem generated!");
}

// HTTPS + WSS server
const server = https.createServer(
  {
    key: fs.readFileSync("key.pem"),
    cert: fs.readFileSync("cert.pem"),
  },
  app
);

app.get("/", (req, res) => {
  res.send("Hub is running securely over HTTPS!");
});

// In-memory store
const connectedUsers = new Map();
const sharedFiles = new Map();

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const params = url.parse(req.url, true).query;
  const token = params.token;
  const payload = verifyToken(token);

  if (!payload || !payload.nickname) {
    ws.send(JSON.stringify({ type: "system", text: "Invalid or missing token. Closing connection." }));
    ws.close();
    return;
  }

  const nickname = payload.nickname;
  console.log(`${nickname} connected`);
  connectedUsers.set(nickname, ws);

  ws.send(JSON.stringify({ type: "system", text: `Welcome ${nickname}! Connected securely over WSS.` }));
  broadcast(connectedUsers, JSON.stringify({ type: "system", text: `${nickname} joined the chat.` }), ws);

  ws.on("message", (msgBuffer) => {
    let parsed;
    try {
      parsed = JSON.parse(msgBuffer.toString());
    } catch {
      console.log(`[${nickname}] sent invalid JSON`);
      return;
    }
    if (parsed.type === "revokeAccess") {
      const { fileHash, targetUserID } = parsed;
      const fileMeta = sharedFiles.get(fileHash);

      if (!fileMeta || fileMeta.ownerID !== nickname) {
        ws.send(JSON.stringify({ type: "error", text: "You are not the owner of this file." }));
        return;
      }

      if (!RevocationList.has(fileHash)) {
        RevocationList.set(fileHash, new Set());
      }
      RevocationList.get(fileHash).add(targetUserID);
      if (fileMeta.allowedUserIDs?.has(targetUserID)) {
        fileMeta.allowedUserIDs.delete(targetUserID);
      }

      console.log(`${nickname} revoked access to ${fileHash} for ${targetUserID}`);
      ws.send(JSON.stringify({ type: "system", text: `User ${targetUserID} revoked for ${fileHash}` }));

      // Notify revoked user if online
      const targetWS = connectedUsers.get(targetUserID);
      if (targetWS) {
        targetWS.send(JSON.stringify({
          type: "revokedNotice",
          text: `Your access to file ${fileHash} has been revoked by ${nickname}.`
        }));
      }
      return;
    }
    if (parsed.type === "rotateKey") {
      const { fileHash, newEncryptedKeys, newIV } = parsed;
      const fileMeta = sharedFiles.get(fileHash);

      if (!fileMeta || fileMeta.ownerID !== nickname) {
        ws.send(JSON.stringify({ type: "error", text: "Unauthorized key rotation." }));
        return;
      }

      // Replace old keys with new ones for allowed users only
      fileMeta.encryptedKeys = newEncryptedKeys;
      fileMeta.iv = newIV;

      console.log(` Key rotated for file ${fileHash} by ${nickname}`);
      ws.send(JSON.stringify({ type: "system", text: `Key rotated successfully for ${fileHash}` }));
      for (const user of fileMeta.allowedUserIDs) {
        const targetWS = connectedUsers.get(user);
        if (targetWS) {
          targetWS.send(JSON.stringify({
            type: "keyRotatedNotice",
            text: `Key rotated for ${fileHash} by ${nickname}. You can now fetch the new key.`,
          }));
        }
      }
      return;
    }
    // Handle encrypted file sharing
    if (parsed.type === "shareEncryptedFile") {
      const normalizedKeys = {};
      for (const [user, key] of Object.entries(parsed.encryptedKeys)) {
        normalizedKeys[user] = Buffer.isBuffer(key) ? key.toString("base64") : key;
      }
      sharedFiles.set(parsed.fileHash, {
        fileName: parsed.fileName,
        size: parsed.size,
        ownerID: nickname,
        recipients: parsed.recipients,
        encryptedKeys: normalizedKeys,
        iv: Buffer.isBuffer(parsed.iv) ? parsed.iv.toString("base64") : parsed.iv,
        allowedUserIDs: new Set(parsed.recipients),
        chunkHashes: Array.isArray(parsed.chunkHashes) ? parsed.chunkHashes : [],
        chunkSize: parsed.chunkSize || null,
        chunks: parsed.chunks || null,
      });

      for (const recipient of parsed.recipients) {
        const targetWS = connectedUsers.get(recipient);
        if (targetWS) {
          targetWS.send(JSON.stringify({
            type: "fileShared",
            from: nickname,
            fileHash: parsed.fileHash,
            fileName: parsed.fileName,
            size: parsed.size,
          }));
        }
      }

      console.log(`${nickname} shared encrypted file ${parsed.fileHash}`);
      ws.send(JSON.stringify({ type: "shareAck", fileHash: parsed.fileHash }));
      return;
    }
    // Handle file key requests
    if (parsed.type === "getFileKey") {
      const fileMeta = sharedFiles.get(parsed.fileHash);
      if (!fileMeta) {
        ws.send(JSON.stringify({ type: "error", text: "File not found." }));
        return;
      }
      const revokedSet = RevocationList.get(parsed.fileHash);
      if (revokedSet && revokedSet.has(nickname)) {
        ws.send(JSON.stringify({ type: "error", text: "Access Revoked. You cannot retrieve this key." }));
        return;
      }

      if (!fileMeta.allowedUserIDs.has(nickname)) {
        ws.send(JSON.stringify({ type: "error", text: "Access denied" }));
        return;
      }

      const encKey = fileMeta.encryptedKeys[nickname];
      const iv = fileMeta.iv;
      ws.send(JSON.stringify({
        type: "fileKey",
        fileHash: parsed.fileHash,
        encryptedKey: encKey,
        iv,
      }));
      return;
    }
    // Handle file key updates by owner
    if (parsed.type === "updateFileKeys") {
      const { fileHash, newIV, newEncryptedKeys } = parsed;
      const fileMeta = sharedFiles.get(fileHash);
      if (!fileMeta || fileMeta.ownerID !== nickname) {
        ws.send(JSON.stringify({
          type: "error",
          text: "Unauthorized: Only the owner can update file keys."
        }));
        return;
      }
      if (!newIV || !newEncryptedKeys || typeof newEncryptedKeys !== "object") {
        ws.send(JSON.stringify({
          type: "error",
          text: "Invalid update payload."
        }));
        return;
      }
      fileMeta.iv = newIV;
      fileMeta.encryptedKeys = newEncryptedKeys;

      console.log(` File keys updated for ${fileHash} by ${nickname}`);

      ws.send(JSON.stringify({
        type: "system",
        text: `File keys successfully updated for ${fileHash}.`
      }));
      for (const user of fileMeta.allowedUserIDs) {
        const targetWS = connectedUsers.get(user);
        if (targetWS) {
          targetWS.send(JSON.stringify({
            type: "keyUpdateNotice",
            text: `File ${fileHash} keys have been updated by ${nickname}. Please fetch the new key.`,
          }));
        }
      }

      return;
    }

    if (parsed.type === "requestDownloadToken") {
      const { fileHash } = parsed;
      const fileMeta = sharedFiles.get(fileHash);

      if (!fileMeta) {
        ws.send(JSON.stringify({ type: "error", text: "File not found" }));
        return;
      }
      const revokedSet = RevocationList.get(fileHash);
      if (revokedSet && revokedSet.has(nickname)) {
        ws.send(JSON.stringify({ type: "error", text: "Access Revoked. Download denied." }));
        return;
      }

      if (!fileMeta.allowedUserIDs.has(nickname)) {
        ws.send(JSON.stringify({ type: "error", text: "Access denied" }));
        return;
      }

      const token = jwt.sign({ fileHash }, DOWNLOAD_SECRET, { expiresIn: "5m" });
      ws.send(JSON.stringify({
        type: "downloadToken",
        fileHash,
        token,
        uploader: fileMeta.ownerID,
      }));
      console.log(` Issued download token for ${nickname} on ${fileHash}`);
      return;
    }
    // Handle public key registration
    if (parsed.type === "registerKey") {
      const { from, publicKey } = parsed;
      userPublicKeys.set(from, publicKey);
      ws.send(JSON.stringify({ type: "keyAck", text: `Public key registered for ${from}` }));
      return;
    }

    if (handlePrivateMessage(connectedUsers, nickname, ws, parsed)) return;
    if (handleModeration(connectedUsers, nickname, ws, parsed)) return;

    if (parsed.type === "chat" || parsed.text) {
      const outgoing = JSON.stringify({ type: "message", from: nickname, text: parsed.text });
      broadcast(connectedUsers, outgoing);
    }
  });

  ws.on("close", () => {
    connectedUsers.delete(nickname);
    broadcast(connectedUsers, JSON.stringify({ type: "system", text: `${nickname} left the chat.` }));
  });
});

server.listen(3000, () => {
  console.log("Hub server running at https://localhost:3000");
});
