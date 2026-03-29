/**
 * User profile management backed by the SQLite `users` table.
 *
 * Handles user creation, preference storage (persisted as a JSON blob in the
 * `preferences` column), and admin-status management.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  isAdmin: boolean;
  timezone: string;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type UserUpdates = Partial<
  Pick<User, 'username' | 'firstName' | 'timezone' | 'preferences'>
>;

// SQLite row shape (snake_case from DB)
interface UserRow {
  id: string;
  telegram_id: string;
  username: string | null;
  first_name: string | null;
  is_admin: number;
  timezone: string;
  preferences: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// UserProfileManager
// ---------------------------------------------------------------------------

export class UserProfileManager {
  // -------------------------------------------------------------------------
  // Create / retrieve
  // -------------------------------------------------------------------------

  /**
   * Return the user with `telegramId`, creating them if they do not yet exist.
   *
   * If a new record is inserted the optional `username` and `firstName` are
   * stored immediately.  If the user already exists the call is a no-op (the
   * profile is not updated – call `updateUser` for that).
   */
  getOrCreateUser(
    telegramId: string,
    username?: string,
    firstName?: string,
  ): User {
    const db = getDb();

    const existing = db
      .prepare('SELECT * FROM users WHERE telegram_id = ?')
      .get(telegramId) as UserRow | undefined;

    if (existing) return this._rowToUser(existing);

    const now = new Date().toISOString();
    const id = uuidv4();

    db.prepare(
      `INSERT INTO users
         (id, telegram_id, username, first_name, is_admin, timezone, preferences, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 'UTC', '{}', ?, ?)`,
    ).run(id, telegramId, username ?? null, firstName ?? null, now, now);

    const row = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as UserRow;

    return this._rowToUser(row);
  }

  /**
   * Look up a user by their internal UUID.
   * Returns `null` if no matching record exists.
   */
  getUser(userId: string): User | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(userId) as UserRow | undefined;
    return row ? this._rowToUser(row) : null;
  }

  /**
   * Look up a user by their Telegram numeric/string ID.
   * Returns `null` if no matching record exists.
   */
  getUserByTelegramId(telegramId: string): User | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM users WHERE telegram_id = ?')
      .get(telegramId) as UserRow | undefined;
    return row ? this._rowToUser(row) : null;
  }

  /**
   * Retrieve every user in the database.
   * Intended for the admin dashboard – use sparingly.
   */
  getAllUsers(): User[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM users ORDER BY created_at DESC')
      .all() as UserRow[];
    return rows.map(this._rowToUser.bind(this));
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  /**
   * Apply a partial update to a user record.
   *
   * Only the fields provided in `updates` are changed.  If `preferences` is
   * included it *replaces* the entire preferences JSON blob; use
   * `setPreference` to merge individual keys.
   *
   * @returns The updated User, or null if `userId` does not exist.
   */
  updateUser(userId: string, updates: UserUpdates): User | null {
    const db = getDb();
    const now = new Date().toISOString();

    const setClauses: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (updates.username !== undefined) {
      setClauses.push('username = ?');
      params.push(updates.username);
    }
    if (updates.firstName !== undefined) {
      setClauses.push('first_name = ?');
      params.push(updates.firstName);
    }
    if (updates.timezone !== undefined) {
      setClauses.push('timezone = ?');
      params.push(updates.timezone);
    }
    if (updates.preferences !== undefined) {
      setClauses.push('preferences = ?');
      params.push(JSON.stringify(updates.preferences));
    }

    if (setClauses.length === 1) {
      // Only updated_at – nothing meaningful to update.
      return this.getUser(userId);
    }

    params.push(userId);

    db.prepare(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`,
    ).run(...params);

    return this.getUser(userId);
  }

  /**
   * Promote or demote a user to/from admin status.
   */
  setAdmin(userId: string, isAdmin: boolean): void {
    const db = getDb();
    db.prepare(
      `UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?`,
    ).run(isAdmin ? 1 : 0, new Date().toISOString(), userId);
  }

  // -------------------------------------------------------------------------
  // Preferences
  // -------------------------------------------------------------------------

  /**
   * Set a single preference key for `userId`.
   *
   * The existing preferences JSON is read, merged with the new key/value, and
   * written back atomically inside a transaction.
   *
   * @param userId  Internal user id.
   * @param key     Preference name (e.g. `'language'`, `'notification_time'`).
   * @param value   Any JSON-serialisable value.
   */
  setPreference(userId: string, key: string, value: unknown): void {
    const db = getDb();

    const updatePreference = db.transaction(() => {
      const row = db
        .prepare('SELECT preferences FROM users WHERE id = ?')
        .get(userId) as Pick<UserRow, 'preferences'> | undefined;

      if (!row) {
        throw new Error(`setPreference: user "${userId}" not found`);
      }

      let prefs: Record<string, unknown>;
      try {
        prefs = JSON.parse(row.preferences) as Record<string, unknown>;
      } catch {
        prefs = {};
      }

      prefs[key] = value;

      db.prepare(
        'UPDATE users SET preferences = ?, updated_at = ? WHERE id = ?',
      ).run(JSON.stringify(prefs), new Date().toISOString(), userId);
    });

    updatePreference();
  }

  /**
   * Read a single preference key for `userId`.
   *
   * @returns The stored value, or `undefined` if the key does not exist.
   */
  getPreference(userId: string, key: string): unknown {
    const db = getDb();
    const row = db
      .prepare('SELECT preferences FROM users WHERE id = ?')
      .get(userId) as Pick<UserRow, 'preferences'> | undefined;

    if (!row) return undefined;

    try {
      const prefs = JSON.parse(row.preferences) as Record<string, unknown>;
      return prefs[key];
    } catch {
      return undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _rowToUser(row: UserRow): User {
    let preferences: Record<string, unknown> = {};
    try {
      preferences = JSON.parse(row.preferences) as Record<string, unknown>;
    } catch {
      preferences = {};
    }

    return {
      id: row.id,
      telegramId: row.telegram_id,
      username: row.username,
      firstName: row.first_name,
      isAdmin: row.is_admin === 1,
      timezone: row.timezone,
      preferences,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
