const fs = require("fs");
const https = require("https");
const express = require("express");
const { WebSocketServer } = require("ws");
const url = require("url");
const { verifyToken } = require("./middleware/auth");
const selfsigned = require("selfsigned");
const app = express();
// Check for existing SSL certs, if not found generate self-signed certs
if (!fs.existsSync("key.pem") || !fs.existsSync("cert.pem")) {
  console.log(" No SSL certs found. Generating self-signed certificate...");
  const attrs = [{ name: "commonName", value: "localhost" }];
  const pems = selfsigned.generate(attrs, { days: 365 });

  fs.writeFileSync("key.pem", pems.private);
  fs.writeFileSync("cert.pem", pems.cert);

  console.log("key.pem and cert.pem generated!");
}
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
    ws.send(" Invalid or missing token. Closing connection.");
    ws.close();
    return;
  }

  const nickname = payload.nickname;
  console.log(`${nickname} connected`);
  connectedUsers.set(nickname, ws);

  ws.send(`Welcome ${nickname}! Connected securely over WSS.`);

  ws.on("message", (msg) => {
    console.log(`[${nickname}] says: ${msg}`);
    for (let [user, clientWs] of connectedUsers) {
      if (clientWs.readyState === ws.OPEN) {
        clientWs.send(`${nickname}: ${msg}`);
      }
    }
  });

  ws.on("close", () => {
    console.log(` ${nickname} disconnected`);
    connectedUsers.delete(nickname);
  });
});
server.listen(3000, () => {
  console.log("Hub server running at https://localhost:3000");
});