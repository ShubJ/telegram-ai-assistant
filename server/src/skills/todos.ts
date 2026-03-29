/**
 * TodoSkill — CRUD operations for the todos table.
 *
 * Actions: add | list | done | remove
 */

import { BaseSkill, type SkillResult } from './base.js';
import { getDb } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface TodoRow {
  id: string;
  user_id: string;
  text: string;
  priority: string;
  done: number; // 0 | 1
  created_at: string;
  completed_at: string | null;
}

type Priority = 'low' | 'medium' | 'high';

// ---------------------------------------------------------------------------
// Params shape
// ---------------------------------------------------------------------------

interface TodoParams {
  action: 'add' | 'list' | 'done' | 'remove';
  userId: string;
  text?: string;
  todoId?: string;
  priority?: Priority;
}

// ---------------------------------------------------------------------------
// Skill implementation
// ---------------------------------------------------------------------------

export class TodoSkill extends BaseSkill {
  readonly name = 'todos';
  readonly description = 'Manage your personal to-do list with add, list, done, and remove operations.';

  getToolDefinition() {
    return {
      name: 'todos',
      description:
        'Manage the user\'s personal to-do list. Supports adding, listing, completing, and removing items.',
      input_schema: {
        type: 'object' as const,
        properties: {
          action: {
            type: 'string',
            enum: ['add', 'list', 'done', 'remove'],
            description: 'The operation to perform on the todo list.',
          },
          text: {
            type: 'string',
            description: 'The todo item text (required for "add").',
          },
          todoId: {
            type: 'string',
            description: 'The ID (or 8-char prefix) of the todo (required for "done" and "remove").',
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Priority level for the todo (defaults to "medium").',
          },
        },
        required: ['action'],
      },
    };
  }

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const { action, userId, text, todoId, priority } = params as unknown as TodoParams;

    if (!userId) {
      return this.failure('userId is required.');
    }

    this.ensureTable();

    switch (action) {
      case 'add':
        return this.addTodo(userId, text ?? '', priority ?? 'medium');
      case 'list':
        return this.listTodos(userId);
      case 'done':
        return this.markDone(userId, todoId ?? '');
      case 'remove':
        return this.removeTodo(userId, todoId ?? '');
      default:
        return this.failure(
          `Unknown action "${String(action)}". Use add, list, done, or remove.`,
        );
    }
  }

  // ---------------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------------

  private addTodo(userId: string, text: string, priority: Priority): SkillResult {
    if (!text.trim()) {
      return this.failure('Please provide the todo text. Usage: /todo add <text>');
    }

    const db = getDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO todos (id, user_id, text, priority, done, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
    ).run(id, userId, text.trim(), priority, now);

    const priorityEmoji = this.priorityEmoji(priority);
    return this.success(
      `${priorityEmoji} Added todo: *${this.escape(text.trim())}*\nID: \`${id.slice(0, 8)}\``,
      { id },
    );
  }

  private listTodos(userId: string): SkillResult {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM todos
         WHERE user_id = ? AND done = 0
         ORDER BY
           CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
           created_at ASC`,
      )
      .all(userId) as TodoRow[];

    if (rows.length === 0) {
      return this.success('You have no pending todos. Use /todo add <text> to create one.');
    }

    const lines = ['*Your To-Do List:*', ''];
    rows.forEach((row) => {
      const emoji = this.priorityEmoji(row.priority as Priority);
      const shortId = row.id.slice(0, 8);
      lines.push(`${emoji} \`${shortId}\` ${this.escape(row.text)}`);
    });

    lines.push('');
    lines.push(`_${rows.length} pending item${rows.length === 1 ? '' : 's'}_`);
    lines.push('_Use /todo done <id> or /todo remove <id>_');

    return this.success(lines.join('\n'), {
      todos: rows.map((r) => ({
        id: r.id,
        text: r.text,
        priority: r.priority,
        createdAt: r.created_at,
      })),
    });
  }

  private markDone(userId: string, todoId: string): SkillResult {
    if (!todoId.trim()) {
      return this.failure('Please provide a todo ID. Usage: /todo done <id>');
    }

    const db = getDb();
    const row = this.findTodo(userId, todoId);

    if (!row) {
      return this.failure(`No todo found with ID starting with "${todoId}".`);
    }

    if (row.done === 1) {
      return this.failure(`Todo "${this.escape(row.text)}" is already marked as done.`);
    }

    db.prepare(
      `UPDATE todos SET done = 1, completed_at = ? WHERE id = ?`,
    ).run(new Date().toISOString(), row.id);

    return this.success(`✅ Marked as done: *${this.escape(row.text)}*`, { id: row.id });
  }

  private removeTodo(userId: string, todoId: string): SkillResult {
    if (!todoId.trim()) {
      return this.failure('Please provide a todo ID. Usage: /todo remove <id>');
    }

    const db = getDb();
    const row = this.findTodo(userId, todoId);

    if (!row) {
      return this.failure(`No todo found with ID starting with "${todoId}".`);
    }

    db.prepare('DELETE FROM todos WHERE id = ?').run(row.id);

    return this.success(`🗑️ Removed todo: *${this.escape(row.text)}*`, { id: row.id });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Finds a todo by full UUID or 8-char prefix. */
  private findTodo(userId: string, idOrPrefix: string): TodoRow | undefined {
    const db = getDb();
    const trimmed = idOrPrefix.trim();

    // Try exact match first, then prefix match
    const row =
      (db
        .prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?')
        .get(trimmed, userId) as TodoRow | undefined) ??
      (db
        .prepare('SELECT * FROM todos WHERE id LIKE ? AND user_id = ?')
        .get(`${trimmed}%`, userId) as TodoRow | undefined);

    return row;
  }

  private priorityEmoji(priority: Priority | string): string {
    switch (priority) {
      case 'high':
        return '🔴';
      case 'medium':
        return '🟡';
      default:
        return '🟢';
    }
  }

  /** Escape Telegram Markdown special chars. */
  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
  }

  /** Create the todos table if it doesn't exist. */
  private ensureTable(): void {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL,
        text         TEXT NOT NULL,
        priority     TEXT NOT NULL DEFAULT 'medium',
        done         INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id, done);
    `);
  }
}
