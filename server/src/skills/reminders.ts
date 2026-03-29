/**
 * ReminderSkill — schedule one-off and recurring reminders.
 *
 * Parses natural-language time expressions and stores them in the
 * `reminders` table.  On startup all active reminders are re-scheduled
 * via node-cron.  When a reminder fires, a Telegram message is sent
 * directly via the bot API.
 */

import * as cron from 'node-cron';
import { BaseSkill, type SkillResult } from './base.js';
import { getDb } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import type { Bot, Context } from 'grammy';
import { createLogger } from '../logger.js';

const logger = createLogger('ReminderSkill');

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface ReminderRow {
  id: string;
  user_id: string;
  telegram_chat_id: string;
  text: string;
  fire_at: string | null;        // ISO datetime for one-off reminders
  cron_expression: string | null; // cron string for recurring reminders
  is_recurring: number;           // 0 | 1
  fired: number;                  // 0 | 1
  created_at: string;
}

// ---------------------------------------------------------------------------
// Time parsing helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to parse a natural-language time expression.
 *
 * Returns either:
 *   { type: 'datetime', fireAt: Date }       — one-off
 *   { type: 'cron', expression: string }     — recurring
 *   null                                     — could not parse
 */
function parseTimeExpression(
  expr: string,
): { type: 'datetime'; fireAt: Date } | { type: 'cron'; expression: string } | null {
  const normalised = expr.toLowerCase().trim();

  // ---- "in X minutes" / "in X hours" / "in X seconds" --------------------
  const inMatch = normalised.match(/^in\s+(\d+)\s+(second|minute|hour)s?$/);
  if (inMatch) {
    const n = parseInt(inMatch[1] ?? '0', 10);
    const unit = inMatch[2];
    const now = new Date();
    if (unit === 'second') now.setSeconds(now.getSeconds() + n);
    else if (unit === 'minute') now.setMinutes(now.getMinutes() + n);
    else if (unit === 'hour') now.setHours(now.getHours() + n);
    return { type: 'datetime', fireAt: now };
  }

  // ---- "tomorrow at HH:MM" ------------------------------------------------
  const tomorrowMatch = normalised.match(/^tomorrow\s+at\s+(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/);
  if (tomorrowMatch) {
    let hour = parseInt(tomorrowMatch[1] ?? '0', 10);
    const minute = parseInt(tomorrowMatch[2] ?? '0', 10);
    const meridiem = tomorrowMatch[3];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    const fireAt = new Date();
    fireAt.setDate(fireAt.getDate() + 1);
    fireAt.setHours(hour, minute, 0, 0);
    return { type: 'datetime', fireAt };
  }

  // ---- "today at HH:MM" ---------------------------------------------------
  const todayMatch = normalised.match(/^today\s+at\s+(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/);
  if (todayMatch) {
    let hour = parseInt(todayMatch[1] ?? '0', 10);
    const minute = parseInt(todayMatch[2] ?? '0', 10);
    const meridiem = todayMatch[3];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    const fireAt = new Date();
    fireAt.setHours(hour, minute, 0, 0);
    if (fireAt <= new Date()) {
      // Already passed — schedule for tomorrow
      fireAt.setDate(fireAt.getDate() + 1);
    }
    return { type: 'datetime', fireAt };
  }

  // ---- "at HH:MM" (shorthand for today/tomorrow) --------------------------
  const atMatch = normalised.match(/^at\s+(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/);
  if (atMatch) {
    let hour = parseInt(atMatch[1] ?? '0', 10);
    const minute = parseInt(atMatch[2] ?? '0', 10);
    const meridiem = atMatch[3];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    const fireAt = new Date();
    fireAt.setHours(hour, minute, 0, 0);
    if (fireAt <= new Date()) {
      fireAt.setDate(fireAt.getDate() + 1);
    }
    return { type: 'datetime', fireAt };
  }

  // ---- "every day at HH:MM" -----------------------------------------------
  const everyDayMatch = normalised.match(
    /^every\s+day\s+at\s+(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/,
  );
  if (everyDayMatch) {
    let hour = parseInt(everyDayMatch[1] ?? '0', 10);
    const minute = parseInt(everyDayMatch[2] ?? '0', 10);
    const meridiem = everyDayMatch[3];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return { type: 'cron', expression: `${minute} ${hour} * * *` };
  }

  // ---- "every weekday at HH:MM" -------------------------------------------
  const everyWeekdayMatch = normalised.match(
    /^every\s+weekday\s+at\s+(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/,
  );
  if (everyWeekdayMatch) {
    let hour = parseInt(everyWeekdayMatch[1] ?? '0', 10);
    const minute = parseInt(everyWeekdayMatch[2] ?? '0', 10);
    const meridiem = everyWeekdayMatch[3];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return { type: 'cron', expression: `${minute} ${hour} * * 1-5` };
  }

  // ---- "every Monday/Tuesday/... at HH:MM" --------------------------------
  const dayNames: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const everyDowMatch = normalised.match(
    /^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/,
  );
  if (everyDowMatch) {
    const dow = dayNames[everyDowMatch[1] ?? ''];
    let hour = parseInt(everyDowMatch[2] ?? '0', 10);
    const minute = parseInt(everyDowMatch[3] ?? '0', 10);
    const meridiem = everyDowMatch[4];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (dow !== undefined) {
      return { type: 'cron', expression: `${minute} ${hour} * * ${dow}` };
    }
  }

  // ---- "every X minutes/hours" --------------------------------------------
  const everyIntervalMatch = normalised.match(/^every\s+(\d+)\s+(minute|hour)s?$/);
  if (everyIntervalMatch) {
    const n = parseInt(everyIntervalMatch[1] ?? '1', 10);
    const unit = everyIntervalMatch[2];
    if (unit === 'minute') {
      return { type: 'cron', expression: `*/${n} * * * *` };
    } else {
      return { type: 'cron', expression: `0 */${n} * * *` };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Skill
// ---------------------------------------------------------------------------

export class ReminderSkill extends BaseSkill {
  readonly name = 'reminders';
  readonly description = 'Set one-off and recurring reminders with natural language time expressions.';

  getToolDefinition() {
    return {
      name: 'reminders',
      description:
        'Set, list, and remove reminders. Supports natural-language time expressions like "in 10 minutes", "tomorrow at 9am", "every day at 8:00".',
      input_schema: {
        type: 'object' as const,
        properties: {
          action: {
            type: 'string',
            enum: ['add', 'list', 'remove', 'complete'],
            description: 'The operation to perform.',
          },
          text: {
            type: 'string',
            description: 'The reminder message text (required for "add").',
          },
          time: {
            type: 'string',
            description:
              'Natural-language time expression for when the reminder should fire (required for "add"). Examples: "in 10 minutes", "tomorrow at 9:00", "every day at 8:00", "every Monday at 3pm".',
          },
          reminderId: {
            type: 'string',
            description: 'The ID (or 8-char prefix) of the reminder (required for "remove" and "complete").',
          },
        },
        required: ['action'],
      },
    };
  }

  /** live node-cron tasks, keyed by reminder UUID */
  private readonly scheduledTasks = new Map<string, cron.ScheduledTask>();

  /** bot reference injected after construction */
  private bot: Bot<Context> | null = null;

  /** Set the bot instance so the skill can send Telegram messages. */
  setBot(bot: Bot<Context>): void {
    this.bot = bot;
  }

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const action = typeof params['action'] === 'string' ? params['action'] : '';
    const userId = typeof params['userId'] === 'string' ? params['userId'] : '';
    const chatId = typeof params['chatId'] === 'string' ? params['chatId'] : userId;

    if (!userId) return this.failure('userId is required.');

    this.ensureTable();

    switch (action) {
      case 'add':
        return this.addReminder(
          userId,
          chatId,
          typeof params['text'] === 'string' ? params['text'] : '',
          typeof params['time'] === 'string' ? params['time'] : '',
        );
      case 'list':
        return this.listReminders(userId);
      case 'remove':
        return this.removeReminder(
          userId,
          typeof params['reminderId'] === 'string' ? params['reminderId'] : '',
        );
      case 'complete':
        return this.completeReminder(
          userId,
          typeof params['reminderId'] === 'string' ? params['reminderId'] : '',
        );
      default:
        return this.failure(
          `Unknown action "${action}". Use add, list, remove, or complete.`,
        );
    }
  }

  /**
   * Load all active reminders from the DB and re-schedule them.
   * Call this once at application startup after the bot is set.
   */
  async loadAndScheduleAll(): Promise<void> {
    this.ensureTable();
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM reminders
         WHERE fired = 0
         ORDER BY created_at ASC`,
      )
      .all() as ReminderRow[];

    let scheduled = 0;
    const now = new Date();

    for (const row of rows) {
      if (row.is_recurring) {
        if (row.cron_expression) {
          this.scheduleCron(row);
          scheduled++;
        }
      } else if (row.fire_at) {
        const fireAt = new Date(row.fire_at);
        if (fireAt > now) {
          this.scheduleOnce(row, fireAt);
          scheduled++;
        } else {
          // Missed reminder — fire immediately
          await this.fireReminder(row);
        }
      }
    }

    if (scheduled > 0) {
      logger.info(`Re-scheduled ${scheduled} reminder(s) from DB.`);
    }
  }

  // ---------------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------------

  private addReminder(
    userId: string,
    chatId: string,
    text: string,
    timeExpr: string,
  ): SkillResult {
    if (!text.trim()) {
      return this.failure('Please provide reminder text. Usage: /remind <time> <text>');
    }
    if (!timeExpr.trim()) {
      return this.failure(
        'Please provide a time expression.\n' +
          'Examples: "in 10 minutes", "tomorrow at 9am", "every day at 8:00"',
      );
    }

    const parsed = parseTimeExpression(timeExpr);
    if (!parsed) {
      return this.failure(
        `Could not parse time expression: "${timeExpr}"\n\n` +
          'Supported formats:\n' +
          '• in X minutes / in X hours\n' +
          '• today at HH:MM / tomorrow at HH:MM\n' +
          '• at HH:MM\n' +
          '• every day at HH:MM\n' +
          '• every weekday at HH:MM\n' +
          '• every Monday at HH:MM\n' +
          '• every X minutes / every X hours',
      );
    }

    const db = getDb();
    const id = uuidv4();
    const now = new Date().toISOString();
    const isRecurring = parsed.type === 'cron' ? 1 : 0;
    const fireAt = parsed.type === 'datetime' ? parsed.fireAt.toISOString() : null;
    const cronExpr = parsed.type === 'cron' ? parsed.expression : null;

    db.prepare(
      `INSERT INTO reminders
         (id, user_id, telegram_chat_id, text, fire_at, cron_expression, is_recurring, fired, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(id, userId, chatId, text.trim(), fireAt, cronExpr, isRecurring, now);

    const row = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) as ReminderRow;

    if (parsed.type === 'datetime') {
      this.scheduleOnce(row, parsed.fireAt);
      const fireStr = parsed.fireAt.toLocaleString('en-GB', { timeZone: 'UTC' });
      return this.success(
        `⏰ Reminder set!\n*"${this.escape(text.trim())}"*\nFires at: ${fireStr} UTC\nID: \`${id.slice(0, 8)}\``,
        { id },
      );
    } else {
      this.scheduleCron(row);
      return this.success(
        `🔁 Recurring reminder set!\n*"${this.escape(text.trim())}"*\nSchedule: \`${cronExpr}\`\nID: \`${id.slice(0, 8)}\``,
        { id },
      );
    }
  }

  private listReminders(userId: string): SkillResult {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM reminders
         WHERE user_id = ? AND fired = 0
         ORDER BY created_at ASC`,
      )
      .all(userId) as ReminderRow[];

    if (rows.length === 0) {
      return this.success(
        'You have no active reminders. Use /remind <time> <text> to set one.',
      );
    }

    const lines = ['*Your Reminders:*', ''];
    rows.forEach((row) => {
      const shortId = row.id.slice(0, 8);
      const icon = row.is_recurring ? '🔁' : '⏰';
      const timing =
        row.is_recurring && row.cron_expression
          ? `Cron: \`${row.cron_expression}\``
          : row.fire_at
            ? `At: ${new Date(row.fire_at).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC`
            : 'N/A';
      lines.push(`${icon} \`${shortId}\` ${this.escape(row.text)}`);
      lines.push(`   _${timing}_`);
    });

    lines.push('');
    lines.push('_Use /remind remove <id> to delete_');

    return this.success(lines.join('\n'), {
      reminders: rows.map((r) => ({
        id: r.id,
        text: r.text,
        fireAt: r.fire_at,
        cronExpression: r.cron_expression,
        isRecurring: r.is_recurring === 1,
      })),
    });
  }

  private removeReminder(userId: string, reminderId: string): SkillResult {
    if (!reminderId.trim()) {
      return this.failure('Please provide a reminder ID. Usage: /remind remove <id>');
    }

    const db = getDb();
    const row = this.findReminder(userId, reminderId);

    if (!row) {
      return this.failure(`No active reminder found with ID starting with "${reminderId}".`);
    }

    // Cancel scheduled task
    const task = this.scheduledTasks.get(row.id);
    if (task) {
      task.stop();
      this.scheduledTasks.delete(row.id);
    }

    db.prepare('DELETE FROM reminders WHERE id = ?').run(row.id);

    return this.success(`🗑️ Removed reminder: *"${this.escape(row.text)}"*`, { id: row.id });
  }

  private completeReminder(userId: string, reminderId: string): SkillResult {
    if (!reminderId.trim()) {
      return this.failure('Please provide a reminder ID.');
    }

    const db = getDb();
    const row = this.findReminder(userId, reminderId);

    if (!row) {
      return this.failure(`No active reminder found with ID starting with "${reminderId}".`);
    }

    const task = this.scheduledTasks.get(row.id);
    if (task) {
      task.stop();
      this.scheduledTasks.delete(row.id);
    }

    db.prepare('UPDATE reminders SET fired = 1 WHERE id = ?').run(row.id);

    return this.success(`✅ Reminder completed: *"${this.escape(row.text)}"*`, { id: row.id });
  }

  // ---------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------

  private scheduleOnce(row: ReminderRow, fireAt: Date): void {
    const delayMs = fireAt.getTime() - Date.now();
    if (delayMs <= 0) return;

    const timeoutId = setTimeout(() => {
      void this.fireReminder(row);
    }, delayMs);

    // Wrap setTimeout in a fake ScheduledTask-compatible object so we can stop it
    const pseudoTask: cron.ScheduledTask = {
      stop: () => clearTimeout(timeoutId),
      start: () => {
        /* no-op */
      },
      destroy: () => clearTimeout(timeoutId),
      getStatus: () => 'scheduled',
    } as unknown as cron.ScheduledTask;

    this.scheduledTasks.set(row.id, pseudoTask);
  }

  private scheduleCron(row: ReminderRow): void {
    if (!row.cron_expression) return;

    if (!cron.validate(row.cron_expression)) {
      logger.warn(`Invalid cron expression for reminder ${row.id}: "${row.cron_expression}"`);
      return;
    }

    const task = cron.schedule(row.cron_expression, () => {
      void this.fireReminder(row);
    });

    this.scheduledTasks.set(row.id, task);
  }

  private async fireReminder(row: ReminderRow): Promise<void> {
    logger.info(`Firing reminder ${row.id} for user ${row.user_id}`);

    try {
      if (this.bot) {
        await this.bot.api.sendMessage(
          row.telegram_chat_id,
          `⏰ *Reminder:* ${row.text}`,
          { parse_mode: 'Markdown' },
        );
      } else {
        logger.warn(`Bot not set, cannot send reminder ${row.id}`);
      }
    } catch (err) {
      logger.error(`Failed to send reminder ${row.id}`, { error: err instanceof Error ? err.message : String(err) });
    }

    // Mark one-off reminders as fired; recurring ones stay active
    if (!row.is_recurring) {
      const db = getDb();
      db.prepare('UPDATE reminders SET fired = 1 WHERE id = ?').run(row.id);
      this.scheduledTasks.delete(row.id);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private findReminder(userId: string, idOrPrefix: string): ReminderRow | undefined {
    const db = getDb();
    const trimmed = idOrPrefix.trim();

    return (
      (db
        .prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ? AND fired = 0')
        .get(trimmed, userId) as ReminderRow | undefined) ??
      (db
        .prepare(
          'SELECT * FROM reminders WHERE id LIKE ? AND user_id = ? AND fired = 0',
        )
        .get(`${trimmed}%`, userId) as ReminderRow | undefined)
    );
  }

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
  }

  private ensureTable(): void {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL,
        telegram_chat_id  TEXT NOT NULL,
        text              TEXT NOT NULL,
        fire_at           TEXT,
        cron_expression   TEXT,
        is_recurring      INTEGER NOT NULL DEFAULT 0,
        fired             INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id, fired);
    `);
  }
}
