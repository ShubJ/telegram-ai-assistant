/**
 * Abstract base agent class.
 *
 * Every agent (PM, EM, TL, SDE3, etc.) extends BaseAgent. The base class
 * provides the LLM tool-use loop, message sending helpers, and token tracking.
 */

import { v4 as uuidv4 } from 'uuid';
import { getLLMManager } from '../llm/index.js';
import { createLogger } from '../logger.js';
import type { AgentMessage, AgentRole, AgentToolDefinition, MessageType, WorkflowPhase } from './types.js';
import type { MessageBus } from './message-bus.js';
import type { WorkspaceManager } from './workspace-manager.js';

const logger = createLogger('BaseAgent');

// ---------------------------------------------------------------------------
// Token usage tracking
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

// ---------------------------------------------------------------------------
// BaseAgent
// ---------------------------------------------------------------------------

export abstract class BaseAgent {
  readonly role: AgentRole;
  readonly instanceId: string;
  protected readonly messageBus: MessageBus;
  protected readonly workspaceManager: WorkspaceManager;
  protected tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, calls: 0 };

  constructor(
    role: AgentRole,
    instanceId: string,
    messageBus: MessageBus,
    workspaceManager: WorkspaceManager,
  ) {
    this.role = role;
    this.instanceId = instanceId;
    this.messageBus = messageBus;
    this.workspaceManager = workspaceManager;
  }

  /**
   * Return the system prompt that defines this agent's personality and role.
   */
  abstract getSystemPrompt(): string;

  /**
   * Return the tool definitions available to this agent.
   */
  abstract getTools(workspacePath?: string): AgentToolDefinition[];

  /**
   * Execute a task: sends the task content to the LLM with the agent's
   * system prompt and tools, runs the tool-use loop, and returns the
   * response as an AgentMessage.
   */
  async execute(
    task: AgentMessage,
    workspacePath?: string,
  ): Promise<AgentMessage> {
    const agentLabel = `${this.role}${this.instanceId ? `-${this.instanceId}` : ''}`;
    logger.info(`${agentLabel} executing task`, {
      phase: task.phase,
      contentPreview: task.payload.content.slice(0, 100),
    });

    const systemPrompt = this.getSystemPrompt();
    const tools = this.getTools(workspacePath);
    const llm = getLLMManager();

    const executeToolFn = async (
      toolName: string,
      toolInput: Record<string, unknown>,
    ): Promise<string> => {
      return this.executeTool(toolName, toolInput, workspacePath);
    };

    const response = await llm.chatWithTools(
      [{ role: 'user', content: task.payload.content }],
      systemPrompt,
      { maxTokens: 8192, temperature: 0.4 },
      tools,
      executeToolFn,
    );

    // Track usage
    this.tokenUsage.inputTokens += response.usage.inputTokens;
    this.tokenUsage.outputTokens += response.usage.outputTokens;
    this.tokenUsage.calls += 1;

    logger.info(`${agentLabel} completed`, {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
    });

    // Build response message
    return {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      from: this.role,
      fromInstance: this.instanceId || undefined,
      to: task.from,
      toInstance: task.fromInstance,
      type: 'SUBMISSION' as MessageType,
      phase: task.phase,
      payload: {
        content: response.content,
        metadata: { model: response.model },
      },
      parentMessageId: task.id,
      projectId: task.projectId,
    };
  }

  /**
   * Get accumulated token usage for this agent instance.
   */
  getTokenUsage(): TokenUsage {
    return { ...this.tokenUsage };
  }

  // -------------------------------------------------------------------------
  // Tool execution — override in subclasses for custom tools
  // -------------------------------------------------------------------------

  /**
   * Execute a tool call. Subclasses can override to add custom tool handlers.
   */
  protected async executeTool(
    toolName: string,
    toolInput: Record<string, unknown>,
    workspacePath?: string,
  ): Promise<string> {
    switch (toolName) {
      case 'read_file': {
        if (!workspacePath) return 'Error: no workspace available';
        const filePath = String(toolInput.path ?? '');
        const content = this.workspaceManager.readFile(workspacePath, filePath);
        return content || `File not found: ${filePath}`;
      }

      case 'write_file': {
        if (!workspacePath) return 'Error: no workspace available';
        const filePath = String(toolInput.path ?? '');
        const content = String(toolInput.content ?? '');
        this.workspaceManager.writeFile(workspacePath, filePath, content);
        return `File written: ${filePath} (${content.length} bytes)`;
      }

      case 'list_files': {
        if (!workspacePath) return 'Error: no workspace available';
        const subDir = toolInput.directory ? String(toolInput.directory) : undefined;
        const files = this.workspaceManager.listFiles(workspacePath, subDir);
        return files.length > 0 ? files.join('\n') : 'No files found';
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Send a message through the bus.
   */
  protected sendMessage(
    to: AgentRole,
    type: MessageType,
    phase: WorkflowPhase,
    content: string,
    projectId: string,
    parentMessageId?: string,
  ): AgentMessage {
    return this.messageBus.send({
      from: this.role,
      fromInstance: this.instanceId || undefined,
      to,
      type,
      phase,
      payload: { content },
      parentMessageId,
      projectId,
    });
  }
}
