import { Router, type Request, type Response } from 'express';
import { getDb } from '../../db/index.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('API:Users');

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/users
// List all users
// ---------------------------------------------------------------------------
router.get('/', (_req: Request, res: Response): void => {
  try {
    const db = getDb();

    const users = db
      .prepare(
        `
        SELECT
          id,
          telegram_id,
          username,
          first_name,
          last_name,
          timezone,
          preferences,
          is_admin,
          created_at,
          last_seen_at
        FROM users
        ORDER BY created_at DESC
      `,
      )
      .all();

    res.json({ data: users });
  } catch (err) {
    logger.error('[users] GET / error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/users/:id
// Get user details with stats (message count, memory count)
// ---------------------------------------------------------------------------
router.get('/:id', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;

    const user = db
      .prepare(
        `
        SELECT
          id,
          telegram_id,
          username,
          first_name,
          last_name,
          timezone,
          preferences,
          is_admin,
          created_at,
          last_seen_at
        FROM users
        WHERE id = ?
      `,
      )
      .get(id);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Message count across all conversations for this user
    const messageCountRow = db
      .prepare(
        `
        SELECT COUNT(m.id) AS count
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.user_id = ?
      `,
      )
      .get(id) as { count: number };

    // Memory count for this user
    const memoryCountRow = db
      .prepare('SELECT COUNT(*) AS count FROM memories WHERE user_id = ?')
      .get(id) as { count: number };

    // Conversation count
    const conversationCountRow = db
      .prepare('SELECT COUNT(*) AS count FROM conversations WHERE user_id = ?')
      .get(id) as { count: number };

    res.json({
      ...user as object,
      stats: {
        messageCount: messageCountRow?.count ?? 0,
        memoryCount: memoryCountRow?.count ?? 0,
        conversationCount: conversationCountRow?.count ?? 0,
      },
    });
  } catch (err) {
    logger.error('[users] GET /:id error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/users/:id
// Update user: timezone, preferences, isAdmin
// ---------------------------------------------------------------------------
router.put('/:id', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { timezone, preferences, isAdmin } = req.body as {
      timezone?: string;
      preferences?: Record<string, unknown>;
      isAdmin?: boolean;
    };

    // Build dynamic SET clause only for provided fields
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (timezone !== undefined) {
      if (typeof timezone !== 'string' || timezone.trim().length === 0) {
        res.status(400).json({ error: 'timezone must be a non-empty string' });
        return;
      }
      setClauses.push('timezone = ?');
      params.push(timezone.trim());
    }

    if (preferences !== undefined) {
      if (typeof preferences !== 'object' || preferences === null || Array.isArray(preferences)) {
        res.status(400).json({ error: 'preferences must be an object' });
        return;
      }
      setClauses.push('preferences = ?');
      params.push(JSON.stringify(preferences));
    }

    if (isAdmin !== undefined) {
      if (typeof isAdmin !== 'boolean') {
        res.status(400).json({ error: 'isAdmin must be a boolean' });
        return;
      }
      setClauses.push('is_admin = ?');
      params.push(isAdmin ? 1 : 0);
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    params.push(id);

    db.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    const updated = db
      .prepare(
        `
        SELECT id, telegram_id, username, first_name, last_name,
               timezone, preferences, is_admin, created_at, last_seen_at
        FROM users WHERE id = ?
      `,
      )
      .get(id);

    res.json(updated);
  } catch (err) {
    logger.error('[users] PUT /:id error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/users/:id
// Delete user and all their data (conversations, messages, memories, todos, reminders)
// ---------------------------------------------------------------------------
router.delete('/:id', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const deleteAll = db.transaction(() => {
      // Delete messages via conversations
      db.prepare(
        `
        DELETE FROM messages
        WHERE conversation_id IN (
          SELECT id FROM conversations WHERE user_id = ?
        )
      `,
      ).run(id);

      db.prepare('DELETE FROM conversations WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM memories WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM todos WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM reminders WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });

    deleteAll();

    res.json({ success: true, message: 'User and all associated data deleted' });
  } catch (err) {
    logger.error('[users] DELETE /:id error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
