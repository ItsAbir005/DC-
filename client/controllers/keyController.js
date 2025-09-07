const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function ensureKeyPair() {
  const privateKeyPath = path.join(__dirname, "../.private-key.pem");
  const publicKeyPath = path.join(__dirname, "../.public-key.pem");

  if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    return {
      privateKey: fs.readFileSync(privateKeyPath, "utf8"),
      publicKey: fs.readFileSync(publicKeyPath, "utf8"),
    };
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(publicKeyPath, publicKey);

  return { privateKey, publicKey };
}

module.exports = { ensureKeyPair };
