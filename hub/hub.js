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

  // Send welcome message
  ws.send(JSON.stringify({ type: "system", text: `Welcome ${nickname}! Connected securely over WSS.` }));

  // Broadcast join message
  broadcast(connectedUsers, JSON.stringify({ type: "system", text: `${nickname} joined the chat.` }), ws);

  ws.on("message", (msgBuffer) => {
    let parsed;
    try {
      parsed = JSON.parse(msgBuffer.toString());
    } catch {
      console.log(`[${nickname}] sent invalid JSON`);
      return;
    }

    console.log(`[${nickname}] says: ${parsed.text}`);

    // Private messages
    if (handlePrivateMessage(connectedUsers, nickname, ws, parsed)) return;

    // Moderation commands
    if (handleModeration(connectedUsers, nickname, ws, parsed)) return;

    // Public broadcast
    const outgoing = JSON.stringify({
      type: "message",
      from: nickname,
      text: parsed.text,
    });
    broadcast(connectedUsers, outgoing);
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
