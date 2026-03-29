import { Router, type Request, type Response } from 'express';
import { getDb } from '../../db/index.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('API:Conversations');

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/conversations
// List all conversations with optional pagination and userId filter
// Query params: page (1-based), limit, userId
// ---------------------------------------------------------------------------
router.get('/', (req: Request, res: Response): void => {
  try {
    const db = getDb();

    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt((req.query.limit as string) ?? '20', 10) || 20),
    );
    const offset = (page - 1) * limit;
    const userId = req.query.userId as string | undefined;

    let query: string;
    let countQuery: string;

    if (userId) {
      query = `
        SELECT
          c.id,
          c.user_id,
          c.started_at,
          c.last_message_at,
          COUNT(m.id) AS message_count,
          u.username,
          u.first_name,
          u.last_name
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        LEFT JOIN users u ON u.id = c.user_id
        WHERE c.user_id = ?
        GROUP BY c.id
        ORDER BY c.last_message_at DESC
        LIMIT ? OFFSET ?
      `;
      countQuery = `SELECT COUNT(*) AS total FROM conversations WHERE user_id = ?`;
    } else {
      query = `
        SELECT
          c.id,
          c.user_id,
          c.started_at,
          c.last_message_at,
          COUNT(m.id) AS message_count,
          u.username,
          u.first_name,
          u.last_name
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        LEFT JOIN users u ON u.id = c.user_id
        GROUP BY c.id
        ORDER BY c.last_message_at DESC
        LIMIT ? OFFSET ?
      `;
      countQuery = `SELECT COUNT(*) AS total FROM conversations`;
    }

    const rows = userId
      ? db.prepare(query).all(userId, limit, offset)
      : db.prepare(query).all(limit, offset);

    const countRow = userId
      ? (db.prepare(countQuery).get(userId) as { total: number })
      : (db.prepare(countQuery).get() as { total: number });

    const total = countRow?.total ?? 0;

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error('[conversations] GET / error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/conversations/:id
// Get a single conversation with all its messages
// ---------------------------------------------------------------------------
router.get('/:id', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;

    const conversation = db
      .prepare(
        `
        SELECT
          c.id,
          c.user_id,
          c.started_at,
          c.last_message_at,
          u.username,
          u.first_name,
          u.last_name
        FROM conversations c
        LEFT JOIN users u ON u.id = c.user_id
        WHERE c.id = ?
      `,
      )
      .get(id);

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const messages = db
      .prepare(
        `
        SELECT id, conversation_id, role, content, created_at, tokens_used
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
      `,
      )
      .all(id);

    res.json({ ...conversation as object, messages });
  } catch (err) {
    logger.error('[conversations] GET /:id error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/conversations/:id/messages
// Get messages for a conversation with pagination
// Query params: page, limit
// ---------------------------------------------------------------------------
router.get('/:id/messages', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;

    // Verify conversation exists
    const conversation = db
      .prepare('SELECT id FROM conversations WHERE id = ?')
      .get(id);

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10) || 1);
    const limit = Math.min(
      200,
      Math.max(1, parseInt((req.query.limit as string) ?? '50', 10) || 50),
    );
    const offset = (page - 1) * limit;

    const messages = db
      .prepare(
        `
        SELECT id, conversation_id, role, content, created_at, tokens_used
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
        LIMIT ? OFFSET ?
      `,
      )
      .all(id, limit, offset);

    const countRow = db
      .prepare('SELECT COUNT(*) AS total FROM messages WHERE conversation_id = ?')
      .get(id) as { total: number };

    const total = countRow?.total ?? 0;

    res.json({
      data: messages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error('[conversations] GET /:id/messages error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/conversations/:id
// Delete a conversation and all its messages
// ---------------------------------------------------------------------------
router.delete('/:id', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;

    const conversation = db
      .prepare('SELECT id FROM conversations WHERE id = ?')
      .get(id);

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Use a transaction to delete messages first, then the conversation
    const deleteTransaction = db.transaction(() => {
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    });

    deleteTransaction();

    res.json({ success: true, message: 'Conversation deleted' });
  } catch (err) {
    logger.error('[conversations] DELETE /:id error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

export default router;
