import { Router, type Request, type Response } from 'express';
import { getDb } from '../../db/index.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('API:Memories');

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/memories
// List memories with optional filters: userId, type, pagination
// Query params: userId, type, page, limit
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
    const type = req.query.type as string | undefined;

    // Build WHERE clause dynamically
    const conditions: string[] = [];
    const filterParams: unknown[] = [];

    if (userId) {
      conditions.push('m.user_id = ?');
      filterParams.push(userId);
    }

    if (type) {
      conditions.push('m.type = ?');
      filterParams.push(type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `
        SELECT
          m.id,
          m.user_id,
          m.type,
          m.content,
          m.importance,
          m.created_at,
          m.updated_at,
          u.username,
          u.first_name,
          u.last_name
        FROM memories m
        LEFT JOIN users u ON u.id = m.user_id
        ${whereClause}
        ORDER BY m.importance DESC, m.created_at DESC
        LIMIT ? OFFSET ?
      `,
      )
      .all(...filterParams, limit, offset);

    const countRow = db
      .prepare(`SELECT COUNT(*) AS total FROM memories m ${whereClause}`)
      .get(...filterParams) as { total: number };

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
    logger.error('[memories] GET / error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch memories' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/memories/:id
// Get a single memory
// ---------------------------------------------------------------------------
router.get('/:id', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;

    const memory = db
      .prepare(
        `
        SELECT
          m.id,
          m.user_id,
          m.type,
          m.content,
          m.importance,
          m.created_at,
          m.updated_at,
          u.username,
          u.first_name,
          u.last_name
        FROM memories m
        LEFT JOIN users u ON u.id = m.user_id
        WHERE m.id = ?
      `,
      )
      .get(id);

    if (!memory) {
      res.status(404).json({ error: 'Memory not found' });
      return;
    }

    res.json(memory);
  } catch (err) {
    logger.error('[memories] GET /:id error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch memory' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/memories
// Create a memory manually
// Body: { userId, type, content, importance? }
// ---------------------------------------------------------------------------
router.post('/', (req: Request, res: Response): void => {
  try {
    const db = getDb();

    const { userId, type, content, importance } = req.body as {
      userId?: string;
      type?: string;
      content?: string;
      importance?: number;
    };

    if (!userId || typeof userId !== 'string') {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    if (!type || typeof type !== 'string' || type.trim().length === 0) {
      res.status(400).json({ error: 'type is required' });
      return;
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    // Validate user exists
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const importanceValue =
      importance !== undefined
        ? Math.min(10, Math.max(1, Math.round(Number(importance))))
        : 5;

    const now = new Date().toISOString();

    const result = db
      .prepare(
        `
        INSERT INTO memories (user_id, type, content, importance, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .run(userId, type.trim(), content.trim(), importanceValue, now, now);

    const created = db
      .prepare('SELECT * FROM memories WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json(created);
  } catch (err) {
    logger.error('[memories] POST / error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to create memory' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/memories/:id
// Edit memory content and/or importance
// Body: { content?, importance? }
// ---------------------------------------------------------------------------
router.put('/:id', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT id FROM memories WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Memory not found' });
      return;
    }

    const { content, importance } = req.body as {
      content?: string;
      importance?: number;
    };

    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (content !== undefined) {
      if (typeof content !== 'string' || content.trim().length === 0) {
        res.status(400).json({ error: 'content must be a non-empty string' });
        return;
      }
      setClauses.push('content = ?');
      params.push(content.trim());
    }

    if (importance !== undefined) {
      const imp = Math.min(10, Math.max(1, Math.round(Number(importance))));
      if (isNaN(imp)) {
        res.status(400).json({ error: 'importance must be a number between 1 and 10' });
        return;
      }
      setClauses.push('importance = ?');
      params.push(imp);
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    setClauses.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    db.prepare(`UPDATE memories SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);

    res.json(updated);
  } catch (err) {
    logger.error('[memories] PUT /:id error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to update memory' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/memories/:id
// Delete a single memory
// ---------------------------------------------------------------------------
router.delete('/:id', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT id FROM memories WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Memory not found' });
      return;
    }

    db.prepare('DELETE FROM memories WHERE id = ?').run(id);

    res.json({ success: true, message: 'Memory deleted' });
  } catch (err) {
    logger.error('[memories] DELETE /:id error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

export default router;
