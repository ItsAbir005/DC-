const fs = require("fs");
const { walkDirectory } = require("../middleware/fileScanner");

function generateSharedIndex(folderPath) {
  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    throw new Error("Invalid folder path");
  }

  console.log("📂 Scanning folder:", folderPath);
  const index = walkDirectory(folderPath, folderPath);

  fs.writeFileSync("shared_index.json", JSON.stringify(index, null, 2));
  console.log("✅ Shared index created! Saved as shared_index.json");

  return index;
}

module.exports = { generateSharedIndex };
