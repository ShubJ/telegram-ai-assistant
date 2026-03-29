/**
 * GitHub Agent — handles git operations and PR creation.
 */

import { execSync } from 'child_process';
import { createLogger } from '../../logger.js';
import { BaseAgent } from '../base-agent.js';
import { AgentRole } from '../types.js';
import type { AgentToolDefinition } from '../types.js';
import type { MessageBus } from '../message-bus.js';
import type { WorkspaceManager } from '../workspace-manager.js';
import { GitHubClient } from '../../github/client.js';

const logger = createLogger('GitHubAgent');

export class GitHubAgent extends BaseAgent {
  constructor(instanceId: string, messageBus: MessageBus, workspaceManager: WorkspaceManager) {
    super(AgentRole.GITHUB, instanceId, messageBus, workspaceManager);
  }

  getSystemPrompt(): string {
    return `You are a DevOps engineer responsible for Git operations on an autonomous software engineering team.

Your responsibilities:
1. Create a GitHub repository for the project (if needed)
2. Create a feature branch
3. Stage and commit all project files with a clear commit message
4. Push the branch to GitHub
5. Create a Pull Request with a comprehensive description

Follow these conventions:
- Branch naming: feature/<short-description> or fix/<short-description>
- Commit messages: conventional commits format (feat:, fix:, docs:, etc.)
- PR title: clear, concise summary
- PR body: description, changes list, testing notes

Use the available tools to perform each step. If a step fails, report the error clearly.`;
  }

  getTools(workspacePath?: string): AgentToolDefinition[] {
    if (!workspacePath) return [];
    return [
      {
        name: 'git_init',
        description: 'Initialise a git repository in the workspace.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'git_add',
        description: 'Stage files for commit.',
        input_schema: {
          type: 'object',
          properties: {
            files: { type: 'string', description: 'Files to stage (use "." for all)' },
          },
          required: ['files'],
        },
      },
      {
        name: 'git_commit',
        description: 'Create a git commit with the given message.',
        input_schema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Commit message' },
          },
          required: ['message'],
        },
      },
      {
        name: 'git_branch',
        description: 'Create and checkout a new branch.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Branch name' },
          },
          required: ['name'],
        },
      },
      {
        name: 'git_push',
        description: 'Push the current branch to the remote repository.',
        input_schema: {
          type: 'object',
          properties: {
            remote: { type: 'string', description: 'Remote name (default: origin)' },
          },
        },
      },
      {
        name: 'create_repo',
        description: 'Create a new GitHub repository.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Repository name' },
            description: { type: 'string', description: 'Repository description' },
            isPrivate: { type: 'boolean', description: 'Whether the repo should be private' },
          },
          required: ['name'],
        },
      },
      {
        name: 'create_pr',
        description: 'Create a pull request on GitHub.',
        input_schema: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository in owner/name format' },
            head: { type: 'string', description: 'Head branch name' },
            base: { type: 'string', description: 'Base branch name' },
            title: { type: 'string', description: 'PR title' },
            body: { type: 'string', description: 'PR description body' },
          },
          required: ['repo', 'head', 'base', 'title', 'body'],
        },
      },
      {
        name: 'list_files',
        description: 'List all files in the project workspace.',
        input_schema: {
          type: 'object',
          properties: {
            directory: { type: 'string', description: 'Optional subdirectory' },
          },
        },
      },
    ];
  }

  protected override async executeTool(
    toolName: string,
    toolInput: Record<string, unknown>,
    workspacePath?: string,
  ): Promise<string> {
    if (!workspacePath && toolName !== 'create_repo' && toolName !== 'create_pr') {
      return 'Error: no workspace available';
    }

    switch (toolName) {
      case 'git_init':
        return this.gitExec('git init', workspacePath!);

      case 'git_add':
        return this.gitExec(`git add ${String(toolInput.files ?? '.')}`, workspacePath!);

      case 'git_commit':
        return this.gitExec(`git commit -m "${String(toolInput.message ?? 'commit').replace(/"/g, '\\"')}"`, workspacePath!);

      case 'git_branch':
        return this.gitExec(`git checkout -b ${String(toolInput.name ?? 'feature/new')}`, workspacePath!);

      case 'git_push': {
        const remote = String(toolInput.remote ?? 'origin');
        return this.gitExec(`git push -u ${remote} HEAD`, workspacePath!);
      }

      case 'create_repo':
        return this.createRepo(toolInput);

      case 'create_pr':
        return this.createPR(toolInput);

      case 'list_files':
        return super.executeTool(toolName, toolInput, workspacePath);

      default:
        return `Unknown tool: ${toolName}`;
    }
  }

  private gitExec(command: string, cwd: string): string {
    try {
      const output = execSync(command, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return output.trim() || 'OK';
    } catch (err) {
      if (err && typeof err === 'object' && 'stderr' in err) {
        return `Git error: ${String((err as { stderr: string }).stderr).slice(0, 1000)}`;
      }
      return `Git error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async createRepo(input: Record<string, unknown>): Promise<string> {
    try {
      const client = new GitHubClient();
      const result = await client.createRepo(
        String(input.name ?? ''),
        String(input.description ?? ''),
        Boolean(input.isPrivate ?? true),
      );
      return `Repository created: ${result.htmlUrl}\nClone URL: ${result.cloneUrl}`;
    } catch (err) {
      logger.error('Create repo failed', { error: err instanceof Error ? err.message : String(err) });
      return `Failed to create repo: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async createPR(input: Record<string, unknown>): Promise<string> {
    try {
      const client = new GitHubClient();
      const [owner, repo] = String(input.repo ?? '').split('/');
      const result = await client.createPR(
        owner,
        repo,
        String(input.head ?? ''),
        String(input.base ?? 'main'),
        String(input.title ?? ''),
        String(input.body ?? ''),
      );
      return `Pull request created: ${result.htmlUrl}`;
    } catch (err) {
      logger.error('Create PR failed', { error: err instanceof Error ? err.message : String(err) });
      return `Failed to create PR: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
