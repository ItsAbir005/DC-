const readlineSync = require("readline-sync");
const jwt = require("jsonwebtoken");
const WebSocket = require("ws");
let nickname = readlineSync.question("Enter your nickname: ").trim();
console.log("Nickname entered:", `"${nickname}"`);
if (!nickname) {
  console.error("No nickname entered. Please run again and type something.");
  process.exit(1);
}
const secretKey = "secret123";
const token = jwt.sign({ nickname: nickname }, secretKey, { expiresIn: "1h" });
console.log("Generated JWT:", token);
const ws = new WebSocket(`wss://localhost:3000/?token=${token}`, {
  rejectUnauthorized: false,
});
ws.on("open", () => {
  console.log("Connected to server as", nickname);
  ws.send(`Hello, I'm ${nickname}`);
});
ws.on("message", (msg) => {
    console.log("Received:", msg.toLocaleString());
});
ws.on("close", () => {
  console.log("Disconnected from server");
});
ws.on("error", (error) => {
  console.error("WebSocket error:", error);
});