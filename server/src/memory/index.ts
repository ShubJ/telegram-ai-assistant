/**
 * MemoryManager – unified facade over short-term and long-term memory.
 *
 * Responsibilities:
 *  1. Persist every user/assistant turn to short-term memory (in-RAM + SQLite).
 *  2. Extract important facts from conversations and promote them to long-term
 *     memory automatically.
 *  3. Build the `context` string injected into every LLM prompt.
 *
 * Fact extraction uses a simple pattern-matching approach: no LLM call is
 * needed, which keeps latency and cost low.  The patterns cover the most
 * common ways users share persistent information ("my name is …", "I live in
 * …", "I prefer …", "remember that …", etc.).
 */

import { LongTermMemory, type Memory, type MemoryType } from './long-term.js';
import { ShortTermMemory, type Message, type MessageRole } from './short-term.js';
import { UserProfileManager } from './user-profile.js';

// Re-export core types so callers can import from a single path.
export type { Memory, MemoryType } from './long-term.js';
export type { Message, MessageRole } from './short-term.js';
export type { User, UserUpdates } from './user-profile.js';

// ---------------------------------------------------------------------------
// Extraction patterns
// ---------------------------------------------------------------------------

interface ExtractionRule {
  /** Regex applied to the lower-cased user message. */
  pattern: RegExp;
  type: MemoryType;
  importance: number;
  /** Optional transform on the captured group before storing. */
  transform?: (match: string) => string;
}

