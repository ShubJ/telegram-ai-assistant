/**
 * Agent system public API — registers as a Telegram skill.
 */

import { BaseSkill } from '../skills/base.js';
import type { SkillResult, ToolDefinition } from '../skills/base.js';
import { getOrchestrator } from './orchestrator.js';
import { createLogger } from '../logger.js';
import type { Bot, Context } from 'grammy';

const logger = createLogger('AgentSkill');

// ---------------------------------------------------------------------------
// AgentSkill — integrates the multi-agent system as a bot skill
// ---------------------------------------------------------------------------

export class AgentSkill extends BaseSkill {
  readonly name = 'agents';
  readonly description = 'Multi-agent software engineering system — build entire projects autonomously';

  setBot(botInstance: Bot<Context>): void {
    getOrchestrator().setBot(botInstance);
  }

  getToolDefinition(): ToolDefinition {
    return {
      name: 'agents',
      description: 'Start a software project or task using the multi-agent engineering system. Use action "project" to create a new project from scratch, or "task" to add a feature/fix to an existing repo.',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['project', 'task', 'status', 'cancel', 'list'],
            description: 'The action to perform',
          },
          description: {
            type: 'string',
            description: 'Project/task description (for project/task actions)',
          },
          repoPath: {
            type: 'string',
            description: 'Path to existing repo (for task action)',
          },
          projectId: {
            type: 'string',
            description: 'Project ID (for status/cancel actions)',
          },
          userId: {
            type: 'string',
            description: 'User ID',
          },
          chatId: {
            type: 'string',
            description: 'Chat ID for progress updates',
          },
        },
        required: ['action'],
      },
    };
  }

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const action = String(params.action ?? '');
    const orchestrator = getOrchestrator();

    try {
      switch (action) {
        case 'project': {
          const description = String(params.description ?? '');
          const userId = String(params.userId ?? '');
          const chatId = String(params.chatId ?? '');
          if (!description) return this.failure('Please provide a project description.');
          if (!userId || !chatId) return this.failure('Missing user or chat ID.');
          const projectId = await orchestrator.startProject(userId, description, chatId);
          return this.success(`🚀 Project started! ID: \`${projectId.slice(0, 8)}\`\nI'll send you progress updates as agents work.`);
        }

        case 'task': {
          const description = String(params.description ?? '');
          const repoPath = String(params.repoPath ?? '');
          const userId = String(params.userId ?? '');
          const chatId = String(params.chatId ?? '');
          if (!description) return this.failure('Please provide a task description.');
          if (!repoPath) return this.failure('Please provide a repository path.');
          if (!userId || !chatId) return this.failure('Missing user or chat ID.');
          const projectId = await orchestrator.startTask(userId, repoPath, description, chatId);
          return this.success(`🚀 Task started! ID: \`${projectId.slice(0, 8)}\`\nI'll send you progress updates.`);
        }

        case 'status': {
          const projectId = String(params.projectId ?? '');
          if (!projectId) return this.failure('Please provide a project ID.');
          const status = orchestrator.getStatus(projectId);
          if (!status) return this.failure(`No project found with ID: ${projectId}`);
          return this.success(
            `📊 *Project Status*\n` +
            `ID: \`${status.projectId.slice(0, 8)}\`\n` +
            `Phase: ${status.phase}\n` +
            `Progress: ${status.progress}\n` +
            `Started: ${status.startedAt}` +
            (status.error ? `\nError: ${status.error}` : ''),
          );
        }

        case 'cancel': {
          const projectId = String(params.projectId ?? '');
          if (!projectId) return this.failure('Please provide a project ID.');
          orchestrator.cancelProject(projectId);
          return this.success(`🛑 Project \`${projectId.slice(0, 8)}\` cancelled.`);
        }

        case 'list': {
          const userId = String(params.userId ?? '');
          if (!userId) return this.failure('Missing user ID.');
          const projects = orchestrator.listProjects(userId);
          if (projects.length === 0) return this.success('No projects found.');
          const lines = projects.map((p) => {
            const icon = p.status === 'COMPLETE' ? '✅' : p.status === 'FAILED' ? '❌' : '⏳';
            return `${icon} \`${p.id.slice(0, 8)}\` ${p.status} — ${p.description.slice(0, 50)}`;
          });
          return this.success(`*Your Projects:*\n${lines.join('\n')}`);
        }

        default:
          return this.failure(`Unknown action: ${action}. Use: project, task, status, cancel, list`);
      }
    } catch (err) {
      logger.error('Agent skill error', { action, error: err instanceof Error ? err.message : String(err) });
      return this.failure(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// Re-exports
export { getOrchestrator } from './orchestrator.js';
export { MessageBus } from './message-bus.js';
export { WorkspaceManager } from './workspace-manager.js';
export { CostEstimator } from './cost-estimator.js';
export { createAgent } from './agent-factory.js';
export * from './types.js';
