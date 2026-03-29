import { Router, type Request, type Response } from 'express';
import { getDb } from '../../db/index.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('API:Todos');

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/todos
// List todos with optional filters: userId, completed
// Query params: userId, completed (true/false), page, limit
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
    const completedParam = req.query.completed as string | undefined;

    const conditions: string[] = [];
    const filterParams: unknown[] = [];

    if (userId) {
      conditions.push('t.user_id = ?');
      filterParams.push(userId);
    }

    if (completedParam !== undefined) {
      const isCompleted = completedParam === 'true' || completedParam === '1';
      conditions.push('t.completed = ?');
      filterParams.push(isCompleted ? 1 : 0);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `
        SELECT
          t.id,
          t.user_id,
          t.text,
          t.completed,
          t.due_at,
          t.created_at,
          t.updated_at,
          u.username,
          u.first_name,
          u.last_name
        FROM todos t
        LEFT JOIN users u ON u.id = t.user_id
        ${whereClause}
        ORDER BY t.created_at DESC
        LIMIT ? OFFSET ?
      `,
      )
      .all(...filterParams, limit, offset);

    const countRow = db
      .prepare(`SELECT COUNT(*) AS total FROM todos t ${whereClause}`)
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
    logger.error('[todos] GET / error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch todos' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/todos/:id
// Update a todo: text, completed, due_at
// Body: { text?, completed?, dueAt? }
// ---------------------------------------------------------------------------
router.put('/:id', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT id FROM todos WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    const { text, completed, dueAt } = req.body as {
      text?: string;
      completed?: boolean;
      dueAt?: string | null;
    };

    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (text !== undefined) {
      if (typeof text !== 'string' || text.trim().length === 0) {
        res.status(400).json({ error: 'text must be a non-empty string' });
        return;
      }
      setClauses.push('text = ?');
      params.push(text.trim());
    }

    if (completed !== undefined) {
      if (typeof completed !== 'boolean') {
        res.status(400).json({ error: 'completed must be a boolean' });
        return;
      }
      setClauses.push('completed = ?');
      params.push(completed ? 1 : 0);
    }

    if (dueAt !== undefined) {
      if (dueAt !== null && typeof dueAt !== 'string') {
        res.status(400).json({ error: 'dueAt must be an ISO date string or null' });
        return;
      }
      setClauses.push('due_at = ?');
      params.push(dueAt);
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    setClauses.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    db.prepare(`UPDATE todos SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    const updated = db
      .prepare(
        `
        SELECT
          t.id, t.user_id, t.text, t.completed, t.due_at, t.created_at, t.updated_at,
          u.username, u.first_name, u.last_name
        FROM todos t
        LEFT JOIN users u ON u.id = t.user_id
        WHERE t.id = ?
      `,
      )
      .get(id);

    res.json(updated);
  } catch (err) {
    logger.error('[todos] PUT /:id error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to update todo' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/todos/:id
// Delete a todo
// ---------------------------------------------------------------------------
router.delete('/:id', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT id FROM todos WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    db.prepare('DELETE FROM todos WHERE id = ?').run(id);

    res.json({ success: true, message: 'Todo deleted' });
  } catch (err) {
    logger.error('[todos] DELETE /:id error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to delete todo' });
  }
});

export default router;
