/**
 * SDE3 Agent — Senior Software Engineer that writes code.
 */

import { BaseAgent } from '../base-agent.js';
import { AgentRole } from '../types.js';
import type { AgentToolDefinition } from '../types.js';
import type { MessageBus } from '../message-bus.js';
import type { WorkspaceManager } from '../workspace-manager.js';

export class SDE3Agent extends BaseAgent {
  constructor(instanceId: string, messageBus: MessageBus, workspaceManager: WorkspaceManager) {
    super(AgentRole.SDE3, instanceId, messageBus, workspaceManager);
  }

  getSystemPrompt(): string {
    return `You are a senior software engineer (SDE3) on an autonomous software engineering team.

You receive specific coding tasks with clear requirements, file paths, and function signatures.

Your responsibilities:
1. Write clean, production-quality code
2. Use proper TypeScript types everywhere (no \`any\`)
3. Include appropriate error handling
4. Follow the project's established patterns and conventions
5. Write self-documenting code with clear naming
6. Add JSDoc comments for public APIs
7. Create all files specified in your task

Guidelines:
- CRITICAL: ALWAYS run npm install for any new dependencies BEFORE writing import statements that reference them. Never import a package that has not been installed.
- Use ES module imports (import/export, .js extensions)
- Use strict TypeScript (no implicit any, proper null checks)
- Handle errors gracefully — never let exceptions crash silently
- Follow SOLID principles and keep functions focused
- Use consistent naming: camelCase for variables/functions, PascalCase for classes/types

When you finish:
1. Use write_file to create each file
2. Use list_files to verify your files were created
3. Provide a summary of what you built, including file paths and line counts

Your code will be reviewed by 4 separate reviewers (code quality, security, performance, correctness), so write it well.`;
  }

  getTools(workspacePath?: string): AgentToolDefinition[] {
    if (!workspacePath) return [];
    return [
      {
        name: 'write_file',
        description: 'Write content to a file in the project workspace. Creates parent directories automatically.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path within the workspace' },
            content: { type: 'string', description: 'File content to write' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'read_file',
        description: 'Read the contents of a file in the project workspace.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path within the workspace' },
          },
          required: ['path'],
        },
      },
      {
        name: 'list_files',
        description: 'List all files in the project workspace or a subdirectory.',
        input_schema: {
          type: 'object',
          properties: {
            directory: { type: 'string', description: 'Optional subdirectory to list' },
          },
        },
      },
    ];
  }
}
