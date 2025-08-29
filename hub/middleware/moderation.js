const { broadcast } = require("./broadcast");
function handleModeration(connectedUsers, sender, ws, msg) {
  if (!msg.startsWith("/kick ")) return false;
  if (sender !== "admin") {
    ws.send("You are not allowed to use this command.");
    return true;
  }
  const target = msg.split(" ")[1];
  if (connectedUsers.has(target)) {
    const targetSocket = connectedUsers.get(target);
    targetSocket.send("You have been kicked by the admin.");
    targetSocket.close();
    connectedUsers.delete(target);
    broadcast(connectedUsers, `${target} has been kicked by admin.`);
  } else {
    ws.send(`User ${target} not found.`);
  }

  return true; 
}

module.exports = { handleModeration };