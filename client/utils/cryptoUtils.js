const crypto = require("crypto");
function generateAESKey() {
  return {
    key: crypto.randomBytes(32),
    iv: crypto.randomBytes(16),
  };
}
function encryptAESKeyForRecipient(publicKeyPem, aesKey) {
  return crypto.publicEncrypt(publicKeyPem, aesKey).toString("base64");
}
function decryptAESKeyWithPrivate(privateKeyPem, encryptedKey) {
  return crypto.privateDecrypt(privateKeyPem, Buffer.from(encryptedKey, "base64"));
}

module.exports = { generateAESKey, encryptAESKeyForRecipient, decryptAESKeyWithPrivate };
