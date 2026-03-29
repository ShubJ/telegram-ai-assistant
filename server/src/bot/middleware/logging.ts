/**
 * Logging middleware.
 *
 * Logs metadata about every incoming Telegram update:
 *  - update type (message, callback_query, etc.)
 *  - user ID and username (not the full message text, for privacy)
 *  - command name or a truncated preview if it's a plain text message
 *  - processing time once the next() chain returns
 *
 * Full message content is intentionally NOT logged.
 */

import type { Context, NextFunction } from 'grammy';
import { createLogger } from '../../logger.js';

const logger = createLogger('BotMiddleware');

export async function loggingMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const startMs = Date.now();

  // ---- Extract metadata ---------------------------------------------------
  const userId = ctx.from?.id ?? 'unknown';
  const username = ctx.from?.username ? `@${ctx.from.username}` : String(userId);
  const chatId = ctx.chat?.id ?? 'unknown';
  const updateType = ctx.update?.message ? 'message' :
    ctx.update?.callback_query ? 'callback_query' :
    ctx.update?.edited_message ? 'edited_message' : 'unknown';

  let preview = '';

  if (ctx.message?.text) {
    const text = ctx.message.text;
    if (text.startsWith('/')) {
      // Log command name but not its arguments
      preview = `[command: ${text.split(' ')[0]}]`;
    } else {
      // Log only character count, not content
      preview = `[text: ${text.length} chars]`;
    }
  } else if (ctx.callbackQuery?.data) {
    preview = `[callback: ${ctx.callbackQuery.data.slice(0, 20)}]`;
  } else if (ctx.message?.photo) {
    preview = '[photo]';
  } else if (ctx.message?.document) {
    preview = '[document]';
  } else if (ctx.message?.sticker) {
    preview = '[sticker]';
  } else if (ctx.message?.voice) {
    preview = '[voice]';
  }

  logger.info(`Incoming update`, { user: username, chat: chatId, type: updateType, preview });

  // ---- Pass to next middleware --------------------------------------------
  await next();

  // ---- Log response time --------------------------------------------------
  const elapsed = Date.now() - startMs;
  logger.info(`Handled ${updateType} for ${username} in ${elapsed}ms`);
}
