/**
 * Base skill abstraction.
 *
 * All skills extend BaseSkill and implement the `execute` method.
 * The `isEnabled` method checks the skills_config table (or falls back to
 * true if the DB is not yet available, so startup order doesn't matter).
 */

import { getDb } from '../db/index.js';

// ---------------------------------------------------------------------------
// Shared result type
// ---------------------------------------------------------------------------

export interface SkillResult {
  /** Human-readable response to send back to the user. */
  text: string;
  /** Whether the skill call succeeded. */
  success: boolean;
  /** Optional structured data for programmatic consumers. */
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Anthropic tool definition shape
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Abstract base
// ---------------------------------------------------------------------------

export abstract class BaseSkill {
  /** Unique identifier / registry key for this skill. */
  abstract readonly name: string;

  /** Short description shown in /skills list. */
  abstract readonly description: string;

  /**
   * Execute the skill.
   *
   * @param params - Arbitrary key-value pairs passed by the caller.
   * @returns A SkillResult with a text reply and optional structured data.
   */
  abstract execute(params: Record<string, unknown>): Promise<SkillResult>;

  /**
   * Return an Anthropic-compatible tool definition so this skill can be
   * offered to Claude as a callable tool during conversation.
   */
  abstract getToolDefinition(): ToolDefinition;

  /**
   * Check whether this skill is currently enabled.
   *
   * Reads from the `skills_config` table when available; defaults to
   * `true` so skills work even before the table is created.
   */
  isEnabled(): boolean {
    try {
      const db = getDb();
      const row = db
        .prepare('SELECT enabled FROM skills_config WHERE name = ?')
        .get(this.name) as { enabled: number } | undefined;

      if (row === undefined) {
        // Skill not in DB yet — treat as enabled
        return true;
      }

      return row.enabled === 1;
    } catch {
      // DB not ready or table missing — default to enabled
      return true;
    }
  }

  /**
   * Convenience helper: returns a failed SkillResult.
   */
  protected failure(message: string, data?: Record<string, unknown>): SkillResult {
    return { success: false, text: message, data };
  }

  /**
   * Convenience helper: returns a successful SkillResult.
   */
  protected success(text: string, data?: Record<string, unknown>): SkillResult {
    return { success: true, text, data };
  }
}
