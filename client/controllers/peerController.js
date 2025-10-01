import WebSocket from "ws";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export function initiatePeerDownload(
  fileHash,
  token,
  uploader,
  expectedChunkHashes = [],
  baseDir = "./downloads"
) {
  console.log(`\n Connecting to ${uploader} for file ${fileHash}...`);
  const peerAddress = "ws://localhost:4000";

  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  const filePath = path.join(baseDir, `${fileHash}.enc`);

  let startOffset = 0;
  if (fs.existsSync(filePath)) {
    startOffset = fs.statSync(filePath).size;
    console.log(` Resuming from offset ${startOffset}`);
  }

  const peerSocket = new WebSocket(peerAddress);
  const writeStream = fs.createWriteStream(filePath, { flags: "a" });

  let totalChunks = 0;
  let receivedChunks = 0;

  peerSocket.on("open", () => {
    peerSocket.send(
      JSON.stringify({ type: "downloadRequest", fileHash, token, startOffset })
    );
  });

  peerSocket.on("message", async (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      console.error("Non-JSON message received");
      return;
    }

    if (data.type === "fileMetadata") {
      expectedChunkHashes = data.expectedChunkHashes || [];
      totalChunks = data.totalChunks;
      console.log(`Expecting ${totalChunks} chunks...`);
    }

    if (data.type === "fileChunk") {
      const chunkBuffer = Buffer.from(data.chunk, "base64"); // fallback
      const hash = crypto.createHash("sha256").update(chunkBuffer).digest("hex");

      if (expectedChunkHashes.length && data.hash !== hash) {
        console.error(` Hash mismatch at chunk ${data.current}`);
        peerSocket.close();
        return;
      }

      // backpressure handling
      if (!writeStream.write(chunkBuffer)) {
        peerSocket.pause();
        writeStream.once("drain", () => peerSocket.resume());
      }

      receivedChunks++;
      console.log(` Received chunk ${data.current}/${data.total}`);

      // send ack to uploader
      peerSocket.send(JSON.stringify({ type: "chunkAck", index: data.current }));
    }

    if (data.type === "fileComplete") {
      writeStream.end(async () => {
        console.log(` Download complete: ${filePath}`);

        // Final verification
        try {
          const fileBuf = fs.readFileSync(filePath);
          const finalHash = crypto
            .createHash("sha256")
            .update(fileBuf)
            .digest("hex");

          if (finalHash === fileHash) {
            console.log(` File verified successfully `);
          } else {
            console.error("Final file hash mismatch!");
          }
        } catch (err) {
          console.error(" Error verifying file:", err.message);
        }

        peerSocket.close();
      });
    }

    if (data.type === "error") {
      console.error("Peer error:", data.text);
      writeStream.end();
      peerSocket.close();
    }
  });

  peerSocket.on("close", () =>
    console.log(" Peer connection closed")
  );
  peerSocket.on("error", (err) =>
    console.error("Peer error:", err.message)
  );
}
