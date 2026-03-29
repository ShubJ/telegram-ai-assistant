/**
 * Auth middleware.
 *
 * Ensures every user that interacts with the bot has a corresponding row
 * in the `users` table.  If the row doesn't exist it is created automatically
 * (upsert pattern).
 *
 * IMPORTANT: The users table schema is defined in `db/migrations.ts`.
 * This module works with that schema — do NOT re-create the table here.
 *
 * Also exposes an `adminGuard` middleware factory that rejects commands from
 * non-admin users when the ADMIN_SECRET / admin user list is configured.
 */

import type { Context, NextFunction } from 'grammy';
import { getDb } from '../../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../logger.js';

const logger = createLogger('Auth');

// ---------------------------------------------------------------------------
// User row shape (matches the schema in db/migrations.ts)
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  telegram_id: string;
  username: string | null;
  first_name: string | null;
  is_admin: number; // 0 | 1
  timezone: string;
  preferences: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Upsert helper
// ---------------------------------------------------------------------------

export function upsertUser(from: NonNullable<Context['from']>): UserRow {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare('SELECT * FROM users WHERE telegram_id = ?')
    .get(String(from.id)) as UserRow | undefined;

  if (existing) {
    // Update mutable profile fields
    db.prepare(
      `UPDATE users
       SET username = ?, first_name = ?, updated_at = ?
       WHERE telegram_id = ?`,
    ).run(
      from.username ?? null,
      from.first_name ?? null,
      now,
      String(from.id),
    );

    return {
      ...existing,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      updated_at: now,
    };
  }

  // Create new user
  const id = uuidv4();
  db.prepare(
    `INSERT INTO users
       (id, telegram_id, username, first_name, is_admin, timezone, preferences, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 'UTC', '{}', ?, ?)`,
  ).run(
    id,
    String(from.id),
    from.username ?? null,
    from.first_name ?? null,
    now,
    now,
  );

  logger.info(`New user registered`, { telegramId: from.id, username: from.username ?? 'n/a' });

  return {
    id,
    telegram_id: String(from.id),
    username: from.username ?? null,
    first_name: from.first_name ?? null,
    is_admin: 0,
    timezone: 'UTC',
    preferences: '{}',
    created_at: now,
    updated_at: now,
  };
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

export async function authMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  if (!ctx.from) {
    // No user info (e.g., channel posts) — pass through
    await next();
    return;
  }

  try {
    // Upsert the user and attach to ctx for downstream handlers
    const user = upsertUser(ctx.from);
    // Attach to context via the grammy convention
    (ctx as Context & { user: UserRow }).user = user;
  } catch (err) {
    logger.error('Failed to upsert user', { error: err instanceof Error ? err.message : String(err) });
    // Don't block the user — proceed even if DB write fails
  }

  await next();
}

// ---------------------------------------------------------------------------
// Admin guard factory
// ---------------------------------------------------------------------------

/**
 * Returns a middleware that only allows users whose `is_admin = 1` in the DB.
 * If the user is not found or not admin, sends a refusal message.
 */
export function adminGuard(
  replyText = '⛔ This command is restricted to administrators.',
): (ctx: Context, next: NextFunction) => Promise<void> {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    if (!ctx.from) {
      await ctx.reply(replyText);
      return;
    }

    try {
      const db = getDb();
      const row = db
        .prepare('SELECT is_admin FROM users WHERE telegram_id = ?')
        .get(ctx.from.id) as { is_admin: number } | undefined;

      if (!row || row.is_admin !== 1) {
        await ctx.reply(replyText);
        return;
      }
    } catch {
      await ctx.reply(replyText);
      return;
    }

    await next();
  };
}
