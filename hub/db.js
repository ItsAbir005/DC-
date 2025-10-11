import sqlite3 from "sqlite3";
import { open } from "sqlite";

export async function initDB() {
  const db = await open({
    filename: "./hub_data.db",
    driver: sqlite3.Database,
  });

  // USERS TABLE
  await db.exec(`
    CREATE TABLE IF NOT EXISTS Users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT UNIQUE NOT NULL,
      public_key TEXT NOT NULL
    );
  `);

  // FILES TABLE
  await db.exec(`
    CREATE TABLE IF NOT EXISTS Files (
      file_hash TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      file_name TEXT,
      iv TEXT NOT NULL,
      encrypted_keys TEXT NOT NULL,
      allowed_users TEXT NOT NULL
    );
  `);

  // REVOCATIONS TABLE
  await db.exec(`
    CREATE TABLE IF NOT EXISTS Revocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_hash TEXT NOT NULL,
      revoked_user TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // AUDIT LOG TABLE
  await db.exec(`
    CREATE TABLE IF NOT EXISTS AuditLog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      acting_user_id TEXT,
      file_hash TEXT,
      action_type TEXT,
      status TEXT,
      details TEXT
    );
  `);

  console.log("Database initialized successfully");
  return db;
}
