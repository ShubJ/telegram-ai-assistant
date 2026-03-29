/**
 * PersonalityManager – builds and manages the system prompt that gives the
 * assistant its character.
 *
 * The active personality is stored in the SQLite `personality_config` table
 * (seeded by the migrations module).  At runtime the manager reads the active
 * record, combines it with per-user context from the memory system, and
 * produces the final system prompt injected into every LLM call.
 *
 * Default personality: "Atlas" – helpful, witty, concise, proactive.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersonalityConfig {
  id: string;
  name: string;
  /** Core system prompt template (may contain {{placeholders}}). */
  systemPrompt: string;
  traits: string[];
  tone: string;
  responseStyle: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalityConfigInput {
  name: string;
  systemPrompt: string;
  traits?: string[];
  tone?: string;
  responseStyle?: string;
}

// SQLite row shape
interface PersonalityRow {
  id: string;
  name: string;
  system_prompt: string;
  traits: string;
  tone: string;
  response_style: string;
  active: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Default Atlas system prompt
// ---------------------------------------------------------------------------

const DEFAULT_ATLAS_SYSTEM_PROMPT = `You are Atlas, a highly capable, friendly, and proactive AI assistant living inside Telegram.

## Core Traits
- **Helpful**: You proactively assist users in completing tasks, answering questions thoroughly, and volunteering relevant follow-up information without being asked.
- **Witty & Warm**: You maintain a light, conversational tone with the occasional well-placed remark. You are never snarky or condescending.
- **Concise**: You favour crisp, direct responses. You use bullet points and short paragraphs rather than walls of text. You never pad answers unnecessarily.
- **Honest**: You acknowledge uncertainty rather than fabricating answers. You say "I'm not sure" when appropriate and suggest ways to verify information.
- **Proactive**: You notice opportunities beyond the immediate request — suggesting follow-up questions, recommending that important information be saved to memory, or flagging potential issues before they arise.
- **Memory-aware**: You use what you know about the user to personalise every response. You remember their name, preferences, and past conversations.

## Communication Style
- Match the user's energy: casual when they're casual, precise when they ask technical questions.
- Use Markdown formatting (bold, lists, code blocks) when it genuinely aids readability; avoid it for simple one-sentence answers.
- Always respond in the same language the user writes in.
- Address the user by their first name occasionally (not every message) to keep the conversation personal.

## Capabilities
You have access to tools including web search, weather lookups, reminders, to-do list management, and persistent memory. Use them proactively when they would improve the user's experience — don't wait to be asked.

## Memory Guidelines
- When a user shares something personal (name, location, preferences, goals), acknowledge it and store it in memory.
- Reference past interactions naturally: "As you mentioned last time…" or "Since you prefer dark mode…"
- Never reveal raw memory data structures to the user; surface information conversationally.

## Boundaries
- You do not generate harmful, deceptive, or illegal content.
- You do not impersonate real individuals.
- You do not process or store sensitive credentials (passwords, API keys).

Remember: your goal is to be the most useful assistant the user has ever had — anticipating needs, removing friction, and making every interaction feel effortless.`;

// ---------------------------------------------------------------------------
// PersonalityManager
// ---------------------------------------------------------------------------

export class PersonalityManager {
  /** Cached active personality – invalidated on update. */
  private _cache: PersonalityConfig | null = null;

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  /**
   * Return the currently active personality configuration.
   * Falls back to a hard-coded default if the DB has no active record
   * (should not happen after migrations run, but defensive).
   */
  getPersonality(): PersonalityConfig {
    if (this._cache) return this._cache;

    const db = getDb();
    const row = db
      .prepare(
        `SELECT * FROM personality_config WHERE active = 1 ORDER BY updated_at DESC LIMIT 1`,
      )
      .get() as PersonalityRow | undefined;

    if (row) {
      this._cache = this._rowToConfig(row);
      return this._cache;
    }

    // No active personality in DB – return default without caching so the next
    // call retries the DB (migrations may not have run yet).
    return this._defaultAtlas();
  }

