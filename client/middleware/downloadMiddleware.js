//middleware/downloadMiddleware.js
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { verifyDownloadToken } from "./authMiddleware.js";

const CHUNK_SIZE = 4 * 1024 * 1024;

export function handleDownload(peerSocket, { fileHash, token, startOffset = 0 }, baseDir = "./downloads") {
  try {
    const decoded = verifyDownloadToken(token, fileHash);
    console.log(` Token valid for ${decoded.nickname}, resuming from offset ${startOffset}`);

    const filePath = path.join(baseDir, `${fileHash}.enc`);
    if (!fs.existsSync(filePath)) {
      peerSocket.send(JSON.stringify({ type: "error", text: "File not found" }));
      return;
    }

    const stat = fs.statSync(filePath);
    const totalChunks = Math.ceil(stat.size / CHUNK_SIZE);
    let chunkIndex = Math.floor(startOffset / CHUNK_SIZE);

    const expectedChunkHashes = [];
    const hashStream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
    hashStream.on("data", (chunk) => {
      expectedChunkHashes.push(
        crypto.createHash("sha256").update(chunk).digest("hex")
      );
    });

    hashStream.on("end", () => {
      peerSocket.send(
        JSON.stringify({
          type: "fileMetadata",
          totalChunks,
          fileSize: stat.size, // include size
          startChunkIndex: chunkIndex,
          expectedChunkHashes,
        })
      );

      const stream = fs.createReadStream(filePath, { start: startOffset });
      let current = chunkIndex;

      stream.on("data", (chunk) => {
        const hash = crypto.createHash("sha256").update(chunk).digest("hex");

        peerSocket.send(
          JSON.stringify({
            type: "fileChunk",
            current,
            total: totalChunks,
            chunk: chunk.toString("base64"),
            hash,
          })
        );

        current++;
      });

      stream.on("end", () => {
        peerSocket.send(JSON.stringify({ type: "fileComplete" }));
        console.log(" Finished sending file:", filePath);
      });
    });
  } catch (err) {
    console.error(" Download error:", err.message);
    peerSocket.send(JSON.stringify({ type: "error", text: err.message }));
  }
}
