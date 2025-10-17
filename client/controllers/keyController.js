// controllers/keyController.js
import crypto from "crypto";
import fs from "fs";
import path from "path";

const KEY_DIR = "./keys";
const PRIVATE_KEY_PATH = path.join(KEY_DIR, "private.pem");
const PUBLIC_KEY_PATH = path.join(KEY_DIR, "public.pem");

export function ensureKeyPair() {
  // Create keys directory if it doesn't exist
  if (!fs.existsSync(KEY_DIR)) {
    fs.mkdirSync(KEY_DIR, { recursive: true });
  }

  // Check if keys already exist
  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
    const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
    const publicKey = fs.readFileSync(PUBLIC_KEY_PATH, "utf8");
    
    console.log("✓ Loaded existing RSA key pair");
    return { privateKey, publicKey };
  }

  // Generate new RSA key pair
  console.log("⚙ Generating new RSA key pair...");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  // Save keys to disk
  fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, "utf8");
  fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, "utf8");

  console.log("✓ Generated and saved new RSA key pair");
  console.log(`  Private key: ${PRIVATE_KEY_PATH}`);
  console.log(`  Public key: ${PUBLIC_KEY_PATH}`);

  return { privateKey, publicKey };
}

export function getPrivateKey() {
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    throw new Error("Private key not found. Run ensureKeyPair() first.");
  }
  return fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
}

export function getPublicKey() {
  if (!fs.existsSync(PUBLIC_KEY_PATH)) {
    throw new Error("Public key not found. Run ensureKeyPair() first.");
  }
  return fs.readFileSync(PUBLIC_KEY_PATH, "utf8");
}