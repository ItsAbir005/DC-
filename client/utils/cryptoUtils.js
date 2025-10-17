// utils/cryptoUtils.js
import crypto from "crypto";

export function generateAESKey() {
  const key = crypto.randomBytes(32); // 256-bit key for AES-256
  const iv = crypto.randomBytes(16);  // 128-bit IV
  return { key, iv };
}

export function encryptAESKeyForRecipient(publicKeyPem, aesKey) {
  try {
    // Ensure the public key is in correct format
    if (!publicKeyPem || typeof publicKeyPem !== 'string') {
      throw new Error('Invalid public key: must be a non-empty string');
    }

    // Check if it's already in PEM format
    if (!publicKeyPem.includes('-----BEGIN')) {
      throw new Error('Invalid public key format: must be PEM format');
    }

    // Encrypt the AES key using RSA-OAEP
    const encrypted = crypto.publicEncrypt(
      {
        key: publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      aesKey
    );

    return encrypted.toString("base64");
  } catch (err) {
    console.error("Encryption error:", err.message);
    throw new Error(`Failed to encrypt AES key: ${err.message}`);
  }
}

export function decryptAESKey(privateKeyPem, encryptedAESKey) {
  try {
    if (!privateKeyPem || typeof privateKeyPem !== 'string') {
      throw new Error('Invalid private key: must be a non-empty string');
    }

    if (!encryptedAESKey || typeof encryptedAESKey !== 'string') {
      throw new Error('Invalid encrypted key: must be a non-empty string');
    }

    const decrypted = crypto.privateDecrypt(
      {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(encryptedAESKey, "base64")
    );

    return decrypted;
  } catch (err) {
    console.error("Decryption error:", err.message);
    throw new Error(`Failed to decrypt AES key: ${err.message}`);
  }
}

export function encryptFile(filePath, outputPath, aesKey, iv) {
  return new Promise((resolve, reject) => {
    const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
    const input = fs.createReadStream(filePath);
    const output = fs.createWriteStream(outputPath);

    input
      .pipe(cipher)
      .pipe(output)
      .on("finish", () => resolve())
      .on("error", (err) => reject(err));
  });
}

export function decryptFile(encryptedPath, outputPath, aesKey, iv) {
  return new Promise((resolve, reject) => {
    const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);
    const input = fs.createReadStream(encryptedPath);
    const output = fs.createWriteStream(outputPath);

    input
      .pipe(decipher)
      .pipe(output)
      .on("finish", () => resolve())
      .on("error", (err) => reject(err));
  });
}