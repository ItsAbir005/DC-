const readline = require("readline");
const jwt = require("jsonwebtoken");
const WebSocket = require("ws");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question("Enter your nickname: ", (nickname) => {
  nickname = nickname.trim();
  if (!nickname) {
    console.error(" No nickname entered. Please run again.");
    process.exit(1);
  }

  console.log("Nickname entered:", `"${nickname}"`);

  // Generate JWT
  const secretKey = "secret123";
  const token = jwt.sign({ nickname }, secretKey, { expiresIn: "1h" });
  console.log("Generated JWT:", token);
  const ws = new WebSocket(`wss://localhost:3000/?token=${token}`, {
    rejectUnauthorized: false,
  });

  ws.on("open", () => {
    console.log("Connected to server as", nickname);
    rl.setPrompt("> ");
    rl.prompt();

    rl.on("line", (line) => {
      const msg = line.trim();
      if (!msg) {
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
      console.log(`\n${msg.from || "Server"}: ${msg.text}`);
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
