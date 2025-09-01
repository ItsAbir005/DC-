const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function walkDirectory(dir, basePath, fileList = []) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      walkDirectory(filePath, basePath, fileList);
    } else {
      const fileBuffer = fs.readFileSync(filePath);
      const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

      fileList.push({
        fileName: path.relative(basePath, filePath),
        size: stat.size,
        hash: hash,
      });
    }
  }
  return fileList;
}

module.exports = { walkDirectory };