const EXTRACTION_RULES: ExtractionRule[] = [
  // Name
  {
    pattern: /my name is ([^.!?\n]{2,60})/i,
    type: 'fact',
    importance: 9,
    transform: (m) => `User's name is ${m.trim()}`,
  },
  {
    pattern: /(?:i'm|i am) (?:called |known as )?([a-z][a-z\s'-]{1,40})/i,
    type: 'fact',
    importance: 8,
    transform: (m) => `User goes by ${m.trim()}`,
  },
  // Location
  {
    pattern: /i (?:live|am based|work) (?:in|at) ([^.!?\n]{2,80})/i,
    type: 'fact',
    importance: 7,
    transform: (m) => `User lives/works in ${m.trim()}`,
  },
  {
    pattern: /i(?:'m| am) from ([^.!?\n]{2,80})/i,
    type: 'fact',
    importance: 6,
    transform: (m) => `User is from ${m.trim()}`,
  },
  // Profession / role
  {
    pattern: /i(?:'m| am) (?:a |an )?([a-z][a-z\s'-]{2,60})(?:\s+by (?:profession|trade|job))?/i,
    type: 'fact',
    importance: 6,
    transform: (m) => `User is a ${m.trim()}`,
  },
  {
    pattern: /i work (?:as|for) ([^.!?\n]{2,80})/i,
    type: 'fact',
    importance: 6,
    transform: (m) => `User works as/for ${m.trim()}`,
  },
  // Preferences
  {
    pattern: /i (?:prefer|like|love|enjoy|hate|dislike|always|never) ([^.!?\n]{3,120})/i,
    type: 'preference',
    importance: 6,
    transform: (m) => `User said: "I prefer/like/enjoy ${m.trim()}"`,
  },
  {
    pattern: /my (?:favourite|favorite) ([^.!?\n]{3,80})/i,
    type: 'preference',
    importance: 6,
    transform: (m) => `User's favourite ${m.trim()}`,
  },
  // Explicit remember requests
  {
    pattern: /(?:please )?remember (?:that |this: ?)?(.{5,200})/i,
    type: 'note',
    importance: 8,
    transform: (m) => `User asked to remember: ${m.trim()}`,
  },
  {
    pattern: /(?:don't|do not) forget (?:that )?(.{5,200})/i,
    type: 'note',
    importance: 8,
    transform: (m) => `User asked not to forget: ${m.trim()}`,
  },
  // Goals / plans
  {
    pattern: /my goal (?:is|for \w+ is) ([^.!?\n]{5,200})/i,
    type: 'context',
    importance: 7,
    transform: (m) => `User's goal: ${m.trim()}`,
  },
  {
    pattern: /i(?:'m| am) (?:learning|studying|working on|building|trying to) ([^.!?\n]{3,120})/i,
    type: 'context',
    importance: 6,
    transform: (m) => `User is learning/working on ${m.trim()}`,
  },
  // Language / locale
  {
    pattern: /(?:i (?:speak|use)|my (?:native )?language is) ([a-z\s]{2,40})/i,
    type: 'preference',
    importance: 7,
    transform: (m) => `User speaks/uses ${m.trim()}`,
  },
];

// ---------------------------------------------------------------------------
// MemoryManager
// ---------------------------------------------------------------------------

export class MemoryManager {
  readonly shortTerm: ShortTermMemory;
  readonly longTerm: LongTermMemory;
  readonly userProfile: UserProfileManager;

  constructor(
    shortTerm?: ShortTermMemory,
    longTerm?: LongTermMemory,
    userProfile?: UserProfileManager,
  ) {
    this.shortTerm = shortTerm ?? new ShortTermMemory();
    this.longTerm = longTerm ?? new LongTermMemory();
    this.userProfile = userProfile ?? new UserProfileManager();
  }

  // -------------------------------------------------------------------------
  // Primary interface used by the bot message handler
  // -------------------------------------------------------------------------

  /**
   * Build a combined context string for injection into the LLM prompt.
   *
   * Returned sections (omitted when empty):
   *  - User profile (name, preferences)
   *  - Relevant long-term memories (matched to the current message)
   *  - Recent conversation history (last N turns)
   *
   * @param userId         Internal user UUID.
   * @param currentMessage The user's latest message (used for memory search).
   */
  async getContext(userId: string, currentMessage = ''): Promise<string> {
    const parts: string[] = [];

    // ---- User profile -------------------------------------------------------
    const user = this.userProfile.getUser(userId);
    if (user) {
      const profileLines: string[] = [];
      if (user.firstName) profileLines.push(`Name: ${user.firstName}`);
      if (user.username) profileLines.push(`Telegram username: @${user.username}`);
      if (user.timezone && user.timezone !== 'UTC')
        profileLines.push(`Timezone: ${user.timezone}`);

      const prefs = user.preferences;
      if (prefs && typeof prefs === 'object') {
        const prefEntries = Object.entries(prefs)
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .map(([k, v]) => `  ${k}: ${String(v)}`);
        if (prefEntries.length > 0) {
          profileLines.push('Preferences:\n' + prefEntries.join('\n'));
        }
      }

      if (profileLines.length > 0) {
        parts.push('## User Profile\n' + profileLines.join('\n'));
      }
    }

    // ---- Relevant long-term memories ----------------------------------------
    const memories = currentMessage
      ? this.longTerm.getRelevantMemories(userId, currentMessage, 8)
      : this.longTerm.getMemories(userId, undefined, 8);

    if (memories.length > 0) {
      const memoryLines = memories.map((m) => `- [${m.type}] ${m.content}`);
      parts.push('## What I Remember About You\n' + memoryLines.join('\n'));
    }

    // ---- Short-term conversation history ------------------------------------
    const messages = this.shortTerm.getMessages(userId);
    const nonSystem = messages.filter((m) => m.role !== 'system');
    if (nonSystem.length > 0) {
      const historyLines = nonSystem.map(
        (m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`,
      );
      parts.push('## Recent Conversation\n' + historyLines.join('\n'));
    }

    return parts.join('\n\n');
  }

  /**
   * Persist a completed user↔assistant exchange and auto-extract any facts.
   *
   * @param userId            Internal user UUID.
   * @param userMessage       The user's message text.
   * @param assistantResponse The assistant's reply text.
   */
  async saveInteraction(
    userId: string,
    userMessage: string,
    assistantResponse: string,
  ): Promise<void> {
    // Persist to short-term memory (also writes to DB).
    this.shortTerm.addMessage(userId, 'user', userMessage);
    this.shortTerm.addMessage(userId, 'assistant', assistantResponse);

    // Auto-extract facts from the user's message.
    const extracted = this._extractFacts(userMessage);
    for (const { type, content, importance } of extracted) {
      // Avoid exact duplicates.
      if (!this._isDuplicateMemory(userId, content)) {
        this.longTerm.addMemory(userId, type, content, importance);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Direct memory management (used by bot commands / admin API)
  // -------------------------------------------------------------------------

  /** Add a memory directly without going through fact extraction. */
  addMemory(
    userId: string,
    type: MemoryType,
    content: string,
    importance = 5,
  ): Memory {
    return this.longTerm.addMemory(userId, type, content, importance);
  }

  /** Remove a memory by id. */
  removeMemory(id: string): boolean {
    return this.longTerm.deleteMemory(id);
  }

  /** Search memories for a user. */
  searchMemories(userId: string, query: string, limit = 10): Memory[] {
    return this.longTerm.searchMemories(userId, query, limit);
  }

  /** Return all memories for admin dashboard. */
  getAllMemories(userId: string): Memory[] {
    return this.longTerm.getAllMemories(userId);
  }

  // -------------------------------------------------------------------------
  // Short-term helpers
  // -------------------------------------------------------------------------

  getMessages(userId: string): Message[] {
    return this.shortTerm.getMessages(userId);
  }

  clearContext(userId: string): void {
    this.shortTerm.clearContext(userId);
  }

  addMessage(userId: string, role: MessageRole, content: string): Message {
    return this.shortTerm.addMessage(userId, role, content);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Run all extraction rules against `text` and return de-duplicated matches.
   */
  private _extractFacts(
    text: string,
  ): Array<{ type: MemoryType; content: string; importance: number }> {
    const results: Array<{ type: MemoryType; content: string; importance: number }> = [];
    const seen = new Set<string>();

    for (const rule of EXTRACTION_RULES) {
      const match = rule.pattern.exec(text);
      if (!match || !match[1]) continue;

      const raw = match[1].trim();
      if (!raw || raw.length < 3) continue;

      const content = rule.transform ? rule.transform(raw) : raw;
      if (seen.has(content.toLowerCase())) continue;
      seen.add(content.toLowerCase());

      results.push({ type: rule.type, content, importance: rule.importance });
    }

    return results;
  }

  /**
   * Check whether an almost-identical memory already exists to avoid storing
   * exact duplicates.  Uses a simple case-insensitive string comparison.
   */
  private _isDuplicateMemory(userId: string, content: string): boolean {
    const existing = this.longTerm.searchMemories(userId, content, 3);
    const normalised = content.toLowerCase().trim();
    return existing.some((m) => m.content.toLowerCase().trim() === normalised);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: MemoryManager | null = null;

export function getMemoryManager(): MemoryManager {
  if (!_instance) {
    _instance = new MemoryManager();
  }
  return _instance;
}

/** Replace the singleton (primarily for unit tests). */
export function setMemoryManager(manager: MemoryManager): void {
  _instance = manager;
}

export const memoryManager = new Proxy({} as MemoryManager, {
  get(_target, prop: string | symbol) {
    return (getMemoryManager() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
