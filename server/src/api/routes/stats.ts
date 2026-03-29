import { Router, type Request, type Response } from 'express';
import { getDb } from '../../db/index.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('API:Stats');

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/stats
// Return aggregated bot statistics (BotStats)
// ---------------------------------------------------------------------------
router.get('/', (_req: Request, res: Response): void => {
  try {
    const db = getDb();

    // Total users
    const totalUsersRow = db
      .prepare('SELECT COUNT(*) AS count FROM users')
      .get() as { count: number };

    // Total messages across all conversations
    const totalMessagesRow = db
      .prepare('SELECT COUNT(*) AS count FROM messages')
      .get() as { count: number };

    // Active conversations: at least one message in the last 24 hours
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const activeConversationsRow = db
      .prepare(
        `
        SELECT COUNT(DISTINCT conversation_id) AS count
        FROM messages
        WHERE created_at >= ?
      `,
      )
      .get(since24h) as { count: number };

    // Total memories
    const memoryCountRow = db
      .prepare('SELECT COUNT(*) AS count FROM memories')
      .get() as { count: number };

    // Total todos
    const todosCountRow = db
      .prepare('SELECT COUNT(*) AS count FROM todos')
      .get() as { count: number };

    // Total reminders
    const remindersCountRow = db
      .prepare('SELECT COUNT(*) AS count FROM reminders')
      .get() as { count: number };

    const stats = {
      totalUsers: totalUsersRow?.count ?? 0,
      totalMessages: totalMessagesRow?.count ?? 0,
      activeConversations: activeConversationsRow?.count ?? 0,
      memoryCount: memoryCountRow?.count ?? 0,
      uptime: process.uptime(),
      todosCount: todosCountRow?.count ?? 0,
      remindersCount: remindersCountRow?.count ?? 0,
    };

    res.json(stats);
  } catch (err) {
    logger.error('[stats] GET / error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stats/activity
// Message counts per day for the last 30 days (for charting)
// Returns: [{ date: 'YYYY-MM-DD', count: number }, ...]
// ---------------------------------------------------------------------------
router.get('/activity', (_req: Request, res: Response): void => {
  try {
    const db = getDb();

    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // SQLite date function to group by calendar day
    const rows = db
      .prepare(
        `
        SELECT
          DATE(created_at) AS date,
          COUNT(*) AS count
        FROM messages
        WHERE created_at >= ?
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `,
      )
      .all(since30d) as Array<{ date: string; count: number }>;

    // Fill in missing days with 0 so the chart has a continuous x-axis
    const dateMap = new Map<string, number>(rows.map((r) => [r.date, r.count]));
    const result: Array<{ date: string; count: number }> = [];

    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD
      result.push({ date: dateStr, count: dateMap.get(dateStr) ?? 0 });
    }

    res.json({ data: result });
  } catch (err) {
    logger.error('[stats] GET /activity error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch activity data' });
  }
});

export default router;
