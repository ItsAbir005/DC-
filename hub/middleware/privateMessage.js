//middleware/privateMessage.js
export function handlePrivateMessage(connectedUsers, sender, ws, msg) {
  if (!msg.text || !msg.text.startsWith("/pm ")) return false;

  const parts = msg.text.split(" ");
  const recipient = parts[1];
  const privateMsg = parts.slice(2).join(" ");
  if (connectedUsers.has(recipient)) {
    connectedUsers.get(recipient).send(JSON.stringify({
      type: "private",
      from: sender,
      text: privateMsg
    }));
    ws.send(JSON.stringify({
      type: "private",
      to: recipient,
      text: privateMsg
    }));
  } else {
    ws.send(JSON.stringify({
      type: "system",
      text: `User ${recipient} not found.`
    }));
  }

  return true;
}

