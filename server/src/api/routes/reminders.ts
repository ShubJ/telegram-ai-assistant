import { Router, type Request, type Response } from 'express';
import { getDb } from '../../db/index.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('API:Reminders');

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/reminders
// List reminders with optional filters: userId, active
// Query params: userId, active (true/false), page, limit
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
    const activeParam = req.query.active as string | undefined;

    const conditions: string[] = [];
    const filterParams: unknown[] = [];

    if (userId) {
      conditions.push('r.user_id = ?');
      filterParams.push(userId);
    }

    if (activeParam !== undefined) {
      const isActive = activeParam === 'true' || activeParam === '1';
      conditions.push('r.is_active = ?');
      filterParams.push(isActive ? 1 : 0);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `
        SELECT
          r.id,
          r.user_id,
          r.text,
          r.remind_at,
          r.is_active,
          r.recurrence,
          r.created_at,
          r.updated_at,
          u.username,
          u.first_name,
          u.last_name
        FROM reminders r
        LEFT JOIN users u ON u.id = r.user_id
        ${whereClause}
        ORDER BY r.remind_at ASC
        LIMIT ? OFFSET ?
      `,
      )
      .all(...filterParams, limit, offset);

    const countRow = db
      .prepare(`SELECT COUNT(*) AS total FROM reminders r ${whereClause}`)
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
    logger.error('[reminders] GET / error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/reminders/:id
// Update a reminder: text, remindAt, isActive, recurrence
// Body: { text?, remindAt?, isActive?, recurrence? }
// ---------------------------------------------------------------------------
router.put('/:id', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT id FROM reminders WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Reminder not found' });
      return;
    }

    const { text, remindAt, isActive, recurrence } = req.body as {
      text?: string;
      remindAt?: string;
      isActive?: boolean;
      recurrence?: string | null;
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

    if (remindAt !== undefined) {
      if (typeof remindAt !== 'string' || isNaN(Date.parse(remindAt))) {
        res.status(400).json({ error: 'remindAt must be a valid ISO date string' });
        return;
      }
      setClauses.push('remind_at = ?');
      params.push(remindAt);
    }

    if (isActive !== undefined) {
      if (typeof isActive !== 'boolean') {
        res.status(400).json({ error: 'isActive must be a boolean' });
        return;
      }
      setClauses.push('is_active = ?');
      params.push(isActive ? 1 : 0);
    }

    if (recurrence !== undefined) {
      if (recurrence !== null && typeof recurrence !== 'string') {
        res.status(400).json({ error: 'recurrence must be a string or null' });
        return;
      }
      setClauses.push('recurrence = ?');
      params.push(recurrence);
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    setClauses.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    db.prepare(`UPDATE reminders SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    const updated = db
      .prepare(
        `
        SELECT
          r.id, r.user_id, r.text, r.remind_at, r.is_active, r.recurrence,
          r.created_at, r.updated_at,
          u.username, u.first_name, u.last_name
        FROM reminders r
        LEFT JOIN users u ON u.id = r.user_id
        WHERE r.id = ?
      `,
      )
      .get(id);

    res.json(updated);
  } catch (err) {
    logger.error('[reminders] PUT /:id error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to update reminder' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/reminders/:id
// Delete a reminder
// ---------------------------------------------------------------------------
router.delete('/:id', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT id FROM reminders WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Reminder not found' });
      return;
    }

    db.prepare('DELETE FROM reminders WHERE id = ?').run(id);

    res.json({ success: true, message: 'Reminder deleted' });
  } catch (err) {
    logger.error('[reminders] DELETE /:id error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

export default router;
