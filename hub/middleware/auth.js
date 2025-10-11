//middleware/auth.js
import jwt from "jsonwebtoken";

export function verifyToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret123");
    return decoded;
  } catch (err) {
    console.log("JWT verification failed:", err.message);
    return null;
  }
}
