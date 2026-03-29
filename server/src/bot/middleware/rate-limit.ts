/**
 * Rate-limit middleware.
 *
 * In-memory per-user sliding window:
 *   - Default: 30 messages per 60-second window
 *   - When exceeded: replies with a friendly message and stops processing
 *
 * The map is cleaned up automatically so it doesn't grow unboundedly.
 */

import type { Context, NextFunction } from 'grammy';

interface RateLimitEntry {
  count: number;
  resetTime: number; // epoch ms when the window resets
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000;  // 1 minute
const MAX_MESSAGES = 30;   // per window
const CLEANUP_INTERVAL_MS = 5 * 60_000; // prune expired entries every 5 min

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const rateLimitMap = new Map<number, RateLimitEntry>();

// Periodic cleanup to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of rateLimitMap.entries()) {
    if (entry.resetTime <= now) {
      rateLimitMap.delete(userId);
    }
  }
}, CLEANUP_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function rateLimitMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;

  // Skip if we can't identify the user (e.g., channel posts)
  if (userId === undefined) {
    await next();
    return;
  }

  const now = Date.now();
  let entry = rateLimitMap.get(userId);

  if (!entry || entry.resetTime <= now) {
    // Start a fresh window
    entry = { count: 1, resetTime: now + WINDOW_MS };
    rateLimitMap.set(userId, entry);
    await next();
    return;
  }

  // Increment within the current window
  entry.count += 1;

  if (entry.count > MAX_MESSAGES) {
    const secondsLeft = Math.ceil((entry.resetTime - now) / 1000);
    await ctx.reply(
      `⚠️ You're sending messages too fast!\n\n` +
        `Please wait ${secondsLeft} second${secondsLeft === 1 ? '' : 's'} before sending another message.\n\n` +
        `_Limit: ${MAX_MESSAGES} messages per minute._`,
      { parse_mode: 'Markdown' },
    );
    return; // do NOT call next()
  }

  await next();
}
