//middleware/fileScanner.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function walkDirectory(baseDir, dir) {
  const results = [];
  const list = fs.readdirSync(dir);

  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat && stat.isDirectory()) {
      results.push(...walkDirectory(baseDir, filePath));
    } else {
      const buffer = fs.readFileSync(filePath);
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");

      results.push({
        fileName: path.relative(baseDir, filePath),
        filePath,                                
        size: stat.size,
        hash,
      });
    }
  });

  return results;
}

module.exports = { walkDirectory };
