/**
 * Inter-agent communication bus.
 *
 * All agent-to-agent messages flow through the MessageBus. Messages are
 * persisted to the agent_messages DB table and can trigger callbacks
 * registered by the orchestrator.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';
import { createLogger } from '../logger.js';
import type { AgentMessage, AgentRole, MessageType, WorkflowPhase } from './types.js';

const logger = createLogger('MessageBus');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MessageCallback = (message: AgentMessage) => void;

// ---------------------------------------------------------------------------
// MessageBus
// ---------------------------------------------------------------------------

export class MessageBus {
  private subscribers = new Map<string, MessageCallback[]>();

  /**
   * Send a message between agents. Persists to DB and notifies subscribers.
   */
  send(message: Omit<AgentMessage, 'id' | 'timestamp'>): AgentMessage {
    const fullMessage: AgentMessage = {
      ...message,
      id: uuidv4(),
      timestamp: new Date().toISOString(),
    };

    this.persist(fullMessage);
    this.notify(fullMessage);

    logger.debug('Message sent', {
      id: fullMessage.id,
      from: `${fullMessage.from}${fullMessage.fromInstance ? `-${fullMessage.fromInstance}` : ''}`,
      to: `${fullMessage.to}${fullMessage.toInstance ? `-${fullMessage.toInstance}` : ''}`,
      type: fullMessage.type,
      phase: fullMessage.phase,
    });

    return fullMessage;
  }

  /**
   * Get all messages addressed to a specific agent role for a project.
   */
  getMessagesForAgent(role: AgentRole, projectId: string): AgentMessage[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM agent_messages WHERE to_role = ? AND project_id = ? ORDER BY created_at ASC`,
    ).all(role, projectId) as AgentMessageRow[];

    return rows.map(rowToMessage);
  }

  /**
   * Get full message history for a project.
   */
  getMessageHistory(projectId: string): AgentMessage[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM agent_messages WHERE project_id = ? ORDER BY created_at ASC`,
    ).all(projectId) as AgentMessageRow[];

    return rows.map(rowToMessage);
  }

  /**
   * Subscribe to messages addressed to a specific role.
   */
  subscribe(role: AgentRole, callback: MessageCallback): void {
    const existing = this.subscribers.get(role) ?? [];
    existing.push(callback);
    this.subscribers.set(role, existing);
  }

  /**
   * Remove all subscribers (useful for cleanup).
   */
  clearSubscribers(): void {
    this.subscribers.clear();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private persist(message: AgentMessage): void {
    try {
      const db = getDb();
      db.prepare(
        `INSERT INTO agent_messages
           (id, project_id, from_role, from_instance, to_role, to_instance,
            type, phase, content, files_changed, parent_message_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        message.id,
        message.projectId,
        message.from,
        message.fromInstance ?? null,
        message.to,
        message.toInstance ?? null,
        message.type,
        message.phase,
        message.payload.content,
        message.payload.files ? JSON.stringify(message.payload.files.map((f) => f.path)) : null,
        message.parentMessageId ?? null,
        message.timestamp,
      );
    } catch (err) {
      logger.error('Failed to persist message', {
        messageId: message.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private notify(message: AgentMessage): void {
    const callbacks = this.subscribers.get(message.to) ?? [];
    for (const cb of callbacks) {
      try {
        cb(message);
      } catch (err) {
        logger.error('Subscriber callback error', {
          role: message.to,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// DB row mapping
// ---------------------------------------------------------------------------

interface AgentMessageRow {
  id: string;
  project_id: string;
  from_role: string;
  from_instance: string | null;
  to_role: string;
  to_instance: string | null;
  type: string;
  phase: string;
  content: string;
  files_changed: string | null;
  parent_message_id: string | null;
  created_at: string;
}

function rowToMessage(row: AgentMessageRow): AgentMessage {
  return {
    id: row.id,
    timestamp: row.created_at,
    from: row.from_role as AgentRole,
    fromInstance: row.from_instance ?? undefined,
    to: row.to_role as AgentRole,
    toInstance: row.to_instance ?? undefined,
    type: row.type as MessageType,
    phase: row.phase as WorkflowPhase,
    payload: {
      content: row.content,
      files: undefined,
    },
    parentMessageId: row.parent_message_id ?? undefined,
    projectId: row.project_id,
  };
}
