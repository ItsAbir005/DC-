function handlePrivateMessage(connectedUsers, sender, ws, msg) {
  if (!msg.startsWith("/pm ")) return false;

  const parts = msg.split(" ");
  const recipient = parts[1];
  const privateMsg = parts.slice(2).join(" ");

  if (connectedUsers.has(recipient)) {
    connectedUsers.get(recipient).send(`[PM from ${sender}]: ${privateMsg}`);
    ws.send(`[PM to ${recipient}]: ${privateMsg}`);
  } else {
    ws.send(`User ${recipient} not found.`);
  }

  return true; 
}

module.exports = { handlePrivateMessage };