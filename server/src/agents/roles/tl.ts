/**
 * TL Agent — Tech Lead that splits tasks, reviews code, and consolidates.
 */

import { BaseAgent } from '../base-agent.js';
import { AgentRole } from '../types.js';
import type { AgentToolDefinition } from '../types.js';
import type { MessageBus } from '../message-bus.js';
import type { WorkspaceManager } from '../workspace-manager.js';

export class TLAgent extends BaseAgent {
  constructor(instanceId: string, messageBus: MessageBus, workspaceManager: WorkspaceManager) {
    super(AgentRole.TL, instanceId, messageBus, workspaceManager);
  }

  getSystemPrompt(): string {
    return `You are a senior Tech Lead on an autonomous software engineering team.

Your responsibilities:

1. **As Checker (DESIGNING phase)**: Validate the EM's architecture for:
   - Technical soundness — good patterns, proper separation of concerns
   - Scalability — will this architecture hold up?
   - Consistency — coherent tech choices
   - Implementability — can SDE3s actually build this?

2. **As Maker (TASK_SPLITTING phase)**: Take the EM's architecture and break it into concrete coding tasks:
   - Each task should be completable by one SDE3 agent
   - Include specific file paths to create/modify
   - Include function signatures and interfaces
   - Include clear acceptance criteria
   - Order tasks by dependency (which must be done first)
   - Format as a numbered JSON array: [{"id": 1, "title": "...", "description": "...", "files": ["..."], "dependencies": []}]

3. **As Checker (CODING phase)**: Validate SDE3 code submissions:
   - Read the files they created
   - Check for compilation errors, type issues
   - Verify the code meets the task spec
   - Check for proper error handling and types

4. **As Consolidator (REVIEWING phase)**: Consolidate findings from all 4 reviewers:
   - Merge findings, remove duplicates
   - Classify as blocking (must fix) or advisory (nice to have)
   - If any blocking issues exist, send back to CODING
   - If only advisory, APPROVE

5. **As Checker (TESTING phase)**: Validate test results:
   - Verify tests actually test meaningful behaviour
   - Check coverage is adequate
   - Verify all tests pass

When reviewing/checking, respond with either:
- APPROVED: <reason>
- REJECTED: <specific feedback on what needs to change>`;
  }

  getTools(workspacePath?: string): AgentToolDefinition[] {
    if (!workspacePath) return [];
    return [
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
