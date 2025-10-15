//hub/hub.js
import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { broadcast } from "./middleware/broadcast.js";
import { handleModeration } from "./middleware/moderation.js";
import { handlePrivateMessage } from "./middleware/privateMessage.js";
import { initDB } from "./db.js";

const PORT = 8080;
const connectedUsers = new Map();
const db = await initDB();

export async function logPeerConnectionAttempt(uploader, downloader) {
  await logAudit({
    acting_user_id: uploader,
    action_type: "PEER_CONNECT_ATTEMPT",
    status: "PENDING",
    details: { downloader }
  });
}

export async function logPeerVerificationFailure(uploader, downloader, reason) {
  await logAudit({
    acting_user_id: uploader,
    action_type: "PEER_CONNECT_ATTEMPT",
    status: "DENIED",
    details: { downloader, reason }
  });
}

console.log(`Hub running on ws://localhost:${PORT}`);

//  Centralized Audit Logger
async function logAudit({ acting_user_id, file_hash = null, action_type, status, details = "" }) {
  try {
    await db.run(
      `INSERT INTO AuditLog (acting_user_id, file_hash, action_type, status, details)
       VALUES (?, ?, ?, ?, ?)`,
      [acting_user_id, file_hash, action_type, status, JSON.stringify(details)]
    );
  } catch (err) {
    console.error("Audit log failed:", err.message);
  }
}

const activeTokens = new Map();

