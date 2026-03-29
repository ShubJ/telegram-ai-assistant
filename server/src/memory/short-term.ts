/**
 * Short-term (in-session) memory.
 *
 * Keeps a rolling window of recent messages per user in a plain JavaScript
 * Map for near-zero latency access.  Every message is also persisted to the
 * SQLite `messages` table so nothing is lost across process restarts.
 *
 * Design choices:
 *  - The system message (role === 'system') is always kept if present.
 *  - When the window overflows, the oldest non-system messages are dropped.
 *  - The in-memory cache is rebuilt lazily from the DB on first access after
 *    a restart.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface Message {
  id: string;
  userId: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

// Row shape returned by SQLite
interface MessageRow {
  id: string;
  user_id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  metadata: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CONTEXT = 20;

// ---------------------------------------------------------------------------
// ShortTermMemory
// ---------------------------------------------------------------------------

export class ShortTermMemory {
  /** userId → ordered list of messages (oldest first). */
  private cache: Map<string, Message[]> = new Map();
  /** Maximum number of messages retained per user (system msg excluded). */
  private maxContext: number;
  /** Track which userIds have been loaded from DB to avoid repeated queries. */
  private loaded: Set<string> = new Set();

  constructor(maxContext: number = DEFAULT_MAX_CONTEXT) {
    this.maxContext = maxContext;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Add a new message to the context window for `userId`.
   * The message is persisted to SQLite immediately.
   */
  addMessage(
    userId: string,
    role: MessageRole,
    content: string,
    metadata: Record<string, unknown> = {},
  ): Message {
    this._ensureLoaded(userId);

    const message: Message = {
      id: uuidv4(),
      userId,
      role,
      content,
      timestamp: new Date().toISOString(),
      metadata,
    };

    // Persist first so the DB is always the source of truth.
    this._persistMessage(message);

    // Update in-memory cache.
    const messages = this._getOrCreate(userId);
    messages.push(message);
    this._trim(userId);

    return message;
  }

  /** Return the current context window for `userId` (may be empty). */
  getMessages(userId: string): Message[] {
    this._ensureLoaded(userId);
    return [...(this.cache.get(userId) ?? [])];
  }

  /**
   * Clear the in-memory context window for `userId`.
   * SQLite history is intentionally preserved – only the hot cache is wiped.
   */
  clearContext(userId: string): void {
    this.cache.delete(userId);
    this.loaded.delete(userId);
  }

  /**
   * Remove all messages from both the cache *and* the SQLite `messages` table
   * for `userId`.  Use with care – this is destructive.
   */
  deleteHistory(userId: string): void {
    this.cache.delete(userId);
    this.loaded.delete(userId);

    const db = getDb();
    db.prepare('DELETE FROM messages WHERE user_id = ?').run(userId);
  }

  /**
   * Return the most recent `limit` messages for `userId` directly from SQLite
   * (bypasses the in-memory cache – useful for history/admin views).
   */
  getHistoryFromDb(userId: string, limit = 100): Message[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, user_id, role, content, timestamp, metadata
           FROM messages
          WHERE user_id = ?
          ORDER BY timestamp DESC
          LIMIT ?`,
      )
      .all(userId, limit) as MessageRow[];

    return rows.reverse().map(this._rowToMessage);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _getOrCreate(userId: string): Message[] {
    if (!this.cache.has(userId)) {
      this.cache.set(userId, []);
    }
    return this.cache.get(userId)!;
  }

  /**
   * Lazily load the recent context window from SQLite on first access per
   * userId (after a restart the in-memory map is empty).
   */
  private _ensureLoaded(userId: string): void {
    if (this.loaded.has(userId)) return;
    this.loaded.add(userId);

    const db = getDb();
    // Fetch enough rows to fill the window; we only need the most recent ones.
    const rows = db
      .prepare(
        `SELECT id, user_id, role, content, timestamp, metadata
           FROM messages
          WHERE user_id = ?
          ORDER BY timestamp DESC
          LIMIT ?`,
      )
      .all(userId, this.maxContext * 2) as MessageRow[];

    // Reverse so they are oldest-first in the cache.
    const messages = rows.reverse().map(this._rowToMessage);
    this.cache.set(userId, messages);
    this._trim(userId);
  }

  /**
   * Enforce the context window limit.
   *
   * Strategy:
   *  1. Identify (and preserve) any system message at index 0.
   *  2. Keep only the most recent `maxContext` non-system messages.
   */
  private _trim(userId: string): void {
    const messages = this.cache.get(userId);
    if (!messages) return;

    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    if (nonSystemMessages.length <= this.maxContext) return;

    // Drop oldest non-system entries.
    const trimmed = nonSystemMessages.slice(
      nonSystemMessages.length - this.maxContext,
    );

    this.cache.set(userId, [...systemMessages, ...trimmed]);
  }

  private _persistMessage(message: Message): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO messages (id, user_id, role, content, timestamp, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      message.id,
      message.userId,
      message.role,
      message.content,
      message.timestamp,
      JSON.stringify(message.metadata),
    );
  }

  private _rowToMessage(row: MessageRow): Message {
    return {
      id: row.id,
      userId: row.user_id,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      metadata: (() => {
        try {
          return JSON.parse(row.metadata) as Record<string, unknown>;
        } catch {
          return {};
        }
      })(),
    };
  }
}
