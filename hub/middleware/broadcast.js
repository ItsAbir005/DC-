//hub/middleware/broadcast.js
export function broadcast(connectedUsers, message) {
  for (let [user, clientWs] of connectedUsers) {
    if (clientWs.readyState === clientWs.OPEN) {
      clientWs.send(message);
    }
  }
}
