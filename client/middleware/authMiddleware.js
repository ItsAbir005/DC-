import jwt from "jsonwebtoken";

export function verifyDownloadToken(token, fileHash) {
  try {
    const decoded = jwt.verify(token, "secret123");
    if (decoded.fileHash !== fileHash) {
      throw new Error("File hash mismatch");
    }
    return decoded;
  } catch (err) {
    throw new Error("Invalid/expired token: " + err.message);
  }
}
