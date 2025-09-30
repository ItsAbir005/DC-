import fs from "fs";
import path from "path";
import crypto from "crypto";
import { verifyDownloadToken } from "./authMiddleware.js";

export function handleDownload(peerSocket, { fileHash, token, startOffset = 0 }, baseDir = "./downloads") {
  try {
    const decoded = verifyDownloadToken(token, fileHash);
    console.log(` Token valid for ${decoded.nickname}, resuming from ${startOffset}`);

    const filePath = path.join(baseDir, `${fileHash}.enc`);
    if (!fs.existsSync(filePath)) {
      peerSocket.send(JSON.stringify({ type: "error", text: "File not found" }));
      return;
    }

    const stat = fs.statSync(filePath);
    const totalChunks = Math.ceil(stat.size / (4 * 1024 * 1024));
    let chunkIndex = Math.floor(startOffset / (4 * 1024 * 1024));

    peerSocket.send(JSON.stringify({
      type: "fileMetadata",
      totalChunks,
      startChunkIndex: chunkIndex,
    }));

    const stream = fs.createReadStream(filePath, { start: startOffset });
    let current = chunkIndex + 1;

    stream.on("data", (chunk) => {
      const hash = crypto.createHash("sha256").update(chunk).digest("hex");
      peerSocket.send(JSON.stringify({
        type: "fileChunk",
        current,
        total: totalChunks,
        chunk: chunk.toString("base64"),
        hash,
      }));
      current++;
    });

    stream.on("end", () => {
      peerSocket.send(JSON.stringify({ type: "fileComplete" }));
      console.log(" Finished sending file:", filePath);
    });

  } catch (err) {
    console.error("Download error:", err.message);
    peerSocket.send(JSON.stringify({ type: "error", text: err.message }));
  }
}
