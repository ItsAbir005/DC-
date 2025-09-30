// uploader_server.js
const fs = require("fs");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const path = require("path");
const crypto = require("crypto");

const PORT = 4000;
const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || "download_secret_dev";
const CHUNK_SIZE = 64 * 1024; // 64 KB
const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log(`Uploader peer server listening ws://localhost:${PORT}`);
});

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
wss.on("connection", (ws, req) => {
  console.log("Peer connected:", (req && req.socket && req.socket.remoteAddress) || "");

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", text: "Invalid JSON" }));
      console.error("Invalid JSON from peer; ignoring");
      return;
    }

    // All messages must include { type, fileHash, token } except some admin messages
    if (!msg.type) {
      ws.send(JSON.stringify({ type: "error", text: "Missing message type" }));
      return;
    }
    function verifyTokenOrSendError(token, fileHash) {
      try {
        const decoded = jwt.verify(token, DOWNLOAD_SECRET);
        if (fileHash && decoded.fileHash && decoded.fileHash !== fileHash) {
          ws.send(JSON.stringify({ type: "error", text: "Token fileHash mismatch" }));
          return null;
        }
        return decoded;
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", text: "Invalid or expired token" }));
        return null;
      }
    }
    if (msg.type === "downloadRequest") {
      // downloadRequest returns metadata and optionally streams from a startOffset to the end.
      const { fileHash, token } = msg;
      if (!fileHash || !token) {
        ws.send(JSON.stringify({ type: "error", text: "downloadRequest requires fileHash and token" }));
        return;
      }

      const decoded = verifyTokenOrSendError(token, fileHash);
      if (!decoded) return;

      const encPath = path.join(__dirname, "downloads", `${fileHash}.enc`);
      if (!fs.existsSync(encPath)) {
        ws.send(JSON.stringify({ type: "error", text: "File not available on uploader" }));
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

      // send metadata
      ws.send(JSON.stringify({
        type: "fileMetadata",
        fileHash,
        totalChunks,
        expectedChunkHashes,
        startChunkIndex,
        fileSize,
      }));

      // If caller requested a streaming resume (legacy behaviour), stream from startOffset -> EOF.
      if (msg.stream === true || msg.autoStream) {
        // Use createReadStream with start option so we do not buffer huge files twice
        const readStream = fs.createReadStream(encPath, { highWaterMark: CHUNK_SIZE, start: startOffset });
        let current = startChunkIndex;
        readStream.on("data", (chunk) => {
          current++;
          ws.send(JSON.stringify({
            type: "fileChunk",
            current,
            total: totalChunks,
            chunk: chunk.toString("base64"),
          }));
        });
        readStream.on("end", () => {
          ws.send(JSON.stringify({ type: "fileComplete", fileHash }));
        });
        readStream.on("error", (err) => {
          console.error("Stream error:", err.message);
          ws.send(JSON.stringify({ type: "error", text: "Stream error" }));
        });
      }

      return;
    }
    //chunk request
    if (msg.type === "requestChunk") {
      const { fileHash, chunkIndex, start, end, token } = msg;
      if (!fileHash || !token) {
        ws.send(JSON.stringify({ type: "error", text: "requestChunk requires fileHash and token" }));
        return;
      }
      const decoded = verifyTokenOrSendError(token, fileHash);
      if (!decoded) return;

      const encPath = path.join(__dirname, "downloads", `${fileHash}.enc`);
      if (!fs.existsSync(encPath)) {
        ws.send(JSON.stringify({ type: "error", text: "File not available on uploader" }));
        return;
      }

      const fileSize = fs.statSync(encPath).size;

      // Determine byte range
      let byteStart, byteEnd; // inclusive start, exclusive end
      if (typeof chunkIndex === "number") {
        // chunkIndex requested
        byteStart = chunkIndex * CHUNK_SIZE;
        byteEnd = Math.min(byteStart + CHUNK_SIZE, fileSize);
      } else if (typeof start === "number") {
        // byte-range requested
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

        // Determine returned chunkIndex if caller asked by byte range
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
        console.error("Failed to read chunk:", err);
        ws.send(JSON.stringify({ type: "error", text: "Failed to read chunk" }));
      }

      return;
    }
    // Unknown message type
    ws.send(JSON.stringify({ type: "error", text: "Unknown request type" }));
  });

  ws.on("close", () => {
    console.log("Peer disconnected");
  });

  ws.on("error", (err) => {
    console.error("Peer socket error:", err.message);
  });
});
