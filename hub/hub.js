import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { broadcast } from "./middleware/broadcast.js";
import { handleModeration } from "./middleware/moderation.js";
import { handlePrivateMessage } from "./middleware/privateMessage.js";
import { initDB } from "./db.js";

const PORT = 8080;
const connectedUsers = new Map();
const db = await initDB();

console.log(`Hub running on ws://localhost:${PORT}`);

async function logAudit({ acting_user_id, file_hash = null, action_type, status, details = "" }) {
  try {
    await db.run(
      `INSERT INTO AuditLog (acting_user_id, file_hash, action_type, status, details)
       VALUES (?, ?, ?, ?, ?)`,
      [acting_user_id, file_hash, action_type, status, details]
    );
  } catch (err) {
    console.error("Audit log failed:", err.message);
  }
}

// Active download tokens
const activeTokens = new Map();

// WebSocket connection
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", async (ws, req) => {
  const params = new URLSearchParams(req.url.split("?")[1]);
  const token = params.get("token");
  let currentUser = null;
  try {
    const decoded = jwt.verify(token, "secret123");
    currentUser = decoded.nickname;

    await db.run(
      `INSERT OR IGNORE INTO Users (nickname, public_key) VALUES (?, ?)`,
      [currentUser, decoded.publicKey || "unknown"]
    );

    await logAudit({
      acting_user_id: currentUser,
      action_type: "LOGIN",
      status: "SUCCESS",
    });

    connectedUsers.set(currentUser, ws);
    console.log(` ${currentUser} connected`);
    ws.send(JSON.stringify({ type: "system", text: `Welcome ${currentUser}!` }));
  } catch (err) {
    console.log(" Invalid token attempt:", err.message);
    await logAudit({
      acting_user_id: "Unknown",
      action_type: "LOGIN_ATTEMPT",
      status: "DENIED",
      details: err.message,
    });
    ws.close();
    return;
  }

  // Handle messages
  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "requestDownloadToken") {
        const { fileHash, uploader } = msg;

        const file = await db.get(`SELECT * FROM Files WHERE file_hash = ?`, [fileHash]);
        if (!file) {
          await logAudit({
            acting_user_id: currentUser,
            file_hash: fileHash,
            action_type: "TOKEN_REQUESTED",
            status: "DENIED",
            details: "File not found.",
          });
          ws.send(JSON.stringify({ type: "error", text: "File not found." }));
          return;
        }

        const allowedUsers = JSON.parse(file.allowed_users || "[]");
        const revoked = await db.get(
          `SELECT * FROM Revocations WHERE file_hash = ? AND revoked_user = ?`,
          [fileHash, currentUser]
        );

        if (revoked) {
          await logAudit({
            acting_user_id: currentUser,
            file_hash: fileHash,
            action_type: "TOKEN_REQUESTED",
            status: "DENIED",
            details: "Access revoked.",
          });
          ws.send(JSON.stringify({ type: "error", text: "Access revoked for this file." }));
          return;
        }

        if (!allowedUsers.includes(currentUser)) {
          await logAudit({
            acting_user_id: currentUser,
            file_hash: fileHash,
            action_type: "TOKEN_REQUESTED",
            status: "DENIED",
            details: "Permission denied.",
          });
          ws.send(JSON.stringify({ type: "error", text: "You don’t have permission." }));
          return;
        }
        const token = Math.random().toString(36).substring(2, 10);
        activeTokens.set(token, {
          user: currentUser,
          fileHash,
          expires: Date.now() + 5 * 60 * 1000, // 5 minutes
        });

        ws.send(
          JSON.stringify({
            type: "downloadToken",
            token,
            fileHash,
            uploader,
          })
        );

        await logAudit({
          acting_user_id: currentUser,
          file_hash: fileHash,
          action_type: "TOKEN_ISSUED",
          status: "SUCCESS",
          details: "Download token granted.",
        });

        return;
      }

      // Other middleware handlers
      if (handlePrivateMessage(connectedUsers, currentUser, ws, msg)) return;
      if (handleModeration(connectedUsers, currentUser, ws, msg)) return;

      // Normal chat
      broadcast(
        connectedUsers,
        JSON.stringify({
          type: "chat",
          from: currentUser,
          text: msg.text,
        })
      );
    } catch (err) {
      console.error("Message error:", err.message);
    }
  });

  // Disconnect
  ws.on("close", () => {
    if (currentUser) {
      connectedUsers.delete(currentUser);
      broadcast(
        connectedUsers,
        JSON.stringify({
          type: "system",
          text: `${currentUser} disconnected.`,
        })
      );
      console.log(`🔌 ${currentUser} disconnected`);
    }
  });
});
