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

  console.log("🔌 New connection attempt...");

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
    console.log(`✅ ${currentUser} connected and authenticated`);
  } catch (err) {
    console.log("❌ Invalid token attempt:", err.message);
    await logAudit({
      acting_user_id: "Unknown",
      action_type: "LOGIN_ATTEMPT",
      status: "DENIED",
      details: err.message,
    });
    ws.close();
    return;
  }

  console.log(`🎧 Setting up message handler for ${currentUser}...`);

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Debug: Log all incoming messages
      console.log(`📩 ${currentUser}: ${msg.type}`);

      // Handle public key registration - MUST BE FIRST
      if (msg.type === "registerKey") {
        const { publicKey } = msg;

        console.log(`🔑 Attempting to register key for ${currentUser}`);
        console.log(`   Key preview: ${publicKey?.substring(0, 60)}...`);

        if (!publicKey || !publicKey.includes('-----BEGIN PUBLIC KEY-----')) {
          console.log(`⚠ Invalid public key received from ${currentUser}`);
          ws.send(JSON.stringify({
            type: "error",
            text: "Invalid public key format."
          }));
          return;
        }

        // Use INSERT OR REPLACE to ensure the row exists
        await db.run(
          `INSERT OR REPLACE INTO Users (nickname, public_key) VALUES (?, ?)`,
          [currentUser, publicKey]
        );

        // Verify the update
        const check = await db.get(`SELECT public_key FROM Users WHERE nickname = ?`, [currentUser]);
        console.log(`   Verification: ${check?.public_key ? 'Key stored successfully' : 'FAILED to store key'}`);

        // Broadcast the public key to all connected users
        for (const [nick, userWs] of connectedUsers.entries()) {
          if (nick !== currentUser && userWs.readyState === 1) {
            userWs.send(JSON.stringify({
              type: "userKey",
              nickname: currentUser,
              publicKey: publicKey
            }));
          }
        }

        ws.send(JSON.stringify({
          type: "keyAck",
          text: "Public key registered successfully."
        }));

        console.log(`✓ Public key registered for ${currentUser}`);
        return;
      }

      // Handle file index
      if (msg.type === "fileIndex") {
        console.log(`📁 ${currentUser} shared ${msg.files?.length || 0} files`);
        // File index is just informational for now
        return;
      }

      // Handle file sharing
      // Handle file sharing
      if (msg.type === "shareFile") {
        const { fileHash, fileName, size, iv, encryptedKeys, allowedUsers } = msg;

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

        ws.send(JSON.stringify({
          type: "info",
          text: `File ${fileName} shared successfully with ${allowedUsers.join(', ')}.`
        }));

        // Notify recipients - FIXED VERSION
        for (const recipient of allowedUsers) {
          const recipientWs = connectedUsers.get(recipient);
          if (recipientWs && recipientWs.readyState === 1) {
            recipientWs.send(JSON.stringify({
              type: "fileShared",
              from: currentUser,
              fileName,
              size,
              fileHash,
              encryptedKey: encryptedKeys[recipient], 
              iv: iv
            }));
            console.log(`   ✅ Sent to ${recipient} with encryptedKey and iv`);
          }
        }
        return;
      }

      // Handle download token requests
      if (msg.type === "requestDownloadToken") {
        console.log(`🎯 Processing download request from ${currentUser}`);
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
          ws.send(JSON.stringify({ type: "error", text: "You don't have permission." }));
          return;
        }

        const token = Math.random().toString(36).substring(2, 10);
        activeTokens.set(token, {
          user: currentUser,
          fileHash,
          expires: Date.now() + 5 * 60 * 1000,
        });

        // Send token to downloader
        ws.send(JSON.stringify({
          type: "downloadToken",
          token,
          fileHash,
          uploader: file.owner
        }));

        // Notify the file owner (uploader) about the token
        const uploaderWs = connectedUsers.get(file.owner);
        console.log(`📤 Notifying uploader ${file.owner} about token for ${currentUser}`);

        if (uploaderWs && uploaderWs.readyState === 1) {
          uploaderWs.send(JSON.stringify({
            type: "downloadTokenIssued",
            token,
            fileHash,
            downloader: currentUser,
            expires: Date.now() + 5 * 60 * 1000,
          }));
          console.log(`   ✅ Token notification sent to ${file.owner}`);
        } else {
          console.log(`   ⚠ Cannot notify uploader - not connected or not ready`);
        }

        await logAudit({
          acting_user_id: currentUser,
          file_hash: fileHash,
          action_type: "TOKEN_ISSUED",
          status: "SUCCESS",
          details: "Download token granted.",
        });
        return;
      }

      // Handle download completion
      if (msg.type === "download_complete") {
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

      // Handle access revocation
      if (msg.type === "revokeAccess") {
        const { fileHash, targetUserID } = msg;

        const file = await db.get(`SELECT * FROM Files WHERE file_hash = ?`, [fileHash]);
        if (!file || file.owner !== currentUser) {
          ws.send(JSON.stringify({ type: "error", text: "You are not the owner of this file." }));
          return;
        }

        await db.run(
          `INSERT INTO Revocations (file_hash, revoked_user) VALUES (?, ?)`,
          [fileHash, targetUserID]
        );

        await logAudit({
          acting_user_id: currentUser,
          file_hash: fileHash,
          action_type: "ACCESS_REVOKED",
          status: "SUCCESS",
          details: { revoked_user_id: targetUserID },
        });

        ws.send(JSON.stringify({
          type: "revocationConfirmed",
          text: `Access revoked for ${targetUserID}.`,
          fileHash,
          revokedUser: targetUserID
        }));
        return;
      }

      // Handle audit log requests
      if (msg.type === "get_audit_log") {
        const { fileHash } = msg;

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

      // Handle key rotation
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

      // Handle get users request
      if (msg.type === "getUsers") {
        const users = [];
        for (const [nickname, userWs] of connectedUsers.entries()) {
          if (userWs.readyState === 1) {
            const userInfo = await db.get(`SELECT public_key FROM Users WHERE nickname = ?`, [nickname]);
            const pubKey = userInfo?.public_key;

            // Only include users with valid public keys
            if (pubKey && pubKey !== "unknown" && pubKey.includes('-----BEGIN PUBLIC KEY-----')) {
              users.push({
                id: nickname,
                nickname: nickname,
                publicKey: pubKey
              });
            } else {
              console.log(`⚠ User ${nickname} has no valid public key in database`);
              users.push({
                id: nickname,
                nickname: nickname,
                publicKey: null
              });
            }
          }
        }
        ws.send(JSON.stringify({ type: "userList", users }));
        return;
      }

      // Handle list files request
      if (msg.type === "listRequest") {
        const { target } = msg;
        const files = await db.all(
          `SELECT file_hash, file_name, allowed_users FROM Files WHERE owner = ?`,
          [target]
        );

        const fileList = files.map(f => ({
          hash: f.file_hash,
          fileName: f.file_name,
          size: 0, // Size not stored in DB, would need to be added
        }));

        ws.send(JSON.stringify({
          type: "fileList",
          owner: target,
          files: fileList
        }));
        return;
      }

      // Handle file key request
      if (msg.type === "getFileKey") {
        const { fileHash } = msg;

        const file = await db.get(`SELECT * FROM Files WHERE file_hash = ?`, [fileHash]);
        if (!file) {
          ws.send(JSON.stringify({ type: "error", text: "File not found." }));
          return;
        }

        const allowedUsers = JSON.parse(file.allowed_users || "[]");
        if (!allowedUsers.includes(currentUser)) {
          ws.send(JSON.stringify({ type: "error", text: "You don't have access to this file." }));
          return;
        }

        const encryptedKeys = JSON.parse(file.encrypted_keys || "{}");
        const userKey = encryptedKeys[currentUser];

        if (!userKey) {
          ws.send(JSON.stringify({ type: "error", text: "No key found for your user." }));
          return;
        }

        ws.send(JSON.stringify({
          type: "fileKey",
          fileHash,
          encryptedKey: userKey,
          iv: file.iv
        }));

        await logAudit({
          acting_user_id: currentUser,
          file_hash: fileHash,
          action_type: "KEY_RETRIEVED",
          status: "SUCCESS",
        });
        return;
      }

      // Handle private messages and moderation
      if (handlePrivateMessage(connectedUsers, currentUser, ws, msg)) return;
      if (handleModeration(connectedUsers, currentUser, ws, msg)) return;

      // Handle regular chat messages
      if (msg.type === "message" && msg.text) {
        broadcast(
          connectedUsers,
          JSON.stringify({ type: "chat", from: currentUser, text: msg.text })
        );
        return;
      }

      // Unknown message type
      console.log(`Unknown message type from ${currentUser}:`, msg.type);

    } catch (err) {
      console.error("❌ Message error:", err.message);
      console.error("Stack trace:", err.stack);
      ws.send(JSON.stringify({ type: "error", text: "Server error processing request." }));
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