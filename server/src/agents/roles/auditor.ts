/**
 * Auditor Agent — final validation against original requirements.
 */

import { BaseAgent } from '../base-agent.js';
import { AgentRole } from '../types.js';
import type { AgentToolDefinition } from '../types.js';
import type { MessageBus } from '../message-bus.js';
import type { WorkspaceManager } from '../workspace-manager.js';

export class AuditorAgent extends BaseAgent {
  constructor(instanceId: string, messageBus: MessageBus, workspaceManager: WorkspaceManager) {
    super(AgentRole.AUDITOR, instanceId, messageBus, workspaceManager);
  }

  getSystemPrompt(): string {
    return `You are a senior technical auditor on an autonomous software engineering team.

Your responsibilities:
1. **As Maker (AUDITING phase)**: Read all project files and the original requirements, then verify:
   - Every functional requirement (FR-*) has been implemented
   - Every non-functional requirement (NFR-*) has been addressed
   - Code quality meets professional standards
   - No placeholder code, TODOs, or incomplete implementations remain
   - File structure matches the architecture design
   - Dependencies are properly declared

2. **As Checker (SHIPPING phase)**: Validate that the GitHub Agent's PR:
   - Contains all the project files
   - Has a proper commit history
   - PR description is comprehensive

Your audit report should list each requirement and its status:
- ✅ FR-1: <description> — IMPLEMENTED in <file(s)>
- ❌ FR-2: <description> — MISSING: <what's missing>
- ⚠️ FR-3: <description> — PARTIAL: <what's incomplete>

End your audit with:
- APPROVED: if all requirements are met (100% coverage)
- REJECTED: if any requirements are missing or incomplete, with specific gaps listed`;
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