//  WebSocket Server
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", async (ws, req) => {
  const params = new URLSearchParams(req.url.split("?")[1]);
  const token = params.get("token");
  let currentUser = null;

  //  Authentication
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
    ws.send(JSON.stringify({ type: "system", text: `Welcome ${currentUser}!` }));
    console.log(`${currentUser} connected`);
  } catch (err) {
    console.log("Invalid token attempt:", err.message);
    await logAudit({
      acting_user_id: "Unknown",
      action_type: "LOGIN_ATTEMPT",
      status: "DENIED",
      details: err.message,
    });
    ws.close();
    return;
  }

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "shareFile") {
        const { fileHash, fileName, iv, encryptedKeys, allowedUsers } = msg;

        await db.run(
          `INSERT OR REPLACE INTO Files (file_hash, owner, file_name, iv, encrypted_keys, allowed_users)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [fileHash, currentUser, fileName, iv, JSON.stringify(encryptedKeys), JSON.stringify(allowedUsers)]
        );

        await logAudit({
          acting_user_id: currentUser,
          file_hash: fileHash,
          action_type: "FILE_SHARED",
          status: "SUCCESS",
          details: { fileName, allowedUsers },
        });

        ws.send(JSON.stringify({ type: "system", text: `File ${fileName} shared successfully.` }));
        return;
      }

      if (msg.text && msg.text.startsWith("!share")) {
        const [_, fileHash, ...allowedUsers] = msg.text.split(" ");
        const allowedList = allowedUsers.join(",") || "";

        // Check if file already exists
        const existing = await db.get(`SELECT file_hash FROM Files WHERE file_hash = ?`, [fileHash]);
        if (!existing) {
          await db.run(
            `INSERT INTO Files (file_hash, owner, file_name, iv, encrypted_keys, allowed_users)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [
              fileHash,
              currentUser,
              "Unknown", // Or pass actual filename if available
              "iv_placeholder",
              "encrypted_keys_placeholder",
              allowedList
            ]
          );
        }

        // Log the event
        await db.run(
          `INSERT INTO AuditLog (acting_user_id, file_hash, action_type, status, details)
     VALUES (?, ?, 'FILE_SHARED', 'SUCCESS', ?)`,
          [currentUser, fileHash, JSON.stringify({ shared_with: allowedList })]
        );

        ws.send(JSON.stringify({
          type: "info",
          text: `File shared successfully and logged for ${fileHash}`
        }));
        return true;
      }


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
          expires: Date.now() + 5 * 60 * 1000,
        });

        ws.send(JSON.stringify({ type: "downloadToken", token, fileHash, uploader }));

        await logAudit({
          acting_user_id: currentUser,
          file_hash: fileHash,
          action_type: "TOKEN_ISSUED",
          status: "SUCCESS",
          details: "Download token granted.",
        });
        return;
      }
      if (msg.type === "!download_complete") {
        const { fileHash } = msg;
        await logAudit({
          acting_user_id: currentUser,
          file_hash: fileHash,
          action_type: "DOWNLOAD_COMPLETE",
          status: "SUCCESS",
          details: "Downloader verified and assembled file successfully."
        });

        ws.send(JSON.stringify({ type: "system", text: "Download completion logged." }));
        return;
      }

      if (msg.type === "revokeAccess") {
        const { fileHash, targetUser } = msg;

        const file = await db.get(`SELECT * FROM Files WHERE file_hash = ?`, [fileHash]);
        if (!file || file.owner !== currentUser) {
          ws.send(JSON.stringify({ type: "error", text: "You are not the owner of this file." }));
          return;
        }

        await db.run(
          `INSERT INTO Revocations (file_hash, revoked_user) VALUES (?, ?)`,
          [fileHash, targetUser]
        );

        await logAudit({
          acting_user_id: currentUser,
          file_hash: fileHash,
          action_type: "ACCESS_REVOKED",
          status: "SUCCESS",
          details: { revoked_user_id: targetUser },
        });

        ws.send(JSON.stringify({ type: "system", text: `Access revoked for ${targetUser}.` }));
        return;
      }

      if (msg.text && msg.text.startsWith("!get_audit_log")) {
        const [_, fileHash] = msg.text.split(" ");
        const file = await db.get(`SELECT * FROM Files WHERE file_hash = ?`, [fileHash]);

        if (!file) {
          ws.send(JSON.stringify({ type: "error", text: "File not found." }));
          return;
        }

        if (file.owner !== currentUser) {
          ws.send(JSON.stringify({ type: "error", text: "Access denied. Only owner can view audit log." }));
          return;
        }

        const logs = await db.all(
          `SELECT timestamp, acting_user_id, action_type, status, details 
     FROM AuditLog WHERE file_hash = ? ORDER BY timestamp DESC`,
          [fileHash]
        );

        ws.send(JSON.stringify({
          type: "auditLog",
          fileHash,
          logs
        }));
        return;
      }

      if (msg.type === "updateFileKeys") {
        const { fileHash, newIV, newEncryptedKeys } = msg;

        const file = await db.get(`SELECT * FROM Files WHERE file_hash = ?`, [fileHash]);
        if (!file || file.owner !== currentUser) {
          ws.send(JSON.stringify({ type: "error", text: "Only owner can rotate keys." }));
          return;
        }

        await db.run(
          `UPDATE Files SET iv = ?, encrypted_keys = ? WHERE file_hash = ?`,
          [newIV, JSON.stringify(newEncryptedKeys), fileHash]
        );

        await logAudit({
          acting_user_id: currentUser,
          file_hash: fileHash,
          action_type: "KEY_ROTATED",
          status: "SUCCESS",
          details: { newIV },
        });

        ws.send(JSON.stringify({ type: "system", text: "Key rotation successful." }));
        return;
      }

      if (handlePrivateMessage(connectedUsers, currentUser, ws, msg)) return;
      if (handleModeration(connectedUsers, currentUser, ws, msg)) return;

      broadcast(
        connectedUsers,
        JSON.stringify({ type: "chat", from: currentUser, text: msg.text })
      );
    } catch (err) {
      console.error("Message error:", err.message);
    }
  });

  //  Disconnect
  ws.on("close", () => {
    if (currentUser) {
      connectedUsers.delete(currentUser);
      broadcast(
        connectedUsers,
        JSON.stringify({ type: "system", text: `${currentUser} disconnected.` })
      );
      console.log(` ${currentUser} disconnected`);
    }
  });
});
