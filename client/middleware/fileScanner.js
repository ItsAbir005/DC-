// client/middleware/fileScanner.js
import fs from "fs";
import path from "path";
import crypto from "crypto";

function hashFile(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
}

export function walkDirectory(dirPath, basePath) {
  const files = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    
    if (entry.isFile()) {
      try {
        const stats = fs.statSync(fullPath);
        const hash = hashFile(fullPath);
        const relativePath = path.relative(basePath, fullPath);
        
        files.push({
          fileName: entry.name,
          filePath: fullPath,
          relativePath: relativePath,
          hash: hash,
          size: stats.size,
        });
      } catch (err) {
        console.warn(` Failed to process ${fullPath}: ${err.message}`);
      }
    } else if (entry.isDirectory()) {
      // Recursively scan subdirectories
      files.push(...walkDirectory(fullPath, basePath));
    }
  }

  return files;
}