/**
 * Skill command handlers.
 *
 * Routes skill-specific commands to the appropriate skill in the registry.
 *
 *  /todo add|list|done|remove ...
 *  /remind <time> <text> | list | remove <id>
 *  /weather <city>
 *  /search <query>
 */

import type { Context } from 'grammy';
import { skillRegistry } from '../../skills/index.js';
import { getMemoryManager } from '../../memory/index.js';
import { escapeMd } from './commands.js';

// ---------------------------------------------------------------------------
// /todo
// ---------------------------------------------------------------------------

export async function handleTodo(ctx: Context): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('Could not identify you. Please try again.');
    return;
  }

  const rawText = ctx.message?.text ?? '';
  // Strip command prefix and split on first whitespace
  const args = rawText.replace(/^\/todo(?:@\S+)?\s*/i, '').trim();

  if (!args) {
    await ctx.reply(
      '*Todo Commands:*\n\n' +
        '/todo add \\<text\\> \\- Add a new item\n' +
        '/todo list \\- Show pending items\n' +
        '/todo done \\<id\\> \\- Mark as complete\n' +
        '/todo remove \\<id\\> \\- Delete an item\n\n' +
        '_Priority can be appended: `high`, `medium` \\(default\\), `low`_',
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  const todoSkill = skillRegistry.get('todos');
  if (!todoSkill || !todoSkill.isEnabled()) {
    await ctx.reply('❌ The todo skill is currently disabled.');
    return;
  }

  const memoryManager = getMemoryManager();
  const userProfile = memoryManager.userProfile.getOrCreateUser(
    String(ctx.from.id),
    ctx.from.username,
    ctx.from.first_name,
  );

  // Parse sub-command
  const parts = args.split(/\s+/);
  const subCommand = (parts[0] ?? '').toLowerCase();
  const rest = parts.slice(1).join(' ').trim();

  let result;

  switch (subCommand) {
    case 'add': {
      // Optional trailing priority keyword
      const priorityMatch = rest.match(/\s+(high|medium|low)$/i);
      const priority = (priorityMatch?.[1]?.toLowerCase() ?? 'medium') as 'high' | 'medium' | 'low';
      const text = priorityMatch ? rest.slice(0, rest.lastIndexOf(priorityMatch[0])).trim() : rest;

      result = await todoSkill.execute({
        action: 'add',
        userId: userProfile.id,
        text,
        priority,
      });
      break;
    }
    case 'list':
      result = await todoSkill.execute({ action: 'list', userId: userProfile.id });
      break;
    case 'done':
      result = await todoSkill.execute({ action: 'done', userId: userProfile.id, todoId: rest });
      break;
    case 'remove':
    case 'delete':
    case 'rm':
      result = await todoSkill.execute({ action: 'remove', userId: userProfile.id, todoId: rest });
      break;
    default:
      // If no sub-command recognised, treat the whole thing as "add"
      result = await todoSkill.execute({
        action: 'add',
        userId: userProfile.id,
        text: args,
        priority: 'medium',
      });
  }

  await sendSkillResult(ctx, result.text);
}

// ---------------------------------------------------------------------------
// /remind
// ---------------------------------------------------------------------------

export async function handleRemind(ctx: Context): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('Could not identify you. Please try again.');
    return;
  }

  const rawText = ctx.message?.text ?? '';
  const args = rawText.replace(/^\/remind(?:@\S+)?\s*/i, '').trim();

  if (!args) {
    await ctx.reply(
      '*Reminder Commands:*\n\n' +
        '/remind \\<time\\> \\<text\\> \\- Set a reminder\n' +
        '/remind list \\- Show active reminders\n' +
        '/remind remove \\<id\\> \\- Cancel a reminder\n\n' +
        '*Time examples:*\n' +
        '• `in 10 minutes`\n' +
        '• `in 2 hours`\n' +
        '• `today at 3pm`\n' +
        '• `tomorrow at 9:00`\n' +
        '• `at 18:30`\n' +
        '• `every day at 8:00`\n' +
        '• `every weekday at 9:00`\n' +
        '• `every Monday at 10:00`\n' +
        '• `every 30 minutes`',
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  const reminderSkill = skillRegistry.get('reminders');
  if (!reminderSkill || !reminderSkill.isEnabled()) {
    await ctx.reply('❌ The reminder skill is currently disabled.');
    return;
  }

  const memoryManager = getMemoryManager();
  const userProfile = memoryManager.userProfile.getOrCreateUser(
    String(ctx.from.id),
    ctx.from.username,
    ctx.from.first_name,
  );

  const chatId = String(ctx.chat?.id ?? ctx.from.id);
  const parts = args.split(/\s+/);
  const firstWord = (parts[0] ?? '').toLowerCase();

  // Sub-commands: list, remove
  if (firstWord === 'list') {
    const result = await reminderSkill.execute({ action: 'list', userId: userProfile.id, chatId });
    await sendSkillResult(ctx, result.text);
    return;
  }

  if (firstWord === 'remove' || firstWord === 'delete' || firstWord === 'cancel') {
    const id = parts.slice(1).join(' ').trim();
    const result = await reminderSkill.execute({
      action: 'remove',
      userId: userProfile.id,
      chatId,
      reminderId: id,
    });
    await sendSkillResult(ctx, result.text);
    return;
  }

  // Otherwise parse "add" — extract time expression and reminder text.
  // Strategy: try progressively longer leading phrases as the time expression.
  // The time expression ends where the remaining text forms valid reminder content.
  const { timeExpr, text } = parseReminderArgs(args);

  const result = await reminderSkill.execute({
    action: 'add',
    userId: userProfile.id,
    chatId,
    text,
    time: timeExpr,
  });

  await sendSkillResult(ctx, result.text);
}

// ---------------------------------------------------------------------------
// /weather
// ---------------------------------------------------------------------------

export async function handleWeather(ctx: Context): Promise<void> {
  const rawText = ctx.message?.text ?? '';
  const city = rawText.replace(/^\/weather(?:@\S+)?\s*/i, '').trim();

  if (!city) {
    await ctx.reply(
      '🌤️ Please provide a city name\\.\n\nUsage: /weather \\<city\\>',
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  const weatherSkill = skillRegistry.get('weather');
  if (!weatherSkill || !weatherSkill.isEnabled()) {
    await ctx.reply('❌ The weather skill is currently disabled.');
    return;
  }

  // Show typing indicator while fetching
  await ctx.replyWithChatAction('typing');

  const result = await weatherSkill.execute({ city });
  await sendSkillResult(ctx, result.text);
}

// ---------------------------------------------------------------------------
// /search
// ---------------------------------------------------------------------------

export async function handleSearch(ctx: Context): Promise<void> {
  const rawText = ctx.message?.text ?? '';
  const query = rawText.replace(/^\/search(?:@\S+)?\s*/i, '').trim();

  if (!query) {
    await ctx.reply(
      '🔍 Please provide a search query\\.\n\nUsage: /search \\<query\\>',
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  const searchSkill = skillRegistry.get('web-search');
  if (!searchSkill || !searchSkill.isEnabled()) {
    await ctx.reply('❌ The web search skill is currently disabled.');
    return;
  }

  await ctx.replyWithChatAction('typing');

  const result = await searchSkill.execute({ query });
  await sendSkillResult(ctx, result.text);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Send a skill result, splitting across multiple messages if necessary
 * to stay within Telegram's 4096-character limit.
 */
async function sendSkillResult(ctx: Context, text: string): Promise<void> {
  const MAX_LEN = 4096;

  if (text.length <= MAX_LEN) {
    try {
      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch {
      // Fall back to plain text if Markdown parse fails
      await ctx.reply(stripMarkdown(text));
    }
    return;
  }

  // Split into chunks, preferring newline boundaries
  const chunks = splitMessage(text, MAX_LEN);
  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: 'Markdown' });
    } catch {
      await ctx.reply(stripMarkdown(chunk));
    }
  }
}

/** Split a long message into chunks at newline boundaries. */
function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Try to split at a newline within the limit
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt <= 0) {
      // No newline found — hard split at maxLen
      splitAt = maxLen;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

/** Very lightweight Markdown stripper for fallback plain text. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, '$1');
}

/**
 * Parse a reminder argument string into a time expression and message text.
 *
 * Heuristic: known time patterns are matched at the start of the string;
 * the remainder is the reminder text.  Falls back to splitting on first
 * unrecognised word boundary.
 */
function parseReminderArgs(args: string): { timeExpr: string; text: string } {
  const lower = args.toLowerCase();

  // Ordered from most specific to least specific
  const timePatterns = [
    // "in X minutes/hours/seconds"
    /^(in\s+\d+\s+(?:second|minute|hour)s?)\s+/i,
    // "every day/weekday at HH:MM"
    /^(every\s+(?:day|weekday)\s+at\s+\d{1,2}:\d{2}(?:\s*(?:am|pm))?)\s+/i,
    // "every <dayname> at HH:MM"
    /^(every\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+\d{1,2}:\d{2}(?:\s*(?:am|pm))?)\s+/i,
    // "every X minutes/hours"
    /^(every\s+\d+\s+(?:minute|hour)s?)\s+/i,
    // "tomorrow at HH:MM"
    /^(tomorrow\s+at\s+\d{1,2}:\d{2}(?:\s*(?:am|pm))?)\s+/i,
    // "today at HH:MM"
    /^(today\s+at\s+\d{1,2}:\d{2}(?:\s*(?:am|pm))?)\s+/i,
    // "at HH:MM"
    /^(at\s+\d{1,2}:\d{2}(?:\s*(?:am|pm))?)\s+/i,
  ];

  for (const pattern of timePatterns) {
    const match = lower.match(pattern);
    if (match?.[1]) {
      const timeExpr = match[1];
      const text = args.slice(timeExpr.length).trim();
      return { timeExpr, text };
    }
  }

  // Fallback: split on the first word that looks like a time boundary
  // Give up and use the entire string, letting the skill parser handle the error
  return { timeExpr: args, text: '' };
}

// Re-export escapeMd for use in this file
export { escapeMd };
