// client.js
const readline = require("readline");
const jwt = require("jsonwebtoken");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { generateSharedIndex } = require("./controllers/shareController");
const { ensureKeyPair } = require("./controllers/keyController");
const { registerUserKey, getUserKey } = require("./controllers/userController");
const { generateAESKey, encryptAESKeyForRecipient } = require("./utils/cryptoUtils");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("Enter your nickname: ", (nicknameRaw) => {
  const nickname = nicknameRaw.trim();
  if (!nickname) {
    console.error("No nickname entered. Please run again.");
    process.exit(1);
  }

  rl.question("Enter folder path to share (press Enter to skip): ", (folderPathRaw) => {
    const folderPath = folderPathRaw.trim();
    let index = [];
    if (folderPath) {
      try {
        index = generateSharedIndex(folderPath);
      } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
      }
    } else {
      console.log("ℹNo folder shared. Continuing without files...");
    }

    // Load or create local RSA keypair
    const { privateKey: localPrivateKeyPem, publicKey: localPublicKeyPem } = ensureKeyPair();
    // Create auth token
    const token = jwt.sign({ nickname }, "secret123", { expiresIn: "1h" });
    // Connect WebSocket
    const ws = new WebSocket(`wss://localhost:3000/?token=${token}`, { rejectUnauthorized: false });
    ws.on("open", () => {
      console.log("Connected to server as", nickname);
      // Send public key
      ws.send(JSON.stringify({
        type: "registerKey",
        from: nickname,
        publicKey: localPublicKeyPem
      }));
      // Send initial file index
      ws.send(JSON.stringify({ type: "fileIndex", from: nickname, files: index }));

      rl.setPrompt("> ");
      rl.prompt();
    });
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (err) {
        console.log("Received non-JSON message:", data.toString());
        rl.prompt();
        return;
      }

      switch (msg.type) {
        case "system":
        case "keyAck":
          console.log(`\nServer: ${msg.text}`);
          break;

        case "userList":
          console.log("\n Connected Users:");
          if (Array.isArray(msg.users)) {
            msg.users.forEach((u) => {
              console.log(`ID: ${u.id} | Nick: ${u.nickname}`);
              if (u.publicKey) registerUserKey(u.nickname, u.publicKey);
            });
          }
          break;

        case "userKey":
          registerUserKey(msg.nickname, msg.publicKey);
          console.log(`\nReceived public key for ${msg.nickname}`);
          break;

        case "shareAck":
          if (Array.isArray(msg.userIDs)) {
            console.log(`\n Server acknowledged sharing file ${msg.fileHash} with ${msg.userIDs.join(", ")}`);
          } else {
            console.log(`\n Server acknowledged sharing file ${msg.fileHash}`);
          }
          break;
        case "fileShared":
          console.log(`\n ${msg.from} shared a file with you:`);
          console.log(`   ${msg.fileName} | size: ${msg.size} bytes | hash: ${msg.fileHash}`);
          console.log("   To request decryption key, run: !request_keys", msg.fileHash);
          break;

        case "fileKey":
          console.log(`\n Received encrypted key for file ${msg.fileHash}`);
          console.log(`Encrypted Key (base64): ${msg.encryptedKey}`);
          console.log(`IV: ${msg.iv}`);
          break;

        case "fileList":
          console.log(`\n Files shared by ${msg.owner}:`);
          if (!msg.files || msg.files.length === 0) {
            console.log(" (No files shared with you)");
          } else {
            msg.files.forEach((file, i) => {
              console.log(`${i + 1}. ${file.fileName} | size: ${file.size} bytes | hash: ${file.hash}`);
            });
          }
          break;

        case "chat":
        case "message":
          console.log(`\n${msg.from || "Server"}: ${msg.text}`);
          break;

        default:
          console.log("\n Unknown msg.type:", msg.type, "raw:", msg);
      }

      rl.prompt();
    });

    ws.on("close", (code, reason) => {
      console.log("\n Disconnected from server", code ? `(code ${code})` : "", reason ? `reason: ${reason}` : "");
      process.exit(0);
    });

    ws.on("error", (err) => {
      console.error("\nWebSocket error:", err.message || err);
      rl.prompt();
    });

    // CLI commands
    rl.on("line", async (line) => {
      const msg = line.trim();
      if (!msg) { rl.prompt(); return; }

      // Show own files
      if (msg === "!myfiles") {
        console.log("\n Your Files:");
        if (index.length === 0) console.log(" (No files shared)");
        else index.forEach((file, i) => console.log(`${i + 1}. ${file.fileName} | hash: ${file.hash}`));
        rl.prompt();
        return;
      }

      // Request user list
      if (msg === "!users") {
        ws.send(JSON.stringify({ type: "getUsers", from: nickname }));
        rl.prompt();
        return;
      }

      // Share encrypted file
      if (msg.startsWith("!share ")) {
        const parts = msg.split(" ");
        if (parts.length < 3) {
          console.log("Usage: !share <fileHash> <recipient1,recipient2,...>");
          rl.prompt();
          return;
        }

        const fileHash = parts[1];
        const recipients = parts[2].split(",");
        const file = index.find(f => f.hash === fileHash);
        if (!file) {
          console.log(" File not found in your index.");
          rl.prompt();
          return;
        }

        const { key: aesKey, iv } = generateAESKey();
        const encryptedFilePath = file.filePath
          ? path.join(path.dirname(file.filePath), file.fileName + ".enc")
          : file.fileName + ".enc";
        const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
        fs.createReadStream(file.filePath)
          .pipe(cipher)
          .pipe(fs.createWriteStream(encryptedFilePath))
          .on("finish", () => {
            const encryptedKeys = {};
            for (const r of recipients) {
              const pubKeyPem = getUserKey(r);
              if (!pubKeyPem) continue;
              encryptedKeys[r] = encryptAESKeyForRecipient(pubKeyPem, aesKey);
            }

            ws.send(JSON.stringify({
              type: "shareEncryptedFile",
              from: nickname,
              fileHash,
              fileName: file.fileName,
              size: file.size,
              recipients,
              encryptedKeys,
              iv: iv.toString("base64"),
            }));

            console.log(`Share request sent for ${file.fileName}, encrypted copy at ${encryptedFilePath}`);
            rl.prompt();
          });
        return;
      }

      // Request AES keys for a file
      if (msg.startsWith("!request_keys ")) {
        const parts = msg.split(" ");
        if (parts.length < 2) {
          console.log("Usage: !request_keys <fileHash>");
          rl.prompt();
          return;
        }
        const fileHash = parts[1];
        ws.send(JSON.stringify({ type: "requestKeys", from: nickname, fileHash }));
        rl.prompt();
        return;
      }

      // Request files from another user
      if (msg.startsWith("!list ")) {
        const parts = msg.split(" ");
        if (parts.length < 2) {
          console.log("Usage: !list <nickname>");
          rl.prompt();
          return;
        }
        const targetNick = parts[1];
        ws.send(JSON.stringify({ type: "listRequest", from: nickname, target: targetNick }));
        rl.prompt();
        return;
      }

      // Fallback → chat
      ws.send(JSON.stringify({ type: "message", from: nickname, text: msg }));
      rl.prompt();
    });
  });
});
