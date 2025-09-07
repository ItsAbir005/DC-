const recipientKeys = new Map(); // nickname -> publicKey

function registerUserKey(nickname, publicKey) {
  recipientKeys.set(nickname, publicKey);
}

function getUserKey(nickname) {
  return recipientKeys.get(nickname);
}

function getAllUsers() {
  return Array.from(recipientKeys.keys());
}

module.exports = { registerUserKey, getUserKey, getAllUsers };
