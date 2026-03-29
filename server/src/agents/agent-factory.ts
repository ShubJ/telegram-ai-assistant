/**
 * Agent factory — creates agent instances by role.
 */

import { AgentRole, ReviewerSpecialty } from './types.js';
import type { MessageBus } from './message-bus.js';
import type { WorkspaceManager } from './workspace-manager.js';
import type { BaseAgent } from './base-agent.js';
import { ResearcherAgent } from './roles/researcher.js';
import { PMAgent } from './roles/pm.js';
import { EMAgent } from './roles/em.js';
import { TLAgent } from './roles/tl.js';
import { SDE3Agent } from './roles/sde3.js';
import { ReviewerAgent } from './roles/reviewer.js';
import { TesterAgent } from './roles/tester.js';
import { GitHubAgent } from './roles/github-agent.js';
import { AuditorAgent } from './roles/auditor.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAgent(
  role: AgentRole,
  messageBus: MessageBus,
  workspaceManager: WorkspaceManager,
  instanceId?: string,
  specialty?: ReviewerSpecialty,
): BaseAgent {
  const id = instanceId ?? '';

  switch (role) {
    case AgentRole.RESEARCHER:
      return new ResearcherAgent(id, messageBus, workspaceManager);

    case AgentRole.PM:
      return new PMAgent(id, messageBus, workspaceManager);

    case AgentRole.EM:
      return new EMAgent(id, messageBus, workspaceManager);

    case AgentRole.TL:
      return new TLAgent(id, messageBus, workspaceManager);

    case AgentRole.SDE3:
      return new SDE3Agent(id, messageBus, workspaceManager);

    case AgentRole.REVIEWER:
      return new ReviewerAgent(id, messageBus, workspaceManager, specialty ?? ReviewerSpecialty.CODE_QUALITY);

    case AgentRole.TESTER:
      return new TesterAgent(id, messageBus, workspaceManager);

    case AgentRole.GITHUB:
      return new GitHubAgent(id, messageBus, workspaceManager);

    case AgentRole.AUDITOR:
      return new AuditorAgent(id, messageBus, workspaceManager);

    default:
      throw new Error(`Unknown agent role: ${role}`);
  }
}
