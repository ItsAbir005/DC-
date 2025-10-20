// client/controllers/shareController.js
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { walkDirectory } from "../middleware/fileScanner.js";

const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB

function hashBuffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function computeChunkHashes(filePath) {
  const stats = fs.statSync(filePath);
  const total = stats.size;
  const hashes = [];
  const fd = fs.openSync(filePath, "r");
  try {
    let offset = 0;
    while (offset < total) {
      const length = Math.min(CHUNK_SIZE, total - offset);
      const buffer = Buffer.alloc(length);
      const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
      if (bytesRead === 0) break;
      hashes.push(hashBuffer(buffer.slice(0, bytesRead)));
      offset += bytesRead;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { chunkHashes: hashes, chunkSize: CHUNK_SIZE, chunks: hashes.length, size: stats.size };
}

export function generateSharedIndex(folderPath) {
  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    throw new Error("Invalid folder path");
  }

  console.log(" Scanning folder:", folderPath);
  const files = walkDirectory(folderPath, folderPath); // expecting { fileName, filePath, hash, size } entries

  // For each file compute chunk hashes
  const index = files.map(f => {
    try {
      const meta = computeChunkHashes(f.filePath);
      return {
        fileName: f.fileName,
        filePath: f.filePath,
        hash: f.hash,
        size: meta.size,
        chunkSize: meta.chunkSize,
        chunks: meta.chunks,
        chunkHashes: meta.chunkHashes
      };
    } catch (err) {
      console.warn(` Failed to compute chunks for ${f.filePath}: ${err.message}`);
      return {
        fileName: f.fileName,
        filePath: f.filePath,
        hash: f.hash,
        size: f.size || 0,
        chunkSize: CHUNK_SIZE,
        chunks: 0,
        chunkHashes: []
      };
    }
  });

  fs.writeFileSync("shared_index.json", JSON.stringify(index, null, 2));
  console.log(" Shared index created -> shared_index.json");

  return index;
}