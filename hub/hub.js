const fs = require("fs");
const https = require("https");
const express = require("express");
const { WebSocketServer } = require("ws");
const jwt = require("jsonwebtoken");
const selfsigned = require("selfsigned");
const app = express();
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
//wss server 
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log(" Client connected");

  ws.on("message", (msg) => {
    console.log(" Received:", msg.toString());

    try {
      const decoded = jwt.verify(msg.toString(), "secret123");
      ws.send("Token valid: " + JSON.stringify(decoded));
    } catch {
      ws.send(" Invalid token");
    }
  });

  ws.send("Welcome to Secure WSS!");
});
const port = 3000;
app.listen(port, () => {
  console.log(`Hub server running at http://localhost:${port}`);
});