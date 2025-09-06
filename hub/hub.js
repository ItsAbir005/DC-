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

// In-memory store for connected users
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
  console.log(` ${nickname} connected`);
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
    if (parsed.type === "registerKey") {
      const { from, publicKey } = parsed;
      userPublicKeys.set(from, publicKey);

      console.log(`Stored public key for ${from}`);

      ws.send(JSON.stringify({
        type: "keyAck",
        text: `Public key registered for ${from}`
      }));
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
      ws.send(JSON.stringify({
        type: "shareAck",
        fileHash,
        userIDs,
      }));

      return;
    }
    if (parsed.type === "getUsers") {
      const users = [...connectedUsers.keys()].map((nick, i) => ({
        id: `u${i + 1}`,
        nickname: nick,
      }));

      ws.send(JSON.stringify({ type: "userList", users }));
      return;
    }
    // Handle fileIndex from client
    if (parsed.type === "fileIndex") {
      if (Array.isArray(parsed.files)) {
        userFileIndexes.set(nickname, parsed.files);
        console.log(`${nickname} shared ${parsed.files.length} files in index`);
      }
      return;
    }

    // Handle listRequest from client
    if (parsed.type === "listRequest") {
      const targetNick = parsed.target;
      const targetFiles = userFileIndexes.get(targetNick);

      if (!targetFiles || targetFiles.length === 0) {
        ws.send(JSON.stringify({
          type: "system",
          text: `${targetNick} has not shared any files.`,
        }));
        return;
      }

      // Filter only files the requester is allowed to see
      const visibleFiles = targetFiles.filter(f => {
        const sharedMeta = sharedFiles.get(f.hash);
        if (!sharedMeta) return false;
        return (
          sharedMeta.ownerID === targetNick &&
          (sharedMeta.allowedUserIDs.has(nickname) || targetNick === nickname)
        );
      });

      if (visibleFiles.length === 0) {
        ws.send(JSON.stringify({
          type: "system",
          text: `You don't have access to ${targetNick}'s files.`,
        }));
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
    // Private messages
    if (handlePrivateMessage(connectedUsers, nickname, ws, parsed)) return;

    // Moderation commands
    if (handleModeration(connectedUsers, nickname, ws, parsed)) return;

    // Public broadcast (chat)
    if (parsed.type === "chat" || parsed.text) {
      const outgoing = JSON.stringify({
        type: "message",
        from: nickname,
        text: parsed.text,
      });
      broadcast(connectedUsers, outgoing);
    }
  });

  ws.on("close", () => {
    console.log(`${nickname} disconnected`);
    connectedUsers.delete(nickname);
    broadcast(
      connectedUsers,
      JSON.stringify({ type: "system", text: `${nickname} left the chat.` })
    );
  });
});

server.listen(3000, () => {
  console.log(" Hub server running at https://localhost:3000");
});