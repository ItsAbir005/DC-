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

// Secrets
const AUTH_SECRET = process.env.AUTH_SECRET || "auth_secret_dev";
const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || "download_secret_dev";

const app = express();
const userFileIndexes = new Map();
const userPublicKeys = new Map();

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
    if (parsed.type === "shareRequest") {
      const { fileHash, userIDs } = parsed;
      sharedFiles.set(fileHash, {
        fileName: parsed.fileName || "unknown",
        size: parsed.size || 0,
        ownerID: nickname,
        allowedUserIDs: new Set(userIDs),
      });

      console.log(`${nickname} shared file ${fileHash} with users: ${userIDs.join(", ")}`);
      ws.send(JSON.stringify({ type: "shareAck", fileHash, userIDs }));
      return;
    }

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
        chunkHashes: Array.isArray(parsed.chunkHashes) ? parsed.chunkHashes : [], // <- store chunk hashes
        chunkSize: parsed.chunkSize || null,
        chunks: parsed.chunks || null
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
    if (parsed.type === "getFileKey") {
      const fileMeta = sharedFiles.get(parsed.fileHash);
      if (!fileMeta || !fileMeta.allowedUserIDs.has(nickname)) {
        ws.send(JSON.stringify({ type: "system", text: "Access denied" }));
        return;
      }
      try {
        const encKey = fileMeta.encryptedKeys[nickname];
        const iv = fileMeta.iv;
        ws.send(JSON.stringify({
          type: "fileKey",
          fileHash: parsed.fileHash,
          encryptedKey: Buffer.isBuffer(encKey) ? encKey.toString("base64") : encKey,
          iv: Buffer.isBuffer(iv) ? iv.toString("base64") : iv,
        }));
      } catch (err) {
        console.error("Failed to send to client:", err);
      }

      return;
    }

    //User and key management
    if (parsed.type === "getUsers") {
      const users = [...connectedUsers.keys()].map((nick, i) => ({
        id: `u${i + 1}`,
        nickname: nick,
        publicKey: userPublicKeys.get(nick) || null
      }));
      ws.send(JSON.stringify({ type: "userList", users }));
      return;
    }

    if (parsed.type === "requestKey") {
      const target = parsed.target || parsed.nickname;
      const pubKey = userPublicKeys.get(target);

      if (!pubKey) {
        ws.send(JSON.stringify({ type: "system", text: `No public key found for ${target}` }));
        return;
      }

      ws.send(JSON.stringify({ type: "userKey", nickname: target, publicKey: pubKey }));
      return;
    }

    if (parsed.type === "getPublicKey") {
      const pubKey = userPublicKeys.get(parsed.target);
      if (!pubKey) {
        ws.send(JSON.stringify({ type: "system", text: `No public key found for ${parsed.target}` }));
        return;
      }
      ws.send(JSON.stringify({ type: "publicKey", user: parsed.target, key: pubKey }));
      return;
    }
    if (parsed.type === "registerKey") {
      const { from, publicKey } = parsed;
      userPublicKeys.set(from, publicKey);
      console.log(`Stored public key for ${from}`);
      ws.send(JSON.stringify({ type: "keyAck", text: `Public key registered for ${from}` }));
      return;
    }

    //File listing
    if (parsed.type === "fileIndex") {
      if (Array.isArray(parsed.files)) {
        userFileIndexes.set(nickname, parsed.files);
        console.log(`${nickname} shared ${parsed.files.length} files in index`);
      }
      return;
    }

    if (parsed.type === "listRequest") {
      const targetNick = parsed.target;
      const targetFiles = userFileIndexes.get(targetNick);

      if (!targetFiles || targetFiles.length === 0) {
        ws.send(JSON.stringify({ type: "system", text: `${targetNick} has not shared any files.` }));
        return;
      }

      const visibleFiles = targetFiles.filter(f => {
        const sharedMeta = sharedFiles.get(f.hash);
        if (!sharedMeta) return false;
        return (
          sharedMeta.ownerID === targetNick &&
          (sharedMeta.allowedUserIDs.has(nickname) || targetNick === nickname)
        );
      });

      if (visibleFiles.length === 0) {
        ws.send(JSON.stringify({ type: "system", text: `You don't have access to ${targetNick}'s files.` }));
        return;
      }

      ws.send(JSON.stringify({
        type: "fileList",
        owner: targetNick,
        files: visibleFiles.map(f => ({
          fileName: f.fileName,
          size: f.size || 0,
          hash: f.hash,
        })),
      }));
      return;
    }
    if (parsed.type === "requestDownloadToken") {
      const { fileHash } = parsed;

      //Validate auth
      if (!nickname || !connectedUsers.has(nickname)) {
        ws.send(JSON.stringify({ type: "error", text: "Unauthorized" }));
        return;
      }
      const fileMeta = sharedFiles.get(fileHash);
      if (!fileMeta) {
        ws.send(JSON.stringify({ type: "error", text: "File not found" }));
        return;
      }
      if (!fileMeta.allowedUserIDs || !fileMeta.allowedUserIDs.has(nickname)) {
        ws.send(JSON.stringify({ type: "error", text: "Access denied" }));
        return;
      }
      const token = jwt.sign({ fileHash }, DOWNLOAD_SECRET, { expiresIn: "5m" });

      ws.send(JSON.stringify({
        type: "downloadToken",
        fileHash,
        token,
        uploader: fileMeta.ownerID
      }));

      console.log(`Issued download token for ${nickname} on ${fileHash}`);
      return;
    }

    //Private messages
    if (handlePrivateMessage(connectedUsers, nickname, ws, parsed)) return;

    //Moderation
    if (handleModeration(connectedUsers, nickname, ws, parsed)) return;

    //Public chat
    if (parsed.type === "chat" || parsed.text) {
      const outgoing = JSON.stringify({ type: "message", from: nickname, text: parsed.text });
      broadcast(connectedUsers, outgoing);
    }
  });

  ws.on("close", () => {
    console.log(`${nickname} disconnected`);
    connectedUsers.delete(nickname);
    broadcast(connectedUsers, JSON.stringify({ type: "system", text: `${nickname} left the chat.` }));
  });
});

server.listen(3000, () => {
  console.log("Hub server running at https://localhost:3000");
});
