import WebSocket from "ws";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export function initiatePeerDownload(fileHash, token, uploader, expectedChunkHashes = [], baseDir = "./downloads") {
  console.log(`\n Connecting to ${uploader} for file ${fileHash}...`);
  const peerAddress = "ws://localhost:4000";

  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);
  const filePath = path.join(baseDir, `${fileHash}.enc`);

  let startOffset = 0;
  if (fs.existsSync(filePath)) {
    startOffset = fs.statSync(filePath).size;
    console.log(`⏸ Resuming from offset ${startOffset}`);
  }

  const peerSocket = new WebSocket(peerAddress);
  const writeStream = fs.createWriteStream(filePath, { flags: "a" });

  peerSocket.on("open", () => {
    peerSocket.send(JSON.stringify({ type: "downloadRequest", fileHash, token, startOffset }));
  });

  peerSocket.on("message", (raw) => {
    const data = JSON.parse(raw.toString());

    if (data.type === "fileMetadata") {
      expectedChunkHashes = data.expectedChunkHashes || [];
      console.log(`Expecting ${data.totalChunks} chunks...`);
    }

    if (data.type === "fileChunk") {
      const chunkBuffer = Buffer.from(data.chunk, "base64");
      const hash = crypto.createHash("sha256").update(chunkBuffer).digest("hex");

      if (expectedChunkHashes.length && data.hash !== hash) {
        console.error(` Hash mismatch at chunk ${data.current}`);
        peerSocket.close();
        return;
      }

      writeStream.write(chunkBuffer);
      console.log(` Received chunk ${data.current}/${data.total}`);
    }

    if (data.type === "fileComplete") {
      writeStream.end();
      console.log(` Download complete: ${filePath}`);
      peerSocket.close();
    }

    if (data.type === "error") {
      console.error("Peer error:", data.text);
      peerSocket.close();
    }
  });

  peerSocket.on("close", () => console.log("Peer connection closed"));
  peerSocket.on("error", (err) => console.error("Peer error:", err.message));
}
