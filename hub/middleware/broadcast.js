function broadcast(connectedUsers, message) {
  for (let [user, clientWs] of connectedUsers) {
    if (clientWs.readyState === clientWs.OPEN) {
      clientWs.send(message);
    }
  }
}

module.exports = { broadcast };