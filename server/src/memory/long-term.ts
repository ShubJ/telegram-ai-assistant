/**
 * Long-term memory backed by the SQLite `memories` table.
 *
 * Memories are semi-structured facts extracted from conversations that should
 * persist across sessions.  They are ranked by importance (1–10) and an
 * access_count so that frequently-recalled memories are surfaced first.
 *
 * Search is intentionally simple: the query string is split on whitespace and
 * each word is matched against `content` using LIKE.  This avoids a
 * full-text-search extension dependency while still being useful for the
 * typical "my name is …" / "I prefer …" style facts this system extracts.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryType =
  | 'fact'      // General fact about the user ("lives in Berlin")
  | 'preference'// User preference ("prefers dark mode")
  | 'note'      // Explicit user note ("remember that …")
  | 'context'   // Situational context from a conversation
  | 'skill'     // Something the user knows / wants to learn
  | string;     // Allow arbitrary custom types

export interface Memory {
  id: string;
  userId: string;
  type: MemoryType;
  content: string;
  importance: number;   // 1 (low) – 10 (high)
  createdAt: string;
  lastAccessed: string;
  accessCount: number;
}

// SQLite row shape
interface MemoryRow {
  id: string;
  user_id: string;
  type: string;
  content: string;
  importance: number;
  created_at: string;
  last_accessed: string;
  access_count: number;
}

// ---------------------------------------------------------------------------
// LongTermMemory
// ---------------------------------------------------------------------------

export class LongTermMemory {
  // -------------------------------------------------------------------------
  // Write operations
  // -------------------------------------------------------------------------

  /**
   * Store a new memory.
   *
   * @param userId     Internal user id (uuid).
   * @param type       Memory category.
   * @param content    The fact / note to remember.
   * @param importance Priority score 1–10 (default 5).
   * @returns The newly created Memory record.
   */
  addMemory(
    userId: string,
    type: MemoryType,
    content: string,
    importance: number = 5,
  ): Memory {
    const db = getDb();
    const now = new Date().toISOString();
    const id = uuidv4();
    const clamped = Math.max(1, Math.min(10, Math.round(importance)));

    db.prepare(
      `INSERT INTO memories
         (id, user_id, type, content, importance, created_at, last_accessed, access_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(id, userId, type, content, clamped, now, now);

    return {
      id,
      userId,
      type,
      content,
      importance: clamped,
      createdAt: now,
      lastAccessed: now,
      accessCount: 0,
    };
  }

  /**
   * Delete a memory by its primary key.
   * Returns true if a row was actually removed.
   */
  deleteMemory(id: string): boolean {
    const db = getDb();
    const result = db
      .prepare('DELETE FROM memories WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  /**
   * Increment access_count and refresh last_accessed for a memory.
   * Call this whenever a memory is surfaced to the LLM.
   */
  updateAccessCount(id: string): void {
    const db = getDb();
    db.prepare(
      `UPDATE memories
          SET access_count  = access_count + 1,
              last_accessed = ?
        WHERE id = ?`,
    ).run(new Date().toISOString(), id);
  }

  // -------------------------------------------------------------------------
  // Read operations
  // -------------------------------------------------------------------------

  /**
   * Full-text keyword search across a user's memories.
   *
   * The query is tokenised on whitespace; only memories containing *all*
   * tokens (case-insensitive) are returned.  Results are ordered by
   * importance DESC then access_count DESC.
   *
   * @param userId  Internal user id.
   * @param query   Natural-language search string.
   * @param limit   Max results (default 10).
   */
  searchMemories(userId: string, query: string, limit = 10): Memory[] {
    const db = getDb();

    const tokens = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => t.toLowerCase());

    if (tokens.length === 0) return [];

    // Build a WHERE clause: user_id = ? AND LOWER(content) LIKE '%token1%' AND …
    const likeClauses = tokens.map(() => `LOWER(content) LIKE ?`).join(' AND ');
    const params: unknown[] = [userId, ...tokens.map((t) => `%${t}%`), limit];

    const rows = db
      .prepare(
        `SELECT id, user_id, type, content, importance, created_at, last_accessed, access_count
           FROM memories
          WHERE user_id = ?
            AND ${likeClauses}
          ORDER BY importance DESC, access_count DESC
          LIMIT ?`,
      )
      .all(...params) as MemoryRow[];

    return rows.map(this._rowToMemory);
  }

  /**
   * Retrieve memories for a user, optionally filtered by type.
   *
   * @param userId  Internal user id.
   * @param type    Optional type filter.
   * @param limit   Max results (default 50).
   */
  getMemories(userId: string, type?: MemoryType, limit = 50): Memory[] {
    const db = getDb();

    if (type) {
      const rows = db
        .prepare(
          `SELECT id, user_id, type, content, importance, created_at, last_accessed, access_count
             FROM memories
            WHERE user_id = ? AND type = ?
            ORDER BY importance DESC, last_accessed DESC
            LIMIT ?`,
        )
        .all(userId, type, limit) as MemoryRow[];
      return rows.map(this._rowToMemory);
    }

    const rows = db
      .prepare(
        `SELECT id, user_id, type, content, importance, created_at, last_accessed, access_count
           FROM memories
          WHERE user_id = ?
          ORDER BY importance DESC, last_accessed DESC
          LIMIT ?`,
      )
      .all(userId, limit) as MemoryRow[];

    return rows.map(this._rowToMemory);
  }

  /**
   * Return all memories for `userId` regardless of type or limit.
   * Intended for the admin dashboard – avoid in hot paths.
   */
  getAllMemories(userId: string): Memory[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, user_id, type, content, importance, created_at, last_accessed, access_count
           FROM memories
          WHERE user_id = ?
          ORDER BY created_at DESC`,
      )
      .all(userId) as MemoryRow[];
    return rows.map(this._rowToMemory);
  }

  /**
   * Find memories relevant to the current message using a lightweight
   * keyword heuristic.
   *
   * Runs a search with up to the top 5 non-stop words extracted from the
   * message.  Updates access counts on matched memories.
   *
   * @param userId          Internal user id.
   * @param currentMessage  Latest user message text.
   * @param limit           Max memories to return (default 5).
   */
  getRelevantMemories(
    userId: string,
    currentMessage: string,
    limit = 5,
  ): Memory[] {
    // Extract meaningful words (3+ chars, not common stop words).
    const stopWords = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all',
      'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day',
      'get', 'has', 'him', 'his', 'how', 'its', 'let', 'may',
      'new', 'now', 'old', 'see', 'two', 'way', 'who', 'any',
      'did', 'its', 'own', 'use', 'she', 'her', 'that', 'this',
      'with', 'from', 'they', 'been', 'have', 'will', 'what',
      'when', 'than', 'then', 'some', 'more', 'also', 'into',
      'just', 'like', 'very', 'well', 'over', 'such', 'each',
    ]);

    const keywords = currentMessage
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopWords.has(w))
      .slice(0, 5);

    if (keywords.length === 0) {
      // Fallback: return top memories by importance.
      return this.getMemories(userId, undefined, limit);
    }

    // Use the first keyword as the primary search term for broadest coverage.
    const results = this.searchMemories(
      userId,
      keywords.join(' '),
      limit,
    );

    // Bump access counters asynchronously (fire-and-forget).
    for (const mem of results) {
      try {
        this.updateAccessCount(mem.id);
      } catch {
        // Non-fatal.
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private _rowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type as MemoryType,
      content: row.content,
      importance: row.importance,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
    };
  }
}
