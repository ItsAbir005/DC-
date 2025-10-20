// client/controllers/userController.js
import fs from "fs";
import path from "path";

const USERS_FILE = "./users_keys.json";

// Initialize users file if it doesn't exist
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({}), "utf8");
}

export function registerUserKey(nickname, publicKeyPem) {
  try {
    if (!publicKeyPem || typeof publicKeyPem !== 'string') {
      console.error(`Invalid public key for ${nickname}: not a string`);
      return false;
    }

    if (!publicKeyPem.includes('-----BEGIN PUBLIC KEY-----')) {
      console.error(`Invalid public key format for ${nickname}: missing PEM headers`);
      return false;
    }

    const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    users[nickname] = publicKeyPem;
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
    
    console.log(`✓ Registered public key for ${nickname}`);
    return true;
  } catch (err) {
    console.error(`Failed to register key for ${nickname}:`, err.message);
    return false;
  }
}

export function getUserKey(nickname) {
  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    const key = users[nickname];
    
    if (!key) {
      console.error(`No public key found for ${nickname}`);
      return null;
    }

    if (!key.includes('-----BEGIN PUBLIC KEY-----')) {
      console.error(`Stored key for ${nickname} is not in valid PEM format`);
      return null;
    }

    return key;
  } catch (err) {
    console.error(`Failed to get key for ${nickname}:`, err.message);
    return null;
  }
}

export function listUsers() {
  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    return Object.keys(users);
  } catch (err) {
    console.error("Failed to list users:", err.message);
    return [];
  }
}