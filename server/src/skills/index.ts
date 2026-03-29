/**
 * SkillRegistry — central registry for all built-in skills.
 *
 * Usage:
 *   import { skillRegistry } from './skills/index.js';
 *   const result = await skillRegistry.get('weather')?.execute({ city: 'London' });
 */

import { getDb } from '../db/index.js';
import { BaseSkill } from './base.js';
import { createLogger } from '../logger.js';

const logger = createLogger('SkillRegistry');
import { WebSearchSkill } from './web-search.js';
import { TodoSkill } from './todos.js';
import { WeatherSkill } from './weather.js';
import { ReminderSkill } from './reminders.js';
import { GitHubSkill } from './github.js';
import type { Bot, Context } from 'grammy';

// ---------------------------------------------------------------------------
// Registry class
// ---------------------------------------------------------------------------

export class SkillRegistry {
  private readonly skills = new Map<string, BaseSkill>();

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /** Register a skill. Overwrites any existing skill with the same name. */
  register(skill: BaseSkill): void {
    this.skills.set(skill.name, skill);
    logger.info(`Registered skill: ${skill.name}`);
  }

  /** Remove a skill from the registry. */
  unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  // ---------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------

  /** Get a skill by name. Returns undefined if not found. */
  get(name: string): BaseSkill | undefined {
    return this.skills.get(name);
  }

  /** Return all registered skills as an array. */
  listAll(): BaseSkill[] {
    return [...this.skills.values()];
  }

  // ---------------------------------------------------------------------------
  // Enable / disable (persists to DB)
  // ---------------------------------------------------------------------------

  /**
   * Enable a skill — upserts enabled=1 in skills_config.
   */
  enable(name: string): void {
    const db = getDb();
    this.ensureConfigTable(db);
    db.prepare(
      `INSERT INTO skills_config (name, enabled)
       VALUES (?, 1)
       ON CONFLICT(name) DO UPDATE SET enabled = 1`,
    ).run(name);
    logger.info(`Enabled skill: ${name}`);
  }

  /**
   * Disable a skill — upserts enabled=0 in skills_config.
   * The skill instance stays in the registry but isEnabled() returns false.
   */
  disable(name: string): void {
    const db = getDb();
    this.ensureConfigTable(db);
    db.prepare(
      `INSERT INTO skills_config (name, enabled)
       VALUES (?, 0)
       ON CONFLICT(name) DO UPDATE SET enabled = 0`,
    ).run(name);
    logger.info(`Disabled skill: ${name}`);
  }

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  /**
   * Register all built-in skills.
   * Optionally inject a bot instance for skills that need to send messages.
   */
  initBuiltins(bot?: Bot<Context>): void {
    const webSearch = new WebSearchSkill();
    const todos = new TodoSkill();
    const weather = new WeatherSkill();
    const reminders = new ReminderSkill();
    const github = new GitHubSkill();

    if (bot) {
      reminders.setBot(bot);
    }

    this.register(webSearch);
    this.register(todos);
    this.register(weather);
    this.register(reminders);
    this.register(github);

    this.ensureConfigTableSafe();
  }

  /**
   * Load and schedule all persisted active reminders.
   * Call once after initBuiltins() and after DB is ready.
   */
  async loadReminders(): Promise<void> {
    const reminders = this.get('reminders') as ReminderSkill | undefined;
    if (reminders) {
      await reminders.loadAndScheduleAll();
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private ensureConfigTable(db: ReturnType<typeof getDb>): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS skills_config (
        name    TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1
      );
    `);
  }

  private ensureConfigTableSafe(): void {
    try {
      const db = getDb();
      this.ensureConfigTable(db);
    } catch {
      // DB not ready yet — will be created on first isEnabled() call
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const skillRegistry = new SkillRegistry();

// Re-export base types for convenience
export { BaseSkill } from './base.js';
export type { SkillResult, ToolDefinition } from './base.js';
export { ReminderSkill } from './reminders.js';
export { TodoSkill } from './todos.js';
export { WeatherSkill } from './weather.js';
export { WebSearchSkill } from './web-search.js';
export { GitHubSkill } from './github.js';
