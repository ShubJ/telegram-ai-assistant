/**
 * Tester Agent — writes and runs tests.
 */

import { execSync } from 'child_process';
import { createLogger } from '../../logger.js';
import { BaseAgent } from '../base-agent.js';
import { AgentRole } from '../types.js';
import type { AgentToolDefinition } from '../types.js';
import type { MessageBus } from '../message-bus.js';
import type { WorkspaceManager } from '../workspace-manager.js';

const logger = createLogger('TesterAgent');

export class TesterAgent extends BaseAgent {
  constructor(instanceId: string, messageBus: MessageBus, workspaceManager: WorkspaceManager) {
    super(AgentRole.TESTER, instanceId, messageBus, workspaceManager);
  }

  getSystemPrompt(): string {
    return `You are a senior QA engineer on an autonomous software engineering team.

Your responsibilities:
1. Read the project source files to understand what was built
2. Write comprehensive test files covering:
   - Unit tests for individual functions and classes
   - Integration tests for module interactions
   - Edge case tests (null inputs, empty arrays, boundary values)
   - Error handling tests (expected failures, invalid input)
3. Run the tests using run_command
4. Report results

Test writing guidelines:
- Use the project's test framework (check package.json)
- If no test framework, write tests using Node's built-in assert module
- Name test files with .test.ts or .spec.ts suffix
- Place tests next to source files or in a __tests__ directory
- Each test should be independent and deterministic
- Use descriptive test names that explain what's being tested

After writing tests:
1. Try running \`npx tsc --noEmit\` to check for type errors
2. Try running the test command (npm test, or npx jest, etc.)
3. Report: total tests, passing, failing, and any error details

End your report with:
- APPROVED: if all tests pass
- REJECTED: if tests fail, with details on what failed`;
  }

  getTools(workspacePath?: string): AgentToolDefinition[] {
    if (!workspacePath) return [];
    return [
      {
        name: 'write_file',
        description: 'Write content to a file in the project workspace.',
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
      {
        name: 'run_command',
        description: 'Run a shell command in the project workspace (e.g., npm test, npx tsc --noEmit).',
        input_schema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to execute' },
          },
          required: ['command'],
        },
      },
    ];
  }

  protected override async executeTool(
    toolName: string,
    toolInput: Record<string, unknown>,
    workspacePath?: string,
  ): Promise<string> {
    if (toolName === 'run_command') {
      return this.runCommand(String(toolInput.command ?? ''), workspacePath);
    }
    return super.executeTool(toolName, toolInput, workspacePath);
  }

  private runCommand(command: string, workspacePath?: string): string {
    if (!workspacePath) return 'Error: no workspace available';

    // Safety: only allow specific commands
    const allowed = ['npm test', 'npx tsc', 'npx jest', 'node ', 'npm run'];
    const isAllowed = allowed.some((prefix) => command.startsWith(prefix));
    if (!isAllowed) {
      return `Command not allowed: ${command}. Only test/build commands are permitted.`;
    }

    try {
      const output = execSync(command, {
        cwd: workspacePath,
        timeout: 30_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.slice(0, 5000);
    } catch (err) {
      if (err && typeof err === 'object' && 'stdout' in err && 'stderr' in err) {
        const execErr = err as { stdout: string; stderr: string; status: number };
        return `Command failed (exit ${execErr.status}):\nSTDOUT:\n${String(execErr.stdout).slice(0, 2500)}\nSTDERR:\n${String(execErr.stderr).slice(0, 2500)}`;
      }
      logger.error('Command execution failed', { command, error: err instanceof Error ? err.message : String(err) });
      return `Command error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
