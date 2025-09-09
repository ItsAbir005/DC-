const fs = require("fs");
const crypto = require("crypto");

function decryptAESKey(encryptedKeyBase64, privateKeyPath) {
  const encryptedKey = Buffer.from(encryptedKeyBase64, "base64");
  const privateKeyPem = fs.readFileSync(privateKeyPath, "utf8");
  return crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    },
    encryptedKey
  );
}

async function decryptFile(inputPath, outputPath, aesKey, ivBase64) {
  return new Promise((resolve, reject) => {
    const iv = Buffer.from(ivBase64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);

    const input = fs.createReadStream(inputPath);
    const output = fs.createWriteStream(outputPath);

    input
      .pipe(decipher)
      .pipe(output)
      .on("finish", resolve)
      .on("error", reject);
  });
}

module.exports = { decryptAESKey, decryptFile };
