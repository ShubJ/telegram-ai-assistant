import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { createLogger } from "../logger.js";

const logger = createLogger("DB");

let db: Database.Database;

/**
 * Returns the singleton database instance.
 * Throws if the database has not been initialized via `initDatabase()` yet.
 */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error(
      "Database has not been initialized. Call initDatabase() first."
    );
  }
  return db;
}

/**
 * Initializes the SQLite database:
 *  1. Ensures the data directory exists.
 *  2. Opens (or creates) the database file.
 *  3. Enables WAL journal mode for better concurrent read performance.
 *  4. Sets pragmas for improved reliability and speed.
 */
export function initDatabase(): Database.Database {
  const dbPath = config.databasePath;
  const dataDir = path.dirname(dbPath);

  // Ensure the parent directory exists
  fs.mkdirSync(dataDir, { recursive: true });

  db = new Database(dbPath, {
    // verbose logging only in development
    verbose:
      config.nodeEnv === "development"
        ? (sql: unknown) => logger.debug(String(sql))
        : undefined,
  });

  // Enable WAL mode — better read concurrency, no blocking writes
  db.pragma("journal_mode = WAL");

  // Enforce foreign-key constraints
  db.pragma("foreign_keys = ON");

  // Recommended performance pragmas
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000"); // 64 MB page cache
  db.pragma("temp_store = MEMORY");
  db.pragma("mmap_size = 268435456"); // 256 MB memory-mapped I/O

  logger.info(`Database initialized at: ${dbPath}`);
  return db;
}

/**
 * Closes the database connection gracefully.
 * Safe to call multiple times — no-ops if already closed.
 */
export function closeDatabase(): void {
  if (db && db.open) {
    db.close();
    logger.info("Database connection closed.");
  }
}

// Re-export the Database type for use elsewhere
export type { Database };
