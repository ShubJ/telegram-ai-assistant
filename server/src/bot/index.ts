/**
 * Bot factory and lifecycle management.
 *
 * Creates and configures the Grammy bot instance:
 *  - Registers middleware (logging → rate-limit → auth)
 *  - Registers all command handlers
 *  - Registers the default text message handler
 *  - Exports start / stop helpers for use in the application entry point
 */

import { Bot, GrammyError, HttpError, type Context } from 'grammy';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const logger = createLogger('Bot');

// Middleware
import { loggingMiddleware } from './middleware/logging.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { authMiddleware } from './middleware/auth.js';

// Command handlers
import {
  handleStart,
  handleHelp,
  handleRemember,
  handleForget,
  handleClear,
  handleSkills,
  handleProfile,
  handleProject,
  handleTask,
  handleAgents,
} from './handlers/commands.js';

// Skill command handlers
import {
  handleTodo,
  handleRemind,
  handleWeather,
  handleSearch,
} from './handlers/skills.js';

// Core message handler
import { handleMessage } from './handlers/message.js';

// Skills (initialised here so the bot ref can be injected)
import { skillRegistry } from '../skills/index.js';

// Agent system
import { AgentSkill } from '../agents/index.js';

// ---------------------------------------------------------------------------
// Bot instance
// ---------------------------------------------------------------------------

let bot: Bot<Context> | null = null;

/**
 * Create (or return the existing) Grammy bot instance.
 *
 * Does NOT start polling — call `startBot()` for that.
 */
export function createBot(): Bot<Context> {
  if (bot) return bot;

  bot = new Bot<Context>(config.telegramBotToken);

  // ---- Middleware (order matters) ----------------------------------------
  bot.use(loggingMiddleware);
  bot.use(rateLimitMiddleware);
  bot.use(authMiddleware);

  // ---- Command handlers ---------------------------------------------------
  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('remember', handleRemember);
  bot.command('forget', handleForget);
  bot.command('clear', handleClear);
  bot.command('skills', handleSkills);
  bot.command('profile', handleProfile);

  // Skill commands
  bot.command('todo', handleTodo);
  bot.command('remind', handleRemind);
  bot.command('weather', handleWeather);
  bot.command('search', handleSearch);

  // Agent system commands
  bot.command('project', handleProject);
  bot.command('task', handleTask);
  bot.command('agents', handleAgents);

  // ---- Default text message handler --------------------------------------
  // This catches all non-command text messages and runs the AI flow
  bot.on('message:text', handleMessage);

  // ---- Error handler ------------------------------------------------------
  bot.catch((err) => {
    const ctx = err.ctx;
    const userId = ctx.from?.id ?? 'unknown';

    if (err.error instanceof GrammyError) {
      logger.error(`Grammy error for user ${userId}`, { description: err.error.description });
    } else if (err.error instanceof HttpError) {
      logger.error(`HTTP error for user ${userId}`, { error: err.error.message });
    } else {
      logger.error(`Unhandled error for user ${userId}`, { error: err.error instanceof Error ? err.error.message : String(err.error) });
    }

    // Try to notify the user, but don't crash if we can't
    ctx.reply(
      "⚠️ An unexpected error occurred. Please try again in a moment.",
    ).catch(() => {
      // silently ignore — nothing we can do here
    });
  });

  return bot;
}

/**
 * Initialise skills, inject the bot reference, and start polling.
 *
 * Resolves when the bot is successfully connected to Telegram.
 * Rejects on connection failure.
 */
export async function startBot(): Promise<Bot<Context>> {
  const instance = createBot();

  // Initialise built-in skills with the bot reference
  // (needed by ReminderSkill to send messages)
  skillRegistry.initBuiltins(instance);

  // Register and initialise the agent skill
  const agentSkill = new AgentSkill();
  agentSkill.setBot(instance);
  skillRegistry.register(agentSkill);

  // Load and re-schedule persisted reminders
  await skillRegistry.loadReminders();

  // Register commands with BotFather so the "/" menu is populated
  await instance.api.setMyCommands([
    { command: 'start',    description: 'Start or restart the assistant' },
    { command: 'help',     description: 'Show all available commands' },
    { command: 'clear',    description: 'Clear conversation context' },
    { command: 'profile',  description: 'View your profile' },
    { command: 'remember', description: 'Save a memory' },
    { command: 'forget',   description: 'View or delete memories' },
    { command: 'todo',     description: 'Manage your to-do list' },
    { command: 'remind',   description: 'Set a reminder' },
    { command: 'weather',  description: 'Get current weather for a city' },
    { command: 'search',   description: 'Search the web' },
    { command: 'skills',   description: 'List available skills' },
    { command: 'project',  description: 'Start a new AI-driven project' },
    { command: 'task',     description: 'Add feature/fix to existing repo' },
    { command: 'agents',   description: 'Agent system status & management' },
  ]);

  logger.info('Commands registered with Telegram.');

  // Start long-polling in the background (non-blocking)
  void instance.start({
    onStart: (botInfo) => {
      logger.info(`Running as @${botInfo.username} (id: ${botInfo.id})`);
    },
  });

  return instance;
}

/**
 * Gracefully stop the bot (stops polling and cleans up).
 * Safe to call multiple times.
 */
export async function stopBot(): Promise<void> {
  if (!bot) return;

  logger.info('Stopping…');
  await bot.stop();
  bot = null;
  logger.info('Stopped.');
}

/**
 * Return the active bot instance, or null if not started.
 */
export function getBot(): Bot<Context> | null {
  return bot;
}

export type { Context };
export { Bot };
