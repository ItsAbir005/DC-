// client/uploaderServer.js - ES Module version
import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const CHUNK_SIZE = 64 * 1024; // 64 KB
let uploaderServer = null;

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function startUploaderServer(port = 4000, activeTokens) {
  if (uploaderServer) {
    console.log(`⚠ Uploader server already running on port ${port}`);
    return uploaderServer;
  }

  const wss = new WebSocketServer({ port }, () => {
    console.log(`🚀 Uploader peer server started on ws://localhost:${port}`);
  });

  wss.on("connection", (ws, req) => {
    console.log("🔌 Peer connected:", req?.socket?.remoteAddress || "unknown");

    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", text: "Invalid JSON" }));
        console.error("❌ Invalid JSON from peer");
        return;
      }

      if (!msg.type) {
        ws.send(JSON.stringify({ type: "error", text: "Missing message type" }));
        return;
      }

      // Verify token using the hub's active tokens
      function verifyToken(token, fileHash) {
        const tokenData = activeTokens.get(token);
        if (!tokenData) {
          console.log(`❌ Token not found: ${token}`);
          return null;
        }

        if (tokenData.expires < Date.now()) {
          console.log(`❌ Token expired: ${token}`);
          activeTokens.delete(token);
          return null;
        }

        if (fileHash && tokenData.fileHash !== fileHash) {
          console.log(`❌ Token fileHash mismatch`);
          return null;
        }

        return tokenData;
      }

      // Handle download request
      if (msg.type === "downloadRequest") {
        const { fileHash, token } = msg;
        
        if (!fileHash || !token) {
          ws.send(JSON.stringify({ type: "error", text: "downloadRequest requires fileHash and token" }));
          return;
        }

        const tokenData = verifyToken(token, fileHash);
        if (!tokenData) {
          ws.send(JSON.stringify({ type: "error", text: "Invalid or expired token" }));
          return;
        }

        const encPath = path.join("./downloads", `${fileHash}.enc`);
        if (!fs.existsSync(encPath)) {
          ws.send(JSON.stringify({ type: "error", text: "File not available on uploader" }));
          console.log(`❌ File not found: ${encPath}`);
          return;
        }

        const fileBuffer = fs.readFileSync(encPath);
        const fileSize = fileBuffer.length;
        const totalChunks = Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));
        const expectedChunkHashes = [];

        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min((i + 1) * CHUNK_SIZE, fileSize);
          const chunk = fileBuffer.slice(start, end);
          expectedChunkHashes.push(sha256Hex(chunk));
        }

        const startOffset = typeof msg.startOffset === "number" ? Math.max(0, msg.startOffset) : 0;
        const startChunkIndex = Math.floor(startOffset / CHUNK_SIZE);

        // Send metadata
        ws.send(JSON.stringify({
          type: "fileMetadata",
          fileHash,
          totalChunks,
          expectedChunkHashes,
          startChunkIndex,
          fileSize,
        }));

        console.log(`✅ Sent metadata for ${fileHash} to ${tokenData.user}`);

        // Stream file if requested
        if (msg.stream === true || msg.autoStream) {
          const readStream = fs.createReadStream(encPath, { 
            highWaterMark: CHUNK_SIZE, 
            start: startOffset 
          });
          
          let current = startChunkIndex;
          
          readStream.on("data", (chunk) => {
            ws.send(JSON.stringify({
              type: "fileChunk",
              current: current++,
              total: totalChunks,
              chunk: chunk.toString("base64"),
            }));
          });

          readStream.on("end", () => {
            ws.send(JSON.stringify({ type: "fileComplete", fileHash }));
            console.log(`✅ File transfer complete: ${fileHash}`);
          });

          readStream.on("error", (err) => {
            console.error("❌ Stream error:", err.message);
            ws.send(JSON.stringify({ type: "error", text: "Stream error" }));
          });
        }

        return;
      }

      // Handle chunk request
      if (msg.type === "requestChunk") {
        const { fileHash, chunkIndex, start, end, token } = msg;
        
        if (!fileHash || !token) {
          ws.send(JSON.stringify({ type: "error", text: "requestChunk requires fileHash and token" }));
          return;
        }

        const tokenData = verifyToken(token, fileHash);
        if (!tokenData) {
          ws.send(JSON.stringify({ type: "error", text: "Invalid or expired token" }));
          return;
        }

        const encPath = path.join("./downloads", `${fileHash}.enc`);
        if (!fs.existsSync(encPath)) {
          ws.send(JSON.stringify({ type: "error", text: "File not available" }));
          return;
        }

        const fileSize = fs.statSync(encPath).size;
        let byteStart, byteEnd;

        if (typeof chunkIndex === "number") {
          byteStart = chunkIndex * CHUNK_SIZE;
          byteEnd = Math.min(byteStart + CHUNK_SIZE, fileSize);
        } else if (typeof start === "number") {
          byteStart = Math.max(0, start);
          byteEnd = typeof end === "number" ? Math.min(end, fileSize) : Math.min(byteStart + CHUNK_SIZE, fileSize);
        } else {
          ws.send(JSON.stringify({ type: "error", text: "requestChunk needs chunkIndex or start/end" }));
          return;
        }

        if (byteStart >= fileSize) {
          ws.send(JSON.stringify({ type: "error", text: "Requested start beyond file size" }));
          return;
        }

        try {
          const fd = fs.openSync(encPath, "r");
          const length = byteEnd - byteStart;
          const buffer = Buffer.alloc(length);
          fs.readSync(fd, buffer, 0, length, byteStart);
          fs.closeSync(fd);

          const chunkHash = sha256Hex(buffer);
          const returnedChunkIndex = Math.floor(byteStart / CHUNK_SIZE);

          ws.send(JSON.stringify({
            type: "chunkData",
            fileHash,
            chunkIndex: returnedChunkIndex,
            start: byteStart,
            end: byteEnd,
            chunk: buffer.toString("base64"),
            hash: chunkHash,
          }));
        } catch (err) {
          console.error("❌ Failed to read chunk:", err);
          ws.send(JSON.stringify({ type: "error", text: "Failed to read chunk" }));
        }

        return;
      }

      // Unknown message type
      ws.send(JSON.stringify({ type: "error", text: "Unknown request type" }));
    });

    ws.on("close", () => {
      console.log("🔌 Peer disconnected");
    });

    ws.on("error", (err) => {
      console.error("❌ Peer socket error:", err.message);
    });
  });

  uploaderServer = wss;
  return wss;
}

export function stopUploaderServer() {
  if (uploaderServer) {
    uploaderServer.close(() => {
      console.log("🛑 Uploader server stopped");
    });
    uploaderServer = null;
  }
}

export function isUploaderServerRunning() {
  return uploaderServer !== null;
}