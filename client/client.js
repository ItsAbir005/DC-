const readline = require("readline");
const jwt = require("jsonwebtoken");
const WebSocket = require("ws");
const { generateSharedIndex } = require("./controllers/shareController");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("Enter your nickname: ", (nickname) => {
  nickname = nickname.trim();
  if (!nickname) {
    console.error(" No nickname entered. Please run again.");
    process.exit(1);
  }
  console.log("Nickname entered:", `"${nickname}"`);

  // Ask for folder path
  rl.question("Enter folder path to share (press Enter to skip): ", (folderPath) => {
    let index = [];

    if (folderPath.trim()) {
      try {
        index = generateSharedIndex(folderPath);
      } catch (err) {
        console.error(" Error:", err.message);
        process.exit(1);
      }
    } else {
      console.log(" No folder shared. Continuing without files...");
    }


    // Connect WebSocket
    const secretKey = "secret123";
    const token = jwt.sign({ nickname }, secretKey, { expiresIn: "1h" });

    const ws = new WebSocket(`wss://localhost:3000/?token=${token}`, {
      rejectUnauthorized: false,
    });

    ws.on("open", () => {
      console.log("Connected to server as", nickname);

      // Optionally: send file index to server
      ws.send(JSON.stringify({ type: "fileIndex", from: nickname, files: index }));

      rl.setPrompt("> ");
      rl.prompt();

      rl.on("line", (line) => {
        const msg = line.trim();
        if (!msg) {
          rl.prompt();
          return;
        }
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
          return; // <-- prevents sending to server
        }
        if (msg === "!users") {
          ws.send(JSON.stringify({ type: "getUsers", from: nickname }));
          rl.prompt();
          return;
        }
        if (msg.startsWith("!share ")) {
          const parts = msg.split(" ");
          if (parts.length < 3) {
            console.log("Usage: !share <fileHash> <userID1> <userID2> ...");
            rl.prompt();
            return;
          }

          const fileHash = parts[1];
          const userIDs = parts.slice(2);

          ws.send(
            JSON.stringify({
              type: "shareRequest",
              from: nickname,
              fileHash,
              userIDs,
            })
          );

          console.log(` Request sent to share file ${fileHash} with users: ${userIDs.join(", ")}`);
          rl.prompt();
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
          ws.send(JSON.stringify({
            type: "listRequest",
            from: nickname,
            target: targetNick,
          }));
          rl.prompt();
          return;
        }
        ws.send(JSON.stringify({ type: "message", from: nickname, text: msg }));
        rl.prompt();
      });
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "userList") {
          console.log("\nConnected Users:");
          msg.users.forEach((u) => {
            console.log(`ID: ${u.id} | Nick: ${u.nickname}`);
          });
        } else if (msg.type === "shareAck") {
          console.log(`\n Server acknowledged sharing file ${msg.fileHash} with ${msg.userIDs.join(", ")}`);
        } else {
          console.log(`\n${msg.from || "Server"}: ${msg.text}`);
        }
      } catch (err) {
        console.log("Raw message:", data.toString());
      }
      rl.prompt();
    });


    ws.on("close", () => {
      console.log("\nDisconnected from server");
      process.exit(0);
    });

    ws.on("error", (error) => {
      console.error("\n WebSocket error:", error.message);
    });
  });
});