  /**
   * Build the complete system prompt for a given user context.
   *
   * The prompt combines:
   *  1. The core personality system prompt.
   *  2. A dynamic user-context section (name, timezone, date/time, prefs).
   *
   * @param userContext  Optional pre-built context string from MemoryManager.
   * @param userTimezone IANA timezone string (e.g. "Europe/Berlin").
   */
  getSystemPrompt(
    userContext?: string,
    userTimezone = 'UTC',
  ): string {
    const personality = this.getPersonality();
    const parts: string[] = [personality.systemPrompt];

    // ---- Dynamic runtime section ------------------------------------------
    const runtimeLines: string[] = [];

    // Current date/time
    const now = new Date();
    const formattedDate = this._formatDateInTimezone(now, userTimezone);
    runtimeLines.push(`Current date and time: ${formattedDate} (${userTimezone})`);

    // Server environment context — helps Claude use tools effectively
    runtimeLines.push('');
    runtimeLines.push('## Server Environment');
    runtimeLines.push('You are running on a server with full access to the file system and tools.');
    runtimeLines.push('Known local projects:');
    runtimeLines.push('- /home/ubuntu/Projects/telegram-ai-assistant — This bot\'s own codebase (Node.js + TypeScript)');
    runtimeLines.push('GitHub account: ShubJ (connected via token — you CAN push code, create repos, create PRs)');
    runtimeLines.push('');
    runtimeLines.push('IMPORTANT: When the user asks you to do something with GitHub (push code, create repos, list repos, etc.), USE the github tool. Do NOT say you cannot do it. You have full GitHub access. For push_repo, use the local_path of the project on disk.');

    if (runtimeLines.length > 0) {
      parts.push('## Current Context\n' + runtimeLines.join('\n'));
    }

    // ---- User context (from MemoryManager) ---------------------------------
    if (userContext && userContext.trim()) {
      parts.push(userContext.trim());
    }

    return parts.join('\n\n---\n\n');
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  /**
   * Save a new personality configuration and set it as the active one.
   * All previously active configurations are deactivated.
   *
   * @returns The newly created PersonalityConfig.
   */
  updatePersonality(input: PersonalityConfigInput): PersonalityConfig {
    const db = getDb();
    const now = new Date().toISOString();
    const id = uuidv4();

    const update = db.transaction(() => {
      // Deactivate existing.
      db.prepare(`UPDATE personality_config SET active = 0, updated_at = ?`)
        .run(now);

      // Insert new active record.
      db.prepare(
        `INSERT INTO personality_config
           (id, name, system_prompt, traits, tone, response_style, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run(
        id,
        input.name,
        input.systemPrompt,
        JSON.stringify(input.traits ?? []),
        input.tone ?? 'friendly and professional',
        input.responseStyle ?? 'conversational',
        now,
        now,
      );
    });

    update();

    // Invalidate cache.
    this._cache = null;

    const row = db
      .prepare(`SELECT * FROM personality_config WHERE id = ?`)
      .get(id) as PersonalityRow;

    this._cache = this._rowToConfig(row);
    return this._cache;
  }

  /**
   * Update fields on the currently active personality in-place.
   * This is lighter than `updatePersonality` which always creates a new row.
   */
  patchPersonality(
    patches: Partial<Omit<PersonalityConfigInput, 'name'>>,
  ): PersonalityConfig | null {
    const current = this.getPersonality();
    if (!current) return null;

    const db = getDb();
    const now = new Date().toISOString();

    const setClauses: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (patches.systemPrompt !== undefined) {
      setClauses.push('system_prompt = ?');
      params.push(patches.systemPrompt);
    }
    if (patches.traits !== undefined) {
      setClauses.push('traits = ?');
      params.push(JSON.stringify(patches.traits));
    }
    if (patches.tone !== undefined) {
      setClauses.push('tone = ?');
      params.push(patches.tone);
    }
    if (patches.responseStyle !== undefined) {
      setClauses.push('response_style = ?');
      params.push(patches.responseStyle);
    }

    params.push(current.id);

    db.prepare(
      `UPDATE personality_config SET ${setClauses.join(', ')} WHERE id = ?`,
    ).run(...params);

    // Invalidate cache.
    this._cache = null;
    return this.getPersonality();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _rowToConfig(row: PersonalityRow): PersonalityConfig {
    let traits: string[] = [];
    try {
      traits = JSON.parse(row.traits) as string[];
    } catch {
      traits = [];
    }

    return {
      id: row.id,
      name: row.name,
      systemPrompt: row.system_prompt,
      traits,
      tone: row.tone,
      responseStyle: row.response_style,
      active: row.active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private _defaultAtlas(): PersonalityConfig {
    const now = new Date().toISOString();
    return {
      id: 'default',
      name: 'Atlas',
      systemPrompt: DEFAULT_ATLAS_SYSTEM_PROMPT,
      traits: ['helpful', 'witty', 'concise', 'proactive', 'memory-aware'],
      tone: 'warm and professional',
      responseStyle: 'conversational with markdown formatting when appropriate',
      active: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Format a Date object in the given IANA timezone, falling back to UTC on
   * any error.  Returns a human-readable string like
   * "Saturday, 14 March 2026, 09:42 AM CET".
   */
  private _formatDateInTimezone(date: Date, timezone: string): string {
    try {
      return date.toLocaleString('en-GB', {
        timeZone: timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });
    } catch {
      // Invalid timezone – fall back to UTC ISO string.
      return date.toUTCString();
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: PersonalityManager | null = null;

export function getPersonalityManager(): PersonalityManager {
  if (!_instance) {
    _instance = new PersonalityManager();
  }
  return _instance;
}

/** Replace the singleton (primarily for unit tests). */
export function setPersonalityManager(manager: PersonalityManager): void {
  _instance = manager;
}

export const personalityManager = new Proxy({} as PersonalityManager, {
  get(_target, prop: string | symbol) {
    return (getPersonalityManager() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
