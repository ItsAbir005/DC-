//middleware/moderation.js
import { broadcast } from "./broadcast.js";

export function handleModeration(connectedUsers, sender, ws, msg) {
  if (!msg.text || !msg.text.startsWith("/kick ")) return false;

  if (sender !== "admin") {
    ws.send(JSON.stringify({
      type: "system",
      text: "You are not allowed to use this command."
    }));
    return true;
  }

  const target = msg.text.split(" ")[1];
  if (connectedUsers.has(target)) {
    const targetSocket = connectedUsers.get(target);
    targetSocket.send(JSON.stringify({
      type: "system",
      text: "You have been kicked by the admin."
    }));
    targetSocket.close();
    connectedUsers.delete(target);

    broadcast(connectedUsers, JSON.stringify({
      type: "system",
      text: `${target} has been kicked by admin.`
    }));
  } else {
    ws.send(JSON.stringify({
      type: "system",
      text: `User ${target} not found.`
    }));
  }

  return true;
}

