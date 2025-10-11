import { WebSocketServer } from "ws";
import { broadcast } from "./middleware/broadcast.js";
import { handleModeration } from "./middleware/moderation.js";
import { handlePrivateMessage } from "./middleware/privateMessage.js";
import { initDB } from "./db.js";

const PORT = 8080;
const connectedUsers = new Map();
const db = await initDB();

const wss = new WebSocketServer({ port: PORT });
console.log(`Hub running on ws://localhost:${PORT}`);

wss.on("connection", (ws) => {
  let currentUser = null;

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "register") {
        currentUser = msg.nickname;
        connectedUsers.set(currentUser, ws);
        console.log(` ${currentUser} connected`);
        ws.send(JSON.stringify({ type: "system", text: `Welcome ${currentUser}!` }));
        await db.run(`INSERT OR IGNORE INTO Users (nickname, public_key) VALUES (?, ?)`, [msg.nickname, msg.publicKey]);
        return;
      }

      if (handlePrivateMessage(connectedUsers, currentUser, ws, msg)) return;
      if (handleModeration(connectedUsers, currentUser, ws, msg)) return;

      // Broadcast normal messages
      broadcast(connectedUsers, JSON.stringify({
        type: "chat",
        from: currentUser,
        text: msg.text
      }));

    } catch (err) {
      console.error("Message error:", err);
    }
  });

  ws.on("close", () => {
    if (currentUser) {
      connectedUsers.delete(currentUser);
      broadcast(connectedUsers, JSON.stringify({ type: "system", text: `${currentUser} disconnected.` }));
      console.log(`${currentUser} disconnected`);
    }
  });
});
