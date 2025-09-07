// client.js
const readline = require("readline");
const jwt = require("jsonwebtoken");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const { generateSharedIndex } = require("./controllers/shareController");
const { ensureKeyPair } = require("./controllers/keyController");
const { registerUserKey, getUserKey } = require("./controllers/userController");
const { generateAESKey, encryptAESKeyForRecipient } = require("./utils/cryptoUtils");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("Enter your nickname: ", (nicknameRaw) => {
  const nickname = nicknameRaw.trim();
  if (!nickname) {
    console.error(" No nickname entered. Please run again.");
    process.exit(1);
  }

  rl.question("Enter folder path to share (press Enter to skip): ", (folderPathRaw) => {
    const folderPath = folderPathRaw.trim();
    let index = [];
    if (folderPath) {
      try {
        index = generateSharedIndex(folderPath); 
      } catch (err) {
        console.error(" Error:", err.message);
        process.exit(1);
      }
    } else {
      console.log(" No folder shared. Continuing without files...");
    }
    const { privateKey: localPrivateKeyPem, publicKey: localPublicKeyPem } = ensureKeyPair();
    const token = jwt.sign({ nickname }, "secret123", { expiresIn: "1h" });
    const ws = new WebSocket(`wss://localhost:3000/?token=${token}`, { rejectUnauthorized: false });

    ws.on("open", () => {
      console.log("Connected to server as", nickname);
      ws.send(JSON.stringify({
        type: "registerKey",
        from: nickname,
        publicKey: localPublicKeyPem
      }));
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
          console.log(`\nServer: ${msg.text}`);
          break;

        case "keyAck":
          console.log(`\nServer: ${msg.text}`);
          break;

        case "userList":
          console.log("\nConnected Users:");
          if (Array.isArray(msg.users)) {
            msg.users.forEach((u, i) => {
              console.log(`ID: ${u.id} | Nick: ${u.nickname}`);
              if (u.publicKey) {
                registerUserKey(u.nickname, u.publicKey);
              }
            });
          }
          break;

        case "userKey":
          if (msg.nickname && msg.publicKey) {
            registerUserKey(msg.nickname, msg.publicKey);
            console.log(`\nReceived public key for ${msg.nickname}`);
          }
          break;

        case "shareAck":
          console.log(`\nServer acknowledged sharing file ${msg.fileHash} with ${msg.userIDs.join(", ")}`);
          break;

        case "fileList":
          console.log(`\nFiles shared by ${msg.owner}:`);
          if (!msg.files || msg.files.length === 0) {
            console.log(" (No files shared with you)");
          } else {
            msg.files.forEach((file, i) => {
              console.log(`${i + 1}. ${file.fileName} | size: ${file.size} bytes | hash: ${file.hash}`);
            });
          }
          break;

        case "message":
        case "chat":
          console.log(`\n${msg.from || "Server"}: ${msg.text}`);
          break;

        default:
          console.log("\nUnknown msg.type:", msg.type, "raw:", msg);
      }

      rl.prompt();
    });
    ws.on("close", (code, reason) => {
      console.log("\nDisconnected from server", code ? `(code ${code})` : "", reason ? `reason: ${reason}` : "");
      process.exit(0);
    });

    ws.on("error", (err) => {
      console.error("\nWebSocket error:", err.message || err);
      rl.prompt();
    });
    rl.on("line", async (line) => {
      const msg = line.trim();
      if (!msg) { rl.prompt(); return; }

      if (msg === "!myfiles") {
        console.log("\n Your Files:");
        if (index.length === 0) {
          console.log(" (No files shared)");
        } else {
          index.forEach((file, i) => {
            console.log(`${i + 1}. ${file.fileName} | hash: ${file.hash}`);
          });
        }
        rl.prompt();
        return;
      }

      if (msg === "!users") {
        ws.send(JSON.stringify({ type: "getUsers", from: nickname }));
        rl.prompt();
        return;
      }

      if (msg.startsWith("!share ")) {
        const parts = msg.split(" ");
        if (parts.length < 3) {
          console.log("Usage: !share <fileHash> <user1> <user2> ...");
          rl.prompt();
          return;
        }
        const fileHash = parts[1];
        const recipients = parts.slice(2);

        const file = index.find(f => f.hash === fileHash);
        if (!file) {
          console.log("File not found in your index.");
          rl.prompt();
          return;
        }
        const filePath = file.path;
        const missing = recipients.filter(r => !getUserKey(r));
        if (missing.length > 0) {
          console.log(`Requesting public keys for: ${missing.join(", ")}. Try !share again after keys arrive.`);
          missing.forEach(m => ws.send(JSON.stringify({ type: "requestKey", from: nickname, target: m })));
          rl.prompt();
          return;
        }
        const { key: aesKey, iv } = generateAESKey();
        const encryptedFilePath = `${filePath}.enc`;
        const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
        const inStream = fs.createReadStream(filePath);
        const outStream = fs.createWriteStream(encryptedFilePath);
        inStream.pipe(cipher).pipe(outStream);
        outStream.on("finish", () => {
          const encryptedKeys = {};
          for (const r of recipients) {
            const pubKeyPem = getUserKey(r);
            if (!pubKeyPem) continue; 
            encryptedKeys[r] = encryptAESKeyForRecipient(pubKeyPem, aesKey); // base64 string
          }

          // Send metadata + encrypted keys + iv to hub
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
          console.log(`Share request sent for ${file.fileName} -> encrypted file saved at ${encryptedFilePath}`);
          rl.prompt();
        });
        outStream.on("error", (err) => {
          console.error("Encryption/write error:", err.message || err);
          rl.prompt();
        });

        return;
      }

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
      ws.send(JSON.stringify({ type: "message", from: nickname, text: msg }));
      rl.prompt();
    });
  });
});
